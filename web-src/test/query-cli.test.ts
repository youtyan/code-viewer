import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseQueryArgs,
  QUERY_AGENT_HELP,
  QUERY_HELP,
  type QueryCommand,
  runQueryCli,
  shellSingleQuote,
} from "../server/query-cli";

const REPO_ROOT = join(import.meta.dir, "..", "..");

describe("parseQueryArgs", () => {
  test("returns help on bare invocation, --help, and -h", () => {
    for (const argv of [[], ["--help"], ["-h"]]) {
      const result = parseQueryArgs(argv);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.args.command.kind).toBe("help");
    }
  });

  test("returns agent-help for the agent-help subcommand", () => {
    const result = parseQueryArgs(["agent-help"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args.command.kind).toBe("agent-help");
  });

  test("sources subcommand parses with and without --json/--commands (no other flags accepted)", () => {
    const bare = parseQueryArgs(["sources"]);
    expect(bare.ok).toBe(true);
    if (!bare.ok) throw new Error("parse failed");
    expect(bare.args.command).toEqual({ kind: "sources", mode: "default" });

    const withJson = parseQueryArgs(["sources", "--json"]);
    expect(withJson.ok).toBe(true);
    if (!withJson.ok) throw new Error("parse failed");
    expect(withJson.args.command).toEqual({ kind: "sources", mode: "json" });

    const withCommands = parseQueryArgs(["sources", "--commands"]);
    expect(withCommands.ok).toBe(true);
    if (!withCommands.ok) throw new Error("parse failed");
    expect(withCommands.args.command).toEqual({
      kind: "sources",
      mode: "commands",
    });

    expect(parseQueryArgs(["sources", "--json", "--commands"])).toEqual({
      ok: false,
      error: "sources does not accept --json with --commands",
    });
    expect(parseQueryArgs(["sources", "extra"])).toEqual({
      ok: false,
      error: "sources does not accept positional arguments",
    });
    expect(parseQueryArgs(["sources", "--db", "app.db"])).toEqual({
      ok: false,
      error: "sources does not accept --db",
    });
    expect(parseQueryArgs(["sources", "--wait"])).toEqual({
      ok: false,
      error: "sources does not accept --wait",
    });
  });

  test("schemas requires --db and accepts only --json", () => {
    expect(parseQueryArgs(["schemas"])).toEqual({
      ok: false,
      error: "schemas requires --db <path>",
    });
    expect(parseQueryArgs(["schemas", "extra", "--db", "x"])).toEqual({
      ok: false,
      error: "schemas does not accept positional arguments",
    });
    expect(parseQueryArgs(["schemas", "--db", "x", "--schema", "s"])).toEqual({
      ok: false,
      error: "schemas does not accept --schema",
    });
    expect(parseQueryArgs(["schemas", "--db", "x", "--wait"])).toEqual({
      ok: false,
      error: "schemas does not accept --wait",
    });

    const ok = parseQueryArgs(["schemas", "--db", "docker:pg-svc", "--json"]);
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("parse failed");
    expect(ok.args.command).toEqual({
      kind: "schemas",
      db: "docker:pg-svc",
      json: true,
    });
  });

  test("schema accepts --schema/--with-columns/--json, rejects --table", () => {
    expect(parseQueryArgs(["schema"])).toEqual({
      ok: false,
      error: "schema requires --db <path>",
    });
    expect(parseQueryArgs(["schema", "--db", "x", "--table", "t"])).toEqual({
      ok: false,
      error: "schema does not accept --table",
    });
    const ok = parseQueryArgs([
      "schema",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
      "--with-columns",
      "--json",
    ]);
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("parse failed");
    expect(ok.args.command).toEqual({
      kind: "schema",
      db: "docker:pg-svc",
      schema: "analytics",
      withColumns: true,
      json: true,
    });

    const minimal = parseQueryArgs(["schema", "--db", "app.db"]);
    expect(minimal.ok).toBe(true);
    if (!minimal.ok) throw new Error("parse failed");
    expect(minimal.args.command).toEqual({
      kind: "schema",
      db: "app.db",
      schema: undefined,
      withColumns: false,
      json: false,
    });
  });

  test("columns requires --db and --table; --with-columns is rejected", () => {
    expect(parseQueryArgs(["columns", "--db", "x"])).toEqual({
      ok: false,
      error: "columns requires --table <name>",
    });
    expect(
      parseQueryArgs([
        "columns",
        "--db",
        "x",
        "--table",
        "t",
        "--with-columns",
      ]),
    ).toEqual({
      ok: false,
      error: "columns does not accept --with-columns",
    });
    const ok = parseQueryArgs([
      "columns",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
      "--table",
      "events",
      "--json",
    ]);
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("parse failed");
    expect(ok.args.command).toEqual({
      kind: "columns",
      db: "docker:pg-svc",
      schema: "analytics",
      table: "events",
      json: true,
    });
  });

  test("ddl requires --db and --table; mirrors columns surface", () => {
    expect(parseQueryArgs(["ddl", "--db", "x"])).toEqual({
      ok: false,
      error: "ddl requires --table <name>",
    });
    const ok = parseQueryArgs(["ddl", "--db", "app.db", "--table", "users"]);
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("parse failed");
    expect(ok.args.command).toEqual({
      kind: "ddl",
      db: "app.db",
      schema: undefined,
      table: "users",
      json: false,
    });
  });

  test("exec requires --db and --sql", () => {
    expect(parseQueryArgs(["exec"])).toEqual({
      ok: false,
      error: "exec requires --db <path>",
    });
    expect(parseQueryArgs(["exec", "--db", "a.db"])).toEqual({
      ok: false,
      error: "exec requires --sql <sql>",
    });
  });

  test("exec parses optional title, body, --no-save, and --max-rows", () => {
    const result = parseQueryArgs([
      "exec",
      "--db",
      "a.db",
      "--schema",
      "analytics",
      "--sql",
      "SELECT 1",
      "--title",
      "T",
      "--body",
      "B",
      "--no-save",
      "--max-rows",
      "5",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.command).toEqual({
      kind: "exec",
      db: "a.db",
      sql: "SELECT 1",
      schema: "analytics",
      title: "T",
      body: "B",
      save: false,
      maxRows: 5,
    });
  });

  test("exec rejects non-positive-integer --max-rows", () => {
    expect(
      parseQueryArgs([
        "exec",
        "--db",
        "a.db",
        "--sql",
        "SELECT 1",
        "--max-rows",
        "0",
      ]),
    ).toEqual({
      ok: false,
      error: "--max-rows must be a positive integer",
    });
    expect(
      parseQueryArgs([
        "exec",
        "--db",
        "a.db",
        "--sql",
        "SELECT 1",
        "--max-rows",
        "-3",
      ]),
    ).toEqual({
      ok: false,
      error: "--max-rows must be a positive integer",
    });
  });

  test("list and clear accept --schema only when scoped by --db", () => {
    const list = parseQueryArgs([
      "list",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
      "--json",
    ]);
    expect(list.ok).toBe(true);
    if (!list.ok) throw new Error("parse failed");
    expect(list.args.command).toEqual({
      kind: "list",
      json: true,
      db: "docker:pg-svc",
      schema: "analytics",
    });

    const clear = parseQueryArgs([
      "clear",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
    ]);
    expect(clear.ok).toBe(true);
    if (!clear.ok) throw new Error("parse failed");
    expect(clear.args.command).toEqual({
      kind: "clear",
      db: "docker:pg-svc",
      schema: "analytics",
    });
    expect(parseQueryArgs(["list", "--schema", "analytics"])).toEqual({
      ok: false,
      error: "list --schema requires --db <path>",
    });
    expect(parseQueryArgs(["clear", "--schema", "analytics"])).toEqual({
      ok: false,
      error: "clear --schema requires --db <path>",
    });
  });

  test("snapshot create requires --db, splits --tables on commas, --note is optional", () => {
    expect(parseQueryArgs(["snapshot", "create"])).toEqual({
      ok: false,
      error: "snapshot create requires --db <path>",
    });
    const result = parseQueryArgs([
      "snapshot",
      "create",
      "--db",
      "app.db",
      "--tables",
      " users , orders , ,",
      "--note",
      "before",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.command).toEqual({
      kind: "snapshot-create",
      db: "app.db",
      tables: ["users", "orders"],
      note: "before",
      wait: false,
      timeoutSec: 120,
      json: false,
    });
  });

  test("snapshot create without --tables omits the field (server scans every table)", () => {
    const result = parseQueryArgs(["snapshot", "create", "--db", "app.db"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    const command = result.args.command as Extract<
      QueryCommand,
      { kind: "snapshot-create" }
    >;
    expect(command.tables).toBeUndefined();
    expect(command.note).toBe("");
    // defaults for the new wait-related flags
    expect(command.wait).toBe(false);
    expect(command.timeoutSec).toBe(120);
    expect(command.json).toBe(false);
  });

  test("snapshot create --wait --json --timeout 30 maps cleanly to the SnapshotCreate command", () => {
    const result = parseQueryArgs([
      "snapshot",
      "create",
      "--db",
      "app.db",
      "--tables",
      "users",
      "--wait",
      "--json",
      "--timeout",
      "30",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.command).toEqual({
      kind: "snapshot-create",
      db: "app.db",
      tables: ["users"],
      note: "",
      wait: true,
      timeoutSec: 30,
      json: true,
    });
  });

  test("snapshot create rejects non-positive --timeout at parse time", () => {
    for (const bad of ["0", "-5"]) {
      expect(
        parseQueryArgs([
          "snapshot",
          "create",
          "--db",
          "app.db",
          "--timeout",
          bad,
        ]),
      ).toEqual({
        ok: false,
        error: "--timeout must be a positive integer (sec)",
      });
    }
  });

  test("snapshot create with --schema carries the schema onto the command", () => {
    const result = parseQueryArgs([
      "snapshot",
      "create",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
      "--tables",
      "events",
      "--note",
      "before",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    const command = result.args.command as Extract<
      QueryCommand,
      { kind: "snapshot-create" }
    >;
    expect(command.schema).toBe("analytics");
    expect(command.db).toBe("docker:pg-svc");
    expect(command.tables).toEqual(["events"]);
  });

  test("snapshot create without --schema leaves the field undefined (no-op for non-PG sources)", () => {
    const result = parseQueryArgs(["snapshot", "create", "--db", "app.db"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    const command = result.args.command as Extract<
      QueryCommand,
      { kind: "snapshot-create" }
    >;
    expect(command.schema).toBeUndefined();
  });

  test("snapshot list parses --db and --json", () => {
    const result = parseQueryArgs([
      "snapshot",
      "list",
      "--db",
      "app.db",
      "--json",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.command).toEqual({
      kind: "snapshot-list",
      db: "app.db",
      schema: undefined,
      json: true,
    });
  });

  test("snapshot list accepts --schema with or without --db", () => {
    const withBoth = parseQueryArgs([
      "snapshot",
      "list",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
    ]);
    expect(withBoth.ok).toBe(true);
    if (!withBoth.ok) throw new Error("parse failed");
    expect(withBoth.args.command).toEqual({
      kind: "snapshot-list",
      db: "docker:pg-svc",
      schema: "analytics",
      json: false,
    });

    // --schema only (no --db): valid; the CLI sends ?schema=... to filter
    // every db's snapshots down to that schema.
    const schemaOnly = parseQueryArgs([
      "snapshot",
      "list",
      "--schema",
      "analytics",
    ]);
    expect(schemaOnly.ok).toBe(true);
    if (!schemaOnly.ok) throw new Error("parse failed");
    expect(schemaOnly.args.command).toEqual({
      kind: "snapshot-list",
      db: undefined,
      schema: "analytics",
      json: false,
    });
  });

  test("snapshot delete requires --id", () => {
    expect(parseQueryArgs(["snapshot", "delete"])).toEqual({
      ok: false,
      error: "snapshot delete requires --id <snapshot-id>",
    });
    const result = parseQueryArgs(["snapshot", "delete", "--id", "snap-1"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.command).toEqual({
      kind: "snapshot-delete",
      id: "snap-1",
    });
  });

  test("snapshot note requires both --id and --note (empty string allowed)", () => {
    expect(parseQueryArgs(["snapshot", "note", "--id", "snap-1"])).toEqual({
      ok: false,
      error: "snapshot note requires --note <text>",
    });
    const result = parseQueryArgs([
      "snapshot",
      "note",
      "--id",
      "snap-1",
      "--note",
      "",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.command).toEqual({
      kind: "snapshot-note",
      id: "snap-1",
      note: "",
    });
  });

  test("diff tables requires --before and --after", () => {
    expect(parseQueryArgs(["diff", "tables"])).toEqual({
      ok: false,
      error: "diff tables requires --before <id> and --after <id>",
    });
    const result = parseQueryArgs([
      "diff",
      "tables",
      "--before",
      "snap-a",
      "--after",
      "snap-b",
      "--json",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.command).toEqual({
      kind: "diff-tables",
      before: "snap-a",
      after: "snap-b",
      json: true,
    });
  });

  test("diff rows requires --before, --after, and --table; limit/offset are validated", () => {
    expect(
      parseQueryArgs(["diff", "rows", "--before", "a", "--after", "b"]),
    ).toEqual({
      ok: false,
      error: "diff rows requires --before <id>, --after <id>, --table <name>",
    });
    expect(
      parseQueryArgs([
        "diff",
        "rows",
        "--before",
        "a",
        "--after",
        "b",
        "--table",
        "users",
        "--limit",
        "0",
      ]),
    ).toEqual({
      ok: false,
      error: "--limit must be a positive integer",
    });
    expect(
      parseQueryArgs([
        "diff",
        "rows",
        "--before",
        "a",
        "--after",
        "b",
        "--table",
        "users",
        "--offset",
        "-1",
      ]),
    ).toEqual({
      ok: false,
      error: "--offset must be a non-negative integer",
    });
    const result = parseQueryArgs([
      "diff",
      "rows",
      "--before",
      "a",
      "--after",
      "b",
      "--table",
      "users",
      "--limit",
      "50",
      "--offset",
      "10",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.command).toEqual({
      kind: "diff-rows",
      before: "a",
      after: "b",
      table: "users",
      limit: 50,
      offset: 10,
      json: false,
    });
  });

  test("search requires --db and --term; flags map onto SearchCommand", () => {
    expect(parseQueryArgs(["search"])).toEqual({
      ok: false,
      error: "search requires --db <path>",
    });
    expect(parseQueryArgs(["search", "--db", "app.db"])).toEqual({
      ok: false,
      error: "search requires --term <text>",
    });
    const result = parseQueryArgs([
      "search",
      "--db",
      "app.db",
      "--term",
      "needle",
      "--tables",
      "users, orders",
      "--include-non-text",
      "--max-hits",
      "20",
      "--schema",
      "public",
      "--json",
      "--timeout",
      "10",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.command).toEqual({
      kind: "search",
      db: "app.db",
      term: "needle",
      tables: ["users", "orders"],
      schema: "public",
      includeNonText: true,
      maxHits: 20,
      timeoutSec: 10,
      json: true,
    });
  });

  test("search defaults: includeNonText=false, json=false, timeoutSec=60, tables/schema/maxHits undefined", () => {
    const result = parseQueryArgs(["search", "--db", "app.db", "--term", "x"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.command).toEqual({
      kind: "search",
      db: "app.db",
      term: "x",
      tables: undefined,
      schema: undefined,
      includeNonText: false,
      maxHits: undefined,
      timeoutSec: 60,
      json: false,
    });
  });

  test("search rejects non-positive --max-hits and --timeout", () => {
    for (const [flag, msg] of [
      ["--max-hits", "--max-hits must be a positive integer"],
      ["--timeout", "--timeout must be a positive integer (sec)"],
    ] as const) {
      expect(
        parseQueryArgs(["search", "--db", "app.db", "--term", "x", flag, "0"]),
      ).toEqual({ ok: false, error: msg });
      expect(
        parseQueryArgs(["search", "--db", "app.db", "--term", "x", flag, "-1"]),
      ).toEqual({ ok: false, error: msg });
    }
  });

  test("unknown subcommand names are rejected", () => {
    expect(parseQueryArgs(["wat"])).toEqual({
      ok: false,
      error: "unknown query command: wat",
    });
    expect(parseQueryArgs(["snapshot", "wat"])).toEqual({
      ok: false,
      error: "unknown snapshot subcommand: wat",
    });
    expect(parseQueryArgs(["diff", "wat"])).toEqual({
      ok: false,
      error: "unknown diff subcommand: wat",
    });
  });

  test("--cwd and --server are absorbed as global options without affecting subcommand parsing", () => {
    const result = parseQueryArgs([
      "--cwd",
      "/tmp/x",
      "--server",
      "http://localhost:9999",
      "snapshot",
      "list",
      "--db",
      "app.db",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.cwd).toBe("/tmp/x");
    expect(result.args.server).toBe("http://localhost:9999");
    expect(result.args.command).toEqual({
      kind: "snapshot-list",
      db: "app.db",
      json: false,
    });
  });
});

describe("shellSingleQuote", () => {
  test("wraps plain values in single quotes", () => {
    expect(shellSingleQuote("app.db")).toBe("'app.db'");
    expect(shellSingleQuote("docker:pg-svc")).toBe("'docker:pg-svc'");
    expect(shellSingleQuote("docker:s3-svc/sample-bucket")).toBe(
      "'docker:s3-svc/sample-bucket'",
    );
  });

  test("preserves spaces, colons, slashes, and shell metacharacters as literals", () => {
    // POSIX '...' は内部を全て literal にするので、 $ ` \ * など shell が
    // 通常解釈するメタも素通しになる。bash/zsh で同じ。
    expect(shellSingleQuote("path with space")).toBe("'path with space'");
    expect(shellSingleQuote("$VAR `cmd` \\n")).toBe("'$VAR `cmd` \\n'");
    expect(shellSingleQuote("a*b?c|d")).toBe("'a*b?c|d'");
  });

  test("escapes embedded single quotes by closing+reopening ('\\'')", () => {
    // 'sample's path' を表すには 'sample'\''s path' と書く必要がある。
    // bash/zsh/sh 全てで同じ規則。
    expect(shellSingleQuote("sample's path")).toBe("'sample'\\''s path'");
    expect(shellSingleQuote("'")).toBe("''\\'''");
    expect(shellSingleQuote("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  test("handles empty string", () => {
    expect(shellSingleQuote("")).toBe("''");
  });
});

describe("QUERY_HELP / QUERY_AGENT_HELP", () => {
  test("documents only the subcommands that are actually wired", () => {
    // help text must NOT mention "diff create / diff delete / diff list" —
    // those subcommands were advertised before but returned
    // `unknown query command: ...` at runtime. Keeping the docs honest is
    // the core point of this guard.
    for (const text of [QUERY_HELP, QUERY_AGENT_HELP]) {
      expect(/diff create/.test(text)).toBe(false);
      expect(/diff delete/.test(text)).toBe(false);
      expect(/diff list/.test(text)).toBe(false);
      // The implemented commands MUST appear.
      expect(text).toMatch(/snapshot create/);
      expect(text).toMatch(/snapshot list/);
      expect(text).toMatch(/diff tables/);
      expect(text).toMatch(/diff rows/);
      // search is now a real subcommand — it must appear everywhere.
      expect(text).toMatch(/code-viewer query search /);
    }
    // QUERY_HELP (the short usage) must list search as a callable subcommand.
    expect(/^\s+code-viewer query search /m.test(QUERY_HELP)).toBe(true);
    // QUERY_AGENT_HELP must not claim search is unwired anymore.
    expect(/Not yet wired in the CLI/.test(QUERY_AGENT_HELP)).toBe(false);
    expect(/list with: code-viewer query list/.test(QUERY_AGENT_HELP)).toBe(
      false,
    );
    // Source discovery is now a wired subcommand. The previous guard asserted
    // that `query list` is described as NOT being a discovery path; that
    // intent is now expressed as a positive guard: the agent guide must point
    // at `code-viewer query sources` as the discovery entry point.
    expect(QUERY_AGENT_HELP).toMatch(/code-viewer query sources/);
    // Both helps must list `sources` as a real subcommand.
    for (const text of [QUERY_HELP, QUERY_AGENT_HELP]) {
      expect(text).toMatch(/code-viewer query sources/);
    }
    // The output contract must document the search exit semantics so agents
    // know an empty result is a clean exit 0.
    expect(QUERY_AGENT_HELP).toMatch(
      /search:[\s\S]*Empty result[\s\S]*exit 0/i,
    );
  });
});

// --- runQueryCli integration tests (fetch mocked) ---

type RequestRecord = {
  url: string;
  method: string;
  body: unknown;
};

type CapturedExit = number;

const originalFetch = globalThis.fetch;
let originalExit: typeof process.exit | null = null;
let originalLog: typeof console.log | null = null;
let originalErr: typeof console.error | null = null;

function installRunHarness(
  responses: Array<{ status?: number; contentType?: string; body: string }>,
): {
  requests: RequestRecord[];
  logs: string[];
  errs: string[];
  exits: CapturedExit[];
} {
  const requests: RequestRecord[] = [];
  const logs: string[] = [];
  const errs: string[] = [];
  const exits: CapturedExit[] = [];

  // 順番に消費する fake fetch。server health probe を最初に消費する。
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
  // `process.exit` is typed as `(code?: number) => never`. The harness needs
  // to short-circuit without actually terminating the test process, so we
  // throw a marker that the test can catch — TypeScript still sees `never`
  // because we satisfy the signature.
  process.exit = ((code?: number) => {
    exits.push(typeof code === "number" ? code : 0);
    throw new ExitMarker(code ?? 0);
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

class ExitMarker extends Error {
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

async function runAndCatchExit(argv: string[]): Promise<void> {
  try {
    await runQueryCli(argv);
  } catch (err) {
    if (err instanceof ExitMarker) return;
    throw err;
  }
}

describe("runQueryCli integration", () => {
  const SERVER = "http://localhost:65535";

  // sources は ensureServerUrl の cheap health probe と body の双方で fetch する。
  // /_db/files discovery 自体は body fetch の 1 回だけに抑える。
  test("query sources --json emits the /_db/files response verbatim", async () => {
    const payload = {
      files: [
        {
          id: "app.db",
          path: "app.db",
          name: "app.db",
          sizeBytes: 1024,
          kind: "sqlite",
        },
        {
          id: "docker:pg-svc",
          path: "docker:pg-svc",
          name: "pg-svc (postgresql)",
          sizeBytes: 0,
          kind: "postgresql",
        },
        {
          id: "docker:s3-svc/sample-bucket",
          path: "docker:s3-svc/sample-bucket",
          name: "sample-bucket (s3)",
          sizeBytes: 0,
          kind: "s3",
        },
      ],
    };
    const harness = installRunHarness([
      // health probe (ensureServerUrl)
      { body: JSON.stringify({ files: [] }) },
      // body fetch
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit(["--server", SERVER, "sources", "--json"]);

    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[0].url).toBe(`${SERVER}/`);
    expect(harness.requests[1].url).toBe(`${SERVER}/_db/files`);
    expect(harness.requests[1].method).toBe("GET");
    expect(harness.exits).toEqual([]);
    expect(JSON.parse(harness.logs.join("\n"))).toEqual(payload);
  });

  test("query sources (default) prints id/kind/name lines for each source", async () => {
    const payload = {
      files: [
        {
          id: "app.db",
          path: "app.db",
          name: "app.db",
          sizeBytes: 100,
          kind: "sqlite",
        },
        {
          id: "docker:pg-svc",
          path: "docker:pg-svc",
          name: "pg-svc (postgresql)",
          sizeBytes: 0,
          kind: "postgresql",
        },
      ],
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit(["--server", SERVER, "sources"]);

    expect(harness.exits).toEqual([]);
    const lines = harness.logs;
    // 2 sources → 2 行。順序はサーバ応答順を保つ。
    expect(lines).toEqual([
      "app.db\tsqlite\tapp.db",
      "docker:pg-svc\tpostgresql\tpg-svc (postgresql)",
    ]);
  });

  test("query sources surfaces truncated / dockerError as stdout '#' notes (default mode)", async () => {
    const payload = {
      files: [
        {
          id: "app.db",
          path: "app.db",
          name: "app.db",
          sizeBytes: 100,
          kind: "sqlite",
        },
      ],
      truncated: true,
      dockerError: "compose ps failed: docker daemon unreachable",
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit(["--server", SERVER, "sources"]);

    expect(harness.exits).toEqual([]);
    expect(harness.errs).toEqual([]);
    const out = harness.logs.join("\n");
    expect(out).toMatch(/^app\.db\tsqlite\tapp\.db$/m);
    expect(out).toMatch(/^# truncated:/m);
    expect(out).toMatch(
      /^# dockerError: compose ps failed: docker daemon unreachable$/m,
    );
  });

  test("query sources (default) on empty server prints a no-sources notice and exits 0", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify({ files: [] }) },
    ]);

    await runAndCatchExit(["--server", SERVER, "sources"]);

    expect(harness.exits).toEqual([]);
    expect(harness.logs).toEqual(["no datastore sources discovered"]);
  });

  test("query sources --commands emits shell-pasteable next-step commands per source", async () => {
    // mixed-kind discovery: sqlite + postgresql + mysql + s3。
    //   sqlite/mysql → schema + exec の 2 行
    //   postgresql → schemas (multi-schema) を追加した 3 行
    //   s3 → SQL command ではなく browser-pane hint
    const payload = {
      files: [
        {
          id: "app.db",
          path: "app.db",
          name: "app.db",
          sizeBytes: 1024,
          kind: "sqlite",
        },
        {
          id: "docker:pg-svc",
          path: "docker:pg-svc",
          name: "pg-svc (postgresql)",
          sizeBytes: 0,
          kind: "postgresql",
        },
        {
          id: "docker:s3-svc/sample-bucket",
          path: "docker:s3-svc/sample-bucket",
          name: "sample-bucket (s3)",
          sizeBytes: 0,
          kind: "s3",
        },
        {
          id: "docker:mysql-svc",
          path: "docker:mysql-svc",
          name: "mysql-svc (mysql)",
          sizeBytes: 0,
          kind: "mysql",
        },
      ],
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit(["--server", SERVER, "sources", "--commands"]);

    expect(harness.exits).toEqual([]);
    expect(harness.errs).toEqual([]);
    const out = harness.logs.join("\n");
    // 各 source heading は # で始まり ordinal が付く。db id と server URL は
    // 必ず single-quote。各 SQL 行は --server '<SERVER>' を pin する。
    expect(out).toMatch(/^# source 1: app\.db \(sqlite\)$/m);
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' schema --db 'app\.db' --with-columns --json$/m,
    );
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' exec --db 'app\.db' --sql "SELECT 1" --no-save$/m,
    );
    // sqlite にも query history と snapshot store への paste-safe entrypoint
    // が出る。browser tab を開かずに既存の調査履歴へ進める。
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' list --db 'app\.db' --json$/m,
    );
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' snapshot list --db 'app\.db' --json$/m,
    );
    // sqlite には schemas 行が出ない。
    expect(/query schemas --db 'app\.db'/.test(out)).toBe(false);

    expect(out).toMatch(/^# source 2: docker:pg-svc \(postgresql\)$/m);
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' schemas --db 'docker:pg-svc' --json$/m,
    );
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' schema --db 'docker:pg-svc' --with-columns --json$/m,
    );
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' list --db 'docker:pg-svc' --json$/m,
    );
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' snapshot list --db 'docker:pg-svc' --json$/m,
    );

    expect(out).toMatch(/^# source 3: docker:s3-svc\/sample-bucket \(s3\)$/m);
    expect(out).toMatch(
      /^# s3: use the browser Datastores tab; query schema\/exec commands are SQL-only$/m,
    );
    // s3 は SQL source ではないので schema/exec/list/snapshot 行を出さない。
    expect(/query schema --db 'docker:s3-svc/.test(out)).toBe(false);
    expect(/query exec --db 'docker:s3-svc/.test(out)).toBe(false);
    expect(/query list --db 'docker:s3-svc/.test(out)).toBe(false);
    expect(/query snapshot list --db 'docker:s3-svc/.test(out)).toBe(false);

    expect(out).toMatch(/^# source 4: docker:mysql-svc \(mysql\)$/m);
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' schema --db 'docker:mysql-svc' --with-columns --json$/m,
    );
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' exec --db 'docker:mysql-svc' --sql "SELECT 1" --no-save$/m,
    );
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' list --db 'docker:mysql-svc' --json$/m,
    );
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' snapshot list --db 'docker:mysql-svc' --json$/m,
    );
    // MySQL はこの server の /_db/schemas では multi-schema 扱いしない。
    expect(/query schemas --db 'docker:mysql-svc'/.test(out)).toBe(false);
    // 全 SQL 行で --server prefix が付いていることを regression guard。
    // (auto-discovery に逸れて別 server / no server に流れない保証)
    const sqlLines = out
      .split("\n")
      .filter((line) => line.startsWith("code-viewer query"));
    // postgresql=5 (schemas+schema+exec+list+snapshot list) +
    //   sqlite=4 (schema+exec+list+snapshot list) +
    //   mysql=4  (schema+exec+list+snapshot list) = 13 SQL 行が出る。
    // s3 は SQL command を一切出さない。
    expect(sqlLines).toHaveLength(13);
    const missingPrefix = sqlLines.filter(
      (line) => !line.startsWith("code-viewer query --server '"),
    );
    expect(missingPrefix).toEqual([]);
  });

  test("query sources --commands single-quotes ids containing spaces and quotes", async () => {
    // path に空白と ' を含むケース。POSIX '...' 内で ' を出すには '\'' に展開。
    const payload = {
      files: [
        {
          id: "sample's data.db",
          path: "sample's data.db",
          name: "sample's data.db",
          sizeBytes: 2048,
          kind: "sqlite",
        },
      ],
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit(["--server", SERVER, "sources", "--commands"]);

    expect(harness.exits).toEqual([]);
    const out = harness.logs.join("\n");
    // heading は生 id (notice 用)、command は quote 済み。--server prefix も付く。
    expect(out).toMatch(/^# source 1: sample's data\.db \(sqlite\)$/m);
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' schema --db 'sample'\\''s data\.db' --with-columns --json$/m,
    );
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' exec --db 'sample'\\''s data\.db' --sql "SELECT 1" --no-save$/m,
    );
    // 追加の query history / snapshot list entrypoint も同じ paste-safety を満たす。
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' list --db 'sample'\\''s data\.db' --json$/m,
    );
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535' snapshot list --db 'sample'\\''s data\.db' --json$/m,
    );
  });

  test("query sources --commands single-quotes the server URL itself when it contains spaces", async () => {
    // --server URL に空白を含むケース。ensureServerUrl は trailing slash を
    // 剥がすだけで、内部 path はそのまま resolved serverUrl に渡される。
    // shellSingleQuote が URL にも効いて貼り付け安全になることを検証する。
    const SERVER_WITH_SPACE = "http://localhost:65535/with space/";
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          files: [
            {
              id: "app.db",
              path: "app.db",
              name: "app.db",
              sizeBytes: 1024,
              kind: "sqlite",
            },
          ],
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER_WITH_SPACE,
      "sources",
      "--commands",
    ]);

    expect(harness.exits).toEqual([]);
    const out = harness.logs.join("\n");
    // trailing slash は ensureServerUrl で剥がされ "http://localhost:65535/with space"
    // が resolved serverUrl になる。space を含む URL も single-quote 内で literal。
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535\/with space' schema --db 'app\.db' --with-columns --json$/m,
    );
    expect(out).toMatch(
      /^code-viewer query --server 'http:\/\/localhost:65535\/with space' exec --db 'app\.db' --sql "SELECT 1" --no-save$/m,
    );
  });

  test("query sources --commands preserves truncated / dockerError notices at the tail", async () => {
    const payload = {
      files: [
        {
          id: "app.db",
          path: "app.db",
          name: "app.db",
          sizeBytes: 100,
          kind: "sqlite",
        },
      ],
      truncated: true,
      dockerError: "compose ps failed: docker daemon unreachable",
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit(["--server", SERVER, "sources", "--commands"]);

    expect(harness.exits).toEqual([]);
    const out = harness.logs.join("\n");
    expect(out).toMatch(/^# source 1: app\.db \(sqlite\)$/m);
    expect(out).toMatch(/^# truncated:/m);
    expect(out).toMatch(
      /^# dockerError: compose ps failed: docker daemon unreachable$/m,
    );
  });

  test("query sources --commands keeps source notices single-line for pasted command blocks", async () => {
    const payload = {
      files: [
        {
          id: "sample\tdata.db",
          path: "sample\tdata.db",
          name: "sample\tdata.db",
          sizeBytes: 100,
          kind: "sqlite",
        },
      ],
      dockerError: "compose ps failed\nsecond line\twith tab",
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit(["--server", SERVER, "sources", "--commands"]);

    expect(harness.exits).toEqual([]);
    const lines = harness.logs.join("\n").split("\n");
    expect(lines.includes("# source 1: sample data.db (sqlite)")).toBe(true);
    expect(
      lines.includes("# dockerError: compose ps failed second line with tab"),
    ).toBe(true);
    expect(lines.includes("second line\twith tab")).toBe(false);
    expect(
      lines.every(
        (line) =>
          line === "" ||
          line.startsWith("#") ||
          line.startsWith("code-viewer query"),
      ),
    ).toBe(true);
  });

  test("query sources --commands on empty server explains why nothing is shown", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify({ files: [] }) },
    ]);

    await runAndCatchExit(["--server", SERVER, "sources", "--commands"]);

    expect(harness.exits).toEqual([]);
    // 空の場合は # コメント1行だけ。default mode と違って解説を含める。
    expect(harness.logs).toEqual([
      "# no datastore sources discovered — start a service or check docker-compose",
    ]);
  });

  test("query exec --schema forwards schema in the query body", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          dbId: "docker:pg-svc",
          schema: "analytics",
          columns: ["id"],
          columnTypes: ["int4"],
          rows: [[1]],
          rowCount: 1,
          truncated: false,
          elapsedMs: 7,
          executedSql: ["SELECT 1"],
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "exec",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
      "--sql",
      "SELECT 1",
      "--no-save",
      "--max-rows",
      "5",
    ]);

    expect(harness.requests[1].url).toBe(`${SERVER}/_db/query`);
    expect(harness.requests[1].method).toBe("POST");
    expect(harness.requests[1].body).toEqual({
      db: "docker:pg-svc",
      schema: "analytics",
      sql: "SELECT 1",
      saveHistory: false,
      executedBy: "ai",
      source: "cli",
      maxRows: 5,
    });
    expect(JSON.parse(harness.logs.join("\n"))).toEqual({
      dbId: "docker:pg-svc",
      schema: "analytics",
      columns: ["id"],
      columnTypes: ["int4"],
      rows: [[1]],
      rowCount: 1,
      truncated: false,
      elapsedMs: 7,
      executedSql: ["SELECT 1"],
    });
  });

  test("query exec output passes through truncated/columnTypes/executedSql verbatim", async () => {
    // server が truncated=true を返したら CLI も truncated=true を残し、
    // AI agent が「LIMIT を拡張して再実行する」判断材料にできるかを検証する。
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          dbId: "sample.db",
          columns: ["id", "label"],
          columnTypes: ["INTEGER", "TEXT"],
          rows: [
            [1, "alpha"],
            [2, "beta"],
          ],
          rowCount: 2,
          truncated: true,
          elapsedMs: 12,
          executedSql: ["SELECT id, label FROM sample_table LIMIT 2"],
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "exec",
      "--db",
      "sample.db",
      "--sql",
      "SELECT id, label FROM sample_table LIMIT 2",
      "--no-save",
      "--max-rows",
      "2",
    ]);

    expect(harness.exits).toEqual([]);
    const parsed = JSON.parse(harness.logs.join("\n"));
    expect(parsed.dbId).toBe("sample.db");
    expect(parsed.columns).toEqual(["id", "label"]);
    expect(parsed.columnTypes).toEqual(["INTEGER", "TEXT"]);
    expect(parsed.rowCount).toBe(2);
    expect(parsed.truncated).toBe(true);
    expect(parsed.executedSql).toEqual([
      "SELECT id, label FROM sample_table LIMIT 2",
    ]);
    // schema は server が返さなかったので CLI 出力にも含まれない
    // (undefined を JSON に焼かない)。
    expect("schema" in parsed).toBe(false);
  });

  test("query exec output omits optional fields when server did not return them", async () => {
    // 古い server / 非 PG が schema / executedSql を返さないケース。
    // 残りの必須フィールド (truncated 等) は素通しされ、optional は欠落するだけ。
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          dbId: "sample.db",
          columns: [],
          columnTypes: [],
          rows: [],
          rowCount: 0,
          truncated: false,
          elapsedMs: 1,
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "exec",
      "--db",
      "sample.db",
      "--sql",
      "SELECT 1 WHERE 0",
      "--no-save",
    ]);

    const parsed = JSON.parse(harness.logs.join("\n"));
    expect(parsed).toEqual({
      dbId: "sample.db",
      columns: [],
      columnTypes: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      elapsedMs: 1,
    });
    expect("schema" in parsed).toBe(false);
    expect("executedSql" in parsed).toBe(false);
  });

  test("query schemas --json emits the /_db/schemas response verbatim", async () => {
    const payload = {
      dbId: "docker:pg-svc",
      schemas: [{ name: "public" }, { name: "analytics" }],
      selectedSchema: "public",
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "schemas",
      "--db",
      "docker:pg-svc",
      "--json",
    ]);

    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[1].url).toBe(
      `${SERVER}/_db/schemas?db=docker%3Apg-svc`,
    );
    expect(harness.requests[1].method).toBe("GET");
    expect(harness.exits).toEqual([]);
    expect(JSON.parse(harness.logs.join("\n"))).toEqual(payload);
  });

  test("query schemas (default) prints one schema name per line", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          dbId: "docker:pg-svc",
          schemas: [{ name: "public" }, { name: "analytics" }],
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "schemas",
      "--db",
      "docker:pg-svc",
    ]);

    expect(harness.exits).toEqual([]);
    expect(harness.logs).toEqual(["public", "analytics"]);
  });

  test("query schemas notifies when the engine has no multi-schema concept", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify({ dbId: "app.db", schemas: [] }) },
    ]);

    await runAndCatchExit(["--server", SERVER, "schemas", "--db", "app.db"]);

    expect(harness.exits).toEqual([]);
    expect(harness.logs).toEqual([
      "no schemas (engine has no multi-schema concept)",
    ]);
  });

  test("query schema --with-columns forwards includeColumns=1", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          dbId: "docker:pg-svc",
          schema: "analytics",
          tables: [],
          indexes: [],
          foreignKeys: [],
          columnsMap: {},
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "schema",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
      "--with-columns",
      "--json",
    ]);

    expect(harness.requests[1].url).toBe(
      `${SERVER}/_db/schema?db=docker%3Apg-svc&schema=analytics&includeColumns=1`,
    );
  });

  test("query schema --json (sqlite, no --schema) enriches tables[] with paste-safe columns/ddl commands", async () => {
    // SQLite なので response の schema は undefined。--schema 引数も無い。
    // 追加される 2 コマンドには --schema が混入してはならない。top-level
    // (dbId / indexes / foreignKeys / executedSql) は素通し。
    const payload = {
      dbId: "app.db",
      tables: [
        { name: "sample_table", type: "table", rowCount: 42 },
        { name: "sample_view", type: "view", rowCount: null },
      ],
      indexes: [
        {
          table: "sample_table",
          name: "sample_idx",
          columns: ["id"],
          unique: false,
        },
      ],
      foreignKeys: [],
      executedSql: ["SELECT ... FROM sqlite_master"],
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "schema",
      "--db",
      "app.db",
      "--json",
    ]);

    expect(harness.exits).toEqual([]);
    expect(JSON.parse(harness.logs[0])).toEqual({
      dbId: "app.db",
      tables: [
        {
          name: "sample_table",
          type: "table",
          rowCount: 42,
          columnsCommand:
            "code-viewer query --server 'http://localhost:65535' columns --db 'app.db' --table 'sample_table' --json",
          ddlCommand:
            "code-viewer query --server 'http://localhost:65535' ddl --db 'app.db' --table 'sample_table' --json",
        },
        {
          name: "sample_view",
          type: "view",
          rowCount: null,
          columnsCommand:
            "code-viewer query --server 'http://localhost:65535' columns --db 'app.db' --table 'sample_view' --json",
          ddlCommand:
            "code-viewer query --server 'http://localhost:65535' ddl --db 'app.db' --table 'sample_view' --json",
        },
      ],
      indexes: [
        {
          table: "sample_table",
          name: "sample_idx",
          columns: ["id"],
          unique: false,
        },
      ],
      foreignKeys: [],
      executedSql: ["SELECT ... FROM sqlite_master"],
    });
  });

  test("query schema --json with --with-columns preserves columnsMap and uses data.schema for --schema pinning", async () => {
    // PG response: server が解決した data.schema を優先する。--with-columns
    // 経由の columnsMap は素通し。tables[] への enrich は additive で、
    // --schema 'analytics' が columnsCommand / ddlCommand に必ず含まれる。
    const payload = {
      dbId: "docker:pg-svc",
      schema: "analytics",
      tables: [{ name: "events", type: "table", rowCount: 7 }],
      indexes: [],
      foreignKeys: [],
      columnsMap: {
        events: [
          {
            name: "id",
            type: "int8",
            nullable: false,
            primaryKey: true,
            defaultValue: null,
          },
        ],
      },
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "schema",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
      "--with-columns",
      "--json",
    ]);

    expect(harness.exits).toEqual([]);
    const parsed = JSON.parse(harness.logs[0]);
    // top-level は素通し (columnsMap 含む)。
    expect(parsed.dbId).toBe("docker:pg-svc");
    expect(parsed.schema).toBe("analytics");
    expect(parsed.columnsMap).toEqual(payload.columnsMap);
    expect(parsed.indexes).toEqual([]);
    expect(parsed.foreignKeys).toEqual([]);
    // tables[] は additive enrich。table 名・既存フィールドは保存。
    expect(parsed.tables).toEqual([
      {
        name: "events",
        type: "table",
        rowCount: 7,
        columnsCommand:
          "code-viewer query --server 'http://localhost:65535' columns --db 'docker:pg-svc' --schema 'analytics' --table 'events' --json",
        ddlCommand:
          "code-viewer query --server 'http://localhost:65535' ddl --db 'docker:pg-svc' --schema 'analytics' --table 'events' --json",
      },
    ]);
  });

  test("query schema --json prefers server-resolved data.schema over the --schema argument", async () => {
    // CLI の --schema と server-resolved schema が食い違っても、
    // response の data.schema を優先する。enrich はその
    // 解決済み値を使う ── そうすると AI が columnsCommand を貼って実行する時
    // も同じ schema を見に行く。
    const payload = {
      dbId: "docker:pg-svc",
      schema: "public",
      tables: [{ name: "items", type: "table", rowCount: 3 }],
      indexes: [],
      foreignKeys: [],
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "schema",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
      "--json",
    ]);

    const parsed = JSON.parse(harness.logs[0]);
    expect(parsed.tables[0].columnsCommand).toBe(
      "code-viewer query --server 'http://localhost:65535' columns --db 'docker:pg-svc' --schema 'public' --table 'items' --json",
    );
    expect(parsed.tables[0].ddlCommand).toBe(
      "code-viewer query --server 'http://localhost:65535' ddl --db 'docker:pg-svc' --schema 'public' --table 'items' --json",
    );
  });

  test("query schema --json single-quotes db/schema/table with spaces and single quotes", async () => {
    // db id・schema 名・table 名すべてに空白と ' が混じるケース。POSIX '...'
    // の '\'' 展開で paste-safe になっていることを behavior で確認する。
    const payload = {
      dbId: "sample's data.db",
      schema: "weird schema",
      tables: [{ name: "sample's table", type: "table", rowCount: 1 }],
      indexes: [],
      foreignKeys: [],
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "schema",
      "--db",
      "sample's data.db",
      "--schema",
      "weird schema",
      "--json",
    ]);

    const parsed = JSON.parse(harness.logs[0]);
    expect(parsed.tables[0].columnsCommand).toBe(
      "code-viewer query --server 'http://localhost:65535' columns --db 'sample'\\''s data.db' --schema 'weird schema' --table 'sample'\\''s table' --json",
    );
    expect(parsed.tables[0].ddlCommand).toBe(
      "code-viewer query --server 'http://localhost:65535' ddl --db 'sample'\\''s data.db' --schema 'weird schema' --table 'sample'\\''s table' --json",
    );
  });

  test("query schema (default) prints name/type/rowCount per table", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          dbId: "app.db",
          tables: [
            { name: "users", type: "table", rowCount: 42 },
            { name: "user_view", type: "view", rowCount: null },
          ],
          indexes: [],
          foreignKeys: [],
        }),
      },
    ]);

    await runAndCatchExit(["--server", SERVER, "schema", "--db", "app.db"]);

    expect(harness.requests[1].url).toBe(`${SERVER}/_db/schema?db=app.db`);
    expect(harness.exits).toEqual([]);
    // default mode は table summary line だけ。command hint は --json 専用で、
    // default の stdout には漏らさない (AI-parseable な tab-separated 行を守る)。
    expect(harness.logs).toEqual(["users\ttable\t42", "user_view\tview\t-"]);
    const out = harness.logs.join("\n");
    expect(/columnsCommand/.test(out)).toBe(false);
    expect(/ddlCommand/.test(out)).toBe(false);
    expect(/code-viewer query --server/.test(out)).toBe(false);
  });

  test("query columns (default) prints name/type/nullable/pk/default", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          dbId: "app.db",
          table: "users",
          columns: [
            {
              name: "id",
              type: "INTEGER",
              nullable: false,
              primaryKey: true,
              defaultValue: null,
            },
            {
              name: "email",
              type: "TEXT",
              nullable: true,
              primaryKey: false,
              defaultValue: "''",
            },
          ],
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "columns",
      "--db",
      "app.db",
      "--table",
      "users",
    ]);

    expect(harness.requests[1].url).toBe(
      `${SERVER}/_db/columns?db=app.db&table=users`,
    );
    expect(harness.logs).toEqual([
      "id\tINTEGER\tNOT NULL\tPK\t-",
      "email\tTEXT\tNULL\t-\t''",
    ]);
  });

  test("query ddl (default) prints CREATE statement and triggers", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          dbId: "app.db",
          table: "users",
          sql: "CREATE TABLE users (id INTEGER PRIMARY KEY)",
          triggers: [{ name: "users_ai", sql: "CREATE TRIGGER users_ai ..." }],
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "ddl",
      "--db",
      "app.db",
      "--table",
      "users",
    ]);

    expect(harness.requests[1].url).toBe(
      `${SERVER}/_db/ddl?db=app.db&table=users`,
    );
    expect(harness.logs).toEqual([
      "CREATE TABLE users (id INTEGER PRIMARY KEY)",
      "",
      "CREATE TRIGGER users_ai ...",
    ]);
  });

  test("query schema relays server text errors to stderr + exit 1", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        status: 400,
        contentType: "text/plain",
        body: "unknown database id: bogus",
      },
    ]);

    await runAndCatchExit(["--server", SERVER, "schema", "--db", "bogus"]);

    expect(harness.exits).toEqual([1]);
    expect(harness.errs.join("\n")).toMatch(
      /read schema failed \(400\): unknown database id: bogus/,
    );
  });

  test("query list --schema forwards db and schema in the history URL", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify({ version: 1, entries: [] }) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "list",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
      "--json",
    ]);

    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[1].url).toBe(
      `${SERVER}/_db/history?db=docker%3Apg-svc&schema=analytics`,
    );
    expect(JSON.parse(harness.logs.join("\n"))).toEqual({
      version: 1,
      entries: [],
    });
  });

  test("query clear --schema forwards db and schema in the POST body", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify({ ok: true }) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "clear",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
    ]);

    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[1].url).toBe(`${SERVER}/_db/history/clear`);
    expect(harness.requests[1].method).toBe("POST");
    expect(harness.requests[1].body).toEqual({
      db: "docker:pg-svc",
      schema: "analytics",
    });
    expect(harness.logs.join("\n")).toBe("cleared query history");
  });

  test("snapshot create (no --wait) prints the message + snapshotId + poll hint", async () => {
    const harness = installRunHarness([
      // health probe
      { body: JSON.stringify({ files: [] }) },
      // snapshot create ack (new contract: server returns snapshotId)
      {
        body: JSON.stringify({
          ok: true,
          message: "snapshot started",
          snapshotId: "snap-no-wait-1",
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "create",
      "--db",
      "app.db",
      "--tables",
      "users,orders",
      "--note",
      "n",
    ]);

    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[0].url).toBe(`${SERVER}/`);
    expect(harness.requests[1].url).toBe(`${SERVER}/_db/snapshot/create`);
    expect(harness.requests[1].method).toBe("POST");
    expect(harness.requests[1].body).toEqual({
      db: "app.db",
      note: "n",
      tables: ["users", "orders"],
    });
    const out = harness.logs.join("\n");
    expect(out).toMatch(/snapshot started/);
    expect(out).toMatch(/\[id=snap-no-wait-1\]/);
    // poll hint も sources --commands と同じく --server を pin し、db id を
    // single-quote で paste-safe にする。
    expect(out).toMatch(
      /Poll with: code-viewer query --server 'http:\/\/localhost:65535' snapshot list --db 'app\.db' --json/,
    );
    expect(harness.exits).toEqual([]);
  });

  test("snapshot create --json (no --wait) emits structured ack with pollCommand", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          ok: true,
          message: "snapshot started",
          snapshotId: "snap-json-1",
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "create",
      "--db",
      "app.db",
      "--json",
    ]);

    expect(harness.exits).toEqual([]);
    expect(JSON.parse(harness.logs.join("\n"))).toEqual({
      ok: true,
      message: "snapshot started",
      snapshotId: "snap-json-1",
      // JSON ack にも pollCommand を載せて、AI が toString 構築せず literal を
      // 再利用できるようにする。human 行と同じ paste-safety 規則。
      pollCommand:
        "code-viewer query --server 'http://localhost:65535' snapshot list --db 'app.db' --json",
    });
  });

  test("snapshot create no-wait poll command single-quotes db ids and schemas containing spaces", async () => {
    // path に空白と ' を含む db id と、空白を含む schema 名でも shell に
    // そのまま paste できることを behavior で検証する。
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          ok: true,
          message: "snapshot started",
          snapshotId: "snap-spaces-1",
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "create",
      "--db",
      "sample's data.db",
      "--schema",
      "weird schema",
      "--note",
      "n",
    ]);

    const out = harness.logs.join("\n");
    expect(out).toMatch(
      /Poll with: code-viewer query --server 'http:\/\/localhost:65535' snapshot list --db 'sample'\\''s data\.db' --schema 'weird schema' --json/,
    );
    expect(harness.exits).toEqual([]);
  });

  test("snapshot create --schema forwards schema in the POST body", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          ok: true,
          message: "snapshot started",
          snapshotId: "snap-pg-1",
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "create",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
      "--tables",
      "events",
      "--note",
      "before",
    ]);

    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[1].url).toBe(`${SERVER}/_db/snapshot/create`);
    expect(harness.requests[1].body).toEqual({
      db: "docker:pg-svc",
      note: "before",
      tables: ["events"],
      schema: "analytics",
    });
    // poll hint should mirror --schema so the human re-runs list with the
    // same scope, with --server pinned and db/schema single-quoted.
    expect(harness.logs.join("\n")).toMatch(
      /code-viewer query --server 'http:\/\/localhost:65535' snapshot list --db 'docker:pg-svc' --schema 'analytics' --json/,
    );
  });

  test("snapshot create without --schema omits the field from the POST body (back-compat)", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          ok: true,
          message: "snapshot started",
          snapshotId: "snap-sqlite-1",
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "create",
      "--db",
      "app.db",
      "--note",
      "n",
    ]);

    expect(harness.requests[1].body).toEqual({
      db: "app.db",
      note: "n",
    });
    // 既存 server / 旧 client にも壊さない後方互換のため、schema キー自体が
    // 出ないことを確認 (undefined すらシリアライズしない)。tsconfig target は
    // ES2020 なので Object.hasOwn は使わず in 演算子で見る。
    expect("schema" in (harness.requests[1].body as object)).toBe(false);
  });

  test("snapshot list --schema appends schema to the URL (and --db is optional)", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify({ snapshots: [] }) },
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify({ snapshots: [] }) },
    ]);

    // Case A: db + schema → both in the querystring.
    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "list",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
      "--json",
    ]);
    expect(harness.requests[1].url).toBe(
      `${SERVER}/_db/snapshot/list?db=docker%3Apg-svc&schema=analytics`,
    );

    // Case B: schema only → ?schema=... (db absent).
    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "list",
      "--schema",
      "analytics",
      "--json",
    ]);
    expect(harness.requests[3].url).toBe(
      `${SERVER}/_db/snapshot/list?schema=analytics`,
    );
  });

  test("snapshot list (without --json) renders status / id / table count", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          snapshots: [
            {
              id: "snap-1",
              dbId: "app.db",
              kind: "sqlite",
              note: "before",
              createdAt: "2026-06-30T12:00:00Z",
              tables: ["users", "orders"],
              status: "done",
            },
          ],
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "list",
      "--db",
      "app.db",
    ]);

    const out = harness.logs.join("\n");
    expect(out).toMatch(/snap-1/);
    expect(out).toMatch(/\[done\]/);
    expect(out).toMatch(/\(2 tables\)/);
    expect(out).toMatch(/before/);
    // default mode は要約行だけ。enrich 用 command hint は --json 専用で、
    // default の stdout には漏らさない (AI-parseable な行を守る)。
    expect(/deleteCommand/.test(out)).toBe(false);
    expect(/noteCommand/.test(out)).toBe(false);
    expect(/code-viewer query --server/.test(out)).toBe(false);
  });

  test("snapshot list --json enriches each snapshots[] element with paste-safe delete/note commands", async () => {
    // 複数 snapshot で id / note の組み合わせを変えて、各 entry が独立して
    // enrich されることを確認する。top-level (snapshots 以外) と既存フィールド
    // (dbId / schema / kind / note / createdAt / tables / status / errorMessage)
    // は素通し。
    const payload = {
      version: 1,
      snapshots: [
        {
          id: "snap-1",
          dbId: "app.db",
          kind: "sqlite",
          note: "before sample run",
          createdAt: "2026-06-30T12:00:00Z",
          tables: ["sample_table", "sample_archive"],
          status: "done",
        },
        {
          id: "snap-2",
          dbId: "docker:pg-svc",
          schema: "analytics",
          kind: "postgresql",
          note: "",
          createdAt: "2026-06-30T12:05:00Z",
          tables: ["events"],
          status: "error",
          errorMessage: "table not found",
        },
      ],
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "list",
      "--db",
      "app.db",
      "--json",
    ]);

    expect(harness.exits).toEqual([]);
    expect(JSON.parse(harness.logs[0])).toEqual({
      version: 1,
      snapshots: [
        {
          id: "snap-1",
          dbId: "app.db",
          kind: "sqlite",
          note: "before sample run",
          createdAt: "2026-06-30T12:00:00Z",
          tables: ["sample_table", "sample_archive"],
          status: "done",
          deleteCommand:
            "code-viewer query --server 'http://localhost:65535' snapshot delete --id 'snap-1'",
          noteCommand:
            "code-viewer query --server 'http://localhost:65535' snapshot note --id 'snap-1' --note 'before sample run'",
        },
        {
          id: "snap-2",
          dbId: "docker:pg-svc",
          schema: "analytics",
          kind: "postgresql",
          note: "",
          createdAt: "2026-06-30T12:05:00Z",
          tables: ["events"],
          status: "error",
          errorMessage: "table not found",
          deleteCommand:
            "code-viewer query --server 'http://localhost:65535' snapshot delete --id 'snap-2'",
          // 空文字 note は --note '' になる。snapshot note parser は空文字を
          // 許容するので paste したそのままが parser を通る。
          noteCommand:
            "code-viewer query --server 'http://localhost:65535' snapshot note --id 'snap-2' --note ''",
        },
      ],
    });
  });

  test("snapshot list --json single-quotes ids and notes containing spaces and single quotes", async () => {
    // POSIX '...' の '\'' 展開で、id にも note text にも空白や ' が含まれる
    // ケースで paste-safe になることを behavior で確認する。
    const payload = {
      snapshots: [
        {
          id: "snap with 'quote'",
          dbId: "app.db",
          kind: "sqlite",
          note: "sample's edit note",
          createdAt: "2026-06-30T12:00:00Z",
          tables: ["sample_table"],
          status: "done",
        },
      ],
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "list",
      "--db",
      "app.db",
      "--json",
    ]);

    const parsed = JSON.parse(harness.logs[0]);
    expect(parsed.snapshots[0].deleteCommand).toBe(
      "code-viewer query --server 'http://localhost:65535' snapshot delete --id 'snap with '\\''quote'\\'''",
    );
    expect(parsed.snapshots[0].noteCommand).toBe(
      "code-viewer query --server 'http://localhost:65535' snapshot note --id 'snap with '\\''quote'\\''' --note 'sample'\\''s edit note'",
    );
  });

  test("snapshot list --json on empty result keeps the top-level shape and emits no command hints", async () => {
    // empty result でも JSON 分岐は素通し (no snapshots) + enrich は空配列。
    // 余計な command hint を吐かないことを保証する。
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify({ snapshots: [] }) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "list",
      "--db",
      "app.db",
      "--json",
    ]);

    expect(harness.exits).toEqual([]);
    expect(JSON.parse(harness.logs[0])).toEqual({ snapshots: [] });
    expect(/deleteCommand/.test(harness.logs.join("\n"))).toBe(false);
    expect(/noteCommand/.test(harness.logs.join("\n"))).toBe(false);
  });

  test("diff tables (--json) enriches each tables[] element with a paste-safe diffRowsCommand", async () => {
    const payload = {
      beforeId: "snap-a",
      afterId: "snap-b",
      tables: [
        {
          tableName: "sample_table",
          insertedCount: 1,
          updatedCount: 0,
          deletedCount: 0,
          unchangedCount: 9,
          coverage: "both",
        },
        {
          tableName: "sample_archive",
          insertedCount: 0,
          updatedCount: 3,
          deletedCount: 1,
          unchangedCount: 42,
          coverage: "both",
        },
      ],
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "diff",
      "tables",
      "--before",
      "snap-a",
      "--after",
      "snap-b",
      "--json",
    ]);

    expect(harness.requests[1].url).toBe(
      `${SERVER}/_db/snapshot/diff/tables?before=snap-a&after=snap-b`,
    );
    // top-level fields preserved; tables[] elements gain diffRowsCommand.
    // server URL / before / after / table はすべて single-quoted。
    expect(JSON.parse(harness.logs[0])).toEqual({
      beforeId: "snap-a",
      afterId: "snap-b",
      tables: [
        {
          tableName: "sample_table",
          insertedCount: 1,
          updatedCount: 0,
          deletedCount: 0,
          unchangedCount: 9,
          coverage: "both",
          diffRowsCommand:
            "code-viewer query --server 'http://localhost:65535' diff rows --before 'snap-a' --after 'snap-b' --table 'sample_table' --json",
        },
        {
          tableName: "sample_archive",
          insertedCount: 0,
          updatedCount: 3,
          deletedCount: 1,
          unchangedCount: 42,
          coverage: "both",
          diffRowsCommand:
            "code-viewer query --server 'http://localhost:65535' diff rows --before 'snap-a' --after 'snap-b' --table 'sample_archive' --json",
        },
      ],
    });
  });

  test("diff tables (default) prints the summary line and a paste-safe diff rows hint per table", async () => {
    const payload = {
      beforeId: "snap-a",
      afterId: "snap-b",
      tables: [
        {
          tableName: "sample_table",
          insertedCount: 1,
          updatedCount: 0,
          deletedCount: 0,
          unchangedCount: 9,
          coverage: "both",
        },
        {
          tableName: "sample_archive",
          insertedCount: 0,
          updatedCount: 3,
          deletedCount: 1,
          unchangedCount: 42,
          coverage: "after-only",
        },
      ],
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "diff",
      "tables",
      "--before",
      "snap-a",
      "--after",
      "snap-b",
    ]);

    expect(harness.exits).toEqual([]);
    const out = harness.logs.join("\n");
    // 既存 summary 行は保持。直下に "# diff rows: ..." hint を出す。
    expect(out).toMatch(/^sample_table {2}\+1 ~0 -0 =9$/m);
    expect(out).toMatch(
      /^# diff rows: code-viewer query --server 'http:\/\/localhost:65535' diff rows --before 'snap-a' --after 'snap-b' --table 'sample_table' --json$/m,
    );
    expect(out).toMatch(/^sample_archive {2}\+0 ~3 -1 =42 {2}\(after-only\)$/m);
    expect(out).toMatch(
      /^# diff rows: code-viewer query --server 'http:\/\/localhost:65535' diff rows --before 'snap-a' --after 'snap-b' --table 'sample_archive' --json$/m,
    );
    // hint 行は必ず summary 行の直下に来る (table ごとに対応関係を担保)。
    const lines = out.split("\n");
    const idxSampleTable = lines.indexOf("sample_table  +1 ~0 -0 =9");
    expect(lines[idxSampleTable + 1].startsWith("# diff rows:")).toBe(true);
    const idxSampleArchive = lines.indexOf(
      "sample_archive  +0 ~3 -1 =42  (after-only)",
    );
    expect(lines[idxSampleArchive + 1].startsWith("# diff rows:")).toBe(true);
  });

  test("diff tables single-quotes table names and snapshot ids containing spaces and quotes", async () => {
    // table 名・snapshot id に空白と ' を含むケース。POSIX '...' の '\''
    // 展開が効いて paste-safe であることを behavior で検証する。
    const payload = {
      beforeId: "snap with space",
      afterId: "snap's after",
      tables: [
        {
          tableName: "sample's table",
          insertedCount: 2,
          updatedCount: 0,
          deletedCount: 0,
          unchangedCount: 0,
          coverage: "both",
        },
      ],
    };
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "diff",
      "tables",
      "--before",
      "snap with space",
      "--after",
      "snap's after",
    ]);

    const out = harness.logs.join("\n");
    expect(out).toMatch(
      /^# diff rows: code-viewer query --server 'http:\/\/localhost:65535' diff rows --before 'snap with space' --after 'snap'\\''s after' --table 'sample'\\''s table' --json$/m,
    );
  });

  test("diff tables on empty result keeps the existing notice without hints", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          beforeId: "snap-a",
          afterId: "snap-b",
          tables: [],
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "diff",
      "tables",
      "--before",
      "snap-a",
      "--after",
      "snap-b",
    ]);

    expect(harness.exits).toEqual([]);
    expect(harness.logs).toEqual(["no tables in diff"]);
  });

  test("non-2xx responses with text/plain bodies are surfaced as readable errors (not SyntaxError)", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        status: 404,
        contentType: "text/plain",
        body: "snapshot not found: snap-missing",
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "delete",
      "--id",
      "snap-missing",
    ]);

    expect(harness.exits).toEqual([1]);
    const err = harness.errs.join("\n");
    expect(err).toMatch(/snapshot delete failed \(404\)/);
    expect(err).toMatch(/snapshot not found: snap-missing/);
    // 旧実装は res.json() を直接呼んで SyntaxError で死んでいた。
    expect(/SyntaxError/.test(err)).toBe(false);
  });

  test("non-2xx application/json bodies with {error:string} surface the error text only", async () => {
    // server (/_db/query) は失敗時に 400 + DbQueryResponse {dbId, columns:[],
    // ..., error:"<reason>"} を返す。CLI は JSON 丸出しでなく error 文字列
    // だけを stderr に書き、AI agent が原因を 1 行で読めるようにする。
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          dbId: "sample.db",
          columns: [],
          columnTypes: [],
          rows: [],
          rowCount: 0,
          truncated: false,
          elapsedMs: 0,
          error: "sample failure",
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "exec",
      "--db",
      "sample.db",
      "--sql",
      "SELECT 1",
      "--no-save",
    ]);

    expect(harness.exits).toEqual([1]);
    const err = harness.errs.join("\n");
    expect(err).toMatch(/^query failed \(400\): sample failure$/m);
    // 生 JSON を吐かない — dbId 等の他フィールドは stderr に漏れない。
    expect(/dbId/.test(err)).toBe(false);
    expect(/columnTypes/.test(err)).toBe(false);
    expect(/SyntaxError/.test(err)).toBe(false);
    // 失敗時は stdout に何も出さない。
    expect(harness.logs).toEqual([]);
  });

  test("non-2xx application/json bodies without {error} fall back to the raw body text", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ reason: "no error field" }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "exec",
      "--db",
      "sample.db",
      "--sql",
      "SELECT 1",
      "--no-save",
    ]);

    expect(harness.exits).toEqual([1]);
    const err = harness.errs.join("\n");
    expect(err).toMatch(
      /^query failed \(400\): \{"reason":"no error field"\}$/m,
    );
    expect(/SyntaxError/.test(err)).toBe(false);
  });

  test("non-2xx application/json bodies with malformed JSON keep the raw text fallback", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        status: 500,
        contentType: "application/json",
        body: "not even json",
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "exec",
      "--db",
      "sample.db",
      "--sql",
      "SELECT 1",
      "--no-save",
    ]);

    expect(harness.exits).toEqual([1]);
    const err = harness.errs.join("\n");
    expect(err).toMatch(/^query failed \(500\): not even json$/m);
    expect(/SyntaxError/.test(err)).toBe(false);
  });

  test("non-2xx application/json bodies with {error:<non-string>} fall back to raw text", async () => {
    // {error: 123} のように error が文字列でない場合は安全に raw を出す。
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: 123 }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "exec",
      "--db",
      "sample.db",
      "--sql",
      "SELECT 1",
      "--no-save",
    ]);

    expect(harness.exits).toEqual([1]);
    const err = harness.errs.join("\n");
    expect(err).toMatch(/^query failed \(400\): \{"error":123\}$/m);
  });

  test("non-2xx responses with empty bodies fall back to HTTP <status>", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { status: 500, contentType: "application/json", body: "" },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "exec",
      "--db",
      "sample.db",
      "--sql",
      "SELECT 1",
      "--no-save",
    ]);

    expect(harness.exits).toEqual([1]);
    const err = harness.errs.join("\n");
    expect(err).toMatch(/^query failed \(500\): HTTP 500$/m);
  });
});

