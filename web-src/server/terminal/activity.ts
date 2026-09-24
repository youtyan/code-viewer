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
import { readTmuxServerGeneration } from "../tmux/command";
import { type ListTmuxPanesOptions, listTmuxPanes } from "../tmux/panes";
import { mapWithConcurrency } from "../worktree/list";
import {
  agentTargetKey,
  getAgentState,
  recordAgentState,
  retainAgentStates,
  setAgentTmuxGeneration,
} from "./agent-state";
import { getActiveAgentScreenRules, reloadAgentScreenRules } from "./rules";
import { resetAgentUnread } from "./unread";

/**
 * 見に行く間隔。エージェント一覧とヘッダの件数表示は、状態が変わってから
 * 5 秒以内に出したい。作業中 → 待機は待機の表示を 2 回続けて見て初めて決まる
 * (nextObservedState の hold) ので、2 周ぶん + 画面側の取り直し
 * (AGENT_MONITOR_INTERVAL_MS) がそこに収まる値にする。
 */
export const ACTIVITY_POLL_INTERVAL_MS = 1500;

/**
 * 誰も見ていないサーバの巡回の間隔。
 *
 * プロジェクトごとにサーバが立つので、見られていないサーバまで 1.5 秒で
 * 回すと tmux の呼び出しがサーバの数だけ増える (1 本で毎秒約 45 回)。
 * 一覧の取得が来ない間はこの間隔に落とし、フックの申告はそのまま受ける。
 */
export const ACTIVITY_IDLE_POLL_INTERVAL_MS = 15_000;

/** 一覧 (/_agent/overview・/_agent/states) の取得がこれだけ来なければ「誰も見ていない」。 */
export const ACTIVITY_UNWATCHED_AFTER_MS = 30_000;

/**
 * 次の巡回までの間隔。最後に一覧を取りに来てから ACTIVITY_UNWATCHED_AFTER_MS
 * 以内なら速い巡回、それ以上なら遅い巡回。
 */
export function activityPollDelay(now: number, lastWatchedAt: number): number {
  return now - lastWatchedAt <= ACTIVITY_UNWATCHED_AFTER_MS
    ? ACTIVITY_POLL_INTERVAL_MS
    : ACTIVITY_IDLE_POLL_INTERVAL_MS;
}

/**
 * 取得が来たとき、答える前に巡回し直すか。最後の巡回がこれより古ければ、
 * 覚えている状態は遅い巡回のもの (最大 ACTIVITY_IDLE_POLL_INTERVAL_MS 前) なので、
 * 今の状態のように見せない。
 */
export function activityIsStale(now: number, lastSweepAt: number): boolean {
  return now - lastSweepAt > ACTIVITY_POLL_INTERVAL_MS * 2;
}

/** これだけ画面が動かなければ止まったとみなす。 */
export const ACTIVITY_IDLE_AFTER_MS = 15000;

/**
 * 申告を「稼働」で上書きするのに要る、画面が動き続けた時間。
 *
 * 一瞬では足りない。入力待ちの画面でも、時計や候補の再描画で一瞬だけ変わる
 * ことがある。これだけの間ずっと動いていれば、それは出力が流れているという
 * こと。決めているのは回数ではなく時間 (元は 3 秒間隔 × 4 回 = 12 秒)。
 */
export const OVERRIDE_MOTION_MS = 12_000;

/**
 * 上の時間を、巡回 1 回ごとに数える回数に直したもの。間隔を変えても時間が
 * 縮まないよう、間隔から導く。1 周で全ペインを見きれない (ペインが
 * MAX_PANES_PER_SWEEP を超える) ときは 1 本を見る間隔が延びるので、実際の
 * 時間はこれより長くなる側にしかずれない。
 */
export const OVERRIDE_CHANGE_STREAK = Math.ceil(
  OVERRIDE_MOTION_MS / ACTIVITY_POLL_INTERVAL_MS,
);

