// アカウントごとの使用量 (5 時間枠・週枠) を、エージェントがディスクに
// 書いたものから読む。API は呼ばない。
//
// - claude: statusLine に渡される JSON にしか上限の情報が無い
//   (https://code.claude.com/docs/en/statusline の rate_limits)。statusLine
//   を包むスクリプト (terminal/statusline.ts) が、受け取った JSON を
//   `<状態ディレクトリ>/agent-usage/claude-<鍵>.json` に保存する。鍵は
//   そのセッションの CLAUDE_CONFIG_DIR の値 (既定なら空文字) の POSIX cksum。
//   包むスクリプトは sh で動くので、どのアカウントかを数ミリ秒で名前に
//   できるのはこれだけ (cksum は POSIX の必須コマンド)
// - codex: `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl` の
//   `token_count` イベントの rate_limits。公式に約束された書式ではないので、
//   読めなければ理由つきで「取得できません」にする。大きなファイルは末尾
//   だけを読み、同じ大きさ・時刻なら読み直さない
//
// どちらも「いつの値か」(observedAt) を必ず返す。

import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  AccountAgent,
  AccountUsage,
  UsageWindow,
} from "../../core/agent-accounts";
import { usageWindowsConflict } from "../../core/agent-accounts";
import { formatErrorDetail } from "../../core/error-detail";
import { errno } from "../terminal/settings-file";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

/** POSIX の `cksum` と同じ値 (CRC-32/CKSUM、長さを後ろに足す)。 */
export function posixCksum(text: string): number {
  const bytes = new TextEncoder().encode(text);
  let crc = 0;
  const feed = (byte: number) => {
    crc = ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0;
  };
  for (const byte of bytes) feed(byte);
  for (
    let length = bytes.length;
    length > 0;
    length = Math.floor(length / 256)
  ) {
    feed(length & 0xff);
  }
  return ~crc >>> 0;
}

export function claudeUsageFile(usageDir: string, envValue: string): string {
  return join(usageDir, `claude-${posixCksum(envValue)}.json`);
}

/** statusLine の JSON の上限。これより大きいものは読まない。 */
const MAX_STATUSLINE_BYTES = 1024 * 1024;

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 秒でも ms でも受ける (1e12 を超えたら ms とみなす)。 */
function epochMs(value: unknown): number {
  const n = finite(value);
  if (n === null || n <= 0) return 0;
  return n > 1e12 ? n : n * 1000;
}

/** statusLine に渡された JSON から使用量を取り出す。 */
export function parseClaudeStatusline(
  text: string,
  observedAt: number,
): AccountUsage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      status: "unavailable",
      reason: "unreadable",
      detail: `the saved statusline input is not JSON: ${formatErrorDetail(error)}`,
      observedAt,
    };
  }
  if (!isPlainObject(parsed)) {
    return {
      status: "unavailable",
      reason: "unreadable",
      detail: "the saved statusline input is not a JSON object",
      observedAt,
    };
  }
  const limits = parsed.rate_limits;
  if (limits === undefined || limits === null) {
    return {
      status: "unavailable",
      reason: "no-limits",
      detail: "",
      observedAt,
    };
  }
  if (!isPlainObject(limits)) {
    return {
      status: "unavailable",
      reason: "unreadable",
      detail: "rate_limits is not an object",
      observedAt,
    };
  }
  const windows: UsageWindow[] = [];
  const problems: string[] = [];
  for (const [key, kind, minutes] of [
    ["five_hour", "five_hour", 300],
    ["seven_day", "seven_day", 10080],
  ] as const) {
    const window = limits[key];
    if (window === undefined || window === null) continue;
    const used = isPlainObject(window) ? finite(window.used_percentage) : null;
    if (!isPlainObject(window) || used === null) {
      problems.push(`rate_limits.${key}.used_percentage is not a number`);
      continue;
    }
    windows.push({
      kind,
      minutes,
      usedPercent: used,
      resetsAt: epochMs(window.resets_at),
    });
  }
  if (problems.length > 0) {
    return {
      status: "unavailable",
      reason: "unreadable",
      detail: problems.join("\n"),
      observedAt,
    };
  }
  if (windows.length === 0) {
    return {
      status: "unavailable",
      reason: "no-limits",
      detail: "",
      observedAt,
    };
  }
  return { status: "ok", windows, observedAt };
}

/**
 * claude のアカウントの使用量。包むスクリプトが保存した最新のファイルを
 * 読む。envValues はそのアカウントを指す CLAUDE_CONFIG_DIR の値の候補
 * (既定なら空文字と既定のディレクトリ)。いちばん新しいものを使う。
 */
