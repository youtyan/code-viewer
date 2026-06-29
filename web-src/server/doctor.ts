import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DoctorGroup,
  DoctorReport,
  DoctorRow,
  DoctorStatus,
} from "../core/doctor-types";
import {
  type SpawnTextResult,
  spawnTextAsync,
} from "./database/adapters/spawn-runner";
import {
  type DockerDiscoveryResult,
  discoverDockerDatabasesAsync,
  discoverSqliteFilesAsync,
} from "./database/discovery";
import {
  describeSqliteDriver,
  loadSqliteClass,
  type SqliteDriverStatus,
} from "./database/sqlite-driver";

export type {
  DoctorGroup,
  DoctorReport,
  DoctorRow,
  DoctorStatus,
} from "../core/doctor-types";

export type DoctorContext = {
  cwd: string;
  scopeOmitDirNames: readonly string[];
  listenPort: number;
  signal?: AbortSignal;
};

const SNAPSHOT_DB_REL = ".code-viewer/db-snapshots.sqlite";
const REQUIRED_NODE_MAJOR = 20;

const TTL = {
  version: 5 * 60_000,
  dockerInfo: 10_000,
  composeConfig: 60_000,
  composePs: 5_000,
  gitRepo: 30_000,
} as const;

const TIMEOUT = {
  version: 1_500,
  dockerInfo: 2_500,
  composeConfig: 3_500,
  composePs: 4_500,
  git: 1_500,
} as const;

type CacheEntry<T> = { value: T; expiresAt: number };

const versionCache = new Map<string, CacheEntry<SpawnTextResult | null>>();
const gitCache = new Map<string, CacheEntry<SpawnTextResult | null>>();
const dockerInfoCache = new Map<string, CacheEntry<SpawnTextResult | null>>();

// Non-printable separator: prevents argv-boundary collisions
// (e.g. ["a","bc"] vs ["ab","c"]) when composing the cache key.
const CACHE_KEY_SEP = "";
const composeConfigCache = new Map<
  string,
  CacheEntry<{ result: SpawnTextResult | null; services: string[] | null }>
>();
const composePsCache = new Map<
  string,
  CacheEntry<{
    result: SpawnTextResult | null;
    parsed: ComposePsRow[] | null;
  }>
>();

type ComposePsRow = {
  Service?: string;
  Name?: string;
  State?: string;
  Health?: string;
  ExitCode?: number;
};

let doctorGeneration = 0;

