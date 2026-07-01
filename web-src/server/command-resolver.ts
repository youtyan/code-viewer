import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

export const EXTERNAL_COMMAND_NAMES = ["git", "rg", "docker"] as const;

export type ExternalCommandName = (typeof EXTERNAL_COMMAND_NAMES)[number];

export type ExternalCommandOverride = {
  name: ExternalCommandName;
  path: string;
};

export type ConfigureExternalCommandsOptions = {
  cwd: string;
  cliOverrides?: ExternalCommandOverride[];
  env?: NodeJS.ProcessEnv;
  allowedNames?: readonly ExternalCommandName[];
};

type OverrideSource = "cli" | "env";

type ResolvedOverride = {
  path: string;
  realPath: string;
  source: OverrideSource;
};

const commandNameSet = new Set<string>(EXTERNAL_COMMAND_NAMES);
const activeOverrides = new Map<ExternalCommandName, ResolvedOverride>();

export function isExternalCommandName(
  value: string,
): value is ExternalCommandName {
  return commandNameSet.has(value);
}

export function parseExternalCommandOverride(
  raw: string,
  flag = "--bin",
  allowedNames: readonly ExternalCommandName[] = EXTERNAL_COMMAND_NAMES,
):
  | { ok: true; override: ExternalCommandOverride }
  | { ok: false; error: string } {
  const eq = raw.indexOf("=");
  if (eq <= 0 || eq === raw.length - 1) {
    return { ok: false, error: `${flag} requires <name>=<absolute-path>` };
  }
  const name = raw.slice(0, eq).trim();
  const path = raw.slice(eq + 1);
  if (!isExternalCommandName(name)) {
    return {
      ok: false,
      error: `${flag} unsupported command: ${name}`,
    };
  }
  if (!allowedNames.includes(name)) {
    return {
      ok: false,
      error: `${flag} unsupported command: ${name}`,
    };
  }
  return { ok: true, override: { name, path } };
}

export function configureExternalCommands(
  opts: ConfigureExternalCommandsOptions,
): { ok: true } | { ok: false; error: string } {
  const env = opts.env ?? process.env;
  const allowedNames = opts.allowedNames ?? EXTERNAL_COMMAND_NAMES;
  const selected = new Map<
    ExternalCommandName,
    { path: string; source: OverrideSource }
  >();
  for (const name of allowedNames) {
    const value = env[envNameForCommand(name)];
    if (value) selected.set(name, { path: value, source: "env" });
  }
  for (const override of opts.cliOverrides ?? []) {
    if (!allowedNames.includes(override.name)) {
      return {
        ok: false,
        error: `--bin unsupported command: ${override.name}`,
      };
    }
    selected.set(override.name, { path: override.path, source: "cli" });
  }
  if (selected.size === 0) {
    activeOverrides.clear();
    return { ok: true };
  }

  const roots = forbiddenExecutableRoots(opts.cwd);
  if ("error" in roots) return { ok: false, error: roots.error };

  const resolved = new Map<ExternalCommandName, ResolvedOverride>();
  for (const [name, value] of selected) {
    const validated = validateExecutablePath(value.path, roots.roots);
    if ("error" in validated) {
      return {
        ok: false,
        error: `${sourceLabel(value.source)} ${name}: ${validated.error}`,
      };
    }
    resolved.set(name, {
      path: value.path,
      realPath: validated.realPath,
      source: value.source,
    });
  }
  activeOverrides.clear();
  for (const [name, value] of resolved) activeOverrides.set(name, value);
  return { ok: true };
}

export function commandForExternal(name: ExternalCommandName): string {
  return activeOverrides.get(name)?.realPath ?? name;
}

export function externalCommandSource(
  name: ExternalCommandName,
): "override" | "PATH" {
  return activeOverrides.has(name) ? "override" : "PATH";
}

export function resetExternalCommandsForTest(): void {
  activeOverrides.clear();
}

export function isCommandNotFoundResult(
  command: ExternalCommandName,
  result: { code: number; stderr?: string },
): boolean {
  if (result.code === 0) return false;
  return isCommandNotFoundMessage(command, result.stderr || "");
}

export function commandNotFoundDetail(command: ExternalCommandName): string {
  const resolved = commandForExternal(command);
  if (resolved === command) return `${command} not found in PATH`;
  return `${command} binary not found or not executable: ${resolved}`;
}

function envNameForCommand(name: ExternalCommandName): string {
  return `CODE_VIEWER_BIN_${name.toUpperCase().replace(/-/g, "_")}`;
}

function sourceLabel(source: OverrideSource): string {
  return source === "cli" ? "--bin" : "environment override";
}

function validateExecutablePath(
  raw: string,
  forbiddenRoots: string[],
): { realPath: string } | { error: string } {
  if (!raw) return { error: "path must not be empty" };
  if (raw.includes("\0") || /[\r\n]/.test(raw)) {
    return { error: "path must be single-line and must not contain NUL" };
  }
  if (!isAbsolute(raw)) return { error: "path must be absolute" };
  let realPath: string;
  try {
    realPath = realpathSync(raw);
    const st = statSync(realPath);
    if (!st.isFile()) return { error: "path must point to a file" };
    accessSync(realPath, constants.X_OK);
  } catch {
    return { error: "path must point to an executable file" };
  }
  for (const root of forbiddenRoots) {
    if (sameOrInside(realPath, root)) {
      return {
        error:
          "path must not point inside the current repository or working directory",
      };
    }
  }
  return { realPath };
}

function forbiddenExecutableRoots(
  cwd: string,
): { roots: string[] } | { error: string } {
  let cwdReal: string;
  try {
    cwdReal = realpathSync(cwd);
  } catch {
    return { error: `--cwd must point to an existing directory: ${cwd}` };
  }
  const roots = [cwdReal];
  const gitRoot = findGitRootByWalking(cwdReal);
  if (gitRoot && !roots.some((root) => sameOrInside(gitRoot, root))) {
    roots.push(gitRoot);
  }
  return { roots };
}

function findGitRootByWalking(start: string): string | null {
  let current = start;
  for (;;) {
    try {
      statSync(join(current, ".git"));
      return realpathSync(current);
    } catch {
      // keep walking
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function sameOrInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function isCommandNotFoundMessage(
  command: ExternalCommandName,
  message: string,
): boolean {
  const lower = message.toLowerCase();
  if (lower.includes("enoent")) return true;
  if (lower.includes(`spawn ${command.toLowerCase()}`)) return true;
  if (lower.includes(`${command.toLowerCase()}: command not found`))
    return true;
  if (lower.includes(`${command.toLowerCase()}: not found`)) return true;
  return false;
}
