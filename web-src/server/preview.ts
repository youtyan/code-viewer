import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import { normalizeNewDirectoryName } from "../core/directory-name";
import { APP_ENTRY_PATHS, SPA_PATHS } from "../core/routes";
import type {
  AnnotationTarget,
  AppSettingsState,
  DiffMeta,
  FileDiffResponse,
  FileMeta,
  FileRangeResponse,
  FileSearchListResponse,
  GrepMatch,
  GrepResponse,
  RepoTreeResponse,
  SettingsResponse,
  UndoActionResponse,
} from "../core/types";
import {
  ANNOTATION_BODY_MAX_BYTES,
  addAnnotationEntry,
  deleteAnnotationById,
  emptyAnnotationsState,
  loadAnnotationsState,
  moveAnnotationEntry,
  normalizeAnnotationTarget,
  renameAnnotationSession,
  saveAnnotationsState,
  startAnnotationSession,
  updateAnnotationEntry,
} from "./annotations";
import {
  cacheFresh,
  fileDiffCacheKey,
  setTimedCacheEntry,
  type TimedCacheEntry,
} from "./cache";
import { startDevAssetReload } from "./dev-assets";
import { handleDoctor } from "./doctor";
import * as git from "./git";
import {
  buildLineOffsetIndexFromStream,
  collectByteRangeFromStream,
  collectBytesWithLineOffsetIndexFromStream,
  collectLineRangeFromIndexedText,
  collectLineRangeFromStream,
  isSameWorktreeRange,
  type LineOffsetIndex,
  type LineRangeResult,
  lineByteRangeForIndex,
  parseHttpByteRange,
} from "./range";
import { type FileMetadata, rawFileHeaders } from "./raw-file-headers";
import { ROOT } from "./root";
import {
  fileByteRangeResponseBody,
  fileReadableStream,
  readFileTextRange,
  runSync,
  spawnDetached,
  startServer,
} from "./runtime";
import {
  buildFileSearchList,
  buildRgArgs,
  DEFAULT_EXCLUDE_NAMES,
  fixedStringLineMatches,
  GREP_MAX_FILE_BYTES,
  isSkippableSearchPath,
  normalizeGrepMax,
  parseGitGrepOutput,
  parseRgOutput,
} from "./search";
import { removeServerRegistry, writeServerRegistry } from "./server-registry";
import { loadAppSettingsState } from "./state-store";
import {
  DEFAULT_WORKTREE_WATCH_DIRECTORY_LIMIT,
  MAX_WORKTREE_WATCH_DIRECTORY_LIMIT,
  MIN_WORKTREE_WATCH_DIRECTORY_LIMIT,
  startWorktreeUpdateWatch,
} from "./worktree-watcher";

const WEB_ROOT = join(ROOT, "web");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
  .version as string;
const DEFAULT_ARGS = ["HEAD"];
const PREVIEW_HUNKS_DEFAULT = 3;
const PREVIEW_LINES_DEFAULT = 1200;
const WATCHED_ASSET_FILES = ["index.html", "style.css", "app.js"];
const SIZE_SMALL = 2000;
const SIZE_MEDIUM = 8000;
const SIZE_LARGE = 20000;
const LINE_INDEX_MIN_START = 10000;
const LINE_INDEX_MAX_FILE_BYTES = 256 * 1024 * 1024;
const BLOB_LINE_CACHE_MAX_BYTES = 128 * 1024 * 1024;
const MAX_UPLOAD_FILE_BYTES = 512 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_TOTAL_BYTES + 1024 * 1024;
const MAX_UPLOAD_FILES = 50;
const SAFE_UPLOAD_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
  ".toml",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".pdf",
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".zip",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".scss",
  ".html",
]);

let generation = 1;
let cwd = git.repoRoot(process.cwd()) || process.cwd();
let cliArgs = DEFAULT_ARGS;
let listenPort = 0;
let openAfterStart = false;
let scopeOmitDirNames = git.DEFAULT_WORKTREE_OMIT_DIR_NAMES;
let scopeOmitDirCliOverride: string[] | null = null;
let scopeExcludeNames = DEFAULT_EXCLUDE_NAMES;
let scopeWatchLimit = DEFAULT_WORKTREE_WATCH_DIRECTORY_LIMIT;
let uploadEnabled = true;
let rgAvailableCache: boolean | null = null;

const enc = new TextEncoder();
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const sseKeepalives = new Map<
  ReadableStreamDefaultController<Uint8Array>,
  ReturnType<typeof setInterval>
>();
const fileCache = new Map<string, TimedCacheEntry<{ diffText: string }>>();
// blame result cache, keyed by base/ref/path (+mtime+size for worktree base).
// Capped LRU to keep memory bounded across many edits and refs.
const blameCache = new Map<string, git.GitBlameResult>();
const BLAME_CACHE_MAX = 64;
const metaCache = new Map<
  string,
  TimedCacheEntry<{ body: string; sig: string }>
>();
const fileListCache = new Map<
  string,
  { generation: number; body: FileSearchListResponse }
>();
const lineIndexCache = new Map<
  string,
  { signature: string; index: LineOffsetIndex }
>();
const blobLineIndexCache = new Map<string, LineOffsetIndex>();
const blobBytesCache = new Map<string, Uint8Array>();
let blobLineCacheBytes = 0;

function parseCli() {
  const rest: string[] = [];
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(`code-viewer ${VERSION}

Usage:
  code-viewer [--cwd <repo>] [--port <port>] [--open] [git-diff-args...]
  code-viewer annotate <start|add|add-db|rename|edit|move|list|delete|clear> [options]
  code-viewer query <sources|schemas|schema|columns|ddl|exec|list|clear|snapshot|diff|search|redis|elasticsearch|s3> [options]
  code-viewer search code --term <text> [--ref <ref>] [--path <p>...] [--regex] [--max <n>] [--json]
  code-viewer search files --term <pattern> [--ref <ref>] [--max <n>] [--json]
  code-viewer file <blame|history|show> --path <p> [--ref <ref>] [...subcommand options] [--json]
  code-viewer skill install [--agent <list>] [--global]
  code-viewer doctor [--cwd <path>] [--port <N>] [--json]
  code-viewer agent-help
  code-viewer help

AI-agent index (start here):  code-viewer agent-help
Subcommand guides (AI agents): code-viewer <annotate|query|search|file|skill|doctor> agent-help

Examples:
  code-viewer --open
  code-viewer --cwd /path/to/repo --open
  code-viewer HEAD~1 HEAD
  code-viewer --staged
  code-viewer annotate --help
  code-viewer query --help
  code-viewer search code --term "TODO" --json
  code-viewer search files --term "src/**/*.test.ts" --json
  code-viewer query redis databases --db docker:redis-svc --json
  code-viewer query elasticsearch indices --db docker:es-svc --json
  code-viewer query s3 buckets --db docker:s3-svc --json
  code-viewer file blame --path src/sample.ts --json
  code-viewer file history --path src/sample.ts --limit 10 --json
  code-viewer file show --path src/sample.ts --start 1 --end 40 --json
  code-viewer doctor --json
`);
      process.exit(0);
    } else if (arg === "--version" || arg === "-v") {
      console.log(VERSION);
      process.exit(0);
    } else if (arg === "--cwd") {
      const next = process.argv[++i];
      if (!next) {
        console.error("--cwd requires a value");
        process.exit(1);
      }
      try {
        // --cwd で明示された path が git repo の toplevel そのものなら
        // それを使う。サブディレクトリ指定や非 git ディレクトリの場合は
        // 親 repoRoot に勝手に上がらず、指定された path 自身を cwd にする
        // (data/test/* のような独立 cwd を含めるための挙動)。
        const nextReal = realpathSync(next);
        const candidate = git.repoRoot(next);
        cwd = candidate === nextReal ? candidate : nextReal;
      } catch {
        console.error("--cwd must point to an existing directory");
        process.exit(1);
      }
    } else if (arg === "--port") {
      const next = process.argv[++i];
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        console.error("--port requires a TCP port number");
        process.exit(1);
      }
      listenPort = parsed;
    } else if (arg === "--open") {
      openAfterStart = true;
    } else if (arg === "--allow-upload") {
      // Deprecated no-op: uploads are enabled for worktree folders by default.
    } else if (arg === "--scope-omit-dir") {
      const next = process.argv[++i];
      if (!next) {
        console.error("--scope-omit-dir requires a directory name");
        process.exit(1);
      }
      scopeOmitDirCliOverride = normalizeScopeOmitDirNames([
        ...(scopeOmitDirCliOverride || []),
        next,
      ]);
    } else {
      rest.push(arg);
    }
  }
  if (rest.length) cliArgs = rest;
  warnIfLegacyConfigPresent();
  if (scopeOmitDirCliOverride) {
    scopeOmitDirNames = scopeOmitDirCliOverride;
  }
  scopeWatchLimit = worktreeWatchDirectoryLimitFromEnv();
}

function warnIfLegacyConfigPresent() {
  try {
    if (existsSync(join(cwd, ".code-viewer.json"))) {
      console.warn(
        "[code-viewer] .code-viewer.json is no longer used; configure scope and upload from Viewer Settings instead. The file can be safely removed.",
      );
    }
  } catch {
    // best effort only
  }
}

function applyPersistedSettings(state: AppSettingsState) {
  const prevOmit = scopeOmitDirNames;
  const prevExclude = scopeExcludeNames;
  const prevWatchLimit = scopeWatchLimit;
  if (
    !scopeOmitDirCliOverride &&
    Array.isArray(state.scopeOmitDirs) &&
    state.scopeOmitDirs.length > 0
  ) {
    scopeOmitDirNames = state.scopeOmitDirs;
  } else if (!scopeOmitDirCliOverride) {
    scopeOmitDirNames = git.DEFAULT_WORKTREE_OMIT_DIR_NAMES;
  }
  if (
    Array.isArray(state.scopeExcludeNames) &&
    state.scopeExcludeNames.length > 0
  ) {
    scopeExcludeNames = state.scopeExcludeNames;
  } else {
    scopeExcludeNames = DEFAULT_EXCLUDE_NAMES;
  }
  if (state.scopeWatchLimit != null) {
    scopeWatchLimit = normalizeScopeWatchLimit(state.scopeWatchLimit);
  }
  uploadEnabled = state.uploadEnabled !== false;
  if (
    prevOmit !== scopeOmitDirNames ||
    prevExclude !== scopeExcludeNames ||
    prevWatchLimit !== scopeWatchLimit
  ) {
    restartWorktreeWatch();
  }
}

function normalizeScopeWatchLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_WORKTREE_WATCH_DIRECTORY_LIMIT;
  }
  const floored = Math.floor(value);
  if (floored < MIN_WORKTREE_WATCH_DIRECTORY_LIMIT) {
    return MIN_WORKTREE_WATCH_DIRECTORY_LIMIT;
  }
  if (floored > MAX_WORKTREE_WATCH_DIRECTORY_LIMIT) {
    return MAX_WORKTREE_WATCH_DIRECTORY_LIMIT;
  }
  return floored;
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function requestAllowed(req: Request) {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin");
  const okHost = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(host);
  const okOrigin =
    !origin ||
    origin === "null" ||
    /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(origin);
  return okHost && okOrigin;
}

function sideEffectRequestAllowed(req: Request) {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  const requestedBy = req.headers.get("x-code-viewer-action");
  return (
    /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(host) &&
    origin === `http://${host}` &&
    (!fetchSite || fetchSite === "same-origin") &&
    requestedBy === "1"
  );
}

function staticFile(pathname: string): Response | null {
  const map: Record<string, [string, string]> = {
    "/favicon.png": ["favicon.png", "image/png"],
    "/style.css": ["style.css", "text/css; charset=utf-8"],
    "/app.js": ["app.js", "application/javascript; charset=utf-8"],
    "/mermaid.js": ["mermaid.js", "application/javascript; charset=utf-8"],
    "/shiki.js": ["shiki.js", "application/javascript; charset=utf-8"],
    "/vendor/diff2html/diff2html.min.css": [
      "vendor/diff2html/diff2html.min.css",
      "text/css; charset=utf-8",
    ],
    "/vendor/diff2html/diff2html-ui.min.js": [
      "vendor/diff2html/diff2html-ui.min.js",
      "application/javascript; charset=utf-8",
    ],
    "/vendor/highlight.js/highlight.min.js": [
      "vendor/highlight.js/highlight.min.js",
      "application/javascript; charset=utf-8",
    ],
    "/vendor/highlight.js/styles/github.min.css": [
      "vendor/highlight.js/styles/github.min.css",
      "text/css; charset=utf-8",
    ],
    "/vendor/highlight.js/styles/github-dark.min.css": [
      "vendor/highlight.js/styles/github-dark.min.css",
      "text/css; charset=utf-8",
    ],
  };
  for (const spaPath of [...APP_ENTRY_PATHS, ...SPA_PATHS]) {
    map[spaPath] = ["index.html", "text/html; charset=utf-8"];
  }
  const spec = map[pathname];
  if (!spec) return null;
  const full = join(WEB_ROOT, spec[0]);
  if (!existsSync(full)) return text("not found", 404);
  return new Response(readFileSync(full), {
    headers: { "Content-Type": spec[1], "Cache-Control": "no-store" },
  });
}

function buildRangeArgs(range: { from?: string; to?: string }) {
  const refs = [];
  if (range.from && range.from !== "worktree") refs.push(range.from);
  if (range.to && range.to !== "worktree") refs.push(range.to);
  return { args: refs.length ? refs : cliArgs, refs };
}

function includeUntracked(
  range: { from?: string; to?: string },
  refs: string[],
) {
  const toWorktree = !range.to || range.to === "worktree";
  if (refs.length > 0) return toWorktree && refs.length < 2;
  return (
    cliArgs.length === 0 || (cliArgs.length === 1 && cliArgs[0] === "HEAD")
  );
}

function guessMediaKind(path: string) {
  const ext = extname(path).slice(1).toLowerCase();
  if (
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"].includes(
      ext,
    )
  )
    return "image";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"].includes(ext))
    return "audio";
  return null;
}

function classify(file: git.GitFileMeta) {
  if (file.binary) return "binary";
  const total = (file.additions || 0) + (file.deletions || 0);
  if (total <= SIZE_SMALL) return "small";
  if (total <= SIZE_MEDIUM) return "medium";
  if (total <= SIZE_LARGE) return "large";
  return "huge";
}

function estimateHeight(file: git.GitFileMeta, sizeClass: string) {
  if (file.binary) return 380;
  if (sizeClass === "small")
    return Math.min(
      800,
      ((file.additions || 0) + (file.deletions || 0) + 10) * 22,
    );
  return 140;
}

function buildQuery(params: Record<string, unknown>) {
  const q = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== "")
      q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function fileToMeta(
  file: git.GitFileMeta,
  range: { from?: string; to?: string },
  extraQs: Record<string, string>,
): FileMeta {
  const sizeClass = classify(file);
  const q = {
    path: file.path,
    old_path: file.old_path,
    status: file.status,
    from: range.from,
    to: range.to,
    ...extraQs,
  };
  if (file.untracked) Object.assign(q, { untracked: "1" });
  const previewQ = { ...q, mode: "preview", max_hunks: PREVIEW_HUNKS_DEFAULT };
  const previewUrl =
    sizeClass !== "small" ? `/file_diff${buildQuery(previewQ)}` : null;
  return {
    order: file.order,
    key: `${file.status || "M"}\0${file.old_path || ""}\0${file.path}`,
    path: file.path,
    old_path: file.old_path,
    display_path: file.path,
    status: file.status || "M",
    additions: file.additions || 0,
    deletions: file.deletions || 0,
    binary: file.binary || false,
    media_kind: guessMediaKind(file.path),
    size_class: sizeClass,
    force_layout: sizeClass === "huge" ? "line-by-line" : undefined,
    highlight: sizeClass === "small",
    load_url: `/file_diff${buildQuery(q)}`,
    preview_url: previewUrl,
    estimated_height_px: estimateHeight(file, sizeClass),
    untracked: file.untracked || false,
  };
}

function computePayload(
  extras: string[],
  range: { from?: string; to?: string },
  pathFilter = "",
): DiffMeta {
  if (isSameWorktreeRange(range)) {
    return {
      files: [],
      totals: { files: 0, additions: 0, deletions: 0 },
      range: "worktree .. worktree",
      project: basename(cwd),
      branch: git.currentBranch(cwd) || undefined,
      generation,
    };
  }
  const { args, refs } = buildRangeArgs(range);
  const fullArgs = [...extras, ...args];
  const files = git.fileMeta(fullArgs, cwd, false);
  if (includeUntracked(range, refs)) files.push(...git.untrackedMeta(cwd));
  const filteredFiles = pathFilter
    ? files.filter(
        (file) => file.path === pathFilter || file.old_path === pathFilter,
      )
    : files;
  filteredFiles.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  filteredFiles.forEach((file, i) => {
    file.order = i + 1;
  });
  const extraQs: Record<string, string> = {};
  for (const e of extras) {
    if (e === "-w" || e === "--ignore-all-space") extraQs.ignore_ws = "1";
    if (e === "--ignore-blank-lines") extraQs.ignore_blank = "1";
  }
  const meta = filteredFiles.map((file) => fileToMeta(file, range, extraQs));
  const totals = meta.reduce(
    (acc, file) => {
      acc.additions += file.additions || 0;
      acc.deletions += file.deletions || 0;
      return acc;
    },
    { files: meta.length, additions: 0, deletions: 0 },
  );
  const toWorktree = !range.to || range.to === "worktree";
  const label = refs.length
    ? `${refs.join(" .. ")}${toWorktree && refs.length === 1 ? " .. worktree" : ""}`
    : cliArgs.join(" ");
  return {
    files: meta,
    totals,
    range: label || "HEAD",
    project: basename(cwd),
    branch: git.currentBranch(cwd) || undefined,
    generation,
  };
}

