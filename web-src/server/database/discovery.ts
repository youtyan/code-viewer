import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, join, relative } from "node:path";

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
