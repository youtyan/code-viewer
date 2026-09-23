// エージェントの設定ファイル (JSON) を安全に書き換える共通部分。
//
// フックの入れ外し (hooks.ts) と statusLine を包む・戻す (statusline.ts) が
// 同じ約束で書くためにここへ置く:
//
// - 書く前に読む。JSON として読めない・想定外の形なら書かない
// - 確認画面に出した差分は、そのとき読んだ中身のハッシュと一緒に返す。
//   書くときに同じ実体パスのロック内で読み直し、ハッシュ・実体パス・
//   ファイル identity が違えば書かない (見せたものと書くものをずらさない)
// - 書く直前に同じディレクトリへバックアップを作る。失敗したら書かない
// - 一時ファイルに書いてから置き換える。元の権限を保つ
// - シンボリックリンクはリンクのまま残し、リンク先を書き換える

import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import { resolvedFilePath, withFileLock } from "../file-lock";

export function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** 設定ファイルの形の問題。どこが・なぜ。 */
export type ShapeIssue = { path: string; message: string };

export function writeFileAtomic(
  path: string,
  text: string,
  mode: number,
): void {
  const temp = join(
    dirname(path),
    `.${basename(path)}.code-viewer-${randomUUID()}.tmp`,
  );
  writeFileSync(temp, text, { encoding: "utf8", flag: "wx", mode });
  try {
    // umask で落ちた権限を元に戻す。
    chmodSync(temp, mode);
    renameSync(temp, path);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch (cleanupError) {
      throw errorWithCause(
        `failed to replace ${path}, and the temporary file ${temp} could not be removed`,
        { error, cleanupError },
      );
    }
    throw error;
  }
}

export type JsonFileRead =
  | { kind: "missing-dir" }
  | { kind: "missing"; realPath: string }
  | { kind: "unreadable"; realPath: string; symlink: boolean; detail: string }
  | {
      kind: "ok";
      realPath: string;
      symlink: boolean;
      text: string;
      root: Record<string, unknown>;
      mode: number;
      fileIdentity: string;
    };

function identityFor(
  realPath: string,
  stat: { dev: number; ino: number; size: number; mtimeMs: number },
): string {
  if (
    Number.isSafeInteger(stat.dev) &&
    Number.isSafeInteger(stat.ino) &&
    (stat.dev !== 0 || stat.ino !== 0)
  ) {
    return `device:${stat.dev}|inode:${stat.ino}`;
  }
  return `path:${realPath}|size:${stat.size}|mtime:${stat.mtimeMs}`;
}

export function settingsFileIdentity(read: JsonFileRead): string {
  return read.kind === "ok"
    ? read.fileIdentity
    : `${read.kind}:${"realPath" in read ? read.realPath : ""}`;
}

export function settingsRevisionConflicts(
  actual: { baseHash: string; realPath: string; fileIdentity: string },
  expected: { baseHash: string; realPath: string; fileIdentity: string },
): string[] {
  const conflicts: string[] = [];
  if (actual.realPath !== expected.realPath) {
    conflicts.push(
      `the resolved path changed from ${expected.realPath} to ${actual.realPath}`,
    );
  }
  if (actual.fileIdentity !== expected.fileIdentity) {
    conflicts.push("the file identity changed");
  }
  if (actual.baseHash !== expected.baseHash) {
    conflicts.push("the content changed");
  }
  return conflicts;
}

/**
 * 設定ファイルを読む。JSON として読めない・check が問題を返したら
 * unreadable (書かない)。
 */
export function readJsonSettingsFile(
  configDir: string,
  path: string,
  check: (root: unknown) => ShapeIssue[],
): JsonFileRead {
  let symlink = false;
  try {
    symlink = lstatSync(path).isSymbolicLink();
  } catch (error) {
    if (errno(error) !== "ENOENT") {
      return {
        kind: "unreadable",
        realPath: path,
        symlink,
        detail: formatErrorDetail(error),
      };
    }
    try {
      if (!statSync(configDir).isDirectory()) {
        return {
          kind: "unreadable",
          realPath: path,
          symlink,
          detail: `${configDir} is not a directory`,
        };
      }
    } catch (dirError) {
      if (errno(dirError) === "ENOENT") return { kind: "missing-dir" };
      return {
        kind: "unreadable",
        realPath: path,
        symlink,
        detail: formatErrorDetail(dirError),
      };
    }
    try {
      return { kind: "missing", realPath: resolvedFilePath(path) };
    } catch (error) {
      return {
        kind: "unreadable",
        realPath: path,
        symlink,
        detail: formatErrorDetail(error),
      };
    }
  }
  let realPath = path;
  try {
    realPath = realpathSync(path);
    const text = readFileSync(realPath, "utf8");
    const stat = statSync(realPath);
    const mode = stat.mode & 0o7777;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return {
        kind: "unreadable",
        realPath,
        symlink,
        detail: `not valid JSON: ${formatErrorDetail(error)}`,
      };
    }
    const issues = check(parsed);
    if (issues.length > 0) {
      return {
        kind: "unreadable",
        realPath,
        symlink,
        detail: issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join("\n"),
      };
    }
    return {
      kind: "ok",
      realPath,
      symlink,
      text,
      root: parsed as Record<string, unknown>,
      mode,
      fileIdentity: identityFor(realPath, stat),
    };
  } catch (error) {
    return {
      kind: "unreadable",
      realPath,
      symlink,
      detail: formatErrorDetail(error),
    };
  }
}

