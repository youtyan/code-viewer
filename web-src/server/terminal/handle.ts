// エージェント向けの HTTP 入口。
//
// - POST /_agent/state    エージェントのフックが状態を申告する
// - GET  /_agent/states   いま分かっている状態の一覧
// - GET  /_agent/overview tmux の全ペインを状態・種類・プロジェクト付きで返す
// - GET  /_agent/capture  ターミナル本文を前回の続きから取る
// - GET  /_agent/images   出力から拾った画像パスを配信できる形に直す
// - GET  /_agent/images/history  繋いだとき、ペインの履歴から画像パスを拾う
// - GET  /_agent/image    その 1 枚を配る (/_file は worktree 限定なので別口)
// - GET  /_agent/hooks          claude / codex のフックの状態と直近の失敗
// - GET  /_agent/hooks/plan     入れる・外すと何が変わるか (書かない)
// - POST /_agent/hooks/apply    確認した計画を実行する
// - DELETE /_agent/hooks/failures 失敗の記録を消す
// - /_agent/accounts・/_agent/launch・/_agent/statusline/* はアカウントの
//   入口 (accounts/handle.ts)
// - /_agent/projects・/_agent/projects/open・/_agent/projects/stop は
//   プロジェクトの登録簿と、そのサーバを開く・止める入口 (projects/handle.ts)
//
// ルーティングと副作用リクエストの認可は tmux/handle.ts と同じ dispatchRoutes
// に任せる。申告は状態を書き換えるので sideEffect: true。CLI からの POST は
// cli-helpers の requestJson が Origin と x-code-viewer-action を付けるので
// そのまま通る。
//
// 本文の取得を GET にしてあるのは、読み取りしか行わないため。カーソルは
// クエリで持ち回る。

import {
  type AgentHookApplyResponse,
  HOOK_AGENTS,
  type HookAction,
  isHookAgent,
} from "../../core/agent-hooks";
import type { AgentOverviewResponse } from "../../core/agent-overview";
import type { AgentScreenRuleIssue } from "../../core/agent-screen";
import {
  type AgentStatesResponse,
  isAgentEvent,
  isReportedAgent,
} from "../../core/agent-state";
import { formatErrorDetail } from "../../core/error-detail";
import type { ProjectOpenResponse } from "../../core/projects";
import { isShellSessionId } from "../../core/shell";
import {
  findImagePathsNewestFirst,
  MAX_TERMINAL_IMAGE_PATHS,
  stripAnsi,
  type TerminalImageHistoryResponse,
  type TerminalImagesResponse,
} from "../../core/terminal-images";
import { MAX_PASTE_BODY_BYTES } from "../../core/terminal-paste";
import {
  handleAccountsGet,
  handleAccountsPlanGet,
  handleAccountsPost,
  handleLaunchPost,
  handleLoginPost,
  handleStatusLineApplyPost,
  handleStatusLineFailuresDelete,
  handleStatusLinePlanGet,
} from "../accounts/handle";
import {
  dispatchRoutes,
  handleError,
  json,
  parseBoundedJsonBody,
  textError,
} from "../database/handle-shared";
import {
  handleProjectOpenPost,
  handleProjectStopPost,
  handleProjectsPost,
} from "../projects/handle";
import { rawFileHeaders } from "../raw-file-headers";
import { fileReadableStream } from "../runtime";
import { captureTmuxPane, MAX_TMUX_HISTORY_LINES } from "../tmux/capture";
import { getAgentActivityErrors, noteAgentListWatched } from "./activity";
import {
  getAgentState,
  listAgentStates,
  recordAgentState,
} from "./agent-state";
import { captureTerminal, clampHistoryLines, terminalKindOf } from "./capture";
import {
  AgentHookError,
  type AgentHookTarget,
  agentHookFile,
  agentHooksOverview,
  applyAgentHooks,
  clearHookFailures,
  currentHookLauncher,
  defaultAgentConfigDir,
  planAgentHooks,
  writeHookLauncher,
} from "./hooks";
import { terminalImageBase } from "./image-base";
import {
  resolveTerminalImage,
  resolveTerminalImages,
  terminalImageVersion,
} from "./images";
import {
  type AgentOverviewDeps,
  buildAgentOverview,
  defaultAgentOverviewDeps,
} from "./overview";
import { savePastedImage } from "./paste";
import { relayAgentRead } from "./read-relay";
import {
  MAX_AGENT_SCREEN_RULES_BYTES,
  reloadAgentScreenRules,
  resetAgentScreenRules,
  saveAgentScreenRules,
} from "./rules";
import { clearAgentUnread, noteAgentUnread } from "./unread";

