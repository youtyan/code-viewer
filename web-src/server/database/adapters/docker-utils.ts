import { spawnSync } from "node:child_process";

type ComposePsContainer = {
  Service?: string;
  Name?: string;
  State?: string;
};

type ComposeContainerNameCacheEntry = {
  value: string | null;
  expiresAt: number;
};

const COMPOSE_CONTAINER_NAME_POSITIVE_TTL_MS = 30_000;
const COMPOSE_CONTAINER_NAME_NEGATIVE_TTL_MS = 3_000;
const composeContainerNameCache = new Map<
  string,
  ComposeContainerNameCacheEntry
>();

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

export function isDockerComposeServiceUnavailableError(
  err: unknown,
): err is DockerComposeServiceUnavailableError {
  return err instanceof DockerComposeServiceUnavailableError;
}

function composeContainerNameCacheKey(
  serviceName: string,
  cwd: string,
): string {
  return `${cwd}\0${serviceName}`;
}

export function __clearDockerComposeContainerNameCacheForTest(): void {
  composeContainerNameCache.clear();
}

export function __setDockerComposeSpawnSyncForTest(
  spawnSyncForTest: typeof spawnSync | null,
): void {
  spawnSyncImpl = spawnSyncForTest ?? spawnSync;
}

export function resolveRunningComposeContainerName(
  serviceName: string,
  cwd: string,
): string | null {
  const cacheKey = composeContainerNameCacheKey(serviceName, cwd);
  const now = Date.now();
  const cached = composeContainerNameCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const proc = spawnSyncImpl(
    "docker",
    ["compose", "ps", "--format", "json", "--status", "running"],
    { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"], cwd },
  );
  if (proc.status !== 0) {
    composeContainerNameCache.set(cacheKey, {
      value: null,
      expiresAt: now + COMPOSE_CONTAINER_NAME_NEGATIVE_TTL_MS,
    });
    return null;
  }
  try {
    const output = proc.stdout.trim();
    const containers: ComposePsContainer[] = output.startsWith("[")
      ? JSON.parse(output)
      : output
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
    const match = containers.find(
      (c) => c.Service === serviceName && c.State === "running",
    );
    const value = match?.Name || null;
    composeContainerNameCache.set(cacheKey, {
      value,
      expiresAt:
        now +
        (value
          ? COMPOSE_CONTAINER_NAME_POSITIVE_TTL_MS
          : COMPOSE_CONTAINER_NAME_NEGATIVE_TTL_MS),
    });
    return value;
  } catch {
    composeContainerNameCache.set(cacheKey, {
      value: null,
      expiresAt: now + COMPOSE_CONTAINER_NAME_NEGATIVE_TTL_MS,
    });
    return null;
  }
}

export function resolveRunningComposeContainerNameOrThrow(
  serviceName: string,
  cwd: string,
): string {
  const containerName = resolveRunningComposeContainerName(serviceName, cwd);
  if (!containerName) {
    throw new DockerComposeServiceUnavailableError(serviceName, cwd);
  }
  return containerName;
}
