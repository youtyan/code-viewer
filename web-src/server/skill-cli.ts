import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT } from "./root";

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

export const SKILL_HELP = `code-viewer skill — manage the bundled agent skills

Usage:
  code-viewer skill install [--agent <list>] [--global] [--cwd <dir>]
  code-viewer skill agent-help

Installs every bundled skill (each SKILL.md directory under the package's
skills/) into the skills directory of each selected agent in the current
project, or into the home directory equivalents with --global. Running
install again overwrites the files, so the same command also updates an
existing installation.

Options:
  --agent <list>  comma separated agents: ${AGENT_NAMES.join(", ")}, or all
                  (default: claude)
  --global        install into the home directory (~/.claude/skills/ etc)
  --cwd <dir>     project directory to install into (ignored with --global)

Run "code-viewer skill agent-help" for an AI-agent oriented guide.

Examples:
  code-viewer skill install
  code-viewer skill install --agent claude,codex,gemini
  code-viewer skill install --agent all --global
`;

export const SKILL_AGENT_HELP = `code-viewer skill — agent guide

You are an AI coding agent. Use this command to install (or refresh) the
code-viewer-bundled skill packs into the human's repository or home
directory, so the next session of any supported AI agent picks them up
without manual setup.

## When to use

- First time the human runs code-viewer in a repo: install per-project
  skills so the team gets a consistent agent walkthrough convention.
- The human upgrades code-viewer and wants the latest skill content
  reflected in their agent setup.
- The human asks "can you make my AI agent know about this tool" — that
  is exactly what \`code-viewer skill install\` does.

## Behaviour

- Discovers every SKILL.md folder bundled with code-viewer (under the
  package's \`skills/\` directory) and copies each into the agent's
  conventional skills directory (e.g. \`.claude/skills/<name>/\`).
- Re-run is safe and idempotent: it overwrites files, so it doubles as
  an "update to latest" command.
- \`--global\` writes under \`~/.claude/skills/\`, \`~/.codex/skills/\`,
  etc. instead of the current repo.

## How to call

  code-viewer skill install                # default agent = claude, into cwd
  code-viewer skill install --agent all    # claude + codex + gemini + cursor + agents
  code-viewer skill install --agent all --global
  code-viewer skill install --agent codex --cwd /path/to/repo

If \`code-viewer\` is not on PATH (the human launches via npx), use:

  npx -y @youtyan/code-viewer skill install --agent claude

## Output contract

Each line of stdout is one outcome:

  installed (<agent>/<skill>): <absolute target path>
  updated   (<agent>/<skill>): <absolute target path>

Parse the "<action> (<agent>/<skill>)" prefix if you need to summarize.
Exit code 0 on success, 1 on any error (unknown agent, copy failure,
missing bundled skills).

## What gets installed

The bundled set covers code-viewer's own AI workflows (annotation
walkthroughs, doctor introspection, query/snapshot inspection). After
install, ask the AI to use \`code-viewer annotate\` and the related
skills will guide it.
`;

export type SkillArgs =
  | { kind: "help" }
  | { kind: "agent-help" }
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
  if (argv[0] === "agent-help") {
    return { ok: true, args: { kind: "agent-help" } };
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
  skillsRoot: string;
  homeDir: string;
  projectDir: string;
};

export type InstallSkillResult =
  | {
      ok: true;
      results: {
        agent: AgentName;
        skill: string;
        action: "installed" | "updated";
        target: string;
      }[];
    }
  | { ok: false; error: string };

function discoverBundledSkills(skillsRoot: string): string[] {
  if (!existsSync(skillsRoot)) return [];
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(skillsRoot, entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name)
    .sort();
}

export function installSkill(
  args: { agents: AgentName[]; global: boolean; cwd?: string },
  deps: InstallSkillDeps,
): InstallSkillResult {
  const skills = discoverBundledSkills(deps.skillsRoot);
  if (skills.length === 0) {
    return {
      ok: false,
      error: `no bundled skills found under ${deps.skillsRoot}`,
    };
  }
  const base = args.global
    ? deps.homeDir
    : resolve(args.cwd ?? deps.projectDir);
  const results: {
    agent: AgentName;
    skill: string;
    action: "installed" | "updated";
    target: string;
  }[] = [];
  for (const agent of args.agents) {
    for (const skill of skills) {
      const sourceDir = join(deps.skillsRoot, skill);
      const target = join(base, AGENT_SKILL_DIRS[agent], "skills", skill);
      const action = existsSync(target) ? "updated" : "installed";
      try {
        mkdirSync(target, { recursive: true });
        cpSync(sourceDir, target, { recursive: true });
      } catch (error) {
        return { ok: false, error: String(error) };
      }
      results.push({ agent, skill, action, target });
    }
  }
  return { ok: true, results };
}

// ai-dup-check: allow -- shares (string[]) -> void signature with runtime.spawnDetached but is the unrelated CLI entry point.
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
  if (parsed.args.kind === "agent-help") {
    console.log(SKILL_AGENT_HELP);
    return;
  }
  const result = installSkill(parsed.args, {
    skillsRoot: join(ROOT, "skills"),
    homeDir: homedir(),
    projectDir: process.cwd(),
  });
  if (result.ok === false) {
    console.error(result.error);
    process.exit(1);
  }
  for (const entry of result.results) {
    console.log(
      `${entry.action} (${entry.agent}/${entry.skill}): ${entry.target}`,
    );
  }
  if (result.results.some((entry) => entry.action === "installed")) {
    console.log("Re-run the same command anytime to update the skills.");
  }
}
