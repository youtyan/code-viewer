import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { lstat, open, readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { hasControlCharacter } from "../../core/control-chars";
import type { DbFileInfo, DbKind } from "../../core/database/types";

const SQLITE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3", ".s3db"]);
const SQLITE_MAGIC = "SQLite format 3\0";
const MAX_SCAN_DEPTH = 3;
const MAX_ENTRIES = 50;
const DOCKER_DISCOVERY_TTL_MS = 5_000;
const SQLITE_DISCOVERY_TTL_MS = 5_000;

function isSqliteFile(fullPath: string): boolean {
  try {
    const stat = statSync(fullPath);
    if (!stat.isFile() || stat.size < 16) return false;
    const buf = Buffer.alloc(16);
    const fd = openSync(fullPath, "r");
    try {
      readSync(fd, buf, 0, 16, 0);
    } finally {
      closeSync(fd);
    }
    return buf.toString("utf8", 0, 16) === SQLITE_MAGIC;
  } catch {
    return false;
  }
}

async function isSqliteFileAsync(fullPath: string): Promise<boolean> {
  try {
    const fileStat = await stat(fullPath);
    if (!fileStat.isFile() || fileStat.size < 16) return false;
    const file = await open(fullPath, "r");
    try {
      const buf = Buffer.alloc(16);
      await file.read(buf, 0, 16, 0);
      return buf.toString("utf8", 0, 16) === SQLITE_MAGIC;
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}

export type DiscoveredDb = {
  path: string;
  name: string;
  sizeBytes: number;
};

const sqliteDiscoveryCache = new Map<
  string,
  { expiresAt: number; result: DiscoveredDb[] }
>();

function discoveryCacheKey(cwd: string, omitDirNames: string[]): string {
  const omit = [...omitDirNames].map((d) => d.toLowerCase()).sort();
  return JSON.stringify([cwd, omit]);
}

function cloneDiscoveredDbs(result: DiscoveredDb[]): DiscoveredDb[] {
  return result.map((entry) => ({ ...entry }));
}

export async function discoverSqliteFilesAsync(
  cwd: string,
  omitDirNames: string[],
  signal?: AbortSignal,
): Promise<DiscoveredDb[]> {
  const cacheKey = discoveryCacheKey(cwd, omitDirNames);
  const now = Date.now();
  const cached = sqliteDiscoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cloneDiscoveredDbs(cached.result);
  }

  const omitSet = new Set(omitDirNames.map((d) => d.toLowerCase()));
  omitSet.add(".git");
  omitSet.add(".code-viewer");
  const results: DiscoveredDb[] = [];

  async function scan(dir: string, depth: number): Promise<void> {
    if (signal?.aborted) return;
    if (depth > MAX_SCAN_DEPTH || results.length >= MAX_ENTRIES) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (signal?.aborted) return;
      if (results.length >= MAX_ENTRIES) return;
      if (omitSet.has(entry.toLowerCase())) continue;
      const full = join(dir, entry);
      let entryStat: Awaited<ReturnType<typeof lstat>>;
      try {
        entryStat = await lstat(full);
      } catch {
        continue;
      }
      if (entryStat.isSymbolicLink()) continue;
      if (entryStat.isDirectory()) {
        await scan(full, depth + 1);
      } else if (entryStat.isFile()) {
        const ext = entry.slice(entry.lastIndexOf(".")).toLowerCase();
        if (!SQLITE_EXTENSIONS.has(ext)) continue;
        if (!(await isSqliteFileAsync(full))) continue;
        const rel = relative(cwd, full);
        if (rel.startsWith("..") || rel.startsWith("/")) continue;
        results.push({
          path: rel,
          name: basename(rel),
          sizeBytes: entryStat.size,
        });
      }
    }
  }

  await scan(cwd, 0);
  results.sort((a, b) => a.path.localeCompare(b.path));
  if (signal?.aborted) return cloneDiscoveredDbs(results);
  sqliteDiscoveryCache.set(cacheKey, {
    expiresAt: now + SQLITE_DISCOVERY_TTL_MS,
    result: cloneDiscoveredDbs(results),
  });
  return cloneDiscoveredDbs(results);
}

export function validateDbPath(cwd: string, dbPath: string): string | null {
  if (
    !dbPath ||
    dbPath.includes("\0") ||
    dbPath.startsWith("/") ||
    dbPath.startsWith("\\")
  )
    return null;
  const parts = dbPath.split(/[\\/]+/);
  if (
    parts.some(
      (p) =>
        p === ".." ||
        p.toLowerCase() === ".git" ||
        p.toLowerCase() === ".code-viewer",
    )
  )
    return null;
  const full = join(cwd, dbPath);
  if (!existsSync(full)) return null;
  let realCwd: string;
  let realFull: string;
  try {
    realCwd = realpathSync(cwd);
    realFull = realpathSync(full);
  } catch {
    return null;
  }
  const rel = relative(realCwd, realFull);
  if (rel === "" || rel.startsWith("..") || rel.startsWith("/")) return null;
  if (!isSqliteFile(realFull)) return null;
  return realFull;
}

const COMPOSE_FILENAMES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

function serviceListIncludesAwsService(
  value: string | undefined,
  service: string,
): boolean {
  if (value === undefined || value.trim() === "") return true;
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .includes(service);
}

// LocalStack の SERVICES 環境変数から、code-viewer が対応する AWS サービスの
// DbKind を全て検出する。1コンテナで複数サービス(s3, dynamodb 等)を同時に
// 提供するため、単一 kind ではなく配列で返す。
function detectAwsKindsFromServices(services: string | undefined): DbKind[] {
  const kinds: DbKind[] = [];
  if (serviceListIncludesAwsService(services, "s3")) kinds.push("s3");
  if (serviceListIncludesAwsService(services, "dynamodb"))
    kinds.push("dynamodb");
  return kinds;
}

function isLocalstackImage(image: string | null): boolean {
  return !!image && image.toLowerCase().includes("localstack/localstack");
}

function imageLooksLikeMinio(image: string): boolean {
  return /(^|\/)minio(?::|\/|$)/.test(image.toLowerCase());
}

function detectDbKind(
  image: string,
  _env: Record<string, string> = {},
): DbKind | null {
  const lower = image.toLowerCase();
  if (lower.includes("postgres")) return "postgresql";
  if (lower.includes("mysql") || lower.includes("mariadb")) return "mysql";
  if (lower.includes("redis")) return "redis";
  if (lower.includes("elasticsearch") || lower.includes("opensearch"))
    return "elasticsearch";
  if (imageLooksLikeMinio(lower)) return "s3";
  return null;
}

function detectDbKindFromEnv(env: Record<string, string>): DbKind | null {
  if (
    env.MYSQL_DATABASE ||
    env.MYSQL_ROOT_PASSWORD ||
    env.MYSQL_USER ||
    env.MARIADB_DATABASE ||
    env.MARIADB_USER ||
    env.MYSQL_ALLOW_EMPTY_PASSWORD
  ) {
    return "mysql";
  }
  if (env.POSTGRES_DB || env.POSTGRES_USER || env.POSTGRES_PASSWORD) {
    return "postgresql";
  }
  if (
    env.MINIO_ROOT_USER ||
    env.MINIO_ROOT_PASSWORD ||
    env.MINIO_ACCESS_KEY ||
    env.MINIO_SECRET_KEY
  ) {
    return "s3";
  }
  return null;
}

// service block から検出できる DbKind を全て返す。LocalStack (image または
// SERVICES 環境変数で判定) は1コンテナで複数 AWS サービスを提供しうるため
// 複数 kind を返すことがある。それ以外は既存の単一判定チェーンにフォールバック。
function detectDbKindsForService(
  image: string | null,
  env: Record<string, string>,
  containerPort: string | null,
  serviceName: string,
): DbKind[] {
  if (isLocalstackImage(image) || env.SERVICES !== undefined) {
    return detectAwsKindsFromServices(env.SERVICES);
  }
  const single =
    (image ? detectDbKind(image, env) : null) ??
    detectDbKindFromEnv(env) ??
    detectDbKindFromContainerPort(containerPort) ??
    detectDbKindFromServiceName(serviceName);
  return single ? [single] : [];
}

// 同一 service から複数 kind が検出された場合の label 表示用。
function dbKindDisplayName(kind: DbKind): string {
  switch (kind) {
    case "s3":
      return "S3";
    case "dynamodb":
      return "DynamoDB";
    case "redis":
      return "Redis";
    case "elasticsearch":
      return "Elasticsearch";
    case "postgresql":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "sqlite":
      return "SQLite";
  }
}

function detectDbKindFromContainerPort(port: string | null): DbKind | null {
  switch (port) {
    case "3306":
      return "mysql";
    case "5432":
      return "postgresql";
    case "6379":
      return "redis";
    case "9200":
      return "elasticsearch";
    default:
      return null;
  }
}

function detectDbKindFromServiceName(name: string): DbKind | null {
  const lower = name.toLowerCase();
  if (lower === "mysql" || lower === "mariadb" || lower === "db") {
    return "mysql";
  }
  if (lower === "postgres" || lower === "postgresql" || lower === "pg") {
    return "postgresql";
  }
  if (lower === "redis") return "redis";
  if (lower === "elasticsearch" || lower === "opensearch" || lower === "es") {
    return "elasticsearch";
  }
  if (lower === "minio" || lower === "s3" || lower === "object-storage") {
    return "s3";
  }
  return null;
}

function defaultPortFor(
  kind: DbKind,
  image?: string | null,
  env: Record<string, string> = {},
): string {
  switch (kind) {
    case "postgresql":
      return "5432";
    case "mysql":
      return "3306";
    case "redis":
      return "6379";
    case "elasticsearch":
      return "9200";
    case "s3": {
      const lower = image?.toLowerCase() || "";
      return lower.includes("localstack/localstack") ||
        (env.SERVICES !== undefined &&
          serviceListIncludesAwsService(env.SERVICES, "s3"))
        ? "4566"
        : "9000";
    }
    case "dynamodb":
      return "4566";
    default:
      return "";
  }
}

function lookupEnvValue(
  varName: string,
  composeDirEnv: Record<string, string>,
): string | undefined {
  return process.env[varName] ?? composeDirEnv[varName];
}

function stripScalarSyntax(raw: string): string {
  let value = raw.trim();
  if (value.startsWith("'") || value.startsWith('"')) {
    const quote = value[0];
    const quoteEnd = value.lastIndexOf(quote);
    if (quoteEnd > 0) return value.slice(1, quoteEnd);
  }
  const hashIdx = value.indexOf(" #");
  if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
  return value;
}

function resolveEnvValue(
  raw: string,
  composeDirEnv: Record<string, string> = {},
): string {
  const value = stripScalarSyntax(raw);
  const withBraces = value.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    const defaultMatch = expr.match(/^([^:-]+)(?::?-(.*))?$/);
    if (!defaultMatch) return "";
    const varName = defaultMatch[1];
    const fallback = defaultMatch[2] ?? "";
    return lookupEnvValue(varName, composeDirEnv) ?? fallback;
  });
  return withBraces.replace(
    /\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_, varName: string) => lookupEnvValue(varName, composeDirEnv) ?? "",
  );
}

