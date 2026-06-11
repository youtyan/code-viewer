import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT } from "./root";

const SKILL_NAME = "code-viewer-annotate";

export const SKILL_HELP = `code-viewer skill — manage the bundled agent skill

Usage:
  code-viewer skill install [--global] [--cwd <dir>]

Installs the ${SKILL_NAME} skill (SKILL.md for AI coding agents) into
.claude/skills/ of the current project, or into ~/.claude/skills/ with
--global. Running install again overwrites the files, so the same command
also updates an existing installation.

Options:
  --global      install into ~/.claude/skills/ instead of the project
  --cwd <dir>   project directory to install into (ignored with --global)
`;

export type SkillArgs =
  | { kind: "help" }
  | { kind: "install"; global: boolean; cwd?: string };

export type SkillParseResult =
  | { ok: true; args: SkillArgs }
  | { ok: false; error: string };

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
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--global") {
      global = true;
    } else if (arg === "--cwd") {
      cwd = rest[++i];
      if (!cwd) return { ok: false, error: "--cwd requires a directory" };
    } else {
      return { ok: false, error: `unknown option: ${arg}` };
    }
  }
  return { ok: true, args: { kind: "install", global, cwd } };
}

export type InstallSkillDeps = {
  sourceDir: string;
  homeDir: string;
  projectDir: string;
};

export type InstallSkillResult =
  | { ok: true; action: "installed" | "updated"; target: string }
  | { ok: false; error: string };

export function installSkill(
  args: { global: boolean; cwd?: string },
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
  const target = join(base, ".claude", "skills", SKILL_NAME);
  const action = existsSync(target) ? "updated" : "installed";
  try {
    mkdirSync(target, { recursive: true });
    cpSync(deps.sourceDir, target, { recursive: true });
  } catch (error) {
    return { ok: false, error: String(error) };
  }
  return { ok: true, action, target };
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
  console.log(`${result.action}: ${result.target}`);
  if (result.action === "installed") {
    console.log("Re-run the same command anytime to update the skill.");
  }
}
