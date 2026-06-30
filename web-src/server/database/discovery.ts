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

function serviceListIncludesS3(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return true;
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .includes("s3");
}

function imageLooksLikeMinio(image: string): boolean {
  return /(^|\/)minio(?::|\/|$)/.test(image.toLowerCase());
}

function detectDbKind(
  image: string,
  env: Record<string, string> = {},
): DbKind | null {
  const lower = image.toLowerCase();
  if (lower.includes("postgres")) return "postgresql";
  if (lower.includes("mysql") || lower.includes("mariadb")) return "mysql";
  if (lower.includes("redis")) return "redis";
  if (lower.includes("elasticsearch") || lower.includes("opensearch"))
    return "elasticsearch";
  if (imageLooksLikeMinio(lower)) return "s3";
  if (lower.includes("localstack/localstack")) {
    return serviceListIncludesS3(env.SERVICES) ? "s3" : null;
  }
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
  if (env.SERVICES && serviceListIncludesS3(env.SERVICES)) return "s3";
  return null;
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
        (env.SERVICES !== undefined && serviceListIncludesS3(env.SERVICES))
        ? "4566"
        : "9000";
    }
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
    const value = resolveEnvValue(
      trimmed
        .slice(1)
        .trim()
        .replace(/^["']|["']$/g, "")
        .split(/\s+#/)[0]
        .split("/")[0]
        .trim(),
      composeDirEnv,
    );
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
    const kind =
      (image ? detectDbKind(image, env) : null) ??
      detectDbKindFromEnv(env) ??
      detectDbKindFromContainerPort(containerPort) ??
      detectDbKindFromServiceName(svc.name);
    if (!kind) continue;

    const defaultPort = defaultPortFor(kind, image, env);
    const serviceContainerPort =
      kind === "s3" ? defaultPort : containerPort || defaultPort;
    const publishedHostPort =
      parseComposeHostPortForContainer(
        svcBlock,
        serviceContainerPort,
        composeDirEnv,
      ) ||
      parseComposeHostPortForContainer(svcBlock, defaultPort, composeDirEnv) ||
      parseComposePorts(svcBlock, composeDirEnv);
    const hostPort =
      kind === "s3"
        ? publishedHostPort || undefined
        : publishedHostPort || defaultPort;
    const imageLabel = image ?? `build:${kind}`;

    const id = isRoot
      ? `docker:${svc.name}`
      : `docker:${svc.name}@${encodeURIComponent(relDirSlash)}`;
    const labelPath = isRoot ? "" : ` — ${relDirSlash}`;

    let label: string;
    if (kind === "redis" || kind === "elasticsearch" || kind === "s3") {
      const endpointLabel = hostPort
        ? `localhost:${hostPort}`
        : `container:${serviceContainerPort}`;
      label = `${svc.name} (${imageLabel}, ${endpointLabel}${labelPath})`;
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

  async function scan(dir: string, depth: number): Promise<void> {
    if (signal?.aborted) return;
    if (results.length >= MAX_DOCKER_SERVICES) return;
    if (depth > MAX_SCAN_DEPTH) return;
    for (const filename of COMPOSE_FILENAMES) {
      const filepath = join(dir, filename);
      if (await pathExistsAsync(filepath)) {
        await parseComposeFileAsync(filepath, dir, cwd, results);
        break;
      }
    }
    if (signal?.aborted) return;
    if (results.length >= MAX_DOCKER_SERVICES) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (signal?.aborted) return;
      if (results.length >= MAX_DOCKER_SERVICES) return;
      if (omitSet.has(entry.toLowerCase())) continue;
      const full = join(dir, entry);
      let entryStat: Awaited<ReturnType<typeof lstat>>;
      try {
        entryStat = await lstat(full);
      } catch {
        continue;
      }
      if (entryStat.isSymbolicLink()) continue;
      if (entryStat.isDirectory()) await scan(full, depth + 1);
    }
  }

  await scan(cwd, 0);
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

// `docker:<svc>` または `docker:<svc>@<encodedRelDir>` (+ optional `:<db>`) を
// parse して `{serviceName, relDir, database}` を返す。
// `relDir` は encodeURIComponent された slash 区切り。cwd 直下は空文字。
// 解析失敗時は null。
export function parseDockerDbId(
  dbId: string,
): { serviceName: string; relDir: string; database?: string } | null {
  if (!dbId.startsWith("docker:")) return null;
  let rest = dbId.slice(7);
  if (!rest) return null;
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
  return { serviceName: rest, relDir: "", database };
}

export function canonicalizeDockerDbId(dbId: string): string | null {
  const parsed = parseDockerDbId(dbId);
  if (!parsed) return null;
  const database = parsed.database ? `:${parsed.database}` : "";
  if (!parsed.relDir) return `docker:${parsed.serviceName}${database}`;
  return `docker:${parsed.serviceName}@${encodeURIComponent(parsed.relDir)}${database}`;
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
        (!kind || d.kind === kind),
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
