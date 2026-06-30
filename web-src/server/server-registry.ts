import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ServerRegistryEntry = {
  url: string;
  pid: number;
  root: string;
  started_at: string;
};

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

export function writeServerRegistry(entry: ServerRegistryEntry): void {
  try {
    mkdirSync(registryDir(), { recursive: true });
    writeFileSync(
      serverRegistryFilePath(entry.root),
      `${JSON.stringify(entry, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* registry is best-effort; the server works without it */
  }
}

export function readServerRegistry(root: string): ServerRegistryEntry | null {
  const file = serverRegistryFilePath(root);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.url !== "string" || !entry.url) return null;
    return {
      url: entry.url,
      pid: typeof entry.pid === "number" ? entry.pid : 0,
      root: typeof entry.root === "string" ? entry.root : root,
      started_at: typeof entry.started_at === "string" ? entry.started_at : "",
    };
  } catch {
    return null;
  }
}

export function removeServerRegistry(root: string, pid: number): void {
  try {
    const entry = readServerRegistry(root);
    if (!entry || entry.pid !== pid) return;
    unlinkSync(serverRegistryFilePath(root));
  } catch {
    /* best-effort cleanup */
  }
}
