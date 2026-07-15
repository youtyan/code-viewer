// Help page (keybindings reference), extracted from app.ts.

import type { AppRoute } from "../core/routes";
import { buildHelpKeybindingGroups } from "./help-keybindings";

export type HelpPageDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  getRoute(): AppRoute;
  setRoute(route: AppRoute, replace?: boolean): void;
  setPageMode(): void;
  cancelActiveSourceLoad(reason: "user" | "navigation" | "esc"): boolean;
  removeStandaloneSource(): void;
  clearLoadQueue(): void;
  currentRange(): { from: string; to: string };
  syncHeaderMenu(): void;
  getLanguage(): HelpLanguage;
  setLanguage(language: HelpLanguage): void;
};

export type HelpLanguage = "en" | "ja";

export type HelpSection =
  | "overview"
  | "storage"
  | "annotations"
  | "database"
  | "skills"
  | "mcp"
  | "keybindings";

type HelpBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "command"; title: string; command: string }
  | { kind: "table"; rows: Array<[string, string]> };

type HelpContent = {
  languageLabel: string;
  title: string;
  sections: Record<
    HelpSection,
    {
      nav: string;
      title: string;
      intro: string;
      groups: Array<{ title: string; blocks: HelpBlock[] }>;
    }
  >;
};

const HELP_LANGUAGES: HelpLanguage[] = ["en", "ja"];

const HELP_SECTIONS: HelpSection[] = [
  "overview",
  "storage",
  "annotations",
  "database",
  "skills",
  "mcp",
  "keybindings",
];