function statusWorse(a: DoctorStatus, b: DoctorStatus): DoctorStatus {
  const rank = { ok: 0, warn: 1, error: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

function computeWorst(groups: DoctorGroup[]): DoctorStatus {
  let worst: DoctorStatus = "ok";
  for (const group of groups) {
    for (const row of group.rows) worst = statusWorse(worst, row.status);
  }
  return worst;
}

async function runCached(
  cache: Map<string, CacheEntry<SpawnTextResult | null>>,
  ttl: number,
  command: string,
  args: string[],
  timeoutMs: number,
  signal: AbortSignal | undefined,
  cwd?: string,
): Promise<SpawnTextResult | null> {
  const key = [cwd || "", command, ...args].join(CACHE_KEY_SEP);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  let result: SpawnTextResult | null;
  try {
    result = await spawnTextAsync({
      command,
      args,
      ...(cwd ? { cwd } : {}),
      timeoutMs,
      signal,
      abortMessage: "doctor aborted",
      timeoutMessage: `${command} ${args.join(" ")} timed out after ${timeoutMs}ms`,
      rejectOnError: false,
    });
  } catch {
    result = null;
  }
  cache.set(key, { value: result, expiresAt: now + ttl });
  return result;
}

function firstLine(text: string | undefined): string {
  return (text || "").trim().split(/\r?\n/)[0] || "";
}

function checkRuntime(): DoctorGroup {
  const rows: DoctorRow[] = [];
  const node = process.versions.node || "unknown";
  const nodeMajor = Number.parseInt(node.split(".")[0] || "0", 10);
  const abi = process.versions.modules || "?";
  rows.push({
    id: "runtime.node",
    title: "Node.js",
    status: nodeMajor >= REQUIRED_NODE_MAJOR ? "ok" : "error",
    detail: `v${node} (NODE_MODULE_VERSION=${abi})`,
    ...(nodeMajor >= REQUIRED_NODE_MAJOR
      ? {}
      : {
          hint: `code-viewer requires Node.js >= ${REQUIRED_NODE_MAJOR}. Upgrade via nvm / volta / your package manager.`,
        }),
  });
  if (process.versions.bun) {
    rows.push({
      id: "runtime.bun",
      title: "Bun",
      status: "ok",
      detail: `v${process.versions.bun}`,
    });
  }
  rows.push({
    id: "runtime.platform",
    title: "Platform",
    status: "ok",
    detail: `${process.platform} / ${process.arch}`,
  });
  return { id: "runtime", title: "Runtime", rows };
}

function detectExecutionOrigin(): { kind: string; path: string } {
  const argv1 = process.argv[1] || "";
  if (!argv1) return { kind: "unknown", path: "" };
  if (/[\\/]_npx[\\/]/.test(argv1)) return { kind: "npx cache", path: argv1 };
  if (/[\\/]\.bun[\\/](install|bin)[\\/]/.test(argv1))
    return { kind: "bunx", path: argv1 };
  if (/[\\/]node_modules[\\/]\.bin[\\/]/.test(argv1))
    return { kind: "local node_modules", path: argv1 };
  if (
    /[\\/]npm[\\/]node_modules[\\/]/.test(argv1) ||
    /[\\/]\.npm[\\/]bin[\\/]/.test(argv1) ||
    /[\\/]npm-global[\\/]/.test(argv1)
  )
    return { kind: "global npm install", path: argv1 };
  return { kind: "unknown", path: argv1 };
}

function findCodeViewerPackageJson(): {
  version?: string;
  path?: string;
} {
  try {
    let cursor: string;
    try {
      cursor = dirname(fileURLToPath(import.meta.url));
    } catch {
      cursor = dirname(process.argv[1] || ".");
    }
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = join(cursor, "package.json");
      try {
        const raw = readFileSync(candidate, "utf8");
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.name === "@youtyan/code-viewer") {
          return { version: pkg.version, path: candidate };
        }
      } catch {
        // continue
      }
      const next = dirname(cursor);
      if (next === cursor) break;
      cursor = next;
    }
  } catch {
    // ignore
  }
  return {};
}

function checkPackageOrigin(): DoctorGroup {
  const rows: DoctorRow[] = [];
  const pkg = findCodeViewerPackageJson();
  rows.push({
    id: "package.version",
    title: "@youtyan/code-viewer version",
    status: "ok",
    detail: pkg.version
      ? `v${pkg.version}${pkg.path ? ` (${pkg.path})` : ""}`
      : "package.json not located (running from bundle?)",
  });
  const origin = detectExecutionOrigin();
  const isNpxCache = origin.kind === "npx cache";
  rows.push({
    id: "package.origin",
    title: "Execution origin",
    status: isNpxCache ? "warn" : "ok",
    detail: `${origin.kind}${origin.path ? ` — ${origin.path}` : ""}`,
    ...(isNpxCache
      ? {
          hint: 'Running from npx cache. After upgrading Node.js, clear the cache with `rm -rf ~/.npm/_npx` (macOS / Linux) or `Remove-Item -Recurse -Force "$(npm config get cache)\\_npx"` (Windows) and re-run `npx -y @youtyan/code-viewer@latest …`. Otherwise stale native binaries (e.g. better-sqlite3) may crash with NODE_MODULE_VERSION mismatch.',
        }
      : {}),
  });
  return { id: "package", title: "Package", rows };
}

export function sqliteStatusToRow(status: SqliteDriverStatus): DoctorRow {
  if (status.kind === "ok") {
    return {
      id: "sqlite.driver",
      title: `${status.driver} loaded`,
      status: "ok",
      detail:
        status.driver === "bun:sqlite"
          ? "Using built-in Bun SQLite"
          : "Using better-sqlite3 native binding",
    };
  }
  if (status.kind === "abi-mismatch") {
    return {
      id: "sqlite.driver",
      title: "better-sqlite3 ABI mismatch",
      status: "error",
      detail:
        `Native binary built for NODE_MODULE_VERSION=${status.compiledAbi}, ` +
        `but this Node.js requires ${status.runtimeAbi}.` +
        (status.modulePath ? ` Module: ${status.modulePath}` : ""),
      hint: status.hint,
    };
  }
  return {
    id: "sqlite.driver",
    title: "better-sqlite3 not available",
    status: "warn",
    detail: status.message,
    hint: status.hint,
  };
}

