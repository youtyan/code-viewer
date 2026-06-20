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
  results.sort((a, b) => a.path.localeCompare(b.path));
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
  return null;
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
      env[stripped.slice(0, eqIdx).trim()] = stripped.slice(eqIdx + 1).trim();
    } else if (colonIdx > 0) {
      env[stripped.slice(0, colonIdx).trim()] = stripped
        .slice(colonIdx + 2)
        .trim();
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

export function discoverDockerDatabases(cwd: string): DbFileInfo[] {
  const results: DbFileInfo[] = [];

  for (const filename of COMPOSE_FILENAMES) {
    const filepath = join(cwd, filename);
    if (!existsSync(filepath)) continue;

    let content: string;
    try {
      content = readFileSync(filepath, "utf-8");
    } catch {
      continue;
    }

    const servicesMatch = content.match(/^services:\s*\n/m);
    if (!servicesMatch || servicesMatch.index === undefined) continue;

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
      servicePositions.push({
        name: match[1],
        start: match.index,
      });
    }

    for (let i = 0; i < servicePositions.length; i++) {
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
      const hostPort = port || (kind === "postgresql" ? "5432" : "3306");

      const label = `${svc.name} (${image}, ${user}@localhost:${hostPort}/${dbName})`;

      results.push({
        id: `docker:${svc.name}`,
        path: filename,
        name: label,
        sizeBytes: 0,
        kind,
      });
    }

    break;
  }

  return results;
}