/** 申告 1 件の本文上限。指示文が丸ごと来ても収まる程度。 */
const MAX_STATE_TEXT = 2000;
const MAX_AGENT_ACTION_BODY_BYTES = 16 * 1024;

function textField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, MAX_STATE_TEXT);
}

/**
 * 入口のサーバ (entry/server.ts) が受けるときだけ渡す差し替え。1 つで完結する
 * サーバ (preview.ts) は渡さない。要求ごとに作る (選んでいるプロジェクトは
 * 画面が要求の見出しで伝える)。
 */
export type AgentEntryHooks = {
  /** 画面が選んでいるプロジェクトの根。一覧ではこれが current になる。 */
  selectedRoot: string;
  /** 動いているプロジェクトのサーバを、入口の URL (`/p/<鍵>/`) で見せる。 */
  serverUrl(root: string): string;
  /** 登録したプロジェクトの裏を (無ければ起こして) 入口の URL で返す。 */
  openProject(root: string): Promise<ProjectOpenResponse>;
  /** 入口が起こした裏を止める。 */
  stopProject(root: string): Promise<{ stopped: boolean }>;
};

async function handleStatePost(
  req: Request,
  entry: AgentEntryHooks | undefined,
): Promise<Response> {
  const parsed = await parseBoundedJsonBody(
    req,
    MAX_AGENT_ACTION_BODY_BYTES,
    "agent state request too large",
  );
  if (parsed instanceof Response) return parsed;
  if (!parsed || typeof parsed !== "object") {
    return textError("invalid state request", 400);
  }
  const body = parsed as {
    target?: unknown;
    event?: unknown;
    at?: unknown;
    lastPrompt?: unknown;
    note?: unknown;
    agent?: unknown;
    relay?: unknown;
  };

  const target = body.target;
  if (typeof target !== "string" || !terminalKindOf(target)) {
    return textError("invalid target", 400);
  }
  // 外から受けるのは出来事だけ。状態を直接置けるようにすると
  // {event:"stop", state:"working"} のような食い違いが通ってしまう。
  // 状態を直接置けるのは画面観測 (terminal/activity.ts) だけ。
  if (!isAgentEvent(body.event)) return textError("invalid event", 400);
  if (body.agent !== undefined && !isReportedAgent(body.agent)) {
    return textError("invalid agent", 400);
  }

  if (body.relay !== undefined && body.relay !== true) {
    return textError("invalid relay", 400);
  }
  const now = Date.now();
  if (
    body.at !== undefined &&
    (typeof body.at !== "number" ||
      !Number.isSafeInteger(body.at) ||
      body.at < 0 ||
      body.at > now)
  ) {
    return textError("invalid event timestamp", 400);
  }
  const record = recordAgentState({
    target,
    event: body.event,
    source: "hook",
    at: typeof body.at === "number" ? body.at : undefined,
    lastPrompt: textField(body.lastPrompt),
    note: textField(body.note),
    agent: isReportedAgent(body.agent) ? body.agent : undefined,
  });
  if (!record) return textError("invalid event", 400);
  // 画面で「読んだ」ときは、ほかのサーバにも伝える (read-relay.ts)。送り先
  // からは relay を付けずに送るので、送り返されない。
  // 入口では状態を持つのが入口だけなので中継しない (read-relay.ts は
  // 1 つで完結するサーバが並ぶ間のもの)。
  if (body.event === "read" && body.relay === true && !entry) {
    const relay = await relayAgentRead(target, record.updatedAt);
    return json({ ok: true, state: record, relay });
  }
  return json({ ok: true, state: record });
}

async function handleStatesGet(url: URL): Promise<Response> {
  noteAgentListWatched();
  const errors = getAgentActivityErrors();
  const target = url.searchParams.get("target");
  if (target) {
    const record = getAgentState(target);
    if (!record) return textError("unknown target", 404);
    return json({ states: [record], errors } satisfies AgentStatesResponse);
  }
  return json({
    states: listAgentStates(),
    errors,
  } satisfies AgentStatesResponse);
}

