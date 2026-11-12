// エージェント一覧 (/agents) とヘッダの件数表示の元になる 1 本の応答。
//
// 新しく観測はしない。tmux のペイン一覧と、terminal/activity.ts の巡回と
// フック申告が既に決めた状態を突き合わせ、ペインの cwd から求めたプロジェクト
// (git の本体のルート) を付けるだけ。状態の判定規則はここでは変えない。
//
// tmux のペインはどのサーバから見ても同じなので、どのリポジトリで開いた
// code-viewer からでも同じ全体一覧になる。
//
// git とサーバ登録簿への問い合わせは、ペインの cwd / プロジェクトごとに
// 短い間だけ覚えておく。一覧は数秒おきに取り直されるので、毎回 30 本の git を
// 立てないため。失敗は覚えた結果ごと応答の errors に載せ、黙って消さない。

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import {
  agentTmuxPanes,
  isAccountAgent,
  type PaneAccount,
} from "../../core/agent-accounts";
import {
  type AgentOverviewResponse,
  type AgentOverviewShell,
  type AgentPane,
  type AgentProjectInfo,
  type AgentProjectServer,
  abbreviateHome,
  agentKindOf,
  projectOpenable,
} from "../../core/agent-overview";
import type {
  AgentStateObservationError,
  AgentStateRecord,
} from "../../core/agent-state";
import { formatErrorDetail } from "../../core/error-detail";
import type { ProjectRegistrySnapshot } from "../../core/projects";
import type { ShellSession } from "../../core/shell";
import { basenameOf, linkShellsAndPanes } from "../../core/terminal-board";
import type { TmuxClient, TmuxPanesResponse } from "../../core/tmux";
import type { ProbeTarget } from "../accounts/process-env";
import {
  type PaneAccountTarget,
  sharedAccountService,
} from "../accounts/service";
import { projectRootResultAsync } from "../git";
import {
  projectRegistryPath,
  projectRegistrySnapshot,
} from "../projects/registry";
import { listShellSessionsForMatching } from "../shell/session";
import { listTmuxClients } from "../tmux/clients";
import { listTmuxPanes } from "../tmux/panes";
import { runningServerResult } from "../worktree/open";
import { agentActivityObservedAt, getAgentActivityErrors } from "./activity";
import {
  type AgentConversationEntry,
  getAgentConversation,
  listAgentStates,
} from "./agent-state";
import {
  createProcessKindProber,
  type ProcessKindProber,
  type ProcessKindResult,
} from "./process-kind";

export type ProjectResolution =
  | { kind: "root"; root: string; toplevel: string }
  | { kind: "outside" }
  | { kind: "error"; error: string };

export type AgentOverviewDeps = {
  /** このサーバのプロセスを見分ける値 (AgentOverviewResponse.serverInstance)。 */
  serverInstance: string;
  /** ホームディレクトリ。見出しのパスを `~/…` に縮めるのに使う。 */
  home: string;
  /** この画面を出しているサーバの cwd。そのプロジェクトは「このサーバ」になる。 */
  serverRoot: string;
  listPanes(): Promise<TmuxPanesResponse>;
  listStates(): AgentStateRecord[];
  /**
   * フックが知らせた会話の場所 (terminal/agent-state.ts)。状態の記録とは別に
   * 持つ (状態は保存しないが、場所は起動を跨いで戻す)。
   */
  conversationOf(target: string): AgentConversationEntry | null;
  /** terminal/activity.ts が最後に巡回を完了した時刻。 */
  activityObservedAt(): number;
  observationErrors(): AgentStateObservationError[];
  listShells(): ShellSession[] | Promise<ShellSession[]>;
  listClients(): Promise<
    | { status: "ok"; clients: TmuxClient[] }
    | { status: "error"; error: unknown }
  >;
  resolveProject(path: string): Promise<ProjectResolution>;
  /**
   * ペインを初めて一覧に載せた時刻。状態の記録がまだ無いペイン (どの画面
   * ルールにも当たらない待機など) の「見始めた時刻」に使う。呼び出しを
   * 跨いで持つ。
   */
  firstListed: Map<string, number>;
  findServer(root: string): Promise<AgentProjectServer>;
  /** findServer の覚えた結果を捨てる。 */
  forgetServer(root: string): void;
  /** 登録したプロジェクト (エージェントが居なくても一覧に載せる)。 */
  readRegistry(): ProjectRegistrySnapshot | Promise<ProjectRegistrySnapshot>;
  /** 登録したフォルダがまだ在るか (消えたものは見出しに理由を出す)。 */
  rootExists(root: string): boolean;
  /**
   * claude / codex の行がどのアカウントで動いているか。プロセスの調査は
   * accounts/process-env.ts が頻度を抑えて行う。
   */
  paneAccounts(
    targets: readonly PaneAccountTarget[],
  ): Promise<Map<string, PaneAccount>>;
  /**
   * 前面のコマンドがインタプリタ (node など) のペインの中のプログラムの種類。
   * process-kind.ts が覚えておき、ペインかコマンドが変わったときだけ ps を呼ぶ。
   */
  paneProcessKinds(targets: readonly ProbeTarget[]): Promise<ProcessKindResult>;
  now(): number;
};

