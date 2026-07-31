import { afterEach, describe, expect, test } from "vitest";
import { parseAnnotateArgs, runAnnotateCli } from "../server/annotate-cli";

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

// --- runAnnotateCli integration tests (fetch mocked) ---

type AnnotateRequestRecord = {
  url: string;
  method: string;
  body: unknown;
};

const SERVER = "http://localhost:65535";
const originalFetch = globalThis.fetch;
let originalExit: typeof process.exit | null = null;
let originalLog: typeof console.log | null = null;
let originalErr: typeof console.error | null = null;

function installAnnotateRunHarness(
  responses: Array<{ status?: number; contentType?: string; body: string }>,
): {
  requests: AnnotateRequestRecord[];
  logs: string[];
  errs: string[];
  exits: number[];
} {
  const requests: AnnotateRequestRecord[] = [];
  const logs: string[] = [];
  const errs: string[] = [];
  const exits: number[] = [];
  let index = 0;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const bodyText = init?.body as string | undefined;
      const body = bodyText ? JSON.parse(bodyText) : undefined;
      requests.push({ url, method: init?.method ?? "GET", body });
      const next = responses[index++];
      if (!next) throw new Error(`unexpected extra fetch: ${url}`);
      return new Response(next.body, {
        status: next.status ?? 200,
        headers: {
          "Content-Type": next.contentType ?? "application/json",
        },
      });
    },
  });

  originalExit = process.exit;
  process.exit = ((code?: number) => {
    exits.push(typeof code === "number" ? code : 0);
    throw new AnnotateExitMarker(code ?? 0);
  }) as typeof process.exit;

  originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(
      args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
    );
  };

  originalErr = console.error;
  console.error = (...args: unknown[]) => {
    errs.push(
      args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
    );
  };

  return { requests, logs, errs, exits };
}

class AnnotateExitMarker extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
  if (originalExit) process.exit = originalExit;
  if (originalLog) console.log = originalLog;
  if (originalErr) console.error = originalErr;
});

async function runAnnotateAndCatchExit(argv: string[]): Promise<void> {
  try {
    await runAnnotateCli(argv);
  } catch (err) {
    if (err instanceof AnnotateExitMarker) return;
    throw err;
  }
}

describe("runAnnotateCli add output", () => {
  test.each([
    {
      name: "file annotation shows a single line",
      argv: [
        "--server",
        SERVER,
        "add",
        "--file",
        "src/sample.ts",
        "--line",
        "3",
        "--body",
        "sample note",
      ],
      response: {
        session_id: "session-1",
        session_title: "Sample session",
        entry: {
          id: "entry-1",
          created_at: "2026-01-02T03:04:05Z",
          path: "src/sample.ts",
          line: { start: 3, end: 3 },
          body: "sample note",
        },
      },
      expectedLogs: [
        "annotated src/sample.ts:3 [entry-1] in session session-1 (Sample session)",
      ],
      expectedErrs: [
        `view annotations at ${SERVER}/ with the code annotations panel`,
      ],
    },
    {
      name: "file annotation shows a line range",
      argv: [
        "--server",
        SERVER,
        "add",
        "--file",
        "src/sample.ts",
        "--line",
        "3-5",
        "--body",
        "sample note",
      ],
      response: {
        session_id: "session-1",
        session_title: "Sample session",
        entry: {
          id: "entry-2",
          created_at: "2026-01-02T03:04:05Z",
          path: "src/sample.ts",
          line: { start: 3, end: 5 },
          body: "sample note",
        },
      },
      expectedLogs: [
        "annotated src/sample.ts:3-5 [entry-2] in session session-1 (Sample session)",
      ],
      expectedErrs: [
        `view annotations at ${SERVER}/ with the code annotations panel`,
      ],
    },
    {
      name: "file annotation omits an absent line",
      argv: [
        "--server",
        SERVER,
        "add",
        "--file",
        "src/sample.ts",
        "--body",
        "sample note",
      ],
      response: {
        session_id: "session-1",
        session_title: "Sample session",
        entry: {
          id: "entry-3",
          created_at: "2026-01-02T03:04:05Z",
          path: "src/sample.ts",
          body: "sample note",
        },
      },
      expectedLogs: [
        "annotated src/sample.ts [entry-3] in session session-1 (Sample session)",
      ],
      expectedErrs: [
        `view annotations at ${SERVER}/ with the code annotations panel`,
      ],
    },
    {
      name: "database annotation shows its stored location",
      argv: [
        "--server",
        SERVER,
        "add-db",
        "--db",
        "sample.db",
        "--body",
        "sample note",
      ],
      response: {
        session_id: "session-1",
        session_title: "Sample session",
        entry: {
          id: "entry-4",
          created_at: "2026-01-02T03:04:05Z",
          path: "database/sample_table",
          body: "sample note",
        },
      },
      expectedLogs: [
        "annotated database/sample_table [entry-4] in session session-1 (Sample session)",
      ],
      expectedErrs: [
        `view annotations at ${SERVER}/ with the code annotations panel`,
      ],
    },
    {
      name: "auto-created session is announced with the fallback title",
      argv: [
        "--server",
        SERVER,
        "add",
        "--file",
        "src/sample.ts",
        "--body",
        "sample note",
      ],
      response: {
        session_id: "session-2",
        created_session: true,
        entry: {
          id: "entry-5",
          created_at: "2026-01-02T03:04:05Z",
          path: "src/sample.ts",
          body: "sample note",
        },
      },
      expectedLogs: [
        "annotated src/sample.ts [entry-5] in session session-2 (Untitled session)",
      ],
      expectedErrs: [
        "created new annotation session session-2 (Untitled session)",
        `view annotations at ${SERVER}/ with the code annotations panel`,
      ],
    },
  ])("$name", async ({ argv, response, expectedLogs, expectedErrs }) => {
    const harness = installAnnotateRunHarness([
      { body: JSON.stringify({ sessions: [] }) },
      { body: JSON.stringify(response) },
    ]);

    await runAnnotateAndCatchExit(argv);

    expect(harness.logs).toEqual(expectedLogs);
    expect(harness.errs).toEqual(expectedErrs);
    expect(harness.exits).toEqual([]);
  });
});

