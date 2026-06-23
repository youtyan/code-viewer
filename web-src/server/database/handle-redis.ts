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

async function handleClose(req: Request): Promise<Response> {
  if (req.method !== "POST") return textError("method not allowed", 405);
  let body: { db?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (!body.db) return textError("missing db", 400);
  closeRedisAdapter(body.db);
  return json({ ok: true });
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
  sideEffectAllowed?: (req: Request) => boolean,
): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method;
  const wrap = createQueryStrippedLogger("redis", req, url);
  const routes: Record<
    string,
    {
      methods: readonly string[];
      sideEffect?: boolean;
      handler: () => Response | Promise<Response>;
    }
  > = {
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
    "/_db/redis/close": {
      methods: ["POST"],
      sideEffect: true,
      handler: () => handleClose(req),
    },
  };
  const route = routes[path];
  if (!route) return null;
  if (!route.methods.includes(method)) {
    return wrap(textError("method not allowed", 405));
  }
  if (route.sideEffect && sideEffectAllowed && !sideEffectAllowed(req)) {
    return wrap(textError("forbidden", 403));
  }
  return wrap(await route.handler());
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
