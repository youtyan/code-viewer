// 電話の幅の骨格の純関数 (core/mobile-layout.ts)。幅の段・差分の並べ方・左端の
// スワイプ・ソフトキーボードの高さ・端末の操作札のバイト列。
import { describe, expect, test } from "vitest";
import {
  bottomSwipeAction,
  DRAWER_DRAG_START,
  diffLayoutFor,
  drawerDragOffset,
  EDGE_SWIPE_START_MAX_X,
  edgeSwipeAction,
  LONG_PRESS_MOVE_TOLERANCE,
  longPressMoved,
  mobileBarCurrent,
  PHONE_LANDSCAPE_MEDIA_QUERY,
  PHONE_MEDIA_QUERY,
  pinchFontSize,
  SOFT_KEYS_MEDIA_QUERY,
  softKeyboardInset,
  softKeySequence,
  type TerminalSoftKey,
  TOUCH_MEDIA_QUERY,
  viewportTier,
} from "../core/mobile-layout";

describe("viewportTier", () => {
  test.each([
    {
      name: "縦の電話 (390)",
      width: 390,
      height: 844,
      coarse: true,
      expected: "phone",
    },
    {
      name: "境界: 639 はマウスでも電話",
      width: 639,
      height: 900,
      coarse: false,
      expected: "phone",
    },
    {
      name: "境界: 640 はマウスでも電話",
      width: 640,
      height: 900,
      coarse: false,
      expected: "phone",
    },
    {
      name: "境界: 641 のマウスはデスクトップ",
      width: 641,
      height: 900,
      coarse: false,
      expected: "desktop",
    },
    {
      name: "横の電話 (844×390) は指なので電話",
      width: 844,
      height: 390,
      coarse: true,
      expected: "phone",
    },
    {
      name: "境界: 指で高さ 499 は電話",
      width: 900,
      height: 499,
      coarse: true,
      expected: "phone",
    },
    {
      name: "境界: 指で高さ 500 は電話",
      width: 900,
      height: 500,
      coarse: true,
      expected: "phone",
    },
    {
      name: "境界: 指で高さ 501 はデスクトップ (タブレット)",
      width: 900,
      height: 501,
      coarse: true,
      expected: "desktop",
    },
    {
      name: "低いマウスの窓 (1280×400) はデスクトップ",
      width: 1280,
      height: 400,
      coarse: false,
      expected: "desktop",
    },
    {
      name: "デスクトップ 1280×800",
      width: 1280,
      height: 800,
      coarse: false,
      expected: "desktop",
    },
    {
      name: "デスクトップ 1600×900",
      width: 1600,
      height: 900,
      coarse: false,
      expected: "desktop",
    },
  ])("$name → $expected", ({ width, height, coarse, expected }) => {
    expect(viewportTier({ width, height, coarsePointer: coarse })).toBe(
      expected,
    );
  });

  test("media query の文字列は同じ境界から作る", () => {
    expect(PHONE_MEDIA_QUERY).toBe(
      "(max-width: 640px), (pointer: coarse) and (max-height: 500px)",
    );
    expect(PHONE_LANDSCAPE_MEDIA_QUERY).toBe(
      "(pointer: coarse) and (max-height: 500px)",
    );
    expect(TOUCH_MEDIA_QUERY).toBe("(pointer: coarse)");
    expect(SOFT_KEYS_MEDIA_QUERY).toBe("(max-width: 640px), (pointer: coarse)");
  });
});

// 電話の段では 2 列の差分が幅に入らないので 1 列が既定。電話で切り替えたものは
// その場だけ効き、デスクトップは保存した並べ方のまま。
describe("diffLayoutFor", () => {
  test.each([
    ["desktop", "side-by-side", null, "side-by-side"],
    ["desktop", "line-by-line", null, "line-by-line"],
    ["desktop", "side-by-side", "line-by-line", "side-by-side"],
    ["phone", "side-by-side", null, "line-by-line"],
    ["phone", "line-by-line", null, "line-by-line"],
    ["phone", "line-by-line", "side-by-side", "side-by-side"],
    ["phone", "side-by-side", "line-by-line", "line-by-line"],
  ] as const)("%s, saved %s, chosen on the phone %s → %s", (tier, saved, chosen, expected) => {
    expect(diffLayoutFor(tier, saved, chosen)).toBe(expected);
  });
});

