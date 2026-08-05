export const DOCTOR_AGENT_HELP = `code-viewer doctor — agent guide

You are an AI coding agent. Use this command to inspect the human's local
environment in one machine-readable shot, instead of asking them to run a
bunch of probing commands or open the 🩺 browser panel.

## When to use

- A previous command failed; you want to confirm Node / Bun / SQLite /
  Docker / git / rg / gh / tmux / node-pty state before suggesting a fix.
- The human asks "is my environment OK", "why does install fail", or
  similar; \`code-viewer doctor\` is the single source of truth.
- Pre-flight before a destructive step (DB snapshot reset, npx upgrade)
  so you can show "before" state.
- CI: \`code-viewer doctor --json | jq\` gates a step on environment
  readiness (exit code 1 ⇔ any row is ERROR).

## How to call

The same report as the 🩺 panel and \`/_doctor\` endpoint, no server
needed:

  code-viewer doctor --json

To target another working directory or pretend a specific port is bound:

  code-viewer doctor --cwd /path/to/repo --port 64160 --json

If \`code-viewer\` is not on PATH (the human launches via npx), use:

  npx -y @youtyan/code-viewer doctor --json

## Report shape

Stable JSON contract (see core/doctor-types.ts):

  {
    "generation": number,         // monotonic, restart resets to 1
    "worstStatus": "ok"|"warn"|"error",
    "groups": [
      { "id": "runtime"|"package"|"sqlite"|"snapshot"|"git"|"search"
            |"github"|"discovery"|"datastore"|"docker"|"terminal"|"server",
        "title": string,
        "rows": [
          { "id": string, "title": string,
            "status": "ok"|"warn"|"error",
            "detail"?: string, "hint"?: string } ]
      }
    ]
  }

The "datastore" group runs a minimal read round-trip against every
source discovered by /_db/files (SQLite open + tables, docker SQL
getTables, Redis listDatabases, Elasticsearch listIndices, S3
listBuckets). Each source becomes one row; success = ok, connection
failure or 2s timeout = warn. Failure rows include a paste-safe hint:
SQL sources get a "code-viewer query schemas --db '<id>' --json"
command (no --server: the query CLI auto-discovery resolves it at
paste time); Redis / Elasticsearch / S3 point at the browser's
Datastores tab. When nothing was discovered the group is still
emitted with one informative "datastore.none" row (status ok) instead
of disappearing.

The exit code is 1 iff \`worstStatus === "error"\` — never on \`warn\`.

## Reading guidance

- Filter to actionable rows: \`.groups[].rows[] | select(.status != "ok")\`.
- \`hint\` is the human-readable fix; quote it verbatim when reporting back.
- A \`runtime.node\` row failing means Node < 20 — almost everything else
  is downstream of that. Fix it first.
- A \`github.gh\` row warning means GitHub Issue listing/linking cannot use
  the GitHub CLI yet. Install \`gh\` or pass \`--bin gh=/absolute/path\`.
  Doctor intentionally does not inspect GitHub auth metadata.
- A \`search.rg\` row warning means fast search and regular-expression
  search are unavailable. Fixed-string search can still use the built-in
  fallback. Install \`rg\` or pass \`--bin rg=/absolute/path\`.
- A \`terminal.tmux\` warning affects the tmux session tree, not ordinary
  browser shells. Install \`tmux\` or pass \`--bin tmux=/absolute/path\`.
- A \`terminal.node-pty\` warning means browser shells cannot open. This is
  an optional npm dependency and should normally arrive with npx; follow the
  row's native-module installation hint instead of looking for it on PATH.
- A \`sqlite.*\` row failing usually points at npx cache; the hint shows
  the rm -rf ~/.npm/_npx workaround.
- Docker rows are advisory — \`code-viewer\` works without Docker; warnings
  in that group only matter if the human asked about Datastores.
- Do not parse the human-readable output (without --json); the JSON is
  the contract.
`;