function ruleOperationError(
  code: string,
  error: unknown,
  status = 500,
): Response {
  console.error(`[code-viewer] terminal rule ${code} failed`, error);
  const errors: AgentScreenRuleIssue[] = [
    {
      path: "$",
      code,
      message: formatErrorDetail(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    },
  ];
  return json({ errors }, status);
}

async function handleRulesGet(cwd: string): Promise<Response> {
  try {
    return json(await reloadAgentScreenRules(cwd));
  } catch (error) {
    // 読み直せなかった (ロックを待ちきれない・I/O)。前のルールのまま動いている。
    return ruleOperationError("reload_failed", error, 503);
  }
}

async function handleRulesPut(req: Request): Promise<Response> {
  const body = await parseBoundedJsonBody(
    req,
    MAX_AGENT_SCREEN_RULES_BYTES,
    "terminal rules body too large",
  );
  if (body instanceof Response) return body;
  try {
    const result = await saveAgentScreenRules(body);
    return json(result, "source" in result ? 200 : 400);
  } catch (error) {
    return ruleOperationError("save_failed", error);
  }
}

async function handleRulesDelete(): Promise<Response> {
  try {
    return json(await resetAgentScreenRules());
  } catch (error) {
    return ruleOperationError("reset_failed", error);
  }
}

async function handleCaptureGet(url: URL, cwd: string): Promise<Response> {
  const target = url.searchParams.get("target");
  if (!target || !terminalKindOf(target)) {
    return textError("invalid target", 400);
  }
  const cursor = url.searchParams.get("cursor");
  const history = clampHistoryLines(url.searchParams.get("history"));
  const result = await captureTerminal(target, cursor, cwd, history);
  if (result.status === "invalid") return textError("invalid target", 400);
  if (result.status === "gone") return textError("target is gone", 410);
  if (result.status === "error") {
    console.error("[code-viewer] terminal capture failed", result.error);
    return textError(formatErrorDetail(result.error), 500);
  }
  return json({
    target,
    kind: result.kind,
    content: result.slice.content,
    cursor: result.slice.cursor,
    reset: result.slice.reset,
  });
}

/**
 * 繋いだときにさかのぼる tmux の履歴の行数。tmux から取れる上限
 * (MAX_TMUX_HISTORY_LINES) と同じにしてある。1 回だけなので、画面から
 * 流れた古い画像まで棚に戻せるほうを取る。
 */
export const TERMINAL_IMAGE_HISTORY_LINES = MAX_TMUX_HISTORY_LINES;

/** クエリの shell。無ければ null、形が違えば 400 の応答。 */
function shellParam(url: URL): string | null | Response {
  const shell = url.searchParams.get("shell");
  if (shell === null) return null;
  if (!isShellSessionId(shell)) return textError("invalid shell", 400);
  return shell;
}

/**
 * 出力から拾った候補を、配信できる 1 枚に直して返す。
 *
 * 読み取りしかしないので GET。候補はまとめて渡せる (tmux は毎フレーム全画面
 * が届くので、1 枚ずつ往復させると同じフレームで何本も飛ぶ)。shell を渡すと、
 * 相対パスはそのシェルが映しているペインの作業場所から解く (image-base.ts)。
 */
async function handleImagesGet(url: URL, cwd: string): Promise<Response> {
  const shell = shellParam(url);
  if (shell instanceof Response) return shell;
  const { base } = await terminalImageBase(cwd, shell);
  const candidates = url.searchParams.getAll("path");
  const body: TerminalImagesResponse = {
    ...resolveTerminalImages(base.cwd, candidates),
    base,
  };
  return json(body);
}

/**
 * 繋いだときに 1 回だけ、シェルが映している tmux のペインの履歴をさかのぼって
 * 画像パスを拾う。出力の流れを走査するだけだと、画面から流れた過去のパスは
 * 拾えない (tmux は繋いだときに今の画面を描き直すだけ)。
 *
 * tmux を映していないシェルでは何も拾わない (そのシェルの溜め置きは購読の
 * 始めに流れてくるので、ブラウザ側の走査が拾う)。
 */
async function handleImagesHistoryGet(
  url: URL,
  cwd: string,
): Promise<Response> {
  const shell = shellParam(url);
  if (shell instanceof Response) return shell;
  if (shell === null) return textError("shell is required", 400);
  const { base, pane } = await terminalImageBase(cwd, shell);
  const empty: TerminalImageHistoryResponse = {
    images: [],
    rejected: [],
    base,
    pane: null,
    candidates: [],
    lines: 0,
  };
  if (!pane) return json(empty);
  const capture = await captureTmuxPane(
    pane,
    cwd,
    TERMINAL_IMAGE_HISTORY_LINES,
  );
  // 引く間にペインが閉じられた。
  if (capture.status === "gone") return json(empty);
  if (capture.status === "error") {
    console.error(
      `[code-viewer] terminal image history capture failed (pane ${pane})`,
      capture.error,
    );
    return textError(formatErrorDetail(capture.error), 500);
  }
  const { screen } = capture;
  const candidates = findImagePathsNewestFirst(
    stripAnsi(screen.content),
    screen.width,
  );
  const body: TerminalImageHistoryResponse = {
    ...resolveTerminalImages(base.cwd, candidates, MAX_TERMINAL_IMAGE_PATHS),
    base,
    pane,
    candidates,
    lines: screen.historyLines + screen.height,
  };
  return json(body);
}

/**
 * ブラウザに覚えさせてよい期間。URL の v (更新時刻と大きさ) が今の実体と
 * 一致するときだけ付ける。上書きされれば URL が変わるので、古い版を見せ続け
 * ることはない。
 */
const TERMINAL_IMAGE_CACHE_CONTROL = "private, max-age=31536000, immutable";

/**
 * 解決済みの 1 枚を配る。
 *
 * クライアントが持って回った URL は信用せず、ここでもう一度同じ判定を通す
 * (拡張子・通常ファイル・上限バイト数・読めるか)。ヘッダの組み立ては
 * /_file と同じ raw-file-headers に任せるので、Content-Type の表は 1 つのまま。
 * 配れないときは 404 で、本文に理由 (TerminalImageRejectReason) を返す。
 */
function handleImageGet(url: URL, cwd: string): Response {
  const result = resolveTerminalImage(cwd, url.searchParams.get("path"));
  if (result.status === "rejected") {
    return textError(`not found: ${result.reason}`, 404);
  }
  const { image } = result;
  const headers: Record<string, string> = {
    ...(rawFileHeaders(image.path, { size: image.bytes }) as Record<
      string,
      string
    >),
  };
  // 棚のサムネイルは描き直すたびに同じ URL を読む。no-store のままだと、
  // そのたびに原寸を取り直す。
  if (url.searchParams.get("v") === terminalImageVersion(image)) {
    headers["Cache-Control"] = TERMINAL_IMAGE_CACHE_CONTROL;
  }
  return new Response(fileReadableStream(image.path), { headers });
}

async function handlePastePost(req: Request, cwd: string): Promise<Response> {
  const body = await parseBoundedJsonBody(
    req,
    MAX_PASTE_BODY_BYTES,
    "image too large",
  );
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object") {
    return textError("invalid image data", 400);
  }
  const { mime, data } = body as { mime?: unknown; data?: unknown };
  const result = await savePastedImage(cwd, mime, data);
  if (result.status === "invalid") return textError(result.message, 400);
  if (result.status === "error") {
    console.error(`[code-viewer] paste save failed: ${result.message}`);
    return textError("failed to save image", 500);
  }
  return json({
    path: result.path,
    name: result.name,
    bytes: result.bytes,
  });
}

