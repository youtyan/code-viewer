export function normalizeNewDirectoryName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 180) return null;
  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    Array.from(trimmed).some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return null;
  if (trimmed === "." || trimmed === ".." || trimmed.toLowerCase() === ".git")
    return null;
  return trimmed;
}
