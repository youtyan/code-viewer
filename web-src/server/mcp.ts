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
import {
  AGENT_EVENTS,
  isAgentEvent,
  needsAttention,
} from "../core/agent-state";
import { formatErrorDetail } from "../core/error-detail";
import { isGlobPathQuery, rankPathMatches } from "../core/fuzzy-search";
import { AGENT_GUIDES, buildAgentHelpIndex } from "./agent-help";
import { resolveRepoRootSafe } from "./cli-helpers";
import {
  createDbColumnsResponse,
  createDbDdlResponse,
  createDbFilesResponse,
  createDbHistoryResponse,
  createDbQueryResponse,
  createDbSchemaResponse,
  createDbSchemasResponse,
  DB_QUERY_DEFAULT_MAX_ROWS,
  DB_QUERY_HARD_CAP_MAX_ROWS,
  type DbServiceResult,
} from "./database/handle";
import {
  buildFileBlameReportAsync,
  buildFileDiffReportAsync,
  buildFileHistoryReportAsync,
  buildFileShowReportAsync,
  FILE_DEFAULT_HISTORY_LIMIT,
  FILE_DIFF_DEFAULT_MAX_HUNKS,
  FILE_DIFF_DEFAULT_MAX_LINES,
  FILE_DIFF_HUNK_HARD_CAP,
  FILE_DIFF_LINE_HARD_CAP,
  FILE_HISTORY_HARD_CAP,
  type FileBlameCommand,
  type FileDiffCommand,
  type FileHistoryCommand,
  type FileShowCommand,
} from "./file-cli";
import { ROOT } from "./root";
import {
  DEFAULT_EXCLUDE_NAMES,
  FILE_SEARCH_ABSOLUTE_MAX,
  GREP_ABSOLUTE_MAX,
  GREP_DEFAULT_MAX,
} from "./search";
import { FILE_NAME_SEARCH_DEFAULT_MAX } from "./search-cli";
import {
  grepRepoAsync,
  listRepoFilesAsync,
  type SearchEnv,
} from "./search-service";
import {
  buildStatusReport,
  STATUS_DEFAULT_LIMIT,
  STATUS_DEFAULT_REF,
  STATUS_HARD_CAP_LIMIT,
} from "./status-cli";
import { getAgentActivityErrors } from "./terminal/activity";
import { listAgentStates, recordAgentState } from "./terminal/agent-state";
import {
  captureTerminal,
  clampHistoryLines,
  DEFAULT_CAPTURE_HISTORY_LINES,
  terminalKindOf,
} from "./terminal/capture";
import { MAX_TMUX_HISTORY_LINES } from "./tmux/capture";

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

export type DefaultMcpToolsOptions = {
  cwd?: string;
  omitDirNames?: string[];
  generation?: number;
};

