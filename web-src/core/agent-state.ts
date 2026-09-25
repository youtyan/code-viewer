// ターミナルで動いているコーディングエージェントの状態。
//
// 状態変更の申告、画面に見えている入力・作業表示、画面の変化量を順に使う。
// 申告が無い対象でも画面表示から入力待ちと作業中を拾い、どのルールにも
// 一致しないときだけ変化量から作業中か待機中かを推測する。
//
// - 申告だけ  → フックを入れていない人には何も出ない
// - 当て推量だけ → 「入力待ち」と「終わったが未読」を区別できない
//
// ここは純粋な型と遷移規則だけを置く。保存も HTTP も server 側で行う。

import { hasControlCharacter } from "./control-chars";

/**
 * 画面に出す 4 つの状態。
 *
 * done を idle と分けているのが要点。「終わったのに気付いていない」ものを
 * 見落とすと手が止まるので、待ちと同じ強さで拾う必要がある。
 */
export const AGENT_STATES = ["working", "waiting", "done", "idle"] as const;

export type AgentState = (typeof AGENT_STATES)[number];

export function isAgentState(value: unknown): value is AgentState {
  return (
    typeof value === "string" &&
    (AGENT_STATES as readonly string[]).includes(value)
  );
}

/**
 * エージェントのフックが送ってくる出来事。CLI の `--event` がそのまま入る。
 *
 * 実行環境ごとにフック名は違うが、意味は次の出来事に畳める。名前を揃えて
 * おかないと、対応対象が増えるたびに遷移表が増える。
 */
export const AGENT_EVENTS = [
  /** 人間が指示を出した。ここからターンが始まる。 */
  "prompt",
  /** ツールを実行した。ターンが続いている証拠。 */
  "progress",
  /** 判断を求めて止まった (許可待ち・質問)。 */
  "ask",
  /** ターンが終わった。人間はまだ結果を見ていない。 */
  "stop",
  /** 人間が結果を見た。未読を解く (これが無いと done が残り続ける)。 */
  "read",
  /** セッションが閉じた。 */
  "exit",
  /**
   * セッションが始まった、または作業を中断して入力を待てる状態に戻った。
   * 閉じたのではないので、種類 (claude など) はそのまま覚えておく。
   */
  "ready",
] as const;

export type AgentEvent = (typeof AGENT_EVENTS)[number];

export function isAgentEvent(value: unknown): value is AgentEvent {
  return (
    typeof value === "string" &&
    (AGENT_EVENTS as readonly string[]).includes(value)
  );
}

/**
 * 出来事から状態への対応。
 *
 * read だけは遷移前の状態を見る。読んだのは「終わったが未読」のときだけで、
 * 稼働中や入力待ちの対象を読んでも、その状態は変わらないため。
 */
const STATE_BY_EVENT: Record<Exclude<AgentEvent, "read">, AgentState> = {
  prompt: "working",
  progress: "working",
  ask: "waiting",
  stop: "done",
  exit: "idle",
  ready: "idle",
};

export function agentStateForEvent(
  event: AgentEvent,
  current: AgentState | null = null,
): AgentState {
  if (event === "read")
    return current === "done" ? "idle" : (current ?? "idle");
  return STATE_BY_EVENT[event];
}

/**
 * フックが名乗ってきたエージェントの種類。プロセス名から見分けられない
 * もの (node として動く claude など) を一覧に出すために使う。
 */
export const REPORTED_AGENTS = ["claude", "codex"] as const;

export type ReportedAgent = (typeof REPORTED_AGENTS)[number];

export function isReportedAgent(value: unknown): value is ReportedAgent {
  return (
    typeof value === "string" &&
    (REPORTED_AGENTS as readonly string[]).includes(value)
  );
}

/** 状態の出どころ。UI で「申告なので確か」と「当て推量」を区別するために持つ。 */
export type AgentStateSource = "hook" | "screen" | "activity";

/**
 * フックの入力にある会話の場所。claude・codex とも公式の共通欄
 * (`session_id`・`transcript_path`・`cwd`) で、どの出来事にも付く。
 * 「別のアカウントで続ける」が、次の担当に会話記録の場所を渡すのに使う。
 * 会話記録の中身は code-viewer では読まない (書式は公式に約束されていない)。
 * 渡されなかった欄は空 (codex の transcript_path は null になりうる)。
 */
export type AgentConversation = {
  sessionId: string;
  /** 会話記録のファイル (JSONL) の絶対パス。 */
  transcriptPath: string;
  /** フックが呼ばれたときのエージェントの作業フォルダの絶対パス。 */
  cwd: string;
};

/**
 * 1 つの欄の上限 (文字数)。実際のパスは数百文字に収まる。申告の本文の上限
 * (server/terminal/handle.ts の MAX_AGENT_STATE_BODY_BYTES) に、指示文と
 * 3 つの欄が最悪の文字でも収まるように小さくとる。
 */
export const MAX_CONVERSATION_FIELD = 1024;

/**
 * 欄の値として受け取れるか。空は「渡されなかった」。パスは絶対パスだけ
 * (相対パスはエージェントのプロセスの cwd に依存し、ほかから読めない)。
 */
export function conversationFieldValid(
  field: keyof AgentConversation,
  value: string,
): boolean {
  if (value === "") return true;
  if (value.length > MAX_CONVERSATION_FIELD || hasControlCharacter(value))
    return false;
  return field === "sessionId" || value.startsWith("/");
}

