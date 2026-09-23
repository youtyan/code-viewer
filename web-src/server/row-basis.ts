// Diff のカードの高さの見積もりの材料 (core/diff-card-estimate.ts の DiffRowBasis) を、
// 小さいファイル (中身を丸ごと描くカード) ごとに数える。
//
// 追跡中のファイルは差分の本文を 1 回読み、追跡外 (新規) はファイルの先頭を読む。
// どちらも読む前に量を見て、上限を超えたら読まない (材料を載せず、画面が追加・
// 削除から数え直す。追跡中は row_basis が無く、追跡外は widest が無い)。
// 失敗は 1 件ずつ、どのファイルの・どの操作で・何が理由かを返し、黙って捨てない。

import { open } from "node:fs/promises";
import {
  type DiffRowBasis,
  diffRowBasisFromText,
  widestLines,
} from "../core/diff-card-estimate";
import { errorWithCause, formatErrorDetail } from "../core/error-detail";
import type { RowBasisError } from "../core/types";
import type { GitFileMeta } from "./git";

/** 追跡中のファイルの差分を数える上限 (件数と、追加 + 削除の行の和)。 */
export const ROW_BASIS_FILE_BUDGET = 500;
export const ROW_BASIS_LINE_BUDGET = 20000;
/**
 * 追跡外のファイルの先頭を読む上限。1 件はこの長さまで (これより長いファイルは、
 * 読んだ分の行だけで横に十分長い)。件数と、1 件の上限で頭打ちにした大きさの和。
 */
export const UNTRACKED_READ_BYTES = 1024 * 1024;
export const UNTRACKED_FILE_BUDGET = 200;
export const UNTRACKED_BYTE_BUDGET = 8 * 1024 * 1024;

/** 材料を数えるために読むもの (preview.ts が git とファイルを渡す)。 */
export type RowBasisSources = {
  /** 追跡中のファイルの `git diff` の本文。 */
  diffText(
    paths: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  /** 追跡外のファイルの大きさ (bytes)。 */
  fileSize(path: string): Promise<number>;
  /** 追跡外のファイルの先頭から bytes まで (UTF-8)。 */
  readHead(path: string, bytes: number): Promise<string>;
};

/** ファイルの先頭から bytes まで (UTF-8)。 */
export async function readFileHead(
  fullPath: string,
  bytes: number,
): Promise<string> {
  const handle = await open(fullPath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

/**
 * 小さいファイル (呼び出し側が選ぶ。二進は除く) の材料と、数えられなかった理由。
 */
export async function diffRowBasisFor(
  small: readonly GitFileMeta[],
  sources: RowBasisSources,
): Promise<{ basis: Map<string, DiffRowBasis>; errors: RowBasisError[] }> {
  const basis = new Map<string, DiffRowBasis>();
  const errors: RowBasisError[] = [];
  const fail = (
    operation: string,
    context: string,
    err: unknown,
    path?: string,
  ) => {
    console.error(errorWithCause(context, err));
    errors.push({
      ...(path === undefined ? {} : { path }),
      operation,
      message: formatErrorDetail(err),
    });
  };

  const reading: { file: GitFileMeta; rows: DiffRowBasis }[] = [];
  for (const file of small) {
    if (!file.untracked) continue;
    const additions = file.additions || 0;
    const rows: DiffRowBasis = {
      hunks: additions > 0 ? 1 : 0,
      context: 0,
      split_changes: additions,
      lead_gap: false,
    };
    basis.set(file.path, rows);
    if (additions > 0) reading.push({ file, rows });
  }
  if (reading.length <= UNTRACKED_FILE_BUDGET) {
    const sized: { file: GitFileMeta; rows: DiffRowBasis; bytes: number }[] =
      [];
    for (const { file, rows } of reading) {
      try {
        const size = await sources.fileSize(file.path);
        sized.push({ file, rows, bytes: Math.min(size, UNTRACKED_READ_BYTES) });
      } catch (err) {
        fail(
          "stat untracked file",
          `reading the size of the untracked file ${file.path} for the card height estimate failed`,
          err,
          file.path,
        );
      }
    }
    const total = sized.reduce((sum, { bytes }) => sum + bytes, 0);
    if (total <= UNTRACKED_BYTE_BUDGET) {
      for (const { file, rows, bytes } of sized) {
        try {
          const text = await sources.readHead(file.path, bytes);
          const additions = file.additions || 0;
          rows.widest = {
            old: [],
            new: widestLines(
              text.split("\n").map((line) => line.replace(/\r$/, "")),
            ),
            // git が新規のファイルに付ける見出し。
            head: [`@@ -0,0 +1${additions === 1 ? "" : `,${additions}`} @@`],
          };
        } catch (err) {
          fail(
            "read untracked file",
            `reading the untracked file ${file.path} for the card height estimate failed`,
            err,
            file.path,
          );
        }
      }
    }
  }

  const tracked = small.filter((file) => !file.untracked);
  const lines = tracked.reduce(
    (sum, file) => sum + (file.additions || 0) + (file.deletions || 0),
    0,
  );
  if (
    tracked.length === 0 ||
    tracked.length > ROW_BASIS_FILE_BUDGET ||
    lines > ROW_BASIS_LINE_BUDGET
  )
    return { basis, errors };
  const paths = tracked.flatMap((file) =>
    file.old_path && file.old_path !== file.path
      ? [file.old_path, file.path]
      : [file.path],
  );
  const res = await sources.diffText(paths);
  if (res.code !== 0) {
    const message = `git diff exited ${res.code} for ${paths.length} paths: ${res.stderr.trim()}`;
    console.error(
      `[code-viewer] counting diff rows for the card height estimate failed: ${message}`,
    );
    errors.push({ operation: "git diff", message });
    return { basis, errors };
  }
  try {
    for (const [path, rows] of diffRowBasisFromText(res.stdout))
      basis.set(path, rows);
  } catch (err) {
    fail(
      "read git diff",
      `reading the git diff for the card height estimate failed (${paths.length} paths)`,
      err,
    );
  }
  return { basis, errors };
}
