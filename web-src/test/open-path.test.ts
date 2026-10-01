import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { defaultKeyBindings, resolveKeyOutcome } from "../core/keymap";
import { isGitInternalPath } from "../server/git";
import { safeWorktreePath } from "../server/search-service";
import { runGit as git } from "./_git-fixture";

describe("open path in OS action", () => {
  test("server forbids browsing Git internal tree paths", () => {
    // Behaviour-level guard: git.ts exports isGitInternalPath and preview.ts
    // uses it both at /_open_path entry and inside safeWorktreePath. The
    // predicate must return true for `.git/*` paths and false for normal
    // worktree paths. UI/Test Discipline: don't grep for the implementation
    // string — assert the contract on the actual function.
    expect(isGitInternalPath(".git/config")).toBe(true);
    expect(isGitInternalPath("nested/.git/HEAD")).toBe(true);
    expect(isGitInternalPath("src/sample.ts")).toBe(false);
    const repo = mkdtempSync(join(tmpdir(), "code-viewer-open-path-safe-"));
    try {
      git(repo, ["init", "-b", "main"]);
      writeFileSync(join(repo, "sample_file.ts"), "sample\n");
      const env = { cwd: repo, omitDirNames: [], excludeNames: [] };
      expect(safeWorktreePath(env, ".git/config")).toBeNull();
      expect(safeWorktreePath(env, "sample_file.ts")).toBe(
        realpathSync(join(repo, "sample_file.ts")),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("search palette shortcuts", () => {
  // 押したキーの行き先はソースの文字ではなく、app の keydown と同じ解決
  // (resolveKeyOutcome) で見る。Ctrl+K / Ctrl+G は入力欄の中 (ファイルの絞り込み)
  // からも開き、/ は入力欄の外だけ。
  test.each([
    {
      name: "Ctrl+K in the file filter",
      key: "k",
      ctrl: true,
      editable: true,
      action: "open-file-palette",
    },
    {
      name: "Ctrl+G in the file filter",
      key: "g",
      ctrl: true,
      editable: true,
      action: "open-grep-palette",
    },
    {
      name: "/ outside a text field",
      key: "/",
      ctrl: false,
      editable: false,
      action: "focus-file-filter",
    },
    {
      name: "/ inside a text field",
      key: "/",
      ctrl: false,
      editable: true,
      action: null,
    },
  ])("$name resolves to $action", ({ key, ctrl, editable, action }) => {
    expect(
      resolveKeyOutcome(
        { key, ctrlKey: ctrl },
        { scope: "sidebar", editable, mac: false },
        defaultKeyBindings(false),
      ),
    ).toEqual(action ? { kind: "run", action } : null);
  });
});
