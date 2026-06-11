# code-viewer

Local browser-based code and git diff viewer.

Requires Node.js 20 or newer when installed from npm. Development uses
[Bun](https://bun.sh/).

## Features

- Browse repository files and folders in a persistent sidebar.
- View git diffs with unified or split layout, lazy loading, and viewed-file state.
- Open files directly from the repository or diff view, including large generated files.
- Preview Markdown with a table of contents, task lists, Mermaid diagrams, and Shiki code highlighting.
- Preview browser-safe media and show metadata for binary files that cannot be rendered.
- Open repository folders in the OS file manager from localhost-only actions.
- Upload files into worktree folders when upload is explicitly enabled.

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

Equivalent one-shot commands also work:

```sh
pnpm dlx @youtyan/code-viewer
bunx @youtyan/code-viewer
```

Or install it globally:

```sh
npm install -g @youtyan/code-viewer
code-viewer
```

The published CLI runs on Node.js 20 or newer. Bun is supported as a package
runner through `bunx`, but the npm package no longer requires Bun at runtime.

Arguments after options are passed to `git diff`. By default, code-viewer
compares `HEAD` with the working tree.

```sh
npx @youtyan/code-viewer HEAD~1 HEAD
npx @youtyan/code-viewer --staged
code-viewer HEAD~1 HEAD
code-viewer --cwd /path/to/repo --staged
```

## Repository View

Open the root URL to browse the repository tree. Folder pages keep the sidebar
visible, and file pages show a preview when the browser can safely render the
file. Unsupported binary files show a clear unavailable state with file
metadata instead of dumping bytes as text.

Markdown files use a dedicated preview tab. Relative links and images are
resolved inside the repository, code blocks are highlighted with Shiki, and
Mermaid diagrams are rendered lazily in the browser.

Very large text files use a virtualized source viewer. Only visible rows are
rendered, and the page includes controls to copy the full file or reopen it in
the full non-virtual view.

## Uploads

File uploads are available for the local worktree target. Git tree views remain
read-only.

Place `.code-viewer.json` at the repository root to configure repository scope
defaults:

```json
{
  "version": 1,
  "scope": {
    "omitDirs": ["node_modules", "dist", "build"]
  }
}
```

Repository scope settings control recursive repository browsing and search scope
for the left tree, Ctrl+K file palette, and Ctrl+G grep palette. The in-app Scope
Settings popover stores only a browser-local override in localStorage; edit
`.code-viewer.json` directly for project defaults shared with the repository.
Use `scope.omitDirs` for directories that should stay visible as skipped, and
`scope.excludeNames` for file or directory names that should be hidden entirely.
`.DS_Store` is hidden by default.

## AI Code Annotations

AI coding agents (Claude Code, Codex, and similar CLI agents) can walk you
through a codebase inside the viewer. An agent posts explanations for
specific code locations with the `annotate` subcommand, and every open
browser tab jumps to that location live — in the diff view when the file has
changes in the current range, or in the source view otherwise:

```sh
code-viewer annotate start --title "How the SSE update flow works"
code-viewer annotate add --file web-src/server/preview.ts --line 2330-2360 \
  --body "Each browser tab keeps one SSE stream open against this endpoint."
code-viewer annotate add --file web-src/app.ts --line 9650 \
  --from HEAD~1 --to worktree \
  --body "After the fix, reloads preserve the scroll position here."
```

The body is Markdown. Long bodies can be passed with `--body-file <path>` or
piped through stdin. `code-viewer annotate --help` shows all commands,
including `list`, `delete <id>`, and `clear`. For AI agents,
`code-viewer annotate agent-help` prints a skill-style guide covering the
workflow, conventions, and pitfalls for writing good walkthroughs.

Annotations are grouped into sessions and persisted in
`.code-viewer/annotations.json` at the repository root, so the walkthrough
survives reloads and server restarts. The `.code-viewer` directory is
tool-internal: it never shows up in the file tree, searches, or diffs. Add it
to `.gitignore` if you do not want to share annotations through git.

In the browser, the 💬 button in the header opens the annotation side panel.
The current explanation is rendered at the top of the panel while the code
stays visible next to it, with the annotated lines highlighted. The history
below groups annotations by session; clicking an entry jumps back to its
location, and entries and sessions can be deleted there too. The "follow"
checkbox controls whether the tab jumps automatically when an agent adds a
new annotation.

The `annotate` subcommand talks to the running server for the repository
(discovered via `~/.cache/code-viewer/servers/`); start one with
`code-viewer` first. Pass `--cwd <repo>` when annotating a repository other
than the current directory, or `--server <url>` to target a specific server.

`add` appends to the most recent session (creating one when none exists);
run `annotate start` again to begin a new session, or pass `--session <id>`
to target a specific one.

### Agent Skill

The package bundles an [Agent Skill](https://agentskills.io) (the SKILL.md
open standard) that teaches AI coding agents when and how to use
`annotate`. Install it into the current project:

```sh
npx -y @youtyan/code-viewer skill install                       # Claude Code (.claude/skills/)
npx -y @youtyan/code-viewer skill install --agent codex,gemini  # other agents
npx -y @youtyan/code-viewer skill install --agent all           # claude, codex, gemini, cursor, .agents
```

Or install it once for all projects with `--global` (`~/.claude/skills/`
etc). Running the same command again updates an existing installation.

## Development

```sh
bun install
bun run verify
bun run preview --cwd /path/to/repo
```

`bun run preview` is the development runner. It rebuilds the browser bundle
when browser source files change, restarts the preview server when
`web-src/server/*.ts` changes, and keeps the URL stable on
`http://127.0.0.1:64160/` unless you pass `--port <port>`.

Before releasing:

```sh
bun run verify
npm pack --dry-run
```

## License

MIT. Third-party licenses for bundled browser assets are included under
`web/vendor/*`.
