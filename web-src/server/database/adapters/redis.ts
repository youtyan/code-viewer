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

const SCAN_WITH_TYPES_LUA = `local s = redis.call('SCAN', ARGV[1], 'MATCH', ARGV[2], 'COUNT', ARGV[3]); local types = {}; for i, k in ipairs(s[2]) do types[i] = redis.call('TYPE', k).ok end; return cjson.encode({cursor=s[1], keys=s[2], types=types})`;

function isValidRedisType(t: string): t is RedisType {
  return (
    t === "string" ||
    t === "list" ||
    t === "set" ||
    t === "zset" ||
    t === "hash" ||
    t === "stream" ||
    t === "none"
  );
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

  function listKeys(opts: {
    db: number;
    pattern?: string;
    cursor?: string;
    count?: number;
  }): { keys: Array<{ name: string; type: RedisType }>; nextCursor: string } {
    const pattern = opts.pattern || "*";
    const cursor = opts.cursor || "0";
    const count = String(opts.count ?? 200);
    const result = execRedisCli(config, [
      "-n",
      String(opts.db),
      "EVAL",
      SCAN_WITH_TYPES_LUA,
      "0",
      cursor,
      pattern,
      count,
    ]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "SCAN failed");
    }
    const stdout = result.stdout.trim();
    if (!stdout) return { keys: [], nextCursor: "0" };
    let parsed: { cursor: string; keys: string[]; types: string[] };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error(`failed to parse SCAN result: ${stdout.slice(0, 200)}`);
    }
    const keys: Array<{ name: string; type: RedisType }> = [];
    for (let i = 0; i < parsed.keys.length; i++) {
      const rawType = parsed.types[i] || "none";
      const type: RedisType = isValidRedisType(rawType) ? rawType : "none";
      keys.push({ name: parsed.keys[i], type });
    }
    return { keys, nextCursor: parsed.cursor };
  }

  function getValue(opts: { db: number; key: string }): RedisValue {
    const typeResult = execRedisCli(config, [
      "-n",
      String(opts.db),
      "TYPE",
      opts.key,
    ]);
    if (typeResult.code !== 0) {
      throw new Error(typeResult.stderr.trim() || "TYPE failed");
    }
    const rawType = typeResult.stdout.trim();
    if (rawType === "none" || !isValidRedisType(rawType)) {
      return { type: "none" };
    }
    if (rawType === "string") {
      const r = execRedisCli(config, ["-n", String(opts.db), "GET", opts.key]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "GET failed");
      }
      const value = r.stdout.replace(/\n$/, "");
      return { type: "string", value };
    }
    if (rawType === "list") {
      const lua = `return cjson.encode(redis.call('LRANGE', KEYS[1], 0, -1))`;
      const r = execRedisCli(config, [
        "-n",
        String(opts.db),
        "EVAL",
        lua,
        "1",
        opts.key,
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "LRANGE failed");
      }
      const stdout = r.stdout.trim();
      const items = stdout ? (JSON.parse(stdout) as string[]) : [];
      return { type: "list", items };
    }
    if (rawType === "hash") {
      const lua = `local h = redis.call('HGETALL', KEYS[1]); local obj = {}; for i = 1, #h, 2 do obj[h[i]] = h[i+1] end; if next(obj) == nil then return '{}' end; return cjson.encode(obj)`;
      const r = execRedisCli(config, [
        "-n",
        String(opts.db),
        "EVAL",
        lua,
        "1",
        opts.key,
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "HGETALL failed");
      }
      const stdout = r.stdout.trim();
      const fields = stdout
        ? (JSON.parse(stdout) as Record<string, string>)
        : {};
      return { type: "hash", fields };
    }
    // set / zset / stream are added in the next commit.
    return { type: "none" };
  }

  return {
    kind: "redis",
    listDatabases,
    listKeys,
    getValue,
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
