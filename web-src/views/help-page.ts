// Help page (keybindings reference), extracted from app.ts.

import type { KeyBinding } from "../core/keymap";
import type { AppRoute } from "../core/routes";
import {
  buildHelpKeybindingGroups,
  type HelpKeybindingTableGroup,
} from "./help-keybindings";

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
  /** 設定セクションの中身。フォームの実体は views/viewer-settings.ts が持つ */
  mountViewerSettings(host: HTMLElement): void;
  /** ユーザーの差分を反映した、いま実際に効くバインド一覧 */
  getKeyBindings(): KeyBinding[];
  /**
   * キーバインド表に変更ボタンとツールバーを足す。実体は
   * views/help-keybinding-editor.ts が持つ。
   */
  decorateKeybindings(
    article: HTMLElement,
    groups: HelpKeybindingTableGroup[],
  ): void;
};

export type HelpLanguage = "en" | "ja";

export type HelpSection =
  | "settings"
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
  "settings",
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
    title: "Settings & Help",
    sections: {
      settings: {
        nav: "Settings",
        title: "Settings",
        intro:
          "Viewer preferences for this project and this browser. Edits remain a draft until you select Save changes.",
        groups: [],
      },
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
                text: "Filter this folder narrows filenames and shows matching / total counts. Down focuses a result, Enter opens the first result, and Escape clears the filter. Code provides a visible Go to line control and total line count. Folder listings show Last committed separately from Local modified, with independent date sorting. Commit dates use HEAD for the worktree or the selected revision and include changes inside folders. Uncommitted edits do not change them; paths without history are labeled explicitly. Local modified is filesystem metadata and can change during checkout, copying, or extraction.",
              },
              {
                kind: "paragraph",
                text: "Use the sidebar or file palette to open source files, Markdown previews, images, PDFs, and other browser-safe media. Large text files automatically switch to virtual mode. Sidebar rows are links: Cmd/Ctrl+click or middle-click opens a file in a new tab. View File on a diff card shows the full source in place and keeps the file list (and, on the History screen, the commit list) on screen; View Diff returns to the diff.",
              },
              {
                kind: "paragraph",
                text: "A file detail page exposes up to four tabs — Preview, Code, Blame, History. For text files Code is the default and ?preview=1 opts in to the Markdown / HTML preview; media files (images, video, audio, PDF) show a Preview tab only, with no Code tab. Blame and History have their own canonical URLs (view=blame, view=history) so deep links and the browser back/forward stay in sync, and they keep the Repository sidebar visible. Opening another file from the repository tree keeps the active tab (a file that cannot be previewed falls back to Code).",
              },
              {
                kind: "paragraph",
                text: "CSV and TSV previews provide all-column search, per-column filters, three-state column sorting (ascending, descending, then source order), a visible-row count, and a reset action. Filtering and sorting keep each row's original file row number.",
              },
              {
                kind: "paragraph",
                text: "Relative links inside a Markdown preview lead to the same destinations as they do on GitHub: another Markdown file opens its file page, an #anchor opens the preview and scrolls to that heading, a non-Markdown file opens in the Code view, and a link to a directory opens that folder in the repository tree.",
              },
              {
                kind: "paragraph",
                text: "When the repository remote is on GitHub, repository and file headers can open the current path there. Selecting source lines also exposes separate actions to copy the AI reference, open the exact GitHub line range, or copy its URL. Markdown and HTML diff cards include a direct Preview shortcut.",
              },
              {
                kind: "paragraph",
                text: "In large repositories the sidebar loads folder children on demand. Folders you open are remembered and automatically re-expanded after a reload.",
              },
              {
                kind: "paragraph",
                text: 'Symlinks show a distinct icon and a "→ target" label so they are never mistaken for a regular file or folder, and clicking one navigates to its resolved target. A broken symlink is visually flagged and disabled.',
              },
              {
                kind: "paragraph",
                text: "Files with pending git changes show a status badge in the tree instead of the regular type icon: M (modified), A (added — staged for commit), D (deleted), R (renamed), U (untracked — in the worktree but not under version control yet), and I (ignored by a .gitignore rule). U and A stay separate so a file you have never run git add on does not look like one that is already staged. A wholly untracked or ignored directory is badged as a whole and keeps its folder icon, so it stays recognizable while collapsed; its contents inherit the badge unless an ignore rule names a file specifically.",
              },
            ],
          },
          {
            title: "Search and history",
            blocks: [
              {
                kind: "paragraph",
                text: "Ctrl+K opens the file palette and Ctrl+G the text palette; the search button at the left of the header icons does the same (Shift+click for text). The two share one window: switching keeps what you typed, and reopening restores the last query, selected so typing replaces it. With an empty query the file palette lists the files you opened most recently, and the result line says when the ranking was cut at 50. The text palette has regex (Alt+R), match-case (Alt+C) and whole-word (Alt+W) toggles, and path:<dir or glob> tokens in the query narrow the search; matching is case-insensitive on every engine unless match-case is on. Opening a hit marks the matched text on the target line, and in a large virtualized file it pre-fills the in-file find bar. Pin (or Ctrl+Enter) moves the query into the bottom panel's Search tab, where the grouped result list stays open while you browse files; the query is part of the URL (?results=) so a reload re-runs it.",
              },
              {
                kind: "paragraph",
                text: "Cmd/Ctrl+click a function, class, or variable in source or diff code to jump to its definition; with a caret or selected symbol, g . performs the same lookup. When several definitions match, choose one from the candidate menu; a code preview of the highlighted candidate appears beside the menu. If no definition matches, the menu falls back to references and can open the symbol name in the search panel.",
              },
              {
                kind: "paragraph",
                text: "The sidebar filter takes plain text (anywhere in the path), /pattern/ for a regex, ~text for a fuzzy match and *.ts or src/** for a glob, and shows matching / all file counts while active.",
              },
              {
                kind: "paragraph",
                text: 'The History screen filter understands words (message text, "quoted" keeps spaces), sha prefixes, author:<name>, path:<part>, since:/after:<date>, until:/before:<date>, code:<text> (lines added or removed) and merges:no / merges:only; different kinds combine with AND, author: offers the repository\'s authors as suggestions, and the filter is part of the URL (?q=) so a reload or shared link keeps it. Rows show branch and tag labels and a merge marker. The selected commit can be copied (sha) or opened on GitHub, Shift+click a second commit to diff the whole range between them, and a merge commit lets you pick which parent to compare against. ↑ / ↓ step commits anywhere on the screen, j / k do when the commit list has focus, and g h opens the history of the ref you are looking at. A folder page has a History button that opens the log restricted to that folder; selected source lines offer a Line history action (git log -L) in the line-reference pill, file pages have older / newer revision buttons that step through the commits that touched that file, and the ref picker keeps the refs you picked last as quick chips. A file opened with View File rides in the URL too (&source=<path>).',
              },
            ],
          },
          {
            title: "Scratch on pasted text",
            blocks: [
              {
                kind: "paragraph",
                text: "The Tools item in the header menu opens a drawer for text you paste, without leaving the screen you are on. It holds a Markdown preview (the same renderer as the file preview, so the table of contents, task lists, frontmatter, code highlighting and ```mermaid fences all work), a Mermaid preview with zoom and drag-pan, and a JSON / YAML tool that reads either format and re-emits it as formatted JSON or YAML — a validator and a converter in one.",
              },
              {
                kind: "paragraph",
                text: "Each tool keeps its own draft in .code-viewer/tools.json, so the drawer reopens where you left it. The open tool is part of the URL (?tools=markdown), which makes it shareable and survives a reload, and the drawer width is draggable from the grip on its left edge.",
              },
            ],
          },
          {
            title: "Terminal",
            blocks: [
              {
                kind: "paragraph",
                text: "The Terminal item in the header menu opens a bottom panel with a real shell in it. It is an ordinary login shell running on a PTY and drawn with xterm.js, so anything you would run in a terminal works here — including tmux. Run tmux inside it and it behaves exactly as it does in any other terminal, because the panel only resizes the PTY and whatever runs in it follows on its own.",
              },
              {
                kind: "paragraph",
                text: "Typing goes to that shell, so you can answer a prompt without switching to the terminal. The toggle in the panel header turns input off when you only want to watch. The shell on screen is part of the URL (?terminal=shell-ab12cd), so a reload comes back to it. Shells live as long as the server does; typing exit ends one, and so does the × on its row.",
              },
              {
                kind: "paragraph",
                text: "The left side starts with a Your turn section for terminals that are waiting for input or finished but unread. Below it, you can scope the session list to this repository or all tmux sessions, filter by state, and search by task, place, or id. Its two-tier tree puts shells opened by this panel at the top: a shell running tmux carries a terminal icon and its session name, and that session's windows and panes hang underneath it. The bottom tier is the tmux sessions no shell has opened yet. Each pane is labelled with the title tmux shows for it — a coding agent running in a pane usually puts what it is doing there, so the tree alone tells you which pane is busy.",
              },
              {
                kind: "paragraph",
                text: "Status first uses lifecycle reports when they are available. Otherwise it evaluates every enabled screen rule against the live terminal title and recent visible lines, then uses the highest-priority match. A terminal is tracked only after a report or a visible rule identifies it; screen motion then provides the working/idle fallback. Working matches expire when the title and screen stop changing, so stale status text does not stay active. Settings & Help → Settings contains the full JSON rule set, including regions, priorities, contains checks, regular expressions, and nested all/any/not conditions. Regular expressions use a bounded safe subset: groups, alternation, and backreferences are rejected, and AND/OR belongs in all/any. Saving validates the whole set and shows every error without replacing the active rules. Restoring the built-in rules removes the saved override so updated defaults can arrive with later releases.",
              },
              {
                kind: "paragraph",
                text: "Click a pane and the panel takes you to it. If a shell already has that session open, it switches to that shell and makes the pane current; otherwise a shell is opened and attached for you. A session moves up to the top tier the moment a shell opens it and drops back down when that shell closes, so you end up with one shell per tmux session rather than one per pane. Powerline separators and file icons render when a Nerd Font is installed on the machine running the browser; no font ships with the package. The tree needs tmux on PATH — without it the panel says so, and shells still work. Opening shells needs the optional @lydell/node-pty package.",
              },
              {
                kind: "paragraph",
                text: "One tmux caveat worth knowing: a tmux window can only have one size, so when the same session is attached from both this panel and another terminal, they share it. With tmux's default window-size latest the window snaps to whichever terminal you touched last, and the smaller one gets its right and bottom edges cut off. Setting window-size smallest makes every attached terminal show the whole window, at the cost of some empty space in the larger one.",
              },
            ],
          },
          {
            title: "Worktrees",
            blocks: [
              {
                kind: "paragraph",
                text: "The Worktrees item in the header menu lists every worktree of this repository — the main one and every linked worktree — in the same three-pane shape as History: pick a worktree on the left, its changed files in the middle, the diff on the right. Running one coding agent per worktree makes that spread invisible from inside a single checkout, and this screen is where it becomes visible again. The selection lives in the URL (?wt=…&file=…), so a reload comes back to the same diff.",
              },
              {
                kind: "paragraph",
                text: 'Every row in the left pane answers two things. How far the branch has drifted from the base branch (how many commits ahead and behind), and whether it still merges: code-viewer runs git merge-tree without touching any working tree, so a row says either that it merges cleanly, or how many files would conflict, or that the check could not run — the last one is kept separate from the first, because "not checked" is not "safe". For a branch ahead of its base, the middle pane lists those commits above the changed files, with their subjects, authors, and timestamps. It then splits that worktree\'s files into work that is not committed yet and commits made since the branch point, with added and deleted line counts; the diff itself is rendered by the same viewer the Diff screen uses, from git run inside that worktree. Changed images, video, and audio show the same before / after preview card as the Diff screen; the bytes are read from that worktree, so a file that exists only there still renders.',
              },
              {
                kind: "paragraph",
                text: "The banner above the cards is the one to read first. It names every file that more than one worktree is currently changing, and the same files are marked inside each card. Two agents editing the same file is invisible until one of them merges; this is where it shows up before that happens. The base branch is whatever origin/HEAD points at, falling back to main and then master; each row names the one it used.",
              },
              {
                kind: "paragraph",
                text: "Create makes a worktree under .worktrees/ in the repository root. You give it a folder name and the dialog shows the exact path it will create as you type; the branch defaults to that same name, so an existing branch is checked out and otherwise a new one starts from where you are. Because that folder sits inside the repository, git reports it as untracked until you add .worktrees/ to .gitignore — the dialog keeps that note behind a ? mark, and code-viewer never edits .gitignore for you. Remove deletes the worktree's folder from disk — the dialog says so, with the full path and a note that it cannot be undone — and keeps the branch and its committed work. With uncommitted changes the dialog also shows a warning and requires a checkbox before it deletes. An entry whose folder is already gone is cleaned from git's bookkeeping instead (git worktree prune), and the dialog says how many such entries will go. Because prune silently skips locked entries and still succeeds, code-viewer checks the entry is actually gone before reporting success and explains why if it is not. The worktree this server is serving cannot be removed from here. Delete sits on its own line, away from the everyday buttons, and stays muted until you reach for it.",
              },
              {
                kind: "paragraph",
                text: 'Every row carries a "…" on the right, and every action for that worktree lives in it — no button appears just because you picked a row, and the row you act on is the row you opened the menu from, whether or not it is the one being shown. "Open in a new tab" starts a second code-viewer for that worktree, because a server stays on the working tree it started in; an already-running server is reused instead of started again. Those servers outlive this one, so "Stop its server" is in the same menu — the Server group in doctor still lists them all, and `kill <pid>` works too, with the pid in ~/.cache/code-viewer/servers/. A worktree that merges cleanly also offers to copy the `git switch` / `git merge` command; code-viewer copies it and never runs it. "Copy its address" is there because a new tab can be stopped by a browser extension before it loads (Chrome reports ERR_BLOCKED_BY_CLIENT) — the address still works in another browser or from a terminal. "Open folder" only appears for worktrees inside the repository, since that is the only place code-viewer will open on your behalf.',
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
                text: "Each row reports OK / WARN / ERROR with a remediation hint when relevant. The check groups are Runtime (Node / Bun / NODE_MODULE_VERSION), Package (version + execution origin including npx cache), SQLite driver, Snapshot store, Git, Search (rg), GitHub CLI, Discovery summary, Docker / Compose (CLI / v2 plugin / daemon / compose config dry-parse / compose ps health per discovered service), Terminal (tmux and @lydell/node-pty), and Server. The most common hint is the npx cache fix for better-sqlite3 NODE_MODULE_VERSION mismatch (rm -rf ~/.npm/_npx then re-run with npx -y @youtyan/code-viewer@latest).",
              },
              {
                kind: "paragraph",
                text: 'From the terminal — and for AI agents or CI — the same report is available without a browser. `code-viewer doctor` prints a status summary; add `--json` for the full DoctorReport (matches the /_doctor endpoint). Use `--bin <name>=/absolute/path` for git, rg, docker, gh, or tmux when PATH does not include the tool directory or resolves the wrong tool. Exit code is 1 when worstStatus is "error", so it doubles as a CI gate.',
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
                  "code-viewer doctor --json\ncode-viewer doctor --cwd /path/to/repo --port 64160 --json\ncode-viewer doctor --bin git=/opt/bin/git --bin rg=/opt/bin/rg --bin docker=/opt/bin/docker --bin gh=/opt/bin/gh --bin tmux=/opt/bin/tmux --json",
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
                    "Settings — diff layout, theme, language, sidebar/history widths, font sizes, syntax highlight, ignore-whitespace, hide-tests, scope overrides (omitted dirs / excluded names), upload toggle, annotation panel open/width/follow/mute/rate, and the last viewed diff range.",
                  ],
                  [
                    "agent-screen-rules.json",
                    "Terminal status screen rules saved from Settings. Removing the override restores the built-in rules.",
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
                    "tools.json",
                    "Tools drawer state — the pasted draft for each tool (Markdown, Mermaid, JSON / YAML), the tool you used last, and the drawer width.",
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
                text: "The directory appears in the repository tree and its text files can be inspected in the Code view. It remains excluded from repository searches and diffs.",
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
                    "Add and edit notes",
                    "Add note captures selected code lines or the current datastore view. Choose a session, write Markdown, preview it, and save with Cmd/Ctrl+Enter. A failed save keeps your input and shows the full error.",
                  ],
                  [
                    "Find and read",
                    "Search titles, full bodies, paths and session names, or filter to this location. Collapse sessions to tidy the library. A note opens in a full-height reader; All notes returns to the same search and scroll position.",
                  ],
                  [
                    "Draft protection",
                    "Background updates and automatic follow cannot replace an open editor. Closing the panel retains your draft in this tab; leaving the editor asks before discarding changes.",
                  ],
                  [
                    "Read below the code",
                    "Inline notes show their target lines, full title and formatted Markdown at a comfortable reading width. Bodies start expanded; the Note button collapses them individually and keeps your choice through panel changes and updates. Read in panel opens the full-height reader.",
                  ],
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
                  [
                    "Restorable URL",
                    "The panel-open state, selected session, and selected annotation are kept in the URL, so reloads and shared links restore the same walkthrough context.",
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
          "Browse SQLite files, Docker-hosted databases, Cloudflare D1, Redis, Elasticsearch, DynamoDB, and S3-compatible object stores (including Cloudflare R2) from one local viewer.",
        groups: [
          {
            title: "Supported datastores",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "Saved connections",
                    "Use + beside the datastore selector to add an arbitrary PostgreSQL, MySQL, Cloudflare D1, Redis, Elasticsearch, S3-compatible (including a Cloudflare R2 preset), or DynamoDB endpoint. Required fields are marked, and Test connection verifies the current values before saving. Drivers are included, so no database CLI or curl is required. Non-secret settings are saved locally; credentials are never written into the repository — on macOS they are kept in the Keychain so they survive a restart, and elsewhere they stay in server memory and must be entered again.",
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
                    "Cloudflare D1",
                    "Added as a saved connection with an account ID, database ID, and API token (needs D1:Read). Browsed over the D1 REST API and reuses the SQL screens — table list, row grid, query editor, schema, ER diagram, snapshots and diffs. Read-only: the query editor accepts SELECT / PRAGMA / EXPLAIN / WITH only, and grid Edit mode is not offered.",
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
                    "S3 / MinIO / LocalStack / Cloudflare R2",
                    "Detected from compose files, or added as a saved connection. R2 uses the Cloudflare R2 provider preset: enter the account ID and an R2 access key pair, and the endpoint and the required auto signing region are filled in. Folder-tree browse, prefix/filename search, updated-time sort, and previews for images, video, audio, PDF, Markdown, HTML, and text. Edit text/markdown/JSON object bodies inline, upload new objects, and delete existing ones. LocalStack falls back to `docker exec curl` when no host port is published; MinIO requires a published host port.",
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
                    "Filter table names and use Up/Down to select, Enter to open, and Left/Right to expand or collapse. Row mode in the detail footer lists every column vertically and follows the active row. NULL, empty strings, false, and zero remain distinct. Click any cell to open a resizable detail footer; JSON values are pretty-printed and syntax-highlighted there. Once the grid has focus, arrow keys move the active cell from data cell to data cell and the footer follows the value under it, scrolling only as far as needed. Row numbers remain visible during horizontal scrolling, and active column filters are highlighted; Enter follows a foreign key (arrow keys alone never fire a related-table query), Escape closes whichever panel is open, and Tab / Shift+Tab move between the main grid and the related grid. Foreign-key cells open a related-rows panel with multi-step drill-down breadcrumbs, supporting both outgoing (FK → PK) and incoming (PK ← FK) navigation. Its reference list keeps each entry on one line with the full table name and condition in a tooltip, and the list width can be dragged and is remembered.",
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
    title: "設定・ヘルプ",
    sections: {
      settings: {
        nav: "設定",
        title: "設定",
        intro:
          "このプロジェクトとこのブラウザのビューア設定です。「変更を保存」を押すまで編集内容は下書きのままです。",
        groups: [],
      },
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
                text: "フォルダ内のファイル名を絞り込み、表示件数を確認できます。検索欄で下矢印を押すと結果に移り、Enterで先頭の結果を開き、Escapeで解除します。Codeタブの「行へ移動」から指定行を開けます。フォルダ一覧には「最終コミット日時」と「ローカル更新日時」を別々に表示し、それぞれの列で並べ替えできます。コミット日時は、作業ツリーではHEAD、過去の版では選択した版が基準です。フォルダは配下の変更を含み、未コミットの編集では日時が変わりません。履歴がないパスは「コミット履歴なし」と表示します。ローカル更新日時はファイルシステム上の値で、チェックアウト・コピー・展開でも変わります。",
              },
              {
                kind: "paragraph",
                text: "サイドバーやファイルパレットから、ソース、Markdown プレビュー、画像、PDF などを開けます。大きいテキストファイルは自動で軽量な仮想表示に切り替わります。サイドバーの行はリンクなので、Cmd/Ctrl+クリックや中クリックで別タブに開けます。diff カードの View File はファイル一覧（履歴画面ではコミット一覧も）を残したままファイル全体を表示し、View Diff で差分に戻ります。",
              },
              {
                kind: "paragraph",
                text: "ファイル詳細ページには最大 4 つのタブ (Preview / Code / Blame / History) があります。テキストファイルは Code がデフォルトで、?preview=1 を付けると Markdown / HTML プレビューに切り替わります。画像・動画・音声・PDF などのメディアファイルは Preview タブのみ表示され、Code タブは表示されません。Blame と History はそれぞれ専用 URL (view=blame, view=history) を持つため、ディープリンクとブラウザの戻る / 進むが同期し、いずれも Repository サイドバーは表示されたままです。ツリーから別のファイルを開いても選択中のタブは維持されます (プレビューできないファイルでは Code に戻ります)。",
              },
              {
                kind: "paragraph",
                text: "CSV・TSVプレビューでは、全列検索、列ごとの絞り込み、昇順・降順・元の順番の3段階ソート、表示件数、リセットを利用できます。絞り込みや並べ替えの後も、各行には元ファイル上の行番号が表示されます。",
              },
              {
                kind: "paragraph",
                text: "Markdown プレビュー内の相対リンクは GitHub と同じ行き先に解決されます。別の Markdown ファイルはそのファイルページを開き、#見出し 付きのリンクはプレビューを開いて該当見出しまでスクロールし、Markdown 以外のファイルは Code ビュー、ディレクトリへのリンクはリポジトリツリーのそのフォルダを開きます。",
              },
              {
                kind: "paragraph",
                text: "リポジトリの remote が GitHub の場合、リポジトリとファイルのヘッダーから現在のパスを GitHub で開けます。ソース行を選択すると、AI 参照のコピー、選択行範囲を GitHub で開く、GitHub URL のコピーを個別に選べます。Markdown / HTML の diff カードには直接 Preview を開く導線も表示されます。",
              },
              {
                kind: "paragraph",
                text: "大きいリポジトリではサイドバーがフォルダの中身を必要に応じて読み込みます。開いたフォルダは記憶され、次回のリロード時に同じ状態で展開し直されます。",
              },
              {
                kind: "paragraph",
                text: "シンボリックリンクは専用アイコンと「→ リンク先」ラベルで表示されるため通常のファイル/フォルダと区別でき、クリックするとリンク先に遷移します。リンク切れのシンボリックリンクは無効化されたことが分かる表示になります。",
              },
              {
                kind: "paragraph",
                text: "git の状態があるファイルは、通常の種類アイコンの代わりにステータスバッジがツリーに表示されます。M(変更)、A(追加 — コミット予定としてステージ済み)、D(削除)、R(リネーム)、U(未追跡 — ワークツリーにあるがまだバージョン管理下にない)、I(.gitignore の対象) の 6 種類です。U と A を分けているのは、git add をまだ一度もしていないファイルが、既にステージ済みのファイルと同じ見た目にならないようにするためです。丸ごと未追跡・無視のディレクトリにはディレクトリ単位でバッジが付き、フォルダアイコンは残るので折りたたんだままでも判別できます。配下のファイルはそのバッジを引き継ぎますが、無視ルールが個別に名指ししているファイルはそちらが優先されます。",
              },
            ],
          },
          {
            title: "検索と履歴",
            blocks: [
              {
                kind: "paragraph",
                text: "Ctrl+K でファイルパレット、Ctrl+G でコード検索パレットが開きます。ヘッダのアイコン列の左端にある検索ボタンでも同じです（Shift+クリックでコード検索）。2 つは 1 つのウィンドウを共有し、切り替えても入力中の検索語は残り、閉じて開き直すと前回の検索語が選択状態で戻ります。ファイルパレットは空のとき最近開いたファイルを並べ、結果が 50 件で切られたときはその旨を表示します。コード検索には正規表現（Alt+R）・大文字小文字の区別（Alt+C）・単語単位（Alt+W）の切り替えがあり、検索語の中の path:<ディレクトリ or glob> で対象を絞れます。大文字小文字は「区別する」を押さない限りどのエンジンでも区別しません。ヒットを開くと該当行の一致箇所が強調され、大きな仮想表示のファイルではファイル内検索バーに検索語が入ります。「固定」（または Ctrl+Enter）を押すと検索語が下パネルの「検索」タブに移り、ファイルを開いて回る間も結果一覧が残ります。検索語は URL（?results=）に載るのでリロードしても同じ検索が走ります。",
              },
              {
                kind: "paragraph",
                text: "ソースまたは diff の関数・クラス・変数を Cmd/Ctrl+クリックすると定義へ移動できます。カーソル位置または選択中のシンボルには g . でも同じ検索を実行します。定義候補が複数ある場合は候補メニューから選択でき、選択中の候補のコードはメニューの隣にプレビュー表示されます。定義が見つからない場合は参照箇所へフォールバックし、そのシンボル名を検索パネルで開けます。",
              },
              {
                kind: "paragraph",
                text: "サイドバーの絞り込みは文字列（パスの部分一致）、/pattern/（正規表現）、~text（あいまい一致）、*.ts や src/**（glob）を受け付け、絞り込み中は「一致 / 全体」の件数を表示します。",
              },
              {
                kind: "paragraph",
                text: '履歴画面の絞り込みは、語（メッセージ本文。"引用" で空白を含む句）、sha の前方一致、author:<名前>、path:<一部>、since:/after:<日付>、until:/before:<日付>、code:<文字列>（追加・削除された行）、merges:no / merges:only を解釈し、種類の違う条件は AND で組み合わさります。author: にはリポジトリの著者名が候補として出て、絞り込みは URL（?q=）に載るのでリロードや共有でも残ります。各行にはブランチ / タグのラベルとマージ印が付きます。選択したコミットは sha をコピーしたり GitHub で開いたりでき、別のコミットを Shift+クリックするとその区間全体の差分、マージコミットでは比較する親を選べます。↑ / ↓ は画面のどこでも、j / k はコミット一覧にフォーカスがあるときにコミットを送り、g h は見ている ref の履歴を開きます。フォルダページの「履歴」ボタンでそのフォルダに絞った履歴が開きます。ソースの行を選択すると行参照ピルに「この行の履歴」（git log -L）が出て、ファイルページには前後のリビジョンへ移るボタン、ref ピッカーには最近使った ref のチップが並びます。View File で開いたファイルも URL（&source=<path>）に載ります。',
              },
            ],
          },
          {
            title: "貼り付けたテキストを扱う",
            blocks: [
              {
                kind: "paragraph",
                text: "ヘッダメニューの Tools は、いま見ている画面を離れずに使える貼り付け用のドロワーを開きます。Markdown プレビュー（ファイルプレビューと同じ描画なので、目次・タスクリスト・frontmatter・コードハイライト・```mermaid フェンスがそのまま効きます）、ズームとドラッグ移動ができる Mermaid プレビュー、JSON と YAML のどちらでも読み取って整形し直す JSON / YAML ツール（検証と相互変換を兼ねます）が入っています。",
              },
              {
                kind: "paragraph",
                text: "各ツールの入力は .code-viewer/tools.json に保存されるので、開き直すと続きから使えます。開いているツールは URL（?tools=markdown）に載るので共有もリロードもでき、ドロワーの幅は左端のグリップをドラッグして変えられます。",
              },
            ],
          },
          {
            title: "ターミナル",
            blocks: [
              {
                kind: "paragraph",
                text: "ヘッダメニューの Terminal は、シェルが動く下パネルを開きます。中身は PTY 上のふつうのログインシェルを xterm.js で描いたものなので、ターミナルでできることはそのままできます。tmux もそのひとつで、この中で tmux を起動すれば、他のターミナルで使うのと同じように動きます。パネルがやるのは PTY のリサイズだけで、中で動いているものはそれに自分で追従します。",
              },
              {
                kind: "paragraph",
                text: "打ったキーはそのシェルに届くので、ターミナルに切り替えずに返事ができます。見るだけにしたいときは、パネル右上のトグルで入力を切ってください。表示中のシェルは URL（?terminal=shell-ab12cd）に載るので、リロードしても同じシェルに戻ります。シェルはサーバが動いている間だけ生き、exit と打てば閉じます（行の × でも同じです）。",
              },
              {
                kind: "paragraph",
                text: "左側の先頭には、入力待ちと、終わったのにまだ見ていないターミナルを集める「あなたの番」があります。その下の一覧は、このリポジトリだけ、またはすべての tmux セッションに範囲を切り替え、状態で絞り込み、作業内容・場所・宛先で検索できます。2 段のツリーの上段はこのパネルが開いたシェルで、中で tmux が動いていれば端末の印とセッション名が付き、そのセッションのウィンドウとペインがその下にぶら下がります。下段は、まだどのシェルも開いていない tmux セッションです。ペインには tmux 側のタイトルが付きます。ペインで動いているコーディングエージェントは作業内容をタイトルに出すので、ツリーを見るだけでどのペインが動いているか分かります。",
              },
              {
                kind: "paragraph",
                text: "状態変更の申告がある場合はそれを先に使います。申告が無い場合は、現在のターミナルタイトルと画面下端の表示に対して全ルールを評価し、優先度が最大の一致から「作業中」「入力待ち」「待機中」「直前の状態を維持」を決めます。申告か見えているルールで対象を識別した後だけ、画面の変化量を作業中・待機中の補助判定に使います。作業中ルールの文字が残っていても、タイトルと画面が変化しなくなれば待機中へ移ります。設定・ヘルプ → 設定では、見る範囲、優先度、contains、正規表現、入れ子の all/any/not を含むJSONルール集を編集できます。正規表現は処理時間を抑えた範囲だけを許可し、グループ・選択・後方参照は使えません。AND/OR は all/any で表します。保存時は全ルールを検証し、エラーはすべて表示して適用中のルールを置き換えません。組み込みルールへ戻すと保存済みの上書きを削除するため、以後の更新で新しい既定ルールを受け取れます。",
              },
              {
                kind: "paragraph",
                text: "ペインを押すと、そこまで連れて行きます。そのセッションを既に開いているシェルがあれば、そのシェルに切り替えてペインをカレントにします。無ければ、こちらでシェルを開いて attach します。シェルで開いた瞬間にセッションは下段から上段へ移り、そのシェルを閉じると下段へ戻ります。つまりペインごとではなく、tmux のセッション 1 つにつきシェル 1 本になります。powerline のセパレータやファイルアイコンは、ブラウザを動かしている環境に Nerd Font が入っていれば表示されます（フォントはパッケージに同梱していません）。ツリーには tmux が PATH にあることが必要で、無い場合はその旨を表示します（シェルはそのまま使えます）。シェルを開くには任意依存の @lydell/node-pty が必要です。",
              },
              {
                kind: "paragraph",
                text: "tmux の性質でひとつ知っておくとよいこと。tmux のウィンドウは寸法を 1 つしか持てないので、同じセッションをこのパネルと別のターミナルの両方から開くと、寸法を共有します。tmux の既定（window-size latest）では最後に操作した側の寸法に合うため、小さいほうの端末では右と下が見切れます。window-size smallest にすると、どの端末でもウィンドウ全体が見えるようになります（大きいほうの端末には余白が出ます）。",
              },
            ],
          },
          {
            title: "作業ツリー",
            blocks: [
              {
                kind: "paragraph",
                text: "ヘッダメニューの「作業ツリー」は、このリポジトリの作業ツリーを本体ぶんも含めて並べます。画面の形は履歴と同じ 3 つの列で、左で作業ツリーを選び、中央にその変更ファイル、右に差分が出ます。コーディングエージェントを作業ツリーごとに走らせると、1 つのチェックアウトの中からは全体が見えなくなります。この画面はそれを見えるようにするためのものです。選んだものは URL に載る (?wt=…&file=…) ので、読み込み直しても同じ差分に戻ります。",
              },
              {
                kind: "paragraph",
                text: "左の 1 行が答えるのは 2 つです。基準ブランチからどれだけ離れているか（進んだぶん・遅れたぶんのコミット数）。そしてまだマージできるか — 作業ツリーを一切触らない git merge-tree で試し、「そのままマージできます」「マージすると何ファイルで衝突するか」「確かめられなかった」を出し分けます。最後のものは 1 番目と混ぜません。「確かめていない」は「安全」ではないからです。基準ブランチより先に進んだブランチでは、中央の列の変更ファイルより上に、コミットの件名・作者・時刻を並べます。その下で、その作業ツリーが触っているファイルを、まだコミットしていないぶんと分岐した後のコミットに分けて、追加・削除の行数つきで出します。差分そのものは Diff ビューアと同じ描画で、その作業ツリーの中で走らせた git の結果です。画像・動画・音声の変更は、Diff ビューアと同じ before / after のプレビューカードで出ます。中身はその作業ツリーから読むので、そこにしかないファイルも見えます。",
              },
              {
                kind: "paragraph",
                text: "カードの上の帯を最初に読んでください。2 本以上の作業ツリーが今まさに触っているファイルを名指しで挙げ、同じファイルは各カードの中にも印が付きます。2 つのエージェントが同じファイルを書いていることは、どちらかをマージするまで表に出ません。ここはそれが起きる前に出る場所です。基準ブランチは origin/HEAD が指す先で、無ければ main、次に master を使います。どれを使ったかは各行に出ます。",
              },
              {
                kind: "paragraph",
                text: "「作る」はリポジトリ直下の .worktrees/ の下に作業ツリーを作ります。入力するのはフォルダ名で、打つそばから作られるパスがダイアログに出ます。ブランチは同じ名前が既定で、既にあるブランチならそれを開き、無ければいまの地点から新しく作ります。この置き場所はリポジトリの中なので、.worktrees/ を .gitignore に入れるまでは git から未追跡として見えます。その案内はダイアログの「?」に入れてあり、code-viewer が .gitignore を書き換えることはしません。「削除」はその作業ツリーのフォルダをディスクから消します。ダイアログにはフルパスと「元に戻せません」が出ます。ブランチとコミット済みの内容は残します。コミットしていない変更があるときは警告が出て、チェックを入れないと削除できません。フォルダが既に無い登録は git の管理情報の掃除 (git worktree prune) になり、同じ状態の登録が他にもあれば件数を出します。prune はロックされた登録を黙って飛ばして成功を返すので、消えたことを確かめてから成功と言います (残っていれば理由つきで断ります)。このサーバが映している作業ツリーはここからは消せません。削除だけは他の操作と段を分けて置いてあり、押すまでは沈んだ字で出ます。",
              },
              {
                kind: "paragraph",
                text: "各行の右端に「…」があり、その作業ツリーへの操作は全部その中にあります。行を選んだからといってボタンが現れることはなく、操作の相手は「…」を開いた行です（いま映している行である必要はありません）。「別タブで見る」はその作業ツリーで code-viewer をもう 1 本起こします。サーバは起動したときの作業ツリーから動けないためです。既に動いているサーバがあれば使い回します。起こしたサーバはこのサーバより長く生きるので、「サーバを止める」を同じメニューに置いてあります。doctor の Server グループには変わらず一覧が出ますし、`kill <pid>` でも止まります（pid は ~/.cache/code-viewer/servers/）。そのままマージできる作業ツリーには、取り込むコマンドのコピーも出ます。コピーするだけで、code-viewer が実行することはありません。「アドレスをコピー」があるのは、開いたタブがブラウザ拡張に止められることがあるためです（Chrome は ERR_BLOCKED_BY_CLIENT と出します）。アドレスさえ手元にあれば、別のブラウザやターミナルから開けます。「フォルダを開く」はリポジトリの中にある作業ツリーにだけ出ます。code-viewer が代わりに開くのはそこまでだからです。",
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
                text: "各項目は OK / WARN / ERROR で表示され、必要に応じて対処手順のヒントが付きます。診断グループは Runtime (Node / Bun / NODE_MODULE_VERSION)、Package (バージョン + 実行元: npx cache / global / local / bunx)、SQLite driver、Snapshot store、Git、Search (rg)、GitHub CLI、Discovery summary、Docker / Compose (CLI / v2 plugin / daemon / compose config dry parse / compose ps による各サービスのヘルス)、Terminal (tmux / @lydell/node-pty)、Server (待ち受けポート) です。よくあるヒントは npx キャッシュ起因の better-sqlite3 NODE_MODULE_VERSION 不一致で、rm -rf ~/.npm/_npx の後に npx -y @youtyan/code-viewer@latest を再実行する手順を表示します。",
              },
              {
                kind: "paragraph",
                text: 'ターミナルからは `code-viewer doctor` で同じレポートを取得できます。AI エージェントや CI からは `--json` で /_doctor と同じ DoctorReport を受け取れます。git / rg / docker / gh / tmux が PATH に含まれない場合や別の実行ファイルを使いたい場合は、`--bin <name>=/absolute/path` を指定できます。worstStatus が "error" なら exit code 1 を返すので CI ガードに直接使えます。',
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
                  "code-viewer doctor --json\ncode-viewer doctor --cwd /path/to/repo --port 64160 --json\ncode-viewer doctor --bin git=/opt/bin/git --bin rg=/opt/bin/rg --bin docker=/opt/bin/docker --bin gh=/opt/bin/gh --bin tmux=/opt/bin/tmux --json",
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
                    "設定 — diff レイアウト、テーマ、言語、サイドバー/履歴幅、フォントサイズ、シンタックスハイライト、whitespace 無視、テスト非表示、scope 上書き（除外ディレクトリ / 除外名）、アップロード許可、注釈パネルの開閉/幅/follow/ミュート/再生速度、最後に表示した diff 範囲を保存します。",
                  ],
                  [
                    "agent-screen-rules.json",
                    "設定画面で保存したターミナル状態の画面判定ルール。上書きを削除すると組み込みルールへ戻ります。",
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
                    "tools.json",
                    "ツールドロワーの状態 — 各ツール（Markdown / Mermaid / JSON・YAML）に貼り付けた下書き、最後に使ったツール、ドロワーの幅。",
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
                text: "ディレクトリはリポジトリツリーに表示され、テキストファイルは Code ビューで確認できます。リポジトリ検索と diff の対象からは引き続き除外されます。",
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
                    "注釈の追加・編集",
                    "「注釈を追加」で選択中のコード行、または現在のデータ画面を保存できます。セッションを選び、Markdownを編集・プレビュー。⌘ / Ctrl + Enter で保存でき、保存失敗時も入力とエラーの詳細が残ります。",
                  ],
                  [
                    "探して読む",
                    "タイトル・本文全文・パス・セッション名を検索し、「この場所」で表示中の対象に絞れます。セッションは折りたたみ可能。詳細はパネル全体で読み、「一覧へ」で検索とスクロール位置を保ったまま戻れます。",
                  ],
                  [
                    "入力の保護",
                    "編集中は自動追従を停止し、届いた更新で入力を消しません。パネルを閉じても同じタブに入力が残り、編集を終了するときは破棄する前に確認します。",
                  ],
                  [
                    "コード下で読む",
                    "対象行・タイトル全文・Markdownの本文を、読みやすい幅で表示します。本文は最初から展開され、「注釈」ボタンで個別に折りたためます。パネルの開閉や更新でも手動の選択を保持。「パネルで読む」で縦長の詳細表示に移れます。",
                  ],
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
                  [
                    "復元できる URL",
                    "パネルの開閉、選択中のセッション、選択中の注釈は URL に反映されるため、リロードや共有リンクでも同じウォークスルー状態を復元できます。",
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
          "SQLite ファイル、Docker 上のデータベース、Cloudflare D1、Redis、Elasticsearch、DynamoDB、S3 互換オブジェクトストア (Cloudflare R2 を含む) をローカルビューアで閲覧できます。",
        groups: [
          {
            title: "対応データストア",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "保存済み接続",
                    "データストア選択の横にある + から、任意の PostgreSQL、MySQL、Cloudflare D1、Redis、Elasticsearch、S3 互換 (Cloudflare R2 プリセットあり)、DynamoDB エンドポイントを追加できます。必須項目にはマークが付き、保存前に「接続テスト」で入力内容を確認できます。ドライバーは同梱されているため、データベース CLI や curl は不要です。非機密設定はローカルに保存されます。資格情報はリポジトリ配下には一切書かれず、macOS ではキーチェーンに保存されるため再起動をまたいで保持されます (それ以外の OS ではサーバーメモリのみで、再起動後は再入力が必要です)。",
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
                    "Cloudflare D1",
                    "アカウント ID・データベース ID・API トークン (D1:Read 権限が必要) を入力して保存済み接続として追加します。D1 REST API 経由で閲覧し、SQL 系の画面 (テーブル一覧・行グリッド・クエリエディタ・スキーマ・ER 図・スナップショット/差分) をそのまま使えます。閲覧専用で、クエリエディタは SELECT / PRAGMA / EXPLAIN / WITH のみ受け付け、グリッドの Edit モードは表示されません。",
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
                    "S3 / MinIO / LocalStack / Cloudflare R2",
                    "compose ファイルから検出するほか、保存済み接続としても追加できます。R2 は「Cloudflare R2」プロバイダプリセットを選び、アカウント ID と R2 のアクセスキーを入力すればエンドポイントと必須リージョン auto が自動で入ります。フォルダツリー型ブラウザ、prefix/ファイル名検索、更新日時順表示、画像/動画/音声/PDF/Markdown/HTML/テキストのプレビューに対応。テキスト/Markdown/JSON のインライン編集、新規オブジェクトアップロード、オブジェクト削除も可能。LocalStack はホストポート未公開時 `docker exec curl` にフォールバックしますが、MinIO はホストポート公開が必須です。",
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
                    "テーブル一覧は名前の絞り込みと件数表示に対応し、上下矢印で選択、Enterで開く、左右矢印で展開・折りたたみができます。セルをクリックするとリサイズ可能な詳細フッタが開きます。「行全体」で全カラムを縦に表示し、矢印キーで移動した行に追従します。NULL・空文字・false・0は区別して表示します。JSON 値は整形してシンタックスハイライト付きで表示されます。グリッドにフォーカスがある間は矢印キーでデータセル間を移動でき、詳細フッタもその値に追従します（スクロールは見える位置まで必要なぶんだけ）。横スクロール中も行番号が表示され、絞り込み中の列は色で強調されます。Enter で外部キーを辿り（矢印キーだけでは関連テーブルへのクエリは飛びません）、Escape で開いているパネルを閉じ、Tab / Shift+Tab でメイングリッドと関連グリッドを行き来できます。外部キー値からは関連行パネルが開き、ブレッドクラム付きで多段ドリルダウン可能。outgoing (FK→PK) と incoming (PK←FK) の両方向に対応。左の参照リストは各項目を1行に保ち、テーブル名と条件の全文は tooltip で確認できます。リスト幅はドラッグで変更でき、次回も保持されます。",
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

export type OpenHelpSectionDeps = Pick<
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

export function openHelpSection(
  deps: OpenHelpSectionDeps,
  section: HelpSection,
): void {
  const route = deps.getRoute();
  deps.cancelActiveSourceLoad("navigation");
  deps.setRoute({
    screen: "help",
    lang:
      route.screen === "help"
        ? helpLanguageFromRoute(route)
        : deps.getLanguage(),
    section,
    range: deps.currentRange(),
  });
  deps.setPageMode();
  deps.renderHelpPage();
  deps.setStatus("live");
}

export function openHelpKeybindings(deps: OpenHelpSectionDeps): void {
  openHelpSection(deps, "keybindings");
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
    // ユーザーが割り当てを変えていれば、それを反映した一覧を出す。
    const keybindingGroups =
      section === "keybindings"
        ? buildHelpKeybindingGroups(lang, deps.getKeyBindings())
        : [];
    const sectionGroups =
      section === "keybindings"
        ? [
            ...keybindingGroups.map((group) => ({
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
    // 表示言語の切り替えは設定セクションに一本化した。?lang= の URL は
    // 引き続き効くので、別言語のヘルプへのリンクは共有したままで動く。
    header.append(title);

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
    sectionGroups.forEach((group, index) => {
      const groupSection = document.createElement("section");
      groupSection.className = "gdp-help-group";
      // キー一覧のグループだけ印を付ける。後段の編集 UI が、静的な説明表と
      // 取り違えずに変更ボタンを差せるようにするため。
      if (index < keybindingGroups.length)
        groupSection.classList.add("gdp-help-keybinding-group");
      const groupTitle = document.createElement("h3");
      groupTitle.textContent = group.title;
      groupSection.append(groupTitle);
      group.blocks.forEach((block) => {
        groupSection.appendChild(renderHelpBlock(block));
      });
      article.appendChild(groupSection);
    });
    // フォーム部品は HelpBlock では表せないので、静的コンテンツを組んだ後で
    // 差し込む。
    if (section === "settings") deps.mountViewerSettings(article);
    if (section === "keybindings")
      deps.decorateKeybindings(article, keybindingGroups);

    layout.append(helpNav, article);
    shell.append(header, layout);
    target.replaceChildren(shell);
  }

  return { renderHelpPage };
}
