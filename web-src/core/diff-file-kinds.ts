// Kind-of-change counts for an "AI review brief". Shared by the diff meta
// chip strip (diff-view.ts) and the AI-context clipboard summary
// (ai-context-copy.ts) so both surfaces agree on what counts as "heavy" or
// "binary". No file paths or code content: counts only.

import type { FileMeta } from "./types";

export type DiffFileKindCounts = {
  added: number;
  deleted: number;
  renamed: number;
  heavy: number;
  binary: number;
  media: number;
};

const HEAVY_SIZE_CLASSES = new Set(["medium", "large", "huge"]);

export type DiffFileKind = {
  added: boolean;
  deleted: boolean;
  renamed: boolean;
  heavy: boolean;
  binary: boolean;
  media: boolean;
};

// Single-file classification, shared by summarizeDiffFileKinds (topbar
// totals) and per-row indicators (sidebar file list) so both agree on what
// counts as "heavy" or "binary".
export function classifyDiffFileKind(
  file: Pick<FileMeta, "status" | "size_class" | "media_kind" | "binary">,
): DiffFileKind {
  const status = (file.status || "")[0]?.toUpperCase();
  const heavy = HEAVY_SIZE_CLASSES.has(file.size_class || "");
  const media = !!file.media_kind;
  return {
    added: status === "A",
    deleted: status === "D",
    renamed: status === "R",
    heavy,
    binary: !media && (file.size_class === "binary" || !!file.binary),
    media,
  };
}

export function summarizeDiffFileKinds(files: FileMeta[]): DiffFileKindCounts {
  const counts: DiffFileKindCounts = {
    added: 0,
    deleted: 0,
    renamed: 0,
    heavy: 0,
    binary: 0,
    media: 0,
  };
  for (const file of files) {
    const kind = classifyDiffFileKind(file);
    if (kind.added) counts.added++;
    if (kind.deleted) counts.deleted++;
    if (kind.renamed) counts.renamed++;
    if (kind.heavy) counts.heavy++;
    if (kind.binary) counts.binary++;
    if (kind.media) counts.media++;
  }
  return counts;
}
