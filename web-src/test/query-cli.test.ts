import { afterEach, describe, expect, test } from "bun:test";
import {
  parseQueryArgs,
  QUERY_AGENT_HELP,
  QUERY_HELP,
  type QueryCommand,
  runQueryCli,
} from "../server/query-cli";

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
      json: true,
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

  test("snapshot create posts to /_db/snapshot/create and prints the poll hint", async () => {
    const harness = installRunHarness([
      // health probe
      { body: JSON.stringify({ files: [] }) },
      // snapshot create ack
      { body: JSON.stringify({ ok: true, message: "snapshot started" }) },
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
    expect(harness.logs.join("\n")).toMatch(/snapshot started/);
    expect(harness.logs.join("\n")).toMatch(
      /Poll with: code-viewer query snapshot list --db app.db --json/,
    );
    expect(harness.exits).toEqual([]);
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
