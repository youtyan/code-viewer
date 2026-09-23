import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { formatErrorDetail } from "../core/error-detail";

const runAsync = vi.hoisted(() => vi.fn());

vi.mock("../server/runtime", () => ({ runAsync }));
vi.mock("../server/command-resolver", () => ({
  commandForExternal: () => "tmux",
  isCommandNotFoundResult: () => false,
}));

import { readTmuxServerGeneration, runTmux } from "../server/tmux/command";

describe("runTmux error details", () => {
  beforeEach(() => {
    runAsync.mockReset();
  });

  test("keeps the exit code, stderr, and stdout", async () => {
    runAsync.mockResolvedValue({
      code: 2,
      stdout: "sample output",
      stderr: "sample error",
    });

    const result = await runTmux(["sample"], "/sample");

    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected an error result");
    expect(formatErrorDetail(result.error)).toBe(
      "Error: tmux exited with 2\nstderr: sample error\nstdout: sample output",
    );
  });

  test("keeps the execution rejection as the cause", async () => {
    runAsync.mockRejectedValue(new TypeError("process launch failed"));

    const result = await runTmux(["sample"], "/sample");

    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected an error result");
    expect(formatErrorDetail(result.error)).toBe(
      "Error: failed to execute tmux\nCaused by: TypeError: process launch failed",
    );
  });
});

describe("tmux server generation", () => {
  beforeEach(() => {
    runAsync.mockReset();
  });

  test("uses the server pid and start time when both are available", async () => {
    runAsync.mockResolvedValue({
      code: 0,
      stdout: `4242${String.fromCharCode(31)}1700000000${String.fromCharCode(31)}/tmp/sample.sock\n`,
      stderr: "",
    });

    await expect(readTmuxServerGeneration("/sample")).resolves.toEqual({
      status: "ok",
      generation: "4242:1700000000",
    });
  });

  test("falls back to the socket inode and ctime when server fields are absent", async () => {
    const root = mkdtempSync(join(tmpdir(), "tmux-generation-"));
    const socket = join(root, "sample.sock");
    try {
      writeFileSync(socket, "sample");
      const stat = statSync(socket);
      runAsync.mockResolvedValue({
        code: 0,
        stdout: `${String.fromCharCode(31)}${String.fromCharCode(31)}${socket}\n`,
        stderr: "",
      });

      await expect(readTmuxServerGeneration("/sample")).resolves.toEqual({
        status: "ok",
        generation: `socket:${stat.ino}:${stat.ctimeMs}`,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
