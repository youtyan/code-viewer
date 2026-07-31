import { describe, expect, test } from "vitest";
import {
  aiContextClipboardText,
  resolveSelectionTarget,
} from "../core/ai-context-copy";
import type { AppRoute } from "../core/routes";
import type { FileMeta } from "../core/types";
import { makeDiffMeta } from "./_test-helpers";

const RANGE = { from: "HEAD", to: "worktree" };

function file(path: string, overrides?: Partial<FileMeta>): FileMeta {
  return { path, load_url: `/x?path=${path}`, status: "M", ...overrides };
}

describe("aiContextClipboardText", () => {
  test("returns a bare @path when a file screen has no line selection", () => {
    const route: AppRoute = {
      screen: "file",
      path: "README.md",
      ref: "worktree",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("@README.md");
  });

  test("formats a line range as @path#start-end, matching the line-ref-pill convention", () => {
    const route: AppRoute = {
      screen: "file",
      path: ".gitignore",
      ref: "worktree",
      range: RANGE,
      line: { start: 9, end: 13 },
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("@.gitignore#9-13");
  });

  test("omits the suffix for the live worktree and HEAD refs", () => {
    const worktreeRoute: AppRoute = {
      screen: "file",
      path: "web-src/app.ts",
      ref: "worktree",
      range: RANGE,
      line: 120,
    };
    const headRoute: AppRoute = {
      screen: "file",
      path: "web-src/app.ts",
      ref: "HEAD",
      range: RANGE,
      line: 120,
    };
    expect(
      aiContextClipboardText({
        route: worktreeRoute,
        diffFrom: "HEAD",
        diffTo: "worktree",
      }),
    ).toBe("@web-src/app.ts#120");
    expect(
      aiContextClipboardText({
        route: headRoute,
        diffFrom: "HEAD",
        diffTo: "worktree",
      }),
    ).toBe("@web-src/app.ts#120");
  });

  test("appends a (ref: ...) suffix when the ref isn't the live worktree or HEAD", () => {
    const route: AppRoute = {
      screen: "file",
      path: "web-src/app.ts",
      ref: "release-1.0",
      range: RANGE,
      line: { start: 10, end: 25 },
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("@web-src/app.ts#10-25 (ref: release-1.0)");
  });

  test("prefers a (commit: ...) suffix over the ref when both are set", () => {
    const route: AppRoute = {
      screen: "file",
      path: "web-src/app.ts",
      ref: "release-1.0",
      range: RANGE,
      view: "history",
      commit: "abc1234",
      line: 42,
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("@web-src/app.ts#42 (commit: abc1234)");
  });

  test("appends a fenced code block after the reference when selectionCode lines are provided (Shift+Click)", () => {
    const route: AppRoute = {
      screen: "file",
      path: "web-src/app.ts",
      ref: "worktree",
      range: RANGE,
      line: { start: 10, end: 12 },
    };
    expect(
      aiContextClipboardText({
        route,
        diffFrom: "HEAD",
        diffTo: "worktree",
        selectionCode: {
          lines: ["const a = 1;", "const b = 2;", "const c = 3;"],
          lang: "typescript",
        },
      }),
    ).toBe(
      "@web-src/app.ts#10-12\n\n```typescript\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```",
    );
  });

  test("degrades to the ref-only line when selectionCode has no lines (normal click, or nothing rendered)", () => {
    const route: AppRoute = {
      screen: "file",
      path: "web-src/app.ts",
      ref: "worktree",
      range: RANGE,
      line: { start: 10, end: 12 },
    };
    const withoutSelectionCode = aiContextClipboardText({
      route,
      diffFrom: "HEAD",
      diffTo: "worktree",
    });
    const withEmptySelectionCode = aiContextClipboardText({
      route,
      diffFrom: "HEAD",
      diffTo: "worktree",
      selectionCode: { lines: [], lang: "typescript" },
    });
    expect(withEmptySelectionCode).toBe(withoutSelectionCode);
    expect(withoutSelectionCode).toBe("@web-src/app.ts#10-12");
  });

  test("returns a bare @path for a repo screen with a selected path", () => {
    const route: AppRoute = {
      screen: "repo",
      ref: "worktree",
      path: "web-src/app.ts",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("@web-src/app.ts");
  });

  test("appends the ref suffix for a repo screen browsing a non-default ref", () => {
    const route: AppRoute = {
      screen: "repo",
      ref: "v1.0.0",
      path: "web-src/app.ts",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("@web-src/app.ts (ref: v1.0.0)");
  });

  test("returns an empty string for a repo screen with nothing selected", () => {
    const route: AppRoute = {
      screen: "repo",
      ref: "worktree",
      path: "",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("");
  });

  test("returns a bare @path for a diff screen file with no line selected", () => {
    const route: AppRoute = {
      screen: "diff",
      range: RANGE,
      path: "web-src/app.ts",
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("@web-src/app.ts");
  });

  test("formats a line range for a diff screen file", () => {
    const route: AppRoute = {
      screen: "diff",
      range: RANGE,
      path: "web-src/app.ts",
      line: { start: 5, end: 9 },
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("@web-src/app.ts#5-9");
  });

  test("appends code for a diff screen selection (Shift+Click)", () => {
    const route: AppRoute = {
      screen: "diff",
      range: RANGE,
      path: "web-src/app.ts",
      line: { start: 5, end: 6 },
    };
    expect(
      aiContextClipboardText({
        route,
        diffFrom: "HEAD",
        diffTo: "worktree",
        selectionCode: { lines: ["a", "b"], lang: "typescript" },
      }),
    ).toBe("@web-src/app.ts#5-6\n\n```typescript\na\nb\n```");
  });

  test("falls back to a short Diff: from..to line when the diff screen has no file selected", () => {
    const route: AppRoute = { screen: "diff", range: RANGE };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("Diff: HEAD..worktree");
  });

  test("includes files/totals in the diff overview brief when diffMeta is present", () => {
    const route: AppRoute = { screen: "diff", range: RANGE };
    const meta = makeDiffMeta([
      file("a.ts", { additions: 10, deletions: 3 }),
      file("b.ts", { additions: 2, deletions: 0 }),
    ]);
    expect(
      aiContextClipboardText({
        route,
        diffFrom: "HEAD",
        diffTo: "worktree",
        diffMeta: meta,
      }),
    ).toBe("Diff: HEAD..worktree (2 files, +12/-3)");
  });

  test("includes viewed progress as a count in the diff overview brief when viewedFiles is present", () => {
    const route: AppRoute = { screen: "diff", range: RANGE };
    const meta = makeDiffMeta([
      file("a.ts", { additions: 10, deletions: 3 }),
      file("b.ts", { additions: 2, deletions: 0 }),
    ]);
    const text = aiContextClipboardText({
      route,
      diffFrom: "HEAD",
      diffTo: "worktree",
      diffMeta: meta,
      viewedFiles: new Set(["a.ts"]),
    });
    expect(text).toBe("Diff: HEAD..worktree (2 files, +12/-3, 1/2 viewed)");
    expect(text.includes("a.ts")).toBe(false);
    expect(text.includes("b.ts")).toBe(false);
  });

  test("omits the viewed progress when viewedFiles is not provided", () => {
    const route: AppRoute = { screen: "diff", range: RANGE };
    const meta = makeDiffMeta([file("a.ts", { additions: 10 })]);
    expect(
      aiContextClipboardText({
        route,
        diffFrom: "HEAD",
        diffTo: "worktree",
        diffMeta: meta,
      }),
    ).toBe("Diff: HEAD..worktree (1 file, +10/-0)");
  });

  test("includes non-zero kind counts (added/deleted/renamed/heavy/binary/media) in the diff overview brief", () => {
    const route: AppRoute = { screen: "diff", range: RANGE };
    const meta = makeDiffMeta([
      file("new.ts", { status: "A", additions: 20 }),
      file("old.ts", { status: "D", deletions: 15 }),
      file("moved.ts", { status: "R" }),
      file("huge.ts", { size_class: "huge", additions: 900, deletions: 900 }),
      file("archive.zip", { size_class: "binary" }),
      file("logo.png", { media_kind: "image" }),
    ]);
    const text = aiContextClipboardText({
      route,
      diffFrom: "HEAD",
      diffTo: "worktree",
      diffMeta: meta,
    });
    expect(text).toBe(
      "Diff: HEAD..worktree (6 files, +920/-915, 1 added, 1 deleted, 1 renamed, 1 heavy, 1 binary, 1 media)",
    );
    expect(text.includes("new.ts")).toBe(false);
    expect(text.includes("logo.png")).toBe(false);
  });

  test("omits the brief details when diffMeta has no totals", () => {
    const route: AppRoute = { screen: "diff", range: RANGE };
    expect(
      aiContextClipboardText({
        route,
        diffFrom: "HEAD",
        diffTo: "worktree",
        diffMeta: { files: [file("a.ts", { additions: 1 })] },
      }),
    ).toBe("Diff: HEAD..worktree");
  });

  test("does not add the diff overview brief when a file is selected, even if diffMeta is present", () => {
    const route: AppRoute = {
      screen: "diff",
      range: RANGE,
      path: "web-src/app.ts",
    };
    const meta = makeDiffMeta([file("web-src/app.ts", { additions: 5 })]);
    expect(
      aiContextClipboardText({
        route,
        diffFrom: "HEAD",
        diffTo: "worktree",
        diffMeta: meta,
      }),
    ).toBe("@web-src/app.ts");
  });

  test("does not add the diff overview brief to a Shift+Click code selection, even if diffMeta is present", () => {
    const route: AppRoute = {
      screen: "diff",
      range: RANGE,
      path: "web-src/app.ts",
      line: { start: 5, end: 6 },
    };
    const meta = makeDiffMeta([file("web-src/app.ts", { additions: 5 })]);
    expect(
      aiContextClipboardText({
        route,
        diffFrom: "HEAD",
        diffTo: "worktree",
        selectionCode: { lines: ["a", "b"], lang: "typescript" },
        diffMeta: meta,
      }),
    ).toBe("@web-src/app.ts#5-6\n\n```typescript\na\nb\n```");
  });

  test("prefers the file reference over the Diff: summary when a file is selected", () => {
    const route: AppRoute = {
      screen: "diff",
      range: RANGE,
      path: "web-src/app.ts",
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("@web-src/app.ts");
  });

  test("returns commit: <sha> for a history screen viewing a specific commit", () => {
    const route: AppRoute = {
      screen: "history",
      ref: "HEAD",
      commit: "abc1234",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("commit: abc1234");
  });

  test("appends a ref suffix for a history commit on a non-default ref", () => {
    const route: AppRoute = {
      screen: "history",
      ref: "release-1.0",
      commit: "abc1234",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("commit: abc1234 (ref: release-1.0)");
  });

  test("falls back to the live diff range for a history screen with no commit selected", () => {
    const route: AppRoute = { screen: "history", ref: "HEAD", range: RANGE };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("History: HEAD..worktree");
  });

  test("appends a ref suffix for a history screen with no commit on a non-default ref", () => {
    const route: AppRoute = {
      screen: "history",
      ref: "release-1.0",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("History: HEAD..worktree (ref: release-1.0)");
  });

  test("includes db/schema/table/tab for a database screen", () => {
    const route: AppRoute = {
      screen: "database",
      db: "sample_db",
      schema: "sample_schema",
      table: "sample_table",
      tab: "query",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe(
      "database: db=sample_db, schema=sample_schema, table=sample_table, tab=query",
    );
  });

  test("includes only the fields present for a database screen with a partial route", () => {
    const route: AppRoute = {
      screen: "database",
      db: "sample_db",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("database: db=sample_db");
  });

  test("includes the snapshot pair for a database screen comparing two snapshots", () => {
    const route: AppRoute = {
      screen: "database",
      db: "sample_db",
      table: "sample_table",
      tab: "snapshot",
      diffBefore: "snap_before",
      diffAfter: "snap_after",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe(
      "database: db=sample_db, table=sample_table, tab=snapshot, snapshot=snap_before..snap_after",
    );
  });

  test("omits the snapshot pair when only one of diffBefore/diffAfter is set", () => {
    const route: AppRoute = {
      screen: "database",
      db: "sample_db",
      diffBefore: "snap_before",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("database: db=sample_db");
  });

  test("identifies the screen for a bare Datastores landing route with no fields set", () => {
    const route: AppRoute = { screen: "database", range: RANGE };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("database");
  });

  test("includes the current SQL draft for a database screen on the query tab", () => {
    const route: AppRoute = {
      screen: "database",
      db: "sample_db",
      tab: "query",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({
        route,
        diffFrom: "HEAD",
        diffTo: "worktree",
        databaseQuerySql: "SELECT * FROM sample_table",
      }),
    ).toBe("database: db=sample_db, tab=query, sql=SELECT * FROM sample_table");
  });

  test("collapses newlines/whitespace in the SQL draft into a single line", () => {
    const route: AppRoute = {
      screen: "database",
      db: "sample_db",
      tab: "query",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({
        route,
        diffFrom: "HEAD",
        diffTo: "worktree",
        databaseQuerySql: "SELECT *\n  FROM sample_table\n  WHERE  1=1",
      }),
    ).toBe(
      "database: db=sample_db, tab=query, sql=SELECT * FROM sample_table WHERE 1=1",
    );
  });

  test("truncates a long SQL draft with an ASCII ellipsis instead of pasting it in full", () => {
    const route: AppRoute = {
      screen: "database",
      db: "sample_db",
      tab: "query",
      range: RANGE,
    };
    const longSql = `SELECT * FROM sample_table WHERE ${"sample_col = 1 AND ".repeat(20)}1=1`;
    const text = aiContextClipboardText({
      route,
      diffFrom: "HEAD",
      diffTo: "worktree",
      databaseQuerySql: longSql,
    });
    const sqlPart = text.slice(text.indexOf("sql=") + "sql=".length);
    expect(sqlPart.endsWith("...")).toBe(true);
    expect(sqlPart.length <= 203).toBe(true);
    expect(longSql.length > 203).toBe(true);
  });

  test("omits the SQL draft when not on the query tab, even if one is provided", () => {
    const route: AppRoute = {
      screen: "database",
      db: "sample_db",
      tab: "data",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({
        route,
        diffFrom: "HEAD",
        diffTo: "worktree",
        databaseQuerySql: "SELECT * FROM sample_table",
      }),
    ).toBe("database: db=sample_db, tab=data");
  });

  test("returns an empty string for screens with no path/selection concept (e.g. help)", () => {
    const route: AppRoute = {
      screen: "help",
      range: RANGE,
      lang: "en",
      section: "overview",
    };
    expect(
      aiContextClipboardText({ route, diffFrom: "HEAD", diffTo: "worktree" }),
    ).toBe("");
  });
});

describe("resolveSelectionTarget", () => {
  test("resolves a single-line file selection", () => {
    const route: AppRoute = {
      screen: "file",
      path: "web-src/app.ts",
      ref: "worktree",
      range: RANGE,
      line: 42,
    };
    expect(resolveSelectionTarget(route)).toEqual({
      path: "web-src/app.ts",
      start: 42,
      end: 42,
    });
  });

  test("resolves a line range on a diff screen", () => {
    const route: AppRoute = {
      screen: "diff",
      range: RANGE,
      path: "web-src/app.ts",
      line: { start: 5, end: 9 },
    };
    expect(resolveSelectionTarget(route)).toEqual({
      path: "web-src/app.ts",
      start: 5,
      end: 9,
    });
  });

  test("returns null when the route has no line target", () => {
    const route: AppRoute = {
      screen: "file",
      path: "web-src/app.ts",
      ref: "worktree",
      range: RANGE,
    };
    expect(resolveSelectionTarget(route)).toBeNull();
  });

  test("returns null for screens that cannot carry a selection", () => {
    const route: AppRoute = { screen: "history", ref: "HEAD", range: RANGE };
    expect(resolveSelectionTarget(route)).toBeNull();
  });
});
