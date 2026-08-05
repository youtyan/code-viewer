// capture-pane -e が返す画面を、そのまま xterm へ流せる形に整える部分。
//
// tmux は行ごとに色を閉じない。ステータスラインのように行末まで背景色が続く
// 行があると、その色が次の行以降へ引き継がれ、画面の残りが丸ごと塗り潰される
// (全画面アプリでは画面全体がステータス行の色になる、という壊れ方をした)。
// tmux の画面では行が独立しているので、行の切れ目で必ず既定へ戻す。
//
// 制御文字はソースに直書きせず、ESC から組み立てる。

import { describe, expect, test } from "vitest";
import { closeLineColors } from "../server/tmux/capture";

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
/** 背景を真っ青にする SGR。全画面アプリのステータス行を模す。 */
const BLUE_BG = `${ESC}[48;2;137;180;250m`;
/** 背景色を指定する 8 色 SGR。 */
const BLUE_BG_BASIC = `${ESC}[44m`;

const SGR_PATTERN = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

/** 行が「背景色を開いたまま」終わっているか。 */
function endsWithOpenBackground(line: string): boolean {
  let open = false;
  for (const match of line.matchAll(SGR_PATTERN)) {
    const code = match[1];
    if (code === "" || code === "0" || code === "49") open = false;
    else if (/(^|;)(4[0-7]|10[0-7])(;|$)/.test(code) || code.includes("48;"))
      open = true;
  }
  return open;
}

function stripSgr(text: string): string {
  return text.replace(SGR_PATTERN, "");
}

describe("closeLineColors", () => {
  test.each([
    {
      name: "色を使っていない行にも閉じを足す",
      input: "plain",
      expected: `plain${RESET}`,
    },
    {
      name: "背景色が開いたまま終わる行を閉じる",
      input: `${BLUE_BG}NORMAL`,
      expected: `${BLUE_BG}NORMAL${RESET}`,
    },
    {
      name: "行ごとに閉じる",
      input: `${BLUE_BG}NORMAL\nnext`,
      expected: `${BLUE_BG}NORMAL${RESET}\nnext${RESET}`,
    },
    {
      name: "空行はそのまま (前の行が閉じているので足す意味がない)",
      input: `${BLUE_BG}NORMAL\n\nnext`,
      expected: `${BLUE_BG}NORMAL${RESET}\n\nnext${RESET}`,
    },
    {
      name: "末尾の改行を増やさない",
      input: "one\ntwo\n",
      expected: `one${RESET}\ntwo${RESET}\n`,
    },
    {
      name: "空の画面は空のまま",
      input: "",
      expected: "",
    },
  ])("$name", ({ input, expected }) => {
    expect(closeLineColors(input)).toBe(expected);
  });

  test("背景色を開いたまま終わる行が 1 つも残らない", () => {
    // 画面を模した本文。1 行目と 3 行目が背景色を開いたまま終わる。
    const screen = [
      `${BLUE_BG}NORMAL  main`,
      "  372 # comment",
      `${BLUE_BG_BASIC}status`,
      "  373 code",
    ].join("\n");
    expect(screen.split("\n").filter(endsWithOpenBackground)).toHaveLength(2);

    const closed = closeLineColors(screen);
    expect(closed.split("\n").filter(endsWithOpenBackground)).toHaveLength(0);
  });

  test("本文の文字は落とさない", () => {
    const screen = `${BLUE_BG}NORMAL\n  372 # comment\n`;
    expect(stripSgr(closeLineColors(screen))).toBe("NORMAL\n  372 # comment\n");
  });
});
