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

File uploads are disabled by default. Enable them only for trusted local
worktrees:

```sh
code-viewer --cwd /path/to/repo --allow-upload
```

Or place `.code-viewer.json` at the repository root:

```json
{
  "version": 1,
  "upload": {
    "enabled": true
  },
  "scope": {
    "omitDirs": ["node_modules", "dist", "build"]
  }
}
```

Uploads are accepted only for the worktree target. Git tree views remain
read-only.

Repository scope settings control recursive repository browsing and search scope
for the left tree, Ctrl+K file palette, and Ctrl+G grep palette. The in-app Scope
Settings popover stores only a browser-local override in localStorage; edit
`.code-viewer.json` directly for project defaults shared with the repository.

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
