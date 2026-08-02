// ターミナルで動いているコーディングエージェントの状態。
//
// 画面の文字を読んで当てるのではなく、エージェント自身に申告させる。CLI の
// フック (claude なら UserPromptSubmit / PreToolUse / Stop / Notification、
// codex なら hooks.json) が `code-viewer terminal state` を呼び、そこから
// サーバへ届く。申告が無いセッションのために、出力が動いているかどうかだけ
// を見る当て推量も持つ。両方あるのは、片方だけでは足りないため:
//
// - 申告だけ  → フックを入れていない人には何も出ない
// - 当て推量だけ → 「入力待ち」と「終わったが未読」を区別できない
//
// ここは純粋な型と遷移規則だけを置く。保存も HTTP も server 側で行う。

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
 * claude と codex でフック名は違うが、意味は次の 4 つに畳める。名前を揃えて
 * おかないと、エージェントが増えるたびに遷移表が増える。
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
};

export function agentStateForEvent(
  event: AgentEvent,
  current: AgentState | null = null,
): AgentState {
  if (event === "read")
    return current === "done" ? "idle" : (current ?? "idle");
  return STATE_BY_EVENT[event];
}

/** 状態の出どころ。UI で「申告なので確か」と「当て推量」を区別するために持つ。 */
export type AgentStateSource = "hook" | "activity";

export type AgentStateRecord = {
  /** tmux ペイン ID か、ブラウザシェルのセッション ID。 */
  target: string;
  state: AgentState;
  source: AgentStateSource;
  /** 最後に状態が変わった時刻 (epoch ms)。 */
  updatedAt: number;
  /** 人間が最後に出した指示。フックが送ってきたときだけ入る。 */
  lastPrompt: string;
  /** エージェント側の一言。フックが送ってきたときだけ入る。 */
  note: string;
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
