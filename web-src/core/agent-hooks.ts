// エージェントの設定ファイルに、状態を code-viewer へ知らせるフックを
// 足す・外すための純ロジック。
//
// 対象は claude (`<設定ディレクトリ>/settings.json` の hooks) と codex
// (`<CODEX_HOME>/hooks.json`)。どちらも同じ形をしている:
//
//   { "hooks": { "<出来事>": [ { "matcher"?: "...", "hooks": [ {command...} ] } ] } }
//
// ここはファイルに触らない。読んだ JSON を受け取り、次に書く JSON と
// 「何が足され・消されるか」を返すだけ。読み書き・バックアップ・置き換えは
// server/terminal/hooks.ts が行う。確認画面に出す差分と実際に書く中身を
// 同じ関数から作るので、見せたものと書いたものがずれない。
//
// 自分の入れたものは、コマンド文字列に含まれる AGENT_HOOK_MARKER で
// 見分ける。ほかのツールが入れたフックは読むだけで、1 つも消さず、順序も
// 変えない。
//
// opencode には設定ファイルのフックが無い。代わりに、
// `<設定ディレクトリ>/plugins/` の .js を読むプラグインの仕組みがある
// (https://opencode.ai/docs/plugins.md)。code-viewer は自分だけのファイル
// (OPENCODE_PLUGIN_FILE) を 1 つ置き、その中で受けた出来事を同じ起動
// スクリプトに渡す。中身は opencodePluginSource が作る。opencode 2 と 1 で
// プラグインの API が違う (https://opencode.ai/docs/build/plugins/migrate-v1.md)
// ので、1 つのファイルで両方に答える。

import {
  type AgentAttention,
  type AgentEvent,
  MAX_ATTENTION_TEXT,
} from "./agent-state";
import { hasControlCharacter } from "./control-chars";

export const HOOK_AGENTS = ["claude", "codex", "opencode"] as const;

export type HookAgent = (typeof HOOK_AGENTS)[number];

export function isHookAgent(value: unknown): value is HookAgent {
  return (
    typeof value === "string" &&
    (HOOK_AGENTS as readonly string[]).includes(value)
  );
}

/**
 * 自分の入れたフックの印。起動スクリプトのファイル名そのものなので、
 * コマンド文字列に必ず入る。書式の違う古い版の入れ方でも、この名前を
 * 含んでいれば自分のものとみなして外せる。
 */
export const AGENT_HOOK_MARKER = "code-viewer-agent-hook";

/** 設定ファイルに入れるフック 1 つの定義。 */
export type HookSpec = {
  /** エージェント側の出来事の名前 (settings の hooks のキー)。 */
  event: string;
  /**
   * claude / codex は出来事の中の種類 (source など) を選ぶ正規表現。
   * opencode は session.status の status.type を選ぶ (プラグインが当てる)。
   */
  matcher?: string;
  /** 秒。エージェント側の打ち切り時間 (opencode はプラグインが子を止める)。 */
  timeout: number;
  /** claude の async。バックグラウンドで走らせ、エージェントを待たせない。 */
  async?: boolean;
  /**
   * opencode のどの版のプラグインの API が送る出来事か (1 = opencode 1 の
   * `event`、2 = opencode 2 の `ctx.event.subscribe()`)。無ければ両方が送るか、
   * プラグインが自分で名付けたもの。プラグインは 2 の出来事だけを購読する
   * (知らない名前は opencode 2 がログに警告を出す)。
   */
  api?: 1 | 2;
};

/**
 * 入れるフック。出来事と申告の対応は agentEventForHook と合わせる。
 *
 * - SessionStart は compact (要約で作り直したとき) を除く。作業の途中で
 *   起きるので、待機に倒すと作業中が消える
 * - claude の許可待ちは Notification の permission_prompt と
 *   elicitation_dialog だけ。idle_prompt は入力欄で 60 秒待ったときに出る
 *   もので、完了 (未読) を入力待ちで上書きしてしまう
 * - claude は async で動かし、エージェントを 1 ミリ秒も待たせない。
 *   SessionEnd だけは終了と同時に打ち切られないよう同期にする
 * - codex には async が無い。ツールごとに呼ばれる出来事 (PostToolUse) は
 *   入れず、許可の後に作業へ戻ったことは画面の観測に任せる
 * - codex の SessionEnd と Interrupt は既定 1 秒・上限 3 秒 (公式)
 * - claude の StopFailure (API の失敗・上限・認証切れでターンが止まった) は
 *   完了にしない。人の手が要る (ask) として、理由を agentAttentionForHook で添える
 * - opencode はプラグインが受ける出来事。api: 1 は opencode 1 の event (手元の
 *   1.19.5 で観測し、@opencode-ai/sdk の Event 型で欄を確かめた)。session.status
 *   は作業中の busy と再試行の retry だけ (idle は session.idle と重なる)。
 *   permission.updated は 1 の古い版の許可の出来事。api: 2 は opencode 2 の
 *   出来事 (2.2.7 で観測。2 は session.status・session.idle・question.* を送らず、
 *   1 ターンを session.execution.* で、質問を form.* で送る)。permission.asked と
 *   permission.replied は両方の名前。OPENCODE_START / OPENCODE_DISPOSE は
 *   プラグインの読み込み・終わり (1 の dispose・2 の setup が返す片付け) で、
 *   opencode の出来事ではなくプラグインが自分で名付けたもの
 */
