import { describe, expect, test } from "vitest";
import {
  buildDefinitionQuery,
  type DefinitionLang,
  definitionLangOf,
  escapeRegexLiteral,
  isJumpableSymbol,
  rankDefinitionMatches,
} from "../core/definition-search";
import type { GrepMatch } from "../core/types";

const ALL_LANGS: Array<DefinitionLang | null> = [
  "js",
  "python",
  "go",
  "rust",
  "ruby",
  "java",
  "kotlin",
  "swift",
  "c",
  "csharp",
  "php",
  "shell",
  null,
];

const PATHS: Record<DefinitionLang | "generic", string> = {
  js: "src/sample.ts",
  python: "src/sample.py",
  go: "src/sample.go",
  rust: "src/sample.rs",
  ruby: "src/sample.rb",
  java: "src/Sample.java",
  kotlin: "src/sample.kt",
  swift: "src/sample.swift",
  c: "src/sample.c",
  csharp: "src/Sample.cs",
  php: "src/sample.php",
  shell: "src/sample.sh",
  generic: "src/sample.txt",
};

type ClassificationCase = [DefinitionLang | null, string, number | null];
const CLASSIFICATION_CASES: ClassificationCase[] = [
  ["js", "function sampleThing() {}", 0],
  ["js", "class sampleThing {}", 1],
  ["js", "const sampleThing = 1;", 2],
  ["js", "async sampleThing() {}", 3],
  ["js", "sampleThing = async () => {};", 4],
  ["js", "sampleThing();", null],
  ["js", "// function sampleThing() {}", null],
  ["js", "  /* class sampleThing {}", null],
  ["js", " * function sampleThing() {}", null],
  ["python", "def sampleThing():", 0],
  ["python", "class sampleThing:", 1],
  ["python", "sampleThing: int = 1", 2],
  ["python", "sampleThing()", null],
  ["python", "# def sampleThing():", null],
  ["go", "func sampleThing() {}", 0],
  ["go", "func sampleThing[T any]() {}", 0],
  ["go", "func (sample Receiver) sampleThing() {}", 1],
  ["go", "type sampleThing struct {}", 2],
  ["go", "sampleThing := 1", 3],
  ["go", "sampleThing()", null],
  ["go", "// func sampleThing() {}", null],
  ["rust", "fn sampleThing() {}", 0],
  ["rust", "struct sampleThing {}", 0],
  ["rust", "macro_rules! sampleThing {}", 1],
  ["rust", "let mut sampleThing = 1;", 2],
  ["rust", "sampleThing();", null],
  ["rust", "// fn sampleThing() {}", null],
  ["ruby", "def sampleThing", 0],
  ["ruby", "class sampleThing", 1],
  ["ruby", "sampleThing = 1", 2],
  ["ruby", "define_method(:sampleThing)", 3],
  ["ruby", "sampleThing()", null],
  ["ruby", "# def sampleThing", null],
  ["java", "class sampleThing {}", 0],
  ["java", "void sampleThing() {", 1],
  ["java", "String[] sampleThing;", 2],
  ["java", "sampleThing();", null],
  ["java", "// class sampleThing {}", null],
  ["kotlin", "fun sampleThing() = 1", 0],
  ["kotlin", "class sampleThing", 0],
  ["kotlin", "val sampleThing = 1", 0],
  ["kotlin", "sampleThing()", null],
  ["kotlin", "// fun sampleThing() = 1", null],
  ["swift", "func sampleThing() {}", 0],
  ["swift", "struct sampleThing {}", 0],
  ["swift", "let sampleThing = 1", 0],
  ["swift", "sampleThing()", null],
  ["swift", "// func sampleThing() {}", null],
  ["c", "#define sampleThing 1", 0],
  ["c", "struct sampleThing {", 1],
  ["c", "typedef unsigned long sampleThing;", 2],
  ["c", "int *sampleThing(void) {", 3],
  ["c", "sampleThing();", null],
  ["c", "// int sampleThing(void) {", null],
  ["csharp", "class sampleThing {", 0],
  ["csharp", "void sampleThing() {", 1],
  ["csharp", "int sampleThing { get; set; }", 2],
  ["csharp", "sampleThing();", null],
  ["csharp", "// void sampleThing() {", null],
  ["php", "function &sampleThing() {", 0],
  ["php", "class sampleThing {", 1],
  ["php", "$sampleThing = 1;", 2],
  ["php", "const sampleThing = 1;", 3],
  ["php", "define('sampleThing', 1);", 4],
  ["php", "$value = sampleThing();", null],
  ["php", "// function sampleThing() {", null],
  ["shell", "function sampleThing {", 0],
  ["shell", "sampleThing() {", 1],
  ["shell", "sampleThing=value", 2],
  ["shell", "sampleThing", null],
  ["shell", "# function sampleThing", null],
  [null, "function sampleThing()", 0],
  [null, "sampleThing = 1", 1],
  [null, "sampleThing()", null],
];

