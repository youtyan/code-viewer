// 本文を「前回の続きから」切り出す純関数。
//
// ここが狂うと、他のエージェントへ渡すコンテキストが黙って欠ける。欠けるより
// 重複するほうが安全という設計なので、追えなかったときに reset が立って全部
// 返ることまで含めて固定する。

import { describe, expect, test } from "vitest";
import {
  hashLine,
  sliceShellBuffer,
  sliceTmuxCapture,
} from "../core/terminal-capture";

describe("sliceTmuxCapture", () => {
  test("カーソルが無ければ全部返し、reset は立てない", () => {
    const result = sliceTmuxCapture("one\ntwo\n", null);
    expect(result.content).toBe("one\ntwo\n");
    expect(result.reset).toBe(false);
  });

  test("前回の続きだけを返す", () => {
    const first = sliceTmuxCapture("one\ntwo\n", null);
    const second = sliceTmuxCapture("one\ntwo\nthree\nfour\n", first.cursor);
    expect(second.content).toBe("three\nfour");
    expect(second.reset).toBe(false);
  });

  test("何も増えていなければ空を返す", () => {
    const first = sliceTmuxCapture("one\ntwo\n", null);
    const second = sliceTmuxCapture("one\ntwo\n", first.cursor);
    expect(second.content).toBe("");
    expect(second.reset).toBe(false);
  });

  test("前回位置の行が書き換わったら全部返して reset を立てる", () => {
    // TUI のエージェントは今の画面を描き直すので、この経路を必ず通る。
    const first = sliceTmuxCapture("one\nspinner A\n", null);
    const second = sliceTmuxCapture("one\nspinner B\nthree\n", first.cursor);
    expect(second.content).toBe("one\nspinner B\nthree\n");
    expect(second.reset).toBe(true);
  });

  test("履歴が切り詰められて短くなったら reset を立てる", () => {
    const first = sliceTmuxCapture("a\nb\nc\nd\n", null);
    const second = sliceTmuxCapture("c\nd\n", first.cursor);
    expect(second.reset).toBe(true);
    expect(second.content).toBe("c\nd\n");
  });

  test("履歴の窓がずれたら、最終行が同じでも取りこぼさない", () => {
    // シェルのプロンプトは何度も同じ文字列になる。最終行だけで照合すると、
    // 窓がずれて中身が総入れ替えされても「増えていない」と誤判定し、間の
    // 本文が黙って消える。
    const prompt = "user@host:~$ ";
    const before = ["a", "b", "c", "d", prompt].join("\n");
    const after = ["e", "f", "g", "h", prompt].join("\n");
    const first = sliceTmuxCapture(before, null);
    const second = sliceTmuxCapture(after, first.cursor);
    expect(second.content).not.toBe("");
    expect(second.reset).toBe(true);
  });

  test.each([
    { name: "壊れたカーソル", cursor: "garbage" },
    { name: "別方式のカーソル", cursor: "s120" },
    { name: "区切りの足りないカーソル", cursor: "t12" },
    { name: "区切りが 1 つだけのカーソル", cursor: "t12.abc" },
    { name: "負の行数", cursor: "t-3.abc.def" },
    { name: "数字に混ざり物があるカーソル", cursor: "t12junk.abc.def" },
    { name: "桁溢れした行数", cursor: "t99999999999999999999.abc.def" },
  ])("$name は全部返し、重複する前提を伝える", ({ cursor }) => {
    // 受け手は reset=false を「これは続き」と解釈して追記する。読めない
    // カーソルで false を返すと、前回分と重複したまま気付けない。
    const result = sliceTmuxCapture("one\ntwo\n", cursor);
    expect(result.content).toBe("one\ntwo\n");
    expect(result.reset).toBe(true);
  });

  test("空文字のカーソルは初回として扱う", () => {
    const result = sliceTmuxCapture("one\ntwo\n", "");
    expect(result.content).toBe("one\ntwo\n");
    expect(result.reset).toBe(false);
  });

  test("空の画面でもカーソルを返す", () => {
    const result = sliceTmuxCapture("", null);
    expect(result.content).toBe("");
    expect(result.cursor).not.toBe("");
  });
});

describe("sliceShellBuffer", () => {
  test("カーソルが無ければ溜め置きを全部返す", () => {
    const result = sliceShellBuffer("hello", 5, null);
    expect(result.content).toBe("hello");
    expect(result.reset).toBe(false);
  });

  test("前回位置から先だけを返す", () => {
    const first = sliceShellBuffer("hello", 5, null);
    const second = sliceShellBuffer("hello world", 11, first.cursor);
    expect(second.content).toBe(" world");
    expect(second.reset).toBe(false);
  });

  test("増えていなければ空を返す", () => {
    const first = sliceShellBuffer("hello", 5, null);
    const second = sliceShellBuffer("hello", 5, first.cursor);
    expect(second.content).toBe("");
    expect(second.reset).toBe(false);
  });

  test.each([
    {
      name: "境界: 捨てられた直後の位置はまだ取り出せる",
      cursor: "s5",
      expectedContent: "56789",
      expectedReset: false,
    },
    {
      name: "境界: 1 文字ぶん古い位置は取り出せない",
      cursor: "s4",
      expectedContent: "56789",
      expectedReset: true,
    },
    {
      name: "境界: 最新位置は空",
      cursor: "s10",
      expectedContent: "",
      expectedReset: false,
    },
    {
      name: "未来の位置は追えない",
      cursor: "s11",
      expectedContent: "56789",
      expectedReset: true,
    },
  ])("$name", ({ cursor, expectedContent, expectedReset }) => {
    // 累積 10 文字のうち、末尾 5 文字だけ残っている状態。
    const result = sliceShellBuffer("56789", 10, cursor);
    expect(result.content).toBe(expectedContent);
    expect(result.reset).toBe(expectedReset);
  });

  test.each([
    { name: "壊れたカーソル", cursor: "garbage" },
    { name: "別方式のカーソル", cursor: "t3.abc.def" },
    { name: "負の位置", cursor: "s-1" },
    { name: "数字に混ざり物がある位置", cursor: "s10junk" },
    { name: "桁溢れした位置", cursor: "s99999999999999999999" },
  ])("$name は全部返し、重複する前提を伝える", ({ cursor }) => {
    const result = sliceShellBuffer("56789", 10, cursor);
    expect(result.content).toBe("56789");
    expect(result.reset).toBe(true);
  });

  test("空文字のカーソルは初回として扱う", () => {
    const result = sliceShellBuffer("56789", 10, "");
    expect(result.content).toBe("56789");
    expect(result.reset).toBe(false);
  });
});

describe("hashLine", () => {
  test.each([
    { name: "同じ行は同じ値", a: "hello", b: "hello", same: true },
    { name: "1 文字違えば別の値", a: "hello", b: "hellp", same: false },
    { name: "空行と空白行は別の値", a: "", b: " ", same: false },
    { name: "順序が違えば別の値", a: "ab", b: "ba", same: false },
  ])("$name", ({ a, b, same }) => {
    expect(hashLine(a) === hashLine(b)).toBe(same);
  });

  test("カーソルに埋め込める形になっている", () => {
    // カーソルは `t<行数>.<ハッシュ>` なので、ハッシュに区切りが入ると壊れる。
    expect(hashLine("any line")).not.toContain(".");
  });
});
