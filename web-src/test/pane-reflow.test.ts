// SP の 1 ペイン表示の「読む」画面の元。端末に書いた出力を、スマホの幅で折り返せる
// 行に起こすところと、流しの始めの画面を空の端末へ書き戻すところ。本物の xterm に
// バイト列を書いて確かめる (画面には出さない)。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  DEFAULT_COLOR,
  findChoices,
  paragraphStart,
  type ReflowLine,
  readableColor,
  readLogicalLines,
  readParagraphs,
  runCss,
  withoutTransient,
  STYLE,
  terminalPalette,
} from "../core/pane-reflow";
import { paneSnapshotSequence, type TmuxPaneSnapshot } from "../core/tmux";
import type { XtermTerminal } from "../core/xterm-loader";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const ESC = String.fromCharCode(27);

async function terminal(
  cols: number,
  rows: number,
  data: string,
): Promise<XtermTerminal> {
  const { Terminal } = await import("@xterm/xterm");
  const term = new Terminal({ cols, rows, scrollback: 100 });
  await new Promise<void>((resolve) => term.write(data, resolve));
  return term as unknown as XtermTerminal;
}

function texts(lines: ReflowLine[]): string[] {
  return lines.map((line) => line.runs.map((run) => run.text).join(""));
}

describe("readLogicalLines", () => {
  test.each([
    {
      name: "端末が折り返した行は 1 行に繋ぐ",
      cols: 10,
      data: "hello world this wraps",
      expected: ["hello world this wraps"],
    },
    {
      name: "行末の空白は落とす",
      cols: 20,
      data: "abc     \r\nnext",
      expected: ["abc", "next"],
    },
    {
      name: "全角の字は後ろ半分を数えない",
      cols: 6,
      data: "日本語テスト",
      expected: ["日本語テスト"],
    },
    {
      name: "左右の枠を外して中身だけにする",
      cols: 24,
      data: "  │ inner text         │",
      expected: ["inner text"],
    },
    {
      name: "枠の線だけの行はそのまま (線として扱う)",
      cols: 12,
      data: "╭──────────╮",
      expected: ["╭──────────╮"],
    },
    {
      name: "片側だけの縦線は枠ではない",
      cols: 20,
      data: "│ quoted text",
      expected: ["│ quoted text"],
    },
  ])("$name", async ({ cols, data, expected }) => {
    const term = await terminal(cols, 5, data);
    const buffer = term.buffer.active;
    const lines = readLogicalLines(buffer, 0, buffer.length).filter(
      (line) => line.runs.length > 0,
    );
    expect(texts(lines)).toEqual(expected);
  });

  test("枠の線だけの行には印を付ける", async () => {
    const term = await terminal(12, 3, "╭──────────╮\r\nplain");
    const buffer = term.buffer.active;
    expect(readLogicalLines(buffer, 0, 2).map((line) => line.rule)).toEqual([
      true,
      false,
    ]);
  });

  test("色の変わり目で区切る", async () => {
    const term = await terminal(20, 3, `${ESC}[1;31mred${ESC}[0m plain`);
    const [line] = readLogicalLines(term.buffer.active, 0, 1);
    expect(
      line.runs.map((run) => ({
        text: run.text,
        fg: run.style.fg,
        bold: (run.style.flags & STYLE.bold) !== 0,
      })),
    ).toEqual([
      { text: "red", fg: 1, bold: true },
      { text: " plain", fg: DEFAULT_COLOR, bold: false },
    ]);
  });
});

