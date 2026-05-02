# code-viewer

Local browser-based code and git diff viewer.

Requires [Bun](https://bun.sh/) on your `PATH`.

## Features

- Browse repository files and folders in a persistent sidebar.
- View git diffs with unified or split layout, lazy loading, and viewed-file state.
- Open files directly from the repository or diff view, including large generated files.
- Preview Markdown with a table of contents, task lists, Mermaid diagrams, and Shiki code highlighting.
- Preview browser-safe media and show metadata for binary files that cannot be rendered.
- Open repository folders in the OS file manager from localhost-only actions.
- Upload files into worktree folders when upload is explicitly enabled.

## Usage

```sh
bunx @youtyan/code-viewer --cwd /path/to/repo
```

Or after installing globally:

```sh
npm install -g @youtyan/code-viewer
code-viewer --cwd /path/to/repo
```

Arguments after options are passed to `git diff`. By default it compares
`HEAD` with the working tree.

```sh
code-viewer HEAD~1 HEAD
code-viewer --cwd /path/to/repo --staged
```

Pass `--open` only when you want the browser opened automatically.

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
  "upload": {
    "enabled": true
  }
}
```

Uploads are accepted only for the worktree target. Git tree views remain
read-only.

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
