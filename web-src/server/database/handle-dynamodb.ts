import { hasControlCharacter } from "../../core/control-chars";
import type {
  DynamoDbAttributeValue,
  DynamoDbItemResponse,
  DynamoDbItemsResponse,
  DynamoDbKey,
  DynamoDbTableResponse,
  DynamoDbTablesResponse,
} from "../../core/database/types";
import { isAbortLikeError } from "./adapters/abort";
import {
  createDynamoDbAdapter,
  type DynamoDbExplorer,
  isDynamoDbHttpError,
  openDynamoDbExplorerAsync,
} from "./adapters/dynamodb";
import {
  createDockerAdapterCache,
  createQueryStrippedLogger,
  dispatchRoutes,
  handleError,
  json,
  resolveDatastoreExplorerAsync,
  textError,
} from "./handle-shared";

const dynamoDbAdapterCache = createDockerAdapterCache<DynamoDbExplorer>();
const DEFAULT_ITEMS_LIMIT = 100;
const MAX_ITEMS_LIMIT = 1000;
const MAX_TABLES_LIMIT = 100;
const MAX_TABLE_NAME_LEN = 255;
const MAX_EXPRESSION_LEN = 4096;
const MAX_JSON_PARAM_LEN = 64 * 1024;

export function closeDynamoDbAdapter(dbId: string): void {
  dynamoDbAdapterCache.close(dbId);
}

function resolveDynamoDb(
  cwd: string,
  dbParam: string | null,
  signal?: AbortSignal,
  omitDirNames?: string[],
): Promise<{ dbId: string; explorer: DynamoDbExplorer } | Response> {
  return resolveDatastoreExplorerAsync<DynamoDbExplorer>(
    cwd,
    dbParam,
    "dynamodb",
    dynamoDbAdapterCache,
    (info) => openDynamoDbExplorerAsync(info),
    (connection) => {
      if (connection.kind !== "dynamodb") {
        throw new Error("invalid DynamoDB connection");
      }
      return createDynamoDbAdapter(connection);
    },
    omitDirNames,
    signal,
  );
}

function dynamoDbErrorResponse(
  err: unknown,
  action: string,
  signal?: AbortSignal,
): Response {
  if (isAbortLikeError(err, signal)) {
    return handleError("dynamodb", action, err, signal);
  }
  if (isDynamoDbHttpError(err)) return textError(err.message, err.status);
  return handleError("dynamodb", action, err, signal);
}

function validateTableName(value: string | null): string | Response {
  if (!value) return textError("missing table parameter", 400);
  if (
    value.length < 3 ||
    value.length > MAX_TABLE_NAME_LEN ||
    hasControlCharacter(value) ||
    !/^[A-Za-z0-9_.-]+$/.test(value)
  ) {
    return textError("invalid table parameter", 400);
  }
  return value;
}

function validateOptionalText(
  value: string | null,
  name: string,
  maxLen = MAX_EXPRESSION_LEN,
): string | Response | undefined {
  if (value === null || value === "") return undefined;
  if (value.length > maxLen || hasControlCharacter(value)) {
    return textError(`invalid ${name} parameter`, 400);
  }
  return value;
}

function parseLimit(url: URL, param: string, defaultValue: number): number {
  const raw = Number(url.searchParams.get(param) || defaultValue);
  return Math.min(
    param === "limit" ? MAX_ITEMS_LIMIT : MAX_TABLES_LIMIT,
    Math.max(1, Number.isFinite(raw) ? raw : defaultValue),
  );
}

function parseJsonParam<T>(
  value: string | null,
  name: string,
): T | Response | undefined {
  if (value === null || value === "") return undefined;
  if (value.length > MAX_JSON_PARAM_LEN || hasControlCharacter(value)) {
    return textError(`invalid ${name} parameter`, 400);
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return textError(`invalid ${name} parameter`, 400);
  }
}