export const HOOK_SPECS: Record<HookAgent, readonly HookSpec[]> = {
  claude: [
    {
      event: "SessionStart",
      matcher: "startup|resume|clear",
      timeout: 5,
      async: true,
    },
    { event: "UserPromptSubmit", timeout: 5, async: true },
    { event: "PostToolUse", timeout: 5, async: true },
    {
      event: "Notification",
      matcher: "permission_prompt|elicitation_dialog",
      timeout: 5,
      async: true,
    },
    { event: "Stop", timeout: 5, async: true },
    { event: "StopFailure", timeout: 5, async: true },
    { event: "SessionEnd", timeout: 5 },
  ],
  codex: [
    { event: "SessionStart", matcher: "startup|resume|clear", timeout: 5 },
    { event: "UserPromptSubmit", timeout: 5 },
    { event: "PermissionRequest", timeout: 5 },
    { event: "Stop", timeout: 5 },
    { event: "Interrupt", timeout: 3 },
    { event: "SessionEnd", timeout: 3 },
  ],
  opencode: [
    { event: "code-viewer.start", timeout: 5 },
    { event: "session.status", matcher: "busy|retry", timeout: 5, api: 1 },
    { event: "permission.asked", timeout: 5 },
    { event: "permission.updated", timeout: 5, api: 1 },
    { event: "permission.replied", timeout: 5 },
    { event: "question.asked", timeout: 5, api: 1 },
    { event: "question.replied", timeout: 5, api: 1 },
    { event: "question.rejected", timeout: 5, api: 1 },
    { event: "session.idle", timeout: 5, api: 1 },
    { event: "session.execution.started", timeout: 5, api: 2 },
    { event: "session.execution.succeeded", timeout: 5, api: 2 },
    { event: "session.execution.failed", timeout: 5, api: 2 },
    { event: "session.execution.interrupted", timeout: 5, api: 2 },
    { event: "form.created", timeout: 5, api: 2 },
    { event: "form.replied", timeout: 5, api: 2 },
    { event: "form.cancelled", timeout: 5, api: 2 },
    { event: "code-viewer.dispose", timeout: 3 },
  ],
};

/** opencode のプラグインが読み込み・終わりに自分で名乗る出来事。 */
export const OPENCODE_START = "code-viewer.start";
export const OPENCODE_DISPOSE = "code-viewer.dispose";

/**
 * opencode のプラグインが渡す出来事と申告の対応。opencode 2 の
 * session.execution.failed (モデルの呼び出しの失敗など、再試行しない失敗で
 * ターンが止まった) は claude の StopFailure と同じく完了にせず、入力待ちに
 * して理由を添える。interrupted (Esc・許可を断った・質問を閉じた) は入力欄に
 * 戻っただけなので待機。
 */
const OPENCODE_EVENTS = new Map<string, AgentEvent>([
  [OPENCODE_START, "ready"],
  ["session.status", "progress"],
  ["permission.asked", "ask"],
  ["permission.updated", "ask"],
  ["permission.replied", "progress"],
  ["question.asked", "ask"],
  ["question.replied", "progress"],
  ["question.rejected", "progress"],
  ["session.idle", "stop"],
  ["session.execution.started", "progress"],
  ["session.execution.succeeded", "stop"],
  ["session.execution.failed", "ask"],
  ["session.execution.interrupted", "ready"],
  ["form.created", "ask"],
  ["form.replied", "progress"],
  ["form.cancelled", "progress"],
  [OPENCODE_DISPOSE, "exit"],
]);

/** opencode の質問 (1 の question ツール・2 のフォーム)。 */
const OPENCODE_QUESTIONS = new Set(["question.asked", "form.created"]);

/** 下請けのセッションからも送る出来事 (許可と質問とその答え)。 */
const OPENCODE_CHILD_EVENTS = [
  "permission.asked",
  "permission.updated",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
  "form.created",
  "form.replied",
  "form.cancelled",
];

/**
 * opencode の出来事を申告に直す。session.status は status.type が
 * HOOK_SPECS の matcher に当たるときだけ (プラグインも同じ条件で絞るが、
 * 古い版のプラグインからも来うるのでここでも見る)。
 */
