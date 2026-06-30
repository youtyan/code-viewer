// Top-level `code-viewer agent-help` aggregator. Lets an AI coding agent
// discover every AI-facing subcommand guide (query / annotate / skill /
// doctor / search) by running ONE command, instead of guessing which
// subcommand to agent-help into first.
//
// Implementation rule: we MUST NOT copy any text from the subcommand guides.
// The signature line of each *_AGENT_HELP is imported and rendered through
// firstLine() so that any rename in the underlying constant flows here
// automatically and nothing drifts.

import { ANNOTATE_AGENT_HELP } from "./annotate-cli";
import { DOCTOR_AGENT_HELP } from "./doctor-agent-help";
import { QUERY_AGENT_HELP } from "./query-cli";
import { SEARCH_AGENT_HELP } from "./search-cli";
import { SKILL_AGENT_HELP } from "./skill-cli";

export type AgentGuideEntry = {
  name: "query" | "annotate" | "search" | "skill" | "doctor";
  signature: string;
  rerun: string;
};

export type AgentHelpArgs = { ok: true } | { ok: false; error: string };

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

export const AGENT_GUIDES: readonly AgentGuideEntry[] = [
  {
    name: "query",
    signature: firstLine(QUERY_AGENT_HELP),
    rerun: "code-viewer query agent-help",
  },
  {
    name: "annotate",
    signature: firstLine(ANNOTATE_AGENT_HELP),
    rerun: "code-viewer annotate agent-help",
  },
  {
    name: "search",
    signature: firstLine(SEARCH_AGENT_HELP),
    rerun: "code-viewer search agent-help",
  },
  {
    name: "skill",
    signature: firstLine(SKILL_AGENT_HELP),
    rerun: "code-viewer skill agent-help",
  },
  {
    name: "doctor",
    signature: firstLine(DOCTOR_AGENT_HELP),
    rerun: "code-viewer doctor agent-help",
  },
];

export function buildAgentHelpIndex(): string {
  const lines: string[] = [
    "code-viewer — agent-help index",
    "",
    "You are an AI coding agent. This is the single entry point for",
    "discovering every AI-facing subcommand guide bundled with code-viewer.",
    "Each entry below shows the guide's signature line (imported live from",
    "the subcommand module) and the command that prints the full guide.",
    "",
    "Subcommand guides:",
    "",
  ];
  for (const guide of AGENT_GUIDES) {
    lines.push(`- ${guide.name}`);
    lines.push(`    ${guide.signature}`);
    lines.push(`    Full guide: ${guide.rerun}`);
    lines.push("");
  }
  lines.push("Tip: re-run this index any time with: code-viewer agent-help");
  return `${lines.join("\n")}\n`;
}

export function parseAgentHelpArgs(argv: string[]): AgentHelpArgs {
  if (argv.length === 0) return { ok: true };
  return {
    ok: false,
    error: "agent-help does not accept arguments",
  };
}

export function runAgentHelp(argv: string[] = []): void {
  const parsed = parseAgentHelpArgs(argv);
  if (parsed.ok === false) {
    process.stderr.write(`${parsed.error}\n`);
    process.exit(2);
  }
  process.stdout.write(buildAgentHelpIndex());
}
