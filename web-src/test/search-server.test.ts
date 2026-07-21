import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFileSearchList,
  buildRgArgs,
  fixedStringLineMatches,
  GREP_ABSOLUTE_MAX,
  GREP_DEFAULT_MAX,
  isSkippableSearchPath,
  normalizeGrepMax,
  parseGitGrepOutput,
  parseRgOutput,
} from "../server/search";
import {
  grepRepoAsync,
  isExcludedScopePath,
  listRepoFilesAsync,
  safeWorktreePath,
} from "../server/search-service";
import { runGit as git } from "./_git-fixture";

describe("normalizeGrepMax", () => {
  test("defaults and clamps grep result limits", () => {
    expect(normalizeGrepMax(null)).toBe(GREP_DEFAULT_MAX);
    expect(normalizeGrepMax("0")).toBe(GREP_DEFAULT_MAX);
    expect(normalizeGrepMax("20")).toBe(20);
    expect(normalizeGrepMax("9999")).toBe(GREP_ABSOLUTE_MAX);
  });
});

describe("fixedStringLineMatches", () => {
  test("matches text case-insensitively with line and column", () => {
    const matches = fixedStringLineMatches(
      "src/app.ts",
      "Alpha\nbeta alpha\n",
      "ALPHA",
      10,
    );
    expect(matches).toEqual([
      { path: "src/app.ts", line: 1, column: 1, preview: "Alpha" },
      { path: "src/app.ts", line: 2, column: 6, preview: "beta alpha" },
    ]);
  });

  test("respects max results", () => {
    const matches = fixedStringLineMatches("a.txt", "x\nx\nx\n", "x", 2);
    expect(matches.length).toBe(2);
  });
});

describe("search path filtering", () => {
  test("skips paths that should not be searched by fallback grep", () => {
    expect(isSkippableSearchPath(".git/config")).toBe(true);
    expect(isSkippableSearchPath("node_modules/pkg/index.js")).toBe(false);
    expect(
      isSkippableSearchPath("node_modules/pkg/index.js", ["node_modules"]),
    ).toBe(true);
    expect(isSkippableSearchPath("dist/app.js", ["dist"])).toBe(true);
    expect(isSkippableSearchPath("node_modules/pkg/index.js", ["dist"])).toBe(
      false,
    );
    expect(isSkippableSearchPath("audio/sample.wav", ["dist"])).toBe(false);
    expect(isSkippableSearchPath(".DS_Store", [], [".DS_Store"])).toBe(true);
    expect(isSkippableSearchPath("src/.DS_Store", [], [".DS_Store"])).toBe(
      true,
    );
    expect(isSkippableSearchPath("src/app.ts")).toBe(false);
  });

  test("always skips the tool-internal .code-viewer directory", () => {
    expect(isSkippableSearchPath(".code-viewer/annotations.json")).toBe(true);
    expect(isSkippableSearchPath("docs/.code-viewer/notes.md")).toBe(true);
    expect(isSkippableSearchPath("src/code-viewer.ts")).toBe(false);
  });

  test.each([
    {
      name: "* が excludeNames のファイル名にマッチする",
      path: "src/app.log",
      omitDirNames: [],
      excludeNames: ["*.log"],
      expected: true,
    },
    {
      name: "* が拡張子違いには非マッチ",
      path: "src/app.ts",
      omitDirNames: [],
      excludeNames: ["*.log"],
      expected: false,
    },
    {
      name: "* が omitDirNames のディレクトリ名にマッチする",
      path: "test-cache/x.txt",
      omitDirNames: ["test-*"],
      excludeNames: [],
      expected: true,
    },
    {
      name: "* が前方一致しないディレクトリ名には非マッチ",
      path: "cache-test/x.txt",
      omitDirNames: ["test-*"],
      excludeNames: [],
      expected: false,
    },
    {
      name: "? は1文字にマッチする",
      path: "a1.log",
      omitDirNames: [],
      excludeNames: ["a?.log"],
      expected: true,
    },
    {
      name: "? は2文字には非マッチ",
      path: "a12.log",
      omitDirNames: [],
      excludeNames: ["a?.log"],
      expected: false,
    },
    {
      name: "[abc] は文字クラス内にマッチする",
      path: "log-a.txt",
      omitDirNames: [],
      excludeNames: ["log-[abc].txt"],
      expected: true,
    },
    {
      name: "[abc] は文字クラス外には非マッチ",
      path: "log-z.txt",
      omitDirNames: [],
      excludeNames: ["log-[abc].txt"],
      expected: false,
    },
    {
      name: "[!abc] は否定文字クラスにマッチする",
      path: "log-z.txt",
      omitDirNames: [],
      excludeNames: ["log-[!abc].txt"],
      expected: true,
    },
    {
      name: "[!abc] は否定対象文字には非マッチ",
      path: "log-a.txt",
      omitDirNames: [],
      excludeNames: ["log-[!abc].txt"],
      expected: false,
    },
  ])("$name", ({ path, omitDirNames, excludeNames, expected }) => {
    expect(isSkippableSearchPath(path, omitDirNames, excludeNames)).toBe(
      expected,
    );
  });
});

