// Diff のカードの高さの見積もり (core/diff-card-estimate.ts)。見積もりが実際と
// 違うと、中身が届いたときに下のカードが動く (ui-layout.md の「切替で CLS 0 を
// 保つ」)。期待の高さは、標準の密度・幅 1600 の実画面で測ったカードの高さ
// (1 行 22.4375・見出し 46・広げるボタン 1 段 22)。

import { describe, expect, test } from "vitest";
import {
  type DiffCardMetrics,
  type DiffRowBasis,
  diffRowBasisFromText,
  estimateDiffCardHeight,
  fallbackDiffRowBasis,
  unquoteGitPath,
} from "../core/diff-card-estimate";

const METRICS: DiffCardMetrics = {
  rowHeight: 22.4375,
  headerHeight: 46,
  gapRowHeight: 22,
};

const header = (path: string) =>
  `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}`;

/** 1 行だけのファイルの 1 行を変えた (前後に文脈が無い)。 */
const SHORT = `${header("src/short.ts")}
@@ -1 +1 @@
-export const sample = 1;
+export const sample = 5;
`;

/** 120 行のファイルの 5 か所を変えた (5 ハンク。最後のハンクはファイルの終わりで切れる)。 */
function longDiff(): string {
  const hunk = (
    start: number,
    before: number,
    changed: number,
    after: number,
  ) => {
    const lines: string[] = [];
    for (let i = 0; i < before; i++) lines.push(` ctx ${start + i}`);
    for (let i = 0; i < changed; i++) lines.push(`-old ${i}`);
    for (let i = 0; i < changed; i++) lines.push(`+new ${i}`);
    for (let i = 0; i < after; i++) lines.push(` ctx after ${i}`);
    const oldLen = before + changed + after;
    return `@@ -${start},${oldLen} +${start},${oldLen} @@\n${lines.join("\n")}`;
  };
  return `${header("src/long.ts")}
${hunk(2, 3, 1, 3)}
${hunk(27, 3, 2, 3)}
${hunk(57, 3, 1, 3)}
${hunk(87, 3, 1, 3)}
${hunk(115, 3, 1, 2)}
`;
}

const NEW_FILE = `diff --git a/src/fresh.ts b/src/fresh.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/fresh.ts
@@ -0,0 +1,2 @@
+export const fresh = 1;
+export const fresh2 = 2;
`;

const DELETED_FILE = `diff --git a/src/removed.ts b/src/removed.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/removed.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export const removed1 = 1;
-export const removed2 = 2;
-export const removed3 = 3;
`;

const BINARY = `diff --git a/assets/sample.png b/assets/sample.png
index 5555555..6666666 100644
Binary files a/assets/sample.png and b/assets/sample.png differ
`;

describe("diffRowBasisFromText (サーバが本文から数える材料)", () => {
  test.each<{
    name: string;
    text: string;
    path: string;
    expected: DiffRowBasis;
  }>([
    {
      name: "短いファイル 1 ハンク (先頭の行から)",
      text: SHORT,
      path: "src/short.ts",
      expected: { hunks: 1, context: 0, split_changes: 1, lead_gap: false },
    },
    {
      name: "長いファイルの多ハンク (途中から始まる)",
      text: longDiff(),
      path: "src/long.ts",
      expected: { hunks: 5, context: 29, split_changes: 6, lead_gap: true },
    },
    {
      name: "新規のファイル",
      text: NEW_FILE,
      path: "src/fresh.ts",
      expected: { hunks: 1, context: 0, split_changes: 2, lead_gap: false },
    },
    {
      name: "削除したファイル (鍵は古い側のパス)",
      text: DELETED_FILE,
      path: "src/removed.ts",
      expected: { hunks: 1, context: 0, split_changes: 3, lead_gap: false },
    },
    {
      name: "二進 (ハンクが無い)",
      text: BINARY,
      path: "assets/sample.png",
      expected: { hunks: 0, context: 0, split_changes: 0, lead_gap: false },
    },
  ])("$name", ({ text, path, expected }) => {
    expect(diffRowBasisFromText(text).get(path)).toEqual(expected);
  });

  test("左右の行は変更のかたまりごとの max(削除, 追加)", () => {
    const text = `${header("src/blocks.ts")}
@@ -3,7 +3,8 @@
 keep
-a
-b
+c
 keep
-d
+e
+f
 keep
`;
    // かたまり 1: 削除 2・追加 1 → 2 行。かたまり 2: 削除 1・追加 2 → 2 行。
    expect(diffRowBasisFromText(text).get("src/blocks.ts")).toEqual({
      hunks: 1,
      context: 3,
      split_changes: 4,
      lead_gap: true,
    });
  });

  test("ハンクの中の --- / +++ で始まる行は見出しではなく行", () => {
    const text = `${header("docs/sample.md")}
@@ -1,2 +1,2 @@
---- old rule
++++ new rule
 keep
`;
    expect(diffRowBasisFromText(text).get("docs/sample.md")).toEqual({
      hunks: 1,
      context: 1,
      split_changes: 1,
      lead_gap: false,
    });
  });

  test("複数のファイルを、それぞれのパスで返す", () => {
    const basis = diffRowBasisFromText(`${SHORT}${NEW_FILE}${BINARY}`);
    expect([...basis.keys()]).toEqual([
      "src/short.ts",
      "src/fresh.ts",
      "assets/sample.png",
    ]);
  });

  test("引用されたパス (空白・8 進の UTF-8) を外す", () => {
    const text = `diff --git "a/src/sample \\346\\227\\245.ts" "b/src/sample \\346\\227\\245.ts"
--- "a/src/sample \\346\\227\\245.ts"
+++ "b/src/sample \\346\\227\\245.ts"
@@ -1 +1 @@
-a
+b
`;
    expect([...diffRowBasisFromText(text).keys()]).toEqual([
      "src/sample 日.ts",
    ]);
  });

  test("読めないハンクの見出しは、その行を添えて投げる", () => {
    expect(() =>
      diffRowBasisFromText(`${header("src/short.ts")}\n@@ broken @@\n`),
    ).toThrow("unreadable hunk header in git diff: @@ broken @@");
  });
});

