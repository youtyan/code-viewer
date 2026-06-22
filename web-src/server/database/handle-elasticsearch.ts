import type {
  EsDocResponse,
  EsDocsResponse,
  EsIndicesResponse,
  EsMappingResponse,
  EsQueryResponse,
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

async function handleSearch(
  cwd: string,
  req: Request,
  url: URL,
): Promise<Response> {
  const r = resolveEs(cwd, url.searchParams.get("db"));
  if (r instanceof Response) return r;

  // GET の場合は `?q=<lucene>` を受けて `_search?q=...` に流す簡易フォーム。
  // POST の場合は JSON body で `{method, path, body}` をそのまま渡す
  // (UI からの DSL 実行用)。どちらも adapter 側の read-only allowlist が
  // 書き込み系を弾く。
  let input: { method: "GET" | "POST"; path: string; body?: unknown };
  if (req.method === "GET") {
    const q = url.searchParams.get("q");
    if (!q) return textError("missing q parameter", 400);
    const index = url.searchParams.get("index");
    const pathPrefix = index ? `/${encodeURIComponent(index)}` : "";
    input = {
      method: "GET",
      path: `${pathPrefix}/_search?q=${encodeURIComponent(q)}`,
    };
  } else if (req.method === "POST") {
    let body: { method?: string; path?: string; body?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return textError("invalid JSON body", 400);
    }
    if (body.method !== "GET" && body.method !== "POST") {
      return textError("method must be GET or POST", 400);
    }
    if (!body.path || typeof body.path !== "string") {
      return textError("missing path", 400);
    }
    input = { method: body.method, path: body.path, body: body.body };
  } else {
    return textError("method not allowed", 405);
  }

  try {
    const result = await r.explorer.query(input);
    const body: EsQueryResponse = {
      dbId: r.dbId,
      status: result.status,
      body: result.body,
      elapsedMs: result.elapsedMs,
    };
    return json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[code-viewer] elasticsearch error:", msg);
    const body: EsQueryResponse = {
      dbId: r.dbId,
      status: 0,
      body: null,
      elapsedMs: 0,
      error: msg,
    };
    return json(body, 400);
  }
}

function handleDoc(cwd: string, url: URL): Response {
  const r = resolveEs(cwd, url.searchParams.get("db"));
  if (r instanceof Response) return r;
  const index = url.searchParams.get("index");
  const id = url.searchParams.get("id");
  if (!index) return textError("missing index parameter", 400);
  if (!id) return textError("missing id parameter", 400);
  try {
    const doc = r.explorer.getDoc({ index, id });
    const body: EsDocResponse = {
      dbId: r.dbId,
      index,
      id,
      found: doc.found,
      source: doc.source,
      seqNo: doc.seqNo,
      primaryTerm: doc.primaryTerm,
    };
    return json(body);
  } catch (err) {
    console.error(
      "[code-viewer] elasticsearch error:",
      err instanceof Error ? err.message : String(err),
    );
    return textError(
      `failed to get elasticsearch doc: ${err instanceof Error ? err.message : String(err)}`,
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
  sideEffectAllowed?: (req: Request) => boolean,
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
  if (path === "/_db/elasticsearch/doc") {
    if (method !== "GET") {
      return wrap(textError("method not allowed", 405));
    }
    return wrap(handleDoc(cwd, url));
  }
  if (path === "/_db/elasticsearch/search") {
    if (method !== "GET" && method !== "POST") {
      return wrap(textError("method not allowed", 405));
    }
    // POST 経由は DSL を直接受けるルートなので、SQL の /_db/query と同等の
    // CSRF ガードをかける。GET は q= だけの read-only なので通す。
    if (method === "POST" && sideEffectAllowed && !sideEffectAllowed(req)) {
      return wrap(textError("forbidden", 403));
    }
    return wrap(await handleSearch(cwd, req, url));
  }
  return null;
}
