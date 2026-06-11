import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT } from "./root";

const SKILL_NAME = "code-viewer-annotate";

// Skill directory name per agent. SKILL.md is an open standard; only the
// install location differs. "agents" is the vendor-neutral .agents/skills.
export const AGENT_SKILL_DIRS = {
  claude: ".claude",
  codex: ".codex",
  gemini: ".gemini",
  cursor: ".cursor",
  agents: ".agents",
} as const;

export type AgentName = keyof typeof AGENT_SKILL_DIRS;

const AGENT_NAMES = Object.keys(AGENT_SKILL_DIRS) as AgentName[];

export const SKILL_HELP = `code-viewer skill — manage the bundled agent skill

Usage:
  code-viewer skill install [--agent <list>] [--global] [--cwd <dir>]

Installs the ${SKILL_NAME} skill (SKILL.md for AI coding agents) into the
skills directory of each selected agent in the current project, or into the
home directory equivalents with --global. Running install again overwrites
the files, so the same command also updates an existing installation.

Options:
  --agent <list>  comma separated agents: ${AGENT_NAMES.join(", ")}, or all
                  (default: claude)
  --global        install into the home directory (~/.claude/skills/ etc)
  --cwd <dir>     project directory to install into (ignored with --global)

Examples:
  code-viewer skill install
  code-viewer skill install --agent claude,codex,gemini
  code-viewer skill install --agent all --global
`;

export type SkillArgs =
  | { kind: "help" }
  | { kind: "install"; agents: AgentName[]; global: boolean; cwd?: string };

export type SkillParseResult =
  | { ok: true; args: SkillArgs }
  | { ok: false; error: string };

function parseAgentList(value: string): AgentName[] | null {
  if (value === "all") return [...AGENT_NAMES];
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  const result: AgentName[] = [];
  for (const name of names) {
    if (!(name in AGENT_SKILL_DIRS)) return null;
    const agent = name as AgentName;
    if (!result.includes(agent)) result.push(agent);
  }
  return result;
}

export function parseSkillArgs(argv: string[]): SkillParseResult {
  if (argv.length === 0 || argv.includes("--help") || argv[0] === "help") {
    return { ok: true, args: { kind: "help" } };
  }
  const [command, ...rest] = argv;
  if (command !== "install") {
    return { ok: false, error: `unknown skill command: ${command}` };
  }
  let global = false;
  let cwd: string | undefined;
  let agents: AgentName[] = ["claude"];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--global") {
      global = true;
    } else if (arg === "--cwd") {
      cwd = rest[++i];
      if (!cwd) return { ok: false, error: "--cwd requires a directory" };
    } else if (arg === "--agent") {
      const value = rest[++i];
      if (!value) return { ok: false, error: "--agent requires a list" };
      const parsed = parseAgentList(value);
      if (!parsed) {
        return {
          ok: false,
          error: `unknown agent in "${value}" (valid: ${AGENT_NAMES.join(", ")}, all)`,
        };
      }
      agents = parsed;
    } else {
      return { ok: false, error: `unknown option: ${arg}` };
    }
  }
  return { ok: true, args: { kind: "install", agents, global, cwd } };
}

export type InstallSkillDeps = {
  sourceDir: string;
  homeDir: string;
  projectDir: string;
};

export type InstallSkillResult =
  | {
      ok: true;
      results: {
        agent: AgentName;
        action: "installed" | "updated";
        target: string;
      }[];
    }
  | { ok: false; error: string };

export function installSkill(
  args: { agents: AgentName[]; global: boolean; cwd?: string },
  deps: InstallSkillDeps,
): InstallSkillResult {
  if (!existsSync(join(deps.sourceDir, "SKILL.md"))) {
    return {
      ok: false,
      error: `bundled skill not found at ${deps.sourceDir}`,
    };
  }
  const base = args.global
    ? deps.homeDir
    : resolve(args.cwd ?? deps.projectDir);
  const results: {
    agent: AgentName;
    action: "installed" | "updated";
    target: string;
  }[] = [];
  for (const agent of args.agents) {
    const target = join(base, AGENT_SKILL_DIRS[agent], "skills", SKILL_NAME);
    const action = existsSync(target) ? "updated" : "installed";
    try {
      mkdirSync(target, { recursive: true });
      cpSync(deps.sourceDir, target, { recursive: true });
    } catch (error) {
      return { ok: false, error: String(error) };
    }
    results.push({ agent, action, target });
  }
  return { ok: true, results };
}

export function runSkillCli(argv: string[]): void {
  const parsed = parseSkillArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error('Run "code-viewer skill --help" for usage.');
    process.exit(1);
  }
  if (parsed.args.kind === "help") {
    console.log(SKILL_HELP);
    return;
  }
  const result = installSkill(parsed.args, {
    sourceDir: join(ROOT, "skills", SKILL_NAME),
    homeDir: homedir(),
    projectDir: process.cwd(),
  });
  if (result.ok === false) {
    console.error(result.error);
    process.exit(1);
  }
  for (const entry of result.results) {
    console.log(`${entry.action} (${entry.agent}): ${entry.target}`);
  }
  if (result.results.some((entry) => entry.action === "installed")) {
    console.log("Re-run the same command anytime to update the skill.");
  }
}