// Build the default tool inventory. Exported so preview.ts can mount it
// and tests can introspect the list without standing up an HTTP server.
export function defaultMcpTools(
  options: DefaultMcpToolsOptions = {},
): McpTool[] {
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
      name: "code_viewer_file_blame",
      title: "code-viewer file blame",
      description:
        "Returns the same JSON payload `code-viewer file blame --json` emits: path, ref, base ('worktree' | 'HEAD'), and result (GitBlameResult with lines, commits keyed by sha, optional isUntracked / isSynthetic / error). Read-only. ref defaults to 'worktree'; base defaults to 'worktree' (uncommitted edits show as the zero sha). Pair with code_viewer_file_show to ground a change in the commit that introduced it.",
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
              "Git ref. Defaults to 'worktree'. Pass HEAD / a branch / a commit / a tag for a committed blame. Used only when base is 'HEAD'.",
          },
          base: {
            type: "string",
            enum: ["worktree", "HEAD"],
            description:
              "Blame base. 'worktree' (default) keeps uncommitted edits visible as the zero sha; 'HEAD' forces a committed-only blame against `ref` (or HEAD when ref is omitted).",
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
        return runFileBlameTool(input, options.cwd);
      },
    },
    {
      name: "code_viewer_file_history",
      title: "code-viewer file history",
      description:
        "Returns the same JSON payload `code-viewer file history --json` emits: path, ref, limit, skip, optional query, and result (commits with sha/author/when/subject, hasMore, optional error). Read-only. ref defaults to 'HEAD'. Follows renames for file paths. Use `query` for the same 'author:' / 'path:' / sha-prefix filters the browser history view accepts.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Repo-relative file path (single-line, no NUL / '..' segments / leading '-' / leading slash). Required. Trailing '/' is treated as a directory (no --follow).",
          },
          ref: {
            type: "string",
            description:
              "Git ref to walk. Defaults to 'HEAD'. Pass a branch / commit / tag to inspect a different tip.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: FILE_HISTORY_HARD_CAP,
            description: `Maximum commits to return. Clamped to [1, ${FILE_HISTORY_HARD_CAP}]. Default ${FILE_DEFAULT_HISTORY_LIMIT}. \`result.hasMore: true\` indicates more commits are available; bump \`skip\` to paginate.`,
          },
          skip: {
            type: "integer",
            minimum: 0,
            description: "Non-negative pagination offset. Default 0.",
          },
          query: {
            type: "string",
            description:
              "Optional git log filter, passed verbatim to commitHistory. Supports the 'author:' and 'path:' prefixes the browser history view uses. Single-line, no NUL.",
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
        return runFileHistoryTool(input, options.cwd);
      },
    },
    {
      name: "code_viewer_file_diff",
      title: "code-viewer file diff",
      description:
        "Returns the same snake_case diff payload as `code-viewer file diff --json`; it matches the preview server's /file_diff shape except for browser-only status/generation fields. Fields: path, optional old_path, from, to, untracked, ignore_ws, ignore_blank, mode ('preview' | 'full'), max_hunks, max_lines, diff (unified diff text), hunk_count, rendered_hunk_count, line_count, truncated, binary, and an optional error string. Read-only. Defaults to from='HEAD' and to='worktree' (uncommitted changes) in preview mode (3 hunks / 1200 lines) to protect agent context. Set mode='full' only when the file diff is safe to return without caps; max_hunks/max_lines are null in the response.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Repo-relative file path (single-line, no NUL / '..' segments / leading '-' / leading slash). Required.",
          },
          from: {
            type: "string",
            description:
              "Range start ref. Default 'HEAD'. The literal 'worktree' means the working tree.",
          },
          to: {
            type: "string",
            description:
              "Range end ref. Default 'worktree'. The literal 'worktree' means the working tree.",
          },
          old_path: {
            type: "string",
            description:
              "Previous repo-relative path when the file was renamed inside the range. Same validation as `path`.",
          },
          untracked: {
            type: "boolean",
            description:
              "Diff an untracked worktree file against /dev/null. Cannot be combined with `from`; only valid when `to` is 'worktree' (or omitted).",
          },
          ignore_ws: {
            type: "boolean",
            description:
              "Pass -w to git diff (ignore all whitespace changes). Defaults to false.",
          },
          ignore_blank: {
            type: "boolean",
            description:
              "Pass --ignore-blank-lines to git diff. Defaults to false.",
          },
          mode: {
            type: "string",
            enum: ["preview", "full"],
            description:
              "Truncation mode. 'preview' (default) caps the diff at max_hunks / max_lines. 'full' returns the whole diff and rejects max_hunks / max_lines.",
          },
          max_hunks: {
            type: "integer",
            minimum: 1,
            maximum: FILE_DIFF_HUNK_HARD_CAP,
            description: `Maximum hunks to render in preview mode. Clamped to [1, ${FILE_DIFF_HUNK_HARD_CAP}]. Default ${FILE_DIFF_DEFAULT_MAX_HUNKS}. Cannot be combined with mode='full'.`,
          },
          max_lines: {
            type: "integer",
            minimum: 1,
            maximum: FILE_DIFF_LINE_HARD_CAP,
            description: `Maximum total lines (header + hunks) in preview mode. Clamped to [1, ${FILE_DIFF_LINE_HARD_CAP}]. Default ${FILE_DIFF_DEFAULT_MAX_LINES}. Cannot be combined with mode='full'.`,
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
        return runFileDiffTool(input, options.cwd);
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
              "Optional list of repo-relative files, directories, or globs (e.g. 'src/**/*.ts') to restrict the search to. Unsafe paths are dropped silently.",
          },
          regex: {
            type: "boolean",
            description:
              "Treat `term` as an extended regex instead of a fixed string. Defaults to false.",
          },
          caseSensitive: {
            type: "boolean",
            description:
              "Match case. Defaults to false (case-insensitive on every engine).",
          },
          wholeWord: {
            type: "boolean",
            description:
              "Match whole words only (rg -w / git grep -w semantics). Defaults to false.",
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
        return runSearchCodeTool(input, options.cwd, options.generation);
      },
    },
    {
      name: "code_viewer_datastore_sources",
      title: "code-viewer datastore sources",
      description:
        "Returns the same JSON payload `code-viewer query sources --json` and `/_db/files` emit: discovered SQLite / PostgreSQL / MySQL / Redis / Elasticsearch / S3 sources, plus truncation or docker discovery warnings. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          cwd: {
            type: "string",
            description:
              "Repository to inspect. Absolute path. Defaults to the directory the code-viewer server was started in.",
          },
        },
        additionalProperties: false,
      },
      run(input) {
        return runDatastoreSourcesTool(input, options);
      },
    },
    {
      name: "code_viewer_datastore_schemas",
      title: "code-viewer datastore schemas",
      description:
        "Returns the same JSON payload `code-viewer query schemas --json` and `/_db/schemas` emit for one SQL datastore: dbId, schemas, selectedSchema, and executedSql when available. Read-only. Non multi-schema engines return an empty schemas array.",
      inputSchema: {
        type: "object",
        properties: {
          db: {
            type: "string",
            description:
              "Datastore id from code_viewer_datastore_sources, for example a repo-relative SQLite path or docker:<service>.",
          },
          schema: {
            type: "string",
            description:
              "Optional schema name to resolve/select for PostgreSQL sources.",
          },
          cwd: {
            type: "string",
            description:
              "Repository to inspect. Absolute path. Defaults to the directory the code-viewer server was started in.",
          },
        },
        required: ["db"],
        additionalProperties: false,
      },
      run(input) {
        return runDatastoreSchemasTool(input, options);
      },
    },
    {
      name: "code_viewer_datastore_schema",
      title: "code-viewer datastore schema",
      description:
        "Returns the same JSON payload `code-viewer query schema --json` and `/_db/schema` emit for one SQL datastore: dbId, schema, tables with row counts, indexes, foreignKeys, executedSql, and columnsMap when includeColumns is true. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          db: {
            type: "string",
            description:
              "Datastore id from code_viewer_datastore_sources, for example a repo-relative SQLite path or docker:<service>.",
          },
          schema: {
            type: "string",
            description: "Optional schema name for PostgreSQL sources.",
          },
          includeColumns: {
            type: "boolean",
            description:
              "Include columnsMap for every table. Defaults to true; set false to reduce payload size.",
          },
          cwd: {
            type: "string",
            description:
              "Repository to inspect. Absolute path. Defaults to the directory the code-viewer server was started in.",
          },
        },
        required: ["db"],
        additionalProperties: false,
      },
      run(input) {
        return runDatastoreSchemaTool(input, options);
      },
    },
    {
      name: "code_viewer_datastore_columns",
      title: "code-viewer datastore columns",
      description:
        "Returns the same JSON payload `code-viewer query columns --json` and `/_db/columns` emit for one SQL table: dbId, schema, table, columns, and executedSql. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          db: {
            type: "string",
            description:
              "Datastore id from code_viewer_datastore_sources, for example a repo-relative SQLite path or docker:<service>.",
          },
          schema: {
            type: "string",
            description: "Optional schema name for PostgreSQL sources.",
          },
          table: {
            type: "string",
            description: "Table or view name to inspect.",
          },
          cwd: {
            type: "string",
            description:
              "Repository to inspect. Absolute path. Defaults to the directory the code-viewer server was started in.",
          },
        },
        required: ["db", "table"],
        additionalProperties: false,
      },
      run(input) {
        return runDatastoreColumnsTool(input, options);
      },
    },
    {
      name: "code_viewer_datastore_ddl",
      title: "code-viewer datastore DDL",
      description:
        "Returns the same JSON payload `code-viewer query ddl --json` and `/_db/ddl` emit for one SQL table: dbId, schema, table, sql, triggers, and executedSql. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          db: {
            type: "string",
            description:
              "Datastore id from code_viewer_datastore_sources, for example a repo-relative SQLite path or docker:<service>.",
          },
          schema: {
            type: "string",
            description: "Optional schema name for PostgreSQL sources.",
          },
          table: {
            type: "string",
            description: "Table or view name to inspect.",
          },
          cwd: {
            type: "string",
            description:
              "Repository to inspect. Absolute path. Defaults to the directory the code-viewer server was started in.",
          },
        },
        required: ["db", "table"],
        additionalProperties: false,
      },
      run(input) {
        return runDatastoreDdlTool(input, options);
      },
    },
    {
      name: "code_viewer_datastore_query",
      title: "code-viewer datastore query",
      description:
        "Executes a read-only SQL query against one SQL datastore and returns the same JSON payload `code-viewer query exec --json` and `/_db/query` emit: dbId, schema, columns, columnTypes, rows, rowCount, truncated, elapsedMs, executedSql (success) or the same shape with `error` (failure). Only SELECT / PRAGMA / EXPLAIN / WITH are accepted; any INSERT / UPDATE / DELETE / DROP / ALTER / CREATE / ATTACH / DETACH / REPLACE / VACUUM / REINDEX / LOAD_EXTENSION keyword is rejected. History is never saved.",
      inputSchema: {
        type: "object",
        properties: {
          db: {
            type: "string",
            description:
              "Datastore id from code_viewer_datastore_sources, for example a repo-relative SQLite path or docker:<service>.",
          },
          sql: {
            type: "string",
            description:
              "SQL statement to run. Must start with SELECT, PRAGMA, EXPLAIN, or WITH; write keywords are rejected by the adapter.",
          },
          schema: {
            type: "string",
            description: "Optional schema name for PostgreSQL sources.",
          },
          maxRows: {
            type: "integer",
            minimum: 1,
            maximum: DB_QUERY_HARD_CAP_MAX_ROWS,
            description: `Maximum rows to return. Clamped to [1, ${DB_QUERY_HARD_CAP_MAX_ROWS}]. Default ${DB_QUERY_DEFAULT_MAX_ROWS}. \`truncated: true\` in the response means more rows were available.`,
          },
          cwd: {
            type: "string",
            description:
              "Repository to inspect. Absolute path. Defaults to the directory the code-viewer server was started in.",
          },
        },
        required: ["db", "sql"],
        additionalProperties: false,
      },
      run(input) {
        return runDatastoreQueryTool(input, options);
      },
    },
    {
      name: "code_viewer_datastore_history",
      title: "code-viewer datastore history",
      description:
        "Returns saved datastore query history using the same JSON shape as `code-viewer query list --json` and `/_db/history`: version and entries. Optional db/schema filters mirror the browser history endpoint. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          db: {
            type: "string",
            description:
              "Optional datastore id to filter by. Use ids from code_viewer_datastore_sources.",
          },
          schema: {
            type: "string",
            description:
              "Optional schema filter, applied only when db is also supplied.",
          },
          cwd: {
            type: "string",
            description:
              "Repository to inspect. Absolute path. Defaults to the directory the code-viewer server was started in.",
          },
        },
        additionalProperties: false,
      },
      run(input) {
        return runDatastoreHistoryTool(input, options);
      },
    },
    {
      name: "code_viewer_terminal_list",
      title: "code-viewer terminal list",
      description:
        "Returns the state of every terminal this server knows about, plus every observation error, using the same payload `code-viewer terminal list --json` emits: { states: [{ target, state, source, updatedAt, lastPrompt, note }], errors: [{ operation, target, at, detail, stack }] }. state is working | waiting | done | idle, where done means the turn finished and nobody has read the output yet. source is hook for a reported event, screen for a visible matched rule, and activity for the motion fallback. Read-only. Call this before asking the human anything — another agent may already be blocking them.",
      inputSchema: {
        type: "object",
        properties: {
          attentionOnly: {
            type: "boolean",
            description:
              "Return only terminals in waiting or done, i.e. the ones the human still has to deal with.",
          },
        },
        additionalProperties: false,
      },
      run(input) {
        return runTerminalListTool(input);
      },
    },
    {
      name: "code_viewer_terminal_capture",
      title: "code-viewer terminal capture",
      description:
        "Reads what another terminal is showing, the same payload `code-viewer terminal capture --json` emits: { target, kind, content, cursor, reset }. Pass the cursor from the previous call to receive only what was added since then, which keeps handovers small. reset=true means the previous position could not be followed and content is the whole buffer again, so treat it as overlapping what you already had. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              "tmux pane id such as %12, or a browser shell id such as shell-xxxx. Get these from code_viewer_terminal_list.",
          },
          cursor: {
            type: "string",
            description:
              "Opaque cursor returned by a previous capture. Omit to read the whole buffer.",
          },
          history: {
            type: "integer",
            minimum: 0,
            maximum: MAX_TMUX_HISTORY_LINES,
            description: `Lines of scrollback to include for tmux panes. Default ${DEFAULT_CAPTURE_HISTORY_LINES}, max ${MAX_TMUX_HISTORY_LINES}. Ignored for browser shells, which always return their retained buffer.`,
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
      run(input) {
        return runTerminalCaptureTool(input, options);
      },
    },
    {
      name: "code_viewer_terminal_state",
      title: "code-viewer terminal state",
      description:
        "Reports your own lifecycle state so the human's terminal board can show it, the same call `code-viewer terminal state` makes. Use this only if you cannot install the agent CLI hooks, which report the same events automatically. event is prompt | progress | ask | stop | exit. Identify yourself with the TMUX_PANE environment variable inside tmux, or CODE_VIEWER_SHELL_ID inside a shell this server opened.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              "Your own tmux pane id ($TMUX_PANE) or browser shell id ($CODE_VIEWER_SHELL_ID).",
          },
          event: {
            type: "string",
            enum: [...AGENT_EVENTS],
            description:
              "prompt = the human sent an instruction, progress = you ran a tool, ask = you stopped to ask something, stop = your turn ended, exit = the session ended.",
          },
          lastPrompt: {
            type: "string",
            description:
              "The instruction the human last gave. Kept until replaced.",
          },
          note: {
            type: "string",
            description: "One line about what you are doing right now.",
          },
        },
        required: ["target", "event"],
        additionalProperties: false,
      },
      run(input) {
        return runTerminalStateTool(input);
      },
    },
  ];
}

