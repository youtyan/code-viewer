// Diff のカードの高さの見積もり (core/diff-card-estimate.ts)。見積もりが実際と
// 違うと、中身が届いたときに下のカードが動く (ui-layout.md の「切替で CLS 0 を
// 保つ」)。期待の高さは、標準の密度・幅 1600 の実画面で測ったカードの高さ
// (1 行 22.4375・見出し 46・広げるボタン 1 段 22)。

import { describe, expect, test } from "vitest";
import {
  type DiffCardHScrollMetrics,
  type DiffCardMetrics,
  type DiffRowBasis,
  diffCardScrollsSideways,
  diffRowBasisFromText,
  estimateDiffCardHeight,
  fallbackDiffRowBasis,
  tabbedTextWidth,
  unquoteGitPath,
  widestLines,
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
      expected: {
        hunks: 1,
        context: 0,
        split_changes: 1,
        lead_gap: false,
        tail_more: false,
        widest: {
          old: ["export const sample = 1;"],
          new: ["export const sample = 5;"],
          head: ["@@ -1 +1 @@"],
        },
      },
    },
    {
      name: "長いファイルの多ハンク (途中から始まる)",
      text: longDiff(),
      path: "src/long.ts",
      expected: {
        hunks: 5,
        context: 29,
        split_changes: 6,
        lead_gap: true,
        tail_more: false,
        // 同じ長さの行は先の 1 本 (ctx after 1・2 は ctx after 0 以下)。
        widest: {
          old: ["ctx after 0"],
          new: ["ctx after 0"],
          head: ["@@ -115,6 +115,6 @@"],
        },
      },
    },
    {
      name: "新規のファイル",
      text: NEW_FILE,
      path: "src/fresh.ts",
      expected: {
        hunks: 1,
        context: 0,
        split_changes: 2,
        lead_gap: false,
        tail_more: false,
        widest: {
          old: [],
          new: ["export const fresh2 = 2;"],
          head: ["@@ -0,0 +1,2 @@"],
        },
      },
    },
    {
      name: "削除したファイル (鍵は古い側のパス)",
      text: DELETED_FILE,
      path: "src/removed.ts",
      expected: {
        hunks: 1,
        context: 0,
        split_changes: 3,
        lead_gap: false,
        tail_more: false,
        widest: {
          old: ["export const removed1 = 1;"],
          new: [],
          head: ["@@ -1,3 +0,0 @@"],
        },
      },
    },
    {
      name: "二進 (ハンクが無い)",
      text: BINARY,
      path: "assets/sample.png",
      expected: {
        hunks: 0,
        context: 0,
        split_changes: 0,
        lead_gap: false,
        tail_more: false,
        widest: { old: [], new: [], head: [] },
      },
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
      tail_more: false,
      widest: { old: ["keep"], new: ["keep"], head: ["@@ -3,7 +3,8 @@"] },
    });
  });

  test.each([
    {
      name: "最後の文脈が 3 行ちょうど: まだ行が続く見込み",
      after: 3,
      tail: true,
    },
    { name: "最後の文脈が 2 行: ファイルの終わり", after: 2, tail: false },
  ])("$name", ({ after, tail }) => {
    const context = Array.from({ length: after }, (_, i) => ` after ${i}`);
    const text = `${header("src/tail.ts")}
@@ -10,${4 + after} +10,${4 + after} @@
 before 1
 before 2
 before 3
-old
+new
${context.join("\n")}
`;
    expect(diffRowBasisFromText(text).get("src/tail.ts")?.tail_more).toBe(tail);
  });

  test("削除したファイルは、最後の文脈が 3 行でも続きが無い", () => {
    const text = `${header("src/gone.ts").replace("+++ b/src/gone.ts", "+++ /dev/null")}
@@ -1,4 +0,0 @@
-a
-b
-c
-d
`;
    expect(diffRowBasisFromText(text).get("src/gone.ts")?.tail_more).toBe(
      false,
    );
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
      tail_more: false,
      widest: {
        old: ["--- old rule"],
        new: ["+++ new rule"],
        head: ["@@ -1,2 +1,2 @@"],
      },
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

  test("横に長い行: 文脈は両方の表・削除は古い側・追加は新しい側、CR は外す", () => {
    const text = `${header("src/wide.ts")}
@@ -1,3 +1,3 @@ export function sample() {
 const keep = 1;\r
-const old = "shorter";\r
+const replaced = "a longer line";\r
 }\r
`;
    expect(diffRowBasisFromText(text).get("src/wide.ts")?.widest).toEqual({
      old: ['const old = "shorter";'],
      new: ['const replaced = "a longer line";'],
      head: ["@@ -1,3 +1,3 @@ export function sample() {"],
    });
  });

  test("読めないハンクの見出しは、その行を添えて投げる", () => {
    expect(() =>
      diffRowBasisFromText(`${header("src/short.ts")}\n@@ broken @@\n`),
    ).toThrow("unreadable hunk header in git diff: @@ broken @@");
  });
});

