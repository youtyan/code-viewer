// worktree 一覧の 1 行を組み立てる。
//
// `git worktree list` が返すのはパスとブランチだけ。「基準ブランチからどれだけ
// 離れていて、そのまま取り込めるのか」「何のファイルを触っているのか」は、その
// パスを cwd にして初めて分かる。行ごとに独立しているが、同時に起動する git
// プロセスが worktree 数に比例しないよう、固定数の worker で引く。
//
// 1 本でも失敗したら、その行の error に理由を残して他の行はそのまま出す。
// エージェントを走らせている作業ツリーが 1 つ壊れていても、残りを見られなく
// する理由は無い。

import { existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { formatErrorDetail } from "../../core/error-detail";
import type { WorktreesResponse } from "../../core/types";
import type {
  WorktreeDivergence,
  WorktreeFileChange,
  WorktreeItem,
  WorktreeRef,
} from "../../core/worktree";
import { findWorktreeOverlaps } from "../../core/worktree";
import {
  commitHistoryAsync,
  defaultBranchResultAsync,
  fileMetaResultAsync,
  type GitFileMeta,
  type GitFileMetaResult,
  mergePreviewResultAsync,
  repoRoot,
  worktreeDivergenceResultAsync,
  worktreeListResultAsync,
} from "../git";
import { runningServerResult } from "./open";

/** 追加する作業ツリーの置き場所。リポジトリ本体の直下に掘る。 */
export const WORKTREE_ADD_DIR_NAME = ".worktrees";
export const WORKTREE_LIST_CONCURRENCY = 3;

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("concurrency limit must be a positive integer");
  }
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, () =>
      worker(),
    ),
  );
  return results;
}

export function worktreeAddParent(repoRootPath: string): string {
  return join(repoRootPath, WORKTREE_ADD_DIR_NAME);
}

/**
 * このサーバが映している作業ツリーの実パス。
 *
 * `git worktree list` が返すのは git が解決した実パスなので、突き合わせる側も
 * 同じ形にしないと一致しない。cwd がリポジトリのサブディレクトリだったり
 * symlink 越しだったりすると (macOS の /var -> /private/var など)、素の cwd
 * では自分自身の行すら見つけられず、「現在の作業ツリー」の判定も、削除を
 * 拒む判定も静かに外れる。
 */
export function serverWorktreeRoot(cwd: string): string {
  return repoRoot(cwd) ?? cwd;
}

/** リポジトリからの相対パス。外に置かれた作業ツリーは絶対パスのまま出す。 */
function displayPathFor(root: string, path: string): string {
  const rel = relative(root, path);
  if (!rel) return ".";
  return rel.startsWith("..") ? path : rel;
}

function joinErrors(...parts: (string | undefined)[]): string {
  return parts.filter((part): part is string => !!part).join("\n");
}

function toFileChange(
  meta: GitFileMeta,
  origin: WorktreeFileChange["origin"],
): WorktreeFileChange {
  return {
    path: meta.path,
    ...(meta.old_path ? { oldPath: meta.old_path } : {}),
    // 未追跡は git の name-status には出ないので、追加 ("A") と区別できる
    // ように専用の文字にする。
    status: meta.untracked ? "U" : meta.status || "M",
    additions: meta.additions || 0,
    deletions: meta.deletions || 0,
    origin,
  };
}

/**
 * その作業ツリーが触っているファイル。
 *
 * 2 つを合わせる。まだコミットしていないもの (HEAD との差 + 未追跡) と、
 * 基準ブランチから分かれた後のコミットに入っているもの。前者だけだと
 * 「コミット済みだがまだマージしていない変更」が見えず、後者だけだと
 * 「今まさに書いている変更」が見えない。
 */
