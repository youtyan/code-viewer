// Behavior tests for the MCP adapter (web-src/server/mcp.ts).
//
// Layered to keep diagnosis cheap:
//   1. dispatchJsonRpc: pure-input → pure-output. Anchors the JSON-RPC
//      envelope shape, initialize / tools/list / tools/call / ping /
//      unknown / invalid handling without HTTP.
//   2. defaultMcpTools: pure tool invocation against a tmp git fixture
//      (no HTTP). Pins the StatusReport contract code_viewer_status
//      returns.
//   3. /_mcp via a real startServer: HTTP method guards, content-type
//      guards, host/origin guards, body cap, end-to-end tools/call. This
//      layer is what an MCP client actually hits.
//
// No string-presence "implementation contains foo" assertions — every
// check verifies an observable JSON shape or HTTP behavior.

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentHelpIndex } from "../server/agent-help";
import {
  defaultMcpTools,
  dispatchJsonRpc,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  MCP_PROTOCOL_VERSION,
  type McpTool,
  parseJsonRpcBody,
} from "../server/mcp";
import { runGit as git } from "./_git-fixture";

const TOOLS: readonly McpTool[] = defaultMcpTools();
const INSTRUCTIONS = "test instructions text";

function call(message: unknown) {
  return dispatchJsonRpc(message, { tools: TOOLS, instructions: INSTRUCTIONS });
}

function seedSampleSqlite(dir: string, fileName = "sample_data.db"): string {
  const db = new Database(join(dir, fileName));
  db.exec(`
    CREATE TABLE sample_items (
      sample_id INTEGER PRIMARY KEY,
      sample_label TEXT NOT NULL
    );
    INSERT INTO sample_items (sample_label) VALUES ('alpha'), ('beta');
  `);
  db.close();
  return fileName;
}

// Sample-named registry stub so reading the server registry never returns
// a pinned --server line (we want next steps to behave deterministically).
let originalRegistryDir: string | undefined;
let registryDirStub: string;
beforeAll(() => {
  registryDirStub = mkdtempSync(join(tmpdir(), "code-viewer-mcp-registry-"));
  originalRegistryDir = process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
  process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = registryDirStub;
});
afterAll(() => {
  if (originalRegistryDir === undefined) {
    delete process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
  } else {
    process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = originalRegistryDir;
  }
  rmSync(registryDirStub, { recursive: true, force: true });
});

describe("dispatchJsonRpc — initialize", () => {
  test("returns protocolVersion, capabilities.tools, serverInfo, and instructions", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(result.kind).toBe("response");
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.jsonrpc).toBe("2.0");
    expect(result.body.id).toBe(1);
    expect(result.body.error).toBeUndefined();
    const payload = result.body.result as {
      protocolVersion: string;
      capabilities: { tools: { listChanged: boolean } };
      serverInfo: { name: string; version: string };
      instructions: string;
    };
    expect(payload.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(payload.capabilities.tools.listChanged).toBe(false);
    expect(payload.serverInfo.name).toBe("code-viewer");
    expect(typeof payload.serverInfo.version).toBe("string");
    expect(payload.instructions).toBe(INSTRUCTIONS);
  });

  test("omits instructions when none were configured", async () => {
    const result = await dispatchJsonRpc(
      { jsonrpc: "2.0", id: 7, method: "initialize" },
      { tools: TOOLS },
    );
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as { instructions?: string };
    expect(payload.instructions).toBeUndefined();
  });
});

describe("dispatchJsonRpc — notifications", () => {
  test("notifications/initialized produces no response (HTTP 202 hint)", async () => {
    const result = await call({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(result.kind).toBe("notification");
  });

  test("any request without an id is treated as a notification", async () => {
    const result = await call({
      jsonrpc: "2.0",
      method: "tools/list",
    });
    expect(result.kind).toBe("notification");
  });

  test("JSON-RPC response inputs produce no response (HTTP 202 hint)", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: "client-response",
      result: { ok: true },
    });
    expect(result.kind).toBe("notification");
  });
});