function writable(path: string): string {
  try {
    accessSync(path, constants.W_OK);
    return "";
  } catch (error) {
    return `${path} is not writable (${errno(error) ?? formatErrorDetail(error)})`;
  }
}

/** 書けない理由。書けるなら空。 */
export function writeBlockedReason(path: string, read: JsonFileRead): string {
  if (read.kind === "missing-dir" || read.kind === "unreadable") return "";
  const reasons = [writable(dirname(read.realPath))];
  if (read.kind === "ok") {
    reasons.push(writable(read.realPath));
    // バックアップはリンクの側 (設定ディレクトリ) に置く。
    if (dirname(path) !== dirname(read.realPath)) {
      reasons.push(writable(dirname(path)));
    }
  }
  return reasons.filter(Boolean).join("\n");
}

export function contentHash(read: JsonFileRead): string {
  const text = read.kind === "ok" ? read.text : `<${read.kind}>`;
  return createHash("sha256").update(text).digest("hex");
}

/** バックアップの名前。時刻は手元の時計で、秒まで。 */
export function backupPathFor(path: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return join(dirname(path), `${basename(path)}.code-viewer-backup-${stamp}`);
}

export type SettingsWriteOps = {
  /**
   * source (書き換える実体) をバイト列のまま path に写す。既にあれば失敗
   * させる。解読した文字列から書くと、UTF-8 として正しくないバイトが
   * U+FFFD に置き換わり、元の中身がどこにも残らない。
   */
  writeBackup(path: string, source: string, mode: number): void;
};

export const DEFAULT_WRITE_OPS: SettingsWriteOps = {
  writeBackup(path, source, mode) {
    copyFileSync(source, path, constants.COPYFILE_EXCL);
    chmodSync(path, mode);
  },
};

export function writeBackupUnique(
  ops: SettingsWriteOps,
  path: string,
  now: Date,
  source: string,
  mode: number,
): string {
  const first = backupPathFor(path, now);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? first : `${first}-${attempt + 1}`;
    try {
      ops.writeBackup(candidate, source, mode);
      return candidate;
    } catch (error) {
      if (errno(error) === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error(`too many backups named ${first}`);
}

/**
 * 確認済みの変更を書く。読み直してハッシュが違えば書かない (conflict)。
 * バックアップに失敗したら書かない (failed)。
 *
 * @param next 読んだ JSON (ファイルが無ければ null) から、書く中身の文字列を
 *   作る。確認の画面を作った関数と同じものを使う。
 * @param error 呼び出し側の例外の型に合わせて作る。cause は必ず載せる。
 * @returns バックアップの場所 (ファイルが無かったなら null)
 */
export async function commitJsonSettingsChange(options: {
  configDir: string;
  path: string;
  check: (root: unknown) => ShapeIssue[];
  baseHash: string;
  realPath: string;
  fileIdentity: string;
  next: (root: Record<string, unknown> | null, text: string | null) => string;
  now: Date;
  ops: SettingsWriteOps;
  error: (
    code: "conflict" | "failed",
    message: string,
    cause?: unknown,
  ) => Error;
}): Promise<{ backupPath: string | null }> {
  const { path } = options;
  return withFileLock(`${options.realPath}.lock`, () => {
    const read = readJsonSettingsFile(options.configDir, path, options.check);
    const conflicts: string[] = [];
    if (read.kind !== "ok" && read.kind !== "missing") {
      conflicts.push(
        read.kind === "unreadable"
          ? `the current file cannot be read: ${read.detail}`
          : "the settings directory no longer exists",
      );
    } else {
      conflicts.push(
        ...settingsRevisionConflicts(
          {
            baseHash: contentHash(read),
            realPath: read.realPath,
            fileIdentity: settingsFileIdentity(read),
          },
          options,
        ),
      );
    }
    if (conflicts.length > 0) {
      throw options.error(
        "conflict",
        `${path} changed after it was shown for confirmation; nothing was changed. Review it again.\n${conflicts.map((reason) => `- ${reason}`).join("\n")}`,
      );
    }
    const current = read as Extract<JsonFileRead, { kind: "ok" | "missing" }>;
    let backupPath: string | null = null;
    if (current.kind === "ok") {
      try {
        backupPath = writeBackupUnique(
          options.ops,
          path,
          options.now,
          current.realPath,
          current.mode,
        );
      } catch (cause) {
        throw options.error(
          "failed",
          `failed to back up ${path}; nothing was changed.`,
          cause,
        );
      }
    }
    const text = options.next(
      current.kind === "ok" ? current.root : null,
      current.kind === "ok" ? current.text : null,
    );
    try {
      writeFileAtomic(
        current.realPath,
        text,
        current.kind === "ok" ? current.mode : 0o600,
      );
    } catch (cause) {
      throw options.error(
        "failed",
        `failed to write ${current.realPath}. ${
          backupPath ? `The previous content is in ${backupPath}.` : ""
        }`,
        cause,
      );
    }
    return { backupPath };
  });
}
