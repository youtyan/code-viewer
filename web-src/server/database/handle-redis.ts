import type {
  RedisDatabasesResponse,
  RedisKeysResponse,
  RedisValueResponse,
} from "../../core/database/types";
import { openRedisExplorer, type RedisExplorer } from "./adapters/redis";
import {
  createDockerAdapterCache,
  createQueryStrippedLogger,
  dispatchRoutes,
  handleError,
  json,
  resolveDockerExplorer,
  textError,
} from "./handle-shared";

const redisAdapterCache = createDockerAdapterCache<RedisExplorer>();

export function closeRedisAdapter(dbId: string): void {
  redisAdapterCache.close(dbId);
}

function resolveRedis(
  cwd: string,
  dbParam: string | null,
  omitDirNames?: string[],
): { dbId: string; explorer: RedisExplorer } | Response {
  return resolveDockerExplorer<RedisExplorer>(
    cwd,
    dbParam,
    "redis",
    redisAdapterCache,
    (info) => openRedisExplorer(info.serviceName, info.env, info.composeDir),
    omitDirNames,
  );
}

function handleDatabases(
  cwd: string,
  url: URL,
  omitDirNames?: string[],
): Response {
  const r = resolveRedis(cwd, url.searchParams.get("db"), omitDirNames);
  if (r instanceof Response) return r;
  try {
    const databases = r.explorer.listDatabases();
    const body: RedisDatabasesResponse = { dbId: r.dbId, databases };
    return json(body);
  } catch (err) {
    return handleError("redis", "list redis databases", err);
  }
}

function handleKeys(cwd: string, url: URL, omitDirNames?: string[]): Response {
  const r = resolveRedis(cwd, url.searchParams.get("db"), omitDirNames);
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
    return handleError("redis", "list redis keys", err);
  }
}

export async function handleRedisRoute(
  req: Request,
  url: URL,
  cwd: string,
  sideEffectAllowed?: (req: Request) => boolean,
  omitDirNames?: string[],
): Promise<Response | null> {
  const wrap = createQueryStrippedLogger("redis", req, url);
  return dispatchRoutes(
    req,
    url,
    {
      "/_db/redis/databases": {
        methods: ["GET"],
        handler: () => handleDatabases(cwd, url, omitDirNames),
      },
      "/_db/redis/keys": {
        methods: ["GET"],
        handler: () => handleKeys(cwd, url, omitDirNames),
      },
      "/_db/redis/value": {
        methods: ["GET"],
        handler: () => handleValue(cwd, url, omitDirNames),
      },
    },
    sideEffectAllowed,
    wrap,
  );
}

function handleValue(cwd: string, url: URL, omitDirNames?: string[]): Response {
  const r = resolveRedis(cwd, url.searchParams.get("db"), omitDirNames);
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
    return handleError("redis", "read redis value", err);
  }
}