async function readDotenvAsync(
  composeDir: string,
): Promise<Record<string, string>> {
  try {
    const content = await readFile(join(composeDir, ".env"), "utf-8");
    return parseDotenvContent(content);
  } catch {
    return {};
  }
}

function parseDotenvContent(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!match) continue;
    env[match[1]] = stripScalarSyntax(match[2]);
  }
  return env;
}

function parseComposeEnv(
  serviceBlock: string,
  composeDirEnv: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  const envMatch = serviceBlock.match(
    /^[ \t]+environment:\s*\n((?:[ \t]+(?:- )?[^\n]+\n?)*)/m,
  );
  if (!envMatch) return env;
  const block = envMatch[1];
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const stripped = trimmed.startsWith("- ") ? trimmed.slice(2) : trimmed;
    const eqIdx = stripped.indexOf("=");
    const colonIdx = stripped.indexOf(": ");
    if (eqIdx > 0) {
      env[stripped.slice(0, eqIdx).trim()] = resolveEnvValue(
        stripped.slice(eqIdx + 1).trim(),
        composeDirEnv,
      );
    } else if (colonIdx > 0) {
      env[stripped.slice(0, colonIdx).trim()] = resolveEnvValue(
        stripped.slice(colonIdx + 2).trim(),
        composeDirEnv,
      );
    }
  }
  return env;
}

