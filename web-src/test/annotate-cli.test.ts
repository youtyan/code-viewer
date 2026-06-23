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

  test("rename and edit parse ids and options", () => {
    expect(parseAnnotateArgs(["rename", "s-1", "--title", "New"])).toEqual({
      ok: true,
      args: {
        command: { kind: "rename", id: "s-1", title: "New" },
        cwd: undefined,
        server: undefined,
      },
    });
    const edit = parseAnnotateArgs(["edit", "a-1", "--body", "fixed"]);
    expect(
      edit.ok &&
        edit.args.command.kind === "edit" &&
        edit.args.command.body === "fixed",
    ).toBe(true);
    expect(parseAnnotateArgs(["rename"]).ok).toBe(false);
    expect(
      parseAnnotateArgs(["edit", "a-1", "--body", "x", "--body-file", "y"]).ok,
    ).toBe(false);
  });

  test("agent-help prints the agent guide", () => {
    expect(parseAnnotateArgs(["agent-help"])).toEqual({
      ok: true,
      args: { command: { kind: "agent-help" } },
    });
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
      before: undefined,
      after: undefined,
      position: undefined,
    });
  });

  test("add parses insertion options", () => {
    const parsed = parseAnnotateArgs([
      "add",
      "--file",
      "src/app.ts",
      "--after",
      "a-1",
      "--body",
      "x",
    ]);
    if (parsed.ok === false) throw new Error(parsed.error);
    expect(parsed.args.command.kind).toBe("add");
    if (parsed.args.command.kind === "add") {
      expect(parsed.args.command.after).toBe("a-1");
      expect(parsed.args.command.position).toBeUndefined();
    }
  });

  test("add-db parses database targets", () => {
    const parsed = parseAnnotateArgs([
      "add-db",
      "--db",
      "app.db",
      "--table",
      "users",
      "--tab",
      "schema",
      "--before",
      "a-2",
      "--body",
      "database note",
    ]);
    if (parsed.ok === false) throw new Error(parsed.error);
    expect(parsed.args.command).toEqual({
      kind: "add-db",
      db: "app.db",
      table: "users",
      tab: "schema",
      gridSearch: undefined,
      filters: [],
      sort: undefined,
      row: undefined,
      sql: undefined,
      sqlFile: undefined,
      queryMode: "run",
      queryAutoRun: false,
      searchTerm: undefined,
      includeNonText: undefined,
      searchAutoRun: false,
      title: undefined,
      session: undefined,
      sessionTitle: undefined,
      body: "database note",
      bodyFile: undefined,
      before: "a-2",
      after: undefined,
      position: undefined,
    });
    expect(parseAnnotateArgs(["add-db", "--body", "database note"]).ok).toBe(
      false,
    );
    expect(parseAnnotateArgs(["add-db", "--tab", "bad"]).ok).toBe(false);
  });

  test("add-db parses reproducible database view state", () => {
    const data = parseAnnotateArgs([
      "add-db",
      "--db",
      "app.db",
      "--table",
      "orders",
      "--grid-search",
      "failed",
      "--filter",
      "status=failed",
      "--filter",
      "kind=refund",
      "--sort",
      "created_at:desc",
      "--row",
      "3",
      "--body",
      "filtered rows",
    ]);
    if (data.ok === false) throw new Error(data.error);
    expect(data.args.command.kind).toBe("add-db");
    if (data.args.command.kind === "add-db") {
      expect(data.args.command.tab).toBeUndefined();
      expect(data.args.command.gridSearch).toBe("failed");
      expect(data.args.command.filters).toEqual([
        { column: "status", value: "failed" },
        { column: "kind", value: "refund" },
      ]);
      expect(data.args.command.sort).toEqual({
        column: "created_at",
        direction: "desc",
      });
      expect(data.args.command.row).toBe(3);
    }

    const query = parseAnnotateArgs([
      "add-db",
      "--db",
      "app.db",
      "--sql",
      "select * from users",
      "--query-mode",
      "explain",
      "--run-query",
      "--body",
      "query result",
    ]);
    if (query.ok === false) throw new Error(query.error);
    expect(query.args.command.kind).toBe("add-db");
    if (query.args.command.kind === "add-db") {
      expect(query.args.command.sql).toBe("select * from users");
      expect(query.args.command.queryMode).toBe("explain");
      expect(query.args.command.queryAutoRun).toBe(true);
    }

    const search = parseAnnotateArgs([
      "add-db",
      "--db",
      "app.db",
      "--search-term",
      "failed",
      "--include-non-text",
      "--run-search",
      "--body",
      "global search",
    ]);
    if (search.ok === false) throw new Error(search.error);
    expect(search.args.command.kind).toBe("add-db");
    if (search.args.command.kind === "add-db") {
      expect(search.args.command.searchTerm).toBe("failed");
      expect(search.args.command.includeNonText).toBe(true);
      expect(search.args.command.searchAutoRun).toBe(true);
    }

    const passiveSearch = parseAnnotateArgs([
      "add-db",
      "--db",
      "app.db",
      "--search-term",
      "failed",
      "--body",
      "global search",
    ]);
    if (passiveSearch.ok === false) throw new Error(passiveSearch.error);
    expect(passiveSearch.args.command.kind).toBe("add-db");
    if (passiveSearch.args.command.kind === "add-db") {
      expect(passiveSearch.args.command.searchAutoRun).toBe(false);
    }

    expect(
      parseAnnotateArgs([
        "add-db",
        "--db",
        "app.db",
        "--filter",
        "broken",
        "--body",
        "x",
      ]).ok,
    ).toBe(false);
    expect(
      parseAnnotateArgs([
        "add-db",
        "--db",
        "app.db",
        "--sort",
        "created_at:sideways",
        "--body",
        "x",
      ]).ok,
    ).toBe(false);
    expect(
      parseAnnotateArgs([
        "add-db",
        "--db",
        "app.db",
        "--grid-search",
        "failed",
        "--body",
        "x",
      ]).ok,
    ).toBe(false);
    expect(
      parseAnnotateArgs([
        "add-db",
        "--db",
        "app.db",
        "--tab",
        "data",
        "--sql",
        "select * from users",
        "--body",
        "x",
      ]).ok,
    ).toBe(false);
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
    expect(
      parseAnnotateArgs(["add", "--file", "a.ts", "--position", "0"]).ok,
    ).toBe(false);
  });

  test("list, move, delete, and clear commands", () => {
    const list = parseAnnotateArgs(["list", "--json"]);
    if (list.ok === false) throw new Error(list.error);
    expect(list.args.command).toEqual({ kind: "list", json: true });

    const move = parseAnnotateArgs(["move", "a-1", "--before", "a-2"]);
    if (move.ok === false) throw new Error(move.error);
    expect(move.args.command).toEqual({
      kind: "move",
      id: "a-1",
      before: "a-2",
      after: undefined,
      position: undefined,
    });
    expect(parseAnnotateArgs(["move"]).ok).toBe(false);
    expect(parseAnnotateArgs(["move", "a-1"]).ok).toBe(false);

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
