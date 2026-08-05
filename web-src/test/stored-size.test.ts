import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { readStoredSize, writeStoredSize } from "../core/stored-size";

GlobalRegistrator.register();

afterAll(() => {
  GlobalRegistrator.unregister();
});

const KEY = "code-viewer:test-size";

beforeEach(() => {
  window.localStorage.clear();
});

/**
 * localStorage に触れない文脈 (プライベートモードや、設定でストレージを
 * 止めているブラウザ) を作る。プロパティごと差し替えるのは、Storage の
 * メソッドだけ差し替えると元に戻したときに実体が壊れるため。
 */
function withBlockedStorage(run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(window, "localStorage", original);
    else Reflect.deleteProperty(window, "localStorage");
  }
}

describe("readStoredSize", () => {
  test.each([
    { name: "保存した整数をそのまま返す", stored: "512", expected: 512 },
    { name: "0 は未保存ではなく寸法 0 として読む", stored: "0", expected: 0 },
    { name: "小数もそのまま返す", stored: "12.5", expected: 12.5 },
    {
      name: "負値もクランプせずに返す (範囲は呼び出し側の責任)",
      stored: "-10",
      expected: -10,
    },
    { name: "空文字は未保存として扱う", stored: "", expected: 380 },
    { name: "数値でない値は fallback", stored: "abc", expected: 380 },
    { name: "Infinity は fallback", stored: "Infinity", expected: 380 },
    { name: "NaN は fallback", stored: "NaN", expected: 380 },
  ])("$name", ({ stored, expected }) => {
    window.localStorage.setItem(KEY, stored);
    expect(readStoredSize(KEY, 380)).toBe(expected);
  });

  test("保存が無ければ fallback を返す", () => {
    expect(readStoredSize(KEY, 380)).toBe(380);
  });
});

describe("writeStoredSize", () => {
  test("書いた寸法を読み戻せる", () => {
    writeStoredSize(KEY, 512);
    expect(readStoredSize(KEY, 380)).toBe(512);
  });
});

describe("localStorage に触れない文脈", () => {
  test("読めなければ fallback を返す", () => {
    withBlockedStorage(() => {
      expect(readStoredSize(KEY, 380)).toBe(380);
    });
  });

  test("書けなくても操作を落とさない", () => {
    withBlockedStorage(() => {
      expect(() => writeStoredSize(KEY, 512)).not.toThrow();
    });
  });
});
