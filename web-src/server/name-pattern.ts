const GLOB_CHARS = /[*?[\]]/;
const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/;

function escapeRegExpChar(ch: string): string {
  return REGEXP_SPECIAL.test(ch) ? `\\${ch}` : ch;
}

// gitignore-style single-segment wildcard: `*`, `?`, `[abc]`, `[!abc]`,
// `[a-z]`. No `/`-anchoring or `**` since these settings only ever match a
// single path segment (the UI rejects `/` in the input).
function globSegmentToRegExp(pattern: string): RegExp | null {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      source += ".*";
    } else if (ch === "?") {
      source += ".";
    } else if (ch === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        source += "\\[";
        continue;
      }
      const body = pattern.slice(i + 1, close);
      source += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
      i = close;
    } else {
      source += escapeRegExpChar(ch);
    }
  }
  try {
    return new RegExp(`^${source}$`);
  } catch {
    return null;
  }
}

export type NamePatternSet = {
  matches(name: string): boolean;
};

export function compileNamePatterns(patterns: string[]): NamePatternSet {
  const literals = new Set<string>();
  const regexes: RegExp[] = [];
  for (const pattern of patterns) {
    const lower = pattern.toLowerCase();
    if (GLOB_CHARS.test(lower)) {
      const regex = globSegmentToRegExp(lower);
      if (regex) regexes.push(regex);
    } else {
      literals.add(lower);
    }
  }
  return {
    matches(name: string): boolean {
      const lower = name.toLowerCase();
      return literals.has(lower) || regexes.some((regex) => regex.test(lower));
    },
  };
}
