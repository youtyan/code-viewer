import { hasControlCharacter } from "../../core/control-chars";
import { s3ObjectName } from "../../core/database/s3-keys";
import type {
  S3BucketsResponse,
  S3FolderResponse,
  S3ObjectHeadResponse,
  S3ObjectsResponse,
  S3SearchMode,
  S3SortMode,
} from "../../core/database/types";
import { sourceDisplayKind } from "../../core/source-meta";
import { isAbortLikeError } from "./adapters/abort";
import {
  createS3Adapter,
  isS3HttpError,
  openS3ExplorerAsync,
  type S3Explorer,
} from "./adapters/s3";
import {
  createDockerAdapterCache,
  createQueryStrippedLogger,
  dispatchRoutes,
  handleError,
  json,
  parseBoundedJsonBody,
  resolveDatastoreExplorerAsync,
  textError,
} from "./handle-shared";

const s3AdapterCache = createDockerAdapterCache<S3Explorer>();
const DEFAULT_OBJECT_LIMIT = 200;
const MAX_OBJECT_LIMIT = 1000;
const UPDATED_SORT_SCAN_PAGES = 2;
const MAX_CONTAINS_SCAN_PAGES = 10;
const MAX_TEXT_PREVIEW_BYTES = 512 * 1024;

export function closeS3Adapter(dbId: string): void {
  s3AdapterCache.close(dbId);
}

function resolveS3(
  cwd: string,
  dbParam: string | null,
  signal?: AbortSignal,
  omitDirNames?: string[],
): Promise<{ dbId: string; explorer: S3Explorer } | Response> {
  return resolveDatastoreExplorerAsync<S3Explorer>(
    cwd,
    dbParam,
    "s3",
    s3AdapterCache,
    (info) => openS3ExplorerAsync(info),
    (connection) => {
      if (connection.kind !== "s3") throw new Error("invalid S3 connection");
      return createS3Adapter(connection);
    },
    omitDirNames,
    signal,
  );
}

function validateBucket(value: string | null): string | Response {
  if (!value) return textError("missing bucket parameter", 400);
  if (value.length > 255 || value.includes("/") || hasControlCharacter(value)) {
    return textError("invalid bucket parameter", 400);
  }
  return value;
}

function validateKey(value: string | null): string | Response {
  if (!value) return textError("missing key parameter", 400);
  if (value.length > 4096 || hasControlCharacter(value)) {
    return textError("invalid key parameter", 400);
  }
  return value;
}

function validateOptionalText(
  value: string | null,
  name: string,
  maxLen: number,
): string | Response {
  if (!value) return "";
  if (value.length > maxLen || hasControlCharacter(value)) {
    return textError(`invalid ${name} parameter`, 400);
  }
  return value;
}

function parseLimit(url: URL): number {
  const raw = Number(url.searchParams.get("limit") || DEFAULT_OBJECT_LIMIT);
  return Math.min(
    MAX_OBJECT_LIMIT,
    Math.max(1, Number.isFinite(raw) ? raw : DEFAULT_OBJECT_LIMIT),
  );
}

function parseMode(url: URL): S3SearchMode | Response {
  const raw = url.searchParams.get("mode") || "prefix";
  if (raw === "prefix" || raw === "contains") return raw;
  return textError("invalid mode parameter", 400);
}

function parseSort(url: URL): S3SortMode | Response {
  const raw = url.searchParams.get("sort") || "updated-desc";
  if (raw === "key-asc" || raw === "updated-desc") return raw;
  return textError("invalid sort parameter", 400);
}

