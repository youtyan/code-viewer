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
import {
  createDockerAdapterCache,
  createQueryStrippedLogger,
  dispatchRoutes,
  handleError,
  json,
  parsePostJsonBody,
  resolveDockerExplorer,
  textError,
} from "./handle-shared";

const esAdapterCache = createDockerAdapterCache<ElasticsearchExplorer>();

export function closeElasticsearchAdapter(dbId: string): void {
  esAdapterCache.close(dbId);
}

function resolveEs(
  cwd: string,
  dbParam: string | null,
  omitDirNames?: string[],
): { dbId: string; explorer: ElasticsearchExplorer } | Response {
  return resolveDockerExplorer<ElasticsearchExplorer>(
    cwd,
    dbParam,
    "elasticsearch",
    esAdapterCache,
    (info) =>
      openElasticsearchAdapter(info.serviceName, info.env, info.composeDir),
    omitDirNames,
  );
}

function handleIndices(
  cwd: string,
  url: URL,
  omitDirNames?: string[],
): Response {
  const r = resolveEs(cwd, url.searchParams.get("db"), omitDirNames);
  if (r instanceof Response) return r;
  try {
    const indices = r.explorer.listIndices();
    const body: EsIndicesResponse = { dbId: r.dbId, indices };
    return json(body);
  } catch (err) {
    return handleError("elasticsearch", "list elasticsearch indices", err);
  }
}

function handleDocs(cwd: string, url: URL, omitDirNames?: string[]): Response {
  const r = resolveEs(cwd, url.searchParams.get("db"), omitDirNames);
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
    return handleError("elasticsearch", "search elasticsearch docs", err);
  }
}

async function handleSearch(
  cwd: string,
  req: Request,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = resolveEs(cwd, url.searchParams.get("db"), omitDirNames);
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
    const body = await parsePostJsonBody<{
      method?: string;
      path?: string;
      body?: unknown;
    }>(req);
    if (body instanceof Response) return body;
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
      ...result,
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

function handleDoc(cwd: string, url: URL, omitDirNames?: string[]): Response {
  const r = resolveEs(cwd, url.searchParams.get("db"), omitDirNames);
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
    return handleError("elasticsearch", "get elasticsearch doc", err);
  }
}

function handleMapping(
  cwd: string,
  url: URL,
  omitDirNames?: string[],
): Response {
  const r = resolveEs(cwd, url.searchParams.get("db"), omitDirNames);
  if (r instanceof Response) return r;
  const index = url.searchParams.get("index");
  if (!index) return textError("missing index parameter", 400);
  try {
    const mapping = r.explorer.getMapping(index);
    const body: EsMappingResponse = { dbId: r.dbId, mapping };
    return json(body);
  } catch (err) {
    return handleError("elasticsearch", "read elasticsearch mapping", err);
  }
}

export async function handleElasticsearchRoute(
  req: Request,
  url: URL,
  cwd: string,
  sideEffectAllowed?: (req: Request) => boolean,
  omitDirNames?: string[],
): Promise<Response | null> {
  const wrap = createQueryStrippedLogger("elasticsearch", req, url);
  return dispatchRoutes(
    req,
    url,
    {
      "/_db/elasticsearch/indices": {
        methods: ["GET"],
        handler: () => handleIndices(cwd, url, omitDirNames),
      },
      "/_db/elasticsearch/mapping": {
        methods: ["GET"],
        handler: () => handleMapping(cwd, url, omitDirNames),
      },
      "/_db/elasticsearch/docs": {
        methods: ["GET"],
        handler: () => handleDocs(cwd, url, omitDirNames),
      },
      "/_db/elasticsearch/doc": {
        methods: ["GET"],
        handler: () => handleDoc(cwd, url, omitDirNames),
      },
      "/_db/elasticsearch/search": {
        methods: ["GET", "POST"],
        // POST 経由は DSL を直接受けるルートなので、SQL の /_db/query と同等の
        // CSRF ガードをかける。GET は q= だけの read-only なので通す。
        sideEffect: (m) => m === "POST",
        handler: () => handleSearch(cwd, req, url, omitDirNames),
      },
    },
    sideEffectAllowed,
    wrap,
    (err) => handleError("elasticsearch", "handle elasticsearch request", err),
  );
}
