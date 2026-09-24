// 「プロジェクトを追加」のダイアログがたどるディレクトリの一覧。
//
// - GET /_agent/projects/directories?path=<絶対パスか ~>&hidden=1
//
// 読むだけ。返すのは正規化した絶対パス・親・子のディレクトリの名前と「git の
// 根か」だけで、ファイルの名前・中身は返さない。ブラウザの標準のフォルダ選択は
// 絶対パスを返さないので、画面はこれでたどって選び、登録は既存の
// POST /_agent/projects に任せる (git でないディレクトリ・重複・作業ツリーの
// 扱いは登録簿の規則のまま)。
//
// 振り分けは terminal/handle.ts の /_agent/ の表。GET なので副作用の検査は
// 通らないが、入口 (entry/server.ts) と単体のサーバ (preview.ts) の手前で
// requestAllowed がローカル以外の Host・Origin を断る。

import type { Dirent } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { formatErrorDetail } from "../../core/error-detail";
import {
  MAX_PROJECT_DIRECTORY_ENTRIES,
  type ProjectDirectoryEntry,
  type ProjectDirectoryListing,
  projectRootIssue,
} from "../../core/projects";
import { json } from "../database/handle-shared";
import { errno } from "../terminal/settings-file";

export type DirectoryListCode =
  | "invalid"
  | "not-found"
  | "not-directory"
  | "unreadable";

/** 一覧を出せない理由。code ごとに HTTP の状態を決める。 */
export class DirectoryListError extends Error {
  constructor(
    readonly code: DirectoryListCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "DirectoryListError";
    if (options && "cause" in options) {
      Object.assign(this, { cause: options.cause });
    }
  }
}

const STATUS: Record<DirectoryListCode, number> = {
  invalid: 400,
  "not-found": 404,
  "not-directory": 400,
  unreadable: 403,
};

/** `~` と `~/…` をホームに読み替え、`..` や重なった `/` を畳む。 */
export function resolveDirectoryInput(input: string, home: string): string {
  const expanded =
    input === "~"
      ? home
      : input.startsWith("~/")
        ? join(home, input.slice(2))
        : input;
  const issue = projectRootIssue(expanded);
  if (issue) {
    throw new DirectoryListError(
      "invalid",
      `path must be an absolute path or start with ~/ (${issue}): ${input}`,
    );
  }
  return resolve(expanded);
}

/** fs の失敗を、どのパスで何をしていたかつきの理由に直す。 */
function fsFailure(
  operation: string,
  path: string,
  error: unknown,
): DirectoryListError | unknown {
  const code = errno(error);
  const listCode: DirectoryListCode | null =
    code === "ENOENT"
      ? "not-found"
      : code === "ENOTDIR"
        ? "not-directory"
        : code === "EACCES" || code === "EPERM"
          ? "unreadable"
          : code === "ELOOP" || code === "ENAMETOOLONG"
            ? "invalid"
            : null;
  if (listCode === null) return error;
  return new DirectoryListError(listCode, `cannot ${operation} ${path}`, {
    cause: error,
  });
}

/** 子がディレクトリか。symlink は先を見る (壊れたリンクはディレクトリでない)。 */
async function childDirectory(
  dir: string,
  entry: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean },
): Promise<{ directory: boolean; issue?: string }> {
  if (entry.isDirectory()) return { directory: true };
  if (!entry.isSymbolicLink()) return { directory: false };
  try {
    return { directory: (await stat(join(dir, entry.name))).isDirectory() };
  } catch (error) {
    const code = errno(error);
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
      return { directory: false };
    }
    // 先を確かめられないリンクは、ディレクトリかもしれないので理由つきで出す。
    return { directory: true, issue: formatErrorDetail(error) };
  }
}

async function gitMark(
  path: string,
): Promise<{ git: boolean; issue?: string }> {
  try {
    await lstat(join(path, ".git"));
    return { git: true };
  } catch (error) {
    const code = errno(error);
    if (code === "ENOENT" || code === "ENOTDIR") return { git: false };
    return { git: false, issue: formatErrorDetail(error) };
  }
}

export async function listProjectDirectory(
  input: string,
  options: { hidden: boolean; home?: string; limit?: number },
): Promise<ProjectDirectoryListing> {
  const path = resolveDirectoryInput(input, options.home ?? homedir());
  const limit = options.limit ?? MAX_PROJECT_DIRECTORY_ENTRIES;
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch (error) {
    throw fsFailure("read", path, error);
  }
  if (!info.isDirectory()) {
    throw new DirectoryListError("not-directory", `not a directory: ${path}`);
  }
  let dirents: Dirent[];
  try {
    dirents = await readdir(path, { withFileTypes: true });
  } catch (error) {
    throw fsFailure("list", path, error);
  }
  const children: { name: string; issue?: string }[] = [];
  for (const dirent of dirents) {
    if (!options.hidden && dirent.name.startsWith(".")) continue;
    const child = await childDirectory(path, dirent);
    if (child.directory)
      children.push({ name: dirent.name, issue: child.issue });
  }
  children.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
  const shown = children.slice(0, limit);
  const entries = await Promise.all(
    shown.map(async (child): Promise<ProjectDirectoryEntry> => {
      if (child.issue)
        return { name: child.name, git: false, issue: child.issue };
      const mark = await gitMark(join(path, child.name));
      return mark.issue
        ? { name: child.name, git: mark.git, issue: mark.issue }
        : { name: child.name, git: mark.git };
    }),
  );
  return {
    path,
    parent: path === "/" ? null : dirname(path),
    entries,
    total: children.length,
    truncated: children.length > shown.length,
  };
}

export async function handleProjectDirectoriesGet(url: URL): Promise<Response> {
  const input = url.searchParams.get("path") ?? "";
  if (!input) {
    return json({ error: "path is required", code: "invalid" }, 400);
  }
  try {
    return json(
      await listProjectDirectory(input, {
        hidden: url.searchParams.get("hidden") === "1",
      }),
    );
  } catch (error) {
    if (error instanceof DirectoryListError) {
      // code は本文の欄で返す (projects/handle.ts の errorResponse と同じ)。
      return json(
        {
          error: formatErrorDetail(error, { fieldsShownElsewhere: ["code"] }),
          code: error.code,
        },
        STATUS[error.code],
      );
    }
    console.error("[code-viewer] directory listing failed", error);
    return json({ error: formatErrorDetail(error), code: "failed" }, 500);
  }
}
