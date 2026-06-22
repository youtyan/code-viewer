import { spawnSync } from "node:child_process";
import type { RedisType, RedisValue } from "../../../core/database/types";

type RedisConfig = {
  containerName: string;
  password: string;
};

export type RedisExplorer = {
  readonly kind: "redis";
  listDatabases(): Array<{ index: number; keyCount: number }>;
  listKeys(opts: {
    db: number;
    pattern?: string;
    cursor?: string;
    count?: number;
  }): { keys: Array<{ name: string; type: RedisType }>; nextCursor: string };
  getValue(opts: { db: number; key: string }): RedisValue;
  close(): void;
};

const DEFAULT_DATABASES = 16;

function execRedisCli(
  config: RedisConfig,
  args: string[],
  timeoutMs = 10000,
): { stdout: string; stderr: string; code: number } {
  const dockerArgs = [
    "exec",
    "-i",
    config.containerName,
    "redis-cli",
    ...(config.password ? ["-a", config.password, "--no-auth-warning"] : []),
    "-3",
    ...args,
  ];
  const proc = spawnSync("docker", dockerArgs, {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
    code: proc.status ?? 1,
  };
}

function resolveContainerName(serviceName: string, cwd: string): string | null {
  const proc = spawnSync(
    "docker",
    ["compose", "ps", "--format", "json", "--status", "running"],
    { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"], cwd },
  );
  if (proc.status !== 0) return null;
  try {
    const output = proc.stdout.trim();
    let containers: { Service?: string; Name?: string; State?: string }[];
    if (output.startsWith("[")) {
      containers = JSON.parse(output);
    } else {
      containers = output
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    }
    const match = containers.find(
      (c) => c.Service === serviceName && c.State === "running",
    );
    return match?.Name || null;
  } catch {
    return null;
  }
}

function parseInfoKeyspace(stdout: string): Map<number, number> {
  const counts = new Map<number, number>();
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^db(\d+):keys=(\d+)/);
    if (m) counts.set(Number(m[1]), Number(m[2]));
  }
  return counts;
}

function createRedisAdapter(config: RedisConfig): RedisExplorer {
  function listDatabases(): Array<{ index: number; keyCount: number }> {
    const result = execRedisCli(config, ["INFO", "keyspace"]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "INFO keyspace failed");
    }
    const counts = parseInfoKeyspace(result.stdout);
    const dbs: Array<{ index: number; keyCount: number }> = [];
    for (let i = 0; i < DEFAULT_DATABASES; i++) {
      dbs.push({ index: i, keyCount: counts.get(i) ?? 0 });
    }
    return dbs;
  }

  return {
    kind: "redis",
    listDatabases,
    listKeys() {
      throw new Error("not implemented yet");
    },
    getValue() {
      throw new Error("not implemented yet");
    },
    close() {
      // nothing to close (docker exec is one-shot per call)
    },
  };
}

export function openRedisExplorer(
  serviceName: string,
  env: Record<string, string>,
  cwd: string,
): RedisExplorer {
  const containerName = resolveContainerName(serviceName, cwd);
  if (!containerName) {
    throw new Error(
      `Container for service "${serviceName}" is not running. Start it with: docker compose up -d ${serviceName}`,
    );
  }
  const password = env.REDIS_PASSWORD || "";
  return createRedisAdapter({ containerName, password });
}
