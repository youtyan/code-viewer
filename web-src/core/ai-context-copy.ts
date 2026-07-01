import { summarizeDiffFileKinds } from "./diff-file-kinds";
import { fileReferenceClipboardText } from "./file-path-copy";
import type { AppRoute, SourceLineTarget } from "./routes";
import type { DiffMeta } from "./types";

// Selections at/above this size start to feel like "pasting a whole file"
// into an AI prompt - the pill/header copy UI flags them so a Shift+Click
// doesn't silently balloon the prompt. Shared by line-ref-pill and the
// global "Copy AI context" header button.
export const AI_CONTEXT_LARGE_SELECTION_LINE_THRESHOLD = 300;

export type AiContextSelectionTarget = {
  path: string;
  start: number;
  end: number;
};

// Code already read off the rendered page for the active selection (e.g. via
// line-ref-pill's readRenderedLines/langFromPath). Optional: when omitted or
// empty, the reference stays code-less.
export type AiContextSelectionCode = {
  lines: string[];
  lang?: string | null;
};

export type AiContextScreenSnapshot = {
  route: AppRoute;
  diffFrom: string;
  diffTo: string;
  selectionCode?: AiContextSelectionCode;
  diffMeta?: DiffMeta | null;
  viewedFiles?: ReadonlySet<string>;
};

function lineRange(line: SourceLineTarget): { start: number; end: number } {
  return typeof line === "number"
    ? { start: line, end: line }
    : { start: line.start, end: line.end };
}

// Resolves the path/start/end of the current line selection from the route,
// independent of whether rendered code for it is available. Callers (e.g.
// the copy-AI-context click handler) use this to decide whether a
// Shift+Click code lookup is worth attempting.
export function resolveSelectionTarget(
  route: AppRoute,
): AiContextSelectionTarget | null {
  const path =
    route.screen === "file" || route.screen === "diff" ? route.path : undefined;
  const line =
    route.screen === "file" || route.screen === "diff" ? route.line : undefined;
  if (!path || !line) return null;
  return { path, ...lineRange(line) };
}

// The path shown when there's no line selection to turn into "@path#range".
function activePath(route: AppRoute): string | undefined {
  if (route.screen === "file") return route.path;
  if (route.screen === "repo") return route.path || undefined;
  if (route.screen === "diff") return route.path;
  return undefined;
}

// "(commit: <sha>)" when viewing a specific past commit, else "(ref: <ref>)"
// when the ref isn't the live worktree/HEAD, else nothing. Only screens that
// declare `commit`/`ref` on their route are eligible (file/repo/history).
function commitOrRefSuffix(route: AppRoute): string {
  const commit = "commit" in route ? route.commit : undefined;
  if (commit) return ` (commit: ${commit})`;
  const ref = "ref" in route ? route.ref : undefined;
  if (ref && ref !== "worktree" && ref !== "HEAD") return ` (ref: ${ref})`;
  return "";
}

// "@path#start-end" (or "@path" without a selection), with a commit/ref
// suffix when relevant. Shift+Click code appends a fenced block after it.
function referenceLine(
  route: AppRoute,
  code: AiContextSelectionCode | undefined,
): string {
  const target = resolveSelectionTarget(route);
  const path = target?.path ?? activePath(route);
  if (!path) return "";
  const suffix = commitOrRefSuffix(route);
  if (!target) return `@${path}${suffix}`;
  const ref = fileReferenceClipboardText(target.path, target.start, target.end);
  const withSuffix = `${ref}${suffix}`;
  const lines = code?.lines ?? [];
  if (lines.length === 0) return withSuffix;
  const lang = (code?.lang || "").trim();
  return `${withSuffix}\n\n\`\`\`${lang}\n${lines.join("\n")}\n\`\`\``;
}

function historyLine(route: Extract<AppRoute, { screen: "history" }>): string {
  if (!route.commit) return "";
  const ref =
    route.ref && route.ref !== "worktree" && route.ref !== "HEAD"
      ? ` (ref: ${route.ref})`
      : "";
  return `commit: ${route.commit}${ref}`;
}

function databaseLine(
  route: Extract<AppRoute, { screen: "database" }>,
): string {
  const parts: string[] = [];
  if (route.db) parts.push(`db=${route.db}`);
  if (route.schema) parts.push(`schema=${route.schema}`);
  if (route.table) parts.push(`table=${route.table}`);
  if (route.tab) parts.push(`tab=${route.tab}`);
  if (route.diffBefore && route.diffAfter) {
    parts.push(`snapshot=${route.diffBefore}..${route.diffAfter}`);
  }
  return parts.length > 0 ? `database: ${parts.join(", ")}` : "";
}

// A one-line "AI review brief" for the diff overview: range + totals + kind
// counts (added/deleted/renamed/heavy/binary/media). Counts only - no file
// paths or code, so it stays cheap to paste even on large diffs.
function diffOverviewLine(
  from: string,
  to: string,
  meta: DiffMeta | null | undefined,
  viewedFiles?: ReadonlySet<string>,
): string {
  const base = `Diff: ${from}..${to}`;
  if (!meta?.totals) return base;
  const parts = [
    `${meta.totals.files} file${meta.totals.files === 1 ? "" : "s"}`,
    `+${meta.totals.additions}/-${meta.totals.deletions}`,
  ];
  const viewedTotal = meta.files.length;
  if (viewedFiles && viewedTotal > 0) {
    const viewed = meta.files.filter((file) =>
      viewedFiles.has(file.path),
    ).length;
    parts.push(`${viewed}/${viewedTotal} viewed`);
  }
  const kinds = summarizeDiffFileKinds(meta.files);
  const kindParts: string[] = [];
  if (kinds.added) kindParts.push(`${kinds.added} added`);
  if (kinds.deleted) kindParts.push(`${kinds.deleted} deleted`);
  if (kinds.renamed) kindParts.push(`${kinds.renamed} renamed`);
  if (kinds.heavy) kindParts.push(`${kinds.heavy} heavy`);
  if (kinds.binary) kindParts.push(`${kinds.binary} binary`);
  if (kinds.media) kindParts.push(`${kinds.media} media`);
  if (kindParts.length > 0) parts.push(kindParts.join(", "));
  return `${base} (${parts.join(", ")})`;
}

// A short, pasteable reference for the current screen, close to what the
// line-ref-pill already copies ("@path#start-end"), not a screen-state dump.
// No heading, no URL, no absolute paths, env vars, cookies, local storage,
// or fetched data.
export function aiContextClipboardText(
  snapshot: AiContextScreenSnapshot,
): string {
  const { route } = snapshot;
  if (route.screen === "database") return databaseLine(route);
  if (route.screen === "history") return historyLine(route);
  if (route.screen === "diff" && !route.path) {
    return diffOverviewLine(
      snapshot.diffFrom,
      snapshot.diffTo,
      snapshot.diffMeta,
      snapshot.viewedFiles,
    );
  }
  return referenceLine(route, snapshot.selectionCode);
}