describe("runQueryCli search integration", () => {
  const SERVER = "http://localhost:65535";
  const originalPollEnv = process.env.CODE_VIEWER_SEARCH_POLL_MS;
  const originalDateNow = Date.now;

  // polling 間隔は env 経由でテスト中だけ 0 にする。テスト終了で必ず復元する。
  function withZeroPollInterval(): void {
    process.env.CODE_VIEWER_SEARCH_POLL_MS = "0";
  }
  function restorePollEnv(): void {
    if (originalPollEnv === undefined) {
      delete process.env.CODE_VIEWER_SEARCH_POLL_MS;
    } else {
      process.env.CODE_VIEWER_SEARCH_POLL_MS = originalPollEnv;
    }
  }
  afterEach(() => {
    restorePollEnv();
    Date.now = originalDateNow;
  });

  test("posts to /_db/search/start, polls /_db/search/status until done, prints final JSON", async () => {
    withZeroPollInterval();
    const finalStatus = {
      jobId: "job-1",
      dbId: "app.db",
      scannedTables: 2,
      totalTables: 2,
      hits: [
        {
          table: "users",
          column: "email",
          valuePreview: "sample@example.com",
          rowKeyJson: '{"id":7}',
          rowPreview: [7, "sample@example.com"],
        },
      ],
      done: true,
    };
    const harness = installRunHarness([
      // health probe
      { body: JSON.stringify({ files: [] }) },
      // start ack
      { body: JSON.stringify({ jobId: "job-1" }) },
      // status: still running
      {
        body: JSON.stringify({
          jobId: "job-1",
          dbId: "app.db",
          scannedTables: 1,
          totalTables: 2,
          hits: [],
          done: false,
          currentTable: "users",
        }),
      },
      // status: done
      { body: JSON.stringify(finalStatus) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "search",
      "--db",
      "app.db",
      "--term",
      "sample@example.com",
      "--tables",
      "users,orders",
      "--max-hits",
      "20",
      "--json",
    ]);

    expect(harness.requests).toHaveLength(4);
    expect(harness.requests[0].url).toBe(`${SERVER}/`);
    expect(harness.requests[1]).toEqual({
      url: `${SERVER}/_db/search/start`,
      method: "POST",
      body: {
        db: "app.db",
        term: "sample@example.com",
        includeNonText: false,
        tables: ["users", "orders"],
        maxHitsPerTable: 20,
      },
    });
    expect(harness.requests[2].url).toBe(
      `${SERVER}/_db/search/status?id=job-1`,
    );
    expect(harness.requests[2].method).toBe("GET");
    expect(harness.requests[3].url).toBe(
      `${SERVER}/_db/search/status?id=job-1`,
    );
    expect(harness.exits).toEqual([]);
    expect(JSON.parse(harness.logs.join("\n"))).toEqual(finalStatus);
  });

  test("default mode (no --json) prints hit lines and a summary line", async () => {
    withZeroPollInterval();
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify({ jobId: "job-x" }) },
      {
        body: JSON.stringify({
          jobId: "job-x",
          dbId: "app.db",
          scannedTables: 1,
          totalTables: 1,
          hits: [
            {
              table: "users",
              column: "email",
              rowKeyJson: '{"id":7}',
              valuePreview: "match@example.com",
              rowPreview: [7, "match@example.com"],
            },
          ],
          done: true,
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "search",
      "--db",
      "app.db",
      "--term",
      "match@example.com",
    ]);

    const out = harness.logs.join("\n");
    expect(out).toMatch(/users\.email/);
    expect(out).toMatch(/key=\{"id":7\}/);
    expect(out).toMatch(/match@example\.com/);
    expect(out).toMatch(/# 1 hit\(s\) across 1 table\(s\)/);
    expect(harness.exits).toEqual([]);
  });

  test("empty result is a clean exit 0 with a 'no hits' line", async () => {
    withZeroPollInterval();
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify({ jobId: "job-empty" }) },
      {
        body: JSON.stringify({
          jobId: "job-empty",
          dbId: "app.db",
          scannedTables: 3,
          totalTables: 3,
          hits: [],
          done: true,
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "search",
      "--db",
      "app.db",
      "--term",
      "missing",
    ]);

    expect(harness.exits).toEqual([]);
    expect(harness.logs.join("\n")).toMatch(/no hits \(scanned 3 tables\)/);
  });

  test("server-side error status fails fast and exits 1 without polling further", async () => {
    withZeroPollInterval();
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify({ jobId: "job-err" }) },
      {
        body: JSON.stringify({
          jobId: "job-err",
          dbId: "app.db",
          scannedTables: 0,
          totalTables: 0,
          hits: [],
          done: true,
          error: "boom",
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "search",
      "--db",
      "app.db",
      "--term",
      "x",
    ]);

    expect(harness.exits).toEqual([1]);
    expect(harness.errs.join("\n")).toMatch(/search error: boom/);
  });

  test("timeout cancels the search job best-effort and exits with the timeout reason", async () => {
    withZeroPollInterval();
    const nowValues = [0, 0, 1001];
    let nowIndex = 0;
    Date.now = () => nowValues[Math.min(nowIndex++, nowValues.length - 1)];
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      { body: JSON.stringify({ jobId: "job-timeout" }) },
      {
        body: JSON.stringify({
          jobId: "job-timeout",
          dbId: "app.db",
          scannedTables: 1,
          totalTables: 2,
          hits: [],
          done: false,
        }),
      },
      { status: 500, contentType: "text/plain", body: "cancel failed" },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "search",
      "--db",
      "app.db",
      "--term",
      "x",
      "--timeout",
      "1",
    ]);

    expect(harness.requests[3]).toEqual({
      url: `${SERVER}/_db/search/cancel`,
      method: "POST",
      body: { id: "job-timeout" },
    });
    expect(harness.exits).toEqual([1]);
    expect(harness.errs.join("\n")).toMatch(
      /search timed out after 1s \(cancelled job job-timeout\)/,
    );
  });

  test("--timeout 0 is rejected at parse-time so the CLI never hangs forever", () => {
    expect(
      parseQueryArgs([
        "search",
        "--db",
        "app.db",
        "--term",
        "x",
        "--timeout",
        "0",
      ]),
    ).toEqual({
      ok: false,
      error: "--timeout must be a positive integer (sec)",
    });
  });
});

