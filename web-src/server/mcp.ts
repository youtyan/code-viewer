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
import { isGlobPathQuery, rankPathMatches } from "../core/fuzzy-search";
import { AGENT_GUIDES, buildAgentHelpIndex } from "./agent-help";
import { resolveRepoRootSafe } from "./cli-helpers";
import { buildFileShowReport, type FileShowCommand } from "./file-cli";
import { ROOT } from "./root";
import {
  DEFAULT_EXCLUDE_NAMES,
  FILE_SEARCH_ABSOLUTE_MAX,
  GREP_ABSOLUTE_MAX,
  GREP_DEFAULT_MAX,
} from "./search";
import { FILE_NAME_SEARCH_DEFAULT_MAX } from "./search-cli";
import { grepRepo, listRepoFiles, type SearchEnv } from "./search-service";
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
    {
      name: "code_viewer_file_show",
      title: "code-viewer file show",
      description:
        "Returns the same JSON payload `code-viewer file show --json` emits: path, ref, optional start/end, totalLines, complete, text, and an optional error string when the path cannot be read. Read-only. ref defaults to 'worktree'. Provide start/end (1-indexed, inclusive) to slice large files before piping into a model context.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Repo-relative file path (single-line, no NUL / '..' segments / leading '-' / leading slash). Required.",
          },
          ref: {
            type: "string",
            description:
              "Git ref. Defaults to 'worktree' (reads the working copy). Pass HEAD / a branch / a commit / a tag for a committed snapshot.",
          },
          start: {
            type: "integer",
            minimum: 1,
            description: "1-indexed start line for slicing. Pair with `end`.",
          },
          end: {
            type: "integer",
            minimum: 1,
            description: "1-indexed end line (inclusive). Pair with `start`.",
          },
          cwd: {
            type: "string",
            description:
              "Repository to inspect. Absolute path. Defaults to the directory the code-viewer server was started in.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
      run(input) {
        return runFileShowTool(input, options.cwd);
      },
    },
    {
      name: "code_viewer_search_files",
      title: "code-viewer search files",
      description:
        "Returns the same JSON shape `code-viewer search files --json` emits: ref, query, mode ('fuzzy' or 'glob' depending on whether the term contains * or ?), truncated, candidateTruncated, totalCandidates, totalMatches, and matches (path / score / ranges, best first). Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          term: {
            type: "string",
            description:
              "Search term. Fuzzy by default; switches to glob mode automatically when the term contains '*' or '?'.",
          },
          ref: {
            type: "string",
            description:
              "Git ref. Defaults to 'worktree'. Pass a branch / commit / tag to search a committed snapshot's file list.",
          },
          max: {
            type: "integer",
            minimum: 1,
            maximum: FILE_SEARCH_ABSOLUTE_MAX,
            description: `Maximum ranked matches. Default ${FILE_NAME_SEARCH_DEFAULT_MAX}, max ${FILE_SEARCH_ABSOLUTE_MAX}.`,
          },
          cwd: {
            type: "string",
            description:
              "Repository to inspect. Absolute path. Defaults to the directory the code-viewer server was started in.",
          },
        },
        required: ["term"],
        additionalProperties: false,
      },
      run(input) {
        return runSearchFilesTool(input, options.cwd);
      },
    },
    {
      name: "code_viewer_search_code",
      title: "code-viewer search code",
      description:
        "Returns the same GrepResponse shape `/_grep` and `code-viewer search code --json` emit: ref, engine ('rg' / 'git' / 'fallback'), truncated, and matches (path / line / column / preview). Read-only. Uses ripgrep when available and falls back to git grep / a fixed-string scanner with identical scope filtering.",
      inputSchema: {
        type: "object",
        properties: {
          term: {
            type: "string",
            description:
              "Search term. Treated as a fixed string unless `regex` is true.",
          },
          ref: {
            type: "string",
            description:
              "Git ref. Defaults to 'worktree'. Pass a branch / commit / tag to grep a committed snapshot.",
          },
          paths: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional list of repo-relative paths to restrict the search to. Unsafe paths are dropped silently.",
          },
          regex: {
            type: "boolean",
            description:
              "Treat `term` as an extended regex instead of a fixed string. Defaults to false.",
          },
          max: {
            type: "integer",
            minimum: 1,
            maximum: GREP_ABSOLUTE_MAX,
            description: `Maximum matches. Default ${GREP_DEFAULT_MAX}, max ${GREP_ABSOLUTE_MAX}.`,
          },
          cwd: {
            type: "string",
            description:
              "Repository to inspect. Absolute path. Defaults to the directory the code-viewer server was started in.",
          },
        },
        required: ["term"],
        additionalProperties: false,
      },
      run(input) {
        return runSearchCodeTool(input, options.cwd);
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

// Path validation shared by file_show and explicit search_code paths. The
// rules mirror cli-helpers.validateRepoRelativePathValue but we phrase
// them in MCP vocabulary (no `--flag` prefix) because tool errors are
// surfaced through the MCP `isError` channel, not stderr.
function validateMcpPath(value: string): string | undefined {
  if (!value) return "path requires a non-empty value";
  if (value.includes("\0") || /[\r\n]/.test(value))
    return "path must be single-line and must not contain NUL";
  if (value.startsWith("-")) return "path must not start with '-'";
  if (value.startsWith("/") || value.startsWith("\\"))
    return "path must be repo-relative";
  if (value.split(/[\\/]+/).includes(".."))
    return "path must not contain '..' segments";
  return undefined;
}

// Shared ref validation. Worktree ref ("worktree") is the implicit
// default in every tool that uses it.
function validateMcpRef(
  refRaw: unknown,
  fallback: string,
): { ok: true; ref: string } | { ok: false; error: string } {
  if (refRaw === undefined) return { ok: true, ref: fallback };
  if (typeof refRaw !== "string") {
    return { ok: false, error: "ref must be a string" };
  }
  if (!refRaw) return { ok: false, error: "ref must be a non-empty string" };
  if (refRaw.includes("\0") || /[\r\n]/.test(refRaw)) {
    return {
      ok: false,
      error: "ref must be single-line and must not contain NUL",
    };
  }
  if (refRaw.startsWith("-")) {
    return { ok: false, error: "ref must not start with '-'" };
  }
  return { ok: true, ref: refRaw };
}

function validateMcpCwd(
  raw: unknown,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "string")
    return { ok: false, error: "cwd must be a string" };
  return { ok: true, value: raw };
}

