import type {
  EsIndexInfo,
  EsMapping,
  EsMappingProperty,
  EsQueryRequest,
  EsQueryResult,
  EsSearchResult,
} from "../../../core/database/types";
import type {
  DocSource,
  Queryable,
  SnapshotItem,
  SnapshotIterable,
} from "../sources/types";
import { throwIfAborted } from "./abort";
import { resolveRunningComposeContainerNameOrThrowAsync } from "./docker-utils";
import { spawnTextAsync } from "./spawn-runner";

type EsConfig = {
  containerName: string;
  // 認証あり ES の場合 elastic ユーザーのパスワード。stdin 経由で
  // 渡すので argv には現れない (Round 1 C2 と同パターン)。
  password: string;
};

// ドキュメント書き込み。id 指定で PUT (更新/upsert)、未指定で POST (id 自動採番)。
// seqNo/primaryTerm を渡すと楽観ロック (if_seq_no/if_primary_term) を付ける。
export type EsWriteOps = {
  writeDocAsync(opts: {
    index: string;
    id?: string;
    source: unknown;
    seqNo?: number;
    primaryTerm?: number;
    signal?: AbortSignal;
  }): Promise<{ id: string; result: string }>;
  deleteDocAsync(opts: {
    index: string;
    id: string;
    signal?: AbortSignal;
  }): Promise<void>;
};

export type ElasticsearchExplorer = DocSource &
  Queryable<EsQueryRequest, EsQueryResult> &
  SnapshotIterable &
  EsWriteOps & {
    readonly kind: "elasticsearch";
    readonly model: "document";
    readonly capabilities: { snapshot: true; query: true };
  };

// read-only ガード: 任意 path に書き込み系 API を投げられたら危険なので、
// query() 経由で許可する path を allowlist で限定する。最初の `/` を除いた
// 1 セグメント目で判定する (例: `/_search` / `/my-index/_search` どちらも OK)。
const ES_QUERY_ALLOWED_SUBPATHS = new Set([
  "_search",
  "_count",
  "_msearch",
  "_explain",
  "_validate",
  "_field_caps",
  "_eql",
]);

export function isReadOnlyEsPath(rawPath: string): boolean {
  // path に query string が付くケースもあるので `?` で切る。
  const path = rawPath.split("?")[0].replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 2) return false;
  const apiSegment = segments[segments.length - 1];
  return ES_QUERY_ALLOWED_SUBPATHS.has(apiSegment);
}

const ES_DEFAULT_SIZE = 200;

export function quoteCurlConfigString(value: string): string {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new Error("curl config value must not contain control characters");
    }
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

type EsHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

function buildEsRequestInvocation(
  config: EsConfig,
  method: EsHttpMethod,
  path: string,
  body?: unknown,
): { args: string[]; input?: string } {
  const hasPassword = !!config.password;
  // curl --user elastic:$PASSWORD は argv 露出するため、認証ありの場合は
  // -K - で stdin から config を流す。host の `ps -ef` には -K - だけが
  // 見え、credential 値は stdin 経由で渡る。
  // PoC では認証なしを default で動かす想定。認証ありは password が
  // 与えられた場合に有効化する。
  // curl の write-out で HTTP status と body を区切るために以下の trick を使う。
  //   --write-out '\n__ES_STATUS__:%{http_code}\n'
  // tail で status を取り、それより上を body とする。
  const url = `http://localhost:9200${path.startsWith("/") ? "" : "/"}${path}`;
  const curlConfig = hasPassword
    ? `user = ${quoteCurlConfigString(`elastic:${config.password}`)}\n`
    : undefined;
  const args = [
    "exec",
    "-i",
    config.containerName,
    "curl",
    "-s",
    "-S",
    "-X",
    method,
    url,
    "-w",
    "\n__ES_STATUS__:%{http_code}\n",
    "-H",
    "Content-Type: application/json",
    ...(hasPassword ? ["-K", "-"] : []),
    ...(body !== undefined ? ["--data-binary", JSON.stringify(body)] : []),
  ];
  return { args, input: curlConfig };
}

