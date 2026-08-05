import { describe, expect, test } from "vitest";
import { isToolInternalPath } from "../server/git";

describe("isToolInternalPath", () => {
  test("matches .code-viewer anywhere in the path", () => {
    expect(isToolInternalPath(".code-viewer")).toBe(true);
    expect(isToolInternalPath(".code-viewer/annotations.json")).toBe(true);
    expect(isToolInternalPath("packages/app/.code-viewer/server.json")).toBe(
      true,
    );
  });

  test("does not match regular project paths", () => {
    expect(isToolInternalPath("src/app.ts")).toBe(false);
    expect(isToolInternalPath("code-viewer/readme.md")).toBe(false);
    expect(isToolInternalPath(".code-viewer-backup/file")).toBe(false);
  });
});