function handleDiffJson(url: URL) {
  const extras = [];
  if (url.searchParams.get("ignore_ws") === "1") extras.push("-w");
  if (url.searchParams.get("ignore_blank") === "1")
    extras.push("--ignore-blank-lines");
  const range = {
    from: url.searchParams.get("from") || "",
    to: url.searchParams.get("to") || "",
  };
  const path = url.searchParams.get("path") || "";
  if (path && !safePath(path)) return text("invalid path", 400);
  const key = `${range.from}|${range.to}|${url.searchParams.get("ignore_ws") || ""}|${url.searchParams.get("ignore_blank") || ""}|${path}`;
  if (url.searchParams.get("nocache") === "1") {
    const payload = computePayload(extras, range, path);
    const sig = JSON.stringify({ ...payload, generation: undefined });
    const cached = metaCache.get(key);
    if (!cached || cached.sig !== sig) {
      generation++;
      payload.generation = generation;
      metaCache.clear();
      fileCache.clear();
    }
    const body = JSON.stringify(payload);
    setTimedCacheEntry(metaCache, key, { body, sig });
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  const cached = metaCache.get(key);
  if (cacheFresh(cached))
    return new Response(cached.body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  const payload = computePayload(extras, range, path);
  const body = JSON.stringify(payload);
  setTimedCacheEntry(metaCache, key, {
    body,
    sig: JSON.stringify({ ...payload, generation: undefined }),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function safePath(path: string) {
  if (
    !path ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\0")
  )
    return false;
  return !path.split(/[\\/]+/).includes("..");
}

function safeRepoPath(path: string) {
  return path === "" || safePath(path);
}

function normalizeScopeOmitDirNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  return [
    ...new Set(
      names
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim())
        .filter(
          (name) =>
            name &&
            name.length <= 64 &&
            !name.includes("/") &&
            !name.includes("\\") &&
            !name.includes("\0") &&
            name !== "." &&
            name !== ".." &&
            name !== ".git",
        ),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

function normalizeScopeExcludeNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  return [
    ...new Set(
      names
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim())
        .filter(
          (name) =>
            name &&
            name.length <= 128 &&
            !name.includes("/") &&
            !name.includes("\\") &&
            !name.includes("\0") &&
            name !== "." &&
            name !== ".." &&
            name !== ".git",
        ),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

function parseScopeOmitDirNamesQuery(value: string): string[] | null {
  const names = value ? value.split(",") : [];
  if (names.length > 100) return null;
  for (const raw of names) {
    const name = raw.trim();
    if (
      !name ||
      name.length > 64 ||
      name.includes("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      name === "." ||
      name === ".." ||
      name === ".git"
    )
      return null;
  }
  return normalizeScopeOmitDirNames(names);
}

function parseScopeExcludeNamesQuery(value: string): string[] | null {
  const names = value ? value.split(",") : [];
  if (names.length > 200) return null;
  for (const raw of names) {
    const name = raw.trim();
    if (
      !name ||
      name.length > 128 ||
      name.includes("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      name === "." ||
      name === ".." ||
      name === ".git"
    )
      return null;
  }
  return normalizeScopeExcludeNames(names);
}

function scopeOmitDirNamesFromQuery(url: URL): string[] {
  if (!url.searchParams.has("omit_dirs")) return scopeOmitDirNames;
  return (
    parseScopeOmitDirNamesQuery(url.searchParams.get("omit_dirs") || "") ||
    scopeOmitDirNames
  );
}

function scopeExcludeNamesFromQuery(url: URL): string[] {
  if (!url.searchParams.has("exclude_names")) return scopeExcludeNames;
  return (
    parseScopeExcludeNamesQuery(url.searchParams.get("exclude_names") || "") ||
    scopeExcludeNames
  );
}

function invalidScopeOmitDirNamesQuery(url: URL): boolean {
  return (
    url.searchParams.has("omit_dirs") &&
    !parseScopeOmitDirNamesQuery(url.searchParams.get("omit_dirs") || "")
  );
}

function invalidScopeExcludeNamesQuery(url: URL): boolean {
  return (
    url.searchParams.has("exclude_names") &&
    !parseScopeExcludeNamesQuery(url.searchParams.get("exclude_names") || "")
  );
}

function isExcludedScopePath(path: string, excludeNames: string[]): boolean {
  return path
    .split(/[\\/]+/)
    .some((part) =>
      excludeNames.some((name) => part.toLowerCase() === name.toLowerCase()),
    );
}

// ai-dup-check: allow -- ".git" path predicate mirrors git.isToolInternalPath for the git metadata directory.
function isGitInternalPath(path: string): boolean {
  return path.split(/[\\/]+/).some((part) => part.toLowerCase() === ".git");
}

function safeWorktreePath(path: string): string | null {
  if (!safePath(path)) return null;
  if (isGitInternalPath(path)) return null;
  const full = join(cwd, path);
  if (!existsSync(full)) return null;
  let realCwd: string;
  let realFull: string;
  try {
    realCwd = realpathSync(cwd);
    realFull = realpathSync(full);
  } catch {
    return null;
  }
  const rel = relative(realCwd, realFull);
  if (
    rel === "" ||
    rel.startsWith("..") ||
    rel.startsWith("/") ||
    rel.startsWith("\\")
  )
    return null;
  if (isGitInternalPath(rel)) return null;
  return realFull;
}

function worktreePath(path: string): string {
  return join(cwd, path);
}

function safeOpenWorktreePath(path: string): string | null {
  if (path === "") {
    try {
      const realCwd = realpathSync(cwd);
      if (isGitInternalPath(realCwd)) return null;
      return realCwd;
    } catch {
      return null;
    }
  }
  return safeWorktreePath(path);
}

function parentRepoPath(path: string): string {
  const parent = dirname(path);
  return parent === "." ? "" : parent;
}

function isoDate(ms: number | undefined): string | undefined {
  return ms && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function worktreeFileMetadata(path: string, knownSize?: number): FileMetadata {
  const full = safeWorktreePath(path);
  if (!full) return {};
  try {
    const stat = statSync(full) as unknown as {
      size: number;
      birthtimeMs: number;
      mtimeMs: number;
      ctimeMs: number;
      isFile?: () => boolean;
    };
    return {
      size: knownSize ?? stat.size,
      created_at: isoDate(stat.birthtimeMs),
      updated_at: isoDate(stat.mtimeMs),
    };
  } catch {
    return {};
  }
}

function gitFileMetadata(
  ref: string,
  path: string,
  knownSize?: number,
): FileMetadata {
  const size = knownSize ?? rawFileSize(path, ref);
  const commitUpdatedAt =
    git.lastCommitDateForPath(ref, path, cwd) || undefined;
  return {
    size: size == null ? undefined : size,
    updated_at: commitUpdatedAt,
    commit_updated_at: commitUpdatedAt,
  };
}

function directoryMetadata(target: string, path: string): FileMetadata {
  if (target === "worktree" || target === "") {
    const full =
      path === "" ? safeOpenWorktreePath("") : safeWorktreePath(path);
    if (!full) return {};
    try {
      const stat = statSync(full) as unknown as {
        birthtimeMs: number;
        mtimeMs: number;
      };
      return {
        created_at: isoDate(stat.birthtimeMs),
        updated_at: isoDate(stat.mtimeMs),
      };
    } catch {
      return {};
    }
  }
  const commitUpdatedAt =
    git.lastCommitDateForPath(target, path || ".", cwd) || undefined;
  return { updated_at: commitUpdatedAt, commit_updated_at: commitUpdatedAt };
}

function fileMetadataForTarget(target: string, path: string): FileMetadata {
  return target === "worktree" || target === ""
    ? worktreeFileMetadata(path)
    : gitFileMetadata(target, path);
}

function attachTreeEntryMetadata(
  target: string,
  entry: git.GitTreeEntry,
): git.GitTreeEntry {
  if (entry.type === "tree")
    return { ...entry, ...directoryMetadata(target, entry.path) };
  if (entry.type !== "blob") return entry;
  return { ...entry, ...fileMetadataForTarget(target, entry.path) };
}

function readReadme(
  target: string,
  dirPath: string,
): RepoTreeResponse["readme"] {
  const candidates = ["README.md", "readme.md", "README.markdown", "README"];
  for (const name of candidates) {
    const path = dirPath ? `${dirPath}/${name}` : name;
    if (target === "worktree" || target === "") {
      const full = safeWorktreePath(path);
      if (!full) continue;
      try {
        return { path, text: readFileSync(full, "utf8") };
      } catch {
        continue;
      }
    }
    const res = git.show(target, path, cwd);
    if (res.code === 0) return { path, text: res.stdout };
  }
  return null;
}

function handleTree(url: URL) {
  const target =
    url.searchParams.get("ref") || url.searchParams.get("target") || "worktree";
  const path = (url.searchParams.get("path") || "").replace(/^\/+|\/+$/g, "");
  if (!safeRepoPath(path)) return text("invalid path", 400);
  if ((target === "worktree" || target === "") && isGitInternalPath(path))
    return text("forbidden", 403);
  if (target !== "worktree" && !git.verifyTreeRef(target, cwd))
    return text("invalid target", 400);
  const recursive = url.searchParams.get("recursive") === "1";
  if (invalidScopeOmitDirNamesQuery(url)) return text("invalid omit dirs", 400);
  if (invalidScopeExcludeNamesQuery(url))
    return text("invalid exclude names", 400);
  const excludeNames = scopeExcludeNamesFromQuery(url);
  const entries = git
    .listTree(target, path, cwd, {
      recursive,
      omitDirNames: scopeOmitDirNamesFromQuery(url),
      excludeNames,
    })
    .entries.filter((entry) => !isExcludedScopePath(entry.path, excludeNames));
  return json({
    ref: target,
    path,
    project: basename(cwd),
    branch: git.currentBranch(cwd) || undefined,
    entries: recursive
      ? entries
      : entries.map((entry) => attachTreeEntryMetadata(target, entry)),
    readme: readReadme(target, path),
    upload_enabled: uploadEnabled && (target === "worktree" || target === ""),
  } satisfies RepoTreeResponse);
}

function handleSettings() {
  return json({
    project: basename(cwd),
    branch: git.currentBranch(cwd) || undefined,
    repo_web_url: git.remoteWebUrl(cwd),
    scope: {
      omit_dirs_effective: scopeOmitDirNames,
      omit_dirs_built_in: git.DEFAULT_WORKTREE_OMIT_DIR_NAMES,
      exclude_names_effective: scopeExcludeNames,
      exclude_names_built_in: DEFAULT_EXCLUDE_NAMES,
      max_entries: git.WORKTREE_RECURSIVE_ENTRY_LIMIT,
      watch_limit_effective: scopeWatchLimit,
      watch_limit_default: DEFAULT_WORKTREE_WATCH_DIRECTORY_LIMIT,
      watch_limit_min: MIN_WORKTREE_WATCH_DIRECTORY_LIMIT,
      watch_limit_max: MAX_WORKTREE_WATCH_DIRECTORY_LIMIT,
    },
  } satisfies SettingsResponse);
}

function worktreeWatchDirectoryLimitFromEnv(): number {
  const raw = process.env.CODE_VIEWER_WORKTREE_WATCH_LIMIT;
  if (!raw) return DEFAULT_WORKTREE_WATCH_DIRECTORY_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0)
    return DEFAULT_WORKTREE_WATCH_DIRECTORY_LIMIT;
  const floored = Math.floor(parsed);
  if (floored < MIN_WORKTREE_WATCH_DIRECTORY_LIMIT)
    return MIN_WORKTREE_WATCH_DIRECTORY_LIMIT;
  if (floored > MAX_WORKTREE_WATCH_DIRECTORY_LIMIT)
    return MAX_WORKTREE_WATCH_DIRECTORY_LIMIT;
  return floored;
}

function handleFiles(url: URL) {
  const target =
    url.searchParams.get("ref") || url.searchParams.get("target") || "worktree";
  if (target !== "worktree" && !git.verifyTreeRef(target, cwd))
    return text("invalid target", 400);
  if (invalidScopeOmitDirNamesQuery(url)) return text("invalid omit dirs", 400);
  if (invalidScopeExcludeNamesQuery(url))
    return text("invalid exclude names", 400);
  const omitDirNames = scopeOmitDirNamesFromQuery(url);
  const excludeNames = scopeExcludeNamesFromQuery(url);
  const key = `${target || "worktree"}\0${omitDirNames.join("\0")}\0${excludeNames.join("\0")}`;
  const cached = fileListCache.get(key);
  if (cached && cached.generation === generation) return json(cached.body);
  const ref = target || "worktree";
  const entries = git
    .listTree(ref, "", cwd, {
      recursive: true,
      omitDirNames,
      excludeNames,
    })
    .entries.filter((entry) => !isExcludedScopePath(entry.path, excludeNames));
  const body = buildFileSearchList(ref, generation, entries);
  fileListCache.set(key, { generation, body });
  return json(body);
}

function parseGrepPaths(
  url: URL,
  omitDirNames: string[],
  excludeNames: string[],
): string[] {
  return url.searchParams
    .getAll("path")
    .filter(
      (path) =>
        safePath(path) &&
        !isGitInternalPath(path) &&
        !isSkippableSearchPath(path, omitDirNames, excludeNames),
    );
}

function rgAvailable(): boolean {
  if (rgAvailableCache !== null) return rgAvailableCache;
  const proc = runSync(["rg", "--version"], cwd);
  rgAvailableCache = proc.code === 0;
  return rgAvailableCache;
}

function grepWorktreeFallback(
  query: string,
  max: number,
  paths: string[],
  omitDirNames: string[],
  excludeNames: string[],
): GrepMatch[] {
  const candidates = paths.length
    ? paths
    : git
        .listTree("worktree", "", cwd, {
          recursive: true,
          omitDirNames,
          excludeNames,
        })
        .entries.map((entry) => entry.path);
  const matches: GrepMatch[] = [];
  for (const path of candidates) {
    if (matches.length >= max) break;
    if (
      !safePath(path) ||
      isGitInternalPath(path) ||
      isSkippableSearchPath(path, omitDirNames, excludeNames)
    )
      continue;
    const full = safeWorktreePath(path);
    if (!full) continue;
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > GREP_MAX_FILE_BYTES
    )
      continue;
    let data: Buffer;
    try {
      data = readFileSync(full);
    } catch {
      continue;
    }
    if (data.subarray(0, 8192).includes(0)) continue;
    matches.push(
      ...fixedStringLineMatches(
        path,
        data.toString("utf8"),
        query,
        max - matches.length,
      ),
    );
  }
  return matches;
}

function grepWorktree(
  query: string,
  max: number,
  paths: string[],
  regex: boolean,
  omitDirNames: string[],
  excludeNames: string[],
): GrepResponse {
  if (rgAvailable()) {
    const safePaths = paths.filter(
      (path) =>
        safePath(path) &&
        !isGitInternalPath(path) &&
        !isSkippableSearchPath(path, omitDirNames, excludeNames) &&
        safeWorktreePath(path),
    );
    const args = buildRgArgs(
      query,
      max,
      safePaths,
      regex,
      omitDirNames,
      excludeNames,
    );
    const proc = runSync(args, cwd, { timeout: 5000 });
    const stdout = proc.stdout;
    const matches = parseRgOutput(
      stdout,
      max,
      omitDirNames,
      excludeNames,
    ).filter(
      (match) =>
        safePath(match.path) &&
        !isGitInternalPath(match.path) &&
        !isSkippableSearchPath(match.path, omitDirNames, excludeNames) &&
        !!safeWorktreePath(match.path),
    );
    return {
      ref: "worktree",
      engine: "rg",
      truncated: matches.length >= max,
      matches,
    };
  }
  if (regex)
    return {
      ref: "worktree",
      engine: "fallback",
      truncated: false,
      matches: [],
    };
  const matches = grepWorktreeFallback(
    query,
    max,
    paths,
    omitDirNames,
    excludeNames,
  );
  return {
    ref: "worktree",
    engine: "fallback",
    truncated: matches.length >= max,
    matches,
  };
}

function grepTreeRef(
  ref: string,
  query: string,
  max: number,
  paths: string[],
  regex: boolean,
  omitDirNames: string[],
  excludeNames: string[],
): GrepResponse {
  const safePaths = paths.filter(
    (path) =>
      safePath(path) &&
      !isGitInternalPath(path) &&
      !isSkippableSearchPath(path, omitDirNames, excludeNames),
  );
  const args = [
    "git",
    "-c",
    "core.quotepath=false",
    "grep",
    "-n",
    "--column",
    "-i",
    regex ? "-E" : "-F",
    "--no-color",
    "-e",
    query,
    ref,
    "--",
    ...safePaths,
  ];
  const proc = runSync(args, cwd, { timeout: 5000 });
  const stdout = proc.stdout;
  const matches = parseGitGrepOutput(
    stdout,
    ref,
    max,
    omitDirNames,
    excludeNames,
  ).slice(0, max);
  return { ref, engine: "git", truncated: matches.length >= max, matches };
}

function handleGrep(url: URL) {
  const query = url.searchParams.get("q") || "";
  const ref = url.searchParams.get("ref") || "worktree";
  const max = normalizeGrepMax(url.searchParams.get("max"));
  if (invalidScopeOmitDirNamesQuery(url)) return text("invalid omit dirs", 400);
  if (invalidScopeExcludeNamesQuery(url))
    return text("invalid exclude names", 400);
  const omitDirNames = scopeOmitDirNamesFromQuery(url);
  const excludeNames = scopeExcludeNamesFromQuery(url);
  const paths = parseGrepPaths(url, omitDirNames, excludeNames);
  const regex = url.searchParams.get("regex") === "1";
  if (!query.trim())
    return json({
      ref,
      engine: ref === "worktree" ? "fallback" : "git",
      truncated: false,
      matches: [],
    } satisfies GrepResponse);
  if (ref === "worktree" || ref === "")
    return json(
      grepWorktree(query, max, paths, regex, omitDirNames, excludeNames),
    );
  if (!git.verifyTreeRef(ref, cwd)) return text("invalid target", 400);
  return json(
    grepTreeRef(ref, query, max, paths, regex, omitDirNames, excludeNames),
  );
}

function handleRefCommits(url: URL) {
  const query = url.searchParams.get("q") || "";
  const parsedMax = Number(url.searchParams.get("max") || "");
  const parsedSkip = Number(url.searchParams.get("skip") || "0");
  const max =
    Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : undefined;
  const skip =
    Number.isFinite(parsedSkip) && parsedSkip > 0 ? parsedSkip : undefined;
  return json(git.refCommitPage(cwd, { query, max, skip }));
}

function handleLog(url: URL) {
  const ref = url.searchParams.get("ref") || "HEAD";
  const skip = Number(url.searchParams.get("skip") || "0");
  const limit = Number(url.searchParams.get("limit") || "50");
  const path = url.searchParams.get("path") || "";
  if (path && !safePath(path)) return text("invalid path", 400);
  const result = git.commitHistory(cwd, {
    ref,
    skip: Number.isFinite(skip) ? skip : 0,
    limit: Number.isFinite(limit) ? limit : 50,
    query: url.searchParams.get("q") || "",
    ...(path ? { path } : {}),
  });
  if (result.error) return text(result.error, 400);
  // ref=worktree (or worktree=1) with a path filter prepends a "Working tree"
  // pseudo-commit when this path has uncommitted changes vs HEAD.
  const wantsWorktreeHead =
    path &&
    skip === 0 &&
    (ref === "worktree" || url.searchParams.get("worktree") === "1");
  let commits: typeof result.commits = result.commits;
  let hasWorktree = false;
  if (wantsWorktreeHead) {
    const status = runSync(
      [
        "git",
        "-c",
        "core.quotepath=false",
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=normal",
        "--",
        path,
      ],
      cwd,
    );
    if (status.code === 0 && status.stdout.length > 0) {
      // Any non-empty record means the path has uncommitted changes.
      const parts = status.stdout.split("\0").filter(Boolean);
      if (parts.length > 0) {
        hasWorktree = true;
        commits = [
          {
            sha: "worktree",
            subject: "未コミット変更 (Working tree)",
            author: "",
            when: "",
            parents: [],
            body: "",
          },
          ...commits,
        ];
      }
    }
  }
  return json({
    commits,
    hasMore: result.hasMore,
    generation,
    ...(hasWorktree ? { hasWorktree: true } : {}),
  });
}

function blamePathKey(p: string): string {
  try {
    const st = statSync(join(cwd, p));
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return "missing";
  }
}

function rememberBlame(key: string, value: git.GitBlameResult) {
  if (blameCache.has(key)) blameCache.delete(key);
  blameCache.set(key, value);
  while (blameCache.size > BLAME_CACHE_MAX) {
    const oldest = blameCache.keys().next();
    if (oldest.done) break;
    blameCache.delete(oldest.value);
  }
}

function handleFileBlame(url: URL) {
  const path = url.searchParams.get("path") || "";
  if (!safePath(path)) return text("invalid path", 400);
  const ref = url.searchParams.get("ref") || "worktree";
  if (!ref || ref.startsWith("-") || ref.includes("\0"))
    return text("invalid ref", 400);
  const rawBase = url.searchParams.get("base");
  const requestedBase: git.GitBlameBase =
    rawBase === "HEAD"
      ? "HEAD"
      : rawBase === "worktree"
        ? "worktree"
        : ref === "worktree"
          ? "worktree"
          : "HEAD";
  const normalized = git.normalizeBlameRef(ref, requestedBase);
  const { base } = normalized;
  let cacheKey: string;
  if (base === "worktree") {
    cacheKey = `worktree|${path}|${blamePathKey(path)}`;
  } else {
    const resolved = runSync(
      ["git", "rev-parse", "--verify", `${normalized.ref}^{commit}`],
      cwd,
    );
    if (resolved.code !== 0) return text("unknown ref", 400);
    cacheKey = `HEAD|${path}|${resolved.stdout.trim()}`;
  }
  const cached = blameCache.get(cacheKey);
  if (cached) {
    if (blameCache.has(cacheKey)) {
      blameCache.delete(cacheKey);
      blameCache.set(cacheKey, cached);
    }
    return json({ ...cached, base, ref, generation });
  }
  const result = git.blame(cwd, { path, ref: normalized.ref, base });
  if (!result.error) rememberBlame(cacheKey, result);
  return json({ ...result, base, ref, generation });
}

function handleFileDiff(url: URL) {
  const path = url.searchParams.get("path") || "";
  if (!safePath(path)) return text("invalid path", 400);
  const extras = [];
  if (url.searchParams.get("ignore_ws") === "1") extras.push("-w");
  if (url.searchParams.get("ignore_blank") === "1")
    extras.push("--ignore-blank-lines");
  const isUntracked = url.searchParams.get("untracked") === "1";
  const range = {
    from: url.searchParams.get("from") || "",
    to: url.searchParams.get("to") || "",
  };
  if (isSameWorktreeRange(range)) {
    return json({
      path,
      old_path: url.searchParams.get("old_path") || "",
      status: url.searchParams.get("status") || "",
      mode: url.searchParams.get("mode") || "full",
      diff: "",
      hunk_count: 0,
      rendered_hunk_count: 0,
      line_count: 0,
      truncated: false,
      binary: false,
      generation,
    });
  }
  const { args } = buildRangeArgs(range);
  const oldPath = url.searchParams.get("old_path");
  let cacheKey: string;
  try {
    cacheKey = fileDiffCacheKey({
      path,
      oldPath,
      isUntracked,
      range,
      extras,
      args,
      cwd,
    });
  } catch {
    return text("invalid diff range", 400);
  }
  const cached = fileCache.get(cacheKey);
  let diffText: string;
  let errText = "";
  if (cacheFresh(cached)) {
    diffText = cached.diffText;
  } else {
    if (isUntracked) {
      diffText = git.untrackedFileDiff(extras, path, cwd).stdout || "";
    } else {
      const res = git.fileDiffText(
        [...extras, ...args],
        oldPath ? [oldPath, path] : path,
        cwd,
      );
      diffText = res.stdout || "";
      if (res.code !== 0) errText = res.stderr;
    }
    setTimedCacheEntry(fileCache, cacheKey, { diffText });
  }
  const mode = url.searchParams.get("mode") || "full";
  const truncated =
    mode === "preview"
      ? git.truncateToNHunks(
          diffText,
          Number(url.searchParams.get("max_hunks")) || PREVIEW_HUNKS_DEFAULT,
          Number(url.searchParams.get("max_lines")) || PREVIEW_LINES_DEFAULT,
        )
      : git.truncateToNHunks(diffText, 1e9);
  const body: FileDiffResponse & { line_count?: number; error?: string } = {
    path,
    old_path: url.searchParams.get("old_path") || "",
    status: url.searchParams.get("status") || "",
    mode,
    diff: truncated.text,
    hunk_count: truncated.totalHunks,
    rendered_hunk_count: truncated.renderedHunks,
    line_count: truncated.lineCount,
    truncated:
      mode === "preview" &&
      (truncated.totalHunks > truncated.renderedHunks ||
        truncated.lineTruncated),
    binary: diffText.includes("Binary files"),
    error: errText,
    generation,
  };
  return json(body);
}

function worktreeLineIndexSignature(full: string): string | null {
  try {
    const stat = statSync(full) as unknown as {
      size: number;
      mtimeMs: number;
      ctimeMs: number;
      ino?: number;
    };
    return `size:${stat.size}|mtime:${stat.mtimeMs}|ctime:${stat.ctimeMs}|ino:${stat.ino || 0}`;
  } catch {
    return null;
  }
}

async function getWorktreeLineIndex(
  full: string,
): Promise<LineOffsetIndex | null> {
  const signature = worktreeLineIndexSignature(full);
  if (!signature) return null;
  const cached = lineIndexCache.get(full);
  if (cached?.signature === signature) {
    lineIndexCache.delete(full);
    lineIndexCache.set(full, cached);
    return cached.index;
  }
  const stat = statSync(full) as unknown as { size: number };
  if (stat.size > LINE_INDEX_MAX_FILE_BYTES) return null;
  const index = await buildLineOffsetIndexFromStream(
    fileReadableStream(full),
    stat.size,
  );
  lineIndexCache.delete(full);
  lineIndexCache.set(full, { signature, index });
  while (lineIndexCache.size > 32) {
    const oldest = lineIndexCache.keys().next().value;
    if (oldest === undefined) break;
    lineIndexCache.delete(oldest);
  }
  return index;
}

function cachedBlobLineRange(
  cacheKey: string,
  start: number,
  end: number,
): LineRangeResult | null {
  const bytes = blobBytesCache.get(cacheKey);
  const index = blobLineIndexCache.get(cacheKey);
  if (!bytes || !index) return null;
  blobBytesCache.delete(cacheKey);
  blobBytesCache.set(cacheKey, bytes);
  blobLineIndexCache.delete(cacheKey);
  blobLineIndexCache.set(cacheKey, index);
  const range = lineByteRangeForIndex(index, start, end);
  const textValue = range
    ? new TextDecoder().decode(bytes.subarray(range.start, range.endExclusive))
    : "";
  return collectLineRangeFromIndexedText(textValue, index, start, end);
}

function setBlobLineCache(
  cacheKey: string,
  bytes: Uint8Array,
  index: LineOffsetIndex,
): void {
  setBlobLineIndexCache(cacheKey, index);
  const existing = blobBytesCache.get(cacheKey);
  if (existing) blobLineCacheBytes -= existing.byteLength;
  blobBytesCache.delete(cacheKey);
  if (bytes.byteLength > BLOB_LINE_CACHE_MAX_BYTES) return;
  blobBytesCache.set(cacheKey, bytes);
  blobLineCacheBytes += bytes.byteLength;
  while (
    blobBytesCache.size > 16 ||
    blobLineCacheBytes > BLOB_LINE_CACHE_MAX_BYTES
  ) {
    const oldest = blobBytesCache.keys().next().value;
    if (oldest === undefined) break;
    const evicted = blobBytesCache.get(oldest);
    if (evicted) blobLineCacheBytes -= evicted.byteLength;
    blobBytesCache.delete(oldest);
  }
}

function setBlobLineIndexCache(cacheKey: string, index: LineOffsetIndex): void {
  blobLineIndexCache.delete(cacheKey);
  blobLineIndexCache.set(cacheKey, index);
  while (blobLineIndexCache.size > 128) {
    const oldest = blobLineIndexCache.keys().next().value;
    if (oldest === undefined) break;
    blobLineIndexCache.delete(oldest);
  }
}

async function collectGitBlobLineRangeWithIndex(
  cacheKey: string,
  oid: string,
  index: LineOffsetIndex,
  start: number,
  end: number,
): Promise<LineRangeResult | null> {
  blobLineIndexCache.delete(cacheKey);
  blobLineIndexCache.set(cacheKey, index);
  const range = lineByteRangeForIndex(index, start, end);
  if (!range) return collectLineRangeFromIndexedText("", index, start, end);
  const shown = git.catFileBlobStream(oid, cwd);
  const bytes = await collectByteRangeFromStream(
    shown.stream,
    range.start,
    range.endExclusive,
  );
  await shown.exited;
  if (bytes.byteLength !== range.endExclusive - range.start) return null;
  const textValue = new TextDecoder().decode(bytes);
  return collectLineRangeFromIndexedText(textValue, index, start, end);
}

async function readGitBlobBytesWithIndex(
  oid: string,
  sizeHint: number,
): Promise<{ bytes: Uint8Array; index: LineOffsetIndex } | null> {
  const shown = git.catFileBlobStream(oid, cwd);
  const result = await collectBytesWithLineOffsetIndexFromStream(
    shown.stream,
    sizeHint,
  );
  const code = await shown.exited;
  if (code !== 0) return null;
  return result;
}

async function collectGitBlobLineRangeFromStream(
  oid: string,
  start: number,
  end: number,
): Promise<LineRangeResult | null> {
  const shown = git.catFileBlobStream(oid, cwd);
  const result = await collectLineRangeFromStream(shown.stream, start, end);
  const code = await shown.exited;
  if (code !== 0 && result.complete) return null;
  return result;
}

async function collectIndexedGitBlobLineRange(
  path: string,
  oid: string,
  size: number,
  start: number,
  end: number,
): Promise<LineRangeResult | null> {
  const cacheKey = `${oid}\0${path}`;
  const cached = cachedBlobLineRange(cacheKey, start, end);
  if (cached) return cached;
  const cachedIndex = blobLineIndexCache.get(cacheKey);
  if (cachedIndex)
    return collectGitBlobLineRangeWithIndex(
      cacheKey,
      oid,
      cachedIndex,
      start,
      end,
    );
  if (start < LINE_INDEX_MIN_START) {
    return collectGitBlobLineRangeFromStream(oid, start, end);
  }
  if (size > LINE_INDEX_MAX_FILE_BYTES)
    return collectGitBlobLineRangeFromStream(oid, start, end);
  const indexedBlob = await readGitBlobBytesWithIndex(oid, size);
  if (!indexedBlob) return null;
  setBlobLineCache(cacheKey, indexedBlob.bytes, indexedBlob.index);
  return (
    cachedBlobLineRange(cacheKey, start, end) ||
    collectGitBlobLineRangeWithIndex(
      cacheKey,
      oid,
      indexedBlob.index,
      start,
      end,
    )
  );
}

async function collectIndexedWorktreeLineRange(
  full: string,
  start: number,
  end: number,
): Promise<LineRangeResult> {
  if (start < LINE_INDEX_MIN_START && !lineIndexCache.has(full)) {
    return collectLineRangeFromStream(fileReadableStream(full), start, end);
  }
  const index = await getWorktreeLineIndex(full);
  if (!index)
    return collectLineRangeFromStream(fileReadableStream(full), start, end);
  const range = lineByteRangeForIndex(index, start, end);
  const textValue = range
    ? await readFileTextRange(full, range.start, range.endExclusive)
    : "";
  return collectLineRangeFromIndexedText(textValue, index, start, end);
}

async function handleFileRange(url: URL) {
  const path = url.searchParams.get("path") || "";
  if (!safePath(path)) return text("invalid path", 400);
  let start = Number(url.searchParams.get("start") || "1") || 1;
  let end =
    Number(
      url.searchParams.get("end") || url.searchParams.get("endline") || "0",
    ) || 0;
  if (start < 1) start = 1;
  if (end < start) end = start;
  const ref = url.searchParams.get("ref") || "worktree";
  if (ref === "worktree" || ref === "") {
    const full = safeWorktreePath(path);
    if (!full) return text("no file", 404);
    const result = await collectIndexedWorktreeLineRange(full, start, end);
    const body: FileRangeResponse = {
      path,
      ref,
      start,
      end,
      lines: result.lines,
      total: result.total,
      complete: result.complete,
      generation,
    };
    return json(body);
  } else {
    if (!git.verifyTreeRef(ref, cwd)) return text("invalid ref", 400);
    const oid = git.objectId(ref, path, cwd);
    if (oid.code !== 0 || !oid.oid) return text("not in ref", 404);
    const size = git.objectByteSize(oid.oid, cwd);
    if (size.code !== 0) return text("cannot read ref", 500);
    const result = await collectIndexedGitBlobLineRange(
      path,
      oid.oid,
      size.size,
      start,
      end,
    );
    if (!result) return text("cannot read ref", 500);
    const body: FileRangeResponse = {
      path,
      ref,
      start,
      end,
      lines: result.lines,
      total: result.total,
      complete: result.complete,
      generation,
    };
    return json(body);
  }
}

function handleRawFile(req: Request, url: URL) {
  const path = url.searchParams.get("path") || "";
  if (!safePath(path)) return text("forbidden", 403);
  const ref = url.searchParams.get("ref") || "worktree";
  let body: BodyInit;
  if (ref !== "worktree" && ref !== "") {
    if (!git.verifyTreeRef(ref, cwd)) return text("invalid ref", 400);
    const size = rawFileSize(path, ref);
    if (size == null) return text("not in ref", 404);
    const metadata = gitFileMetadata(ref, path, size);
    if (req.method === "HEAD")
      return new Response(null, {
        headers: rawFileHeaders(path, { size, metadata }),
      });
    const res = git.showBytes(ref, path, cwd);
    if (res.code !== 0) return text("not in ref", 404);
    body = res.stdout.buffer.slice(
      res.stdout.byteOffset,
      res.stdout.byteOffset + res.stdout.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: rawFileHeaders(path, { size, metadata }),
    });
  } else {
    const full = safeWorktreePath(path);
    if (!full) return text("not found", 404);
    const size = rawFileSize(path, ref);
    if (size == null) return text("not found", 404);
    const metadata = worktreeFileMetadata(path, size);
    const rangeResult = req.headers.get("range")
      ? parseHttpByteRange(req.headers.get("range"), size)
      : null;
    if (rangeResult?.kind === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: {
          ...rawFileHeaders(path, { size, metadata }),
          "Content-Range": `bytes */${size}`,
          "Content-Length": "0",
        },
      });
    }
    if (rangeResult?.kind === "range") {
      const range = rangeResult.range;
      if (req.method === "HEAD") {
        return new Response(null, {
          status: 206,
          headers: rawFileHeaders(path, { size, range, metadata }),
        });
      }
      return new Response(
        fileByteRangeResponseBody(full, range.start, range.end),
        {
          status: 206,
          headers: rawFileHeaders(path, { size, range, metadata }),
        },
      );
    }
    if (req.method === "HEAD")
      return new Response(null, {
        headers: rawFileHeaders(path, { size, metadata }),
      });
    return new Response(fileReadableStream(full), {
      headers: rawFileHeaders(path, { size, metadata }),
    });
  }
}

function rawFileSize(path: string, ref: string): number | null {
  if (ref !== "worktree" && ref !== "") {
    if (!git.verifyTreeRef(ref, cwd)) return null;
    const res = git.objectSize(ref, path, cwd);
    return res.code === 0 ? res.size : null;
  }
  const full = safeWorktreePath(path);
  if (!full) return null;
  try {
    return (statSync(full) as unknown as { size: number }).size;
  } catch {
    return null;
  }
}

function isForbiddenUploadName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith(".") ||
    lower === "package.json" ||
    lower === "package-lock.json" ||
    lower === "bun.lock" ||
    lower === "bun.lockb" ||
    lower === "yarn.lock" ||
    lower === "pnpm-lock.yaml" ||
    lower === "makefile" ||
    lower === "dockerfile" ||
    lower.endsWith(".dockerfile") ||
    /^(tsconfig|jsconfig|bunfig|vercel|netlify|wrangler|next|vite|webpack|rollup|esbuild|astro|svelte|tailwind|postcss|babel|prettier|eslint)\./.test(
      lower,
    ) ||
    lower.endsWith(".config.js") ||
    lower.endsWith(".config.jsx") ||
    lower.endsWith(".config.ts") ||
    lower.endsWith(".config.tsx") ||
    lower.endsWith(".config.mjs") ||
    lower.endsWith(".config.cjs") ||
    lower.includes("credential") ||
    lower.includes("secret") ||
    lower.endsWith(".exe") ||
    lower.endsWith(".dll") ||
    lower.endsWith(".dylib") ||
    lower.endsWith(".so") ||
    lower.endsWith(".sh") ||
    lower.endsWith(".bash") ||
    lower.endsWith(".zsh") ||
    lower.endsWith(".fish") ||
    lower.endsWith(".ps1") ||
    lower.endsWith(".bat") ||
    lower.endsWith(".cmd")
  );
}

function safeUploadFileName(name: string): string | null {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed.length > 180 ||
    trimmed.includes("\0") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    Array.from(trimmed).some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return null;
  if (trimmed === "." || trimmed === "..") return null;
  if (isGitInternalPath(trimmed) || isForbiddenUploadName(trimmed)) return null;
  if (!SAFE_UPLOAD_EXTENSIONS.has(extname(trimmed).toLowerCase())) return null;
  return trimmed;
}

function uploadOpenFlags() {
  return (
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_EXCL |
    (constants.O_NOFOLLOW || 0)
  );
}

async function handleUploadFiles(req: Request) {
  if (!uploadEnabled) return text("upload disabled by viewer settings", 403);
  if (req.method !== "POST") return text("method not allowed", 405);
  if (!sideEffectRequestAllowed(req)) return text("forbidden", 403);
  if (req.headers.get("content-encoding"))
    return text("unsupported media type", 415);
  const lengthHeader = req.headers.get("content-length");
  if (!lengthHeader) return text("content length required", 411);
  const length = Number(lengthHeader);
  if (!Number.isSafeInteger(length) || length < 0)
    return text("invalid content length", 400);
  if (length > MAX_UPLOAD_BODY_BYTES) return text("upload too large", 413);
  const contentType = req.headers.get("content-type") || "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType))
    return text("unsupported media type", 415);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return text("invalid form data", 400);
  }

  const dir = String(form.get("dir") || "").replace(/^\/+|\/+$/g, "");
  if (!safeRepoPath(dir)) return text("invalid dir", 400);
  if (dir && isGitInternalPath(dir)) return text("forbidden", 403);
  const realDir = safeOpenWorktreePath(dir);
  if (!realDir) return text("not found", 404);
  const stats = statSync(realDir) as unknown as { isDirectory(): boolean };
  if (!stats.isDirectory()) return text("not a directory", 400);

  const files = form
    .getAll("files")
    .filter((item): item is File => item instanceof File);
  if (!files.length) return text("no files", 400);
  if (files.length > MAX_UPLOAD_FILES) return text("too many files", 413);

  let total = 0;
  const names = new Set<string>();
  const uploads: Array<{ file: File; name: string; target: string }> = [];
  for (const file of files) {
    const safeName = safeUploadFileName(file.name);
    if (!safeName) return text("invalid filename", 400);
    const lowerName = safeName.toLowerCase();
    if (names.has(lowerName)) return text("duplicate filename", 409);
    names.add(lowerName);
    if (file.size > MAX_UPLOAD_FILE_BYTES) return text("file too large", 413);
    total += file.size;
    if (total > MAX_UPLOAD_TOTAL_BYTES) return text("upload too large", 413);
    const target = join(realDir, safeName);
    if (relative(realDir, dirname(target)) !== "")
      return text("invalid filename", 400);
    if (existsSync(target)) return text("file exists", 409);
    uploads.push({ file, name: safeName, target });
  }

  const written: string[] = [];
  try {
    for (const upload of uploads) {
      const fd = openSync(upload.target, uploadOpenFlags(), 0o644);
      try {
        writeFileSync(fd, new Uint8Array(await upload.file.arrayBuffer()));
      } finally {
        closeSync(fd);
      }
      written.push(upload.target);
    }
  } catch (error) {
    for (const path of written) {
      try {
        unlinkSync(path);
      } catch {
        /* best-effort cleanup */
      }
    }
    if ((error as { code?: string }).code === "EEXIST")
      return text("file exists", 409);
    return text("upload failed", 500);
  }

  triggerUpdate();
  return json({
    ok: true,
    files: uploads.map((upload) => upload.name),
    generation,
  });
}

function openOsPath(path: string) {
  const cmd =
    process.platform === "darwin"
      ? ["open", "--", path]
      : process.platform === "win32"
        ? ["explorer.exe", path]
        : ["xdg-open", path];
  spawnDetached(cmd);
}

function windowsTrashScript(path: string): string {
  const quotedPath = path.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop';",
    `$path = '${quotedPath}';`,
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class CodeViewerRecycleBin {",
    "  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
    "  public struct SHFILEOPSTRUCT {",
    "    public IntPtr hwnd;",
    "    public uint wFunc;",
    "    public string pFrom;",
    "    public string pTo;",
    "    public ushort fFlags;",
    "    [MarshalAs(UnmanagedType.Bool)] public bool fAnyOperationsAborted;",
    "    public IntPtr hNameMappings;",
    "    public string lpszProgressTitle;",
    "  }",
    '  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]',
    "  private static extern int SHFileOperationW(ref SHFILEOPSTRUCT lpFileOp);",
    "  public static void MoveToRecycleBin(string path) {",
    "    const uint FO_DELETE = 0x0003;",
    "    const ushort FOF_SILENT = 0x0004;",
    "    const ushort FOF_NOCONFIRMATION = 0x0010;",
    "    const ushort FOF_ALLOWUNDO = 0x0040;",
    "    const ushort FOF_NOERRORUI = 0x0400;",
    "    var op = new SHFILEOPSTRUCT {",
    "      hwnd = IntPtr.Zero,",
    "      wFunc = FO_DELETE,",
    '      pFrom = path + "\\0\\0",',
    "      pTo = null,",
    "      fFlags = (ushort)(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT),",
    "      fAnyOperationsAborted = false,",
    "      hNameMappings = IntPtr.Zero,",
    "      lpszProgressTitle = null",
    "    };",
    "    int result = SHFileOperationW(ref op);",
    '    if (result != 0) throw new InvalidOperationException("SHFileOperationW failed: " + result);',
    '    if (op.fAnyOperationsAborted) throw new OperationCanceledException("SHFileOperationW aborted");',
    "  }",
    "}",
    "'@;",
    "[CodeViewerRecycleBin]::MoveToRecycleBin($path);",
  ].join(" ");
}

function windowsRestoreTrashScript(originalPath: string): string {
  const quotedPath = originalPath.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop';",
    `$original = '${quotedPath}';`,
    "$parent = [System.IO.Path]::GetDirectoryName($original);",
    "$name = [System.IO.Path]::GetFileName($original);",
    "$shell = New-Object -ComObject Shell.Application;",
    "$bin = $shell.Namespace(10);",
    "$restored = $false;",
    "foreach ($item in $bin.Items()) {",
    "  $deletedFrom = $item.ExtendedProperty('System.Recycle.DeletedFrom');",
    "  if ($item.Name -eq $name -and $deletedFrom -eq $parent) {",
    "    $item.InvokeVerb('ESTORE');",
    "    $restored = $true;",
    "    break;",
    "  }",
    "}",
    "if (-not $restored) { throw 'recycle bin item not found'; }",
  ].join(" ");
}

function makeUndoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clearMutableCaches() {
  fileCache.clear();
  metaCache.clear();
  fileListCache.clear();
}

function triggerUpdate(changedPaths?: string[]) {
  generation++;
  clearMutableCaches();
  const data =
    changedPaths && changedPaths.length && changedPaths.length <= 50
      ? JSON.stringify({ generation, paths: changedPaths })
      : "tick";
  sendSse("update", data);
}

function moveMacPathIntoTrash(path: string): {
  ok: boolean;
  trashPath?: string;
  error?: string;
} {
  const trashDir = join(homedir(), ".Trash");
  const base = basename(path) || "code-viewer-trash-item";
  const target = join(
    trashDir,
    `${base}-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    mkdirSync(trashDir, { recursive: true });
    renameSync(path, target);
    return { ok: true, trashPath: target };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function movePathToTrash(path: string): {
  ok: boolean;
  trashPath?: string;
  error?: string;
} {
  lstatSync(path);
  if (process.platform === "darwin") {
    return moveMacPathIntoTrash(path);
  }
  if (process.platform === "win32") {
    const res = runSync(
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        windowsTrashScript(path),
      ],
      cwd,
      { timeout: 60000 },
    );
    return res.code === 0
      ? { ok: true }
      : { ok: false, error: res.stderr || res.stdout };
  }
  return { ok: false, error: "trash unsupported" };
}

function restoreTrashPath(
  originalPath: string,
  trashPath?: string,
): {
  ok: boolean;
  error?: string;
} {
  const parent = parentRepoPath(originalPath);
  const parentFullPath = safeOpenWorktreePath(parent);
  if (!parentFullPath) return { ok: false, error: "invalid restore target" };
  const original = worktreePath(originalPath);
  if (existsSync(original))
    return { ok: false, error: "restore target exists" };
  if (trashPath) {
    if (process.platform !== "darwin")
      return { ok: false, error: "invalid trash handle" };
    if (!existsSync(trashPath))
      return { ok: false, error: "trash item not found" };
    try {
      const trashRoot = join(homedir(), ".Trash");
      const trashRelative = relative(trashRoot, trashPath);
      if (
        trashRelative === "" ||
        trashRelative.startsWith("..") ||
        trashRelative.startsWith("/") ||
        trashRelative.startsWith("\\")
      )
        return { ok: false, error: "invalid trash handle" };
      mkdirSync(dirname(original), { recursive: true });
      renameSync(trashPath, original);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
  if (process.platform === "win32") {
    const res = runSync(
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        windowsRestoreTrashScript(original),
      ],
      cwd,
      { timeout: 60000 },
    );
    return res.code === 0
      ? { ok: true }
      : { ok: false, error: res.stderr || res.stdout };
  }
  return { ok: false, error: "undo unavailable for this trash operation" };
}

async function handleOpenPath(req: Request) {
  if (req.method !== "POST") return text("method not allowed", 405);
  if (!sideEffectRequestAllowed(req)) return text("forbidden", 403);
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:;|$)/i.test(contentType))
    return text("unsupported media type", 415);
  const length = Number(req.headers.get("content-length") || "0");
  if (length > 1024) return text("payload too large", 413);

  let body: { path?: unknown; kind?: unknown } = {};
  try {
    const raw = await req.text();
    if (raw.length > 1024) return text("payload too large", 413);
    body = JSON.parse(raw);
  } catch {
    return text("invalid json", 400);
  }

  const path =
    typeof body.path === "string" ? body.path.replace(/^\/+|\/+$/g, "") : "";
  const kind = body.kind;
  if (kind !== "directory" && kind !== "file-parent")
    return text("invalid kind", 400);
  if (kind === "file-parent" && !path) return text("invalid path", 400);
  if (!safeRepoPath(path)) return text("invalid path", 400);
  if (path && isGitInternalPath(path)) return text("forbidden", 403);

  const targetPath = kind === "file-parent" ? parentRepoPath(path) : path;
  const target = safeOpenWorktreePath(targetPath);
  if (!target) return text("not found", 404);

  const stats = statSync(target) as unknown as { isDirectory(): boolean };
  if (!stats.isDirectory()) return text("not a directory", 400);
  openOsPath(target);
  return json({ ok: true });
}

async function handleTrashPath(req: Request) {
  if (req.method !== "POST") return text("method not allowed", 405);
  if (!sideEffectRequestAllowed(req)) return text("forbidden", 403);
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:;|$)/i.test(contentType))
    return text("unsupported media type", 415);
  const length = Number(req.headers.get("content-length") || "0");
  if (length > 1024) return text("payload too large", 413);

  let body: { path?: unknown } = {};
  try {
    const raw = await req.text();
    if (raw.length > 1024) return text("payload too large", 413);
    body = JSON.parse(raw);
  } catch {
    return text("invalid json", 400);
  }

  const path =
    typeof body.path === "string" ? body.path.replace(/^\/+|\/+$/g, "") : "";
  if (!path) return text("invalid path", 400);
  if (!safeRepoPath(path)) return text("invalid path", 400);
  if (isGitInternalPath(path)) return text("forbidden", 403);
  const originalFullPath = safeWorktreePath(path);
  if (!originalFullPath) return text("not found", 404);
  const moved = movePathToTrash(worktreePath(path));
  if (!moved.ok) return text(moved.error || "trash failed", 500);
  const undo: UndoActionResponse = {
    id: makeUndoId(),
    type: "trash",
    label: `Restore ${path}`,
    payload: {
      original_path: path,
      trashPath: moved.trashPath,
    },
  };
  triggerUpdate();
  return json({ ok: true, generation, undo });
}

async function handleCreateDirectory(req: Request) {
  if (req.method !== "POST") return text("method not allowed", 405);
  if (!sideEffectRequestAllowed(req)) return text("forbidden", 403);
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:;|$)/i.test(contentType))
    return text("unsupported media type", 415);
  const lengthHeader = req.headers.get("content-length");
  const length = Number(lengthHeader || "0");
  if (lengthHeader && (!Number.isFinite(length) || length < 0))
    return text("invalid content length", 400);
  if (length > 2048) return text("payload too large", 413);

  let body: { dir?: unknown; name?: unknown } = {};
  try {
    const raw = await req.text();
    if (raw.length > 2048) return text("payload too large", 413);
    body = JSON.parse(raw);
  } catch {
    return text("invalid json", 400);
  }

  const dir =
    typeof body.dir === "string"
      ? body.dir.trim().replace(/^\/+|\/+$/g, "")
      : "";
  const name = normalizeNewDirectoryName(body.name);
  if (!safeRepoPath(dir)) return text("invalid dir", 400);
  if (dir && isGitInternalPath(dir)) return text("forbidden", 403);
  if (!name) return text("invalid name", 400);
  const parent = safeOpenWorktreePath(dir);
  if (!parent) return text("not found", 404);
  const stats = statSync(parent) as unknown as { isDirectory(): boolean };
  if (!stats.isDirectory()) return text("not a directory", 400);
  const targetPath = dir ? `${dir}/${name}` : name;
  if (!safeRepoPath(targetPath) || isGitInternalPath(targetPath))
    return text("invalid target", 400);
  const target = join(parent, name);
  if (existsSync(target)) return text("already exists", 409);
  try {
    mkdirSync(target, { recursive: false });
  } catch (error) {
    if ((error as { code?: string }).code === "EEXIST")
      return text("already exists", 409);
    return text("create failed", 500);
  }
  triggerUpdate();
  return json({ ok: true, path: targetPath, generation });
}

async function handleRestoreTrash(req: Request) {
  if (req.method !== "POST") return text("method not allowed", 405);
  if (!sideEffectRequestAllowed(req)) return text("forbidden", 403);
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:;|$)/i.test(contentType))
    return text("unsupported media type", 415);
  const length = Number(req.headers.get("content-length") || "0");
  if (length > 1024) return text("payload too large", 413);

  let body: { original_path?: unknown; trashPath?: unknown } = {};
  try {
    const raw = await req.text();
    if (raw.length > 1024) return text("payload too large", 413);
    body = JSON.parse(raw);
  } catch {
    return text("invalid json", 400);
  }

  const originalPath =
    typeof body.original_path === "string"
      ? body.original_path.replace(/^\/+|\/+$/g, "")
      : "";
  const trashPath = typeof body.trashPath === "string" ? body.trashPath : "";
  if (!originalPath || !safeRepoPath(originalPath))
    return text("invalid restore target", 400);
  if (isGitInternalPath(originalPath)) return text("forbidden", 403);
  const restored = restoreTrashPath(originalPath, trashPath || undefined);
  if (!restored.ok) return text(restored.error || "undo failed", 409);
  triggerUpdate();
  return json({ ok: true, generation });
}

function annotationSse(
  kind: "start" | "add" | "delete" | "clear" | "update",
  sessionId?: string,
  entryId?: string,
) {
  sendSse(
    "annotation",
    JSON.stringify({ kind, session_id: sessionId, entry_id: entryId }),
  );
}

async function handleAnnotations(req: Request) {
  if (req.method === "GET") return json(await loadAnnotationsState(cwd));
  if (req.method !== "POST") return text("method not allowed", 405);
  if (!sideEffectRequestAllowed(req)) return text("forbidden", 403);
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:;|$)/i.test(contentType))
    return text("unsupported media type", 415);
  const maxBytes = ANNOTATION_BODY_MAX_BYTES + 4096;
  const length = Number(req.headers.get("content-length") || "0");
  if (length > maxBytes) return text("payload too large", 413);

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw.length > maxBytes) return text("payload too large", 413);
    body = JSON.parse(raw);
  } catch {
    return text("invalid json", 400);
  }

  const action = body.action;
  if (action === "start") {
    const title = typeof body.title === "string" ? body.title : "";
    const started = startAnnotationSession(
      await loadAnnotationsState(cwd),
      title,
      new Date().toISOString(),
    );
    await saveAnnotationsState(cwd, started.state);
    annotationSse("start", started.session.id);
    return json({ ok: true, session: started.session });
  }
  if (action === "add") {
    const rawTarget =
      body.target && typeof body.target === "object"
        ? (body.target as Record<string, unknown>)
        : null;
    const target: AnnotationTarget | undefined =
      rawTarget?.kind === "database"
        ? normalizeAnnotationTarget(rawTarget)
        : undefined;
    if (target?.kind === "database" && !target.db)
      return text("database annotation requires db", 400);
    if (target?.kind === "database" && target.data && !target.table)
      return text("database data annotations require table", 400);
    const path =
      typeof body.path === "string" ? body.path.replace(/^\/+|\/+$/g, "") : "";
    if (!target) {
      if (!path || !safeRepoPath(path)) return text("invalid path", 400);
      if (isGitInternalPath(path) || isCodeViewerInternalPath(path))
        return text("forbidden", 403);
    }
    const result = addAnnotationEntry(
      await loadAnnotationsState(cwd),
      {
        session_id:
          typeof body.session_id === "string" ? body.session_id : undefined,
        session_title:
          typeof body.session_title === "string"
            ? body.session_title
            : undefined,
        path,
        line:
          body.line && typeof body.line === "object"
            ? (body.line as { start: number; end: number })
            : undefined,
        range:
          body.range && typeof body.range === "object"
            ? (body.range as { from?: string; to?: string })
            : undefined,
        target,
        title: typeof body.title === "string" ? body.title : undefined,
        body: typeof body.body === "string" ? body.body : "",
        before_id:
          typeof body.before_id === "string" ? body.before_id : undefined,
        after_id: typeof body.after_id === "string" ? body.after_id : undefined,
        position: typeof body.position === "number" ? body.position : undefined,
      },
      new Date().toISOString(),
    );
    if (result.ok === false) return text(result.error, 400);
    await saveAnnotationsState(cwd, result.state);
    annotationSse("add", result.session.id, result.entry.id);
    return json({
      ok: true,
      session_id: result.session.id,
      session_title: result.session.title,
      created_session: result.created_session,
      entry: result.entry,
    });
  }
  if (action === "move") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return text("invalid id", 400);
    const result = moveAnnotationEntry(await loadAnnotationsState(cwd), id, {
      before_id:
        typeof body.before_id === "string" ? body.before_id : undefined,
      after_id: typeof body.after_id === "string" ? body.after_id : undefined,
      position: typeof body.position === "number" ? body.position : undefined,
    });
    if (result.ok === false) return text(result.error, 400);
    await saveAnnotationsState(cwd, result.state);
    annotationSse("update", result.session.id, result.entry.id);
    return json({
      ok: true,
      session_id: result.session.id,
      entry: result.entry,
    });
  }
  if (action === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return text("invalid id", 400);
    const result = deleteAnnotationById(await loadAnnotationsState(cwd), id);
    if (result.removed) {
      await saveAnnotationsState(cwd, result.state);
      annotationSse("delete");
    }
    return json({ ok: true, removed: result.removed });
  }
  if (action === "rename") {
    const id = typeof body.id === "string" ? body.id : "";
    const title = typeof body.title === "string" ? body.title : "";
    if (!id) return text("invalid id", 400);
    const result = renameAnnotationSession(
      await loadAnnotationsState(cwd),
      id,
      title,
    );
    if (!result.renamed) return text("session not found", 404);
    await saveAnnotationsState(cwd, result.state);
    annotationSse("update", id);
    return json({ ok: true });
  }
  if (action === "update") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return text("invalid id", 400);
    const result = updateAnnotationEntry(await loadAnnotationsState(cwd), id, {
      title: typeof body.title === "string" ? body.title : undefined,
      body: typeof body.body === "string" ? body.body : undefined,
    });
    if (result.ok === false) return text(result.error, 400);
    await saveAnnotationsState(cwd, result.state);
    annotationSse("update", undefined, id);
    return json({ ok: true, entry: result.entry });
  }
  if (action === "clear") {
    await saveAnnotationsState(cwd, emptyAnnotationsState());
    annotationSse("clear");
    return json({ ok: true });
  }
  return text("invalid action", 400);
}

const isCodeViewerInternalPath = git.isToolInternalPath;

function sendSse(event: string, data = "tick") {
  const payload = enc.encode(`event: ${event}\ndata: ${data}\n\n`);
  for (const client of [...sseClients]) {
    try {
      client.enqueue(payload);
    } catch {
      removeSseClient(client);
    }
  }
}

function removeSseClient(ctrl: ReadableStreamDefaultController<Uint8Array>) {
  sseClients.delete(ctrl);
  const keepalive = sseKeepalives.get(ctrl);
  if (keepalive) clearInterval(keepalive);
  sseKeepalives.delete(ctrl);
}

function closeSseClients() {
  for (const client of [...sseClients]) {
    removeSseClient(client);
    try {
      client.close();
    } catch {
      /* client may already be closed */
    }
  }
}

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd.exe", "/c", "start", "", url]
        : ["xdg-open", url];
  spawnDetached(cmd);
}

parseCli();
applyPersistedSettings(await loadAppSettingsState(cwd));

// Directory count the worktree watcher capped at, or null while under the cap.
// Tracked so clients that connect after the cap was hit still learn about it.
let watchLimitReached: number | null = null;

const server = await startServer({
  hostname: "127.0.0.1",
  port: listenPort,
  async fetch(req) {
    if (!requestAllowed(req)) return text("forbidden", 403);
    const url = new URL(req.url);
    const staticResponse = staticFile(url.pathname);
    if (staticResponse) return staticResponse;
    if (url.pathname === "/diff.json") return handleDiffJson(url);
    if (url.pathname === "/_settings") return handleSettings();
    if (url.pathname === "/_doctor")
      return handleDoctor({
        cwd,
        scopeOmitDirNames,
        listenPort,
      });
    if (url.pathname === "/_tree") return handleTree(url);
    if (url.pathname === "/_files") return handleFiles(url);
    if (url.pathname === "/_grep") return handleGrep(url);
    if (url.pathname === "/_commits") return handleRefCommits(url);
    if (url.pathname === "/_log") return handleLog(url);
    if (url.pathname === "/_file_blame") return handleFileBlame(url);
    if (url.pathname === "/file_diff") return handleFileDiff(url);
    if (url.pathname === "/file_range") return handleFileRange(url);
    if (url.pathname === "/_file") return handleRawFile(req, url);
    if (url.pathname === "/_open_path") return handleOpenPath(req);
    if (url.pathname === "/_trash_path") return handleTrashPath(req);
    if (url.pathname === "/_restore_trash") return handleRestoreTrash(req);
    if (url.pathname === "/_create_directory")
      return handleCreateDirectory(req);
    if (url.pathname === "/_upload_files") return handleUploadFiles(req);
    if (url.pathname.startsWith("/_db/")) {
      const { handleDatabaseRoute } = await import("./database/handle");
      const dbResponse = await handleDatabaseRoute(
        req,
        url,
        cwd,
        scopeOmitDirNames,
        sideEffectRequestAllowed,
        sendSse,
      );
      if (dbResponse) return dbResponse;
    }
    if (url.pathname.startsWith("/_state/")) {
      const { handleStateRoute } = await import("./state-route");
      const stateResponse = await handleStateRoute(
        req,
        url,
        cwd,
        sideEffectRequestAllowed,
        { onSettingsChange: applyPersistedSettings },
      );
      if (stateResponse) return stateResponse;
    }
    if (url.pathname === "/_annotations") return handleAnnotations(req);
    if (url.pathname === "/_refs") return json(git.refs(cwd));
    if (url.pathname === "/refresh" && req.method === "POST") {
      if (!sideEffectRequestAllowed(req)) return text("forbidden", 403);
      triggerUpdate();
      return json({ ok: true, generation });
    }
    if (url.pathname === "/events") {
      let ctrl: ReadableStreamDefaultController<Uint8Array>;
      let keepalive: ReturnType<typeof setInterval>;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            ctrl = controller;
            sseClients.add(controller);
            controller.enqueue(enc.encode("event: open\ndata: ok\n\n"));
            if (watchLimitReached !== null) {
              controller.enqueue(
                enc.encode(
                  `event: watch-limit\ndata: ${watchLimitReached}\n\n`,
                ),
              );
            }
            keepalive = setInterval(() => {
              try {
                controller.enqueue(enc.encode(": ping\n\n"));
              } catch {
                removeSseClient(controller);
              }
            }, 15000);
            keepalive.unref?.();
            sseKeepalives.set(controller, keepalive);
          },
          cancel() {
            if (ctrl) removeSseClient(ctrl);
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        },
      );
    }
    return text("not found", 404);
  },
});

// startServer 後に実際にバインドされたポートを listenPort に反映する。
// CLI 引数で --port を指定しない場合 listenPort=0 のまま startServer に渡しており、
// OS が選んだポートは server.port にしか入らない。doctor (handleDoctor) は
// listenPort=0 を「未バインド」として WARN を出すので、ここで同期しないと
// npx 既定起動時に常に「port not yet bound」WARN が出てしまう。
listenPort = server.port;

if (openAfterStart) {
  openBrowser(`http://127.0.0.1:${server.port}/`);
}

writeServerRegistry({
  url: `http://127.0.0.1:${server.port}/`,
  pid: process.pid,
  root: cwd,
  started_at: new Date().toISOString(),
});
let worktreeWatch: ReturnType<typeof startWorktreeUpdateWatch> | null = null;
let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    process.exit(1);
  }
  shuttingDown = true;
  removeServerRegistry(cwd, process.pid);
  closeSseClients();
  worktreeWatch?.close();
  try {
    await server.close();
  } catch (error) {
    console.warn(`code-viewer server close skipped: ${String(error)}`);
  }
  process.exit(exitCode);
}