/** capture-pane の同時実行数。子プロセス数をこの値より増やさない。 */
export const ACTIVITY_CAPTURE_CONCURRENCY = 8;
/**
 * 1 周で capture-pane を掛けるペインの上限。続きは次の周で見る。
 *
 * 並列化で 1 周が短くなっても単位時間あたりの子プロセス数を増やさないよう、
 * 3 組までに抑える。ペインが多い場合も巡回位置を持ち回って全件を見る。
 */
export const MAX_PANES_PER_SWEEP = ACTIVITY_CAPTURE_CONCURRENCY * 3;
/** 一覧・世代確認・capture を含む巡回 1 回の上限。 */
export const ACTIVITY_SWEEP_TIMEOUT_MS = 6000;
/**
 * 期限で capture を始められなかったのが何周続いたら、観測の失敗として画面に出すか。
 *
 * 1 周の打ち切りはマシンが混んでいるだけの遅延で、次の周の先頭で読まれる。
 * それが続くときだけ「このペインを見られていない」ことを利用者に知らせる。
 */
export const ACTIVITY_DEFERRED_ERROR_STREAK = 3;

export type ActivitySeen = {
  hash: string;
  changedAt: number;
  /** 連続で画面が変わった回数。申告を上書きしてよいかの根拠になる。 */
  changeStreak: number;
  /** 直前の観測で、作業中から待機への切替えを 1 回見送った。 */
  held?: true;
};

const seen = new Map<string, ActivitySeen>();
/**
 * ペインごとの、最後に capture が返った時刻と、期限で後回しにした連続回数。
 * 鍵は seen と同じ (世代 + pane id)。
 */
const captureProgress = new Map<
  string,
  { lastCapturedAt: number | null; deferredStreak: number }
