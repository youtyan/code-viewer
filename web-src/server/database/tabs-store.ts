import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TabsState } from "../../core/database/types";

const CODE_VIEWER_DIR = ".code-viewer";
const TABS_FILE_NAME = "tabs.json";
// tabs は dbId / id / view 等の短い文字列だけなので、上限は控えめで OK。
// 暴走防止用の hard cap。
const MAX_TABS = 64;
const MAX_JSON_BYTES = 100_000;
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
    if (typeof tab.id !== "string" || !tab.id) continue;
    if (seenIds.has(tab.id)) continue;
    seenIds.add(tab.id);
    const dbId =
      typeof tab.dbId === "string" && tab.dbId.length > 0 ? tab.dbId : null;
    const table =
      typeof tab.table === "string" && tab.table.length > 0 ? tab.table : null;
    const view =
      typeof tab.view === "string" && VALID_VIEWS.has(tab.view)
        ? (tab.view as TabsState["tabs"][number]["view"])
        : "data";
    tabs.push({ id: tab.id, dbId, table, view });
  }
  let activeTabId =
    typeof obj.activeTabId === "string" && obj.activeTabId.length > 0
      ? obj.activeTabId
      : null;
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
    return sanitize(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

export function saveTabs(cwd: string, state: TabsState): void {
  const normalized = sanitize(state);
  const dir = join(cwd, CODE_VIEWER_DIR);
  mkdirSync(dir, { recursive: true });
  const file = tabsFilePath(cwd);
  const tmp = `${file}.tmp-${process.pid}`;
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) {
    // 上限を超えるほど巨大な state は受けない (構造上ありえないが defensive)。
    throw new Error("tabs state too large");
  }
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}
