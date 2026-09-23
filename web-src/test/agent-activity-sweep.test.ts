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
  ACTIVITY_POLL_INTERVAL_MS,
  ACTIVITY_SWEEP_TIMEOUT_MS,
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
import { agentPane } from "./_test-helpers";

const paneIds = Array.from({ length: 16 }, (_, index) => `%${index + 1}`);

function tmuxPanesFixture() {
  return {
    available: true,
    running: true,
    sessions: [
      {
        name: "sample-session",
        attached: false,
        windows: [
          {
            index: 0,
            name: "main",
            active: true,
            panes: paneIds.map((id, index) => ({
              id,
              label: `sample-session:0.${index}`,
              paneIndex: index,
              title: "sample activity",
              command: "codex",
              path: "/work/sample",
              pid: 1000 + index,
              width: 80,
              height: 24,
              active: index === 0,
              inRepo: true,
            })),
          },
        ],
      },
    ],
  };
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

  test("stops starting captures at the sweep deadline and keeps prior state", async () => {
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
    expect(getAgentActivityErrors()).toHaveLength(paneIds.length);
    expect(paneIds.map((id) => getAgentState(id)?.state)).toEqual(
      paneIds.map(() => "working"),
    );
  });

  test("an overview watch request starts a stale sweep without awaiting it", async () => {
    startAgentActivityWatch("/work/sample");

    expect(noteAgentListWatched()).toBe(0);
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
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