function opencodeEvent(input: Record<string, unknown>): AgentEvent | null {
  const name = input.hook_event_name;
  if (typeof name !== "string") return null;
  const event = OPENCODE_EVENTS.get(name);
  if (!event) return null;
  if (name !== "session.status") return event;
  const spec = HOOK_SPECS.opencode.find((item) => item.event === name);
  const status = typeof input.status === "string" ? input.status : "";
  return spec?.matcher && new RegExp(`^(?:${spec.matcher})$`).test(status)
    ? event
    : null;
}

/** フックの入力で、SessionStart が要約による作り直しかどうかを見る欄。 */
const COMPACT_SOURCE = "compact";

/** claude の Notification のうち入力待ちとして申告するものと、その理由。 */
const CLAUDE_ASK_NOTIFICATIONS = new Map<string, AgentAttention["kind"]>([
  ["permission_prompt", "permission"],
  ["elicitation_dialog", "question"],
]);

/**
 * フックに渡された JSON から、code-viewer に申告する出来事を決める。
 * 申告しない出来事なら null。
 */
export function agentEventForHook(
  agent: HookAgent,
  input: Record<string, unknown>,
): AgentEvent | null {
  if (agent === "opencode") return opencodeEvent(input);
  const name = input.hook_event_name;
  if (name === "SessionStart") {
    return input.source === COMPACT_SOURCE ? null : "ready";
  }
  if (name === "UserPromptSubmit") return "prompt";
  if (name === "Stop") return "stop";
  if (name === "SessionEnd") return "exit";
  if (agent === "claude") {
    if (name === "PostToolUse") return "progress";
    if (name === "StopFailure") return "ask";
    if (name === "Notification") {
      return typeof input.notification_type === "string" &&
        CLAUDE_ASK_NOTIFICATIONS.has(input.notification_type)
        ? "ask"
        : null;
    }
    return null;
  }
  if (name === "PermissionRequest") return "ask";
  if (name === "Interrupt") return "ready";
  return null;
}

/** 理由・補足に載せる文字。制御文字を空白にして上限で切る。 */
function attentionText(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = [...value]
    .map((char) => (hasControlCharacter(char) ? " " : char))
    .join("")
    .trim();
  return text.slice(0, MAX_ATTENTION_TEXT);
}

/**
 * 入力待ち (ask) の理由。agentEventForHook が ask を返す入力にだけ値を返す。
 * StopFailure の欄 (`error` = 種類、`error_details` = 補足) は claude の公式の
 * hooks の文書のもの。opencode の session.execution.failed は、プラグインが
 * 出来事の `data.error.type` と `data.error.message` を同じ名前の欄に入れて渡す。
 */
export function agentAttentionForHook(
  agent: HookAgent,
  input: Record<string, unknown>,
): AgentAttention | null {
  if (agentEventForHook(agent, input) !== "ask") return null;
  const name = input.hook_event_name;
  if (
    name === "StopFailure" ||
    (agent === "opencode" && name === "session.execution.failed")
  ) {
    return {
      kind: "error",
      reason: attentionText(input.error),
      detail: attentionText(input.error_details),
    };
  }
  if (name === "Notification" && typeof input.notification_type === "string") {
    const kind = CLAUDE_ASK_NOTIFICATIONS.get(input.notification_type);
    return kind ? { kind, reason: "", detail: "" } : null;
  }
  if (name === "PermissionRequest") {
    return { kind: "permission", reason: "", detail: "" };
  }
  // opencode の許可 (permission.asked / 1 の古い版の permission.updated) と質問
  // (1 の question ツール・2 のフォーム)。
  if (agent === "opencode") {
    return {
      kind:
        typeof name === "string" && OPENCODE_QUESTIONS.has(name)
          ? "question"
          : "permission",
      reason: "",
      detail: "",
    };
  }
  return null;
}

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 設定ファイルの形の問題。どこが・なぜ、を全部返す。 */
export type HookShapeIssue = { path: string; message: string };

/**
 * 設定ファイルが、フックを読み書きできる形かを確かめる。
 *
 * 自分の印を探すために hooks の中は全部見るので、全部の形を確かめる。
 * 1 つでも想定外なら書かない (読めないものを上書きしない)。
 */
