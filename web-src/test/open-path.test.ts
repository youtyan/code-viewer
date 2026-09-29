import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { defaultKeyBindings, resolveKeyOutcome } from "../core/keymap";
import { isGitInternalPath } from "../server/git";
import { safeWorktreePath } from "../server/search-service";
import { runGit as git } from "./_git-fixture";
import { sourceFixture } from "./source-fixture";

const server = sourceFixture(readFileSync("web-src/server/preview.ts", "utf8"));

describe("open path in OS action", () => {
  test("server exposes a localhost-only POST endpoint with bounded JSON input", () => {
    expect(
      server.includes(
        'if (url.pathname === "/_open_path") return handleOpenPath(req)',
      ),
    ).toBe(true);
    expect(
      server.includes(
        "if (req.method !== 'POST') return text('method not allowed', 405)",
      ),
    ).toBe(true);
    expect(
      server.includes("function sideEffectRequestAllowed(req: Request)"),
    ).toBe(true);
    expect(
      server.includes(
        "if (!sideEffectRequestAllowed(req)) return text('forbidden', 403)",
      ),
    ).toBe(true);
    expect(server.includes("return text('unsupported media type', 415)")).toBe(
      true,
    );
    expect(
      server.includes(
        'if (length > 1024) return text("payload too large", 413)',
      ),
    ).toBe(true);
    expect(
      server.includes('if (kind !== "directory" && kind !== "file-parent")'),
    ).toBe(true);
    expect(server.includes('return text("invalid kind", 400)')).toBe(true);
    expect(
      server.includes(
        'if (kind === "file-parent" && !path) return text("invalid path", 400)',
      ),
    ).toBe(true);
  });

  test("server validates repo-relative paths before opening the directory", () => {
    expect(
      server.includes(
        "function safeOpenWorktreePath(path: string): string | null",
      ),
    ).toBe(true);
  });

  test("server forbids browsing Git internal tree paths", () => {
    // Behaviour-level guard: git.ts exports isGitInternalPath and preview.ts
    // uses it both at /_open_path entry and inside safeWorktreePath. The
    // predicate must return true for `.git/*` paths and false for normal
    // worktree paths. UI/Test Discipline: don't grep for the implementation
    // string — assert the contract on the actual function.
    expect(isGitInternalPath(".git/config")).toBe(true);
    expect(isGitInternalPath("nested/.git/HEAD")).toBe(true);
    expect(isGitInternalPath("src/sample.ts")).toBe(false);
    expect(
      server.includes(
        "if ((target === 'worktree' || target === '') && git.isGitInternalPath(path)) return text('forbidden', 403)",
      ),
    ).toBe(true);
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

describe("state changing refresh endpoint", () => {
  test("refresh uses the same side-effect request gate as upload and open path", () => {
    expect(
      server.includes(
        'if (url.pathname === "/refresh" && req.method === "POST")',
      ),
    ).toBe(true);
    expect(
      server.includes(
        'if (!sideEffectRequestAllowed(req)) return text("forbidden", 403);\n      triggerUpdate();',
      ),
    ).toBe(true);
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
