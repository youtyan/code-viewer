// `code-viewer doctor` subcommand. Reuses buildDoctorReport from doctor.ts
// and emits either a human-readable summary (default) or the raw
// DoctorReport JSON (--json), so an AI agent can introspect the runtime,
// SQLite driver, git, Docker discovery, and snapshot store status without
// scraping the HTTP /_doctor endpoint or the browser UI.

import type {
  DoctorGroup,
  DoctorReport,
  DoctorStatus,
} from "../core/doctor-types";
import { buildDoctorReport } from "./doctor";
import { DEFAULT_WORKTREE_OMIT_DIR_NAMES } from "./git";

const DOCTOR_HELP = `code-viewer doctor — diagnose the current environment

Usage:
  code-viewer doctor [--cwd <path>] [--port <N>] [--json]
  code-viewer doctor agent-help

Options:
  --cwd <path>   Working directory to inspect (default: process.cwd()).
  --port <N>     Listening port to mention in the report (default: 0 = no server).
  --json         Print the full DoctorReport as JSON instead of a summary.
  --help, -h     Show this help.

Run "code-viewer doctor agent-help" for an AI-agent oriented guide.

Exit codes:
  0  worst status is "ok" or "warn"
  1  worst status is "error"
  2  invalid arguments
`;

export const DOCTOR_AGENT_HELP = `code-viewer doctor — agent guide

You are an AI coding agent. Use this command to inspect the human's local
environment in one machine-readable shot, instead of asking them to run a
bunch of probing commands or open the 🩺 browser panel.

## When to use

- A previous command failed; you want to confirm Node / Bun / SQLite /
  Docker / git state before suggesting a fix.
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
      { "id": "runtime"|"package"|"sqlite"|"snapshot"|"git"
            |"discovery"|"docker"|"server",
        "title": string,
        "rows": [
          { "id": string, "title": string,
            "status": "ok"|"warn"|"error",
            "detail"?: string, "hint"?: string } ]
      }
    ]
  }

The exit code is 1 iff \`worstStatus === "error"\` — never on \`warn\`.

## Reading guidance

- Filter to actionable rows: \`.groups[].rows[] | select(.status != "ok")\`.
- \`hint\` is the human-readable fix; quote it verbatim when reporting back.
- A \`runtime.node\` row failing means Node < 20 — almost everything else
  is downstream of that. Fix it first.
- A \`sqlite.*\` row failing usually points at npx cache; the hint shows
  the rm -rf ~/.npm/_npx workaround.
- Docker rows are advisory — \`code-viewer\` works without Docker; warnings
  in that group only matter if the human asked about Datastores.
- Do not parse the human-readable output (without --json); the JSON is
  the contract.
`;

type DoctorCliArgs = {
  cwd: string;
  port: number;
  json: boolean;
};

export type DoctorCliParseResult =
  | { kind: "help" }
  | { kind: "agent-help" }
  | { kind: "run"; args: DoctorCliArgs }
  | { kind: "error"; message: string };

export function parseDoctorCliArgs(argv: string[]): DoctorCliParseResult {
  let cwd = process.cwd();
  let port = 0;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h" || arg === "help") {
      return { kind: "help" };
    }
    if (arg === "agent-help") {
      return { kind: "agent-help" };
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--cwd") {
      const next = argv[++i];
      if (!next) return { kind: "error", message: "--cwd requires a value" };
      cwd = next;
      continue;
    }
    if (arg === "--port") {
      const next = argv[++i];
      if (!next) return { kind: "error", message: "--port requires a value" };
      const n = Number.parseInt(next, 10);
      if (!Number.isFinite(n) || n < 0 || n > 65535) {
        return {
          kind: "error",
          message: `--port must be 0-65535 (got ${next})`,
        };
      }
      port = n;
      continue;
    }
    return { kind: "error", message: `unknown argument: ${arg}` };
  }
  return { kind: "run", args: { cwd, port, json } };
}

const STATUS_SYMBOL: Record<DoctorStatus, string> = {
  ok: "✓",
  warn: "⚠",
  error: "✗",
};

// Render a DoctorReport as a stable, grep-friendly plain-text summary.
// Kept pure so tests can pin the exact output shape independently from
// buildDoctorReport's environment-dependent fields.
export function formatDoctorReportText(report: DoctorReport): string {
  const lines: string[] = [];
  for (const group of report.groups) {
    lines.push(`${groupSymbol(group)} ${group.title}`);
    for (const row of group.rows) {
      const sym = STATUS_SYMBOL[row.status];
      const detail = row.detail ? ` — ${row.detail}` : "";
      lines.push(`  ${sym} ${row.title}${detail}`);
      if (row.hint && row.status !== "ok") {
        lines.push(`     hint: ${row.hint}`);
      }
    }
  }
  lines.push("");
  lines.push(`Worst status: ${report.worstStatus}`);
  return lines.join("\n");
}

function groupSymbol(group: DoctorGroup): string {
  let worst: DoctorStatus = "ok";
  for (const row of group.rows) {
    if (row.status === "error") return STATUS_SYMBOL.error;
    if (row.status === "warn") worst = "warn";
  }
  return STATUS_SYMBOL[worst];
}

export function exitCodeForReport(report: DoctorReport): number {
  return report.worstStatus === "error" ? 1 : 0;
}

export async function runDoctorCli(argv: string[]): Promise<void> {
  const parsed = parseDoctorCliArgs(argv);
  if (parsed.kind === "error") {
    process.stderr.write(`code-viewer doctor: ${parsed.message}\n`);
    process.stderr.write(`Run "code-viewer doctor --help" for usage.\n`);
    process.exit(2);
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${DOCTOR_HELP}`);
    return;
  }
  if (parsed.kind === "agent-help") {
    process.stdout.write(`${DOCTOR_AGENT_HELP}\n`);
    return;
  }
  const { cwd, port, json } = parsed.args;
  const report = await buildDoctorReport({
    cwd,
    scopeOmitDirNames: DEFAULT_WORKTREE_OMIT_DIR_NAMES,
    listenPort: port,
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatDoctorReportText(report)}\n`);
  }
  const code = exitCodeForReport(report);
  if (code !== 0) process.exit(code);
}
