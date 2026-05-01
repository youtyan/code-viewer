# code-viewer

Local browser-based git diff viewer.

Requires [Bun](https://bun.sh/) on your `PATH`.

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

## Development

```sh
bun install
bun run verify
bun run preview --cwd /path/to/repo
```

`bun run preview` is the development runner. It rebuilds the browser bundle
when `web-src/app.ts` changes, restarts the preview server when
`web-src/server/*.ts` changes, and keeps the URL stable on
`http://127.0.0.1:64160/` unless you pass `--port <port>`.

## License

MIT. Third-party licenses for bundled browser assets are included under
`web/vendor/*`.
