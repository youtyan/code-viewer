import { describe, expect, test } from "bun:test";
import { toTmuxKeyBytes } from "../server/tmux/keys";

// 制御文字はソースに直接置くと見た目で判別できないので、コード指定で作る。
const CTRL_C = String.fromCharCode(3);
const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);

describe("toTmuxKeyBytes", () => {
  test.each([
    { name: "converts plain ascii", data: "hi", expected: ["68", "69"] },
    { name: "converts a space", data: " ", expected: ["20"] },
    { name: "converts carriage return", data: "\r", expected: ["0d"] },
    { name: "converts newline", data: "\n", expected: ["0a"] },
    { name: "converts tab", data: "\t", expected: ["09"] },
    { name: "converts Ctrl-C", data: CTRL_C, expected: ["03"] },
    { name: "converts Escape", data: ESC, expected: ["1b"] },
    { name: "pads a zero byte to two digits", data: NUL, expected: ["00"] },
    {
      name: "converts an arrow key sequence",
      data: `${ESC}[A`,
      expected: ["1b", "5b", "41"],
    },
    {
      name: "converts a multibyte character as its utf-8 bytes",
      data: "あ",
      expected: ["e3", "81", "82"],
    },
    {
      name: "converts an emoji as four bytes",
      data: "🙂",
      expected: ["f0", "9f", "99", "82"],
    },
    {
      name: "passes shell metacharacters through as bytes",
      data: "; rm",
      expected: ["3b", "20", "72", "6d"],
    },
    { name: "returns nothing for an empty string", data: "", expected: [] },
  ])("$name", ({ data, expected }) => {
    expect(toTmuxKeyBytes(data)).toEqual(expected);
  });

  test("emits one two-digit token per byte", () => {
    const bytes = toTmuxKeyBytes("日本語テキスト");
    // 7 文字 × UTF-8 3 バイト。
    expect(bytes).toHaveLength(21);
    expect(bytes.every((token) => /^[0-9a-f]{2}$/.test(token))).toBe(true);
  });
});
