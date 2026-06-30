// Minimal MCP (Model Context Protocol) Streamable HTTP adapter.
//
// Wraps the existing read-only CLI surface (status / agent-help) as MCP
// tools so MCP-capable AI agents can call code-viewer without shelling out
// to npx per call.
// Mounted at `/_mcp` by preview.ts; this module owns parsing,
// dispatch, and tool definitions but knows nothing about HTTP.
//
// Spec alignment (MCP 2025-06-18 + JSON-RPC 2.0):
//   - initialize → { protocolVersion, capabilities, serverInfo, instructions }
//   - notifications/initialized → no response (caller returns HTTP 202)
//   - tools/list → { tools: [...] }
//   - tools/call → { content: [{ type: "text", text }], isError }
//   - ping → {}
//   - unknown method → JSON-RPC error -32601
//   - malformed envelope → JSON-RPC error -32600 / -32700
//
// Reuse:
//   - tool inventory text comes from `buildAgentHelpIndex()` so the MCP
//     surface and the CLI agent-help index never drift.
//   - `code_viewer_status` invokes `buildStatusReport` (the same payload
//     `code-viewer status --json` emits).
//   - `resolveRepoRootSafe` replaces the CLI's exit-on-failure helper so
//     a bad --cwd is reported as an MCP tool error, not a server crash.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_GUIDES, buildAgentHelpIndex } from "./agent-help";
import { resolveRepoRootSafe } from "./cli-helpers";
import { ROOT } from "./root";
import {
  buildStatusReport,
  STATUS_DEFAULT_LIMIT,
  STATUS_DEFAULT_REF,
  STATUS_HARD_CAP_LIMIT,
} from "./status-cli";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

const PACKAGE_VERSION = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
).version as string;

export const MCP_SERVER_INFO = {
  name: "code-viewer",
  title: "code-viewer",
  version: PACKAGE_VERSION,
} as const;

// JSON-RPC error codes (subset used here)
export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

export type JsonRpcId = string | number | null;

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorObject;
};

export type McpToolContent = { type: "text"; text: string };

export type McpToolResult = {
  content: McpToolContent[];
  isError?: boolean;
};

export type McpToolRunReturn = {
  text: string;
  isError?: boolean;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  // Minimal JSON Schema; we only emit type/properties/required to keep
  // the wire shape predictable. Validation is done in `run` so each tool
  // can phrase errors in its own vocabulary.
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  run(input: unknown): McpToolRunReturn | Promise<McpToolRunReturn>;
};

export type McpDispatchOptions = {
  tools: readonly McpTool[];
  serverInfo?: { name: string; title?: string; version: string };
  instructions?: string;
};

export type McpDispatchResult =
  | { kind: "response"; body: JsonRpcResponse }
  | { kind: "notification" };

// Build the default tool inventory. Exported so preview.ts can mount it
// and tests can introspect the list without standing up an HTTP server.
export function defaultMcpTools(options: { cwd?: string } = {}): McpTool[] {
  return [
    {
      name: "code_viewer_agent_help",
      title: "code-viewer agent-help index",
      description:
        "Returns the same text the CLI prints for `code-viewer agent-help` — a discovery index of every AI-facing subcommand guide (status / query / annotate / search / file / skill / doctor) plus its rerun command. Run this first when you do not yet know which subcommand fits.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run() {
        return { text: buildAgentHelpIndex() };
      },
    },
    {
      name: "code_viewer_status",
      title: "code-viewer status snapshot",
      description:
        "Returns the same JSON payload `code-viewer status --json` emits: repoRoot, branch, remoteWebUrl, changed (worktree vs HEAD), staged (index vs HEAD), recentCommits, recentCommitsError (only when --ref is unreachable), and nextCommands. Read-only. Use this as the first orientation step inside a repository.",
      inputSchema: {
        type: "object",
        properties: {
          cwd: {
            type: "string",
            description:
              "Repository to inspect. Absolute path. Defaults to the directory the code-viewer server was started in.",
          },
          ref: {
            type: "string",
            description: `Git ref recent commits are read from. Defaults to ${STATUS_DEFAULT_REF}.`,
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: STATUS_HARD_CAP_LIMIT,
            description: `Recent commits to include. Default ${STATUS_DEFAULT_LIMIT}, max ${STATUS_HARD_CAP_LIMIT}.`,
          },
        },
        additionalProperties: false,
      },
      run(input) {
        return runStatusTool(input, options.cwd);
      },
    },
  ];
}

