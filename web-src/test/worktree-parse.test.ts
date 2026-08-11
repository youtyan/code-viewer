// `git worktree list --porcelain -z` の読み取りと、追加フォームが受け付ける名前の
// 判定。どちらも git を呼ばない純粋な変換なので、ここだけで書式の取り違えを
// 検出できる。
//
// 入力は git 2.55 の実出力から写した (detached / locked <reason> / prunable
// <reason> は、実際にその状態を作って確かめた形)。

import { describe, expect, test } from "vitest";
import type { WorktreeFileChange } from "../core/worktree";
import {
  findWorktree,
  findWorktreeOverlaps,
  parseAheadBehind,
  parseMergeTreeConflicts,
  parseWorktreeList,
  worktreeBranchError,
  worktreeNameError,
} from "../core/worktree";

/** 生の制御文字はソースに直書きしない (server.md)。 */
const CONTROL_CHAR = String.fromCharCode(1);
const NUL = String.fromCharCode(0);

describe("parseWorktreeList", () => {
  test.each([
    {
      name: "reads a checked-out worktree",
      input: "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n",
      expected: [
        {
          path: "/repo",
          head: "abc123",
          branch: "main",
          detached: false,
          bare: false,
          locked: false,
          lockedReason: "",
          prunable: false,
          prunableReason: "",
        },
      ],
    },
    {
      name: "reads a detached worktree",
      input: "worktree /repo/.worktrees/det\nHEAD abc123\ndetached\n",
      expected: [
        {
          path: "/repo/.worktrees/det",
          head: "abc123",
          branch: "",
          detached: true,
          bare: false,
          locked: false,
          lockedReason: "",
          prunable: false,
          prunableReason: "",
        },
      ],
    },
    {
      name: "reads a bare repository, which has no HEAD or branch line",
      input: "worktree /repo.git\nbare\n",
      expected: [
        {
          path: "/repo.git",
          head: "",
          branch: "",
          detached: false,
          bare: true,
          locked: false,
          lockedReason: "",
          prunable: false,
          prunableReason: "",
        },
      ],
    },
    {
      name: "keeps the reason attached to locked",
      input:
        "worktree /repo/a\nHEAD abc123\nbranch refs/heads/a\nlocked in use by agent\n",
      expected: [
        {
          path: "/repo/a",
          head: "abc123",
          branch: "a",
          detached: false,
          bare: false,
          locked: true,
          lockedReason: "in use by agent",
          prunable: false,
          prunableReason: "",
        },
      ],
    },
    {
      name: "reads locked without a reason",
      input: "worktree /repo/a\nHEAD abc123\nbranch refs/heads/a\nlocked\n",
      expected: [
        {
          path: "/repo/a",
          head: "abc123",
          branch: "a",
          detached: false,
          bare: false,
          locked: true,
          lockedReason: "",
          prunable: false,
          prunableReason: "",
        },
      ],
    },
    {
      name: "keeps the reason attached to prunable",
      input:
        "worktree /repo/gone\nHEAD abc123\ndetached\nprunable gitdir file points to non-existent location\n",
      expected: [
        {
          path: "/repo/gone",
          head: "abc123",
          branch: "",
          detached: true,
          bare: false,
          locked: false,
          lockedReason: "",
          prunable: true,
          prunableReason: "gitdir file points to non-existent location",
        },
      ],
    },
    {
      name: "keeps a slash-bearing branch name whole",
      input: "worktree /repo\nHEAD abc123\nbranch refs/heads/feature/x\n",
      expected: [
        {
          path: "/repo",
          head: "abc123",
          branch: "feature/x",
          detached: false,
          bare: false,
          locked: false,
          lockedReason: "",
          prunable: false,
          prunableReason: "",
        },
      ],
    },
    {
      name: "starts a new entry on every worktree line, without a trailing blank line",
      input:
        "worktree /repo\nHEAD aaa\nbranch refs/heads/main\n\nworktree /repo/b\nHEAD bbb\nbranch refs/heads/b",
      expected: [
        {
          path: "/repo",
          head: "aaa",
          branch: "main",
          detached: false,
          bare: false,
          locked: false,
          lockedReason: "",
          prunable: false,
          prunableReason: "",
        },
        {
          path: "/repo/b",
          head: "bbb",
          branch: "b",
          detached: false,
          bare: false,
          locked: false,
          lockedReason: "",
          prunable: false,
          prunableReason: "",
        },
      ],
    },
    {
      name: "tolerates CRLF line endings",
      input: "worktree /repo\r\nHEAD abc123\r\nbranch refs/heads/main\r\n",
      expected: [
        {
          path: "/repo",
          head: "abc123",
          branch: "main",
          detached: false,
          bare: false,
          locked: false,
          lockedReason: "",
          prunable: false,
          prunableReason: "",
        },
      ],
    },
    { name: "returns nothing for empty output", input: "", expected: [] },
    {
      name: "ignores attribute lines that appear before any worktree line",
      input: "HEAD abc123\nbranch refs/heads/main\n",
      expected: [],
    },
  ])("$name", ({ input, expected }) => {
    expect(parseWorktreeList(input)).toEqual(expected);
  });

  test("keeps newlines and carriage returns in a NUL-delimited worktree path", () => {
    const path = "/repo/worktree\nwith\rcarriage";
    const input = [
      `worktree ${path}`,
      "HEAD abc123",
      "branch refs/heads/feature/x",
      "",
    ].join(NUL);

    expect(parseWorktreeList(input)).toEqual([
      {
        path,
        head: "abc123",
        branch: "feature/x",
        detached: false,
        bare: false,
        locked: false,
        lockedReason: "",
        prunable: false,
        prunableReason: "",
      },
    ]);
  });
});

