import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, join, relative } from "node:path";
import type { DbFileInfo, DbKind } from "../../core/database/types";

const SQLITE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3", ".s3db"]);
const SQLITE_MAGIC = "SQLite format 3\0";
const MAX_SCAN_DEPTH = 3;
const MAX_ENTRIES = 50;
const DOCKER_DISCOVERY_TTL_MS = 5_000;

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

export type DiscoveredDb = {
  path: string;
  name: string;
  sizeBytes: number;
};

export function discoverSqliteFiles(
  cwd: string,
  omitDirNames: string[],
): DiscoveredDb[] {
  const omitSet = new Set(omitDirNames.map((d) => d.toLowerCase()));
  omitSet.add(".git");
  const results: DiscoveredDb[] = [];

  function scan(dir: string, depth: number) {
    if (depth > MAX_SCAN_DEPTH || results.length >= MAX_ENTRIES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= MAX_ENTRIES) return;
      if (omitSet.has(entry.toLowerCase())) continue;
      const full = join(dir, entry);
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        scan(full, depth + 1);
      } else if (stat.isFile()) {
        const ext = entry.slice(entry.lastIndexOf(".")).toLowerCase();
        if (!SQLITE_EXTENSIONS.has(ext)) continue;
        if (!isSqliteFile(full)) continue;
        const rel = relative(cwd, full);
        if (rel.startsWith("..") || rel.startsWith("/")) continue;
        results.push({
          path: rel,
          name: basename(rel),
          sizeBytes: stat.size,
        });
      }
    }
  }

  scan(cwd, 0);
  results.sort((a, b) => {
    const aInternal = a.path.startsWith(".code-viewer/") ? 1 : 0;
    const bInternal = b.path.startsWith(".code-viewer/") ? 1 : 0;
    if (aInternal !== bInternal) return aInternal - bInternal;
    return a.path.localeCompare(b.path);
  });
  return results;
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
  if (parts.some((p) => p === ".." || p.toLowerCase() === ".git")) return null;
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

function detectDbKind(image: string): DbKind | null {
  const lower = image.toLowerCase();
  if (lower.includes("postgres")) return "postgresql";
  if (lower.includes("mysql") || lower.includes("mariadb")) return "mysql";
  if (lower.includes("redis")) return "redis";
  if (lower.includes("elasticsearch") || lower.includes("opensearch"))
    return "elasticsearch";
  return null;
}

function defaultPortFor(kind: DbKind): string {
  switch (kind) {
    case "postgresql":
      return "5432";
    case "mysql":
      return "3306";
    case "redis":
      return "6379";
    case "elasticsearch":
      return "9200";
    default:
      return "";
  }
}

function resolveEnvValue(raw: string): string {
  return raw.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    const defaultMatch = expr.match(/^([^:-]+)(?::?-(.*))?$/);
    if (!defaultMatch) return "";
    const varName = defaultMatch[1];
    const fallback = defaultMatch[2] ?? "";
    return process.env[varName] || fallback;
  });
}

function parseComposeEnv(serviceBlock: string): Record<string, string> {
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
      );
    } else if (colonIdx > 0) {
      env[stripped.slice(0, colonIdx).trim()] = resolveEnvValue(
        stripped.slice(colonIdx + 2).trim(),
      );
    }
  }
  return env;
}

function parseComposePorts(serviceBlock: string): string | null {
  const portsMatch = serviceBlock.match(
    /^[ \t]+ports:\s*\n((?:[ \t]+- [^\n]+\n?)*)/m,
  );
  if (!portsMatch) return null;
  for (const line of portsMatch[1].split("\n")) {
    const m = line.match(/["']?(\d+):(\d+)["']?/);
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
  env: Record<string, string>;
  database?: string;
  composeDir: string;
  relDirSlash: string;
};

export type DockerDiscoveryResult = DockerDbInfo[] & { truncated?: boolean };

// 1 ファイルから service 群を parse して結果配列に積む。
// dbId は cwd 直下なら従来の `docker:<svc>`、サブディレクトリなら
// `docker:<svc>@<encodedRelDir>` で衝突回避する。
function parseComposeFile(
  filepath: string,
  composeDir: string,
  cwd: string,
  results: DockerDbInfo[],
): void {
  let content: string;
  try {
    content = readFileSync(filepath, "utf-8");
  } catch {
    return;
  }
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
    if (!imageMatch) continue;

    const image = imageMatch[1];
    const kind = detectDbKind(image);
    if (!kind) continue;

    const env = parseComposeEnv(svcBlock);
    const port = parseComposePorts(svcBlock);
    const hostPort = port || defaultPortFor(kind);

    const id = isRoot
      ? `docker:${svc.name}`
      : `docker:${svc.name}@${encodeURIComponent(relDirSlash)}`;
    const labelPath = isRoot ? "" : ` — ${relDirSlash}`;

    let label: string;
    if (kind === "redis" || kind === "elasticsearch") {
      label = `${svc.name} (${image}, localhost:${hostPort}${labelPath})`;
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
      label = `${svc.name} (${image}, ${user}@localhost:${hostPort}/${dbName}${labelPath})`;
    }

    results.push({
      id,
      path: isRoot ? filename : `${relDirSlash}/${filename}`,
      name: label,
      sizeBytes: 0,
      kind,
      serviceName: svc.name,
      env,
      composeDir,
      relDirSlash,
    });
  }
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
  const omit = [...omitDirNames].map((d) => d.toLowerCase()).sort();
  return JSON.stringify([cwd, omit]);
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

export function discoverDockerDatabases(
  cwd: string,
  omitDirNames: string[] = [],
): DockerDiscoveryResult {
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

  function scan(dir: string, depth: number): void {
    if (results.length >= MAX_DOCKER_SERVICES) return;
    if (depth > MAX_SCAN_DEPTH) return;
    // 1. このディレクトリ直下の compose を 1 つ parse する。
    for (const filename of COMPOSE_FILENAMES) {
      const filepath = join(dir, filename);
      if (existsSync(filepath)) {
        parseComposeFile(filepath, dir, cwd, results);
        break;
      }
    }
    if (results.length >= MAX_DOCKER_SERVICES) return;
    // 2. サブディレクトリへ recurse (symlink 除外 / omitDirNames 除外)。
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= MAX_DOCKER_SERVICES) return;
      if (omitSet.has(entry.toLowerCase())) continue;
      const full = join(dir, entry);
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) scan(full, depth + 1);
    }
  }

  scan(cwd, 0);
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

export function findDockerServiceByDbId(
  cwd: string,
  dbId: string,
  kind?: DbKind,
  omitDirNames?: string[],
): DockerDbInfo | null {
  const parsed = parseDockerDbId(dbId);
  if (!parsed) return null;
  return (
    discoverDockerDatabases(cwd, omitDirNames).find(
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

function hasControlCharacter(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
