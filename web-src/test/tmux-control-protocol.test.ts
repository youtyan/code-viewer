// tmux の control mode の行を、ペインの出力・コマンドの返事・窓の知らせに
// 読み分けるところ。ここが狂うと SP の 1 ペイン表示に別のペインの出力が混ざったり、
// コマンドの返事の中身を出力として流したりする。

import { describe, expect, test } from "vitest";
import {
  createControlParser,
  unescapeControlOutput,
} from "../server/tmux/control-protocol";

const bytes = (text: string) => Buffer.from(text, "utf8");

describe("unescapeControlOutput", () => {
  test.each([
    { name: "そのままの文字", input: "abc", expected: [0x61, 0x62, 0x63] },
    { name: "ESC", input: "\\033[0m", expected: [0x1b, 0x5b, 0x30, 0x6d] },
    { name: "CR LF", input: "\\015\\012", expected: [0x0d, 0x0a] },
    { name: "バックスラッシュそのもの", input: "\\134", expected: [0x5c] },
    {
      name: "8 進が 3 桁に満たない",
      input: "\\03",
      expected: [0x5c, 0x30, 0x33],
    },
    {
      name: "8 進でない数字",
      input: "\\089",
      expected: [0x5c, 0x30, 0x38, 0x39],
    },
    {
      name: "日本語はバイトのまま",
      input: "日",
      expected: [0xe6, 0x97, 0xa5],
    },
  ])("$name", ({ input, expected }) => {
    expect([...unescapeControlOutput(bytes(input))]).toEqual(expected);
  });
});

describe("createControlParser", () => {
  test.each([
    {
      name: "ペインの出力",
      lines: ["%output %3 hi\\015\\012"],
      expected: [{ kind: "output", pane: "%3", text: "hi\r\n" }],
    },
    {
      name: "pause-after を使ったときの出力",
      lines: ["%extended-output %3 120 : ok"],
      expected: [{ kind: "output", pane: "%3", text: "ok" }],
    },
    {
      name: "送ったコマンドの返事",
      lines: ["%begin 1 7 1", "80 24", "%end 1 7 1"],
      expected: [{ kind: "reply", ours: true, ok: true, lines: ["80 24"] }],
    },
    {
      name: "失敗した返事",
      lines: ["%begin 1 8 1", "can't find pane: %9", "%error 1 8 1"],
      expected: [
        {
          kind: "reply",
          ours: true,
          ok: false,
          lines: ["can't find pane: %9"],
        },
      ],
    },
    {
      name: "繋いだ直後の attach の返事は自分のものではない",
      lines: ["%begin 1 3 0", "%end 1 3 0"],
      expected: [{ kind: "reply", ours: false, ok: true, lines: [] }],
    },
    {
      name: "返事の中の %end らしい行は番号が違えば中身",
      lines: ["%begin 1 9 1", "%end 1 2 1", "%output %1 x", "%end 1 9 1"],
      expected: [
        {
          kind: "reply",
          ours: true,
          ok: true,
          lines: ["%end 1 2 1", "%output %1 x"],
        },
      ],
    },
    {
      name: "窓の並びが変わった",
      lines: ["%layout-change @4 ab12,80x24,0,0,3 ab12,80x24,0,0,3 *"],
      expected: [{ kind: "layout", window: "@4" }],
    },
    {
      name: "窓が閉じた",
      lines: ["%window-close @4", "%unlinked-window-close @5"],
      expected: [
        { kind: "window-close", window: "@4" },
        { kind: "window-close", window: "@5" },
      ],
    },
    {
      name: "外された",
      lines: ["%exit server exited"],
      expected: [{ kind: "exit", reason: "server exited" }],
    },
    {
      name: "使わない知らせ",
      lines: ["%session-changed $0 sample"],
      expected: [{ kind: "other", line: "%session-changed $0 sample" }],
    },
  ])("$name", ({ lines, expected }) => {
    const events = createControlParser().feed(bytes(`${lines.join("\n")}\n`));
    expect(
      events.map((event) =>
        event.kind === "output"
          ? { kind: event.kind, pane: event.pane, text: event.data.toString() }
          : event.kind === "reply"
            ? { ...event, lines: event.lines.map((line) => line.toString()) }
            : event,
      ),
    ).toEqual(expected);
  });

  test("行の途中で切れて届いても、続きと繋いで 1 行として読む", () => {
    const parser = createControlParser();
    const first = parser.feed(bytes("%output %2 ab"));
    const second = parser.feed(bytes("c\n%output %2 d\n"));
    expect([
      first.length,
      second.map((event) =>
        event.kind === "output" ? event.data.toString() : event.kind,
      ),
    ]).toEqual([0, ["abc", "d"]]);
  });

  test("UTF-8 の 1 文字が 2 回に分かれても、バイトを欠かさない", () => {
    const parser = createControlParser();
    const whole = bytes("%output %2 日\n");
    const events = [
      ...parser.feed(whole.subarray(0, 12)),
      ...parser.feed(whole.subarray(12)),
    ];
    expect(
      events.map((event) =>
        event.kind === "output" ? event.data.toString("utf8") : event.kind,
      ),
    ).toEqual(["日"]);
  });
});