describe("widestLines (字の幅が分からなくても一番幅を取りうる行)", () => {
  test.each([
    {
      name: "どの種類でも別の行以下の行は外す",
      lines: ["ab", "abc", "a"],
      expected: ["abc"],
    },
    {
      name: "同じ数の行は先の 1 本",
      lines: ["abc", "xyz"],
      expected: ["abc"],
    },
    {
      name: "全角が多い行と ASCII が多い行は両方 (おおよその幅の広い順)",
      lines: ["xxxxxxxxxx", "漢漢漢漢漢漢"],
      expected: ["漢漢漢漢漢漢", "xxxxxxxxxx"],
    },
    {
      name: "タブは別の種類",
      lines: ["abcd", "\tab"],
      expected: ["\tab", "abcd"],
    },
    {
      name: "その他の字 (アクセント付き) は全角と別の種類",
      lines: ["éé", "漢"],
      expected: ["éé", "漢"],
    },
    {
      name: "幅の無い字 (結合文字) は数えない",
      lines: ["e\u0301e\u0301", "eee"],
      expected: ["eee"],
    },
    { name: "行が無い", lines: [], expected: [] },
  ])("$name", ({ lines, expected }) => {
    expect(widestLines(lines)).toEqual(expected);
  });

  test("候補は 8 本まで・1 行は 1000 字まで", () => {
    // ASCII が 1 字増えるごとに全角が 1 字減る 10 本は、どれも外れない。
    const tradeOff = Array.from(
      { length: 10 },
      (_, i) => "a".repeat(i) + "漢".repeat(10 - i),
    );
    expect({
      count: widestLines(tradeOff),
      long: widestLines(["x".repeat(1500)]).map((line) => line.length),
    }).toEqual({ count: tradeOff.slice(0, 8), long: [1000] });
  });
});

describe("tabbedTextWidth (タブを止まりまで進めた行の幅)", () => {
  // 字は 1 字 10px (W だけ 37px)。空白 10px・tab-size 4 で止まりは 40px ごと。
  const measure = (text: string) =>
    [...text].reduce((sum, ch) => sum + (ch === "W" ? 37 : 10), 0);
  test.each([
    { text: "ab", expected: 20 },
    { text: "\tab", expected: 60 },
    { text: "a\tb", expected: 50 },
    { text: "abcd\tx", expected: 90 },
    // 止まり (40) まで 3px しかない (空白の半分未満) ので、次の止まり (80) まで。
    { text: "W\tx", expected: 90 },
  ])("$text", ({ text, expected }) => {
    expect(tabbedTextWidth(text, measure, 4)).toBe(expected);
  });
});