function sortObjects<T extends { key: string; updatedAt?: string }>(
  objects: T[],
  sort: S3SortMode,
): T[] {
  return [...objects].sort((a, b) => {
    if (sort === "updated-desc") {
      const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      if (tb !== ta) return tb - ta;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

async function scanObjects(
  explorer: S3Explorer,
  opts: {
    bucket: string;
    prefix?: string;
    continuationToken?: string;
    maxPages: number;
    signal?: AbortSignal;
    shouldStop?: (
      objects: Awaited<ReturnType<S3Explorer["listObjects"]>>["objects"],
    ) => boolean;
  },
): Promise<{
  objects: Awaited<ReturnType<S3Explorer["listObjects"]>>["objects"];
  nextToken?: string;
  truncated: boolean;
  scannedObjects: number;
  scannedPages: number;
  scanLimitReached: boolean;
}> {
  let continuationToken = opts.continuationToken;
  let upstreamTruncated = false;
  let scannedObjects = 0;
  let scannedPages = 0;
  const objects: Awaited<ReturnType<S3Explorer["listObjects"]>>["objects"] = [];
  do {
    const requestToken = continuationToken;
    const page = await explorer.listObjects({
      bucket: opts.bucket,
      prefix: opts.prefix,
      continuationToken: requestToken,
      maxKeys: MAX_OBJECT_LIMIT,
      signal: opts.signal,
    });
    scannedPages++;
    scannedObjects += page.objects.length;
    objects.push(...page.objects);
    upstreamTruncated = page.truncated;
    continuationToken =
      page.nextToken && page.nextToken !== requestToken
        ? page.nextToken
        : undefined;
    if (opts.shouldStop?.(objects)) break;
  } while (continuationToken && scannedPages < opts.maxPages);
  return {
    objects,
    nextToken: continuationToken,
    truncated: upstreamTruncated,
    scannedObjects,
    scannedPages,
    scanLimitReached: !!continuationToken && scannedPages >= opts.maxPages,
  };
}

function s3ErrorResponse(
  err: unknown,
  action: string,
  signal?: AbortSignal,
): Response {
  if (isAbortLikeError(err, signal))
    return handleError("s3", action, err, signal);
  if (isS3HttpError(err)) return textError(err.message, err.status);
  return handleError("s3", action, err, signal);
}

async function handleBuckets(
  req: Request,
  cwd: string,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveS3(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  try {
    const buckets = await r.explorer.listBuckets(req.signal);
    const body: S3BucketsResponse = { dbId: r.dbId, buckets };
    return json(body);
  } catch (err) {
    return s3ErrorResponse(err, "list s3 buckets", req.signal);
  }
}

async function handleObjects(
  cwd: string,
  req: Request,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveS3(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  const bucket = validateBucket(url.searchParams.get("bucket"));
  if (bucket instanceof Response) return bucket;
  const prefix = validateOptionalText(
    url.searchParams.get("prefix"),
    "prefix",
    2048,
  );
  if (prefix instanceof Response) return prefix;
  const search = validateOptionalText(url.searchParams.get("q"), "q", 512);
  if (search instanceof Response) return search;
  const token = validateOptionalText(
    url.searchParams.get("token"),
    "token",
    4096,
  );
  if (token instanceof Response) return token;
  const mode = parseMode(url);
  if (mode instanceof Response) return mode;
  const sort = parseSort(url);
  if (sort instanceof Response) return sort;
  const limit = parseLimit(url);

  try {
    if (mode === "prefix") {
      const effectivePrefix = search || prefix;
      if (sort === "updated-desc") {
        const scanned = await scanObjects(r.explorer, {
          bucket,
          prefix: effectivePrefix,
          continuationToken: token || undefined,
          maxPages: UPDATED_SORT_SCAN_PAGES,
          signal: req.signal,
        });
        const sorted = sortObjects(scanned.objects, sort);
        const body: S3ObjectsResponse = {
          dbId: r.dbId,
          bucket,
          prefix: effectivePrefix,
          search,
          mode,
          sort,
          objects: sorted,
          nextToken: scanned.nextToken,
          truncated: scanned.truncated,
          scannedObjects: scanned.scannedObjects,
          scannedPages: scanned.scannedPages,
          ...(scanned.scanLimitReached ? { scanLimitReached: true } : {}),
        };
        return json(body);
      }
      const page = await r.explorer.listObjects({
        bucket,
        prefix: effectivePrefix,
        continuationToken: token || undefined,
        maxKeys: limit,
        signal: req.signal,
      });
      const body: S3ObjectsResponse = {
        dbId: r.dbId,
        bucket,
        prefix: effectivePrefix,
        search,
        mode,
        sort,
        objects: page.objects,
        nextToken: page.nextToken,
        truncated: page.truncated,
        scannedObjects: page.objects.length,
        scannedPages: 1,
      };
      return json(body);
    }

    const needle = search.toLowerCase();
    if (!needle) {
      const body: S3ObjectsResponse = {
        dbId: r.dbId,
        bucket,
        prefix,
        search,
        mode,
        sort,
        objects: [],
        truncated: false,
        scannedObjects: 0,
        scannedPages: 0,
      };
      return json(body);
    }
    const scanned = await scanObjects(r.explorer, {
      bucket,
      prefix,
      continuationToken: token || undefined,
      maxPages: MAX_CONTAINS_SCAN_PAGES,
      signal: req.signal,
      shouldStop: (objects) => {
        let matchCount = 0;
        for (const object of objects) {
          const haystack =
            `${object.key}\n${s3ObjectName(object.key)}`.toLowerCase();
          if (haystack.includes(needle)) matchCount++;
          if (matchCount >= limit) return true;
        }
        return false;
      },
    });
    const matches: Awaited<ReturnType<S3Explorer["listObjects"]>>["objects"] =
      [];
    for (const object of scanned.objects) {
      const haystack =
        `${object.key}\n${s3ObjectName(object.key)}`.toLowerCase();
      if (haystack.includes(needle)) {
        matches.push(object);
        if (matches.length >= limit) break;
      }
    }

    const sorted = sortObjects(matches, sort).slice(0, limit);
    const body: S3ObjectsResponse = {
      dbId: r.dbId,
      bucket,
      prefix,
      search,
      mode,
      sort,
      objects: sorted,
      nextToken: scanned.nextToken,
      truncated: scanned.truncated,
      scannedObjects: scanned.scannedObjects,
      scannedPages: scanned.scannedPages,
      ...(scanned.scanLimitReached ? { scanLimitReached: true } : {}),
    };
    return json(body);
  } catch (err) {
    return s3ErrorResponse(err, "list s3 objects", req.signal);
  }
}

async function handleFolder(
  cwd: string,
  req: Request,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveS3(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  const bucket = validateBucket(url.searchParams.get("bucket"));
  if (bucket instanceof Response) return bucket;
  // prefix は末尾 "/" のフォルダパス。ルートは空文字。
  const prefix = validateOptionalText(
    url.searchParams.get("prefix"),
    "prefix",
    2048,
  );
  if (prefix instanceof Response) return prefix;
  const token = validateOptionalText(
    url.searchParams.get("token"),
    "token",
    4096,
  );
  if (token instanceof Response) return token;
  try {
    const page = await r.explorer.listObjects({
      bucket,
      prefix,
      delimiter: "/",
      continuationToken: token || undefined,
      maxKeys: MAX_OBJECT_LIMIT,
      signal: req.signal,
    });
    // フォルダ自身を表すプレースホルダオブジェクト (key === prefix) は除外する。
    const objects = page.objects.filter((object) => object.key !== prefix);
    const body: S3FolderResponse = {
      dbId: r.dbId,
      bucket,
      prefix,
      folders: page.commonPrefixes ?? [],
      objects,
      ...(page.nextToken ? { nextToken: page.nextToken } : {}),
    };
    return json(body);
  } catch (err) {
    return s3ErrorResponse(err, "list s3 folder", req.signal);
  }
}

async function handleHead(
  cwd: string,
  req: Request,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveS3(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  const bucket = validateBucket(url.searchParams.get("bucket"));
  if (bucket instanceof Response) return bucket;
  const key = validateKey(url.searchParams.get("key"));
  if (key instanceof Response) return key;
  try {
    const head = await r.explorer.headObject({
      bucket,
      key,
      signal: req.signal,
    });
    const body: S3ObjectHeadResponse = { ...head, dbId: r.dbId };
    return json(body);
  } catch (err) {
    return s3ErrorResponse(err, "read s3 object metadata", req.signal);
  }
}

async function handleText(
  cwd: string,
  req: Request,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveS3(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  const bucket = validateBucket(url.searchParams.get("bucket"));
  if (bucket instanceof Response) return bucket;
  const key = validateKey(url.searchParams.get("key"));
  if (key instanceof Response) return key;
  if (sourceDisplayKind(key) !== "text") {
    return textError("object is not previewable as text", 415);
  }
  try {
    const result = await r.explorer.getObjectText({
      bucket,
      key,
      maxBytes: MAX_TEXT_PREVIEW_BYTES,
      signal: req.signal,
    });
    return json({
      ...result.head,
      dbId: r.dbId,
      text: result.text,
      truncated: result.truncated,
    });
  } catch (err) {
    return s3ErrorResponse(err, "read s3 object text", req.signal);
  }
}

async function handleRaw(
  cwd: string,
  req: Request,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveS3(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  const bucket = validateBucket(url.searchParams.get("bucket"));
  if (bucket instanceof Response) return bucket;
  const key = validateKey(url.searchParams.get("key"));
  if (key instanceof Response) return key;
  try {
    return await r.explorer.getObjectResponse({
      bucket,
      key,
      method: req.method as "GET" | "HEAD",
      range: req.headers.get("range"),
      signal: req.signal,
    });
  } catch (err) {
    return s3ErrorResponse(err, "stream s3 object", req.signal);
  }
}

// テキスト内容でのオブジェクト作成/上書き、およびオブジェクト削除。
// バイナリ (ファイル) アップロードは将来対応。
async function handleWrite(
  req: Request,
  cwd: string,
  omitDirNames?: string[],
): Promise<Response> {
  const parsed = await parseBoundedJsonBody(
    req,
    8 * 1024 * 1024,
    "payload too large",
  );
  if (parsed instanceof Response) return parsed;
  const body = parsed as {
    db?: unknown;
    bucket?: unknown;
    key?: unknown;
    op?: unknown;
    content?: unknown;
    contentType?: unknown;
  };
  if (typeof body.db !== "string" || body.db === "") {
    return textError("missing db", 400);
  }
  const bucket = validateBucket(
    typeof body.bucket === "string" ? body.bucket : null,
  );
  if (bucket instanceof Response) return bucket;
  const key = validateKey(typeof body.key === "string" ? body.key : null);
  if (key instanceof Response) return key;
  const r = await resolveS3(cwd, body.db, req.signal, omitDirNames);
  if (r instanceof Response) return r;
  try {
    if (body.op === "delete") {
      await r.explorer.deleteObjectAsync({
        bucket,
        key,
        signal: req.signal,
      });
      return json({ ok: true });
    }
    // op:"create" は既存オブジェクトを上書きしない。S3 には移植性のある
    // アトミック作成が無いため、PUT 前に HEAD で存在チェックする (TOCTOU は
    // 残るが、UI 上の「新規作成」が既存を黙って潰すのを防ぐ)。
    if (body.op === "create") {
      let exists = false;
      try {
        await r.explorer.headObject({ bucket, key, signal: req.signal });
        exists = true;
      } catch (err) {
        if (isS3HttpError(err) && err.status === 404) exists = false;
        else throw err;
      }
      if (exists) return textError(`object already exists: ${key}`, 409);
    }
    // put (作成/上書き)。content はテキスト。
    const content = typeof body.content === "string" ? body.content : "";
    const contentType =
      typeof body.contentType === "string" && body.contentType
        ? body.contentType
        : "application/octet-stream";
    await r.explorer.putObjectAsync({
      bucket,
      key,
      body: new TextEncoder().encode(content),
      contentType,
      signal: req.signal,
    });
    return json({ ok: true });
  } catch (err) {
    return handleError("s3", "write s3 object", err, req.signal);
  }
}

export async function handleS3Route(
  req: Request,
  url: URL,
  cwd: string,
  sideEffectAllowed?: (req: Request) => boolean,
  omitDirNames?: string[],
): Promise<Response | null> {
  const wrap = createQueryStrippedLogger("s3", req, url);
  return dispatchRoutes(
    req,
    url,
    {
      "/_db/s3/buckets": {
        methods: ["GET"],
        handler: () => handleBuckets(req, cwd, url, omitDirNames),
      },
      "/_db/s3/objects": {
        methods: ["GET"],
        handler: () => handleObjects(cwd, req, url, omitDirNames),
      },
      "/_db/s3/folder": {
        methods: ["GET"],
        handler: () => handleFolder(cwd, req, url, omitDirNames),
      },
      "/_db/s3/head": {
        methods: ["GET"],
        handler: () => handleHead(cwd, req, url, omitDirNames),
      },
      "/_db/s3/text": {
        methods: ["GET"],
        handler: () => handleText(cwd, req, url, omitDirNames),
      },
      "/_db/s3/raw": {
        methods: ["GET", "HEAD"],
        handler: () => handleRaw(cwd, req, url, omitDirNames),
      },
      "/_db/s3/write": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleWrite(req, cwd, omitDirNames),
      },
    },
    sideEffectAllowed,
    wrap,
    (err) => handleError("s3", "handle s3 request", err, req.signal),
  );
}
