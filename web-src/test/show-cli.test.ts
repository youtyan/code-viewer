// `code-viewer show` (AI が利用者の画面にファイル・差分を新しいタブで開く)。
// 引数の解釈・リポジトリの中のパスへの直し方・形の検査・どの窓が開くか。
import "./_dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import { isShowEvent, isShowRequest, parseShowTarget } from "../core/show";
import { parseShowArgs, showRequestFor } from "../server/show-cli";
import { claimShow } from "../views/show-claim";

describe("parseShowArgs", () => {
  test.each([
    { argv: [], expected: { ok: true, args: { kind: "help" } } },
    { argv: ["--help"], expected: { ok: true, args: { kind: "help" } } },
    {
      argv: ["src/a.ts:12"],
      expected: {
        ok: true,
        args: { kind: "show", target: "src/a.ts:12", diff: false },
      },
    },
    {
      argv: ["src/a.ts", "--diff", "--cwd", "/repo"],
      expected: {
        ok: true,
        args: { kind: "show", target: "src/a.ts", diff: true, cwd: "/repo" },
      },
    },
    {
      argv: ["a.ts", "b.ts"],
      expected: { ok: false, error: "show takes one path; also got: b.ts" },
    },
    {
      argv: ["a.ts", "--line", "3"],
      expected: { ok: false, error: "unknown option: --line" },
    },
  ])("$argv", ({ argv, expected }) => {
    expect(parseShowArgs(argv)).toEqual(expected);
  });
});

describe("showRequestFor", () => {
  test.each([
    {
      name: "a path from a subfolder becomes repository-relative, with its line",
      target: "a.ts:12",
      base: "/repo/src",
      expected: {
        ok: true,
        request: { path: "src/a.ts", line: 12, view: "file" },
      },
    },
    {
      name: "an absolute path inside the repository",
      target: "/repo/README.md",
      base: "/elsewhere",
      expected: { ok: true, request: { path: "README.md", view: "file" } },
    },
    {
      name: "a diff opens the whole file (no line)",
      target: "src/a.ts:12",
      base: "/repo",
      expected: { ok: true, request: { path: "src/a.ts", view: "diff" } },
      diff: true,
    },
  ])("$name", ({ target, base, expected, diff }) => {
    expect(showRequestFor(target, diff === true, "/repo", base)).toEqual(
      expected,
    );
  });

  test.each([
    { name: "outside the repository", target: "/etc/hosts" },
    { name: "git metadata", target: ".git/config" },
  ])("refuses $name, naming the path and the repository", ({ target }) => {
    const made = showRequestFor(target, false, "/repo", "/repo");
    expect(made.ok).toBe(false);
    expect(made.ok === false && made.error).toContain(target);
    expect(made.ok === false && made.error).toContain("/repo");
  });
});

describe("show shapes", () => {
  test.each([
    { value: "src/a.ts:12", expected: { path: "src/a.ts", line: 12 } },
    { value: "src/a.ts", expected: { path: "src/a.ts" } },
    { value: "src/a.ts:0", expected: { path: "src/a.ts:0" } },
  ])("parseShowTarget($value)", ({ value, expected }) => {
    expect(parseShowTarget(value)).toEqual(expected);
  });

  test.each([
    { value: { path: "a.ts", view: "file" }, request: true, event: false },
    {
      value: { path: "a.ts", view: "file", id: "x" },
      request: true,
      event: true,
    },
    {
      value: { path: "a.ts", view: "blame", id: "x" },
      request: false,
      event: false,
    },
    {
      value: { path: "", view: "file", id: "x" },
      request: false,
      event: false,
    },
    {
      value: { path: "a.ts", view: "file", line: 0, id: "x" },
      request: false,
      event: false,
    },
  ])("$value", ({ value, request, event }) => {
    expect([isShowRequest(value), isShowEvent(value)]).toEqual([
      request,
      event,
    ]);
  });
});

describe("which window opens it", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  test("only the first window that gets an event opens it", async () => {
    // 同じオリジンの全部の文脈で 1 つずつしか走らない鍵 (Web Locks) の代わり。
    let chain = Promise.resolve();
    vi.stubGlobal("navigator", {
      ...navigator,
      locks: {
        request: (_name: string, run: () => unknown) => {
          const next = chain.then(run);
          chain = next.then(() => undefined);
          return next;
        },
      },
    });
    const claims = await Promise.all([
      claimShow("event-1"),
      claimShow("event-1"),
      claimShow("event-2"),
    ]);
    expect(claims).toEqual([true, false, true]);
  });
});
