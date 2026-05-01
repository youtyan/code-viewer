# code-viewer

Local browser-based git diff viewer.

Requires [Bun](https://bun.sh/) on your `PATH`.

## Usage

```sh
bunx @youtyan/code-viewer --cwd /path/to/repo --open
```

Or after installing globally:

```sh
npm install -g @youtyan/code-viewer
code-viewer --cwd /path/to/repo --open
```

Arguments after options are passed to `git diff`. By default it compares
`HEAD` with the working tree.

```sh
code-viewer --open HEAD~1 HEAD
code-viewer --cwd /path/to/repo --open --staged
```

## Development

```sh
bun install
bun run verify
bun run preview --cwd /path/to/repo --open
```

## License

MIT. Third-party licenses for bundled browser assets are included under
`web/vendor/*`.