describe("unquoteGitPath", () => {
  test.each([
    { quoted: '"a/tab\\there"', expected: "a/tab\there" },
    { quoted: '"a/quote\\"d"', expected: 'a/quote"d' },
    { quoted: '"a/\\346\\227\\245"', expected: "a/日" },
    { quoted: '"a/😀 \\t"', expected: "a/😀 \t" },
  ])("$quoted", ({ quoted, expected }) => {
    expect(unquoteGitPath(quoted)).toBe(expected);
  });

  test("壊れた引用は理由つきで投げる", () => {
    expect(() => unquoteGitPath('"a/\\q"')).toThrow(
      'unknown escape \\q in git path: "a/\\q"',
    );
  });
});

describe("estimateDiffCardHeight (描いた直後の高さ)", () => {
  const long = diffRowBasisFromText(longDiff()).get("src/long.ts");
  test.each([
    {
      name: "短いファイル 1 ハンク・左右",
      input: {
        additions: 1,
        deletions: 1,
        basis: diffRowBasisFromText(SHORT).get("src/short.ts"),
      },
      layout: "side-by-side" as const,
      // 実画面: 68.4 (見出し 46 + 1 行)
      expected: 68,
    },
    {
      name: "長いファイルの多ハンク・左右",
      input: { additions: 6, deletions: 6, basis: long },
      layout: "side-by-side" as const,
      // 実画面: 1029.3 (35 行 + 区切り 1 + 2 × 4 段)
      expected: 1029,
    },
    {
      name: "長いファイルの多ハンク・1 列",
      input: { additions: 6, deletions: 6, basis: long },
      layout: "line-by-line" as const,
      // 実画面: 1163.9 (41 行 + 区切り 9 段)
      expected: 1164,
    },
    {
      name: "新規のファイル・左右",
      input: {
        additions: 2,
        deletions: 0,
        basis: diffRowBasisFromText(NEW_FILE).get("src/fresh.ts"),
      },
      layout: "side-by-side" as const,
      // 実画面: 90.9
      expected: 91,
    },
    {
      name: "削除したファイル・1 列",
      input: {
        additions: 0,
        deletions: 3,
        basis: diffRowBasisFromText(DELETED_FILE).get("src/removed.ts"),
      },
      layout: "line-by-line" as const,
      expected: 113,
    },
  ])("$name", ({ input, layout, expected }) => {
    expect(estimateDiffCardHeight({ ...input, layout, metrics: METRICS })).toBe(
      expected,
    );
  });

  test.each([
    { name: "二進", input: { additions: 0, deletions: 0, binary: true } },
    {
      name: "ハンクの無い差分 (改名だけ)",
      input: {
        additions: 0,
        deletions: 0,
        basis: { hunks: 0, context: 0, split_changes: 0, lead_gap: false },
      },
    },
  ])("$name は行から数えられないので null", ({ input }) => {
    expect(
      estimateDiffCardHeight({
        ...input,
        layout: "side-by-side",
        metrics: METRICS,
      }),
    ).toBeNull();
  });
});

describe("fallbackDiffRowBasis (材料が無いとき)", () => {
  test.each([
    {
      name: "短いファイル 1 ハンク: 文脈はファイルの長さで頭打ち",
      input: { additions: 1, deletions: 1, hunks: 1, fileLines: 1 },
      expected: { hunks: 1, context: 0, split_changes: 1, lead_gap: false },
    },
    {
      name: "長いファイルの多ハンク: ハンクごとに前後 3 行",
      input: { additions: 6, deletions: 6, hunks: 5, fileLines: 120 },
      expected: { hunks: 5, context: 30, split_changes: 6, lead_gap: true },
    },
    {
      name: "ハンクの数が分からなければ 1",
      input: { additions: 2, deletions: 2 },
      expected: { hunks: 1, context: 6, split_changes: 2, lead_gap: true },
    },
    {
      name: "新規のファイル",
      input: { additions: 2, deletions: 0, status: "A" },
      expected: { hunks: 1, context: 0, split_changes: 2, lead_gap: false },
    },
    {
      name: "削除したファイル",
      input: { additions: 0, deletions: 20, status: "D" },
      expected: { hunks: 1, context: 0, split_changes: 20, lead_gap: false },
    },
    {
      name: "既存のファイルから行を消しただけ (削除のファイルではない)",
      input: { additions: 0, deletions: 2, status: "M", hunks: 1 },
      expected: { hunks: 1, context: 6, split_changes: 2, lead_gap: true },
    },
  ])("$name", ({ input, expected }) => {
    expect(fallbackDiffRowBasis(input)).toEqual(expected);
  });
});