export function readClaudeUsage(
  usageDir: string,
  envValues: readonly string[],
  wrapped: boolean,
): AccountUsage {
  let newest: { path: string; mtime: number; size: number } | null = null;
  for (const value of envValues) {
    const path = claudeUsageFile(usageDir, value);
    try {
      const stat = statSync(path);
      if (!newest || stat.mtimeMs > newest.mtime) {
        newest = { path, mtime: stat.mtimeMs, size: stat.size };
      }
    } catch (error) {
      if (errno(error) === "ENOENT") continue;
      return {
        status: "unavailable",
        reason: "unreadable",
        detail: `failed to read ${path}: ${formatErrorDetail(error)}`,
        observedAt: 0,
      };
    }
  }
  if (!newest) {
    return {
      status: "unavailable",
      reason: wrapped ? "no-data" : "not-wrapped",
      detail: "",
      observedAt: 0,
    };
  }
  if (newest.size > MAX_STATUSLINE_BYTES) {
    return {
      status: "unavailable",
      reason: "unreadable",
      detail: `${newest.path} is larger than ${MAX_STATUSLINE_BYTES} bytes`,
      observedAt: Math.floor(newest.mtime),
    };
  }
  let text: string;
  try {
    text = readTail(newest.path, newest.size, newest.size);
  } catch (error) {
    return {
      status: "unavailable",
      reason: "unreadable",
      detail: `failed to read ${newest.path}: ${formatErrorDetail(error)}`,
      observedAt: Math.floor(newest.mtime),
    };
  }
  const usage = parseClaudeStatusline(text, Math.floor(newest.mtime));
  if (usage.status !== "ok" && usage.detail) {
    return { ...usage, detail: `${newest.path}: ${usage.detail}` };
  }
  return usage;
}

function readTail(path: string, size: number, bytes: number): string {
  const length = Math.min(size, bytes);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    let offset = 0;
    while (offset < length) {
      const read = readSync(
        fd,
        buffer,
        offset,
        length - offset,
        size - length + offset,
      );
      if (read === 0) break;
      offset += read;
    }
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** codex のセッション記録の末尾から読む量。token_count は数百バイト。 */
const CODEX_TAIL_BYTES = 256 * 1024;
/** 1 行がこれより長ければ token_count ではない (会話の中身)。 */
const MAX_TOKEN_COUNT_LINE = 64 * 1024;
/** 新しいほうから見るセッション記録の数。 */
const CODEX_FILES_TO_SCAN = 5;
/** 見る日付のディレクトリの数。 */
const CODEX_DAYS_TO_SCAN = 3;
/** 混在を疑うのは、最新の記録とこの時間の中で観測された記録だけ。 */
const CODEX_MIXED_WINDOW_MS = 6 * 60 * 60_000;

function codexWindow(value: unknown): UsageWindow | null | "bad" {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) return "bad";
  const used = finite(value.used_percent);
  if (used === null) return "bad";
  const minutes = finite(value.window_minutes) ?? 0;
  return {
    kind:
      minutes === 300 ? "five_hour" : minutes === 10080 ? "seven_day" : "other",
    minutes,
    usedPercent: used,
    resetsAt: epochMs(value.resets_at),
  };
}

/**
 * セッション記録の 1 行が token_count で rate_limits を持っていれば、
 * その使用量。関係ない行なら null。
 */
export function parseCodexTokenCountLine(line: string): AccountUsage | null {
  if (!line.includes('"token_count"') || line.length > MAX_TOKEN_COUNT_LINE) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return {
      status: "unavailable",
      reason: "unreadable",
      detail: `a token_count line is not JSON: ${formatErrorDetail(error)}`,
      observedAt: 0,
    };
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.payload)) return null;
  if (parsed.payload.type !== "token_count") return null;
  const limits = parsed.payload.rate_limits;
  if (limits === undefined || limits === null) return null;
  const observedAt =
    typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : NaN;
  const at = Number.isFinite(observedAt) ? observedAt : 0;
  if (!isPlainObject(limits)) {
    return {
      status: "unavailable",
      reason: "unreadable",
      detail: "rate_limits is not an object",
      observedAt: at,
    };
  }
  const windows: UsageWindow[] = [];
  for (const key of ["primary", "secondary"] as const) {
    const window = codexWindow(limits[key]);
    if (window === "bad") {
      return {
        status: "unavailable",
        reason: "unreadable",
        detail: `rate_limits.${key} does not have a numeric used_percent`,
        observedAt: at,
      };
    }
    if (window) windows.push(window);
  }
  if (windows.length === 0) {
    return {
      status: "unavailable",
      reason: "no-token-count",
      detail: "rate_limits has neither primary nor secondary",
      observedAt: at,
    };
  }
  return { status: "ok", windows, observedAt: at };
}

/** 末尾から見て、最後に rate_limits を持つ token_count の行。 */
export function lastCodexUsage(text: string): AccountUsage | null {
  const lines = text.split("\n");
  let incomplete: AccountUsage | null = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    const usage = parseCodexTokenCountLine(line);
    if (
      i === lines.length - 1 &&
      !text.endsWith("\n") &&
      usage?.status === "unavailable" &&
      usage.reason === "unreadable"
    ) {
      try {
        JSON.parse(line);
      } catch {
        incomplete = usage;
        continue;
      }
    }
    if (usage) return usage;
  }
  return incomplete;
}

