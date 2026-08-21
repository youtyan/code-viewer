import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  buildFileSearchList,
  buildRgArgs,
  fixedStringColumn,
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
      {
        path: "src/app.ts",
        line: 1,
        column: 1,
        preview: "Alpha",
        matchText: "Alpha",
      },
      {
        path: "src/app.ts",
        line: 2,
        column: 6,
        preview: "beta alpha",
        matchText: "alpha",
      },
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
      "--json",
      "--line-number",
      "--column",
      "--no-heading",
      "--with-filename",
      "--color",
      "never",
      "--ignore-case",
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
  test.each([
    { name: "a current-directory prefix", inputPath: "./src/sample.ts" },
    { name: "no current-directory prefix", inputPath: "src/sample.ts" },
  ])("parses ripgrep JSON with $name and converts its byte offset", ({
    inputPath,
  }) => {
    const output = `${JSON.stringify({
      type: "match",
      data: {
        path: { text: inputPath },
        lines: { text: "const 日本語 = 1;\n" },
        line_number: 7,
        submatches: [{ match: { text: "日本語" }, start: 6, end: 15 }],
      },
    })}\n`;

    expect(parseRgOutput(output, 10)).toEqual([
      {
        path: "src/sample.ts",
        line: 7,
        column: 7,
        preview: "const 日本語 = 1;",
        matchText: "日本語",
      },
    ]);
  });

  test.each([
    { name: "a current-directory prefix", inputPath: "./src/app.ts" },
    { name: "no current-directory prefix", inputPath: "src/app.ts" },
  ])("parses plain output with $name", ({ inputPath }) => {
    expect(parseRgOutput(`${inputPath}:10:3:const app = true\n`, 10)).toEqual([
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
    writeFileSync(
      join(repo, "sample_file.test.ts"),
      "export const sample = 3;\n",
    );
    writeFileSync(join(repo, ".DS_Store"), "sample\n");
    // Case / word / scope matrix material: one nested directory with a
    // mixed-case token that also appears as a prefix of a longer word.
    mkdirSync(join(repo, "nested", "deep"), { recursive: true });
    writeFileSync(
      join(repo, "nested", "sample_case.ts"),
      "const Token = 1;\nconst tokenizer = 2;\nconst token = 3;\n",
    );
    writeFileSync(join(repo, "nested", "deep", "readme.md"), "Token here\n");
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
      "nested/deep/readme.md",
      "nested/sample_case.ts",
      "other_sample.ts",
      "sample_file.test.ts",
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

  test.each([
    {
      name: "worktree",
      ref: "worktree",
      expected: ["other_sample.ts", "sample_file.ts"],
    },
    {
      name: "committed ref",
      ref: "main",
      expected: ["other_sample.ts", "sample_file.ts"],
    },
  ])("grep excludes test files for $name", async ({ ref, expected }) => {
    const result = await grepRepoAsync(env(), {
      query: "sample",
      ref,
      paths: [],
      regex: false,
      max: 10,
      excludeTests: true,
    });
    if (result.ok !== true) throw new Error(result.error);
    expect(result.value.matches.map((match) => match.path).sort()).toEqual(
      expected,
    );
  });

  test("a test-only path restriction stays empty instead of widening to the repository", async () => {
    const result = await grepRepoAsync(env(), {
      query: "sample",
      ref: "worktree",
      paths: ["sample_file.test.ts"],
      regex: false,
      max: 10,
      excludeTests: true,
    });
    if (result.ok !== true) throw new Error(result.error);
    expect(result.value.matches).toEqual([]);
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

  // The three engines (rg / git grep / fallback) must agree on what
  // "match case" and "whole word" mean, so the same table runs against the
  // worktree (rg or fallback, whichever this machine has) and a committed
  // ref (git grep) and expects identical line sets.
  describe.each([
    { ref: "worktree" },
    { ref: "main" },
  ])("grep case / word options on $ref", ({ ref }) => {
    test.each([
      {
        name: "default: case-insensitive substring",
        caseSensitive: false,
        wholeWord: false,
        expected: [1, 2, 3],
      },
      {
        name: "match case keeps only the capitalised line",
        caseSensitive: true,
        wholeWord: false,
        expected: [1],
      },
      {
        name: "whole word drops the tokenizer line",
        caseSensitive: false,
        wholeWord: true,
        expected: [1, 3],
      },
      {
        name: "match case + whole word",
        caseSensitive: true,
        wholeWord: true,
        expected: [1],
      },
    ])("$name", async ({ caseSensitive, wholeWord, expected }) => {
      const result = await grepRepoAsync(env(), {
        query: "Token",
        ref,
        paths: ["nested/sample_case.ts"],
        regex: false,
        max: 10,
        caseSensitive,
        wholeWord,
      });
      if (result.ok !== true) throw new Error(result.error);
      expect(result.value.matches.map((match) => match.line)).toEqual(expected);
    });

    test.each([
      {
        name: "a directory scope walks into it",
        paths: ["nested"],
        expected: ["nested/deep/readme.md", "nested/sample_case.ts"],
      },
      {
        name: "a glob scope selects by pattern",
        paths: ["*.md"],
        expected: ["nested/deep/readme.md"],
      },
      {
        name: "a deep glob scope",
        paths: ["nested/**/*.ts"],
        expected: ["nested/sample_case.ts"],
      },
    ])("$name", async ({ paths, expected }) => {
      const result = await grepRepoAsync(env(), {
        query: "token",
        ref,
        paths,
        regex: false,
        max: 10,
      });
      if (result.ok !== true) throw new Error(result.error);
      expect(
        [...new Set(result.value.matches.map((match) => match.path))].sort(),
      ).toEqual(expected);
    });
  });
});

describe("fixedStringColumn", () => {
  test.each([
    {
      name: "case-insensitive by default",
      line: "const Token = 1;",
      query: "token",
      options: {},
      expected: 6,
    },
    {
      name: "match case rejects a different casing",
      line: "const token = 1;",
      query: "Token",
      options: { caseSensitive: true },
      expected: -1,
    },
    {
      name: "match case accepts the exact casing",
      line: "const Token = 1;",
      query: "Token",
      options: { caseSensitive: true },
      expected: 6,
    },
    {
      name: "whole word skips a prefix hit and finds a later bounded one",
      line: "tokenizer token",
      query: "token",
      options: { wholeWord: true },
      expected: 10,
    },
    {
      name: "whole word: underscore counts as a word character",
      line: "sample_token",
      query: "token",
      options: { wholeWord: true },
      expected: -1,
    },
    {
      name: "whole word: punctuation is a boundary",
      line: "x.token(",
      query: "token",
      options: { wholeWord: true },
      expected: 2,
    },
    {
      name: "whole word: line start and end are boundaries",
      line: "token",
      query: "token",
      options: { wholeWord: true },
      expected: 0,
    },
    {
      name: "whole word: unicode letters are word characters",
      line: "étoken",
      query: "token",
      options: { wholeWord: true },
      expected: -1,
    },
    {
      name: "empty query never matches",
      line: "anything",
      query: "",
      options: {},
      expected: -1,
    },
  ])("$name", ({ line, query, options, expected }) => {
    expect(fixedStringColumn(line, query, options)).toBe(expected);
  });
});

describe("buildRgArgs options", () => {
  test.each([
    {
      name: "default is case-insensitive without word matching",
      options: {},
      present: ["--ignore-case"],
      absent: ["--case-sensitive", "--word-regexp", "--smart-case"],
    },
    {
      name: "match case",
      options: { caseSensitive: true },
      present: ["--case-sensitive"],
      absent: ["--ignore-case", "--word-regexp"],
    },
    {
      name: "whole word",
      options: { wholeWord: true },
      present: ["--ignore-case", "--word-regexp"],
      absent: ["--case-sensitive"],
    },
  ])("$name", ({ options, present, absent }) => {
    const args = buildRgArgs("needle", 20, [], false, [], [], false, options);
    for (const flag of present) expect(args).toContain(flag);
    for (const flag of absent) expect(args).not.toContain(flag);
  });

  test("path globs become include globs while plain paths stay positional", () => {
    const args = buildRgArgs("needle", 20, ["src"], false, [], [], false, {
      pathGlobs: ["*.md", "lib/**/*.ts"],
    });
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["src"]);
    const globIndex = args.indexOf("--glob");
    expect(args.slice(globIndex, globIndex + 4)).toEqual([
      "--glob",
      "*.md",
      "--glob",
      "lib/**/*.ts",
    ]);
  });
});