describe("edgeSwipeAction", () => {
  test.each([
    {
      name: "左端から右へ 56 で開く",
      startX: 10,
      endX: 66,
      startY: 300,
      endY: 300,
      open: false,
      expected: "open",
    },
    {
      name: "境界: 右へ 55 は短いので何もしない",
      startX: 10,
      endX: 65,
      startY: 300,
      endY: 300,
      open: false,
      expected: null,
    },
    {
      name: "境界: 端から 24 で始めると開く",
      startX: 24,
      endX: 124,
      startY: 300,
      endY: 300,
      open: false,
      expected: "open",
    },
    {
      name: "境界: 端から 25 で始めると開かない (本文の横送り)",
      startX: 25,
      endX: 125,
      startY: 300,
      endY: 300,
      open: false,
      expected: null,
    },
    {
      name: "縦が横より大きいのはスクロール",
      startX: 5,
      endX: 105,
      startY: 100,
      endY: 220,
      open: false,
      expected: null,
    },
    {
      name: "境界: 縦と横が同じはスクロール扱い",
      startX: 5,
      endX: 105,
      startY: 100,
      endY: 200,
      open: false,
      expected: null,
    },
    {
      name: "閉じている間の左へは何もしない",
      startX: 200,
      endX: 50,
      startY: 300,
      endY: 300,
      open: false,
      expected: null,
    },
    {
      name: "開いている間に左へ 56 で閉じる",
      startX: 200,
      endX: 144,
      startY: 300,
      endY: 300,
      open: true,
      expected: "close",
    },
    {
      name: "開いている間の右へは何もしない",
      startX: 5,
      endX: 200,
      startY: 300,
      endY: 300,
      open: true,
      expected: null,
    },
  ])("$name", ({ startX, endX, startY, endY, open, expected }) => {
    expect(
      edgeSwipeAction({ startX, startY, endX, endY, drawerOpen: open }),
    ).toBe(expected);
  });
});

describe("softKeyboardInset", () => {
  test.each([
    {
      name: "キーボード無し",
      inner: 844,
      height: 844,
      offset: 0,
      scale: 1,
      expected: 0,
    },
    {
      name: "縮めないブラウザでキーボード 336",
      inner: 844,
      height: 508,
      offset: 0,
      scale: 1,
      expected: 336,
    },
    {
      name: "見えている部分が下へずれた分は隠れていない",
      inner: 844,
      height: 508,
      offset: 100,
      scale: 1,
      expected: 236,
    },
    {
      name: "境界: 119 はブラウザの帯の出入り",
      inner: 844,
      height: 725,
      offset: 0,
      scale: 1,
      expected: 0,
    },
    {
      name: "境界: 120 はキーボード",
      inner: 844,
      height: 724,
      offset: 0,
      scale: 1,
      expected: 120,
    },
    {
      name: "縮めるブラウザ (innerHeight も縮む) は 0",
      inner: 508,
      height: 508,
      offset: 0,
      scale: 1,
      expected: 0,
    },
    {
      name: "ピンチで拡大中は測らない",
      inner: 844,
      height: 400,
      offset: 0,
      scale: 2,
      expected: 0,
    },
  ])("$name", ({ inner, height, offset, scale, expected }) => {
    expect(
      softKeyboardInset({
        innerHeight: inner,
        viewportHeight: height,
        viewportOffsetTop: offset,
        scale,
      }),
    ).toBe(expected);
  });
});

describe("softKeySequence", () => {
  test.each<{ key: TerminalSoftKey; app: boolean; expected: string }>([
    { key: "escape", app: false, expected: "\x1b" },
    { key: "escape", app: true, expected: "\x1b" },
    { key: "tab", app: false, expected: "\t" },
    { key: "tab", app: true, expected: "\t" },
    { key: "shiftTab", app: false, expected: "\x1b[Z" },
    { key: "shiftTab", app: true, expected: "\x1b[Z" },
    { key: "ctrlC", app: false, expected: "\x03" },
    { key: "ctrlC", app: true, expected: "\x03" },
    { key: "enter", app: false, expected: "\r" },
    { key: "enter", app: true, expected: "\r" },
    { key: "up", app: false, expected: "\x1b[A" },
    { key: "up", app: true, expected: "\x1bOA" },
    { key: "down", app: false, expected: "\x1b[B" },
    { key: "down", app: true, expected: "\x1bOB" },
  ])("$key (アプリのカーソルキー $app)", ({ key, app, expected }) => {
    expect(softKeySequence(key, app)).toBe(expected);
  });
});