function runTerminalListTool(input: unknown): McpToolRunReturn {
  const params = isPlainObject(input) ? input : {};
  const attentionOnly = params.attentionOnly;
  if (attentionOnly !== undefined && typeof attentionOnly !== "boolean") {
    return { text: "attentionOnly must be a boolean", isError: true };
  }
  const all = listAgentStates();
  const states = attentionOnly
    ? all.filter((record) => needsAttention(record.state))
    : all;
  return {
    text: JSON.stringify({ states, errors: getAgentActivityErrors() }, null, 2),
  };
}

async function runTerminalCaptureTool(
  input: unknown,
  options: DefaultMcpToolsOptions,
): Promise<McpToolRunReturn> {
  const params = isPlainObject(input) ? input : {};
  const target = params.target;
  if (typeof target !== "string" || !terminalKindOf(target)) {
    return {
      text: "target must be a tmux pane id (%12) or a shell id (shell-xxxx)",
      isError: true,
    };
  }
  const cursorRaw = params.cursor;
  if (cursorRaw !== undefined && typeof cursorRaw !== "string") {
    return { text: "cursor must be a string", isError: true };
  }
  const historyRaw = params.history;
  if (historyRaw !== undefined && typeof historyRaw !== "number") {
    return { text: "history must be an integer", isError: true };
  }
  const result = await captureTerminal(
    target,
    typeof cursorRaw === "string" ? cursorRaw : null,
    options.cwd ?? process.cwd(),
    clampHistoryLines(historyRaw),
  );
  if (result.status === "invalid") {
    return { text: "target is not a terminal id", isError: true };
  }
  if (result.status === "gone") {
    return { text: `${target} is gone`, isError: true };
  }
  if (result.status === "error") {
    return { text: formatErrorDetail(result.error), isError: true };
  }
  return {
    text: JSON.stringify(
      {
        target,
        kind: result.kind,
        content: result.slice.content,
        cursor: result.slice.cursor,
        reset: result.slice.reset,
      },
      null,
      2,
    ),
  };
}

