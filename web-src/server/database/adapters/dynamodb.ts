import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import type {
  DynamoDbAttributeValue,
  DynamoDbItem,
  DynamoDbKey,
} from "../../../core/database/types";
import type { DockerDbInfo } from "../discovery";
import {
  dockerCommand,
  resolveRunningComposeContainerNameOrThrowAsync,
  throwIfDockerCommandUnavailableResult,
} from "./docker-utils";
import { spawnCollectAsync } from "./spawn-runner";

export type DynamoDbConfig = {
  endpoint: string;
  dockerContainerName?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type { DynamoDbAttributeValue, DynamoDbItem, DynamoDbKey };

export type DynamoDbTableDescription = {
  TableName?: string;
  TableStatus?: string;
  CreationDateTime?: number;
  ItemCount?: number;
  TableSizeBytes?: number;
  KeySchema?: Array<{ AttributeName: string; KeyType: string }>;
  AttributeDefinitions?: Array<{
    AttributeName: string;
    AttributeType: string;
  }>;
  BillingModeSummary?: { BillingMode?: string };
  GlobalSecondaryIndexes?: unknown[];
  LocalSecondaryIndexes?: unknown[];
  [key: string]: unknown;
};

export type DynamoDbListTablesResult = {
  tableNames: string[];
  lastEvaluatedTableName?: string;
};

export type DynamoDbScanResult = {
  items: DynamoDbItem[];
  count: number;
  scannedCount: number;
  lastEvaluatedKey?: DynamoDbKey;
};

export type DynamoDbQueryResult = DynamoDbScanResult;

export type DynamoDbGetItemResult = {
  item?: DynamoDbItem;
  consumedCapacity?: unknown;
};

type DynamoDbListTablesOptions = {
  limit?: number;
  exclusiveStartTableName?: string;
  signal?: AbortSignal;
};

type DynamoDbScanOptions = {
  tableName: string;
  limit?: number;
  exclusiveStartKey?: DynamoDbKey;
  indexName?: string;
  projectionExpression?: string;
  filterExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: Record<string, DynamoDbAttributeValue>;
  signal?: AbortSignal;
};

type DynamoDbQueryOptions = {
  tableName: string;
  keyConditionExpression: string;
  limit?: number;
  exclusiveStartKey?: DynamoDbKey;
  indexName?: string;
  projectionExpression?: string;
  filterExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: Record<string, DynamoDbAttributeValue>;
  scanIndexForward?: boolean;
  signal?: AbortSignal;
};

type DynamoDbGetItemOptions = {
  tableName: string;
  key: DynamoDbKey;
  projectionExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  consistentRead?: boolean;
  signal?: AbortSignal;
};

export type DynamoDbExplorer = {
  readonly kind: "dynamodb";
  readonly model: "document";
  close(): void;
  listTablesAsync(
    opts?: DynamoDbListTablesOptions,
  ): Promise<DynamoDbListTablesResult>;
  describeTableAsync(
    tableName: string,
    signal?: AbortSignal,
  ): Promise<DynamoDbTableDescription>;
  scanAsync(opts: DynamoDbScanOptions): Promise<DynamoDbScanResult>;
  queryAsync(opts: DynamoDbQueryOptions): Promise<DynamoDbQueryResult>;
  getItemAsync(opts: DynamoDbGetItemOptions): Promise<DynamoDbGetItemResult>;
};

type DynamoDbAction =
  | "ListTables"
  | "DescribeTable"
  | "Scan"
  | "Query"
  | "GetItem";

type DynamoDbRequestDeadline = {
  expiresAt: number;
  timeoutMs: number;
};

let spawnSyncImpl = spawnSync;
let spawnSyncImplIsTestOverride = false;

export function __setDynamoDbSpawnSyncForTest(
  spawnSyncForTest: typeof spawnSync | null,
): void {
  spawnSyncImpl = spawnSyncForTest ?? spawnSync;
  spawnSyncImplIsTestOverride = !!spawnSyncForTest;
}

class DynamoDbHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const DEFAULT_DYNAMODB_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_DYNAMODB_DOCKER_CURL_TIMEOUT_MS = 30000;
const DYNAMODB_JSON_CONTENT_TYPE = "application/x-amz-json-1.0";
const DOCKER_CURL_BODY_MARKER = "__CODE_VIEWER_DYNAMODB_BODY__";

let dynamoDbRequestTimeoutMs = DEFAULT_DYNAMODB_REQUEST_TIMEOUT_MS;
let dynamoDbDockerCurlTimeoutMs = DEFAULT_DYNAMODB_DOCKER_CURL_TIMEOUT_MS;

export function __setDynamoDbRequestTimeoutMsForTest(
  timeoutMs: number | null,
): void {
  dynamoDbRequestTimeoutMs = timeoutMs ?? DEFAULT_DYNAMODB_REQUEST_TIMEOUT_MS;
}

export function __setDynamoDbDockerCurlTimeoutMsForTest(
  timeoutMs: number | null,
): void {
  dynamoDbDockerCurlTimeoutMs =
    timeoutMs ?? DEFAULT_DYNAMODB_DOCKER_CURL_TIMEOUT_MS;
}

function createDynamoDbRequestDeadline(): DynamoDbRequestDeadline {
  const timeoutMs = dynamoDbRequestTimeoutMs;
  return { expiresAt: Date.now() + timeoutMs, timeoutMs };
}

function createDynamoDbDockerCurlDeadline(): DynamoDbRequestDeadline {
  const timeoutMs = dynamoDbDockerCurlTimeoutMs;
  return { expiresAt: Date.now() + timeoutMs, timeoutMs };
}

function createDynamoDbTransportDeadline(
  config: DynamoDbConfig,
): DynamoDbRequestDeadline {
  return config.dockerContainerName
    ? createDynamoDbDockerCurlDeadline()
    : createDynamoDbRequestDeadline();
}

function dynamoDbTimeoutError(
  deadline?: DynamoDbRequestDeadline,
): DynamoDbHttpError {
  return new DynamoDbHttpError(
    503,
    `DynamoDB request timed out after ${deadline?.timeoutMs ?? dynamoDbRequestTimeoutMs}ms`,
  );
}

function remainingDynamoDbTimeoutMs(
  deadline?: DynamoDbRequestDeadline,
): number {
  if (!deadline) return dynamoDbRequestTimeoutMs;
  return Math.max(0, deadline.expiresAt - Date.now());
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function amzDate(date = new Date()): { dateStamp: string; amzDate: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { dateStamp: iso.slice(0, 8), amzDate: iso };
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "dynamodb");
  return hmac(kService, "aws4_request");
}

function compareCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
  if (idx < 0) return { headerText: "", body: bytes };
  return {
    headerText: buffer.subarray(0, idx).toString("utf8"),
    body: new Uint8Array(buffer.subarray(idx + sepLen)),
  };
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
  url: string;
  headers: Headers;
  body: string;
}): { args: string[]; input: Buffer } {
  const shellScript = [
    "set -eu",
    'headers_file="$(mktemp)"',
    'body_file="$(mktemp)"',
    'trap \'rm -f "$headers_file" "$body_file"\' EXIT',
    `while IFS= read -r line; do [ "$line" = "${DOCKER_CURL_BODY_MARKER}" ] && break; printf '%s\\n' "$line" >> "$headers_file"; done`,
    'cat > "$body_file"',
    `curl -sS -X POST -D - -o - -K "$headers_file" --data-binary "@$body_file" ${curlConfigQuote(opts.url)}`,
  ].join("\n");
  return {
    args: ["exec", "-i", opts.containerName, "sh", "-c", shellScript],
    input: Buffer.from(
      `${curlHeaderConfig(opts.headers)}${DOCKER_CURL_BODY_MARKER}\n${opts.body}`,
      "utf8",
    ),
  };
}

