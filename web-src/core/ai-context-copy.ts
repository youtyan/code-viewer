import { fileReferenceWithCodeClipboardText } from "./file-path-copy";
import type { AppRoute, SourceLineTarget } from "./routes";

export type AiContextSelectionTarget = {
  path: string;
  start: number;
  end: number;
};

// Code already read off the rendered page for the active selection (e.g. via
// line-ref-pill's readRenderedLines/langFromPath). Optional — when omitted or
// empty, the selection line degrades to a ref-only reference.
export type AiContextSelectionCode = {
  lines: string[];
  lang?: string | null;
};

export type AiContextScreenSnapshot = {
  route: AppRoute;
  pathname: string;
  search: string;
  diffFrom: string;
  diffTo: string;
  selectionCode?: AiContextSelectionCode;
};

function activeFileLine(route: AppRoute): string {
  if (route.screen === "file") {
    const view = route.view || "detail";
    return `- file: ${route.path} (ref: ${route.ref}, view: ${view})`;
  }
  if (route.screen === "repo" && route.path) {
    return `- file: ${route.path} (ref: ${route.ref})`;
  }
  if (route.screen === "diff" && route.path) {
    return `- file: ${route.path}`;
  }
  return "";
}

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

function selectionLine(
  route: AppRoute,
  code: AiContextSelectionCode | undefined,
): string {
  const target = resolveSelectionTarget(route);
  if (!target) return "";
  const ref = fileReferenceWithCodeClipboardText(
    target.path,
    target.start,
    target.end,
    code?.lines ?? [],
    code?.lang,
  );
  return ref ? `- selection: ${ref}` : "";
}

// Short Markdown summary of the current screen, safe to paste into an AI
// chat. Carries only route/URL state already visible in the browser bar —
// no absolute paths, env vars, cookies, local storage, or fetched data.
// `selectionCode`, when provided with non-empty lines, appends the rendered
// code for the active selection as a fenced block (Shift+Click path);
// otherwise the selection stays a short "@path#start-end" reference.
export function aiContextClipboardText(
  snapshot: AiContextScreenSnapshot,
): string {
  const lines = [
    "## code-viewer screen context",
    "",
    `- view: ${snapshot.route.screen}`,
    `- url: ${snapshot.pathname}${snapshot.search}`,
    `- diff range: ${snapshot.diffFrom}..${snapshot.diffTo}`,
  ];
  const file = activeFileLine(snapshot.route);
  if (file) lines.push(file);
  const selection = selectionLine(snapshot.route, snapshot.selectionCode);
  if (selection) lines.push(selection);
  return lines.join("\n");
}
