function visiblePathCharacter(character: string): string {
  if (character === "\n") return "\\n";
  if (character === "\r") return "\\r";
  if (character === "\t") return "\\t";
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return "";
  return `\\u{${codePoint.toString(16).toUpperCase().padStart(4, "0")}}`;
}

const INVISIBLE_PATH_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

/**
 * Make path characters that can alter or hide the visible label explicit.
 * Ordinary paths are returned unchanged; once a path needs escaping, its
 * backslashes are doubled too so the escaped form cannot be confused with a
 * literal "\n" in the name.
 */
export function filePathDisplayText(path: string | null | undefined): string {
  if (!path) return "";
  if (!INVISIBLE_PATH_CHARACTERS.test(path)) return path;
  return path
    .replace(/\\/g, "\\\\")
    .replace(/[\p{Cc}\p{Cf}]/gu, visiblePathCharacter);
}

/** True when the visible label differs from the raw path. */
export function filePathNeedsEscaping(
  path: string | null | undefined,
): boolean {
  return !!path && INVISIBLE_PATH_CHARACTERS.test(path);
}

export function filePathClipboardText(path: string | null | undefined): string {
  return filePathDisplayText(path);
}

export function fileNameClipboardText(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return filePathDisplayText(parts[parts.length - 1] || "");
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
  const visiblePath = filePathDisplayText(path);
  return a === b ? `@${visiblePath}#${a}` : `@${visiblePath}#${a}-${b}`;
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