function parseComposePortMappings(
  serviceBlock: string,
  composeDirEnv: Record<string, string> = {},
): Array<{ host: string; container: string }> {
  const portsMatch = serviceBlock.match(
    /^[ \t]+ports:\s*\n((?:[ \t]+- [^\n]+\n?)*)/m,
  );
  if (!portsMatch) return [];
  const mappings: Array<{ host: string; container: string }> = [];
  for (const line of portsMatch[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    // resolveEnvValue (→ stripScalarSyntax) が引用符とコメントを正しい順序
    // (引用符の対応する終端まで見てからコメントを切る) で除去したうえで
    // ${VAR}/$VAR を展開する。ここで先に独自に引用符/コメントを削ると、
    // 閉じ引用符がコメントの手前にある行 (例: `- "4566:4566"  # comment`)
    // で終端引用符だけ消せず `4566:4566"` が残り、ポート番号として parse
    // できなくなる (該当行が丸ごと無視されホストポート未検出になる)。
    const value = resolveEnvValue(trimmed.slice(1).trim(), composeDirEnv)
      .split("/")[0]
      .trim();
    if (!value || value.includes("target:")) continue;
    const parts = value.split(":");
    const container = parts.pop()?.trim() || "";
    const host = parts.pop()?.trim() || "";
    const containerPorts = expandPortRange(container);
    const hostPorts = host ? expandPortRange(host) : [];
    if (!containerPorts) continue;
    if (host && (!hostPorts || hostPorts.length !== containerPorts.length)) {
      continue;
    }
    for (let i = 0; i < containerPorts.length; i++) {
      mappings.push({
        host: hostPorts ? (hostPorts[i] ?? "").toString() : "",
        container: containerPorts[i].toString(),
      });
    }
  }
  return mappings;
}

function expandPortRange(value: string): number[] | null {
  const match = value.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2] || match[1]);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end > 65535 ||
    end < start
  ) {
    return null;
  }
  return Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
}