function guardedDynamoDbTransport<T>(
  signal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
  deadline?: DynamoDbRequestDeadline,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(
      new DynamoDbHttpError(503, "DynamoDB HTTP transport aborted"),
    );
  }
  const timeoutMs = remainingDynamoDbTimeoutMs(deadline);
  if (timeoutMs <= 0) return Promise.reject(dynamoDbTimeoutError(deadline));

  const controller = new AbortController();
  let timedOut = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleanupParent = () => undefined;

  const abort = (
    err: DynamoDbHttpError,
    reject: (err: DynamoDbHttpError) => void,
  ) => {
    if (settled) return;
    settled = true;
    controller.abort(err);
    reject(err);
  };

  const guarded = new Promise<T>((resolve, reject) => {
    const onParentAbort = () =>
      abort(
        new DynamoDbHttpError(503, "DynamoDB HTTP transport aborted"),
        reject,
      );
    if (signal) {
      signal.addEventListener("abort", onParentAbort, { once: true });
      cleanupParent = () => signal.removeEventListener("abort", onParentAbort);
    }
    timer = setTimeout(() => {
      timedOut = true;
      abort(dynamoDbTimeoutError(deadline), reject);
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
          reject(dynamoDbTimeoutError(deadline));
        } else if (signal?.aborted) {
          reject(new DynamoDbHttpError(503, "DynamoDB HTTP transport aborted"));
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
  deadline?: DynamoDbRequestDeadline,
): ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]> {
  return guardedDynamoDbTransport(
    signal,
    (transportSignal) => {
      const cancelRead = () => {
        void reader.cancel(transportSignal.reason).catch(() => undefined);
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
  deadline?: DynamoDbRequestDeadline,
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
      /* reader may already be cancelled */
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
  deadline?: DynamoDbRequestDeadline,
): Promise<string> {
  return new TextDecoder("utf-8", { fatal: false }).decode(
    await readResponseBytesWithTimeout(res, signal, deadline),
  );
}

async function dockerCurlFetch(opts: {
  containerName: string;
  url: string;
  headers: Headers;
  body: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const { args, input } = dockerCurlCommand(opts);
  if (spawnSyncImplIsTestOverride) {
    const proc = spawnSyncImpl(dockerCommand(), args, {
      encoding: "buffer",
      input,
      timeout: dynamoDbDockerCurlTimeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if ((proc.status ?? 1) !== 0) {
      const stderr = new TextDecoder()
        .decode(proc.stderr || new Uint8Array())
        .concat(proc.error ? `\n${proc.error.message}` : "")
        .replace(/\s+/g, " ")
        .trim();
      throwIfDockerCommandUnavailableResult({
        code: proc.status ?? 1,
        stderr,
      });
      throw new DynamoDbHttpError(
        503,
        `DynamoDB HTTP transport failed via docker exec${stderr ? `: ${stderr.slice(0, 240)}` : ""}`,
      );
    }
    return responseFromCurlOutput(
      new Uint8Array(proc.stdout || new Uint8Array()),
    );
  }
  if (opts.signal?.aborted) {
    throw new DynamoDbHttpError(503, "DynamoDB HTTP transport aborted");
  }
  const proc = await spawnCollectAsync({
    command: dockerCommand(),
    args,
    input,
    timeoutMs: dynamoDbDockerCurlTimeoutMs,
    signal: opts.signal,
    abortMessage: "DynamoDB HTTP transport aborted",
    timeoutMessage: `docker exec curl timed out after ${dynamoDbDockerCurlTimeoutMs}ms`,
    rejectOnError: false,
  });
  if (proc.code !== 0) {
    const stderr = new TextDecoder()
      .decode(proc.stderr)
      .replace(/\s+/g, " ")
      .trim();
    throwIfDockerCommandUnavailableResult({ code: proc.code, stderr });
    throw new DynamoDbHttpError(
      503,
      `DynamoDB HTTP transport failed via docker exec${stderr ? `: ${stderr.slice(0, 240)}` : ""}`,
    );
  }
  return responseFromCurlOutput(new Uint8Array(proc.stdout));
}

function sanitizeDynamoDbError(
  status: number,
  text: string,
): DynamoDbHttpError {
  let message = "";
  try {
    const parsed = JSON.parse(text) as {
      __type?: unknown;
      message?: unknown;
      Message?: unknown;
    };
    const type =
      typeof parsed.__type === "string"
        ? parsed.__type.split("#").pop() || parsed.__type
        : "";
    const bodyMessage =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.Message === "string"
          ? parsed.Message
          : "";
    message = [type, bodyMessage].filter(Boolean).join(": ");
  } catch {
    message = text.replace(/\s+/g, " ").trim().slice(0, 240);
  }
  return new DynamoDbHttpError(
    status,
    `DynamoDB HTTP ${status}: ${message || "request failed"}`,
  );
}

function assertTableName(tableName: string): void {
  if (!/^[A-Za-z0-9_.-]{3,255}$/.test(tableName)) {
    throw new Error("invalid DynamoDB table name");
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asDynamoDbItemsResult(
  raw: Record<string, unknown>,
): DynamoDbScanResult {
  return {
    items: Array.isArray(raw.Items) ? (raw.Items as DynamoDbItem[]) : [],
    count: asNumber(raw.Count),
    scannedCount: asNumber(raw.ScannedCount),
    ...(raw.LastEvaluatedKey
      ? { lastEvaluatedKey: asObject(raw.LastEvaluatedKey) as DynamoDbKey }
      : {}),
  };
}

function dynamoDbItemsRequestFields(
  opts: DynamoDbScanOptions | DynamoDbQueryOptions,
) {
  return {
    ...(opts.limit ? { Limit: Math.min(1000, Math.max(1, opts.limit)) } : {}),
    ...(opts.exclusiveStartKey
      ? { ExclusiveStartKey: opts.exclusiveStartKey }
      : {}),
    ...(opts.indexName ? { IndexName: opts.indexName } : {}),
    ...(opts.projectionExpression
      ? { ProjectionExpression: opts.projectionExpression }
      : {}),
    ...(opts.filterExpression
      ? { FilterExpression: opts.filterExpression }
      : {}),
    ...(opts.expressionAttributeNames
      ? { ExpressionAttributeNames: opts.expressionAttributeNames }
      : {}),
    ...(opts.expressionAttributeValues
      ? { ExpressionAttributeValues: opts.expressionAttributeValues }
      : {}),
  };
}

export function createDynamoDbAdapter(
  config: DynamoDbConfig,
): DynamoDbExplorer {
  async function signedJsonRequest<T>(
    action: DynamoDbAction,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    deadline = createDynamoDbTransportDeadline(config),
  ): Promise<T> {
    const requestBody = JSON.stringify(body);
    const res = await guardedDynamoDbTransport(
      signal,
      (transportSignal) => {
        const endpoint = new URL(config.endpoint);
        const { dateStamp, amzDate: requestDate } = amzDate();
        const payloadHash = requestBody ? sha256(requestBody) : EMPTY_SHA256;
        const headers: Record<string, string> = {
          "content-type": DYNAMODB_JSON_CONTENT_TYPE,
          host: endpoint.host,
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": requestDate,
          "x-amz-target": `DynamoDB_20120810.${action}`,
          ...(config.sessionToken
            ? { "x-amz-security-token": config.sessionToken }
            : {}),
        };
        const signedNames = signedHeadersString(headers);
        const canonicalRequest = [
          "POST",
          "/",
          "",
          canonicalHeaders(headers),
          signedNames,
          payloadHash,
        ].join("\n");
        const scope = `${dateStamp}/${config.region}/dynamodb/aws4_request`;
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
        const url = `${config.endpoint.replace(/\/$/, "")}/`;
        if (config.dockerContainerName) {
          return dockerCurlFetch({
            containerName: config.dockerContainerName,
            url,
            headers: requestHeaders,
            body: requestBody,
            signal: transportSignal,
          });
        }
        return fetch(url, {
          method: "POST",
          headers: requestHeaders,
          body: requestBody,
          signal: transportSignal,
        });
      },
      deadline,
    );
    const text = await readResponseTextWithTimeout(res, signal, deadline);
    if (!res.ok) throw sanitizeDynamoDbError(res.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async function listTablesAsync(
    opts?: DynamoDbListTablesOptions,
  ): Promise<DynamoDbListTablesResult> {
    const body = {
      ...(opts?.limit ? { Limit: Math.min(100, Math.max(1, opts.limit)) } : {}),
      ...(opts?.exclusiveStartTableName
        ? { ExclusiveStartTableName: opts.exclusiveStartTableName }
        : {}),
    };
    const raw = await signedJsonRequest<Record<string, unknown>>(
      "ListTables",
      body,
      opts?.signal,
    );
    return {
      tableNames: asStringArray(raw.TableNames),
      ...(typeof raw.LastEvaluatedTableName === "string"
        ? { lastEvaluatedTableName: raw.LastEvaluatedTableName }
        : {}),
    };
  }

  async function describeTableAsync(
    tableName: string,
    signal?: AbortSignal,
  ): Promise<DynamoDbTableDescription> {
    assertTableName(tableName);
    const raw = await signedJsonRequest<Record<string, unknown>>(
      "DescribeTable",
      { TableName: tableName },
      signal,
    );
    return asObject(raw.Table) as DynamoDbTableDescription;
  }

  async function scanAsync(
    opts: DynamoDbScanOptions,
  ): Promise<DynamoDbScanResult> {
    assertTableName(opts.tableName);
    const raw = await signedJsonRequest<Record<string, unknown>>(
      "Scan",
      {
        TableName: opts.tableName,
        ...dynamoDbItemsRequestFields(opts),
      },
      opts.signal,
    );
    return asDynamoDbItemsResult(raw);
  }

  async function queryAsync(
    opts: DynamoDbQueryOptions,
  ): Promise<DynamoDbQueryResult> {
    assertTableName(opts.tableName);
    const raw = await signedJsonRequest<Record<string, unknown>>(
      "Query",
      {
        TableName: opts.tableName,
        KeyConditionExpression: opts.keyConditionExpression,
        ...dynamoDbItemsRequestFields(opts),
        ...(opts.scanIndexForward !== undefined
          ? { ScanIndexForward: opts.scanIndexForward }
          : {}),
      },
      opts.signal,
    );
    return asDynamoDbItemsResult(raw);
  }

  async function getItemAsync(
    opts: DynamoDbGetItemOptions,
  ): Promise<DynamoDbGetItemResult> {
    assertTableName(opts.tableName);
    const raw = await signedJsonRequest<Record<string, unknown>>(
      "GetItem",
      {
        TableName: opts.tableName,
        Key: opts.key,
        ...(opts.projectionExpression
          ? { ProjectionExpression: opts.projectionExpression }
          : {}),
        ...(opts.expressionAttributeNames
          ? { ExpressionAttributeNames: opts.expressionAttributeNames }
          : {}),
        ...(opts.consistentRead !== undefined
          ? { ConsistentRead: opts.consistentRead }
          : {}),
      },
      opts.signal,
    );
    return {
      ...(raw.Item ? { item: asObject(raw.Item) as DynamoDbItem } : {}),
      ...(raw.ConsumedCapacity
        ? { consumedCapacity: raw.ConsumedCapacity }
        : {}),
    };
  }

  return {
    kind: "dynamodb",
    model: "document",
    close() {
      /* noop */
    },
    listTablesAsync,
    describeTableAsync,
    scanAsync,
    queryAsync,
    getItemAsync,
  };
}

async function dynamoDbConfigFromDockerInfoAsync(
  info: DockerDbInfo,
  signal?: AbortSignal,
): Promise<DynamoDbConfig> {
  const env = info.env;
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
    accessKeyId: env.AWS_ACCESS_KEY_ID || "test",
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY || "test",
    ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
  };
}

export async function openDynamoDbExplorerAsync(
  info: DockerDbInfo,
  signal?: AbortSignal,
): Promise<DynamoDbExplorer> {
  return createDynamoDbAdapter(
    await dynamoDbConfigFromDockerInfoAsync(info, signal),
  );
}

export function isDynamoDbHttpError(err: unknown): err is DynamoDbHttpError {
  return err instanceof DynamoDbHttpError;
}
