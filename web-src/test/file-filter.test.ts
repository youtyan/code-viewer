import { describe, expect, test } from "vitest";
import {
  compileFileFilter,
  filePathMatchesFilter,
  isTestFilePath,
  normalizeFileFilterQuery,
} from "../core/file-filter";

describe("normalizeFileFilterQuery", () => {
  test("trims and lowercases file search text", () => {
    expect(normalizeFileFilterQuery("  WEB/App.TS  ")).toBe("web/app.ts");
  });
});

describe("isTestFilePath", () => {
  test.each([
    { name: "dot test suffix", path: "src/sample.test.ts", expected: true },
    {
      name: "underscore spec suffix",
      path: "src/sample_spec.rb",
      expected: true,
    },
    { name: "test directory", path: "test/sample.ts", expected: true },
    {
      name: "nested test directory",
      path: "src/__tests__/sample.ts",
      expected: true,
    },
    { name: "ordinary source", path: "src/sample.ts", expected: false },
    { name: "word containing test", path: "src/latest.ts", expected: false },
  ])("recognizes $name", ({ path, expected }) => {
    expect(isTestFilePath(path)).toBe(expected);
  });
});

describe("filePathMatchesFilter", () => {
  test("matches paths case-insensitively and treats an empty query as all files", () => {
    expect(filePathMatchesFilter("web-src/app.ts", "APP")).toBe(true);
    expect(filePathMatchesFilter("web-src/app.ts", "server")).toBe(false);
    expect(filePathMatchesFilter("web-src/app.ts", "")).toBe(true);
  });
});

describe("compileFileFilter", () => {
  test("keeps empty queries as match-all", () => {
    const filter = compileFileFilter("   ");
    expect(filter.kind).toBe("empty");
    expect(filter.match("web-src/app.ts")).toBe(true);
  });

  test("keeps plain text as case-insensitive substring search", () => {
    const filter = compileFileFilter("APP");
    expect(filter.kind).toBe("substring");
    expect(filter.match("web-src/app.ts")).toBe(true);
    expect(filter.match("web-src/server/git.ts")).toBe(false);
  });

  test("uses slash-delimited regular expressions", () => {
    const filter = compileFileFilter("/app|git/");
    expect(filter.kind).toBe("regex");
    expect(filter.match("web-src/app.ts")).toBe(true);
    expect(filter.match("web-src/server/git.ts")).toBe(true);
    expect(filter.match("README.md")).toBe(false);
  });

  test("supports explicit regex flags", () => {
    const filter = compileFileFilter("/README/i");
    expect(filter.kind).toBe("regex");
    expect(filter.match("readme.md")).toBe(true);
  });

  test("treats an unfinished slash query as plain text", () => {
    const filter = compileFileFilter("/web-src");
    expect(filter.kind).toBe("substring");
    expect(filter.match("web-src/app.ts")).toBe(true);
  });

  test("reports invalid regular expressions without matching anything", () => {
    const filter = compileFileFilter("/[/");
    expect(filter.kind).toBe("invalid");
    expect(filter.match("web-src/app.ts")).toBe(false);
  });
});

describe("compileFileFilter syntax matrix", () => {
  test.each([
    { name: "empty", query: "", kind: "empty" },
    { name: "only spaces", query: "   ", kind: "empty" },
    { name: "plain word", query: "app", kind: "substring" },
    { name: "slash regex", query: "/app|git/", kind: "regex" },
    { name: "unfinished slash", query: "/web-src", kind: "substring" },
    { name: "tilde fuzzy", query: "~wsa", kind: "fuzzy" },
    { name: "tilde alone is empty", query: "~", kind: "empty" },
    { name: "star glob", query: "*.ts", kind: "glob" },
    { name: "question glob", query: "app.??", kind: "glob" },
    { name: "deep glob", query: "web-src/**/*.ts", kind: "glob" },
    { name: "broken regex", query: "/[/", kind: "invalid" },
  ])("$name -> $kind", ({ query, kind }) => {
    expect(compileFileFilter(query).kind).toBe(kind);
  });

  test.each([
    {
      name: "fuzzy: subsequence across path segments",
      query: "~wsa",
      path: "web-src/app.ts",
      expected: true,
    },
    {
      name: "fuzzy: letters out of order do not match",
      query: "~asw",
      path: "web-src/app.ts",
      expected: false,
    },
    {
      name: "glob: extension at any depth",
      query: "*.ts",
      path: "web-src/server/git.ts",
      expected: true,
    },
    {
      name: "glob: extension mismatch",
      query: "*.ts",
      path: "README.md",
      expected: false,
    },
    {
      name: "glob: ** spans zero directories",
      query: "web-src/**/*.ts",
      path: "web-src/app.ts",
      expected: true,
    },
    {
      name: "glob: ** spans several directories",
      query: "web-src/**/*.ts",
      path: "web-src/server/database/x.ts",
      expected: true,
    },
    {
      name: "glob: prefix mismatch",
      query: "web-src/**/*.ts",
      path: "scripts/build.ts",
      expected: false,
    },
    {
      name: "substring still wins for plain text containing a dot",
      query: "app.ts",
      path: "web-src/app.ts",
      expected: true,
    },
  ])("$name", ({ query, path, expected }) => {
    expect(compileFileFilter(query).match(path)).toBe(expected);
  });
});