const CONVERSATION_FIELDS = ["sessionId", "transcriptPath", "cwd"] as const;

/** サーバが申告の本文を受けるときの検査。3 つの欄が全部あり、どれも受け取れる値。 */
export function isAgentConversation(
  value: unknown,
): value is AgentConversation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return CONVERSATION_FIELDS.every(
    (field) =>
      typeof record[field] === "string" &&
      conversationFieldValid(field, record[field] as string),
  );
}

/**
 * フックに渡された JSON から会話の場所を取り出す。受け取れない値の欄は空に
 * して、欄の名前を rejected に返す (申告そのものは止めない。呼び出し側が
 * 失敗の記録に残す)。欄が無い・null は渡されなかっただけ (codex の
 * transcript_path は null になりうる)。3 つとも空なら conversation は null。
 */
export function conversationFromHookInput(input: Record<string, unknown>): {
  conversation: AgentConversation | null;
  rejected: (keyof AgentConversation)[];
} {
  const rejected: (keyof AgentConversation)[] = [];
  const pick = (field: keyof AgentConversation, value: unknown): string => {
    if (value === undefined || value === null) return "";
    if (typeof value === "string" && conversationFieldValid(field, value))
      return value;
    rejected.push(field);
    return "";
  };
  const conversation: AgentConversation = {
    sessionId: pick("sessionId", input.session_id),
    transcriptPath: pick("transcriptPath", input.transcript_path),
    cwd: pick("cwd", input.cwd),
  };
  return {
    conversation: CONVERSATION_FIELDS.some(
      (field) => conversation[field] !== "",
    )
      ? conversation
      : null,
    rejected,
  };
}

export type AgentStateRecord = {
  /** tmux ペイン ID か、ブラウザシェルのセッション ID。 */
  target: string;
  state: AgentState;
  source: AgentStateSource;
  /** 最後に状態が変わった時刻 (epoch ms)。 */
  updatedAt: number;
  /**
   * updatedAt が「状態が変わった瞬間」を本当に捉えたものか。
   *
   * 申告 (hook) か、観測中に状態が変わったのを見たときだけ true。サーバが
   * 見始めた時点で既にその状態だったもの (最初の観測) は false で、updatedAt は
   * 「遅くともこの時刻からこの状態」という下限でしかない。これを経過時間として
   * 出すと、何時間も前から待機しているものが「数分」と出る。
   */
  changeObserved: boolean;
  /** 人間が最後に出した指示。フックが送ってきたときだけ入る。 */
  lastPrompt: string;
  /** エージェント側の一言。フックが送ってきたときだけ入る。 */
  note: string;
  /** フックが名乗った種類。名乗っていなければ無い。 */
  agent?: ReportedAgent;
  /**
   * 最後の申告がセッションの終了 (exit) だった。そのペインではもう
   * エージェントが動いていないので、一覧では種類を持たないペインに戻す。
   */
  ended?: boolean;
};

export type AgentStateObservationError = {
  operation:
    | "list_terminals"
    | "capture_screen"
    /** エージェント一覧: どの端末がどのペインを映しているかを引けなかった。 */
    | "list_clients"
    /** エージェント一覧: ペインの cwd から git のルートを求められなかった。 */
    | "resolve_project"
    /** エージェント一覧: プロジェクトを開いているサーバを確かめられなかった。 */
    | "find_server"
    /** 保存した会話の場所を読めなかった (server/terminal/agent-conversations.ts)。 */
    | "restore_conversations"
    /** 会話の場所を保存できなかった。 */
    | "save_conversations";
  target: string;
  at: number;
  /** Error の cause と独自フィールドを保持した表示用詳細。 */
  detail: string;
  /** Error が持つ場合は省略せず返す。 */
  stack: string;
};

export type AgentStatesResponse = {
  states: AgentStateRecord[];
  errors: AgentStateObservationError[];
};

/**
 * 人間の番かどうか。上段のボードに出す判定はここ 1 箇所に置く。
 * waiting と done を並べるのが目的なので、呼び出し側で 2 つ書かない。
 */
export function needsAttention(state: AgentState): boolean {
  return state === "waiting" || state === "done";
}

/**
 * 出力の動きから状態を当てる (フックが無いセッション用)。
 *
 * 分かるのは「動いている」か「止まっている」かだけ。止まっている理由までは
 * 見分けられないので、待ちにも done にも倒さず idle にする。嘘の「あなたの
 * 番」を出すより、何も言わないほうがましという判断。
 *
 * @param changed 直前の観測から画面が変わったか
 * @param quietMs 最後に変化してからの経過 (ms)
 * @param idleAfterMs これを超えて静かなら止まったとみなす
 */
export function agentStateFromActivity(
  changed: boolean,
  quietMs: number,
  idleAfterMs: number,
): AgentState {
  if (changed) return "working";
  return quietMs >= idleAfterMs ? "idle" : "working";
}

/**
 * 申告と当て推量のどちらを採るか。
 *
 * 申告が来ているセッションでは当て推量を無視する。フックは状態が変わった
 * 瞬間に届くので、画面が静かでも「待ち」のままでいるのが正しい。当て推量で
 * 上書きすると、待っているものが idle に化けて見落としに直結する。
 */
export function preferHookState(
  hook: AgentStateRecord | null,
  activity: AgentStateRecord | null,
): AgentStateRecord | null {
  return hook ?? activity;
}