export function checkHookShape(root: unknown): HookShapeIssue[] {
  const issues: HookShapeIssue[] = [];
  if (!isPlainObject(root)) {
    return [{ path: "$", message: "the file must contain a JSON object" }];
  }
  if (!("hooks" in root)) return issues;
  const hooks = root.hooks;
  if (!isPlainObject(hooks)) {
    return [{ path: "$.hooks", message: "hooks must be an object" }];
  }
  for (const [event, groups] of Object.entries(hooks)) {
    const eventPath = `$.hooks.${event}`;
    if (!Array.isArray(groups)) {
      issues.push({ path: eventPath, message: "must be an array" });
      continue;
    }
    groups.forEach((group, groupIndex) => {
      const groupPath = `${eventPath}[${groupIndex}]`;
      if (!isPlainObject(group)) {
        issues.push({ path: groupPath, message: "must be an object" });
        return;
      }
      if (!("hooks" in group)) return;
      if (!Array.isArray(group.hooks)) {
        issues.push({
          path: `${groupPath}.hooks`,
          message: "must be an array",
        });
        return;
      }
      group.hooks.forEach((hook, hookIndex) => {
        if (!isPlainObject(hook)) {
          issues.push({
            path: `${groupPath}.hooks[${hookIndex}]`,
            message: "must be an object",
          });
        }
      });
    });
  }
  return issues;
}

function commandOf(hook: unknown): string {
  return isPlainObject(hook) && typeof hook.command === "string"
    ? hook.command
    : "";
}

export function isOwnHook(hook: unknown): boolean {
  return commandOf(hook).includes(AGENT_HOOK_MARKER);
}

/** 設定ファイルに書くグループ 1 つ。 */
export function hookGroupFor(spec: HookSpec, command: string): JsonObject {
  const hook: JsonObject = { type: "command", command, timeout: spec.timeout };
  if (spec.async) hook.async = true;
  return spec.matcher === undefined
    ? { hooks: [hook] }
    : { matcher: spec.matcher, hooks: [hook] };
}

/** 足す・消すもの 1 つ。確認画面にそのまま出す。 */
export type HookChange = {
  event: string;
  /** 足す・消すグループ (消すときは、消したフックだけを残した形)。 */
  entry: JsonObject;
};

export type HookAction = "install" | "uninstall";

export type HookPlan = {
  /** 書いた後の JSON。changed が false なら入力と同じ。 */
  next: JsonObject;
  added: HookChange[];
  removed: HookChange[];
  /** ほかのツールが入れたフックの数。1 つも触らない。 */
  kept: number;
  changed: boolean;
};

function countForeign(hooks: JsonObject): number {
  let count = 0;
  for (const groups of Object.values(hooks)) {
    for (const group of groups as JsonObject[]) {
      if (!Array.isArray(group.hooks)) continue;
      for (const hook of group.hooks) if (!isOwnHook(hook)) count += 1;
    }
  }
  return count;
}

/** 深い比較。JSON として読んだ値どうしだけを比べる。 */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 1 つの出来事の配列から自分のフックを抜く。自分のものを抜いたせいで
 * 空になったグループは消す (元から空のグループは残す)。
 */
function stripOwn(
  event: string,
  groups: JsonObject[],
  removed: HookChange[],
): JsonObject[] {
  const kept: JsonObject[] = [];
  for (const group of groups) {
    if (!Array.isArray(group.hooks)) {
      kept.push(group);
      continue;
    }
    const own = group.hooks.filter(isOwnHook);
    if (own.length === 0) {
      kept.push(group);
      continue;
    }
    removed.push({ event, entry: { ...group, hooks: own } });
    const rest = group.hooks.filter((hook) => !isOwnHook(hook));
    if (rest.length > 0) kept.push({ ...group, hooks: rest });
  }
  return kept;
}

/**
 * 次に書く中身を決める。
 *
 * - install: 入れるべきフックと同じものが 1 つだけあれば何もしない。
 *   違うもの (古い版の書き方・重複) があれば、それを消して正しいものを
 *   末尾に足す。入れる対象に無い出来事に残った自分のフックも消す
 * - uninstall: 自分のフックを全部消す
 *
 * どちらも、自分のものを消したせいで空になった入れ物 (グループ・出来事の
 * 配列・hooks) は片付ける。元から空だったものは残す。
 *
 * @param root 読んだ JSON。ファイルが無ければ null。checkHookShape を
 *   通ったものだけを渡す。
 */
