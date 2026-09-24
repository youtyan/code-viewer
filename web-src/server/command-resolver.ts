import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { formatErrorDetail } from "../core/error-detail";
import type { RunFailure } from "./runtime";

export const EXTERNAL_COMMAND_NAMES = [
  "git",
  "rg",
  "docker",
  "gh",
  "tmux",
] as const;

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

/**
 * コマンドが終了コードを返すところまで動かなかった理由。動いて終わったなら
 * (0 でも非 0 でも) null。
 *
 * - not-found: 実行ファイルが見つからない (ENOENT) ときだけ
 * - timed-out: こちらが時間切れで止めた
 * - could-not-start: fork / exec の失敗 (EAGAIN・EMFILE・EACCES など)
 * - cwd-missing: 作業ディレクトリが無い (node はこれも ENOENT で返す)
 *
 * 以前は stderr に `spawn <command>` があれば全部「無い」にしていたので、tmux
 * の 3 秒の時間切れ (`spawn tmux ETIMEDOUT`) が「tmux が無い」になり、本当の
 * 理由が消えていた。呼び出し側は、どの種類でも「そのコマンドを使えなかった」
 * として detail を出し、非 0 の終了と同じ扱いにしない。
 */
export type CommandRunFailure = {
  kind: "not-found" | "timed-out" | "could-not-start" | "cwd-missing";
  /** コマンド・理由 (・時間切れならかかった時間) を含む説明。 */
  detail: string;
};

export function commandRunFailure(
  command: ExternalCommandName,
  result: { code: number; stderr?: string; failure?: RunFailure },
): CommandRunFailure | null {
  if (result.code === 0) return null;
  const failure = result.failure;
  if (failure?.kind === "timed-out") {
    return { kind: "timed-out", detail: failure.message };
  }
  if (failure?.kind === "cwd-missing") {
    return {
      kind: "cwd-missing",
      detail: `${command} could not run because the working directory ${failure.cwd} does not exist or is not a directory`,
    };
  }
  if (failure?.kind === "spawn-error") {
    return failure.error.code === "ENOENT"
      ? { kind: "not-found", detail: commandNotFoundDetail(command) }
      : {
          kind: "could-not-start",
          detail: `${command} could not be started: ${formatErrorDetail(failure.error)}`,
        };
  }
  // 起動の記録が無い結果 (シェル経由の exit 127、差し替えた spawnSync) は
  // stderr の文言で「無い」だけを見分ける。
  return isCommandNotFoundMessage(command, result.stderr || "")
    ? { kind: "not-found", detail: commandNotFoundDetail(command) }
    : null;
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
  let realPath = raw;
  // どの操作がどのパスで落ちたかを理由と一緒に返す (ENOENT と EACCES を
  // 同じ 1 文にしない)。
  let step = "realpath";
  try {
    realPath = realpathSync(raw);
    step = "stat";
    const st = statSync(realPath);
    if (!st.isFile()) return { error: "path must point to a file" };
    step = "access (X_OK)";
    accessSync(realPath, constants.X_OK);
  } catch (error) {
    return {
      error: `path must point to an executable file: ${step} ${realPath} failed\n${formatErrorDetail(error)}`,
    };
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
  } catch (error) {
    return {
      error: `--cwd must point to an existing directory: ${cwd}\n${formatErrorDetail(error)}`,
    };
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
    } catch (error) {
      // .git が無いだけなら親へ。読めないなど、ほかの理由は隠さない。
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
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
  if (lower.includes(`${command.toLowerCase()}: command not found`))
    return true;
  if (lower.includes(`${command.toLowerCase()}: not found`)) return true;
  return false;
}
