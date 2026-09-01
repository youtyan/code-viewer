// WORD_CHAR_RE intentionally excludes `$` because it also defines the server's
// whole-word behavior. In v1, clicking `$sampleValue` extracts `sampleValue`;
// PHP declarations still match through their explicit `$` definition pattern.

import { isTestFilePath } from "./file-filter";
import type { GrepMatch } from "./types";
import { WORD_CHAR_RE } from "./word-boundary";

export type DefinitionLang =
  | "js"
  | "python"
  | "go"
  | "rust"
  | "ruby"
  | "java"
  | "kotlin"
  | "swift"
  | "c"
  | "csharp"
  | "php"
  | "shell";

type Vocab = {
  sp: string;
  bL: string;
  bR: string;
};

type PatternTemplate = (symbol: string, vocab: Vocab) => string;

export type DefinitionQuery = {
  pattern: string;
  classifiers: RegExp[];
};

export type DefinitionCandidate = GrepMatch & {
  score: number;
  patternIndex: number;
};

const ENGINE_VOCAB: Vocab = {
  sp: "[[:blank:]]",
  bL: "(^|[^A-Za-z0-9_])",
  bR: "([^A-Za-z0-9_]|$)",
};

const JS_VOCAB: Vocab = {
  sp: "[ \\t]",
  bL: "(^|[^A-Za-z0-9_])",
  bR: "([^A-Za-z0-9_]|$)",
};

// Engine patterns are passed unchanged to both rg's Rust regex parser and
// git grep -E. Keep them to their common subset: POSIX character classes,
// capturing groups, and explicit boundaries. Do not use \b, \s, \w,
// non-capturing groups, lookaround, backreferences, lazy quantifiers, a
// backslash inside a bracket expression, or a raw `[` inside one. Special
// bracket characters belong in an outside alternation such as `(\(|\[)`.
const PATTERNS: Record<DefinitionLang | "generic", PatternTemplate[]> = {
  js: [
    (s, v) => `${v.bL}function[*]?${v.sp}+${s}${v.sp}*(\\(|<)`,
    (s, v) => `${v.bL}(class|interface|enum|namespace|type)${v.sp}+${s}${v.bR}`,
    (s, v) => `${v.bL}(const|let|var)${v.sp}+${s}${v.bR}`,
    (s, v) => `${v.bL}(get|set|async)${v.sp}+${s}${v.sp}*\\(`,
    (s, v) => `${v.bL}${s}${v.sp}*(:|=)${v.sp}*(async${v.sp}+)?(\\(|function)`,
  ],
  python: [
    (s, v) => `${v.bL}def${v.sp}+${s}${v.sp}*\\(`,
    (s, v) => `${v.bL}class${v.sp}+${s}${v.sp}*(:|\\()`,
    (s, v) => `^${v.sp}*${s}${v.sp}*(:[^=]+)?=[^=]`,
  ],
  go: [
    (s, v) => `func${v.sp}+${s}${v.sp}*(\\(|\\[)`,
    (s, v) => `func${v.sp}*\\([^)]*\\)${v.sp}*${s}${v.sp}*\\(`,
    (s, v) => `${v.bL}(type|var|const)${v.sp}+${s}${v.bR}`,
    (s, v) => `${v.bL}${s}${v.sp}*:=`,
  ],
  rust: [
    (s, v) => `${v.bL}(fn|struct|enum|trait|union|type|mod)${v.sp}+${s}${v.bR}`,
    (s, v) => `macro_rules!${v.sp}*${s}${v.bR}`,
    (s, v) => `${v.bL}(let|const|static)(${v.sp}+mut)?${v.sp}+${s}${v.bR}`,
  ],
  ruby: [
    (s, v) => `${v.bL}def${v.sp}+(self\\.)?${s}${v.bR}`,
    (s, v) => `${v.bL}(class|module)${v.sp}+${s}${v.bR}`,
    (s, v) => `^${v.sp}*${s}${v.sp}*=[^=]`,
    (s, v) =>
      `${v.bL}(define_method|attr_accessor|attr_reader|attr_writer|scope)${v.sp}*(\\(|${v.sp})${v.sp}*:${s}${v.bR}`,
  ],
  java: [
    (s, v) => `${v.bL}(class|interface|enum|record)${v.sp}+${s}${v.bR}`,
    (s, v) => `${s}${v.sp}*\\([^)]*\\)${v.sp}*(\\{|throws)`,
    (s, v) => `([A-Za-z0-9_<>,]|\\[|\\])${v.sp}+${s}${v.sp}*(=|;)`,
  ],
  kotlin: [
    (s, v) =>
      `${v.bL}(fun|val|var|class|interface|object|typealias)${v.sp}+(<[^>]*>${v.sp}+)?${s}${v.bR}`,
  ],
  swift: [
    (s, v) =>
      `${v.bL}(func|class|struct|enum|protocol|extension|let|var|typealias|actor)${v.sp}+${s}${v.bR}`,
  ],
  c: [
    (s, v) => `#${v.sp}*define${v.sp}+${s}${v.bR}`,
    (s, v) => `${v.bL}(struct|union|enum|class)${v.sp}+${s}${v.bR}`,
    (s, v) => `${v.bL}typedef${v.sp}+[^;]*(${v.sp}|\\*)${s}${v.sp}*;`,
    (s, v) => `^[A-Za-z_][^;{}=]*(${v.sp}|\\*|&)${s}${v.sp}*\\(`,
  ],
  csharp: [
    (s, v) =>
      `${v.bL}(class|interface|struct|enum|record|delegate|event)${v.sp}+${s}${v.bR}`,
    (s, v) => `${s}${v.sp}*\\([^)]*\\)${v.sp}*\\{`,
    (s, v) => `${s}${v.sp}*\\{${v.sp}*(get|set)`,
  ],
  php: [
    (s, v) => `function${v.sp}+&?${s}${v.sp}*\\(`,
    (s, v) => `${v.bL}(class|interface|trait)${v.sp}+${s}${v.bR}`,
    (s, v) => `\\$${s}${v.sp}*=[^=]`,
    (s, v) => `${v.bL}const${v.sp}+${s}${v.bR}`,
    (s, v) => `define${v.sp}*\\(${v.sp}*('|")${s}`,
  ],
  shell: [
    (s, v) => `${v.bL}function${v.sp}+${s}${v.bR}`,
    (s, v) => `^${v.sp}*${s}${v.sp}*\\(${v.sp}*\\)`,
    (s, v) => `^${v.sp}*${s}=`,
  ],
  generic: [
    (s, v) =>
      `${v.bL}(def|function|fn|func|class|module|interface|trait|struct|enum|type|let|const|var|val)${v.sp}+${s}${v.bR}`,
    (s, v) => `^${v.sp}*${s}${v.sp}*(:|=)([^=]|$)`,
  ],
};

