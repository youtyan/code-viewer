// 電話の幅の骨格の純関数 (core/mobile-layout.ts)。幅の段・左端のスワイプ・
// ソフトキーボードの高さ・端末の操作札のバイト列。
import { describe, expect, test } from "vitest";
import {
  edgeSwipeAction,
  PHONE_LANDSCAPE_MEDIA_QUERY,
  PHONE_MEDIA_QUERY,
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
