import { describe, expect, test, vi } from "vitest";
import {
  createProcessShutdown,
  reportFatalAndShutdown,
} from "../server/shutdown";
import {
  applySseClientOperation,
  type SseClientOperation,
} from "../server/sse-clients";

describe("server shutdown", () => {
  test("runs every cleanup step, reports complete errors, and returns exit code 1", async () => {
    const syncFailure = new Error("sample synchronous cleanup failure");
    const asyncFailure = new Error("sample asynchronous cleanup failure");
    const calls: string[] = [];
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const exits: number[] = [];
      const shutdown = createProcessShutdown(
        [
          {
            label: "code-viewer agent watch stop",
            run: () => {
              calls.push("first");
              throw syncFailure;
            },
          },
          {
            label: "code-viewer server close",
            run: async () => {
              calls.push("second");
              throw asyncFailure;
            },
          },
          {
            label: "last cleanup",
            run: () => {
              calls.push("last");
            },
          },
        ],
        (code) => exits.push(code),
      );
      await shutdown.run(0);

      expect(exits).toEqual([1]);
      expect(shutdown.started()).toBe(true);
      expect(calls).toEqual(["first", "second", "last"]);
      expect(logged.mock.calls).toEqual([
        ["code-viewer agent watch stop failed:", syncFailure],
        ["code-viewer server close failed:", asyncFailure],
      ]);
      expect(syncFailure.stack).toContain("sample synchronous cleanup failure");
      expect(asyncFailure.stack).toContain(
        "sample asynchronous cleanup failure",
      );
    } finally {
      logged.mockRestore();
    }
  });

  test("a fatal process error is printed intact and requests shutdown with exit code 1", () => {
    const failure = new Error("sample fatal failure");
    const shutdown = vi.fn<(exitCode: number) => Promise<void>>(
      async () => undefined,
    );
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      reportFatalAndShutdown("uncaught exception", failure, shutdown);

      expect(logged).toHaveBeenCalledWith(
        "[code-viewer] uncaught exception:",
        failure,
      );
      expect(shutdown).toHaveBeenCalledWith(1);
    } finally {
      logged.mockRestore();
    }
  });
});

describe("SSE client failures", () => {
  test.each<{
    name: string;
    operation: SseClientOperation;
    failure: Error & { code?: string };
    expectedLog: string;
    rejects: boolean;
  }>([
    {
      name: "EPIPE while sending is an expected disconnect",
      operation: "send",
      failure: Object.assign(new Error("sample broken pipe"), {
        code: "EPIPE",
      }),
      expectedLog: "[code-viewer] SSE client disconnected during send:",
      rejects: false,
    },
    {
      name: "a closed controller during heartbeat is an expected disconnect",
      operation: "heartbeat",
      failure: Object.assign(
        new Error("Invalid state: Controller is already closed"),
        {
          code: "ERR_INVALID_STATE",
        },
      ),
      expectedLog: "[code-viewer] SSE client disconnected during heartbeat:",
      rejects: false,
    },
    {
      name: "an unknown close failure is returned after every client is handled",
      operation: "close",
      failure: new Error("sample unknown close failure"),
      expectedLog: "[code-viewer] SSE client close failed:",
      rejects: true,
    },
  ])("$name", ({ operation, failure, expectedLog, rejects }) => {
    const clients = ["failed", "healthy"];
    const removed: string[] = [];
    const handled: string[] = [];
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const run = () =>
        applySseClientOperation(
          clients,
          operation,
          (client) => removed.push(client),
          (client) => {
            handled.push(client);
            if (client === "failed") throw failure;
          },
        );

      if (rejects)
        expect(run).toThrow(expect.objectContaining({ errors: [failure] }));
      else expect(run).not.toThrow();
      expect(handled).toEqual(["failed", "healthy"]);
      expect(removed).toEqual(["failed"]);
      expect(logged).toHaveBeenCalledWith(expectedLog, failure);
    } finally {
      logged.mockRestore();
    }
  });
});