// エージェント (Claude Code など) はペインの幅で自分で改行を入れて書く。読む画面は
// それをスマホの幅でもう一度折るので、行の端が細切れになった (「回数が 4」「回」)。
// ペインの幅で入れた改行だけを見分けて、元の 1 文に繋ぎ直す。
describe("readParagraphs", () => {
  test.each([
    {
      name: "語の折り返しは空白で繋ぐ",
      data: "  hello world this\r\n  wraps here",
      expected: ["  hello world this wraps here"],
    },
    {
      name: "長い語の途中で切れた行は空白なしで繋ぐ",
      data: "  /very/long/path/na\r\n  me/rest",
      expected: ["  /very/long/path/name/rest"],
    },
    {
      name: "全角で右端まで詰まった行は空白なしで繋ぐ",
      data: "  日本語の文章がここ\r\n  で続きます",
      expected: ["  日本語の文章がここで続きます"],
    },
    {
      name: "全角の字の後ろで半角から続く行は空白で繋ぐ",
      data: "  日本語の文章がここ\r\n  → next",
      expected: ["  日本語の文章がここ → next"],
    },
    {
      name: "箇条書きの続きは、頭の後ろの字下げなら繋ぐ",
      data: "  - item text here\r\n    continues",
      expected: ["  - item text here continues"],
    },
    {
      name: "右端に次の語が入る余りがあれば繋がない",
      data: "  short line\r\n  next line",
      expected: ["  short line", "  next line"],
    },
    {
      name: "字下げが続きと違えば繋がない",
      data: "  hello world this\r\n    wraps",
      expected: ["  hello world this", "    wraps"],
    },
    {
      name: "次の行が箇条書きの頭なら繋がない",
      data: "  - item text here\r\n  - second",
      expected: ["  - item text here", "  - second"],
    },
    {
      name: "… で切った行は繋がない",
      data: "  a long line here…\r\n  next",
      expected: ["  a long line here…", "  next"],
    },
    {
      name: "罫線の行は繋がない",
      data: "────────────────────\r\n  text",
      expected: ["────────────────────", "  text"],
    },
  ])("$name", async ({ data, expected }) => {
    // 行の数は中身と同じ (空いた行を並べない)。
    const term = await terminal(20, 2, data);
    const buffer = term.buffer.active;
    expect(texts(readParagraphs(buffer, 0, buffer.length, 20))).toEqual(
      expected,
    );
  });

  // ペインの幅は後から変わる (PC で 59 桁だったペインが 210 桁に)。過去の行は書いた
  // ときの幅で改行されているので、今の幅で詰まり方を見ると繋がらなかった。
  // Claude Code が入力欄の上下に引く、幅いっぱいの罫線の長さを、その行を書いた
  // ときの幅とみなす。
  test.each([
    {
      name: "後ろの罫線が書いたときの幅を教える",
      data: "  hello world this\r\n  wraps here\r\n────────────────────",
      expected: ["  hello world this wraps here", "────────────────────"],
    },
    {
      name: "後ろに無ければ前の罫線",
      data: "────────────────────\r\n  hello world this\r\n  wraps here",
      expected: ["────────────────────", "  hello world this wraps here"],
    },
    {
      name: "罫線が無ければ今の幅で見る",
      data: "  hello world this\r\n  wraps here",
      expected: ["  hello world this", "  wraps here"],
    },
  ])("幅が変わったペイン: $name", async ({ data, expected }) => {
    const term = await terminal(40, 3, data);
    const buffer = term.buffer.active;
    expect(
      texts(readParagraphs(buffer, 0, buffer.length, 40)).filter(Boolean),
    ).toEqual(expected);
  });

  // スマホの幅で折り返した 2 行目以降を、文の始まり (箇条書きなら頭の後ろ) に揃える。
  test.each([
    { name: "箇条書き", data: "  - item text here\r\n    continues", hang: 4 },
    { name: "字下げだけ", data: "  plain text", hang: 2 },
    { name: "字下げなし", data: "top", hang: 0 },
  ])("揃える桁: $name", async ({ data, hang }) => {
    const term = await terminal(20, 2, data);
    const buffer = term.buffer.active;
    expect(readParagraphs(buffer, 0, buffer.length, 20)[0]?.hang).toBe(hang);
  });

  test("段落の続きの行からは、段落の頭の行までさかのぼる", async () => {
    const term = await terminal(
      20,
      6,
      "top\r\n  hello world this\r\n  wraps here",
    );
    const buffer = term.buffer.active;
    expect([0, 1, 2].map((y) => paragraphStart(buffer, y, 20))).toEqual([
      0, 1, 1,
    ]);
  });
});

