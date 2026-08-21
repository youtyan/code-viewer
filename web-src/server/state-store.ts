import { join } from "node:path";
import { sanitizeKeymapOverrides } from "../core/keymap";
import {
  MAX_GREP_PALETTE_HEIGHT,
  MAX_GREP_PALETTE_WIDTH,
  MIN_GREP_PALETTE_HEIGHT,
  MIN_GREP_PALETTE_WIDTH,
} from "../core/search-palette";
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from "../core/tmux";
import {
  isToolId,
  MAX_TOOLS_SHEET_WIDTH,
  MIN_TOOLS_SHEET_WIDTH,
  TOOL_IDS,
  type ToolId,
} from "../core/tools";
import type {
  AppSettingsState,
  DbUiPrefs,
  DbUiState,
  ToolsState,
  ViewerFontSizeSetting,
  ViewState,
} from "../core/types";
import { createJsonFileStore, type JsonFileStore } from "./json-store";
import {
  MAX_WORKTREE_WATCH_DIRECTORY_LIMIT,
  MIN_WORKTREE_WATCH_DIRECTORY_LIMIT,
} from "./worktree-watcher";

const CODE_VIEWER_DIR = ".code-viewer";
const SETTINGS_FILE_NAME = "settings.json";
const VIEW_STATE_FILE_NAME = "view-state.json";
const DB_UI_FILE_NAME = "db-ui.json";
const TOOLS_FILE_NAME = "tools.json";
const MAX_SETTINGS_BYTES = 200_000;
const MAX_VIEW_STATE_BYTES = 1_000_000;
const MAX_DB_UI_BYTES = 1_000_000;
// 1 ツールあたりの下書き上限 (UTF-16 コード単位)。
const MAX_TOOL_DRAFT_LEN = 200_000;
// 下書きは 3 ツール分あり、UTF-8 では 1 文字が最大 4 バイトになる。上限まで
// 埋めた 3 ツール分 (最悪 2.4 MB) が JSON 化しても収まる大きさを取る。ここが
// 足りないと、個別には許可した下書きの組合せが保存できなくなる。
const MAX_TOOLS_BYTES = 4_000_000;
const MAX_REF_LEN = 1024;
const MAX_KEY_LEN = 2048;
const MAX_VIEW_ITEMS = 20_000;
const MAX_GREP_SELECTION_HISTORY_ITEMS = 100;
const MAX_RECENT_REFS = 8;
const MAX_DB_UI_DBS = 200;
const MAX_DB_UI_TABLES = 500;
const MAX_DB_UI_COLUMNS = 1000;
const MAX_DB_UI_EXPANDED_SCOPES = 500;

