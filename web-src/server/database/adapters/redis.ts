import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  RedisHashField,
  RedisItem,
  RedisType,
  RedisValue,
} from "../../../core/database/types";
import type { SnapshotItem } from "../sources/types";

type RedisConfig = {
  containerName: string;
  password: string;
};

export type RedisExplorer = {
  readonly kind: "redis";
  readonly model: "kv";
  readonly capabilities: { snapshot: true };
  listDatabases(): Array<{ index: number; keyCount: number }>;
  listKeys(opts: {
    db: number;
    pattern?: string;
    cursor?: string;
    count?: number;
  }): { keys: Array<{ name: string; type: RedisType }>; nextCursor: string };
  getValue(opts: { db: number; key: string }): RedisValue;
  iterateForSnapshot(
    container: string,
    signal?: AbortSignal,
  ): AsyncIterable<SnapshotItem>;
  listSnapshotContainers(): Promise<Array<{ id: string; label: string }>>;
  close(): void;
};

// iterateForSnapshot に渡される container は JSON 文字列。
// `{"db":0,"pattern":"user:*"}` のように DB index + key pattern を持つ。
// pattern だけの文字列を渡された場合は DB 0 を default にする (UI 互換)。
function parseSnapshotContainer(container: string): {
  db: number;
  pattern: string;
} {
  if (container.startsWith("{")) {
    try {
      const obj = JSON.parse(container) as { db?: number; pattern?: string };
      const db = typeof obj.db === "number" ? obj.db : 0;
      const pattern =
        typeof obj.pattern === "string" && obj.pattern.length > 0
          ? obj.pattern
          : "*";
      return { db, pattern };
    } catch {
      // fall through
    }
  }
  return { db: 0, pattern: container || "*" };
}

const DEFAULT_DATABASES = 16;
// PoC: hard caps to avoid OOM / long blocking on large values.
const REDIS_STRING_BYTE_LIMIT = 65536; // ~64 KB
const REDIS_COLLECTION_LIMIT = 200; // entries / fields / members

