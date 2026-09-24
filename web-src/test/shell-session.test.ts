import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatErrorDetail } from "../core/error-detail";
import { linkShellsAndPanes } from "../core/terminal-board";

const mocks = vi.hoisted(() => ({
  runAsync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("../server/runtime", () => ({ runAsync: mocks.runAsync }));
vi.mock("@lydell/node-pty", () => ({ spawn: mocks.spawn }));

import {
  closeAllShellSessions,
  closeShellSession,
  createShellSession,
  listShellSessionsForMatching,
  subscribeShell,
  writeToShellWhenReady,
} from "../server/shell/session";

type FakePty = {
  pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  emitData(data: string): void;
  emitExit(exitCode: number): void;
};

function fakePty(): FakePty {
  let dataListener: ((data: string) => void) | null = null;
  const exitListeners: Array<(event: { exitCode: number }) => void> = [];
  return {
    pid: 1234,
    onData(listener) {
      dataListener = listener;
      return { dispose: () => undefined };
    },
    onExit(listener) {
      exitListeners.push(listener);
      return { dispose: () => undefined };
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData(data) {
      dataListener?.(data);
    },
    emitExit(exitCode) {
      for (const listener of exitListeners) listener({ exitCode });
    },
  };
}

let pty: FakePty;

beforeEach(() => {
  pty = fakePty();
  mocks.spawn.mockReturnValue(pty);
  mocks.runAsync.mockResolvedValue({
    code: 0,
    stdout: "ttys001\n",
    stderr: "",
  });
});

afterEach(async () => {
  pty.emitExit(0);
  await closeAllShellSessions();
  mocks.runAsync.mockReset();
  mocks.spawn.mockReset();
});

// 頼まれた ID で開く: 入口が起き直して終わったシェルのタブを、同じ ID のまま
// 開き直す (タブの配置は ID で指す)。2 つの窓が同時に開き直すこともある。
describe("createShellSession with a requested id", () => {
  test("使われている ID なら開かずに、そのシェルを in-use で返す", async () => {
    const first = await createShellSession(process.cwd(), {}, "shell-same01");
    const second = await createShellSession(process.cwd(), {}, "shell-same01");

    expect([first, second, mocks.spawn.mock.calls.length]).toMatchObject([
      { status: "ok", session: { id: "shell-same01" } },
      { status: "in-use", session: { id: "shell-same01" } },
      1,
    ]);
  });

  test("同時に開いたら後から来た方を止めて先の方を返し、止めた方が終わっても先の方は残る", async () => {
    const winner = fakePty();
    const loser = fakePty();
    mocks.spawn.mockReturnValueOnce(winner).mockReturnValueOnce(loser);

    const results = await Promise.all([
      createShellSession(process.cwd(), {}, "shell-same02"),
      createShellSession(process.cwd(), {}, "shell-same02"),
    ]);
    loser.emitExit(0);
    const listed = (await listShellSessionsForMatching()).map((s) => s.id);
    winner.emitExit(0);

    expect([
      results,
      winner.kill.mock.calls.length,
      loser.kill.mock.calls.length,
      listed,
    ]).toMatchObject([
      [
        { status: "ok", session: { id: "shell-same02" } },
        { status: "in-use", session: { id: "shell-same02" } },
      ],
      0,
      1,
      ["shell-same02"],
    ]);
  });
});

describe("createShellSession PTY terminal resolution", () => {
  test("retries a temporarily missing tty and links the shell to its tmux pane", async () => {
    mocks.runAsync
      .mockResolvedValueOnce({ code: 0, stdout: "?\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "ttys031\n", stderr: "" });

    const result = await createShellSession(process.cwd());

    if (result.status !== "ok") throw new Error("expected a shell session");
    expect(result.session.tty).toBe("/dev/ttys031");
    const linked = linkShellsAndPanes(
      [result.session],
      [{ tty: "/dev/ttys031", session: "sample-session", pane: "%31" }],
    );
    expect(linked.paneToShell.get("%31")).toBe(result.session.id);
  });

  test("rechecks an empty tty for matching and remembers the first resolved value", async () => {
    vi.useFakeTimers();
    try {
      mocks.runAsync.mockResolvedValue({ code: 0, stdout: "?\n", stderr: "" });
      const creating = createShellSession(process.cwd());
      await vi.advanceTimersByTimeAsync(2000);
      const created = await creating;
      if (created.status !== "ok") throw new Error("expected a shell session");
      expect(created.session.tty).toBe("");

      mocks.runAsync.mockResolvedValue({
        code: 0,
        stdout: "ttys031\n",
        stderr: "",
      });
      const matched = await listShellSessionsForMatching();
      const callsAfterResolution = mocks.runAsync.mock.calls.length;
      expect(matched[0]?.tty).toBe("/dev/ttys031");

      await listShellSessionsForMatching();
      expect(mocks.runAsync).toHaveBeenCalledTimes(callsAfterResolution);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    {
      name: "a non-zero ps result",
      arrange: () =>
        mocks.runAsync.mockResolvedValue({
          code: 17,
          stdout: "partial stdout",
          stderr: "permission denied",
        }),
      expected:
        "Error: failed to resolve the PTY terminal\nCaused by: Error: ps exited with 17\nstderr: permission denied\nstdout: partial stdout",
    },
    {
      name: "a rejected ps execution",
      arrange: () =>
        mocks.runAsync.mockRejectedValue(
          Object.assign(new Error("ps execution failed"), {
            cause: new Error("spawn failed"),
          }),
        ),
      expected:
        "Error: failed to resolve the PTY terminal\nCaused by: Error: ps execution failed\nCaused by: Error: spawn failed",
    },
  ])("returns every detail for $name and closes the child", async ({
    arrange,
    expected,
  }) => {
    arrange();

    const result = await createShellSession(process.cwd());

    expect(result).toMatchObject({ status: "error" });
    if (result.status !== "error") throw new Error("expected an error result");
    expect(result.error).toBeInstanceOf(Error);
    expect(formatErrorDetail(result.error)).toBe(expected);
    expect(pty.kill).toHaveBeenCalledTimes(1);
  });

  test("keeps terminal resolution and child cleanup failures as separate errors", async () => {
    mocks.runAsync.mockRejectedValue(
      Object.assign(new Error("ps execution failed"), {
        cause: new Error("spawn failed"),
      }),
    );
    pty.kill.mockImplementation(() => {
      throw Object.assign(new Error("cleanup failed"), {
        cause: new Error("kill failed"),
      });
    });

    const result = await createShellSession(process.cwd());

    expect(result).toMatchObject({ status: "error" });
    if (result.status !== "error") throw new Error("expected an error result");
    expect(formatErrorDetail(result.error)).toBe(
      'Error: failed to create the shell and stop its child process\nDetails: {"errors":[{"name":"Error","message":"failed to resolve the PTY terminal","cause":{"name":"Error","message":"ps execution failed","cause":{"name":"Error","message":"spawn failed"}}},{"name":"Error","message":"cleanup failed","cause":{"name":"Error","message":"kill failed"}}]}',
    );
  });
});

describe("writeToShellWhenReady", () => {
  test("does not report success until the deferred write succeeds", async () => {
    const created = await createShellSession(process.cwd());
    if (created.status !== "ok") throw new Error("expected a shell session");

    let settled = false;
    const pending = writeToShellWhenReady(
      created.session.id,
      "sample input",
    ).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    pty.emitData("$ ");

    await expect(pending).resolves.toEqual({ status: "ok" });
    expect(pty.write).toHaveBeenCalledWith("sample input");
  });

  test("returns the complete deferred write error", async () => {
    const created = await createShellSession(process.cwd());
    if (created.status !== "ok") throw new Error("expected a shell session");
    pty.write.mockImplementation(() => {
      throw Object.assign(new Error("write failed"), {
        cause: new Error("pipe closed"),
      });
    });

    const pending = writeToShellWhenReady(created.session.id, "sample input");
    pty.emitData("$ ");

    const result = await pending;
    expect(result).toMatchObject({ status: "error" });
    if (result.status !== "error") throw new Error("expected an error result");
    expect(formatErrorDetail(result.error)).toBe(
      "Error: failed to write to the shell\nCaused by: Error: write failed\nCaused by: Error: pipe closed",
    );
  });

  test("finishes a pending write as gone when the shell exits first", async () => {
    const created = await createShellSession(process.cwd());
    if (created.status !== "ok") throw new Error("expected a shell session");

    const pending = writeToShellWhenReady(created.session.id, "sample input");
    pty.emitExit(3);

    await expect(pending).resolves.toEqual({ status: "gone" });
    expect(pty.write).not.toHaveBeenCalled();
  });
});

describe("closeShellSession", () => {
  test("returns success after the child exit is observed", async () => {
    const created = await createShellSession(process.cwd());
    if (created.status !== "ok") throw new Error("expected a shell session");
    pty.kill.mockImplementation(() => pty.emitExit(0));

    await expect(closeShellSession(created.session.id)).resolves.toEqual({
      status: "ok",
    });
  });

  test("keeps normal and forced kill failures as separate errors", async () => {
    vi.useFakeTimers();
    try {
      const created = await createShellSession(process.cwd());
      if (created.status !== "ok") throw new Error("expected a shell session");
      pty.kill.mockImplementation((signal?: string) => {
        if (signal === "SIGKILL") {
          throw Object.assign(new Error("forced kill failed"), {
            cause: new Error("forced cleanup cause"),
          });
        }
        throw Object.assign(new Error("normal kill failed"), {
          cause: new Error("normal cleanup cause"),
        });
      });

      const pending = closeShellSession(created.session.id);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await pending;

      expect(result).toMatchObject({ status: "error" });
      if (result.status !== "error")
        throw new Error("expected an error result");
      expect(formatErrorDetail(result.error)).toBe(
        'Error: failed to close the shell\nDetails: {"errors":[{"name":"Error","message":"failed to stop the shell","cause":{"name":"Error","message":"normal kill failed","cause":{"name":"Error","message":"normal cleanup cause"}}},{"name":"Error","message":"failed to force-stop the shell","cause":{"name":"Error","message":"forced kill failed","cause":{"name":"Error","message":"forced cleanup cause"}}}]}',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

// 購読し直したときの流し直しは、前の購読者に渡った分 (replay) と、まだ誰にも
// 渡っていない分 (unseen) に分かれる。渡った分の中の端末への問い合わせには
// そのときの端末が答えているので、答え直すと PTY に文字として入る。渡って
// いない分 (シェルを作ってから購読が始まるまでに出た tmux の問い合わせなど)
// には、まだ誰も答えていない。
describe("subscribeShell replay split", () => {
  test.each([
    {
      name: "output before the first subscriber is unseen for it, and seen for the next",
      before: "q1",
      during: "",
      after: "",
      first: { replay: "", unseen: "q1" },
      next: { replay: "q1", unseen: "" },
    },
    {
      name: "output delivered live is seen",
      before: "",
      during: "x",
      after: "",
      first: { replay: "", unseen: "" },
      next: { replay: "x", unseen: "" },
    },
    {
      name: "output after the subscriber left is unseen",
      before: "",
      during: "",
      after: "q2",
      first: { replay: "", unseen: "" },
      next: { replay: "", unseen: "q2" },
    },
    {
      name: "seen output comes first, then the unseen tail",
      before: "q1",
      during: "x",
      after: "q2",
      first: { replay: "", unseen: "q1" },
      next: { replay: "q1x", unseen: "q2" },
    },
  ])("$name", async ({ before, during, after, first, next }) => {
    const created = await createShellSession(process.cwd());
    if (created.status !== "ok") throw new Error("expected a shell session");
    const id = created.session.id;
    const noop = () => undefined;

    if (before) pty.emitData(before);
    const firstSub = subscribeShell(id, noop, noop);
    if (during) pty.emitData(during);
    firstSub?.unsubscribe();
    if (after) pty.emitData(after);
    const nextSub = subscribeShell(id, noop, noop);

    expect({ replay: firstSub?.replay, unseen: firstSub?.unseen }).toEqual(
      first,
    );
    expect({ replay: nextSub?.replay, unseen: nextSub?.unseen }).toEqual(next);
  });

  test("unseen output larger than the buffer leaves nothing marked as seen", async () => {
    const created = await createShellSession(process.cwd());
    if (created.status !== "ok") throw new Error("expected a shell session");
    const id = created.session.id;
    const noop = () => undefined;
    const firstSub = subscribeShell(id, noop, noop);
    pty.emitData("x");
    firstSub?.unsubscribe();

    pty.emitData("y".repeat(300_000));
    const sub = subscribeShell(id, noop, noop);

    expect(sub?.replay).toBe("");
    expect(sub?.unseen.startsWith("y")).toBe(true);
  });
});