function execEsRequestAsync(
  config: EsConfig,
  method: EsHttpMethod,
  path: string,
  body?: unknown,
  timeoutMs = 15000,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  throwIfAborted(signal, "elasticsearch request aborted");
  const invocation = buildEsRequestInvocation(config, method, path, body);
  return spawnTextAsync({
    command: "docker",
    args: invocation.args,
    env: process.env,
    input: invocation.input,
    timeoutMs,
    signal,
    abortMessage: "elasticsearch request aborted",
    timeoutMessage: `elasticsearch request timed out after ${timeoutMs}ms`,
    rejectOnError: false,
  });
}

// curl の write-out で末尾に `\n__ES_STATUS__:NNN\n` を付けている。
// それを切り離して body と http status を返す。
function parseEsResponse(stdout: string): { status: number; body: string } {
  const marker = "__ES_STATUS__:";
  const idx = stdout.lastIndexOf(marker);
  if (idx < 0) return { status: 0, body: stdout };
  const statusPart = stdout.slice(idx + marker.length).trim();
  const status = Number(statusPart) || 0;
  // marker の前にある改行も剥がす。
  let body = stdout.slice(0, idx);
  if (body.endsWith("\n")) body = body.slice(0, -1);
  return { status, body };
}

function safeJsonParse<T>(stdout: string, label: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (err) {
    throw new Error(
      `${label} レスポンス JSON の parse に失敗: ${err instanceof Error ? err.message : String(err)} / 先頭200: ${stdout.slice(0, 200)}`,
    );
  }
}