describe("runQueryCli snapshot create --wait integration", () => {
  const SERVER = "http://localhost:65535";
  const originalPollEnv = process.env.CODE_VIEWER_SNAPSHOT_POLL_MS;

  function withZeroPollInterval(): void {
    process.env.CODE_VIEWER_SNAPSHOT_POLL_MS = "0";
  }
  function restorePollEnv(): void {
    if (originalPollEnv === undefined) {
      delete process.env.CODE_VIEWER_SNAPSHOT_POLL_MS;
    } else {
      process.env.CODE_VIEWER_SNAPSHOT_POLL_MS = originalPollEnv;
    }
  }
  afterEach(restorePollEnv);

  // 共通のスナップショット meta builder (テスト用 placeholder のみ)。
  function meta(
    status: "running" | "done" | "error",
    overrides: Partial<{
      id: string;
      tables: string[];
      errorMessage: string;
    }> = {},
  ) {
    return {
      id: overrides.id ?? "snap-wait-1",
      dbId: "app.db",
      kind: "sqlite",
      note: "n",
      createdAt: "2026-06-30T12:00:00Z",
      tables: overrides.tables ?? ["users", "orders"],
      status,
      ...(overrides.errorMessage
        ? { errorMessage: overrides.errorMessage }
        : {}),
    };
  }

  test("polls snapshot list until status=done, prints final meta as JSON when --json", async () => {
    withZeroPollInterval();
    const finalMeta = meta("done");
    const harness = installRunHarness([
      // health
      { body: JSON.stringify({ files: [] }) },
      // create ack with snapshotId
      {
        body: JSON.stringify({
          ok: true,
          message: "snapshot started",
          snapshotId: "snap-wait-1",
        }),
      },
      // list response 1: still running
      { body: JSON.stringify({ snapshots: [meta("running")] }) },
      // list response 2: done
      { body: JSON.stringify({ snapshots: [finalMeta] }) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "create",
      "--db",
      "app.db",
      "--tables",
      "users,orders",
      "--note",
      "n",
      "--wait",
      "--json",
    ]);

    expect(harness.requests).toHaveLength(4);
    expect(harness.requests[1].url).toBe(`${SERVER}/_db/snapshot/create`);
    expect(harness.requests[2].url).toBe(
      `${SERVER}/_db/snapshot/list?db=app.db`,
    );
    expect(harness.requests[2].method).toBe("GET");
    expect(harness.requests[3].url).toBe(
      `${SERVER}/_db/snapshot/list?db=app.db`,
    );
    expect(harness.exits).toEqual([]);
    expect(JSON.parse(harness.logs.join("\n"))).toEqual(finalMeta);
  });

  test("--wait --schema forwards schema to the create body AND to every polling URL", async () => {
    withZeroPollInterval();
    const finalMeta = meta("done", { id: "snap-wait-pg" });
    const harness = installRunHarness([
      // health
      { body: JSON.stringify({ files: [] }) },
      // create ack
      {
        body: JSON.stringify({
          ok: true,
          message: "snapshot started",
          snapshotId: "snap-wait-pg",
        }),
      },
      // list 1: running
      {
        body: JSON.stringify({
          snapshots: [meta("running", { id: "snap-wait-pg" })],
        }),
      },
      // list 2: done
      { body: JSON.stringify({ snapshots: [finalMeta] }) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "create",
      "--db",
      "docker:pg-svc",
      "--schema",
      "analytics",
      "--tables",
      "events",
      "--wait",
      "--json",
    ]);

    // create body includes schema
    expect(harness.requests[1].body).toEqual({
      db: "docker:pg-svc",
      note: "",
      tables: ["events"],
      schema: "analytics",
    });
    // both polling URLs include schema
    expect(harness.requests[2].url).toBe(
      `${SERVER}/_db/snapshot/list?db=docker%3Apg-svc&schema=analytics`,
    );
    expect(harness.requests[3].url).toBe(
      `${SERVER}/_db/snapshot/list?db=docker%3Apg-svc&schema=analytics`,
    );
    expect(harness.exits).toEqual([]);
  });

  test("status=error prints stderr and exits 1 (still emits final meta on --json)", async () => {
    withZeroPollInterval();
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          ok: true,
          message: "snapshot started",
          snapshotId: "snap-wait-err",
        }),
      },
      {
        body: JSON.stringify({
          snapshots: [
            meta("error", {
              id: "snap-wait-err",
              errorMessage: "table not found",
            }),
          ],
        }),
      },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "create",
      "--db",
      "app.db",
      "--wait",
      "--json",
    ]);

    expect(harness.exits).toEqual([1]);
    expect(harness.errs.join("\n")).toMatch(
      /snapshot snap-wait-err failed: table not found/,
    );
    // --json は失敗時も meta を 1 度出してから exit 1 する契約。
    expect(JSON.parse(harness.logs.join("\n")).status).toBe("error");
  });

  test("timeout cancels the snapshot via /_db/snapshot/cancel and exits 1", async () => {
    // poll interval を --timeout 1s より十分長くすれば、1 回 list して sleep
    // した後の次 iter で必ず deadline 突破 → cancel に入る (耐レース)。
    process.env.CODE_VIEWER_SNAPSHOT_POLL_MS = "1500";
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      {
        body: JSON.stringify({
          ok: true,
          message: "snapshot started",
          snapshotId: "snap-wait-timeout",
        }),
      },
      {
        body: JSON.stringify({
          snapshots: [meta("running", { id: "snap-wait-timeout" })],
        }),
      },
      // cancel ack
      { body: JSON.stringify({ ok: true }) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "create",
      "--db",
      "app.db",
      "--wait",
      "--timeout",
      "1",
    ]);

    // health + create + list (1 度走った後 sleep) + cancel = 4
    expect(harness.requests).toHaveLength(4);
    expect(harness.requests[3]).toEqual({
      url: `${SERVER}/_db/snapshot/cancel`,
      method: "POST",
      body: { id: "snap-wait-timeout" },
    });
    expect(harness.exits).toEqual([1]);
    expect(harness.errs.join("\n")).toMatch(
      /snapshot create timed out after 1s \(cancelled snap-wait-timeout\)/,
    );
  }, 5000);

  test("old server (no snapshotId in ack) with --wait fails fast with a clear error", async () => {
    const harness = installRunHarness([
      { body: JSON.stringify({ files: [] }) },
      // 旧 server 互換: snapshotId 未返却
      { body: JSON.stringify({ ok: true, message: "snapshot started" }) },
    ]);

    await runAndCatchExit([
      "--server",
      SERVER,
      "snapshot",
      "create",
      "--db",
      "app.db",
      "--wait",
    ]);

    expect(harness.exits).toEqual([1]);
    expect(harness.errs.join("\n")).toMatch(
      /snapshot create --wait: server did not return snapshotId/,
    );
  });
});

