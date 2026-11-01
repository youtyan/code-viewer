// capture-pane -e が返す画面を、そのまま xterm へ流せる形に整える部分。
//
// tmux は行ごとに色を閉じない。ステータスラインのように行末まで背景色が続く
// 行があると、その色が次の行以降へ引き継がれ、画面の残りが丸ごと塗り潰される
// (全画面アプリでは画面全体がステータス行の色になる、という壊れ方をした)。
// tmux の画面では行が独立しているので、行の切れ目で必ず既定へ戻す。
//
// 制御文字はソースに直書きせず、ESC から組み立てる。

import { describe, expect, test, vi } from "vitest";
import type { TmuxRunResult } from "../server/tmux/command";

const mocks = vi.hoisted(() => ({ runTmux: vi.fn() }));
vi.mock("../server/tmux/command", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/tmux/command")>()),
  runTmux: mocks.runTmux,
}));

import {
  captureTmuxPanes,
  closeLineColors,
  type TmuxCaptureResult,
} from "../server/tmux/capture";

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

/**
 * tmux が返す本文: ペインごとに、頼まれた区切り・ペイン ID・大きさの行と画面。
 * 区切りは呼ぶたびに変わるので、頼まれた -F から読む。
 */
function screens(
  args: string[],
  panes: Array<[string, string]>,
): TmuxRunResult {
  const format = args[args.indexOf("-F") + 1] ?? "";
  const marker = format.slice(0, format.indexOf("#{pane_id}"));
  return {
    status: "ok",
    stdout: panes
      .map(([pane, text]) => `${marker}${pane} 80 24 1 2 0\n${text}\n`)
      .join(""),
  };
}

function summary(result: TmuxCaptureResult): string {
  if (result.status === "ok")
    return `ok ${result.screen.pane} ${result.screen.content}`;
  if (result.status === "gone") return "gone";
  return `error ${result.error.message}`;
}

describe("captureTmuxPanes", () => {
  test.each([
    {
      name: "1 回の tmux で全部のペインを読む",
      replies: [
        (args: string[]) =>
          screens(args, [
            ["%1", "one"],
            ["%2", "two"],
          ]),
      ],
      expected: [`ok %1 one${RESET}\n`, `ok %2 two${RESET}\n`],
    },
    {
      name: "閉じたペインがあれば 1 本ずつ読み直し、閉じたものは gone",
      replies: [
        (): TmuxRunResult => ({ status: "no-target" }),
        (args: string[]) => screens(args, [["%1", "one"]]),
        (): TmuxRunResult => ({ status: "no-target" }),
      ],
      expected: [`ok %1 one${RESET}\n`, "gone"],
    },
    {
      name: "画面の数が合わなければ全部を失敗にする",
      replies: [(args: string[]) => screens(args, [["%1", "one"]])],
      expected: [
        "error tmux capture returned 1 screens for 2 panes (%1 %2)",
        "error tmux capture returned 1 screens for 2 panes (%1 %2)",
      ],
    },
    {
      name: "別のペインの画面が返れば、そのペインだけ失敗にする",
      replies: [
        (args: string[]) =>
          screens(args, [
            ["%1", "one"],
            ["%3", "three"],
          ]),
      ],
      expected: [
        `ok %1 one${RESET}\n`,
        "error tmux capture of %2 returned the screen of %3",
      ],
    },
  ])("$name", async ({ replies, expected }) => {
    mocks.runTmux.mockReset();
    for (const reply of replies)
      mocks.runTmux.mockImplementationOnce(async (args: string[]) =>
        reply(args),
      );

    const results = await captureTmuxPanes(["%1", "%2"], "/repo");

    expect(results.map(summary)).toEqual(expected);
    expect(mocks.runTmux).toHaveBeenCalledTimes(replies.length);
  });
});
