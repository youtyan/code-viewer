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
  AgentEvent,
  AgentState,
  AgentStateRecord,
  AgentStateSource,
} from "../../core/agent-state";
import { agentStateForEvent, needsAttention } from "../../core/agent-state";

/**
 * 覚えておく対象の数。閉じたペインの分が積み上がらないように上限を掛ける。
 * 溢れたら更新が古いものから捨てる。
 */
const MAX_TRACKED_TARGETS = 200;

/** 申告に添えられる文字列の上限。指示文がそのまま来るので長くなりうる。 */
const MAX_TEXT_LENGTH = 2000;

const states = new Map<string, AgentStateRecord>();

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
   * 当て推量が申告を上書きしてよい、という合図。
   *
   * 使うのは「画面が動き続けているのに申告は入力待ちのまま」という、申告が
   * 事実と食い違っている場合だけ (terminal/activity.ts が判定する)。申告を
   * 入れたきり二度と報告が来ないセッションが、永久に「あなたの番」へ居座る
   * のを解く唯一の経路。
   */
  override?: boolean;
  lastPrompt?: string;
  note?: string;
};

/**
 * 申告を 1 件記録する。
 *
 * 2 つ捨てる場合がある。
 *
 * - 申告済みの対象への当て推量。フックは状態が変わった瞬間に届くので、画面が
 *   静かでも「待ち」のままでいるのが正しい。当て推量で上書きすると、待って
 *   いるものが idle に化けて見落としになる。
 * - 既に記録した申告より古い申告。progress が stop より遅れて着いたときに、
 *   終わった対象が稼働中へ戻るのを防ぐ。
 */
export function recordAgentState(
  input: RecordAgentStateInput,
): AgentStateRecord | null {
  const previous = states.get(input.target);
  const next =
    input.state ??
    (input.event
      ? agentStateForEvent(input.event, previous?.state ?? null)
      : null);
  if (!next) return null;

  // 当て推量は原則として申告に触らない。フックは状態が変わった瞬間に届く
  // ので、画面が静かでも「待ち」のままでいるのが正しい。
  //
  // 例外は「稼働へ上げる」ときだけ。画面が動き続けているなら入力待ちでは
  // ありえないので、そこは事実を採る。逆向き (待ちを停止へ落とす) は許さない。
  // 落とすと、長く待たせているものが一覧から消えて本当に見落とす。
  if (input.source === "activity" && previous?.source === "hook") {
    const promoting = input.override === true && next === "working";
    if (!promoting) return previous;
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
    updatedAt: at,
    // 添え物は送られてこなければ前の値を残す。ターンの途中で毎回指示文を
    // 送り直させないため。
    lastPrompt: clip(input.lastPrompt ?? previous?.lastPrompt ?? ""),
    note: clip(input.note ?? previous?.note ?? ""),
  };
  states.set(input.target, record);
  evictOldest();
  return record;
}

export function getAgentState(target: string): AgentStateRecord | null {
  return states.get(target) ?? null;
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
  return states.delete(target);
}

/**
 * もう存在しない対象の状態を落とす。閉じたペインが「稼働中」のまま一覧に
 * 残り続けるのを防ぐ。棚卸しできた対象だけを渡すこと (tmux が落ちている等で
 * 一覧が取れなかったときに全部消さないため)。
 */
export function retainAgentStates(known: Set<string>): number {
  let removed = 0;
  for (const target of [...states.keys()]) {
    if (!known.has(target)) {
      states.delete(target);
      removed += 1;
    }
  }
  return removed;
}

/** テストとサーバ終了用。持ち越すと次のテストに漏れる。 */
export function clearAgentStates(): void {
  states.clear();
}
