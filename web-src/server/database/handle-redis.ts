import type {
  RedisDatabasesResponse,
  RedisKeysResponse,
  RedisValueResponse,
} from "../../core/database/types";
import { openRedisExplorer, type RedisExplorer } from "./adapters/redis";
import { discoverDockerDatabases } from "./discovery";
import { json, textError } from "./handle";

const redisAdapterCache = new Map<string, RedisExplorer>();

type DockerRedisInfo = {
  serviceName: string;
  env: Record<string, string>;
};

let cachedRedisDbs: DockerRedisInfo[] | null = null;
let cachedRedisCwd: string | null = null;

function getRedisServices(cwd: string): DockerRedisInfo[] {
  if (cachedRedisCwd === cwd && cachedRedisDbs) return cachedRedisDbs;
  const all = discoverDockerDatabases(cwd);
  cachedRedisDbs = all
    .filter((d) => d.kind === "redis")
    .map((d) => ({ serviceName: d.serviceName, env: d.env }));
  cachedRedisCwd = cwd;
  return cachedRedisDbs;
}

function resolveRedis(
  cwd: string,
  dbParam: string | null,
): { dbId: string; explorer: RedisExplorer } | Response {
  if (!dbParam) return textError("missing db parameter", 400);
  if (!dbParam.startsWith("docker:")) {
    return textError("redis requires docker: prefix", 400);
  }
  const serviceName = dbParam.slice(7).split(":")[0];
  const services = getRedisServices(cwd);
  const info = services.find((s) => s.serviceName === serviceName);
  if (!info) return textError("redis service not found", 404);

  const cached = redisAdapterCache.get(dbParam);
  if (cached) return { dbId: dbParam, explorer: cached };

  const explorer = openRedisExplorer(info.serviceName, info.env, cwd);
  redisAdapterCache.set(dbParam, explorer);
  return { dbId: dbParam, explorer };
}

function handleDatabases(cwd: string, url: URL): Response {
  const r = resolveRedis(cwd, url.searchParams.get("db"));
  if (r instanceof Response) return r;
  try {
    const databases = r.explorer.listDatabases();
    const body: RedisDatabasesResponse = { dbId: r.dbId, databases };
    return json(body);
  } catch (err) {
    console.error(
      "[code-viewer] redis error:",
      err instanceof Error ? err.message : String(err),
    );
    return textError(
      `failed to list redis databases: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}

function handleKeys(cwd: string, url: URL): Response {
  const r = resolveRedis(cwd, url.searchParams.get("db"));
  if (r instanceof Response) return r;
  const dbIndexRaw = url.searchParams.get("dbIndex");
  if (dbIndexRaw === null) return textError("missing dbIndex", 400);
  const dbIndex = Number(dbIndexRaw);
  if (!Number.isInteger(dbIndex) || dbIndex < 0 || dbIndex > 15) {
    return textError("dbIndex must be an integer in 0..15", 400);
  }
  const pattern = url.searchParams.get("pattern") || "*";
  const cursor = url.searchParams.get("cursor") || "0";
  const countRaw = url.searchParams.get("count");
  const count = countRaw
    ? Math.min(10000, Math.max(1, Number(countRaw) || 200))
    : 200;
  try {
    const { keys, nextCursor } = r.explorer.listKeys({
      db: dbIndex,
      pattern,
      cursor,
      count,
    });
    const body: RedisKeysResponse = {
      dbId: r.dbId,
      dbIndex,
      keys,
      nextCursor,
    };
    return json(body);
  } catch (err) {
    console.error(
      "[code-viewer] redis error:",
      err instanceof Error ? err.message : String(err),
    );
    return textError(
      `failed to list redis keys: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}

export async function handleRedisRoute(
  req: Request,
  url: URL,
  cwd: string,
): Promise<Response | null> {
  const path = url.pathname;
  const start = Date.now();
  const method = req.method;
  // ログには query string を含めない (key=, pattern= 等にユーザーデータが乗る)。
  const log = (status: number) => {
    const ms = Date.now() - start;
    console.log(`[code-viewer] ${method} ${path} ${status} ${ms}ms`);
  };
  const wrap = (res: Response): Response => {
    log(res.status);
    return res;
  };
  if (
    path !== "/_db/redis/databases" &&
    path !== "/_db/redis/keys" &&
    path !== "/_db/redis/value"
  ) {
    return null;
  }
  if (method !== "GET") {
    return wrap(textError("method not allowed", 405));
  }
  if (path === "/_db/redis/databases") return wrap(handleDatabases(cwd, url));
  if (path === "/_db/redis/keys") return wrap(handleKeys(cwd, url));
  return wrap(handleValue(cwd, url));
}

function handleValue(cwd: string, url: URL): Response {
  const r = resolveRedis(cwd, url.searchParams.get("db"));
  if (r instanceof Response) return r;
  const dbIndexRaw = url.searchParams.get("dbIndex");
  if (dbIndexRaw === null) return textError("missing dbIndex", 400);
  const dbIndex = Number(dbIndexRaw);
  if (!Number.isInteger(dbIndex) || dbIndex < 0 || dbIndex > 15) {
    return textError("dbIndex must be an integer in 0..15", 400);
  }
  const key = url.searchParams.get("key");
  if (!key) return textError("missing key", 400);
  try {
    const value = r.explorer.getValue({ db: dbIndex, key });
    const body: RedisValueResponse = { dbId: r.dbId, dbIndex, key, value };
    return json(body);
  } catch (err) {
    console.error(
      "[code-viewer] redis error:",
      err instanceof Error ? err.message : String(err),
    );
    return textError(
      `failed to read redis value: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}
