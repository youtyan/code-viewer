// ターミナルの出力から画像パスを拾うときの規則。
//
// ここが緩いと帯が誤検出で埋まり、厳しすぎると肝心のパスを取り逃す。とくに
// 2 つ、実際に踏む形を固定しておく。
//
// - capture-pane は -e 付きなので本文に ANSI が混じる。落としてから拾わないと
//   色の指定 (ESC[32m の m) がパスの頭にくっつく
// - tmux は折り返しを改行として返すので、狭いペインでは長い絶対パスが必ず
//   途中で割れる

import { describe, expect, test } from "vitest";
import {
  findImagePathLinks,
  findImagePaths,
  findImagePathsInText,
  findImagePathsNewestFirst,
  findScreenImagePaths,
  joinBrokenPathLines,
  joinWrappedLines,
  stripAnsi,
  TERMINAL_IMAGE_EXTENSIONS,
  terminalImageExtension,
} from "../core/terminal-images";
import { PASTE_IMAGE_TYPES } from "../core/terminal-paste";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe("受け付ける画像の種類", () => {
  test("貼り付けで受ける種類と揃っている", () => {
    expect([...TERMINAL_IMAGE_EXTENSIONS].sort()).toEqual([
      "gif",
      "jpeg",
      "jpg",
      "png",
      "webp",
    ]);
    // 片方だけ広げると、拾えるのに配れない (あるいはその逆) が起きる。
    for (const extension of Object.values(PASTE_IMAGE_TYPES)) {
      expect(TERMINAL_IMAGE_EXTENSIONS).toContain(extension);
    }
  });

  test.each([
    { name: "png", path: "shot.png", expected: "png" },
    { name: "jpg", path: "shot.jpg", expected: "jpg" },
    { name: "jpeg は jpg の別綴り", path: "shot.jpeg", expected: "jpeg" },
    { name: "gif", path: "shot.gif", expected: "gif" },
    { name: "webp", path: "shot.webp", expected: "webp" },
    { name: "大文字でも同じ", path: "SHOT.PNG", expected: "png" },
    { name: "SVG は受けない", path: "shot.svg", expected: null },
    { name: "画像でない", path: "notes.txt", expected: null },
    { name: "拡張子が無い", path: "Makefile", expected: null },
    { name: "画像の後ろに別の拡張子", path: "shot.png.txt", expected: null },
  ])("$name", ({ path, expected }) => {
    expect(terminalImageExtension(path)).toBe(expected);
  });
});

describe("stripAnsi", () => {
  test.each([
    {
      name: "色指定 (CSI) を落とす",
      text: `${ESC}[32m/tmp/out.png${ESC}[0m`,
      expected: "/tmp/out.png",
    },
    {
      name: "カーソル移動も落とす",
      text: `${ESC}[3;1Hhello`,
      expected: "hello",
    },
    {
      name: "OSC (タイトル設定) を BEL 終端ごと落とす",
      text: `${ESC}]0;title${BEL}body`,
      expected: "body",
    },
    {
      name: "OSC を ESC \\ 終端ごと落とす",
      text: `${ESC}]0;title${ESC}\\body`,
      expected: "body",
    },
    { name: "2 文字ものを落とす", text: `${ESC}Mhello`, expected: "hello" },
    { name: "エスケープが無ければそのまま", text: "plain", expected: "plain" },
    { name: "改行は残す", text: "a\nb", expected: "a\nb" },
  ])("$name", ({ text, expected }) => {
    expect(stripAnsi(text)).toBe(expected);
  });
});