const HELP_CONTENT: Record<HelpLanguage, HelpContent> = {
  en: {
    languageLabel: "Language",
    title: "Help",
    sections: {
      overview: {
        nav: "Getting Started",
        title: "Getting Started",
        intro:
          "code-viewer is a local browser UI for reading a repository, reviewing diffs, and letting AI agents attach explanations to exact code lines.",
        groups: [
          {
            title: "Start the viewer",
            blocks: [
              {
                kind: "paragraph",
                text: "Run the command from inside a Git repository. The server prints a localhost URL; open it in your browser.",
              },
              {
                kind: "command",
                title: "Run without installing",
                command: "npx @youtyan/code-viewer",
              },
              {
                kind: "command",
                title: "Open another repository",
                command: "code-viewer --cwd /path/to/repo --open",
              },
              {
                kind: "command",
                title: "Bind to a specific port or override scope",
                command:
                  "code-viewer --port 64160 --scope-omit-dir node_modules --scope-omit-dir dist",
              },
              {
                kind: "command",
                title: "Print the installed version",
                command: "code-viewer --version",
              },
            ],
          },
          {
            title: "Read a diff",
            blocks: [
              {
                kind: "paragraph",
                text: "Arguments after the options are passed to Git diff. With no arguments, code-viewer compares HEAD with the working tree.",
              },
              {
                kind: "command",
                title: "Compare two refs",
                command: "code-viewer HEAD~1 HEAD",
              },
              {
                kind: "command",
                title: "Inspect staged changes",
                command: "code-viewer --staged",
              },
            ],
          },
          {
            title: "Browse files",
            blocks: [
              {
                kind: "paragraph",
                text: "Use the sidebar or file palette to open source files, Markdown previews, images, PDFs, and other browser-safe media. Large text files automatically switch to virtual mode.",
              },
              {
                kind: "paragraph",
                text: "A file detail page exposes four tabs — Preview, Code, Blame, History. Code is the default and ?preview=1 opts in to the Markdown / media preview. Blame and History have their own canonical URLs (view=blame, view=history) so deep links and the browser back/forward stay in sync, and they keep the Repository sidebar visible.",
              },
              {
                kind: "paragraph",
                text: "In large repositories the sidebar loads folder children on demand. Folders you open are remembered and automatically re-expanded after a reload.",
              },
            ],
          },
          {
            title: "Environment doctor",
            blocks: [
              {
                kind: "paragraph",
                text: "Toggle the 🩺 icon in the header to slide in a diagnostic sheet from the right. It works on top of any screen (Repository, Diff, History, Datastores) and the open state is preserved in the URL as ?doctor=open so links are reproducible.",
              },
              {
                kind: "paragraph",
                text: "Each row reports OK / WARN / ERROR with a remediation hint when relevant. The check groups are Runtime (Node / Bun / NODE_MODULE_VERSION), Package (version + execution origin including npx cache), SQLite driver, Snapshot store, Git, GitHub CLI, Discovery summary, Docker / Compose (CLI / v2 plugin / daemon / compose config dry-parse / compose ps health per discovered service), and Server. The most common hint is the npx cache fix for better-sqlite3 NODE_MODULE_VERSION mismatch (rm -rf ~/.npm/_npx then re-run with npx -y @youtyan/code-viewer@latest).",
              },
              {
                kind: "paragraph",
                text: 'From the terminal — and for AI agents or CI — the same report is available without a browser. `code-viewer doctor` prints a status summary; add `--json` for the full DoctorReport (matches the /_doctor endpoint). Use `--bin git=/absolute/path`, `--bin docker=/absolute/path`, or `--bin gh=/absolute/path` when PATH resolves the wrong tool. Exit code is 1 when worstStatus is "error", so it doubles as a CI gate.',
              },
              {
                kind: "command",
                title: "Doctor summary in the terminal",
                command: "code-viewer doctor",
              },
              {
                kind: "command",
                title: "Doctor JSON for agents and CI",
                command:
                  "code-viewer doctor --json\ncode-viewer doctor --cwd /path/to/repo --port 64160 --json\ncode-viewer doctor --bin git=/opt/bin/git --bin docker=/opt/bin/docker --bin gh=/opt/bin/gh --json",
              },
            ],
          },
        ],
      },
      storage: {
        nav: "Project Files",
        title: ".code-viewer Directory",
        intro:
          "code-viewer keeps every per-repository state file under .code-viewer/ at the root of the opened repository. The directory is created on demand, can be deleted at any time to reset state, and should be gitignored in most projects.",
        groups: [
          {
            title: "What lives there",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "settings.json",
                    "Viewer Settings — diff layout, theme, language, sidebar/history widths, font sizes, syntax highlight, ignore-whitespace, hide-tests, scope overrides (omitted dirs / excluded names), upload toggle, annotation panel open/width/follow/mute/rate, and the last viewed diff range.",
                  ],
                  [
                    "view-state.json",
                    "Sidebar tree state — collapsed directories, lazy-expanded directories (folders opened on demand in large repos), and the viewed-file list used to dim already-read entries.",
                  ],
                  [
                    "tabs.json",
                    "Multi-DB tab layout — open datastore tabs, the active tab, per-tab selected table / view / SQL draft, per-tab Elasticsearch index and Redis DB index, and per-tab sidebar and history panel widths.",
                  ],
                  [
                    "db-ui.json",
                    "Datastore UI preferences — column widths per (DB, table, column) and toggle states such as Rails FK inference and the S3 tooltip.",
                  ],
                  [
                    "annotations.json",
                    "AI annotation walkthroughs — sessions with their ordered steps (file, line range, title, body), used by the annotation panel and synced live to open tabs over SSE.",
                  ],
                  [
                    "query-history.json",
                    "SQL query history — recent statements with column list, preview rows, row count, elapsed time, executor (browser or CLI), and execution timestamp.",
                  ],
                  [
                    "db-snapshots.sqlite (+ -shm / -wal)",
                    "SQLite store used by the Datastore Snapshot tab to keep point-in-time captures of tables / indices / key spaces for diffing. The -shm / -wal sidecar files are SQLite WAL artifacts; do not edit them directly.",
                  ],
                ],
              },
            ],
          },
          {
            title: "Source of truth and editing",
            blocks: [
              {
                kind: "paragraph",
                text: "Everything in .code-viewer/ is owned by code-viewer. JSON files are rewritten safely with validation on every change, so unknown keys are dropped and invalid values are reset to defaults. Hand-edit at your own risk — a corrupt file is renamed with a .corrupt suffix and replaced with an empty default.",
              },
              {
                kind: "paragraph",
                text: "Deleting the whole directory is the supported way to reset all per-repository state. Removing a single file resets only that subsystem (for example, deleting tabs.json closes all DB tabs on the next load).",
              },
            ],
          },
          {
            title: "Sharing across machines",
            blocks: [
              {
                kind: "paragraph",
                text: "These files contain local UI state and should normally stay out of version control — add .code-viewer/ to .gitignore. To share AI walkthroughs, commit annotations.json explicitly (or copy it between checkouts) and leave the other files ignored.",
              },
            ],
          },
        ],
      },
      annotations: {
        nav: "AI Annotations",
        title: "AI Code Annotations",
        intro:
          "Annotations let an AI coding agent guide you through code in the browser. Each annotation points to a file and line range, open tabs jump there live, and the full walkthrough is saved to .code-viewer/annotations.json so it survives reloads.",
        groups: [
          {
            title: "What you ask the AI to do",
            blocks: [
              {
                kind: "paragraph",
                text: 'Ask the agent to explain code with code-viewer annotations. For example: "Use annotate to walk me through the hardest part of this system."',
              },
              {
                kind: "steps",
                items: [
                  "Start code-viewer for the repository and keep it running.",
                  "Ask the AI agent for an annotated walkthrough.",
                  "Open the annotation panel in the browser, toggle the follow checkbox if you want tabs to auto-jump, and press play to have the current note read aloud.",
                ],
              },
            ],
          },
          {
            title: "Commands the agent uses",
            blocks: [
              {
                kind: "command",
                title: "Start a walkthrough session",
                command:
                  'code-viewer annotate start --title "How the cache invalidation works"',
              },
              {
                kind: "command",
                title: "Add an explanation to a line range",
                command:
                  'code-viewer annotate add --file src/cache.ts --line 120-145 --title "Entry point" --body "Writes land here first."',
              },
              {
                kind: "command",
                title: "Insert or move a step",
                command:
                  'code-viewer annotate add --after a-123 --file src/cache.ts --line 150 --body "This belongs here."\ncode-viewer annotate move a-999 --before a-123',
              },
              {
                kind: "command",
                title: "Edit, rename, delete, or clear",
                command:
                  'code-viewer annotate edit a-123 --body "Updated explanation."\ncode-viewer annotate rename sess-abc --title "Renamed walkthrough"\ncode-viewer annotate delete a-999\ncode-viewer annotate clear',
              },
              {
                kind: "command",
                title: "Annotate a database view",
                command: `code-viewer annotate add-db --db app.db --table orders --tab data \\
  --grid-search failed --filter status=failed --sort created_at:desc \\
  --body "This restores the filtered failure rows."
code-viewer annotate add-db --db app.db --tab query \\
  --sql "select * from orders where status = 'failed'" --run-query \\
  --body "This reopens the result being discussed."`,
              },
              {
                kind: "command",
                title: "Inspect posted annotations",
                command: "code-viewer annotate list",
              },
            ],
          },
          {
            title: "Browser panel features",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "Follow checkbox",
                    "When on, every new annotation makes the active tab jump to its location. Turn it off to read at your own pace.",
                  ],
                  [
                    "Audio playback",
                    "Play / pause / previous / next / mute / rate controls speak the current annotation through the browser TTS engine. Rate and mute are saved per project.",
                  ],
                  [
                    "Copy as AI prompt",
                    "Each annotation has a copy button that produces a paste-ready prompt block referencing the annotation URL, so you can hand it back to the originating agent.",
                  ],
                  [
                    "Timestamps and width",
                    "Session and entry rows show creation time. The panel can be resized, and its width is saved per project.",
                  ],
                  [
                    "Persistent state",
                    "Open/closed, width, follow, mute, and rate are stored under .code-viewer/settings.json; annotations themselves live in .code-viewer/annotations.json.",
                  ],
                ],
              },
            ],
          },
          {
            title: "Writing useful annotations",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "One idea per annotation",
                    "Prefer several focused notes over one long explanation.",
                  ],
                  [
                    "Always pass --line",
                    "Use the smallest range that covers the idea. The body is rendered under the last line.",
                  ],
                  [
                    "Use sessions",
                    "Start a new session for each walkthrough topic so the history stays readable.",
                  ],
                  [
                    "Fix in place",
                    "Use annotate edit when a note is wrong so the walkthrough order and IDs remain stable.",
                  ],
                  [
                    "Place notes deliberately",
                    "Use --before, --after, --position, or annotate move when the reading order changes.",
                  ],
                ],
              },
            ],
          },
        ],
      },
      database: {
        nav: "Datastores",
        title: "Datastore Viewer",
        intro:
          "Browse SQLite files, Docker-hosted databases, Redis, Elasticsearch, DynamoDB, and S3-compatible object stores from one local viewer.",
        groups: [
          {
            title: "Supported datastores",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "Saved connections",
                    "Use + beside the datastore selector to add an arbitrary PostgreSQL, MySQL, Redis, Elasticsearch, S3-compatible, or DynamoDB endpoint. Required fields are marked, and Test connection verifies the current values before saving. Drivers are included, so no database CLI or curl is required. Non-secret settings are saved locally; authentication values stay in server memory and must be entered again after a restart.",
                  ],
                  [
                    "SQLite",
                    "Automatically discovered from .db, .sqlite, .sqlite3, and .s3db files in the repository. Inline row edit / insert / delete via the grid Edit mode (atomic per-commit batch).",
                  ],
                  [
                    "MySQL / MariaDB",
                    "Detected from docker-compose.yml / compose.yml (or .yaml). Multiple databases per server are listed. Same inline row edit / insert / delete as SQLite.",
                  ],
                  [
                    "PostgreSQL",
                    "Detected from compose files. Multiple databases per server, plus a schema selector for switching schemas without reopening. Same inline row edit / insert / delete as SQLite. Local Supabase CLI (`supabase start`) projects are also auto-discovered from `supabase/config.toml`, without needing a docker-compose file.",
                  ],
                  [
                    "Redis",
                    "Detected from compose files. Browse DB 0-15, SCAN keys, dedicated string/hash/list panes, JSON view for set/zset/stream. Edit values, delete keys, and create new keys (all types) via in-pane editors. Participates in snapshots and diffs.",
                  ],
                  [
                    "Elasticsearch",
                    "Detected from compose files. List indices, view mappings, paginate with search_after, run lucene q= or DSL queries on an allowlist. Edit / create / delete documents with _seq_no / _primary_term optimistic concurrency. Take snapshots/diffs.",
                  ],
                  [
                    "DynamoDB / LocalStack",
                    "Detected when DynamoDB is enabled on a LocalStack compose service. List tables, browse a Structure tab (key schema, GSI/LSI, and non-key attribute types inferred from loaded items), scan or query items, follow pagination tokens, and open item details with a copyable key. Browsing is read-only.",
                  ],
                  [
                    "S3 / MinIO / LocalStack",
                    "Detected from compose files. Folder-tree browse, prefix/filename search, updated-time sort, and previews for images, video, audio, PDF, Markdown, HTML, and text. Edit text/markdown/JSON object bodies inline, upload new objects, and delete existing ones. LocalStack falls back to `docker exec curl` when no host port is published; MinIO requires a published host port.",
                  ],
                ],
              },
            ],
          },
          {
            title: "UI layout",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "Multi-DB tabs",
                    "Open multiple databases side by side. Drag to reorder, + adds an empty tab, middle-click or × closes one (the last tab is reset to empty). Layout persists in .code-viewer/tabs.json.",
                  ],
                  [
                    "Sidebar",
                    "DB selector, PostgreSQL schema selector, table tree (expand to see columns and a table description when available), filter, Rails FK inference toggle, and icon toolbar for Query / ER / Search / Snapshot tabs.",
                  ],
                  [
                    "Data tab",
                    "Paginated grid with sort, filter, cell copy, CSV/JSON export (capped at 100k rows; export respects the current filter and sort), and a table-only reload action that keeps global search and column filters. Reload results are announced beside the button so row-count changes are visible. Toggle Edit mode in the prefs bar to enable inline editing — double-click a cell to edit, queue insert/delete via row actions, and commit the batch atomically. Edited rows/cells highlight in yellow until committed.",
                  ],
                  [
                    "Detail footer & related panel",
                    "Click any cell to open a resizable detail footer. Foreign-key cells open a related-rows panel with multi-step drill-down breadcrumbs, supporting both outgoing (FK → PK) and incoming (PK ← FK) navigation.",
                  ],
                  [
                    "Schema tab",
                    "Table description when available, column definitions, indexes, foreign keys, triggers, and DDL, with an in-tab refresh action for reloading the current table structure.",
                  ],
                  [
                    "Query editor",
                    "SQL syntax highlighting (shiki), Tab indent, auto-resize, Ctrl+Enter to run. Allowlist depends on the engine (SQLite: SELECT/PRAGMA/EXPLAIN/WITH; PostgreSQL and MySQL also accept SHOW/DESCRIBE).",
                  ],
                  [
                    "ER Diagram",
                    "Mermaid-based entity-relationship diagram with zoom and pan.",
                  ],
                  [
                    "Search tab",
                    "Full-text search across all tables and text columns of a database.",
                  ],
                  [
                    "Snapshot tab",
                    "Capture point-in-time snapshots of selected tables/indices/key spaces and diff any two to see inserts, updates, and deletes with full before/after values.",
                  ],
                  [
                    "Footer dock (Query History / Session log)",
                    "JetBrains-style bottom dock with two tabs. Query History: per-DB master/detail of saved queries, SSE-synced across tabs. Session log: every SQL the server runs in this session (read fetches, user queries, write commits) with timing, row count, and the executed SQL syntax-highlighted. Auto-follow keeps the newest entry pinned; scroll up or click a non-latest entry to pause. The active tab and open/closed state persist in tabs.json.",
                  ],
                  [
                    "Datastore explorers",
                    "Redis / Elasticsearch / DynamoDB / S3 keep the same Multi-DB tab UI but swap the table tree for a key-space / index-tree / table-list / folder-tree explorer. Redis, Elasticsearch, and S3 provide editing or creation flows; DynamoDB browsing is read-only.",
                  ],
                ],
              },
            ],
          },
          {
            title: "CLI query (for AI agents)",
            blocks: [
              {
                kind: "paragraph",
                text: "AI agents can execute read-only queries, search across tables, and capture snapshots / diffs from the CLI. Results are written to the same per-repository history visible in the browser, and the browser UI exposes the same operations through the Search tab and the Snapshot tab.",
              },
              {
                kind: "command",
                title: "Run a query",
                command:
                  'code-viewer query exec --db data.db --sql "SELECT * FROM users LIMIT 10" --title "Sample data"',
              },
              {
                kind: "command",
                title: "Run without saving history",
                command:
                  'code-viewer query exec --db app.db --sql "SELECT count(*) FROM orders" --max-rows 1 --no-save',
              },
              {
                kind: "command",
                title: "List or clear query history",
                command:
                  "code-viewer query list --db app.db --json\ncode-viewer query clear --db app.db",
              },
              {
                kind: "command",
                title: "Search across all tables",
                command:
                  'code-viewer query search --db app.db --term "sample@example.com" \\\n  --tables users,orders --include-non-text --max-hits 20',
              },
              {
                kind: "command",
                title: "Capture a snapshot",
                command:
                  'code-viewer query snapshot create --db app.db --tables users,orders \\\n  --note "Before user registration test"',
              },
              {
                kind: "command",
                title: "List, annotate, or delete snapshots",
                command:
                  'code-viewer query snapshot list --db app.db --json\ncode-viewer query snapshot note --id snap-abc123 --note "Updated context"\ncode-viewer query snapshot delete --id snap-abc123',
              },
              {
                kind: "command",
                title: "Diff two snapshots",
                command:
                  "code-viewer query diff tables --before snap-abc123 --after snap-def456 --json",
              },
              {
                kind: "command",
                title: "Inspect a diff",
                command:
                  "code-viewer query diff rows --before snap-abc123 --after snap-def456 --table users --limit 50",
              },
              {
                kind: "command",
                title: "Agent reference",
                command: "code-viewer query agent-help",
              },
            ],
          },
        ],
      },
      skills: {
        nav: "Agent Skill",
        title: "Agent Skill Setup",
        intro:
          "The package bundles four skills — code-viewer-annotate, code-viewer-journal, code-viewer-query, and code-viewer-snapshot — so AI agents know when and how to create browser walkthroughs, manage Work Log task queues, run read-only queries, and capture snapshot / diff sessions. A single skill install command copies all four into the selected agent directories.",
        groups: [
          {
            title: "Install the skills",
            blocks: [
              {
                kind: "command",
                title: "Install for Claude Code in the current project",
                command: "npx -y @youtyan/code-viewer skill install",
              },
              {
                kind: "command",
                title: "Install for other agents",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent codex,gemini,cursor",
              },
              {
                kind: "command",
                title: "Install for every supported agent",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent all\n# all = claude (.claude/), codex (.codex/), gemini (.gemini/), cursor (.cursor/), agents (.agents/)",
              },
              {
                kind: "command",
                title: "Install globally for a user (not per project)",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent all --global",
              },
              {
                kind: "command",
                title: "Install into a different project directory",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent all --cwd /path/to/other/repo\n# --cwd selects the target project; ignored when --global is also given.",
              },
            ],
          },
          {
            title: "What the skills teach",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "When to annotate",
                    "Code reviews, onboarding walkthroughs, and explanations of changes.",
                  ],
                  [
                    "How to manage Work Log tasks",
                    "Use the journal CLI for task lists, task creation, claim/done flows, and GitHub Issue linking.",
                  ],
                  [
                    "How to inspect data",
                    "Use read-only query commands for schema, SQL, saved query history, and table-wide search.",
                  ],
                  [
                    "How to verify data changes",
                    "Use snapshot create/list/diff workflows to compare before and after states.",
                  ],
                ],
              },
            ],
          },
          {
            title: "Agent reference",
            blocks: [
              {
                kind: "paragraph",
                text: "Agents can print the full built-in guide from the CLI when they need exact command details.",
              },
              {
                kind: "command",
                title: "Show the agent guides",
                command:
                  "code-viewer annotate agent-help\ncode-viewer journal agent-help\ncode-viewer query agent-help",
              },
            ],
          },
        ],
      },
      mcp: {
        nav: "MCP Server",
        title: "MCP Server",
        intro:
          "While code-viewer is running, the same server also exposes a local, read-only MCP endpoint at /_mcp so AI agents can call status, file, search, and datastore tools directly over JSON-RPC instead of spawning code-viewer CLI subprocesses.",
        groups: [
          {
            title: "Connect to the endpoint",
            blocks: [
              {
                kind: "paragraph",
                text: "The endpoint speaks JSON-RPC 2.0 over the Streamable HTTP transport (initialize, ping, tools/list, tools/call). It accepts POST requests with an application/json body only, and is guarded by the same localhost / same-origin check as every other route.",
              },
              {
                kind: "command",
                title: "Endpoint URL (port from the printed startup URL)",
                command: "http://127.0.0.1:<port>/_mcp",
              },
            ],
          },
          {
            title: "Available tools",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "code_viewer_agent_help",
                    "Index of every AI-facing CLI subcommand.",
                  ],
                  [
                    "code_viewer_status",
                    "Branch, remote, changed files, and recent commits.",
                  ],
                  [
                    "code_viewer_file_show",
                    "Read a file (optionally a line range) at any ref.",
                  ],
                  [
                    "code_viewer_file_blame",
                    "Per-line blame (sha / author / time / summary).",
                  ],
                  [
                    "code_viewer_file_history",
                    "Commit history for one path (follows renames).",
                  ],
                  [
                    "code_viewer_file_diff",
                    "Unified diff for one path (preview-capped by default).",
                  ],
                  [
                    "code_viewer_search_files",
                    "Rank repository paths by fuzzy or glob match.",
                  ],
                  [
                    "code_viewer_search_code",
                    "Grep the repository (rg / git grep / fallback).",
                  ],
                  [
                    "code_viewer_datastore_sources",
                    "Discover read-only datastore source ids.",
                  ],
                  [
                    "code_viewer_datastore_schemas",
                    "List schemas for one SQL datastore.",
                  ],
                  [
                    "code_viewer_datastore_schema",
                    "Inspect tables, indexes, FKs, and columns.",
                  ],
                  [
                    "code_viewer_datastore_columns",
                    "Inspect columns for one SQL table.",
                  ],
                  [
                    "code_viewer_datastore_ddl",
                    "Inspect the CREATE statement and triggers.",
                  ],
                  [
                    "code_viewer_datastore_query",
                    "Run a read-only SELECT / PRAGMA / EXPLAIN / WITH.",
                  ],
                  [
                    "code_viewer_datastore_history",
                    "Inspect saved query history.",
                  ],
                ],
              },
            ],
          },
        ],
      },
      keybindings: {
        nav: "Keybindings",
        title: "Keyboard Shortcuts",
        intro:
          "Use these shortcuts to move between panels and navigate files without leaving the keyboard.",
        groups: [
          {
            title: "Line selection",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "Drag on line numbers",
                    "Highlight a range; the floating copy pill prepares @path#1-9",
                  ],
                  [
                    "Click the pill",
                    "Copy @path#1-9 to the clipboard for pasting into an AI agent",
                  ],
                  [
                    "Shift+Click the pill",
                    "Copy @path#1-9 plus a fenced code block of the selected lines — paste straight to an AI without re-fetching the file",
                  ],
                  [
                    "x button / Escape",
                    "Clear the selected range and hide the floating copy pill",
                  ],
                ],
              },
            ],
          },
        ],
      },
    },
  },
  ja: {
    languageLabel: "言語",
    title: "ヘルプ",
    sections: {
      overview: {
        nav: "はじめに",
        title: "はじめに",
        intro:
          "code-viewer は、ローカルのリポジトリをブラウザで読み、diff を確認し、AI エージェントにコード行へ説明を付けさせるためのツールです。",
        groups: [
          {
            title: "ビューアを起動する",
            blocks: [
              {
                kind: "paragraph",
                text: "Git リポジトリの中でコマンドを実行します。サーバが localhost の URL を表示するので、それをブラウザで開きます。",
              },
              {
                kind: "command",
                title: "インストールせずに起動",
                command: "npx @youtyan/code-viewer",
              },
              {
                kind: "command",
                title: "別のリポジトリを開く",
                command: "code-viewer --cwd /path/to/repo --open",
              },
              {
                kind: "command",
                title: "ポート指定とスコープ除外を上書きする",
                command:
                  "code-viewer --port 64160 --scope-omit-dir node_modules --scope-omit-dir dist",
              },
              {
                kind: "command",
                title: "インストールされたバージョンを表示",
                command: "code-viewer --version",
              },
            ],
          },
          {
            title: "diff を読む",
            blocks: [
              {
                kind: "paragraph",
                text: "オプションの後ろに置いた引数は Git diff に渡されます。引数なしなら HEAD と作業ツリーを比較します。",
              },
              {
                kind: "command",
                title: "2つの ref を比較",
                command: "code-viewer HEAD~1 HEAD",
              },
              {
                kind: "command",
                title: "ステージ済み変更を見る",
                command: "code-viewer --staged",
              },
            ],
          },
          {
            title: "ファイルを読む",
            blocks: [
              {
                kind: "paragraph",
                text: "サイドバーやファイルパレットから、ソース、Markdown プレビュー、画像、PDF などを開けます。大きいテキストファイルは自動で軽量な仮想表示に切り替わります。",
              },
              {
                kind: "paragraph",
                text: "ファイル詳細ページには Preview / Code / Blame / History の 4 つのタブがあります。Code がデフォルトで、?preview=1 を付けると Markdown / メディアプレビューに切り替わります。Blame と History はそれぞれ専用 URL (view=blame, view=history) を持つため、ディープリンクとブラウザの戻る / 進むが同期し、いずれも Repository サイドバーは表示されたままです。",
              },
              {
                kind: "paragraph",
                text: "大きいリポジトリではサイドバーがフォルダの中身を必要に応じて読み込みます。開いたフォルダは記憶され、次回のリロード時に同じ状態で展開し直されます。",
              },
            ],
          },
          {
            title: "環境ドクター",
            blocks: [
              {
                kind: "paragraph",
                text: "ヘッダ右の 🩺 アイコンで、右からスライドする診断シートを開きます。Repository / Diff / History / Datastores などどの画面の上にも重ねて表示でき、開閉状態は URL の ?doctor=open に同期されるのでリンク共有で復元できます。",
              },
              {
                kind: "paragraph",
                text: "各項目は OK / WARN / ERROR で表示され、必要に応じて対処手順のヒントが付きます。診断グループは Runtime (Node / Bun / NODE_MODULE_VERSION)、Package (バージョン + 実行元: npx cache / global / local / bunx)、SQLite driver、Snapshot store、Git、GitHub CLI、Discovery summary、Docker / Compose (CLI / v2 plugin / daemon / compose config dry parse / compose ps による各サービスのヘルス)、Server (待ち受けポート) です。よくあるヒントは npx キャッシュ起因の better-sqlite3 NODE_MODULE_VERSION 不一致で、rm -rf ~/.npm/_npx の後に npx -y @youtyan/code-viewer@latest を再実行する手順を表示します。",
              },
              {
                kind: "paragraph",
                text: 'ターミナルからは `code-viewer doctor` で同じレポートを取得できます。AI エージェントや CI からは `--json` で /_doctor と同じ DoctorReport を受け取れます。PATH と別の実行ファイルを使いたい場合は `--bin git=/absolute/path`、`--bin docker=/absolute/path`、`--bin gh=/absolute/path` を指定できます。worstStatus が "error" なら exit code 1 を返すので CI ガードに直接使えます。',
              },
              {
                kind: "command",
                title: "ターミナル用 doctor サマリー",
                command: "code-viewer doctor",
              },
              {
                kind: "command",
                title: "AI / CI 用 doctor JSON",
                command:
                  "code-viewer doctor --json\ncode-viewer doctor --cwd /path/to/repo --port 64160 --json\ncode-viewer doctor --bin git=/opt/bin/git --bin docker=/opt/bin/docker --bin gh=/opt/bin/gh --json",
              },
            ],
          },
        ],
      },
      storage: {
        nav: "プロジェクトファイル",
        title: ".code-viewer ディレクトリ",
        intro:
          "code-viewer はリポジトリ単位の状態をすべて、開いたリポジトリ直下の .code-viewer/ ディレクトリに保存します。必要になったときに自動で作られ、削除すれば全状態をリセットでき、通常は .gitignore に登録しておきます。",
        groups: [
          {
            title: "中に置かれるファイル",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "settings.json",
                    "Viewer Settings — diff レイアウト、テーマ、言語、サイドバー/履歴幅、フォントサイズ、シンタックスハイライト、whitespace 無視、テスト非表示、scope 上書き（除外ディレクトリ / 除外名）、アップロード許可、注釈パネルの開閉/幅/follow/ミュート/再生速度、最後に表示した diff 範囲を保存します。",
                  ],
                  [
                    "view-state.json",
                    "サイドバーツリーの状態 — 折りたたみ済みディレクトリ、遅延展開済みディレクトリ（大規模リポジトリで必要に応じて開かれたフォルダ）、既読扱いするための表示済みファイル一覧。",
                  ],
                  [
                    "tabs.json",
                    "マルチ DB タブのレイアウト — 開いているデータストアタブ、アクティブタブ、タブごとの選択テーブル / ビュー / SQL ドラフト、Elasticsearch のインデックスや Redis の DB index、タブ単位のサイドバー幅・履歴パネル高。",
                  ],
                  [
                    "db-ui.json",
                    "データストア UI の設定 — (DB, テーブル, カラム) ごとの列幅、Rails FK 推測や S3 ツールチップなどのトグル状態。",
                  ],
                  [
                    "annotations.json",
                    "AI 注釈のウォークスルー — セッションと順序付きステップ（ファイル、行範囲、タイトル、本文）。注釈パネルが読み、SSE で開いているタブへもライブ同期されます。",
                  ],
                  [
                    "query-history.json",
                    "SQL クエリ履歴 — 直近のクエリ、カラム一覧、プレビュー行、行数、実行時間、実行元（browser / CLI）、実行時刻。",
                  ],
                  [
                    "db-snapshots.sqlite (+ -shm / -wal)",
                    "Snapshot タブが使う SQLite ストア。テーブル / インデックス / キー空間の時点スナップショットを保持し、差分表示に使います。-shm / -wal は SQLite の WAL 用付随ファイル。手動編集しないでください。",
                  ],
                ],
              },
            ],
          },
          {
            title: "ファイルの所有権と編集",
            blocks: [
              {
                kind: "paragraph",
                text: ".code-viewer/ の中身はすべて code-viewer が管理します。JSON ファイルは書き込みごとにバリデーションを通して安全に書き換えられるため、未知のキーは破棄され、不正な値は既定値に戻されます。手で編集すると壊れる可能性があり、壊れたファイルは .corrupt サフィックスに改名されて空の既定値で置き換えられます。",
              },
              {
                kind: "paragraph",
                text: "ディレクトリごと削除するのが、このリポジトリの全状態をリセットする推奨手順です。個別ファイルだけを消した場合はその系統だけがリセットされます（例: tabs.json を消すと次回起動時に DB タブがすべて閉じた状態になります）。",
              },
            ],
          },
          {
            title: "他マシンとの共有",
            blocks: [
              {
                kind: "paragraph",
                text: "これらはローカル UI 状態なので、原則としてバージョン管理には入れません — .code-viewer/ を .gitignore に追加しておきます。AI のウォークスルーを共有したい場合は annotations.json だけを明示的に commit（または別チェックアウトへコピー）し、それ以外は無視したままにします。",
              },
            ],
          },
        ],
      },
      annotations: {
        nav: "AI注釈",
        title: "AI コード注釈",
        intro:
          "注釈機能を使うと、AI コーディングエージェントがブラウザ上の特定ファイル・特定行へ説明を付けられます。開いているタブは注釈先へライブで移動し、ウォークスルー全体は .code-viewer/annotations.json に保存されてリロード後も残ります。",
        groups: [
          {
            title: "AI に頼む言い方",
            blocks: [
              {
                kind: "paragraph",
                text: "AI エージェントには、code-viewer の annotate 機能を使って説明して、と頼みます。例: 「このシステムで一番むずかしい処理を annotate でウォークスルーして」",
              },
              {
                kind: "steps",
                items: [
                  "対象リポジトリで code-viewer を起動したままにします。",
                  "AI エージェントに注釈付きの解説を依頼します。",
                  "ブラウザの注釈パネルを開き、自動追従させたいときは follow チェックボックスをオン、再生ボタンで読み上げも使えます。",
                ],
              },
            ],
          },
          {
            title: "AI が使うコマンド",
            blocks: [
              {
                kind: "command",
                title: "ウォークスルー用セッションを作る",
                command:
                  'code-viewer annotate start --title "キャッシュ無効化の流れ"',
              },
              {
                kind: "command",
                title: "行範囲へ説明を追加する",
                command:
                  'code-viewer annotate add --file src/cache.ts --line 120-145 --title "入口" --body "書き込みはここから入ります。"',
              },
              {
                kind: "command",
                title: "説明を途中に差し込む・移動する",
                command:
                  'code-viewer annotate add --after a-123 --file src/cache.ts --line 150 --body "ここに入る補足です。"\ncode-viewer annotate move a-999 --before a-123',
              },
              {
                kind: "command",
                title: "edit / rename / delete / clear",
                command:
                  'code-viewer annotate edit a-123 --body "説明文を修正しました。"\ncode-viewer annotate rename sess-abc --title "ウォークスルー名を変更"\ncode-viewer annotate delete a-999\ncode-viewer annotate clear',
              },
              {
                kind: "command",
                title: "データベース画面へ注釈を追加する",
                command: `code-viewer annotate add-db --db app.db --table orders --tab data \\
  --grid-search failed --filter status=failed --sort created_at:desc \\
  --body "失敗注文で絞り込んだ調査画面を復元します。"
code-viewer annotate add-db --db app.db --tab query \\
  --sql "select * from orders where status = 'failed'" --run-query \\
  --body "説明対象のクエリ結果を開き直します。"`,
              },
              {
                kind: "command",
                title: "投稿済み注釈を確認する",
                command: "code-viewer annotate list",
              },
            ],
          },
          {
            title: "ブラウザパネルの機能",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "follow チェックボックス",
                    "オンにすると新しい注釈が追加されるたびにアクティブタブが注釈先へ自動で移動します。落ち着いて読みたいときはオフに。",
                  ],
                  [
                    "音声再生",
                    "再生 / 一時停止 / 前後 / ミュート / 速度を持つプレイヤーが、現在の注釈をブラウザ TTS で読み上げます。速度とミュートはプロジェクト単位で保存されます。",
                  ],
                  [
                    "AI 用プロンプトとしてコピー",
                    "各注釈のコピーボタンが、注釈 URL を含む貼り付け可能なプロンプトを生成します。元のエージェントへそのまま戻せます。",
                  ],
                  [
                    "日時と幅",
                    "セッションと注釈の行には作成日時が出ます。パネル幅はリサイズでき、プロジェクト単位で保存されます。",
                  ],
                  [
                    "永続化",
                    "パネルの開閉・幅・follow・ミュート・速度は .code-viewer/settings.json に、注釈自体は .code-viewer/annotations.json に保存されます。",
                  ],
                ],
              },
            ],
          },
          {
            title: "読みやすい注釈にするコツ",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "1注釈1テーマ",
                    "巨大な説明を1つ置くより、短い注釈を順番に並べます。",
                  ],
                  [
                    "必ず --line を付ける",
                    "説明に必要な最小行範囲を指定します。本文は範囲の最後の行の下に表示されます。",
                  ],
                  [
                    "セッションを分ける",
                    "1つの解説テーマごとにセッションを作ると履歴が読みやすくなります。",
                  ],
                  [
                    "間違いは edit で直す",
                    "削除して追加し直すより、注釈IDと順番を保ったまま修正します。",
                  ],
                  [
                    "順番は明示的に直す",
                    "--before、--after、--position、annotate move で読み順を整えます。",
                  ],
                ],
              },
            ],
          },
        ],
      },
      database: {
        nav: "データストア",
        title: "データストアビューア",
        intro:
          "SQLite ファイル、Docker 上のデータベース、Redis、Elasticsearch、DynamoDB、S3 互換オブジェクトストアをローカルビューアで閲覧できます。",
        groups: [
          {
            title: "対応データストア",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "保存済み接続",
                    "データストア選択の横にある + から、任意の PostgreSQL、MySQL、Redis、Elasticsearch、S3 互換、DynamoDB エンドポイントを追加できます。必須項目にはマークが付き、保存前に「接続テスト」で入力内容を確認できます。ドライバーは同梱されているため、データベース CLI や curl は不要です。非機密設定はローカルに保存されますが、認証情報はサーバーメモリだけに保持され、再起動後は再入力が必要です。",
                  ],
                  [
                    "SQLite",
                    "リポジトリ内の .db, .sqlite, .sqlite3, .s3db ファイルを自動検出します。グリッドの Edit モードで行のインライン編集 / 追加 / 削除に対応 (コミット単位でアトミックに適用)。",
                  ],
                  [
                    "MySQL / MariaDB",
                    "docker-compose.yml / compose.yml (.yaml 含む) のサービスから検出。同一サーバー上の複数データベースを一覧表示します。SQLite と同じく Edit モードで行のインライン編集 / 追加 / 削除に対応。",
                  ],
                  [
                    "PostgreSQL",
                    "compose ファイルから検出。同一サーバー上の複数データベースに対応し、スキーマ切替セレクターで再オープンせずスキーマを切り替えられます。SQLite と同じく行のインライン編集 / 追加 / 削除に対応。ローカルの Supabase CLI (`supabase start`) プロジェクトも `supabase/config.toml` から自動検出され、docker-compose ファイルは不要です。",
                  ],
                  [
                    "Redis",
                    "compose ファイルから検出。DB 0-15 を SCAN し、string/hash/list は専用ペイン、set/zset/stream は JSON ビュー。値の編集 / キー削除 / 新規キー作成 (全タイプ) に対応。スナップショット/差分にも参加します。",
                  ],
                  [
                    "Elasticsearch",
                    "compose ファイルから検出。インデックス一覧、マッピング、search_after ページング、lucene q= と許可リスト経由の DSL、スナップショット/差分に対応。_seq_no / _primary_term 楽観ロックでドキュメントの編集 / 新規作成 / 削除も可能。",
                  ],
                  [
                    "DynamoDB / LocalStack",
                    "LocalStack の compose サービスで DynamoDB が有効な場合に検出。テーブル一覧、構造タブ(キースキーマ・GSI/LSI・読み込み済みアイテムから推測した非キー属性の型)、scan / query、継続トークンによるページング、コピー可能なキー付きのアイテム詳細を表示します。閲覧専用です。",
                  ],
                  [
                    "S3 / MinIO / LocalStack",
                    "compose ファイルから検出。フォルダツリー型ブラウザ、prefix/ファイル名検索、更新日時順表示、画像/動画/音声/PDF/Markdown/HTML/テキストのプレビューに対応。テキスト/Markdown/JSON のインライン編集、新規オブジェクトアップロード、オブジェクト削除も可能。LocalStack はホストポート未公開時 `docker exec curl` にフォールバックしますが、MinIO はホストポート公開が必須です。",
                  ],
                ],
              },
            ],
          },
          {
            title: "UI構成",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "マルチ DB タブ",
                    "複数のデータベースを横並びで開きます。ドラッグで並び替え、+ で空タブ追加、× / 中クリックで閉じる（最後の1枚は空タブにリセット）。並びは .code-viewer/tabs.json に保存されます。",
                  ],
                  [
                    "サイドバー",
                    "DB 選択、PostgreSQL スキーマセレクター、テーブルツリー（展開でカラムと、あればテーブルコメントを表示）、フィルター、Rails 命名規約による仮想 FK 推測トグル、Query / ER / Search / Snapshot アイコンツールバー。",
                  ],
                  [
                    "Data タブ",
                    "ページネーション付きグリッド。ソート、フィルター、セルコピー、CSV/JSON エクスポート（最大10万行、現在のフィルター/ソートを反映）、全体検索と列フィルターを保持した表だけの再読み込みに対応。再読み込み結果はボタン横に表示され、行数変化に気づけます。設定バーで Edit モードを ON にするとインライン編集が可能 — セルをダブルクリックで編集、行操作で挿入/削除を予約、コミット単位で一括適用。未コミットの編集行/セルは黄色でハイライト。",
                  ],
                  [
                    "詳細フッタ・関連パネル",
                    "セルをクリックするとリサイズ可能な詳細フッタが開きます。外部キー値からは関連行パネルが開き、ブレッドクラム付きで多段ドリルダウン可能。outgoing (FK→PK) と incoming (PK←FK) の両方向に対応。",
                  ],
                  [
                    "Schema タブ",
                    "テーブルコメント（あれば）、カラム定義、インデックス、外部キー、トリガー、DDL。現在の表構造だけを再読み込みするタブ内更新にも対応。",
                  ],
                  [
                    "クエリエディター",
                    "SQL シンタックスハイライト (shiki)、Tab インデント、自動リサイズ、Ctrl+Enter で実行。許可文は DB 種別により異なります（SQLite: SELECT/PRAGMA/EXPLAIN/WITH。PostgreSQL と MySQL は SHOW/DESCRIBE も可）。",
                  ],
                  [
                    "ER 図",
                    "Mermaid ベースのエンティティ関係図。ズーム・パン対応。",
                  ],
                  [
                    "Search タブ",
                    "全テーブル・全テキスト列を横断する全文検索。",
                  ],
                  [
                    "Snapshot タブ",
                    "選んだテーブル / インデックス / キー空間の状態を保存し、任意の 2 つの差分（insert / update / delete + before/after）を表示します。",
                  ],
                  [
                    "フッタ Dock (クエリ履歴 / ログ)",
                    "JetBrains 風の常駐 bottom dock に 2 タブ。「クエリ履歴」: DB ごとに保存されたクエリのマスター/ディテール、SSE で全タブにライブ同期。「ログ」: このセッションでサーバが実行した SQL すべて (テーブル読み込み / ユーザークエリ / 編集コミット) を所要時間・行数・実行 SQL (シンタックスハイライト) 付きで時系列表示。自動追従 ON で常に最新を表示、下スクロール or 最新以外をクリックすると追従解除。アクティブタブと開閉状態は tabs.json に永続化されます。",
                  ],
                  [
                    "データストア専用エクスプローラ",
                    "Redis / Elasticsearch / DynamoDB / S3 はマルチ DB タブ UI を共有しつつ、テーブルツリーをキー空間ツリー / インデックスツリー / テーブル一覧 / フォルダツリーに差し替えます。Redis、Elasticsearch、S3 は編集・作成フローを提供し、DynamoDB は閲覧専用です。",
                  ],
                ],
              },
            ],
          },
          {
            title: "CLI クエリ（AIエージェント用）",
            blocks: [
              {
                kind: "paragraph",
                text: "AI エージェントは CLI から read-only クエリの実行、テーブル横断検索、スナップショット / 差分作成までできます。結果はブラウザで見えるのと同じリポジトリ単位の履歴に保存され、ブラウザ UI 側でも Search タブ / Snapshot タブから同じ操作が行えます。",
              },
              {
                kind: "command",
                title: "クエリを実行",
                command:
                  'code-viewer query exec --db data.db --sql "SELECT * FROM users LIMIT 10" --title "サンプルデータ"',
              },
              {
                kind: "command",
                title: "履歴を残さずに実行",
                command:
                  'code-viewer query exec --db app.db --sql "SELECT count(*) FROM orders" --max-rows 1 --no-save',
              },
              {
                kind: "command",
                title: "履歴の一覧 / 削除",
                command:
                  "code-viewer query list --db app.db --json\ncode-viewer query clear --db app.db",
              },
              {
                kind: "command",
                title: "テーブル横断の全文検索",
                command:
                  'code-viewer query search --db app.db --term "sample@example.com" \\\n  --tables users,orders --include-non-text --max-hits 20',
              },
              {
                kind: "command",
                title: "スナップショットを作成",
                command:
                  'code-viewer query snapshot create --db app.db --tables users,orders \\\n  --note "ユーザー登録テスト前"',
              },
              {
                kind: "command",
                title: "スナップショットの一覧 / メモ更新 / 削除",
                command:
                  'code-viewer query snapshot list --db app.db --json\ncode-viewer query snapshot note --id snap-abc123 --note "メモを更新"\ncode-viewer query snapshot delete --id snap-abc123',
              },
              {
                kind: "command",
                title: "2 つのスナップショットを diff",
                command:
                  "code-viewer query diff tables --before snap-abc123 --after snap-def456 --json",
              },
              {
                kind: "command",
                title: "diff の中身を確認",
                command:
                  "code-viewer query diff rows --before snap-abc123 --after snap-def456 --table users --limit 50",
              },
              {
                kind: "command",
                title: "エージェント向けリファレンス",
                command: "code-viewer query agent-help",
              },
            ],
          },
        ],
      },
      skills: {
        nav: "スキル登録",
        title: "Agent Skill の登録",
        intro:
          "このパッケージには 4 つのスキル (code-viewer-annotate / code-viewer-journal / code-viewer-query / code-viewer-snapshot) が同梱されており、AI エージェントに annotate でのウォークスルー、Work Log タスク管理、read-only な query、スナップショット / 差分の使い分けを教えます。skill install を 1 回叩くと、選んだエージェントすべてに 4 スキルがコピーされます。",
        groups: [
          {
            title: "スキルをインストールする",
            blocks: [
              {
                kind: "command",
                title: "現在のプロジェクトへ Claude Code 用に登録",
                command: "npx -y @youtyan/code-viewer skill install",
              },
              {
                kind: "command",
                title: "別のエージェント向けに登録",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent codex,gemini,cursor",
              },
              {
                kind: "command",
                title: "対応エージェントすべてに登録",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent all\n# all = claude (.claude/), codex (.codex/), gemini (.gemini/), cursor (.cursor/), agents (.agents/)",
              },
              {
                kind: "command",
                title: "ユーザー全体（プロジェクト外）へ登録",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent all --global",
              },
              {
                kind: "command",
                title: "別プロジェクトのディレクトリへ登録",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent all --cwd /path/to/other/repo\n# --cwd でインストール先プロジェクトを指定。--global を併用したときは無視されます。",
              },
            ],
          },
          {
            title: "スキルが教えること",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "いつ注釈するか",
                    "コードレビュー、オンボーディング、変更内容の解説で使うこと。",
                  ],
                  [
                    "Work Log タスクをどう扱うか",
                    "journal CLI でタスク一覧取得、作成、claim/done、GitHub Issue 紐づけを行うこと。",
                  ],
                  [
                    "データをどう調査するか",
                    "read-only な query コマンドでスキーマ、SQL、履歴、横断検索を扱うこと。",
                  ],
                  [
                    "データ変更をどう検証するか",
                    "snapshot create/list/diff で before/after を比較すること。",
                  ],
                ],
              },
            ],
          },
          {
            title: "AI 向けリファレンス",
            blocks: [
              {
                kind: "paragraph",
                text: "AI エージェントは、詳細な手順が必要なときに CLI から組み込みガイドを表示できます。",
              },
              {
                kind: "command",
                title: "AI 向けガイドを表示",
                command:
                  "code-viewer annotate agent-help\ncode-viewer journal agent-help\ncode-viewer query agent-help",
              },
            ],
          },
        ],
      },
      mcp: {
        nav: "MCPサーバー",
        title: "MCPサーバー",
        intro:
          "code-viewer を起動している間、同じサーバーがローカルの read-only な MCP エンドポイント (/_mcp) も公開します。AI エージェントは code-viewer の CLI をサブプロセスとして起動する代わりに、status / file / search / datastore の各ツールを JSON-RPC 経由で直接呼び出せます。",
        groups: [
          {
            title: "エンドポイントへの接続",
            blocks: [
              {
                kind: "paragraph",
                text: "エンドポイントは JSON-RPC 2.0 の Streamable HTTP トランスポート (initialize / ping / tools/list / tools/call) で応答します。受け付けるのは application/json ボディの POST リクエストのみで、他のルートと同じ localhost / 同一オリジンチェックで保護されています。",
              },
              {
                kind: "command",
                title:
                  "エンドポイント URL (port は起動時に表示される URL と同じ)",
                command: "http://127.0.0.1:<port>/_mcp",
              },
            ],
          },
          {
            title: "利用できるツール",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "code_viewer_agent_help",
                    "AI 向け CLI サブコマンドの一覧索引。",
                  ],
                  [
                    "code_viewer_status",
                    "ブランチ、remote、変更ファイル、直近のコミット。",
                  ],
                  [
                    "code_viewer_file_show",
                    "任意の ref でファイル(または行範囲)を読む。",
                  ],
                  [
                    "code_viewer_file_blame",
                    "行単位の blame (sha / author / time / summary)。",
                  ],
                  [
                    "code_viewer_file_history",
                    "1ファイルのコミット履歴(リネーム追跡あり)。",
                  ],
                  [
                    "code_viewer_file_diff",
                    "1ファイルの unified diff(既定はプレビュー上限あり)。",
                  ],
                  [
                    "code_viewer_search_files",
                    "ファジー / glob マッチでリポジトリのパスを順位付け。",
                  ],
                  [
                    "code_viewer_search_code",
                    "リポジトリを grep する (rg / git grep / フォールバック)。",
                  ],
                  [
                    "code_viewer_datastore_sources",
                    "read-only なデータストアの source id を発見。",
                  ],
                  [
                    "code_viewer_datastore_schemas",
                    "SQL データストア1件のスキーマ一覧。",
                  ],
                  [
                    "code_viewer_datastore_schema",
                    "テーブル、インデックス、外部キー、カラムを調査。",
                  ],
                  [
                    "code_viewer_datastore_columns",
                    "SQL テーブル1件のカラムを調査。",
                  ],
                  ["code_viewer_datastore_ddl", "CREATE 文とトリガーを調査。"],
                  [
                    "code_viewer_datastore_query",
                    "read-only な SELECT / PRAGMA / EXPLAIN / WITH を実行。",
                  ],
                  [
                    "code_viewer_datastore_history",
                    "保存済みのクエリ履歴を調査。",
                  ],
                ],
              },
            ],
          },
        ],
      },
      keybindings: {
        nav: "キーバインド",
        title: "キーバインド",
        intro:
          "キーボードだけでパネル移動、ファイル選択、スクロールを行うためのショートカットです。",
        groups: [
          {
            title: "行選択",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "行番号でドラッグ",
                    "範囲をハイライトし、フロートする Copy ピルが @path#1-9 を用意",
                  ],
                  [
                    "ピルをクリック",
                    "@path#1-9 をコピー（AI エージェントへの貼り付け用）",
                  ],
                  [
                    "Shift+ピルをクリック",
                    "@path#1-9 と選択行の実コード（フェンス付き）をまとめてコピー — AI へ直接貼れて、ファイル再取得不要",
                  ],
                  [
                    "x ボタン / Escape",
                    "選択範囲を解除し、フロートする Copy ピルを閉じる",
                  ],
                ],
              },
            ],
          },
        ],
      },
    },
  },
};