function execRedisCli(
  config: RedisConfig,
  args: string[],
  timeoutMs = 10000,
): { stdout: string; stderr: string; code: number } {
  // パスワードは docker の argv 露出を避けるため、`docker exec -e REDISCLI_AUTH`
  // (キー名のみ。値なし) で渡し、値は spawnSync の env で REDISCLI_AUTH に詰める。
  // docker は `-e KEY` (値なし) のとき、host 環境変数の同名値を container 内に継承する。
  // host の `ps -ef` には KEY 名しか現れない。
  const hasPassword = !!config.password;
  const dockerArgs = [
    "exec",
    "-i",
    ...(hasPassword ? ["-e", "REDISCLI_AUTH"] : []),
    config.containerName,
    "redis-cli",
    "-3",
    ...args,
  ];
  const spawnEnv = hasPassword
    ? { ...process.env, REDISCLI_AUTH: config.password }
    : process.env;
  const proc = spawnSync("docker", dockerArgs, {
    encoding: "utf8",
    env: spawnEnv,
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

// Lua 5.1 で各要素を hex に詰めてから cjson.encode する prelude。
// Redis 2.6+ Lua + cjson は UTF-8 only なので、binary 値は直接 cjson に
// 渡せない。一度 hex 化することで JSON 経路が常に ASCII になり、TS 側で
// hex → bytes → utf8/base64 判定して binary 安全に decode できる。
const LUA_TOHEX_PRELUDE = `local function tohex(s) local t = {} for i = 1, #s do t[i] = string.format('%02x', string.byte(s, i)) end return table.concat(t) end`;

// snapshot 専用 Lua prelude。tohex に加えて、ARGV 経由で渡された hex key を
// raw bytes に戻す fromhex も提供する。binary key を ARGV から redis.call の
// key 引数として渡すために使う (redis-cli の argv は string なので binary を
// 直接渡せないが、hex を ARGV で受け Lua 内で復元すれば任意 byte 列で
// command を発行できる)。
const LUA_HEX_KEY_PRELUDE = `local function tohex(s) local t = {} for i = 1, #s do t[i] = string.format('%02x', string.byte(s, i)) end return table.concat(t) end local function fromhex(h) local b = {} for i = 1, #h, 2 do b[#b+1] = string.char(tonumber(string.sub(h, i, i+1), 16)) end return table.concat(b) end`;

// snapshot 用 SCAN: key を hex で返す。binary key 対応 (R2-M1) と、
// 後段の dedup (R2-M2) のために hex 比較で同一性を判定する。
const SCAN_HEX_KEYS_LUA = `${LUA_TOHEX_PRELUDE} local s = redis.call('SCAN', ARGV[1], 'MATCH', ARGV[2], 'COUNT', ARGV[3]) local types = {} local hex_keys = {} for i, k in ipairs(s[2]) do types[i] = redis.call('TYPE', k).ok hex_keys[i] = tohex(k) end return cjson.encode({cursor=s[1], keys=hex_keys, types=types})`;

function decodeHexItem(hex: string): RedisItem {
  const buf = Buffer.from(hex, "hex");
  if (isValidUtf8(buf)) return buf.toString("utf8");
  return { binaryBase64: buf.toString("base64") };
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
      const lua = `${LUA_TOHEX_PRELUDE} local total = redis.call('LLEN', KEYS[1]) local items = redis.call('LRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1) local hex_items = {} for i, v in ipairs(items) do hex_items[i] = tohex(v) end return cjson.encode({total = total, items = hex_items})`;
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
      const items = parsed.items.map(decodeHexItem);
      return {
        type: "list",
        items,
        total: parsed.total,
        truncated: items.length < parsed.total,
      };
    }
    if (rawType === "hash") {
      // HSCAN 1 call で最大 COUNT field 取得、HLEN で total。
      // field 名・値どちらも binary 可能なので hex で詰めて返す。
      const lua = `${LUA_TOHEX_PRELUDE} local total = redis.call('HLEN', KEYS[1]) local result = redis.call('HSCAN', KEYS[1], '0', 'COUNT', tonumber(ARGV[1])) local raw = result[2] local pairs_arr = {} local limit = tonumber(ARGV[1]) local count = 0 for i = 1, #raw, 2 do if count >= limit then break end table.insert(pairs_arr, {field = tohex(raw[i]), value = tohex(raw[i+1])}) count = count + 1 end return cjson.encode({total = total, fields = pairs_arr, count = count, cursor = result[1]})`;
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
            fields: Array<{ field: string; value: string }>;
            count: number;
            cursor: string;
          }>(stdout, "HSCAN")
        : { total: 0, fields: [], count: 0, cursor: "0" };
      const fields: RedisHashField[] = parsed.fields.map((p) => ({
        field: decodeHexItem(p.field),
        value: decodeHexItem(p.value),
      }));
      const truncated = parsed.count < parsed.total || parsed.cursor !== "0";
      return {
        type: "hash",
        fields,
        total: parsed.total,
        truncated,
      };
    }
    if (rawType === "set") {
      const lua = `${LUA_TOHEX_PRELUDE} local total = redis.call('SCARD', KEYS[1]) local result = redis.call('SSCAN', KEYS[1], '0', 'COUNT', tonumber(ARGV[1])) local members = {} local limit = tonumber(ARGV[1]) for i = 1, math.min(#result[2], limit) do members[i] = tohex(result[2][i]) end return cjson.encode({total = total, members = members, cursor = result[1]})`;
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
      const members = parsed.members.map(decodeHexItem);
      const truncated = members.length < parsed.total || parsed.cursor !== "0";
      return {
        type: "set",
        members,
        total: parsed.total,
        truncated,
      };
    }
    if (rawType === "zset") {
      const lua = `${LUA_TOHEX_PRELUDE} local total = redis.call('ZCARD', KEYS[1]) local r = redis.call('ZRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1, 'WITHSCORES') local arr = {} for i = 1, #r, 2 do table.insert(arr, {member = tohex(r[i]), score = tonumber(r[i+1])}) end return cjson.encode({total = total, members = arr})`;
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
      const members = parsed.members.map((m) => ({
        member: decodeHexItem(m.member),
        score: m.score,
      }));
      return {
        type: "zset",
        members,
        total: parsed.total,
        truncated: members.length < parsed.total,
      };
    }
    if (rawType === "stream") {
      // stream ID は <ms>-<seq> 形式の数値文字列なので hex 化不要。
      // field/value は binary 可能なので hex 化する。
      const lua = `${LUA_TOHEX_PRELUDE} local total = redis.call('XLEN', KEYS[1]) local r = redis.call('XRANGE', KEYS[1], '-', '+', 'COUNT', tonumber(ARGV[1])) local arr = {} for _, entry in ipairs(r) do local pairs_arr = {} for i = 1, #entry[2], 2 do table.insert(pairs_arr, {field = tohex(entry[2][i]), value = tohex(entry[2][i+1])}) end table.insert(arr, {id = entry[1], fields = pairs_arr}) end return cjson.encode({total = total, entries = arr})`;
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
            entries: Array<{
              id: string;
              fields: Array<{ field: string; value: string }>;
            }>;
          }>(stdout, "XRANGE")
        : { total: 0, entries: [] };
      const entries = parsed.entries.map((e) => ({
        id: e.id,
        fields: e.fields.map((p) => ({
          field: decodeHexItem(p.field),
          value: decodeHexItem(p.value),
        })),
      }));
      return {
        type: "stream",
        entries,
        total: parsed.total,
        truncated: entries.length < parsed.total,
      };
    }
    return { type: "none" };
  }

  // snapshot 用に "全データ" を読んで SHA256 を取り、UI 互換の truncated payload
  // も同時に作る。binary key 対応のため、key は hex で受けて Lua 側で fromhex
  // で復元してから redis コマンドに渡す。各 yield する SnapshotItem の
  // rowHash は閲覧用 truncation の影響を受けない完全データ hash になる。
  function snapshotFetch(
    db: number,
    hexKey: string,
    type: RedisType,
  ): { payload: RedisValue; fullHash: string } {
    if (type === "none") {
      return {
        payload: { type: "none" },
        fullHash: createHash("sha256").update("").digest("hex"),
      };
    }
    if (type === "string") return snapshotFetchString(db, hexKey);
    if (type === "list") return snapshotFetchList(db, hexKey);
    if (type === "hash") return snapshotFetchHash(db, hexKey);
    if (type === "set") return snapshotFetchSet(db, hexKey);
    if (type === "zset") return snapshotFetchZset(db, hexKey);
    if (type === "stream") return snapshotFetchStream(db, hexKey);
    return {
      payload: { type: "none" },
      fullHash: createHash("sha256").update("").digest("hex"),
    };
  }

  function evalHex(
    db: number,
    luaBody: string,
    extraArgv: string[],
    label: string,
  ): string {
    const r = execRedisCli(config, [
      "-n",
      String(db),
      "EVAL",
      luaBody,
      "0",
      ...extraArgv,
    ]);
    if (r.code !== 0) {
      throw new Error(r.stderr.trim() || `${label} failed`);
    }
    return r.stdout.replace(/\r?\n$/, "");
  }

  function snapshotFetchString(
    db: number,
    hexKey: string,
  ): { payload: RedisValue; fullHash: string } {
    const fullSize =
      Number(
        evalHex(
          db,
          `${LUA_HEX_KEY_PRELUDE} return redis.call('STRLEN', fromhex(ARGV[1]))`,
          [hexKey],
          "STRLEN",
        ),
      ) || 0;
    const hasher = createHash("sha256");
    let previewBytes = Buffer.alloc(0);
    for (let offset = 0; offset < fullSize; offset += REDIS_STRING_BYTE_LIMIT) {
      const end = Math.min(offset + REDIS_STRING_BYTE_LIMIT - 1, fullSize - 1);
      const hexChunk = evalHex(
        db,
        `${LUA_HEX_KEY_PRELUDE} return tohex(redis.call('GETRANGE', fromhex(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])))`,
        [hexKey, String(offset), String(end)],
        "GETRANGE",
      );
      const bytes = Buffer.from(hexChunk, "hex");
      hasher.update(bytes);
      if (offset === 0) previewBytes = bytes;
    }
    const truncated = fullSize > REDIS_STRING_BYTE_LIMIT;
    const payload: RedisValue = isValidUtf8(previewBytes)
      ? {
          type: "string",
          value: previewBytes.toString("utf8"),
          truncated,
          fullSize,
        }
      : {
          type: "string",
          value: "",
          binaryBase64: previewBytes.toString("base64"),
          truncated,
          fullSize,
        };
    return { payload, fullHash: hasher.digest("hex") };
  }

  // 長さ prefix 付きで hash に詰める。`<len_hex>:<hex>\n` 形式。
  // delimiter のみだと "ab|c" と "a|bc" が同じ hash になるので長さも入れる。
  function hashHexItem(hasher: import("node:crypto").Hash, hex: string): void {
    hasher.update(`${hex.length.toString(16)}:${hex}\n`);
  }

  function snapshotFetchList(
    db: number,
    hexKey: string,
  ): { payload: RedisValue; fullHash: string } {
    const total =
      Number(
        evalHex(
          db,
          `${LUA_HEX_KEY_PRELUDE} return redis.call('LLEN', fromhex(ARGV[1]))`,
          [hexKey],
          "LLEN",
        ),
      ) || 0;
    const hasher = createHash("sha256");
    let previewItems: RedisItem[] = [];
    for (let offset = 0; offset < total; offset += REDIS_COLLECTION_LIMIT) {
      const end = offset + REDIS_COLLECTION_LIMIT - 1;
      const stdout = evalHex(
        db,
        `${LUA_HEX_KEY_PRELUDE} local items = redis.call('LRANGE', fromhex(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])) local hex = {} for i, v in ipairs(items) do hex[i] = tohex(v) end return cjson.encode(hex)`,
        [hexKey, String(offset), String(end)],
        "LRANGE",
      );
      const chunk = safeJsonParse<string[]>(stdout, "LRANGE");
      for (const hex of chunk) hashHexItem(hasher, hex);
      if (offset === 0) previewItems = chunk.map(decodeHexItem);
    }
    const payload: RedisValue = {
      type: "list",
      items: previewItems,
      total,
      truncated: total > REDIS_COLLECTION_LIMIT,
    };
    return { payload, fullHash: hasher.digest("hex") };
  }

  function snapshotFetchHash(
    db: number,
    hexKey: string,
  ): { payload: RedisValue; fullHash: string } {
    const total =
      Number(
        evalHex(
          db,
          `${LUA_HEX_KEY_PRELUDE} return redis.call('HLEN', fromhex(ARGV[1]))`,
          [hexKey],
          "HLEN",
        ),
      ) || 0;
    // HSCAN は dedup を保証しないので全件集めてから field hex で sort する。
    const allPairs: Array<[string, string]> = [];
    let cursor = "0";
    do {
      const stdout = evalHex(
        db,
        `${LUA_HEX_KEY_PRELUDE} local r = redis.call('HSCAN', fromhex(ARGV[1]), ARGV[2], 'COUNT', tonumber(ARGV[3])) local raw = r[2] local pairs_arr = {} for i = 1, #raw, 2 do table.insert(pairs_arr, {tohex(raw[i]), tohex(raw[i+1])}) end return cjson.encode({cursor=r[1], pairs=pairs_arr})`,
        [hexKey, cursor, String(REDIS_COLLECTION_LIMIT)],
        "HSCAN",
      );
      const parsed = safeJsonParse<{
        cursor: string;
        pairs: [string, string][];
      }>(stdout, "HSCAN");
      allPairs.push(...parsed.pairs);
      cursor = parsed.cursor;
    } while (cursor !== "0");
    // HSCAN 自体が同じ要素を複数回返すこともあるので、field hex で dedup。
    const seenField = new Set<string>();
    const uniquePairs: Array<[string, string]> = [];
    for (const p of allPairs) {
      if (seenField.has(p[0])) continue;
      seenField.add(p[0]);
      uniquePairs.push(p);
    }
    uniquePairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const hasher = createHash("sha256");
    for (const [f, v] of uniquePairs) {
      hashHexItem(hasher, f);
      hashHexItem(hasher, v);
    }
    const previewFields: RedisHashField[] = uniquePairs
      .slice(0, REDIS_COLLECTION_LIMIT)
      .map(([f, v]) => ({ field: decodeHexItem(f), value: decodeHexItem(v) }));
    const payload: RedisValue = {
      type: "hash",
      fields: previewFields,
      total,
      truncated: total > REDIS_COLLECTION_LIMIT,
    };
    return { payload, fullHash: hasher.digest("hex") };
  }

  function snapshotFetchSet(
    db: number,
    hexKey: string,
  ): { payload: RedisValue; fullHash: string } {
    const total =
      Number(
        evalHex(
          db,
          `${LUA_HEX_KEY_PRELUDE} return redis.call('SCARD', fromhex(ARGV[1]))`,
          [hexKey],
          "SCARD",
        ),
      ) || 0;
    const allMembers: string[] = [];
    let cursor = "0";
    do {
      const stdout = evalHex(
        db,
        `${LUA_HEX_KEY_PRELUDE} local r = redis.call('SSCAN', fromhex(ARGV[1]), ARGV[2], 'COUNT', tonumber(ARGV[3])) local arr = {} for i, v in ipairs(r[2]) do arr[i] = tohex(v) end return cjson.encode({cursor=r[1], members=arr})`,
        [hexKey, cursor, String(REDIS_COLLECTION_LIMIT)],
        "SSCAN",
      );
      const parsed = safeJsonParse<{ cursor: string; members: string[] }>(
        stdout,
        "SSCAN",
      );
      allMembers.push(...parsed.members);
      cursor = parsed.cursor;
    } while (cursor !== "0");
    // SSCAN duplicate を dedupe してから sort。
    const dedup = Array.from(new Set(allMembers));
    dedup.sort();
    const hasher = createHash("sha256");
    for (const m of dedup) hashHexItem(hasher, m);
    const previewMembers = dedup
      .slice(0, REDIS_COLLECTION_LIMIT)
      .map(decodeHexItem);
    const payload: RedisValue = {
      type: "set",
      members: previewMembers,
      total,
      truncated: total > REDIS_COLLECTION_LIMIT,
    };
    return { payload, fullHash: hasher.digest("hex") };
  }

  function snapshotFetchZset(
    db: number,
    hexKey: string,
  ): { payload: RedisValue; fullHash: string } {
    const total =
      Number(
        evalHex(
          db,
          `${LUA_HEX_KEY_PRELUDE} return redis.call('ZCARD', fromhex(ARGV[1]))`,
          [hexKey],
          "ZCARD",
        ),
      ) || 0;
    // ZRANGE は score 順で stable なので chunked pagination で順次ハッシュする。
    const hasher = createHash("sha256");
    let previewMembers: Array<{ member: RedisItem; score: number }> = [];
    for (let offset = 0; offset < total; offset += REDIS_COLLECTION_LIMIT) {
      const end = offset + REDIS_COLLECTION_LIMIT - 1;
      const stdout = evalHex(
        db,
        `${LUA_HEX_KEY_PRELUDE} local r = redis.call('ZRANGE', fromhex(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), 'WITHSCORES') local arr = {} for i = 1, #r, 2 do table.insert(arr, {tohex(r[i]), tonumber(r[i+1])}) end return cjson.encode(arr)`,
        [hexKey, String(offset), String(end)],
        "ZRANGE",
      );
      const chunk = safeJsonParse<[string, number][]>(stdout, "ZRANGE");
      for (const [hex, score] of chunk) {
        hashHexItem(hasher, hex);
        hasher.update(`${score}\n`);
      }
      if (offset === 0) {
        previewMembers = chunk.map(([h, s]) => ({
          member: decodeHexItem(h),
          score: s,
        }));
      }
    }
    const payload: RedisValue = {
      type: "zset",
      members: previewMembers,
      total,
      truncated: total > REDIS_COLLECTION_LIMIT,
    };
    return { payload, fullHash: hasher.digest("hex") };
  }

  function snapshotFetchStream(
    db: number,
    hexKey: string,
  ): { payload: RedisValue; fullHash: string } {
    const total =
      Number(
        evalHex(
          db,
          `${LUA_HEX_KEY_PRELUDE} return redis.call('XLEN', fromhex(ARGV[1]))`,
          [hexKey],
          "XLEN",
        ),
      ) || 0;
    // XRANGE は id 順で安定。ページング: 直前最後の id の次から取り直す。
    // 簡単のため <id>-\0 のような hack をせず、見た id を Set で持って二重 yield 防止。
    const hasher = createHash("sha256");
    let previewEntries: Array<{ id: string; fields: RedisHashField[] }> = [];
    let startId = "-";
    const seenIds = new Set<string>();
    let first = true;
    for (;;) {
      const stdout = evalHex(
        db,
        `${LUA_HEX_KEY_PRELUDE} local r = redis.call('XRANGE', fromhex(ARGV[1]), ARGV[2], '+', 'COUNT', tonumber(ARGV[3])) local arr = {} for _, e in ipairs(r) do local fs = {} for i = 1, #e[2], 2 do fs[#fs+1] = tohex(e[2][i]) fs[#fs+1] = tohex(e[2][i+1]) end arr[#arr+1] = {id=e[1], fs=fs} end return cjson.encode(arr)`,
        [hexKey, startId, String(REDIS_COLLECTION_LIMIT)],
        "XRANGE",
      );
      const chunk = safeJsonParse<Array<{ id: string; fs: string[] }>>(
        stdout,
        "XRANGE",
      );
      if (chunk.length === 0) break;
      const newEntries: Array<{ id: string; fs: string[] }> = [];
      for (const e of chunk) {
        if (seenIds.has(e.id)) continue;
        seenIds.add(e.id);
        newEntries.push(e);
      }
      for (const e of newEntries) {
        hasher.update(`${e.id}\n`);
        for (const hex of e.fs) hashHexItem(hasher, hex);
      }
      if (first) {
        previewEntries = newEntries
          .slice(0, REDIS_COLLECTION_LIMIT)
          .map((e) => {
            const fields: RedisHashField[] = [];
            for (let i = 0; i < e.fs.length; i += 2) {
              fields.push({
                field: decodeHexItem(e.fs[i]),
                value: decodeHexItem(e.fs[i + 1]),
              });
            }
            return { id: e.id, fields };
          });
        first = false;
      }
      if (chunk.length < REDIS_COLLECTION_LIMIT) break;
      startId = chunk[chunk.length - 1].id;
    }
    const payload: RedisValue = {
      type: "stream",
      entries: previewEntries,
      total,
      truncated: total > REDIS_COLLECTION_LIMIT,
    };
    return { payload, fullHash: hasher.digest("hex") };
  }

  async function* iterateForSnapshot(
    container: string,
    signal?: AbortSignal,
  ): AsyncIterable<SnapshotItem> {
    const { db, pattern } = parseSnapshotContainer(container);
    // SCAN は同じ要素を複数回返すことがあるので hex key ベースで dedup する。
    // hex 化することで binary key も Set のキーとして扱える。
    const seen = new Set<string>();
    let cursor = "0";
    do {
      if (signal?.aborted) return;
      const stdout = evalHex(
        db,
        SCAN_HEX_KEYS_LUA,
        [cursor, pattern, String(REDIS_COLLECTION_LIMIT)],
        "SCAN",
      );
      const parsed = safeJsonParse<{
        cursor: string;
        keys: string[];
        types: string[];
      }>(stdout, "SCAN");
      for (let i = 0; i < parsed.keys.length; i++) {
        if (signal?.aborted) return;
        const hexKey = parsed.keys[i];
        if (seen.has(hexKey)) continue;
        seen.add(hexKey);
        const rawType = parsed.types[i] || "none";
        const type: RedisType = isValidRedisType(rawType) ? rawType : "none";
        const { payload, fullHash } = snapshotFetch(db, hexKey, type);
        const keyBytes = Buffer.from(hexKey, "hex");
        const keyName: RedisItem = isValidUtf8(keyBytes)
          ? keyBytes.toString("utf8")
          : { binaryBase64: keyBytes.toString("base64") };
        const keyJson = JSON.stringify({ db, key: keyName });
        const payloadJson = JSON.stringify({ type, value: payload });
        yield { keyJson, payloadJson, rowHash: fullHash };
      }
      cursor = parsed.cursor;
    } while (cursor !== "0");
  }

  async function listSnapshotContainers(): Promise<
    Array<{ id: string; label: string }>
  > {
    // Redis では UI に pattern 入力欄を出して任意 pattern を受け取る想定なので、
    // adapter から候補は返さない。空配列は UI 側で「pattern 必須」の示唆になる。
    return [];
  }

  return {
    kind: "redis",
    model: "kv",
    capabilities: { snapshot: true },
    listDatabases,
    listKeys,
    getValue,
    iterateForSnapshot,
    listSnapshotContainers,
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