describe("dispatchJsonRpc — tools/list", () => {
  test("returns the tool inventory with name/title/description/inputSchema", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: "list-1",
      method: "tools/list",
    });
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.error).toBeUndefined();
    const payload = result.body.result as {
      tools: Array<{
        name: string;
        title: string;
        description: string;
        inputSchema: { type: string; properties: Record<string, unknown> };
      }>;
    };
    const names = payload.tools.map((t) => t.name);
    expect(names.includes("code_viewer_agent_help")).toBe(true);
    expect(names.includes("code_viewer_status")).toBe(true);
    expect(names.includes("code_viewer_file_show")).toBe(true);
    expect(names.includes("code_viewer_search_files")).toBe(true);
    expect(names.includes("code_viewer_search_code")).toBe(true);
    expect(names.includes("code_viewer_datastore_sources")).toBe(true);
    expect(names.includes("code_viewer_datastore_schemas")).toBe(true);
    expect(names.includes("code_viewer_datastore_schema")).toBe(true);
    expect(names.includes("code_viewer_datastore_columns")).toBe(true);
    expect(names.includes("code_viewer_datastore_ddl")).toBe(true);
    expect(names.includes("code_viewer_datastore_query")).toBe(true);
    for (const tool of payload.tools) {
      expect(typeof tool.title).toBe("string");
      expect(tool.title.length > 0).toBe(true);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length > 0).toBe(true);
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.inputSchema.properties).toBe("object");
    }
  });
});

describe("dispatchJsonRpc — tools/call code_viewer_agent_help", () => {
  test("returns the exact buildAgentHelpIndex() text wrapped as MCP text content", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: { name: "code_viewer_agent_help", arguments: {} },
    });
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.error).toBeUndefined();
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(false);
    expect(payload.content.length).toBe(1);
    expect(payload.content[0].type).toBe("text");
    // Identity with the CLI's agent-help text — proves no drift.
    expect(payload.content[0].text).toBe(buildAgentHelpIndex());
  });
});

describe("dispatchJsonRpc — tools/call code_viewer_status (fixture repo)", () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-mcp-status-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "sample-author"]);
    git(repo, ["config", "user.name", "sample-author"]);
    writeFileSync(join(repo, "sample_file.ts"), "export const sample = 1;\n");
    git(repo, ["add", "sample_file.ts"]);
    git(repo, ["commit", "-m", "sample initial commit"]);
    // Add a worktree edit so changed/staged is populated.
    writeFileSync(
      join(repo, "sample_file.ts"),
      "export const sample = 1;\nexport const extra = 2;\n",
    );
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("returns StatusReport JSON text identical to buildStatusReport shape", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: "status-1",
      method: "tools/call",
      params: {
        name: "code_viewer_status",
        arguments: { cwd: repo, ref: "HEAD", limit: 5 },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.error).toBeUndefined();
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(false);
    const report = JSON.parse(payload.content[0].text);
    expect(report.branch).toBe("main");
    expect(report.remoteWebUrl).toBeNull();
    expect(report.changed.totals.files).toBe(1);
    expect(report.changed.files[0].path).toBe("sample_file.ts");
    expect(report.recentCommits.length).toBe(1);
    expect(report.recentCommits[0].subject).toBe("sample initial commit");
    expect(Array.isArray(report.nextCommands)).toBe(true);
  });

  test("uses the configured default cwd when cwd argument is omitted", async () => {
    const result = await dispatchJsonRpc(
      {
        jsonrpc: "2.0",
        id: "status-default-cwd",
        method: "tools/call",
        params: {
          name: "code_viewer_status",
          arguments: { ref: "HEAD", limit: 1 },
        },
      },
      { tools: defaultMcpTools({ cwd: repo }) },
    );
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(false);
    const report = JSON.parse(payload.content[0].text);
    expect(report.branch).toBe("main");
    expect(report.recentCommits[0].subject).toBe("sample initial commit");
  });

  test("returns isError content (not JSON-RPC error) when cwd is invalid", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "code_viewer_status",
        arguments: { cwd: "/no/such/path/sample" },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.error).toBeUndefined();
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(
      /must point to an existing directory/,
    );
  });

  test("rejects unsafe ref values with isError true and a descriptive text", async () => {
    for (const bad of [
      { input: { ref: "" }, expect: /non-empty/ },
      { input: { ref: "a\nb" }, expect: /single-line/ },
      { input: { ref: "--inject" }, expect: /must not start with '-'/ },
    ] as const) {
      const result = await call({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "code_viewer_status",
          arguments: { cwd: repo, ref: bad.input.ref },
        },
      });
      if (result.kind !== "response") throw new Error("expected response");
      const payload = result.body.result as {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      };
      expect(payload.isError).toBe(true);
      expect(payload.content[0].text).toMatch(bad.expect);
    }
  });

  test("rejects limit outside [1, hard_cap] with isError true", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "code_viewer_status",
        arguments: { cwd: repo, limit: 0 },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/integer in \[1, /);
  });
});