export async function collectFiles(
  ref: WorktreeRef,
  base: string,
): Promise<{ files: WorktreeFileChange[]; error?: string }> {
  const comparable = !!base && !!ref.branch && ref.branch !== base;
  const [uncommitted, committed] = await Promise.all([
    fileMetaResultAsync(["HEAD"], ref.path, true),
    comparable
      ? fileMetaResultAsync(
          [`refs/heads/${base}...refs/heads/${ref.branch}`],
          ref.path,
          false,
        )
      : Promise.resolve<GitFileMetaResult>({ files: [] }),
  ]);
  const files = [
    ...uncommitted.files.map((meta) => toFileChange(meta, "uncommitted")),
    ...committed.files.map((meta) => toFileChange(meta, "committed")),
  ];
  return {
    files,
    error: joinErrors(uncommitted.error, committed.error) || undefined,
  };
}

/** 基準ブランチとの位置関係。基準そのものと detached では測らない。 */
async function collectDivergence(
  root: string,
  ref: WorktreeRef,
  base: string,
): Promise<{ divergence: WorktreeDivergence | null; error?: string }> {
  if (!base || !ref.branch || ref.branch === base) {
    return { divergence: null };
  }
  const [counts, merge] = await Promise.all([
    worktreeDivergenceResultAsync(root, base, ref.branch),
    mergePreviewResultAsync(root, base, ref.branch),
  ]);
  if (counts.error) return { divergence: null, error: counts.error };
  return {
    divergence: {
      base,
      ahead: counts.ahead,
      behind: counts.behind,
      mergeState: merge.state,
      conflicts: merge.conflicts,
    },
    error: merge.error,
  };
}

function emptyItem(root: string, ref: WorktreeRef): WorktreeItem {
  return {
    ...ref,
    id: ref.path,
    name: basename(ref.path) || ref.path,
    displayPath: displayPathFor(root, ref.path),
    current: ref.path === root,
    missing: !existsSync(ref.path),
    changedCount: 0,
    error: "",
    lastCommit: null,
    serverUrl: "",
    divergence: null,
    files: [],
    fileCount: 0,
  };
}

async function buildItem(
  root: string,
  base: string,
  ref: WorktreeRef,
): Promise<WorktreeItem> {
  const item = emptyItem(root, ref);
  // 消えている作業ツリーと bare リポジトリには作業ツリーが無い。git を呼んでも
  // 失敗するだけなので、その事実 (missing / bare) だけを出す。
  if (item.missing || ref.bare) return item;

  const [history, changes, divergence, server] = await Promise.all([
    commitHistoryAsync(ref.path, { ref: "HEAD", skip: 0, limit: 1 }),
    collectFiles(ref, base),
    collectDivergence(root, ref, base),
    runningServerResult(ref.path),
  ]);
  const commit = history.commits[0];
  return {
    ...item,
    changedCount: changes.files.filter((file) => file.origin === "uncommitted")
      .length,
    error: joinErrors(
      changes.error,
      divergence.error,
      history.error,
      server.status === "invalid" || server.status === "unreachable"
        ? formatErrorDetail(server.error)
        : undefined,
    ),
    lastCommit: commit
      ? {
          sha: commit.sha,
          subject: commit.subject,
          author: commit.author,
          when: commit.when,
        }
      : null,
    serverUrl: server.status === "running" ? server.url : "",
    divergence: divergence.divergence,
    files: changes.files,
    fileCount: changes.files.length,
  };
}

export async function buildWorktreeList(
  root: string,
): Promise<Omit<WorktreesResponse, "generation">> {
  const [listed, baseResult] = await Promise.all([
    worktreeListResultAsync(root),
    defaultBranchResultAsync(root),
  ]);
  const baseBranch = baseResult.branch;
  const worktrees = await mapWithConcurrency(
    listed.worktrees,
    WORKTREE_LIST_CONCURRENCY,
    (ref) => buildItem(root, baseBranch, ref),
  );
  const error = joinErrors(listed.error, baseResult.error);
  return {
    worktrees,
    repoRoot: root,
    addParent: worktreeAddParent(root),
    baseBranch,
    overlaps: findWorktreeOverlaps(worktrees),
    ...(error ? { error } : {}),
  };
}