export function planHookChange(
  root: JsonObject | null,
  action: HookAction,
  specs: readonly HookSpec[],
  command: string,
): HookPlan {
  const base: JsonObject = root ? { ...root } : {};
  const hadHooks = "hooks" in base;
  const hooks: JsonObject = hadHooks ? { ...(base.hooks as JsonObject) } : {};
  const added: HookChange[] = [];
  const removed: HookChange[] = [];
  const wanted = new Map(
    action === "install"
      ? specs.map((spec) => [spec.event, hookGroupFor(spec, command)])
      : [],
  );

  for (const [event, value] of Object.entries(hooks)) {
    const groups = value as JsonObject[];
    const desired = wanted.get(event);
    if (desired) {
      const ownGroups = groups.filter(
        (group) => Array.isArray(group.hooks) && group.hooks.some(isOwnHook),
      );
      const [only] = ownGroups;
      if (ownGroups.length === 1 && only && sameJson(only, desired)) {
        wanted.delete(event);
        continue;
      }
    }
    const stripped = stripOwn(event, groups, removed);
    if (stripped.length === groups.length && sameJson(stripped, groups)) {
      continue;
    }
    if (stripped.length === 0 && !desired) delete hooks[event];
    else hooks[event] = stripped;
  }

  for (const [event, group] of wanted) {
    const current = (hooks[event] as JsonObject[] | undefined) ?? [];
    hooks[event] = [...current, group];
    added.push({ event, entry: group });
  }

  const changed = added.length > 0 || removed.length > 0;
  if (!changed) {
    return {
      next: root ?? {},
      added,
      removed,
      kept: countForeign(hooks),
      changed,
    };
  }
  const emptiedByUs = Object.keys(hooks).length === 0 && removed.length > 0;
  if (emptiedByUs) delete base.hooks;
  else base.hooks = hooks;
  return { next: base, added, removed, kept: countForeign(hooks), changed };
}

/** 設定ファイルの中の自分のフックの状態。 */
export type HookEntriesState = "none" | "installed" | "partial";

export function hookEntriesState(
  root: JsonObject | null,
  specs: readonly HookSpec[],
  command: string,
): HookEntriesState {
  const hooks = root && isPlainObject(root.hooks) ? root.hooks : {};
  let own = 0;
  for (const groups of Object.values(hooks)) {
    for (const group of groups as JsonObject[]) {
      if (Array.isArray(group.hooks))
        own += group.hooks.filter(isOwnHook).length;
    }
  }
  if (own === 0) return "none";
  return planHookChange(root, "install", specs, command).changed
    ? "partial"
    : "installed";
}

/**
 * 元のファイルの字下げ。最初に字下げされた行の先頭の空白をそのまま使う。
 * 見つからなければ 2 桁の空白。
 */
export function detectJsonIndent(text: string): string {
  const match = /\n([ \t]+)\S/.exec(text);
  return match?.[1] ?? "  ";
}

/**
 * 書く文字列。字下げと末尾の改行の有無は元のファイルに合わせる (無い
 * ファイルは 2 桁・改行あり)。
 */
export function serializeHookFile(
  value: unknown,
  original: string | null,
): string {
  const indent = original === null ? "  " : detectJsonIndent(original);
  const newline = original === null || original.endsWith("\n") ? "\n" : "";
  return `${JSON.stringify(value, null, indent)}${newline}`;
}

/** 起動スクリプトの状態。 */
export type LauncherHealth = {
  /**
   * - ok: この code-viewer を指している
   * - other-install: 別の場所の code-viewer を指している (そこは在る)
   * - missing: 起動スクリプトが無い
   * - target-missing: 起動スクリプトが指す code-viewer か node が消えた
   * - unreadable: 読めない
   */
  state: "ok" | "other-install" | "missing" | "target-missing" | "unreadable";
  path: string;
  /** target-missing なら消えたパス、unreadable なら理由。 */
  detail: string;
};

/**
 * 設定画面の 1 行の状態。
 *
 * - no-config-dir: 設定ディレクトリが無い (そのエージェントを使っていない)
 * - unreadable: 設定ファイルが読めない・想定外の形 (書かない)
 * - none / partial / installed: 自分のフックが無い / 一部だけ・古い / 全部ある
 * - broken: フックはあるが、呼び先 (起動スクリプトか code-viewer) が無い
 */
export type AgentHookState =
  | "no-config-dir"
  | "unreadable"
  | "none"
  | "partial"
  | "installed"
  | "broken";

export type AgentHookStatus = {
  agent: HookAgent;
  configDir: string;
  /** 設定ファイル。リンクならリンクそのもの。 */
  path: string;
  /** 実際に書くファイル (リンク先)。 */
  realPath: string;
  symlink: boolean;
  state: AgentHookState;
  /** unreadable の理由、broken の消えたパス、no-config-dir のディレクトリ。 */
  detail: string;
  /** 書けない理由。書けるなら空。 */
  writeBlocked: string;
  /** ほかのツールが入れたフックの数。 */
  kept: number;
};

/** フックが code-viewer に届かなかった 1 件。 */
export type AgentHookFailure = {
  at: number;
  agent: string;
  /** エージェント側の出来事の名前。 */
  hookEvent: string;
  /** 申告しようとした出来事。 */
  event: string;
  target: string;
  /** 届かなかったサーバ。サーバを探す前の失敗なら空。 */
  server: string;
  /** どの段階か (input / registry / identity / no-server / report / launch / log)。 */
  stage: string;
  detail: string;
};

export type AgentHooksResponse = {
  /** サーバのホームディレクトリ。パスを `~/…` に縮めて見せるため。 */
  home: string;
  agents: AgentHookStatus[];
  launcher: LauncherHealth;
  failures: {
    total: number;
    /** 新しい順。 */
    recent: AgentHookFailure[];
    log: string;
  };
};