function runStatusTool(input: unknown, defaultCwd?: string): McpToolRunReturn {
  const params = isPlainObject(input) ? input : {};
  const cwdRaw = params.cwd;
  const refRaw = params.ref;
  const limitRaw = params.limit;

  if (cwdRaw !== undefined && typeof cwdRaw !== "string") {
    return { text: "cwd must be a string", isError: true };
  }
  if (refRaw !== undefined && typeof refRaw !== "string") {
    return { text: "ref must be a string", isError: true };
  }
  let ref = STATUS_DEFAULT_REF;
  if (typeof refRaw === "string") {
    if (!refRaw)
      return { text: "ref must be a non-empty string", isError: true };
    if (refRaw.includes("\0") || /[\r\n]/.test(refRaw)) {
      return {
        text: "ref must be single-line and must not contain NUL",
        isError: true,
      };
    }
    if (refRaw.startsWith("-")) {
      return { text: "ref must not start with '-'", isError: true };
    }
    ref = refRaw;
  }

  let limit = STATUS_DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    if (
      typeof limitRaw !== "number" ||
      !Number.isInteger(limitRaw) ||
      limitRaw < 1 ||
      limitRaw > STATUS_HARD_CAP_LIMIT
    ) {
      return {
        text: `limit must be an integer in [1, ${STATUS_HARD_CAP_LIMIT}]`,
        isError: true,
      };
    }
    limit = limitRaw;
  }

  const resolved = resolveRepoRootSafe(
    typeof cwdRaw === "string" ? cwdRaw : defaultCwd,
  );
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  try {
    const report = buildStatusReport({ root: resolved.root, ref, limit });
    return { text: JSON.stringify(report, null, 2) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: `status failed: ${detail}`, isError: true };
  }
}

// Instructions surfaced by initialize. AI agents see this in their MCP
// client UI as the server's "what am I" text. Build it from the live
// agent-help index so adding a new subcommand to AGENT_GUIDES propagates
// here automatically.
export function buildMcpInstructions(): string {
  const lines: string[] = [
    "code-viewer MCP — local, read-only access to the running code-viewer server.",
    "",
    "Tools:",
    "  - code_viewer_agent_help: discover every AI-facing CLI subcommand.",
    "  - code_viewer_status: orient yourself inside the current repository.",
    "",
    "The CLI subcommands referenced by code_viewer_agent_help are:",
  ];
  for (const guide of AGENT_GUIDES) {
    lines.push(`  - ${guide.name}: ${guide.signature}`);
  }
  return `${lines.join("\n")}\n`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isValidJsonRpcId(value: unknown): value is JsonRpcId {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  const error: JsonRpcErrorObject = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

// Parse a raw HTTP body into a JSON value. Empty body / invalid JSON
// surfaces as a -32700 parse error response (id=null per spec).
export function parseJsonRpcBody(
  body: string,
): { ok: true; value: unknown } | { ok: false; response: JsonRpcResponse } {
  if (body.trim() === "") {
    return {
      ok: false,
      response: jsonRpcError(
        null,
        JSONRPC_PARSE_ERROR,
        "Parse error: empty body",
      ),
    };
  }
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      response: jsonRpcError(
        null,
        JSONRPC_PARSE_ERROR,
        `Parse error: ${detail}`,
      ),
    };
  }
}