function listDesc(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .sort()
    .reverse();
}

/** 読んだ結果を、ファイルの大きさと時刻が同じ間だけ覚える。 */
const codexCache = new Map<
  string,
  { key: string; usage: AccountUsage | null }
>();

/** 新しいほうのセッション記録 (最大 CODEX_FILES_TO_SCAN 本)。 */
function recentRolloutFiles(
  sessions: string,
): { path: string; mtime: number; size: number }[] {
  const days: string[] = [];
  for (const year of listDesc(sessions)) {
    if (!/^\d{4}$/.test(year)) continue;
    for (const month of listDesc(join(sessions, year))) {
      if (!/^\d{2}$/.test(month)) continue;
      for (const day of listDesc(join(sessions, year, month))) {
        if (!/^\d{2}$/.test(day)) continue;
        days.push(join(sessions, year, month, day));
        if (days.length >= CODEX_DAYS_TO_SCAN) break;
      }
      if (days.length >= CODEX_DAYS_TO_SCAN) break;
    }
    if (days.length >= CODEX_DAYS_TO_SCAN) break;
  }
  const files: { path: string; mtime: number; size: number }[] = [];
  for (const day of days) {
    for (const name of readdirSync(day)) {
      if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
      const path = join(day, name);
      const stat = statSync(path);
      files.push({ path, mtime: stat.mtimeMs, size: stat.size });
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, CODEX_FILES_TO_SCAN);
}

export function readCodexUsage(configDir: string): AccountUsage {
  const sessions = join(configDir, "sessions");
  let files: { path: string; mtime: number; size: number }[];
  try {
    files = recentRolloutFiles(sessions);
  } catch (error) {
    // sessions そのものが無いときだけ「まだ使っていない」。中の日付のフォルダや
    // ファイルが途中で消えたのは、読めなかった理由として出す。
    if (
      errno(error) === "ENOENT" &&
      (error as NodeJS.ErrnoException).path === sessions
    ) {
      return {
        status: "unavailable",
        reason: "no-sessions",
        detail: "",
        observedAt: 0,
      };
    }
    return {
      status: "unavailable",
      reason: "unreadable",
      detail: `failed to list ${sessions}: ${formatErrorDetail(error)}`,
      observedAt: 0,
    };
  }
  if (files.length === 0) {
    return {
      status: "unavailable",
      reason: "no-sessions",
      detail: "",
      observedAt: 0,
    };
  }
  const normal: Extract<AccountUsage, { status: "ok" }>[] = [];
  let unavailable: Extract<AccountUsage, { status: "unavailable" }> | null =
    null;
  for (const file of files) {
    const key = `${file.size}:${file.mtime}`;
    let usage: AccountUsage | null;
    const hit = codexCache.get(file.path);
    if (hit && hit.key === key) {
      usage = hit.usage;
    } else {
      try {
        usage = lastCodexUsage(
          readTail(file.path, file.size, CODEX_TAIL_BYTES),
        );
      } catch (error) {
        return {
          status: "unavailable",
          reason: "unreadable",
          detail: `failed to read ${file.path}: ${formatErrorDetail(error)}`,
          observedAt: 0,
        };
      }
      codexCache.set(file.path, { key, usage });
      if (codexCache.size > 200) {
        const oldest = codexCache.keys().next().value;
        if (oldest !== undefined) codexCache.delete(oldest);
      }
    }
    if (!usage) continue;
    if (usage.status === "unavailable") {
      unavailable ??= usage.detail
        ? { ...usage, detail: `${file.path}: ${usage.detail}` }
        : usage;
      continue;
    }
    normal.push(usage);
  }
  normal.sort((a, b) => b.observedAt - a.observedAt);
  const [first, ...older] = normal;
  if (first) {
    // 新しいほうの記録と同じ枠なのにリセットの時刻が違う = 同じ設定ディレクトリで
    // 別のアカウントとしてログインした記録。0% を今の値のように見せない。
    for (const usage of older) {
      if (
        first.observedAt - usage.observedAt <= CODEX_MIXED_WINDOW_MS &&
        usageWindowsConflict(first, usage)
      ) {
        return {
          ...first,
          mixed: { windows: usage.windows, observedAt: usage.observedAt },
        };
      }
    }
    return first;
  }
  if (unavailable) return unavailable;
  return {
    status: "unavailable",
    reason: "no-token-count",
    detail: files.map((file) => file.path).join("\n"),
    observedAt: 0,
  };
}

export function readAccountUsage(
  agent: AccountAgent,
  configDir: string,
  options: { usageDir: string; claudeEnvValues: string[]; wrapped: boolean },
): AccountUsage {
  if (agent === "codex") return readCodexUsage(configDir);
  return readClaudeUsage(
    options.usageDir,
    options.claudeEnvValues,
    options.wrapped,
  );
}
