// Help page (keybindings reference), extracted from app.ts.

import type { KeyBinding } from "../core/keymap";
import { PHONE_MEDIA_QUERY } from "../core/mobile-layout";
import type { InstallOffer } from "../core/pwa";
import type { AppRoute } from "../core/routes";
import { buildHelpKeybindingGroups } from "./help-keybindings";
import type { SettingsCategory } from "./viewer-settings";

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
  /** 設定の検索欄 (実体は viewer-settings.ts)。見出しの下に置く。 */
  mountSettingsSearch(host: HTMLElement): void;
  /** 左の列に並べる設定の分類 (並び順どおり)。 */
  settingsCategories(): Array<{
    id: SettingsCategory;
    label: string;
    description: string;
  }>;
  getSettingsCategory(): SettingsCategory;
  setSettingsCategory(category: SettingsCategory): void;
  /** ユーザーの差分を反映した、いま実際に効くバインド一覧 */
  getKeyBindings(): KeyBinding[];
  /**
   * 設定の「ショートカット」を開く。キーの一覧はそこで変える (一覧の上に
   * 案内を出す。編集の画面は views/help-keybinding-editor.ts)。
   */
  openShortcutSettings(): void;
  /** インストールの案内 (PWA) を出すか・ボタンを出せるか。実体は core/pwa.ts */
  installOffer: InstallOffer;
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
  /** インストールの案内 (PWA)。ボタンはブラウザが出せるときだけ。Chrome 以外では出さない */
  | { kind: "install"; button: string; steps: string[] }
  | { kind: "command"; title: string; command: string }
  | { kind: "table"; rows: Array<[string, string]> };