const LANG_FAMILY_GLOBS: Record<DefinitionLang, string[]> = {
  js: ["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs"],
  python: ["*.py"],
  go: ["*.go"],
  rust: ["*.rs"],
  ruby: ["*.rb"],
  java: ["*.java"],
  kotlin: ["*.kt", "*.kts"],
  swift: ["*.swift"],
  c: ["*.c", "*.h", "*.cc", "*.cpp", "*.hpp", "*.cxx", "*.hxx"],
  csharp: ["*.cs"],
  php: ["*.php"],
  shell: ["*.sh", "*.bash", "*.zsh"],
};

function wordSet(words: string): ReadonlySet<string> {
  return new Set(words.split(" "));
}

const COMMON_RESERVED = wordSet(
  "break case catch continue default else false finally for if import new null return switch throw true try while with yield",
);

const LANG_RESERVED: Record<DefinitionLang, ReadonlySet<string>> = {
  js: wordSet(
    "async await class const debugger delete do enum export extends function get implements in instanceof interface let namespace of private protected public readonly set static super this typeof undefined var void",
  ),
  python: wordSet(
    "False None True and as assert async await class def del elif except from global in is lambda nonlocal not or pass raise",
  ),
  go: wordSet(
    "chan const defer fallthrough func go goto interface map package range select struct type var",
  ),
  rust: wordSet(
    "Self as async await become box const crate dyn enum extern fn impl in let loop macro match mod move mut override priv pub ref self static struct super trait type typeof union unsafe use virtual where",
  ),
  ruby: wordSet(
    "BEGIN END alias begin class def defined do elsif end ensure module next nil not or redo rescue retry self then undef unless until when",
  ),
  java: wordSet(
    "abstract assert boolean byte char class double enum extends final float implements int interface long native package private protected public short static strictfp super synchronized this throws transient void volatile",
  ),
  kotlin: wordSet(
    "actual annotation by class companion constructor crossinline data dynamic expect external field file final fun get import infix init inline inner internal lateinit noinline object open operator out override private property protected public reified sealed set suspend tailrec typealias vararg",
  ),
  swift: wordSet(
    "Any as associatedtype class deinit enum extension fileprivate func guard inout internal is let mutating nonmutating open operator precedencegroup private protocol public repeat required rethrows some static struct subscript typealias unowned var weak where",
  ),
  c: wordSet(
    "alignas alignof auto char const double enum extern float inline int long register restrict short signed sizeof static struct typedef union unsigned void volatile",
  ),
  csharp: wordSet(
    "abstract as base bool byte checked class decimal delegate double event explicit extern fixed float implicit int interface internal is lock long namespace object operator out override params private protected public readonly ref sbyte sealed short sizeof stackalloc static string struct this uint ulong unchecked unsafe ushort using virtual void",
  ),
  php: wordSet(
    "abstract and array as callable class clone const declare echo elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final fn function global goto implements include include_once instanceof insteadof interface isset list match namespace or print private protected public readonly require require_once static trait unset use xor",
  ),
  shell: wordSet(
    "case do done elif esac fi function in local select then time until",
  ),
};