export function helpLanguageFromRoute(route: AppRoute): HelpLanguage {
  return route.screen === "help" &&
    HELP_LANGUAGES.includes(route.lang as HelpLanguage)
    ? (route.lang as HelpLanguage)
    : "en";
}

// ai-dup-check: allow -- fp: helpLanguageFromRoute と同型の
// 「route から allowlist 照合してフォールバック値を返す」pre-existing
// パターン。対象フィールド (lang vs section) が異なるため共通化しない。
export function helpSectionFromRoute(route: AppRoute): HelpSection {
  return route.screen === "help" &&
    HELP_SECTIONS.includes(route.section as HelpSection)
    ? (route.section as HelpSection)
    : "overview";
}

export type OpenHelpKeybindingsDeps = Pick<
  HelpPageDeps,
  | "getRoute"
  | "getLanguage"
  | "currentRange"
  | "setRoute"
  | "setPageMode"
  | "cancelActiveSourceLoad"
> & {
  renderHelpPage(): void;
  setStatus(status: "live" | "refreshing" | "error" | null): void;
};

export function openHelpKeybindings(deps: OpenHelpKeybindingsDeps): void {
  const route = deps.getRoute();
  deps.cancelActiveSourceLoad("navigation");
  deps.setRoute({
    screen: "help",
    lang:
      route.screen === "help"
        ? helpLanguageFromRoute(route)
        : deps.getLanguage(),
    section: "keybindings",
    range: deps.currentRange(),
  });
  deps.setPageMode();
  deps.renderHelpPage();
  deps.setStatus("live");
}

