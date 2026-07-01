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
import {
  configureExternalCommands,
  type ExternalCommandOverride,
  parseExternalCommandOverride,
} from "./command-resolver";
import { buildDoctorReport } from "./doctor";
import { DOCTOR_AGENT_HELP } from "./doctor-agent-help";
import { DEFAULT_WORKTREE_OMIT_DIR_NAMES } from "./git";

const DOCTOR_HELP = `code-viewer doctor — diagnose the current environment

Usage:
  code-viewer doctor [--cwd <path>] [--port <N>] [--json] [--bin <git|docker>=<path>]
  code-viewer doctor agent-help

Options:
  --cwd <path>   Working directory to inspect (default: process.cwd()).
  --port <N>     Listening port to mention in the report (default: 0 = no server).
  --bin <n>=<p>  Override git/docker executable path. Repeatable.
  --json         Print the full DoctorReport as JSON instead of a summary.
  --help, -h     Show this help.

Run "code-viewer doctor agent-help" for an AI-agent oriented guide.

Exit codes:
  0  worst status is "ok" or "warn"
  1  worst status is "error"
  2  invalid arguments
`;

type DoctorCliArgs = {
  cwd: string;
  port: number;
  json: boolean;
  commandOverrides?: ExternalCommandOverride[];
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
  const commandOverrides: ExternalCommandOverride[] = [];
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
    if (arg === "--bin") {
      const next = argv[++i];
      if (!next) {
        return {
          kind: "error",
          message: "--bin requires <name>=<absolute-path>",
        };
      }
      const parsed = parseExternalCommandOverride(next, "--bin", [
        "git",
        "docker",
      ]);
      if (parsed.ok === false) return { kind: "error", message: parsed.error };
      commandOverrides.push(parsed.override);
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
  return {
    kind: "run",
    args: {
      cwd,
      port,
      json,
      ...(commandOverrides.length ? { commandOverrides } : {}),
    },
  };
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
  const { cwd, port, json, commandOverrides = [] } = parsed.args;
  const commandConfig = configureExternalCommands({
    cwd,
    cliOverrides: commandOverrides,
    allowedNames: ["git", "docker"],
  });
  if (commandConfig.ok === false) {
    process.stderr.write(`code-viewer doctor: ${commandConfig.error}\n`);
    process.exit(2);
  }
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