function createElasticsearchAdapter(config: EsConfig): ElasticsearchExplorer {
  async function callJsonAsync<T>(
    method: EsHttpMethod,
    path: string,
    body: unknown,
    label: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const r = await execEsRequestAsync(
      config,
      method,
      path,
      body,
      15000,
      signal,
    );
    if (r.code !== 0) {
      throw new Error(r.stderr.trim() || `${label}: curl exit ${r.code}`);
    }
    const { status, body: text } = parseEsResponse(r.stdout);
    if (status < 200 || status >= 300) {
      throw new Error(`${label}: HTTP ${status} / ${text.slice(0, 200)}`);
    }
    if (!text.trim()) return {} as T;
    return safeJsonParse<T>(text, label);
  }

  async function listIndicesAsync(
    signal?: AbortSignal,
  ): Promise<EsIndexInfo[]> {
    const raw = await callJsonAsync<
      Array<{
        index?: string;
        "docs.count"?: string;
        "store.size"?: string;
        health?: string;
        status?: string;
      }>
    >(
      "GET",
      "/_cat/indices?format=json&expand_wildcards=open",
      undefined,
      "_cat/indices",
      signal,
    );
    const result: EsIndexInfo[] = [];
    for (const row of raw) {
      const name = row.index;
      if (!name || name.startsWith(".")) continue;
      result.push({
        name,
        docCount: Number(row["docs.count"]) || 0,
        sizeBytes: parseEsSize(row["store.size"]),
        health: row.health,
        status: row.status,
      });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  async function getMappingAsync(
    index: string,
    signal?: AbortSignal,
  ): Promise<EsMapping> {
    if (!index || index.includes("/") || index.includes("?")) {
      throw new Error(`invalid index name: ${index}`);
    }
    const raw = await callJsonAsync<
      Record<
        string,
        {
          mappings?: {
            properties?: Record<string, EsMappingProperty>;
          };
        }
      >
    >(
      "GET",
      `/${encodeURIComponent(index)}/_mapping`,
      undefined,
      "_mapping",
      signal,
    );
    const keys = Object.keys(raw);
    if (keys.length === 0) {
      return { index, properties: {} };
    }
    const realIndex = keys[0];
    const props = raw[realIndex]?.mappings?.properties ?? {};
    return { index: realIndex, properties: props };
  }

  async function searchDocsAsync(opts: {
    index: string;
    query?: string;
    size?: number;
    searchAfter?: unknown[];
    signal?: AbortSignal;
  }): Promise<EsSearchResult> {
    if (!opts.index || opts.index.includes("/") || opts.index.includes("?")) {
      throw new Error(`invalid index name: ${opts.index}`);
    }
    const size = Math.min(1000, Math.max(1, opts.size ?? ES_DEFAULT_SIZE));
    const body: Record<string, unknown> = {
      size,
      track_total_hits: true,
      seq_no_primary_term: true,
      sort: [{ _doc: "asc" }],
      query: opts.query
        ? { query_string: { query: opts.query } }
        : { match_all: {} },
    };
    if (opts.searchAfter && opts.searchAfter.length > 0) {
      body.search_after = opts.searchAfter;
    }
    type RawHit = {
      _index?: string;
      _id?: string;
      _score?: number | null;
      _source?: unknown;
      _seq_no?: number;
      _primary_term?: number;
      sort?: unknown[];
    };
    type RawResult = {
      hits?: {
        total?: { value?: number } | number;
        hits?: RawHit[];
      };
    };
    const raw = await callJsonAsync<RawResult>(
      "POST",
      `/${encodeURIComponent(opts.index)}/_search`,
      body,
      "_search",
      opts.signal,
    );
    const rawHits = raw.hits?.hits ?? [];
    const hits = rawHits.map((h) => ({
      _index: h._index ?? opts.index,
      _id: h._id ?? "",
      _score: h._score ?? null,
      _source: h._source,
      sort: h.sort,
      _seq_no: h._seq_no,
      _primary_term: h._primary_term,
    }));
    let totalHits = 0;
    const t = raw.hits?.total;
    if (typeof t === "number") totalHits = t;
    else if (t && typeof t.value === "number") totalHits = t.value;
    const lastSort = hits.length > 0 ? hits[hits.length - 1].sort : undefined;
    return { totalHits, hits, lastSort };
  }

  async function getDocAsync(opts: {
    index: string;
    id: string;
    signal?: AbortSignal;
  }): Promise<{
    found: boolean;
    source: unknown;
    seqNo?: number;
    primaryTerm?: number;
  }> {
    if (!opts.index || opts.index.includes("/") || opts.index.includes("?")) {
      throw new Error(`invalid index name: ${opts.index}`);
    }
    if (!opts.id) {
      throw new Error("missing doc id");
    }
    const r = await execEsRequestAsync(
      config,
      "GET",
      `/${encodeURIComponent(opts.index)}/_doc/${encodeURIComponent(opts.id)}`,
      undefined,
      15000,
      opts.signal,
    );
    if (r.code !== 0) {
      throw new Error(r.stderr.trim() || `_doc: curl exit ${r.code}`);
    }
    const { status, body: text } = parseEsResponse(r.stdout);
    type DocResp = {
      found?: boolean;
      _source?: unknown;
      _seq_no?: number;
      _primary_term?: number;
    };
    if (status === 404) {
      try {
        const parsed = text ? (JSON.parse(text) as DocResp) : { found: false };
        return { found: parsed.found === true, source: parsed._source };
      } catch {
        return { found: false, source: undefined };
      }
    }
    if (status < 200 || status >= 300) {
      throw new Error(`_doc: HTTP ${status} / ${text.slice(0, 200)}`);
    }
    const parsed = safeJsonParse<DocResp>(text, "_doc");
    return {
      found: parsed.found === true,
      source: parsed._source,
      seqNo: parsed._seq_no,
      primaryTerm: parsed._primary_term,
    };
  }

  function assertIndex(index: string): void {
    if (!index || index.includes("/") || index.includes("?")) {
      throw new Error(`invalid index name: ${index}`);
    }
  }

  async function writeDocAsync(opts: {
    index: string;
    id?: string;
    source: unknown;
    seqNo?: number;
    primaryTerm?: number;
    signal?: AbortSignal;
  }): Promise<{ id: string; result: string }> {
    assertIndex(opts.index);
    const idGiven = typeof opts.id === "string" && opts.id !== "";
    let path: string;
    let method: EsHttpMethod;
    if (idGiven) {
      path = `/${encodeURIComponent(opts.index)}/_doc/${encodeURIComponent(
        opts.id as string,
      )}`;
      method = "PUT";
      // 楽観ロック: 既読の seq_no/primary_term があれば衝突検出を付ける。
      if (opts.seqNo !== undefined && opts.primaryTerm !== undefined) {
        path += `?if_seq_no=${opts.seqNo}&if_primary_term=${opts.primaryTerm}`;
      }
    } else {
      path = `/${encodeURIComponent(opts.index)}/_doc`;
      method = "POST";
    }
    const resp = await callJsonAsync<{ _id?: string; result?: string }>(
      method,
      path,
      opts.source,
      "_doc write",
      opts.signal,
    );
    return { id: resp._id ?? opts.id ?? "", result: resp.result ?? "" };
  }

  async function deleteDocAsync(opts: {
    index: string;
    id: string;
    signal?: AbortSignal;
  }): Promise<void> {
    assertIndex(opts.index);
    if (!opts.id) throw new Error("missing doc id");
    await callJsonAsync(
      "DELETE",
      `/${encodeURIComponent(opts.index)}/_doc/${encodeURIComponent(opts.id)}`,
      undefined,
      "_doc delete",
      opts.signal,
    );
  }

  async function* iterateForSnapshot(
    container: string,
    signal?: AbortSignal,
  ): AsyncIterable<SnapshotItem> {
    const { index, query } = parseEsSnapshotContainer(container);
    // search_after で全件 iterate。PIT を使うのが本式だが PoC では
    // search_after だけで進める (R3 仕様書通り)。size 1000 で chunk しつつ、
    // 最終 hit の sort を次ループに渡す。size 未満が返れば終了。
    const PAGE = 1000;
    let searchAfter: unknown[] | undefined;
    for (;;) {
      if (signal?.aborted) return;
      const result = await searchDocsAsync({
        index,
        query,
        size: PAGE,
        searchAfter,
        signal,
      });
      if (result.hits.length === 0) return;
      for (const hit of result.hits) {
        if (signal?.aborted) return;
        const keyJson = JSON.stringify({ _index: hit._index, _id: hit._id });
        const payloadJson = JSON.stringify({ _source: hit._source });
        // doc version 識別: ES の _seq_no + _primary_term は idempotent な
        // version 番号 (write のたびに seq_no が単調増加、term は primary
        // 切り替えで増える)。両方欠落していたら _source の JSON で fallback。
        const rowHash =
          hit._seq_no !== undefined && hit._primary_term !== undefined
            ? `${hit._seq_no}-${hit._primary_term}`
            : payloadJson;
        yield { keyJson, payloadJson, rowHash };
      }
      if (result.hits.length < PAGE) return;
      searchAfter = result.lastSort;
      if (!searchAfter || searchAfter.length === 0) return;
    }
  }

  async function query(
    input: EsQueryRequest,
    _maxRows?: number,
    signal?: AbortSignal,
  ): Promise<EsQueryResult> {
    if (input.method !== "GET" && input.method !== "POST") {
      throw new Error(`method not allowed: ${input.method}`);
    }
    if (!input.path || typeof input.path !== "string") {
      throw new Error("missing path");
    }
    if (!isReadOnlyEsPath(input.path)) {
      throw new Error(
        `path is not in the read-only allowlist: ${input.path.split("?")[0]}`,
      );
    }
    // path 先頭の / は execEsRequest 側で吸収するのでそのまま渡す。
    const start = Date.now();
    const r = await execEsRequestAsync(
      config,
      input.method,
      input.path,
      input.body,
      15000,
      signal,
    );
    const elapsedMs = Date.now() - start;
    if (r.code !== 0) {
      throw new Error(r.stderr.trim() || `query: curl exit ${r.code}`);
    }
    const { status, body: text } = parseEsResponse(r.stdout);
    let body: unknown = text;
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        // text のまま返す (debug 用)。
      }
    } else {
      body = null;
    }
    return { status, body, elapsedMs };
  }

  async function listSnapshotContainers(): Promise<
    Array<{ id: string; label: string }>
  > {
    // index 一覧を SnapshotIterable の container 候補として返す。
    // id は canonical JSON で、label は表示用の生 index 名。
    const indices = await listIndicesAsync();
    return indices.map((ix) => ({
      id: JSON.stringify({ index: ix.name }),
      label: ix.name,
    }));
  }

  return {
    kind: "elasticsearch",
    model: "document",
    capabilities: { snapshot: true, query: true },
    listIndicesAsync,
    getMappingAsync,
    searchDocsAsync,
    getDocAsync,
    writeDocAsync,
    deleteDocAsync,
    iterateForSnapshot,
    listSnapshotContainers,
    query,
    close() {
      // nothing to close (docker exec is one-shot per call)
    },
  };
}

