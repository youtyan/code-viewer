# code-viewer

Local browser-based code and git diff viewer.

Requires Node.js 20 or newer. Development uses
[pnpm](https://pnpm.io/) (the version is pinned in `packageManager`).

## Features

- Browse repository files and folders in a persistent sidebar with live
  worktree change updates over SSE. The sidebar filter takes plain text
  (substring), `/pattern/` (regex), `~text` (fuzzy, same matcher as the file
  palette) and globs such as `*.ts` or `src/**`, and shows
  `matching / all` file counts in the header while it is active.
- View git diffs with unified or split layout, lazy loading, viewed-file
  state, ignore-whitespace and hide-tests toggles, and dismissible per-line
  "reference pills" that copy `@path#start-end` for AI agents.
- Browse commit history per branch and open any commit's changed files and
  diff, with shareable `/history?ref=<branch>&commit=<sha>` links. The
  filter understands message words (`"quoted"` keeps spaces), sha prefixes,
  `author:<name>`, `path:<part>`, `since:`/`after:`/`until:`/`before:<date>`,
  `code:<text>` (lines added or removed, `git log -S`) and `merges:no` /
  `merges:only`; kinds combine with AND, `author:` offers the repository's
  authors as suggestions, and the text rides in the URL (`?q=`). Rows carry
  branch / tag labels and a merge marker. The selected commit has a copy-sha
  button and an "Open on GitHub" link; Shift+click a second commit to diff the
  whole range between them (`?compare=<sha>`), and a merge commit lets you
  pick the parent to compare against. `↑` / `↓` step commits anywhere on the
  screen, `j` / `k` do when the commit list has focus, `g h` opens the
  history of the ref you are viewing, and every folder page has a History
  button that opens the log restricted to that folder
  (`/history?path=<dir>/`). Select lines in a file and the line-reference
  pill offers **Line history**: the History tab restricted to commits that
  changed those lines (`git log -L`, `?lines=<start>-<end>`). File pages
  carry older / newer revision buttons that step through the commits that
  touched that file, and the ref picker remembers the refs you picked last
  as quick chips.
- Open per-file Blame and History tabs on a file detail page (GitHub-style):
  Blame groups consecutive lines from the same commit with an Older→Newer
  colour bar and lets you jump to the originating commit; History embeds the
  same commit list and diff renderer used by `/history` inside the file's
  tab shell, filtered to that path. Both tabs keep the Repository sidebar
  visible.
- Browse every worktree of the repository from the `Worktrees` item in the
  header menu, in the same three-pane shape as History: worktrees on the left,
  the picked one's changed files in the middle, the diff on the right. Each row
  shows how far its branch has drifted from the base branch (ahead / behind) and
  whether it still merges cleanly — checked with `git merge-tree`, so no working
  tree is touched — or which files would conflict. Files are split into
  uncommitted work and commits made since the branch point, and a banner lists
  every file that more than one worktree is changing, which is the conflict you
  would otherwise only find at merge time. Each row carries the folder it lives
  in, when its files were last touched, and a "…" holding every action for that
  worktree — open the folder, copy its path, view it in a new tab, stop the
  server it started, copy the command that merges it back, or delete it. Create
  a worktree under `.worktrees/` (the dialog shows the exact path before you
  commit to it); deleting one removes its folder from disk and keeps the branch.
- Open files directly from the repository or diff view, including text-like
  config/prompt files and large generated files (virtualized source viewer
  with copy/open-full-view).
- Preview Markdown with a table of contents, task lists, Mermaid diagrams
  (click to enlarge), and Shiki code highlighting.
- Preview browser-safe media and show metadata for binary files that cannot
  be rendered.
- Find files and grep across the repository with `Ctrl+K` (file palette) and
  `Ctrl+G` (text palette), or from the search button at the left of the
  header icons (plain click: files, Shift+click: grep). The two palettes
  share one window: `Ctrl+K` /
  `Ctrl+G` (or the Files / Grep buttons in its label row) switch modes while
  keeping what you typed, and reopening a palette restores its last query,
  selected so typing replaces it. With an empty query the file palette lists
  the files you opened most recently, and its result count says when the
  ranking was cut at 50 (`50 of 1,234 results`). The text palette has
  match-case (`Alt+C`) and whole-word (`Alt+W`) toggles next to the regex
  one, and `path:<dir or glob>` tokens in the query narrow the search
  (`path:src/ path:*.md needle`); matching is case-insensitive on every
  engine unless you turn match-case on. Opening a hit marks the matched
  text on the target line (`?hl=`), and in large virtualized files it
  pre-fills the in-file find bar with it. **Pin** (or `Ctrl+Enter`) moves
  the query into the bottom panel's **Search** tab, where the grouped
  result list stays open while you browse files; the query rides in the
  URL (`?results=<query>`) so a reload re-runs it, and the Search tab can
  also be opened directly from the panel's tab row.
- Jump from a function, class, or variable in source and diff code to its
  definition with `Cmd/Ctrl+click` or `g .`; choose from ranked candidates when
  several definitions match — a code preview of the highlighted candidate
  appears beside the menu — with references available as a fallback.
- Switch the viewer UI between English and Japanese from Settings & Help —
  the language toggle live-updates every screen including the datastore
  viewer.
- Browse SQLite, PostgreSQL, MySQL, Cloudflare D1, Redis, Elasticsearch,
  DynamoDB, and S3-compatible object storage (MinIO, LocalStack, Cloudflare R2)
  with a built-in datastore viewer.
  Local Supabase CLI (`supabase start`) Postgres projects are auto-discovered
  too, without needing a `docker-compose.yml`.
  Table descriptions appear inside expanded table entries and in the Schema
  tab header when the database provides them.
- Read the built-in Settings & Help page (last item in the header menu) for getting
  started, the `.code-viewer/` project files, AI annotations, datastores,
  the agent skill, and keybindings.
- Scratch on pasted text without leaving the current screen with the Tools
  drawer (the `Tools` item in the header menu, or `?tools=<tool>` on any
  URL): Markdown
  preview (same renderer as file preview, so table of contents, task lists,
  frontmatter, code highlighting and ` ```mermaid ` fences all work),
  Mermaid preview with zoom and drag-pan, and a JSON / YAML tool that
  auto-detects the input and re-emits it as formatted JSON or YAML (also a
  validator and a JSON⇄YAML converter). Each tool keeps its own draft in
  `.code-viewer/tools.json`, and the drawer width is draggable from its left
  edge.
- Run a real shell in the browser with the Terminal panel (the `Terminal` item
  in the header menu, or `?terminal=<shell>` on any URL). It is an ordinary
  login shell on a PTY, rendered with xterm.js, so `tmux` inside it behaves
  exactly as it does in any other terminal — the panel resizes the PTY and
  whatever runs in it follows on its own. The toggle in the panel header turns
  input off when you only want to watch. Typing `exit` closes the shell, just
  like any other terminal.
- The left side of the panel starts with a **Your turn** section for terminals
  that are waiting for input or finished but unread. Below it, the session list
  can be scoped to this repository or all tmux sessions, filtered by state, and
  searched by task, place, or id. Its two-tier tree puts shells opened by this
  panel at the top; a shell running tmux carries a terminal icon and its
  session name, and that session's windows and panes hang underneath it. The
  bottom tier is the tmux sessions no shell has opened yet. Each pane is
  labelled with the title tmux shows for it — a coding agent usually puts what
  it is doing there, so the tree alone tells you which pane is busy.
- Terminal status combines lifecycle reports with priority-based matching of
  the live terminal title and recent visible lines. Matching rules can report
  working, waiting, idle, or keep the previous state. A target is tracked only
  after a lifecycle report or a visible rule identifies it; screen motion is
  then used as a fallback. A working match expires when its title and screen
  stop changing, so a stale status line does not stay active. Edit the complete
  JSON rule set under Settings & Help → Settings. Its regular expressions use a
  bounded safe subset; combine conditions with `all` / `any`. Invalid changes
  list every validation error and do not replace the active rules; restoring
  the built-in set removes the saved override so later releases can supply
  updated defaults. The editor includes an expandable field guide, a valid
  example, and live JSON syntax highlighting.
- Click a pane and the panel takes you to it. If a shell already has that
  session open, it switches to that shell and makes the pane current; otherwise
  a shell is opened and attached for you. A session moves up to the top tier the
  moment a shell opens it and drops back down when that shell closes, so you end
  up with one shell per tmux session rather than one per pane. Powerline
  separators and file icons render when a Nerd Font is installed — the panel
  asks for the common Nerd Font families before falling back to the usual
  monospace stack, so no font ships with the package. The tree needs `tmux` on
  `PATH`; it says so when it is missing, and shells still work without it.
  Opening shells needs the optional `@lydell/node-pty` package.
- One tmux caveat worth knowing: a tmux window can only have one size, so when
  the same session is attached from both this panel and another terminal, they
  share it. With tmux's default `window-size latest` the window snaps to
  whichever terminal you touched last, and the smaller one gets its right and
  bottom edges cut off. `set -g window-size smallest` makes every attached
  terminal show the whole window at the cost of some empty space in the larger
  one.
- Inspect the runtime with the Environment Doctor (right-side sheet,
  toggled by the 🩺 icon in the header): runtime (Node / Bun / ABI),
  `@youtyan/code-viewer` version and execution origin (npx cache vs
  local), SQLite driver and snapshot store, Git, `rg`, GitHub CLI, discovery summary,
  per-source datastore connectivity (each discovered SQLite / docker
  SQL / Supabase CLI / Redis / Elasticsearch / S3 source gets one row
  with a 2s minimal-read probe; failure rows include a paste-safe retry
  hint),
  Docker / Compose health (config dry-parse + `compose ps` per service),
  terminal dependencies (`tmux` and `@lydell/node-pty`), and the listening
  port. Useful when `npx` cache mismatch (e.g.
  `NODE_MODULE_VERSION` errors) needs a remediation hint, or when a
  docker compose datastore is discovered but unreachable.
- Open repository folders (and parent folders of files) in the OS file
  manager, create folders, and trash/restore files from localhost-only
  actions.
- Upload files into worktree folders. Uploads are enabled by default for
  worktree targets; toggle them off from Settings & Help.
- Expose a local, read-only MCP endpoint (`/_mcp`) on the running server so
  AI agents can call status, file, search, and datastore tools directly
  over JSON-RPC instead of spawning CLI subprocesses.

## Usage

From inside a git repository, run it without installing:

```sh
npx @youtyan/code-viewer
```

The server prints a local URL. Add `--open` if you want the browser opened
automatically:

```sh
npx @youtyan/code-viewer --open
```

To inspect another repository, pass `--cwd`:

```sh
npx @youtyan/code-viewer --cwd /path/to/repo
```

The equivalent one-shot command with pnpm also works:

```sh
pnpm dlx @youtyan/code-viewer
```

Or install it globally:

```sh
npm install -g @youtyan/code-viewer
code-viewer
```

The published CLI runs on Node.js 20 or newer.

Common options:

- `--cwd <dir>` — repository to view (default: current working directory).
- `--open` — open the printed URL in the default browser.
- `--port <port>` — bind to a specific port (default: pick a free port).
- `--bin <name>=<absolute-path>` — override an external command path
  (`git`, `rg`, `docker`, `gh`, or `tmux`). The same values can be supplied through
  `CODE_VIEWER_BIN_GIT`, `CODE_VIEWER_BIN_RG`, `CODE_VIEWER_BIN_DOCKER`, and
  `CODE_VIEWER_BIN_GH`, and `CODE_VIEWER_BIN_TMUX`.
- `--scope-omit-dir <name>` — skip a directory under the worktree (repeatable;
  overrides the settings list for this session).
- `--version`, `-v` — print the installed version.
- `--help`, `-h` — print full CLI help.

Arguments after options are passed to `git diff`. By default, code-viewer
compares `HEAD` with the working tree.

```sh
npx @youtyan/code-viewer HEAD~1 HEAD
npx @youtyan/code-viewer --staged
code-viewer HEAD~1 HEAD
code-viewer --cwd /path/to/repo --staged
```

`--bin` is useful when several command installations exist or a login shell
PATH differs from the environment that starts code-viewer. Override paths must
be absolute executable files outside the opened repository.

Open **Settings & Help** from the header menu to change display options such
as theme, layout, sidebar mode, font sizes, and UI language. The language
setting translates the viewer chrome itself, including that page, settings labels,
sidebars, history controls, datastore viewer, and annotation panel labels.

## Repository View

Open the root URL to browse the repository tree. Folder pages keep the sidebar
visible, and file pages show a preview when the browser can safely render the
file. Unsupported binary files show a clear unavailable state with file
metadata instead of dumping bytes as text.

CSV and TSV files open as a table with all-column search, per-column filters, and
three-state column sorting (ascending, descending, then source order). The
visible-row count and reset action stay above the table while original file row
numbers remain attached to their data after filtering or sorting.

Markdown files use a dedicated preview tab. Relative links and images are
resolved inside the repository, code blocks are highlighted with Shiki, and
Mermaid diagrams are rendered lazily in the browser (click any diagram to
open it in a lightbox). Relative links lead to the same destinations as they
do on GitHub: another Markdown file opens its file page, an `#anchor` opens
the preview and scrolls to that heading, a non-Markdown file opens in the
Code view, and a link to a directory opens that folder in the repository
tree.

A file detail page lays out up to four tabs — **Preview**, **Code**,
**Blame**, **History** — modelled after the GitHub file view. For text files
`Code` is the default and `?preview=1` opts in to the Markdown / HTML
preview. Media files (images, video, audio, PDF) show a **Preview** tab only
— there is no Code tab for binary media. `Blame` and `History` each have
their own canonical URL (`view=blame`, `view=history`), so deep links and
the browser back/forward stay in sync. Opening another file from the
repository tree keeps the active tab (a file that cannot be previewed falls
back to Code). The Blame tab reuses the source
view's row component, so line numbers, drag-selection of `line=` ranges,
syntax highlighting and the code font size from Settings & Help all match the
Code tab.

When the repository remote is hosted on GitHub, repository and file headers
include an **Open on GitHub** action. Selecting source lines opens a compact
action bar for copying the AI reference, opening the exact line range on
GitHub, or copying that GitHub URL. Markdown and HTML diff cards also expose a
direct **Preview** shortcut beside the regular file view action.

Very large text files use a virtualized source viewer. Only visible rows are
rendered, and the page includes controls to copy the full file or reopen it in
the full non-virtual view.

The worktree is watched and changes are pushed to every open tab over SSE so
files reload as you edit. The directory watcher is capped at 1024 directories
by default and can be tuned from Settings & Help → **File change watcher**
(range slider + numeric input, 16–65536); when the cap is hit the viewer
shows a banner so reloads are not silently missed.

Large repositories load folder children on demand. The sidebar remembers which
lazy-loaded folders you opened and re-expands them on the next reload, so the
tree state survives navigation and refresh.

Symlinks get a distinct icon and a "→ target" label instead of looking like a
regular file, and clicking one navigates straight to its resolved target.
Broken symlinks are flagged and disabled instead of erroring out. Files with
pending git changes show a status badge in the tree in place of the regular
type icon:

| Badge | Meaning |
|---|---|
| `M` | Modified |
| `A` | Added — staged for commit |
| `D` | Deleted |
| `R` | Renamed |
| `U` | Untracked — in the worktree, not under version control yet |
| `I` | Ignored — excluded by a `.gitignore` rule |

`U` and `A` are deliberately separate: a file you have never run `git add` on
reads differently from one already staged. A directory that is wholly
untracked or ignored is badged as a whole, so it stays recognizable while
collapsed; it keeps its folder icon and carries the badge next to its name.
Inside an untracked directory the badge is inherited by its contents, except
where an ignore rule names a file specifically.

## Uploads and Scope Settings

File uploads are available for the local worktree target by default. Git tree
views remain read-only. Open **Settings & Help** from the header menu to toggle
uploads off, edit the directories to skip while browsing/searching, and hide
files or directory names completely.

Scope settings control directory exclusions shared by the sidebar, Ctrl+K file
palette, Ctrl+G grep palette, the Datastores browser, and the file change
watcher — the same list applies to all five. Both the skip list and the hide
list accept gitignore-style wildcards (`*`, `?`, `[abc]`, `[!abc]`) in
addition to exact names. Everything you change in Viewer
Settings remains a local draft until you select **Save changes**, then it is
saved on the server under `.code-viewer/settings.json` (no
separate project-level config file). `.DS_Store` and a broad set of
build/cache directories (`node_modules`, `dist`, `build`, `.next`, `.turbo`,
`.parcel-cache`, `.vite`, `.angular`, `.dart_tool`, `.venv`, …) are hidden by
default. Pass `--scope-omit-dir <name>` (repeatable) to override the omit
list on the command line for one session. `.devbox` and `.direnv` are always
excluded regardless of saved settings or CLI overrides: they hold thousands
of generated directories (Nix store link trees) that would stall the
worktree watcher.

The viewer keeps its per-project state under `.code-viewer/` at the repository
root:

- `settings.json` — viewer chrome settings, scope overrides, annotation
  panel/follow/TTS state.
- `view-state.json` — last opened file, scroll positions, viewed-file marks.
- `db-ui.json` — per-DB-tab UI state (column widths, related-panel size,
  Rails FK toggle, S3 tooltip).
- `tabs.json` — datastore tab list, order, and drafts.
- `annotations.json` — AI Code Annotations.
- `query-history.json` — datastore query history.
- `db-snapshots.sqlite` — datastore snapshots and diff blobs.
- `datastore-connections.json` — saved non-secret datastore connection settings.

The `.code-viewer` directory is tool-managed. It appears in the repository
tree, and its text files can be inspected in the Code view, but it remains
excluded from repository searches and diffs. Treat the files as diagnostic
state rather than hand-edited configuration. Add `.code-viewer/` to
`.gitignore` if you do not want to share its contents through git.

## Datastore Viewer

code-viewer auto-discovers local datastores in your repository and provides a
browser-based viewer for exploring their contents.

**SQLite** files (`.db`, `.sqlite`, `.sqlite3`, `.s3db`) are detected
automatically by scanning the repository tree. **PostgreSQL**, **MySQL**,
**Redis**, **Elasticsearch**, **DynamoDB on LocalStack**, **MinIO**, and
**LocalStack S3** services are detected from any `docker-compose.yml`,
`docker-compose.yaml`, `compose.yml`, or `compose.yaml` found by the same
recursive scan — both the repository root and subdirectories are considered,
so a single `code-viewer --cwd <root>` brings up every DB defined under that
root. `.git/`, `.code-viewer/`, and `node_modules/` are skipped, and discovery
is capped at a few-level depth and a few dozen services per scan to keep
startup cheap.

Services whose names collide across subdirectories are kept distinct via
`docker:<service>@<relDir>` ids (cwd-direct compose files keep the historical
`docker:<service>` id for backward compatibility).

**Supabase CLI** (`supabase start`) local projects are also auto-discovered,
even though the Supabase CLI does not write a `docker-compose.yml` into the
project directory. Any `supabase/config.toml` found by the same recursive scan
is picked up (`project_id` and `[db] port` are read from it), and the running
Postgres container is resolved directly via `docker ps` (matched by container
name and the `com.supabase.cli.project` label) instead of `docker compose ps`.
Connection defaults to the Supabase CLI's documented local credentials
(`postgres`/`postgres`/`postgres`).

**Redis** support: browse DB 0–15, SCAN keys, and view values per
type (string/hash/list as dedicated panes, set/zset/stream as JSON views).
Edit values, delete keys, and create new keys (string/hash/list/set/zset/stream)
with confirmation dialogs. It also participates in snapshots and diffs.

**Elasticsearch** support: list indices, view mappings, paginate
docs with `search_after`, run lucene `q=` searches, and submit DSL queries to a
small allowlist of `_search` / `_count` / `_msearch` / `_explain` /
`_validate` / `_field_caps` / `_eql`. Edit documents (with optimistic
concurrency via `_seq_no` / `_primary_term`), create new documents, and delete
existing ones. Snapshots and diffs over `_search` iteration are supported.

**DynamoDB** support: detect LocalStack services with DynamoDB enabled, list
tables across paginated responses, and browse a Structure tab (key schema,
global/local secondary indexes, and non-key attribute types inferred from
loaded items) alongside scan or query items, `LastEvaluatedKey` pagination,
and an item detail view with a copyable key. The explorer is read-only.

**Cloudflare D1** support: add a saved connection with a Cloudflare account ID,
database ID, and API token (needs the `D1:Read` permission). The database is
browsed over the D1 REST API (`POST /accounts/{account}/d1/database/{db}/raw`)
and reuses the SQL screens — table list, row grid, query editor, schema, ER
diagram, snapshots and diffs. D1 is SQLite, so the same `sqlite_master` and
`PRAGMA table_info` / `index_list` / `foreign_key_list` introspection is used.
The connection is read-only: the query editor accepts only
`SELECT` / `PRAGMA` / `EXPLAIN` / `WITH`, and the grid's row editing is
unavailable.

**Cloudflare R2**: R2 speaks the S3 API, so it is a saved connection of type
`s3` with the **Cloudflare R2** provider preset. Enter the account ID and an R2
access key pair; the endpoint (`https://<account-id>.r2.cloudflarestorage.com`)
and the required `auto` signing region are filled in for you. Everything in the
object-storage section below applies.

**S3-compatible object storage** (MinIO, LocalStack, Cloudflare R2): browse
buckets as a folder tree, search by prefix or filename, sort scanned objects by
update time, and preview images, video, audio, PDFs, Markdown, HTML, and text
files. Edit text/markdown/JSON object bodies inline, upload new objects to any
prefix, and delete existing objects. Updated-time sorting is scoped to the
objects scanned for the current prefix/search rather than a persistent
whole-bucket index. HTML previews are rendered in a sandboxed `srcdoc` iframe;
relative subresources inside the HTML are not rewritten. **LocalStack** falls
back to `docker exec <container> curl` against the container-local endpoint
when the service does not publish a host port; **MinIO** requires a published
host port (add a `9000:9000` mapping) and will refuse to browse otherwise.

**SQL row editing** (SQLite / PostgreSQL / MySQL): toggle an Edit mode on the
table grid to insert, update, or delete rows inline. Edits queue as pending
changes (shown with a yellow highlight on the affected row/cell) and are
applied as a single transaction on commit. Row updates and deletes require the
table to have a primary key. The whole batch rolls back on the first
constraint violation. Cloudflare D1 is browsed read-only, so Edit mode is not
offered there.

### Browser UI

Open Datastores in the global navigation to access:

- **Saved connections** — use the `+` action beside the datastore selector to
  add PostgreSQL, MySQL, Cloudflare D1, Redis, Elasticsearch, S3-compatible
  (including Cloudflare R2), or DynamoDB endpoints that are not present in the
  repository's local discovery files.
  Required fields are marked in the connection dialog, and **Test connection**
  verifies the current values before saving. Saved connections can be edited
  or deleted from the adjacent actions.
  PostgreSQL, MySQL, and Redis use Node.js drivers installed automatically with
  this package, while Cloudflare D1, Elasticsearch, S3, and DynamoDB use
  built-in HTTP clients. No database CLI or `curl` installation is required for
  saved connections.
  Non-secret settings (host, endpoint, account/database id, region, …) are
  stored in `.code-viewer/datastore-connections.json`. User names, access key
  IDs, passwords, secret keys, session tokens, and API tokens are never written
  to that file and are never returned by list/edit responses.

  Those credentials are kept in the macOS Keychain (one generic-password item
  per connection, service `code-viewer`) and reloaded on demand, so they
  survive a restart without being stored anywhere in the repository. The
  keychain item is written through `security -i`, which reads the command from
  stdin, so the secret never appears in any process's argument list. Deleting a
  connection also deletes its keychain item; if that fails (a locked keychain,
  for example) the connection is still removed and the UI says the credentials
  were left behind, so you can clear them from Keychain Access yourself.

  Credentials are deliberately not encrypted into a file next to the data: a
  file the app can decrypt unattended needs its key on the same disk, which is
  no stronger than plaintext. Key protection is left to the OS.

  On platforms without keychain integration (currently everything except
  macOS), credentials stay in server memory only and must be entered again
  after restarting code-viewer.

- **Multi-DB tabs** — open multiple databases side by side, with their own
  sidebar, panes, and history. `+` adds an empty tab; `×` or middle-click
  closes one (the last tab resets to empty instead of vanishing). Tabs can be
  reordered by drag and drop and persist in `.code-viewer/tabs.json`.
- **PostgreSQL schema selector** — switch between schemas without reopening
  the database.
- **Table browser** — paginated data grid with column sort, text filter, cell
  copy, and CSV/JSON export (capped at 100,000 rows; export respects current
  filter/sort). Reload just the current table from the search bar while
  keeping global search and column filters, with a result chip that calls out
  row-count changes. Double-click a cell to edit inline when Edit mode is on;
  the whole pending edit batch commits atomically.
- **Detail footer and related panel** — click any cell to open a resizable
  detail footer, where JSON values are pretty-printed and syntax-highlighted;
  foreign-key cells open a related panel showing the
  referenced or referencing rows, with multi-step drill-down breadcrumbs.
  Cells that match the focused row are highlighted in both panels. Once the
  grid has focus, arrow keys move the active cell from data cell to data cell
  and the detail footer follows it, `Enter` follows a foreign key (arrow keys
  alone never fire a related-table query), `Escape` closes whichever panel is
  open, and `Tab` / `Shift+Tab` move between the main grid and the related
  grid. The related panel's reference list keeps each entry on one line with
  the full table name and condition in a tooltip, and its width can be dragged
  and is remembered.
- **Footer dock with Query History & Session log** — JetBrains-style bottom
  dock that hosts two tabs: the per-database **Query History** (master/detail
  list of saved queries, SSE-synced across tabs) and a **Session log** that
  records every SQL the server runs in this browser session (read fetches,
  user queries, and write commits) with timing, row counts, and the actual
  executed SQL syntax-highlighted with shiki. Auto-follow keeps the newest
  entry pinned; scroll up to pause.
- **Rails FK inference toggle** — opt-in heuristic that adds virtual foreign
  keys following Rails naming conventions (e.g. `user_id → users.id`) on top
  of the database-declared FKs.
- **Query editor** — execute read-only SQL with syntax highlighting. The
  allowlist depends on the engine (SQLite: `SELECT`, `PRAGMA`, `EXPLAIN`,
  `WITH`; PostgreSQL and MySQL also accept `SHOW` and `DESCRIBE`, and
  PostgreSQL queries run inside `BEGIN TRANSACTION READ ONLY`). Per-DB results
  and history are saved and synced across tabs over SSE; the editor records
  whether each entry came from the browser or the CLI.
- **ER diagram** — auto-generated entity-relationship diagram showing
  foreign-key relationships between tables.
- **Schema view** — table columns (with column comments when the database
  defines them), indexes, foreign keys, triggers, and DDL, with an in-tab
  schema refresh action. Tables themselves surface a comment column on the
  database table list.
- **Global search** — full-text search across all tables and text columns of
  a database.
- **Snapshots and diffs** — take point-in-time snapshots of selected tables
  (or Redis key spaces, or Elasticsearch indices) and compare any two
  snapshots to see inserted, updated, and deleted rows with full before/after
  values.
- **Datastore explorers** — first-class sidebars for Redis (DB / SCAN),
  Elasticsearch (indices / mappings / docs), DynamoDB (tables / scan / query),
  and S3 (folder tree, kind badges) so the same Multi-DB tab UI works for
  non-SQL stores too. Redis, Elasticsearch, and S3 support editing or creation
  through in-line panes and confirmation dialogs; DynamoDB browsing is
  read-only.

### CLI

AI agents can run read-only queries, search across tables, and capture
snapshots / diffs from the command line. Query results are written to the
per-repository history visible in the browser; search results are returned
by the CLI and mirror the browser Search tab; snapshots are stored in the
snapshot store. The same operations are available in the browser's
Datastores tab (Query History, Search, and Snapshot tabs).

```sh
# Discover datastore ids the running server has detected (SQLite files plus
# any PostgreSQL / MySQL / Redis / Elasticsearch / S3 services from a nearby
# docker-compose). Use the printed id as --db on every other command.
code-viewer query sources --json
# Or skip composing the next SQL call yourself: --commands prints
# shell-pasteable schema/exec lines for SQL sources, plus paste-safe
# `list --db ... --json` and `snapshot list --db ... --json` so you can
# step into the existing query history and snapshot store without
# rebuilding those commands. Redis sources get
# `redis databases / redis keys` lines, Elasticsearch sources get
# `elasticsearch indices / elasticsearch docs` lines, and S3 sources get
# `s3 buckets / s3 objects` lines with `--bucket <bucket-name>` as a
# placeholder. Every emitted SQL command line pins --server '<url>' to the
# same server URL this invocation resolved, so pasting them elsewhere
# never silently re-runs auto-discovery. --json and --commands are
# mutually exclusive. Notice/comment metadata is collapsed to one line
# so copied command blocks stay intact.
code-viewer query sources --commands

# Introspect tables and columns without writing dialect-specific SQL.
# `query schema --json` adds paste-safe `columnsCommand` / `ddlCommand` fields
# to every tables[] element (each pins --server and single-quotes the db /
# schema / table) so AI/human can drill into a specific table without
# rebuilding the call.
code-viewer query schemas --db docker:pg-svc --json
code-viewer query schema --db app.db --json
code-viewer query schema --db docker:pg-svc --schema analytics --with-columns --json
code-viewer query columns --db app.db --table users --json
code-viewer query ddl --db app.db --table users

code-viewer query exec --db data.db --sql "SELECT * FROM users LIMIT 10" \
    --title "Sample users" --body "Checking user data shape."
code-viewer query exec --db docker:pg-svc --schema analytics \
    --sql "SELECT * FROM events LIMIT 10"

code-viewer query exec --db app.db --sql "SELECT count(*) FROM orders" \
    --max-rows 1 --no-save

# Show saved query history. `list --json` enriches each entries[] element
# with a paste-safe `replayCommand` — `code-viewer query --server '<url>'
# exec --db '<dbId>' [--schema '<schema>'] --sql '<sql>' [--title '<title>']
# --no-save` — so AI/human can re-run a past query without rebuilding the
# call. server URL / dbId / schema / sql / title are POSIX single-quoted;
# `--no-save` is fixed so replay does not re-pollute history (drop it if you
# do want the replay saved).
code-viewer query list --db app.db --json
code-viewer query clear --db app.db
# PostgreSQL multi-schema query history: keep list/clear scoped to one schema.
code-viewer query list --db docker:pg-svc --schema analytics --json
code-viewer query clear --db docker:pg-svc --schema analytics

# Locate a value across every table (default: text-like columns only).
# Blocks until the scan finishes or --timeout (default 60s) expires.
code-viewer query search --db app.db --term "needle@example.com" --json
code-viewer query search --db app.db --term "needle@example.com" \
    --tables users,orders --max-hits 20 --include-non-text --json

code-viewer query snapshot create --db app.db --tables users,orders \
    --note "Before user registration test"
# The no-wait output also prints a paste-safe "Poll with: ..." line that
# pins --server '<url>' and single-quotes db/schema, so AI/human paste never
# silently falls back to auto-discovery. The same string is available as a
# pollCommand field in --json ack output.
# Block until the snapshot finishes (default --timeout 120s) and emit the
# final meta as JSON — handy when an AI agent needs the snapshot id without
# polling snapshot list separately.
code-viewer query snapshot create --db app.db --tables users,orders \
    --note "Before user registration test" --wait --json
# `snapshot list --json` enriches each snapshots[] element with paste-safe
# `deleteCommand` and `noteCommand` fields. Each pins --server '<url>' and
# single-quotes the snapshot id; `noteCommand` quotes the current note as-is
# so AI/human can paste and edit the value to update.
code-viewer query snapshot list --db app.db --json
# PostgreSQL multi-schema: pin both create and list to the same schema so
# the before/after pair and --wait polling stay scoped to that schema.
code-viewer query snapshot create --db docker:pg-svc --schema analytics \
    --tables events --note "Before backfill" --wait --json
code-viewer query snapshot list --db docker:pg-svc --schema analytics --json
code-viewer query snapshot note --id snap-abc123 --note "Updated context"
code-viewer query snapshot delete --id snap-abc123

# diff tables prints per-table summary lines plus a paste-safe "# diff rows: ..."
# hint per table, and --json adds a diffRowsCommand field to each tables[] element
# so AI/human can copy the exact row-detail command without rebuilding it.
code-viewer query diff tables --before snap-abc123 --after snap-def456 --json
code-viewer query diff rows --before snap-abc123 --after snap-def456 \
    --table users --json
```

`query exec` prints pretty JSON with `dbId`, `columns`, `columnTypes`, `rows`,
`rowCount`, `truncated`, `elapsedMs`, and optional `schema` / `executedSql`.
Check `truncated` before treating the result as complete.

`code-viewer query --help` shows all command syntax. `code-viewer query
agent-help` prints a longer guide for AI agents covering query shape and
conventions. Both `query` and `annotate` accept `--cwd <repo>` and
`--server <url>` for targeting a specific running server.

For discovered Redis sources, `code-viewer query redis` exposes the same
read-only endpoints the browser's Datastores tab uses, so AI agents and
shell scripts can look inside without opening a browser. The CLI calls
the existing `/_db/redis/databases`, `/_db/redis/keys`, and
`/_db/redis/value` routes (writes stay browser-only):

```sh
# List the 16 logical DBs and their key counts.
code-viewer query redis databases --db docker:redis-svc --json

# SCAN-style key paging — re-issue with the returned nextCursor until "0".
code-viewer query redis keys --db docker:redis-svc --db-index 0 \
    --pattern '*' --count 500 --json

# Read a single key's value. Binary content surfaces as binaryBase64.
code-viewer query redis value --db docker:redis-svc --db-index 0 \
    --key sample:key --json
```

Default text output is tab-separated (`index<TAB>keyCount` for
databases, `name<TAB>type` for keys). For `keys` a non-terminal cursor
appears as a trailing `# nextCursor: <cursor>` line so pagination needs
no JSON parsing; 0 keys prints `no redis keys` to stderr and exits 0.
`value`'s default output is the `RedisValue` payload as pretty JSON;
`--json` wraps the same payload in the full `RedisValueResponse`
(dbId / dbIndex / key included).

For discovered Elasticsearch sources, `code-viewer query elasticsearch`
exposes the same read-only endpoints the browser's Datastores tab uses.
The CLI calls the existing `/_db/elasticsearch/indices`, `/mapping`,
`/docs`, and `/doc` routes (writes stay browser-only):

```sh
# List indices: name, doc count, byte size, health.
code-viewer query elasticsearch indices --db docker:es-svc --json

# Inspect a single index's mapping (field types / nested properties).
code-viewer query elasticsearch mapping --db docker:es-svc \
    --index sample-index --json

# Search documents with a Lucene query; --size caps hits, --search-after
# pages by feeding back the previous response's lastSort JSON array.
code-viewer query elasticsearch docs --db docker:es-svc \
    --index sample-index --q 'status:active' --size 10 --json
code-viewer query elasticsearch docs --db docker:es-svc \
    --index sample-index --q 'status:active' --size 10 \
    --search-after '[1700000000000,"abc"]' --json

# Read a single document by id.
code-viewer query elasticsearch doc --db docker:es-svc \
    --index sample-index --id sample-id --json
```

Default text output is tab-separated:
`name<TAB>docCount<TAB>sizeBytes<TAB>health` for `indices`,
`_id<TAB>_score` per hit for `docs` (followed by `# lastSort: <json>` and
`# totalHits: <n> (returned <k>)` trailing lines so paging needs no JSON
parsing). `mapping` and `doc` default to pretty JSON of the inner payload
(`EsMapping` and `_source`). 0 hits on `docs` prints `no elasticsearch
hits` to stderr (exit 0); a missing `doc` id prints
`not found: <index>/<id>` to stderr (exit 0). `--json` always emits the
full server response envelope.

For discovered S3 sources, `code-viewer query s3` exposes the same
read-only endpoints the browser's Datastores tab uses. The CLI calls the
existing `/_db/s3/buckets`, `/objects`, `/folder`, `/head`, and `/text`
routes (writes and raw byte streams stay browser-only):

```sh
# List buckets in the source.
code-viewer query s3 buckets --db docker:s3-svc --json

# List objects in a bucket. --mode prefix walks --prefix; --mode contains
# scans for --q across keys/basenames. Use --token to page.
code-viewer query s3 objects --db docker:s3-svc --bucket sample-bucket \
    --prefix logs/ --limit 50 --json

# Walk one folder level (delimiter "/") — folders and files separately.
code-viewer query s3 folder --db docker:s3-svc --bucket sample-bucket \
    --prefix logs/ --json

# Object metadata only (size / contentType / etag / updatedAt).
code-viewer query s3 head --db docker:s3-svc --bucket sample-bucket \
    --key logs/sample.json --json

# Preview a text-shaped object's body (server caps at 512KiB and sets
# truncated=true when it had to cut). Non-text keys return HTTP 415.
code-viewer query s3 text --db docker:s3-svc --bucket sample-bucket \
    --key logs/sample.json
```

Default text output is tab-separated:
`name<TAB>createdAt-or-"?"` for `buckets`,
`key<TAB>sizeBytes<TAB>updatedAt-or-"?"<TAB>contentType-or-"?"` per object
for `objects` (with `# nextToken: <token>` / `# scanLimitReached: true`
trailing lines when the server returned them), and `DIR<TAB><prefix>` /
`OBJ<TAB><key><TAB><sizeBytes>` rows for `folder`. 0 hits on `objects`
prints `no s3 objects` to stderr (exit 0); an empty `folder` listing
prints `no s3 folder entries` to stderr (exit 0). `head` defaults to
pretty JSON of `S3ObjectHeadResponse`. `text` prints the object body to
stdout and adds `text truncated` to stderr when the server flagged
truncation. `--json` always emits the full server response envelope.

AI agents who don't yet know which subcommand they need can run
`code-viewer agent-help` once. It prints a short index of the eight
AI-facing entry points (`status`, `query`, `annotate`, `journal`, `search`,
`file`, `skill`, `doctor`) with the exact `code-viewer <name>
agent-help` command for each full guide. The index runs without any
preflight, so it works even before SQLite or a running server is set
up.

### Workspace status CLI

`code-viewer status` prints a one-shot snapshot of the current repo so
an AI agent (or you) can orient yourself in a single call: current
branch, remote URL, every file that differs from HEAD (staged +
unstaged + untracked), the staged subset, the most recent commits, and
a paste-safe shortlist of follow-up `code-viewer` commands. It runs
locally over `git` — no running server, no SQLite preflight — so it is
safe to call as the first command after entering any repository.

```sh
# Human-readable summary.
code-viewer status

# Structured payload for agents.
code-viewer status --json

# Override the ref / depth used for "recent commits".
code-viewer status --ref main --limit 20 --json

# Use a specific git binary when PATH resolution is not the one you want.
code-viewer status --bin git=/opt/bin/git --json
```

The `nextCommands` field pins `--server '<url>'` automatically for
server-backed follow-ups when a code-viewer server is registered for
the repo; local follow-ups stay bare. With no server, the snapshot
itself still succeeds.

### Code search CLI

`code-viewer search code` exposes the running server's `/_grep`
endpoint — the same engine that powers the browser's `Ctrl+G` palette —
to the command line for AI agents and shell scripts. The search uses
ripgrep when available and falls back to git grep / fixed-string
scanning, honours the same scope rules as the UI (`.git`,
`.code-viewer`, scope-omit directories filtered out), and can target a
git ref instead of the worktree.

```sh
# default: fixed-string search across the worktree, plain text output.
code-viewer search code --term "TODO"

# JSON output: { ref, engine, truncated, matches[{path,line,column,preview}] }.
# Prefer --json from agents — column / engine / truncated drive follow-up logic.
code-viewer search code --term "TODO" --json

# extended-regex search, restricted to two subtrees, on the `main` ref.
code-viewer search code --term "fn handler" --regex \
    --path src --path tests --ref main --json

# exact case and whole words only; --path also accepts globs.
code-viewer search code --term "Token" --case-sensitive --word \
    --path "src/**/*.ts" --json
```

Default text output is `path:line:column<TAB>preview`, one line per
match. An empty result prints `no matches` to stderr and exits 0.
Parse errors and unreachable servers exit 1. `--max` accepts a positive
integer up to the server's hard cap; `truncated=true` in the JSON
response means more matches exist beyond the cap. Matching is
case-insensitive on every engine unless `--case-sensitive` is given;
`--word` keeps only hits on word boundaries (`rg -w` / `git grep -w`, and
the same rule in the fallback scanner). `--path` takes a file, a
directory, or a glob such as `src/**/*.ts`. Run
`code-viewer search agent-help` for the full AI-agent guide.

`code-viewer search files` is the sister command for **filename**
lookups — the CLI mirror of the browser's `Ctrl+K` palette. It calls
`/_files` for the ref's full tree, then ranks paths with the same
`fuzzy + glob` algorithm the palette uses. `--term` auto-switches
between modes: bare words (e.g. `"auth"`, `"userId"`) use fuzzy
ranking; patterns containing `*` or `?` (e.g. `"src/**/*.test.ts"`) use
glob matching, and the mode used is reported in `--json`. The `.git`,
`.code-viewer`, and scope-omit directories are filtered out just like in
the palette.

```sh
# Fuzzy search across the worktree, top 50 paths printed one per line.
code-viewer search files --term "userId"

# Glob: ranked JSON with score / ranges / mode for AI agents.
code-viewer search files --term "src/**/*.test.ts" --max 200 --json

# Look at a specific ref instead of the worktree.
code-viewer search files --term "config" --ref main --json

# Pin the git binary used for CLI-side repository discovery.
code-viewer search files --term "config" --bin git=/opt/bin/git --json
```

Default text output is one path per line, best first. An empty result
prints `no matching files` to stderr and exits 0. `--json` emits a
ranked payload `{ ref, generation, query, mode, truncated,
candidateTruncated, totalCandidates, totalMatches,
matches[{ path, score, ranges }] }`. `truncated` means the ranked
matches were sliced by `--max`; `candidateTruncated` means the server
file-list cap was reached before ranking. The default `--max` is `50`
(intentionally smaller than `search code` so the result fits an AI
agent's context window); raise it up to the server-side cap when needed.

### File inspect CLI

After `search` locates a path, `code-viewer file` drills into it
from git refs or the worktree. The CLI reuses the same read paths the
browser uses for the Blame, History, and Diff tabs and the source viewer,
so output matches the on-screen views. **No running code-viewer server is
required** — these commands run locally, which makes them safe to use
before the server has started (or from CI).

```sh
# "Who wrote this line?" — porcelain blame for a path, JSON DTO output.
code-viewer file blame --path src/sample.ts --json

# Force a committed-only blame against an explicit ref.
code-viewer file blame --path src/sample.ts --base HEAD --ref main --json

# "What changed on this path recently?" — paginated commit log.
code-viewer file history --path src/sample.ts --limit 10 --json
code-viewer file history --path src/sample.ts --query "author:tester" --json

# Read the file (or a line range) as of a ref. AI-friendly JSON output
# includes totalLines / complete so the caller knows what was sliced.
code-viewer file show --path src/sample.ts --json
code-viewer file show --path src/sample.ts --start 100 --end 150 --json
code-viewer file show --path src/sample.ts --ref main --json

# Unified diff for one path. Defaults to HEAD..worktree and a preview cap
# (hunks/lines); pass --full for the entire diff.
code-viewer file diff --path src/sample.ts --json
code-viewer file diff --path src/sample.ts --from HEAD~1 --to HEAD --full --json
code-viewer file diff --path new_sample.ts --untracked --json

# Pin the git binary used by local file/blame/history/diff reads.
code-viewer file history --path src/sample.ts --bin git=/opt/bin/git --json
```

Default (non-`--json`) output is tab-separated and easy to grep:

- `blame` — `<line><TAB><shortSha or "worktree"><TAB><summary>`. Lines
  with uncommitted edits show `worktree` and `<uncommitted>`.
- `history` — `<shortSha><TAB><whenISO><TAB><author><TAB><subject>`.
  A path with zero commits prints `no history` to stderr and exits 0.
- `show` — the worktree file (or sliced lines) by default. Pass `--ref`
  for a committed snapshot. Empty slices succeed.
- `diff` — the unified diff text. An empty (or worktree == worktree)
  range prints nothing on stdout and exits 0.

Run `code-viewer file agent-help` for the full AI-agent guide
including the JSON contract for each subcommand.

### Doctor CLI

The same diagnostic report behind the Environment Doctor sheet (see
Features above) is available from the terminal without a browser, so AI
agents and CI can introspect the runtime, SQLite driver, Git, search and
terminal dependencies, GitHub CLI, Docker discovery, and snapshot store status
directly.

```sh
# Human-readable status summary.
code-viewer doctor

# Full DoctorReport JSON (matches the /_doctor endpoint).
code-viewer doctor --json
code-viewer doctor --cwd /path/to/repo --port 64160 --json
code-viewer doctor --bin git=/opt/bin/git --bin rg=/opt/bin/rg --bin docker=/opt/bin/docker --bin gh=/opt/bin/gh --bin tmux=/opt/bin/tmux --json
```

The exit code is `1` iff the worst check status is `"error"` (never on
`"warn"`), so it doubles as a CI gate. Run `code-viewer doctor agent-help`
for the full AI-agent guide.

## AI Code Annotations

AI coding agents (Claude Code, Codex, Cursor, Gemini, and similar CLI agents)
can walk you through a codebase inside the viewer. An agent posts explanations
for specific code locations with the `annotate` subcommand, and every open
browser tab jumps to that location live — in the diff view when the file has
changes in the current range, or in the source view otherwise:

```sh
code-viewer annotate start --title "How the SSE update flow works"
code-viewer annotate add --file web-src/server/preview.ts --line 2330-2360 \
  --body "Each browser tab keeps one SSE stream open against this endpoint."
code-viewer annotate add --file web-src/app.ts --line 9650 \
  --from HEAD~1 --to worktree \
  --body "After the fix, reloads preserve the scroll position here."
code-viewer annotate add --after a-previous --file web-src/app.ts --line 9700 \
  --body "This inserted note now appears in the middle of the walkthrough."
code-viewer annotate move a-late --before a-early
code-viewer annotate rename sess-abc --title "Renamed walkthrough"
code-viewer annotate edit a-id --body "Tightened wording."
code-viewer annotate add-db --db app.db --table users --tab schema \
  --body "This table is the identity root for user-facing records."
code-viewer annotate add-db --db app.db --table orders --tab data \
  --grid-search failed --filter status=failed --sort created_at:desc \
  --body "This restores the filtered failure investigation view."
code-viewer annotate add-db --db app.db --tab query \
  --sql "select * from orders where status = 'failed'" --run-query \
  --body "This reopens the exact query result being discussed."
```

The body is Markdown. Long bodies can be passed with `--body-file <path>` or
piped through stdin (works for `add`, `add-db`, and `edit`).
`code-viewer annotate --help` shows all commands: `start`, `add`, `add-db`,
`move`, `edit`, `rename`, `list`, `delete <id>`, and `clear`. `add` and
`add-db` accept `--before <id>`, `--after <id>`, or `--position <n>` when a
note belongs somewhere other than the end, and `--title`, `--session <id>`, or
`--session-title <text>` for session targeting.

`add-db` accepts a wide set of DB-pane flags so the agent can pin the exact
view it is discussing: `--tab <data|schema|query|er|search|snapshot>`,
`--filter key=value` (repeatable), `--sort col:asc|desc`, `--row <n>`,
`--grid-search <text>`, `--sql <text>` or `--sql-file <path>` plus
`--run-query` and `--query-mode <run|explain>`, and `--search-term <text>`
with `--include-non-text` and `--run-search`. For AI agents,
`code-viewer annotate agent-help` prints a skill-style guide.

Annotations are grouped into sessions and persisted in
`.code-viewer/annotations.json` at the repository root, so the walkthrough
survives reloads and server restarts. See **Uploads and Scope Settings**
above for how `.code-viewer/` is treated by the viewer and how to opt out of
sharing it through git.

In the browser, the annotation icon in the header opens the side panel. The
current explanation is rendered at the top of the panel while the code stays
visible next to it, with the annotated lines highlighted. The side panel is
resizable and remembers its width per project. The history below groups
annotations by session, shows when each session and entry was created, and
keeps inline code notes out of the way while the panel is open. Clicking an
entry jumps back to its location, and entries and sessions can be deleted
there too. The "follow" checkbox controls whether the tab jumps automatically
when an agent adds a new annotation. A built-in player can speak the current
annotation aloud with play/pause, previous/next, mute, and rate controls (TTS
state is saved per project).

A copy button on each annotation produces a paste-ready prompt block that
references the annotation by URL for sharing back into the originating agent.
The panel-open state, selected session, and selected annotation are also kept
in the URL, so a reload or shared link restores the same walkthrough context.

The `annotate` subcommand talks to the running server for the repository
(discovered via `~/.cache/code-viewer/servers/`); start one with
`code-viewer` first. Pass `--cwd <repo>` when annotating a repository other
than the current directory, or `--server <url>` to target a specific server.

`add` appends to the most recent session (creating one when none exists);
run `annotate start` again to begin a new session, or pass `--session <id>`
to target a specific one. When `--before` or `--after` is used, the target
session is inferred from that anchor annotation; a conflicting `--session`
is rejected.

The in-app Settings & Help page includes a dedicated annotations guide for AI agents,
covering when to start a session, how to choose focused line ranges, how to
write concise Markdown explanations, and how to install the bundled agent skill.

### Agent Skill

The package bundles four [Agent Skills](https://agentskills.io)
(the SKILL.md open standard) — `code-viewer-annotate`,
`code-viewer-journal`, `code-viewer-query`, and `code-viewer-snapshot` —
that teach AI coding agents when and how to use `annotate`, Work Log task
queues, read-only `query`, and snapshot / diff workflows. A single
`skill install` copies all four into the selected agent directories:

```sh
npx -y @youtyan/code-viewer skill install                       # Claude Code (.claude/skills/)
npx -y @youtyan/code-viewer skill install --agent codex,gemini  # other agents
npx -y @youtyan/code-viewer skill install --agent all           # claude, codex, gemini, cursor, agents (.agents/skills/)
```

`--agent` accepts a comma-separated list of `claude`, `codex`, `gemini`,
`cursor`, `agents` (vendor-neutral `.agents/skills`), or `all`. Pass
`--global` to install into the agent's user-level skill directory
(`~/.claude/skills/`, `~/.codex/skills/`, …) instead of the current project,
and `--cwd <dir>` to target a specific repository. Running the same command
again updates an existing installation in place.

## MCP Server

While `code-viewer` is running, the same server also exposes a local MCP
(Model Context Protocol) endpoint at `/_mcp` — for example
`http://127.0.0.1:<port>/_mcp`, where `<port>` is the port printed at
startup. It speaks JSON-RPC 2.0 over the Streamable HTTP transport
(`initialize`, `ping`, `tools/list`, `tools/call`; POST only,
`application/json`) and is guarded by the same localhost/same-origin check
as every other route, so MCP clients can call it directly instead of
spawning `code-viewer` CLI subprocesses.

All tools are read-only:

| Tool | What it does |
| --- | --- |
| `code_viewer_agent_help` | Index of every AI-facing CLI subcommand. |
| `code_viewer_status` | Branch, remote, changed files, and recent commits. |
| `code_viewer_file_show` | Read a file (optionally a line range) at any ref. |
| `code_viewer_file_blame` | Per-line blame (sha / author / time / summary). |
| `code_viewer_file_history` | Commit history for one path (follows renames). |
| `code_viewer_file_diff` | Unified diff for one path (preview-capped by default). |
| `code_viewer_search_files` | Rank repository paths by fuzzy or glob match. |
| `code_viewer_search_code` | Grep the repository (`rg` / `git grep` / fallback). |
| `code_viewer_datastore_sources` | Discover read-only datastore source ids. |
| `code_viewer_datastore_schemas` | List schemas for one SQL datastore. |
| `code_viewer_datastore_schema` | Inspect tables, indexes, FKs, and columns. |
| `code_viewer_datastore_columns` | Inspect columns for one SQL table. |
| `code_viewer_datastore_ddl` | Inspect the `CREATE` statement and triggers. |
| `code_viewer_datastore_query` | Run a read-only `SELECT` / `PRAGMA` / `EXPLAIN` / `WITH`. |
| `code_viewer_datastore_history` | Inspect saved query history. |

Point any MCP-compatible client (Claude Code, Codex, etc.) at the endpoint
URL above as a Streamable HTTP MCP server; no separate install step or
extra process is needed beyond `code-viewer` already running.

## Development

```sh
pnpm install
pnpm run verify
pnpm run preview --cwd /path/to/repo
```

`pnpm run preview` (and the alias `pnpm run dev`) is the development runner. It
rebuilds the browser bundle when browser source files change, restarts the
preview server when `web-src/server/*.ts` changes, and keeps the URL stable on
`http://127.0.0.1:64160/` unless you pass `--port <port>`. Use
`pnpm run preview:raw` to launch `preview.ts` directly without the dev watcher.

TypeScript runs through [tsx](https://tsx.is/), bundles are built with
[esbuild](https://esbuild.github.io/), and tests run on
[Vitest](https://vitest.dev/).

Before releasing:

```sh
pnpm run verify
npm pack --dry-run
```

## License

MIT. Third-party licenses for bundled browser assets are included under
`web/vendor/*`.
