// フックを入れていないセッション向けの当て推量。
//
// まず画面に見えている入力要求・作業表示・入力欄を優先度付きルールで判定する。
// どのルールにも一致しないときだけ、画面が変わり続けていれば「作業中」、
// しばらく止まれば「待機中」とする。履歴表示などの skip ルールでは直前の状態を
// 維持する。
//
// 申告のある対象も観測する。明示的な文字ルールは申告が取りこぼした遷移を補い、
// 変化量だけの推測は数回続けて動いた場合に限って作業中へ戻せる。
//
// これが無いと、一度入った申告が二度と更新されないセッション (フックを途中
// までしか入れていない、落ちた、手で入れた) が永久に「あなたの番」へ居座る。
//
// 1 周で見る本数に上限があるのは、ペインごとに tmux のプロセスが 1 つ立つた
// め。ただし先頭だけを見続けると 25 本目以降が永久に観測されないので、続きから
// 順に巡回する。ブラウザシェルは溜め置きを覗くだけでプロセスが要らないので、
// 毎周すべて見る。

import {
  type AgentScreenRuleSet,
  detectAgentScreen,
} from "../../core/agent-screen";
import {
  type AgentState,
  type AgentStateObservationError,
  agentStateFromActivity,
} from "../../core/agent-state";
import { formatErrorDetail } from "../../core/error-detail";
// 画面とタイトルの同一性を見るだけなので、差分取得と同じハッシュで足りる。
import { hashLine } from "../../core/terminal-capture";
import { flattenTmuxPanes } from "../../core/tmux";
import { listShellSessions, readShellBuffer } from "../shell/session";
import { captureTmuxPane } from "../tmux/capture";
import { listTmuxPanes } from "../tmux/panes";
import {
  getAgentState,
  recordAgentState,
  retainAgentStates,
} from "./agent-state";
import { getActiveAgentScreenRules, reloadAgentScreenRules } from "./rules";

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

export type ActivitySeen = {
  hash: string;
  changedAt: number;
  /** 連続で画面が変わった回数。申告を上書きしてよいかの根拠になる。 */
  changeStreak: number;
};

const seen = new Map<string, ActivitySeen>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
const activityErrors = new Map<string, AgentStateObservationError>();
/** 巡回の再開位置。ペインが増減しても偏らないように持ち回る。 */
let sweepOffset = 0;

/**
 * 1 対象ぶんの判定。前回の観測と今の中身から、次に記録する状態を決める。
 *
 * 副作用を持たないので、間隔や tmux を動かさずにここだけ試せる。
 */
export function nextActivityState(
  previous: ActivitySeen | undefined,
  hash: string,
  now: number,
): {
  state: ReturnType<typeof agentStateFromActivity>;
  seen: ActivitySeen;
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

export type ObservedState =
  | {
      kind: "record";
      state: ReturnType<typeof agentStateFromActivity>;
      seen: ActivitySeen;
      override: boolean;
      ruleId: string | null;
    }
  | { kind: "skip"; seen: ActivitySeen; ruleId: string }
  | { kind: "hold"; seen: ActivitySeen; ruleId: string }
  | { kind: "unidentified"; seen: ActivitySeen };

/** 画面の明示的な表示を優先し、該当しないときだけ変化量へ戻る。 */
export function nextObservedState(
  previous: ActivitySeen | undefined,
  content: string,
  title: string | undefined,
  now: number,
  rules: AgentScreenRuleSet = getActiveAgentScreenRules(),
  previousState: AgentState | null = null,
): ObservedState {
  const activity = nextActivityState(
    previous,
    hashLine(`${title ?? ""}\0${content}`),
    now,
  );
  const detected = detectAgentScreen({ screen: content, title }, rules);
  if (detected.kind === "skip") {
    return { kind: "skip", seen: activity.seen, ruleId: detected.ruleId };
  }
  if (detected.kind === "state") {
    const contentChanged =
      previous !== undefined && previous.hash !== activity.seen.hash;
    if (
      detected.state === "idle" &&
      previousState === "working" &&
      contentChanged
    ) {
      return {
        kind: "hold",
        seen: activity.seen,
        ruleId: detected.ruleId,
      };
    }
    if (detected.state === "working" && activity.state === "idle") {
      return { kind: "record", ...activity, ruleId: null };
    }
    return {
      kind: "record",
      state: detected.state,
      seen: activity.seen,
      override: detected.state === "working" ? activity.override : true,
      ruleId: detected.ruleId,
    };
  }
  if (previousState === null) {
    return { kind: "unidentified", seen: activity.seen };
  }
  return { kind: "record", ...activity, ruleId: null };
}

/**
 * 申告済みの対象も観測する。上書きはしないが、画面が動き続けているかどうかを
 * 数えておかないと、申告が事実と食い違ったままなのを検出できない。
 */
function observe(
  target: string,
  content: string,
  note: string,
  title?: string,
): void {
  const next = nextObservedState(
    seen.get(target),
    content,
    title,
    Date.now(),
    getActiveAgentScreenRules(),
    getAgentState(target)?.state ?? null,
  );
  seen.set(target, next.seen);
  if (
    next.kind === "skip" ||
    next.kind === "hold" ||
    next.kind === "unidentified"
  ) {
    return;
  }
  recordAgentState({
    target,
    state: next.state,
    source: next.ruleId ? "screen" : "activity",
    note,
    override: next.override,
  });
}

function observationError(
  operation: AgentStateObservationError["operation"],
  target: string,
  error: unknown,
): AgentStateObservationError {
  return {
    operation,
    target,
    at: Date.now(),
    detail: formatErrorDetail(error),
    stack: error instanceof Error ? (error.stack ?? "") : "",
  };
}

export function getAgentActivityErrors(): AgentStateObservationError[] {
  return [...activityErrors.values()]
    .sort((a, b) => a.at - b.at)
    .map((error) => ({ ...error }));
}

function activityErrorKey(
  operation: AgentStateObservationError["operation"],
  target: string,
): string {
  return `${operation}\0${target}`;
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
    activityErrors.delete(activityErrorKey("list_terminals", ""));
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
      if (result.status === "gone") {
        activityErrors.delete(activityErrorKey("capture_screen", pane.id));
        seen.delete(pane.id);
        continue;
      }
      if (result.status === "error") {
        console.error(
          `[code-viewer] terminal screen capture failed for ${pane.id}`,
          result.error,
        );
        activityErrors.set(
          activityErrorKey("capture_screen", pane.id),
          observationError("capture_screen", pane.id, result.error),
        );
        continue;
      }
      activityErrors.delete(activityErrorKey("capture_screen", pane.id));
      observe(pane.id, result.screen.content, pane.title, pane.title);
    }
  } catch (error) {
    console.error("[code-viewer] terminal state observation failed", error);
    activityErrors.set(
      activityErrorKey("list_terminals", ""),
      observationError("list_terminals", "", error),
    );
  } finally {
    inFlight = false;
  }
}

export function startAgentActivityWatch(cwd: string): void {
  if (timer) return;
  void reloadAgentScreenRules(cwd);
  timer = setInterval(() => void sweep(cwd), ACTIVITY_POLL_INTERVAL_MS);
  // 観測のためにプロセスを生かし続けない。
  timer.unref?.();
}

export function stopAgentActivityWatch(): void {
  if (timer) clearInterval(timer);
  timer = null;
  seen.clear();
  activityErrors.clear();
  sweepOffset = 0;
}
