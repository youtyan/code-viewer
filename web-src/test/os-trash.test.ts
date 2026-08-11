import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatErrorDetail } from "../core/error-detail";

const runAsync = vi.hoisted(() => vi.fn());

vi.mock("../server/runtime", () => ({ runAsync }));

import { movePathToTrash, restorePathFromTrash } from "../server/os-trash";

const tempRoots: string[] = [];

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "code-viewer-os-trash-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("OS trash", () => {
  beforeEach(() => {
    runAsync.mockReset();
  });

  test("WSL moves a path into the repository-managed trash and restores it", async () => {
    const repo = makeRepo();
    const original = join(repo, "sample.txt");
    writeFileSync(original, "sample");

    const moved = await movePathToTrash(
      original,
      repo,
      "linux",
      "5.15.0-standard-WSL2",
    );

    expect(existsSync(original)).toBe(false);
    expect(moved.trashPath).toMatch(
      new RegExp(
        `^${join(repo, ".code-viewer", "trash").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
    expect(existsSync(moved.trashPath ?? "")).toBe(true);

    await restorePathFromTrash(
      original,
      moved.trashPath,
      repo,
      "linux",
      "5.15.0-standard-WSL2",
    );

    expect(readFileSync(original, "utf8")).toBe("sample");
    expect(existsSync(moved.trashPath ?? "")).toBe(false);
  });

  test("WSL rejects a trash handle outside the managed trash directory", async () => {
    const repo = makeRepo();
    const outside = join(repo, "outside.txt");
    writeFileSync(outside, "outside");

    const error = await restorePathFromTrash(
      join(repo, "restored.txt"),
      outside,
      repo,
      "linux",
      "5.15.0-standard-WSL2",
    ).catch((caught: unknown) => caught);

    expect(formatErrorDetail(error)).toBe("Error: invalid trash handle");
    expect(readFileSync(outside, "utf8")).toBe("outside");
  });

  test("native Windows delegates to the Recycle Bin command", async () => {
    const repo = makeRepo();
    const original = join(repo, "sample.txt");
    writeFileSync(original, "sample");
    runAsync.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    await movePathToTrash(original, repo, "win32", "sample-kernel");

    expect(runAsync).toHaveBeenCalledOnce();
    expect(runAsync.mock.calls[0]?.[0]).toMatchObject([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      expect.stringContaining(original.replace(/'/g, "''")),
    ]);
    expect(runAsync.mock.calls[0]?.[1]).toBe(repo);
    expect(runAsync.mock.calls[0]?.[2]).toEqual({ timeout: 60_000 });
  });

  test("keeps the complete Windows command failure", async () => {
    const repo = makeRepo();
    const original = join(repo, "sample.txt");
    writeFileSync(original, "sample");
    runAsync.mockResolvedValue({
      code: 7,
      stdout: "command output",
      stderr: "command error",
    });

    const error = await movePathToTrash(
      original,
      repo,
      "win32",
      "sample-kernel",
    ).catch((caught: unknown) => caught);

    expect(formatErrorDetail(error)).toContain(
      '"result":{"code":7,"stdout":"command output","stderr":"command error"}',
    );
  });

  test("ordinary Linux reports unsupported trash without moving the path", async () => {
    const repo = makeRepo();
    const original = join(repo, "sample.txt");
    mkdirSync(original);

    const error = await movePathToTrash(
      original,
      repo,
      "linux",
      "sample-kernel",
    ).catch((caught: unknown) => caught);

    expect(formatErrorDetail(error)).toBe(
      'Error: trash unsupported\nDetails: {"platform":"linux","release":"sample-kernel"}',
    );
    expect(existsSync(original)).toBe(true);
  });
});