// Markdown 内のコードフェンス (```...```) からだけ抽出する。
// 散文中の `code-viewer query ...` (バックティック付き) は人間向けの言及で
// 構文契約の対象外なので無視する。`#` で始まる行はコメントなのでスキップ。
function codeFenceLines(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) continue;
    if (trimmed.startsWith("#")) continue;
    out.push(raw);
  }
  return out;
}

// 行末 `\` 継続を join して 1 行コマンドにまとめる。
function joinBackslashContinuations(lines: string[]): string[] {
  const joined: string[] = [];
  let acc = "";
  for (const line of lines) {
    if (/\\\s*$/.test(line)) {
      acc += `${line.replace(/\\\s*$/, "")} `;
    } else {
      joined.push((acc + line).trim());
      acc = "";
    }
  }
  if (acc) joined.push(acc.trim());
  return joined.filter((l) => l.length > 0);
}

// 単純なシェル風 split。"..."、'...' で囲まれた範囲のスペースは保存する。
// バックスラッシュエスケープは double-quote 内のみで簡易対応。
function shellSplit(s: string): string[] {
  const result: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      else buf += c;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      else if (c === "\\" && i + 1 < s.length) {
        buf += s[i + 1];
        i++;
      } else buf += c;
      continue;
    }
    if (c === "'") inSingle = true;
    else if (c === '"') inDouble = true;
    else if (c === " " || c === "\t") {
      if (buf.length > 0) {
        result.push(buf);
        buf = "";
      }
    } else buf += c;
  }
  if (buf.length > 0) result.push(buf);
  return result;
}

