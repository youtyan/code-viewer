import { randomUUID } from "node:crypto";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import type { DbFileInfo, DbKind } from "../../core/database/types";
import { createJsonFileStore } from "../json-store";
import {
  deleteConnectionSecretsAsync,
  isKeychainAvailable,
  loadConnectionSecretsAsync,
  saveConnectionSecretsAsync,
} from "./credential-store";

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

export type D1Connection = ConnectionBase & {
  kind: "d1";
  accountId: string;
  databaseId: string;
  apiToken: string;
};

export type DatastoreConnection =
  | SqlConnection
  | RedisConnection
  | HttpConnection
  | AwsConnection
  | D1Connection;

type ConnectionsState = {
  version: 1;
  connections: DatastoreConnection[];
};

// .code-viewer/*.json には書かないフィールド。publicConnection がここに
// 挙げたものを落とすので、リポジトリ配下に資格情報が平文で残ることはない。
// 実体はプロセス内の runtimeSecrets が持ち、OS キーチェーンが使える環境では
// そこにも預けて再起動をまたいで復元する (credential-store.ts)。
const RUNTIME_ONLY_FIELDS = [
  "user",
  "username",
  "accessKeyId",
  "password",
  "secretAccessKey",
  "sessionToken",
  "apiToken",
] as const;

// 編集時にクライアントが値を送ってこなかった場合、既存の値を引き継ぐ
// フィールド (フォームでは伏せ字のまま触られないことがある)。
const PRESERVED_SECRET_FIELDS = [
  "password",
  "secretAccessKey",
  "sessionToken",
  "apiToken",
] as const;

type ConnectionSecrets = Partial<
  Record<(typeof RUNTIME_ONLY_FIELDS)[number], string>
>;

const runtimeSecrets = new Map<string, ConnectionSecrets>();
// キーチェーン読み出しの in-flight / 完了済み promise。項目が無かった場合も
// 残して、接続一覧を引くたびに `security` を起動し直さないようにする。
// 「引きに行った」を boolean で持つと、読み出し完了前に来た 2 人目が
// 「済み」と誤認して資格情報の無い接続を返してしまうので、promise を共有する。
const keychainLookups = new Map<string, Promise<void>>();

function secretKey(cwd: string, id: string): string {
  return `${cwd}\0${id}`;
}

// プロセス内に資格情報が無い接続だけ、キーチェーンから復元する。
// 一度引けば runtimeSecrets がキャッシュになるので、以降は起動しない。
async function hydrateFromKeychainAsync(
  cwd: string,
  connections: DatastoreConnection[],
): Promise<void> {
  if (!isKeychainAvailable()) return;
  await Promise.all(
    connections.map((connection) => {
      const key = secretKey(cwd, connection.id);
      if (runtimeSecrets.has(key)) return undefined;
      // 同じ接続に同時に来た呼び出しは 1 回の読み出しを共有して待つ。
      const inFlight = keychainLookups.get(key);
      if (inFlight) return inFlight;
      const lookup = loadConnectionSecretsAsync(cwd, connection.id)
        .then((stored) => {
          if (stored) runtimeSecrets.set(key, extractSecrets(stored));
        })
        // 読み出しは内部で握り潰される想定だが、万一 reject しても
        // map に失敗 promise が残り続けないようにする。
        .catch(() => {
          keychainLookups.delete(key);
        });
      keychainLookups.set(key, lookup);
      return lookup;
    }),
  );
}

function extractSecrets(value: Record<string, unknown>): ConnectionSecrets {
  const secrets: ConnectionSecrets = {};
  for (const field of RUNTIME_ONLY_FIELDS) {
    if (typeof value[field] === "string") secrets[field] = value[field];
  }
  return secrets;
}

function preservedSecrets(
  input: Record<string, unknown>,
  existing: DatastoreConnection | undefined,
): Record<string, unknown> {
  if (!existing) return {};
  const preserved: Record<string, unknown> = {};
  const source = existing as unknown as Record<string, unknown>;
  for (const field of PRESERVED_SECRET_FIELDS) {
    if (input[field] === undefined && field in source) {
      preserved[field] = source[field];
    }
  }
  return preserved;
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
  if (input.kind === "d1") {
    const accountId = requiredString(input.accountId, 128).trim();
    const databaseId = requiredString(input.databaseId, 128).trim();
    if (!accountId || !databaseId) return null;
    return {
      ...base,
      kind: "d1",
      accountId,
      databaseId,
      apiToken: requiredString(input.apiToken),
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

// 資格情報はディスクに残さないので、sanitizeConnection は「保存済み JSON を
// 読み直せること」を基準に必須判定する。実際に接続に使う前は、runtime にだけ
// ある資格情報が揃っているかをここで別途確かめる。
function assertConnectionCredentials(
  connection: DatastoreConnection | null,
): DatastoreConnection {
  const missing =
    !connection ||
    ((connection.kind === "postgresql" || connection.kind === "mysql") &&
      !connection.user) ||
    ((connection.kind === "s3" || connection.kind === "dynamodb") &&
      !connection.accessKeyId) ||
    (connection.kind === "d1" && !connection.apiToken);
  if (!connection || missing) {
    throw new Error("invalid datastore connection");
  }
  return connection;
}

export function validateDatastoreConnection(
  raw: unknown,
  fallbackId = "connection:0000000000000000",
): DatastoreConnection {
  const input =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return assertConnectionCredentials(
    sanitizeConnection({
      ...input,
      id: typeof input.id === "string" && input.id ? input.id : fallbackId,
    }),
  );
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
  const { connections } = await store.load(cwd);
  await hydrateFromKeychainAsync(cwd, connections);
  return connections.map((connection) => withRuntimeSecrets(cwd, connection));
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
    const merged = assertConnectionCredentials(
      sanitizeConnection({
        ...(existing ?? {}),
        ...input,
        id,
        ...preservedSecrets(input, existing),
      }),
    );
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
  const secrets = extractSecrets(result as unknown as Record<string, unknown>);
  runtimeSecrets.set(secretKey(cwd, result.id), secrets);
  keychainLookups.set(secretKey(cwd, result.id), Promise.resolve());
  // キーチェーンが使えない / 拒否された場合もプロセス内には残るので、
  // 保存自体は成功として扱う (再起動で消えるだけ)。
  await saveConnectionSecretsAsync(cwd, result.id, secrets);
  await protectFile(cwd);
  return result;
}

export type DeleteConnectionResult = {
  deleted: boolean;
  // キーチェーン項目まで消せたか。ロック中などで消せなかった場合、資格情報は
  // OS 側に残り続けるので、成功として黙らせずに呼び出し元へ伝える。
  secretsRemoved: boolean;
};

export async function deleteDatastoreConnection(
  cwd: string,
  id: string,
): Promise<DeleteConnectionResult> {
  const deleted = await store.update(cwd, (state) => {
    const connections = state.connections.filter((entry) => entry.id !== id);
    return {
      state: { version: 1 as const, connections },
      result: connections.length !== state.connections.length,
    };
  });
  runtimeSecrets.delete(secretKey(cwd, id));
  keychainLookups.delete(secretKey(cwd, id));
  const secretsRemoved = isKeychainAvailable()
    ? await deleteConnectionSecretsAsync(cwd, id)
    : true;
  await protectFile(cwd);
  return { deleted, secretsRemoved };
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
  const safe = { ...connection } as Record<string, unknown>;
  for (const field of RUNTIME_ONLY_FIELDS) delete safe[field];
  return safe;
}
