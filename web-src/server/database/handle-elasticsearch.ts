import type {
  EsDocsResponse,
  EsIndicesResponse,
  EsMappingResponse,
} from "../../core/database/types";
import {
  type ElasticsearchExplorer,
  openElasticsearchAdapter,
} from "./adapters/elasticsearch";
import { discoverDockerDatabases } from "./discovery";
import { json, textError } from "./handle";

const esAdapterCache = new Map<string, ElasticsearchExplorer>();

type DockerEsInfo = {
  serviceName: string;
  env: Record<string, string>;
};

let cachedEsServices: DockerEsInfo[] | null = null;
let cachedEsCwd: string | null = null;

function getEsServices(cwd: string): DockerEsInfo[] {
  if (cachedEsCwd === cwd && cachedEsServices) return cachedEsServices;
  const all = discoverDockerDatabases(cwd);
  cachedEsServices = all
    .filter((d) => d.kind === "elasticsearch")
    .map((d) => ({ serviceName: d.serviceName, env: d.env }));
  cachedEsCwd = cwd;
  return cachedEsServices;
}

function resolveEs(
  cwd: string,
  dbParam: string | null,
): { dbId: string; explorer: ElasticsearchExplorer } | Response {
  if (!dbParam) return textError("missing db parameter", 400);
  if (!dbParam.startsWith("docker:")) {
    return textError("elasticsearch requires docker: prefix", 400);
  }
  const serviceName = dbParam.slice(7).split(":")[0];
  const services = getEsServices(cwd);
  const info = services.find((s) => s.serviceName === serviceName);
  if (!info) return textError("elasticsearch service not found", 404);

  const cached = esAdapterCache.get(dbParam);
  if (cached) return { dbId: dbParam, explorer: cached };

  const explorer = openElasticsearchAdapter(info.serviceName, info.env, cwd);
  esAdapterCache.set(dbParam, explorer);
  return { dbId: dbParam, explorer };
}

function handleIndices(cwd: string, url: URL): Response {
  const r = resolveEs(cwd, url.searchParams.get("db"));
  if (r instanceof Response) return r;
  try {
    const indices = r.explorer.listIndices();
    const body: EsIndicesResponse = { dbId: r.dbId, indices };
    return json(body);
  } catch (err) {
    console.error(
      "[code-viewer] elasticsearch error:",
      err instanceof Error ? err.message : String(err),
    );
    return textError(
      `failed to list elasticsearch indices: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}

function handleDocs(cwd: string, url: URL): Response {
  const r = resolveEs(cwd, url.searchParams.get("db"));
  if (r instanceof Response) return r;
  const index = url.searchParams.get("index");
  if (!index) return textError("missing index parameter", 400);
  const query = url.searchParams.get("q") || undefined;
  const sizeRaw = url.searchParams.get("size");
  const size = sizeRaw ? Number(sizeRaw) : undefined;
  const sa = url.searchParams.get("searchAfter");
  let searchAfter: unknown[] | undefined;
  if (sa) {
    try {
      const parsed = JSON.parse(sa);
      if (Array.isArray(parsed)) searchAfter = parsed;
    } catch {
      return textError("invalid searchAfter (must be JSON array)", 400);
    }
  }
  try {
    const result = r.explorer.searchDocs({ index, query, size, searchAfter });
    const body: EsDocsResponse = {
      dbId: r.dbId,
      index,
      hits: result.hits,
      totalHits: result.totalHits,
      lastSort: result.lastSort,
    };
    return json(body);
  } catch (err) {
    console.error(
      "[code-viewer] elasticsearch error:",
      err instanceof Error ? err.message : String(err),
    );
    return textError(
      `failed to search elasticsearch docs: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}

function handleMapping(cwd: string, url: URL): Response {
  const r = resolveEs(cwd, url.searchParams.get("db"));
  if (r instanceof Response) return r;
  const index = url.searchParams.get("index");
  if (!index) return textError("missing index parameter", 400);
  try {
    const mapping = r.explorer.getMapping(index);
    const body: EsMappingResponse = { dbId: r.dbId, mapping };
    return json(body);
  } catch (err) {
    console.error(
      "[code-viewer] elasticsearch error:",
      err instanceof Error ? err.message : String(err),
    );
    return textError(
      `failed to read elasticsearch mapping: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}

export async function handleElasticsearchRoute(
  req: Request,
  url: URL,
  cwd: string,
): Promise<Response | null> {
  const path = url.pathname;
  const start = Date.now();
  const method = req.method;
  // クエリ文字列はログに載せない (index 名 / lucene query にユーザーデータが乗る)。
  const log = (status: number) => {
    const ms = Date.now() - start;
    console.log(`[code-viewer] ${method} ${path} ${status} ${ms}ms`);
  };
  const wrap = (res: Response): Response => {
    log(res.status);
    return res;
  };

  if (path === "/_db/elasticsearch/indices") {
    if (method !== "GET") {
      return wrap(textError("method not allowed", 405));
    }
    return wrap(handleIndices(cwd, url));
  }
  if (path === "/_db/elasticsearch/mapping") {
    if (method !== "GET") {
      return wrap(textError("method not allowed", 405));
    }
    return wrap(handleMapping(cwd, url));
  }
  if (path === "/_db/elasticsearch/docs") {
    if (method !== "GET") {
      return wrap(textError("method not allowed", 405));
    }
    return wrap(handleDocs(cwd, url));
  }
  return null;
}
