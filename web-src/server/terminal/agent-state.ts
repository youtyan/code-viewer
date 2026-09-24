// エージェントが申告してきた状態を、サーバが生きている間だけ覚えておく。
//
// 保存しない。サーバを落とせばエージェントも別プロセスとして残るが、状態の
// 続きは次の申告で必ず入り直る。古い状態をディスクから復元すると、既に終わ
// っているものを「待ち」として出してしまうほうが害が大きい。
//
// 上限付きの追記ストアという形は views/database/session-log.ts と同じ。
// あちらはブラウザ内の時系列ログで、こちらは対象ごとの最新値なので、Map で
// 持つ点だけが違う。

import type {
  AgentConversation,
  AgentEvent,
  AgentState,
  AgentStateRecord,
  AgentStateSource,
  ReportedAgent,
} from "../../core/agent-state";
import { agentStateForEvent, needsAttention } from "../../core/agent-state";
import { noteAgentStateChange } from "./unread";

/**
 * 覚えておく対象の数。閉じたペインの分が積み上がらないように上限を掛ける。
 * 溢れたら更新が古いものから捨てる。
 */
const MAX_TRACKED_TARGETS = 200;

/** 申告に添えられる文字列の上限。指示文がそのまま来るので長くなりうる。 */
const MAX_TEXT_LENGTH = 2000;

const states = new Map<string, AgentStateRecord>();
let tmuxGeneration: string | null = null;

/** pane id を現在の tmux サーバ世代に結び付ける、メモリ内ストアの鍵。 */
export function agentTargetKey(target: string): string {
  return `${tmuxGeneration ?? "pending"}\0${target}`;
}

/**
 * 現在の tmux サーバ世代を置く。初回は先に届いたフックを現世代へ移し、
 * 変更時は再利用されうる pane id の記録をすべて捨てる。
 */
export function setAgentTmuxGeneration(generation: string): {
  changed: boolean;
  previous: string | null;
} {
  if (!generation) throw new RangeError("tmux generation must not be empty");
  const previous = tmuxGeneration;
  if (previous === generation) return { changed: false, previous };
  const records = previous === null ? [...states.values()] : [];
  states.clear();
  tmuxGeneration = generation;
  for (const record of records)
    states.set(agentTargetKey(record.target), record);
  return { changed: previous !== null, previous };
}

function clip(value: string): string {
  return value.length > MAX_TEXT_LENGTH
    ? value.slice(0, MAX_TEXT_LENGTH)
    : value;
}

function evictOldest(): void {
  while (states.size > MAX_TRACKED_TARGETS) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, record] of states) {
      if (record.updatedAt < oldestAt) {
        oldestAt = record.updatedAt;
        oldestKey = key;
      }
    }
    if (oldestKey === null) return;
    states.delete(oldestKey);
  }
}

export type RecordAgentStateInput = {
  target: string;
  /** 出来事から状態を決める。state を直接指定したいときは state を使う。 */
  event?: AgentEvent;
  /** 出来事を経由せず状態を直接置く (当て推量の書き込み用)。 */
  state?: AgentState;
  source: AgentStateSource;
  /**
   * 申告側が出来事を観測した時刻 (epoch ms)。フックは別プロセスから HTTP で
   * 届くので、送った順に着くとは限らない。これを見て古い申告を捨てる。
   * 省略時は到着時刻を使う (順序の保証を諦める)。
   */
  at?: number;
  /**
   * 画面観測が申告を上書きしてよい、という合図。
   *
   * 文字ルールに明示的に一致した場合と、画面が連続して動いて申告を作業中へ
   * 戻す場合だけ terminal/activity.ts が指定する。
   */
  override?: boolean;
  lastPrompt?: string;
  note?: string;
  /** フックが名乗った種類。送られてこなければ前の値を残す。 */
  agent?: ReportedAgent;
  /** フックが渡した会話の場所。送られてこなければ前の値を残す。 */
  conversation?: AgentConversation;
};

/**
 * 申告を 1 件記録する。
 *
 * 2 つ捨てる場合がある。
 *
 * - 申告済みの対象への根拠の弱い変化量判定。明示的な画面ルールか、連続変化
 *   による作業中への復帰だけが上書きできる。
 * - 既に記録した申告より古い申告。progress が stop より遅れて着いたときに、
 *   終わった対象が稼働中へ戻るのを防ぐ。
 */