// Dispatch a single JSON-RPC envelope. Returns { kind: "notification" }
// when the caller should respond with HTTP 202 no body, otherwise
// returns { kind: "response", body } with a JSON-RPC envelope.
export async function dispatchJsonRpc(
  message: unknown,
  options: McpDispatchOptions,
): Promise<McpDispatchResult> {
  if (!isPlainObject(message)) {
    return {
      kind: "response",
      body: jsonRpcError(
        null,
        JSONRPC_INVALID_REQUEST,
        "Invalid Request: message must be a JSON object",
      ),
    };
  }
  if (message.jsonrpc !== "2.0") {
    return {
      kind: "response",
      body: jsonRpcError(
        isValidJsonRpcId(message.id) ? (message.id as JsonRpcId) : null,
        JSONRPC_INVALID_REQUEST,
        'Invalid Request: jsonrpc must be "2.0"',
      ),
    };
  }
  if (!("method" in message) && ("result" in message || "error" in message)) {
    return { kind: "notification" };
  }
  if (typeof message.method !== "string" || message.method.length === 0) {
    return {
      kind: "response",
      body: jsonRpcError(
        isValidJsonRpcId(message.id) ? (message.id as JsonRpcId) : null,
        JSONRPC_INVALID_REQUEST,
        "Invalid Request: method must be a non-empty string",
      ),
    };
  }

  const method = message.method;
  const params = message.params;
  // JSON.parse only produces own properties so `in` matches hasOwn here.
  // hasOwn is ES2022; tsconfig pins ES2020, so avoid Object.hasOwn.
  const hasId = "id" in message;
  const id = hasId ? (message.id as JsonRpcId) : null;

  // Notifications (no `id` field) never produce a response. The MCP spec
  // requires HTTP 202 no body — the route caller handles that.
  if (!hasId) {
    return { kind: "notification" };
  }
  if (!isValidJsonRpcId(message.id)) {
    return {
      kind: "response",
      body: jsonRpcError(
        null,
        JSONRPC_INVALID_REQUEST,
        "Invalid Request: id must be a string, number, or null",
      ),
    };
  }

  try {
    switch (method) {
      case "initialize":
        return {
          kind: "response",
          body: jsonRpcResult(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: options.serverInfo ?? MCP_SERVER_INFO,
            ...(options.instructions
              ? { instructions: options.instructions }
              : {}),
          }),
        };
      case "ping":
        return { kind: "response", body: jsonRpcResult(id, {}) };
      case "tools/list":
        return {
          kind: "response",
          body: jsonRpcResult(id, {
            tools: options.tools.map((tool) => ({
              name: tool.name,
              title: tool.title,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          }),
        };
      case "tools/call":
        return {
          kind: "response",
          body: await handleToolsCall(id, params, options.tools),
        };
      default:
        return {
          kind: "response",
          body: jsonRpcError(
            id,
            JSONRPC_METHOD_NOT_FOUND,
            `Method not found: ${method}`,
          ),
        };
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      kind: "response",
      body: jsonRpcError(
        id,
        JSONRPC_INTERNAL_ERROR,
        `Internal error: ${detail}`,
      ),
    };
  }
}

async function handleToolsCall(
  id: JsonRpcId,
  rawParams: unknown,
  tools: readonly McpTool[],
): Promise<JsonRpcResponse> {
  if (!isPlainObject(rawParams)) {
    return jsonRpcError(
      id,
      JSONRPC_INVALID_PARAMS,
      "Invalid params: tools/call requires an object",
    );
  }
  const name = rawParams.name;
  if (typeof name !== "string" || name.length === 0) {
    return jsonRpcError(
      id,
      JSONRPC_INVALID_PARAMS,
      "Invalid params: name must be a non-empty string",
    );
  }
  const args = rawParams.arguments;
  if (args !== undefined && !isPlainObject(args)) {
    return jsonRpcError(
      id,
      JSONRPC_INVALID_PARAMS,
      "Invalid params: arguments must be an object",
    );
  }
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    // The MCP spec models "unknown tool" as a tool-call result with
    // isError: true rather than a JSON-RPC method-not-found error, so
    // clients always know whether to surface this to the user vs retry
    // the protocol.
    const result: McpToolResult = {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
    return jsonRpcResult(id, result);
  }
  const outcome = await tool.run(args ?? {});
  const result: McpToolResult = {
    content: [{ type: "text", text: outcome.text }],
    isError: outcome.isError === true,
  };
  return jsonRpcResult(id, result);
}
