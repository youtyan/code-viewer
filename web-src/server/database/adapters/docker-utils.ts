import { spawnSync } from "node:child_process";
import {
  commandForExternal,
  commandNotFoundDetail,
  isCommandNotFoundResult,
} from "../../command-resolver";
import { isAbortLikeError, throwIfAborted } from "./abort";
import { spawnTextAsync } from "./spawn-runner";

type ComposePsContainer = {
  Service?: string;
  Name?: string;
  State?: string;
};

type ComposePsCacheEntry = {
  containers: ComposeContainerNameByService | null;
  positiveExpiresAt: number;
  negativeExpiresAt: number;
  error?: string;
};

type ComposeContainerNameByService = Map<string, string>;
type DockerCommandResult = { code: number; stderr?: string };

const COMPOSE_CONTAINER_NAME_POSITIVE_TTL_MS = 30_000;
const COMPOSE_CONTAINER_NAME_NEGATIVE_TTL_MS = 3_000;
const COMPOSE_PS_FAILURE_TTL_MS = 15_000;
const composePsCache = new Map<string, ComposePsCacheEntry>();
type ComposePsPendingEntry = {
  promise: Promise<ComposeContainerNameByService | null>;
  controller: AbortController;
  refs: number;
  done: boolean;
};
const composePsPending = new Map<string, ComposePsPendingEntry>();

let spawnSyncImpl = spawnSync;

export class DockerComposeServiceUnavailableError extends Error {
  readonly serviceName: string;
  readonly cwd: string;
  readonly status = 503;

  constructor(serviceName: string, cwd: string) {
    super(
      `Container for service "${serviceName}" is not running. Start it with: docker compose up -d ${serviceName}`,
    );
    this.name = "DockerComposeServiceUnavailableError";
    this.serviceName = serviceName;
    this.cwd = cwd;
  }
}

export class DockerCommandUnavailableError extends Error {
  readonly status = 503;

  constructor() {
    super(
      `${commandNotFoundDetail("docker")}. Install Docker or pass --bin docker=/absolute/path.`,
    );
    this.name = "DockerCommandUnavailableError";
  }
}

export function isDockerComposeServiceUnavailableError(
  err: unknown,
): err is DockerComposeServiceUnavailableError | DockerCommandUnavailableError {
  return (
    err instanceof DockerComposeServiceUnavailableError ||
    err instanceof DockerCommandUnavailableError
  );
}

export function dockerCommand(): string {
  return commandForExternal("docker");
}

export function isDockerCommandUnavailableResult(
  result: DockerCommandResult,
): boolean {
  return isCommandNotFoundResult("docker", result);
}

export function throwIfDockerCommandUnavailableResult(
  result: DockerCommandResult,
): void {
  if (isDockerCommandUnavailableResult(result)) {
    throw new DockerCommandUnavailableError();
  }
}

export function throwIfCachedComposeDockerCommandUnavailable(
  cwd: string,
): void {
  const failure = composePsCache.get(cwd)?.error || "";
  throwIfDockerCommandUnavailableResult({ code: 1, stderr: failure });
}

export function __clearDockerComposeContainerNameCacheForTest(): void {
  composePsCache.clear();
  composePsPending.clear();
}

export function __setDockerComposeSpawnSyncForTest(
  spawnSyncForTest: typeof spawnSync | null,
): void {
  spawnSyncImpl = spawnSyncForTest ?? spawnSync;
}

function parseComposePsOutput(stdout: string): ComposeContainerNameByService {
  const output = stdout.trim();
  const containers: ComposePsContainer[] = output.startsWith("[")
    ? JSON.parse(output)
    : output
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
  const byService: ComposeContainerNameByService = new Map();
  for (const container of containers) {
    if (container.Service && container.Name && container.State === "running") {
      byService.set(container.Service, container.Name);
    }
  }
  return byService;
}

function cacheComposePsFailure(
  cwd: string,
  result: DockerCommandResult,
  now: number,
): void {
  const stderr = result.stderr || "";
  const failureTtl =
    isDockerCommandUnavailableResult(result) ||
    /docker daemon|cannot connect|is the docker daemon running/i.test(stderr)
      ? COMPOSE_PS_FAILURE_TTL_MS
      : COMPOSE_CONTAINER_NAME_NEGATIVE_TTL_MS;
  composePsCache.set(cwd, {
    containers: null,
    positiveExpiresAt: now,
    negativeExpiresAt: now + failureTtl,
    error: stderr,
  });
}

