import type {
  EsDocResponse,
  EsDocsResponse,
  EsIndicesResponse,
  EsMappingResponse,
  EsQueryResponse,
} from "../../core/database/types";
import { asAsyncDoc } from "./adapters/async-facade";
import {
  type ElasticsearchExplorer,
  openElasticsearchAdapterAsync,
} from "./adapters/elasticsearch";
import {
  createDockerAdapterCache,
  createQueryStrippedLogger,
  dispatchRoutes,
  handleError,
  json,
  parseBoundedJsonBody,
  parsePostJsonBody,
  resolveDockerExplorerAsync,
  textError,
} from "./handle-shared";

const esAdapterCache = createDockerAdapterCache<ElasticsearchExplorer>();

export function closeElasticsearchAdapter(dbId: string): void {
  esAdapterCache.close(dbId);
}

function resolveEs(
  cwd: string,
  dbParam: string | null,
  signal?: AbortSignal,
  omitDirNames?: string[],
): Promise<{ dbId: string; explorer: ElasticsearchExplorer } | Response> {
  return resolveDockerExplorerAsync<ElasticsearchExplorer>(
    cwd,
    dbParam,
    "elasticsearch",
    esAdapterCache,
    (info) =>
      openElasticsearchAdapterAsync(
        info.serviceName,
        info.env,
        info.composeDir,
      ),
    omitDirNames,
    signal,
  );
}

async function handleIndices(
  req: Request,
  cwd: string,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveEs(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  try {
    const indices = await asAsyncDoc(r.explorer).listIndices(req.signal);
    const body: EsIndicesResponse = { dbId: r.dbId, indices };
    return json(body);
  } catch (err) {
    return handleError("elasticsearch", "list elasticsearch indices", err);
  }
}

async function handleDocs(
  req: Request,
  cwd: string,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveEs(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
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
    const result = await asAsyncDoc(r.explorer).searchDocs({
      index,
      query,
      size,
      searchAfter,
      signal: req.signal,
    });
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
  const r = await resolveEs(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
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
    const result = await r.explorer.query(input, undefined, req.signal);
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

async function handleDoc(
  req: Request,
  cwd: string,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveEs(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  const index = url.searchParams.get("index");
  const id = url.searchParams.get("id");
  if (!index) return textError("missing index parameter", 400);
  if (!id) return textError("missing id parameter", 400);
  try {
    const doc = await asAsyncDoc(r.explorer).getDoc({
      index,
      id,
      signal: req.signal,
    });
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

async function handleMapping(
  req: Request,
  cwd: string,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveEs(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  const index = url.searchParams.get("index");
  if (!index) return textError("missing index parameter", 400);
  try {
    const mapping = await asAsyncDoc(r.explorer).getMapping(index, req.signal);
    const body: EsMappingResponse = { dbId: r.dbId, mapping };
    return json(body);
  } catch (err) {
    return handleError("elasticsearch", "read elasticsearch mapping", err);
  }
}

async function handleWrite(
  req: Request,
  cwd: string,
  omitDirNames?: string[],
): Promise<Response> {
  const parsed = await parseBoundedJsonBody(
    req,
    4 * 1024 * 1024,
    "payload too large",
  );
  if (parsed instanceof Response) return parsed;
  const body = parsed as {
    db?: unknown;
    index?: unknown;
    id?: unknown;
    op?: unknown;
    source?: unknown;
    seqNo?: unknown;
    primaryTerm?: unknown;
  };
  if (typeof body.db !== "string" || body.db === "") {
    return textError("missing db", 400);
  }
  if (typeof body.index !== "string" || body.index === "") {
    return textError("missing index", 400);
  }
  const id = typeof body.id === "string" ? body.id : undefined;
  const r = await resolveEs(cwd, body.db, req.signal, omitDirNames);
  if (r instanceof Response) return r;
  try {
    if (body.op === "delete") {
      if (!id) return textError("missing id", 400);
      await r.explorer.deleteDocAsync({
        index: body.index,
        id,
        signal: req.signal,
      });
      return json({ ok: true });
    }
    // 既定は put (作成 / 更新)。source は JSON オブジェクトであること。
    if (
      body.source === null ||
      typeof body.source !== "object" ||
      Array.isArray(body.source)
    ) {
      return textError("source must be a JSON object", 400);
    }
    const seqNo = typeof body.seqNo === "number" ? body.seqNo : undefined;
    const primaryTerm =
      typeof body.primaryTerm === "number" ? body.primaryTerm : undefined;
    const result = await r.explorer.writeDocAsync({
      index: body.index,
      id,
      source: body.source,
      seqNo,
      primaryTerm,
      // op:"create" は既存 id を上書きしない (_create → 既存なら 409)。
      create: body.op === "create",
      signal: req.signal,
    });
    return json({ ok: true, id: result.id, result: result.result });
  } catch (err) {
    return handleError("elasticsearch", "write elasticsearch doc", err);
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
        handler: () => handleIndices(req, cwd, url, omitDirNames),
      },
      "/_db/elasticsearch/mapping": {
        methods: ["GET"],
        handler: () => handleMapping(req, cwd, url, omitDirNames),
      },
      "/_db/elasticsearch/docs": {
        methods: ["GET"],
        handler: () => handleDocs(req, cwd, url, omitDirNames),
      },
      "/_db/elasticsearch/doc": {
        methods: ["GET"],
        handler: () => handleDoc(req, cwd, url, omitDirNames),
      },
      "/_db/elasticsearch/write": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleWrite(req, cwd, omitDirNames),
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
