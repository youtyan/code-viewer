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
import { isAccountAgent, type PaneAccount } from "../../core/agent-accounts";
import {
  type AgentOverviewResponse,
  type AgentPane,
  type AgentProjectInfo,
  type AgentProjectServer,
  abbreviateHome,
  agentKindOf,
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
import { flattenTmuxPanes } from "../../core/tmux";
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
import { listAgentStates } from "./agent-state";

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
    };
  }
  const tmuxPanes = panes.running ? flattenTmuxPanes(panes.sessions) : [];
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
  let paneToShell = new Map<string, string>();
  if (clients.status === "ok") {
    paneToShell = linkShellsAndPanes(
      await deps.listShells(),
      clients.clients,
    ).paneToShell;
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
  const kinds = new Map(
    tmuxPanes.map((pane) => {
      const record = states.get(pane.id) ?? null;
      return [
        pane.id,
        agentKindOf(pane.command, record?.source ?? null, record),
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
  const sessionOf = new Map<string, string>();
  for (const session of panes.sessions) {
    for (const window of session.windows) {
      for (const pane of window.panes) sessionOf.set(pane.id, session.name);
    }
  }
  for (const pane of tmuxPanes) {
    const resolution = resolved.get(pane.path) ?? {
      kind: "error" as const,
      error: `project for ${pane.path} was not resolved`,
    };
    const root = resolution.kind === "root" ? resolution.root : pane.path;
    if (!projects.has(root)) {
      projects.set(root, {
        root,
        name: basenameOf(root) || root,
        displayRoot: abbreviateHome(root, deps.home),
        git: resolution.kind === "root",
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
    result.push({
      id: pane.id,
      label: pane.label,
      session: sessionOf.get(pane.id) ?? "",
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
    });
  }

  // 登録したプロジェクトを合わせる。同じ git ルートなら 1 つにまとめ、
  // 表示名は登録の名前にする。エージェントの居ないものは行の無い見出しになる。
  const registry = await deps.readRegistry();
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
      git: true,
      error: deps.rootExists(registered.root)
        ? ""
        : `${registered.root} does not exist`,
      server: { status: "none" },
      registered,
    });
  }

  await Promise.all(
    [...projects.values()]
      .filter((info) => info.git)
      .map(async (info) => {
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
  };
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
    readRegistry: () => projectRegistrySnapshot(projectRegistryPath()),
    rootExists: existsSync,
    now: Date.now,
  };
}
