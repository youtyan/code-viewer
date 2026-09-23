// Diff のカードの見積もりの材料を数えるときの上限と失敗の返し方
// (server/row-basis.ts)。読むもの (git の差分・ファイルの大きさ・先頭) は偽物を
// 渡し、何回読んだかと、何が返ったかを見る。

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GitFileMeta } from "../server/git";
import {
  diffRowBasisFor,
  ROW_BASIS_FILE_BUDGET,
  ROW_BASIS_LINE_BUDGET,
  type RowBasisSources,
  UNTRACKED_BYTE_BUDGET,
  UNTRACKED_FILE_BUDGET,
  UNTRACKED_READ_BYTES,
} from "../server/row-basis";

const MB = 1024 * 1024;

/** 追跡外のファイルを n 件 (1 行ずつ)。 */
const untracked = (n: number): GitFileMeta[] =>
  Array.from({ length: n }, (_, i) => ({
    path: `src/new-${i}.ts`,
    status: "A",
    additions: 1,
    deletions: 0,
    untracked: true,
  }));

/** 追跡中のファイルを n 件 (それぞれ lines 行の追加)。 */
const tracked = (n: number, lines = 1): GitFileMeta[] =>
  Array.from({ length: n }, (_, i) => ({
    path: `src/old-${i}.ts`,
    status: "M",
    additions: lines,
    deletions: 0,
  }));

/** 読んだ回数を数える偽物。大きさは既定で 10 bytes。 */
function fakeSources(
  sizes: Record<string, number> = {},
  failures: { stat?: Record<string, Error>; read?: Record<string, Error> } = {},
  diff = { code: 0, stdout: "", stderr: "" },
) {
  const calls = { diff: 0, stat: 0, read: [] as number[] };
  const sources: RowBasisSources = {
    diffText: async () => {
      calls.diff += 1;
      return diff;
    },
    fileSize: async (path) => {
      calls.stat += 1;
      const failure = failures.stat?.[path];
      if (failure) throw failure;
      return sizes[path] ?? 10;
    },
    readHead: async (path, bytes) => {
      calls.read.push(bytes);
      const failure = failures.read?.[path];
      if (failure) throw failure;
      return "export const created = 1;\n";
    },
  };
  return { sources, calls };
}

let logged: unknown[][] = [];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("読む前に量を見て、上限を超えたら読まない", () => {
  const sizes = (files: GitFileMeta[], bytes: number) =>
    Object.fromEntries(files.map((file) => [file.path, bytes]));
  const eightOfOneMb = untracked(8);
  const nineWithOneByte = untracked(9);
  const nineSizes = {
    ...sizes(nineWithOneByte.slice(0, 8), MB),
    [nineWithOneByte[8].path]: 1,
  };
  const eightOfFiveMb = untracked(8);
  test.each([
    {
      name: `追跡外 ${UNTRACKED_FILE_BUDGET} 件は読む`,
      files: untracked(UNTRACKED_FILE_BUDGET),
      sizes: {},
      expected: {
        diff: 0,
        stat: 200,
        reads: 200,
        widest: 200,
        largestRead: 10,
      },
    },
    {
      name: `追跡外 ${UNTRACKED_FILE_BUDGET + 1} 件は大きさも見ない`,
      files: untracked(UNTRACKED_FILE_BUDGET + 1),
      sizes: {},
      expected: { diff: 0, stat: 0, reads: 0, widest: 0, largestRead: 0 },
    },
    {
      name: "合計がちょうど 8MB なら読む",
      files: eightOfOneMb,
      sizes: sizes(eightOfOneMb, MB),
      expected: { diff: 0, stat: 8, reads: 8, widest: 8, largestRead: MB },
    },
    {
      name: "合計が 8MB を 1 byte でも超えたら 1 件も読まない",
      files: nineWithOneByte,
      sizes: nineSizes,
      expected: { diff: 0, stat: 9, reads: 0, widest: 0, largestRead: 0 },
    },
    {
      name: "1MB を超えるファイルは 1MB と数え、1MB まで読む",
      files: eightOfFiveMb,
      sizes: sizes(eightOfFiveMb, 5 * MB),
      expected: { diff: 0, stat: 8, reads: 8, widest: 8, largestRead: MB },
    },
    {
      name: `追跡中 ${ROW_BASIS_FILE_BUDGET} 件は差分を読む`,
      files: tracked(ROW_BASIS_FILE_BUDGET),
      sizes: {},
      expected: { diff: 1, stat: 0, reads: 0, widest: 0, largestRead: 0 },
    },
    {
      name: `追跡中 ${ROW_BASIS_FILE_BUDGET + 1} 件は差分を読まない`,
      files: tracked(ROW_BASIS_FILE_BUDGET + 1),
      sizes: {},
      expected: { diff: 0, stat: 0, reads: 0, widest: 0, largestRead: 0 },
    },
    {
      name: `追跡中の行が合わせて ${ROW_BASIS_LINE_BUDGET} 行なら読む`,
      files: tracked(2, ROW_BASIS_LINE_BUDGET / 2),
      sizes: {},
      expected: { diff: 1, stat: 0, reads: 0, widest: 0, largestRead: 0 },
    },
    {
      name: `追跡中の行が ${ROW_BASIS_LINE_BUDGET + 1} 行なら読まない`,
      files: [...tracked(1, ROW_BASIS_LINE_BUDGET), ...tracked(1)].map(
        (file, i) => ({ ...file, path: `src/old-${i}.ts` }),
      ),
      sizes: {},
      expected: { diff: 0, stat: 0, reads: 0, widest: 0, largestRead: 0 },
    },
  ])("$name", async ({ files, sizes: fileSizes, expected }) => {
    const { sources, calls } = fakeSources(fileSizes);
    const { basis, errors } = await diffRowBasisFor(files, sources);
    expect({
      diff: calls.diff,
      stat: calls.stat,
      reads: calls.read.length,
      widest: [...basis.values()].filter((rows) => rows.widest).length,
      largestRead: Math.max(0, ...calls.read),
      errors,
    }).toEqual({ ...expected, errors: [] });
  });

  test("上限を超えた追跡外のファイルも、行の数の材料は載せる (横に長い行だけ無い)", async () => {
    const files = untracked(UNTRACKED_FILE_BUDGET + 1);
    const { sources } = fakeSources();
    const { basis } = await diffRowBasisFor(files, sources);
    expect(basis.get(files[0].path)).toEqual({
      hunks: 1,
      context: 0,
      split_changes: 1,
      lead_gap: false,
    });
  });

  test("上限の値", () => {
    expect({
      UNTRACKED_FILE_BUDGET,
      UNTRACKED_BYTE_BUDGET,
      UNTRACKED_READ_BYTES,
    }).toEqual({
      UNTRACKED_FILE_BUDGET: 200,
      UNTRACKED_BYTE_BUDGET: 8 * MB,
      UNTRACKED_READ_BYTES: MB,
    });
  });
});