function error(
  operation: AgentStateObservationError["operation"],
  target: string,
  cause: unknown,
  at: number,
): AgentStateObservationError {
  return {
    operation,
    target,
    at,
    detail: formatErrorDetail(cause),
    stack: cause instanceof Error ? (cause.stack ?? "") : "",
  };
}

export async function buildAgentOverview(
  deps: AgentOverviewDeps,
): Promise<AgentOverviewResponse> {
  const now = deps.now();
  const observedAt = deps.activityObservedAt();
  const errors = deps.observationErrors();
  let panes: TmuxPanesResponse;
  try {
    panes = await deps.listPanes();
  } catch (cause) {
    console.error("[code-viewer] agent overview: tmux listing failed", cause);
    return {
      serverInstance: deps.serverInstance,
      observedAt,
      tmux: {
        available: true,
        running: false,
        error: formatErrorDetail(cause),
      },
      panes: [],
      projects: [],
      errors,
      registry: await deps.readRegistry(),
      shells: overviewShells(await deps.listShells(), []),
    };
  }
  const tmuxPanes = panes.running ? agentTmuxPanes(panes.sessions) : [];
  if (panes.running) {
    const listed = new Set(tmuxPanes.map((pane) => pane.id));
    for (const id of [...deps.firstListed.keys()]) {
      if (!listed.has(id)) deps.firstListed.delete(id);
    }
    for (const id of listed) {
      if (!deps.firstListed.has(id)) deps.firstListed.set(id, now);
    }
  }

  const clients = await deps.listClients();
  const shells = await deps.listShells();
  let paneToShell = new Map<string, string>();
  if (clients.status === "ok") {
    paneToShell = linkShellsAndPanes(shells, clients.clients).paneToShell;
  } else {
    errors.push(error("list_clients", "", clients.error, now));
  }

  const paths = [...new Set(tmuxPanes.map((pane) => pane.path))];
  const resolved = new Map(
    await Promise.all(
      paths.map(
        async (path) => [path, await deps.resolveProject(path)] as const,
      ),
    ),
  );

  const projects = new Map<string, AgentProjectInfo>();
  const states = new Map(
    deps.listStates().map((record) => [record.target, record]),
  );
  const processKinds = await deps.paneProcessKinds(
    tmuxPanes.map((pane) => ({
      id: pane.id,
      pid: pane.pid,
      command: pane.command,
    })),
  );
  for (const failure of processKinds.errors) {
    errors.push(error("probe_process", failure.target, failure.error, now));
  }
  const kinds = new Map(
    tmuxPanes.map((pane) => {
      const record = states.get(pane.id) ?? null;
      return [
        pane.id,
        agentKindOf(
          pane.command,
          record?.source ?? null,
          record,
          processKinds.kinds.get(pane.id) ?? null,
        ),
      ] as const;
    }),
  );
  const accounts = await deps.paneAccounts(
    tmuxPanes.map((pane) => ({
      id: pane.id,
      pid: pane.pid,
      command: pane.command,
      kind: kinds.get(pane.id) ?? null,
    })),
  );
  const result: AgentPane[] = [];
  const placeOf = new Map<string, { session: string; window: number }>();
  for (const session of panes.sessions) {
    for (const window of session.windows) {
      for (const pane of window.panes)
        placeOf.set(pane.id, { session: session.name, window: window.index });
    }
  }
  // git の外で動くペイン (作業役を一時フォルダで起こしたものなど) は、同じ
  // ウインドウのリポジトリのペインがみな同じプロジェクトなら、そのプロジェクトに
  // 入れる。作業場所のフォルダを 1 つのプロジェクトにすると、登録していない
  // 別のプロジェクトとして「tmux で検出」に出ていた。リポジトリが無い・2 つ
  // 以上あるウインドウでは決めず、作業場所のままにする。
  const windowKey = (place: { session: string; window: number }) =>
    `${place.session}\u0000${place.window}`;
  const windowRoots = new Map<string, Set<string>>();
  for (const pane of tmuxPanes) {
    const resolution = resolved.get(pane.path);
    const place = placeOf.get(pane.id);
    if (resolution?.kind !== "root" || !place) continue;
    const roots = windowRoots.get(windowKey(place)) ?? new Set<string>();
    roots.add(resolution.root);
    windowRoots.set(windowKey(place), roots);
  }
  // git の外で動くペインは、それを含む登録したプロジェクト (git の外のフォルダを
  // 登録したもの) があれば、その一番近い根に入れる。ウインドウから借りるより先:
  // 登録は利用者がそのフォルダをプロジェクトと決めたもの。
  const registry = await deps.readRegistry();
  const registeredRootOf = (path: string): string | null => {
    let found: string | null = null;
    for (const project of registry.projects) {
      const inside =
        path === project.root || path.startsWith(`${project.root}/`);
      if (inside && (!found || project.root.length > found.length))
        found = project.root;
    }
    return found;
  };
  const windowRootOf = (paneId: string): string | null => {
    const place = placeOf.get(paneId);
    const roots = place ? windowRoots.get(windowKey(place)) : undefined;
    return roots?.size === 1 ? ([...roots][0] ?? null) : null;
  };
  for (const pane of tmuxPanes) {
    const resolution = resolved.get(pane.path) ?? {
      kind: "error" as const,
      error: `project for ${pane.path} was not resolved`,
    };
    const outside = resolution.kind === "outside";
    const registeredOutside = outside ? registeredRootOf(pane.path) : null;
    const borrowed =
      outside && !registeredOutside ? windowRootOf(pane.id) : null;
    const root =
      resolution.kind === "root"
        ? resolution.root
        : (registeredOutside ?? borrowed ?? pane.path);
    if (!projects.has(root)) {
      projects.set(root, {
        root,
        name: basenameOf(root) || root,
        displayRoot: abbreviateHome(root, deps.home),
        git: resolution.kind === "root" || borrowed !== null,
        error: resolution.kind === "error" ? resolution.error : "",
        server: { status: "none" },
        registered: null,
      });
      if (resolution.kind === "error") {
        errors.push(error("resolve_project", pane.path, resolution.error, now));
      }
    }
    const record = states.get(pane.id);
    const source = record?.source ?? null;
    const conversation = deps.conversationOf(pane.id);
    // tmuxPanes は同じ木を平らにしたものなので、必ず見つかる。
    const place = placeOf.get(pane.id);
    if (!place) throw new Error(`tmux pane ${pane.id} is not in the pane tree`);
    result.push({
      id: pane.id,
      label: pane.label,
      session: place.session,
      window: place.window,
      title: pane.title,
      command: pane.command,
      path: pane.path,
      kind: kinds.get(pane.id) ?? null,
      state: record?.state ?? "idle",
      source,
      updatedAt: record?.changeObserved ? record.updatedAt : 0,
      watchedSince: record
        ? record.changeObserved
          ? 0
          : record.updatedAt
        : (deps.firstListed.get(pane.id) ?? 0),
      project: root,
      worktree:
        resolution.kind === "root" && resolution.toplevel !== resolution.root
          ? basenameOf(resolution.toplevel)
          : "",
      shownInShell: paneToShell.get(pane.id) ?? "",
      account: isAccountAgent(kinds.get(pane.id))
        ? (accounts.get(pane.id) ?? {
            kind: "unknown",
            reason: "the account of this pane was not resolved",
          })
        : null,
      ...(conversation ? { conversation: conversation.conversation } : {}),
      ...(record?.attention && record.state === "waiting"
        ? { attention: record.attention }
        : {}),
      ...(pane.parent ? { parent: pane.parent } : {}),
    });
  }

  // 登録したプロジェクトを合わせる。同じ根なら 1 つにまとめ、表示名は登録の
  // 名前にする。エージェントの居ないものは行の無い見出しになる。git のリポジトリ
  // かは根を引いて決める (git の外のフォルダも登録できる。引けなければ git の外と
  // 同じに数え、理由は出さない: 開いた裏が git の失敗を出す)。
  const unseen = registry.projects.filter(
    (registered) => !projects.has(registered.root),
  );
  const registeredGit = new Map(
    await Promise.all(
      unseen.map(
        async (registered) =>
          [
            registered.root,
            deps.rootExists(registered.root) &&
              (await deps.resolveProject(registered.root)).kind === "root",
          ] as const,
      ),
    ),
  );
  for (const registered of registry.projects) {
    const found = projects.get(registered.root);
    if (found) {
      found.registered = registered;
      found.name = registered.name;
      continue;
    }
    projects.set(registered.root, {
      root: registered.root,
      name: registered.name,
      displayRoot: abbreviateHome(registered.root, deps.home),
      git: registeredGit.get(registered.root) === true,
      error: deps.rootExists(registered.root)
        ? ""
        : `${registered.root} does not exist`,
      server: { status: "none" },
      registered,
    });
  }

  await Promise.all(
    [...projects.values()].filter(projectOpenable).map(async (info) => {
      if (info.root === deps.serverRoot) {
        info.server = { status: "current" };
        return;
      }
      info.server = await deps.findServer(info.root);
      if (
        info.server.status === "unreachable" ||
        info.server.status === "invalid"
      ) {
        errors.push(error("find_server", info.root, info.server.detail, now));
      }
    }),
  );

  return {
    serverInstance: deps.serverInstance,
    observedAt,
    tmux: {
      available: panes.available,
      running: panes.running,
      error: "",
    },
    panes: result,
    projects: [...projects.values()],
    errors,
    registry,
    shells: overviewShells(
      shells,
      clients.status === "ok" ? clients.clients : [],
    ),
  };
}