describe("dispatchJsonRpc — tools/call datastore tools (fixture sqlite)", () => {
  let repo: string;
  let dbFile: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-mcp-datastore-"));
    dbFile = seedSampleSqlite(repo);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  async function callDatastore(name: string, args: Record<string, unknown>) {
    const result = await call({
      jsonrpc: "2.0",
      id: `datastore-${name}`,
      method: "tools/call",
      params: {
        name,
        arguments: { cwd: repo, ...args },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    return result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
  }

  test("code_viewer_datastore_schema works without a prior sources call", async () => {
    const payload = await callDatastore("code_viewer_datastore_schema", {
      db: dbFile,
      includeColumns: false,
    });
    expect(payload.isError).toBe(false);
    const body = JSON.parse(payload.content[0].text);
    expect(body.tables[0].name).toBe("sample_items");
  });

  test("code_viewer_datastore_sources discovers the SQLite source", async () => {
    const payload = await callDatastore("code_viewer_datastore_sources", {});
    expect(payload.isError).toBe(false);
    const body = JSON.parse(payload.content[0].text);
    const source = body.files.find(
      (file: { id: string }) => file.id === dbFile,
    );
    expect(source).toEqual({
      id: dbFile,
      path: dbFile,
      name: dbFile,
      sizeBytes: source.sizeBytes,
      kind: "sqlite",
    });
    expect(typeof source.sizeBytes).toBe("number");
  });

  test("code_viewer_datastore_schemas returns the schemas JSON shape for SQLite", async () => {
    const payload = await callDatastore("code_viewer_datastore_schemas", {
      db: dbFile,
    });
    expect(payload.isError).toBe(false);
    const body = JSON.parse(payload.content[0].text);
    expect(body.dbId).toBe(dbFile);
    expect(body.schemas).toEqual([]);
    expect(body.selectedSchema).toBeUndefined();
  });

  test("code_viewer_datastore_schema includes tables and columns by default", async () => {
    const payload = await callDatastore("code_viewer_datastore_schema", {
      db: dbFile,
    });
    expect(payload.isError).toBe(false);
    const body = JSON.parse(payload.content[0].text);
    expect(body.dbId).toBe(dbFile);
    const table = body.tables.find(
      (entry: { name: string }) => entry.name === "sample_items",
    );
    expect(table).toEqual({
      name: "sample_items",
      type: "table",
      rowCount: 2,
    });
    expect(Array.isArray(body.indexes)).toBe(true);
    expect(Array.isArray(body.foreignKeys)).toBe(true);
    expect(Array.isArray(body.executedSql)).toBe(true);
    const columnNames = body.columnsMap.sample_items.map(
      (col: { name: string }) => col.name,
    );
    expect(columnNames).toEqual(["sample_id", "sample_label"]);
  });

  test("code_viewer_datastore_schema can omit columnsMap for a smaller payload", async () => {
    const payload = await callDatastore("code_viewer_datastore_schema", {
      db: dbFile,
      includeColumns: false,
    });
    expect(payload.isError).toBe(false);
    const body = JSON.parse(payload.content[0].text);
    expect(body.tables[0].name).toBe("sample_items");
    expect(body.columnsMap).toBeUndefined();
  });

  test("code_viewer_datastore_columns returns column metadata for a table", async () => {
    const payload = await callDatastore("code_viewer_datastore_columns", {
      db: dbFile,
      table: "sample_items",
    });
    expect(payload.isError).toBe(false);
    const body = JSON.parse(payload.content[0].text);
    expect(body.dbId).toBe(dbFile);
    expect(body.table).toBe("sample_items");
    expect(body.columns.map((col: { name: string }) => col.name)).toEqual([
      "sample_id",
      "sample_label",
    ]);
    expect(Array.isArray(body.executedSql)).toBe(true);
  });

  test("code_viewer_datastore_ddl returns create SQL and triggers for a table", async () => {
    const payload = await callDatastore("code_viewer_datastore_ddl", {
      db: dbFile,
      table: "sample_items",
    });
    expect(payload.isError).toBe(false);
    const body = JSON.parse(payload.content[0].text);
    expect(body.dbId).toBe(dbFile);
    expect(body.table).toBe("sample_items");
    expect(body.sql).toMatch(/CREATE TABLE sample_items/);
    expect(body.triggers).toEqual([]);
    expect(Array.isArray(body.executedSql)).toBe(true);
  });

  test("table-specific datastore tools require a table argument", async () => {
    const payload = await callDatastore("code_viewer_datastore_columns", {
      db: dbFile,
    });
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/table must be a string/);
  });

  test("datastore tools return isError=true for invalid db ids", async () => {
    const payload = await callDatastore("code_viewer_datastore_schema", {
      db: "../escape.db",
    });
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/invalid database path/);
  });

  test("code_viewer_datastore_query runs SELECT and returns the DbQueryResponse shape", async () => {
    const payload = await callDatastore("code_viewer_datastore_query", {
      db: dbFile,
      sql: "SELECT sample_id, sample_label FROM sample_items ORDER BY sample_id",
    });
    expect(payload.isError).toBe(false);
    const body = JSON.parse(payload.content[0].text);
    expect(body.dbId).toBe(dbFile);
    expect(body.columns).toEqual(["sample_id", "sample_label"]);
    expect(body.rowCount).toBe(2);
    expect(body.truncated).toBe(false);
    expect(body.rows.length).toBe(2);
    expect(body.rows[0]).toEqual([1, "alpha"]);
    expect(body.rows[1]).toEqual([2, "beta"]);
    expect(typeof body.elapsedMs).toBe("number");
    expect(Array.isArray(body.executedSql)).toBe(true);
    // saveHistory must be off in MCP — error field stays absent on success.
    expect(body.error).toBeUndefined();
  });

  test("code_viewer_datastore_query reports truncated=true when maxRows is below the row count", async () => {
    const payload = await callDatastore("code_viewer_datastore_query", {
      db: dbFile,
      sql: "SELECT sample_id FROM sample_items ORDER BY sample_id",
      maxRows: 1,
    });
    expect(payload.isError).toBe(false);
    const body = JSON.parse(payload.content[0].text);
    expect(body.rowCount).toBe(1);
    expect(body.rows.length).toBe(1);
    expect(body.truncated).toBe(true);
  });

  test("code_viewer_datastore_query rejects write keywords with the DbQueryResponse error shape", async () => {
    const payload = await callDatastore("code_viewer_datastore_query", {
      db: dbFile,
      sql: "INSERT INTO sample_items (sample_label) VALUES ('gamma')",
    });
    expect(payload.isError).toBe(true);
    const body = JSON.parse(payload.content[0].text);
    expect(body.dbId).toBe(dbFile);
    expect(body.rows).toEqual([]);
    expect(body.rowCount).toBe(0);
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/SELECT, PRAGMA, EXPLAIN, and WITH/);
  });

  test("code_viewer_datastore_query rejects a SELECT that hides a blocked keyword", async () => {
    const payload = await callDatastore("code_viewer_datastore_query", {
      db: dbFile,
      sql: "SELECT * FROM sample_items; DROP TABLE sample_items;",
    });
    expect(payload.isError).toBe(true);
    const body = JSON.parse(payload.content[0].text);
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/disallowed statement keyword/);
  });

  test("code_viewer_datastore_query rejects a missing sql argument", async () => {
    const payload = await callDatastore("code_viewer_datastore_query", {
      db: dbFile,
    });
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/sql must be a string/);
  });

  test("code_viewer_datastore_query rejects an empty sql argument", async () => {
    const payload = await callDatastore("code_viewer_datastore_query", {
      db: dbFile,
      sql: "   \n  ",
    });
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/non-empty/);
  });

  test("code_viewer_datastore_query rejects maxRows outside [1, 10000]", async () => {
    const payload = await callDatastore("code_viewer_datastore_query", {
      db: dbFile,
      sql: "SELECT 1",
      maxRows: 0,
    });
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(
      /maxRows must be an integer in \[1, 10000\]/,
    );
  });

  test("code_viewer_datastore_query reports invalid_database_path for an unsafe db id", async () => {
    const payload = await callDatastore("code_viewer_datastore_query", {
      db: "../escape.db",
      sql: "SELECT 1",
    });
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/invalid database path/);
  });
});

