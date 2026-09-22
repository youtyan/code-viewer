// 入口のサーバの居場所 (`<状態ディレクトリ>/entry.json`)。
//
// ユーザーが起動する code-viewer は 1 つ (入口) で、どのディレクトリで
// `code-viewer` を打っても同じ入口を使う。CLI はここを読んで、生きている同じ版の
// 入口があれば「このディレクトリを開いて」を送って終わる。フックの申告と
// `code-viewer terminal` の送り先もここ。
//
// 置き場所は agents.md 8 の手順どおり状態ディレクトリの下 (テストは
// CODE_VIEWER_TEST_STATE_DIR で逃げる)。複数の CLI が同時に起動しうるので、
// 入口になる前に起動ロック (acquireEntryStartLock) を取る。
//
// 壊れたファイルは上書きしない。読めない理由を返し、呼び出し側が表に出す。
// 変える外部状態と戻し方: このファイルだけ。入口が終わるときに自分の分を
// 消す。落ちて残ったものは pid が居ないので「居ない」として扱い、次の入口が
// 書き直す。

import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { formatErrorDetail } from "../../core/error-detail";
import { createLinkedAbortController } from "../abort";
import { type FileLock, processAlive, tryAcquireFileLock } from "../file-lock";
import { type RegistryFileRead, readRegistryFile } from "../registry-file";
import { errno, writeFileAtomic } from "../terminal/settings-file";
import { codeViewerStateDir } from "../user-state-dir";

export type EntryRecord = {
  url: string;
  pid: number;
  token: string;
  version: string;
  started_at: string;
};

export const ENTRY_IDENTITY_TIMEOUT_MS = 1500;

export type EntryIdentityVerification =
  | { status: "ok" }
  | { status: "dead" }
  | { status: "unreachable"; error: unknown }
  | { status: "invalid"; detail: string };

export function isEntryToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{16}$/.test(value);
}

export type ServerIdentityRole = "entry" | "standalone";

export type ServerIdentityRecord = {
  url: string;
  pid: number;
  token: string;
  version: string;
};

export type ServerIdentityRequest = (
  url: string,
  signal: AbortSignal,
) => Promise<Response>;

/** 起動ロックを古いとみなす時間。入口の起動 (待ち受けまで) より十分長く。 */
const ENTRY_START_LOCK_STALE_MS = 30_000;

export function entryFilePath(): string {
  return join(codeViewerStateDir(), "entry.json");
}

function parseEntryRecord(
  raw: unknown,
):
  | { ok: true; registry: EntryRecord | null }
  | { ok: false; issues: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, issues: ["expected an object"] };
  }
  const entry = raw as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof entry.url !== "string" || !entry.url) issues.push("url: missing");
  else if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(entry.url)) {
    issues.push(`url: not a loopback root URL (${entry.url})`);
  }
  if (!Number.isInteger(entry.pid) || (entry.pid as number) < 1) {
    issues.push("pid: not a process id");
  }
  if (!isEntryToken(entry.token)) {
    issues.push("token: expected 16 lower-case hexadecimal characters");
  }
  if (typeof entry.version !== "string" || !entry.version) {
    issues.push("version: missing");
  }
  if (typeof entry.started_at !== "string" || !entry.started_at) {
    issues.push("started_at: missing");
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    registry: {
      url: entry.url as string,
      pid: entry.pid as number,
      token: entry.token as string,
      version: entry.version as string,
      started_at: entry.started_at as string,
    },
  };
}

/** 読む。無ければ entry: null。読めない・形が違えば ok: false と理由の全文。 */
export function readEntryRecord(
  path: string = entryFilePath(),
): RegistryFileRead<EntryRecord | null> {
  return readRegistryFile(path, parseEntryRecord, () => null);
}

export function writeEntryRecord(
  entry: EntryRecord,
  path: string = entryFilePath(),
): void {
  writeFileAtomic(path, `${JSON.stringify(entry, null, 2)}\n`, 0o600);
}