process.on("exit", () => {
  removeServerRegistry(cwd, process.pid);
  closeSseClients();
  worktreeWatch?.close();
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => void shutdown(0));
}

// Under the dev wrapper, exit when the parent dies so a crashed or
// force-killed dev.ts never leaves this server holding the port.
// Note: Bun caches process.ppid at startup, so poll the captured pid
// with signal 0 instead of re-reading process.ppid.
if (process.env.CODE_VIEWER_DEV === "1") {
  const parentPid = process.ppid;
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      console.log("dev wrapper exited; shutting down preview server");
      void shutdown(0);
    }
  }, 1000).unref();
}

startDevAssetReload({
  enabled: process.env.CODE_VIEWER_DEV === "1",
  webRoot: WEB_ROOT,
  watchedFiles: WATCHED_ASSET_FILES,
  watch,
  sendReload: () => sendSse("reload"),
});

function startScopedWorktreeWatch(): ReturnType<
  typeof startWorktreeUpdateWatch
> {
  watchLimitReached = null;
  return startWorktreeUpdateWatch({
    root: cwd,
    omitDirNames: scopeOmitDirNames,
    excludeNames: scopeExcludeNames,
    watch,
    initialScanMode: "async",
    maxWatchedDirectories: scopeWatchLimit,
    onUpdate: triggerUpdate,
    onWatchLimit: (limit) => {
      watchLimitReached = limit;
      sendSse("watch-limit", String(limit));
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`code-viewer worktree watch skipped: ${message}`);
    },
  });
}

function restartWorktreeWatch() {
  // Guard against being called during the synchronous startup phase, before
  // `worktreeWatch` / `shuttingDown` are reached by their let declarations.
  // Touching them inside the TDZ throws ReferenceError.
  try {
    if (shuttingDown) return;
    if (!worktreeWatch) return;
  } catch {
    return;
  }
  try {
    worktreeWatch.close();
  } catch (error) {
    console.warn(
      `code-viewer worktree watch restart close skipped: ${String(error)}`,
    );
  }
  worktreeWatch = startScopedWorktreeWatch();
}

worktreeWatch = startScopedWorktreeWatch();

console.log(`GDP_LISTEN_URL=http://127.0.0.1:${server.port}/`);
console.log(`git-diff-preview serving ${cwd}`);
