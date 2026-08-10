import { release as osRelease } from "node:os";
import { errorWithCause, errorWithCauses } from "../core/error-detail";
import { isWsl } from "./os-platform";
import { type RunResult, runAsync } from "./runtime";

type OpenCommand = {
  args: string[];
  cwd: string;
};

const OPEN_TIMEOUT_MS = 15_000;

function directoryCommands(
  path: string,
  platform: NodeJS.Platform,
): OpenCommand[] {
  if (platform === "darwin") {
    return [{ args: ["open", "--", path], cwd: path }];
  }
  if (platform === "win32") {
    return [{ args: ["explorer.exe", path], cwd: path }];
  }
  return [
    { args: ["xdg-open", path], cwd: path },
    { args: ["gio", "open", path], cwd: path },
  ];
}

function urlCommands(
  url: string,
  cwd: string,
  platform: NodeJS.Platform,
): OpenCommand[] {
  if (platform === "darwin") {
    return [{ args: ["open", url], cwd }];
  }
  if (platform === "win32") {
    return [{ args: ["cmd.exe", "/c", "start", "", url], cwd }];
  }
  return [
    { args: ["xdg-open", url], cwd },
    { args: ["gio", "open", url], cwd },
  ];
}

function commandResultError(command: OpenCommand, result: RunResult): Error {
  return Object.assign(
    new Error(
      result.code === 0
        ? `${command.args[0]} wrote to stderr`
        : `${command.args[0]} exited with ${result.code}`,
    ),
    {
      command: command.args,
      cwd: command.cwd,
      result,
    },
  );
}

async function executeOpenCommand(command: OpenCommand): Promise<RunResult> {
  try {
    return await runAsync(command.args, command.cwd, {
      timeout: OPEN_TIMEOUT_MS,
    });
  } catch (error) {
    throw commandExecutionError(command, error);
  }
}

function commandSucceeded(result: RunResult): boolean {
  return result.code === 0 && result.stderr.trim() === "";
}

function commandExecutionError(command: OpenCommand, cause: unknown): Error {
  return Object.assign(
    errorWithCause(`failed to execute ${command.args[0]}`, cause),
    {
      command: command.args,
      cwd: command.cwd,
    },
  );
}

async function runOpenCommands(
  commands: OpenCommand[],
  operation: string,
  errors: Error[] = [],
): Promise<void> {
  for (const command of commands) {
    try {
      const result = await executeOpenCommand(command);
      if (commandSucceeded(result)) return;
      errors.push(commandResultError(command, result));
    } catch (error) {
      errors.push(
        error instanceof Error ? error : commandExecutionError(command, error),
      );
    }
  }
  throw errorWithCauses(`failed to ${operation}`, errors);
}

async function commandOutput(command: OpenCommand): Promise<string> {
  const result = await executeOpenCommand(command);
  if (!commandSucceeded(result)) throw commandResultError(command, result);
  const output = result.stdout.trim();
  if (!output) {
    throw Object.assign(new Error(`${command.args[0]} returned no path`), {
      command: command.args,
      cwd: command.cwd,
      result,
    });
  }
  return output;
}

async function wslWindowsCommandCwd(cwd: string): Promise<string> {
  return commandOutput({ args: ["wslpath", "-u", "C:\\"], cwd });
}

async function openWslDirectory(path: string): Promise<void> {
  const errors: Error[] = [];
  try {
    const windowsPath = await commandOutput({
      args: ["wslpath", "-w", path],
      cwd: path,
    });
    const windowsCwd = await wslWindowsCommandCwd(path);
    const command = {
      args: ["cmd.exe", "/c", "start", "", windowsPath],
      cwd: windowsCwd,
    };
    const result = await executeOpenCommand(command);
    if (commandSucceeded(result)) return;
    errors.push(commandResultError(command, result));
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error
        : errorWithCause("failed to open directory through WSL", error),
    );
  }
  return runOpenCommands(
    [
      { args: ["gio", "open", path], cwd: path },
      { args: ["xdg-open", path], cwd: path },
    ],
    "open directory in OS",
    errors,
  );
}

async function openWslUrl(url: string, cwd: string): Promise<void> {
  const errors: Error[] = [];
  try {
    const windowsCwd = await wslWindowsCommandCwd(cwd);
    const command = {
      args: ["cmd.exe", "/c", "start", "", url],
      cwd: windowsCwd,
    };
    const result = await executeOpenCommand(command);
    if (commandSucceeded(result)) return;
    errors.push(commandResultError(command, result));
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error
        : errorWithCause("failed to open URL through WSL", error),
    );
  }
  return runOpenCommands(
    [
      { args: ["gio", "open", url], cwd },
      { args: ["xdg-open", url], cwd },
    ],
    "open URL in OS",
    errors,
  );
}

export function openDirectoryInOs(
  path: string,
  platform: NodeJS.Platform = process.platform,
  release: string = osRelease(),
): Promise<void> {
  if (isWsl(platform, release)) return openWslDirectory(path);
  return runOpenCommands(
    directoryCommands(path, platform),
    "open directory in OS",
  );
}

export function openUrlInOs(
  url: string,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  release: string = osRelease(),
): Promise<void> {
  if (isWsl(platform, release)) return openWslUrl(url, cwd);
  return runOpenCommands(urlCommands(url, cwd, platform), "open URL in OS");
}
