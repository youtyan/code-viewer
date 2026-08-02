// フックを入れていないセッション向けの当て推量。
//
// 画面が変わり続けている間は「稼働」、しばらく止まったら「停止」。それだけ。
// 止まった理由 (入力待ちなのか終わったのか) は画面からは決められないので、
// core/agent-state の agentStateFromActivity が待ちにも未読にも倒さない。
//
// 申告のある対象も観測はする。ただし記録するのは、画面が数回続けて動いていて
// 「入力待ち」という申告と明らかに食い違うときだけ。フックは状態が変わった
// 瞬間に届くので、画面が静かなら「待ち」のままでいるのが正しく、そこを当て
// 推量で落とすと見落としになる。上げる向きだけを許す。
//
// これが無いと、一度入った申告が二度と更新されないセッション (フックを途中
// までしか入れていない、落ちた、手で入れた) が永久に「あなたの番」へ居座る。
//
// 1 周で見る本数に上限があるのは、ペインごとに tmux のプロセスが 1 つ立つた
// め。ただし先頭だけを見続けると 25 本目以降が永久に観測されないので、続きから
// 順に巡回する。ブラウザシェルは溜め置きを覗くだけでプロセスが要らないので、
// 毎周すべて見る。

import { agentStateFromActivity } from "../../core/agent-state";
// 画面の同一性を見るだけなので、差分取得で使っているものと同じで足りる。
import { hashLine } from "../../core/terminal-capture";
import { flattenTmuxPanes } from "../../core/tmux";
import { listShellSessions, readShellBuffer } from "../shell/session";
import { captureTmuxPane } from "../tmux/capture";
import { listTmuxPanes } from "../tmux/panes";
import { recordAgentState, retainAgentStates } from "./agent-state";

/** 見に行く間隔。 */
export const ACTIVITY_POLL_INTERVAL_MS = 3000;

/** これだけ画面が動かなければ止まったとみなす。 */
export const ACTIVITY_IDLE_AFTER_MS = 15000;

/**
 * 申告を「稼働」で上書きするのに必要な、連続して画面が変わった回数。
 *
 * 1 回では足りない。入力待ちの画面でも、時計や候補の再描画で一瞬だけ変わる
 * ことがある。数回続けて動いていれば、それは出力が流れているということ。
 */
export const OVERRIDE_CHANGE_STREAK = 4;

/** 1 周で capture-pane を掛けるペインの上限。続きは次の周で見る。 */
export const MAX_PANES_PER_SWEEP = 12;

type Seen = {
  hash: string;
  changedAt: number;
  /** 連続で画面が変わった回数。申告を上書きしてよいかの根拠になる。 */
  changeStreak: number;
};

const seen = new Map<string, Seen>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
/** 巡回の再開位置。ペインが増減しても偏らないように持ち回る。 */
let sweepOffset = 0;

/**
 * 1 対象ぶんの判定。前回の観測と今の中身から、次に記録する状態を決める。
 *
 * 副作用を持たないので、間隔や tmux を動かさずにここだけ試せる。
 */
export function nextActivityState(
  previous: Seen | undefined,
  hash: string,
  now: number,
): {
  state: ReturnType<typeof agentStateFromActivity>;
  seen: Seen;
  /** 申告を「稼働」で上書きしてよいだけ、動きが続いているか。 */
  override: boolean;
} {
  const changed = previous === undefined || previous.hash !== hash;
  const changedAt = changed ? now : previous.changedAt;
  // 初回の観測は「変わった」に数えない。前が無いだけで、動いた証拠ではない。
  const changeStreak = changed
    ? previous === undefined
      ? 0
      : previous.changeStreak + 1
    : 0;
  return {
    state: agentStateFromActivity(
      changed,
      now - changedAt,
      ACTIVITY_IDLE_AFTER_MS,
    ),
    seen: { hash, changedAt, changeStreak },
    override: changeStreak >= OVERRIDE_CHANGE_STREAK,
  };
}

/**
 * 申告済みの対象も観測する。上書きはしないが、画面が動き続けているかどうかを
 * 数えておかないと、申告が事実と食い違ったままなのを検出できない。
 */
function observe(target: string, content: string, note: string): void {
  const next = nextActivityState(
    seen.get(target),
    hashLine(content),
    Date.now(),
  );
  seen.set(target, next.seen);
  recordAgentState({
    target,
    state: next.state,
    source: "activity",
    note,
    override: next.override,
  });
}

/**
 * 巡回の順番を決める。offset から始めて上限本数だけ切り出す。
 * 端を越えたら先頭へ回り込む。
 */
export function rotateForSweep<T>(
  items: T[],
  offset: number,
  limit: number,
): { batch: T[]; nextOffset: number } {
  if (items.length === 0) return { batch: [], nextOffset: 0 };
  const take = Math.min(limit, items.length);
  const start = ((offset % items.length) + items.length) % items.length;
  const batch: T[] = [];
  for (let i = 0; i < take; i += 1) {
    batch.push(items[(start + i) % items.length] as T);
  }
  return { batch, nextOffset: (start + take) % items.length };
}

async function sweep(cwd: string): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const panes = await listTmuxPanes(cwd);
    const shells = listShellSessions();
    const allPanes = panes.running ? flattenTmuxPanes(panes.sessions) : [];

    // 棚卸しできたものだけを残す。tmux が落ちているときにペインの状態を
    // 消してしまうと、復帰した瞬間に全部が「初めて見た」に戻る。
    if (panes.running) {
      const known = new Set<string>([
        ...allPanes.map((pane) => pane.id),
        ...shells.map((session) => session.id),
      ]);
      retainAgentStates(known);
      for (const target of [...seen.keys()]) {
        if (!known.has(target)) seen.delete(target);
      }
    }

    // シェルは溜め置きを覗くだけなので、毎周すべて見る。
    for (const session of shells) {
      const buffer = readShellBuffer(session.id);
      if (!buffer) continue;
      observe(session.id, buffer.replay, session.command);
    }

    const targets = allPanes;
    const { batch, nextOffset } = rotateForSweep(
      targets,
      sweepOffset,
      MAX_PANES_PER_SWEEP,
    );
    sweepOffset = nextOffset;
    for (const pane of batch) {
      const result = await captureTmuxPane(pane.id, cwd);
      if (result.status !== "ok") {
        seen.delete(pane.id);
        continue;
      }
      observe(pane.id, result.screen.content, pane.title);
    }
  } catch (error) {
    // ローカルの閲覧ツールなので、tmux 側の不調で観測ごと止めない。
    console.warn(
      `[code-viewer] agent activity sweep skipped: ${String(error)}`,
    );
  } finally {
    inFlight = false;
  }
}

export function startAgentActivityWatch(cwd: string): void {
  if (timer) return;
  timer = setInterval(() => void sweep(cwd), ACTIVITY_POLL_INTERVAL_MS);
  // 観測のためにプロセスを生かし続けない。
  timer.unref?.();
}

export function stopAgentActivityWatch(): void {
  if (timer) clearInterval(timer);
  timer = null;
  seen.clear();
  sweepOffset = 0;
}
