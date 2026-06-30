import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseQueryArgs,
  QUERY_AGENT_HELP,
  QUERY_HELP,
  type QueryCommand,
  runQueryCli,
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
    expect(QUERY_AGENT_HELP).toMatch(/does not discover databases/);
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

  // 順番に消費する fake fetch。/_db/files の health probe を最初に消費する。
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
    expect(harness.requests[0].url).toBe(`${SERVER}/_db/files`);
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
    expect(out).toMatch(
      /Poll with: code-viewer query snapshot list --db app.db --json/,
    );
    expect(harness.exits).toEqual([]);
  });

  test("snapshot create --json (no --wait) emits structured ack", async () => {
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
    });
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
    // same scope.
    expect(harness.logs.join("\n")).toMatch(
      /code-viewer query snapshot list --db docker:pg-svc --schema analytics --json/,
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
  });

  test("diff tables (--json) returns the server payload verbatim", async () => {
    const payload = {
      beforeId: "snap-a",
      afterId: "snap-b",
      tables: [
        {
          tableName: "users",
          insertedCount: 1,
          updatedCount: 0,
          deletedCount: 0,
          unchangedCount: 9,
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
    expect(JSON.parse(harness.logs[0])).toEqual(payload);
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
    expect(harness.requests[0].url).toBe(`${SERVER}/_db/files`);
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