function parseComposePorts(
  serviceBlock: string,
  composeDirEnv: Record<string, string> = {},
): string | null {
  const first = parseComposePortMappings(serviceBlock, composeDirEnv).find(
    (m) => m.host,
  );
  return first?.host || null;
}

function parseComposeHostPortForContainer(
  serviceBlock: string,
  containerPort: string,
  composeDirEnv: Record<string, string> = {},
): string | null {
  const found = parseComposePortMappings(serviceBlock, composeDirEnv).find(
    (m) => m.container === containerPort && m.host,
  );
  return found?.host || null;
}

function parseComposeContainerPort(serviceBlock: string): string | null {
  const portsMatch = serviceBlock.match(
    /^[ \t]+ports:\s*\n((?:[ \t]+- [^\n]+\n?)*)/m,
  );
  if (!portsMatch) return null;
  for (const line of portsMatch[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const value = trimmed
      .slice(1)
      .trim()
      .replace(/^["']|["']$/g, "")
      .split(/\s+#/)[0]
      .split("/")[0];
    const m = value
      .split(":")
      .pop()
      ?.trim()
      .match(/^(\d+)$/);
    if (m) return m[1];
  }
  return null;
}

// DockerDbInfo:
//   composeDir: 拾った compose ファイルが置いてあるディレクトリの絶対 path。
//     adapter 経路で `docker compose ps` を実行する cwd として使う。
//     `/_db/files` レスポンスには漏らさない (handle.ts の toFileInfo で
//     射影しない、Round 1 C1 思想)。
export type DockerDbInfo = DbFileInfo & {
  serviceName: string;
  image?: string;
  env: Record<string, string>;
  database?: string;
  composeDir: string;
  relDirSlash: string;
  hostPort?: string;
  containerPort: string;
  // compose の profiles: が指定されている場合 true。doctor は未指定 profile で
  // `docker compose config --services` から外れるのを「正常」として扱う。
  profiled?: boolean;
};

export type DockerDiscoveryResult = DockerDbInfo[] & { truncated?: boolean };

// 1 ファイルから service 群を parse して結果配列に積む。
// dbId は cwd 直下なら従来の `docker:<svc>`、サブディレクトリなら
// `docker:<svc>@<encodedRelDir>` で衝突回避する。
function parseComposeContent(
  content: string,
  filepath: string,
  composeDir: string,
  cwd: string,
  composeDirEnv: Record<string, string>,
  results: DockerDbInfo[],
): void {
  const servicesMatch = content.match(/^services:\s*\n/m);
  if (!servicesMatch || servicesMatch.index === undefined) return;

  const servicesStart = servicesMatch.index + servicesMatch[0].length;
  const afterServices = content.slice(servicesStart);
  const topLevelEnd = afterServices.search(/^\S/m);
  const servicesBlock =
    topLevelEnd >= 0 ? afterServices.slice(0, topLevelEnd) : afterServices;

  const serviceRegex = /^ {2}(\w[\w-]*):\s*\n/gm;
  const servicePositions: { name: string; start: number }[] = [];
  for (
    let match = serviceRegex.exec(servicesBlock);
    match !== null;
    match = serviceRegex.exec(servicesBlock)
  ) {
    servicePositions.push({ name: match[1], start: match.index });
  }

  const relDir = relative(cwd, composeDir);
  // cwd 直下と一致する場合は relDir === "" になる。
  const isRoot = relDir === "" || relDir === ".";
  // path / id / label に乗せる relDir 表現。Windows パス区切りは `/` に揃える。
  const relDirSlash = relDir.replace(/\\/g, "/");
  const filename = basename(filepath);

  for (let i = 0; i < servicePositions.length; i++) {
    if (results.length >= MAX_DOCKER_SERVICES) return;
    const svc = servicePositions[i];
    const nextStart =
      i + 1 < servicePositions.length
        ? servicePositions[i + 1].start
        : servicesBlock.length;
    const svcBlock = servicesBlock.slice(svc.start, nextStart);

    const imageMatch = svcBlock.match(/^\s+image:\s*["']?([^\s"'#]+)/m);
    const image = imageMatch ? imageMatch[1] : null;
    const env = parseComposeEnv(svcBlock, composeDirEnv);
    const containerPort = parseComposeContainerPort(svcBlock);
    // profiles: が定義されていれば profile-gated。値が空でも key の存在で判定する
    // (compose は `profiles:` だけあって中身が空の場合も警告を出さないため)。
    const profiled = /^\s+profiles:/m.test(svcBlock);
    // LocalStack 等、1コンテナが複数 AWS サービスを同時提供する場合は
    // kinds.length > 1 になる。その場合のみ id/label に kind を明示する。
    const kinds = detectDbKindsForService(image, env, containerPort, svc.name);
    const isMultiKind = kinds.length > 1;

    for (const kind of kinds) {
      if (results.length >= MAX_DOCKER_SERVICES) return;

      const defaultPort = defaultPortFor(kind, image, env);
      const serviceContainerPort =
        kind === "s3" || kind === "dynamodb"
          ? defaultPort
          : containerPort || defaultPort;
      const publishedHostPort =
        parseComposeHostPortForContainer(
          svcBlock,
          serviceContainerPort,
          composeDirEnv,
        ) ||
        parseComposeHostPortForContainer(
          svcBlock,
          defaultPort,
          composeDirEnv,
        ) ||
        parseComposePorts(svcBlock, composeDirEnv);
      const hostPort =
        kind === "s3" || kind === "dynamodb"
          ? publishedHostPort || undefined
          : publishedHostPort || defaultPort;
      const imageLabel = image ?? `build:${kind}`;

      // 複数 kind を持つ service は id が衝突するため kind suffix で一意化する
      // (単一 kind の service は既存の id 形式を維持し後方互換を保つ)。
      const kindSuffix = isMultiKind ? `#${kind}` : "";
      const id = isRoot
        ? `docker:${svc.name}${kindSuffix}`
        : `docker:${svc.name}@${encodeURIComponent(relDirSlash)}${kindSuffix}`;
      const labelPath = isRoot ? "" : ` — ${relDirSlash}`;

      let label: string;
      if (
        kind === "redis" ||
        kind === "elasticsearch" ||
        kind === "s3" ||
        kind === "dynamodb"
      ) {
        const endpointLabel = hostPort
          ? `localhost:${hostPort}`
          : `container:${serviceContainerPort}`;
        const svcLabel = isMultiKind
          ? `${svc.name} / ${dbKindDisplayName(kind)}`
          : svc.name;
        label = `${svcLabel} (${imageLabel}, ${endpointLabel}${labelPath})`;
      } else {
        const dbName =
          env.POSTGRES_DB ||
          env.MYSQL_DATABASE ||
          env.MARIADB_DATABASE ||
          svc.name;
        const user =
          env.POSTGRES_USER ||
          env.MYSQL_USER ||
          env.MARIADB_USER ||
          (kind === "postgresql" ? "postgres" : "root");
        label = `${svc.name} (${imageLabel}, ${user}@localhost:${hostPort}/${dbName}${labelPath})`;
      }

      results.push({
        id,
        path: isRoot ? filename : `${relDirSlash}/${filename}`,
        name: label,
        sizeBytes: 0,
        kind,
        serviceName: svc.name,
        ...(image ? { image } : {}),
        env,
        composeDir,
        relDirSlash,
        ...(hostPort ? { hostPort } : {}),
        containerPort: serviceContainerPort,
        ...(profiled ? { profiled: true } : {}),
      });
    }
  }
}

async function parseComposeFileAsync(
  filepath: string,
  composeDir: string,
  cwd: string,
  results: DockerDbInfo[],
): Promise<void> {
  let content: string;
  try {
    content = await readFile(filepath, "utf-8");
  } catch {
    return;
  }
  const composeDirEnv = await readDotenvAsync(composeDir);
  parseComposeContent(
    content,
    filepath,
    composeDir,
    cwd,
    composeDirEnv,
    results,
  );
}

// SQLite と同じ規約で MAX_SCAN_DEPTH まで再帰 walk し、各ディレクトリで
// compose ファイル 1 つ (COMPOSE_FILENAMES の優先順) を parse する。
// 全 service が `MAX_DOCKER_SERVICES` を超えたら truncate して warn する。
const MAX_DOCKER_SERVICES = 30;
const dockerDiscoveryCache = new Map<
  string,
  { expiresAt: number; result: DockerDiscoveryResult }
>();

function dockerDiscoveryCacheKey(cwd: string, omitDirNames: string[]): string {
  return discoveryCacheKey(cwd, omitDirNames);
}

function cloneDockerDiscoveryResult(
  result: DockerDiscoveryResult,
): DockerDiscoveryResult {
  const cloned = result.map((entry) => ({
    ...entry,
    env: { ...entry.env },
  })) as DockerDiscoveryResult;
  if (result.truncated) cloned.truncated = true;
  return cloned;
}

async function pathExistsAsync(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// 「ディレクトリごとに1つのマーカー (compose ファイル / supabase
// config.toml) を探してから子ディレクトリへ再帰する」という共通の walk。
// docker-compose 探索と supabase CLI 探索はこの形が同じなので共有する
// (sqlite 探索は「任意深さの拡張子一致ファイルを列挙する」という別の形
// なので対象外)。`visitDir` が現在のディレクトリでマーカーを探して結果に
// 積む役目、`hasCapacity` が MAX_* 上限判定を担う。
async function walkForMarkerFileAsync(
  dir: string,
  depth: number,
  omitSet: Set<string>,
  hasCapacity: () => boolean,
  visitDir: (dir: string) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted || !hasCapacity()) return;
  if (depth > MAX_SCAN_DEPTH) return;
  await visitDir(dir);
  if (signal?.aborted || !hasCapacity()) return;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (signal?.aborted || !hasCapacity()) return;
    if (omitSet.has(entry.toLowerCase())) continue;
    const full = join(dir, entry);
    let entryStat: Awaited<ReturnType<typeof lstat>>;
    try {
      entryStat = await lstat(full);
    } catch {
      continue;
    }
    if (entryStat.isSymbolicLink()) continue;
    if (entryStat.isDirectory()) {
      await walkForMarkerFileAsync(
        full,
        depth + 1,
        omitSet,
        hasCapacity,
        visitDir,
        signal,
      );
    }
  }
}

export async function discoverDockerDatabasesAsync(
  cwd: string,
  omitDirNames: string[] = [],
  signal?: AbortSignal,
): Promise<DockerDiscoveryResult> {
  const cacheKey = dockerDiscoveryCacheKey(cwd, omitDirNames);
  const now = Date.now();
  const cached = dockerDiscoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cloneDockerDiscoveryResult(cached.result);
  }

  const results: DockerDiscoveryResult = [] as DockerDiscoveryResult;
  const omitSet = new Set(omitDirNames.map((d) => d.toLowerCase()));
  omitSet.add(".git");
  omitSet.add("node_modules");

  await walkForMarkerFileAsync(
    cwd,
    0,
    omitSet,
    () => results.length < MAX_DOCKER_SERVICES,
    async (dir) => {
      for (const filename of COMPOSE_FILENAMES) {
        const filepath = join(dir, filename);
        if (await pathExistsAsync(filepath)) {
          await parseComposeFileAsync(filepath, dir, cwd, results);
          break;
        }
      }
    },
    signal,
  );
  if (signal?.aborted) return cloneDockerDiscoveryResult(results);
  if (results.length >= MAX_DOCKER_SERVICES) {
    results.truncated = true;
    console.warn(
      `[code-viewer] docker discovery hit MAX_DOCKER_SERVICES=${MAX_DOCKER_SERVICES}; some compose services may be hidden`,
    );
  }
  dockerDiscoveryCache.set(cacheKey, {
    expiresAt: now + DOCKER_DISCOVERY_TTL_MS,
    result: cloneDockerDiscoveryResult(results),
  });
  return cloneDockerDiscoveryResult(results);
}

// DbKind の全メンバー (types.ts と手動同期)。id 末尾の `#<kind>` suffix が
// 任意の文字列を kind として通してしまわないよう、既知の値だけ許可する。
const DB_KIND_VALUES: ReadonlySet<string> = new Set<DbKind>([
  "sqlite",
  "postgresql",
  "mysql",
  "redis",
  "elasticsearch",
  "s3",
  "dynamodb",
]);

function isDbKind(value: string): value is DbKind {
  return DB_KIND_VALUES.has(value);
}

// `docker:<svc>` または `docker:<svc>@<encodedRelDir>` (+ optional `:<db>`,
// + optional `#<kind>`) を parse して `{serviceName, relDir, database, kind}`
// を返す。`relDir` は encodeURIComponent された slash 区切り。cwd 直下は空文字。
// `#<kind>` は LocalStack 等、1コンテナから複数 DbKind を検出した service を
// 一意化するための suffix (単一 kind の service には付かない)。解析失敗時は null。
export function parseDockerDbId(dbId: string): {
  serviceName: string;
  relDir: string;
  database?: string;
  kind?: DbKind;
} | null {
  if (!dbId.startsWith("docker:")) return null;
  let rest = dbId.slice(7);
  if (!rest) return null;
  // `#<kind>` は id の末尾に付く。DB セパレータ `:` や `@<encodedRelDir>` の
  // 解析より先に切り離しておく。
  let kind: DbKind | undefined;
  const hashIdx = rest.indexOf("#");
  if (hashIdx >= 0) {
    const kindPart = rest.slice(hashIdx + 1);
    if (!isDbKind(kindPart)) return null;
    kind = kindPart;
    rest = rest.slice(0, hashIdx);
  }
  // `:<db>` は最後にあるので、`@` の後に出る `:` のみ DB セパレータ。
  // つまり @ より前の最初の `:` は DB セパレータ、@ より後の最初の `:` も DB セパレータ。
  let database: string | undefined;
  // 末尾の `:db` を切る前に `@` 位置を探す。`@<encoded>` の encoded には
  // `:` は出ない (URL encode 済み = `%3A`)。
  const atIdx = rest.indexOf("@");
  if (atIdx >= 0) {
    if (rest.indexOf("@", atIdx + 1) >= 0) return null;
    const afterAt = rest.slice(atIdx + 1);
    const colonIdx = afterAt.indexOf(":");
    if (colonIdx >= 0) {
      database = afterAt.slice(colonIdx + 1);
      rest = `${rest.slice(0, atIdx)}@${afterAt.slice(0, colonIdx)}`;
    }
    const [serviceName, encodedRel] = rest.split("@");
    if (!isSafeDockerServiceName(serviceName)) return null;
    if (!isSafeDockerDatabaseName(database)) return null;
    try {
      const relDir = decodeURIComponent(encodedRel || "");
      if (!isSafeDockerRelDir(relDir)) return null;
      return {
        serviceName,
        relDir,
        database,
        kind,
      };
    } catch {
      return null;
    }
  }
  // `docker:<svc>:<db>` 形式 (cwd 直下、従来形式)。
  const colonIdx = rest.indexOf(":");
  if (colonIdx >= 0) {
    database = rest.slice(colonIdx + 1);
    rest = rest.slice(0, colonIdx);
  }
  if (!isSafeDockerServiceName(rest)) return null;
  if (!isSafeDockerDatabaseName(database)) return null;
  return { serviceName: rest, relDir: "", database, kind };
}

export function canonicalizeDockerDbId(dbId: string): string | null {
  const parsed = parseDockerDbId(dbId);
  if (!parsed) return null;
  const database = parsed.database ? `:${parsed.database}` : "";
  const kindSuffix = parsed.kind ? `#${parsed.kind}` : "";
  if (!parsed.relDir)
    return `docker:${parsed.serviceName}${database}${kindSuffix}`;
  return `docker:${parsed.serviceName}@${encodeURIComponent(parsed.relDir)}${database}${kindSuffix}`;
}

export async function findDockerServiceByDbIdAsync(
  cwd: string,
  dbId: string,
  kind?: DbKind,
  omitDirNames?: string[],
  signal?: AbortSignal,
): Promise<DockerDbInfo | null> {
  const parsed = parseDockerDbId(dbId);
  if (!parsed) return null;
  // id 自体に kind suffix (#dynamodb 等) が含まれる場合、呼び出し元が別の
  // kind を明示していれば矛盾なので「見つからない」扱いにする。
  if (kind && parsed.kind && parsed.kind !== kind) return null;
  const effectiveKind = parsed.kind ?? kind;
  const services = await discoverDockerDatabasesAsync(
    cwd,
    omitDirNames,
    signal,
  );
  return (
    services.find(
      (d) =>
        d.serviceName === parsed.serviceName &&
        d.relDirSlash === parsed.relDir &&
        (!effectiveKind || d.kind === effectiveKind),
    ) || null
  );
}

function isSafeDockerServiceName(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function isSafeDockerRelDir(value: string): boolean {
  if (value === "") return true;
  if (!/^[A-Za-z0-9_./-]+$/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((p) => p !== "" && p !== "." && p !== "..");
}

function isSafeDockerDatabaseName(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (value === "") return false;
  if (hasControlCharacter(value)) return false;
  return /^[A-Za-z0-9_$.-]+$/.test(value);
}

// ---------- Supabase CLI (supabase start) discovery ----------
//
// `supabase start` は Docker API を直接叩いてコンテナ (supabase_db_<project_id> 等)
// を作るだけで、docker-compose.yml をプロジェクトディレクトリに書き出さない。
// そのため上の compose 探索では見つからない。supabase/config.toml を独立に
// 再帰 walk して project_id と db port を拾い、接続は docker.ts 側で
// `docker ps` によるコンテナ名解決 (compose ps 不要) に任せる。

export type SupabaseCliDbInfo = DbFileInfo & {
  kind: "postgresql";
  projectId: string;
  relDirSlash: string;
  dbPort: string;
};

const MAX_SUPABASE_PROJECTS = 30;
const SUPABASE_DISCOVERY_TTL_MS = 5_000;
const DEFAULT_SUPABASE_DB_PORT = "54322";
const supabaseDiscoveryCache = new Map<
  string,
  { expiresAt: number; result: SupabaseCliDbInfo[] }
>();

function cloneSupabaseDiscoveryResult(
  result: SupabaseCliDbInfo[],
): SupabaseCliDbInfo[] {
  return result.map((entry) => ({ ...entry }));
}

// supabase/config.toml のうち project_id (トップレベル) と [db] セクションの
// port だけを状態機械的に読む。[remotes.<branch>] 等、他セクションに同名キー
// があっても誤って拾わないようにセクション追跡が必要。
function parseSupabaseConfigToml(
  content: string,
): { projectId: string; dbPort: string } | null {
  let section: string | null = null;
  let projectId: string | null = null;
  let dbPort: string | null = null;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.+)$/);
    if (!kvMatch) continue;
    const value = stripScalarSyntax(kvMatch[2]);
    if (section === null && kvMatch[1] === "project_id") {
      projectId = value;
    } else if (section === "db" && kvMatch[1] === "port") {
      dbPort = value;
    }
  }
  if (!projectId || !isSafeDockerServiceName(projectId)) return null;
  return {
    projectId,
    dbPort: dbPort && /^\d+$/.test(dbPort) ? dbPort : DEFAULT_SUPABASE_DB_PORT,
  };
}

export async function discoverSupabaseCliProjectsAsync(
  cwd: string,
  omitDirNames: string[] = [],
  signal?: AbortSignal,
): Promise<SupabaseCliDbInfo[]> {
  const cacheKey = discoveryCacheKey(cwd, omitDirNames);
  const now = Date.now();
  const cached = supabaseDiscoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cloneSupabaseDiscoveryResult(cached.result);
  }

  const omitSet = new Set(omitDirNames.map((d) => d.toLowerCase()));
  omitSet.add(".git");
  omitSet.add("node_modules");
  const results: SupabaseCliDbInfo[] = [];

  await walkForMarkerFileAsync(
    cwd,
    0,
    omitSet,
    () => results.length < MAX_SUPABASE_PROJECTS,
    async (dir) => {
      const configPath = join(dir, "supabase", "config.toml");
      if (!(await pathExistsAsync(configPath))) return;
      try {
        const content = await readFile(configPath, "utf-8");
        const parsed = parseSupabaseConfigToml(content);
        if (!parsed) return;
        const relDir = relative(cwd, dir);
        const isRoot = relDir === "" || relDir === ".";
        const relDirSlash = relDir.replace(/\\/g, "/");
        const id = isRoot
          ? `supabase:${parsed.projectId}`
          : `supabase:${parsed.projectId}@${encodeURIComponent(relDirSlash)}`;
        const labelPath = isRoot ? "" : ` — ${relDirSlash}`;
        results.push({
          id,
          path: isRoot
            ? "supabase/config.toml"
            : `${relDirSlash}/supabase/config.toml`,
          name: `${parsed.projectId} (Supabase CLI, postgres@127.0.0.1:${parsed.dbPort}/postgres${labelPath})`,
          sizeBytes: 0,
          kind: "postgresql",
          projectId: parsed.projectId,
          relDirSlash,
          dbPort: parsed.dbPort,
        });
      } catch {
        // 読めない/壊れた config.toml は無視して探索を続ける。
      }
    },
    signal,
  );

  if (signal?.aborted) return cloneSupabaseDiscoveryResult(results);
  supabaseDiscoveryCache.set(cacheKey, {
    expiresAt: now + SUPABASE_DISCOVERY_TTL_MS,
    result: cloneSupabaseDiscoveryResult(results),
  });
  return cloneSupabaseDiscoveryResult(results);
}

// `supabase:<project_id>` または `supabase:<project_id>@<encodedRelDir>` を
// parse する。docker: 系と衝突しないよう別 prefix にしてある。
export function parseSupabaseDbId(
  dbId: string,
): { projectId: string; relDir: string } | null {
  if (!dbId.startsWith("supabase:")) return null;
  const rest = dbId.slice("supabase:".length);
  if (!rest) return null;
  const atIdx = rest.indexOf("@");
  let projectId: string;
  let relDir = "";
  if (atIdx >= 0) {
    if (rest.indexOf("@", atIdx + 1) >= 0) return null;
    projectId = rest.slice(0, atIdx);
    try {
      relDir = decodeURIComponent(rest.slice(atIdx + 1));
    } catch {
      return null;
    }
    if (!isSafeDockerRelDir(relDir)) return null;
  } else {
    projectId = rest;
  }
  if (!isSafeDockerServiceName(projectId)) return null;
  return { projectId, relDir };
}

export async function findSupabaseCliProjectByDbIdAsync(
  cwd: string,
  dbId: string,
  omitDirNames?: string[],
  signal?: AbortSignal,
): Promise<SupabaseCliDbInfo | null> {
  const parsed = parseSupabaseDbId(dbId);
  if (!parsed) return null;
  const projects = await discoverSupabaseCliProjectsAsync(
    cwd,
    omitDirNames,
    signal,
  );
  return (
    projects.find(
      (p) =>
        p.projectId === parsed.projectId && p.relDirSlash === parsed.relDir,
    ) || null
  );
}
