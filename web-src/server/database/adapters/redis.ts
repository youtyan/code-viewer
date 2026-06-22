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
// PoC: hard caps to avoid OOM / long blocking on large values.
const REDIS_STRING_BYTE_LIMIT = 65536; // ~64 KB
const REDIS_COLLECTION_LIMIT = 200; // entries / fields / members

function execRedisCli(
  config: RedisConfig,
  args: string[],
  timeoutMs = 10000,
): { stdout: string; stderr: string; code: number } {
  // Pass the password via REDISCLI_AUTH env var (docker exec -e) so it does
  // not appear in the host process argv. Mirrors how docker.ts uses
  // PGPASSWORD for psql and MYSQL_PWD for mysql.
  const dockerArgs = [
    "exec",
    "-i",
    ...(config.password ? ["-e", `REDISCLI_AUTH=${config.password}`] : []),
    config.containerName,
    "redis-cli",
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

function safeJsonParse<T>(stdout: string, command: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (err) {
    throw new Error(
      `${command} 返却 JSON の parse に失敗: ${err instanceof Error ? err.message : String(err)} / 先頭200: ${stdout.slice(0, 200)}`,
    );
  }
}

// Decode the redis-cli `--no-raw` quoted-string form, e.g. `"foo\xff\nbar"`,
// into raw bytes. If any decoded byte falls outside printable ASCII /
// recognised escapes, the value is treated as binary by the caller.
function decodeQuotedRedisBytes(output: string): {
  bytes: Buffer;
  sawBinaryEscape: boolean;
} {
  const trimmed = output.replace(/\r?\n$/, "");
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return {
      bytes: Buffer.from(trimmed, "utf8"),
      sawBinaryEscape: false,
    };
  }
  const inner = trimmed.slice(1, -1);
  const bytes: number[] = [];
  let sawBinaryEscape = false;
  let i = 0;
  while (i < inner.length) {
    const ch = inner.charCodeAt(i);
    if (ch === 0x5c /* \ */ && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === "x" && i + 3 < inner.length) {
        const b = parseInt(inner.slice(i + 2, i + 4), 16);
        if (Number.isFinite(b)) {
          bytes.push(b);
          if (b < 0x20 || b >= 0x7f) sawBinaryEscape = true;
          i += 4;
          continue;
        }
      }
      if (next === "n") {
        bytes.push(0x0a);
        i += 2;
        continue;
      }
      if (next === "r") {
        bytes.push(0x0d);
        i += 2;
        continue;
      }
      if (next === "t") {
        bytes.push(0x09);
        i += 2;
        continue;
      }
      if (next === "a") {
        bytes.push(0x07);
        i += 2;
        continue;
      }
      if (next === "b") {
        bytes.push(0x08);
        i += 2;
        continue;
      }
      if (next === "\\") {
        bytes.push(0x5c);
        i += 2;
        continue;
      }
      if (next === '"') {
        bytes.push(0x22);
        i += 2;
        continue;
      }
      // Unknown escape: keep literal backslash and continue.
      bytes.push(0x5c);
      i += 1;
      continue;
    }
    if (ch > 0x7f) sawBinaryEscape = true;
    bytes.push(ch & 0xff);
    i += 1;
  }
  return { bytes: Buffer.from(bytes), sawBinaryEscape };
}

