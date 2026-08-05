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