function codeViewerPath(root: string, fileName: string): string {
  return join(root, CODE_VIEWER_DIR, fileName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length === 0 || value.length > maxLen) return undefined;
  if (value.includes("\0")) return undefined;
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

// ai-dup-check: allow -- app-state sanitizer clamps numeric settings locally.
function optionalFiniteNumber(
  value: unknown,
  min: number,
  max: number,
  round: boolean,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = round ? Math.round(value) : value;
  return Math.max(min, Math.min(max, normalized));
}

function optionalNumber(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  return optionalFiniteNumber(value, min, max, true);
}

function optionalFloat(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  return optionalFiniteNumber(value, min, max, false);
}

function optionalFontSize(value: unknown): ViewerFontSizeSetting | undefined {
  return value === "compact" ||
    value === "regular" ||
    value === "large" ||
    value === "xlarge"
    ? value
    : undefined;
}

function normalizeStringList(
  value: unknown,
  options: {
    maxItems: number;
    maxLen: number;
    pathSafe?: boolean;
    keepLast?: boolean;
    sort?: boolean;
  },
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  const items = options.keepLast ? [...value].reverse() : value;
  for (const item of items) {
    if (out.length >= options.maxItems) break;
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || name.length > options.maxLen || name.includes("\0")) continue;
    if (
      options.pathSafe &&
      (name.includes("/") ||
        name.includes("\\") ||
        name === "." ||
        name === ".." ||
        name === ".git")
    ) {
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  if (options.keepLast) out.reverse();
  return options.sort === false ? out : out.sort((a, b) => a.localeCompare(b));
}

function emptySettings(): AppSettingsState {
  return { version: 1 };
}

function emptyViewState(): ViewState {
  return {
    version: 1,
    collapsedDirs: [],
    lazyExpandedDirs: [],
    viewedFiles: [],
  };
}

function emptyDbUiState(): DbUiState {
  return { version: 1, columnWidths: {} };
}

function sanitizeSettings(raw: unknown): AppSettingsState {
  if (!isRecord(raw)) return emptySettings();
  const out: AppSettingsState = { version: 1 };
  if (raw.layout === "side-by-side" || raw.layout === "line-by-line")
    out.layout = raw.layout;
  if (raw.theme === "light" || raw.theme === "dark") out.theme = raw.theme;
  if (raw.language === "en" || raw.language === "ja")
    out.language = raw.language;
  if (raw.sidebarView === "tree" || raw.sidebarView === "flat")
    out.sidebarView = raw.sidebarView;
  const sidebarWidth = optionalNumber(raw.sidebarWidth, 180, 900);
  if (sidebarWidth !== undefined) out.sidebarWidth = sidebarWidth;
  const historyWidth = optionalNumber(raw.historyWidth, 220, 640);
  if (historyWidth !== undefined) out.historyWidth = historyWidth;
  const sidebarHidden = optionalBoolean(raw.sidebarHidden);
  if (sidebarHidden !== undefined) out.sidebarHidden = sidebarHidden;
  const sidebarFontSize = optionalFontSize(raw.sidebarFontSize);
  if (sidebarFontSize) out.sidebarFontSize = sidebarFontSize;
  const codeFontSize = optionalFontSize(raw.codeFontSize);
  if (codeFontSize) out.codeFontSize = codeFontSize;
  // ターミナルは段階値ではなく px の実数。範囲は core と同じものを使う。
  const terminalFontSize = optionalNumber(
    raw.terminalFontSize,
    MIN_TERMINAL_FONT_SIZE,
    MAX_TERMINAL_FONT_SIZE,
  );
  if (terminalFontSize !== undefined) out.terminalFontSize = terminalFontSize;
  const appPanelDocked = optionalBoolean(raw.appPanelDocked);
  if (appPanelDocked !== undefined) out.appPanelDocked = appPanelDocked;
  const syntaxHighlight = optionalBoolean(raw.syntaxHighlight);
  if (syntaxHighlight !== undefined) out.syntaxHighlight = syntaxHighlight;
  const autoUpdate = optionalBoolean(raw.autoUpdate);
  if (autoUpdate !== undefined) out.autoUpdate = autoUpdate;
  const queryHistoryPanelWidth = optionalNumber(
    raw.queryHistoryPanelWidth,
    280,
    800,
  );
  if (queryHistoryPanelWidth !== undefined)
    out.queryHistoryPanelWidth = queryHistoryPanelWidth;
  const annotationPanelOpen = optionalBoolean(raw.annotationPanelOpen);
  if (annotationPanelOpen !== undefined)
    out.annotationPanelOpen = annotationPanelOpen;
  const annotationPanelWidth = optionalNumber(
    raw.annotationPanelWidth,
    260,
    720,
  );
  if (annotationPanelWidth !== undefined)
    out.annotationPanelWidth = annotationPanelWidth;
  const annotationFollow = optionalBoolean(raw.annotationFollow);
  if (annotationFollow !== undefined) out.annotationFollow = annotationFollow;
  const annotationMuted = optionalBoolean(raw.annotationMuted);
  if (annotationMuted !== undefined) out.annotationMuted = annotationMuted;
  const annotationRate = optionalFloat(raw.annotationRate, 0.5, 2);
  if (annotationRate !== undefined) out.annotationRate = annotationRate;
  const ignoreWhitespace = optionalBoolean(raw.ignoreWhitespace);
  if (ignoreWhitespace !== undefined) out.ignoreWhitespace = ignoreWhitespace;
  const hideTests = optionalBoolean(raw.hideTests);
  if (hideTests !== undefined) out.hideTests = hideTests;
  const grepRegex = optionalBoolean(raw.grepRegex);
  if (grepRegex !== undefined) out.grepRegex = grepRegex;
  const grepCaseSensitive = optionalBoolean(raw.grepCaseSensitive);
  if (grepCaseSensitive !== undefined)
    out.grepCaseSensitive = grepCaseSensitive;
  const grepWholeWord = optionalBoolean(raw.grepWholeWord);
  if (grepWholeWord !== undefined) out.grepWholeWord = grepWholeWord;
  const grepGroupByFile = optionalBoolean(raw.grepGroupByFile);
  if (grepGroupByFile !== undefined) out.grepGroupByFile = grepGroupByFile;
  const grepPaletteWidth = optionalNumber(
    raw.grepPaletteWidth,
    MIN_GREP_PALETTE_WIDTH,
    MAX_GREP_PALETTE_WIDTH,
  );
  if (grepPaletteWidth !== undefined) out.grepPaletteWidth = grepPaletteWidth;
  const grepPaletteHeight = optionalNumber(
    raw.grepPaletteHeight,
    MIN_GREP_PALETTE_HEIGHT,
    MAX_GREP_PALETTE_HEIGHT,
  );
  if (grepPaletteHeight !== undefined)
    out.grepPaletteHeight = grepPaletteHeight;
  const grepSelectionHistory = normalizeStringList(raw.grepSelectionHistory, {
    maxItems: MAX_GREP_SELECTION_HISTORY_ITEMS,
    maxLen: MAX_KEY_LEN,
    keepLast: true,
    sort: false,
  });
  if (grepSelectionHistory) out.grepSelectionHistory = grepSelectionHistory;
  const fileSelectionHistory = normalizeStringList(raw.fileSelectionHistory, {
    maxItems: MAX_GREP_SELECTION_HISTORY_ITEMS,
    maxLen: MAX_KEY_LEN,
    keepLast: true,
    sort: false,
  });
  if (fileSelectionHistory) out.fileSelectionHistory = fileSelectionHistory;
  const recentRefs = normalizeStringList(raw.recentRefs, {
    maxItems: MAX_RECENT_REFS,
    maxLen: MAX_REF_LEN,
    keepLast: true,
    sort: false,
  });
  if (recentRefs) out.recentRefs = recentRefs;
  const scopeOmitDirs = normalizeStringList(raw.scopeOmitDirs, {
    maxItems: 100,
    maxLen: 64,
    pathSafe: true,
  });
  if (scopeOmitDirs) out.scopeOmitDirs = scopeOmitDirs;
  const scopeExcludeNames = normalizeStringList(raw.scopeExcludeNames, {
    maxItems: 200,
    maxLen: 128,
    pathSafe: true,
  });
  if (scopeExcludeNames) out.scopeExcludeNames = scopeExcludeNames;
  const scopeWatchLimit = optionalNumber(
    raw.scopeWatchLimit,
    MIN_WORKTREE_WATCH_DIRECTORY_LIMIT,
    MAX_WORKTREE_WATCH_DIRECTORY_LIMIT,
  );
  if (scopeWatchLimit !== undefined) out.scopeWatchLimit = scopeWatchLimit;
  const uploadEnabled = optionalBoolean(raw.uploadEnabled);
  if (uploadEnabled !== undefined) out.uploadEnabled = uploadEnabled;
  // 差分が空なら書かない。全部デフォルトに戻したときにファイルへ {} が
  // 残らないので、次に読んだときは素直に「未設定」として扱える。
  const keybindings = sanitizeKeymapOverrides(raw.keybindings);
  if (Object.keys(keybindings).length) out.keybindings = keybindings;
  if (isRecord(raw.range)) {
    const from = optionalString(raw.range.from, MAX_REF_LEN);
    const to = optionalString(raw.range.to, MAX_REF_LEN);
    if (from && to) out.range = { from, to };
  }
  return out;
}

function mergeSettings(
  current: AppSettingsState,
  patch: unknown,
): AppSettingsState {
  if (!isRecord(patch)) return current;
  const raw = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key === "version") continue;
    if (value === null) delete raw[key];
    else raw[key] = value;
  }
  return sanitizeSettings({ ...raw, version: 1 });
}

