import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { accountEntries, emptyAccountRegistry } from "../core/agent-accounts";
import { AGENT_HOOK_MARKER, HOOK_AGENTS } from "../core/agent-hooks";
import type { DbFileInfo, DbFilesResponse } from "../core/database/types";
import type {
  DoctorGroup,
  DoctorReport,
  DoctorRow,
  DoctorStatus,
} from "../core/doctor-types";
import {
  errorWithCause,
  errorWithCauses,
  formatErrorDetail,
} from "../core/error-detail";
import {
  type AccountPaths,
  accountPaths,
  readAccountRegistry,
} from "./accounts/registry";
import { shellSingleQuote } from "./cli-helpers";
import {
  commandForExternal,
  commandRunFailure,
  type ExternalCommandName,
} from "./command-resolver";
import {
  openDockerAdapterAsync,
  openSupabaseDockerAdapterAsync,
} from "./database/adapters/docker";
import { openElasticsearchAdapterAsync } from "./database/adapters/elasticsearch";
import { openRedisExplorerAsync } from "./database/adapters/redis";
import { openS3ExplorerAsync } from "./database/adapters/s3";
import { spawnTextAsync } from "./database/adapters/spawn-runner";
import { sqliteAdapterFactory } from "./database/adapters/sqlite";
import {
  type DockerDiscoveryResult,
  discoverDockerDatabasesAsync,
  discoverSqliteFilesAsync,
  findDockerServiceByDbIdAsync,
  findSupabaseCliProjectByDbIdAsync,
  parseDockerDbId,
  parseSupabaseDbId,
  validateDbPath,
} from "./database/discovery";
import { createDbFilesResponse } from "./database/handle";
import {
  describeSqliteDriver,
  loadSqliteClass,
  type SqliteDriverStatus,
} from "./database/sqlite-driver";
import { worktreeListResultAsync } from "./git";
import { projectRegistryPath, readProjectRegistry } from "./projects/registry";
import type { RunResult } from "./runtime";
import {
  describeShellAvailability,
  type ShellAvailability,
} from "./shell/session";
import {
  type AgentHookTarget,
  agentHookStatus,
  currentHookLauncher,
  defaultAgentConfigDir,
  type HookLauncher,
  launcherHealth,
} from "./terminal/hooks";
import { errno } from "./terminal/settings-file";
import {
  STATUSLINE_MARKER,
  statusLineStatus,
  statusLineWrapperPath,
} from "./terminal/statusline";
import { tmuxArgs } from "./tmux/command";
import { readUserSettings, userSettingsPath } from "./user-settings";
import {
  mapWithConcurrency,
  serverWorktreeRoot,
  WORKTREE_LIST_CONCURRENCY,
} from "./worktree/list";
import { runningServerResult } from "./worktree/open";

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

const versionCache = new Map<string, CacheEntry<RunResult>>();
const gitCache = new Map<string, CacheEntry<RunResult>>();
const dockerInfoCache = new Map<string, CacheEntry<RunResult>>();

// Non-printable separator: prevents argv-boundary collisions
// (e.g. ["a","bc"] vs ["ab","c"]) when composing the cache key.
//
// 生の制御文字をソースに直接置くと、見た目が空文字と区別できず、消えていても
// 気付けない。必ず String.fromCharCode の形で書く。
const CACHE_KEY_SEP = String.fromCharCode(1);
const composeConfigCache = new Map<
  string,
  CacheEntry<{ result: RunResult; services: RunResult | null }>
>();
const composePsCache = new Map<string, CacheEntry<RunResult>>();

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
  cache: Map<string, CacheEntry<RunResult>>,
  ttl: number,
  command: string,
  args: string[],
  timeoutMs: number,
  signal: AbortSignal | undefined,
  cwd?: string,
): Promise<RunResult> {
  const key = [cwd || "", command, ...args].join(CACHE_KEY_SEP);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  // 起動の失敗は rejectOnError: false で結果 (code と stderr) になる。投げるのは
  // 中断とプログラムの誤りだけなので、行にせず上へ投げる (null を覚えない)。
  const result = await spawnTextAsync({
    command,
    args,
    ...(cwd ? { cwd } : {}),
    timeoutMs,
    signal,
    abortMessage: "doctor aborted",
    timeoutMessage: `${command} ${args.join(" ")} timed out after ${timeoutMs}ms`,
    rejectOnError: false,
  });
  cache.set(key, { value: result, expiresAt: now + ttl });
  return result;
}

function firstLine(text: string | undefined): string {
  return (text || "").trim().split(/\r?\n/)[0] || "";
}

