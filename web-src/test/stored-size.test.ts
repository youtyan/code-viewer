import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  readStoredSize,
  reportStoredSizeFailure,
  writeStoredSize,
} from "../core/stored-size";

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
    expect(readStoredSize(KEY, 380)).toEqual({ ok: true, value: expected });
  });

  test("保存が無ければ fallback を返す", () => {
    expect(readStoredSize(KEY, 380)).toEqual({ ok: true, value: 380 });
  });
});

describe("writeStoredSize", () => {
  test("書いた寸法を読み戻せる", () => {
    expect(writeStoredSize(KEY, 512)).toEqual({ ok: true });
    expect(readStoredSize(KEY, 380)).toEqual({ ok: true, value: 512 });
  });
});

describe("localStorage に触れない文脈", () => {
  test("読み取り失敗を既定値と元の例外に分けて返す", () => {
    withBlockedStorage(() => {
      const result = readStoredSize(KEY, 380);
      expect(result.ok).toBe(false);
      if (!("error" in result)) throw new Error("expected blocked storage");
      expect(result.value).toBe(380);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error).toMatchObject({ message: "blocked" });
    });
  });

  test("書き込み失敗で元の例外を返す", () => {
    withBlockedStorage(() => {
      const result = writeStoredSize(KEY, 512);
      expect(result.ok).toBe(false);
      if (!("error" in result)) throw new Error("expected blocked storage");
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error).toMatchObject({ message: "blocked" });
    });
  });

  test("失敗は操作ごとに 1 回だけ、元の例外を cause に付けて出す", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      /* asserted below */
    });
    try {
      withBlockedStorage(() => {
        for (let i = 0; i < 3; i++) {
          reportStoredSizeFailure(
            readStoredSize(KEY, 380),
            "reading the sample width failed",
          );
          reportStoredSizeFailure(
            writeStoredSize(KEY, 512),
            "saving the sample width failed",
          );
        }
      });
      reportStoredSizeFailure({ ok: true }, "saving the sample width failed");
      expect(errorSpy.mock.calls.map(([error]) => error)).toEqual([
        expect.objectContaining({
          message: "reading the sample width failed",
          cause: expect.objectContaining({ message: "blocked" }),
        }),
        expect.objectContaining({
          message: "saving the sample width failed",
          cause: expect.objectContaining({ message: "blocked" }),
        }),
      ]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
