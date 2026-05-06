import { describe, expect, test } from "bun:test";
import {
  fuzzyMatchPath,
  globMatchPath,
  isGlobPathQuery,
  rankFuzzyPaths,
  rankPathMatches,
} from "../fuzzy-search";

describe("fuzzyMatchPath", () => {
  test("prefers basename matches over directory-only matches", () => {
    const basename = fuzzyMatchPath("app", "web-src/app.ts");
    const directory = fuzzyMatchPath("app", "app/server/index.ts");

    expect(basename === null).toBe(false);
    expect(directory === null).toBe(false);
    expect(basename!.score > directory!.score).toBe(true);
  });

  test("matches subsequences and returns matched ranges", () => {
    const result = fuzzyMatchPath("fts", "web-src/file-tree-search.ts");

    expect(result === null).toBe(false);
    expect(result!.ranges.length > 0).toBe(true);
  });

  test("returns null when query characters are missing", () => {
    expect(fuzzyMatchPath("zzq", "web-src/app.ts")).toBeNull();
  });
});

describe("glob path search", () => {
  test("detects glob-style path queries", () => {
    expect(isGlobPathQuery("*.ts")).toBe(true);
    expect(isGlobPathQuery("src/**/index.ts")).toBe(true);
    expect(isGlobPathQuery("[id].tsx")).toBe(false);
    expect(isGlobPathQuery("app")).toBe(false);
  });

  test("matches suffix and recursive path globs", () => {
    expect(globMatchPath("*.ts", "app.ts") === null).toBe(false);
    expect(globMatchPath("*.ts", "src/app.ts") === null).toBe(false);
    expect(globMatchPath("src/**/*.ts", "src/ui/app.ts") === null).toBe(false);
  });

  test("rankPathMatches switches glob queries away from fuzzy search", () => {
    const ranked = rankPathMatches("*.ts", [
      { path: "src/app.ts" },
      { path: "README.md" },
      { path: "app.ts" },
    ]);

    expect(ranked.map((item) => item.item.path)).toEqual([
      "app.ts",
      "src/app.ts",
    ]);
    expect(ranked[0].mode).toBe("glob");
  });

  test("returns sorted highlight ranges for glob literals", () => {
    const match = globMatchPath("*app*ts*", "src/app.ts");
    expect(match?.ranges).toEqual([
      { start: 4, end: 7 },
      { start: 8, end: 10 },
    ]);
  });
});

describe("rankFuzzyPaths", () => {
  test("returns matches sorted by score with ranges attached", () => {
    const ranked = rankFuzzyPaths("app", [
      { path: "src/application.ts" },
      { path: "web-src/app.ts" },
      { path: "README.md" },
    ]);

    expect(ranked.map((item) => item.item.path)).toEqual([
      "web-src/app.ts",
      "src/application.ts",
    ]);
    expect(ranked[0].ranges.length > 0).toBe(true);
  });
});
