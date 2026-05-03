# Search Palette Design

## Goal

Make file search fast enough to use as the primary navigation path.

`Ctrl+K` opens an Alfred-style file palette. `Ctrl+G` opens the same palette in grep mode. Both shortcuts are palette-only. The existing sidebar search remains a lightweight visible-list filter and is focused with `/`.

## Scope Rules

The palette never mixes diff-only and repository-wide scopes.

- Diff screen: file search uses a snapshot of `STATE.files` at palette open time. Results include only files in the current diff.
- Diff screen: grep searches only the current diff files.
- Repository screen: file search uses all repository files for the current ref.
- Repository screen: grep searches the repository for the current ref.
- Repository blob screen: file search and grep use all repository files for the current blob ref.
- Diff file detail screen: file search and grep use current diff files.

Renamed files in diff scope match both `path` and `old_path`. Selection always navigates to the current `path`.

## Palette UI

The palette appears centered near the top of the viewport with a large search input and a result list below it.

- `Ctrl+K`: file mode.
- `Ctrl+G`: grep mode.
- `Esc`: closes the palette. While open, the palette owns `Esc`.
- `Enter`: opens the selected result. `Enter` is ignored during IME composition.
- `ArrowUp` / `ArrowDown`: move selection.
- `Ctrl+P` / `Ctrl+N`: move selection.
- Only the top 50 results are rendered.
- Selection is tracked with `aria-activedescendant`.
- File results show filename first and full path second.
- Grep results show `path:line` first and the matching line preview second.

## File Search

Diff file search is client-only from the `STATE.files` snapshot.

Repository file search uses a dedicated read-only `/_files` endpoint instead of repeatedly calling `/_tree?recursive=1`.

`/_files` response:

```ts
type FileSearchListResponse = {
  ref: string;
  generation: number;
  files: { path: string; type: 'blob' | 'commit' }[];
  truncated: boolean;
};
```

The server caches results by `ref` and `generation`. The client also caches by `ref` and clears the cache when server generation changes.

The fuzzy matcher returns `{ score, ranges }`. It supports subsequence matching, with bonuses for contiguous runs, segment boundaries, basename matches, and path suffix matches. Basename matches are weighted higher than directory-only matches.

## Grep Search

`/_grep` is a read-only endpoint.

Request:

```text
GET /_grep?ref=<ref|worktree>&q=<query>&max=<number>
```

Response:

```ts
type GrepResponse = {
  ref: string;
  engine: 'rg' | 'git' | 'fallback';
  truncated: boolean;
  matches: {
    path: string;
    line: number;
    column: number;
    preview: string;
  }[];
};
```

Limits:

- Default max results: 200.
- Absolute max results: 500.
- Timeout: 5 seconds.
- One active grep process at a time.
- Client debounce: 80 ms.
- Client cancels stale requests with `AbortController`.

Worktree grep uses `rg` when available. Git refs use `git grep`. Worktree fallback grep is fixed-string only and skips binary files, `.git`, `node_modules`, symlinks, and files larger than 2 MB.

`rg` must be spawned with an argument array. It must not follow symlinks and must not force binary files as text. Query text is passed with `-e <query>` and path arguments after `--`.

Diff-screen grep passes the current diff file list to the server so only those files are searched.

## Navigation

File palette selection:

- Diff screen: `scrollToFile(file.path)`.
- Repository or repository blob screen: route to `/file?path=<path>&target=<ref>`.
- Diff file detail screen: route to the selected diff file detail.

Grep selection:

- Diff screen: scrolls to the file first. Hunk-level line scrolling can be added later.
- Repository or repository blob screen: route to `/file?path=<path>&target=<ref>&line=<line>`.
- File route parsing and building support an optional `line` parameter.

## Testing

Add focused unit tests for:

- Fuzzy scoring and matched ranges.
- Diff scope includes only diff files and matches rename `old_path`.
- Repository file list response schema.
- Grep endpoint caps results and validates path scope.
- Route parse/build preserves optional file line.
- Palette keyboard behavior: open shortcuts, selection movement, IME Enter guard, and `Esc` close.

## Claude Review Notes

Claude reviewed the implementation design before coding. Adopted findings:

- `Ctrl+K` and `Ctrl+G` must be palette-only.
- The sidebar filter fallback must remain `/`.
- Diff search must snapshot `STATE.files`.
- `/file` screen behavior must be explicit.
- Repository file search needs a dedicated cached endpoint.
- Grep needs a schema, caps, timeout, cancellation, and safe spawn rules.
- IME and `Esc` handling must be explicit.
