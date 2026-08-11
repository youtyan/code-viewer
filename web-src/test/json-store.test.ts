import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createJsonFileStore } from "../server/json-store";
import { withTempDir } from "./_test-helpers";

describe("JSON file store", () => {
  test("壊れたファイルを退避し、原因を記録して空状態へ戻す", async () => {
    await withTempDir("json-store-", async (root) => {
      const file = join(root, "state.json");
      const store = createJsonFileStore<{ version: number }>({
        filePath: () => file,
        empty: () => ({ version: 1 }),
        sanitize: (raw) => {
          if (
            !raw ||
            typeof raw !== "object" ||
            typeof (raw as { version?: unknown }).version !== "number"
          ) {
            throw new Error("invalid state shape");
          }
          return { version: (raw as { version: number }).version };
        },
      });
      await writeFile(file, "{broken", "utf8");
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {
        // The assertion below verifies that recovery reported the complete error.
      });
      try {
        await expect(store.load(root)).resolves.toEqual({ version: 1 });
        expect(errorLog).toHaveBeenCalledWith(
          "[code-viewer] invalid JSON state was moved aside",
          expect.objectContaining({ cause: expect.any(SyntaxError) }),
        );
      } finally {
        errorLog.mockRestore();
      }
      await expect(readFile(file, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        (await readdir(root)).filter((name) =>
          name.startsWith("state.json.corrupt-"),
        ),
      ).toHaveLength(1);
    });
  });

  test("保存失敗後も待ち行列を解放し、次の保存を実行する", async () => {
    await withTempDir("json-store-", async (root) => {
      const file = join(root, "state.json");
      const store = createJsonFileStore<string>({
        filePath: () => file,
        empty: () => "",
        sanitize: (raw) => {
          if (typeof raw !== "string")
            throw new Error("state must be a string");
          return raw;
        },
        serialize: (state) => {
          if (state === "rejected") throw new Error("serialization rejected");
          return JSON.stringify(state);
        },
      });

      await expect(store.save(root, "rejected")).rejects.toThrow(
        "serialization rejected",
      );
      await expect(store.save(root, "accepted")).resolves.toBeUndefined();
      await expect(store.load(root)).resolves.toBe("accepted");
    });
  });
});