/** 自分 (pid) の記録なら消す。別の入口が書き直していれば触らない。 */
export function removeEntryRecord(
  pid: number,
  path: string = entryFilePath(),
): void {
  const read = readEntryRecord(path);
  if (read.ok === false || read.registry?.pid !== pid) return;
  try {
    unlinkSync(path);
  } catch (error) {
    if (errno(error) === "ENOENT") return;
    throw error;
  }
}

/**
 * 記録の入口が生きているか (pid だけ)。本当に入口かは `/_entry` で確かめる
 * (pid は使い回される)。
 */
export function entryProcessAlive(entry: EntryRecord): boolean {
  return processAlive(entry.pid);
}

/** pid・token・version が登録と HTTP 本人確認の両方で一致するか。 */
export async function verifyServerIdentity(
  expected: ServerIdentityRecord,
  role: ServerIdentityRole,
  request: ServerIdentityRequest = (url, signal) =>
    fetch(url, { redirect: "error", signal }),
): Promise<EntryIdentityVerification> {
  if (!processAlive(expected.pid)) return { status: "dead" };
  const identityAbort = createLinkedAbortController(
    undefined,
    ENTRY_IDENTITY_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await request(
      new URL("_entry", expected.url).href,
      identityAbort.signal,
    );
  } catch (error) {
    return { status: "unreachable", error };
  } finally {
    identityAbort.cleanup();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return {
      status: "invalid",
      detail: `the server at ${expected.url} returned HTTP ${response.status} with an identity that is not JSON:\n${formatErrorDetail(error)}`,
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      status: "invalid",
      detail: `the server at ${expected.url} failed identity verification:\n- response mismatch: expected an object (HTTP ${response.status})`,
    };
  }
  const identity = body as {
    role?: unknown;
    pid?: unknown;
    token?: unknown;
    version?: unknown;
  };
  const mismatches: string[] = [];
  if (!response.ok) {
    mismatches.push(`HTTP status mismatch: received ${response.status}`);
  }
  if (identity.role !== role) {
    mismatches.push(`role mismatch: expected ${role}`);
  }
  if (identity.pid !== expected.pid) {
    mismatches.push(
      `pid mismatch: expected ${expected.pid}, received ${String(identity.pid)}`,
    );
  }
  if (identity.token !== expected.token) {
    mismatches.push("token mismatch");
  }
  if (identity.version !== expected.version) {
    mismatches.push(
      `version mismatch: expected ${expected.version}, received ${String(identity.version)}`,
    );
  }
  if (mismatches.length > 0) {
    return {
      status: "invalid",
      detail: `the server at ${expected.url} failed identity verification:\n${mismatches.map((reason) => `- ${reason}`).join("\n")}`,
    };
  }
  return { status: "ok" };
}

/** entry.json 用の後方互換 wrapper。 */
export function verifyEntryIdentity(
  entry: EntryRecord,
): Promise<EntryIdentityVerification> {
  return verifyServerIdentity(entry, "entry");
}

/** 動いている入口の記録。読めない記録は理由を投げる。 */
export function liveEntryRecord(
  path: string = entryFilePath(),
): EntryRecord | null {
  const read = readEntryRecord(path);
  if (read.ok === false) throw new Error(read.error);
  const entry = read.registry;
  return entry && entryProcessAlive(entry) ? entry : null;
}

/**
 * 動いている入口の URL (末尾の `/` なし)。記録が無い・pid が居ないなら null。
 * 読めない記録は理由を投げる (黙って「居ない」にしない)。本当に入口かは
 * 呼び出し側が要求して確かめる。
 */
export function liveEntryUrl(path: string = entryFilePath()): string | null {
  const entry = liveEntryRecord(path);
  if (!entry) return null;
  return entry.url.replace(/\/+$/, "");
}

/** 入口になる前の排他。ほかの生きた CLI が起動中なら null。 */
export function acquireEntryStartLock(
  now = Date.now(),
  path: string = entryFilePath(),
): FileLock | null {
  return tryAcquireFileLock(`${path}.start.lock`, {
    staleMs: ENTRY_START_LOCK_STALE_MS,
    now,
  });
}