function match(path: string, line: number, preview: string): GrepMatch {
  return { path, line, column: 1, preview };
}

function ordinaryBracketBodies(pattern: string): string[] {
  const bodies: string[] = [];
  for (let index = 0; index < pattern.length; ) {
    if (pattern[index] === "\\") {
      index += 2;
    } else if (pattern[index] !== "[") {
      index++;
    } else if (pattern.startsWith("[[:", index)) {
      const end = pattern.indexOf(":]]", index + 3);
      if (end < 0) throw new Error(`unclosed POSIX class in ${pattern}`);
      index = end + 3;
    } else {
      const end = pattern.indexOf("]", index + 1);
      if (end < 0) throw new Error(`unclosed bracket expression in ${pattern}`);
      bodies.push(pattern.slice(index + 1, end));
      index = end + 1;
    }
  }
  return bodies;
}

describe("definition patterns", () => {
  test.each(
    CLASSIFICATION_CASES,
  )("classifies %s line %s", (lang, line, expectedPatternIndex) => {
    const query = buildDefinitionQuery(lang, "sampleThing");
    const candidates = rankDefinitionMatches(
      [match(PATHS[lang ?? "generic"], 1, line)],
      {
        symbol: "sampleThing",
        currentPath: "src/current.txt",
        currentLine: null,
      },
      query.classifiers,
    );
    expect(candidates[0]?.patternIndex ?? null).toBe(expectedPatternIndex);
  });

  test.each(
    ALL_LANGS,
  )("keeps the %s engine pattern in the shared dialect", (lang) => {
    const query = buildDefinitionQuery(lang, "sampleThing");
    for (const forbidden of ["\\b", "(?:", "\\s", "\\w"]) {
      expect(query.pattern).not.toContain(forbidden);
    }
    for (const body of ordinaryBracketBodies(query.pattern)) {
      expect(body).not.toContain("\\");
      expect(body).not.toContain("[");
    }
    expect(query.classifiers.every((item) => item instanceof RegExp)).toBe(
      true,
    );
  });

  test.each([
    [
      "js",
      ["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs"],
    ],
    ["c", ["*.c", "*.h", "*.cc", "*.cpp", "*.hpp", "*.cxx", "*.hxx"]],
    ["shell", ["*.sh", "*.bash", "*.zsh"]],
    [null, []],
  ] as Array<
    [DefinitionLang | null, string[]]
  >)("returns static globs for %s", (lang, expected) => {
    expect(buildDefinitionQuery(lang, "sampleThing").globs).toEqual(expected);
  });
});