export type AgentHookPlanResponse = {
  agent: HookAgent;
  action: HookAction;
  path: string;
  realPath: string;
  symlink: boolean;
  fileExists: boolean;
  added: HookChange[];
  removed: HookChange[];
  kept: number;
  changed: boolean;
  /** 書く前の中身を残す場所。書き換えないなら null。時刻は書く瞬間のもの。 */
  backupPath: string | null;
  /**
   * 書く前と後の unified diff (core/text-diff.ts)。確認の画面が差分の見た目で
   * 出す。変わらないなら空。ファイルが無ければ全部が足す行。
   */
  diff: string;
  /** 元の字下げ・並びのままでは書けない (書き直すと空白が変わる)。 */
  formattingChanged: boolean;
  launcher: { path: string; write: boolean };
  writeBlocked: string;
  /** このときの中身のハッシュ。実行時に照らし合わせる。 */
  baseHash: string;
  /** 同じ内容の別ファイルへのリンク差し替えも見分ける不透明な識別子。 */
  fileIdentity: string;
};

export type AgentHookApplyResponse = {
  path: string;
  changed: boolean;
  backupPath: string | null;
  launcherWritten: boolean;
};

/**
 * エージェント一覧に「フックを入れられます」の案内を出す種類。
 *
 * 一覧にその種類のエージェントが居て、フックが入っていない (未設定・
 * 一部だけ・呼び先が無い) ものだけ。使っていない種類や、設定ファイルが
 * 読めない・書けないものは、案内しても一覧からは直せないので出さない
 * (設定画面の行に理由が出る)。
 */
export function agentsNeedingHooks(
  kinds: readonly (string | null)[],
  status: AgentHooksResponse | null,
): HookAgent[] {
  if (!status) return [];
  const present = new Set(kinds);
  return status.agents
    .filter(
      (row) =>
        present.has(row.agent) &&
        !row.writeBlocked &&
        (row.state === "none" ||
          row.state === "partial" ||
          row.state === "broken"),
    )
    .map((row) => row.agent);
}

/**
 * 設定画面の 1 行の見せ方。
 *
 * - problem: 本当の異常 (読めない・想定外の形・呼び先が無い)。注意の色で
 *   理由の全文を出す
 * - generated: 読めるが書けない。設定ファイルを別の場所から生成している
 *   人 (dotfiles をリンクしている等) にはふつうの状態なので、異常として
 *   出さず、生成元に足す手順を案内する
 * - plain: それ以外
 */
export type HookRowTone = "problem" | "generated" | "plain";

export function hookRowTone(status: AgentHookStatus): HookRowTone {
  if (status.state === "unreadable" || status.state === "broken") {
    return "problem";
  }
  if (status.writeBlocked && status.state !== "no-config-dir") {
    return "generated";
  }
  return "plain";
}

/** 行に置く 1 つのボタン。guide-* は書かずに手順を見せる。 */
export type HookRowAction = {
  kind:
    | "install"
    | "uninstall"
    | "repair"
    | "guide-install"
    | "guide-uninstall";
  action: HookAction;
};

export function hookRowAction(status: AgentHookStatus): HookRowAction | null {
  if (status.state === "unreadable" || status.state === "no-config-dir") {
    return null;
  }
  const action: HookAction =
    status.state === "installed" ? "uninstall" : "install";
  // 設定ファイルが書けなくても、呼び先 (起動スクリプト) は書き直せる。
  if (status.writeBlocked && status.state !== "broken") {
    return {
      kind: action === "install" ? "guide-install" : "guide-uninstall",
      action,
    };
  }
  if (status.state === "installed") return { kind: "uninstall", action };
  if (status.state === "none") return { kind: "install", action };
  return { kind: "repair", action };
}

/**
 * opencode のプラグインのファイル名。`<設定ディレクトリ>/plugins/` に置く。
 * 名前が印 (AGENT_HOOK_MARKER) を含むので、古い版の中身でも自分のものと
 * 分かる。中身に印の無い同名のファイルはほかの人のものとして扱い、書かない。
 */
export const OPENCODE_PLUGIN_FILE = `${AGENT_HOOK_MARKER}.js`;

/** プラグインの中身が知る場所。起動スクリプトと失敗の記録。 */
export type OpencodePluginTarget = { launcher: string; failureLog: string };

