import { describe, expect, test } from "bun:test";
import { normalizeNewDirectoryName } from "../directory-name";
import {
  fileNameClipboardText,
  filePathClipboardText,
} from "../file-path-copy";

describe("filePathClipboardText", () => {
  test("copies the current file path exactly", () => {
    expect(filePathClipboardText("web-src/app.ts")).toBe("web-src/app.ts");
  });

  test("handles missing paths without throwing", () => {
    expect(filePathClipboardText(null)).toBe("");
  });

  test("copies only the final file or folder name", () => {
    expect(fileNameClipboardText("web-src/app.ts")).toBe("app.ts");
    expect(fileNameClipboardText("web-src")).toBe("web-src");
    expect(fileNameClipboardText("")).toBe("");
  });
});

describe("normalizeNewDirectoryName", () => {
  test("accepts ordinary ASCII and Japanese folder names", () => {
    expect(normalizeNewDirectoryName("src")).toBe("src");
    expect(normalizeNewDirectoryName(" 新しいフォルダー ")).toBe(
      "新しいフォルダー",
    );
  });

  test("rejects unsafe or ambiguous folder names", () => {
    expect(normalizeNewDirectoryName("")).toBeNull();
    expect(normalizeNewDirectoryName("  ")).toBeNull();
    expect(normalizeNewDirectoryName(".")).toBeNull();
    expect(normalizeNewDirectoryName("..")).toBeNull();
    expect(normalizeNewDirectoryName(".GIT")).toBeNull();
    expect(normalizeNewDirectoryName("a/b")).toBeNull();
    expect(normalizeNewDirectoryName("a\\b")).toBeNull();
    expect(normalizeNewDirectoryName("a\0b")).toBeNull();
    expect(normalizeNewDirectoryName("a\nb")).toBeNull();
    expect(normalizeNewDirectoryName("a".repeat(181))).toBeNull();
  });
});
