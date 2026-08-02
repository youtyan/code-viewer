// 貼り付けた画像を受け取るときの検証。
//
// ここを緩めると、種類の分からないデータをそのままファイルに落としてしまう。
// サーバとブラウザが同じ判定を見るので、規則はここで固定する。

import { describe, expect, test } from "vitest";
import {
  base64ByteLength,
  controlSequenceForInput,
  isShiftEnter,
  looksLikeBase64,
  MAX_PASTE_BODY_BYTES,
  MAX_PASTE_IMAGE_BYTES,
  pasteImageExtension,
  SHIFT_ENTER_SEQUENCE,
} from "../core/terminal-paste";

describe("isShiftEnter", () => {
  const key = (over: Partial<Parameters<typeof isShiftEnter>[0]> = {}) => ({
    key: "Enter",
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...over,
  });

  test("Shift+Enter だけを拾う", () => {
    expect(isShiftEnter(key())).toBe(true);
  });

  test.each([
    { name: "Enter 単独は拾わない", over: { shiftKey: false } },
    { name: "Ctrl 併用は拾わない", over: { ctrlKey: true } },
    { name: "Cmd 併用は拾わない", over: { metaKey: true } },
    { name: "Alt 併用は拾わない", over: { altKey: true } },
    { name: "別のキーは拾わない", over: { key: "a" } },
    { name: "Tab は拾わない", over: { key: "Tab" } },
  ])("$name", ({ over }) => {
    // 修飾キー付きはエージェント側が別の割り当てを持っていることがある。
    expect(isShiftEnter(key(over))).toBe(false);
  });
});

describe("SHIFT_ENTER_SEQUENCE", () => {
  test("LF (Ctrl+J) の 1 バイト", () => {
    // CR を送ると送信されてしまう。ESC+CR も駄目で、受け側は ESC と Enter を
    // 別々に読んで結局送信する。設定なしでどの端末でも通るのは Ctrl+J だけ。
    expect(SHIFT_ENTER_SEQUENCE).toBe(String.fromCharCode(10));
    expect(SHIFT_ENTER_SEQUENCE).toHaveLength(1);
  });

  test("CR を含まない", () => {
    expect(SHIFT_ENTER_SEQUENCE).not.toContain(String.fromCharCode(13));
  });
});

describe("controlSequenceForInput", () => {
  test.each([
    { name: "lowercase letter", input: "c", expectedCode: 3 },
    { name: "uppercase letter", input: "Z", expectedCode: 26 },
    { name: "at sign", input: "@", expectedCode: 0 },
    { name: "opening bracket", input: "[", expectedCode: 27 },
    { name: "question mark", input: "?", expectedCode: 127 },
    { name: "space", input: " ", expectedCode: 0 },
  ])("maps $name to its control byte", ({ input, expectedCode }) => {
    expect(controlSequenceForInput(input)).toBe(
      String.fromCharCode(expectedCode),
    );
  });

  test.each([
    { name: "empty input", input: "" },
    { name: "multiple characters", input: "ab" },
    { name: "non-ASCII letter", input: "あ" },
    { name: "unsupported punctuation", input: "!" },
  ])("rejects $name", ({ input }) => {
    expect(controlSequenceForInput(input)).toBeNull();
  });
});

describe("pasteImageExtension", () => {
  test.each([
    { name: "PNG", mime: "image/png", expected: "png" },
    { name: "JPEG", mime: "image/jpeg", expected: "jpg" },
    { name: "GIF", mime: "image/gif", expected: "gif" },
    { name: "WebP", mime: "image/webp", expected: "webp" },
    { name: "大文字でも通す", mime: "IMAGE/PNG", expected: "png" },
    {
      name: "付帯パラメータを無視する",
      mime: "image/png; charset=binary",
      expected: "png",
    },
    { name: "前後の空白を無視する", mime: "  image/png  ", expected: "png" },
  ])("$name", ({ mime, expected }) => {
    expect(pasteImageExtension(mime)).toBe(expected);
  });

  test.each([
    // SVG は中に script を書けるので受けない。貼り付けの用途では要らない。
    { name: "SVG は受けない", mime: "image/svg+xml" },
    { name: "画像でないものは受けない", mime: "text/plain" },
    { name: "PDF は受けない", mime: "application/pdf" },
    { name: "空文字は受けない", mime: "" },
    { name: "image/ だけは受けない", mime: "image/" },
    { name: "数値は受けない", mime: 12 },
    { name: "null は受けない", mime: null },
    { name: "undefined は受けない", mime: undefined },
  ])("$name", ({ mime }) => {
    expect(pasteImageExtension(mime)).toBeNull();
  });
});

describe("looksLikeBase64", () => {
  test.each([
    { name: "普通の base64", value: "aGVsbG8=", expected: true },
    { name: "パディング 2 個", value: "aGVsbG8hIQ==", expected: true },
    { name: "パディング無し", value: "aGVsbG8h", expected: true },
    {
      name: "data URL が付いたままは弾く",
      value: "data:image/png;base64,aGk=",
      expected: false,
    },
    { name: "空文字は弾く", value: "", expected: false },
    { name: "改行入りは弾く", value: "aGVs\nbG8=", expected: false },
    { name: "URL-safe な記号は弾く", value: "aGV-bG8_", expected: false },
    { name: "数値は弾く", value: 123, expected: false },
    { name: "null は弾く", value: null, expected: false },
  ])("$name", ({ value, expected }) => {
    expect(looksLikeBase64(value)).toBe(expected);
  });
});

describe("base64ByteLength", () => {
  test.each([
    { name: "パディング無し", value: "aGVsbG8h", expected: 6 },
    { name: "パディング 1 個", value: "aGVsbG8=", expected: 5 },
    { name: "パディング 2 個", value: "aGVsbA==", expected: 4 },
  ])("$name", ({ value, expected }) => {
    expect(base64ByteLength(value)).toBe(expected);
  });

  test("実際にデコードした長さと一致する", () => {
    const source = "画像の代わりのバイト列";
    const encoded = Buffer.from(source, "utf8").toString("base64");
    expect(base64ByteLength(encoded)).toBe(Buffer.byteLength(source, "utf8"));
  });
});

describe("上限", () => {
  test("本文の上限は base64 に膨らむぶんを見込んである", () => {
    // base64 は元の 4/3 になる。ここが元のサイズのままだと、上限ぎりぎりの
    // 画像が本文の時点で弾かれる。
    expect(MAX_PASTE_BODY_BYTES).toBeGreaterThan(
      Math.ceil(MAX_PASTE_IMAGE_BYTES * (4 / 3)),
    );
  });
});