type HelpContent = {
  languageLabel: string;
  title: string;
  /** 左の列で、ヘルプの節の前に置く見出し。 */
  helpNavGroup: string;
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
    helpNavGroup: "Help",
    sections: {
      settings: {
        nav: "Settings",
        title: "Settings",
        intro:
          "Viewer preferences. Sections marked All projects are shared by every project; the others apply to this repository. Edits remain a draft until you select Save changes.",
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
                kind: "paragraph",
                text: "First run, in order: the repository you started in is registered and listed under Projects at the top of the left sidebar (a folder outside git is shown but not registered; Register by path… there adds a repository). Running code-viewer in another repository adds it to the same page. To run agents you need tmux: New agent at the bottom of the sidebar starts claude or codex in a new tmux session, and its state (Needs input, Working) shows in the sidebar, the bottom bar and the tab title; Enable notifications on the Agents screen turns on desktop notifications. Settings → Accounts signs in (the default ~/.claude and ~/.codex are created on first sign-in or start) and adds more accounts. When something does not work, code-viewer doctor lists what is missing and how to fix it.",
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
                text: "The row of tabs at the top keeps files and screens open; there is no header row above it. The head of the list column, at the left end of the top row, has two rows. The first, as tall as the tab row, shows the project you are looking at: a colored square with its initials, its name (click it or press p to switch projects) and its branch on the right; a long name is shortened, and hovering it shows the whole name. The second row holds the six view icons (Files, Diff, History, Worktrees, Data, Work log; hover for the name and key), with the button that folds the file list at its right end. The file list starts below the head, and the tab row starts to its right. The left sidebar holds the projects and agents; to its right, the list column shows the file list (the tree of the repository) on every screen, and next to it the list you pick the main area from: the changed files of Diff, the commits of History and the list of a selected worktree, where History and a selected worktree also show their changed files next to the list. The columns follow the tab in front: with a terminal or an image in front, only the file list stays. The list keeps the width you drag it to (320px at first) and the file list keeps its own. When the main area would be narrower than 480px, the list narrows to 240px first (History then shows only the subject and the branch labels), then the changed files fold to a strip, and then the file list folds away (its button carries a mark and says why). Every column folds by hand: the file list with the button at the head, the lists with the small handle in the middle of their right edge; a folded list becomes a strip whose button opens it again, and a column you open yourself is not folded for width again until you reload. In History a branch label keeps its whole name up to about 40% of the room it shares with the subject (more when the subject is short), and the subject is shortened into the rest. A terminal tab showing an agent from another project is named “project · title”; when the tab is narrow, the project name is shortened first. Switching tabs or screens, splitting into two sides, folding a column or showing the lists never moves or hides the head; folding only folds the column below the head, so the tab row and the split button stay put. When the head is narrow, the branch keeps its whole name up to about 40% of the width (more when the project name is short) and the project name is shortened to fit the rest. A file opened with one click (tree, palette, a line link, View File) opens in a preview tab with an italic name, and the next file replaces it; double-click the tree row or the tab, or choose Keep open, to keep it. To open a file in a tab of its own that stays, middle-click or ⌘/Ctrl+click it (tree, Diff and History file lists, Search results, palette rows), press Shift+Enter in the palette, or right-click a tree file → Open in new tab; if the file is already open, that tab comes to the front and is kept. Shift+click still opens the row in a new browser window. A file at another version (a commit opened from History, HEAD, a branch) is a tab of its own next to the working tree one, named like “a.ts @ 1a2b3c4”. Diff, History, Worktrees, Data and Work log each have one tab: their icon brings that tab back as you left it. Files is not a tab: the folder view is what the left side shows when no tab is selected (the Files icon, g r, or a folder in the tree clears the selection), and closing the last tab shows it too. Right-click a tab (or press Shift+F10 on it) for Close / Close others / Close to the right / Keep open / Copy path, drag tabs to reorder, and use g t / g T (next / previous), g x (close) and g 1–9. On the tab row, ←/→, Home and End move between tabs, Enter brings one to the front, Delete closes it and Ctrl+Shift+PageUp / PageDown (or Ctrl+Shift+←/→, ⌘+Shift+←/→, or Move left / Move right in the tab's menu) moves it. With two sides, the tab row of the side that has the focus is underlined across its width. When the tabs do not fit in the row, each one shrinks down to 88px and shortens its name (the icon and the close button stay); past that the row scrolls sideways, always keeping the front tab in view. The tabs are remembered per project, except the ones that do not belong to a project: the agent board, Tools, Settings & Help, terminals and images shown by a terminal stay open when you switch projects. Screens (Diff, History, Worktrees, Data, Work log, Agents, Settings & Help) have one place to be drawn, so they stay on the left side; the right side holds files, terminals and images. Each side draws its own file, so two files, or the same file twice, sit side by side, each with its own scroll, line selection and Code / Preview / Blame view; a file's History opens on the left. The split button at the right of the row (or Split right on a file, terminal or image tab, or dragging one onto the dashed area on the right half) shows two sides; when the button cannot split, its tooltip says why; drag the line between them to resize, drag files, terminals and images between the sides or use Move to other side, and press g o to move to the other side. The tree and the palette open a file on the side that has the focus; Alt+click a file in the tree, the Diff or History file list or the Search results (or right-click a tree file → Open to the right) to open it on the other side (with one side, it splits and opens it on the right). The URL follows the focused side: a file on the right adds pane=right, so a reload and Back / Forward come back to it. Image files open in an image tab with zoom, previous / next, Copy path and Open folder. The buttons that used to sit at the right of the header row (annotations, Copy AI context, auto update, cancel requests, theme, repository page) are at the right of the bottom bar.",
              },
              {
                kind: "paragraph",
                text: "When the two sides would be narrower than 480px each, the list column makes room in the same order while the area is split (the list narrows to 240px, the changed files fold to a strip, then the file list folds away), and what was folded for the split comes back when you return to one side. When two sides still do not fit, the right side is set aside until you move to another screen or widen the window (the split button says so).",
              },
              {
                kind: "paragraph",
                text: "The main area scrolls in its own box. The page itself does not scroll, so the scrollbar sits at the right edge of the main area, and Back / Forward return to where you had scrolled. On a long diff card the horizontal scrollbar sticks to the bottom of the main area while the card is on screen (Split has one for each side), so you can scroll sideways without going to the end of the card. A diff box that scrolls sideways is a Tab stop: once it has focus, ←/→ scroll it. A breadcrumb too long for its row folds the middle folders into “…”; hover it for the full path, or click it (Tab reaches it, then Enter or Space) to pick one of the folded folders.",
              },
              {
                kind: "paragraph",
                text: "Use the sidebar or file palette to open source files, Markdown previews, images, PDFs, and other browser-safe media. Large text files automatically switch to virtual mode. Sidebar rows are links: Cmd/Ctrl+click or middle-click opens a file in a new tab. View File on a diff card shows the full source in place and keeps the file list (and, on the History screen, the commit list) on screen; View Diff returns to the diff.",
              },
              {
                kind: "paragraph",
                text: "A file detail page exposes up to four tabs — Preview, Code, Blame, History. For text files Code is the default and ?preview=1 opts in to the Markdown / HTML preview; media files (images, video, audio, PDF) show a Preview tab only, with no Code tab. Blame and History have their own canonical URLs (view=blame, view=history) so deep links and the browser back/forward stay in sync, and they keep the Repository sidebar visible. Opening another file from the repository tree keeps the active tab (a file that cannot be previewed falls back to Code). When the file's header is narrow (the right side of a split, for example), these tabs move to a row of their own; under about 510px the breadcrumb takes the whole first row and the buttons beside it (copy path, open in the OS, info, previous / next, delete) move to the second.",
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
                text: "Tab reaches the tree once, on the selected row (or the first row). There, ↑ / ↓ move, Home / End jump to the first / last row, → opens a folder, ← folds it or goes to its parent folder, and Enter opens the row; j / k / l / h and Shift+H keep working as before.",
              },
              {
                kind: "paragraph",
                text: "Files with pending git changes show a status badge in the tree instead of the regular type icon: M (modified), A (added — staged for commit), D (deleted), R (renamed), U (untracked — in the worktree but not under version control yet), and I (ignored by a .gitignore rule). U and A stay separate so a file you have never run git add on does not look like one that is already staged. A wholly untracked or ignored directory is badged as a whole and keeps its folder icon, so it stays recognizable while collapsed; its contents inherit the badge unless an ignore rule names a file specifically.",
              },
            ],
          },
          {
            title: "Install as an app",
            blocks: [
              {
                kind: "install",
                button: "Install code-viewer",
                steps: [
                  "In Chrome, click the install icon at the right end of the address bar, or open ⋮ → Cast, save, and share → Install page as app.",
                  "code-viewer opens in its own window. Next time, open it from the Dock, the Start menu or chrome://apps once code-viewer is running.",
                ],
              },
              {
                kind: "paragraph",
                text: "Installed as an app (the install button in the address bar or the browser menu), code-viewer opens in its own window, and there the browser's tab keys work on these tabs: ⌘W / Ctrl+W closes the front tab (never the window), ⌘T / Ctrl+T opens the ＋ menu, ⌘⇧T / Ctrl+Shift+T reopens the last tab you closed, ⌘1–8 / Ctrl+1–8 pick a tab and ⌘9 / Ctrl+9 the last one, Ctrl+Tab / Ctrl+Shift+Tab (or ⌘⇧] / ⌘⇧[ on a Mac) and ⌘← / ⌘→ (Ctrl+← / Ctrl+→ on Windows and Linux) move to the previous / next tab of the focused side, going round at either end. In a text field ⌘← / ⌘→ still move to the start / end of the line; in a terminal they move between tabs. ⌘N / Ctrl+N does nothing, so the window is not doubled. ⌘⇧W / Ctrl+Shift+W is left to the browser and closes the window. In a terminal tab, the other Ctrl keys still go to the terminal. In an ordinary browser tab nothing changes: the browser keeps these keys (⌘← / ⌘→ stay Back / Forward), and g t / g T / g x / g 1–9 work everywhere. All of these keys can be changed, or made to work in browser tabs too, in Settings › Shortcuts.",
              },
            ],
          },
          {
            title: "Search and history",
            blocks: [
              {
                kind: "paragraph",
                text: "Ctrl+K opens the file palette and Ctrl+G the text palette; the Search box at the top of the left sidebar does the same (Shift+click for text). The two share one window: switching keeps what you typed, and reopening restores the last query, selected so typing replaces it. With an empty query the file palette lists the files you opened most recently, and the result line says when the ranking was cut at 50. The text palette has regex (Alt+R), match-case (Alt+C) and whole-word (Alt+W) toggles, and path:<dir or glob> tokens in the query narrow the search; matching is case-insensitive on every engine unless match-case is on. Opening a hit marks the matched text on the target line, and in a large virtualized file it pre-fills the in-file find bar. Pin (or Ctrl+Enter) moves the query into the Search tab, where the grouped result list stays open while you browse files; the Search tab also opens from the + menu of the tab row or the palette. The query is part of the URL (/search?q=) so a reload re-runs it, and the Search tab remembers it with the tabs, so it comes back filled in after a reload even when another tab was in front.",
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
                text: "The Tools tab (the + menu of the tab row, or Go to Tools in the palette) is a scratch pad for text you paste. It holds a Markdown preview (the same renderer as the file preview, so the table of contents, task lists, frontmatter, code highlighting and ```mermaid fences all work), a Mermaid preview with zoom and drag-pan, and a JSON / YAML tool that reads either format and re-emits it as formatted JSON or YAML — a validator and a converter in one.",
              },
              {
                kind: "paragraph",
                text: "Each tool keeps its own draft in .code-viewer/tools.json, so the tab reopens where you left it. The open tool is part of the URL (/tools?tool=markdown), which makes it shareable and survives a reload; the tab also remembers it with the tabs, so it comes back even when another tab was in front. The split between input and output is draggable; in a pane under 560px wide (the left side of a split, for example) the input sits above the result instead, without the divider.",
              },
            ],
          },
          {
            title: "Terminal",
            blocks: [
              {
                kind: "paragraph",
                text: "Terminals open as tabs of the main area. The ＋ just after the last tab opens a menu with Open a file, New shell, and the existing sessions: the shells of this server and the tmux panes of this project (● marks one that is unread and not in a tab; Mark all as read clears them; All sessions in every project goes to the Agents board). An agent from the left sidebar, the palette (Ctrl+K: agents under Agents, shells and plain tmux panes under Sessions), the All agents board or the bottom bar opens in a tab too, and Ctrl+` opens the ＋ menu of the focused side. Each terminal is an ordinary login shell running on a PTY and drawn with xterm.js, so anything you would run in a terminal works here — including tmux, which follows the tab's size on its own.",
              },
              {
                kind: "paragraph",
                text: "?terminal=<shell> in the URL names the shell of the front terminal tab, so a reload comes back to it; opening such a URL without that tab creates the tab. Moving a tab to the other side keeps the same terminal — the screen and what you were typing stay. Closing a terminal tab never stops the shell or the agent: reopen it from the ＋ menu. To end the shell itself, right-click the tab and choose Stop session (it asks first). Images the agent wrote are listed on the shelf at the right of the terminal; clicking one (or the path in the terminal) opens it in an image tab — on the other side when the area is split —, a middle-click or ⌘/Ctrl+click (or Open in new tab in the item's menu) keeps that tab, and Alt+click or the item's right-click menu opens the full-screen viewer instead.",
              },
              {
                kind: "paragraph",
                text: "Typing goes to that shell, so you can answer a prompt without leaving the tab. The tab's right-click menu also turns input off when you only want to watch (Read only) and changes the text size; both apply to every terminal tab. A terminal tab is named after what it shows: the agent and its state, or Shell and a number in the order the shells were opened. Shells live as long as the server does; typing exit ends one and closes its tab, and so does Stop session. A tab opened for a tmux pane closes when that pane ends, even when other panes are left in the session (the tab does not switch to them), and when you leave tmux (the session ends or you detach); a short note at the bottom right names what ended. When the same tmux session is also open in a smaller terminal, tmux shrinks the window to that size and fills the rest with dots; the terminal tab covers that area and gives the window size and the reason.",
              },
              {
                kind: "paragraph",
                text: "The Agents board is the full session list: every tmux pane with a coding agent on this machine, grouped by project, with filters by state and All panes for plain shells; its problems section shows the state observations that failed.",
              },
              {
                kind: "paragraph",
                text: "Status first uses lifecycle reports when they are available. Otherwise it evaluates every enabled screen rule against the live terminal title and recent visible lines, then uses the highest-priority match. A terminal is tracked only after a report or a visible rule identifies it; screen motion then provides the working/idle fallback. Working matches expire when the title and screen stop changing, so stale status text does not stay active. Settings & Help → Settings contains the full JSON rule set, including regions, priorities, contains checks, regular expressions, and nested all/any/not conditions. Regular expressions use a bounded safe subset: groups, alternation, and backreferences are rejected, and AND/OR belongs in all/any. Saving validates the whole set and shows every error without replacing the active rules. If the saved rules cannot be read again (for example, another code-viewer holds their lock), the rules in use stay and Settings shows why, instead of switching to the built-in rules. Restoring the built-in rules removes the saved override so updated defaults can arrive with later releases.",
              },
              {
                kind: "paragraph",
                text: "Choosing a tmux pane (from the ＋ menu, the sidebar, the palette or the board) takes you to it in a tab. If a shell already has that session open, that shell's tab comes forward and the pane becomes current; otherwise a shell is opened and attached for you, so you end up with one shell per tmux session rather than one per pane. This works from a shell that is itself inside tmux, or whose startup files start tmux: the attach runs with TMUX unset, so the pane shows up nested inside that tmux. Powerline separators and file icons render when a Nerd Font is installed on the machine running the browser; no font ships with the package. Panes need tmux on PATH; shells work without it. Opening shells needs the optional @lydell/node-pty package.",
              },
              {
                kind: "paragraph",
                text: "One tmux caveat worth knowing: a tmux window can only have one size, so when the same session is attached from both a terminal tab and another terminal, they share it. With tmux's default window-size latest the window snaps to whichever terminal you touched last, and the smaller one gets its right and bottom edges cut off. Setting window-size smallest makes every attached terminal show the whole window, at the cost of some empty space in the larger one.",
              },
            ],
          },
          {
            title: "Agents",
            blocks: [
              {
                kind: "paragraph",
                text: "The left sidebar lists your projects with the agents running in them, on every screen: registered projects first, in your order, and below them, under Found in tmux, projects that are not registered but have agents in tmux. Rows do not move when states change (the state mark, the counter at the bottom and notifications tell you what changed); agents inside a project follow their tmux place. Click a project name to switch to it (an unregistered one is registered first, without asking); click the chevron to fold it; click an agent to open its pane in a terminal tab of the main area. Alt+click, or right-click → Open in the opposite pane, uses the other pane; when there is only one pane, it splits and opens the terminal on the right. Rest the pointer on an agent (or reach it with the keyboard) for a moment to see the last lines of its screen in a preview over the page; it refreshes every second while it is open, takes no input, and closes when you move away or press Escape. To reorder registered projects, drag a project heading (its agents move with it; a line shows where it will land and nothing moves until you drop), press Alt+↑ / Alt+↓ on the heading, or right-click it → Move up / Move down. The order is saved with the project list, so it is the same in every browser and window, and the All agents board uses it too. The All agents board (the button next to Projects, or g a) lists every tmux pane on this machine where a coding agent runs, grouped by project — the git repository a pane's folder belongs to, with worktrees folded into their repository and folders outside git kept as their own group. It is the same list from whichever code-viewer you open it in. Each agent is a two-line card, the same as in the sidebar: the first line is what it is doing (the pane title) or, without one, the agent kind (claude, codex, or an agent that reports its state through a hook), with a badge when it started waiting for input or finished while you were away; the second line reads the kind, the state, how long it has been in that state, the worktree, the account and where it lives in tmux (session:window.pane). In the sidebar, each project is a bold heading with its agent count, and its agents are indented cards under it. On the board, projects follow the sidebar's order; inside each, Needs input comes first, then Finished · unread, then Working, then the rest; Enter or a click opens that pane in a terminal tab of the main area, and resting on a row shows the same preview under it. Plain shells show up only with All panes.",
              },
              {
                kind: "paragraph",
                text: "The counter at the right of the bottom bar shows how many agents need input and how many are working, on every screen; it turns amber only when something needs input, and clicking it opens the list (or the pane directly, when exactly one needs input). When an agent goes from working to needing input, or from working to stopped, the row gets an unread dot and the tab title gets the unread count, and a stopped one shows as Finished (without hooks too); opening or selecting the pane clears it. An agent of another project (its row, a notification, the palette) switches to that project first and then opens the pane in a tab. Desktop notifications are opt-in: press Enable notifications on the Agents screen, or on the note the left sidebar shows the first time an agent needs input (the note goes away once you allow, block or close it), and choose which changes notify you under Settings → Agent notifications. Nothing is notified for a pane shown in the front terminal tab of either side while this window has focus. States come from screen rules evaluated against the live terminal.",
              },
              {
                kind: "paragraph",
                text: "Settings → Agent integration adds hooks to claude (<settings dir>/settings.json, CLAUDE_CONFIG_DIR or ~/.claude) and codex (<CODEX_HOME>/hooks.json, ~/.codex) so they report their own state: when an agent finishes, the row shows Finished · unread until you open it, and permission prompts show as Needs input without waiting for the screen. Agents that cannot be recognized by process name (claude running under node) also appear. Each button first shows the exact file, what is added or removed, where the backup goes, and how many existing hooks stay; other hooks in the file are never removed or reordered. The hooks call a small launcher in code-viewer's state directory, which runs code-viewer terminal hook and reports to every running code-viewer; it always exits 0, and reports that did not arrive are listed in the same settings section. codex runs a new hook only after you trust it in /hooks.",
              },
              {
                kind: "paragraph",
                text: "Settings → Accounts keeps several claude and codex accounts. An account is a settings directory (CLAUDE_CONFIG_DIR for claude, CODEX_HOME for codex); the default ones (~/.claude, ~/.codex) are always listed. Add account either creates a directory under code-viewer's state directory that links your settings from the default one (settings, instructions, skills, commands, keybindings; codex: config.toml, AGENTS.md, hooks.json, rules — on by default and can be turned off; other items such as plugins or your own scripts can be turned on after you check them; sign-in credentials, account identity, history, sessions and caches can never be shared) — or registers a directory you already have without touching it. Both show what will be created and linked before anything is written. Each account is one row with the same columns: its name, the email it is signed in with (claude also shows the plan), its state (Signed in, Not signed in, or Unknown with the reason on the row) and when it was last checked. The state and email come from the CLI itself (claude auth status; codex login status, then codex app-server for the email); code-viewer does not guess them and does not read tokens. Check again asks the CLI again for that row. Sign in, shown only on rows that are not signed in, opens the official sign-in (claude auth login / codex login) for that account in a new tmux window; you approve it in the browser, and code-viewer never sees the credentials. Rename and Remove appear only on accounts you added; removing only takes an account off the list.",
              },
              {
                kind: "paragraph",
                text: "Once more than the default accounts exist, the Agents list shows which account each claude or codex runs with (read from that process's CLAUDE_CONFIG_DIR / CODEX_HOME only), and a band of account cards above the list shows sign-in state, every quota window present in the latest record with its reset time and when the value was received (80% and above is marked High), how many agents run with it, and its hooks. Missing windows are not invented; when one config directory holds records from two accounts, the card keeps the newest values and adds a Mixed note (hover it for the other account's windows and how to separate them). codex usage comes from its session logs. claude reports usage only to its status line, so Settings → Accounts → Usage can wrap your statusLine command (the row says whether usage arrives and when it last did; How it works shows the file it changes): the wrapper keeps the data it receives and returns your command's output unchanged; turning it off restores the original. New agent (on the Agents toolbar, or + on a project) starts claude or codex with the chosen account and project in a new tmux window, without typing into any shell; the command can be changed under Launch commands and is saved with Save changes at the bottom of the page like every other setting (Restore default launch commands sits next to the fields; it runs in your interactive shell, so shell functions work). The New agent dialog shows the command it will run (Command preview) with a copy button, and picks up a command you have just saved.",
              },
              {
                kind: "paragraph",
                text: "Register your projects to keep them in the Agents list even when no agent runs in them, in the order you choose (drag a heading in the left sidebar, or ⋯ on a project heading: register, rename, color, move up / down, remove from projects — the repository itself is never touched). Each registered project has a color and two initials, shown as a square before its name in the left sidebar, at the head of the list column, on the All agents board and in the project switcher; the heading of the project on screen is tinted with its color, a notification's title puts the initials before the project name, and an installed window's title bar takes that color. A newly registered project gets a color no other project uses (after all nine are used, the least used one); change it with Color… in the heading's ⋯ or right-click menu. Projects that are not registered stay gray. Open (on a heading) switches to that project in the same tab and on the same address (`/p/<key>/…`), so the browser's notification permission, the terminal shells and the unread marks stay; code-viewer starts the project's process first if it is not running. Processes that code-viewer started can be stopped from the ⋯ menu; the project shown on this screen cannot. Running `code-viewer` in another repository adds it to the code-viewer that is already running and prints its URL (`code-viewer --standalone` runs a separate server for one repository, as before). CLI commands that print a screen URL (annotate, query diff tables) print the same `/p/<key>/…` address (a `--standalone` server has none). A project's process that nobody has used for 10 minutes is stopped and started again when you open the project (`--idle-stop <seconds>` changes the time; the terminals, the agents and the unread marks stay); if it stops by itself, the screen says so and offers Restart, with the reason under Details. If code-viewer was updated or reinstalled while it kept running, it can no longer start project processes; the screen (after Restart) and the terminal where you started it say the entry server is out of date. Stop that code-viewer (Ctrl+C there) and run code-viewer again. The project name at the head of the list column (p) switches between registered projects from any screen and keeps the screen you are on; type to filter, ↑↓ and Enter to go. Theme, language, font sizes, key bindings, notifications, dismissed hints and the layout (sidebar width and folding) are shared by all projects (Settings shows which sections), so switching does not change how code-viewer looks.",
              },
              {
                kind: "paragraph",
                text: "On a phone (a window 640px wide or less, or a phone turned sideways) the layout changes for three things: checking agents and answering one that needs input, reading diffs and files, and switching projects. The bar at the bottom opens Projects (the left sidebar, which follows your finger in from the left edge), Files, Diff, Agents, and List (the file list, or the list of the current screen, from the bottom; on History and a worktree the sheet shows the list on top and the chosen commit's changed files below). The bar marks the screen you are on, and Agents carries the number of agents waiting for input. Split view is not available there; a split you saved comes back on a wide window. Diffs show as one column (Unified) by default, a Split you pick on the phone lasts until you leave, and Wrap at the end of the Diff bar wraps long lines. Opening an agent from a notification, the bottom counter or the All agents board closes the sidebar and the sheet. On a touch screen, buttons, tabs, rows and the file list are at least 44px tall, and a terminal tab shows keys the on-screen keyboard lacks: Esc, Tab, ⇧Tab, Ctrl+C, ↑, ↓ and Enter, plus ⌨ to bring up or put away the keyboard. The square with a number at the right end of the tab strip lists every open tab, including those of a saved right side (opening one moves it to the left). Swipe up from the bottom bar to open List, and down on a sheet's header to close it. Hold a finger on an agent, a project heading, a tab or a file row for its right-click menu (a project's menu has Move up / Move down). Pinch on a terminal to change its text size for this browser (the phone starts at 12px; the desktop size is kept). Turned sideways, the status bar is hidden and the bottom bar is thinner. Settings open as contents first; pick a section, and the row at the top goes back. Browser notifications need a secure page (https, or localhost on the same machine); opened over plain http from another device they are not available.",
              },
            ],
          },
          {
            title: "Worktrees",
            blocks: [
              {
                kind: "paragraph",
                text: "The Worktrees tab lists every worktree of this repository — the main one and every linked worktree — in the same three-pane shape as History: pick a worktree on the left, its changed files in the middle, the diff on the right. Running one coding agent per worktree makes that spread invisible from inside a single checkout, and this screen is where it becomes visible again. The selection lives in the URL (?wt=…&file=…), so a reload comes back to the same diff.",
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
                text: "Toggle the pulse icon at the right of the bottom bar to slide in a diagnostic sheet from the right. It works on top of any screen (Repository, Diff, History, Datastores) and the open state is preserved in the URL as ?doctor=open so links are reproducible.",
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
                    "Tools tab state — the pasted draft for each tool (Markdown, Mermaid, JSON / YAML) and the tool you used last.",
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
              {
                kind: "paragraph",
                text: "What is shared by all projects (settings such as theme and language, the project list, accounts, the tab layout and the running code-viewer's record) lives in $XDG_STATE_HOME/code-viewer, or ~/.local/state/code-viewer when it is not set. A relative XDG_STATE_HOME is ignored, as the XDG specification says, and code-viewer prints why once.",
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
                    "Open multiple databases side by side. Drag to reorder, + adds an empty tab, middle-click or × closes one (the last tab is reset to empty). Layout persists in .code-viewer/tabs.json. A tab with no datastore chosen is named New tab and says to pick one in the box at the top left or add one with Add datastore connection.",
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
                    "A bottom dock with two tabs. Query History: per-DB master/detail of saved queries, SSE-synced across tabs. Session log: every SQL the server runs in this session (read fetches, user queries, write commits) with timing, row count, and the executed SQL syntax-highlighted. Auto-follow keeps the newest entry pinned; scroll up or click a non-latest entry to pause. The active tab and open/closed state persist in tabs.json.",
                  ],
                  [
                    "Narrow panes",
                    "Below 560px wide (the left side of a split, for example) the global search box stacks above its button and the query toolbar wraps, instead of squeezing the input; a failure message beside the datastore selector wraps to the next line.",
                  ],
                  [
                    "Failures",
                    "A failed load or write shows the whole reason on the screen (the operation, the HTTP status and the server's message, with every cause), and the browser console gets the same failure with the operation and its target (database, table, key, bucket, …).",
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
          "Use these shortcuts to move between panels and navigate files without leaving the keyboard. The list shows the keys you set: in Settings › Shortcuts every action can take other keys or several keys, each key can be allowed in text fields, in terminals or only in the installed app window, and the changes can be exported, imported or edited as JSON.",
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
    helpNavGroup: "ヘルプ",
    sections: {
      settings: {
        nav: "設定",
        title: "設定",
        intro:
          "ビューアの設定です。「全プロジェクト共通」の節はどのプロジェクトでも同じで、それ以外はこのリポジトリだけの設定です。「変更を保存」を押すまで編集内容は下書きのままです。",
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
                kind: "paragraph",
                text: "初めて使うときの順番: 起動したリポジトリは登録され、左のサイドバーの上の「プロジェクト」に並びます (git の外のフォルダは表示だけで登録されません。そこの「パスを入力して登録…」でリポジトリを足せます)。別のリポジトリで code-viewer を実行すると、同じページに加わります。エージェントを動かすには tmux が要ります。サイドバーの下の「新しいエージェント」が claude や codex を新しい tmux のセッションに起動し、その状態 (入力待ち・作業中) がサイドバー・最下段・タブのタイトルに出ます。デスクトップ通知はエージェントの画面の「通知を有効にする」で入れます。設定 → アカウントでログインし (既定の ~/.claude・~/.codex は初めてのログインか起動で作られます)、アカウントを足せます。うまく動かないときは code-viewer doctor が、足りないものと直し方を出します。",
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
                text: "最上段のタブ列に、開いたファイルと画面が並びます (その上に見出しの行はありません)。最上段の左端の一覧の列の頭は 2 段です。1 段目はタブ列と同じ高さで、いま見ているプロジェクトの色の四角と頭文字・名前 (押すか p でプロジェクトを切り替え) と、右寄せでブランチを出します。長い名前は省略し、カーソルを置くと全体が出ます。2 段目には 6 つの画面の絵柄 (Files・Diff・History・Worktrees・Data・Work log。カーソルを置くと名前とキー) と、右端にファイル一覧を畳むボタンがあります。ファイル一覧は頭の下から、タブ列は頭の右から始まります。左のサイドバーにはプロジェクトとエージェントが並び、その右の一覧の列には、どの画面でもファイル一覧 (リポジトリの木) が出ます。その右に本文を選ぶための一覧 (Diff の変更ファイルの一覧・History のコミット・選んでいる作業ツリーの一覧) が並び、History と選んでいる作業ツリーは一覧の右に変更ファイルの一覧も並びます。列は前面のタブに合わせるので、端末や画像のタブが前面のときはファイル一覧だけが残ります。一覧はドラッグした幅を覚え (最初は 320px)、ファイル一覧も自分の幅を覚えます。本文が 480px に足りないときは、まず一覧を 240px に詰め (History は件名と枝の札だけになります)、次に変更ファイルの一覧を細い帯に畳み、それでも足りなければファイル一覧を畳みます (畳むボタンに印と理由が出ます)。どの列も手で畳めます。ファイル一覧は頭のボタン、一覧と変更ファイルの一覧は右端の線の中ほどの小さなつまみで畳み、畳んだ一覧は帯になって、帯のボタンで開きます。自分で開いた列は、再読み込みまで幅のために畳みません。History の枝の札は、件名と分け合う幅の約 40% まで (件名が短ければそれ以上) 名前を省略せずに出し、件名を残りの幅に収まるよう省略します。別のプロジェクトのエージェントを映すターミナルのタブは「プロジェクト名 · 題」になり、タブが狭いときはプロジェクト名から省略します。タブや画面の切り替え・左右 2 面・列の開閉・一覧の出入りのどれでも、一覧の列の頭は動かず消えません。畳むのは頭の下の列だけで、タブ列と分割のボタンは動きません。頭が狭いときは、ブランチの名前を幅の約 40% まで (プロジェクト名が短ければそれ以上) 省略せずに出し、プロジェクト名を残りの幅に収まるよう省略します。1 回押して開いたファイル (木・パレット・行リンク・View File) は名前が斜体の仮のタブで、次に開いたファイルに置き換わります。木の行かタブをダブルクリックするか、「開いたままにする」で固定します。置き換わらない自分のタブで開くには、中ボタンか ⌘/Ctrl+クリック (木・Diff と History のファイルの一覧・Search の結果・パレットの行)、パレットで Shift+Enter、木のファイルの右クリックの「新しいタブで開く」を使います。そのファイルが開いていれば、そのタブを前面に出して固定します。Shift+クリックは今までどおりブラウザの新しいウィンドウで開きます。作業ツリー以外の版 (History から開いたコミット・HEAD・ブランチ) のファイルは、作業ツリーの版とは別のタブで、「a.ts @ 1a2b3c4」のように版の印が付きます。Diff・History・Worktrees・Data・Work log はそれぞれタブが 1 つで、絵柄を押すとそのタブが前に見ていた状態で前面に出ます。Files はタブではありません。フォルダ表示は、左の面でタブを選んでいないときに出る既定の本文です (Files の絵柄・g r・木のフォルダで選択が外れます。最後のタブを閉じたときもこれが出ます)。タブの右クリック (タブの上で Shift+F10 でも) で閉じる・ほかを閉じる・右側を閉じる・開いたままにする・パスをコピー、ドラッグで並べ替え、g t / g T (次 / 前)、g x (閉じる)、g 1〜9 で移れます。タブ列の上では ←/→・Home・End でタブを移り、Enter で前面に、Delete で閉じ、Ctrl+Shift+PageUp / PageDown (Ctrl+Shift+←/→・⌘+Shift+←/→、タブのメニューの「左へ移す」「右へ移す」でも) で並べ替えます。左右 2 面のときは、フォーカスのある面のタブ列の下端に面の幅いっぱいの線が付きます。タブが列に入りきらないときは、1 つずつ 88px まで縮めて名前を省略します (絵と閉じるは残ります)。それでも入らなければ列を横に送り、前面のタブは必ず見える位置に出します。タブの並びはプロジェクトごとに覚えます。ただしプロジェクトに属さないタブ (エージェントの全体ボード・Tools・設定とヘルプ・ターミナル・ターミナルに出た画像) は、プロジェクトを切り替えても開いたまま残ります。画面 (Diff・History・Worktrees・Data・Work log・エージェント・設定とヘルプ) は描く場所が 1 つなので左の面にだけ置き、右の面にはファイル・ターミナル・画像を置きます。ファイルは面ごとに描くので、2 つのファイルや同じファイルを左右に並べられ、スクロール・行の選択・Code / Preview / Blame の切り替えは面ごとです (ファイルの History は左の面で開きます)。タブ列の右端の分割ボタン (ファイル・ターミナル・画像のタブの「右に分割」、それを右半分の破線の枠へドラッグでも) で左右 2 面になり (押せないときはボタンの説明に理由が出ます)、間の線をドラッグで幅を変え、ファイル・ターミナル・画像は面の間でドラッグするか「反対側へ移す」で移し、g o でもう一方の面へ移ります。木とパレットはフォーカスのある面にファイルを開き、木・Diff と History のファイルの一覧・Search の結果を Alt+クリック (木のファイルの右クリックの「右に分割して開く」でも) すると反対の面に開きます (1 面なら右に分けて右に開きます)。URL はフォーカスのある面に合わせ、右の面のファイルなら pane=right が付くので、再読み込みや戻る・進むでその面に戻ります。画像のファイルは、倍率・前後・パスのコピー・フォルダを開くが付いた画像のタブで開きます。以前の見出しの行の右端にあったボタン (注釈・AI 用コンテキストのコピー・自動更新・通信の中止・テーマ・リポジトリのページ) は最下段の右にあります。",
              },
              {
                kind: "paragraph",
                text: "左右の面がそれぞれ 480px に足りないときは、2 面の間は同じ順で一覧の列を詰めます (一覧を 240px に、変更ファイルの一覧を帯に、次にファイル一覧を畳みます)。1 面に戻すと、2 面のために畳んだものは開き直します。それでも 2 面が入らなければ、別の画面へ移るか窓を広げるまで右の面を預けます (分割のボタンにそう出ます)。",
              },
              {
                kind: "paragraph",
                text: "本文は自分の箱の中でスクロールします。ページそのものは動かないので、スクロールバーは本文の右端に出て、戻る・進むでは前にスクロールしていた位置に戻ります。長い差分のカードでは、カードが見えている間、横のスクロールバーが本文の下端に貼り付きます (Split では左右に 1 本ずつ)。カードの末尾まで行かなくても横に送れます。横に送れる差分の箱は Tab で止まり、フォーカスがあれば ←/→ で送れます。行に入りきらないパンくずは、真ん中のフォルダを「…」にまとめます。カーソルを置くと全体のパスが出ます。押すと (Tab で届き、Enter か Space でも) まとめたフォルダから選んで移れます。",
              },
              {
                kind: "paragraph",
                text: "サイドバーやファイルパレットから、ソース、Markdown プレビュー、画像、PDF などを開けます。大きいテキストファイルは自動で軽量な仮想表示に切り替わります。サイドバーの行はリンクなので、Cmd/Ctrl+クリックや中クリックで別タブに開けます。diff カードの View File はファイル一覧（履歴画面ではコミット一覧も）を残したままファイル全体を表示し、View Diff で差分に戻ります。",
              },
              {
                kind: "paragraph",
                text: "ファイル詳細ページには最大 4 つのタブ (Preview / Code / Blame / History) があります。テキストファイルは Code がデフォルトで、?preview=1 を付けると Markdown / HTML プレビューに切り替わります。画像・動画・音声・PDF などのメディアファイルは Preview タブのみ表示され、Code タブは表示されません。Blame と History はそれぞれ専用 URL (view=blame, view=history) を持つため、ディープリンクとブラウザの戻る / 進むが同期し、いずれも Repository サイドバーは表示されたままです。ツリーから別のファイルを開いても選択中のタブは維持されます (プレビューできないファイルでは Code に戻ります)。ファイルの見出しが狭いとき (2 面の右の面など) は、このタブを 2 段目に下ろします。幅が約 510px より狭いと、パンくずが 1 段目を全部使い、その横の操作 (パスのコピー・OS で開く・情報・前後・削除) は 2 段目に並びます。",
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
                text: "木には Tab で 1 回だけ止まります (選んでいる行、無ければ先頭の行)。そこで ↑ / ↓ で移り、Home / End で先頭 / 末尾へ、→ でフォルダを開き、← で畳むか親のフォルダへ移り、Enter で開きます。j / k / l / h と Shift+H はこれまでどおり使えます。",
              },
              {
                kind: "paragraph",
                text: "git の状態があるファイルは、通常の種類アイコンの代わりにステータスバッジがツリーに表示されます。M(変更)、A(追加 — コミット予定としてステージ済み)、D(削除)、R(リネーム)、U(未追跡 — ワークツリーにあるがまだバージョン管理下にない)、I(.gitignore の対象) の 6 種類です。U と A を分けているのは、git add をまだ一度もしていないファイルが、既にステージ済みのファイルと同じ見た目にならないようにするためです。丸ごと未追跡・無視のディレクトリにはディレクトリ単位でバッジが付き、フォルダアイコンは残るので折りたたんだままでも判別できます。配下のファイルはそのバッジを引き継ぎますが、無視ルールが個別に名指ししているファイルはそちらが優先されます。",
              },
            ],
          },
          {
            title: "アプリとしてインストール",
            blocks: [
              {
                kind: "install",
                button: "code-viewer をインストール",
                steps: [
                  "Chrome のアドレスバーの右端にあるインストールのアイコンを押すか、⋮ → キャスト、保存、共有 → ページをアプリとしてインストール を選びます。",
                  "専用の窓で開きます。次からは code-viewer を起こしてから、Dock・スタートメニュー・chrome://apps で開きます。",
                ],
              },
              {
                kind: "paragraph",
                text: "アプリとしてインストールすると (アドレスバーかブラウザのメニューのインストール)、専用の窓で開き、その窓ではブラウザのタブ操作のキーがこのタブ列に効きます。⌘W / Ctrl+W で前面のタブを閉じ (窓は閉じません)、⌘T / Ctrl+T で「＋」のメニュー、⌘⇧T / Ctrl+Shift+T で最後に閉じたタブを開き直し、⌘1〜8 / Ctrl+1〜8 で N 番目、⌘9 / Ctrl+9 で最後のタブ、Ctrl+Tab / Ctrl+Shift+Tab (Mac では ⌘⇧] / ⌘⇧[ も) と ⌘← / ⌘→ (Windows と Linux では Ctrl+← / Ctrl+→) で、フォーカスのある面の前 / 次のタブへ移ります (端では反対の端へ回ります)。入力欄の中の ⌘← / ⌘→ は今までどおり行の先頭 / 末尾へ動き、ターミナルの中ではタブを移ります。⌘N / Ctrl+N は何もしません (窓を増やさないため)。⌘⇧W / Ctrl+Shift+W はブラウザのままで、窓を閉じます。ターミナルのタブでは、ほかの Ctrl のキーは今までどおりターミナルに届きます。通常のブラウザのタブでは何も変わらず、これらのキーはブラウザのもので (⌘← / ⌘→ は戻る / 進むのまま)、g t / g T / g x / g 1〜9 はどちらでも使えます。これらのキーは、設定 › ショートカット で変えたり、通常のタブでも効くようにしたりできます。",
              },
            ],
          },
          {
            title: "検索と履歴",
            blocks: [
              {
                kind: "paragraph",
                text: "Ctrl+K でファイルパレット、Ctrl+G でコード検索パレットが開きます。左のサイドバーの上の「検索」でも同じです（Shift+クリックでコード検索）。2 つは 1 つのウィンドウを共有し、切り替えても入力中の検索語は残り、閉じて開き直すと前回の検索語が選択状態で戻ります。ファイルパレットは空のとき最近開いたファイルを並べ、結果が 50 件で切られたときはその旨を表示します。コード検索には正規表現（Alt+R）・大文字小文字の区別（Alt+C）・単語単位（Alt+W）の切り替えがあり、検索語の中の path:<ディレクトリ or glob> で対象を絞れます。大文字小文字は「区別する」を押さない限りどのエンジンでも区別しません。ヒットを開くと該当行の一致箇所が強調され、大きな仮想表示のファイルではファイル内検索バーに検索語が入ります。「固定」（または Ctrl+Enter）を押すと検索語が「検索」タブに移り、ファイルを開いて回る間も結果一覧が残ります。「検索」タブはタブ列の ＋ のメニューやパレットからも開けます。検索語は URL（/search?q=）に載るのでリロードしても同じ検索が走ります。「検索」タブの検索語はタブの並びと一緒に覚えるので、別のタブを前面にしたままリロードしても、検索語が入った状態で戻ります。",
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
                text: "「ツール」タブ（タブ列の ＋ のメニュー、またはパレットの「ツールへ移る」）は、貼り付けたテキストを試す作業台です。Markdown プレビュー（ファイルプレビューと同じ描画なので、目次・タスクリスト・frontmatter・コードハイライト・```mermaid フェンスがそのまま効きます）、ズームとドラッグ移動ができる Mermaid プレビュー、JSON と YAML のどちらでも読み取って整形し直す JSON / YAML ツール（検証と相互変換を兼ねます）が入っています。",
              },
              {
                kind: "paragraph",
                text: "各ツールの入力は .code-viewer/tools.json に保存されるので、開き直すと続きから使えます。開いているツールは URL（/tools?tool=markdown）に載るので共有もリロードもできます。タブの並びと一緒にも覚えるので、別のタブを前面にしたままリロードしても同じツールで戻ります。入力と出力の境目はドラッグで動かせます。幅が 560px より狭い面 (2 面の左の面など) では、入力を結果の上に積みます (境目は出しません)。",
              },
            ],
          },
          {
            title: "ターミナル",
            blocks: [
              {
                kind: "paragraph",
                text: "ターミナルはメインの面のタブで開きます。最後のタブのすぐ右の「＋」を押すと、「ファイルを開く」「新しいシェル」と、既存のセッション (このサーバのシェルと、このプロジェクトの tmux のペイン) が並ぶメニューが出ます (● はタブで開いていない未読。「すべて読んだことにする」で消せます。「すべてのプロジェクトのセッション…」はエージェントの一覧へ)。左のサイドバー・パレット (Ctrl+K。エージェントは「エージェント」、シェルとただの tmux のペインは「セッション」の群)・全体ボード・最下段から開くエージェントもタブで開き、Ctrl+` でフォーカスのある面の「＋」のメニューが開きます。中身は PTY 上のふつうのログインシェルを xterm.js で描いたものなので、ターミナルでできることはそのままできます。tmux もそのひとつで、タブの大きさに自分で追従します。",
              },
              {
                kind: "paragraph",
                text: "URL の ?terminal=<シェル> は前面のターミナルのタブのシェルで、リロードしても同じシェルに戻ります。そのタブが無いときにこの URL を開くと、タブを作ります。タブを反対側の面へ移しても同じ端末のままなので、画面も打ちかけの文字も残ります。ターミナルのタブを閉じても、シェルやエージェントは止まりません (「＋」のメニューから開き直せます)。シェルそのものを終わらせるには、タブを右クリックして「セッションを止める」を選びます (先に確かめます)。エージェントが書き出した画像はターミナルの右の棚に並び、押す (ターミナルの中のパスを押す) と画像のタブで開きます (左右 2 面なら反対側の面)。中ボタンか ⌘/Ctrl+クリック (項目の右クリックの「新しいタブで開く」でも) なら、そのタブを固定で開きます。Alt+クリックか項目の右クリックのメニューなら、これまでの拡大表示で開きます。",
              },
              {
                kind: "paragraph",
                text: "打ったキーはそのシェルに届くので、タブを離れずに返事ができます。見るだけにしたいときはタブの右クリックで入力を切れます (閲覧のみ)。同じメニューで文字の大きさも変えられます (どちらも全部のターミナルのタブに効きます)。ターミナルのタブの名前は映しているもので、エージェントならその種類と状態、ただのシェルなら「シェル」と番号です。シェルはサーバが動いている間だけ生き、exit と打てばタブごと閉じます (「セッションを止める」でも同じです)。tmux のペインを開いたタブは、そのペインが終わると閉じます。セッションに別のペインが残っていても、そちらへは切り替わりません。tmux から抜けた (セッションが終わった・detach した) ときも閉じます。何が終わったかは右下に短く出ます。同じ tmux のセッションをもっと小さい端末でも開いていると、tmux はウインドウをその大きさに縮め、余りを点で埋めます。ターミナルのタブはその余りを覆い、ウインドウの大きさと理由を出します。",
              },
              {
                kind: "paragraph",
                text: "セッションの一覧をまとめて見るのはエージェントの一覧 (全体ボード) です。このマシンの tmux でコーディングエージェントが動いているペインをプロジェクトごとに並べ、状態で絞り込め、「すべてのペイン」でただのシェルも出ます。状態の観測に失敗したものは、そこの「問題」に出ます。",
              },
              {
                kind: "paragraph",
                text: "状態変更の申告がある場合はそれを先に使います。申告が無い場合は、現在のターミナルタイトルと画面下端の表示に対して全ルールを評価し、優先度が最大の一致から「作業中」「入力待ち」「待機中」「直前の状態を維持」を決めます。申告か見えているルールで対象を識別した後だけ、画面の変化量を作業中・待機中の補助判定に使います。作業中ルールの文字が残っていても、タイトルと画面が変化しなくなれば待機中へ移ります。設定・ヘルプ → 設定では、見る範囲、優先度、contains、正規表現、入れ子の all/any/not を含むJSONルール集を編集できます。正規表現は処理時間を抑えた範囲だけを許可し、グループ・選択・後方参照は使えません。AND/OR は all/any で表します。保存時は全ルールを検証し、エラーはすべて表示して適用中のルールを置き換えません。保存したルールを読み直せないとき (別の code-viewer がロックを持ったままなど) は、組み込みのルールに戻さず、使っているルールのまま設定画面に理由を出します。組み込みルールへ戻すと保存済みの上書きを削除するため、以後の更新で新しい既定ルールを受け取れます。",
              },
              {
                kind: "paragraph",
                text: "tmux のペインを選ぶと (「＋」のメニュー・サイドバー・パレット・全体ボード)、タブでそこまで連れて行きます。そのセッションを既に開いているシェルがあれば、そのシェルのタブが前に出てペインがカレントになります。無ければ、こちらでシェルを開いて attach します。つまりペインごとではなく、tmux のセッション 1 つにつきシェル 1 本になります。シェルが tmux の中にある場合や、シェルの起動設定が tmux を自動で起こす場合も attach できます (TMUX を外して attach するので、その tmux の中に入れ子で出ます)。powerline のセパレータやファイルアイコンは、ブラウザを動かしている環境に Nerd Font が入っていれば表示されます（フォントはパッケージに同梱していません）。ペインには tmux が PATH にあることが必要です (シェルは無くても使えます)。シェルを開くには任意依存の @lydell/node-pty が必要です。",
              },
              {
                kind: "paragraph",
                text: "tmux の性質でひとつ知っておくとよいこと。tmux のウィンドウは寸法を 1 つしか持てないので、同じセッションをターミナルのタブと別のターミナルの両方から開くと、寸法を共有します。tmux の既定（window-size latest）では最後に操作した側の寸法に合うため、小さいほうの端末では右と下が見切れます。window-size smallest にすると、どの端末でもウィンドウ全体が見えるようになります（大きいほうの端末には余白が出ます）。",
              },
            ],
          },
          {
            title: "エージェント",
            blocks: [
              {
                kind: "paragraph",
                text: "左のサイドバーは、どの画面でもプロジェクトとその中で動いているエージェントを並べます。上に登録したプロジェクト (好きな順)、その下の「tmux で検出」に、登録していないが tmux でエージェントが動いているプロジェクトが出ます。状態が変わっても行は動きません (変化は状態の印・最下段の件数・通知で分かります)。プロジェクトの中のエージェントは tmux の場所の順です。プロジェクト名を押すとそのプロジェクトへ移り (登録していなければ確かめずに登録してから)、左の山形で畳み、エージェントを押すとメインの面のターミナルのタブにそのペインが開きます。Alt+クリック、または右クリックの「反対の面で開く」は反対側の面を使い、1 面だけなら左右に分割して右に開きます。エージェントにポインタを少し置く (キーボードで移っても) と、その画面の最後の行が本文の上にプレビューで出ます。出ている間は 1 秒ごとに新しくなり、入力は受けず、離れるか Esc で消えます。登録したプロジェクトの並べ替えは、見出しをドラッグ (その下のエージェントも一緒に動きます。落とす位置に線が出て、落とすまで何も動きません)、見出しで Alt+↑ / Alt+↓、または右クリックの「上へ」「下へ」。並びはプロジェクトの登録簿に保存されるので、どのブラウザ・窓でも同じで、「すべてのエージェント」のボードもこの順です。「すべてのエージェント」のボード (「プロジェクト」の横のボタン、g a) は、このマシンの tmux でコーディングエージェントが動いているペインを、プロジェクトごとに並べます。プロジェクトはペインのフォルダが属する git リポジトリで、作業ツリーは本体にまとめ、git 管理外のフォルダはそのフォルダで 1 つにします。どのリポジトリで開いた code-viewer からでも同じ一覧です。エージェントはサイドバーと同じ 2 行組のカードです。1 行目は作業内容 (ペインのタイトル。無ければ種類: claude、codex、フックで状態を申告するエージェント) で、見ていない間に入力待ちになった・終わったものには札が付きます。2 行目に種類・状態・その状態になってからの時間・作業ツリー・アカウント・tmux 上の場所 (セッション:ウィンドウ.ペイン) が並びます。サイドバーでは、プロジェクトはエージェントの数を添えた太い見出しで、その下にエージェントのカードが字下げして並びます。ボードのプロジェクトはサイドバーと同じ順で、その中は入力待ちが先頭、次に完了・未読、作業中、その後にそれ以外。Enter かクリックで、メインの面のターミナルのタブにそのペインが開き、行にポインタを置くと同じプレビューが行の下に出ます。ただのシェルは「すべてのペイン」にしたときだけ出ます。",
              },
              {
                kind: "paragraph",
                text: "最下段の右の件数は、どの画面にいても入力待ちと作業中の数を出します。注意の色になるのは入力待ちがあるときだけです。押すと一覧へ、入力待ちが 1 件だけならそのペインを直接開きます。作業中から入力待ちに、または作業中から止まったに変わると、その行に未読の印が付き、タブのタイトルの先頭に未読の数が出ます。止まったものは (フックが無くても) 完了と出ます。そのペインを開くか一覧で選ぶと消えます。別のプロジェクトのエージェント (行・通知・パレット) は、そのプロジェクトへ移ってからペインをタブで開きます。デスクトップ通知は、エージェント画面の「通知を有効にする」か、最初に入力待ちが出たときに左のサイドバーに出る案内のボタンを押したときだけ許可を求めます (案内は、許可かブロックを選ぶか閉じると出なくなります)。どの変化で通知するかは 設定 → エージェントの通知 で選べます。この窓にフォーカスがある間、左右どちらかの前面のターミナルタブに出ているペインは通知しません。状態は生きているターミナルに画面ルールを当てて判定します。",
              },
              {
                kind: "paragraph",
                text: "設定 → エージェント連携 で、claude (<設定ディレクトリ>/settings.json。CLAUDE_CONFIG_DIR か ~/.claude) と codex (<CODEX_HOME>/hooks.json。~/.codex) に、自分の状態を申告するフックを入れられます。入れると、終わったエージェントは開くまで「完了・未読」と出て、許可を求めたときは画面を待たずに入力待ちになります。プロセス名では見分けられないエージェント (node として動く claude など) も一覧に出ます。ボタンを押すと、先に対象のファイル・足すもの・消すもの・バックアップの場所・残る既存のフックの数を見せ、確認してから書きます。ファイルにあるほかのフックは消さず、順序も変えません。フックは code-viewer の状態ディレクトリにある小さな起動スクリプトを呼び、そこから code-viewer terminal hook が動いている全部の code-viewer に申告します。終了コードは常に 0 で、届かなかった申告は同じ設定の節に並びます。codex は /hooks で信頼するまで新しいフックを実行しません。",
              },
              {
                kind: "paragraph",
                text: "設定 → アカウント で、claude と codex のアカウントを複数持てます。アカウントは設定ディレクトリ (claude は CLAUDE_CONFIG_DIR、codex は CODEX_HOME) で、既定のもの (~/.claude、~/.codex) は常に一覧にあります。「アカウントを追加」は、code-viewer の状態ディレクトリにディレクトリを作って既定の設定をリンクで共有するか (settings・指示・スキル・コマンド・キー割り当て。codex は config.toml・AGENTS.md・hooks.json・rules。既定でオンで、外すこともできます。プラグインや自分で置いたスクリプトなどは、確かめたうえでオンにできます。ログインの認証情報・アカウントの識別情報・履歴・セッション・キャッシュは共有できません)、既にあるディレクトリをそのまま登録します。どちらも、書く前に何が作られ何がリンクされるかを見せます。1 つのアカウントは 1 行で、どの行も同じ列です: 名前・ログイン中のメールアドレス (claude はプランも)・状態 (ログイン済み・未ログイン・不明。不明は理由を行に出します)・最後に確かめた時刻。状態とメールアドレスは CLI 自身に訊きます (claude auth status、codex login status とメールアドレスは codex app-server)。code-viewer は推測せず、トークンも読みません。「確かめ直す」はその行を CLI に訊き直します。「ログイン」は未ログインの行にだけ出て、そのアカウントの公式のログイン (claude auth login / codex login) を tmux の新しいウィンドウで開きます。承認はブラウザで行い、code-viewer は認証情報に触れません。「名前を変更」「外す」は追加したアカウントにだけ出ます。「外す」は一覧から外すだけです。",
              },
              {
                kind: "paragraph",
                text: "既定以外のアカウントがあると、エージェント一覧の各行に、その claude / codex がどのアカウントで動いているかが出ます (そのプロセスの CLAUDE_CONFIG_DIR / CODEX_HOME だけを読みます)。一覧の上にはアカウントの帯が出て、ログインの状態・直近の記録にある使用量の枠とリセットまでの時間・いつの値か (80% 以上は「注意」)・そのアカウントで動いているエージェントの数・フックの状態が並びます。記録に無い枠は補いません。1 つの設定ディレクトリに 2 つのアカウントの記録があるときは、新しいほうの値を出し、「混在」の札を付けます (カーソルを置くと、もう一方の枠と分け方が出ます)。codex の使用量はセッション記録から読みます。claude は使用量をステータスラインにだけ渡すので、設定 → アカウント → 使用量 でステータスラインのコマンドを包めます (行には受け取れているかと最後に受け取った時刻だけを出し、書き換えるファイルは「仕組み」を開くと見えます)。包むスクリプトは受け取ったデータを保存し、あなたのコマンドの出力をそのまま返します。無効にすると元に戻ります。「新しいエージェント」(一覧のツールバー、またはプロジェクトの +) は、選んだアカウントとプロジェクトで claude か codex を tmux の新しいウィンドウに起動します。シェルにキー入力を送ることはしません。コマンドは「起動コマンド」で変えられ、ほかの設定と同じくページの下の「変更を保存」で保存します (欄の横に「起動コマンドを既定に戻す」があります。対話シェルで動くので、シェルの関数も使えます)。「新しいエージェント」の画面には実行するコマンドがそのまま出て、コピーのボタンがあります。保存したばかりのコマンドもすぐに出ます。",
              },
              {
                kind: "paragraph",
                text: "プロジェクトを登録すると、エージェントが居なくてもエージェント一覧に、好きな順で常に並びます (左のサイドバーで見出しをドラッグ、または見出しの ⋯ から登録・名前を変える・色・上へ / 下へ・登録を外す。リポジトリには触りません)。登録したプロジェクトには色と頭文字 2 文字が付き、左のサイドバー・一覧の列の頭・「すべてのエージェント」のボード・プロジェクトの切替で名前の前に色の四角として出ます。いま見ているプロジェクトの見出しはその色で薄く塗り、通知の題はプロジェクト名の前に頭文字を付け、インストールした窓の上端の帯もその色になります。新しく登録したプロジェクトには、ほかのプロジェクトが使っていない色が付きます (9 色を使い切った後は、使っている数がいちばん少ない色)。見出しの ⋯ か右クリックのメニューの「色…」で変えられます。登録していないプロジェクトは灰色です。見出しの「開く」は、同じタブ・同じアドレスのまま (`/p/<鍵>/…`) そのプロジェクトへ切り替えます。ブラウザの通知の許可・ターミナルのシェル・未読の印はそのまま残ります。そのプロジェクトのプロセスが動いていなければ、先に起動してから移ります。code-viewer が起動したプロセスは ⋯ から止められます。この画面で選んでいるプロジェクトは止められません。別のリポジトリで `code-viewer` を実行すると、動いている code-viewer にそのリポジトリを加えて URL を表示します (`code-viewer --standalone` は、これまでどおり 1 つのリポジトリだけの別のサーバを起動します)。画面の URL を表示する CLI (annotate・query diff tables) も、同じ `/p/<鍵>/…` のアドレスを表示します (`--standalone` のサーバには付きません)。10 分使われていないプロジェクトのプロセスは止め、そのプロジェクトを開くと起動し直します (時間は `--idle-stop <秒>` で変えられます。ターミナル・エージェント・未読の印はそのまま残ります)。プロセスが自分で止まったときは、画面にそう出して「再起動」を出します。理由は「詳細」にあります。動かしたまま code-viewer を入れ直すと、プロジェクトのプロセスを起動できなくなります。そのときは画面 (「再起動」を押した後) と、code-viewer を起動した端末に「入口の版が古い」と出ます。その code-viewer を止めて (その端末で Ctrl+C)、code-viewer を打ち直してください。一覧の列の頭のプロジェクト名 (p) から、どの画面でも登録したプロジェクトへ切り替えられます。いまの画面のまま移ります。文字を打つと絞り込み、↑↓ と Enter で移ります。テーマ・言語・文字サイズ・キー割り当て・通知・閉じた案内・画面の配置 (サイドバーの幅と畳み) は全プロジェクト共通なので (設定画面にどの節かを表示します)、移っても見た目は変わりません。",
              },
              {
                kind: "paragraph",
                text: "SP (640px 以下の窓、または横向きの電話) では、エージェントの状態を見て入力待ちに返事する・差分とファイルを読む・プロジェクトを切り替える、の 3 つのために画面の形が変わります。下端の帯から、プロジェクト (左のサイドバー。左端から指に付いて引き出せます)・ファイル・差分・エージェント・一覧 (ファイル一覧か、その画面の一覧を下から出す。History と作業ツリーでは上に一覧、下に選んだコミットの変更ファイル) を開きます。帯には今の画面の印が付き、エージェントには入力待ちの件数が出ます。2 面にはできません (保存した 2 面は広い窓で戻ります)。差分は 1 列 (Unified) が既定で、電話で選んだ 2 列はその場だけ効きます。差分の帯の端の「折り返し」で長い行を折り返します。通知・最下段の件数・全体ボードからエージェントを開くと、引き出しと面は閉じます。指で触る画面では、ボタン・タブ・行・ファイル一覧の高さが 44px 以上になり、ターミナルのタブの下にソフトキーボードに無いキー (Esc・Tab・⇧Tab・Ctrl+C・↑・↓・Enter と、キーボードを出す / しまう ⌨) が出ます。タブ列の右端の数字の四角で、開いているタブを全部 (預けた右の面のタブも) 一覧にします (右の面のタブを開くと左の面へ移ります)。下端の帯から上へ指を動かすと一覧の面が開き、面の頭から下へ動かすと閉じます。エージェント・プロジェクトの見出し・タブ・ファイルの行を長押しすると右クリックのメニューが出ます (プロジェクトのメニューに「上へ」「下へ」があります)。ターミナルの上で 2 本指を広げる・狭めると、このブラウザだけの文字の大きさが変わります (電話は 12px から。デスクトップの大きさはそのまま)。横向きでは最下段を隠し、下端の帯を細くします。設定は目次から開き、節を選ぶと本文だけになり、上の 1 行で目次へ戻ります。ブラウザの通知は安全なページ (https か、同じ機械の localhost) でだけ使えます。別の機械から http で開いた画面では使えません。",
              },
            ],
          },
          {
            title: "作業ツリー",
            blocks: [
              {
                kind: "paragraph",
                text: "タブの「作業ツリー」は、このリポジトリの作業ツリーを本体ぶんも含めて並べます。画面の形は履歴と同じ 3 つの列で、左で作業ツリーを選び、中央にその変更ファイル、右に差分が出ます。コーディングエージェントを作業ツリーごとに走らせると、1 つのチェックアウトの中からは全体が見えなくなります。この画面はそれを見えるようにするためのものです。選んだものは URL に載る (?wt=…&file=…) ので、読み込み直しても同じ差分に戻ります。",
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
                text: "最下段の右の診断のアイコンで、右からスライドする診断シートを開きます。Repository / Diff / History / Datastores などどの画面の上にも重ねて表示でき、開閉状態は URL の ?doctor=open に同期されるのでリンク共有で復元できます。",
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
                    "「ツール」タブの状態 — 各ツール（Markdown / Mermaid / JSON・YAML）に貼り付けた下書きと、最後に使ったツール。",
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
              {
                kind: "paragraph",
                text: "全プロジェクト共通のもの (テーマや言語などの設定・プロジェクトの一覧・アカウント・タブの配置・動いている code-viewer の記録) は $XDG_STATE_HOME/code-viewer に、未設定なら ~/.local/state/code-viewer に置きます。相対パスの XDG_STATE_HOME は XDG の決まりどおり無視し、その理由を 1 回表示します。",
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
                    "複数のデータベースを横並びで開きます。ドラッグで並び替え、+ で空タブ追加、× / 中クリックで閉じる（最後の1枚は空タブにリセット）。並びは .code-viewer/tabs.json に保存されます。データストアを選んでいないタブは「新しいタブ」という名前で、左上の欄から選ぶか「データストア接続を追加」で足すよう案内します。",
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
                    "常駐の bottom dock に 2 タブ。「クエリ履歴」: DB ごとに保存されたクエリのマスター/ディテール、SSE で全タブにライブ同期。「ログ」: このセッションでサーバが実行した SQL すべて (テーブル読み込み / ユーザークエリ / 編集コミット) を所要時間・行数・実行 SQL (シンタックスハイライト) 付きで時系列表示。自動追従 ON で常に最新を表示、下スクロール or 最新以外をクリックすると追従解除。アクティブタブと開閉状態は tabs.json に永続化されます。",
                  ],
                  [
                    "狭い面",
                    "幅が 560px より狭い面 (2 面の左の面など) では、全体検索の入力欄をボタンの上に積み、クエリのツールバーは折り返して、入力欄を潰しません。データストアの選択欄の横に出る失敗の文は次の行に送ります。",
                  ],
                  [
                    "失敗の表示",
                    "読み込みや書き込みに失敗すると、画面には理由の全文 (操作・HTTP の状態・サーバの文言と、元の原因のつながり) を出し、ブラウザの console には操作と対象 (データベース・テーブル・キー・バケットなど) を添えて同じ失敗を出します。",
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
          "キーボードだけでパネル移動、ファイル選択、スクロールを行うためのショートカットです。一覧は設定したキーで出ます。設定 › ショートカット では、どの操作にも別のキーや複数のキーを割り当てられ、キーごとに入力欄の中・端末の中・PWA の窓だけのどこで効くかを選べ、変えた内容を JSON で書き出す・読み込む・直接編集できます。",
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
  /**
   * openedSection: 節を指して開いた (設定の見出しへ送るなど)。電話の段で目次の
   * 1 段目を飛ばしてその節を出す。
   */
  renderHelpPage(options?: { openedSection?: boolean }): void;
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
  deps.renderHelpPage({ openedSection: true });
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

function renderHelpBlock(
  block: Exclude<HelpBlock, { kind: "install" }>,
): HTMLElement {
  if (block.kind === "paragraph") {
    const p = document.createElement("p");
    p.textContent = block.text;
    return p;
  }
  if (block.kind === "steps") return renderHelpSteps(block.items);
  if (block.kind === "command") return renderHelpCommand(block);
  return renderHelpTable(block.rows);
}

function renderHelpSteps(items: string[]): HTMLOListElement {
  const ol = document.createElement("ol");
  ol.className = "gdp-help-steps";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    ol.appendChild(li);
  });
  return ol;
}

/**
 * インストールの案内の中身。ボタンはブラウザがインストールの画面を出せるときだけ
 * (押すと 1 度きりなので、押した後は手順の文だけになる)。
 */
function fillInstallBlock(
  host: HTMLElement,
  block: Extract<HelpBlock, { kind: "install" }>,
  offer: InstallOffer,
): void {
  const children: HTMLElement[] = [];
  if (offer.state() === "prompt") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-btn";
    button.textContent = block.button;
    button.addEventListener("click", () => {
      void offer.install();
    });
    const row = document.createElement("p");
    row.append(button);
    children.push(row);
  }
  children.push(renderHelpSteps(block.steps));
  host.replaceChildren(...children);
}

/** 狭い面で目次を畳んだときの 1 行の見出し (「目次: 今の節」)。 */
const HELP_NAV_TOGGLE_TEXT: Record<HelpLanguage, string> = {
  en: "Contents",
  ja: "目次",
};

/** キーの一覧の上の案内: キーは設定の「ショートカット」で変える。 */
const SHORTCUT_SETTINGS_LINK: Record<
  HelpLanguage,
  { before: string; link: string; after: string }
> = {
  en: {
    before: "Change these keys in ",
    link: "Settings › Shortcuts",
    after: ". Keys marked (PWA) work only in the installed app window.",
  },
  ja: {
    before: "キーは ",
    link: "設定 › ショートカット",
    after:
      " で変えられます。(PWA) の付いたキーは、インストールした窓だけで効きます。",
  },
};

export function createHelpPage(deps: HelpPageDeps) {
  function shortcutSettingsLink(lang: HelpLanguage): HTMLElement {
    const text = SHORTCUT_SETTINGS_LINK[lang];
    const note = document.createElement("p");
    note.className = "gdp-help-shortcut-link";
    const link = document.createElement("a");
    link.href = "#shortcut-settings-title";
    link.textContent = text.link;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      deps.openShortcutSettings();
    });
    note.append(text.before, link, text.after);
    return note;
  }

  // 狭い面 (style.css の @container help-shell) では目次を本文の上に畳む。既定は
  // 畳み、節を選んだらまた畳む (描き直しても開いたままにはしない)。
  // 電話の段では 2 段の画面: 目次を開いている間は目次だけ (1 段目)、節を選ぶと
  // 本文だけ (2 段目。頭の「‹ 目次」で 1 段目へ戻る)。ほかの画面から入ったら
  // 1 段目から (節を指して開いたときは 2 段目)。
  let helpNavOpen = false;
  const phoneQuery = window.matchMedia(PHONE_MEDIA_QUERY);

  function renderHelpPage(options: { openedSection?: boolean } = {}) {
    deps.cancelActiveSourceLoad("navigation");
    deps.removeStandaloneSource();
    deps.clearLoadQueue();
    const target = deps.$("#diff");
    const entering =
      !target.firstElementChild?.classList.contains("gdp-help-shell");
    const openedSection = options.openedSection === true;
    if (phoneQuery.matches && (entering || openedSection))
      helpNavOpen = !openedSection;
    const empty = deps.$("#empty");
    empty.classList.add("hidden");
    deps.$("#meta").textContent = "";

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
    const goToSection = (helpSection: HelpSection) => {
      helpNavOpen = false;
      deps.setRoute({
        screen: "help",
        lang,
        section: helpSection,
        range: deps.currentRange(),
      });
      renderHelpPage();
      deps.syncHeaderMenu();
    };
    const navButton = (label: string, active: boolean, onClick: () => void) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = active ? "active" : "";
      button.textContent = label;
      button.addEventListener("click", onClick);
      helpNav.appendChild(button);
    };
    const navHeading = (label: string) => {
      const heading = document.createElement("div");
      heading.className = "gdp-help-nav-heading";
      heading.textContent = label;
      helpNav.appendChild(heading);
    };
    // 左の列: 設定の分類 (設定の節を分類ごとに出す) とキー割り当て、その下に
    // ヘルプの節。?section= は今までどおり節を指す (分類は設定の節の中の状態)。
    const categories = deps.settingsCategories();
    const activeCategory = deps.getSettingsCategory();
    navHeading(content.sections.settings.nav);
    categories.forEach((category) => {
      navButton(
        category.label,
        section === "settings" && category.id === activeCategory,
        () => {
          deps.setSettingsCategory(category.id);
          goToSection("settings");
        },
      );
      if (category.id === "accounts")
        navButton(
          content.sections.keybindings.nav,
          section === "keybindings",
          () => goToSection("keybindings"),
        );
    });
    navHeading(content.helpNavGroup);
    HELP_SECTIONS.forEach((helpSection) => {
      if (helpSection === "settings" || helpSection === "keybindings") return;
      navButton(
        content.sections[helpSection].nav,
        helpSection === section,
        () => goToSection(helpSection),
      );
    });

    const article = document.createElement("article");
    article.className = "gdp-help-content";
    // ブラウザがインストールの画面を出せるようになった・出せなくなったら、
    // 案内だけ描き直す (この画面に案内が無ければ何もしない)。
    let installBlock: (() => void) | null = null;
    const h2 = document.createElement("h2");
    const intro = document.createElement("p");
    const settingsCategory =
      section === "settings"
        ? categories.find((category) => category.id === activeCategory)
        : undefined;
    h2.textContent = settingsCategory?.label ?? sectionContent.title;
    intro.textContent = settingsCategory?.description ?? sectionContent.intro;
    article.append(h2, intro);
    if (section === "keybindings") article.append(shortcutSettingsLink(lang));
    sectionGroups.forEach((group) => {
      const groupSection = document.createElement("section");
      groupSection.className = "gdp-help-group";
      const groupTitle = document.createElement("h3");
      groupTitle.textContent = group.title;
      groupSection.append(groupTitle);
      group.blocks.forEach((block) => {
        if (block.kind !== "install") {
          groupSection.appendChild(renderHelpBlock(block));
          return;
        }
        if (deps.installOffer.state() === "hidden") return;
        const host = document.createElement("div");
        host.className = "gdp-help-install";
        fillInstallBlock(host, block, deps.installOffer);
        installBlock = () => fillInstallBlock(host, block, deps.installOffer);
        groupSection.appendChild(host);
      });
      article.appendChild(groupSection);
    });
    // フォーム部品は HelpBlock では表せないので、静的コンテンツを組んだ後で
    // 差し込む。
    if (section === "settings") deps.mountViewerSettings(article);
    deps.installOffer.onChange(installBlock);

    // 狭い面だけで見える、目次を開閉する 1 行 (広い面では CSS が隠す)。
    helpNav.id = "gdp-help-nav";
    const activeLabel =
      helpNav.querySelector<HTMLButtonElement>("button.active")?.textContent ??
      "";
    const navToggle = document.createElement("button");
    navToggle.type = "button";
    navToggle.className = "gdp-help-nav-toggle";
    navToggle.setAttribute("aria-controls", helpNav.id);
    const syncNavOpen = () => {
      layout.classList.toggle("gdp-help-nav-open", helpNavOpen);
      navToggle.setAttribute("aria-expanded", String(helpNavOpen));
    };
    const toggleLabel = document.createElement("span");
    toggleLabel.className = "gdp-help-nav-toggle-label";
    toggleLabel.textContent = HELP_NAV_TOGGLE_TEXT[lang];
    const toggleCurrent = document.createElement("span");
    toggleCurrent.className = "gdp-help-nav-toggle-current";
    toggleCurrent.textContent = activeLabel;
    navToggle.append(toggleLabel, toggleCurrent);
    navToggle.addEventListener("click", () => {
      helpNavOpen = !helpNavOpen;
      syncNavOpen();
    });
    syncNavOpen();

    layout.append(navToggle, helpNav, article);
    // 設定の検索はどの節でも同じ場所に置く (節を移っても左の列が動かない)。
    // ヘルプの節で打ち始めたら、結果を出す設定の節へ移る。
    const searchRow = document.createElement("div");
    searchRow.className = "gdp-help-search-row";
    deps.mountSettingsSearch(searchRow);
    if (section !== "settings")
      searchRow.addEventListener("input", (event) => {
        const field = event.target;
        goToSection("settings");
        if (field instanceof HTMLInputElement) field.focus();
      });
    // 電話の段の目次 (1 段目) で打ち始めたら、結果を出す設定の節 (2 段目) へ。
    else
      searchRow.addEventListener("input", () => {
        if (!helpNavOpen) return;
        helpNavOpen = false;
        syncNavOpen();
      });
    shell.append(header, searchRow, layout);
    target.replaceChildren(shell);
  }

  return { renderHelpPage };
}