async function checkSqlite(cwd: string): Promise<DoctorGroup> {
  const status = await describeSqliteDriver();
  const rows: DoctorRow[] = [sqliteStatusToRow(status)];
  if (status.kind === "ok") {
    const open = await trySnapshotDbOpen(cwd);
    if (open.kind === "skipped") {
      rows.push({
        id: "sqlite.snapshot-open",
        title: "Snapshot DB open smoke test",
        status: "ok",
        detail: "Skipped (snapshot DB will be created on first use)",
      });
    } else if (open.kind === "ok") {
      rows.push({
        id: "sqlite.snapshot-open",
        title: "Snapshot DB open smoke test",
        status: "ok",
        detail: `Opened ${open.path}`,
      });
    } else {
      rows.push({
        id: "sqlite.snapshot-open",
        title: "Snapshot DB open failed",
        status: "error",
        detail: open.message,
        hint: "The snapshot DB exists but could not be opened. Inspect file permissions, possible corruption, or another process holding the file.",
      });
    }
  }
  return { id: "sqlite", title: "SQLite driver", rows };
}

async function trySnapshotDbOpen(
  cwd: string,
): Promise<
  | { kind: "ok"; path: string }
  | { kind: "error"; message: string }
  | { kind: "skipped" }
> {
  const dbPath = join(cwd, SNAPSHOT_DB_REL);
  try {
    statSync(dbPath);
  } catch {
    return { kind: "skipped" };
  }
  try {
    const DbClass = await loadSqliteClass<{ close(): void }>();
    const db = new DbClass(dbPath, { readonly: true });
    try {
      db.close();
    } catch {
      // ignore
    }
    return { kind: "ok", path: dbPath };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkSnapshotStore(cwd: string): DoctorGroup {
  const dbPath = join(cwd, SNAPSHOT_DB_REL);
  const dir = dirname(dbPath);
  let dirStatus: DoctorStatus = "ok";
  let dirDetail = dir;
  let dirHint: string | undefined;
  try {
    accessSync(dir, constants.W_OK);
    dirDetail = `${dir} (writable)`;
  } catch {
    try {
      statSync(dir);
      dirStatus = "error";
      dirDetail = `${dir} (not writable)`;
      dirHint =
        "Snapshot creation will fail until the directory is writable. " +
        "Check filesystem permissions on the .code-viewer directory.";
    } catch {
      dirDetail = `${dir} (will be created on first snapshot)`;
    }
  }
  let dbDetail = dbPath;
  try {
    const stat = statSync(dbPath);
    dbDetail = `${dbPath} (${stat.size.toLocaleString()} bytes)`;
  } catch {
    dbDetail = `${dbPath} (not created yet — created on first snapshot)`;
  }
  return {
    id: "snapshot",
    title: "Snapshot store",
    rows: [
      {
        id: "snapshot.dir",
        title: "Storage directory",
        status: dirStatus,
        detail: dirDetail,
        ...(dirHint ? { hint: dirHint } : {}),
      },
      {
        id: "snapshot.db",
        title: "Snapshot DB file",
        status: "ok",
        detail: dbDetail,
      },
    ],
  };
}

async function checkGit(
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<DoctorGroup> {
  const versionRes = await runCached(
    versionCache,
    TTL.version,
    "git",
    ["--version"],
    TIMEOUT.version,
    signal,
  );
  if (!versionRes || versionRes.code !== 0) {
    return {
      id: "git",
      title: "Git",
      rows: [
        {
          id: "git.binary",
          title: "git binary",
          status: "error",
          detail: "not found in PATH",
          hint: "git is required for diff, history, and blame features. Install git and ensure it is on PATH.",
        },
      ],
    };
  }
  const rows: DoctorRow[] = [
    {
      id: "git.binary",
      title: "git binary",
      status: "ok",
      detail: firstLine(versionRes.stdout),
    },
  ];
  const repoCheck = await runCached(
    gitCache,
    TTL.gitRepo,
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    TIMEOUT.git,
    signal,
    cwd,
  );
  if (repoCheck && repoCheck.code === 0 && /true/.test(repoCheck.stdout)) {
    const topRes = await runCached(
      gitCache,
      TTL.gitRepo,
      "git",
      ["rev-parse", "--show-toplevel"],
      TIMEOUT.git,
      signal,
      cwd,
    );
    const top = topRes?.stdout.trim() || cwd;
    const insideCwd = relative(top, cwd) || ".";
    rows.push({
      id: "git.repo",
      title: "Working tree",
      status: "ok",
      detail: `${top}${insideCwd && insideCwd !== "." ? ` (cwd is ${insideCwd})` : ""}`,
    });
  } else {
    rows.push({
      id: "git.repo",
      title: "Working tree",
      status: "warn",
      detail: `${cwd} is not inside a git work tree`,
      hint: "Diff, blame, and history features require running inside a git repository. `cd` into a repo or pass --cwd to a git work tree.",
    });
  }
  return { id: "git", title: "Git", rows };
}

type DockerCmd = { binary: string; subcommand: string[] };

async function detectComposeBinary(
  signal: AbortSignal | undefined,
): Promise<{ cmd: DockerCmd | null; v2Version?: string; v1Version?: string }> {
  const v2 = await runCached(
    versionCache,
    TTL.version,
    "docker",
    ["compose", "version", "--short"],
    TIMEOUT.version,
    signal,
  );
  if (v2 && v2.code === 0) {
    return {
      cmd: { binary: "docker", subcommand: ["compose"] },
      v2Version: firstLine(v2.stdout),
    };
  }
  const v1 = await runCached(
    versionCache,
    TTL.version,
    "docker-compose",
    ["version", "--short"],
    TIMEOUT.version,
    signal,
  );
  if (v1 && v1.code === 0) {
    return {
      cmd: { binary: "docker-compose", subcommand: [] },
      v1Version: firstLine(v1.stdout),
    };
  }
  return { cmd: null };
}

function parseComposePs(stdout: string): ComposePsRow[] | null {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    if (trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? (parsed as ComposePsRow[]) : null;
    }
    return trimmed
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ComposePsRow);
  } catch {
    return null;
  }
}

function summarizeDockerSources(discovery: DockerDiscoveryResult): {
  total: number;
  byComposeDir: Map<
    string,
    { compose: string; services: string[]; profiledServices: Set<string> }
  >;
  truncated: boolean;
} {
  const byComposeDir = new Map<
    string,
    { compose: string; services: string[]; profiledServices: Set<string> }
  >();
  for (const source of discovery) {
    const entry = byComposeDir.get(source.composeDir);
    if (entry) {
      entry.services.push(source.serviceName);
      if (source.profiled) entry.profiledServices.add(source.serviceName);
    } else {
      byComposeDir.set(source.composeDir, {
        compose: source.composeDir,
        services: [source.serviceName],
        profiledServices: new Set(source.profiled ? [source.serviceName] : []),
      });
    }
  }
  return {
    total: discovery.length,
    byComposeDir,
    truncated: discovery.truncated === true,
  };
}

async function checkDocker(
  signal: AbortSignal | undefined,
  discoveryResult: DockerDiscoveryResult,
): Promise<DoctorGroup> {
  const summary = summarizeDockerSources(discoveryResult);
  const dockerSourcesPresent = summary.total > 0;

  const rows: DoctorRow[] = [];

  const dockerVersion = await runCached(
    versionCache,
    TTL.version,
    "docker",
    ["--version"],
    TIMEOUT.version,
    signal,
  );
  const dockerOk = dockerVersion?.code === 0;
  rows.push({
    id: "docker.binary",
    title: "docker CLI",
    status: dockerOk ? "ok" : dockerSourcesPresent ? "error" : "warn",
    detail: dockerOk ? firstLine(dockerVersion.stdout) : "not found in PATH",
    ...(dockerOk
      ? {}
      : {
          hint: dockerSourcesPresent
            ? "Compose files reference Docker services that need the docker CLI. Install Docker Desktop or the docker engine."
            : "docker is optional unless this project uses Docker compose data sources.",
        }),
  });

  const compose = await detectComposeBinary(signal);
  if (compose.v2Version) {
    rows.push({
      id: "docker.compose-v2",
      title: "docker compose (v2 plugin)",
      status: "ok",
      detail: `v${compose.v2Version}`,
    });
  } else {
    rows.push({
      id: "docker.compose-v2",
      title: "docker compose (v2 plugin)",
      status: dockerSourcesPresent ? "error" : "warn",
      detail: "not available",
      hint: dockerSourcesPresent
        ? "Install the Docker Compose v2 plugin (bundled with Docker Desktop, or `apt-get install docker-compose-plugin` on Linux)."
        : "Compose v2 plugin is required only when this project uses Docker compose services.",
    });
  }

  if (compose.v1Version) {
    rows.push({
      id: "docker.compose-v1",
      title: "docker-compose (v1 standalone, legacy)",
      status: "warn",
      detail: `v${compose.v1Version}`,
      hint: "docker-compose v1 standalone is legacy. Prefer the Docker Compose v2 plugin (`docker compose ...`).",
    });
  }

  const dockerInfo = dockerOk
    ? await runCached(
        dockerInfoCache,
        TTL.dockerInfo,
        "docker",
        ["info", "--format", "{{.ServerVersion}}"],
        TIMEOUT.dockerInfo,
        signal,
      )
    : null;
  if (dockerOk) {
    if (dockerInfo && dockerInfo.code === 0) {
      rows.push({
        id: "docker.daemon",
        title: "docker daemon",
        status: "ok",
        detail: `Server v${firstLine(dockerInfo.stdout)}`,
      });
    } else {
      const stderr = firstLine(dockerInfo?.stderr || "");
      rows.push({
        id: "docker.daemon",
        title: "docker daemon",
        status: dockerSourcesPresent ? "error" : "warn",
        detail: stderr || "cannot connect to the Docker daemon",
        hint: "Start Docker Desktop (or `sudo systemctl start docker` on Linux), then re-run doctor.",
      });
    }
  }

  if (compose.cmd && dockerInfo?.code === 0) {
    for (const entry of summary.byComposeDir.values()) {
      const composeKey = entry.compose;
      const configRow = await checkComposeConfig(
        compose.cmd,
        composeKey,
        entry.services,
        entry.profiledServices,
        signal,
      );
      rows.push(configRow);
      const psRow = await checkComposePs(
        compose.cmd,
        composeKey,
        entry.services,
        signal,
      );
      rows.push(...psRow);
    }
  }

  return { id: "docker", title: "Docker / Compose", rows };
}

async function checkComposeConfig(
  cmd: DockerCmd,
  composeDir: string,
  discoveredServices: string[],
  profiledServices: Set<string>,
  signal: AbortSignal | undefined,
): Promise<DoctorRow> {
  const cacheKey = `${cmd.binary}|${composeDir}`;
  const now = Date.now();
  const cached = composeConfigCache.get(cacheKey);
  let result: SpawnTextResult | null;
  let services: string[] | null;
  if (cached && cached.expiresAt > now) {
    result = cached.value.result;
    services = cached.value.services;
  } else {
    const args = [...cmd.subcommand, "config", "--quiet"];
    try {
      result = await spawnTextAsync({
        command: cmd.binary,
        args,
        cwd: composeDir,
        timeoutMs: TIMEOUT.composeConfig,
        signal,
        abortMessage: "doctor aborted",
        timeoutMessage: `${cmd.binary} ${args.join(" ")} timed out`,
        rejectOnError: false,
      });
    } catch {
      result = null;
    }
    if (result && result.code === 0) {
      const servicesArgs = [...cmd.subcommand, "config", "--services"];
      try {
        const svcRes = await spawnTextAsync({
          command: cmd.binary,
          args: servicesArgs,
          cwd: composeDir,
          timeoutMs: TIMEOUT.composeConfig,
          signal,
          abortMessage: "doctor aborted",
          timeoutMessage: `${cmd.binary} ${servicesArgs.join(" ")} timed out`,
          rejectOnError: false,
        });
        services =
          svcRes.code === 0
            ? svcRes.stdout
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean)
            : null;
      } catch {
        services = null;
      }
    } else {
      services = null;
    }
    composeConfigCache.set(cacheKey, {
      value: { result, services },
      expiresAt: now + TTL.composeConfig,
    });
  }
  if (!result) {
    return {
      id: `docker.compose-config:${composeDir}`,
      title: `compose config — ${composeDir}`,
      status: "error",
      detail: "command failed to run",
    };
  }
  if (result.code !== 0) {
    return {
      id: `docker.compose-config:${composeDir}`,
      title: `compose config — ${composeDir}`,
      status: "error",
      detail: firstLine(result.stderr) || `exit code ${result.code}`,
      hint: "`docker compose config --quiet` failed. Fix YAML syntax / env interpolation errors before relying on this compose file.",
    };
  }
  if (services) {
    // profile-gated なサービスは未指定 profile では --services から外れるのが
    // 正常挙動なので missing に数えない (例: `profiles: [test]` の db-test)。
    const missing = discoveredServices.filter(
      (s) => !services?.includes(s) && !profiledServices.has(s),
    );
    const skippedProfiled = discoveredServices.filter(
      (s) => profiledServices.has(s) && !services?.includes(s),
    );
    if (missing.length === 0) {
      const summary = skippedProfiled.length
        ? `OK (${services.length} active, ${skippedProfiled.length} profile-gated)`
        : `OK (${services.length} services)`;
      return {
        id: `docker.compose-config:${composeDir}`,
        title: `compose config — ${composeDir}`,
        status: "ok",
        detail: summary,
      };
    }
    return {
      id: `docker.compose-config:${composeDir}`,
      title: `compose config — ${composeDir}`,
      status: "warn",
      detail: `discovered services not resolved by compose: ${missing.join(", ")}`,
      hint: "These services were found by scanning the compose file but `docker compose config --services` did not return them. They may be overridden by a sibling compose file. (profile-gated services with `profiles:` are intentionally ignored.)",
    };
  }
  return {
    id: `docker.compose-config:${composeDir}`,
    title: `compose config — ${composeDir}`,
    status: "ok",
    detail: "OK",
  };
}

