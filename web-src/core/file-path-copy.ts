export function filePathClipboardText(path: string | null | undefined): string {
  return path || "";
}

export function fileNameClipboardText(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

// "@path#start-end" reference, pasteable into Claude Code / Codex prompts.
export function fileReferenceClipboardText(
  path: string | null | undefined,
  start: number,
  end: number,
): string {
  if (!path) return "";
  const a = Math.max(1, Math.floor(Math.min(start, end)));
  const b = Math.max(1, Math.floor(Math.max(start, end)));
  return a === b ? `@${path}#${a}` : `@${path}#${a}-${b}`;
}

// "@path#start-end" + fenced code block carrying the actual lines. Used by
// the line-ref pill's shift+click path so an AI can reason about the code
// without having to re-fetch the file. Empty `lines` collapses back to the
// ref-only output so callers can degrade silently when the DOM source is
// not rendered.
export function fileReferenceWithCodeClipboardText(
  path: string | null | undefined,
  start: number,
  end: number,
  lines: string[],
  lang?: string | null,
): string {
  const ref = fileReferenceClipboardText(path, start, end);
  if (!ref) return "";
  if (!lines || lines.length === 0) return ref;
  const fence = (lang || "").trim();
  return `${ref}\n\n\`\`\`${fence}\n${lines.join("\n")}\n\`\`\``;
}