// PC のペインが低いと、Claude Code が書き換えのたびに作業中の表示を上へ押し出し、
// 過去の行がそれで埋まって読む画面が読めなかった (作業中の印の行と入力欄の罫線が
// 4 割以上)。過去の行からだけ外す。
describe("withoutTransient", () => {
  test("作業中の印・入力欄の罫線と空の入力行・Waiting… を外し、続く空行をまとめる", async () => {
    const rule = "─".repeat(40);
    const rows = [
      "✻ Twisting… (1m 40s · ↓ 6.8k tokens)",
      "",
      rule,
      "❯ ",
      rule,
      "",
      "  - A: real content",
      "",
      "✻ Crunched for 2m 25s · done 19:29",
      "  ⎿  Waiting…",
      "",
      "  more content",
    ];
    const term = await terminal(40, rows.length, rows.join("\r\n"));
    const buffer = term.buffer.active;
    expect(
      texts(withoutTransient(readParagraphs(buffer, 0, buffer.length, 40))),
    ).toEqual([
      "",
      "  - A: real content",
      "",
      "✻ Crunched for 2m 25s · done 19:29",
      "",
      "  more content",
    ]);
  });

  test.each([
    { name: "字下げした罫線", row: `  ${"─".repeat(20)}` },
    { name: "文の入った入力行", row: "❯ 進捗教えて" },
    { name: "… で終わる普通の文", row: "  Loading the data…" },
  ])("残す: $name", async ({ row }) => {
    const term = await terminal(40, 1, row);
    const buffer = term.buffer.active;
    expect(
      texts(withoutTransient(readParagraphs(buffer, 0, buffer.length, 40))),
    ).toEqual([row]);
  });
});

describe("findChoices", () => {
  test.each([
    {
      name: "確認の選択肢 (今の選択に ❯)",
      lines: [
        " Do you want to proceed?",
        " ❯ 1. Yes",
        "   2. Yes, and don't ask again",
        "   3. No, and tell Claude what to do differently (esc)",
      ],
      expected: [
        { key: "1", label: "Yes" },
        { key: "2", label: "Yes, and don't ask again" },
        { key: "3", label: "No, and tell Claude what to do differently (esc)" },
      ],
    },
    {
      name: "1) の形",
      lines: ["1) apply", "2) skip"],
      expected: [
        { key: "1", label: "apply" },
        { key: "2", label: "skip" },
      ],
    },
    {
      name: "1 つだけの番号は選択肢ではない",
      lines: ["1. only one step"],
      expected: [],
    },
    {
      name: "1 から始まらない番号は選択肢ではない",
      lines: ["2. second", "3. third"],
      expected: [],
    },
    {
      name: "番号が飛んだら並びを切る",
      lines: ["1. a", "3. c"],
      expected: [],
    },
    {
      name: "上の手順の番号ではなく、いちばん下の並び",
      lines: ["1. read the file", "2. edit it", "Proceed?", "1. Yes", "2. No"],
      expected: [
        { key: "1", label: "Yes" },
        { key: "2", label: "No" },
      ],
    },
    {
      name: "長い選択肢は 48 字で切る",
      lines: [`1. ${"a".repeat(60)}`, "2. b"],
      expected: [
        { key: "1", label: `${"a".repeat(47)}…` },
        { key: "2", label: "b" },
      ],
    },
  ])("$name", ({ lines, expected }) => {
    expect(findChoices(lines)).toEqual(expected);
  });
});

describe("terminalPalette", () => {
  const palette = terminalPalette({ red: "#ff0000", white: "#eeeeee" });
  test.each([
    { name: "テーマの赤", index: 1, expected: "#ff0000" },
    {
      name: "テーマが持たない青は xterm の既定",
      index: 4,
      expected: "#3465a4",
    },
    { name: "テーマの白", index: 7, expected: "#eeeeee" },
    { name: "6x6x6 の最初", index: 16, expected: "#000000" },
    { name: "6x6x6 の途中", index: 174, expected: "#d78787" },
    { name: "6x6x6 の最後", index: 231, expected: "#ffffff" },
    { name: "灰の最初", index: 232, expected: "#080808" },
    { name: "灰の最後", index: 255, expected: "#eeeeee" },
  ])("$name", ({ index, expected }) => {
    expect(palette[index]).toBe(expected);
  });
});