// canonicalizeEsSnapshotContainer と pair で、JSON 文字列または raw index 名
// から {index, query} に正規化する。canonicalize 側は JSON 文字列を返す関数で、
// こちらは内部で使う構造化値を返す。
function parseEsSnapshotContainer(container: string): {
  index: string;
  query?: string;
} {
  if (container.startsWith("{")) {
    try {
      const obj = JSON.parse(container) as { index?: string; query?: string };
      const index = typeof obj.index === "string" ? obj.index : "*";
      const query =
        typeof obj.query === "string" && obj.query.length > 0
          ? obj.query
          : undefined;
      return { index, query };
    } catch {
      // fall through
    }
  }
  return { index: container || "*" };
}

// "1kb" / "2.3mb" / "10gb" / "500b" のような表記を bytes に変換する。
// _cat/indices の human=true output (デフォルト) に対応するため。
function parseEsSize(raw: string | undefined): number {
  if (!raw) return 0;
  const m = raw
    .trim()
    .toLowerCase()
    .match(/^([\d.]+)\s*(b|kb|mb|gb|tb|pb)?$/);
  if (!m) return 0;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = m[2] || "b";
  const mult: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4,
    pb: 1024 ** 5,
  };
  return Math.round(n * (mult[unit] || 1));
}

// snapshot 用 container の正規化。`"my-index"` 単独でも JSON でも
// `{"index":"my-index"}` に揃える。R2-m1 redis canonicalize と同パターン。
export function canonicalizeEsSnapshotContainer(container: string): string {
  if (container.startsWith("{")) {
    try {
      const obj = JSON.parse(container) as { index?: string; query?: string };
      const index = typeof obj.index === "string" ? obj.index : "*";
      const query = typeof obj.query === "string" ? obj.query : undefined;
      const out: { index: string; query?: string } = { index };
      if (query !== undefined) out.query = query;
      return JSON.stringify(out);
    } catch {
      // fall through
    }
  }
  return JSON.stringify({ index: container || "*" });
}

export async function openElasticsearchAdapterAsync(
  serviceName: string,
  env: Record<string, string>,
  cwd: string,
  signal?: AbortSignal,
): Promise<ElasticsearchExplorer> {
  const containerName = await resolveRunningComposeContainerNameOrThrowAsync(
    serviceName,
    cwd,
    signal,
  );
  const password = env.ELASTIC_PASSWORD || "";
  return createElasticsearchAdapter({ containerName, password });
}