// ドキュメント本文から `code-viewer query <...>` 例を全部取り出し、
// "code-viewer query" プレフィックス除去後の argv 配列に変換する。
function extractDocumentedQueryInvocations(text: string): string[][] {
  const lines = joinBackslashContinuations(codeFenceLines(text));
  const out: string[][] = [];
  for (const line of lines) {
    const parts = shellSplit(line);
    // npx -y @youtyan/code-viewer query <...> も拾う (README の install 例で
    // 出てくる可能性に備える)。 prefix を見つけて以降を argv 化する。
    const idx = parts.findIndex(
      (p, i) =>
        (p === "code-viewer" || p.endsWith("/code-viewer")) &&
        parts[i + 1] === "query",
    );
    if (idx < 0) continue;
    out.push(parts.slice(idx + 2));
  }
  return out;
}

describe("bundled skill + README track the CLI contract", () => {
  // skill MD / README に書かれている `code-viewer query ...` 例を、実 CLI
  // parser に通す。flag rename / 削除済み subcommand / typo が docs に
  // 混入したら、文字列存在チェックではなく実 parser で落とす。
  const docs = [
    "skills/code-viewer-query/SKILL.md",
    "skills/code-viewer-snapshot/SKILL.md",
    "README.md",
  ] as const;

  for (const doc of docs) {
    test(`${doc}: every documented "code-viewer query ..." example parses`, () => {
      const text = readFileSync(join(REPO_ROOT, doc), "utf8");
      const invocations = extractDocumentedQueryInvocations(text);
      // sanity: 抽出ロジックが完全に壊れて 0 件になっていないこと。
      expect(invocations.length === 0).toBe(false);
      const failures: string[] = [];
      for (const argv of invocations) {
        const result = parseQueryArgs(argv);
        if (result.ok) continue;
        // tsconfig が strictNullChecks 無効なので discriminated union narrowing が
        // ここでは効かない。失敗バリアントを明示的に取り出して使う。
        const failure = result as { ok: false; error: string };
        failures.push(`\`${argv.join(" ")}\` → ${failure.error}`);
      }
      expect(failures).toEqual([]);
    });
  }

  const searchDocs = [
    "skills/code-viewer-query/SKILL.md",
    "README.md",
  ] as const;

  for (const doc of searchDocs) {
    test(`${doc}: documents the search subcommand`, () => {
      const text = readFileSync(join(REPO_ROOT, doc), "utf8");
      const invocations = extractDocumentedQueryInvocations(text);
      const hasSearch = invocations.some((argv) => argv[0] === "search");
      expect(hasSearch).toBe(true);
    });
  }

  // parse テストだけでは「必要な例がそもそも doc に無い」状態を検出できない。
  // query skill が AI 向けに最低限持つべき subcommand はここで明示する。
  const REQUIRED_SUBCOMMANDS_IN_QUERY_SKILL = [
    "exec",
    "search",
    "list",
  ] as const;

  test("query skill mentions the non-snapshot subcommands an AI agent should know", () => {
    const text = readFileSync(
      join(REPO_ROOT, "skills/code-viewer-query/SKILL.md"),
      "utf8",
    );
    const invocations = extractDocumentedQueryInvocations(text);
    for (const kind of REQUIRED_SUBCOMMANDS_IN_QUERY_SKILL) {
      const present = invocations.some((argv) => argv[0] === kind);
      expect({ kind, present }).toEqual({ kind, present: true });
    }
  });
});
