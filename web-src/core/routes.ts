import {
  formatHistoryLineRange,
  type HistoryLineRange,
  parseHistoryLineRange,
} from "./history";
import { isShellSessionId, type ShellSessionId } from "./shell";
import { isToolId, type ToolId } from "./tools";

export type DiffRange = {
  from: string;
  to: string;
};

export type SourceLineRange = {
  start: number;
  end: number;
};

export type SourceLineTarget = number | SourceLineRange;

export type SourceFileTarget = {
  path: string;
  ref: string;
};

export type AppRoute =
  | { screen: "repo"; ref: string; path: string; range: DiffRange }
  | { screen: "diff"; range: DiffRange; path?: string; line?: SourceLineTarget }
  | {
      screen: "file";
      path: string;
      ref: string;
      range: DiffRange;
      view?: "blob" | "detail" | "blame" | "history";
      preview?: true;
      line?: SourceLineTarget;
      commit?: string;
      /** view=history: diff the selected commit against this sha instead of
       * its first parent (Shift+click range, or the second parent of a merge). */
      compare?: string;
      /** view=history: the commit filter text. */
      q?: string;
      /** view=history: only commits that changed these lines (git log -L). */
      lines?: HistoryLineRange;
      /** Text to mark inside the `line` target (e.g. the grep hit). */
      hl?: string;
      virtual?: "off";
    }
  | { screen: "help"; range: DiffRange; lang: string; section: string }
  | {
      screen: "worktree";
      /** 選んでいる作業ツリーの一意な id。 */
      wt?: string;
      /** その作業ツリーの中で開いているファイル。 */
      file?: string;
      /** その差分が未コミットぶんか、基準ブランチから分かれた後のぶんか。 */
      origin?: "uncommitted" | "committed";
      range: DiffRange;
    }
  | {
      screen: "history";
      ref: string;
      commit?: string;
      /** Diff the selected commit against this sha instead of its first
       * parent (Shift+click range, or the second parent of a merge). */
      compare?: string;
      /** Commit filter text (author: / path: / since: ... syntax). */
      q?: string;
      /** Restrict the log to this path; a trailing "/" means a directory. */
      path?: string;
      /** With a file `path`: only commits that changed these lines. */
      lines?: HistoryLineRange;
      /** A changed file of the selected commit whose full source is shown in
       * place of the diff cards ("View File"). The commit list stays. */
      source?: string;
      range: DiffRange;
    }
  | {
      screen: "journal";
      tab?: "journal" | "tasks";
      date?: string;
      label?: string;
      task?: string;
      range: DiffRange;
    }
  | {
      screen: "database";
      db?: string;
      schema?: string;
      table?: string;
      tab?: "data" | "query" | "schema" | "er" | "search" | "snapshot";
      /** snapshot タブで diff 表示中の before/after snapshot id。
       * URL に乗せておくと、リロードしても同じ比較が復元される。 */
      diffBefore?: string;
      diffAfter?: string;
      range: DiffRange;
    }
  | {
      screen: "unknown";
      reason: "unknown-pathname" | "missing-path";
      rawPathname: string;
      rawSearch: string;
      range: DiffRange;
    };

export const SPA_PATHS = [
  "/todif",
  "/todiff",
  "/file",
  "/help",
  "/history",
  "/journal",
  "/database",
  "/worktree",
  "/doctor",
] as const;
export const APP_ENTRY_PATHS = ["/", "/index.html"] as const;

export function assertNever(value: never): never {
  throw new Error(`unhandled route: ${JSON.stringify(value)}`);
}

function parseLegacyRange(
  value: string | null | undefined,
  fallback: DiffRange,
): DiffRange {
  const raw = value || "";
  const sep = raw.indexOf("..");
  if (sep < 0) return fallback;
  return {
    from: raw.slice(0, sep) || fallback.from,
    to: raw.slice(sep + 2) || fallback.to,
  };
}

export function parseLineTarget(
  value: string | null | undefined,
): SourceLineTarget | undefined {
  const raw = value || "";
  const range = /^(\d+)-(\d+)$/.exec(raw);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (start > 0) return { start, end };
    return undefined;
  }
  const line = Number(raw);
  return Number.isInteger(line) && line > 0 ? line : undefined;
}

function formatLineTarget(line: SourceLineTarget): string {
  return typeof line === "number" ? String(line) : `${line.start}-${line.end}`;
}

