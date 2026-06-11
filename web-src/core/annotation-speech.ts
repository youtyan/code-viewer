// Converts annotation markdown into plain text suitable for TTS, and
// estimates how long a muted auto-advance should display each entry.

const MS_PER_CHAR = 150;
const MIN_DISPLAY_MS = 3000;

export function annotationSpeechText(body: string): string {
  let text = body;
  // Fenced code blocks are dropped entirely; code is visible on screen.
  text = text.replace(/```[\s\S]*?```/g, " ");
  // Unterminated fence: drop everything after the opening fence.
  text = text.replace(/```[\s\S]*$/g, " ");
  // Links keep their label only.
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Inline code keeps its content.
  text = text.replace(/`([^`]*)`/g, "$1");
  // Headings, blockquotes, list markers at line starts.
  text = text.replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, "");
  // Emphasis markers.
  text = text.replace(/(\*\*|__|\*|_)/g, "");
  // Collapse whitespace.
  return text.replace(/\s+/g, " ").trim();
}

export function annotationDisplayMs(text: string): number {
  return Math.max(MIN_DISPLAY_MS, text.length * MS_PER_CHAR);
}
