import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentPane } from "../core/agent-overview";
import type { AgentState } from "../core/agent-state";
import type { TmuxCaptureResult } from "../server/tmux/capture";

const mocks = vi.hoisted(() => ({
  capturePane: vi.fn(),
  generation: vi.fn(),
  listPanes: vi.fn(),
}));

vi.mock("../server/tmux/capture", () => ({
  captureTmuxPane: mocks.capturePane,
}));
vi.mock("../server/tmux/command", () => ({
  readTmuxServerGeneration: mocks.generation,
}));
vi.mock("../server/tmux/panes", () => ({ listTmuxPanes: mocks.listPanes }));
vi.mock("../server/shell/session", () => ({
  listShellSessions: () => [],
  readShellBuffer: () => null,
}));

import {
  ACTIVITY_CAPTURE_CONCURRENCY,
  ACTIVITY_DEFERRED_ERROR_STREAK,
  ACTIVITY_POLL_INTERVAL_MS,
  ACTIVITY_SWEEP_TIMEOUT_MS,
  agentActivityObservedAt,
  getAgentActivityErrors,
  noteAgentListWatched,
  startAgentActivityWatch,
  stopAgentActivityWatch,
} from "../server/terminal/activity";
import {
  clearAgentStates,
  getAgentState,
  recordAgentState,
} from "../server/terminal/agent-state";
import { noteAgentUnread, resetAgentUnread } from "../server/terminal/unread";
import { agentPane, tmuxPanes } from "./_test-helpers";

const paneIds = Array.from({ length: 16 }, (_, index) => `%${index + 1}`);

function tmuxPanesFixture() {
  return tmuxPanes(paneIds, { title: "sample activity" });
}

function capture(id: string): TmuxCaptureResult {
  return {
    status: "ok",
    screen: {
      pane: id,
      content: "• Working (1s · esc to interrupt)",
      width: 80,
      height: 24,
      cursorX: 0,
      cursorY: 0,
      historyLines: 0,
    },
  };
}

/** 次の巡回が 1 回始まって終わるところまで時計を進める。 */
async function runNextSweep(): Promise<void> {
  const calls = mocks.listPanes.mock.calls.length;
  const observedAt = agentActivityObservedAt();
  for (
    let step = 0;
    mocks.listPanes.mock.calls.length === calls ||
    agentActivityObservedAt() === observedAt;
    step += 1
  ) {
    if (step > 400) throw new Error("the next activity sweep did not finish");
    await vi.advanceTimersByTimeAsync(100);
  }
}

/**
 * 1 本の capture に期限の半分かかる混んだマシン。8 並列で 2 組 (16 本) 読めたところで
 * 期限になり、残りは始められない。記録するのは読めたペインだけ。
 */
const CAPTURE_MS = ACTIVITY_SWEEP_TIMEOUT_MS / 2;
const READ_PER_SWEEP = ACTIVITY_CAPTURE_CONCURRENCY * 2;
function congestedCapture(reads: string[]) {
  return (id: string, _cwd: string, _history: number, timeoutMs = 0) =>
    new Promise<TmuxCaptureResult>((resolve) => {
      const finishes = timeoutMs >= CAPTURE_MS;
      setTimeout(
        () => {
          if (finishes) reads.push(id);
          resolve(
            finishes
              ? capture(id)
              : { status: "error", error: new Error("capture timeout") },
          );
        },
        Math.min(CAPTURE_MS, timeoutMs),
      );
    });
}

function manyPaneIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `%${index + 1}`);
}