function commandVersionFailureDetail(
  command: ExternalCommandName,
  args: string[],
  result: RunResult,
): string {
  return [
    commandRunFailure(command, result)?.detail ??
      `${command} ${args.join(" ")} exited with ${result.code}`,
    result.stderr.trim() ? `stderr: ${result.stderr.trim()}` : "",
    result.stdout.trim() ? `stdout: ${result.stdout.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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

function moduleDirectory(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch (error) {
    // file: でない読み込み方 (data: など) のときだけ、起動した script の場所から探す。
    if (errno(error) !== "ERR_INVALID_URL_SCHEME") throw error;
    return dirname(process.argv[1] || ".");
  }
}

export function findCodeViewerPackageJson(start = moduleDirectory()): {
  version?: string;
  path?: string;
  failures: string[];
} {
  const failures: string[] = [];
  let cursor = start;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(cursor, "package.json");
    try {
      const raw = readFileSync(candidate, "utf8");
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      if (pkg.name === "@youtyan/code-viewer") {
        return { version: pkg.version, path: candidate, failures };
      }
    } catch (error) {
      // package.json の無い階層は上へ探し続ける。読めない・壊れたものは理由を残す。
      if (errno(error) !== "ENOENT") {
        failures.push(`${candidate}: ${formatErrorDetail(error)}`);
      }
    }
    const next = dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }
  return { failures };
}

function checkPackageOrigin(): DoctorGroup {
  const rows: DoctorRow[] = [];
  const pkg = findCodeViewerPackageJson();
  rows.push({
    id: "package.version",
    title: "@youtyan/code-viewer version",
    status: pkg.failures.length > 0 ? "warn" : "ok",
    detail: [
      pkg.version
        ? `v${pkg.version}${pkg.path ? ` (${pkg.path})` : ""}`
        : "package.json not located (running from bundle?)",
      ...pkg.failures,
    ].join("\n"),
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
      detail: "Using better-sqlite3 native binding",
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
  } catch (err) {
    // まだ作られていない DB だけは試さずに済ませる。ほかの理由は失敗として出す。
    if (errno(err) === "ENOENT") return { kind: "skipped" };
    return { kind: "error", message: formatErrorDetail(err) };
  }
  try {
    const DbClass = await loadSqliteClass<{ close(): void }>();
    new DbClass(dbPath, { readonly: true }).close();
    return { kind: "ok", path: dbPath };
  } catch (err) {
    return { kind: "error", message: formatErrorDetail(err) };
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
  } catch (error) {
    // まだ無いフォルダは最初の snapshot で作る。ほかの理由は理由ごと出す。
    if (errno(error) === "ENOENT") {
      dirDetail = `${dir} (will be created on first snapshot)`;
    } else {
      dirStatus = "error";
      dirDetail = `${dir} (not writable)\n${formatErrorDetail(error)}`;
      dirHint =
        "Snapshot creation will fail until the directory is writable. " +
        "Check filesystem permissions on the .code-viewer directory.";
    }
  }
  let dbStatus: DoctorStatus = "ok";
  let dbDetail: string;
  try {
    const stat = statSync(dbPath);
    dbDetail = `${dbPath} (${stat.size.toLocaleString()} bytes)`;
  } catch (error) {
    // まだ無い DB は最初の snapshot で作る。ほかの理由は理由ごと出す。
    if (errno(error) === "ENOENT") {
      dbDetail = `${dbPath} (not created yet — created on first snapshot)`;
    } else {
      dbStatus = "error";
      dbDetail = `${dbPath}\n${formatErrorDetail(error)}`;
    }
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
        status: dbStatus,
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
    commandForExternal("git"),
    ["--version"],
    TIMEOUT.version,
    signal,
  );
  if (versionRes.code !== 0) {
    return {
      id: "git",
      title: "Git",
      rows: [
        {
          id: "git.binary",
          title: "git binary",
          status: "error",
          detail: commandVersionFailureDetail("git", ["--version"], versionRes),
          hint: "git is required for diff, history, and blame features. Install git, add its directory to PATH, or pass --bin git=/absolute/path.",
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
  const repoArgs = ["rev-parse", "--is-inside-work-tree"];
  const repoCheck = await runCached(
    gitCache,
    TTL.gitRepo,
    commandForExternal("git"),
    repoArgs,
    TIMEOUT.git,
    signal,
    cwd,
  );
  const topArgs = ["rev-parse", "--show-toplevel"];
  const topRes =
    repoCheck.code === 0 && /true/.test(repoCheck.stdout)
      ? await runCached(
          gitCache,
          TTL.gitRepo,
          commandForExternal("git"),
          topArgs,
          TIMEOUT.git,
          signal,
          cwd,
        )
      : null;
  if (topRes?.code === 0) {
    const top = topRes.stdout.trim();
    const insideCwd = relative(top, cwd) || ".";
    rows.push({
      id: "git.repo",
      title: "Working tree",
      status: "ok",
      detail: `${top}${insideCwd && insideCwd !== "." ? ` (cwd is ${insideCwd})` : ""}`,
    });
  } else {
    // git が答えなかった理由 (所有者の違う作業ツリー・壊れた .git など) を
    // 「作業ツリーの外」と同じ 1 文に潰さない。
    const failed = topRes ?? (repoCheck.code !== 0 ? repoCheck : null);
    rows.push({
      id: "git.repo",
      title: "Working tree",
      status: "warn",
      detail: `${cwd} is not inside a git work tree${
        failed
          ? `\n${commandVersionFailureDetail("git", failed === topRes ? topArgs : repoArgs, failed)}`
          : ""
      }`,
      hint: "Diff, blame, and history features require running inside a git repository. `cd` into a repo or pass --cwd to a git work tree.",
    });
  }
  return { id: "git", title: "Git", rows };
}

async function checkSearchTools(
  signal: AbortSignal | undefined,
): Promise<DoctorGroup> {
  const args = ["--version"];
  const versionRes = await runCached(
    versionCache,
    TTL.version,
    commandForExternal("rg"),
    args,
    TIMEOUT.version,
    signal,
  );
  const available = versionRes.code === 0;
  return {
    id: "search",
    title: "Search",
    rows: [
      {
        id: "search.rg",
        title: "rg binary",
        status: available ? "ok" : "warn",
        detail: available
          ? firstLine(versionRes.stdout)
          : commandVersionFailureDetail("rg", args, versionRes),
        ...(available
          ? {}
          : {
              hint: "Fast repository search and regular-expression search require rg. Install ripgrep, add its directory to PATH, or pass --bin rg=/absolute/path. Fixed-string search can use the built-in fallback.",
            }),
      },
    ],
  };
}

async function checkGithubCli(
  signal: AbortSignal | undefined,
): Promise<DoctorGroup> {
  const versionRes = await runCached(
    versionCache,
    TTL.version,
    commandForExternal("gh"),
    ["--version"],
    TIMEOUT.version,
    signal,
  );
  if (versionRes.code !== 0) {
    return {
      id: "github",
      title: "GitHub CLI",
      rows: [
        {
          id: "github.gh",
          title: "gh binary",
          status: "warn",
          detail: commandVersionFailureDetail("gh", ["--version"], versionRes),
          hint: "GitHub issue listing and issue-to-task linking require gh. Install GitHub CLI or pass --bin gh=/absolute/path.",
        },
      ],
    };
  }
  return {
    id: "github",
    title: "GitHub CLI",
    rows: [
      {
        id: "github.gh",
        title: "gh binary",
        status: "ok",
        detail: firstLine(versionRes.stdout),
      },
    ],
  };
}

export function shellAvailabilityToRow(
  availability: ShellAvailability,
): DoctorRow {
  if (availability.available) {
    return {
      id: "terminal.node-pty",
      title: "@lydell/node-pty",
      status: "ok",
      detail: "available",
    };
  }
  return {
    id: "terminal.node-pty",
    title: "@lydell/node-pty",
    status: "warn",
    detail: availability.reason,
    hint: "Browser terminal shells require this optional dependency. Reinstall code-viewer with optional dependencies enabled and review any native-module installation error.",
  };
}

async function checkTerminalTools(
  signal: AbortSignal | undefined,
): Promise<DoctorGroup> {
  const tmuxCommand = tmuxArgs(["-V"]);
  const [tmuxVersion, shellAvailability] = await Promise.all([
    runCached(
      versionCache,
      TTL.version,
      tmuxCommand[0],
      tmuxCommand.slice(1),
      TIMEOUT.version,
      signal,
    ),
    describeShellAvailability(),
  ]);
  const tmuxAvailable = tmuxVersion.code === 0;
  return {
    id: "terminal",
    title: "Terminal",
    rows: [
      {
        id: "terminal.tmux",
        title: "tmux binary",
        status: tmuxAvailable ? "ok" : "warn",
        detail: tmuxAvailable
          ? firstLine(tmuxVersion.stdout)
          : commandVersionFailureDetail("tmux", ["-V"], tmuxVersion),
        ...(tmuxAvailable
          ? {}
          : {
              hint: "tmux is optional; browser terminal shells still work without it. To use the tmux session tree, install tmux, add its directory to PATH, or pass --bin tmux=/absolute/path.",
            }),
      },
      shellAvailabilityToRow(shellAvailability),
    ],
  };
}

/**
 * 設定画面の「エージェント連携」で入れたフック (terminal/hooks.ts)。
 * エージェントの設定ファイルと状態ディレクトリに残るものなので、機能を
 * 消しても最低 1 リリースはこの検出を残す (server.md)。読むだけで書かない。
 */
export function checkAgentHooks(
  targets: AgentHookTarget[] = HOOK_AGENTS.map((agent) => ({
    agent,
    configDir: defaultAgentConfigDir(agent),
  })),
  launcher: HookLauncher = currentHookLauncher(),
): DoctorGroup {
  const removeHint = (path: string) =>
    `To remove: Settings > Agent integration > Remove, or delete the hooks whose command contains "${AGENT_HOOK_MARKER}" from ${path}. Earlier content is kept next to it as ${basename(path)}.code-viewer-backup-*.`;
  const rows: DoctorRow[] = targets.map((target) => {
    const status = agentHookStatus(target, launcher);
    const problem =
      status.state === "partial" ||
      status.state === "broken" ||
      status.state === "unreadable";
    return {
      id: `agent-hooks.${target.agent}`,
      title: `${target.agent} state hooks`,
      status: problem ? "warn" : "ok",
      detail: `${status.state}: ${status.path}${status.detail ? `\n${status.detail}` : ""}`,
      ...(status.state === "none" || status.state === "no-config-dir"
        ? {}
        : { hint: removeHint(status.path) }),
    };
  });
  const health = launcherHealth(launcher);
  rows.push({
    id: "agent-hooks.launcher",
    title: "Agent hook launcher",
    status:
      health.state === "target-missing" || health.state === "unreadable"
        ? "warn"
        : "ok",
    detail: `${health.state}: ${health.path}${health.detail ? `\n${health.detail}` : ""}`,
    ...(health.state === "missing"
      ? {}
      : {
          hint: `Written by Settings > Agent integration. Safe to delete once no agent settings file names it; "Repair" rewrites it.`,
        }),
  });
  return { id: "agent-hooks", title: "Agent hooks", rows };
}

/**
 * アカウントの登録簿と、claude の statusLine を包んだもの
 * (accounts/registry.ts・terminal/statusline.ts)。ユーザーの状態ディレクトリと
 * エージェントの設定ファイルに残るので、機能を消しても最低 1 リリースは
 * この検出を残す (server.md)。読むだけで書かない。
 */
export function checkAgentAccounts(
  paths: AccountPaths = accountPaths(),
): DoctorGroup {
  const read = readAccountRegistry(paths.registry);
  const rows: DoctorRow[] = [];
  if (read.ok === false) {
    rows.push({
      id: "agent-accounts.registry",
      title: "Account registry",
      status: "warn",
      detail: read.error,
      hint: `code-viewer does not overwrite it. Fix or move ${paths.registry}; without it only the default accounts are listed.`,
    });
  } else {
    const managed = read.registry.accounts.filter((account) => account.managed);
    rows.push({
      id: "agent-accounts.registry",
      title: "Account registry",
      status: "ok",
      detail: `${read.registry.accounts.length} registered: ${paths.registry}`,
      ...(read.registry.accounts.length === 0
        ? {}
        : {
            hint: `Remove entries from Settings > Accounts, or delete ${paths.registry}. Settings directories are kept${
              managed.length > 0
                ? `; the ones code-viewer created are under ${paths.managedRoot} (they hold that account's login and history, delete them with rm -r only if you no longer need it)`
                : ""
            }.`,
          }),
    });
  }
  const accounts = accountEntries(
    read.ok ? read.registry : emptyAccountRegistry(),
    paths.home,
    { claude: "default", codex: "default" },
  ).filter((account) => account.agent === "claude");
  for (const account of accounts) {
    const status = statusLineStatus(account.configDir, paths.usageDir);
    const ours = status.state === "wrapped" || status.state === "added";
    if (!ours && status.state !== "unreadable") continue;
    rows.push({
      id: `agent-accounts.statusline.${account.id}`,
      title: `claude statusLine (${account.name})`,
      status:
        status.state === "unreadable" || status.wrapperMissing ? "warn" : "ok",
      detail: `${status.state}: ${status.path}${status.detail ? `\n${status.detail}` : ""}${
        status.wrapperMissing
          ? `\nthe wrapper is missing: ${statusLineWrapperPath(paths.usageDir)}`
          : ""
      }`,
      hint: `To restore: Settings > Accounts > Usage > Remove, or set statusLine.command in ${status.path} back to the quoted command after "${STATUSLINE_MARKER}" (remove statusLine if nothing follows it). Earlier content is kept next to it as settings.json.code-viewer-backup-*.`,
    });
  }
  return { id: "agent-accounts", title: "Agent accounts", rows };
}

/**
 * プロジェクトの登録簿と、全プロジェクト共通の設定 (projects/registry.ts・
 * user-settings.ts)。どちらもユーザーの状態ディレクトリに残るので、機能を
 * 消しても最低 1 リリースはこの検出を残す (server.md)。読むだけで書かない。
 */
export function checkProjects(
  registryPath: string = projectRegistryPath(),
  settingsPath: string = userSettingsPath(),
): DoctorGroup {
  const rows: DoctorRow[] = [];
  const read = readProjectRegistry(registryPath);
  rows.push(
    read.ok === false
      ? {
          id: "projects.registry",
          title: "Project registry",
          status: "warn",
          detail: read.error,
          hint: `code-viewer does not overwrite it. Fix or move ${registryPath}; until then no project is registered.`,
        }
      : {
          id: "projects.registry",
          title: "Project registry",
          status: "ok",
          detail: `${read.registry.projects.length} registered: ${registryPath}`,
          ...(read.registry.projects.length === 0
            ? {}
            : {
                hint: `Remove entries from the Agents list (⋯ > Remove from projects), or delete ${registryPath}. Repositories are never touched.`,
              }),
        },
  );
  let settingsRow: DoctorRow;
  try {
    const settings = readUserSettings(settingsPath);
    settingsRow = {
      id: "projects.user-settings",
      title: "Settings shared by all projects",
      status: "ok",
      detail: settings ? settingsPath : `not created yet: ${settingsPath}`,
      ...(settings
        ? {
            hint: `Delete ${settingsPath} to take them over again from the next repository you open. Repository settings (.code-viewer/settings.json) are not changed by it.`,
          }
        : {}),
    };
  } catch (error) {
    settingsRow = {
      id: "projects.user-settings",
      title: "Settings shared by all projects",
      status: "warn",
      detail: formatErrorDetail(error),
      hint: `code-viewer does not overwrite it and shows each repository's own settings meanwhile. Fix or delete ${settingsPath}.`,
    };
  }
  rows.push(settingsRow);
  return { id: "projects", title: "Projects", rows };
}