// 指を動かしている間、引き出しが指に付いて動く (以前は離したときに開くか閉じる
// かだけだった)。閉じた位置は -幅、開いた位置は 0。縦のスクロールや本文の横の
// 送りでは動かさない。
describe("drawerDragOffset", () => {
  const W = 320;
  const edge = EDGE_SWIPE_START_MAX_X;
  test.each([
    [
      "closed: from the edge, right by 100",
      false,
      edge,
      0,
      edge + 100,
      0,
      -220,
    ],
    ["closed: right past the full width stops at open", false, 0, 0, 400, 0, 0],
    [
      "closed: a tap-sized move does nothing",
      false,
      0,
      0,
      DRAWER_DRAG_START - 1,
      0,
      null,
    ],
    [
      "closed: from the middle of the page does nothing",
      false,
      edge + 1,
      0,
      edge + 200,
      0,
      null,
    ],
    ["closed: more down than right is a scroll", false, 0, 0, 40, 80, null],
    ["closed: leftwards does nothing", false, edge, 0, 0, 0, null],
    ["open: left by 100", true, 300, 0, 200, 0, -100],
    ["open: left past the width stops at closed", true, 300, 0, -200, 0, -W],
    ["open: rightwards does nothing", true, 100, 0, 200, 0, null],
  ] as const)("%s", (_name, drawerOpen, startX, startY, x, y, expected) => {
    expect(
      drawerDragOffset({ startX, startY, x, y, drawerOpen, width: W }),
    ).toBe(expected);
  });
});

// 下端の帯の「いま見ている画面」の入口 (body の画面の印から)。左の面の前面が
// タブ (端末など) で画面が隠れているときは付けない。
describe("mobileBarCurrent", () => {
  test.each([
    [["gdp-diff-page"], false, "diff"],
    [["gdp-repo-page"], false, "files"],
    [["gdp-repo-blob-page", "gdp-file-detail-page"], false, "files"],
    [["gdp-agents-page"], false, "agents"],
    [["gdp-history-page"], false, null],
    [["gdp-diff-page"], true, null],
    [[], false, null],
  ] as const)("%j, covered by a tab %s → %s", (classes, covered, expected) => {
    expect(
      mobileBarCurrent(
        (name) => (classes as readonly string[]).includes(name),
        covered,
      ),
    ).toBe(expected);
  });
});

describe("longPressMoved", () => {
  const T = LONG_PRESS_MOVE_TOLERANCE;
  test.each([
    ["still", 0, 0, false],
    ["right by the tolerance", T, 0, false],
    ["right past the tolerance", T + 1, 0, true],
    ["down past the tolerance", 0, T + 1, true],
    ["diagonal within the tolerance (6, 8 = 10)", 6, 8, false],
    ["diagonal past the tolerance (8, 8)", 8, 8, true],
  ] as const)("%s", (_name, dx, dy, expected) => {
    expect(
      longPressMoved({ x: 100, y: 200 }, { x: 100 + dx, y: 200 + dy }),
    ).toBe(expected);
  });
});

describe("bottomSwipeAction", () => {
  const BAR_TOP = 800;
  const HEAD = { top: 150, bottom: 194 };
  test.each([
    ["closed: up from the bar", 820, 700, 0, null, "open"],
    ["closed: up from the bar top edge", BAR_TOP, 700, 0, null, "open"],
    ["closed: up from above the bar (page scroll)", 790, 600, 0, null, null],
    ["closed: up from the bar, too short", 820, 780, 0, null, null],
    ["closed: more sideways than up", 820, 700, 200, null, null],
    ["closed: down from the bar", 820, 900, 0, null, null],
    ["open: down from the sheet head", 170, 300, 0, HEAD, "close"],
    [
      "open: down from the head bottom edge",
      HEAD.bottom,
      300,
      0,
      HEAD,
      "close",
    ],
    ["open: down inside the list (scroll)", 400, 600, 0, HEAD, null],
    ["open: up from the head", 170, 60, 0, HEAD, null],
    ["open: up from the bar does not reopen", 820, 700, 0, HEAD, null],
  ] as const)("%s", (_name, startY, endY, dx, sheetHead, expected) => {
    expect(
      bottomSwipeAction({
        startX: 100,
        startY,
        endX: 100 + dx,
        endY,
        barTop: BAR_TOP,
        sheetHead,
      }),
    ).toBe(expected);
  });
});

describe("pinchFontSize", () => {
  test.each([
    ["no change", 12, 100, 100, 12],
    ["spread 1.5x", 12, 100, 150, 18],
    ["pinch to half stops at the min", 12, 100, 50, 8],
    ["rounds to a whole size (12 x 1.2 = 14.4)", 12, 100, 120, 14],
    ["stops at the max", 20, 100, 300, 28],
    ["stops at the min", 10, 100, 10, 8],
    ["fingers on the same point: keeps the size", 12, 0, 80, 12],
  ] as const)("%s", (_name, startSize, startDistance, distance, expected) => {
    expect(
      pinchFontSize({ startSize, startDistance, distance, min: 8, max: 28 }),
    ).toBe(expected);
  });
});
