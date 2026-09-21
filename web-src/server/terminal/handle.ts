// エージェント向けの HTTP 入口。
//
// - POST /_agent/state    エージェントのフックが状態を申告する
// - GET  /_agent/states   いま分かっている状態の一覧
// - GET  /_agent/overview tmux の全ペインを状態・種類・プロジェクト付きで返す
// - GET  /_agent/capture  ターミナル本文を前回の続きから取る
// - GET  /_agent/images   出力から拾った画像パスを配信できる形に直す
// - GET  /_agent/image    その 1 枚を配る (/_file は worktree 限定なので別口)
// - GET  /_agent/hooks          claude / codex のフックの状態と直近の失敗
// - GET  /_agent/hooks/plan     入れる・外すと何が変わるか (書かない)
// - POST /_agent/hooks/apply    確認した計画を実行する
// - DELETE /_agent/hooks/failures 失敗の記録を消す
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
import type { AgentScreenRuleIssue } from "../../core/agent-screen";
import {
  type AgentStatesResponse,
  isAgentEvent,
  isReportedAgent,
} from "../../core/agent-state";
import { formatErrorDetail } from "../../core/error-detail";
import { MAX_PASTE_BODY_BYTES } from "../../core/terminal-paste";
import {
  dispatchRoutes,
  handleError,
  json,
  parseBoundedJsonBody,
  parsePostJsonBody,
  textError,
} from "../database/handle-shared";
import { rawFileHeaders } from "../raw-file-headers";
import { fileReadableStream } from "../runtime";
import { getAgentActivityErrors } from "./activity";
import {
  getAgentState,
  listAgentStates,
  recordAgentState,
} from "./agent-state";
import { captureTerminal, clampHistoryLines, terminalKindOf } from "./capture";
import {
  AgentHookError,
  type AgentHookTarget,
  agentHooksOverview,
  applyAgentHooks,
  clearHookFailures,
  agentHookFile,
  currentHookLauncher,
  defaultAgentConfigDir,
  planAgentHooks,
  writeHookLauncher,
} from "./hooks";
import { resolveTerminalImage, resolveTerminalImages } from "./images";
import {
  type AgentOverviewDeps,
  buildAgentOverview,
  defaultAgentOverviewDeps,
} from "./overview";
import { savePastedImage } from "./paste";
import {
  MAX_AGENT_SCREEN_RULES_BYTES,
  reloadAgentScreenRules,
  resetAgentScreenRules,
  saveAgentScreenRules,
} from "./rules";

/** 申告 1 件の本文上限。指示文が丸ごと来ても収まる程度。 */
const MAX_STATE_TEXT = 2000;

function textField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, MAX_STATE_TEXT);
}

async function handleStatePost(req: Request): Promise<Response> {
  const body = await parsePostJsonBody<{
    target?: unknown;
    event?: unknown;
    at?: unknown;
    lastPrompt?: unknown;
    note?: unknown;
    agent?: unknown;
  }>(req);
  if (body instanceof Response) return body;

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
  return json({ ok: true, state: record });
}

function handleStatesGet(url: URL): Response {
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

function ruleOperationError(code: string, error: unknown): Response {
  console.error(`[code-viewer] terminal rule ${code} failed`, error);
  const errors: AgentScreenRuleIssue[] = [
    {
      path: "$",
      code,
      message: formatErrorDetail(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    },
  ];
  return json({ errors }, 500);
}

async function handleRulesGet(cwd: string): Promise<Response> {
  return json(await reloadAgentScreenRules(cwd));
}

async function handleRulesPut(req: Request, cwd: string): Promise<Response> {
  const body = await parseBoundedJsonBody(
    req,
    MAX_AGENT_SCREEN_RULES_BYTES,
    "terminal rules body too large",
  );
  if (body instanceof Response) return body;
  try {
    const result = await saveAgentScreenRules(cwd, body);
    return json(result, "source" in result ? 200 : 400);
  } catch (error) {
    return ruleOperationError("save_failed", error);
  }
}

async function handleRulesDelete(cwd: string): Promise<Response> {
  try {
    return json(await resetAgentScreenRules(cwd));
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
 * 出力から拾った候補を、配信できる 1 枚に直して返す。
 *
 * 読み取りしかしないので GET。候補はまとめて渡せる (tmux は毎フレーム全画面
 * が届くので、1 枚ずつ往復させると同じフレームで何本も飛ぶ)。
 */
function handleImagesGet(url: URL, cwd: string): Response {
  const candidates = url.searchParams.getAll("path");
  return json({ images: resolveTerminalImages(cwd, candidates) });
}

/**
 * 解決済みの 1 枚を配る。
 *
 * クライアントが持って回った URL は信用せず、ここでもう一度同じ判定を通す
 * (拡張子・通常ファイル・上限バイト数)。ヘッダの組み立ては /_file と同じ
 * raw-file-headers に任せるので、Content-Type の表は 1 つのまま。
 */
function handleImageGet(url: URL, cwd: string): Response {
  const image = resolveTerminalImage(cwd, url.searchParams.get("path"));
  if (!image) return textError("not found", 404);
  return new Response(fileReadableStream(image.path), {
    headers: rawFileHeaders(image.path, { size: image.bytes }),
  });
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
  const { agent, action, baseHash, launcherOnly } = body as Record<
    string,
    unknown
  >;
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
  try {
    return json(
      applyAgentHooks(
        hookTarget(agent),
        action,
        currentHookLauncher(),
        baseHash,
      ),
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

async function handleOverviewGet(cwd: string): Promise<Response> {
  overviewDeps ??= defaultAgentOverviewDeps(cwd);
  return json(await buildAgentOverview(overviewDeps));
}

export function handleAgentRoute(
  req: Request,
  url: URL,
  cwd: string,
  sideEffectAllowed: (req: Request) => boolean,
): Promise<Response | null> {
  return dispatchRoutes(
    req,
    url,
    {
      "/_agent/state": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleStatePost(req),
      },
      "/_agent/states": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => Promise.resolve(handleStatesGet(url)),
      },
      "/_agent/overview": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleOverviewGet(cwd),
      },
      "/_agent/rules": {
        methods: ["GET", "PUT", "DELETE"],
        sideEffect: (method) => method !== "GET",
        handler: () => {
          if (req.method === "GET") return handleRulesGet(cwd);
          if (req.method === "DELETE") return handleRulesDelete(cwd);
          return handleRulesPut(req, cwd);
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
        handler: () => Promise.resolve(handleImagesGet(url, cwd)),
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