describe("readableColor", () => {
  test.each([
    {
      name: "読める色はそのまま",
      color: "#eeeeec",
      background: "#1e1e2e",
      expected: "#eeeeec",
    },
    {
      name: "暗い地の上の暗い灰は明るくする",
      color: "#444444",
      background: "#000000",
      expected: "#7c7c7c",
    },
    {
      name: "明るい地の上の明るい黄は暗くする",
      color: "#fce94f",
      background: "#ffffff",
      expected: "#7e7528",
    },
    {
      name: "読めない形式はそのまま",
      color: "rgb(1, 2, 3)",
      background: "#000000",
      expected: "rgb(1, 2, 3)",
    },
  ])("$name", ({ color, background, expected }) => {
    expect(readableColor(color, background, 4.5)).toBe(expected);
  });
});

describe("runCss", () => {
  const colors = {
    palette: terminalPalette({}),
    foreground: "#eeeeec",
    background: "#000000",
    minimumContrastRatio: 1,
  };
  test.each([
    {
      name: "既定の色",
      style: { fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, flags: 0 },
      expected: "color:#eeeeec",
    },
    {
      name: "パレットの色と太字・下線",
      style: { fg: 2, bg: DEFAULT_COLOR, flags: STYLE.bold | STYLE.underline },
      expected: "color:#4e9a06;font-weight:700;text-decoration:underline",
    },
    {
      name: "RGB の地",
      style: { fg: DEFAULT_COLOR, bg: 0x1000000 | 0x123456, flags: 0 },
      expected: "color:#eeeeec;background-color:#123456",
    },
    {
      name: "反転は文字と地を入れ替える",
      style: { fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, flags: STYLE.inverse },
      expected: "color:#000000;background-color:#eeeeec",
    },
  ])("$name", ({ style, expected }) => {
    expect(runCss(style, colors)).toBe(expected);
  });
});

describe("paneSnapshotSequence", () => {
  const base: TmuxPaneSnapshot = {
    pane: "%3",
    content: "one\ntwo\nthree",
    width: 20,
    height: 3,
    cursorX: 2,
    cursorY: 1,
    historyLines: 0,
    cursorVisible: true,
    alternate: false,
    appCursorKeys: false,
    appKeypad: false,
    insert: false,
    wrap: true,
    origin: false,
    scrollTop: 0,
    scrollBottom: 2,
  };

  test.each([
    {
      name: "画面とカーソルを戻す",
      snapshot: base,
      expected: {
        lines: ["one", "two", "three"],
        cursor: [2, 1],
        type: "normal",
        appCursor: false,
      },
    },
    {
      name: "別画面を使っていたら別画面に書く",
      snapshot: { ...base, alternate: true },
      expected: {
        lines: ["one", "two", "three"],
        cursor: [2, 1],
        type: "alternate",
        appCursor: false,
      },
    },
    {
      name: "矢印キーのモードを戻す",
      snapshot: { ...base, appCursorKeys: true },
      expected: {
        lines: ["one", "two", "three"],
        cursor: [2, 1],
        type: "normal",
        appCursor: true,
      },
    },
    {
      name: "原点のモードではスクロールの範囲の中でカーソルを置く",
      snapshot: { ...base, origin: true, scrollTop: 1, cursorY: 2 },
      expected: {
        lines: ["one", "two", "three"],
        cursor: [2, 2],
        type: "normal",
        appCursor: false,
      },
    },
  ])("$name", async ({ snapshot, expected }) => {
    const term = await terminal(
      snapshot.width,
      snapshot.height,
      paneSnapshotSequence(snapshot),
    );
    const buffer = term.buffer.active;
    expect({
      lines: texts(readLogicalLines(buffer, 0, buffer.length)),
      cursor: [buffer.cursorX, buffer.cursorY],
      type: buffer.type,
      appCursor: term.modes.applicationCursorKeysMode,
    }).toEqual(expected);
  });
});
