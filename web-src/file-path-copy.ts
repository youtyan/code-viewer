export function filePathClipboardText(path: string | null | undefined): string {
  return path || "";
}

export function fileNameClipboardText(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}