describe("isExcludedScopePath", () => {
  test.each([
    {
      name: "ルート直下でリテラル一致",
      path: ".DS_Store",
      excludeNames: [".DS_Store"],
      expected: true,
    },
    {
      name: "ネストした階層でリテラル一致",
      path: "src/.DS_Store",
      excludeNames: [".DS_Store"],
      expected: true,
    },
    {
      name: "* がネストしたファイル名にマッチする",
      path: "src/debug.log",
      excludeNames: ["*.log"],
      expected: true,
    },
    {
      name: "* が拡張子違いには非マッチ",
      path: "src/debug.ts",
      excludeNames: ["*.log"],
      expected: false,
    },
    {
      name: "文字クラスがファイル名にマッチする",
      path: "logs/x1.txt",
      excludeNames: ["x[0-9].txt"],
      expected: true,
    },
    {
      name: "一致するパターンが無ければ非除外",
      path: "src/app.ts",
      excludeNames: [],
      expected: false,
    },
  ])("$name", ({ path, excludeNames, expected }) => {
    expect(isExcludedScopePath(path, excludeNames)).toBe(expected);
  });
});

describe("buildFileSearchList", () => {
  test("keeps only searchable file entries", () => {
    const response = buildFileSearchList("worktree", 7, [
      { name: "src", path: "src", type: "tree" },
      { name: "app.ts", path: "src/app.ts", type: "blob" },
      { name: "submodule", path: "vendor/submodule", type: "commit" },
    ]);

    expect(response).toEqual({
      ref: "worktree",
      generation: 7,
      truncated: false,
      files: [
        { path: "src/app.ts", type: "blob" },
        { path: "vendor/submodule", type: "commit" },
      ],
    });
  });
});

describe("buildRgArgs", () => {
  test("passes query via -e before path arguments", () => {
    expect(buildRgArgs("needle", 20, ["src/app.ts"])).toEqual([
      "rg",
      "--no-config",
      "--line-number",
      "--column",
      "--no-heading",
      "--with-filename",
      "--color",
      "never",
      "--smart-case",
      "--fixed-strings",
      "--max-count",
      "20",
      "--max-filesize",
      "2M",
      "-e",
      "needle",
      "--",
      "src/app.ts",
    ]);
  });

  test("searches the current repository explicitly when no paths are supplied", () => {
    expect(buildRgArgs("needle", 20, []).slice(-2)).toEqual(["--", "."]);
  });

  test("passes repository scope omissions to ripgrep", () => {
    const args = buildRgArgs("needle", 20, [], false, ["dist"]);
    expect(args.includes("!dist/**")).toBe(true);
    expect(args.includes("!**/dist/**")).toBe(true);
  });

  test("omits fixed-string mode for explicit regex grep", () => {
    const args = buildRgArgs("use[A-Z]", 20, ["src/app.ts"], true);
    expect(args.includes("--fixed-strings")).toBe(false);
    expect(args.includes("-e")).toBe(true);
  });
});