function runComposePsAsync(
  cwd: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number }> {
  throwIfAborted(signal, "docker compose ps aborted");
  if (spawnSyncImpl !== spawnSync) {
    const command = dockerCommand();
    const proc = spawnSyncImpl(
      command,
      ["compose", "ps", "--format", "json", "--status", "running"],
      {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
        cwd,
      },
    );
    return Promise.resolve({
      stdout: String(proc.stdout || ""),
      stderr: `${String(proc.stderr || "")}${proc.error ? `\n${proc.error.message}` : ""}`,
      code: proc.status ?? 1,
    });
  }
  return spawnTextAsync({
    command: dockerCommand(),
    args: ["compose", "ps", "--format", "json", "--status", "running"],
    cwd,
    timeoutMs: 5000,
    signal,
    killSignal: "SIGKILL",
    abortMessage: "docker compose ps aborted",
    timeoutMessage: "docker compose ps timed out",
    rejectOnError: false,
  });
}

export async function resolveRunningComposeContainerNameAsync(
  serviceName: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<string | null> {
  throwIfAborted(signal, "docker compose ps aborted");
  const now = Date.now();
  const cached = composePsCache.get(cwd);
  if (cached) {
    const value = cached.containers?.get(serviceName) ?? null;
    if (value && cached.positiveExpiresAt > now) return value;
    if (!value && cached.negativeExpiresAt > now) return null;
  }

  let pending = composePsPending.get(cwd);
  if (!pending) {
    const controller = new AbortController();
    pending = {
      controller,
      refs: 0,
      done: false,
      promise: (async () => {
        const startedAt = Date.now();
        let proc: { stdout: string; stderr: string; code: number };
        try {
          proc = await runComposePsAsync(cwd, controller.signal);
        } catch (err) {
          if (isAbortLikeError(err, controller.signal)) throw err;
          cacheComposePsFailure(
            cwd,
            {
              code: 1,
              stderr: err instanceof Error ? err.message : String(err),
            },
            startedAt,
          );
          return null;
        }
        if (proc.code !== 0) {
          cacheComposePsFailure(cwd, proc, startedAt);
          return null;
        }
        try {
          const byService = parseComposePsOutput(proc.stdout);
          composePsCache.set(cwd, {
            containers: byService,
            positiveExpiresAt:
              startedAt + COMPOSE_CONTAINER_NAME_POSITIVE_TTL_MS,
            negativeExpiresAt:
              startedAt + COMPOSE_CONTAINER_NAME_NEGATIVE_TTL_MS,
          });
          return byService;
        } catch {
          composePsCache.set(cwd, {
            containers: null,
            positiveExpiresAt: startedAt,
            negativeExpiresAt:
              startedAt + COMPOSE_CONTAINER_NAME_NEGATIVE_TTL_MS,
            error: "could not parse docker compose ps output",
          });
          return null;
        }
      })().finally(() => {
        if (composePsPending.get(cwd) === pending) {
          composePsPending.delete(cwd);
        }
        if (pending) pending.done = true;
      }),
    };
    composePsPending.set(cwd, pending);
  }
  pending.refs++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    pending.refs--;
    if (pending.refs <= 0 && !pending.done) {
      pending.controller.abort();
    }
  };
  signal?.addEventListener("abort", release, { once: true });
  if (signal?.aborted) {
    signal.removeEventListener("abort", release);
    release();
    throwIfAborted(signal, "docker compose ps aborted");
  }
  try {
    const byService = await pending.promise;
    throwIfAborted(signal, "docker compose ps aborted");
    return byService?.get(serviceName) ?? null;
  } finally {
    signal?.removeEventListener("abort", release);
    release();
  }
}

export async function resolveRunningComposeContainerNameOrThrowAsync(
  serviceName: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const containerName = await resolveRunningComposeContainerNameAsync(
    serviceName,
    cwd,
    signal,
  );
  if (!containerName) {
    throwIfCachedComposeDockerCommandUnavailable(cwd);
    throw new DockerComposeServiceUnavailableError(serviceName, cwd);
  }
  return containerName;
}