type DockerCmd = { binary: string; subcommand: string[] };

async function detectComposeBinary(signal: AbortSignal | undefined): Promise<{
  cmd: DockerCmd | null;
  v2Version?: string;
  v2Failure?: string;
  v1Version?: string;
}> {
  const v2Args = ["compose", "version", "--short"];
  const v2 = await runCached(
    versionCache,
    TTL.version,
    commandForExternal("docker"),
    v2Args,
    TIMEOUT.version,
    signal,
  );
  if (v2.code === 0) {
    return {
      cmd: { binary: commandForExternal("docker"), subcommand: ["compose"] },
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
  const v2Failure = commandVersionFailureDetail("docker", v2Args, v2);
  if (v1.code === 0) {
    return {
      cmd: { binary: "docker-compose", subcommand: [] },
      v1Version: firstLine(v1.stdout),
      v2Failure,
    };
  }
  return { cmd: null, v2Failure };
}

function parseComposePs(stdout: string): ComposePsRow[] | { error: string } {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    if (trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed)
        ? (parsed as ComposePsRow[])
        : { error: `expected a JSON array, got ${typeof parsed}` };
    }
    return trimmed
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ComposePsRow);
  } catch (error) {
    return { error: formatErrorDetail(error) };
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
    commandForExternal("docker"),
    ["--version"],
    TIMEOUT.version,
    signal,
  );
  const dockerOk = dockerVersion.code === 0;
  rows.push({
    id: "docker.binary",
    title: "docker CLI",
    status: dockerOk ? "ok" : dockerSourcesPresent ? "error" : "warn",
    detail: dockerOk
      ? firstLine(dockerVersion.stdout)
      : commandVersionFailureDetail("docker", ["--version"], dockerVersion),
    ...(dockerOk
      ? {}
      : {
          hint: dockerSourcesPresent
            ? "Compose files reference Docker services that need the docker CLI. Install Docker Desktop or the docker engine, add docker to PATH, or pass --bin docker=/absolute/path."
            : "docker is optional unless this project uses Docker compose data sources. If it is installed outside PATH, pass --bin docker=/absolute/path.",
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
      detail: `not available\n${compose.v2Failure}`,
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
        commandForExternal("docker"),
        ["info", "--format", "{{.ServerVersion}}"],
        TIMEOUT.dockerInfo,
        signal,
      )
    : null;
  if (dockerInfo) {
    if (dockerInfo.code === 0) {
      rows.push({
        id: "docker.daemon",
        title: "docker daemon",
        status: "ok",
        detail: `Server v${firstLine(dockerInfo.stdout)}`,
      });
    } else {
      rows.push({
        id: "docker.daemon",
        title: "docker daemon",
        status: dockerSourcesPresent ? "error" : "warn",
        detail:
          dockerInfo.stderr.trim() ||
          `docker info exited with ${dockerInfo.code}`,
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
  const compose = (args: string[]) =>
    spawnTextAsync({
      command: cmd.binary,
      args: [...cmd.subcommand, ...args],
      cwd: composeDir,
      timeoutMs: TIMEOUT.composeConfig,
      signal,
      abortMessage: "doctor aborted",
      timeoutMessage: `${cmd.binary} ${[...cmd.subcommand, ...args].join(" ")} timed out`,
      rejectOnError: false,
    });
  let result: RunResult;
  let listed: RunResult | null;
  if (cached && cached.expiresAt > now) {
    result = cached.value.result;
    listed = cached.value.services;
  } else {
    result = await compose(["config", "--quiet"]);
    listed = result.code === 0 ? await compose(["config", "--services"]) : null;
    composeConfigCache.set(cacheKey, {
      value: { result, services: listed },
      expiresAt: now + TTL.composeConfig,
    });
  }
  if (result.code !== 0) {
    return {
      id: `docker.compose-config:${composeDir}`,
      title: `compose config — ${composeDir}`,
      status: "error",
      detail: result.stderr.trim() || `exit code ${result.code}`,
      hint: "`docker compose config --quiet` failed. Fix YAML syntax / env interpolation errors before relying on this compose file.",
    };
  }
  if (listed && listed.code !== 0) {
    return {
      id: `docker.compose-config:${composeDir}`,
      title: `compose config — ${composeDir}`,
      status: "warn",
      detail: `\`docker compose config --services\` failed: ${listed.stderr.trim() || `exit code ${listed.code}`}`,
    };
  }
  const services = listed?.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
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
  let result: RunResult;
  if (cached && cached.expiresAt > now) {
    result = cached.value;
  } else {
    const args = [...cmd.subcommand, "ps", "--all", "--format", "json"];
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
    composePsCache.set(cacheKey, {
      value: result,
      expiresAt: now + TTL.composePs,
    });
  }
  if (result.code !== 0) {
    return [
      {
        id: `docker.compose-ps:${composeDir}`,
        title: `compose ps — ${composeDir}`,
        status: "warn",
        detail: result.stderr.trim() || `exit code ${result.code}`,
        hint: "`docker compose ps` failed. The discovered services may still be valid; verify with `docker compose up -d`.",
      },
    ];
  }
  const parsed = parseComposePs(result.stdout);
  if (!Array.isArray(parsed)) {
    return [
      {
        id: `docker.compose-ps:${composeDir}`,
        title: `compose ps — ${composeDir}`,
        status: "warn",
        detail: `could not parse \`docker compose ps --format json\` output: ${parsed.error}`,
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
    dockerError = formatErrorDetail(err);
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
    sqliteError = formatErrorDetail(err);
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

// --- Datastore connectivity probe -----------------------------------------
//
// Each discovered source (sqlite / docker SQL / redis / es / s3) gets a
// minimal read round-trip with a 2s timeout. Result becomes one DoctorRow
// in the `datastore` group. Failure rows include a paste-safe retry hint
// (SQL: `code-viewer query schemas --db '<id>' --json` without --server,
// since doctor does not know the server URL — the CLI's auto-discovery
// resolves it at paste time; Redis/ES/S3: cheapest read-only CLI command).
//
// `deps` is injectable so the test suite can swap `listSources` and
// `probeSource` for fakes without requiring Docker / SQLite at test time.

const DEFAULT_DATASTORE_PROBE_TIMEOUT_MS = 2000;

export type DatastoreProbe = (
  file: DbFileInfo,
  cwd: string,
  signal: AbortSignal,
) => Promise<void>;

export type DatastoreConnectivityDeps = {
  listSources: (
    cwd: string,
    omitDirNames: readonly string[],
    signal?: AbortSignal,
  ) => Promise<DbFilesResponse>;
  probeSource: DatastoreProbe;
  timeoutMs: number;
};

export const DEFAULT_DATASTORE_CONNECTIVITY_DEPS: DatastoreConnectivityDeps = {
  listSources: (cwd, omitDirNames, signal) =>
    createDbFilesResponse(cwd, [...omitDirNames], signal),
  probeSource: defaultDatastoreProbe,
  timeoutMs: DEFAULT_DATASTORE_PROBE_TIMEOUT_MS,
};

async function defaultDatastoreProbe(
  file: DbFileInfo,
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  // Supabase CLI ソースも kind は "postgresql" (docker: 系と同じ) だが、
  // id prefix で見分けて別経路 (docker compose ps を使わない) に振る。
  if (file.id.startsWith("supabase:")) {
    return probeSupabaseSource(file, cwd, signal);
  }
  switch (file.kind) {
    case "sqlite":
      return probeSqliteSource(file, cwd, signal);
    case "postgresql":
    case "mysql":
      return probeDockerSqlSource(file, cwd, signal);
    case "redis":
      return probeRedisSource(file, cwd, signal);
    case "elasticsearch":
      return probeEsSource(file, cwd, signal);
    case "s3":
      return probeS3Source(file, cwd, signal);
  }
}

// 最小の読み取りの後に閉じる。閉じる失敗も probe の失敗として出す (読み取りも
// 失敗していたら、両方を並べる)。
export async function readThenClose(
  resource: { close(): void },
  read: () => Promise<unknown>,
  signal: AbortSignal,
): Promise<void> {
  let readFailure: { error: unknown } | null = null;
  try {
    signal.throwIfAborted();
    await read();
  } catch (error) {
    readFailure = { error };
  }
  try {
    resource.close();
  } catch (closeError) {
    throw readFailure
      ? errorWithCauses("the probe failed, and closing it also failed", [
          readFailure.error,
          closeError,
        ])
      : errorWithCause("closing after the probe failed", closeError);
  }
  if (readFailure) throw readFailure.error;
}

async function probeSqliteSource(
  file: DbFileInfo,
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  const resolved = validateDbPath(cwd, file.path);
  if (!resolved) throw new Error("path validation failed");
  signal.throwIfAborted();
  const adapter = await sqliteAdapterFactory.open(resolved);
  await readThenClose(adapter, () => adapter.getTablesAsync(signal), signal);
}

async function probeDockerSqlSource(
  file: DbFileInfo,
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  if (file.kind !== "postgresql" && file.kind !== "mysql") {
    throw new Error(`unexpected kind for docker SQL probe: ${file.kind}`);
  }
  const parsed = parseDockerDbId(file.id);
  if (!parsed) throw new Error("invalid docker db id");
  const info = await findDockerServiceByDbIdAsync(
    cwd,
    file.id,
    file.kind,
    undefined,
    signal,
  );
  if (!info) throw new Error("docker service not found");
  const database = parsed.database ?? info.database;
  const adapter = await openDockerAdapterAsync(
    info.serviceName,
    file.kind,
    info.env,
    info.composeDir,
    database,
    undefined,
    signal,
  );
  await readThenClose(adapter, () => adapter.getTablesAsync(signal), signal);
}

async function probeSupabaseSource(
  file: DbFileInfo,
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  const parsed = parseSupabaseDbId(file.id);
  if (!parsed) throw new Error("invalid supabase db id");
  const info = await findSupabaseCliProjectByDbIdAsync(
    cwd,
    file.id,
    undefined,
    signal,
  );
  if (!info) throw new Error("supabase project not found");
  const adapter = await openSupabaseDockerAdapterAsync(
    info.projectId,
    undefined,
    signal,
  );
  await readThenClose(adapter, () => adapter.getTablesAsync(signal), signal);
}

async function probeRedisSource(
  file: DbFileInfo,
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  const info = await findDockerServiceByDbIdAsync(
    cwd,
    file.id,
    "redis",
    undefined,
    signal,
  );
  if (!info) throw new Error("docker service not found");
  const explorer = await openRedisExplorerAsync(
    info.serviceName,
    info.env,
    info.composeDir,
    signal,
  );
  await readThenClose(
    explorer,
    () => explorer.listDatabasesAsync(signal),
    signal,
  );
}

// ai-dup-check: allow -- fp: probeRedisSource と同型の
// 「find + open + close」pre-existing プローブ実装。対象アダプタが違うので
// 共通化しない。今回の変更とは無関係。
async function probeEsSource(
  file: DbFileInfo,
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  const info = await findDockerServiceByDbIdAsync(
    cwd,
    file.id,
    "elasticsearch",
    undefined,
    signal,
  );
  if (!info) throw new Error("docker service not found");
  const explorer = await openElasticsearchAdapterAsync(
    info.serviceName,
    info.env,
    info.composeDir,
    signal,
  );
  await readThenClose(
    explorer,
    () => explorer.listIndicesAsync(signal),
    signal,
  );
}

async function probeS3Source(
  file: DbFileInfo,
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  const info = await findDockerServiceByDbIdAsync(
    cwd,
    file.id,
    "s3",
    undefined,
    signal,
  );
  if (!info) throw new Error("docker service not found");
  const explorer = await openS3ExplorerAsync(info, signal);
  await readThenClose(explorer, () => explorer.listBuckets(signal), signal);
}

type ProbeOutcome =
  | { kind: "ok" }
  | { kind: "fail"; reason: string; timedOut: boolean };

// Promise.race + child AbortController. The child signal is wired both to
// the parent (so parent cancellation propagates) and to the timeout (so the
// probe observes abort and tears down its open connection). Even if the
// underlying adapter ignores signal.abort (e.g. a blocking native call),
// race returns the timeout result and we move on; the orphan probe's
// finally still runs its close() best-effort.
async function runProbeWithTimeout(
  probe: DatastoreProbe,
  file: DbFileInfo,
  cwd: string,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
): Promise<ProbeOutcome> {
  if (parentSignal?.aborted) {
    return { kind: "fail", reason: "parent aborted", timedOut: false };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let parentAbortListener: (() => void) | null = null;
  if (parentSignal) {
    parentAbortListener = () => controller.abort();
    parentSignal.addEventListener("abort", parentAbortListener);
  }
  const probePromise: Promise<ProbeOutcome> = probe(
    file,
    cwd,
    controller.signal,
  ).then(
    () => ({ kind: "ok" }) as const,
    (err) =>
      ({
        kind: "fail",
        reason: formatErrorDetail(err),
        timedOut: false,
      }) as const,
  );
  const timeoutPromise = new Promise<ProbeOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({
        kind: "fail",
        reason: `timed out after ${timeoutMs}ms`,
        timedOut: true,
      });
    }, timeoutMs);
  });
  try {
    return await Promise.race([probePromise, timeoutPromise]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (parentAbortListener && parentSignal) {
      parentSignal.removeEventListener("abort", parentAbortListener);
    }
  }
}

// SQL sources get a paste-safe retry CLI line — without --server, since
// doctor cannot know the running server URL (the discovery group reports
// what is on disk, not what is listening). The query CLI's
// auto-discovery resolves --server at paste time.
// Redis / Elasticsearch / S3 also have read-only CLI surfaces now, so we
// point at the cheapest "is the connection alive?" introspect command for
// each kind instead of pushing the user back to the browser tab.
export function buildDatastoreRetryHint(file: DbFileInfo): string {
  const quoted = shellSingleQuote(file.id);
  if (file.kind === "redis") {
    return `Retry with: code-viewer query redis databases --db ${quoted} --json`;
  }
  if (file.kind === "elasticsearch") {
    return `Retry with: code-viewer query elasticsearch indices --db ${quoted} --json`;
  }
  if (file.kind === "s3") {
    return `Retry with: code-viewer query s3 buckets --db ${quoted} --json`;
  }
  return `Retry with: code-viewer query schemas --db ${quoted} --json`;
}

export async function checkDatastoreConnectivity(
  cwd: string,
  omitDirNames: readonly string[],
  signal: AbortSignal | undefined,
  deps: DatastoreConnectivityDeps = DEFAULT_DATASTORE_CONNECTIVITY_DEPS,
): Promise<DoctorGroup> {
  let files: DbFileInfo[];
  try {
    const response = await deps.listSources(cwd, omitDirNames, signal);
    files = response.files;
  } catch (err) {
    const reason = formatErrorDetail(err);
    return {
      id: "datastore",
      title: "Datastore connectivity",
      rows: [
        {
          id: "datastore.discovery",
          title: "Source discovery",
          status: "warn",
          detail: `source discovery failed: ${reason}`,
        },
      ],
    };
  }
  if (files.length === 0) {
    return {
      id: "datastore",
      title: "Datastore connectivity",
      rows: [
        {
          id: "datastore.none",
          title: "No discovered sources",
          status: "ok",
          detail:
            "no datastore sources to probe (no SQLite files and no docker compose datastores discovered)",
        },
      ],
    };
  }
  const results = await Promise.all(
    files.map(async (file) => {
      const outcome = await runProbeWithTimeout(
        deps.probeSource,
        file,
        cwd,
        deps.timeoutMs,
        signal,
      );
      return { file, outcome };
    }),
  );
  const rows: DoctorRow[] = results.map(({ file, outcome }) => {
    if (outcome.kind === "ok") {
      return {
        id: `datastore.${file.id}`,
        title: `${file.kind}:${file.id}`,
        status: "ok",
        detail: `connect + minimal read succeeded (${file.kind})`,
      };
    }
    return {
      id: `datastore.${file.id}`,
      title: `${file.kind}:${file.id}`,
      status: "warn",
      detail: `probe failed: ${outcome.reason}`,
      hint: buildDatastoreRetryHint(file),
    };
  });
  return { id: "datastore", title: "Datastore connectivity", rows };
}

/**
 * この 2 行目は worktree 画面の「開く」が残す状態の検出。
 *
 * 「開く」は別の作業ツリーで code-viewer をもう 1 本起こし、そのプロセスは
 * このサーバが終わっても生き残る。コードから機能を消しても、ユーザーの環境で
 * 動いているプロセスは消えないので、この行は機能より長く残す
 * (server.md「外部状態を変える機能には、戻す経路と検出を付ける」)。
 */
export async function checkServer(
  listenPort: number,
  cwd: string,
  signal?: AbortSignal,
): Promise<DoctorGroup> {
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
    await entryServerRow(),
  ];
  const root = serverWorktreeRoot(cwd);
  const listed = await worktreeListResultAsync(root, {
    timeout: TIMEOUT.git,
    signal,
  });
  if (listed.error) {
    rows.push({
      id: "server.worktrees",
      title: "Worktree servers",
      status: "warn",
      detail: `could not list worktrees: ${listed.error}`,
    });
    return { id: "server", title: "Server", rows };
  }
  const checked = await mapWithConcurrency(
    listed.worktrees.filter((entry) => entry.path !== root),
    WORKTREE_LIST_CONCURRENCY,
    async (entry) => ({
      path: entry.path,
      server: await runningServerResult(entry.path, {
        signal,
        timeoutMs: TIMEOUT.git,
      }),
    }),
  );
  const running = checked.flatMap((entry) =>
    entry.server.status === "running"
      ? [{ path: entry.path, url: entry.server.url }]
      : [],
  );
  const serverErrors = checked.flatMap((entry) =>
    entry.server.status === "invalid" || entry.server.status === "unreachable"
      ? [`${entry.path}: ${formatErrorDetail(entry.server.error)}`]
      : [],
  );
  rows.push({
    id: "server.worktrees",
    title: "Worktree servers",
    status: serverErrors.length ? "warn" : "ok",
    detail: [
      ...(running.length
        ? running.map((entry) => `${entry.url} ${entry.path}`)
        : ["no other code-viewer is running for this repository's worktrees"]),
      ...serverErrors,
    ].join("\n"),
    ...(running.length
      ? {
          hint: "stop one with `kill <pid>`; the pid is in ~/.cache/code-viewer/servers/",
        }
      : {}),
  });
  return { id: "server", title: "Server", rows };
}

/**
 * 動いている入口のサーバ (`code-viewer` が 1 つだけ起こす、全プロジェクトの
 * 窓口)。版の違う入口が居ると新しい `code-viewer` は起動しないので、その
 * 原因と止め方をここにも出す。判定は起動と同じ findRunningEntry を使う。
 */
async function entryServerRow(): Promise<DoctorRow> {
  const { findRunningEntry } = await import("./entry/server");
  const running = await findRunningEntry();
  const base = { id: "server.entry", title: "Entry server" } as const;
  if (running.status === "none") {
    return {
      ...base,
      status: "ok",
      detail: "not running (`code-viewer` starts it)",
    };
  }
  if (running.status === "broken") {
    return {
      ...base,
      status: "error",
      detail: running.detail,
      hint: "`code-viewer` does not start until this is resolved. The record is entry.json in code-viewer's state directory.",
    };
  }
  const version = findCodeViewerPackageJson().version;
  const detail = `${running.url} (pid ${running.pid}, v${running.version})`;
  if (version && running.version !== version) {
    return {
      ...base,
      status: "warn",
      detail,
      hint: `This is v${version}; \`code-viewer\` does not start while an entry server of another version runs. Stop it (Ctrl+C where it was started, or kill ${running.pid}), then run code-viewer again.`,
    };
  }
  return { ...base, status: "ok", detail };
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
  const search = await checkSearchTools(ctx.signal);
  const github = await checkGithubCli(ctx.signal);
  const discovery = await checkDiscovery(
    ctx.cwd,
    ctx.scopeOmitDirNames,
    ctx.signal,
  );
  const docker = await checkDocker(ctx.signal, discovery.dockerResult);
  // datastore probe re-uses createDbFilesResponse, so it runs its own
  // discovery underneath. It is placed between discovery and docker in the
  // output so AI/human reads "discover -> connect -> compose health" in a
  // natural top-down order. Additive: existing 8 groups stay untouched.
  const datastore = await checkDatastoreConnectivity(
    ctx.cwd,
    ctx.scopeOmitDirNames,
    ctx.signal,
  );
  const terminal = await checkTerminalTools(ctx.signal);
  const server = await checkServer(ctx.listenPort, ctx.cwd, ctx.signal);
  const agentHooks = checkAgentHooks();
  const agentAccounts = checkAgentAccounts();
  const projects = checkProjects();
  const groups: DoctorGroup[] = [
    runtime,
    packageGroup,
    sqlite,
    snapshot,
    git,
    search,
    github,
    discovery.group,
    datastore,
    docker,
    terminal,
    agentHooks,
    agentAccounts,
    projects,
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
    console.error("[code-viewer] the doctor report could not be built:", err);
    return new Response(JSON.stringify({ error: formatErrorDetail(err) }), {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