describe("grep output parsers", () => {
  test("parses ripgrep output path line column preview", () => {
    expect(parseRgOutput("src/app.ts:10:3:const app = true\n", 10)).toEqual([
      { path: "src/app.ts", line: 10, column: 3, preview: "const app = true" },
    ]);
  });

  test("parses git grep tree output without keeping ref in path", () => {
    expect(
      parseGitGrepOutput("main:src/app.ts:10:3:const app = true\n", "main", 10),
    ).toEqual([
      { path: "src/app.ts", line: 10, column: 3, preview: "const app = true" },
    ]);
  });

  test("keeps colons inside paths when parsing grep output", () => {
    expect(parseRgOutput("src/a:b.ts:10:3:const app = true\n", 10)).toEqual([
      { path: "src/a:b.ts", line: 10, column: 3, preview: "const app = true" },
    ]);
  });

  test("keeps location-like text inside grep previews", () => {
    expect(
      parseRgOutput("src/app.ts:10:3:see nested :5:3: marker\n", 10),
    ).toEqual([
      {
        path: "src/app.ts",
        line: 10,
        column: 3,
        preview: "see nested :5:3: marker",
      },
    ]);
  });

  test("stops parsing after the requested maximum result count", () => {
    const output = [
      "src/a.ts:1:1:match a",
      "src/b.ts:2:1:match b",
      "src/c.ts:3:1:match c",
    ].join("\n");

    expect(parseRgOutput(output, 2)).toEqual([
      { path: "src/a.ts", line: 1, column: 1, preview: "match a" },
      { path: "src/b.ts", line: 2, column: 1, preview: "match b" },
    ]);
  });
});

describe("search-service shared behavior", () => {
  let repo: string;
  const env = () => ({
    cwd: repo,
    omitDirNames: [],
    excludeNames: [".DS_Store"],
  });

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-search-service-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "sample-author"]);
    git(repo, ["config", "user.name", "sample-author"]);
    writeFileSync(join(repo, "sample_file.ts"), "export const sample = 1;\n");
    writeFileSync(join(repo, "other_sample.ts"), "export const sample = 2;\n");
    writeFileSync(join(repo, ".DS_Store"), "sample\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "sample initial commit"]);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("listRepoFilesAsync returns searchable worktree files with generation", async () => {
    const result = await listRepoFilesAsync(env(), "worktree", 7);
    if (result.ok !== true) throw new Error(result.error);
    expect(result.value.ref).toBe("worktree");
    expect(result.value.generation).toBe(7);
    expect(result.value.files.map((file) => file.path).sort()).toEqual([
      "other_sample.ts",
      "sample_file.ts",
    ]);
  });

  test("grepRepoAsync honors a single paths[] filter in worktree search", async () => {
    const result = await grepRepoAsync(env(), {
      query: "sample",
      ref: "worktree",
      paths: ["sample_file.ts"],
      regex: false,
      max: 10,
    });
    if (result.ok !== true) throw new Error(result.error);
    expect(result.value.ref).toBe("worktree");
    expect(result.value.matches.map((match) => match.path)).toEqual([
      "sample_file.ts",
    ]);
  });

  test("safeWorktreePath rejects git internals and accepts normal files", () => {
    expect(safeWorktreePath(env(), ".git/config")).toBeNull();
    expect(safeWorktreePath(env(), "sample_file.ts")).toBe(
      realpathSync(join(repo, "sample_file.ts")),
    );
  });

  test("grepRepoAsync rejects unknown committed refs", async () => {
    const result = await grepRepoAsync(env(), {
      query: "sample",
      ref: "missing-ref",
      paths: [],
      regex: false,
      max: 10,
    });
    expect(result).toEqual({
      ok: false,
      error: "fatal: Needed a single revision",
      status: undefined,
    });
  });
});