function renderHelpCommand(block: Extract<HelpBlock, { kind: "command" }>) {
  const wrap = document.createElement("div");
  wrap.className = "gdp-help-command";
  const title = document.createElement("div");
  title.className = "gdp-help-command-title";
  title.textContent = block.title;
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = block.command;
  pre.appendChild(code);
  wrap.append(title, pre);
  return wrap;
}

export function renderHelpTable(rows: Array<[string, string]>) {
  const table = document.createElement("table");
  rows.forEach(([keys, description]) => {
    const tr = document.createElement("tr");
    const keyCell = document.createElement("th");
    keyCell.scope = "row";
    keys.split(" / ").forEach((key, index) => {
      if (index > 0) keyCell.append(" / ");
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      keyCell.appendChild(kbd);
    });
    const desc = document.createElement("td");
    desc.textContent = description;
    tr.append(keyCell, desc);
    table.appendChild(tr);
  });
  return table;
}

function renderHelpBlock(block: HelpBlock): HTMLElement {
  if (block.kind === "paragraph") {
    const p = document.createElement("p");
    p.textContent = block.text;
    return p;
  }
  if (block.kind === "steps") {
    const ol = document.createElement("ol");
    ol.className = "gdp-help-steps";
    block.items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      ol.appendChild(li);
    });
    return ol;
  }
  if (block.kind === "command") return renderHelpCommand(block);
  return renderHelpTable(block.rows);
}

