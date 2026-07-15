const GLOB_CHARS = /[*?[\]]/;

type GlobMatcher =
  | { kind: "literal"; ch: string }
  | { kind: "any" }
  | { kind: "class"; body: string; negate: boolean }
  | { kind: "star" };

// gitignore-style single-segment wildcard: `*`, `?`, `[abc]`, `[!abc]`,
// `[a-z]`. No `/`-anchoring or `**` since these settings only ever match a
// single path segment (the UI rejects `/` in the input).
function parseGlobSegment(pattern: string): GlobMatcher[] {
  const matchers: GlobMatcher[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      matchers.push({ kind: "star" });
    } else if (ch === "?") {
      matchers.push({ kind: "any" });
    } else if (ch === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        matchers.push({ kind: "literal", ch: "[" });
        continue;
      }
      const rawBody = pattern.slice(i + 1, close);
      const negate = rawBody.startsWith("!");
      matchers.push({
        kind: "class",
        body: negate ? rawBody.slice(1) : rawBody,
        negate,
      });
      i = close;
    } else {
      matchers.push({ kind: "literal", ch });
    }
  }
  return matchers;
}

function charInClassBody(ch: string, body: string): boolean {
  for (let i = 0; i < body.length; ) {
    if (body[i + 1] === "-" && i + 2 < body.length) {
      if (ch >= body[i] && ch <= body[i + 2]) return true;
      i += 3;
    } else {
      if (ch === body[i]) return true;
      i += 1;
    }
  }
  return false;
}

function matchesAt(matcher: GlobMatcher, ch: string): boolean {
  switch (matcher.kind) {
    case "literal":
      return matcher.ch === ch;
    case "any":
      return true;
    case "class":
      return charInClassBody(ch, matcher.body) !== matcher.negate;
    case "star":
      return false;
  }
}

// Linear two-pointer wildcard match (the same technique fnmatch-style glob
// matchers use), bounded to O(pattern length * name length). Compiling
// `*` into backtracking `.*` RegExp source (as this file used to) is
// vulnerable to catastrophic backtracking: a pattern with several `*`
// separated by literals (e.g. "*a*a*a*a*a*a*a*a*a*ab") can make the native
// regex engine take seconds to minutes against an adversarial name, even
// though both stay well within scopeOmitDirs/scopeExcludeNames' per-item
// length limits. Walking the matcher list by hand avoids that entirely.
function matchGlobSegment(matchers: GlobMatcher[], name: string): boolean {
  let mi = 0;
  let ni = 0;
  let starMi = -1;
  let starNi = -1;
  while (ni < name.length) {
    const matcher = matchers[mi];
    if (matcher && matcher.kind === "star") {
      starMi = mi;
      starNi = ni;
      mi++;
    } else if (matcher && matchesAt(matcher, name[ni])) {
      mi++;
      ni++;
    } else if (starMi !== -1) {
      mi = starMi + 1;
      starNi++;
      ni = starNi;
    } else {
      return false;
    }
  }
  while (matchers[mi]?.kind === "star") mi++;
  return mi === matchers.length;
}

export type NamePatternSet = {
  matches(name: string): boolean;
};

export function compileNamePatterns(patterns: string[]): NamePatternSet {
  const literals = new Set<string>();
  const globs: GlobMatcher[][] = [];
  for (const pattern of patterns) {
    const lower = pattern.toLowerCase();
    if (GLOB_CHARS.test(lower)) {
      globs.push(parseGlobSegment(lower));
    } else {
      literals.add(lower);
    }
  }
  return {
    matches(name: string): boolean {
      const lower = name.toLowerCase();
      return (
        literals.has(lower) ||
        globs.some((matchers) => matchGlobSegment(matchers, lower))
      );
    },
  };
}