/**
 * 生きているシェルと、その端末に繋がっている tmux のクライアントの大きさ。
 * 端末名 (tty) を引けなかったシェルは、どのクライアントにも当てない
 * (空文字どうしが一致して無関係な端末の大きさを覆いに使わない)。
 */
function overviewShells(
  shells: ShellSession[],
  clients: TmuxClient[],
): AgentOverviewShell[] {
  return shells
    .filter((shell) => !shell.exited)
    .map((shell) => ({
      id: shell.id,
      cwd: shell.cwd,
      window:
        (shell.tty
          ? clients.find((client) => client.tty === shell.tty)?.window
          : undefined) ?? null,
    }));
}

/** 短い間だけ覚える。失敗も同じ間だけ覚え、同じ失敗で git を叩き続けない。 */
export function createTtlCache<T>(
  ttlMs: number,
  now: () => number,
  maxEntries = 500,
) {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  const cached = (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = load();
    entries.delete(key);
    entries.set(key, { at: now(), value });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    return value;
  };
  /** 覚えた結果を捨てる (起こした・止めた直後に古い結果を出さない)。 */
  cached.forget = (key: string) => entries.delete(key);
  return cached;
}

/** ペインの cwd → プロジェクト。cwd はそう頻繁に変わらないので 30 秒。 */
const PROJECT_CACHE_TTL_MS = 30_000;
/** サーバの起動・停止には追従したいので短め。 */
const SERVER_CACHE_TTL_MS = 10_000;
/** 登録されたサーバの生存確認の上限。一覧の応答を待たせすぎない。 */
const SERVER_HEALTH_TIMEOUT_MS = 800;

