import { describe, expect, test } from "vitest";
import { rawFileHeaders } from "../server/raw-file-headers";

describe("file metadata headers", () => {
  test("keeps filesystem and commit timestamps separate", () => {
    const rawHeaders = new Headers(
      rawFileHeaders("README.md", {
        metadata: {
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
          commit_updated_at: "2026-01-03T00:00:00.000Z",
        },
      }),
    );
    expect(rawHeaders.get("x-code-viewer-created-at")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(rawHeaders.get("x-code-viewer-updated-at")).toBe(
      "2026-01-02T00:00:00.000Z",
    );
    expect(rawHeaders.get("x-code-viewer-commit-updated-at")).toBe(
      "2026-01-03T00:00:00.000Z",
    );
  });
});