export function parseRoute(
  pathname: string,
  search: string,
  fallbackRange: DiffRange,
): AppRoute {
  const params = new URLSearchParams(search);
  const legacyRange = parseLegacyRange(params.get("range"), fallbackRange);
  const range = {
    from: params.get("from") || legacyRange.from,
    to: params.get("to") || legacyRange.to,
  };
  switch (pathname) {
    case "/":
    case "/index.html":
      return {
        screen: "repo",
        ref: params.get("ref") || params.get("target") || "worktree",
        path: params.get("path") || "",
        range,
      };
    case "/todif":
    case "/todiff":
      return {
        screen: "diff",
        range,
        ...(params.get("path") ? { path: params.get("path") || "" } : {}),
        ...(parseLineTarget(params.get("line"))
          ? { line: parseLineTarget(params.get("line")) }
          : {}),
      };
    case "/file": {
      const path = params.get("path") || "";
      const target = params.get("target") || "";
      const ref = target || params.get("ref") || "worktree";
      const line = parseLineTarget(params.get("line"));
      if (!path)
        return {
          screen: "unknown",
          reason: "missing-path",
          rawPathname: pathname,
          rawSearch: search,
          range,
        };
      const rawView = params.get("view");
      const preview = params.get("preview") === "1";
      const hl = params.get("hl") || "";
      if (rawView === "blob") {
        return {
          screen: "file",
          path,
          ref,
          range,
          view: "blob",
          ...(preview ? { preview: true as const } : {}),
          ...(line ? { line } : {}),
          ...(line && hl ? { hl } : {}),
          ...(params.get("virtual") === "off"
            ? { virtual: "off" as const }
            : {}),
        };
      }
      if (rawView === "blame") {
        return {
          screen: "file",
          path,
          ref,
          range,
          view: "blame",
          ...(line ? { line } : {}),
        };
      }
      if (rawView === "history") {
        return {
          screen: "file",
          path,
          ref,
          range,
          view: "history",
          ...(params.get("commit")
            ? { commit: params.get("commit") || "" }
            : {}),
          ...(params.get("compare")
            ? { compare: params.get("compare") || "" }
            : {}),
          ...(params.get("q") ? { q: params.get("q") || "" } : {}),
          ...(parseHistoryLineRange(params.get("lines"))
            ? { lines: parseHistoryLineRange(params.get("lines")) }
            : {}),
          ...(line ? { line } : {}),
        };
      }
      return {
        screen: "file",
        path,
        ref,
        range,
        view: target ? "blob" : "detail",
        ...(target && preview ? { preview: true as const } : {}),
        ...(line ? { line } : {}),
        ...(params.get("virtual") === "off" ? { virtual: "off" as const } : {}),
      };
    }
    case "/help":
      return {
        screen: "help",
        range,
        lang: params.get("lang") || "en",
        section: params.get("section") || "overview",
      };
    case "/worktree": {
      const wt = params.get("wt") || "";
      const file = params.get("file") || "";
      const rawOrigin = params.get("origin");
      const origin =
        rawOrigin === "committed" || rawOrigin === "uncommitted"
          ? rawOrigin
          : undefined;
      return {
        screen: "worktree",
        ...(wt ? { wt } : {}),
        ...(file ? { file } : {}),
        ...(origin ? { origin } : {}),
        range,
      };
    }
    case "/doctor":
      return {
        screen: "repo",
        ref: params.get("ref") || params.get("target") || "worktree",
        path: params.get("path") || "",
        range,
      };
    case "/history": {
      const commit = params.get("commit") || "";
      const compare = params.get("compare") || "";
      const q = params.get("q") || "";
      const path = params.get("path") || "";
      const lines = parseHistoryLineRange(params.get("lines"));
      const source = params.get("source") || "";
      return {
        screen: "history",
        ref: params.get("ref") || "HEAD",
        ...(commit ? { commit } : {}),
        ...(compare ? { compare } : {}),
        ...(q ? { q } : {}),
        ...(path ? { path } : {}),
        ...(path && lines ? { lines } : {}),
        ...(source ? { source } : {}),
        range,
      };
    }
    case "/journal": {
      const tabRaw = params.get("tab");
      const tab =
        tabRaw === "tasks" || tabRaw === "journal" ? tabRaw : undefined;
      const date = params.get("date") || undefined;
      const label = params.get("label") || undefined;
      const task = params.get("task") || undefined;
      return {
        screen: "journal",
        ...(tab ? { tab } : {}),
        ...(date ? { date } : {}),
        ...(label ? { label } : {}),
        ...(task ? { task } : {}),
        range,
      };
    }
    case "/database": {
      const db = params.get("db") || undefined;
      const schema = params.get("schema") || undefined;
      const table = params.get("table") || undefined;
      const tabRaw = params.get("tab");
      const tab =
        tabRaw === "data" ||
        tabRaw === "query" ||
        tabRaw === "schema" ||
        tabRaw === "er" ||
        tabRaw === "search" ||
        tabRaw === "snapshot"
          ? tabRaw
          : undefined;
      const diffBefore = params.get("diffBefore") || undefined;
      const diffAfter = params.get("diffAfter") || undefined;
      return {
        screen: "database",
        ...(db ? { db } : {}),
        ...(schema ? { schema } : {}),
        ...(table ? { table } : {}),
        ...(tab ? { tab } : {}),
        ...(diffBefore ? { diffBefore } : {}),
        ...(diffAfter ? { diffAfter } : {}),
        range,
      };
    }
    default:
      return {
        screen: "unknown",
        reason: "unknown-pathname",
        rawPathname: pathname,
        rawSearch: search,
        range,
      };
  }
}

