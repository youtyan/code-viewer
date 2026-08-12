import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { errorWithCause } from "../core/error-detail";

export type ServerRegistryEntry = {
  url: string;
  pid: number;
  root: string;
  started_at: string;
};

export type ServerStartLock = {
  release(): void;
};

type ServerStartLockEntry = {
  token: string;
  pid: number;
  createdAt: number;
};

const SERVER_START_LOCK_STALE_MS = 30_000;

function registryDir(): string {
  // Test-only override; keeps registry tests from writing to the user's cache.
  const override = process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
  if (override) return override;
  return join(homedir(), ".cache", "code-viewer", "servers");
}

export function serverRegistryFilePath(root: string): string {
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(registryDir(), `${hash}.json`);
}

function serverStartLockFilePath(root: string): string {
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(registryDir(), `${hash}.start.lock`);
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errno(error) === "ESRCH") return false;
    if (errno(error) === "EPERM") return true;
    throw error;
  }
}

function readServerStartLock(root: string): ServerStartLockEntry | null {
  const file = serverStartLockFilePath(root);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (errno(error) === "ENOENT") return null;
    throw errorWithCause(`failed to read server start lock for ${root}`, error);
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `invalid server start lock for ${root}: expected an object`,
    );
  }
  const entry = raw as Record<string, unknown>;
  if (
    typeof entry.token !== "string" ||
    !entry.token ||
    !Number.isInteger(entry.pid) ||
    (entry.pid as number) < 1 ||
    typeof entry.createdAt !== "number" ||
    !Number.isFinite(entry.createdAt)
  ) {
    throw new Error(
      `invalid server start lock for ${root}: missing required fields`,
    );
  }
  return {
    token: entry.token,
    pid: entry.pid as number,
    createdAt: entry.createdAt,
  };
}

/**
 * Cross-process lock for the check-then-spawn window. A live lock returns
 * null; a lock left by a dead process or an expired startup is reclaimed.
 */
export function acquireServerStartLock(
  root: string,
  now = Date.now(),
): ServerStartLock | null {
  mkdirSync(registryDir(), { recursive: true });
  const file = serverStartLockFilePath(root);
  const token = randomUUID();
  const entry: ServerStartLockEntry = {
    token,
    pid: process.pid,
    createdAt: now,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      writeFileSync(file, `${JSON.stringify(entry)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return {
        release() {
          const current = readServerStartLock(root);
          if (!current || current.token !== token) return;
          try {
            unlinkSync(file);
          } catch (error) {
            if (errno(error) === "ENOENT") return;
            throw error;
          }
        },
      };
    } catch (error) {
      if (errno(error) !== "EEXIST") throw error;
    }
    const current = readServerStartLock(root);
    if (!current) continue;
    const stale =
      now - current.createdAt > SERVER_START_LOCK_STALE_MS ||
      !processAlive(current.pid);
    if (!stale) return null;
    try {
      unlinkSync(file);
    } catch (error) {
      if (errno(error) !== "ENOENT") throw error;
    }
  }
  throw new Error(`server start lock kept changing for ${root}`);
}

export function writeServerRegistry(entry: ServerRegistryEntry): void {
  mkdirSync(registryDir(), { recursive: true });
  writeFileSync(
    serverRegistryFilePath(entry.root),
    `${JSON.stringify(entry, null, 2)}\n`,
    "utf8",
  );
}

export function readServerRegistry(root: string): ServerRegistryEntry | null {
  const file = serverRegistryFilePath(root);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw errorWithCause(`failed to read server registry for ${root}`, error);
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(`invalid server registry for ${root}: expected an object`);
  }
  const entry = raw as Record<string, unknown>;
  if (
    typeof entry.url !== "string" ||
    !entry.url ||
    !Number.isInteger(entry.pid) ||
    (entry.pid as number) < 1 ||
    typeof entry.root !== "string" ||
    !entry.root ||
    typeof entry.started_at !== "string" ||
    !entry.started_at
  ) {
    throw new Error(
      `invalid server registry for ${root}: missing required fields`,
    );
  }
  return {
    url: entry.url,
    pid: entry.pid as number,
    root: entry.root,
    started_at: entry.started_at,
  };
}

export function removeServerRegistry(root: string, pid: number): void {
  const entry = readServerRegistry(root);
  if (!entry || entry.pid !== pid) return;
  try {
    unlinkSync(serverRegistryFilePath(root));
  } catch (error) {
    // A concurrent shutdown may already have removed the same entry.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