async function checkComposePs(
  cmd: DockerCmd,
  composeDir: string,
  discoveredServices: string[],
  signal: AbortSignal | undefined,
): Promise<DoctorRow[]> {
  const cacheKey = `${cmd.binary}|ps|${composeDir}`;
  const now = Date.now();
  const cached = composePsCache.get(cacheKey);
  let result: SpawnTextResult | null;
  let parsed: ComposePsRow[] | null;
  if (cached && cached.expiresAt > now) {
    result = cached.value.result;
    parsed = cached.value.parsed;
  } else {
    const args = [...cmd.subcommand, "ps", "--all", "--format", "json"];
    try {
      result = await spawnTextAsync({
        command: cmd.binary,
        args,
        cwd: composeDir,
        timeoutMs: TIMEOUT.composePs,
        signal,
        abortMessage: "doctor aborted",
        timeoutMessage: `${cmd.binary} ${args.join(" ")} timed out`,
        rejectOnError: false,
      });
    } catch {
      result = null;
    }
    parsed = result && result.code === 0 ? parseComposePs(result.stdout) : null;
    composePsCache.set(cacheKey, {
      value: { result, parsed },
      expiresAt: now + TTL.composePs,
    });
  }
  if (!result || result.code !== 0) {
    return [
      {
        id: `docker.compose-ps:${composeDir}`,
        title: `compose ps — ${composeDir}`,
        status: "warn",
        detail:
          firstLine(result?.stderr || "") ||
          "could not query running containers",
        hint: "`docker compose ps` failed. The discovered services may still be valid; verify with `docker compose up -d`.",
      },
    ];
  }
  if (!parsed) {
    return [
      {
        id: `docker.compose-ps:${composeDir}`,
        title: `compose ps — ${composeDir}`,
        status: "warn",
        detail: "could not parse `docker compose ps --format json` output",
      },
    ];
  }
  const containers = new Map<string, ComposePsRow>();
  for (const row of parsed) {
    if (row.Service) containers.set(row.Service, row);
  }
  const rows: DoctorRow[] = [];
  for (const service of discoveredServices) {
    const row = containers.get(service);
    if (!row) {
      rows.push({
        id: `docker.compose-ps:${composeDir}:${service}`,
        title: `${service}`,
        status: "warn",
        detail: "container not created",
        hint: `Run \`docker compose up -d ${service}\` (in ${composeDir}) before using this data source.`,
      });
      continue;
    }
    const state = (row.State || "").toLowerCase();
    const health = (row.Health || "").toLowerCase();
    if (state === "running" && (!health || health === "healthy")) {
      rows.push({
        id: `docker.compose-ps:${composeDir}:${service}`,
        title: `${service}`,
        status: "ok",
        detail: `running${health === "healthy" ? " (healthy)" : ""}`,
      });
    } else if (state === "running" && health === "starting") {
      rows.push({
        id: `docker.compose-ps:${composeDir}:${service}`,
        title: `${service}`,
        status: "warn",
        detail: "running but health=starting",
      });
    } else if (state === "running" && health === "unhealthy") {
      rows.push({
        id: `docker.compose-ps:${composeDir}:${service}`,
        title: `${service}`,
        status: "error",
        detail: "running but health=unhealthy",
        hint: `Check container logs: \`docker compose logs ${service}\` (in ${composeDir}).`,
      });
    } else {
      rows.push({
        id: `docker.compose-ps:${composeDir}:${service}`,
        title: `${service}`,
        status: "error",
        detail: `state=${row.State || "unknown"}${row.Health ? ` health=${row.Health}` : ""}${typeof row.ExitCode === "number" ? ` exit=${row.ExitCode}` : ""}`,
        hint: `Container is not running. Start it with \`docker compose up -d ${service}\` (in ${composeDir}).`,
      });
    }
  }
  return rows;
}