async function handleUnreadPost(req: Request): Promise<Response> {
  const parsed = await parseBoundedJsonBody(
    req,
    MAX_AGENT_ACTION_BODY_BYTES,
    "agent unread request too large",
  );
  if (parsed instanceof Response) return parsed;
  if (!parsed || typeof parsed !== "object") {
    return textError("invalid unread request", 400);
  }
  const body = parsed as { target?: unknown };
  if (typeof body.target !== "string" || !terminalKindOf(body.target)) {
    return textError("invalid target", 400);
  }
  return json({ ok: true, removed: clearAgentUnread(body.target) });
}

/** フックの入れ外しの本文上限。種類・動作・ハッシュだけが来る。 */
const MAX_HOOK_APPLY_BYTES = 4096;

function isHookAction(value: unknown): value is HookAction {
  return value === "install" || value === "uninstall";
}

/**
 * 対象の設定ディレクトリ。今は既定の場所だけ (環境変数か ~/.claude・
 * ~/.codex)。hooks.ts の関数はディレクトリを引数で受けるので、別の場所を
 * 足すときはここで選ぶ。
 */
function hookTarget(agent: (typeof HOOK_AGENTS)[number]): AgentHookTarget {
  return { agent, configDir: defaultAgentConfigDir(agent) };
}

