import { describe, expect, test } from "bun:test";
import {
  aiContextClipboardText,
  resolveSelectionTarget,
} from "../core/ai-context-copy";
import type { AppRoute } from "../core/routes";

const RANGE = { from: "HEAD", to: "worktree" };

describe("aiContextClipboardText", () => {
  test("summarizes a repo screen without an active file", () => {
    const route: AppRoute = {
      screen: "repo",
      ref: "worktree",
      path: "",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({
        route,
        pathname: "/",
        search: "",
        diffFrom: "HEAD",
        diffTo: "worktree",
      }),
    ).toBe(
      [
        "## code-viewer screen context",
        "",
        "- view: repo",
        "- url: /",
        "- diff range: HEAD..worktree",
      ].join("\n"),
    );
  });

  test("includes the active file and ref for a repo screen with a selected path", () => {
    const route: AppRoute = {
      screen: "repo",
      ref: "worktree",
      path: "web-src/app.ts",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({
        route,
        pathname: "/",
        search: "?path=web-src%2Fapp.ts",
        diffFrom: "HEAD",
        diffTo: "worktree",
      }),
    ).toBe(
      [
        "## code-viewer screen context",
        "",
        "- view: repo",
        "- url: /?path=web-src%2Fapp.ts",
        "- diff range: HEAD..worktree",
        "- file: web-src/app.ts (ref: worktree)",
      ].join("\n"),
    );
  });

  test("includes file, ref, view and a single-line selection for a file screen", () => {
    const route: AppRoute = {
      screen: "file",
      path: "web-src/app.ts",
      ref: "worktree",
      range: RANGE,
      view: "blob",
      line: 120,
    };
    expect(
      aiContextClipboardText({
        route,
        pathname: "/file",
        search: "?path=web-src%2Fapp.ts&target=worktree&view=blob&line=120",
        diffFrom: "HEAD",
        diffTo: "worktree",
      }),
    ).toBe(
      [
        "## code-viewer screen context",
        "",
        "- view: file",
        "- url: /file?path=web-src%2Fapp.ts&target=worktree&view=blob&line=120",
        "- diff range: HEAD..worktree",
        "- file: web-src/app.ts (ref: worktree, view: blob)",
        "- selection: @web-src/app.ts#120",
      ].join("\n"),
    );
  });

  test("formats a multi-line selection range as start-end", () => {
    const route: AppRoute = {
      screen: "file",
      path: "web-src/app.ts",
      ref: "HEAD",
      range: RANGE,
      view: "blame",
      line: { start: 10, end: 25 },
    };
    expect(
      aiContextClipboardText({
        route,
        pathname: "/file",
        search: "",
        diffFrom: "HEAD",
        diffTo: "worktree",
      }),
    ).toBe(
      [
        "## code-viewer screen context",
        "",
        "- view: file",
        "- url: /file",
        "- diff range: HEAD..worktree",
        "- file: web-src/app.ts (ref: HEAD, view: blame)",
        "- selection: @web-src/app.ts#10-25",
      ].join("\n"),
    );
  });

  test("defaults the file view label to 'detail' when the route omits it", () => {
    const route: AppRoute = {
      screen: "file",
      path: "README.md",
      ref: "worktree",
      range: RANGE,
    };
    expect(
      aiContextClipboardText({
        route,
        pathname: "/file",
        search: "?path=README.md",
        diffFrom: "HEAD",
        diffTo: "worktree",
      }),
    ).toBe(
      [
        "## code-viewer screen context",
        "",
        "- view: file",
        "- url: /file?path=README.md",
        "- diff range: HEAD..worktree",
        "- file: README.md (ref: worktree, view: detail)",
      ].join("\n"),
    );
  });

  test("includes the diff path without a selection when the diff screen has no line", () => {
    const route: AppRoute = {
      screen: "diff",
      range: RANGE,
      path: "web-src/app.ts",
    };
    expect(
      aiContextClipboardText({
        route,
        pathname: "/todif",
        search: "?from=HEAD&to=worktree&path=web-src%2Fapp.ts",
        diffFrom: "HEAD",
        diffTo: "worktree",
      }),
    ).toBe(
      [
        "## code-viewer screen context",
        "",
        "- view: diff",
        "- url: /todif?from=HEAD&to=worktree&path=web-src%2Fapp.ts",
        "- diff range: HEAD..worktree",
        "- file: web-src/app.ts",
      ].join("\n"),
    );
  });

  test("includes a selection for a diff screen carrying a line range", () => {
    const route: AppRoute = {
      screen: "diff",
      range: RANGE,
      path: "web-src/app.ts",
      line: { start: 5, end: 9 },
    };
    expect(
      aiContextClipboardText({
        route,
        pathname: "/todif",
        search: "?from=HEAD&to=worktree&path=web-src%2Fapp.ts&line=5-9",
        diffFrom: "HEAD",
        diffTo: "worktree",
      }),
    ).toBe(
      [
        "## code-viewer screen context",
        "",
        "- view: diff",
        "- url: /todif?from=HEAD&to=worktree&path=web-src%2Fapp.ts&line=5-9",
        "- diff range: HEAD..worktree",
        "- file: web-src/app.ts",
        "- selection: @web-src/app.ts#5-9",
      ].join("\n"),
    );
  });

  test("omits the file and selection lines for screens without an active file", () => {
    const route: AppRoute = { screen: "history", ref: "HEAD", range: RANGE };
    expect(
      aiContextClipboardText({
        route,
        pathname: "/history",
        search: "",
        diffFrom: "HEAD",
        diffTo: "worktree",
      }),
    ).toBe(
      [
        "## code-viewer screen context",
        "",
        "- view: history",
        "- url: /history",
        "- diff range: HEAD..worktree",
      ].join("\n"),
    );
  });

  test("appends a fenced code block to the selection when selectionCode lines are provided (Shift+Click)", () => {
    const route: AppRoute = {
      screen: "file",
      path: "web-src/app.ts",
      ref: "worktree",
      range: RANGE,
      view: "blob",
      line: { start: 10, end: 12 },
    };
    expect(
      aiContextClipboardText({
        route,
        pathname: "/file",
        search: "",
        diffFrom: "HEAD",
        diffTo: "worktree",
        selectionCode: {
          lines: ["const a = 1;", "const b = 2;", "const c = 3;"],
          lang: "typescript",
        },
      }),
    ).toBe(
      [
        "## code-viewer screen context",
        "",
        "- view: file",
        "- url: /file",
        "- diff range: HEAD..worktree",
        "- file: web-src/app.ts (ref: worktree, view: blob)",
        "- selection: @web-src/app.ts#10-12\n\n```typescript\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```",
      ].join("\n"),
    );
  });

  test("degrades to a ref-only selection when selectionCode has no lines (normal click, or nothing rendered)", () => {
    const route: AppRoute = {
      screen: "file",
      path: "web-src/app.ts",
      ref: "worktree",
      range: RANGE,
      view: "blob",
      line: { start: 10, end: 12 },
    };
    const withoutSelectionCode = aiContextClipboardText({
      route,
      pathname: "/file",
      search: "",
      diffFrom: "HEAD",
      diffTo: "worktree",
    });
    const withEmptySelectionCode = aiContextClipboardText({
      route,
      pathname: "/file",
      search: "",
      diffFrom: "HEAD",
      diffTo: "worktree",
      selectionCode: { lines: [], lang: "typescript" },
    });
    expect(withEmptySelectionCode).toBe(withoutSelectionCode);
    expect(withoutSelectionCode).toBe(
      [
        "## code-viewer screen context",
        "",
        "- view: file",
        "- url: /file",
        "- diff range: HEAD..worktree",
        "- file: web-src/app.ts (ref: worktree, view: blob)",
        "- selection: @web-src/app.ts#10-12",
      ].join("\n"),
    );
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