describe("diffCardScrollsSideways (貼り付く横スクロールバーが出るか)", () => {
  // 1 字 10px。左右の表示は古い側 100px・新しい側 200px、見出しは 120px まで。
  const split: DiffCardHScrollMetrics = {
    rowHeight: 10,
    lineRoom: [100, 200],
    headRoom: 120,
    lineWidth: (text) => text.length * 10,
    headWidth: (text) => text.length * 10,
  };
  const unified = { ...split, lineRoom: [150] };
  const lines = (old: number, fresh: number, head = 0) => ({
    old: [old ? "x".repeat(old) : ""],
    new: [fresh ? "x".repeat(fresh) : ""],
    head: [head ? "@".repeat(head) : ""],
  });
  test.each([
    {
      name: "材料に行が無い",
      widest: undefined,
      hscroll: split,
      expected: false,
    },
    {
      name: "古い側の行が古い側の表を超える",
      widest: lines(11, 0),
      hscroll: split,
      expected: true,
    },
    {
      name: "新しい側の行は新しい側の表の幅で見る",
      widest: lines(0, 11),
      hscroll: split,
      expected: false,
    },
    {
      name: "1px までのはみ出しは出さない (views/diff-hscroll.ts と同じ)",
      widest: lines(0, 0),
      hscroll: { ...split, lineRoom: [99, 200], lineWidth: () => 100 },
      expected: false,
    },
    {
      name: "1px を超えるはみ出しは出す",
      widest: lines(0, 0),
      hscroll: { ...split, lineRoom: [98.9, 200], lineWidth: () => 100 },
      expected: true,
    },
    {
      name: "1 列は両側の行を 1 つの表で見る",
      widest: lines(0, 16),
      hscroll: unified,
      expected: true,
    },
    {
      name: "見出しは見出しの幅で見る",
      widest: lines(0, 0, 13),
      hscroll: split,
      expected: true,
    },
  ])("$name", ({ widest, hscroll, expected }) => {
    const layout =
      hscroll.lineRoom.length === 2 ? "side-by-side" : "line-by-line";
    expect(diffCardScrollsSideways(widest, layout, hscroll)).toBe(expected);
  });

  test("測った表の数が並べ方と合わなければ理由つきで投げる", () => {
    expect(() =>
      diffCardScrollsSideways(lines(1, 1), "side-by-side", unified),
    ).toThrow(
      "diff card width measured for 1 tables, but side-by-side draws 2",
    );
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
    {
      name: "行が続く見込み: 最後の「下へ広げる」行が入る",
      status: "M",
      expected: 46 + 3 * 22.4375 + 36,
    },
    {
      name: "削除したファイル: 最後の行は置かれない",
      status: "D",
      expected: 46 + 3 * 22.4375,
    },
  ])("$name", ({ status, expected }) => {
    expect(
      estimateDiffCardHeight({
        additions: 1,
        deletions: 1,
        status,
        basis: {
          hunks: 1,
          context: 2,
          split_changes: 1,
          lead_gap: false,
          tail_more: true,
        },
        layout: "side-by-side",
        metrics: { ...METRICS, trailingRowHeight: 36 },
      }),
    ).toBe(Math.round(expected));
  });

  test.each([
    {
      name: "横に長い行があると、バーの行の高さを足す",
      room: 100,
      expected: 78,
    },
    { name: "収まれば足さない", room: 300, expected: 68 },
  ])("$name", ({ room, expected }) => {
    // 見出し 46 + 1 行 22.4375 (= 68) に、1 字 10px の行 (24 字) の幅を当てる。
    expect(
      estimateDiffCardHeight({
        additions: 1,
        deletions: 1,
        basis: diffRowBasisFromText(SHORT).get("src/short.ts"),
        layout: "side-by-side",
        metrics: {
          ...METRICS,
          hscroll: {
            rowHeight: 10,
            lineRoom: [room, room],
            headRoom: room,
            lineWidth: (text) => text.length * 10,
            headWidth: (text) => text.length * 10,
          },
        },
      }),
    ).toBe(expected);
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
