import { afterEach, describe, expect, test } from "vitest";
import {
  FILE_NAME_SEARCH_DEFAULT_MAX,
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
    expect(parseSearchArgs(["blobs"])).toEqual({
      ok: false,
      error: "unknown search subcommand: blobs",
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
          caseSensitive: false,
          wholeWord: false,
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

  test("--bin captures command overrides", () => {
    const result = parseSearchArgs([
      "code",
      "--term",
      "TODO",
      "--bin",
      "git=/opt/bin/git",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.commandOverrides).toEqual([
      { name: "git", path: "/opt/bin/git" },
    ]);
  });

  test("--bin rejects unsupported command names", () => {
    expect(
      parseSearchArgs([
        "code",
        "--term",
        "TODO",
        "--bin",
        "psql=/opt/bin/psql",
      ]),
    ).toEqual({
      ok: false,
      error: "--bin unsupported command: psql",
    });
    expect(
      parseSearchArgs([
        "code",
        "--term",
        "TODO",
        "--bin",
        "docker=/opt/bin/docker",
      ]),
    ).toEqual({
      ok: false,
      error: "--bin unsupported command: docker",
    });
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

describe("parseSearchArgs code match options", () => {
  test.each([
    {
      name: "--case-sensitive alone",
      argv: ["code", "--term", "Token", "--case-sensitive"],
      caseSensitive: true,
      wholeWord: false,
    },
    {
      name: "--word alone",
      argv: ["code", "--term", "Token", "--word"],
      caseSensitive: false,
      wholeWord: true,
    },
    {
      name: "both flags, any order",
      argv: ["code", "--word", "--term", "Token", "--case-sensitive"],
      caseSensitive: true,
      wholeWord: true,
    },
  ])("$name", ({ argv, caseSensitive, wholeWord }) => {
    const result = parseSearchArgs(argv);
    if (result.ok !== true) throw new Error(result.error);
    const command = result.args.command;
    if (command.kind !== "code") throw new Error(`unexpected ${command.kind}`);
    expect(command.caseSensitive).toBe(caseSensitive);
    expect(command.wholeWord).toBe(wholeWord);
  });

  test.each([
    { flag: "--regex" },
    { flag: "--case-sensitive" },
    { flag: "--word" },
  ])("search files rejects the code-only flag $flag", ({ flag }) => {
    expect(parseSearchArgs(["files", "--term", "x", flag])).toEqual({
      ok: false,
      error: `search files does not accept ${flag}`,
    });
  });
});

describe("parseSearchArgs files", () => {
  test("files requires --term", () => {
    expect(parseSearchArgs(["files"])).toEqual({
      ok: false,
      error: "search files requires --term <text>",
    });
    expect(parseSearchArgs(["files", "--term", ""])).toEqual({
      ok: false,
      error: "search files requires --term <text>",
    });
  });

  test("files rejects multi-line --term", () => {
    expect(parseSearchArgs(["files", "--term", "a\nb"])).toEqual({
      ok: false,
      error: "--term must be a single line",
    });
  });

  test("files rejects --regex (code-only flag)", () => {
    expect(parseSearchArgs(["files", "--term", "sample", "--regex"])).toEqual({
      ok: false,
      error: "search files does not accept --regex",
    });
  });

  test("files rejects --path (code-only repeatable option)", () => {
    expect(
      parseSearchArgs(["files", "--term", "sample", "--path", "src"]),
    ).toEqual({ ok: false, error: "search files does not accept --path" });
  });

  test("files rejects --max <= 0, non-integer, and values above the cap", () => {
    for (const bad of ["0", "-1", "1.5", "abc"]) {
      expect(parseSearchArgs(["files", "--term", "x", "--max", bad])).toEqual({
        ok: false,
        error: `--max must be a positive integer (got ${bad})`,
      });
    }
    // Cap is FILE_SEARCH_ABSOLUTE_MAX (50000). Cap + 1 is rejected, cap is OK.
    expect(parseSearchArgs(["files", "--term", "x", "--max", "50001"])).toEqual(
      {
        ok: false,
        error: "--max must be <= 50000 (got 50001)",
      },
    );
    const okCap = parseSearchArgs(["files", "--term", "x", "--max", "50000"]);
    expect(okCap.ok).toBe(true);
    if (okCap.ok && okCap.args.command.kind === "files") {
      expect(okCap.args.command.max).toBe(50000);
    }
  });

  test("files defaults --max to FILE_NAME_SEARCH_DEFAULT_MAX and captures other args", () => {
    const result = parseSearchArgs([
      "files",
      "--term",
      "userId",
      "--ref",
      "main",
      "--json",
      "--cwd",
      "/tmp/example",
      "--server",
      "http://127.0.0.1:64160",
    ]);
    expect(result).toEqual({
      ok: true,
      args: {
        command: {
          kind: "files",
          term: "userId",
          ref: "main",
          max: FILE_NAME_SEARCH_DEFAULT_MAX,
          json: true,
        },
        cwd: "/tmp/example",
        server: "http://127.0.0.1:64160",
      },
    });
  });

  test("files rejects a stray positional argument", () => {
    expect(parseSearchArgs(["files", "--term", "sample", "extra"])).toEqual({
      ok: false,
      error: "search files does not accept positional argument: extra",
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

  test("SEARCH_HELP documents the wired options for both code and files", () => {
    expect(SEARCH_HELP).toMatch(/code-viewer search code --term/);
    expect(SEARCH_HELP).toMatch(/code-viewer search files --term/);
    expect(SEARCH_HELP).toMatch(/--ref/);
    expect(SEARCH_HELP).toMatch(/--path/);
    expect(SEARCH_HELP).toMatch(/--regex/);
    expect(SEARCH_HELP).toMatch(/--max/);
    expect(SEARCH_HELP).toMatch(/--json/);
    expect(SEARCH_HELP).toMatch(/agent-help/);
    // files-only mode hint must be visible.
    expect(SEARCH_HELP).toMatch(/fuzzy/);
    expect(SEARCH_HELP).toMatch(/glob/);
  });

  test("SEARCH_AGENT_HELP describes both contracts (code GrepResponse, files ranked)", () => {
    expect(SEARCH_AGENT_HELP).toMatch(/GrepResponse/);
    expect(SEARCH_AGENT_HELP).toMatch(/"engine"/);
    expect(SEARCH_AGENT_HELP).toMatch(/"truncated"/);
    expect(SEARCH_AGENT_HELP).toMatch(/"matches"/);
    expect(SEARCH_AGENT_HELP).toMatch(/path:line:column/);
    expect(SEARCH_AGENT_HELP).toMatch(/no matches/);
    // files-specific JSON contract fields.
    expect(SEARCH_AGENT_HELP).toMatch(/"mode"/);
    expect(SEARCH_AGENT_HELP).toMatch(/"score"/);
    expect(SEARCH_AGENT_HELP).toMatch(/"ranges"/);
    expect(SEARCH_AGENT_HELP).toMatch(/"candidateTruncated"/);
    expect(SEARCH_AGENT_HELP).toMatch(/"totalCandidates"/);
    expect(SEARCH_AGENT_HELP).toMatch(/no matching files/);
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

  // ---- search files integration ----

  test("search files --json hits /_files and emits a ranked payload (fuzzy mode)", async () => {
    const filesPayload = {
      ref: "worktree",
      generation: 7,
      files: [
        { path: "src/sample-user.ts", type: "blob" },
        { path: "src/example.ts", type: "blob" },
        { path: "tests/sample/userId.test.ts", type: "blob" },
        { path: "docs/readme.md", type: "blob" },
      ],
      truncated: false,
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(filesPayload) },
    ]);

    await runAndCatchExit([
      "files",
      "--term",
      "userId",
      "--json",
      "--server",
      SERVER,
    ]);

    expect(harness.exits).toEqual([]);
    const filesUrl = new URL(harness.requests[1].url);
    expect(filesUrl.pathname).toBe("/_files");
    // No `q`/`term` is forwarded: ranking happens in the CLI.
    expect(filesUrl.searchParams.get("ref")).toBe(null);
    expect(filesUrl.searchParams.get("q")).toBe(null);
    expect(filesUrl.searchParams.get("term")).toBe(null);

    expect(harness.logs.length).toBe(1);
    const payload = JSON.parse(harness.logs[0]);
    expect(payload.ref).toBe("worktree");
    expect(payload.generation).toBe(7);
    expect(payload.query).toBe("userId");
    expect(payload.mode).toBe("fuzzy");
    expect(payload.totalCandidates).toBe(4);
    expect(typeof payload.totalMatches).toBe("number");
    expect(payload.truncated).toBe(false);
    expect(payload.candidateTruncated).toBe(false);
    expect(Array.isArray(payload.matches)).toBe(true);
    expect(payload.matches.length > 0).toBe(true);
    // The best fuzzy hit for "userId" should be the test file whose basename
    // starts with "userId".
    expect(payload.matches[0].path).toBe("tests/sample/userId.test.ts");
    expect(typeof payload.matches[0].score).toBe("number");
    expect(Array.isArray(payload.matches[0].ranges)).toBe(true);
    expect(typeof payload.matches[0].ranges[0].start).toBe("number");
    expect(typeof payload.matches[0].ranges[0].end).toBe("number");
  });

  test("search files --json reports glob mode for patterns with * or ?", async () => {
    const filesPayload = {
      ref: "worktree",
      generation: 1,
      files: [
        { path: "src/lib/auth.ts", type: "blob" },
        { path: "src/lib/auth.test.ts", type: "blob" },
        { path: "src/lib/user.test.ts", type: "blob" },
        { path: "docs/readme.md", type: "blob" },
      ],
      truncated: false,
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(filesPayload) },
    ]);

    await runAndCatchExit([
      "files",
      "--term",
      "src/**/*.test.ts",
      "--json",
      "--server",
      SERVER,
    ]);

    expect(harness.exits).toEqual([]);
    const payload = JSON.parse(harness.logs[0]);
    expect(payload.mode).toBe("glob");
    expect(payload.query).toBe("src/**/*.test.ts");
    const matchedPaths = payload.matches.map((m: { path: string }) => m.path);
    expect(matchedPaths.includes("src/lib/auth.test.ts")).toBe(true);
    expect(matchedPaths.includes("src/lib/user.test.ts")).toBe(true);
    expect(matchedPaths.includes("docs/readme.md")).toBe(false);
    expect(matchedPaths.includes("src/lib/auth.ts")).toBe(false);
  });

  test("search files --ref pins the /_files ref param", async () => {
    const filesPayload = {
      ref: "main",
      generation: 3,
      files: [{ path: "src/sample.ts", type: "blob" }],
      truncated: false,
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(filesPayload) },
    ]);

    await runAndCatchExit([
      "files",
      "--term",
      "sample",
      "--ref",
      "main",
      "--json",
      "--server",
      SERVER,
    ]);

    expect(harness.exits).toEqual([]);
    const filesUrl = new URL(harness.requests[1].url);
    expect(filesUrl.searchParams.get("ref")).toBe("main");
    const payload = JSON.parse(harness.logs[0]);
    expect(payload.ref).toBe("main");
  });

  test("search files default text emits one path per line, best first", async () => {
    const filesPayload = {
      ref: "worktree",
      generation: 1,
      files: [
        { path: "src/example.ts", type: "blob" },
        { path: "src/sample.ts", type: "blob" },
        { path: "docs/readme.md", type: "blob" },
      ],
      truncated: false,
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(filesPayload) },
    ]);

    await runAndCatchExit(["files", "--term", "sample", "--server", SERVER]);

    expect(harness.exits).toEqual([]);
    expect(harness.errs).toEqual([]);
    // The fuzzy ranking puts the basename-prefix match ("src/sample.ts") above
    // any other partial match. "docs/readme.md" has no "sample" letters in
    // order, so it is not included.
    expect(harness.logs[0]).toBe("src/sample.ts");
    expect(harness.logs.includes("docs/readme.md")).toBe(false);
  });

  test("search files with no matches prints `no matching files` to stderr (exit 0)", async () => {
    const filesPayload = {
      ref: "worktree",
      generation: 1,
      files: [{ path: "docs/readme.md", type: "blob" }],
      truncated: false,
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(filesPayload) },
    ]);

    await runAndCatchExit([
      "files",
      "--term",
      "zzz-no-such-token",
      "--server",
      SERVER,
    ]);

    expect(harness.exits).toEqual([]);
    expect(harness.logs).toEqual([]);
    expect(harness.errs).toEqual(["no matching files"]);
  });

  test("search files --max slices results and reports truncated=true", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      path: `src/sample-${i}.ts`,
      type: "blob" as const,
    }));
    const filesPayload = {
      ref: "worktree",
      generation: 1,
      files,
      truncated: false,
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(filesPayload) },
    ]);

    await runAndCatchExit([
      "files",
      "--term",
      "sample",
      "--max",
      "2",
      "--json",
      "--server",
      SERVER,
    ]);

    expect(harness.exits).toEqual([]);
    const payload = JSON.parse(harness.logs[0]);
    expect(payload.matches.length).toBe(2);
    expect(payload.totalMatches).toBe(5);
    expect(payload.totalCandidates).toBe(5);
    expect(payload.truncated).toBe(true);
    expect(payload.candidateTruncated).toBe(false);
  });

  test("search files default text emits stderr hint when truncated", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      path: `src/sample-${i}.ts`,
      type: "blob" as const,
    }));
    const filesPayload = {
      ref: "worktree",
      generation: 1,
      files,
      truncated: false,
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(filesPayload) },
    ]);

    await runAndCatchExit([
      "files",
      "--term",
      "sample",
      "--max",
      "2",
      "--server",
      SERVER,
    ]);

    expect(harness.exits).toEqual([]);
    expect(harness.logs.length).toBe(2);
    expect(harness.errs.length).toBe(1);
    expect(harness.errs[0].includes("truncated")).toBe(true);
    expect(harness.errs[0].includes("of 5 matches")).toBe(true);
  });

  test("search files surfaces server-side truncation as a stderr note", async () => {
    const filesPayload = {
      ref: "worktree",
      generation: 1,
      files: [{ path: "src/sample.ts", type: "blob" }],
      truncated: true,
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(filesPayload) },
    ]);

    await runAndCatchExit(["files", "--term", "sample", "--server", SERVER]);

    expect(harness.exits).toEqual([]);
    expect(harness.errs.length).toBe(1);
    expect(harness.errs[0].includes("server file list was truncated")).toBe(
      true,
    );
  });

  test("search files --json surfaces server-side candidate truncation", async () => {
    const filesPayload = {
      ref: "worktree",
      generation: 1,
      files: [{ path: "src/sample.ts", type: "blob" }],
      truncated: true,
    };
    const harness = installRunHarness([
      { body: "ok", contentType: "text/plain" },
      { body: JSON.stringify(filesPayload) },
    ]);

    await runAndCatchExit([
      "files",
      "--term",
      "sample",
      "--json",
      "--server",
      SERVER,
    ]);

    expect(harness.exits).toEqual([]);
    expect(harness.errs).toEqual([]);
    const payload = JSON.parse(harness.logs[0]);
    expect(payload.truncated).toBe(false);
    expect(payload.candidateTruncated).toBe(true);
  });

  test("search files parse failure exits 1 without reaching the server", async () => {
    const harness = installRunHarness([]);
    await runAndCatchExit(["files", "--term", "sample", "--regex"]);
    expect(harness.requests).toEqual([]);
    expect(harness.exits).toEqual([1]);
    expect(harness.errs[0]).toBe("search files does not accept --regex");
  });
});