function sweptPane(state: AgentState): AgentPane {
  const samplePane = tmuxPanesFixture().sessions[0]?.windows[0]?.panes[0];
  if (!samplePane) throw new Error("sample pane fixture is empty");
  return agentPane({
    ...samplePane,
    session: "sample-session",
    kind: "codex",
    state,
    source: "hook",
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.capturePane.mockReset();
  mocks.capturePane.mockImplementation(async (id: string) => capture(id));
  mocks.generation.mockReset();
  mocks.generation.mockResolvedValue({ status: "ok", generation: "4242:1" });
  mocks.listPanes.mockReset();
  mocks.listPanes.mockResolvedValue(tmuxPanesFixture());
});

afterEach(() => {
  stopAgentActivityWatch();
  clearAgentStates();
  resetAgentUnread();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("bounded activity sweep", () => {
  test("captures no more than eight panes at once", async () => {
    const pending: ((result: TmuxCaptureResult) => void)[] = [];
    mocks.capturePane.mockImplementation(
      () => new Promise<TmuxCaptureResult>((resolve) => pending.push(resolve)),
    );
    startAgentActivityWatch("/work/sample");

    await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_INTERVAL_MS);
    expect(mocks.capturePane).toHaveBeenCalledTimes(
      ACTIVITY_CAPTURE_CONCURRENCY,
    );

    for (const [index, resolve] of pending.splice(0).entries()) {
      resolve(capture(paneIds[index] ?? "%1"));
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.capturePane).toHaveBeenCalledTimes(
      ACTIVITY_CAPTURE_CONCURRENCY * 2,
    );
    for (const [index, resolve] of pending.splice(0).entries()) {
      resolve(capture(paneIds[index + ACTIVITY_CAPTURE_CONCURRENCY] ?? "%1"));
    }
    await Promise.resolve();
    await Promise.resolve();
  });

  test("stops starting captures at the sweep deadline, keeps prior state, and reports only real capture failures", async () => {
    const failed = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const id of paneIds) {
      recordAgentState({ target: id, state: "working", source: "activity" });
    }
    mocks.capturePane.mockImplementation(
      (_id: string, _cwd: string, _history: number, timeoutMs?: number) =>
        new Promise<TmuxCaptureResult>((resolve) => {
          setTimeout(
            () =>
              resolve({ status: "error", error: new Error("capture timeout") }),
            timeoutMs ?? 3000,
          );
        }),
    );
    startAgentActivityWatch("/work/sample");

    await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_INTERVAL_MS);
    expect(mocks.capturePane).toHaveBeenCalledTimes(
      ACTIVITY_CAPTURE_CONCURRENCY,
    );
    await vi.advanceTimersByTimeAsync(ACTIVITY_SWEEP_TIMEOUT_MS);

    expect(mocks.capturePane).toHaveBeenCalledTimes(
      ACTIVITY_CAPTURE_CONCURRENCY,
    );
    // 始めて時間切れになった 8 本は本当の失敗。始められなかった 8 本は遅延なので出さない。
    const started = paneIds.slice(0, ACTIVITY_CAPTURE_CONCURRENCY);
    expect(getAgentActivityErrors().map((error) => error.target)).toEqual(
      started,
    );
    expect(failed).toHaveBeenCalledTimes(started.length);
    expect(paneIds.map((id) => getAgentState(id)?.state)).toEqual(
      paneIds.map(() => "working"),
    );
  });

  test.each([
    24, 48, 60, 100,
  ])("every one of %i panes is captured within ceil(n / panes read per sweep) congested sweeps", async (count) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ids = manyPaneIds(count);
    const reads: string[] = [];
    mocks.listPanes.mockResolvedValue(tmuxPanes(ids));
    mocks.capturePane.mockImplementation(congestedCapture(reads));
    startAgentActivityWatch("/work/sample");

    const sweeps = Math.ceil(count / READ_PER_SWEEP);
    for (let turn = 0; turn < sweeps; turn += 1) await runNextSweep();

    expect(mocks.listPanes).toHaveBeenCalledTimes(sweeps);
    expect(new Set(reads)).toEqual(new Set(ids));
  });

  test("the first deferred pane leads the next sweep and each sweep logs one line without a stack", async () => {
    const warned = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const failed = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const ids = manyPaneIds(48);
    mocks.listPanes.mockResolvedValue(tmuxPanes(ids));
    mocks.capturePane.mockImplementation(congestedCapture([]));
    startAgentActivityWatch("/work/sample");

    await runNextSweep();
    const firstSweepCalls = mocks.capturePane.mock.calls.length;
    await runNextSweep();

    expect(mocks.capturePane.mock.calls[firstSweepCalls]?.[0]).toBe("%17");
    expect(warned.mock.calls).toEqual([
      [
        "[code-viewer] activity sweep reached its 6000ms deadline after 6000ms; deferred 8 pane(s) to the front of the next sweep: %17 %18 %19 %20 %21 %22 %23 %24",
      ],
      [
        "[code-viewer] activity sweep reached its 6000ms deadline after 6000ms; deferred 8 pane(s) to the front of the next sweep: %33 %34 %35 %36 %37 %38 %39 %40",
      ],
    ]);
    expect(failed).not.toHaveBeenCalled();
    expect(getAgentActivityErrors()).toEqual([]);
  });

  test.each([
    {
      name: "after an earlier capture",
      readFirst: true,
      lastCaptured: "last captured at 2026-01-01T00:00:01.500Z",
    },
    {
      name: "before any capture",
      readFirst: false,
      lastCaptured: "not captured since this server started watching",
    },
  ])("a pane deferred for consecutive sweeps becomes an observation error $name and clears once captured", async ({
    readFirst,
    lastCaptured,
  }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    startAgentActivityWatch("/work/sample");
    if (readFirst) await runNextSweep();
    // 一覧を取るだけで期限を使い切るほど混んでいる。
    mocks.listPanes.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve(tmuxPanesFixture()),
            ACTIVITY_SWEEP_TIMEOUT_MS,
          );
        }),
    );

    for (let turn = 1; turn < ACTIVITY_DEFERRED_ERROR_STREAK; turn += 1) {
      await runNextSweep();
    }
    expect(getAgentActivityErrors()).toEqual([]);
    await runNextSweep();

    const errors = getAgentActivityErrors();
    expect(errors.map((error) => error.target)).toEqual(paneIds);
    expect(errors[0]).toMatchObject({
      operation: "capture_screen",
      detail: `capture could not start before the 6000ms activity sweep deadline for ${ACTIVITY_DEFERRED_ERROR_STREAK} consecutive sweeps; ${lastCaptured}`,
      stack: "",
    });

    mocks.listPanes.mockResolvedValue(tmuxPanesFixture());
    await runNextSweep();
    expect(getAgentActivityErrors()).toEqual([]);
  });

  test("an overview watch request starts a stale sweep without awaiting it", async () => {
    startAgentActivityWatch("/work/sample");

    expect(noteAgentListWatched()).toBe(0);
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  });
});

