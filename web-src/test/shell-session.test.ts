import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatErrorDetail } from "../core/error-detail";

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

describe("createShellSession PTY terminal resolution", () => {
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
