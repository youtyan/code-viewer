// Minimal HTML element-content escaper: handles & < > so the result is safe
// to interpolate into innerHTML element-text contexts. Attribute contexts
// require additional escaping of the surrounding quote character — use
// textContent / setAttribute when that matters instead of expanding this.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
