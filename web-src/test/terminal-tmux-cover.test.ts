// tmux のウインドウの外側 (tmux が点で埋める所) を覆う範囲
// (views/terminal/tmux-cover.ts)。
//
// ここがずれると、点が見えたまま残るか、ウインドウの中身 (エージェントの
// 画面・ステータスの行) を覆って隠す。ステータスの行数と位置の組み合わせを
// 全部並べる。

import { describe, expect, test } from "vitest";
import type { TmuxClientWindow } from "../core/tmux";
import { tmuxCover } from "../views/terminal/tmux-cover";

function frame(over: Partial<TmuxClientWindow>): TmuxClientWindow {
  return {
    clientCols: 132,
    clientRows: 48,
    windowCols: 132,
    windowRows: 47,
    statusLines: 1,
    statusAt: "bottom",
    sessionClients: 1,
    ...over,
  };
}

describe("tmuxCover", () => {
  test.each([
    {
      name: "アプリだけ (ウインドウが端末いっぱい): 覆わない",
      window: frame({}),
      expected: { rects: [], messageIn: -1 },
    },
    {
      name: "ステータスなしで端末いっぱい: 覆わない",
      window: frame({ windowRows: 48, statusLines: 0 }),
      expected: { rects: [], messageIn: -1 },
    },
    {
      name: "下に 1 行・高さだけ小さい (砂場の S1: 132x48 の端末に 132x29)",
      window: frame({ windowRows: 29 }),
      expected: {
        rects: [{ top: 29, left: 0, rows: 18, cols: 132 }],
        messageIn: 0,
      },
    },
    {
      name: "上に 1 行・高さだけ小さい",
      window: frame({ windowRows: 29, statusAt: "top" }),
      expected: {
        rects: [{ top: 30, left: 0, rows: 18, cols: 132 }],
        messageIn: 0,
      },
    },
    {
      name: "下に 2 行・高さだけ小さい",
      window: frame({ windowRows: 29, statusLines: 2 }),
      expected: {
        rects: [{ top: 29, left: 0, rows: 17, cols: 132 }],
        messageIn: 0,
      },
    },
    {
      name: "上に 2 行・高さだけ小さい",
      window: frame({ windowRows: 29, statusLines: 2, statusAt: "top" }),
      expected: {
        rects: [{ top: 31, left: 0, rows: 17, cols: 132 }],
        messageIn: 0,
      },
    },
    {
      name: "ステータスなし・高さだけ小さい",
      window: frame({ windowRows: 29, statusLines: 0 }),
      expected: {
        rects: [{ top: 29, left: 0, rows: 19, cols: 132 }],
        messageIn: 0,
      },
    },
    {
      name: "幅だけ小さい (下に 1 行)",
      window: frame({ windowCols: 100 }),
      expected: {
        rects: [{ top: 0, left: 100, rows: 47, cols: 32 }],
        messageIn: 0,
      },
    },
    {
      name: "幅だけ小さい (上に 1 行)",
      window: frame({ windowCols: 100, statusAt: "top" }),
      expected: {
        rects: [{ top: 1, left: 100, rows: 47, cols: 32 }],
        messageIn: 0,
      },
    },
    {
      name: "幅も高さも小さい (利用者の画面の形: 上に 1 行)。案内は広い方 (下)",
      window: frame({
        clientCols: 378,
        clientRows: 113,
        windowCols: 300,
        windowRows: 104,
        statusAt: "top",
      }),
      expected: {
        rects: [
          { top: 1, left: 300, rows: 104, cols: 78 },
          { top: 105, left: 0, rows: 8, cols: 378 },
        ],
        messageIn: 0,
      },
    },
    {
      name: "幅も高さも小さい (下に 1 行)。案内は広い方",
      window: frame({ windowCols: 120, windowRows: 20 }),
      expected: {
        rects: [
          { top: 0, left: 120, rows: 20, cols: 12 },
          { top: 20, left: 0, rows: 27, cols: 132 },
        ],
        messageIn: 1,
      },
    },
    {
      name: "ウインドウが端末より大きい (見える範囲だけ映す): 覆わない",
      window: frame({ windowCols: 200, windowRows: 60 }),
      expected: { rects: [], messageIn: -1 },
    },
    {
      name: "ウインドウの幅だけ大きく、高さは小さい: 下だけ覆う",
      window: frame({ windowCols: 200, windowRows: 29 }),
      expected: {
        rects: [{ top: 29, left: 0, rows: 18, cols: 132 }],
        messageIn: 0,
      },
    },
  ])("$name", ({ window, expected }) => {
    expect(tmuxCover(window)).toEqual(expected);
  });
});