describe("dispatchJsonRpc — tools/call error paths", () => {
  test("unknown tool name surfaces as isError true (not JSON-RPC error)", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "code_viewer_does_not_exist", arguments: {} },
    });
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.error).toBeUndefined();
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/Unknown tool/);
  });

  test("tools/call missing name returns JSON-RPC -32602", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { arguments: {} },
    });
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.result).toBeUndefined();
    expect(result.body.error?.code).toBe(JSONRPC_INVALID_PARAMS);
  });

  test("tools/call without object params returns -32602", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: "string",
    });
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.error?.code).toBe(JSONRPC_INVALID_PARAMS);
  });
});

describe("dispatchJsonRpc — protocol-level errors", () => {
  test("unknown method returns JSON-RPC -32601 with the id echoed", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: "unk",
      method: "no/such/method",
    });
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.id).toBe("unk");
    expect(result.body.error?.code).toBe(JSONRPC_METHOD_NOT_FOUND);
  });

  test("ping returns the empty result envelope", async () => {
    const result = await call({ jsonrpc: "2.0", id: 99, method: "ping" });
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.result).toEqual({});
    expect(result.body.error).toBeUndefined();
  });

  test("non-object message returns -32600 with id=null", async () => {
    const result = await call(["not", "an", "object"]);
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.id).toBeNull();
    expect(result.body.error?.code).toBe(JSONRPC_INVALID_REQUEST);
  });

  test("wrong jsonrpc version returns -32600", async () => {
    const result = await call({ jsonrpc: "1.0", id: 1, method: "ping" });
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.error?.code).toBe(JSONRPC_INVALID_REQUEST);
  });

  test("missing method returns -32600", async () => {
    const result = await call({ jsonrpc: "2.0", id: 1 });
    if (result.kind !== "response") throw new Error("expected response");
    expect(result.body.error?.code).toBe(JSONRPC_INVALID_REQUEST);
  });
});

