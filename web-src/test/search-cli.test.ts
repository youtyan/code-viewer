import { afterEach, describe, expect, test } from "bun:test";
import {
  parseSearchArgs,
  runSearchCli,
  SEARCH_AGENT_HELP,
  SEARCH_HELP,
} from "../server/search-cli";

describe("parseSearchArgs", () => {
  test("bare invocation returns help", () => {
    expect(parseSearchArgs([])).toEqual({
      ok: true,
      args: { command: { kind: "help" } },
    });
  });

  test("--help and -h return help", () => {
    expect(parseSearchArgs(["--help"])).toEqual({
      ok: true,
      args: { command: { kind: "help" } },
    });
    expect(parseSearchArgs(["-h"])).toEqual({
      ok: true,
      args: { command: { kind: "help" } },
    });
  });

  test("agent-help subcommand returns agent-help", () => {
    expect(parseSearchArgs(["agent-help"])).toEqual({
      ok: true,
      args: { command: { kind: "agent-help" } },
    });
  });

  test("agent-help with extra args is rejected", () => {
    expect(parseSearchArgs(["agent-help", "code"])).toEqual({
      ok: false,
      error: "agent-help does not accept arguments",
    });
  });

  test("unknown top-level subcommand is rejected", () => {
    expect(parseSearchArgs(["files"])).toEqual({
      ok: false,
      error: "unknown search subcommand: files",
    });
  });

  test("search code requires --term", () => {
    expect(parseSearchArgs(["code"])).toEqual({
      ok: false,
      error: "search code requires --term <text>",
    });
  });

  test("search code rejects an empty --term", () => {
    expect(parseSearchArgs(["code", "--term", ""])).toEqual({
      ok: false,
      error: "search code requires --term <text>",
    });
  });

  test("search code rejects multi-line --term", () => {
    expect(parseSearchArgs(["code", "--term", "line1\nline2"])).toEqual({
      ok: false,
      error: "--term must be a single line",
    });
  });

  test("search code rejects a stray positional argument", () => {
    expect(parseSearchArgs(["code", "--term", "TODO", "extra"])).toEqual({
      ok: false,
      error: "search code does not accept positional argument: extra",
    });
  });

  test("search code captures --term, --ref, --regex, --max, --json", () => {
    const result = parseSearchArgs([
      "code",
      "--term",
      "fn handler",
      "--ref",
      "main",
      "--regex",
      "--max",
      "50",
      "--json",
    ]);
    expect(result).toEqual({
      ok: true,
      args: {
        command: {
          kind: "code",
          term: "fn handler",
          ref: "main",
          paths: [],
          regex: true,
          max: 50,
          json: true,
        },
      },
    });
  });

  test("--path is repeatable and preserves order", () => {
    const result = parseSearchArgs([
      "code",
      "--term",
      "TODO",
      "--path",
      "src",
      "--path",
      "tests/sample",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok && result.args.command.kind === "code") {
      expect(result.args.command.paths).toEqual(["src", "tests/sample"]);
    }
  });

  test("--cwd and --server propagate to args", () => {
    const result = parseSearchArgs([
      "code",
      "--term",
      "TODO",
      "--cwd",
      "/tmp/example",
      "--server",
      "http://127.0.0.1:64160",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.cwd).toBe("/tmp/example");
      expect(result.args.server).toBe("http://127.0.0.1:64160");
    }
  });

  test("--max must be a positive integer", () => {
    expect(parseSearchArgs(["code", "--term", "x", "--max", "0"])).toEqual({
      ok: false,
      error: "--max must be a positive integer (got 0)",
    });
    expect(parseSearchArgs(["code", "--term", "x", "--max", "-1"])).toEqual({
      ok: false,
      error: "--max must be a positive integer (got -1)",
    });
    expect(parseSearchArgs(["code", "--term", "x", "--max", "abc"])).toEqual({
      ok: false,
      error: "--max must be a positive integer (got abc)",
    });
  });

  test("--max may not exceed the server hard cap of 500", () => {
    expect(parseSearchArgs(["code", "--term", "x", "--max", "501"])).toEqual({
      ok: false,
      error: "--max must be <= 500 (got 501)",
    });
    // The boundary value is accepted.
    const ok = parseSearchArgs(["code", "--term", "x", "--max", "500"]);
    expect(ok.ok).toBe(true);
  });

  test("unknown option is rejected", () => {
    expect(parseSearchArgs(["code", "--term", "x", "--what"])).toEqual({
      ok: false,
      error: "unknown option: --what",
    });
  });

  test("--term without a value is rejected", () => {
    expect(parseSearchArgs(["code", "--term"])).toEqual({
      ok: false,
      error: "--term requires a value",
    });
  });

  test("--path without a value is rejected", () => {
    expect(parseSearchArgs(["code", "--term", "x", "--path"])).toEqual({
      ok: false,
      error: "--path requires a value",
    });
  });
});

describe("SEARCH_HELP / SEARCH_AGENT_HELP", () => {
  test("both texts share a stable signature line", () => {
    expect(SEARCH_HELP.startsWith("code-viewer search — ")).toBe(true);
    expect(
      SEARCH_AGENT_HELP.startsWith("code-viewer search — agent guide"),
    ).toBe(true);
  });

  test("SEARCH_HELP documents the wired options", () => {
    expect(SEARCH_HELP).toMatch(/code-viewer search code --term/);
    expect(SEARCH_HELP).toMatch(/--ref/);
    expect(SEARCH_HELP).toMatch(/--path/);
    expect(SEARCH_HELP).toMatch(/--regex/);
    expect(SEARCH_HELP).toMatch(/--max/);
    expect(SEARCH_HELP).toMatch(/--json/);
    expect(SEARCH_HELP).toMatch(/agent-help/);
  });

  test("SEARCH_AGENT_HELP describes the GrepResponse contract", () => {
    expect(SEARCH_AGENT_HELP).toMatch(/GrepResponse/);
    expect(SEARCH_AGENT_HELP).toMatch(/"engine"/);
    expect(SEARCH_AGENT_HELP).toMatch(/"truncated"/);
    expect(SEARCH_AGENT_HELP).toMatch(/"matches"/);
    expect(SEARCH_AGENT_HELP).toMatch(/path:line:column/);
    expect(SEARCH_AGENT_HELP).toMatch(/no matches/);
  });
});

// --- runSearchCli integration (fetch + exit + log mocked) ---

type RequestRecord = { url: string; method: string };

const originalFetch = globalThis.fetch;
let originalExit: typeof process.exit | null = null;
let originalLog: typeof console.log | null = null;
let originalErr: typeof console.error | null = null;

class ExitMarker extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

function installRunHarness(
  responses: Array<{ status?: number; contentType?: string; body: string }>,
): {
  requests: RequestRecord[];
  logs: string[];
  errs: string[];
  exits: number[];
} {
  const requests: RequestRecord[] = [];
  const logs: string[] = [];
  const errs: string[] = [];
  const exits: number[] = [];

  let index = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      requests.push({ url, method: init?.method ?? "GET" });
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
    await runSearchCli(argv);
  } catch (err) {
    if (err instanceof ExitMarker) return;
    throw err;
  }
}

