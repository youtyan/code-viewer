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