describe("findImagePaths", () => {
  test.each([
    {
      name: "絶対パス",
      text: "wrote /tmp/out.png",
      expected: ["/tmp/out.png"],
    },
    {
      name: "リポジトリ相対パス",
      text: "saved docs/img/a.jpg",
      expected: ["docs/img/a.jpg"],
    },
    { name: "./ 付き", text: "see ./a.gif", expected: ["./a.gif"] },
    { name: "~ 付き", text: "~/pics/b.webp", expected: ["~/pics/b.webp"] },
    {
      name: "引用符に囲まれていても中身だけ",
      text: "open '/tmp/out.png'",
      expected: ["/tmp/out.png"],
    },
    {
      name: "引用符の中の空白入りの絶対パスは 1 本",
      text: "saved '/tmp/my shots/a b.png'",
      expected: ["/tmp/my shots/a b.png"],
    },
    {
      name: "二重引用符の ~ 付きパスも 1 本",
      text: 'open "~/My Pictures/out.png" now',
      expected: ["~/My Pictures/out.png"],
    },
    {
      name: "パスで始まらない引用は文として扱い、ファイル名だけ拾う",
      text: '"see the out.png file"',
      expected: ["out.png"],
    },
    {
      name: "\\ で書いた空白は外して 1 本",
      text: "ls /tmp/my\\ shots/a.png",
      expected: ["/tmp/my shots/a.png"],
    },
    {
      name: "引用符と素の形が混ざっても出てきた順",
      text: "b.png then './x y.png'",
      expected: ["b.png", "./x y.png"],
    },
    {
      name: "括弧に囲まれていても中身だけ",
      text: "(see out.png)",
      expected: ["out.png"],
    },
    {
      name: "文末の句点は含めない",
      text: "created out.png.",
      expected: ["out.png"],
    },
    {
      name: "= の後ろだけを拾う",
      text: "--out=/tmp/out.png",
      expected: ["/tmp/out.png"],
    },
    {
      name: "罫線がくっついていても外す",
      text: "│/tmp/out.png│",
      expected: ["/tmp/out.png"],
    },
    { name: "日本語のファイル名", text: "図表.png", expected: ["図表.png"] },
    { name: "大文字の拡張子", text: "OUT.PNG", expected: ["OUT.PNG"] },
    { name: "jpeg", text: "a.jpeg", expected: ["a.jpeg"] },
    {
      name: "複数あれば全部",
      text: "a.png then b.gif",
      expected: ["a.png", "b.gif"],
    },
    { name: "同じパスは 1 つ", text: "a.png a.png", expected: ["a.png"] },
    {
      name: "http の URL は拾わない",
      text: "https://x.test/a.png",
      expected: [],
    },
    {
      name: "プロトコル相対の URL も拾わない",
      text: "//cdn.x.test/a.png",
      expected: [],
    },
    { name: "画像でない拡張子", text: "notes.txt", expected: [] },
    { name: "SVG は拾わない", text: "diagram.svg", expected: [] },
    { name: "拡張子の後ろに文字が続く", text: "out.pngx", expected: [] },
    { name: "名前が無い", text: "see .png", expected: [] },
    { name: "名前が無い絶対パス", text: "/.png", expected: [] },
    { name: "画像パスが無い", text: "$ ls -la", expected: [] },
  ])("$name", ({ text, expected }) => {
    expect(findImagePaths(text)).toEqual(expected);
  });

  test.each([
    { name: "上限 1", limit: 1, expected: ["a.png"] },
    { name: "上限 2", limit: 2, expected: ["a.png", "b.png"] },
    {
      name: "上限が件数を超える",
      limit: 9,
      expected: ["a.png", "b.png", "c.png"],
    },
  ])("$name", ({ limit, expected }) => {
    expect(findImagePaths("a.png b.png c.png", limit)).toEqual(expected);
  });
});

describe("joinWrappedLines", () => {
  test.each([
    {
      name: "幅ちょうどの行は次の行と繋ぐ",
      text: "abcde\nfgh",
      width: 5,
      expected: "abcdefgh",
    },
    {
      name: "幅に足りない行は繋がない",
      text: "abc\nfgh",
      width: 5,
      expected: "abc\nfgh",
    },
    {
      name: "折り返しが続けば全部繋ぐ",
      text: "abcde\nfghij\nk",
      width: 5,
      expected: "abcdefghijk",
    },
    {
      name: "繋いだ後の行はまた別の行",
      text: "abcde\nfg\nhij",
      width: 5,
      expected: "abcdefg\nhij",
    },
    {
      name: "幅 0 なら触らない",
      text: "abcde\nfgh",
      width: 0,
      expected: "abcde\nfgh",
    },
    {
      name: "幅が負なら触らない",
      text: "abcde\nfgh",
      width: -1,
      expected: "abcde\nfgh",
    },
    { name: "1 行だけ", text: "abcde", width: 5, expected: "abcde" },
    { name: "空", text: "", width: 5, expected: "" },
  ])("$name", ({ text, width, expected }) => {
    expect(joinWrappedLines(text, width)).toBe(expected);
  });
});