describe("失敗は 1 件ずつ、ファイル・操作・理由を返す", () => {
  const denied = (path: string) =>
    Object.assign(new Error(`EACCES: permission denied, open '${path}'`), {
      code: "EACCES",
    });

  test("読めなかった 2 件は 2 件のまま届く (ほかのファイルは読む)", async () => {
    const files = untracked(3);
    const [a, , c] = files.map((file) => file.path);
    const errA = denied(a);
    const errC = denied(c);
    const { sources, calls } = fakeSources(
      {},
      { read: { [a]: errA, [c]: errC } },
    );
    const { basis, errors } = await diffRowBasisFor(files, sources);
    expect({
      errors,
      widest: files.map((file) => Boolean(basis.get(file.path)?.widest)),
      reads: calls.read.length,
      // console.error には元の例外を cause ごと出す。
      loggedCauses: logged.map(
        ([error]) => (error as { cause?: unknown }).cause,
      ),
    }).toEqual({
      errors: [
        {
          path: a,
          operation: "read untracked file",
          message: `Error: EACCES: permission denied, open '${a}'\nDetails: {"code":"EACCES"}`,
        },
        {
          path: c,
          operation: "read untracked file",
          message: `Error: EACCES: permission denied, open '${c}'\nDetails: {"code":"EACCES"}`,
        },
      ],
      widest: [false, true, false],
      reads: 3,
      loggedCauses: [errA, errC],
    });
  });

  test("大きさを読めなかったファイルと差分の失敗は、別々の 1 件", async () => {
    const files = [...untracked(1), ...tracked(1)];
    const errStat = denied(files[0].path);
    const { sources } = fakeSources(
      {},
      { stat: { [files[0].path]: errStat } },
      { code: 128, stdout: "", stderr: "fatal: sample failure\n" },
    );
    const { errors } = await diffRowBasisFor(files, sources);
    expect(errors).toEqual([
      {
        path: files[0].path,
        operation: "stat untracked file",
        message: `Error: EACCES: permission denied, open '${files[0].path}'\nDetails: {"code":"EACCES"}`,
      },
      {
        operation: "git diff",
        message: "git diff exited 128 for 1 paths: fatal: sample failure",
      },
    ]);
  });

  test("読めない差分の本文は、差分全体の 1 件", async () => {
    const { sources } = fakeSources(
      {},
      {},
      {
        code: 0,
        stdout: "diff --git a/src/old-0.ts b/src/old-0.ts\n@@ broken @@\n",
        stderr: "",
      },
    );
    const { errors } = await diffRowBasisFor(tracked(1), sources);
    expect(errors).toEqual([
      {
        operation: "read git diff",
        message: "Error: unreadable hunk header in git diff: @@ broken @@",
      },
    ]);
  });
});