export function createHelpPage(deps: HelpPageDeps) {
  function renderHelpPage() {
    deps.cancelActiveSourceLoad("navigation");
    deps.removeStandaloneSource();
    deps.clearLoadQueue();
    const target = deps.$("#diff");
    const empty = deps.$("#empty");
    empty.classList.add("hidden");
    deps.$("#meta").textContent = "";
    deps.$("#totals").textContent = "";
    deps.$("#filelist").textContent = "";

    const lang =
      deps.getRoute().screen === "help" &&
      new URLSearchParams(window.location.search).has("lang")
        ? helpLanguageFromRoute(deps.getRoute())
        : deps.getLanguage();
    const section = helpSectionFromRoute(deps.getRoute());
    const content = HELP_CONTENT[lang];
    const sectionContent = content.sections[section];
    const sectionGroups =
      section === "keybindings"
        ? [
            ...buildHelpKeybindingGroups(lang).map((group) => ({
              title: group.title,
              blocks: [{ kind: "table" as const, rows: group.rows }],
            })),
            ...sectionContent.groups,
          ]
        : sectionContent.groups;

    const shell = document.createElement("section");
    shell.className = "gdp-help-shell";
    const header = document.createElement("header");
    header.className = "gdp-help-header";
    const title = document.createElement("h1");
    title.textContent = content.title;
    const langSelect = document.createElement("select");
    langSelect.className = "gdp-help-language";
    langSelect.setAttribute("aria-label", content.languageLabel);
    HELP_LANGUAGES.forEach((optionLang) => {
      const option = document.createElement("option");
      option.value = optionLang;
      option.textContent = optionLang.toUpperCase();
      option.selected = optionLang === lang;
      langSelect.appendChild(option);
    });
    langSelect.addEventListener("change", () => {
      const nextLang = langSelect.value as HelpLanguage;
      deps.setLanguage(nextLang);
    });
    header.append(title, langSelect);

    const layout = document.createElement("div");
    layout.className = "gdp-help-layout";
    const helpNav = document.createElement("nav");
    helpNav.className = "gdp-help-nav";
    HELP_SECTIONS.forEach((helpSection) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = helpSection === section ? "active" : "";
      button.textContent = content.sections[helpSection].nav;
      button.addEventListener("click", () => {
        deps.setRoute({
          screen: "help",
          lang,
          section: helpSection,
          range: deps.currentRange(),
        });
        renderHelpPage();
        deps.syncHeaderMenu();
      });
      helpNav.appendChild(button);
    });

    const article = document.createElement("article");
    article.className = "gdp-help-content";
    const h2 = document.createElement("h2");
    h2.textContent = sectionContent.title;
    const intro = document.createElement("p");
    intro.textContent = sectionContent.intro;
    article.append(h2, intro);
    sectionGroups.forEach((group) => {
      const groupSection = document.createElement("section");
      groupSection.className = "gdp-help-group";
      const groupTitle = document.createElement("h3");
      groupTitle.textContent = group.title;
      groupSection.append(groupTitle);
      group.blocks.forEach((block) => {
        groupSection.appendChild(renderHelpBlock(block));
      });
      article.appendChild(groupSection);
    });

    layout.append(helpNav, article);
    shell.append(header, layout);
    target.replaceChildren(shell);
  }

  return { renderHelpPage };
}
