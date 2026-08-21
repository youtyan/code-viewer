import { fuzzyMatchPath, globMatchPath, isGlobPathQuery } from "./fuzzy-search";

export function normalizeFileFilterQuery(
  value: string | null | undefined,
): string {
  return (value || "").toLowerCase().trim();
}

const TEST_FILE_PATH_RE = /(^|[/_.])(test|spec|__tests__)([/_.]|$)/i;

export function isTestFilePath(path: string): boolean {
  return TEST_FILE_PATH_RE.test(path);
}

// Sidebar filter syntax, cheapest reading first:
//   ""            -> every file
//   "/re/flags"   -> regular expression
//   "~text"       -> fuzzy subsequence (same matcher as the Ctrl+K palette)
//   "*.ts" "src/**" -> glob (same matcher as the palette)
//   anything else -> case-insensitive substring
export type CompiledFileFilter = {
  kind: "empty" | "substring" | "regex" | "fuzzy" | "glob" | "invalid";
  match: (path: string) => boolean;
  error?: string;
};

function parseSlashRegex(
  query: string,
): { source: string; flags: string } | null {
  if (!query.startsWith("/") || query.length < 2) return null;
  const lastSlash = query.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  return {
    source: query.slice(1, lastSlash),
    flags: query.slice(lastSlash + 1),
  };
}

export function compileFileFilter(
  value: string | null | undefined,
): CompiledFileFilter {
  const raw = (value || "").trim();
  if (!raw) return { kind: "empty", match: () => true };

  const slashRegex = parseSlashRegex(raw);
  if (slashRegex) {
    try {
      const regex = new RegExp(slashRegex.source, slashRegex.flags);
      return { kind: "regex", match: (path) => regex.test(path) };
    } catch (error) {
      return {
        kind: "invalid",
        match: () => false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (raw.startsWith("~")) {
    const needle = raw.slice(1).trim();
    if (!needle) return { kind: "empty", match: () => true };
    return { kind: "fuzzy", match: (path) => !!fuzzyMatchPath(needle, path) };
  }
  if (isGlobPathQuery(raw)) {
    return { kind: "glob", match: (path) => !!globMatchPath(raw, path) };
  }

  const q = normalizeFileFilterQuery(raw.startsWith("/") ? raw.slice(1) : raw);
  return {
    kind: "substring",
    match: (path) => path.toLowerCase().includes(q),
  };
}

export function filePathMatchesFilter(
  path: string,
  query: string | null | undefined,
): boolean {
  return compileFileFilter(query).match(path);
}
