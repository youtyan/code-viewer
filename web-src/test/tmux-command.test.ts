import { beforeEach, describe, expect, test, vi } from "vitest";
import { formatErrorDetail } from "../core/error-detail";

const runAsync = vi.hoisted(() => vi.fn());

vi.mock("../server/runtime", () => ({ runAsync }));
vi.mock("../server/command-resolver", () => ({
  commandForExternal: () => "tmux",
  isCommandNotFoundResult: () => false,
}));

import { runTmux } from "../server/tmux/command";

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