/**
 * opencode のプラグインの中身 (ES モジュール)。設定ファイルのフックと同じく、
 * 起動スクリプトの場所だけを持ち、code-viewer の場所は持たない (版が上がっても
 * 中身が変わらない)。
 *
 * - opencode 2 と 1 の両方に 1 つの default export で答える。2 は `id` と
 *   `setup(ctx)` を読み、1 (1.18.29 以降) は `server()` を呼ぶ (公式の
 *   migrate-v1 の「Support V1 and V2 from one package」)。`@opencode/plugin` を
 *   import しない素の定義で、2.2.7 が読み込むことを確かめた
 * - opencode 2 は既定で、最初に起こした端末が始めた共有の裏のサーバ
 *   (`opencode serve --service`) にプラグインを読ませる。裏のサーバの環境の
 *   TMUX_PANE はその最初の端末のもので、どの会話がどのペインのものか分からない
 *   (2.2.7 で、裏のサーバは端末を閉じた後も残り、TMUX_PANE を持ち続けた)。そこでは
 *   申告せず、理由を失敗の記録に 1 つ残す。code-viewer が起こす opencode には
 *   `--standalone` を付ける (server/accounts/shared-server.ts)。そのときプラグインは
 *   ペインの opencode の子 (`serve --stdio`) で動き、終わると片付けが呼ばれる
 * - 受ける出来事と打ち切り時間は HOOK_SPECS.opencode から作る。2 では api: 1 の
 *   ものを除いた名前と、下請けを見分ける session.created だけを購読する
 * - 同じセッションで同じ出来事が続けば 2 回目からは呼ばない (1 の session.status
 *   の busy は 1 ターンに何度も来る)
 * - 起動スクリプトは 1 つずつ順に呼ぶ (申告の時刻は CLI が付けるので、並べると
 *   順序が入れ替わる)。opencode 2 は設定のフォルダが変わるとプラグインを読み直す
 *   ので、読み直した後も同じ列に並べる (前の片付けの申告が後の読み込みの申告を
 *   追い越さない)
 * - opencode 2 は答えの残っている許可・質問 (出来事の id) をセッションごとに
 *   数え、全部に答えるまで答えの出来事を送らない。モデルが道具を並べて呼ぶと
 *   許可が同時に 2 つ出て、1 つ目に答えた時点で「作業中」に戻すと理由が消えた
 *   (2.2.7 で観測)
 * - 子のセッション (task で起こした下請け) は、許可と質問のほかは送らない。
 *   下請けの終わりで親が「完了」に見えないようにする
 * - 起動スクリプトを起こせなかったときは、起動スクリプトと同じ失敗の記録に
 *   残す (設定の節が出す)。子の出力は捨てる (端末の画面を崩さない。失敗は
 *   CLI が記録に書く)
 */
