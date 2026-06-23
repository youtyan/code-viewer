import type {
  RedisDatabasesResponse,
  RedisKeysResponse,
  RedisValueResponse,
} from "../../core/database/types";
import { openRedisExplorer, type RedisExplorer } from "./adapters/redis";
import { findDockerServiceByDbId, parseDockerDbId } from "./discovery";
import { json, textError } from "./handle";
import {
  createDockerAdapterCache,
  createQueryStrippedLogger,
  dispatchRoutes,
  handleError,
} from "./handle-shared";

const redisAdapterCache = createDockerAdapterCache<RedisExplorer>();

export function closeRedisAdapter(dbId: string): void {
  redisAdapterCache.close(dbId);
}

function resolveRedis(
  cwd: string,
  dbParam: string | null,
): { dbId: string; explorer: RedisExplorer } | Response {
  if (!dbParam) return textError("missing db parameter", 400);
  if (!dbParam.startsWith("docker:")) {
    return textError("redis requires docker: prefix", 400);
  }
  const parsed = parseDockerDbId(dbParam);
  if (!parsed) return textError("invalid docker db id", 400);
  const info = findDockerServiceByDbId(cwd, dbParam, "redis");
  if (!info) return textError("redis service not found", 404);

  const explorer = redisAdapterCache.getOrOpen(dbParam, () =>
    // openRedisExplorer の cwd 引数は `docker compose ps` の実行 dir。
    // recursive discovery 後は compose のあるディレクトリを渡す必要がある。
    openRedisExplorer(info.serviceName, info.env, info.composeDir),
  );
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
    return handleError("redis", "list redis databases", err);
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
    return handleError("redis", "list redis keys", err);
  }
}

export async function handleRedisRoute(
  req: Request,
  url: URL,
  cwd: string,
  sideEffectAllowed?: (req: Request) => boolean,
): Promise<Response | null> {
  const wrap = createQueryStrippedLogger("redis", req, url);
  return dispatchRoutes(
    req,
    url,
    {
      "/_db/redis/databases": {
        methods: ["GET"],
        handler: () => handleDatabases(cwd, url),
      },
      "/_db/redis/keys": {
        methods: ["GET"],
        handler: () => handleKeys(cwd, url),
      },
      "/_db/redis/value": {
        methods: ["GET"],
        handler: () => handleValue(cwd, url),
      },
    },
    sideEffectAllowed,
    wrap,
  );
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
    return handleError("redis", "read redis value", err);
  }
}
