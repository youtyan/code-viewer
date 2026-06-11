import { describe, expect, test } from "bun:test";
import { parseAnnotateArgs } from "../server/annotate-cli";

describe("parseAnnotateArgs", () => {
  test("no arguments or --help shows help", () => {
    expect(parseAnnotateArgs([])).toEqual({
      ok: true,
      args: { command: { kind: "help" } },
    });
    const help = parseAnnotateArgs(["add", "--help"]);
    expect(help.ok && help.args.command.kind === "help").toBe(true);
  });

  test("start captures the title and global options", () => {
    const parsed = parseAnnotateArgs([
      "start",
      "--title",
      "How SSE works",
      "--cwd",
      "/repo",
      "--server",
      "http://127.0.0.1:64160/",
    ]);
    expect(parsed).toEqual({
      ok: true,
      args: {
        command: { kind: "start", title: "How SSE works" },
        cwd: "/repo",
        server: "http://127.0.0.1:64160/",
      },
    });
  });

  test("add parses file, line range, refs, and body", () => {
    const parsed = parseAnnotateArgs([
      "add",
      "--file",
      "src/app.ts",
      "--line",
      "10-20",
      "--from",
      "HEAD~1",
      "--to",
      "worktree",
      "--title",
      "guard",
      "--session",
      "s-1",
      "--body",
      "explanation",
    ]);
    if (parsed.ok === false) throw new Error(parsed.error);
    expect(parsed.args.command).toEqual({
      kind: "add",
      file: "src/app.ts",
      line: { start: 10, end: 20 },
      from: "HEAD~1",
      to: "worktree",
      title: "guard",
      session: "s-1",
      sessionTitle: undefined,
      body: "explanation",
      bodyFile: undefined,
    });
  });

  test("add rejects bad input", () => {
    expect(parseAnnotateArgs(["add"]).ok).toBe(false);
    expect(parseAnnotateArgs(["add", "--file", "a.ts", "--line", "x"]).ok).toBe(
      false,
    );
    expect(
      parseAnnotateArgs([
        "add",
        "--file",
        "a.ts",
        "--body",
        "x",
        "--body-file",
        "b.md",
      ]).ok,
    ).toBe(false);
    expect(parseAnnotateArgs(["add", "--file"]).ok).toBe(false);
  });

  test("list, delete, and clear commands", () => {
    const list = parseAnnotateArgs(["list", "--json"]);
    if (list.ok === false) throw new Error(list.error);
    expect(list.args.command).toEqual({ kind: "list", json: true });

    const del = parseAnnotateArgs(["delete", "a-1"]);
    if (del.ok === false) throw new Error(del.error);
    expect(del.args.command).toEqual({ kind: "delete", id: "a-1" });
    expect(parseAnnotateArgs(["delete"]).ok).toBe(false);

    const clear = parseAnnotateArgs(["clear"]);
    if (clear.ok === false) throw new Error(clear.error);
    expect(clear.args.command).toEqual({ kind: "clear" });
  });

  test("unknown commands and options fail", () => {
    expect(parseAnnotateArgs(["frobnicate"]).ok).toBe(false);
    expect(parseAnnotateArgs(["list", "--wat"]).ok).toBe(false);
  });
});