function validateMcpIntegerLimit(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
  flag: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: fallback };
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < min ||
    raw > max
  ) {
    return {
      ok: false,
      error: `${flag} must be an integer in [${min}, ${max}]`,
    };
  }
  return { ok: true, value: raw };
}

function runFileShowTool(
  input: unknown,
  defaultCwd?: string,
): McpToolRunReturn {
  const params = isPlainObject(input) ? input : {};
  const pathRaw = params.path;
  if (typeof pathRaw !== "string") {
    return { text: "path must be a string", isError: true };
  }
  const pathError = validateMcpPath(pathRaw);
  if (pathError) return { text: pathError, isError: true };

  const cwdParsed = validateMcpCwd(params.cwd);
  if (cwdParsed.ok !== true) {
    return { text: cwdParsed.error, isError: true };
  }
  const refParsed = validateMcpRef(params.ref, "worktree");
  if (refParsed.ok !== true) {
    return { text: refParsed.error, isError: true };
  }

  // start/end share validation but are individually optional. The CLI
  // requires both or neither (sliceLines returns the full file when one
  // is missing); we mirror that to avoid a "start without end" silent
  // pass-through.
  const startRaw = params.start;
  const endRaw = params.end;
  if (
    (startRaw !== undefined && endRaw === undefined) ||
    (endRaw !== undefined && startRaw === undefined)
  ) {
    return { text: "start and end must be provided together", isError: true };
  }
  let start: number | undefined;
  let end: number | undefined;
  if (startRaw !== undefined) {
    if (
      typeof startRaw !== "number" ||
      !Number.isInteger(startRaw) ||
      startRaw < 1
    ) {
      return {
        text: "start must be an integer >= 1",
        isError: true,
      };
    }
    if (typeof endRaw !== "number" || !Number.isInteger(endRaw) || endRaw < 1) {
      return { text: "end must be an integer >= 1", isError: true };
    }
    if (endRaw < startRaw) {
      return { text: "end must be >= start", isError: true };
    }
    start = startRaw;
    end = endRaw;
  }

  const resolved = resolveRepoRootSafe(cwdParsed.value ?? defaultCwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  const command: FileShowCommand = {
    kind: "show",
    path: pathRaw,
    ref: refParsed.ref,
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
    json: true,
  };
  try {
    const report = buildFileShowReport(resolved.root, command);
    // FileShowReport already carries `error` when readShowText failed.
    // We surface that as MCP isError so the agent can react without
    // having to parse the body; the JSON text still carries the field.
    return {
      text: JSON.stringify(report, null, 2),
      isError: report.error !== undefined,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: `file show failed: ${detail}`, isError: true };
  }
}

function runSearchFilesTool(
  input: unknown,
  defaultCwd?: string,
): McpToolRunReturn {
  const params = isPlainObject(input) ? input : {};
  const termRaw = params.term;
  if (typeof termRaw !== "string") {
    return { text: "term must be a string", isError: true };
  }
  if (!termRaw)
    return { text: "term must be a non-empty string", isError: true };
  if (termRaw.includes("\0") || /[\r\n]/.test(termRaw)) {
    return {
      text: "term must be single-line and must not contain NUL",
      isError: true,
    };
  }

  const cwdParsed = validateMcpCwd(params.cwd);
  if (cwdParsed.ok !== true) {
    return { text: cwdParsed.error, isError: true };
  }
  const refParsed = validateMcpRef(params.ref, "worktree");
  if (refParsed.ok !== true) {
    return { text: refParsed.error, isError: true };
  }
  const maxParsed = validateMcpIntegerLimit(
    params.max,
    FILE_NAME_SEARCH_DEFAULT_MAX,
    1,
    FILE_SEARCH_ABSOLUTE_MAX,
    "max",
  );
  if (maxParsed.ok !== true) {
    return { text: maxParsed.error, isError: true };
  }

  const resolved = resolveRepoRootSafe(cwdParsed.value ?? defaultCwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  const env: SearchEnv = {
    cwd: resolved.root,
    omitDirNames: [],
    excludeNames: DEFAULT_EXCLUDE_NAMES,
  };
  // Generation is 1 for MCP — we do not share preview.ts's cache, and
  // the FileSearchListResponse field is informational for the client.
  const listResult = listRepoFiles(env, refParsed.ref, 1);
  if (listResult.ok !== true) {
    return { text: listResult.error, isError: true };
  }
  const list = listResult.value;
  const mode: "fuzzy" | "glob" = isGlobPathQuery(termRaw) ? "glob" : "fuzzy";
  const ranked = rankPathMatches(termRaw, list.files);
  const totalMatches = ranked.length;
  const truncated = ranked.length > maxParsed.value;
  const sliced = truncated ? ranked.slice(0, maxParsed.value) : ranked;
  const payload = {
    ref: list.ref,
    generation: list.generation,
    query: termRaw,
    mode,
    truncated,
    candidateTruncated: list.truncated,
    totalCandidates: list.files.length,
    totalMatches,
    matches: sliced.map((m) => ({
      path: m.item.path,
      score: m.score,
      ranges: m.ranges,
    })),
  };
  return { text: JSON.stringify(payload, null, 2) };
}

function runSearchCodeTool(
  input: unknown,
  defaultCwd?: string,
): McpToolRunReturn {
  const params = isPlainObject(input) ? input : {};
  const termRaw = params.term;
  if (typeof termRaw !== "string") {
    return { text: "term must be a string", isError: true };
  }
  if (!termRaw)
    return { text: "term must be a non-empty string", isError: true };
  if (termRaw.includes("\0") || /[\r\n]/.test(termRaw)) {
    return {
      text: "term must be single-line and must not contain NUL",
      isError: true,
    };
  }

  const cwdParsed = validateMcpCwd(params.cwd);
  if (cwdParsed.ok !== true) {
    return { text: cwdParsed.error, isError: true };
  }
  const refParsed = validateMcpRef(params.ref, "worktree");
  if (refParsed.ok !== true) {
    return { text: refParsed.error, isError: true };
  }

  const pathsRaw = params.paths;
  let paths: string[] = [];
  if (pathsRaw !== undefined) {
    if (!Array.isArray(pathsRaw))
      return { text: "paths must be an array of strings", isError: true };
    for (const p of pathsRaw) {
      if (typeof p !== "string") {
        return { text: "paths must be strings", isError: true };
      }
    }
    paths = pathsRaw as string[];
  }

  const regexRaw = params.regex;
  if (regexRaw !== undefined && typeof regexRaw !== "boolean") {
    return { text: "regex must be a boolean", isError: true };
  }
  const regex = regexRaw === true;

  const maxParsed = validateMcpIntegerLimit(
    params.max,
    GREP_DEFAULT_MAX,
    1,
    GREP_ABSOLUTE_MAX,
    "max",
  );
  if (maxParsed.ok !== true) {
    return { text: maxParsed.error, isError: true };
  }

  const resolved = resolveRepoRootSafe(cwdParsed.value ?? defaultCwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  const env: SearchEnv = {
    cwd: resolved.root,
    omitDirNames: [],
    excludeNames: DEFAULT_EXCLUDE_NAMES,
  };
  const result = grepRepo(env, {
    query: termRaw,
    ref: refParsed.ref,
    paths,
    regex,
    max: maxParsed.value,
  });
  if (result.ok !== true) {
    return { text: result.error, isError: true };
  }
  return { text: JSON.stringify(result.value, null, 2) };
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
    "  - code_viewer_file_show: read a file (or a line range) at any ref.",
    "  - code_viewer_search_files: rank repo paths by fuzzy or glob match.",
    "  - code_viewer_search_code: grep the repo (rg / git grep / fallback).",
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