describe("findWorktree", () => {
  const worktrees = [{ path: "/repo" }, { path: "/repo/.worktrees/a" }];

  test.each([
    { name: "finds an exact path", input: "/repo/.worktrees/a", found: true },
    { name: "misses an unlisted path", input: "/elsewhere", found: false },
    {
      name: "does not match a prefix of a listed path",
      input: "/repo/.worktrees",
      found: false,
    },
    { name: "misses an empty path", input: "", found: false },
  ])("$name", ({ input, found }) => {
    expect(findWorktree(worktrees, input)).toEqual(
      found ? { path: input } : null,
    );
  });
});

describe("worktreeNameError", () => {
  test.each([
    { name: "accepts a plain name", input: "feature-x", expected: null },
    {
      name: "accepts a name of 100 characters",
      input: "a".repeat(100),
      expected: null,
    },
    {
      name: "rejects 101 characters",
      input: "a".repeat(101),
      expected: "too-long",
    },
    { name: "rejects an empty name", input: "", expected: "empty" },
    {
      name: "rejects a control character",
      input: `a${CONTROL_CHAR}b`,
      expected: "control",
    },
    { name: "rejects a forward slash", input: "a/b", expected: "separator" },
    { name: "rejects a backslash", input: "a\\b", expected: "separator" },
    { name: "rejects the current directory", input: ".", expected: "relative" },
    { name: "rejects the parent directory", input: "..", expected: "relative" },
    {
      name: "rejects a dotfile name",
      input: ".hidden",
      expected: "leading-dot",
    },
  ])("$name", ({ input, expected }) => {
    expect(worktreeNameError(input)).toBe(expected);
  });
});

describe("parseAheadBehind", () => {
  test.each([
    // `--left-right --count base...branch` は「base 側の数」「branch 側の数」。
    {
      name: "reads behind then ahead",
      input: "1\t3\n",
      expected: { behind: 1, ahead: 3 },
    },
    { name: "reads zeros", input: "0\t0\n", expected: { behind: 0, ahead: 0 } },
    {
      name: "tolerates spaces instead of a tab",
      input: "2 5",
      expected: { behind: 2, ahead: 5 },
    },
    { name: "rejects a single number", input: "3\n", expected: null },
    { name: "rejects empty output", input: "", expected: null },
    { name: "rejects a non-numeric field", input: "a\tb\n", expected: null },
    { name: "rejects a negative count", input: "-1\t2\n", expected: null },
    { name: "rejects a fractional count", input: "1.5\t2\n", expected: null },
  ])("$name", ({ input, expected }) => {
    expect(parseAheadBehind(input)).toEqual(expected);
  });
});

describe("parseMergeTreeConflicts", () => {
  test.each([
    {
      // git 2.55 の実出力。1 行目は書き出された tree、空行より後は人向け。
      name: "reads the paths between the tree oid and the blank line",
      input:
        "1ad260a78ec777f5d27505e419d08ab7981ba368\na.txt\n\nAuto-merging a.txt\nCONFLICT (content): Merge conflict in a.txt\n",
      expected: ["a.txt"],
    },
    {
      name: "reads several conflicting paths",
      input: "abc123\nsrc/a.ts\nsrc/b.ts\n\nCONFLICT (content): ...\n",
      expected: ["src/a.ts", "src/b.ts"],
    },
    {
      name: "returns nothing for a clean merge, which prints only the tree",
      input: "0d8a474fc67971fb3dd7616e26323d3066442555\n",
      expected: [],
    },
    { name: "returns nothing for empty output", input: "", expected: [] },
  ])("$name", ({ input, expected }) => {
    expect(parseMergeTreeConflicts(input)).toEqual(expected);
  });
});

