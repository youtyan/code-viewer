import { describe, expect, test } from "bun:test";
import { normalizeNewDirectoryName } from "../core/directory-name";
import {
  fileNameClipboardText,
  filePathClipboardText,
  fileReferenceClipboardText,
} from "../core/file-path-copy";

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

describe("fileReferenceClipboardText", () => {
  test("formats a single line as @path#line", () => {
    expect(fileReferenceClipboardText("bun.lock", 1, 1)).toBe("@bun.lock#1");
  });

  test("formats a range as @path#start-end", () => {
    expect(fileReferenceClipboardText("web-src/app.ts", 120, 135)).toBe(
      "@web-src/app.ts#120-135",
    );
  });

  test("normalizes reversed ranges", () => {
    expect(fileReferenceClipboardText("a.ts", 9, 3)).toBe("@a.ts#3-9");
  });

  test("returns empty for missing path", () => {
    expect(fileReferenceClipboardText("", 1, 2)).toBe("");
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
