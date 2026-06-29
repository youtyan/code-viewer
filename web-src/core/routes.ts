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
      virtual?: "off";
    }
  | { screen: "help"; range: DiffRange; lang: string; section: string }
  | { screen: "history"; ref: string; commit?: string; range: DiffRange }
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
  "/database",
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

function parseLineTarget(
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
      if (rawView === "blob") {
        return {
          screen: "file",
          path,
          ref,
          range,
          view: "blob",
          ...(preview ? { preview: true as const } : {}),
          ...(line ? { line } : {}),
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
    case "/doctor":
      return {
        screen: "repo",
        ref: params.get("ref") || params.get("target") || "worktree",
        path: params.get("path") || "",
        range,
      };
    case "/history": {
      const commit = params.get("commit") || "";
      return {
        screen: "history",
        ref: params.get("ref") || "HEAD",
        ...(commit ? { commit } : {}),
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
      if (route.commit) params.set("commit", route.commit);
      const qs = params.toString();
      return `/history${qs ? `?${qs}` : ""}`;
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

export function withDoctorOverlay(url: string, open: boolean): string {
  const queryIdx = url.indexOf("?");
  const base = queryIdx >= 0 ? url.slice(0, queryIdx) : url;
  const query = queryIdx >= 0 ? url.slice(queryIdx + 1) : "";
  const params = new URLSearchParams(query);
  if (open) params.set("doctor", "open");
  else params.delete("doctor");
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