describe("findWorktreeOverlaps", () => {
  function change(
    path: string,
    origin: WorktreeFileChange["origin"] = "uncommitted",
  ): WorktreeFileChange {
    return { path, status: "M", additions: 1, deletions: 0, origin };
  }

  test("names every worktree touching the same file", () => {
    expect(
      findWorktreeOverlaps([
        { id: "/repo/a", files: [change("src/shared.ts"), change("src/a.ts")] },
        { id: "/repo/b", files: [change("src/shared.ts")] },
        { id: "/repo/c", files: [change("src/shared.ts"), change("src/c.ts")] },
      ]),
    ).toEqual([
      {
        path: "src/shared.ts",
        worktreeIds: ["/repo/a", "/repo/b", "/repo/c"],
      },
    ]);
  });

  test("ignores a file only one worktree touches", () => {
    expect(
      findWorktreeOverlaps([
        { id: "/repo/a", files: [change("src/a.ts")] },
        { id: "/repo/b", files: [change("src/b.ts")] },
      ]),
    ).toEqual([]);
  });

  test("counts a worktree once even when it has the file twice", () => {
    // 同じファイルが未コミットと分岐後コミットの両方に出るのは普通のこと。
    expect(
      findWorktreeOverlaps([
        {
          id: "/repo/a",
          files: [
            change("src/shared.ts", "uncommitted"),
            change("src/shared.ts", "committed"),
          ],
        },
        { id: "/repo/b", files: [change("src/shared.ts")] },
      ]),
    ).toEqual([
      {
        path: "src/shared.ts",
        worktreeIds: ["/repo/a", "/repo/b"],
      },
    ]);
  });

  test("does not report a file one worktree lists twice on its own", () => {
    expect(
      findWorktreeOverlaps([
        {
          id: "/repo/a",
          files: [
            change("src/shared.ts", "uncommitted"),
            change("src/shared.ts", "committed"),
          ],
        },
      ]),
    ).toEqual([]);
  });

  test("detects overlap through the old path of a rename", () => {
    expect(
      findWorktreeOverlaps([
        {
          id: "/repo/a",
          files: [
            {
              ...change("src/new.ts"),
              oldPath: "src/shared.ts",
              status: "R",
            },
          ],
        },
        { id: "/repo/b", files: [change("src/shared.ts")] },
      ]),
    ).toEqual([
      {
        path: "src/shared.ts",
        worktreeIds: ["/repo/a", "/repo/b"],
      },
    ]);
  });

  test("puts the most contended file first, then sorts by path", () => {
    expect(
      findWorktreeOverlaps([
        { id: "/repo/a", files: [change("z.ts"), change("hot.ts")] },
        { id: "/repo/b", files: [change("z.ts"), change("hot.ts")] },
        { id: "/repo/c", files: [change("hot.ts")] },
      ]),
    ).toEqual([
      { path: "hot.ts", worktreeIds: ["/repo/a", "/repo/b", "/repo/c"] },
      { path: "z.ts", worktreeIds: ["/repo/a", "/repo/b"] },
    ]);
  });

  test("returns nothing for an empty list", () => {
    expect(findWorktreeOverlaps([])).toEqual([]);
  });
});

describe("worktreeBranchError", () => {
  test.each([
    { name: "accepts a plain branch", input: "feature-x", expected: null },
    // ブランチ名は名前と違って `/` を含んでよい。
    { name: "accepts a namespaced branch", input: "feature/x", expected: null },
    { name: "accepts 100 characters", input: "a".repeat(100), expected: null },
    {
      name: "rejects 101 characters",
      input: "a".repeat(101),
      expected: "too-long",
    },
    { name: "rejects an empty branch", input: "", expected: "empty" },
    {
      name: "rejects a control character",
      input: `a${CONTROL_CHAR}b`,
      expected: "control",
    },
    {
      name: "rejects a leading dash, which git reads as an option",
      input: "-x",
      expected: "relative",
    },
    {
      name: "rejects a double dot, which git reads as a range",
      input: "a..b",
      expected: "relative",
    },
  ])("$name", ({ input, expected }) => {
    expect(worktreeBranchError(input)).toBe(expected);
  });
});