function runTerminalStateTool(input: unknown): McpToolRunReturn {
  const params = isPlainObject(input) ? input : {};
  const target = params.target;
  if (typeof target !== "string" || !terminalKindOf(target)) {
    return {
      text: "target must be a tmux pane id (%12) or a shell id (shell-xxxx)",
      isError: true,
    };
  }
  if (!isAgentEvent(params.event)) {
    return {
      text: `event must be one of: ${AGENT_EVENTS.join(", ")}`,
      isError: true,
    };
  }
  const lastPrompt = params.lastPrompt;
  const note = params.note;
  if (lastPrompt !== undefined && typeof lastPrompt !== "string") {
    return { text: "lastPrompt must be a string", isError: true };
  }
  if (note !== undefined && typeof note !== "string") {
    return { text: "note must be a string", isError: true };
  }
  const record = recordAgentState({
    target,
    event: params.event,
    source: "hook",
    lastPrompt: typeof lastPrompt === "string" ? lastPrompt : undefined,
    note: typeof note === "string" ? note : undefined,
  });
  if (!record) return { text: "could not record state", isError: true };
  return { text: JSON.stringify({ ok: true, state: record }, null, 2) };
}

async function runStatusTool(
  input: unknown,
  defaultCwd?: string,
): Promise<McpToolRunReturn> {
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
    const report = await buildStatusReport({ root: resolved.root, ref, limit });
    return {
      text: JSON.stringify(report, null, 2),
      isError: !!(report.changed.error || report.staged.error),
    };
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

async function runFileShowTool(
  input: unknown,
  defaultCwd?: string,
): Promise<McpToolRunReturn> {
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
    const report = await buildFileShowReportAsync(resolved.root, command);
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

async function runFileBlameTool(
  input: unknown,
  defaultCwd?: string,
): Promise<McpToolRunReturn> {
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

  const baseRaw = params.base;
  let base: "worktree" | "HEAD" = "worktree";
  if (baseRaw !== undefined) {
    if (baseRaw !== "worktree" && baseRaw !== "HEAD") {
      return { text: "base must be 'worktree' or 'HEAD'", isError: true };
    }
    base = baseRaw;
  }

  const resolved = resolveRepoRootSafe(cwdParsed.value ?? defaultCwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  const command: FileBlameCommand = {
    kind: "blame",
    path: pathRaw,
    ref: refParsed.ref,
    base,
    json: true,
  };
  try {
    const report = await buildFileBlameReportAsync(resolved.root, command);
    return {
      text: JSON.stringify(report, null, 2),
      isError: report.result.error !== undefined,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: `file blame failed: ${detail}`, isError: true };
  }
}

async function runFileHistoryTool(
  input: unknown,
  defaultCwd?: string,
): Promise<McpToolRunReturn> {
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
  const refParsed = validateMcpRef(params.ref, "HEAD");
  if (refParsed.ok !== true) {
    return { text: refParsed.error, isError: true };
  }

  const limitParsed = validateMcpIntegerLimit(
    params.limit,
    FILE_DEFAULT_HISTORY_LIMIT,
    1,
    FILE_HISTORY_HARD_CAP,
    "limit",
  );
  if (limitParsed.ok !== true) {
    return { text: limitParsed.error, isError: true };
  }
  const skipParsed = validateMcpIntegerLimit(
    params.skip,
    0,
    0,
    Number.MAX_SAFE_INTEGER,
    "skip",
  );
  if (skipParsed.ok !== true) {
    return { text: skipParsed.error, isError: true };
  }

  let query: string | undefined;
  const queryRaw = params.query;
  if (queryRaw !== undefined) {
    if (typeof queryRaw !== "string") {
      return { text: "query must be a string", isError: true };
    }
    if (queryRaw.includes("\0") || /[\r\n]/.test(queryRaw)) {
      return {
        text: "query must be single-line and must not contain NUL",
        isError: true,
      };
    }
    query = queryRaw;
  }

  const resolved = resolveRepoRootSafe(cwdParsed.value ?? defaultCwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  const command: FileHistoryCommand = {
    kind: "history",
    path: pathRaw,
    ref: refParsed.ref,
    limit: limitParsed.value,
    skip: skipParsed.value,
    ...(query !== undefined ? { query } : {}),
    json: true,
  };
  try {
    const report = await buildFileHistoryReportAsync(resolved.root, command);
    return {
      text: JSON.stringify(report, null, 2),
      isError: report.result.error !== undefined,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: `file history failed: ${detail}`, isError: true };
  }
}

async function runFileDiffTool(
  input: unknown,
  defaultCwd?: string,
): Promise<McpToolRunReturn> {
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

  const fromParsed = validateMcpRef(params.from, "HEAD");
  if (fromParsed.ok !== true) {
    return { text: fromParsed.error, isError: true };
  }
  const toParsed = validateMcpRef(params.to, "worktree");
  if (toParsed.ok !== true) {
    return { text: toParsed.error, isError: true };
  }

  let oldPath: string | undefined;
  const oldPathRaw = params.old_path;
  if (oldPathRaw !== undefined) {
    if (typeof oldPathRaw !== "string") {
      return { text: "old_path must be a string", isError: true };
    }
    const oldPathError = validateMcpPath(oldPathRaw);
    if (oldPathError) {
      // 既存 validateMcpPath メッセージは "path ..." で始まるので、AI が
      // どちらの引数を直すか判別できるよう old_path 用に prefix を貼り替える。
      return {
        text: oldPathError.replace(/^path /, "old_path "),
        isError: true,
      };
    }
    oldPath = oldPathRaw;
  }

  const untrackedRaw = params.untracked;
  if (untrackedRaw !== undefined && typeof untrackedRaw !== "boolean") {
    return { text: "untracked must be a boolean", isError: true };
  }
  const untracked = untrackedRaw === true;
  if (untracked && params.from !== undefined) {
    return {
      text: "untracked cannot be combined with from",
      isError: true,
    };
  }
  if (untracked && toParsed.ref !== "worktree") {
    return {
      text: "untracked requires to='worktree' (or omitted)",
      isError: true,
    };
  }

  const ignoreWsRaw = params.ignore_ws;
  if (ignoreWsRaw !== undefined && typeof ignoreWsRaw !== "boolean") {
    return { text: "ignore_ws must be a boolean", isError: true };
  }
  const ignoreWs = ignoreWsRaw === true;
  const ignoreBlankRaw = params.ignore_blank;
  if (ignoreBlankRaw !== undefined && typeof ignoreBlankRaw !== "boolean") {
    return { text: "ignore_blank must be a boolean", isError: true };
  }
  const ignoreBlank = ignoreBlankRaw === true;

  let mode: "preview" | "full" = "preview";
  const modeRaw = params.mode;
  if (modeRaw !== undefined) {
    if (modeRaw !== "preview" && modeRaw !== "full") {
      return { text: "mode must be 'preview' or 'full'", isError: true };
    }
    mode = modeRaw;
  }
  if (
    mode === "full" &&
    (params.max_hunks !== undefined || params.max_lines !== undefined)
  ) {
    return {
      text: "max_hunks and max_lines cannot be combined with mode='full'",
      isError: true,
    };
  }

  const maxHunksParsed = validateMcpIntegerLimit(
    params.max_hunks,
    FILE_DIFF_DEFAULT_MAX_HUNKS,
    1,
    FILE_DIFF_HUNK_HARD_CAP,
    "max_hunks",
  );
  if (maxHunksParsed.ok !== true) {
    return { text: maxHunksParsed.error, isError: true };
  }
  const maxLinesParsed = validateMcpIntegerLimit(
    params.max_lines,
    FILE_DIFF_DEFAULT_MAX_LINES,
    1,
    FILE_DIFF_LINE_HARD_CAP,
    "max_lines",
  );
  if (maxLinesParsed.ok !== true) {
    return { text: maxLinesParsed.error, isError: true };
  }

  const resolved = resolveRepoRootSafe(cwdParsed.value ?? defaultCwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  const command: FileDiffCommand = {
    kind: "diff",
    path: pathRaw,
    ...(oldPath !== undefined ? { oldPath } : {}),
    from: fromParsed.ref,
    to: toParsed.ref,
    untracked,
    ignoreWs,
    ignoreBlank,
    mode,
    maxHunks: maxHunksParsed.value,
    maxLines: maxLinesParsed.value,
    json: true,
  };
  try {
    const report = await buildFileDiffReportAsync(resolved.root, command);
    return {
      text: JSON.stringify(report, null, 2),
      isError: report.error !== undefined,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: `file diff failed: ${detail}`, isError: true };
  }
}

async function runSearchFilesTool(
  input: unknown,
  defaultCwd?: string,
): Promise<McpToolRunReturn> {
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
  const listResult = await listRepoFilesAsync(env, refParsed.ref, 1);
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

async function runSearchCodeTool(
  input: unknown,
  defaultCwd?: string,
  generation?: number,
): Promise<McpToolRunReturn> {
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
  const caseSensitiveRaw = params.caseSensitive;
  if (caseSensitiveRaw !== undefined && typeof caseSensitiveRaw !== "boolean") {
    return { text: "caseSensitive must be a boolean", isError: true };
  }
  const wholeWordRaw = params.wholeWord;
  if (wholeWordRaw !== undefined && typeof wholeWordRaw !== "boolean") {
    return { text: "wholeWord must be a boolean", isError: true };
  }

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
  const result = await grepRepoAsync(env, {
    query: termRaw,
    ref: refParsed.ref,
    paths,
    regex,
    caseSensitive: caseSensitiveRaw === true,
    wholeWord: wholeWordRaw === true,
    max: maxParsed.value,
  });
  if (result.ok !== true) {
    return { text: result.error, isError: true };
  }
  return {
    text: JSON.stringify(
      generation === undefined ? result.value : { ...result.value, generation },
      null,
      2,
    ),
  };
}

async function runDatastoreSourcesTool(
  input: unknown,
  options: DefaultMcpToolsOptions,
): Promise<McpToolRunReturn> {
  const params = isPlainObject(input) ? input : {};
  const cwdParsed = validateMcpCwd(params.cwd);
  if (cwdParsed.ok !== true) {
    return { text: cwdParsed.error, isError: true };
  }
  const resolved = resolveRepoRootSafe(cwdParsed.value ?? options.cwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  try {
    const payload = await createDbFilesResponse(
      resolved.root,
      options.omitDirNames ?? [],
    );
    return { text: JSON.stringify(payload, null, 2) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: `datastore sources failed: ${detail}`, isError: true };
  }
}

async function runDatastoreSchemasTool(
  input: unknown,
  options: DefaultMcpToolsOptions,
): Promise<McpToolRunReturn> {
  const params = isPlainObject(input) ? input : {};
  const dbParsed = validateMcpDbId(params.db);
  if (dbParsed.ok !== true) {
    return { text: dbParsed.error, isError: true };
  }
  const schemaParsed = validateMcpOptionalSingleLine(params.schema, "schema");
  if (schemaParsed.ok !== true) {
    return { text: schemaParsed.error, isError: true };
  }
  const cwdParsed = validateMcpCwd(params.cwd);
  if (cwdParsed.ok !== true) {
    return { text: cwdParsed.error, isError: true };
  }
  const resolved = resolveRepoRootSafe(cwdParsed.value ?? options.cwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  try {
    const result = await createDbSchemasResponse(
      resolved.root,
      dbParsed.value,
      schemaParsed.value,
      options.omitDirNames ?? [],
    );
    return dbServiceResultToMcpToolReturn("datastore schemas", result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: `datastore schemas failed: ${detail}`, isError: true };
  }
}

async function runDatastoreSchemaTool(
  input: unknown,
  options: DefaultMcpToolsOptions,
): Promise<McpToolRunReturn> {
  const params = isPlainObject(input) ? input : {};
  const dbParsed = validateMcpDbId(params.db);
  if (dbParsed.ok !== true) {
    return { text: dbParsed.error, isError: true };
  }
  const schemaParsed = validateMcpOptionalSingleLine(params.schema, "schema");
  if (schemaParsed.ok !== true) {
    return { text: schemaParsed.error, isError: true };
  }
  const cwdParsed = validateMcpCwd(params.cwd);
  if (cwdParsed.ok !== true) {
    return { text: cwdParsed.error, isError: true };
  }
  const includeColumnsRaw = params.includeColumns;
  if (
    includeColumnsRaw !== undefined &&
    typeof includeColumnsRaw !== "boolean"
  ) {
    return { text: "includeColumns must be a boolean", isError: true };
  }
  const resolved = resolveRepoRootSafe(cwdParsed.value ?? options.cwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  try {
    const result = await createDbSchemaResponse(
      resolved.root,
      {
        db: dbParsed.value,
        schema: schemaParsed.value,
        includeColumns: includeColumnsRaw !== false,
      },
      options.omitDirNames ?? [],
    );
    return dbServiceResultToMcpToolReturn("datastore schema", result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: `datastore schema failed: ${detail}`, isError: true };
  }
}

async function runDatastoreColumnsTool(
  input: unknown,
  options: DefaultMcpToolsOptions,
): Promise<McpToolRunReturn> {
  const params = isPlainObject(input) ? input : {};
  const dbParsed = validateMcpDbId(params.db);
  if (dbParsed.ok !== true) {
    return { text: dbParsed.error, isError: true };
  }
  const schemaParsed = validateMcpOptionalSingleLine(params.schema, "schema");
  if (schemaParsed.ok !== true) {
    return { text: schemaParsed.error, isError: true };
  }
  const tableParsed = validateMcpRequiredSingleLine(params.table, "table");
  if (tableParsed.ok !== true) {
    return { text: tableParsed.error, isError: true };
  }
  const cwdParsed = validateMcpCwd(params.cwd);
  if (cwdParsed.ok !== true) {
    return { text: cwdParsed.error, isError: true };
  }
  const resolved = resolveRepoRootSafe(cwdParsed.value ?? options.cwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  try {
    const result = await createDbColumnsResponse(
      resolved.root,
      {
        db: dbParsed.value,
        schema: schemaParsed.value,
        table: tableParsed.value,
      },
      options.omitDirNames ?? [],
    );
    return dbServiceResultToMcpToolReturn("datastore columns", result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: `datastore columns failed: ${detail}`, isError: true };
  }
}

// ai-dup-check: allow -- fp: runDatastoreColumnsTool と同型の
// 「入力検証→createDb*Response 呼び出し→整形」という pre-existing の
// MCP tool 実装パターン。今回の変更とは無関係。
async function runDatastoreDdlTool(
  input: unknown,
  options: DefaultMcpToolsOptions,
): Promise<McpToolRunReturn> {
  const params = isPlainObject(input) ? input : {};
  const dbParsed = validateMcpDbId(params.db);
  if (dbParsed.ok !== true) {
    return { text: dbParsed.error, isError: true };
  }
  const schemaParsed = validateMcpOptionalSingleLine(params.schema, "schema");
  if (schemaParsed.ok !== true) {
    return { text: schemaParsed.error, isError: true };
  }
  const tableParsed = validateMcpRequiredSingleLine(params.table, "table");
  if (tableParsed.ok !== true) {
    return { text: tableParsed.error, isError: true };
  }
  const cwdParsed = validateMcpCwd(params.cwd);
  if (cwdParsed.ok !== true) {
    return { text: cwdParsed.error, isError: true };
  }
  const resolved = resolveRepoRootSafe(cwdParsed.value ?? options.cwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  try {
    const result = await createDbDdlResponse(
      resolved.root,
      {
        db: dbParsed.value,
        schema: schemaParsed.value,
        table: tableParsed.value,
      },
      options.omitDirNames ?? [],
    );
    return dbServiceResultToMcpToolReturn("datastore DDL", result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: `datastore DDL failed: ${detail}`, isError: true };
  }
}

async function runDatastoreQueryTool(
  input: unknown,
  options: DefaultMcpToolsOptions,
): Promise<McpToolRunReturn> {
  const params = isPlainObject(input) ? input : {};
  const dbParsed = validateMcpDbId(params.db);
  if (dbParsed.ok !== true) {
    return { text: dbParsed.error, isError: true };
  }
  const sqlRaw = params.sql;
  if (typeof sqlRaw !== "string") {
    return { text: "sql must be a string", isError: true };
  }
  if (!sqlRaw.trim()) {
    return { text: "sql must be a non-empty string", isError: true };
  }
  if (sqlRaw.includes("\0")) {
    return { text: "sql must not contain NUL", isError: true };
  }
  const schemaParsed = validateMcpOptionalSingleLine(params.schema, "schema");
  if (schemaParsed.ok !== true) {
    return { text: schemaParsed.error, isError: true };
  }
  const cwdParsed = validateMcpCwd(params.cwd);
  if (cwdParsed.ok !== true) {
    return { text: cwdParsed.error, isError: true };
  }
  const maxRowsParsed = validateMcpIntegerLimit(
    params.maxRows,
    DB_QUERY_DEFAULT_MAX_ROWS,
    1,
    DB_QUERY_HARD_CAP_MAX_ROWS,
    "maxRows",
  );
  if (maxRowsParsed.ok !== true) {
    return { text: maxRowsParsed.error, isError: true };
  }
  const resolved = resolveRepoRootSafe(cwdParsed.value ?? options.cwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  try {
    const result = await createDbQueryResponse(
      resolved.root,
      {
        db: dbParsed.value,
        sql: sqlRaw,
        schema: schemaParsed.value,
        maxRows: maxRowsParsed.value,
      },
      options.omitDirNames ?? [],
    );
    return dbServiceResultToMcpToolReturn("datastore query", result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: `datastore query failed: ${detail}`, isError: true };
  }
}

async function runDatastoreHistoryTool(
  input: unknown,
  options: DefaultMcpToolsOptions,
): Promise<McpToolRunReturn> {
  const params = isPlainObject(input) ? input : {};
  const dbParsed = validateMcpOptionalDbId(params.db);
  if (dbParsed.ok !== true) {
    return { text: dbParsed.error, isError: true };
  }
  const schemaParsed = validateMcpOptionalSingleLine(params.schema, "schema");
  if (schemaParsed.ok !== true) {
    return { text: schemaParsed.error, isError: true };
  }
  const cwdParsed = validateMcpCwd(params.cwd);
  if (cwdParsed.ok !== true) {
    return { text: cwdParsed.error, isError: true };
  }
  const resolved = resolveRepoRootSafe(cwdParsed.value ?? options.cwd);
  if (resolved.ok !== true) {
    return { text: resolved.error, isError: true };
  }

  try {
    const result = await createDbHistoryResponse(resolved.root, {
      db: dbParsed.value,
      schema: schemaParsed.value,
    });
    return dbServiceResultToMcpToolReturn("datastore history", result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: `datastore history failed: ${detail}`, isError: true };
  }
}

function validateMcpDbId(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "db must be a string" };
  }
  if (!raw) return { ok: false, error: "db must be a non-empty string" };
  if (raw.includes("\0") || /[\r\n]/.test(raw)) {
    return {
      ok: false,
      error: "db must be single-line and must not contain NUL",
    };
  }
  return { ok: true, value: raw };
}

function validateMcpOptionalDbId(
  raw: unknown,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === "") return { ok: true, value: undefined };
  const parsed = validateMcpDbId(raw);
  if (parsed.ok !== true) return parsed;
  if (
    !parsed.value.startsWith("docker:") &&
    !parsed.value.startsWith("supabase:")
  ) {
    const pathError = validateMcpPath(parsed.value);
    if (pathError) return { ok: false, error: "invalid database path" };
  }
  return { ok: true, value: parsed.value };
}

// ai-dup-check: allow -- fp: validateMcpDbId と同型の
// 「string型チェック→単一行/NUL チェック」という pre-existing のバリデータ
// パターン。今回の変更とは無関係。
function validateMcpRequiredSingleLine(
  raw: unknown,
  name: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: `${name} must be a string` };
  }
  if (!raw) return { ok: false, error: `${name} must be a non-empty string` };
  if (raw.includes("\0") || /[\r\n]/.test(raw)) {
    return {
      ok: false,
      error: `${name} must be single-line and must not contain NUL`,
    };
  }
  return { ok: true, value: raw };
}

function validateMcpOptionalSingleLine(
  raw: unknown,
  name: string,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === "") return { ok: true, value: undefined };
  if (typeof raw !== "string") {
    return { ok: false, error: `${name} must be a string` };
  }
  if (raw.includes("\0") || /[\r\n]/.test(raw)) {
    return {
      ok: false,
      error: `${name} must be single-line and must not contain NUL`,
    };
  }
  return { ok: true, value: raw };
}

async function dbServiceResultToMcpToolReturn<T>(
  label: string,
  result: DbServiceResult<T>,
): Promise<McpToolRunReturn> {
  if (result.ok === true) {
    return { text: JSON.stringify(result.value, null, 2) };
  }
  const detail = await result.response.text();
  const text = detail || `${label} failed: HTTP ${result.response.status}`;
  return { text, isError: true };
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
    "  - code_viewer_file_blame: per-line blame (sha / author / time / summary).",
    "  - code_viewer_file_history: commit history for one path (follows renames).",
    "  - code_viewer_file_diff: unified diff for one path (preview-capped by default).",
    "  - code_viewer_search_files: rank repo paths by fuzzy or glob match.",
    "  - code_viewer_search_code: grep the repo (rg / git grep / fallback).",
    "  - code_viewer_datastore_sources: discover read-only datastore source ids.",
    "  - code_viewer_datastore_schemas: list schemas for one SQL datastore.",
    "  - code_viewer_datastore_schema: inspect tables, indexes, FKs, and columns.",
    "  - code_viewer_datastore_columns: inspect columns for one SQL table.",
    "  - code_viewer_datastore_ddl: inspect CREATE statement and triggers.",
    "  - code_viewer_datastore_query: run read-only SELECT / PRAGMA / EXPLAIN / WITH.",
    "  - code_viewer_datastore_history: inspect saved query history.",
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