export function recordAgentState(
  input: RecordAgentStateInput,
): AgentStateRecord | null {
  const key = agentTargetKey(input.target);
  const previous = states.get(key);
  const next =
    input.state ??
    (input.event
      ? agentStateForEvent(input.event, previous?.state ?? null)
      : null);
  if (!next) return null;

  // 文字ルールの一致は画面に見えている状態として採用する。文字ルールに一致
  // しない変化量だけの判定は、連続して動いたときの作業中への復帰に限る。
  if (input.source !== "hook" && previous?.source === "hook") {
    // 未読の完了状態を解けるのは read / 新しい hook だけ。画面には直前の
    // 作業表示や入力欄が残りうるため、それを根拠に done を消してはいけない。
    if (previous.state === "done") return previous;
    const visibleRule = input.source === "screen" && input.override === true;
    const motionPromoting =
      input.source === "activity" &&
      input.override === true &&
      next === "working";
    if (!visibleRule && !motionPromoting) return previous;
  }

  const at = Number.isFinite(input.at) ? (input.at as number) : Date.now();
  // 申告どうしだけを見比べる。当て推量は観測した瞬間の時刻を持つので、直前に
  // 観測されていると、少し前に発生した申告のほうが古く見えて捨てられてしまう。
  // 同着 (同じミリ秒) は後勝ち。順序が本当に逆なら at がずれる。
  if (
    previous &&
    previous.source === "hook" &&
    input.source === "hook" &&
    at < previous.updatedAt
  ) {
    return previous;
  }

  const record: AgentStateRecord = {
    target: input.target,
    state: next,
    source: input.source,
    updatedAt:
      input.source !== "hook" && previous?.state === next
        ? previous.updatedAt
        : at,
    changeObserved:
      input.source === "hook"
        ? true
        : previous === undefined
          ? false
          : previous.state === next
            ? previous.changeObserved
            : true,
    // 添え物は送られてこなければ前の値を残す。ターンの途中で毎回指示文を
    // 送り直させないため。
    lastPrompt: clip(input.lastPrompt ?? previous?.lastPrompt ?? ""),
    note: clip(input.note ?? previous?.note ?? ""),
  };
  // 種類と終了の印は申告だけが決める。画面観測の記録でも前の値を引き継ぐ。
  const agent = input.agent ?? previous?.agent;
  if (agent) record.agent = agent;
  const ended =
    input.source === "hook" ? input.event === "exit" : previous?.ended;
  if (ended) record.ended = true;
  // 会話の場所も申告だけが決める。終わったセッションの場所は持ち越さない
  // (同じペインで次に動くものの会話ではない)。
  const conversation = ended
    ? undefined
    : (input.conversation ?? previous?.conversation);
  if (conversation) record.conversation = conversation;
  if (previous?.state !== next) {
    noteAgentStateChange(key, previous?.state, next);
  }
  states.set(key, record);
  evictOldest();
  return record;
}

export function getAgentState(target: string): AgentStateRecord | null {
  return states.get(agentTargetKey(target)) ?? null;
}

/** 一覧。人間の番のものが先、その中では待たせている順に並べる。 */
export function listAgentStates(): AgentStateRecord[] {
  return [...states.values()].sort((a, b) => {
    const mine =
      Number(needsAttention(b.state)) - Number(needsAttention(a.state));
    return mine !== 0 ? mine : a.updatedAt - b.updatedAt;
  });
}

export function forgetAgentState(target: string): boolean {
  return states.delete(agentTargetKey(target));
}

/**
 * もう存在しない対象の状態を落とす。閉じたペインが「稼働中」のまま一覧に
 * 残り続けるのを防ぐ。棚卸しできた対象だけを渡すこと (tmux が落ちている等で
 * 一覧が取れなかったときに全部消さないため)。
 */
export function retainAgentStates(known: Set<string>): number {
  let removed = 0;
  for (const [key, record] of [...states]) {
    if (!known.has(record.target)) {
      states.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/** テストとサーバ終了用。持ち越すと次のテストに漏れる。 */
export function clearAgentStates(): void {
  states.clear();
  tmuxGeneration = null;
}