describe("definition search inputs", () => {
  test.each([
    ["typescript", "js"],
    ["javascript", "js"],
    ["cpp", "c"],
    ["c", "c"],
    ["bash", "shell"],
    ["python", "python"],
    ["sql", null],
    [null, null],
  ] as Array<
    [string | null, DefinitionLang | null]
  >)("maps %s to %s", (inferred, expected) =>
    expect(definitionLangOf(inferred)).toBe(expected));

  test.each([
    ["sampleThing", "sampleThing"],
    ["sample.value", "sample\\.value"],
    ["sample[value]", "sample\\[value\\]"],
    ["sample(value)?", "sample\\(value\\)\\?"],
    ["sample$value", "sample\\$value"],
    ["sample\\value", "sample\\\\value"],
  ])("escapes %s", (input, expected) => {
    expect(escapeRegexLiteral(input)).toBe(expected);
  });

  test.each([
    ["sampleThing", "js", true],
    ["sample_value", "python", true],
    ["変数名", "python", true],
    ["", null, false],
    ["2sample", "js", false],
    ["sample-value", "js", false],
    ["$sample", "js", false],
    ["return", null, false],
    ["function", "js", false],
    ["def", "python", false],
    ["class", "java", false],
  ] as Array<
    [string, DefinitionLang | null, boolean]
  >)("returns %s jumpability for %s", (word, lang, expected) => {
    expect(isJumpableSymbol(word, lang)).toBe(expected);
  });
});

type RankingCase = {
  name: string;
  currentPath: string;
  currentLine?: number;
  matches: GrepMatch[];
  expected: string[];
};

describe("rankDefinitionMatches", () => {
  const fn = "function sampleThing() {}";
  const cases: RankingCase[] = [
    {
      name: "self removal",
      currentPath: "src/current.ts",
      currentLine: 5,
      matches: [match("src/current.ts", 5, fn), match("src/other.ts", 2, fn)],
      expected: ["src/other.ts:2"],
    },
    {
      name: "same file",
      currentPath: "src/current.ts",
      matches: [match("src/other.ts", 2, fn), match("src/current.ts", 8, fn)],
      expected: ["src/current.ts:8", "src/other.ts:2"],
    },
    {
      name: "test penalty",
      currentPath: "src/current.ts",
      matches: [
        match("src/sample.test.ts", 2, fn),
        match("src/sample.ts", 2, fn),
      ],
      expected: ["src/sample.ts:2", "src/sample.test.ts:2"],
    },
    {
      name: "pattern priority",
      currentPath: "src/current.ts",
      matches: [
        match("src/variable.ts", 2, "const sampleThing = 1;"),
        match("src/function.ts", 2, fn),
      ],
      expected: ["src/function.ts:2", "src/variable.ts:2"],
    },
    {
      name: "common directory",
      currentPath: "src/feature/current.ts",
      matches: [
        match("src/other/sample.ts", 2, fn),
        match("src/feature/sample.ts", 2, fn),
      ],
      expected: ["src/feature/sample.ts:2", "src/other/sample.ts:2"],
    },
    {
      name: "dedupe",
      currentPath: "src/current.ts",
      matches: [match("src/sample.ts", 2, fn), match("src/sample.ts", 2, fn)],
      expected: ["src/sample.ts:2"],
    },
    {
      name: "comment removal",
      currentPath: "src/current.ts",
      matches: [
        match("src/comment.ts", 1, `// ${fn}`),
        match("src/sample.ts", 2, fn),
      ],
      expected: ["src/sample.ts:2"],
    },
    {
      name: "stable tie order",
      currentPath: "current.ts",
      matches: [
        match("src/z.ts", 3, fn),
        match("src/a.ts", 4, fn),
        match("src/a.ts", 2, fn),
      ],
      expected: ["src/a.ts:2", "src/a.ts:4", "src/z.ts:3"],
    },
  ];

  test.each(cases)("orders by $name", ({
    currentPath,
    currentLine,
    matches,
    expected,
  }) => {
    const ranked = rankDefinitionMatches(
      matches,
      { symbol: "sampleThing", currentPath, currentLine: currentLine ?? null },
      buildDefinitionQuery("js", "sampleThing").classifiers,
    );
    expect(ranked.map((item) => `${item.path}:${item.line}`)).toEqual(expected);
  });
});