async function checkDiscovery(
  cwd: string,
  scopeOmitDirNames: readonly string[],
  signal: AbortSignal | undefined,
): Promise<{ group: DoctorGroup; dockerResult: DockerDiscoveryResult }> {
  let dockerResult: DockerDiscoveryResult = [] as DockerDiscoveryResult;
  let dockerError: string | null = null;
  try {
    dockerResult = await discoverDockerDatabasesAsync(
      cwd,
      Array.from(scopeOmitDirNames),
      signal,
    );
  } catch (err) {
    dockerError = err instanceof Error ? err.message : String(err);
  }
  let sqliteCount = 0;
  let sqliteError: string | null = null;
  try {
    const result = await discoverSqliteFilesAsync(
      cwd,
      Array.from(scopeOmitDirNames),
      signal,
    );
    sqliteCount = result.length;
  } catch (err) {
    sqliteError = err instanceof Error ? err.message : String(err);
  }
  const rows: DoctorRow[] = [
    {
      id: "discovery.sqlite",
      title: "SQLite files",
      status: sqliteError ? "warn" : "ok",
      detail: sqliteError
        ? `discovery failed: ${sqliteError}`
        : `${sqliteCount} file(s) found`,
    },
    {
      id: "discovery.docker",
      title: "Docker compose services",
      status: dockerError ? "warn" : dockerResult.truncated ? "warn" : "ok",
      detail: dockerError
        ? `discovery failed: ${dockerError}`
        : dockerResult.truncated
          ? `${dockerResult.length} service(s) found (truncated by MAX_DOCKER_SERVICES — some may be hidden)`
          : `${dockerResult.length} service(s) found`,
      ...(dockerResult.truncated
        ? {
            hint: "Lower the number of compose services scanned, or extend the scope omit list (Viewer Settings) to skip irrelevant subtrees.",
          }
        : {}),
    },
  ];
  return {
    group: { id: "discovery", title: "Discovery", rows },
    dockerResult,
  };
}