const SLASH_COMMENT_LANGS = new Set<DefinitionLang>([
  "js",
  "go",
  "rust",
  "java",
  "kotlin",
  "swift",
  "c",
  "csharp",
  "php",
]);

const HASH_COMMENT_LANGS = new Set<DefinitionLang>(["python", "ruby", "shell"]);

export function definitionLangOf(
  inferredLang: string | null,
): DefinitionLang | null {
  switch (inferredLang) {
    case "typescript":
    case "javascript":
      return "js";
    case "python":
    case "go":
    case "rust":
    case "ruby":
    case "java":
    case "kotlin":
    case "swift":
    case "csharp":
    case "php":
      return inferredLang;
    case "c":
    case "cpp":
      return "c";
    case "bash":
      return "shell";
    default:
      return null;
  }
}

export function escapeRegexLiteral(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function buildDefinitionQuery(
  lang: DefinitionLang | null,
  symbol: string,
): DefinitionQuery {
  const escaped = escapeRegexLiteral(symbol);
  const templates = PATTERNS[lang ?? "generic"];
  return {
    pattern: templates
      .map((template) => template(escaped, ENGINE_VOCAB))
      .join("|"),
    classifiers: templates.map(
      (template) => new RegExp(template(escaped, JS_VOCAB)),
    ),
  };
}

export function isJumpableSymbol(
  word: string,
  lang: DefinitionLang | null,
): boolean {
  const chars = Array.from(word);
  if (chars.length === 0 || /\p{N}/u.test(chars[0])) return false;
  if (chars.some((char) => !WORD_CHAR_RE.test(char))) return false;
  return !COMMON_RESERVED.has(word) && !(lang && LANG_RESERVED[lang].has(word));
}

function definitionLangForPath(path: string): DefinitionLang | null {
  const lower = path.toLowerCase();
  for (const [lang, globs] of Object.entries(LANG_FAMILY_GLOBS) as Array<
    [DefinitionLang, string[]]
  >) {
    if (globs.some((glob) => lower.endsWith(glob.slice(1)))) return lang;
  }
  return null;
}

function isCommentLine(path: string, preview: string): boolean {
  const lang = definitionLangForPath(path);
  const trimmed = preview.trimStart();
  if (lang && SLASH_COMMENT_LANGS.has(lang)) {
    return (
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*")
    );
  }
  return !!lang && HASH_COMMENT_LANGS.has(lang) && trimmed.startsWith("#");
}

function commonDirectoryDepth(leftPath: string, rightPath: string): number {
  const left = leftPath.split("/").slice(0, -1);
  const right = rightPath.split("/").slice(0, -1);
  let depth = 0;
  while (depth < left.length && left[depth] === right[depth]) depth++;
  return depth;
}

function candidateScore(
  match: GrepMatch,
  patternIndex: number,
  currentPath: string,
  patternCount: number,
): number {
  const patternPriority = (patternCount - patternIndex) * 1000;
  const sameFile = match.path === currentPath ? 300 : 0;
  const commonPath = commonDirectoryDepth(match.path, currentPath) * 20;
  const testPenalty = isTestFilePath(match.path) ? 200 : 0;
  const pathDepth = match.path.split("/").filter(Boolean).length;
  return patternPriority + sameFile + commonPath - testPenalty - pathDepth;
}

export function rankDefinitionMatches(
  matches: GrepMatch[],
  ctx: {
    symbol: string;
    currentPath: string;
    currentLine: number | null;
    lang: DefinitionLang | null;
  },
  classifiers: RegExp[],
): DefinitionCandidate[] {
  const candidates: DefinitionCandidate[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    if (ctx.lang !== null && definitionLangForPath(match.path) !== ctx.lang) {
      continue;
    }
    if (isCommentLine(match.path, match.preview)) continue;
    const patternIndex = classifiers.findIndex((classifier) =>
      classifier.test(match.preview),
    );
    if (patternIndex < 0) continue;
    if (match.path === ctx.currentPath && match.line === ctx.currentLine) {
      continue;
    }
    const key = `${match.path}\0${match.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      ...match,
      patternIndex,
      score: candidateScore(
        match,
        patternIndex,
        ctx.currentPath,
        classifiers.length,
      ),
    });
  }

  return candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.path.localeCompare(right.path) ||
      left.line - right.line,
  );
}
