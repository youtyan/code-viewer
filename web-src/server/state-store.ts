import { join } from "node:path";
import type {
  AppSettingsState,
  DbUiPrefs,
  DbUiState,
  ViewerFontSizeSetting,
  ViewState,
} from "../core/types";
import { createJsonFileStore } from "./json-store";

const CODE_VIEWER_DIR = ".code-viewer";
const SETTINGS_FILE_NAME = "settings.json";
const VIEW_STATE_FILE_NAME = "view-state.json";
const DB_UI_FILE_NAME = "db-ui.json";
const MAX_SETTINGS_BYTES = 200_000;
const MAX_VIEW_STATE_BYTES = 1_000_000;
const MAX_DB_UI_BYTES = 1_000_000;
const MAX_REF_LEN = 1024;
const MAX_KEY_LEN = 2048;
const MAX_VIEW_ITEMS = 20_000;
const MAX_DB_UI_DBS = 200;
const MAX_DB_UI_TABLES = 500;
const MAX_DB_UI_COLUMNS = 1000;

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
function optionalNumber(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function optionalFloat(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, value));
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
  return { version: 1, collapsedDirs: [], viewedFiles: [] };
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
  const viewedFiles = new Set(base.viewedFiles);
  const addedCollapsedDirs = normalizeStringList(patch.addedCollapsedDirs, {
    maxItems: MAX_VIEW_ITEMS,
    maxLen: MAX_KEY_LEN,
    keepLast: true,
    sort: false,
  });
  for (const path of addedCollapsedDirs || []) collapsedDirs.add(path);
  const removedCollapsedDirs = normalizeStringList(patch.removedCollapsedDirs, {
    maxItems: MAX_VIEW_ITEMS,
    maxLen: MAX_KEY_LEN,
    sort: false,
  });
  for (const path of removedCollapsedDirs || []) collapsedDirs.delete(path);
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
    viewedFiles: [...viewedFiles],
  });
}

function safeObjectKey(value: string): string | null {
  if (!value || value.length > MAX_KEY_LEN || value.includes("\0")) return null;
  return value;
}

function sanitizeDbUiPrefs(raw: unknown): DbUiPrefs | undefined {
  if (!isRecord(raw)) return undefined;
  const out: DbUiPrefs = {};
  // boolean は明示 undefined と区別したいので、未指定なら省略する。
  if (raw.s3TooltipEnabled === true || raw.s3TooltipEnabled === false) {
    out.s3TooltipEnabled = raw.s3TooltipEnabled;
  }
  if (raw.inferFkRails === true || raw.inferFkRails === false) {
    out.inferFkRails = raw.inferFkRails;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeDbUiState(raw: unknown): DbUiState {
  if (!isRecord(raw)) return emptyDbUiState();
  const prefs = sanitizeDbUiPrefs(raw.prefs);
  if (!isRecord(raw.columnWidths)) {
    return prefs ? { ...emptyDbUiState(), prefs } : emptyDbUiState();
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
  if (prefs) out.prefs = prefs;
  return out;
}

function mergeDbUiPrefs(
  current: DbUiPrefs | undefined,
  patch: unknown,
): DbUiPrefs | undefined {
  if (!isRecord(patch)) return current;
  // patch 内で boolean が来てれば上書き、null なら削除、未指定なら維持。
  const next: DbUiPrefs = { ...(current ?? {}) };
  if (patch.s3TooltipEnabled === null) delete next.s3TooltipEnabled;
  else if (
    patch.s3TooltipEnabled === true ||
    patch.s3TooltipEnabled === false
  ) {
    next.s3TooltipEnabled = patch.s3TooltipEnabled;
  }
  if (patch.inferFkRails === null) delete next.inferFkRails;
  else if (patch.inferFkRails === true || patch.inferFkRails === false) {
    next.inferFkRails = patch.inferFkRails;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function mergeDbUiState(current: DbUiState, patch: unknown): DbUiState {
  if (!isRecord(patch)) return current;
  // prefs はトップレベル並列の独立キーとして patch される (columnWidths と
  // 同様)。columnWidths が居なくても prefs だけは反映できる必要がある。
  const mergedPrefs =
    "prefs" in patch
      ? mergeDbUiPrefs(current.prefs, patch.prefs)
      : current.prefs;
  if (!isRecord(patch.columnWidths)) {
    const merged: DbUiState = { ...current, version: 1 };
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
    prefs: mergedPrefs,
    version: 1,
  });
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
  return settingsStore.update(root, (state) => {
    const next = mergeSettings(state, patch);
    return { state: next, result: next };
  });
}

export async function loadViewState(root: string): Promise<ViewState> {
  return viewStateStore.load(root);
}

export async function patchViewState(
  root: string,
  patch: unknown,
): Promise<ViewState> {
  return viewStateStore.update(root, (state) => {
    const next = mergeViewState(state, patch);
    return { state: next, result: next };
  });
}

export async function loadDbUiState(root: string): Promise<DbUiState> {
  return dbUiStore.load(root);
}

export async function patchDbUiState(
  root: string,
  patch: unknown,
): Promise<DbUiState> {
  return dbUiStore.update(root, (state) => {
    const next = mergeDbUiState(state, patch);
    return { state: next, result: next };
  });
}
