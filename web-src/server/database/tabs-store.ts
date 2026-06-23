import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TabState, TabsState } from "../../core/database/types";
import { makeId } from "../../core/id";

const CODE_VIEWER_DIR = ".code-viewer";
const TABS_FILE_NAME = "tabs.json";
// 暴走防止用の hard cap。sqlDraft / es.query 等を 1 タブ最大 ~16KB 持つ
// 想定で、最大 64 tabs * 16KB ≒ 1MB を上限にしておく (実用上はもっと小さい)。
const MAX_TABS = 64;
const MAX_JSON_BYTES = 1_000_000;
// 1 タブの自由入力フィールドの個別上限。
const MAX_SQL_DRAFT_LEN = 16_000;
const MAX_ES_QUERY_LEN = 16_000;
const MAX_TAB_ID_LEN = 128;
const MAX_DB_ID_LEN = 2048;
const MAX_TABLE_NAME_LEN = 512;
const MAX_REDIS_KEY_LEN = 1024;
const MAX_REDIS_KEY_FILTER_LEN = 512;
const MAX_INDEX_NAME_LEN = 256;
// CSS の "240px" のような短い文字列だけ受ける。長さで弾く。
const MAX_CSS_SIZE_LEN = 16;
const VALID_VIEWS = new Set([
  "data",
  "query",
  "schema",
  "er",
  "search",
  "snapshot",
]);

function tabsFilePath(root: string): string {
  return join(root, CODE_VIEWER_DIR, TABS_FILE_NAME);
}

function emptyState(): TabsState {
  return { version: 1, tabs: [], activeTabId: null };
}

// CSS の "240px" のような size 文字列を受け付けるか判定する。
// 形式: 数値 + 単位 (px / %)。安全側に厳しめ。
function isValidCssSize(s: string): boolean {
  if (s.length === 0 || s.length > MAX_CSS_SIZE_LEN) return false;
  const match = /^(\d+(?:\.\d+)?)(px|%)$/.exec(s);
  if (!match) return false;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return false;
  return match[2] === "%"
    ? value >= 0 && value <= 100
    : value >= 80 && value <= 2000;
}

function sanitizeOptionalString(
  v: unknown,
  maxLen: number,
): string | undefined {
  if (typeof v !== "string") return undefined;
  if (v.length === 0) return undefined;
  if (v.length > maxLen) return v.slice(0, maxLen);
  return v;
}

function sanitizeCssSize(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return isValidCssSize(v) ? v : undefined;
}

function sanitizeRedis(v: unknown): NonNullable<TabState["redis"]> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  const out: NonNullable<TabState["redis"]> = {};
  if (
    typeof r.dbIndex === "number" &&
    Number.isInteger(r.dbIndex) &&
    r.dbIndex >= 0 &&
    r.dbIndex < 256
  ) {
    out.dbIndex = r.dbIndex;
  }
  const key = sanitizeOptionalString(r.key, MAX_REDIS_KEY_LEN);
  if (key !== undefined) out.key = key;
  const keyFilter = sanitizeOptionalString(
    r.keyFilter,
    MAX_REDIS_KEY_FILTER_LEN,
  );
  if (keyFilter !== undefined) out.keyFilter = keyFilter;
  if (
    out.dbIndex === undefined &&
    out.key === undefined &&
    out.keyFilter === undefined
  )
    return undefined;
  return out;
}

function sanitizeEs(v: unknown): NonNullable<TabState["es"]> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  const out: NonNullable<TabState["es"]> = {};
  const index = sanitizeOptionalString(r.index, MAX_INDEX_NAME_LEN);
  if (index !== undefined) out.index = index;
  const query = sanitizeOptionalString(r.query, MAX_ES_QUERY_LEN);
  if (query !== undefined) out.query = query;
  if (out.index === undefined && out.query === undefined) return undefined;
  return out;
}

// 入力 JSON を厳密に検証して unknown フィールドを捨てる。tabs.json は
// ユーザーが手で書き換える可能性もあるので、壊れた値は静かに正規化する。
function sanitize(input: unknown): TabsState {
  if (!input || typeof input !== "object") return emptyState();
  const obj = input as Record<string, unknown>;
  if (obj.version !== 1) return emptyState();
  const rawTabs = Array.isArray(obj.tabs) ? obj.tabs : [];
  const seenIds = new Set<string>();
  const tabs: TabsState["tabs"] = [];
  for (const t of rawTabs) {
    if (tabs.length >= MAX_TABS) break;
    if (!t || typeof t !== "object") continue;
    const tab = t as Record<string, unknown>;
    const id = sanitizeOptionalString(tab.id, MAX_TAB_ID_LEN);
    if (!id) continue;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const dbId = sanitizeOptionalString(tab.dbId, MAX_DB_ID_LEN) ?? null;
    const table = sanitizeOptionalString(tab.table, MAX_TABLE_NAME_LEN) ?? null;
    const view =
      typeof tab.view === "string" && VALID_VIEWS.has(tab.view)
        ? (tab.view as TabsState["tabs"][number]["view"])
        : "data";
    const out: TabsState["tabs"][number] = { id, dbId, table, view };

    // optional 永続化 field — 値が valid なときだけ載せる。undefined のときは
    // 載せない (旧形式 tabs.json と同じ表現になる)。
    const sqlDraft = sanitizeOptionalString(tab.sqlDraft, MAX_SQL_DRAFT_LEN);
    if (sqlDraft !== undefined) out.sqlDraft = sqlDraft;
    if (typeof tab.historyOpen === "boolean") out.historyOpen = tab.historyOpen;
    const historyHeight = sanitizeCssSize(tab.historyHeight);
    if (historyHeight !== undefined) out.historyHeight = historyHeight;
    const sidebarWidth = sanitizeCssSize(tab.sidebarWidth);
    if (sidebarWidth !== undefined) out.sidebarWidth = sidebarWidth;
    const redis = sanitizeRedis(tab.redis);
    if (redis !== undefined) out.redis = redis;
    const es = sanitizeEs(tab.es);
    if (es !== undefined) out.es = es;

    tabs.push(out);
  }
  let activeTabId =
    sanitizeOptionalString(obj.activeTabId, MAX_TAB_ID_LEN) ?? null;
  if (activeTabId && !tabs.find((t) => t.id === activeTabId)) {
    activeTabId = tabs.length > 0 ? tabs[0].id : null;
  }
  return { version: 1, tabs, activeTabId };
}

export function loadTabs(cwd: string): TabsState {
  const file = tabsFilePath(cwd);
  if (!existsSync(file)) return emptyState();
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { version?: unknown }).version !== 1
    ) {
      backupInvalidTabsFile(file);
      return emptyState();
    }
    return sanitize(parsed);
  } catch {
    backupInvalidTabsFile(file);
    return emptyState();
  }
}

function backupInvalidTabsFile(file: string): void {
  try {
    renameSync(file, `${file}.bak-${Date.now()}`);
  } catch {
    // best effort only
  }
}

export function saveTabs(cwd: string, state: TabsState): void {
  const normalized = sanitize(state);
  const dir = join(cwd, CODE_VIEWER_DIR);
  mkdirSync(dir, { recursive: true });
  const file = tabsFilePath(cwd);
  const tmp = `${file}.${makeId(`tmp-${process.pid}`)}`;
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) {
    // 上限を超えるほど巨大な state は受けない (構造上ありえないが defensive)。
    throw new Error("tabs state too large");
  }
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}