export function buildRoute(route: AppRoute): string {
  switch (route.screen) {
    case "repo": {
      const params = new URLSearchParams();
      if (route.ref && route.ref !== "worktree") params.set("ref", route.ref);
      if (route.path) params.set("path", route.path);
      const qs = params.toString();
      return `/${qs ? `?${qs}` : ""}`;
    }
    case "file":
      if (route.view === "blob") {
        return (
          "/file?path=" +
          encodeURIComponent(route.path) +
          "&target=" +
          encodeURIComponent(route.ref || "worktree") +
          "&view=blob" +
          (route.preview ? "&preview=1" : "") +
          (route.line
            ? `&line=${encodeURIComponent(formatLineTarget(route.line))}`
            : "") +
          (route.line && route.hl
            ? `&hl=${encodeURIComponent(route.hl)}`
            : "") +
          (route.virtual === "off" ? "&virtual=off" : "")
        );
      }
      if (route.view === "blame") {
        const ref = route.ref || "worktree";
        return (
          "/file?path=" +
          encodeURIComponent(route.path) +
          "&target=" +
          encodeURIComponent(ref) +
          "&view=blame" +
          (route.line
            ? `&line=${encodeURIComponent(formatLineTarget(route.line))}`
            : "")
        );
      }
      if (route.view === "history") {
        return (
          "/file?path=" +
          encodeURIComponent(route.path) +
          "&target=" +
          encodeURIComponent(route.ref || "worktree") +
          "&view=history" +
          (route.commit ? `&commit=${encodeURIComponent(route.commit)}` : "") +
          (route.compare
            ? `&compare=${encodeURIComponent(route.compare)}`
            : "") +
          (route.q ? `&q=${encodeURIComponent(route.q)}` : "") +
          (route.lines
            ? `&lines=${encodeURIComponent(formatHistoryLineRange(route.lines))}`
            : "") +
          (route.line
            ? `&line=${encodeURIComponent(formatLineTarget(route.line))}`
            : "")
        );
      }
      return (
        "/file?path=" +
        encodeURIComponent(route.path) +
        "&ref=" +
        encodeURIComponent(route.ref || "worktree") +
        "&from=" +
        encodeURIComponent(route.range.from || "") +
        "&to=" +
        encodeURIComponent(route.range.to || "worktree") +
        (route.line
          ? `&line=${encodeURIComponent(formatLineTarget(route.line))}`
          : "") +
        (route.virtual === "off" ? "&virtual=off" : "")
      );
    case "diff":
      return (
        "/todif?from=" +
        encodeURIComponent(route.range.from || "") +
        "&to=" +
        encodeURIComponent(route.range.to || "worktree") +
        (route.path ? `&path=${encodeURIComponent(route.path)}` : "") +
        (route.line
          ? `&line=${encodeURIComponent(formatLineTarget(route.line))}`
          : "")
      );
    case "worktree": {
      const params = new URLSearchParams();
      if (route.wt) params.set("wt", route.wt);
      if (route.file) params.set("file", route.file);
      // origin は file とセットのときだけ意味を持つ。
      if (route.file && route.origin) params.set("origin", route.origin);
      const qs = params.toString();
      return `/worktree${qs ? `?${qs}` : ""}`;
    }
    case "help": {
      const params = new URLSearchParams();
      if (route.lang && route.lang !== "en") params.set("lang", route.lang);
      if (route.section && route.section !== "overview")
        params.set("section", route.section);
      const qs = params.toString();
      return `/help${qs ? `?${qs}` : ""}`;
    }
    case "history": {
      const params = new URLSearchParams();
      if (route.ref && route.ref !== "HEAD") params.set("ref", route.ref);
      if (route.path) params.set("path", route.path);
      if (route.path && route.lines)
        params.set("lines", formatHistoryLineRange(route.lines));
      if (route.commit) params.set("commit", route.commit);
      if (route.compare) params.set("compare", route.compare);
      if (route.q) params.set("q", route.q);
      if (route.source) params.set("source", route.source);
      const qs = params.toString();
      return `/history${qs ? `?${qs}` : ""}`;
    }
    case "journal": {
      const params = new URLSearchParams();
      // "tasks" is the default tab, so only "journal" needs the explicit
      // param (inverted when the tasks board became the default view).
      if (route.tab && route.tab !== "tasks") params.set("tab", route.tab);
      if (route.date) params.set("date", route.date);
      if (route.label) params.set("label", route.label);
      if (route.task) params.set("task", route.task);
      const qs = params.toString();
      return `/journal${qs ? `?${qs}` : ""}`;
    }
    case "database": {
      const params = new URLSearchParams();
      if (route.db) params.set("db", route.db);
      if (route.schema) params.set("schema", route.schema);
      if (route.table) params.set("table", route.table);
      if (route.tab) params.set("tab", route.tab);
      if (route.diffBefore) params.set("diffBefore", route.diffBefore);
      if (route.diffAfter) params.set("diffAfter", route.diffAfter);
      const qs = params.toString();
      return `/database${qs ? `?${qs}` : ""}`;
    }
    case "unknown":
      return (
        "/todif?from=" +
        encodeURIComponent(route.range.from || "") +
        "&to=" +
        encodeURIComponent(route.range.to || "worktree")
      );
    default:
      return assertNever(route);
  }
}

