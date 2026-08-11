import { beforeEach, describe, expect, test, vi } from "vitest";
import { formatErrorDetail } from "../core/error-detail";

const runAsync = vi.hoisted(() => vi.fn());

vi.mock("../server/runtime", () => ({ runAsync }));

import { openDirectoryInOs, openUrlInOs } from "../server/os-opener";

describe("OS opener command selection", () => {
  beforeEach(() => {
    runAsync.mockReset();
    runAsync.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  test.each([
    {
      name: "macOS uses open",
      platform: "darwin" as const,
      release: "sample-kernel",
      path: "/repo/sample",
      expectedArgs: ["open", "--", "/repo/sample"],
      expectedCwd: "/repo/sample",
    },
    {
      name: "Windows uses File Explorer",
      platform: "win32" as const,
      release: "sample-kernel",
      path: "C:\\repo\\sample",
      expectedArgs: ["explorer.exe", "C:\\repo\\sample"],
      expectedCwd: "C:\\repo\\sample",
    },
    {
      name: "Linux uses xdg-open",
      platform: "linux" as const,
      release: "sample-kernel",
      path: "/repo/sample",
      expectedArgs: ["xdg-open", "/repo/sample"],
      expectedCwd: "/repo/sample",
    },
  ])("$name", async ({
    platform,
    release,
    path,
    expectedArgs,
    expectedCwd,
  }) => {
    await openDirectoryInOs(path, platform, release);

    expect(runAsync).toHaveBeenCalledWith(expectedArgs, expectedCwd, {
      timeout: 15_000,
    });
  });

  test("WSL converts the directory and starts it from a Windows working directory", async () => {
    runAsync
      .mockResolvedValueOnce({
        code: 0,
        stdout: "\\\\wsl.localhost\\sample\\repo\\sample\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: "/mnt/c\n",
        stderr: "",
      })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await openDirectoryInOs("/repo/sample", "linux", "5.15.0-standard-WSL2");

    expect(runAsync.mock.calls).toEqual([
      [["wslpath", "-w", "/repo/sample"], "/repo/sample", { timeout: 15_000 }],
      [["wslpath", "-u", "C:\\"], "/repo/sample", { timeout: 15_000 }],
      [
        [
          "cmd.exe",
          "/c",
          "start",
          "",
          "\\\\wsl.localhost\\sample\\repo\\sample",
        ],
        "/mnt/c",
        { timeout: 15_000 },
      ],
    ]);
  });

  test.each([
    {
      name: "macOS uses open",
      platform: "darwin" as const,
      release: "sample-kernel",
      expectedArgs: ["open", "http://127.0.0.1:64160/"],
    },
    {
      name: "Windows uses start",
      platform: "win32" as const,
      release: "sample-kernel",
      expectedArgs: ["cmd.exe", "/c", "start", "", "http://127.0.0.1:64160/"],
    },
    {
      name: "Linux uses xdg-open",
      platform: "linux" as const,
      release: "sample-kernel",
      expectedArgs: ["xdg-open", "http://127.0.0.1:64160/"],
    },
  ])("$name", async ({ platform, release, expectedArgs }) => {
    await openUrlInOs(
      "http://127.0.0.1:64160/",
      "/repo/sample",
      platform,
      release,
    );

    expect(runAsync).toHaveBeenCalledWith(expectedArgs, "/repo/sample", {
      timeout: 15_000,
    });
  });

  test("WSL starts URLs from a Windows working directory", async () => {
    runAsync
      .mockResolvedValueOnce({ code: 0, stdout: "/mnt/c\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await openUrlInOs(
      "http://127.0.0.1:64160/",
      "/repo/sample",
      "linux",
      "5.15.0-standard-WSL2",
    );

    expect(runAsync.mock.calls).toEqual([
      [["wslpath", "-u", "C:\\"], "/repo/sample", { timeout: 15_000 }],
      [
        ["cmd.exe", "/c", "start", "", "http://127.0.0.1:64160/"],
        "/mnt/c",
        { timeout: 15_000 },
      ],
    ]);
  });
});

describe("OS opener fallback and errors", () => {
  beforeEach(() => {
    runAsync.mockReset();
  });

  test("Linux falls back to gio when xdg-open fails", async () => {
    runAsync
      .mockResolvedValueOnce({
        code: 1,
        stdout: "",
        stderr: "spawn xdg-open ENOENT",
      })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await openDirectoryInOs("/repo/sample", "linux", "sample-kernel");

    expect(runAsync.mock.calls).toEqual([
      [["xdg-open", "/repo/sample"], "/repo/sample", { timeout: 15_000 }],
      [["gio", "open", "/repo/sample"], "/repo/sample", { timeout: 15_000 }],
    ]);
  });

  test("keeps every command failure when no opener succeeds", async () => {
    runAsync
      .mockResolvedValueOnce({
        code: 1,
        stdout: "xdg output",
        stderr: "xdg error",
      })
      .mockRejectedValueOnce(new TypeError("gio could not start"));

    const error = await openDirectoryInOs(
      "/repo/sample",
      "linux",
      "sample-kernel",
    ).catch((caught: unknown) => caught);

    expect(formatErrorDetail(error)).toBe(
      'Error: failed to open directory in OS\nDetails: {"errors":[{"name":"Error","message":"xdg-open exited with 1","command":["xdg-open","/repo/sample"],"cwd":"/repo/sample","result":{"code":1,"stdout":"xdg output","stderr":"xdg error"}},{"name":"Error","message":"failed to execute gio","cause":{"name":"TypeError","message":"gio could not start"},"command":["gio","open","/repo/sample"],"cwd":"/repo/sample"}]}',
    );
    expect(
      (error as { errors: Array<{ cause?: unknown }> }).errors[1]?.cause,
    ).toBeInstanceOf(TypeError);
  });

  test("does not hide stderr from a zero-exit opener", async () => {
    runAsync
      .mockResolvedValueOnce({
        code: 0,
        stdout: "",
        stderr: "opener warning",
      })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await openDirectoryInOs("/repo/sample", "linux", "sample-kernel");

    expect(runAsync.mock.calls).toEqual([
      [["xdg-open", "/repo/sample"], "/repo/sample", { timeout: 15_000 }],
      [["gio", "open", "/repo/sample"], "/repo/sample", { timeout: 15_000 }],
    ]);
  });
});