export function opencodePluginSource(target: OpencodePluginTarget): string {
  const events = Object.fromEntries(
    HOOK_SPECS.opencode.map((spec) => [
      spec.event,
      { timeout: spec.timeout, matcher: spec.matcher ?? null },
    ]),
  );
  const v2Types = [
    "session.created",
    ...HOOK_SPECS.opencode
      .filter(
        (spec) =>
          spec.api !== 1 &&
          spec.event !== OPENCODE_START &&
          spec.event !== OPENCODE_DISPOSE,
      )
      .map((spec) => spec.event),
  ];
  return `// ${AGENT_HOOK_MARKER}: written by code-viewer (Settings > Agent integration).
// Tells code-viewer when this opencode is working, waiting for you, or done, by
// calling code-viewer's hook launcher. Remove it there, or delete this file.
// One default export answers opencode 2 (id and setup) and opencode 1.18.29 or
// later (server).
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const LAUNCHER = ${JSON.stringify(target.launcher)};
const FAILURE_LOG = ${JSON.stringify(target.failureLog)};
const EVENTS = ${JSON.stringify(events)};
const START = ${JSON.stringify(OPENCODE_START)};
const DISPOSE = ${JSON.stringify(OPENCODE_DISPOSE)};
// A sub-session (a task's helper) reports only these, so that its end does not
// make the main session look done.
const CHILD_EVENTS = new Set(${JSON.stringify(OPENCODE_CHILD_EVENTS)});
// opencode 2 event types to subscribe to.
const V2_TYPES = ${JSON.stringify(v2Types)};
// One queue per opencode process, kept across reloads, so that reports reach
// code-viewer in the order they happened.
const QUEUE = Symbol.for(${JSON.stringify(`${AGENT_HOOK_MARKER}.queue`)});

function recordFailure(name, stage, detail) {
  try {
    appendFileSync(FAILURE_LOG, JSON.stringify({ at: Date.now(), agent: "opencode", hookEvent: name, stage, detail }) + "\\n", { mode: 0o600 });
  } catch (error) {
    console.error("[${AGENT_HOOK_MARKER}] " + detail + "; the failure log " + FAILURE_LOG + " could not be written either", error);
  }
}

function enqueue(task) {
  const next = (globalThis[QUEUE] ?? Promise.resolve()).then(task);
  globalThis[QUEUE] = next;
  return next;
}

function send(input) {
  const name = input.hook_event_name;
  const spec = EVENTS[name];
  return new Promise((resolve) => {
    const child = spawn(LAUNCHER, ["opencode"], { stdio: ["pipe", "ignore", "ignore"] });
    const timer = setTimeout(() => child.kill(), spec.timeout * 1000);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (signal || code !== 0) {
        recordFailure(name, "launch", LAUNCHER + " ended with " + (signal ? "signal " + signal + " (the limit is " + spec.timeout + "s)" : "exit code " + code));
      }
      resolve();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      recordFailure(name, "launch", "could not run " + LAUNCHER + ": " + (error?.stack ?? error));
      resolve();
    });
    child.stdin.on("error", (error) => recordFailure(name, "launch", "could not pass the event to " + LAUNCHER + ": " + (error?.stack ?? error)));
    child.stdin.end(JSON.stringify(input));
  });
}

function text(value) {
  return typeof value === "string" ? value : "";
}

// What opencode 1 and 2 share once each has read its own event shape.
function reporter(directory) {
  const children = new Set();
  const last = new Map();
  const report = (name, sessionID, extra) =>
    enqueue(() => send({ hook_event_name: name, session_id: sessionID, cwd: directory, status: "", ...extra }));
  return {
    start: () => report(START, "", {}),
    dispose: () => report(DISPOSE, "", {}),
    child: (sessionID) => {
      if (sessionID) children.add(sessionID);
    },
    event(type, sessionID, extra) {
      const spec = Object.hasOwn(EVENTS, type) ? EVENTS[type] : null;
      if (!spec || type === START || type === DISPOSE) return;
      if (children.has(sessionID) && !CHILD_EVENTS.has(type)) return;
      const status = text(extra.status);
      if (spec.matcher && !new RegExp("^(?:" + spec.matcher + ")$").test(status)) return;
      const key = type + ":" + status;
      if (last.get(sessionID) === key) return;
      last.set(sessionID, key);
      report(type, sessionID, extra);
    },
  };
}

export default {
  id: "code-viewer.agent-hook",
  // opencode 2.
  setup(ctx) {
    if (process.argv.includes("--service")) {
      recordFailure(START, "service", "opencode loaded this plugin in its shared background service (opencode serve --service), which keeps the tmux pane of the terminal that started it and cannot tell which pane a session belongs to, so nothing is reported from it. Start opencode with --standalone; code-viewer does this when it starts opencode.");
      return undefined;
    }
    const hooks = reporter(text(ctx.location?.directory));
    const controller = new AbortController();
    // Permissions and questions still waiting for an answer, per session. A
    // model can ask several at once; answering one is not back to work yet.
    const open = new Map();
    const waiting = (sessionID) => open.get(sessionID) ?? open.set(sessionID, new Set()).get(sessionID);
    hooks.start();
    (async () => {
      for await (const event of ctx.event.subscribe({ types: V2_TYPES, signal: controller.signal })) {
        const data = event.data ?? {};
        if (event.type === "session.created") {
          if (data.parentID) hooks.child(text(data.sessionID));
          continue;
        }
        const sessionID = text(data.sessionID) || text(data.form?.sessionID);
        if (event.type === "permission.asked" || event.type === "form.created") {
          waiting(sessionID).add(text(data.id) || text(data.form?.id));
        } else if (event.type === "permission.replied" || event.type === "form.replied" || event.type === "form.cancelled") {
          const ids = waiting(sessionID);
          ids.delete(text(data.requestID) || text(data.id));
          if (ids.size > 0) continue;
        } else if (event.type.startsWith("session.execution.")) {
          open.delete(sessionID);
        }
        hooks.event(event.type, sessionID, event.type === "session.execution.failed" ? { error: text(data.error?.type), error_details: text(data.error?.message) } : {});
      }
      if (!controller.signal.aborted) recordFailure(START, "events", "opencode ended the event stream; nothing more is reported until opencode restarts");
    })().catch((error) => {
      if (!controller.signal.aborted) recordFailure(START, "events", "the opencode event stream failed; nothing more is reported until opencode restarts: " + (error?.stack ?? error));
    });
    // Wait until it is delivered; otherwise opencode exits before the report.
    return () => {
      controller.abort();
      return hooks.dispose();
    };
  },
  // opencode 1 (1.18.29 or later).
  async server({ directory }) {
    const hooks = reporter(text(directory));
    hooks.start();
    return {
      event: async ({ event }) => {
        const props = event.properties ?? {};
        if (event.type === "session.created") {
          if (props.info?.parentID) hooks.child(text(props.info.id));
          return;
        }
        hooks.event(event.type, text(props.sessionID), event.type === "session.status" ? { status: String(props.status?.type ?? "") } : {});
      },
      dispose: () => hooks.dispose(),
    };
  },
};
`;
}