function sanitizeViewState(raw: unknown): ViewState {
  if (!isRecord(raw)) return emptyViewState();
  return {
    version: 1,
    collapsedDirs:
      normalizeStringList(raw.collapsedDirs, {
        maxItems: MAX_VIEW_ITEMS,
        maxLen: MAX_KEY_LEN,
        keepLast: true,
        sort: false,
      }) ?? [],
    lazyExpandedDirs:
      normalizeStringList(raw.lazyExpandedDirs, {
        maxItems: MAX_VIEW_ITEMS,
        maxLen: MAX_KEY_LEN,
        keepLast: true,
        sort: false,
      }) ?? [],
    viewedFiles:
      normalizeStringList(raw.viewedFiles, {
        maxItems: MAX_VIEW_ITEMS,
        maxLen: MAX_KEY_LEN,
        keepLast: true,
        sort: false,
      }) ?? [],
  };
}

function mergeViewState(current: ViewState, patch: unknown): ViewState {
  if (!isRecord(patch)) return current;
  const base = sanitizeViewState({ ...current, version: 1 });
  const collapsedDirs = new Set(base.collapsedDirs);
  const lazyExpandedDirs = new Set(base.lazyExpandedDirs);
  const viewedFiles = new Set(base.viewedFiles);
  const addedCollapsedDirs = normalizeStringList(patch.addedCollapsedDirs, {
    maxItems: MAX_VIEW_ITEMS,
    maxLen: MAX_KEY_LEN,
    keepLast: true,
    sort: false,
  });
  for (const path of addedCollapsedDirs || []) {
    collapsedDirs.add(path);
    // collapsed が明示されたら lazyExpanded は意味を失う。
    lazyExpandedDirs.delete(path);
  }
  const removedCollapsedDirs = normalizeStringList(patch.removedCollapsedDirs, {
    maxItems: MAX_VIEW_ITEMS,
    maxLen: MAX_KEY_LEN,
    sort: false,
  });
  for (const path of removedCollapsedDirs || []) collapsedDirs.delete(path);
  const addedLazyExpandedDirs = normalizeStringList(
    patch.addedLazyExpandedDirs,
    {
      maxItems: MAX_VIEW_ITEMS,
      maxLen: MAX_KEY_LEN,
      keepLast: true,
      sort: false,
    },
  );
  for (const path of addedLazyExpandedDirs || []) {
    // 同時に collapsed として渡されていなければ追加。
    if (!collapsedDirs.has(path)) lazyExpandedDirs.add(path);
  }
  const removedLazyExpandedDirs = normalizeStringList(
    patch.removedLazyExpandedDirs,
    {
      maxItems: MAX_VIEW_ITEMS,
      maxLen: MAX_KEY_LEN,
      sort: false,
    },
  );
  for (const path of removedLazyExpandedDirs || [])
    lazyExpandedDirs.delete(path);
  const addedViewedFiles = normalizeStringList(patch.addedViewedFiles, {
    maxItems: MAX_VIEW_ITEMS,
    maxLen: MAX_KEY_LEN,
    keepLast: true,
    sort: false,
  });
  for (const path of addedViewedFiles || []) viewedFiles.add(path);
  const removedViewedFiles = normalizeStringList(patch.removedViewedFiles, {
    maxItems: MAX_VIEW_ITEMS,
    maxLen: MAX_KEY_LEN,
    sort: false,
  });
  for (const path of removedViewedFiles || []) viewedFiles.delete(path);
  return sanitizeViewState({
    version: 1,
    collapsedDirs: [...collapsedDirs],
    lazyExpandedDirs: [...lazyExpandedDirs],
    viewedFiles: [...viewedFiles],
  });
}