function checkServer(listenPort: number): DoctorGroup {
  const rows: DoctorRow[] = [
    {
      id: "server.port",
      title: "Listening port",
      status: listenPort > 0 ? "ok" : "warn",
      detail:
        listenPort > 0
          ? `http://localhost:${listenPort}/`
          : "port not yet bound",
    },
  ];
  return { id: "server", title: "Server", rows };
}

export async function buildDoctorReport(
  ctx: DoctorContext,
): Promise<DoctorReport> {
  doctorGeneration += 1;
  const generation = doctorGeneration;
  const runtime = checkRuntime();
  const packageGroup = checkPackageOrigin();
  const sqlite = await checkSqlite(ctx.cwd);
  const snapshot = checkSnapshotStore(ctx.cwd);
  const git = await checkGit(ctx.cwd, ctx.signal);
  const discovery = await checkDiscovery(
    ctx.cwd,
    ctx.scopeOmitDirNames,
    ctx.signal,
  );
  const docker = await checkDocker(ctx.signal, discovery.dockerResult);
  const server = checkServer(ctx.listenPort);
  const groups: DoctorGroup[] = [
    runtime,
    packageGroup,
    sqlite,
    snapshot,
    git,
    discovery.group,
    docker,
    server,
  ];
  return { generation, groups, worstStatus: computeWorst(groups) };
}

export async function handleDoctor(ctx: DoctorContext): Promise<Response> {
  try {
    const report = await buildDoctorReport(ctx);
    return new Response(JSON.stringify(report), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