function hookError(error: unknown): Response {
  const detail = formatErrorDetail(error);
  if (error instanceof AgentHookError) {
    const status =
      error.code === "conflict" || error.code === "blocked"
        ? 409
        : error.code === "unreadable"
          ? 422
          : 500;
    if (status === 500)
      console.error("[code-viewer] agent hook write failed", error);
    return json({ error: detail, code: error.code }, status);
  }
  console.error("[code-viewer] agent hook request failed", error);
  return json({ error: detail, code: "failed" }, 500);
}

function handleHooksGet(): Response {
  try {
    return json(
      agentHooksOverview(HOOK_AGENTS.map(hookTarget), currentHookLauncher()),
    );
  } catch (error) {
    return hookError(error);
  }
}

function handleHooksPlanGet(url: URL): Response {
  const agent = url.searchParams.get("agent");
  const action = url.searchParams.get("action");
  if (!isHookAgent(agent)) return textError("invalid agent", 400);
  if (!isHookAction(action)) return textError("invalid action", 400);
  try {
    return json(
      planAgentHooks(hookTarget(agent), action, currentHookLauncher()),
    );
  } catch (error) {
    return hookError(error);
  }
}

async function handleHooksApplyPost(req: Request): Promise<Response> {
  const body = await parseBoundedJsonBody(
    req,
    MAX_HOOK_APPLY_BYTES,
    "hook request too large",
  );
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object") {
    return textError("invalid hook request", 400);
  }
  const { agent, action, baseHash, realPath, fileIdentity, launcherOnly } =
    body as Record<string, unknown>;
  if (!isHookAgent(agent)) return textError("invalid agent", 400);
  if (!isHookAction(action)) return textError("invalid action", 400);
  if (launcherOnly !== undefined && typeof launcherOnly !== "boolean") {
    return textError("invalid launcherOnly", 400);
  }
  if (launcherOnly) {
    // 設定ファイルは書かず、フックが呼ぶ起動スクリプトだけを用意する
    // (設定ファイルが書けず、利用者が自分で写す場合)。
    try {
      const target = hookTarget(agent);
      return json({
        path: agentHookFile(agent, target.configDir),
        changed: false,
        backupPath: null,
        launcherWritten: writeHookLauncher(currentHookLauncher()),
      } satisfies AgentHookApplyResponse);
    } catch (error) {
      return hookError(error);
    }
  }
  if (typeof baseHash !== "string" || !/^[0-9a-f]{64}$/.test(baseHash)) {
    return textError("invalid baseHash", 400);
  }
  if (typeof realPath !== "string" || !realPath.startsWith("/")) {
    return textError("invalid realPath", 400);
  }
  if (typeof fileIdentity !== "string" || fileIdentity === "") {
    return textError("invalid fileIdentity", 400);
  }
  try {
    return json(
      await applyAgentHooks(hookTarget(agent), action, currentHookLauncher(), {
        baseHash,
        realPath,
        fileIdentity,
      }),
    );
  } catch (error) {
    return hookError(error);
  }
}

function handleHookFailuresDelete(): Response {
  try {
    clearHookFailures(currentHookLauncher().failureLog);
    return json({ ok: true });
  } catch (error) {
    return hookError(error);
  }
}

/**
 * 一覧の問い合わせ先。git とサーバ登録簿の結果を短く覚えておくので、
 * リクエストごとに作り直さずプロセスで 1 つ持つ (cwd はプロセスの間変わらない)。
 */
let overviewDeps: AgentOverviewDeps | null = null;