describe("runSearchCli integration", () => {
  const SERVER = "http://localhost:65534";

  test("help and agent-help never touch the server", async () => {
    const harness = installRunHarness([]);
    await runAndCatchExit(["--help"]);
    await runAndCatchExit(["agent-help"]);
    expect(harness.requests).toEqual([]);
    expect(harness.exits).toEqual([]);
    expect(
      harness.logs.some((line) => line.includes("code-viewer search —")),
    ).toBe(true);
  });

  test("search code --json emits the GrepResponse verbatim and builds the wire URL", async () => {
    const payload = {
      ref: "worktree",
      engine: "rg",
      truncated: false,
      matches: [
        {
          path: "src/sample.ts",
          line: 12,
          column: 3,
          preview: "  // TODO: sample preview line",
        },
      ],
    };
    const harness = installRunHarness([
      // ensureServerUrl health probe to "/"
      { body: "ok", contentType: "text/plain" },
      // /_grep response
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit([
      "code",
      "--term",
      "TODO",
      "--path",
      "src",
      "--path",
      "tests/sample",
      "--regex",
      "--max",
      "25",
      "--json",
      "--server",
      SERVER,
    ]);

    expect(harness.exits).toEqual([]);
    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[0].url).toBe(`${SERVER}/`);
    const grepCall = harness.requests[1];
    expect(grepCall.method).toBe("GET");
    expect(grepCall.url.startsWith(`${SERVER}/_grep?`)).toBe(true);
    const u = new URL(grepCall.url);
    expect(u.searchParams.get("q")).toBe("TODO");
    expect(u.searchParams.get("max")).toBe("25");
    expect(u.searchParams.get("regex")).toBe("1");
    expect(u.searchParams.get("ref")).toBe(null);
    expect(u.searchParams.getAll("path")).toEqual(["src", "tests/sample"]);

    expect(harness.logs).toEqual([JSON.stringify(payload, null, 2)]);
    expect(harness.errs).toEqual([]);
  });

  test("default text output prints one TAB-delimited line per match", async () => {
    const payload = {
      ref: "main",
      engine: "git",
      truncated: false,
      matches: [
        { path: "a.ts", line: 1, column: 1, preview: "first" },
        { path: "b.ts", line: 9, column: 2, preview: "second match" },
      ],
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit([
      "code",
      "--term",
      "anything",
      "--ref",
      "main",
      "--server",
      SERVER,
    ]);

    expect(harness.exits).toEqual([]);
    const grepUrl = new URL(harness.requests[1].url);
    expect(grepUrl.searchParams.get("ref")).toBe("main");
    expect(grepUrl.searchParams.get("regex")).toBe(null);
    expect(harness.logs).toEqual(["a.ts:1:1\tfirst", "b.ts:9:2\tsecond match"]);
    expect(harness.errs).toEqual([]);
  });

  test("default output collapses embedded newlines in preview into a single line", async () => {
    const payload = {
      ref: "worktree",
      engine: "rg",
      truncated: false,
      matches: [{ path: "x.ts", line: 5, column: 1, preview: "before\nafter" }],
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit(["code", "--term", "x", "--server", SERVER]);

    expect(harness.logs).toEqual(["x.ts:5:1\tbefore after"]);
  });

  test("0 matches prints `no matches` to stderr and exits 0", async () => {
    const payload = {
      ref: "worktree",
      engine: "rg",
      truncated: false,
      matches: [],
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit(["code", "--term", "absent", "--server", SERVER]);

    expect(harness.exits).toEqual([]);
    expect(harness.logs).toEqual([]);
    expect(harness.errs).toEqual(["no matches"]);
  });

  test("truncated=true triggers a stderr hint after the match list", async () => {
    const payload = {
      ref: "worktree",
      engine: "rg",
      truncated: true,
      matches: [{ path: "a.ts", line: 1, column: 1, preview: "first" }],
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(payload) },
    ]);

    await runAndCatchExit(["code", "--term", "x", "--server", SERVER]);

    expect(harness.logs).toEqual(["a.ts:1:1\tfirst"]);
    expect(harness.errs.length).toBe(1);
    expect(harness.errs[0].includes("truncated")).toBe(true);
    expect(harness.errs[0].includes("500")).toBe(true);
  });

  test("parse failure exits 1 without reaching the server", async () => {
    const harness = installRunHarness([]);
    await runAndCatchExit(["code", "--what"]);
    expect(harness.requests).toEqual([]);
    expect(harness.exits).toEqual([1]);
    expect(harness.errs[0]).toBe("unknown option: --what");
  });
});
