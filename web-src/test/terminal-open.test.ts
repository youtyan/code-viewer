import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeShellSession: vi.fn(),
  createShellSession: vi.fn(),
  findShellSessionForTmuxSession: vi.fn(),
  listShellSessionsForMatching: vi.fn(),
  rememberShellTmuxAttachment: vi.fn(),
  writeToShellWhenReady: vi.fn(),
  listTmuxClients: vi.fn(),
  resolvePaneSession: vi.fn(),
  selectTmuxPane: vi.fn(),
}));

vi.mock("../server/shell/session", () => ({
  closeShellSession: mocks.closeShellSession,
  createShellSession: mocks.createShellSession,
  findShellSessionForTmuxSession: mocks.findShellSessionForTmuxSession,
  listShellSessionsForMatching: mocks.listShellSessionsForMatching,
  rememberShellTmuxAttachment: mocks.rememberShellTmuxAttachment,
  writeToShellWhenReady: mocks.writeToShellWhenReady,
}));

vi.mock("../server/tmux/clients", () => ({
  findClientByTty: () => null,
  listTmuxClients: mocks.listTmuxClients,
}));

vi.mock("../server/tmux/focus", () => ({
  resolvePaneSession: mocks.resolvePaneSession,
  selectTmuxPane: mocks.selectTmuxPane,
  tmuxAttachCommandLine: () => "attach sample pane\r",
}));

import type { ShellSession } from "../core/shell";
import { openTmuxPaneInShell } from "../server/terminal/open";

const SESSION: ShellSession = {
  id: "shell-sample1",
  command: "/bin/sh",
  cwd: "/sample",
  createdAt: "2026-08-01T00:00:00.000Z",
  cols: 80,
  rows: 24,
  exited: false,
  exitCode: null,
  tty: "/dev/sample",
};

describe("openTmuxPaneInShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePaneSession.mockResolvedValue({
      status: "ok",
      session: "sample-session",
    });
    mocks.selectTmuxPane.mockResolvedValue({ status: "ok" });
    mocks.listTmuxClients.mockResolvedValue({ status: "ok", clients: [] });
    mocks.listShellSessionsForMatching.mockResolvedValue([]);
    mocks.findShellSessionForTmuxSession.mockReturnValue(null);
    mocks.createShellSession.mockResolvedValue({
      status: "ok",
      session: SESSION,
    });
    mocks.closeShellSession.mockResolvedValue({ status: "ok" });
  });

  test("opening two panes in one tmux session keeps one browser shell", async () => {
    let attached: ShellSession | null = null;
    mocks.findShellSessionForTmuxSession.mockImplementation(() => attached);
    mocks.rememberShellTmuxAttachment.mockImplementation(() => {
      attached = SESSION;
    });
    mocks.writeToShellWhenReady.mockResolvedValue({ status: "ok" });

    await expect(openTmuxPaneInShell("%1", "/sample")).resolves.toMatchObject({
      status: "ok",
      action: "attached",
    });
    await expect(openTmuxPaneInShell("%2", "/sample")).resolves.toMatchObject({
      status: "ok",
      action: "switched",
    });

    expect(mocks.createShellSession).toHaveBeenCalledTimes(1);
    expect(mocks.rememberShellTmuxAttachment).toHaveBeenCalledWith(
      SESSION.id,
      "sample-session",
      "%1",
    );
  });

  test("returns a delayed shell write failure instead of reporting success", async () => {
    const writeError = new Error("delayed write failed");
    mocks.writeToShellWhenReady.mockResolvedValue({
      status: "error",
      error: writeError,
    });

    await expect(openTmuxPaneInShell("%1", "/sample")).resolves.toEqual({
      status: "error",
      error: writeError,
    });
    expect(mocks.closeShellSession).toHaveBeenCalledWith(SESSION.id);
  });

  test("closes the created shell when it is gone before the initial write", async () => {
    mocks.writeToShellWhenReady.mockResolvedValue({ status: "gone" });

    await expect(openTmuxPaneInShell("%1", "/sample")).resolves.toEqual({
      status: "gone",
    });
    expect(mocks.closeShellSession).toHaveBeenCalledWith(SESSION.id);
  });

  test("keeps both the initial write failure and cleanup failure", async () => {
    const writeError = new Error("delayed write failed");
    const cleanupError = new Error("close failed");
    mocks.writeToShellWhenReady.mockResolvedValue({
      status: "error",
      error: writeError,
    });
    mocks.closeShellSession.mockResolvedValue({
      status: "error",
      error: cleanupError,
    });

    const result = await openTmuxPaneInShell("%1", "/sample");

    expect(result).toMatchObject({ status: "error" });
    if (result.status !== "error") throw new Error("expected an error result");
    expect(
      (result.error as Error & { errors: unknown[] }).errors,
    ).toStrictEqual([writeError, cleanupError]);
  });
});