function parseKey(value: string | null, name: string): DynamoDbKey | Response {
  const parsed = parseJsonParam<DynamoDbKey>(value, name);
  if (parsed instanceof Response) return parsed;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return textError(`missing ${name} parameter`, 400);
  }
  return parsed;
}

function parseExpressionAttributeNames(
  url: URL,
): Record<string, string> | Response | undefined {
  const parsed = parseJsonParam<Record<string, string>>(
    url.searchParams.get("expressionAttributeNames"),
    "expressionAttributeNames",
  );
  if (parsed instanceof Response || parsed === undefined) return parsed;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((value) => typeof value !== "string")
  ) {
    return textError("invalid expressionAttributeNames parameter", 400);
  }
  return parsed;
}

function parseExpressionAttributeValues(
  url: URL,
): Record<string, DynamoDbAttributeValue> | Response | undefined {
  const parsed = parseJsonParam<Record<string, DynamoDbAttributeValue>>(
    url.searchParams.get("expressionAttributeValues"),
    "expressionAttributeValues",
  );
  if (parsed instanceof Response || parsed === undefined) return parsed;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return textError("invalid expressionAttributeValues parameter", 400);
  }
  return parsed;
}

async function handleTables(
  req: Request,
  cwd: string,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveDynamoDb(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  const exclusiveStartTableName = validateOptionalText(
    url.searchParams.get("exclusiveStartTableName"),
    "exclusiveStartTableName",
    MAX_TABLE_NAME_LEN,
  );
  if (exclusiveStartTableName instanceof Response)
    return exclusiveStartTableName;
  try {
    const result = await r.explorer.listTablesAsync({
      limit: parseLimit(url, "tablesLimit", MAX_TABLES_LIMIT),
      ...(exclusiveStartTableName ? { exclusiveStartTableName } : {}),
      signal: req.signal,
    });
    const body: DynamoDbTablesResponse = { dbId: r.dbId, ...result };
    return json(body);
  } catch (err) {
    return dynamoDbErrorResponse(err, "list dynamodb tables", req.signal);
  }
}

async function handleTable(
  req: Request,
  cwd: string,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveDynamoDb(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  const tableName = validateTableName(url.searchParams.get("table"));
  if (tableName instanceof Response) return tableName;
  try {
    const table = await r.explorer.describeTableAsync(tableName, req.signal);
    const body: DynamoDbTableResponse = { dbId: r.dbId, table };
    return json(body);
  } catch (err) {
    return dynamoDbErrorResponse(err, "describe dynamodb table", req.signal);
  }
}

async function handleItems(
  req: Request,
  cwd: string,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveDynamoDb(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  const tableName = validateTableName(url.searchParams.get("table"));
  if (tableName instanceof Response) return tableName;
  const mode = url.searchParams.get("mode") || "scan";
  if (mode !== "scan" && mode !== "query") {
    return textError("invalid mode parameter", 400);
  }
  const exclusiveStartKey = parseJsonParam<DynamoDbKey>(
    url.searchParams.get("exclusiveStartKey"),
    "exclusiveStartKey",
  );
  if (exclusiveStartKey instanceof Response) return exclusiveStartKey;
  const expressionAttributeNames = parseExpressionAttributeNames(url);
  if (expressionAttributeNames instanceof Response)
    return expressionAttributeNames;
  const expressionAttributeValues = parseExpressionAttributeValues(url);
  if (expressionAttributeValues instanceof Response)
    return expressionAttributeValues;
  const indexName = validateOptionalText(
    url.searchParams.get("index"),
    "index",
  );
  if (indexName instanceof Response) return indexName;
  const projectionExpression = validateOptionalText(
    url.searchParams.get("projectionExpression"),
    "projectionExpression",
  );
  if (projectionExpression instanceof Response) return projectionExpression;
  const filterExpression = validateOptionalText(
    url.searchParams.get("filterExpression"),
    "filterExpression",
  );
  if (filterExpression instanceof Response) return filterExpression;
  const keyConditionExpression = validateOptionalText(
    url.searchParams.get("keyConditionExpression"),
    "keyConditionExpression",
  );
  if (keyConditionExpression instanceof Response) return keyConditionExpression;
  if (mode === "query" && !keyConditionExpression) {
    return textError("missing keyConditionExpression parameter", 400);
  }
  try {
    const common = {
      tableName,
      limit: parseLimit(url, "limit", DEFAULT_ITEMS_LIMIT),
      ...(exclusiveStartKey ? { exclusiveStartKey } : {}),
      ...(indexName ? { indexName } : {}),
      ...(projectionExpression ? { projectionExpression } : {}),
      ...(filterExpression ? { filterExpression } : {}),
      ...(expressionAttributeNames ? { expressionAttributeNames } : {}),
      ...(expressionAttributeValues ? { expressionAttributeValues } : {}),
      signal: req.signal,
    };
    const result =
      mode === "query"
        ? await r.explorer.queryAsync({
            ...common,
            keyConditionExpression,
            scanIndexForward:
              url.searchParams.get("scanIndexForward") !== "false",
          })
        : await r.explorer.scanAsync(common);
    const body: DynamoDbItemsResponse = {
      dbId: r.dbId,
      tableName,
      mode,
      ...result,
    };
    return json(body);
  } catch (err) {
    return dynamoDbErrorResponse(err, "read dynamodb items", req.signal);
  }
}

async function handleItem(
  req: Request,
  cwd: string,
  url: URL,
  omitDirNames?: string[],
): Promise<Response> {
  const r = await resolveDynamoDb(
    cwd,
    url.searchParams.get("db"),
    req.signal,
    omitDirNames,
  );
  if (r instanceof Response) return r;
  const tableName = validateTableName(url.searchParams.get("table"));
  if (tableName instanceof Response) return tableName;
  const key = parseKey(url.searchParams.get("key"), "key");
  if (key instanceof Response) return key;
  const expressionAttributeNames = parseExpressionAttributeNames(url);
  if (expressionAttributeNames instanceof Response)
    return expressionAttributeNames;
  const projectionExpression = validateOptionalText(
    url.searchParams.get("projectionExpression"),
    "projectionExpression",
  );
  if (projectionExpression instanceof Response) return projectionExpression;
  try {
    const result = await r.explorer.getItemAsync({
      tableName,
      key,
      ...(projectionExpression ? { projectionExpression } : {}),
      ...(expressionAttributeNames ? { expressionAttributeNames } : {}),
      consistentRead: url.searchParams.get("consistentRead") === "true",
      signal: req.signal,
    });
    const body: DynamoDbItemResponse = {
      dbId: r.dbId,
      tableName,
      key,
      ...result,
    };
    return json(body);
  } catch (err) {
    return dynamoDbErrorResponse(err, "read dynamodb item", req.signal);
  }
}

export async function handleDynamoDbRoute(
  req: Request,
  url: URL,
  cwd: string,
  sideEffectAllowed?: (req: Request) => boolean,
  omitDirNames?: string[],
): Promise<Response | null> {
  const wrap = createQueryStrippedLogger("dynamodb", req, url);
  return dispatchRoutes(
    req,
    url,
    {
      "/_db/dynamodb/tables": {
        methods: ["GET"],
        handler: () => handleTables(req, cwd, url, omitDirNames),
      },
      "/_db/dynamodb/table": {
        methods: ["GET"],
        handler: () => handleTable(req, cwd, url, omitDirNames),
      },
      "/_db/dynamodb/items": {
        methods: ["GET"],
        handler: () => handleItems(req, cwd, url, omitDirNames),
      },
      "/_db/dynamodb/item": {
        methods: ["GET"],
        handler: () => handleItem(req, cwd, url, omitDirNames),
      },
    },
    sideEffectAllowed,
    wrap,
    (err) =>
      handleError("dynamodb", "handle dynamodb request", err, req.signal),
  );
}