let processKindProber: ProcessKindProber | null = null;

/** サーバのプロセスで 1 つ (覚えた結果を一覧の取り直しの間で持つ)。 */
function sharedProcessKindProber(): ProcessKindProber {
  processKindProber ??= createProcessKindProber();
  return processKindProber;
}

export function defaultAgentOverviewDeps(cwd: string): AgentOverviewDeps {
  const projectCache = createTtlCache<ProjectResolution>(
    PROJECT_CACHE_TTL_MS,
    Date.now,
  );
  const serverCache = createTtlCache<AgentProjectServer>(
    SERVER_CACHE_TTL_MS,
    Date.now,
  );
  return {
    serverInstance: `${process.pid}-${Date.now()}`,
    home: homedir(),
    serverRoot: realpathSync(cwd),
    // 「このリポジトリか」の判定は使わないので、作業ツリーの一覧を引かない。
    listPanes: () => listTmuxPanes(cwd, { worktreePaths: async () => [] }),
    listStates: listAgentStates,
    conversationOf: getAgentConversation,
    activityObservedAt: agentActivityObservedAt,
    observationErrors: getAgentActivityErrors,
    listShells: listShellSessionsForMatching,
    listClients: async () => {
      const result = await listTmuxClients(cwd);
      if (result.status === "error") return result;
      return {
        status: "ok",
        clients: result.status === "ok" ? result.clients : [],
      };
    },
    firstListed: new Map(),
    resolveProject: (path) =>
      projectCache(path, () => projectRootResultAsync(path, cwd)),
    findServer: (root) =>
      serverCache(root, async () => {
        const found = await runningServerResult(root, {
          timeoutMs: SERVER_HEALTH_TIMEOUT_MS,
        });
        if (found.status === "running")
          return {
            status: "running",
            url: found.url,
            launched: found.launched,
          };
        if (found.status === "absent") return { status: "absent" };
        return { status: found.status, detail: formatErrorDetail(found.error) };
      }),
    forgetServer: (root) => serverCache.forget(root),
    paneAccounts: (targets) => sharedAccountService().paneAccounts(targets),
    paneProcessKinds: (targets) => sharedProcessKindProber().probe(targets),
    readRegistry: () => projectRegistrySnapshot(projectRegistryPath()),
    rootExists: existsSync,
    now: Date.now,
  };
}