function isValidUtf8(buf: Buffer): boolean {
  try {
    const decoded = buf.toString("utf8");
    return Buffer.from(decoded, "utf8").equals(buf);
  } catch {
    return false;
  }
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
    const parsed = safeJsonParse<{
      cursor: string;
      keys: string[];
      types: string[];
    }>(stdout, "SCAN");
    const keys: Array<{ name: string; type: RedisType }> = [];
    for (let i = 0; i < parsed.keys.length; i++) {
      const rawType = parsed.types[i] || "none";
      const type: RedisType = isValidRedisType(rawType) ? rawType : "none";
      keys.push({ name: parsed.keys[i], type });
    }
    return { keys, nextCursor: parsed.cursor };
  }

  function getValue(opts: { db: number; key: string }): RedisValue {
    const dbArg = ["-n", String(opts.db)] as const;
    const typeResult = execRedisCli(config, [...dbArg, "TYPE", opts.key]);
    if (typeResult.code !== 0) {
      throw new Error(typeResult.stderr.trim() || "TYPE failed");
    }
    const rawType = typeResult.stdout.trim();
    if (rawType === "none" || !isValidRedisType(rawType)) {
      return { type: "none" };
    }
    if (rawType === "string") {
      const lenR = execRedisCli(config, [...dbArg, "STRLEN", opts.key]);
      if (lenR.code !== 0) {
        throw new Error(lenR.stderr.trim() || "STRLEN failed");
      }
      const fullSize = Number(lenR.stdout.trim()) || 0;
      const lastIndex = REDIS_STRING_BYTE_LIMIT - 1;
      // --no-raw で quoted-string 形式を取り、binary を安全に検出する。
      const r = execRedisCli(config, [
        "--no-raw",
        ...dbArg,
        "GETRANGE",
        opts.key,
        "0",
        String(lastIndex),
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "GETRANGE failed");
      }
      const { bytes, sawBinaryEscape } = decodeQuotedRedisBytes(r.stdout);
      const truncated = fullSize > REDIS_STRING_BYTE_LIMIT;
      if (sawBinaryEscape || !isValidUtf8(bytes)) {
        return {
          type: "string",
          value: "",
          binaryBase64: bytes.toString("base64"),
          truncated,
          fullSize,
        };
      }
      return {
        type: "string",
        value: bytes.toString("utf8"),
        truncated,
        fullSize,
      };
    }
    if (rawType === "list") {
      const lua = `local total = redis.call('LLEN', KEYS[1]); local items = redis.call('LRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1); return cjson.encode({total = total, items = items})`;
      const r = execRedisCli(config, [
        ...dbArg,
        "EVAL",
        lua,
        "1",
        opts.key,
        String(REDIS_COLLECTION_LIMIT),
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "LRANGE failed");
      }
      const stdout = r.stdout.trim();
      const parsed = stdout
        ? safeJsonParse<{ total: number; items: string[] }>(stdout, "LRANGE")
        : { total: 0, items: [] };
      return {
        type: "list",
        items: parsed.items,
        total: parsed.total,
        truncated: parsed.items.length < parsed.total,
      };
    }
    if (rawType === "hash") {
      // HSCAN 1 call で最大 COUNT field 取得、HLEN で total。
      const lua = `local total = redis.call('HLEN', KEYS[1]); local result = redis.call('HSCAN', KEYS[1], '0', 'COUNT', tonumber(ARGV[1])); local fields = result[2]; local obj = {}; local count = 0; for i = 1, #fields, 2 do if count >= tonumber(ARGV[1]) then break end; obj[fields[i]] = fields[i+1]; count = count + 1 end; return cjson.encode({total = total, fields = obj, count = count, cursor = result[1]})`;
      const r = execRedisCli(config, [
        ...dbArg,
        "EVAL",
        lua,
        "1",
        opts.key,
        String(REDIS_COLLECTION_LIMIT),
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "HSCAN failed");
      }
      const stdout = r.stdout.trim();
      const parsed = stdout
        ? safeJsonParse<{
            total: number;
            fields: Record<string, string>;
            count: number;
            cursor: string;
          }>(stdout, "HSCAN")
        : { total: 0, fields: {}, count: 0, cursor: "0" };
      const truncated = parsed.count < parsed.total || parsed.cursor !== "0";
      return {
        type: "hash",
        fields: parsed.fields,
        total: parsed.total,
        truncated,
      };
    }
    if (rawType === "set") {
      const lua = `local total = redis.call('SCARD', KEYS[1]); local result = redis.call('SSCAN', KEYS[1], '0', 'COUNT', tonumber(ARGV[1])); local members = {}; local limit = tonumber(ARGV[1]); for i = 1, math.min(#result[2], limit) do members[i] = result[2][i] end; return cjson.encode({total = total, members = members, cursor = result[1]})`;
      const r = execRedisCli(config, [
        ...dbArg,
        "EVAL",
        lua,
        "1",
        opts.key,
        String(REDIS_COLLECTION_LIMIT),
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "SSCAN failed");
      }
      const stdout = r.stdout.trim();
      const parsed = stdout
        ? safeJsonParse<{
            total: number;
            members: string[];
            cursor: string;
          }>(stdout, "SSCAN")
        : { total: 0, members: [], cursor: "0" };
      const truncated =
        parsed.members.length < parsed.total || parsed.cursor !== "0";
      return {
        type: "set",
        members: parsed.members,
        total: parsed.total,
        truncated,
      };
    }
    if (rawType === "zset") {
      const lua = `local total = redis.call('ZCARD', KEYS[1]); local r = redis.call('ZRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1, 'WITHSCORES'); local arr = {}; for i = 1, #r, 2 do table.insert(arr, {member = r[i], score = tonumber(r[i+1])}) end; return cjson.encode({total = total, members = arr})`;
      const r = execRedisCli(config, [
        ...dbArg,
        "EVAL",
        lua,
        "1",
        opts.key,
        String(REDIS_COLLECTION_LIMIT),
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "ZRANGE failed");
      }
      const stdout = r.stdout.trim();
      const parsed = stdout
        ? safeJsonParse<{
            total: number;
            members: Array<{ member: string; score: number }>;
          }>(stdout, "ZRANGE")
        : { total: 0, members: [] };
      return {
        type: "zset",
        members: parsed.members,
        total: parsed.total,
        truncated: parsed.members.length < parsed.total,
      };
    }
    if (rawType === "stream") {
      const lua = `local total = redis.call('XLEN', KEYS[1]); local r = redis.call('XRANGE', KEYS[1], '-', '+', 'COUNT', tonumber(ARGV[1])); local arr = {}; for _, entry in ipairs(r) do local fields = {}; for i = 1, #entry[2], 2 do fields[entry[2][i]] = entry[2][i+1] end; table.insert(arr, {id = entry[1], fields = fields}) end; return cjson.encode({total = total, entries = arr})`;
      const r = execRedisCli(config, [
        ...dbArg,
        "EVAL",
        lua,
        "1",
        opts.key,
        String(REDIS_COLLECTION_LIMIT),
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "XRANGE failed");
      }
      const stdout = r.stdout.trim();
      const parsed = stdout
        ? safeJsonParse<{
            total: number;
            entries: Array<{ id: string; fields: Record<string, string> }>;
          }>(stdout, "XRANGE")
        : { total: 0, entries: [] };
      return {
        type: "stream",
        entries: parsed.entries,
        total: parsed.total,
        truncated: parsed.entries.length < parsed.total,
      };
    }
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