>();
let timer: ReturnType<typeof setTimeout> | null = null;
/** 走っている巡回。重ねて走らせない。一覧要求は完了を待たない。 */
let inFlight: Promise<void> | null = null;
let watching: { cwd: string; options: ListTmuxPanesOptions } | null = null;
/** 最後に一覧を取りに来た時刻。 */
let lastWatchedAt = 0;
/** 最後に巡回を終えた時刻。 */
let lastSweepAt = 0;
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
    // 見送るのは 1 回だけ。待機中も飾りや時計で画面が動き続けるエージェントは
    // 「同じ画面を 2 回」がいつまでも来ないので、2 回続けて待機の表示なら確定する。
    if (
      detected.state === "idle" &&
      previousState === "working" &&
      contentChanged &&
      !previous?.held
    ) {
      return {
        kind: "hold",
        seen: { ...activity.seen, held: true },
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
  const key = agentTargetKey(target);
  const next = nextObservedState(
    seen.get(key),
    content,
    title,
    Date.now(),
    getActiveAgentScreenRules(),
    getAgentState(target)?.state ?? null,
  );
  seen.set(key, next.seen);
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

/**
 * 何周も続けて期限で読めなかったペインの、画面に出す観測の失敗。
 * 例外ではないのでスタックは無い。
 */
function deferredCaptureError(
  target: string,
  progress: { lastCapturedAt: number | null; deferredStreak: number },
  at: number,
): AgentStateObservationError {
  const lastCaptured =
    progress.lastCapturedAt === null
      ? "not captured since this server started watching"
      : `last captured at ${new Date(progress.lastCapturedAt).toISOString()}`;
  return {
    operation: "capture_screen",
    target,
    at,
    detail: `capture could not start before the ${ACTIVITY_SWEEP_TIMEOUT_MS}ms activity sweep deadline for ${progress.deferredStreak} consecutive sweeps; ${lastCaptured}`,
    stack: "",
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

function sweep(
  cwd: string,
  paneListOptions: ListTmuxPanesOptions,
): Promise<void> {
  inFlight ??= sweepOnce(cwd, paneListOptions).finally(() => {
    lastSweepAt = Date.now();
    inFlight = null;
  });
  return inFlight;
}

async function sweepOnce(
  cwd: string,
  paneListOptions: ListTmuxPanesOptions,
): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + ACTIVITY_SWEEP_TIMEOUT_MS;
  try {
    const [panes, generation] = await Promise.all([
      listTmuxPanes(cwd, paneListOptions),
      readTmuxServerGeneration(cwd),
    ]);
    activityErrors.delete(activityErrorKey("list_terminals", ""));
    const shells = listShellSessions();
    const allPanes = panes.running ? flattenTmuxPanes(panes.sessions) : [];

    if (
      generation.status === "error" ||
      (panes.running && generation.status !== "ok")
    ) {
      const cause =
        generation.status === "error"
          ? generation.error
          : new Error(
              `tmux panes were listed but server generation was ${generation.status}`,
            );
      console.error(
        "[code-viewer] tmux server generation lookup failed",
        cause,
      );
      activityErrors.set(
        activityErrorKey("list_terminals", "tmux-generation"),
        observationError("list_terminals", "tmux-generation", cause),
      );
    } else if (generation.status === "ok" || !panes.running) {
      activityErrors.delete(
        activityErrorKey("list_terminals", "tmux-generation"),
      );
    }
    if (generation.status === "ok") {
      const changed = setAgentTmuxGeneration(generation.generation);
      if (changed.changed) {
        seen.clear();
        captureProgress.clear();
        resetAgentUnread();
        console.info(
          `[code-viewer] tmux server generation changed (${changed.previous} -> ${generation.generation}); cleared agent state`,
        );
      }
    }

    // 棚卸しできたものだけを残す。tmux が落ちているときにペインの状態を
    // 消してしまうと、復帰した瞬間に全部が「初めて見た」に戻る。
    if (panes.running && generation.status === "ok") {
      const known = new Set<string>([
        ...allPanes.map((pane) => pane.id),
        ...shells.map((session) => session.id),
      ]);
      retainAgentStates(known);
      const knownKeys = new Set([...known].map(agentTargetKey));
      for (const target of [...seen.keys()]) {
        if (!knownKeys.has(target)) seen.delete(target);
      }
      for (const target of [...captureProgress.keys()]) {
        if (!knownKeys.has(target)) captureProgress.delete(target);
      }
      // 消えたペインの capture の失敗を出し続けない。二度と読まれないので消えない。
      for (const error of [...activityErrors.values()]) {
        if (error.operation === "capture_screen" && !known.has(error.target)) {
          activityErrors.delete(
            activityErrorKey(error.operation, error.target),
          );
        }
      }
    }

    // シェルは溜め置きを覗くだけなので、毎周すべて見る。
    for (const session of shells) {
      const buffer = readShellBuffer(session.id);
      if (!buffer) continue;
      observe(session.id, buffer.replay, session.command);
    }
    // pane id の世代を特定できなければ旧状態へ結び付けず、次の巡回へ回す。
    if (panes.running && generation.status !== "ok") return;

    const targets = allPanes;
    const offset = sweepOffset;
    const { batch, nextOffset } = rotateForSweep(
      targets,
      offset,
      MAX_PANES_PER_SWEEP,
    );
    const captures = await mapWithConcurrency(
      batch,
      ACTIVITY_CAPTURE_CONCURRENCY,
      async (pane) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { pane, result: null };
        return {
          pane,
          result: await captureTmuxPane(pane.id, cwd, 0, remaining),
        };
      },
    );
    // 期限で始められなかったペインは、次の周の先頭にする。越えて進めると、
    // 混んでいる間は同じ位置のペインが毎周打ち切られて読まれなくなる。
    const firstDeferred = captures.findIndex(({ result }) => result === null);
    sweepOffset =
      firstDeferred === -1
        ? nextOffset
        : (offset + firstDeferred) % targets.length;
    const deferred: string[] = [];
    const settledAt = Date.now();
    for (const { pane, result } of captures) {
      const progressKey = agentTargetKey(pane.id);
      if (result === null) {
        deferred.push(pane.id);
        const progress = captureProgress.get(progressKey) ?? {
          lastCapturedAt: null,
          deferredStreak: 0,
        };
        progress.deferredStreak += 1;
        captureProgress.set(progressKey, progress);
        if (progress.deferredStreak >= ACTIVITY_DEFERRED_ERROR_STREAK) {
          activityErrors.set(
            activityErrorKey("capture_screen", pane.id),
            deferredCaptureError(pane.id, progress, settledAt),
          );
        }
        continue;
      }
      if (result.status === "gone") {
        activityErrors.delete(activityErrorKey("capture_screen", pane.id));
        seen.delete(progressKey);
        captureProgress.delete(progressKey);
        continue;
      }
      captureProgress.set(progressKey, {
        lastCapturedAt:
          result.status === "ok"
            ? settledAt
            : (captureProgress.get(progressKey)?.lastCapturedAt ?? null),
        deferredStreak: 0,
      });
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
    // 遅延は失敗ではないので、ペインごとのスタックは出さず周ごとに 1 行にまとめる。
    if (deferred.length > 0) {
      console.warn(
        `[code-viewer] activity sweep reached its ${ACTIVITY_SWEEP_TIMEOUT_MS}ms deadline after ${settledAt - startedAt}ms; deferred ${deferred.length} pane(s) to the front of the next sweep: ${deferred.join(" ")}`,
      );
    }
  } catch (error) {
    console.error("[code-viewer] terminal state observation failed", error);
    activityErrors.set(
      activityErrorKey("list_terminals", ""),
      observationError("list_terminals", "", error),
    );
  }
}

function schedule(): void {
  if (!watching) return;
  if (timer) clearTimeout(timer);
  const { cwd, options } = watching;
  timer = setTimeout(
    () => {
      timer = null;
      void sweep(cwd, options).finally(schedule);
    },
    activityPollDelay(Date.now(), lastWatchedAt),
  );
  // 観測のためにプロセスを生かし続けない。
  timer.unref?.();
}

export function startAgentActivityWatch(
  cwd: string,
  paneListOptions: ListTmuxPanesOptions = {},
): void {
  if (watching) return;
  watching = { cwd, options: paneListOptions };
  // 起動した直後は見られている扱い (開いたタブがすぐ取りに来る)。
  lastWatchedAt = Date.now();
  // 読めなければ既定のルールで始め、理由を出す (投げっぱなしにすると入口ごと終わる)。
  reloadAgentScreenRules(cwd).catch((error: unknown) => {
    console.error("[code-viewer] terminal rule load failed", error);
  });
  schedule();
}

/**
 * 一覧を取りに来た。速い巡回に戻し、古ければ巡回を起動する。一覧要求は
 * 巡回を待たず、呼び出し側が lastSweepAt を応答に載せて古さを示す。
 */
export function noteAgentListWatched(): number {
  const now = Date.now();
  const wasUnwatched = now - lastWatchedAt > ACTIVITY_UNWATCHED_AFTER_MS;
  lastWatchedAt = now;
  if (!watching) return lastSweepAt;
  if (activityIsStale(now, lastSweepAt)) {
    if (!inFlight) void sweep(watching.cwd, watching.options).finally(schedule);
    return lastSweepAt;
  }
  // 遅い巡回の待ちに入っていたら、速い間隔で組み直す。
  if (wasUnwatched) schedule();
  return lastSweepAt;
}

export function agentActivityObservedAt(): number {
  return lastSweepAt;
}

export function stopAgentActivityWatch(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  watching = null;
  seen.clear();
  captureProgress.clear();
  activityErrors.clear();
  sweepOffset = 0;
  lastSweepAt = 0;
}