async function handleOverviewGet(
  cwd: string,
  entry: AgentEntryHooks | undefined,
): Promise<Response> {
  noteAgentListWatched();
  overviewDeps ??= defaultAgentOverviewDeps(cwd);
  const base = overviewDeps;
  const deps: AgentOverviewDeps = entry
    ? {
        ...base,
        serverRoot: entry.selectedRoot,
        findServer: async (root) => {
          const found = await base.findServer(root);
          return found.status === "running"
            ? { ...found, url: entry.serverUrl(root) }
            : found;
        },
      }
    : base;
  const overview = await buildAgentOverview(deps);
  return json({
    ...overview,
    unread: noteAgentUnread(overview.panes),
  } satisfies AgentOverviewResponse);
}

/**
 * サーバを起こした・止めた後は、一覧が覚えているそのプロジェクトのサーバの
 * 状態を捨てる (次の取り直しで古い「動いていない」を出さない)。
 */
function forgetServer(root: string): void {
  overviewDeps?.forgetServer(root);
}

export function handleAgentRoute(
  req: Request,
  url: URL,
  cwd: string,
  sideEffectAllowed: (req: Request) => boolean,
  entry?: AgentEntryHooks,
): Promise<Response | null> {
  return dispatchRoutes(
    req,
    url,
    {
      "/_agent/state": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleStatePost(req, entry),
      },
      "/_agent/states": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleStatesGet(url),
      },
      "/_agent/overview": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleOverviewGet(cwd, entry),
      },
      "/_agent/rules": {
        methods: ["GET", "PUT", "DELETE"],
        sideEffect: (method) => method !== "GET",
        handler: () => {
          if (req.method === "GET") return handleRulesGet(cwd);
          if (req.method === "DELETE") return handleRulesDelete();
          return handleRulesPut(req);
        },
      },
      "/_agent/capture": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleCaptureGet(url, cwd),
      },
      "/_agent/images": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleImagesGet(url, cwd),
      },
      "/_agent/images/history": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleImagesHistoryGet(url, cwd),
      },
      "/_agent/image": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => Promise.resolve(handleImageGet(url, cwd)),
      },
      "/_agent/hooks": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleHooksGet(),
      },
      "/_agent/hooks/plan": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleHooksPlanGet(url),
      },
      // エージェントの設定ファイルを書き換える。同一オリジンからしか通らない。
      "/_agent/hooks/apply": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleHooksApplyPost(req),
      },
      "/_agent/hooks/failures": {
        methods: ["DELETE"],
        sideEffect: true,
        handler: () => Promise.resolve(handleHookFailuresDelete()),
      },
      "/_agent/accounts": {
        methods: ["GET", "POST"],
        sideEffect: (method) => method !== "GET",
        handler: () =>
          req.method === "GET"
            ? handleAccountsGet(url, cwd)
            : handleAccountsPost(req),
      },
      "/_agent/accounts/plan": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => Promise.resolve(handleAccountsPlanGet(url)),
      },
      // tmux にウィンドウを作る。同一オリジンからしか通らない。
      "/_agent/accounts/login": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleLoginPost(req, cwd),
      },
      "/_agent/launch": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleLaunchPost(req),
      },
      "/_agent/statusline/plan": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => Promise.resolve(handleStatusLinePlanGet(url)),
      },
      // claude の設定ファイルを書き換える。同一オリジンからしか通らない。
      "/_agent/statusline/apply": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleStatusLineApplyPost(req),
      },
      "/_agent/statusline/failures": {
        methods: ["DELETE"],
        sideEffect: true,
        handler: () => Promise.resolve(handleStatusLineFailuresDelete()),
      },
      "/_agent/projects": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleProjectsPost(req, cwd),
      },
      // サーバのプロセスを起こす・止める。同一オリジンからしか通らない。
      "/_agent/projects/open": {
        methods: ["POST"],
        sideEffect: true,
        handler: () =>
          handleProjectOpenPost(req, forgetServer, entry?.openProject),
      },
      "/_agent/projects/stop": {
        methods: ["POST"],
        sideEffect: true,
        handler: () =>
          handleProjectStopPost(req, cwd, forgetServer, entry?.stopProject),
      },
      // 未読を解く (見ている・開いた)。未読はサーバのメモリにある (unread.ts)。
      "/_agent/unread": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleUnreadPost(req),
      },
      // ファイルを作るので副作用。同一オリジンからしか通らない。
      "/_agent/paste": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handlePastePost(req, cwd),
      },
    },
    sideEffectAllowed,
    (res) => res,
    (err) => handleError("agent", "handle agent request", err),
  );
}