describe("runAnnotateCli server error handling", () => {
  test("non-2xx application/json bodies with {error:string} surface the error text only", async () => {
    const harness = installAnnotateRunHarness([
      { body: JSON.stringify({ sessions: [] }) },
      {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "sample failure", extra: "hidden" }),
      },
    ]);

    await runAnnotateAndCatchExit(["--server", SERVER, "list", "--json"]);

    expect(harness.exits).toEqual([1]);
    const err = harness.errs.join("\n");
    expect(err).toMatch(/^annotate list failed \(400\): sample failure$/m);
    expect(/extra|hidden/.test(err)).toBe(false);
    expect(harness.logs).toEqual([]);
  });

  test("non-2xx application/json bodies without {error} fall back to the raw body text", async () => {
    const harness = installAnnotateRunHarness([
      { body: JSON.stringify({ sessions: [] }) },
      {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ reason: "no error field" }),
      },
    ]);

    await runAnnotateAndCatchExit(["--server", SERVER, "list", "--json"]);

    expect(harness.exits).toEqual([1]);
    expect(harness.errs.join("\n")).toMatch(
      /^annotate list failed \(400\): \{"reason":"no error field"\}$/m,
    );
  });

  test("non-2xx text/plain bodies keep the plain error text", async () => {
    const harness = installAnnotateRunHarness([
      { body: JSON.stringify({ sessions: [] }) },
      {
        status: 400,
        contentType: "text/plain",
        body: "annotation target missing",
      },
    ]);

    await runAnnotateAndCatchExit([
      "--server",
      SERVER,
      "add",
      "--file",
      "src/app.ts",
      "--body",
      "sample note",
    ]);

    expect(harness.exits).toEqual([1]);
    expect(harness.errs.join("\n")).toMatch(
      /^annotate add failed \(400\): annotation target missing$/m,
    );
  });

  test("add-db request failures use the add-db command label", async () => {
    const harness = installAnnotateRunHarness([
      { body: JSON.stringify({ sessions: [] }) },
      {
        status: 400,
        contentType: "text/plain",
        body: "database target missing",
      },
    ]);

    await runAnnotateAndCatchExit([
      "--server",
      SERVER,
      "add-db",
      "--db",
      "app.db",
      "--body",
      "sample database note",
    ]);

    expect(harness.exits).toEqual([1]);
    expect(harness.errs.join("\n")).toMatch(
      /^annotate add-db failed \(400\): database target missing$/m,
    );
  });

  test("non-2xx responses with empty bodies fall back to HTTP <status>", async () => {
    const harness = installAnnotateRunHarness([
      { body: JSON.stringify({ sessions: [] }) },
      { status: 500, contentType: "application/json", body: "" },
    ]);

    await runAnnotateAndCatchExit(["--server", SERVER, "clear"]);

    expect(harness.exits).toEqual([1]);
    expect(harness.errs.join("\n")).toMatch(
      /^annotate clear failed \(500\): HTTP 500$/m,
    );
  });
});