function safeObjectKey(value: string): string | null {
  if (!value || value.length > MAX_KEY_LEN || value.includes("\0")) return null;
  return value;
}

// DbUiPrefs に新キーを増やすたびに sanitize/merge を両方触らないで済むよう、
// boolean prefs キーを 1 か所で列挙する。テストもこの集合が完備していること
// を前提にする (state-store-prefs.test.ts)。
const DB_UI_BOOL_PREF_KEYS = ["s3TooltipEnabled", "inferFkRails"] as const;

function sanitizeDbUiPrefs(raw: unknown): DbUiPrefs | undefined {
  if (!isRecord(raw)) return undefined;
  const out: DbUiPrefs = {};
  for (const key of DB_UI_BOOL_PREF_KEYS) {
    const v = raw[key];
    if (v === true || v === false) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeDbUiExpandedTables(
  raw: unknown,
): Record<string, string[]> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string[]> = {};
  let scopeCount = 0;
  for (const [scopeRaw, tablesRaw] of Object.entries(raw)) {
    if (scopeCount >= MAX_DB_UI_EXPANDED_SCOPES) break;
    const scope = safeObjectKey(scopeRaw);
    if (!scope) continue;
    const tables = normalizeStringList(tablesRaw, {
      maxItems: MAX_DB_UI_TABLES,
      maxLen: MAX_KEY_LEN,
      sort: true,
    });
    if (!tables || tables.length === 0) continue;
    out[scope] = tables;
    scopeCount++;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeDbUiState(raw: unknown): DbUiState {
  if (!isRecord(raw)) return emptyDbUiState();
  const prefs = sanitizeDbUiPrefs(raw.prefs);
  const expandedTables = sanitizeDbUiExpandedTables(raw.expandedTables);
  // snapshot 取得ダイアログの「前回どのテーブルにチェックしてたか」も
  // expandedTables と同じ `Record<scope, string[]>` 形なので sanitize ロジック
  // を共有する。専用ラッパは作らない。
  const snapshotSelectedTables = sanitizeDbUiExpandedTables(
    raw.snapshotSelectedTables,
  );
  if (!isRecord(raw.columnWidths)) {
    const out = emptyDbUiState();
    if (expandedTables) out.expandedTables = expandedTables;
    if (snapshotSelectedTables)
      out.snapshotSelectedTables = snapshotSelectedTables;
    if (prefs) out.prefs = prefs;
    return out;
  }
  const columnWidths: DbUiState["columnWidths"] = {};
  let dbCount = 0;
  for (const [dbIdRaw, tablesRaw] of Object.entries(raw.columnWidths)) {
    if (dbCount >= MAX_DB_UI_DBS) break;
    const dbId = safeObjectKey(dbIdRaw);
    if (!dbId || !isRecord(tablesRaw)) continue;
    const tables: Record<string, Record<string, number>> = {};
    let tableCount = 0;
    for (const [tableRaw, columnsRaw] of Object.entries(tablesRaw)) {
      if (tableCount >= MAX_DB_UI_TABLES) break;
      const table = safeObjectKey(tableRaw);
      if (!table || !isRecord(columnsRaw)) continue;
      const columns: Record<string, number> = {};
      let columnCount = 0;
      for (const [columnRaw, widthRaw] of Object.entries(columnsRaw)) {
        if (columnCount >= MAX_DB_UI_COLUMNS) break;
        const column = safeObjectKey(columnRaw);
        const width = optionalNumber(widthRaw, 60, 1200);
        if (!column || width === undefined) continue;
        columns[column] = width;
        columnCount++;
      }
      if (Object.keys(columns).length === 0) continue;
      tables[table] = columns;
      tableCount++;
    }
    if (Object.keys(tables).length === 0) continue;
    columnWidths[dbId] = tables;
    dbCount++;
  }
  const out: DbUiState = { version: 1, columnWidths };
  if (expandedTables) out.expandedTables = expandedTables;
  if (snapshotSelectedTables)
    out.snapshotSelectedTables = snapshotSelectedTables;
  if (prefs) out.prefs = prefs;
  return out;
}

function mergeDbUiPrefs(
  current: DbUiPrefs | undefined,
  patch: unknown,
): DbUiPrefs | undefined {
  if (!isRecord(patch)) return current;
  // patch 内で boolean が来てれば上書き、null なら削除、未指定なら維持。
  // 新キーは DB_UI_BOOL_PREF_KEYS に追加するだけで両方に反映される。
  const next: DbUiPrefs = { ...(current ?? {}) };
  for (const key of DB_UI_BOOL_PREF_KEYS) {
    const v = patch[key];
    if (v === null) delete next[key];
    else if (v === true || v === false) next[key] = v;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function mergeDbUiExpandedTables(
  current: Record<string, string[]> | undefined,
  patch: unknown,
): Record<string, string[]> | undefined {
  if (!isRecord(patch)) return current;
  const next: Record<string, string[]> = { ...(current ?? {}) };
  for (const [scope, tablesRaw] of Object.entries(patch)) {
    if (tablesRaw === null) {
      delete next[scope];
      continue;
    }
    next[scope] = tablesRaw as string[];
  }
  return sanitizeDbUiExpandedTables(next);
}

function mergeDbUiState(current: DbUiState, patch: unknown): DbUiState {
  if (!isRecord(patch)) return current;
  // prefs はトップレベル並列の独立キーとして patch される (columnWidths と
  // 同様)。columnWidths が居なくても prefs だけは反映できる必要がある。
  const mergedPrefs =
    "prefs" in patch
      ? mergeDbUiPrefs(current.prefs, patch.prefs)
      : current.prefs;
  const mergedExpandedTables =
    "expandedTables" in patch
      ? mergeDbUiExpandedTables(current.expandedTables, patch.expandedTables)
      : current.expandedTables;
  // snapshotSelectedTables も expandedTables と同じ `Record<scope, string[]>`
  // 形なので merge ロジックを共有する。
  const mergedSnapshotSelectedTables =
    "snapshotSelectedTables" in patch
      ? mergeDbUiExpandedTables(
          current.snapshotSelectedTables,
          patch.snapshotSelectedTables,
        )
      : current.snapshotSelectedTables;
  if (!isRecord(patch.columnWidths)) {
    const merged: DbUiState = { ...current, version: 1 };
    if (mergedExpandedTables) merged.expandedTables = mergedExpandedTables;
    else delete merged.expandedTables;
    if (mergedSnapshotSelectedTables)
      merged.snapshotSelectedTables = mergedSnapshotSelectedTables;
    else delete merged.snapshotSelectedTables;
    if (mergedPrefs) merged.prefs = mergedPrefs;
    else delete merged.prefs;
    return sanitizeDbUiState(merged);
  }
  const columnWidths: DbUiState["columnWidths"] = {
    ...current.columnWidths,
  };
  for (const [dbId, tablesRaw] of Object.entries(patch.columnWidths)) {
    if (tablesRaw === null) {
      delete columnWidths[dbId];
      continue;
    }
    if (!isRecord(tablesRaw)) continue;
    const tables = { ...(columnWidths[dbId] || {}) };
    for (const [table, columnsRaw] of Object.entries(tablesRaw)) {
      if (columnsRaw === null) {
        delete tables[table];
        continue;
      }
      if (!isRecord(columnsRaw)) continue;
      const columns = { ...(tables[table] || {}) };
      for (const [column, widthRaw] of Object.entries(columnsRaw)) {
        if (widthRaw === null) delete columns[column];
        else columns[column] = widthRaw as number;
      }
      tables[table] = columns;
    }
    columnWidths[dbId] = tables;
  }
  return sanitizeDbUiState({
    ...current,
    ...patch,
    columnWidths,
    expandedTables: mergedExpandedTables,
    snapshotSelectedTables: mergedSnapshotSelectedTables,
    prefs: mergedPrefs,
    version: 1,
  });
}

function emptyToolsState(): ToolsState {
  return { version: 1 };
}

function sanitizeToolsState(raw: unknown): ToolsState {
  if (!isRecord(raw)) return emptyToolsState();
  const out: ToolsState = { version: 1 };
  if (isToolId(raw.activeTool)) out.activeTool = raw.activeTool;
  const width = optionalNumber(
    raw.width,
    MIN_TOOLS_SHEET_WIDTH,
    MAX_TOOLS_SHEET_WIDTH,
  );
  if (width !== undefined) out.width = width;
  if (isRecord(raw.drafts)) {
    const drafts: Partial<Record<ToolId, string>> = {};
    for (const id of TOOL_IDS) {
      const draft = raw.drafts[id];
      if (typeof draft !== "string") continue;
      // 空文字は「下書き無し」。長すぎるものは丸めずに捨てる (途中で切ると
      // ユーザーの本文を壊したまま保存してしまう)。
      if (draft.length === 0 || draft.length > MAX_TOOL_DRAFT_LEN) continue;
      drafts[id] = draft;
    }
    if (Object.keys(drafts).length > 0) out.drafts = drafts;
  }
  return out;
}

function mergeToolsState(current: ToolsState, patch: unknown): ToolsState {
  if (!isRecord(patch)) return current;
  const next: ToolsState = { ...current, version: 1 };
  // drafts と同じ扱い: null は削除、壊れた値は無視して既存値を残す。
  if ("activeTool" in patch) {
    if (patch.activeTool === null) delete next.activeTool;
    else if (isToolId(patch.activeTool)) next.activeTool = patch.activeTool;
  }
  if ("width" in patch) {
    if (patch.width === null) delete next.width;
    else {
      const width = optionalNumber(
        patch.width,
        MIN_TOOLS_SHEET_WIDTH,
        MAX_TOOLS_SHEET_WIDTH,
      );
      if (width !== undefined) next.width = width;
    }
  }
  if (isRecord(patch.drafts)) {
    const drafts: Partial<Record<ToolId, string>> = { ...(next.drafts ?? {}) };
    for (const id of TOOL_IDS) {
      if (!(id in patch.drafts)) continue;
      const value = patch.drafts[id];
      // null と空文字はどちらも「この下書きを消す」。
      if (value === null || value === "") {
        delete drafts[id];
        continue;
      }
      // 文字列以外は壊れた patch。既存の下書きを巻き添えにせず無視する。
      if (typeof value !== "string") continue;
      // 上限超えは sanitize で黙って捨てられて既存値まで消えるので、
      // ここで弾いて 413 として返す。
      if (value.length > MAX_TOOL_DRAFT_LEN)
        throw new Error("tools state too large");
      drafts[id] = value;
    }
    next.drafts = drafts;
  }
  return sanitizeToolsState(next);
}

const settingsStore = createJsonFileStore<AppSettingsState>({
  filePath: (root) => codeViewerPath(root, SETTINGS_FILE_NAME),
  empty: emptySettings,
  sanitize: sanitizeSettings,
  maxBytes: MAX_SETTINGS_BYTES,
  backupSuffix: "corrupt",
  sizeErrorMessage: "settings state too large",
});

const viewStateStore = createJsonFileStore<ViewState>({
  filePath: (root) => codeViewerPath(root, VIEW_STATE_FILE_NAME),
  empty: emptyViewState,
  sanitize: sanitizeViewState,
  maxBytes: MAX_VIEW_STATE_BYTES,
  backupSuffix: "corrupt",
  sizeErrorMessage: "view state too large",
});

const dbUiStore = createJsonFileStore<DbUiState>({
  filePath: (root) => codeViewerPath(root, DB_UI_FILE_NAME),
  empty: emptyDbUiState,
  sanitize: sanitizeDbUiState,
  maxBytes: MAX_DB_UI_BYTES,
  backupSuffix: "corrupt",
  sizeErrorMessage: "db UI state too large",
});

const toolsStore = createJsonFileStore<ToolsState>({
  filePath: (root) => codeViewerPath(root, TOOLS_FILE_NAME),
  empty: emptyToolsState,
  sanitize: sanitizeToolsState,
  maxBytes: MAX_TOOLS_BYTES,
  backupSuffix: "corrupt",
  sizeErrorMessage: "tools state too large",
});

// 各 patch* は「読み込んだ現在値に merge して書き戻し、書き戻した値を返す」
// という同一の手順なので、差し替わるのは merge 関数だけ。
function patchJsonState<T>(
  store: JsonFileStore<T>,
  root: string,
  patch: unknown,
  merge: (current: T, patch: unknown) => T,
): Promise<T> {
  return store.update(root, (state) => {
    const next = merge(state, patch);
    return { state: next, result: next };
  });
}

// ai-dup-check: allow -- exported test helper for this concrete JSON store.
export function settingsFilePath(root: string): string {
  return codeViewerPath(root, SETTINGS_FILE_NAME);
}

// ai-dup-check: allow -- exported test helper for this concrete JSON store.
export function viewStateFilePath(root: string): string {
  return codeViewerPath(root, VIEW_STATE_FILE_NAME);
}

// ai-dup-check: allow -- exported test helper for this concrete JSON store.
export function dbUiFilePath(root: string): string {
  return codeViewerPath(root, DB_UI_FILE_NAME);
}

export function sanitizeAppSettingsState(raw: unknown): AppSettingsState {
  return sanitizeSettings(raw);
}

export function sanitizeAppViewState(raw: unknown): ViewState {
  return sanitizeViewState(raw);
}

export function sanitizeDbUi(raw: unknown): DbUiState {
  return sanitizeDbUiState(raw);
}

export async function loadAppSettingsState(
  root: string,
): Promise<AppSettingsState> {
  return settingsStore.load(root);
}

export async function patchAppSettingsState(
  root: string,
  patch: unknown,
): Promise<AppSettingsState> {
  return patchJsonState(settingsStore, root, patch, mergeSettings);
}

export async function loadViewState(root: string): Promise<ViewState> {
  return viewStateStore.load(root);
}

export async function patchViewState(
  root: string,
  patch: unknown,
): Promise<ViewState> {
  return patchJsonState(viewStateStore, root, patch, mergeViewState);
}

export async function loadDbUiState(root: string): Promise<DbUiState> {
  return dbUiStore.load(root);
}

export async function patchDbUiState(
  root: string,
  patch: unknown,
): Promise<DbUiState> {
  return patchJsonState(dbUiStore, root, patch, mergeDbUiState);
}

// ai-dup-check: allow -- ok:exported test helper for this concrete JSON store.
export function toolsFilePath(root: string): string {
  return codeViewerPath(root, TOOLS_FILE_NAME);
}

export function sanitizeTools(raw: unknown): ToolsState {
  return sanitizeToolsState(raw);
}

export async function loadToolsState(root: string): Promise<ToolsState> {
  return toolsStore.load(root);
}

export async function patchToolsState(
  root: string,
  patch: unknown,
): Promise<ToolsState> {
  return patchJsonState(toolsStore, root, patch, mergeToolsState);
}