describe("joinBrokenPathLines", () => {
  test("CLI が自分で折り返した添付行からパスを組み直す", () => {
    // Claude Code の添付表示。幅で切れた後にサイズ注記が入り、続きは字下げ
    // されて次の行に出る。幅を見るだけでは絶対に繋がらない形。
    const screen = [
      "  › [image] /tmp/session/scratchpad/ban (124.9KB)",
      "            d2.png",
    ].join("\n");
    expect(joinBrokenPathLines(screen)).toBe(
      "/tmp/session/scratchpad/band2.png",
    );
  });

  test.each([
    {
      name: "行末のパス片と次行の先頭語だけを繋ぐ",
      text: "see /tmp/out (1KB)\n    .png trailing",
      expected: "/tmp/out.png",
    },
    {
      name: "パス片が無い行は候補にしない",
      text: "no path here\nnext.png",
      expected: "",
    },
    {
      name: "次の行が空なら候補にしない",
      text: "/tmp/out\n",
      expected: "",
    },
    { name: "1 行だけなら候補は無い", text: "/tmp/out.png", expected: "" },
    { name: "空", text: "", expected: "" },
  ])("$name", ({ text, expected }) => {
    expect(joinBrokenPathLines(text)).toBe(expected);
  });
});

describe("findImagePathsInText", () => {
  test("CLI が割った添付行のパスを拾う", () => {
    // 実際に取り逃していた形。行またぎを組み直せないと、続きの断片
    // (d2.png) しか出てこない。断片も候補には残るが、実在しないので配る側で
    // 落ちる。
    const text = [
      "  › [image] /tmp/session/scratchpad/ban (124.9KB)",
      "            d2.png",
    ].join("\n");
    expect(findImagePathsInText(text)).toEqual([
      "d2.png",
      "/tmp/session/scratchpad/band2.png",
    ]);
  });

  test("サイズ注記が次の行にある形でも拾う", () => {
    const text = [
      "  › [image]/tmp/session/scratchpad/shell-b",
      "           and3.png                          (398KB)",
    ].join("\n");
    expect(findImagePathsInText(text)).toEqual([
      "and3.png",
      "/tmp/session/scratchpad/shell-band3.png",
    ]);
  });

  test("素のままの形も必ず見る", () => {
    expect(findImagePathsInText("wrote docs/out.png\nnext line")).toEqual([
      "docs/out.png",
    ]);
  });
});

describe("findImagePathLinks", () => {
  // 棚にある綴りだけをリンクにする。位置は行の文字列の添字 (end は含まない)。
  const SCREEN = [
    "$ make chart",
    "wrote docs/out.png",
    "  › [image] /tmp/session/scratchpad/ban (124.9KB)",
    "            d2.png",
    "",
  ];
  const known =
    (...candidates: string[]) =>
    (candidate: string) =>
      candidates.includes(candidate);

  test.each([
    {
      name: "1 行にそのまま出ている綴り",
      lines: SCREEN,
      width: 0,
      known: ["docs/out.png"],
      expected: [
        {
          candidate: "docs/out.png",
          start: { row: 1, col: 6 },
          end: { row: 1, col: 18 },
        },
      ],
    },
    {
      name: "CLI が割った行は 2 行にまたがる",
      lines: SCREEN,
      width: 0,
      known: ["/tmp/session/scratchpad/band2.png"],
      expected: [
        {
          candidate: "/tmp/session/scratchpad/band2.png",
          start: { row: 2, col: 12 },
          end: { row: 3, col: 18 },
        },
      ],
    },
    {
      name: "端末の幅で折り返された綴り",
      lines: ["x /tmp/aaaa", "bb/x.png done"],
      width: 11,
      known: ["/tmp/aaaabb/x.png"],
      expected: [
        {
          candidate: "/tmp/aaaabb/x.png",
          start: { row: 0, col: 2 },
          end: { row: 1, col: 8 },
        },
      ],
    },
    {
      name: "引用符の中の空白入りのパス",
      lines: ["saved '/tmp/my shots/a b.png' ok"],
      width: 0,
      known: ["/tmp/my shots/a b.png"],
      expected: [
        {
          candidate: "/tmp/my shots/a b.png",
          start: { row: 0, col: 7 },
          end: { row: 0, col: 28 },
        },
      ],
    },
    {
      name: "\\ で空白を書いたパスは綴りの長さで範囲を取る",
      lines: ["ls: /tmp/my\\ shots/a.png"],
      width: 0,
      known: ["/tmp/my shots/a.png"],
      expected: [
        {
          candidate: "/tmp/my shots/a.png",
          start: { row: 0, col: 4 },
          end: { row: 0, col: 24 },
        },
      ],
    },
    {
      name: "同じ綴りが何か所にあっても全部",
      lines: ["a docs/out.png", "b docs/out.png"],
      width: 0,
      known: ["docs/out.png"],
      expected: [
        {
          candidate: "docs/out.png",
          start: { row: 0, col: 2 },
          end: { row: 0, col: 14 },
        },
        {
          candidate: "docs/out.png",
          start: { row: 1, col: 2 },
          end: { row: 1, col: 14 },
        },
      ],
    },
    {
      name: "棚に無い綴りはリンクにしない",
      lines: SCREEN,
      width: 0,
      known: ["docs/missing.png"],
      expected: [],
    },
    {
      name: "次の行が空なら繋がない",
      lines: ["x /tmp/aaaa", ""],
      width: 11,
      known: ["/tmp/aaaa"],
      expected: [],
    },
  ])("$name", ({ lines, width, known: names, expected }) => {
    expect(findImagePathLinks(lines, width, known(...names))).toEqual(expected);
  });
});

