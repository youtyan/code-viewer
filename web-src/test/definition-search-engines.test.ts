import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  buildDefinitionQuery,
  type DefinitionLang,
} from "../core/definition-search";
import { grepRepoAsync, rgAvailableAsync } from "../server/search-service";
import { runGit } from "./_git-fixture";

type EngineCase = [DefinitionLang | null, string[]];
const ENGINE_CASES: EngineCase[] = [
  [
    "js",
    [
      "function sampleThing() {}",
      "class sampleThing {}",
      "const sampleThing = 1;",
      "async sampleThing() {}",
      "sampleThing = async () => {};",
    ],
  ],
  [
    "python",
    ["def sampleThing():", "class sampleThing:", "sampleThing: int = 1"],
  ],
  [
    "go",
    [
      "func sampleThing[T any]() {}",
      "func (sample Receiver) sampleThing() {}",
      "type sampleThing struct {}",
      "sampleThing := 1",
    ],
  ],
  [
    "rust",
    [
      "fn sampleThing() {}",
      "macro_rules! sampleThing {}",
      "let mut sampleThing = 1;",
    ],
  ],
  [
    "ruby",
    [
      "def sampleThing",
      "class sampleThing",
      "sampleThing = 1",
      "define_method(:sampleThing)",
    ],
  ],
  [
    "java",
    ["class sampleThing {}", "void sampleThing() {", "String[] sampleThing;"],
  ],
  ["kotlin", ["fun <T> sampleThing(value: T) = value"]],
  ["swift", ["func sampleThing() {}"]],
  [
    "c",
    [
      "#define sampleThing 1",
      "struct sampleThing {",
      "typedef unsigned long sampleThing;",
      "int *sampleThing(void) {",
    ],
  ],
  [
    "csharp",
    [
      "class sampleThing {",
      "void sampleThing() {",
      "int sampleThing { get; set; }",
    ],
  ],
  [
    "php",
    [
      "function &sampleThing() {",
      "class sampleThing {",
      "$sampleThing = 1;",
      "const sampleThing = 1;",
      "define('sampleThing', 1);",
    ],
  ],
  ["shell", ["function sampleThing {", "sampleThing() {", "sampleThing=value"]],
  [null, ["function sampleThing()", "sampleThing = 1"]],
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

const RG_AVAILABLE = await rgAvailableAsync(process.cwd());
const repository = mkdtempSync(
  join(tmpdir(), "code-viewer-definition-engines-"),
);

function pathFor(lang: DefinitionLang | null): string {
  return PATHS[lang ?? "generic"];
}

beforeAll(() => {
  mkdirSync(join(repository, "src"), { recursive: true });
  mkdirSync(join(repository, "ignored"), { recursive: true });
  runGit(repository, ["init", "-b", "main"]);
  runGit(repository, ["config", "user.email", "sample-author"]);
  runGit(repository, ["config", "user.name", "sample-author"]);
  writeFileSync(join(repository, ".gitignore"), "ignored/\n");
  writeFileSync(
    join(repository, "ignored", "sample.ts"),
    "function sampleThing() {}\n",
  );
  for (const [lang, lines] of ENGINE_CASES) {
    writeFileSync(join(repository, pathFor(lang)), `${lines.join("\n")}\n`);
  }
  runGit(repository, ["add", "."]);
  runGit(repository, ["commit", "-m", "sample definitions"]);
});

afterAll(() => {
  rmSync(repository, { recursive: true, force: true });
});

async function searchWithEngine(
  lang: DefinitionLang | null,
  ref: "main" | "worktree",
) {
  const query = buildDefinitionQuery(lang, "sampleThing");
  const result = await grepRepoAsync(
    { cwd: repository, omitDirNames: [], excludeNames: [] },
    {
      query: query.pattern,
      ref,
      paths: [],
      regex: true,
      max: 50,
      caseSensitive: true,
    },
  );
  if (result.ok !== true) {
    throw new Error(`${ref} definition search failed: ${result.error}`);
  }
  return {
    engine: result.value.engine,
    hits: result.value.matches
      .map((item) => ({
        path: item.path,
        line: item.line,
      }))
      .sort(
        (left, right) =>
          left.path.localeCompare(right.path) || left.line - right.line,
      ),
  };
}

function expectedHits(lang: DefinitionLang | null, lines: string[]) {
  return lines.map((_, index) => ({ path: pathFor(lang), line: index + 1 }));
}

describe("definition patterns with git grep -E", () => {
  test.each(ENGINE_CASES)("matches every %s template", async (lang, lines) => {
    const result = await searchWithEngine(lang, "main");
    expect(result.engine).toBe("git");
    expect(result.hits.filter((item) => item.path === pathFor(lang))).toEqual(
      expectedHits(lang, lines),
    );
    expect(result.hits).not.toContainEqual({
      path: "ignored/sample.ts",
      line: 1,
    });
  });
});

describe.skipIf(!RG_AVAILABLE)("definition patterns with rg", () => {
  test.each(
    ENGINE_CASES,
  )("matches the same %s lines as git grep -E", async (lang, lines) => {
    const gitResult = await searchWithEngine(lang, "main");
    const rgResult = await searchWithEngine(lang, "worktree");
    expect(rgResult.engine).toBe("rg");
    expect(rgResult.hits).toEqual(gitResult.hits);
    expect(rgResult.hits.filter((item) => item.path === pathFor(lang))).toEqual(
      expectedHits(lang, lines),
    );
    expect(rgResult.hits).not.toContainEqual({
      path: "ignored/sample.ts",
      line: 1,
    });
  });
});
