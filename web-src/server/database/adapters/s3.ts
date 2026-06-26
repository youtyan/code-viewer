import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import type {
  S3BucketInfo,
  S3ObjectHeadResponse,
  S3ObjectInfo,
} from "../../../core/database/types";
import { rawFileHeaders } from "../../raw-file-headers";
import type { DockerDbInfo } from "../discovery";
import type { ObjectSource } from "../sources/types";
import { resolveRunningComposeContainerNameOrThrowAsync } from "./docker-utils";
import { spawnCollectAsync } from "./spawn-runner";

type S3Config = {
  endpoint: string;
  dockerContainerName?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

type SignedRequestOptions = {
  method: "GET" | "HEAD";
  bucket?: string;
  key?: string;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

type S3RequestDeadline = {
  expiresAt: number;
  timeoutMs: number;
};

export type S3Explorer = ObjectSource & {
  readonly kind: "s3";
  readonly model: "object";
};

let spawnSyncImpl = spawnSync;
let spawnSyncImplIsTestOverride = false;

export function __setS3SpawnSyncForTest(
  spawnSyncForTest: typeof spawnSync | null,
): void {
  spawnSyncImpl = spawnSyncForTest ?? spawnSync;
  spawnSyncImplIsTestOverride = !!spawnSyncForTest;
}

class S3HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const DEFAULT_S3_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_S3_DOCKER_CURL_TIMEOUT_MS = 30000;

let s3RequestTimeoutMs = DEFAULT_S3_REQUEST_TIMEOUT_MS;
let s3DockerCurlTimeoutMs = DEFAULT_S3_DOCKER_CURL_TIMEOUT_MS;

export function __setS3RequestTimeoutMsForTest(timeoutMs: number | null): void {
  s3RequestTimeoutMs = timeoutMs ?? DEFAULT_S3_REQUEST_TIMEOUT_MS;
}

export function __setS3DockerCurlTimeoutMsForTest(
  timeoutMs: number | null,
): void {
  s3DockerCurlTimeoutMs = timeoutMs ?? DEFAULT_S3_DOCKER_CURL_TIMEOUT_MS;
}

function createS3RequestDeadline(): S3RequestDeadline {
  const timeoutMs = s3RequestTimeoutMs;
  return {
    expiresAt: Date.now() + timeoutMs,
    timeoutMs,
  };
}

function createS3DockerCurlDeadline(): S3RequestDeadline {
  const timeoutMs = s3DockerCurlTimeoutMs;
  return {
    expiresAt: Date.now() + timeoutMs,
    timeoutMs,
  };
}

function createS3TransportDeadline(config: S3Config): S3RequestDeadline {
  return config.dockerContainerName
    ? createS3DockerCurlDeadline()
    : createS3RequestDeadline();
}

function s3TimeoutError(deadline?: S3RequestDeadline): S3HttpError {
  return new S3HttpError(
    503,
    `S3 request timed out after ${deadline?.timeoutMs ?? s3RequestTimeoutMs}ms`,
  );
}

function remainingS3TimeoutMs(deadline?: S3RequestDeadline): number {
  if (!deadline) return s3RequestTimeoutMs;
  return Math.max(0, deadline.expiresAt - Date.now());
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodePath(value: string): string {
  return value.split("/").map(encodeRfc3986).join("/");
}

function compareCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function buildPath(bucket?: string, key?: string): string {
  if (!bucket) return "/";
  return `/${encodeRfc3986(bucket)}${key ? `/${encodePath(key)}` : ""}`;
}

function canonicalQuery(
  query: Record<string, string | undefined> = {},
): string {
  return Object.entries(query)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(
      ([ak, av], [bk, bv]) =>
        compareCodeUnit(ak, bk) || compareCodeUnit(av, bv),
    )
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

function amzDate(date = new Date()): { dateStamp: string; amzDate: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { dateStamp: iso.slice(0, 8), amzDate: iso };
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function signedHeadersString(headers: Record<string, string>): string {
  return Object.keys(headers)
    .map((key) => key.toLowerCase())
    .sort(compareCodeUnit)
    .join(";");
}

function canonicalHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(
      ([key, value]) =>
        [key.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const,
    )
    .sort(([a], [b]) => compareCodeUnit(a, b))
    .map(([key, value]) => `${key}:${value}\n`)
    .join("");
}

function xmlText(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return match ? decodeXml(match[1]) : undefined;
}

function xmlBlocks(xml: string, tag: string): string[] {
  return Array.from(
    xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi")),
    (m) => m[1],
  );
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function sanitizeS3Error(status: number, text: string): S3HttpError {
  const message =
    xmlText(text, "Message") ||
    xmlText(text, "Code") ||
    text.replace(/\s+/g, " ").trim().slice(0, 240) ||
    "S3 request failed";
  return new S3HttpError(status, `S3 HTTP ${status}: ${message}`);
}

function rawObjectHeaders(key: string, upstream: Response): HeadersInit {
  return rawFileHeaders(key, {
    upstreamContentType: upstream.headers.get("content-type"),
    htmlAsHtml: true,
    allowUpstreamMediaContentType: true,
    contentLength: upstream.headers.get("content-length"),
    contentRange: upstream.headers.get("content-range"),
    etag: upstream.headers.get("etag"),
    lastModified: upstream.headers.get("last-modified"),
  });
}

function splitCurlHeadersAndBody(bytes: Uint8Array): {
  headerText: string;
  body: Uint8Array;
} {
  const buffer = Buffer.from(bytes);
  let idx = buffer.indexOf("\r\n\r\n");
  let sepLen = 4;
  if (idx < 0) {
    idx = buffer.indexOf("\n\n");
    sepLen = 2;
  }
  if (idx < 0) {
    return { headerText: "", body: bytes };
  }
  const headerText = buffer.subarray(0, idx).toString("utf8");
  const body = buffer.subarray(idx + sepLen);
  return { headerText, body: new Uint8Array(body) };
}

function responseFromCurlOutput(bytes: Uint8Array): Response {
  const { headerText, body } = splitCurlHeadersAndBody(bytes);
  const headerBlocks = headerText
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const block = headerBlocks[headerBlocks.length - 1] || "";
  const lines = block.split(/\r?\n/).filter(Boolean);
  const statusMatch = lines[0]?.match(/^HTTP\/\S+\s+(\d+)/i);
  const status = statusMatch ? Number(statusMatch[1]) : 502;
  const headers = new Headers();
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    headers.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  const arrayBuffer = body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength,
  ) as ArrayBuffer;
  return new Response(arrayBuffer, { status, headers });
}

function curlConfigQuote(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")}"`;
}

function curlHeaderConfig(headers: Headers): string {
  const lines: string[] = [];
  headers.forEach((value, key) => {
    lines.push(`header = ${curlConfigQuote(`${key}: ${value}`)}`);
  });
  return `${lines.join("\n")}\n`;
}

function dockerCurlCommand(opts: {
  containerName: string;
  method: "GET" | "HEAD";
  url: string;
  headers: Headers;
}): { args: string[]; input: Buffer } {
  return {
    args: [
      "exec",
      "-i",
      opts.containerName,
      "curl",
      "-sS",
      "-X",
      opts.method,
      "-D",
      "-",
      "-o",
      opts.method === "HEAD" ? "/dev/null" : "-",
      "-K",
      "-",
      opts.url,
    ],
    input: Buffer.from(curlHeaderConfig(opts.headers), "utf8"),
  };
}

function guardedS3Transport<T>(
  signal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
  deadline?: S3RequestDeadline,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new S3HttpError(503, "S3 HTTP transport aborted"));
  }
  const timeoutMs = remainingS3TimeoutMs(deadline);
  if (timeoutMs <= 0) {
    return Promise.reject(s3TimeoutError(deadline));
  }
  const controller = new AbortController();
  let timedOut = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleanupParent = () => {};

  const abort = (err: S3HttpError, reject: (err: S3HttpError) => void) => {
    if (settled) return;
    settled = true;
    controller.abort(err);
    reject(err);
  };

  const guarded = new Promise<T>((resolve, reject) => {
    const onParentAbort = () =>
      abort(new S3HttpError(503, "S3 HTTP transport aborted"), reject);
    if (signal) {
      signal.addEventListener("abort", onParentAbort, { once: true });
      cleanupParent = () => signal.removeEventListener("abort", onParentAbort);
    }
    timer = setTimeout(() => {
      timedOut = true;
      abort(s3TimeoutError(deadline), reject);
    }, timeoutMs);

    operation(controller.signal).then(
      (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        if (timedOut) {
          reject(s3TimeoutError(deadline));
        } else if (signal?.aborted) {
          reject(new S3HttpError(503, "S3 HTTP transport aborted"));
        } else {
          reject(err);
        }
      },
    );
  });

  return guarded.finally(() => {
    if (timer) clearTimeout(timer);
    cleanupParent();
  });
}

async function readStreamChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
  deadline?: S3RequestDeadline,
): ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]> {
  return guardedS3Transport(
    signal,
    (transportSignal) => {
      const cancelRead = () => {
        void reader.cancel(transportSignal.reason).catch(() => {});
      };
      if (transportSignal.aborted) {
        cancelRead();
      } else {
        transportSignal.addEventListener("abort", cancelRead, { once: true });
      }
      return reader.read().finally(() => {
        transportSignal.removeEventListener("abort", cancelRead);
      });
    },
    deadline,
  );
}

async function readResponseBytesWithTimeout(
  res: Response,
  signal?: AbortSignal,
  deadline?: S3RequestDeadline,
): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await readStreamChunkWithTimeout(
        reader,
        signal,
        deadline,
      );
      if (done) break;
      if (!value?.byteLength) continue;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* the reader may already be cancelled by timeout/abort */
    }
  }
  if (chunks.length === 1) return chunks[0];
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readResponseTextWithTimeout(
  res: Response,
  signal?: AbortSignal,
  deadline?: S3RequestDeadline,
): Promise<string> {
  return new TextDecoder("utf-8", { fatal: false }).decode(
    await readResponseBytesWithTimeout(res, signal, deadline),
  );
}

function timeoutReadableStream(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await readStreamChunkWithTimeout(
          reader,
          signal,
        );
        if (done) {
          controller.close();
          return;
        }
        if (value) controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function dockerCurlFetch(opts: {
  containerName: string;
  method: "GET" | "HEAD";
  url: string;
  headers: Headers;
  signal?: AbortSignal;
}): Promise<Response> {
  const { args, input } = dockerCurlCommand(opts);
  if (spawnSyncImplIsTestOverride) {
    const proc = spawnSyncImpl("docker", args, {
      encoding: "buffer",
      input,
      timeout: s3DockerCurlTimeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if ((proc.status ?? 1) !== 0) {
      const stderr = new TextDecoder()
        .decode(proc.stderr || new Uint8Array())
        .replace(/\s+/g, " ")
        .trim();
      throw new S3HttpError(
        503,
        `S3 HTTP transport failed via docker exec${stderr ? `: ${stderr.slice(0, 240)}` : ""}`,
      );
    }
    return responseFromCurlOutput(
      new Uint8Array(proc.stdout || new Uint8Array()),
    );
  }
  if (opts.signal?.aborted) {
    throw new S3HttpError(503, "S3 HTTP transport aborted");
  }
  const proc = await spawnCollectAsync({
    command: "docker",
    args,
    input,
    timeoutMs: s3DockerCurlTimeoutMs,
    signal: opts.signal,
    abortMessage: "S3 HTTP transport aborted",
    timeoutMessage: `docker exec curl timed out after ${s3DockerCurlTimeoutMs}ms`,
  });
  if (proc.code !== 0) {
    const stderr = new TextDecoder()
      .decode(proc.stderr)
      .replace(/\s+/g, " ")
      .trim();
    throw new S3HttpError(
      503,
      `S3 HTTP transport failed via docker exec${stderr ? `: ${stderr.slice(0, 240)}` : ""}`,
    );
  }
  return responseFromCurlOutput(new Uint8Array(proc.stdout));
}

function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseContentLength(res: Response): number | null {
  const raw = res.headers.get("content-length");
  if (raw === null) return null;
  const size = Number(raw);
  return Number.isFinite(size) ? size : null;
}

function parseContentRangeTotal(res: Response): number | null {
  const raw = res.headers.get("content-range");
  if (!raw) return null;
  const match = /\/(\d+|\*)\s*$/.exec(raw);
  if (!match || match[1] === "*") return null;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : null;
}

function headFromObjectResponse(
  bucket: string,
  key: string,
  res: Response,
): S3ObjectHeadResponse {
  const rangedTotal = parseContentRangeTotal(res);
  const contentLength = parseContentLength(res);
  return {
    dbId: "",
    bucket,
    key,
    sizeBytes: rangedTotal ?? contentLength,
    ...(res.headers.get("content-type")
      ? { contentType: res.headers.get("content-type") || undefined }
      : {}),
    ...(res.headers.get("last-modified")
      ? {
          updatedAt: toIsoDate(res.headers.get("last-modified") || undefined),
        }
      : {}),
    ...(res.headers.get("etag")
      ? { etag: res.headers.get("etag") || undefined }
      : {}),
  };
}

function parseBuckets(xml: string): S3BucketInfo[] {
  return xmlBlocks(xml, "Bucket")
    .map((block) => {
      const name = xmlText(block, "Name") || "";
      return {
        name,
        ...(toIsoDate(xmlText(block, "CreationDate"))
          ? { createdAt: toIsoDate(xmlText(block, "CreationDate")) }
          : {}),
      };
    })
    .filter((bucket) => bucket.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseObjects(xml: string): {
  objects: S3ObjectInfo[];
  commonPrefixes: string[];
  nextToken?: string;
  truncated: boolean;
} {
  const objects = xmlBlocks(xml, "Contents")
    .map((block) => {
      const key = xmlText(block, "Key") || "";
      const updatedAt = toIsoDate(xmlText(block, "LastModified"));
      return {
        key,
        sizeBytes: Number(xmlText(block, "Size") || "0") || 0,
        ...(updatedAt ? { updatedAt } : {}),
        ...(xmlText(block, "ETag") ? { etag: xmlText(block, "ETag") } : {}),
        ...(xmlText(block, "StorageClass")
          ? { storageClass: xmlText(block, "StorageClass") }
          : {}),
      };
    })
    .filter((object) => object.key);
  // delimiter 指定時、直下のサブフォルダは <CommonPrefixes><Prefix>foo/</Prefix>
  // として返る。
  const commonPrefixes = xmlBlocks(xml, "CommonPrefixes")
    .map((block) => xmlText(block, "Prefix") || "")
    .filter(Boolean);
  return {
    objects,
    commonPrefixes,
    nextToken: xmlText(xml, "NextContinuationToken"),
    truncated: xmlText(xml, "IsTruncated") === "true",
  };
}

function createS3Adapter(config: S3Config): S3Explorer {
  async function signedFetch(
    opts: SignedRequestOptions,
    deadline = createS3TransportDeadline(config),
  ): Promise<Response> {
    return guardedS3Transport(
      opts.signal,
      (transportSignal) => {
        const endpoint = new URL(config.endpoint);
        const { dateStamp, amzDate: requestDate } = amzDate();
        const path = buildPath(opts.bucket, opts.key);
        const query = canonicalQuery(opts.query);
        const url = `${config.endpoint.replace(/\/$/, "")}${path}${query ? `?${query}` : ""}`;
        const headers: Record<string, string> = {
          host: endpoint.host,
          "x-amz-content-sha256": EMPTY_SHA256,
          "x-amz-date": requestDate,
          ...(config.sessionToken
            ? { "x-amz-security-token": config.sessionToken }
            : {}),
          ...(opts.headers || {}),
        };
        const signedNames = signedHeadersString(headers);
        const canonicalRequest = [
          opts.method,
          path,
          query,
          canonicalHeaders(headers),
          signedNames,
          EMPTY_SHA256,
        ].join("\n");
        const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
        const stringToSign = [
          "AWS4-HMAC-SHA256",
          requestDate,
          scope,
          sha256(canonicalRequest),
        ].join("\n");
        const signature = createHmac(
          "sha256",
          signingKey(config.secretAccessKey, dateStamp, config.region),
        )
          .update(stringToSign, "utf8")
          .digest("hex");
        const requestHeaders = new Headers();
        for (const [key, value] of Object.entries(headers)) {
          if (key !== "host") requestHeaders.set(key, value);
        }
        requestHeaders.set(
          "Authorization",
          `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedNames}, Signature=${signature}`,
        );
        if (config.dockerContainerName) {
          if (
            opts.method === "GET" &&
            opts.key &&
            !opts.headers?.range &&
            !opts.headers?.Range
          ) {
            throw new S3HttpError(
              503,
              "S3 raw streaming requires a published host port or a ranged request",
            );
          }
          return dockerCurlFetch({
            containerName: config.dockerContainerName,
            method: opts.method,
            url,
            headers: requestHeaders,
            signal: transportSignal,
          });
        }
        return fetch(url, {
          method: opts.method,
          headers: requestHeaders,
          signal: transportSignal,
        });
      },
      deadline,
    );
  }

  async function textOrThrow(
    res: Response,
    signal?: AbortSignal,
    deadline?: S3RequestDeadline,
  ): Promise<string> {
    const text = await readResponseTextWithTimeout(res, signal, deadline);
    if (!res.ok) throw sanitizeS3Error(res.status, text);
    return text;
  }

  async function listBuckets(signal?: AbortSignal): Promise<S3BucketInfo[]> {
    const deadline = createS3TransportDeadline(config);
    const xml = await textOrThrow(
      await signedFetch({ method: "GET", signal }, deadline),
      signal,
      deadline,
    );
    return parseBuckets(xml);
  }

  async function listObjects(opts: {
    bucket: string;
    prefix?: string;
    continuationToken?: string;
    maxKeys?: number;
    delimiter?: string;
    signal?: AbortSignal;
  }): Promise<{
    objects: S3ObjectInfo[];
    commonPrefixes?: string[];
    nextToken?: string;
    truncated: boolean;
  }> {
    const deadline = createS3TransportDeadline(config);
    const xml = await textOrThrow(
      await signedFetch(
        {
          method: "GET",
          bucket: opts.bucket,
          query: {
            "list-type": "2",
            "max-keys": String(
              Math.min(1000, Math.max(1, opts.maxKeys ?? 200)),
            ),
            ...(opts.prefix ? { prefix: opts.prefix } : {}),
            ...(opts.delimiter ? { delimiter: opts.delimiter } : {}),
            ...(opts.continuationToken
              ? { "continuation-token": opts.continuationToken }
              : {}),
          },
          signal: opts.signal,
        },
        deadline,
      ),
      opts.signal,
      deadline,
    );
    return parseObjects(xml);
  }

  async function headObject(opts: {
    bucket: string;
    key: string;
    signal?: AbortSignal;
  }): Promise<S3ObjectHeadResponse> {
    const deadline = createS3TransportDeadline(config);
    const res = await signedFetch(
      {
        method: "HEAD",
        bucket: opts.bucket,
        key: opts.key,
        signal: opts.signal,
      },
      deadline,
    );
    if (!res.ok)
      throw sanitizeS3Error(
        res.status,
        await readResponseTextWithTimeout(res, opts.signal, deadline),
      );
    return headFromObjectResponse(opts.bucket, opts.key, res);
  }

  async function getObjectText(opts: {
    bucket: string;
    key: string;
    maxBytes?: number;
    signal?: AbortSignal;
  }): Promise<{
    text: string;
    truncated: boolean;
    head: S3ObjectHeadResponse;
  }> {
    const maxBytes = Math.min(
      1024 * 1024,
      Math.max(1, opts.maxBytes ?? 512 * 1024),
    );
    const deadline = createS3TransportDeadline(config);
    const res = await signedFetch(
      {
        method: "GET",
        bucket: opts.bucket,
        key: opts.key,
        headers: { range: `bytes=0-${maxBytes - 1}` },
        signal: opts.signal,
      },
      deadline,
    );
    if (!res.ok && res.status !== 206)
      throw sanitizeS3Error(
        res.status,
        await readResponseTextWithTimeout(res, opts.signal, deadline),
      );
    const bytes = await readResponseBytesWithTimeout(
      res,
      opts.signal,
      deadline,
    );
    const head = headFromObjectResponse(opts.bucket, opts.key, res);
    const fullSize = head.sizeBytes;
    return {
      text: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
      truncated:
        fullSize !== null
          ? bytes.byteLength < fullSize
          : res.status === 206 || bytes.byteLength >= maxBytes,
      head,
    };
  }

  async function getObjectResponse(opts: {
    bucket: string;
    key: string;
    method: "GET" | "HEAD";
    range?: string | null;
    signal?: AbortSignal;
  }): Promise<Response> {
    const deadline = createS3TransportDeadline(config);
    const res = await signedFetch(
      {
        method: opts.method,
        bucket: opts.bucket,
        key: opts.key,
        headers: opts.range ? { range: opts.range } : undefined,
        signal: opts.signal,
      },
      deadline,
    );
    if (!res.ok && res.status !== 206) {
      throw sanitizeS3Error(
        res.status,
        await readResponseTextWithTimeout(res, opts.signal, deadline),
      );
    }
    return new Response(
      opts.method === "HEAD"
        ? null
        : timeoutReadableStream(res.body, opts.signal),
      {
        status: res.status,
        headers: rawObjectHeaders(opts.key, res),
      },
    );
  }

  return {
    kind: "s3",
    model: "object",
    close() {},
    listBuckets,
    listObjects,
    headObject,
    getObjectText,
    getObjectResponse,
  };
}

async function s3ConfigFromDockerInfoAsync(
  info: DockerDbInfo,
  signal?: AbortSignal,
): Promise<S3Config> {
  const image = info.image?.toLowerCase() || "";
  const minioDefault = image.includes("minio");
  const env = info.env;
  if (!info.hostPort && minioDefault) {
    throw new S3HttpError(
      503,
      'MinIO S3 browsing requires a published host port. Add a compose port mapping like "9000:9000" for the MinIO API.',
    );
  }
  const dockerContainerName = info.hostPort
    ? undefined
    : await resolveRunningComposeContainerNameOrThrowAsync(
        info.serviceName,
        info.composeDir,
        signal,
      );
  return {
    endpoint: info.hostPort
      ? `http://localhost:${info.hostPort}`
      : `http://127.0.0.1:${info.containerPort}`,
    ...(dockerContainerName ? { dockerContainerName } : {}),
    region: env.AWS_REGION || env.AWS_DEFAULT_REGION || "us-east-1",
    accessKeyId:
      env.AWS_ACCESS_KEY_ID ||
      env.MINIO_ROOT_USER ||
      env.MINIO_ACCESS_KEY ||
      (minioDefault ? "minioadmin" : "test"),
    secretAccessKey:
      env.AWS_SECRET_ACCESS_KEY ||
      env.MINIO_ROOT_PASSWORD ||
      env.MINIO_SECRET_KEY ||
      (minioDefault ? "minioadmin" : "test"),
    ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
  };
}

export async function openS3ExplorerAsync(
  info: DockerDbInfo,
  signal?: AbortSignal,
): Promise<S3Explorer> {
  return createS3Adapter(await s3ConfigFromDockerInfoAsync(info, signal));
}

export function isS3HttpError(err: unknown): err is S3HttpError {
  return err instanceof S3HttpError;
}
