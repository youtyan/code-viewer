import { randomUUID } from "node:crypto";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import type { DbFileInfo, DbKind } from "../../core/database/types";
import { createJsonFileStore } from "../json-store";

const CONNECTIONS_FILE_NAME = "datastore-connections.json";
const MAX_CONNECTIONS = 64;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_NAME_LENGTH = 120;
const MAX_HOST_LENGTH = 253;
const MAX_VALUE_LENGTH = 4096;

type ConnectionBase = {
  id: string;
  name: string;
  kind: Exclude<DbKind, "sqlite">;
};

export type SqlConnection = ConnectionBase & {
  kind: "postgresql" | "mysql";
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  schema?: string;
  tls: boolean;
};

export type RedisConnection = ConnectionBase & {
  kind: "redis";
  host: string;
  port: number;
  username?: string;
  password: string;
  tls: boolean;
};

export type HttpConnection = ConnectionBase & {
  kind: "elasticsearch";
  endpoint: string;
  username?: string;
  password: string;
};

export type AwsConnection = ConnectionBase & {
  kind: "s3" | "dynamodb";
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type DatastoreConnection =
  | SqlConnection
  | RedisConnection
  | HttpConnection
  | AwsConnection;

type ConnectionsState = {
  version: 1;
  connections: DatastoreConnection[];
};

type ConnectionSecrets = {
  user?: string;
  username?: string;
  accessKeyId?: string;
  password?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

const runtimeSecrets = new Map<string, ConnectionSecrets>();

function secretKey(cwd: string, id: string): string {
  return `${cwd}\0${id}`;
}

function extractSecrets(value: Record<string, unknown>): ConnectionSecrets {
  return {
    ...(typeof value.user === "string" ? { user: value.user } : {}),
    ...(typeof value.username === "string" ? { username: value.username } : {}),
    ...(typeof value.accessKeyId === "string"
      ? { accessKeyId: value.accessKeyId }
      : {}),
    ...(typeof value.password === "string" ? { password: value.password } : {}),
    ...(typeof value.secretAccessKey === "string"
      ? { secretAccessKey: value.secretAccessKey }
      : {}),
    ...(typeof value.sessionToken === "string"
      ? { sessionToken: value.sessionToken }
      : {}),
  };
}

function withRuntimeSecrets(
  cwd: string,
  connection: DatastoreConnection,
): DatastoreConnection {
  return {
    ...connection,
    ...(runtimeSecrets.get(secretKey(cwd, connection.id)) ?? {}),
  } as DatastoreConnection;
}

function connectionsFilePath(root: string): string {
  return join(root, ".code-viewer", CONNECTIONS_FILE_NAME);
}

function emptyState(): ConnectionsState {
  return { version: 1, connections: [] };
}

function requiredString(value: unknown, maxLength = MAX_VALUE_LENGTH): string {
  return typeof value === "string" && value.length <= maxLength ? value : "";
}

function optionalString(
  value: unknown,
  maxLength = MAX_VALUE_LENGTH,
): string | undefined {
  const normalized = requiredString(value, maxLength);
  return normalized || undefined;
}

function validPort(value: unknown): number | null {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function validEndpoint(value: unknown): string | null {
  const raw = requiredString(value, MAX_VALUE_LENGTH);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function sanitizeConnection(raw: unknown): DatastoreConnection | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const id = requiredString(input.id, 80);
  const name = requiredString(input.name, MAX_NAME_LENGTH).trim();
  if (!/^connection:[a-f0-9-]{16,64}$/.test(id) || !name) return null;
  const base = { id, name };
  if (input.kind === "postgresql" || input.kind === "mysql") {
    const host = requiredString(input.host, MAX_HOST_LENGTH).trim();
    const port = validPort(input.port);
    const user = requiredString(input.user).trim();
    const database = requiredString(input.database).trim();
    if (!host || !port || !database) return null;
    return {
      ...base,
      kind: input.kind,
      host,
      port,
      user,
      password: requiredString(input.password),
      database,
      ...(optionalString(input.schema)?.trim()
        ? { schema: optionalString(input.schema)?.trim() }
        : {}),
      tls: input.tls === true,
    };
  }
  if (input.kind === "redis") {
    const host = requiredString(input.host, MAX_HOST_LENGTH).trim();
    const port = validPort(input.port);
    if (!host || !port) return null;
    return {
      ...base,
      kind: "redis",
      host,
      port,
      ...(optionalString(input.username)?.trim()
        ? { username: optionalString(input.username)?.trim() }
        : {}),
      password: requiredString(input.password),
      tls: input.tls === true,
    };
  }
  if (input.kind === "elasticsearch") {
    const endpoint = validEndpoint(input.endpoint);
    if (!endpoint) return null;
    return {
      ...base,
      kind: "elasticsearch",
      endpoint,
      ...(optionalString(input.username)?.trim()
        ? { username: optionalString(input.username)?.trim() }
        : {}),
      password: requiredString(input.password),
    };
  }
  if (input.kind === "s3" || input.kind === "dynamodb") {
    const endpoint = validEndpoint(input.endpoint);
    const region = requiredString(input.region).trim();
    const accessKeyId = requiredString(input.accessKeyId).trim();
    if (!endpoint || !region) return null;
    return {
      ...base,
      kind: input.kind,
      endpoint,
      region,
      accessKeyId,
      secretAccessKey: requiredString(input.secretAccessKey),
      ...(optionalString(input.sessionToken)
        ? { sessionToken: optionalString(input.sessionToken) }
        : {}),
    };
  }
  return null;
}

export function validateDatastoreConnection(
  raw: unknown,
  fallbackId = "connection:0000000000000000",
): DatastoreConnection {
  const input =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const connection = sanitizeConnection({
    ...input,
    id: typeof input.id === "string" && input.id ? input.id : fallbackId,
  });
  if (
    !connection ||
    ((connection.kind === "postgresql" || connection.kind === "mysql") &&
      !connection.user) ||
    ((connection.kind === "s3" || connection.kind === "dynamodb") &&
      !connection.accessKeyId)
  ) {
    throw new Error("invalid datastore connection");
  }
  return connection;
}

function sanitizeState(raw: unknown): ConnectionsState {
  if (!raw || typeof raw !== "object") return emptyState();
  const input = raw as Record<string, unknown>;
  if (input.version !== 1 || !Array.isArray(input.connections)) {
    return emptyState();
  }
  const seen = new Set<string>();
  const connections: DatastoreConnection[] = [];
  for (const candidate of input.connections) {
    if (connections.length >= MAX_CONNECTIONS) break;
    const connection = sanitizeConnection(candidate);
    if (!connection || seen.has(connection.id)) continue;
    seen.add(connection.id);
    connections.push(connection);
  }
  return { version: 1, connections };
}

const store = createJsonFileStore<ConnectionsState>({
  filePath: connectionsFilePath,
  empty: emptyState,
  sanitize: sanitizeState,
  maxBytes: MAX_JSON_BYTES,
  backupSuffix: "bak",
  sizeErrorMessage: "datastore connections state too large",
  serialize: (state) =>
    `${JSON.stringify(
      {
        version: 1,
        connections: state.connections.map(publicConnection),
      },
      null,
      2,
    )}\n`,
});

async function protectFile(cwd: string): Promise<void> {
  await chmod(connectionsFilePath(cwd), 0o600).catch(() => undefined);
}

export async function loadDatastoreConnections(
  cwd: string,
): Promise<DatastoreConnection[]> {
  return (await store.load(cwd)).connections.map((connection) =>
    withRuntimeSecrets(cwd, connection),
  );
}

export async function findDatastoreConnection(
  cwd: string,
  id: string,
): Promise<DatastoreConnection | null> {
  return (
    (await loadDatastoreConnections(cwd)).find((entry) => entry.id === id) ??
    null
  );
}

export async function saveDatastoreConnection(
  cwd: string,
  raw: unknown,
): Promise<DatastoreConnection> {
  const input =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const requestedId = typeof input.id === "string" ? input.id : "";
  const id = requestedId || `connection:${randomUUID()}`;
  const result = await store.update(cwd, (state) => {
    const storedExisting = state.connections.find((entry) => entry.id === id);
    const existing = storedExisting
      ? withRuntimeSecrets(cwd, storedExisting)
      : undefined;
    const merged = sanitizeConnection({
      ...(existing ?? {}),
      ...input,
      id,
      password:
        input.password === undefined && existing && "password" in existing
          ? existing.password
          : input.password,
      secretAccessKey:
        input.secretAccessKey === undefined &&
        existing &&
        "secretAccessKey" in existing
          ? existing.secretAccessKey
          : input.secretAccessKey,
      sessionToken:
        input.sessionToken === undefined &&
        existing &&
        "sessionToken" in existing
          ? existing.sessionToken
          : input.sessionToken,
    });
    if (
      !merged ||
      ((merged.kind === "postgresql" || merged.kind === "mysql") &&
        !merged.user) ||
      ((merged.kind === "s3" || merged.kind === "dynamodb") &&
        !merged.accessKeyId)
    ) {
      throw new Error("invalid datastore connection");
    }
    const connections = state.connections.filter((entry) => entry.id !== id);
    if (!storedExisting && connections.length >= MAX_CONNECTIONS) {
      throw new Error("too many datastore connections");
    }
    connections.push(merged);
    return {
      state: { version: 1 as const, connections },
      result: merged,
    };
  });
  runtimeSecrets.set(
    secretKey(cwd, result.id),
    extractSecrets(result as unknown as Record<string, unknown>),
  );
  await protectFile(cwd);
  return result;
}

export async function deleteDatastoreConnection(
  cwd: string,
  id: string,
): Promise<boolean> {
  const deleted = await store.update(cwd, (state) => {
    const connections = state.connections.filter((entry) => entry.id !== id);
    return {
      state: { version: 1 as const, connections },
      result: connections.length !== state.connections.length,
    };
  });
  runtimeSecrets.delete(secretKey(cwd, id));
  await protectFile(cwd);
  return deleted;
}

export function connectionToFileInfo(
  connection: DatastoreConnection,
): DbFileInfo {
  return {
    id: connection.id,
    path: "saved connection",
    name: connection.name,
    sizeBytes: 0,
    kind: connection.kind,
    savedConnection: true,
  };
}

export function publicConnection(
  connection: DatastoreConnection,
): Record<string, unknown> {
  const {
    password: _password,
    user: _user,
    username: _username,
    accessKeyId: _accessKeyId,
    ...withoutPassword
  } = connection as DatastoreConnection & {
    password?: string;
    user?: string;
    username?: string;
    accessKeyId?: string;
  };
  const {
    secretAccessKey: _secret,
    sessionToken: _token,
    ...safe
  } = withoutPassword as typeof withoutPassword & {
    secretAccessKey?: string;
    sessionToken?: string;
  };
  return safe;
}
