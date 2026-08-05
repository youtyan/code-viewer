import { describe, expect, test } from "vitest";
import {
  classifyDiffFileKind,
  summarizeDiffFileKinds,
} from "../core/diff-file-kinds";
import type { FileMeta } from "../core/types";

function file(overrides: Partial<FileMeta>): FileMeta {
  return { path: "a.ts", load_url: "/a", status: "M", ...overrides };
}

describe("classifyDiffFileKind", () => {
  test("flags a large diff as heavy, and huge/medium the same way", () => {
    expect(classifyDiffFileKind(file({ size_class: "large" })).heavy).toBe(
      true,
    );
    expect(classifyDiffFileKind(file({ size_class: "huge" })).heavy).toBe(true);
    expect(classifyDiffFileKind(file({ size_class: "medium" })).heavy).toBe(
      true,
    );
    expect(classifyDiffFileKind(file({ size_class: "small" })).heavy).toBe(
      false,
    );
  });

  test("flags a binary size_class as binary, not media", () => {
    const kind = classifyDiffFileKind(file({ size_class: "binary" }));
    expect(kind.binary).toBe(true);
    expect(kind.media).toBe(false);
  });

  test("flags a media_kind file as media, not binary", () => {
    const kind = classifyDiffFileKind(
      file({ size_class: "binary", media_kind: "image" }),
    );
    expect(kind.media).toBe(true);
    expect(kind.binary).toBe(false);
  });

  test("maps status letters to added/deleted/renamed", () => {
    expect(classifyDiffFileKind(file({ status: "A" })).added).toBe(true);
    expect(classifyDiffFileKind(file({ status: "D" })).deleted).toBe(true);
    expect(classifyDiffFileKind(file({ status: "R" })).renamed).toBe(true);
    const modified = classifyDiffFileKind(file({ status: "M" }));
    expect(modified.added).toBe(false);
    expect(modified.deleted).toBe(false);
    expect(modified.renamed).toBe(false);
  });

  test("leaves a small plain-text modification with no kind flags set", () => {
    const kind = classifyDiffFileKind(file({ size_class: "small" }));
    expect(kind).toEqual({
      added: false,
      deleted: false,
      renamed: false,
      heavy: false,
      binary: false,
      media: false,
    });
  });
});

describe("summarizeDiffFileKinds (still consistent with classifyDiffFileKind)", () => {
  test("counts match the sum of individual classifications", () => {
    const files = [
      file({ path: "new.ts", status: "A" }),
      file({ path: "huge.ts", size_class: "huge" }),
      file({ path: "logo.png", media_kind: "image" }),
    ];
    expect(summarizeDiffFileKinds(files)).toEqual({
      added: 1,
      deleted: 0,
      renamed: 0,
      heavy: 1,
      binary: 0,
      media: 1,
    });
  });
});