export function buildRawFileUrl(target: SourceFileTarget): string {
  return (
    "/_file?path=" +
    encodeURIComponent(target.path) +
    "&ref=" +
    encodeURIComponent(target.ref || "worktree")
  );
}

// Doctor sheet is an overlay state independent of AppRoute.
// `?doctor=open` (or pathname `/doctor`) marks it open; any other state
// leaves it closed. The helper lets every screen carry the open flag
// without bloating each AppRoute variant.
export function parseDoctorOverlay(pathname: string, search: string): boolean {
  if (pathname === "/doctor") return true;
  const params = new URLSearchParams(search);
  return params.get("doctor") === "open";
}

// オーバーレイ系の状態は AppRoute とは独立した 1 個のクエリキーで表すので、
// 「そのキーだけ差し替えて他は素通しする」操作を共有する。
function withQueryParam(
  url: string,
  key: string,
  value: string | null,
): string {
  const queryIdx = url.indexOf("?");
  const base = queryIdx >= 0 ? url.slice(0, queryIdx) : url;
  const query = queryIdx >= 0 ? url.slice(queryIdx + 1) : "";
  const params = new URLSearchParams(query);
  if (value === null) params.delete(key);
  else params.set(key, value);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function withDoctorOverlay(url: string, open: boolean): string {
  return withQueryParam(url, "doctor", open ? "open" : null);
}

// Tools overlay is the same kind of AppRoute-independent state as the doctor
// sheet, except the query value also carries which tool is on screen
// (`?tools=markdown`). An unknown value counts as closed.
export function parseToolsOverlay(search: string): ToolId | null {
  const raw = new URLSearchParams(search).get("tools");
  return isToolId(raw) ? raw : null;
}

export function withToolsOverlay(url: string, tool: ToolId | null): string {
  return withQueryParam(url, "tools", tool);
}

/**
 * Terminal ドロワーの状態。tools と違い「開いているがまだ何も映していない」
 * があるので、映しているシェルの ID とは別に "open" を持つ。
 *
 * 映せるのはこのドロワーが開いたシェル (`shell-…`) だけ。tmux ペインは
 * シェルの中の tmux が見せているものなので、URL に載る識別子にはならない
 * (どのペインを見ているかは tmux 側の状態で、開き直すと変わりうる)。
 */
export type TerminalOverlayState = ShellSessionId | "open" | null;

// Terminal ドロワーも AppRoute から独立した 1 クエリキーで、値は映している
// シェル (`?terminal=shell-ab12`)。キーが在ってシェル ID の形でないものは
// 「開いているだけ」とみなす。閉じたシェルの ID が URL に残ることはあるが、
// 開いた時点で一覧と突き合わせるので、ここでは形だけ見る。tmux ペイン ID が
// 載った古い URL もこの経路で「開いているだけ」に落ちる。
export function parseTerminalOverlay(search: string): TerminalOverlayState {
  const raw = new URLSearchParams(search).get("terminal");
  if (raw === null) return null;
  if (isShellSessionId(raw)) return raw;
  return "open";
}

export function withTerminalOverlay(
  url: string,
  state: TerminalOverlayState,
): string {
  return withQueryParam(url, "terminal", state);
}

// Search results sheet (third tab of the bottom panel). The query key holds
// the grep query so a reload re-runs the same search; an empty value means
// "open, nothing searched yet". Same AppRoute-independent shape as ?tools=.
export function parseSearchResultsOverlay(search: string): string | null {
  return new URLSearchParams(search).get("results");
}

export function withSearchResultsOverlay(
  url: string,
  query: string | null,
): string {
  return withQueryParam(url, "results", query);
}