describe("parseJsonRpcBody", () => {
  test("empty body produces a -32700 envelope with id=null", () => {
    const result = parseJsonRpcBody("");
    expect(result.ok).toBe(false);
    if (result.ok === true) throw new Error("expected error");
    expect(result.response.id).toBeNull();
    expect(result.response.error?.code).toBe(JSONRPC_PARSE_ERROR);
  });

  test("invalid JSON produces a -32700 envelope", () => {
    const result = parseJsonRpcBody("{not json");
    expect(result.ok).toBe(false);
    if (result.ok === true) throw new Error("expected error");
    expect(result.response.error?.code).toBe(JSONRPC_PARSE_ERROR);
  });

  test("valid JSON returns the parsed value verbatim", () => {
    const result = parseJsonRpcBody('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    expect(result.ok).toBe(true);
    if (result.ok !== true) throw new Error("expected ok");
    expect(result.value).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });
  });
});

// ---- HTTP-layer behavior tests against a real running preview server ----
//
// We import preview.ts side-effect free by using a child process. The
// runtime layer is the same one production uses, so any guard
// (requestAllowed / method check / content-type) is exercised end-to-end.

describe("/_mcp HTTP route", () => {
  let repo: string;
  let serverPort: number;
  let serverProc: ReturnType<typeof import("node:child_process").spawn> | null =
    null;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-mcp-http-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "sample-author"]);
    git(repo, ["config", "user.name", "sample-author"]);
    writeFileSync(join(repo, "sample_file.ts"), "export const sample = 1;\n");
    git(repo, ["add", "sample_file.ts"]);
    git(repo, ["commit", "-m", "sample initial commit"]);
    seedSampleSqlite(repo, "datastore.db");

    const { spawn } = await import("node:child_process");
    const repoRoot = join(import.meta.dir, "..", "..");
    serverProc = spawn(
      process.execPath,
      ["run", "web-src/server/preview.ts", "--cwd", repo, "--port", "0"],
      {
        cwd: repoRoot,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const port = await new Promise<number>((resolve, reject) => {
      let buf = "";
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const m = buf.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (m) resolve(Number(m[1]));
      };
      serverProc?.stdout?.on("data", onData);
      serverProc?.stderr?.on("data", onData);
      serverProc?.once("exit", (code) =>
        reject(new Error(`preview exited early: code=${code}; buf=${buf}`)),
      );
      setTimeout(
        () => reject(new Error(`preview did not print port; buf=${buf}`)),
        15000,
      );
    });
    serverPort = port;
  });

  afterAll(async () => {
    if (!serverProc) return;
    serverProc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      serverProc?.once("exit", () => resolve());
      setTimeout(() => {
        serverProc?.kill("SIGKILL");
        resolve();
      }, 2000);
    });
    rmSync(repo, { recursive: true, force: true });
  });

  function origin() {
    return `http://127.0.0.1:${serverPort}`;
  }

  test("GET /_mcp returns 405 with an Allow header", async () => {
    const response = await fetch(`${origin()}/_mcp`);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  test("POST with non-JSON content-type returns 415", async () => {
    const response = await fetch(`${origin()}/_mcp`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });
    expect(response.status).toBe(415);
  });

  test("POST initialize over /_mcp returns the MCP initialize result", async () => {
    const response = await fetch(`${origin()}/_mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jsonrpc: string;
      id: number;
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(body.result.serverInfo.name).toBe("code-viewer");
  });

  test("POST notifications/initialized returns HTTP 202 with no body", async () => {
    const response = await fetch(`${origin()}/_mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  test("POST JSON-RPC response input returns HTTP 202 with no body", async () => {
    const response = await fetch(`${origin()}/_mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "client-response",
        result: { ok: true },
      }),
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  test("POST tools/call code_viewer_agent_help round-trip", async () => {
    const response = await fetch(`${origin()}/_mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "code_viewer_agent_help", arguments: {} },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: number;
      result: {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      };
    };
    expect(body.id).toBe(11);
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0].type).toBe("text");
    expect(body.result.content[0].text).toBe(buildAgentHelpIndex());
  });

  test("POST tools/call code_viewer_status uses the server --cwd by default", async () => {
    const response = await fetch(`${origin()}/_mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "code_viewer_status",
          arguments: { ref: "HEAD", limit: 1 },
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      };
    };
    expect(body.result.isError).toBe(false);
    const report = JSON.parse(body.result.content[0].text);
    expect(report.branch).toBe("main");
    expect(report.recentCommits[0].subject).toBe("sample initial commit");
  });

  test("disallowed Origin header is blocked by requestAllowed", async () => {
    const response = await fetch(`${origin()}/_mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://evil.example",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(response.status).toBe(403);
  });

  // The next four tests anchor the new MCP tools against the running
  // preview process; they prove that the preview --cwd is the default
  // root, and that /_grep and code_viewer_search_code give identical
  // matches for the same query.

  test("POST tools/call code_viewer_file_show defaults to the preview --cwd", async () => {
    const response = await fetch(`${origin()}/_mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: {
          name: "code_viewer_file_show",
          arguments: { path: "sample_file.ts" },
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      };
    };
    expect(body.result.isError).toBe(false);
    const report = JSON.parse(body.result.content[0].text);
    expect(report.path).toBe("sample_file.ts");
    expect(report.ref).toBe("worktree");
    expect(report.text).toBe("export const sample = 1;");
    expect(report.totalLines).toBe(1);
    expect(report.complete).toBe(true);
    expect(report.error).toBeUndefined();
  });

  test("POST tools/call code_viewer_file_show returns isError=true with the file payload for a missing path", async () => {
    const response = await fetch(`${origin()}/_mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: {
          name: "code_viewer_file_show",
          arguments: { path: "no_such_sample.ts" },
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      };
    };
    expect(body.result.isError).toBe(true);
    const report = JSON.parse(body.result.content[0].text);
    expect(report.path).toBe("no_such_sample.ts");
    expect(typeof report.error).toBe("string");
    expect(report.totalLines).toBe(0);
    expect(report.text).toBe("");
  });

  test("POST tools/call code_viewer_search_files ranks the preview cwd's paths", async () => {
    const response = await fetch(`${origin()}/_mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 23,
        method: "tools/call",
        params: {
          name: "code_viewer_search_files",
          arguments: { term: "sample" },
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      };
    };
    expect(body.result.isError).toBe(false);
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload.ref).toBe("worktree");
    expect(payload.mode).toBe("fuzzy");
    expect(payload.query).toBe("sample");
    expect(payload.matches.length >= 1).toBe(true);
    expect(payload.matches[0].path).toBe("sample_file.ts");
    // The CLI shape requires score / ranges on each match.
    expect(typeof payload.matches[0].score).toBe("number");
    expect(Array.isArray(payload.matches[0].ranges)).toBe(true);
  });

  test("POST tools/call code_viewer_search_code matches the /_grep response for the same query", async () => {
    const grepResponse = await fetch(
      `${origin()}/_grep?q=${encodeURIComponent("sample")}`,
    );
    expect(grepResponse.status).toBe(200);
    const grepBody = await grepResponse.json();

    const mcpResponse = await fetch(`${origin()}/_mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 24,
        method: "tools/call",
        params: {
          name: "code_viewer_search_code",
          arguments: { term: "sample" },
        },
      }),
    });
    expect(mcpResponse.status).toBe(200);
    const mcpEnvelope = (await mcpResponse.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      };
    };
    expect(mcpEnvelope.result.isError).toBe(false);
    const mcpBody = JSON.parse(mcpEnvelope.result.content[0].text);
    // engine / truncated / ref / matches all come from the same
    // grepRepo entry point. /_grep and MCP must agree match-for-match.
    expect(mcpBody).toEqual(grepBody);
  });

  test("POST tools/call code_viewer_datastore_sources uses the server --cwd by default", async () => {
    const response = await fetch(`${origin()}/_mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 25,
        method: "tools/call",
        params: {
          name: "code_viewer_datastore_sources",
          arguments: {},
        },
      }),
    });
    expect(response.status).toBe(200);
    const envelope = (await response.json()) as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      };
    };
    expect(envelope.result.isError).toBe(false);
    const body = JSON.parse(envelope.result.content[0].text);
    const source = body.files.find(
      (file: { id: string }) => file.id === "datastore.db",
    );
    expect(source.kind).toBe("sqlite");
    expect(source.path).toBe("datastore.db");
  });
});

// Pure-input tool coverage for the 3 new read-only tools. We exercise
// success and every input-validation branch without spawning preview,
// using fixture repositories. This is the "fast" half of the test
// matrix; the HTTP block above is the integration half.
describe("dispatchJsonRpc — tools/call code_viewer_file_show (fixture repo)", () => {
  let repo: string;
  let secondSha: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-mcp-file-show-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "sample-author"]);
    git(repo, ["config", "user.name", "sample-author"]);
    writeFileSync(
      join(repo, "sample_file.ts"),
      "line one\nline two\nline three\nline four\n",
    );
    git(repo, ["add", "sample_file.ts"]);
    git(repo, ["commit", "-m", "sample initial commit"]);
    secondSha = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
    writeFileSync(
      join(repo, "sample_file.ts"),
      "line one\nline two\nline three\nline four\nline five from worktree\n",
    );
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("reads the worktree version with totalLines/complete", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 100,
      method: "tools/call",
      params: {
        name: "code_viewer_file_show",
        arguments: { cwd: repo, path: "sample_file.ts" },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(false);
    const report = JSON.parse(payload.content[0].text);
    expect(report.ref).toBe("worktree");
    expect(report.totalLines).toBe(5);
    expect(report.complete).toBe(true);
    expect(report.text.endsWith("line five from worktree")).toBe(true);
  });

  test("slices [start..end] and reports complete=false when shorter than total", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 101,
      method: "tools/call",
      params: {
        name: "code_viewer_file_show",
        arguments: { cwd: repo, path: "sample_file.ts", start: 2, end: 3 },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(false);
    const report = JSON.parse(payload.content[0].text);
    expect(report.start).toBe(2);
    expect(report.end).toBe(3);
    expect(report.text).toBe("line two\nline three");
    expect(report.totalLines).toBe(5);
    expect(report.complete).toBe(false);
  });

  test("reads a committed ref instead of the worktree", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 102,
      method: "tools/call",
      params: {
        name: "code_viewer_file_show",
        arguments: { cwd: repo, path: "sample_file.ts", ref: secondSha },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(false);
    const report = JSON.parse(payload.content[0].text);
    expect(report.ref).toBe(secondSha);
    expect(report.totalLines).toBe(4);
    expect(report.text.includes("line five from worktree")).toBe(false);
  });

  test("rejects unsafe path values with isError true", async () => {
    for (const bad of [
      { path: "", expect: /non-empty/ },
      { path: "../escape", expect: /'\.\.' segments/ },
      { path: "/abs", expect: /repo-relative/ },
      { path: "-trick", expect: /must not start with '-'/ },
      { path: "with\nnewline", expect: /single-line/ },
    ] as const) {
      const result = await call({
        jsonrpc: "2.0",
        id: 103,
        method: "tools/call",
        params: {
          name: "code_viewer_file_show",
          arguments: { cwd: repo, path: bad.path },
        },
      });
      if (result.kind !== "response") throw new Error("expected response");
      const payload = result.body.result as {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      };
      expect(payload.isError).toBe(true);
      expect(payload.content[0].text).toMatch(bad.expect);
    }
  });

  test("rejects start without end (and vice versa) with isError true", async () => {
    for (const args of [
      { cwd: repo, path: "sample_file.ts", start: 1 },
      { cwd: repo, path: "sample_file.ts", end: 3 },
    ]) {
      const result = await call({
        jsonrpc: "2.0",
        id: 104,
        method: "tools/call",
        params: { name: "code_viewer_file_show", arguments: args },
      });
      if (result.kind !== "response") throw new Error("expected response");
      const payload = result.body.result as {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      };
      expect(payload.isError).toBe(true);
      expect(payload.content[0].text).toMatch(/together/);
    }
  });

  test("rejects end < start with isError true", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 105,
      method: "tools/call",
      params: {
        name: "code_viewer_file_show",
        arguments: { cwd: repo, path: "sample_file.ts", start: 5, end: 2 },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/end must be >= start/);
  });
});

describe("dispatchJsonRpc — tools/call code_viewer_search_files (fixture repo)", () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-mcp-search-files-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "sample-author"]);
    git(repo, ["config", "user.name", "sample-author"]);
    writeFileSync(join(repo, "sample_file.ts"), "export const sample = 1;\n");
    writeFileSync(join(repo, "other_sample.ts"), "export const other = 2;\n");
    writeFileSync(join(repo, "unrelated.md"), "doc\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "sample initial commit"]);
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("fuzzy mode ranks file names containing the term", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 110,
      method: "tools/call",
      params: {
        name: "code_viewer_search_files",
        arguments: { cwd: repo, term: "sample" },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(false);
    const body = JSON.parse(payload.content[0].text);
    expect(body.mode).toBe("fuzzy");
    expect(body.ref).toBe("worktree");
    expect(body.candidateTruncated).toBe(false);
    const paths = body.matches.map((m: { path: string }) => m.path).sort();
    expect(paths.includes("sample_file.ts")).toBe(true);
    expect(paths.includes("other_sample.ts")).toBe(true);
    expect(paths.includes("unrelated.md")).toBe(false);
  });

  test("glob mode triggers on terms containing * or ?", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 111,
      method: "tools/call",
      params: {
        name: "code_viewer_search_files",
        arguments: { cwd: repo, term: "*.md" },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    const body = JSON.parse(payload.content[0].text);
    expect(body.mode).toBe("glob");
    const paths = body.matches.map((m: { path: string }) => m.path);
    expect(paths.includes("unrelated.md")).toBe(true);
    expect(paths.includes("sample_file.ts")).toBe(false);
  });

  test("max above hard cap is rejected", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 112,
      method: "tools/call",
      params: {
        name: "code_viewer_search_files",
        arguments: { cwd: repo, term: "sample", max: 999999 },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/max must be an integer in \[1, /);
  });

  test("empty term is rejected with isError true", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 113,
      method: "tools/call",
      params: {
        name: "code_viewer_search_files",
        arguments: { cwd: repo, term: "" },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/non-empty/);
  });
});

describe("dispatchJsonRpc — tools/call code_viewer_search_code (fixture repo)", () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-mcp-search-code-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "sample-author"]);
    git(repo, ["config", "user.name", "sample-author"]);
    writeFileSync(
      join(repo, "sample_file.ts"),
      "export const sample = 1;\nexport const beta = 2;\n",
    );
    writeFileSync(join(repo, "other_sample.ts"), "export const sample = 3;\n");
    // Third "control" file used by the restricts-results test below to
    // prove the paths[] filter actually drops out-of-scope files.
    writeFileSync(
      join(repo, "control_sample.ts"),
      "export const sample = 999;\n",
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "sample initial commit"]);
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("returns GrepResponse with matches across files", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 120,
      method: "tools/call",
      params: {
        name: "code_viewer_search_code",
        arguments: { cwd: repo, term: "sample" },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(false);
    const body = JSON.parse(payload.content[0].text);
    expect(body.ref).toBe("worktree");
    expect(["rg", "git", "fallback"].includes(body.engine)).toBe(true);
    expect(Array.isArray(body.matches)).toBe(true);
    expect(body.matches.length >= 2).toBe(true);
    // rg returns paths prefixed with "./" when scanning from cwd; git
    // grep / fallback return bare names. Normalise both before asserting.
    const normalize = (path: string) =>
      path.startsWith("./") ? path.slice(2) : path;
    const paths = new Set(
      body.matches.map((m: { path: string }) => normalize(m.path)),
    );
    expect(paths.has("sample_file.ts")).toBe(true);
    expect(paths.has("other_sample.ts")).toBe(true);
  });

  test("restricts results when paths[] is supplied", async () => {
    // control_sample.ts contains "sample" too; omitting it from paths
    // proves the filter actually narrows even when only one path is passed.
    const result = await call({
      jsonrpc: "2.0",
      id: 121,
      method: "tools/call",
      params: {
        name: "code_viewer_search_code",
        arguments: {
          cwd: repo,
          term: "sample",
          paths: ["sample_file.ts"],
        },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    const body = JSON.parse(payload.content[0].text);
    const paths = new Set(body.matches.map((m: { path: string }) => m.path));
    expect(paths.has("control_sample.ts")).toBe(false);
    expect(paths.has("sample_file.ts")).toBe(true);
  });

  test("rejects non-array paths with isError true", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 122,
      method: "tools/call",
      params: {
        name: "code_viewer_search_code",
        arguments: { cwd: repo, term: "sample", paths: "sample_file.ts" },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/array of strings/);
  });

  test("empty term is rejected with isError true", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 123,
      method: "tools/call",
      params: {
        name: "code_viewer_search_code",
        arguments: { cwd: repo, term: "" },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/non-empty/);
  });

  test("regex flag must be a boolean", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 124,
      method: "tools/call",
      params: {
        name: "code_viewer_search_code",
        arguments: { cwd: repo, term: "sample", regex: "yes" },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/regex must be a boolean/);
  });

  test("unknown ref returns the service's 'invalid target' error", async () => {
    const result = await call({
      jsonrpc: "2.0",
      id: 125,
      method: "tools/call",
      params: {
        name: "code_viewer_search_code",
        arguments: {
          cwd: repo,
          term: "sample",
          ref: "ref-that-does-not-exist",
        },
      },
    });
    if (result.kind !== "response") throw new Error("expected response");
    const payload = result.body.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toMatch(/invalid target/);
  });
});