describe("the usage check's session", () => {
  test("is not swept (its screen is never read)", async () => {
    const listed = tmuxPanes(["%1"], { title: "sample activity" });
    const check = tmuxPanes(["%9"], { title: "sample activity" }).sessions.map(
      (session) => ({ ...session, name: "code-viewer-usage-claude-defau-x" }),
    );
    mocks.listPanes.mockResolvedValue({
      ...listed,
      sessions: [...listed.sessions, ...check],
    });
    startAgentActivityWatch("/work/sample");
    await runNextSweep();
    expect(mocks.capturePane.mock.calls.map((call) => call[0])).toEqual(["%1"]);
    expect(getAgentState("%9")).toBeNull();
  });
});

describe("tmux generation changes", () => {
  test("clears state and unread once before a reused pane id is observed", async () => {
    const logged = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    mocks.generation
      .mockResolvedValueOnce({ status: "ok", generation: "4242:1" })
      .mockResolvedValueOnce({ status: "ok", generation: "5252:2" });
    startAgentActivityWatch("/work/sample");
    await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_INTERVAL_MS);
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();

    noteAgentUnread([sweptPane("working")]);
    recordAgentState({ target: "%1", event: "stop", source: "hook" });
    expect(noteAgentUnread([sweptPane("done")])).toEqual([
      { pane: "%1", transition: "finished" },
    ]);

    mocks.capturePane.mockResolvedValue({ status: "gone" });
    vi.setSystemTime(Date.now() + ACTIVITY_POLL_INTERVAL_MS * 3);
    noteAgentListWatched();
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();

    expect(mocks.generation).toHaveBeenCalledTimes(2);
    expect(getAgentState("%1")).toBeNull();
    expect(noteAgentUnread([sweptPane("done")])).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
