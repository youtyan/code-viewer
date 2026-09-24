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
  watchAttachedShell: vi.fn(),
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
  findClientByTty: (clients: { tty: string }[], tty: string) =>
    clients.find((client) => client.tty === tty) ?? null,
  listTmuxClients: mocks.listTmuxClients,
}));

vi.mock("../server/tmux/focus", () => ({
  resolvePaneSession: mocks.resolvePaneSession,
  selectTmuxPane: mocks.selectTmuxPane,
  tmuxAttachCommandLine: () => "attach sample pane\r",
}));

vi.mock("../server/terminal/attach-watch", () => ({
  watchAttachedShell: mocks.watchAttachedShell,
}));

import { LOGIN_SESSION } from "../core/agent-accounts";
import type { ShellPurpose, ShellSession } from "../core/shell";
import {
  openTmuxPaneInShell,
  rememberSignInPane,
} from "../server/terminal/open";

const SIGN_IN: ShellPurpose = {
  kind: "sign-in",
  agent: "claude",
  account: "Work",
};

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
      window: 2,
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
      null,
    );
    // 映していたペインが終わったら閉じる見張りは、attach を打ち込んだ 1 回だけ。
    expect(mocks.watchAttachedShell.mock.calls).toEqual([
      [SESSION.id, "/sample"],
    ]);
  });

  test("does not watch a shell where the user started tmux by hand", async () => {
    // 利用者が自分で tmux を起こしたシェルは、利用者のもの。ペインが終わっても閉じない。
    const manual = { ...SESSION, id: "shell-manual" };
    mocks.listShellSessionsForMatching.mockResolvedValue([manual]);
    mocks.listTmuxClients.mockResolvedValue({
      status: "ok",
      clients: [{ tty: manual.tty, session: "sample-session", pane: "%1" }],
    });
    await expect(openTmuxPaneInShell("%1", "/sample")).resolves.toMatchObject({
      status: "ok",
      action: "switched",
    });
    expect(mocks.watchAttachedShell).not.toHaveBeenCalled();
  });

  // ログインのウィンドウのペインだけに用途が付く。tmux が起き直して同じ ID が
  // 別のセッションのペインに付いても、そちらには付けない。
  test.each([
    { session: LOGIN_SESSION, expected: SIGN_IN },
    { session: "sample-session", expected: null },
  ])("a pane in $session gets the purpose $expected", async ({
    session,
    expected,
  }) => {
    rememberSignInPane("%7", SIGN_IN);
    mocks.resolvePaneSession.mockResolvedValue({
      status: "ok",
      session,
      window: 0,
    });
    mocks.writeToShellWhenReady.mockResolvedValue({ status: "ok" });
    await openTmuxPaneInShell("%7", "/sample");
    expect(mocks.rememberShellTmuxAttachment).toHaveBeenCalledWith(
      SESSION.id,
      session,
      "%7",
      expected,
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

  describe("繋ぎ直し (サーバが起き直して終わったシェルのタブ)", () => {
    const REVIVE = {
      shell: "shell-sample1",
      session: "sample-session",
      window: 2,
    };

    test("保存した場所と一致すれば、同じ ID のシェルを開いて attach を打ち込む", async () => {
      // 同じセッションを映している別のシェルがあっても使い回さない (ID を保つ)。
      mocks.findShellSessionForTmuxSession.mockReturnValue({
        ...SESSION,
        id: "shell-other",
      });
      mocks.writeToShellWhenReady.mockResolvedValue({ status: "ok" });

      const result = await openTmuxPaneInShell("%1", "/sample", {}, REVIVE);

      expect([
        result,
        mocks.createShellSession.mock.calls,
        mocks.writeToShellWhenReady.mock.calls,
      ]).toEqual([
        { status: "ok", session: SESSION, action: "attached" },
        [["/sample", {}, "shell-sample1"]],
        [["shell-sample1", "attach sample pane\r"]],
      ]);
    });

    // ペイン ID は tmux が起き直すと別のペインに付く。ID だけで繋がない。
    test.each([
      { name: "セッション名が違う", session: "another-session", window: 2 },
      { name: "ウインドウの番号が違う", session: "sample-session", window: 3 },
    ])("$name なら開かずに gone", async ({ session, window }) => {
      const result = await openTmuxPaneInShell(
        "%1",
        "/sample",
        {},
        {
          ...REVIVE,
          session,
          window,
        },
      );

      expect([result, mocks.createShellSession.mock.calls]).toEqual([
        { status: "gone" },
        [],
      ]);
    });

    test("別の窓が先に繋ぎ直していれば、そのシェルを返し attach を打ち直さない", async () => {
      mocks.createShellSession.mockResolvedValue({
        status: "in-use",
        session: SESSION,
      });

      const result = await openTmuxPaneInShell("%1", "/sample", {}, REVIVE);

      expect([result, mocks.writeToShellWhenReady.mock.calls]).toEqual([
        { status: "ok", session: SESSION, action: "switched" },
        [],
      ]);
    });
  });
});