describe("findImagePathsNewestFirst", () => {
  test.each([
    {
      name: "後に出てきたものが先",
      text: "wrote a.png\nwrote b.png\nwrote c.png",
      width: 0,
      limit: 64,
      expected: ["c.png", "b.png", "a.png"],
    },
    {
      name: "同じパスは最後に出てきた位置で並ぶ",
      text: "a.png\nb.png\na.png",
      width: 0,
      limit: 64,
      expected: ["a.png", "b.png"],
    },
    {
      name: "上限は新しいほうから取る",
      text: "a.png\nb.png\nc.png",
      width: 0,
      limit: 2,
      expected: ["c.png", "b.png"],
    },
    {
      name: "折り返しを繋いだ候補も繋いだ位置で並ぶ",
      text: "/tmp/aaaaa\nbbb/x.png\nlast.png",
      width: 10,
      limit: 64,
      // 最後の 1 つは CLI が割った行として組み直した候補 (本文のどこにも
      // そのままは無い)。最も古い扱いになる。
      expected: [
        "last.png",
        "bbb/x.png",
        "/tmp/aaaaabbb/x.png",
        "bbb/x.pnglast.png",
      ],
    },
    { name: "画像パスが無い", text: "$ ls", width: 0, limit: 64, expected: [] },
  ])("$name", ({ text, width, limit, expected }) => {
    expect(findImagePathsNewestFirst(text, width, limit)).toEqual(expected);
  });
});

describe("findScreenImagePaths", () => {
  test("色付きのパスを頭から拾う", () => {
    // 落とさずに拾うと、色指定の m がパスの頭に付いた "m/tmp/out.png" になる。
    const screen = `${ESC}[32m/tmp/out.png${ESC}[0m\n`;
    expect(findScreenImagePaths(screen, 80)).toEqual(["/tmp/out.png"]);
  });

  test("折り返しで割れた絶対パスを繋いで拾う", () => {
    // 幅 10 のペインに /tmp/aaaaabbb/x.png を出すと、行が割れて届く。
    const screen = "/tmp/aaaaa\nbbb/x.png\n";
    // 繋いだ形と元の形の両方を返す。どちらが本物かは配る側が実在で決める。
    expect(findScreenImagePaths(screen, 10)).toEqual([
      "bbb/x.png",
      "/tmp/aaaaabbb/x.png",
    ]);
  });

  test("行末ちょうどで終わったパスは繋がない形で残る", () => {
    // 繋ぐと "out.pnghello" になって消える。だから両方を見る。
    const screen = "out.png\nhello\n";
    expect(findScreenImagePaths(screen, 7)).toEqual(["out.png"]);
  });

  test("同じ画面を何度渡しても同じ結果", () => {
    // tmux は毎フレーム全画面を送ってくる。二重に足さない責任は呼び出し側に
    // あるが、こちらが呼ぶたびに違うものを返してはいけない。
    const screen = "a.png\nb.gif\n";
    expect(findScreenImagePaths(screen, 80)).toEqual(["a.png", "b.gif"]);
    expect(findScreenImagePaths(screen, 80)).toEqual(["a.png", "b.gif"]);
  });
});
