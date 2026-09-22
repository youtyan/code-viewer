import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readdir, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { errorWithCause } from "../core/error-detail";
import { type FileLock, processAlive, tryAcquireFileLock } from "./file-lock";

export type ServerRegistryEntry = {
  url: string;
  pid: number;
  root: string;
  started_at: string;
  /**
   * code-viewer が起こしたサーバ (作業ツリーやプロジェクトを開いたとき)。
   * 利用者が自分で起動したサーバには無い。一覧から止めてよいかの判定に使う。
   */
  launched?: boolean;
  /**
   * 入口のサーバが起こしたプロジェクトの裏のプロセス (`--backend`)。巡回も
   * フックの受け口も持たないので、フックの申告と「読んだ」の中継の送り先から
   * 外す。入口はこれを見て、生きている裏を拾い直す。
   */
  backend?: boolean;
};

export type ServerStartLock = FileLock;

const SERVER_START_LOCK_STALE_MS = 30_000;

export function registryDir(): string {
  // Test-only override; keeps registry tests from writing to the user's cache.
  const override = process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
  if (override) return override;
  return join(homedir(), ".cache", "code-viewer", "servers");
}

/** リポジトリのルートごとのファイル名に使う短いハッシュ。 */
export function rootFileKey(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 16);
}

export function serverRegistryFilePath(root: string): string {
  return join(registryDir(), `${rootFileKey(root)}.json`);
}

function serverStartLockFilePath(root: string): string {
  return join(registryDir(), `${rootFileKey(root)}.start.lock`);
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
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
  return tryAcquireFileLock(serverStartLockFilePath(root), {
    staleMs: SERVER_START_LOCK_STALE_MS,
    now,
  });
}

export function writeServerRegistry(entry: ServerRegistryEntry): void {
  mkdirSync(registryDir(), { recursive: true });
  writeFileSync(
    serverRegistryFilePath(entry.root),
    `${JSON.stringify(entry, null, 2)}\n`,
    "utf8",
  );
}

function parseServerRegistryEntry(
  raw: unknown,
  label: string,
): ServerRegistryEntry {
  if (!raw || typeof raw !== "object") {
    throw new Error(`invalid server registry for ${label}: expected an object`);
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
      `invalid server registry for ${label}: missing required fields`,
    );
  }
  for (const flag of ["launched", "backend"] as const) {
    if (entry[flag] !== undefined && typeof entry[flag] !== "boolean") {
      throw new Error(
        `invalid server registry for ${label}: ${flag} is not a boolean`,
      );
    }
  }
  return {
    url: entry.url,
    pid: entry.pid as number,
    root: entry.root,
    started_at: entry.started_at,
    ...(entry.launched === true ? { launched: true } : {}),
    ...(entry.backend === true ? { backend: true } : {}),
  };
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
  return parseServerRegistryEntry(raw, root);
}

export type ServerRegistryListing = {
  /** 登録されていて、プロセスが生きているサーバ。 */
  servers: ServerRegistryEntry[];
  /** 読めなかった登録。1 つ読めなくても残りは返す。 */
  errors: { file: string; error: unknown }[];
};

/**
 * 動いている全部のサーバ。エージェントのフックは、どのリポジトリの
 * サーバが自分のペインを見ているかを知らないので、全部に知らせる。
 * プロセスが既に居ない登録 (落ちたサーバの残り) は飛ばす。
 */
export function listServerRegistry(): ServerRegistryListing {
  const dir = registryDir();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (errno(error) === "ENOENT") return { servers: [], errors: [] };
    throw errorWithCause(`failed to list server registry ${dir}`, error);
  }
  const servers: ServerRegistryEntry[] = [];
  const errors: ServerRegistryListing["errors"] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const file = join(dir, name);
    try {
      const entry = parseServerRegistryEntry(
        JSON.parse(readFileSync(file, "utf8")),
        file,
      );
      if (processAlive(entry.pid)) servers.push(entry);
    } catch (error) {
      // 読んでいる間に消えた登録 (サーバの終了) は失敗ではない。
      if (errno(error) === "ENOENT") continue;
      errors.push({ file, error });
    }
  }
  return { servers, errors };
}

export type ServerRegistryPruneResult = {
  /** プロセスが居ないと確かめて消した登録。 */
  removed: string[];
  /** 残した登録の数 (プロセスが居るもの)。 */
  kept: number;
  /** 読めない・消せなかった登録。消していない。 */
  errors: { file: string; error: unknown }[];
};

/**
 * 落ちたサーバの登録を片付ける。
 *
 * 登録が消えるのは、サーバが自分で終わるとき (shutdown と、作業ツリーの
 * サーバを止めたとき) だけ。強制終了や落ちたサーバの登録は残り続け、
 * フックが呼ばれるたびの全件の読み込みが遅くなる。起動したサーバが
 * ここを呼んで片付ける。
 *
 * 消すのは「その pid のプロセスが存在しない」(ESRCH) と確かめられた登録
 * だけ。pid が別のプロセスに使い回されて生きて見える登録、読めない登録は
 * 残す (読めないのは書いている途中かもしれない)。消す直前に読み直し、
 * pid が変わっていたら (同じリポジトリのサーバが起動し直した) 消さない。
 */
export async function pruneDeadServerRegistry(): Promise<ServerRegistryPruneResult> {
  const dir = registryDir();
  const result: ServerRegistryPruneResult = {
    removed: [],
    kept: 0,
    errors: [],
  };
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (errno(error) === "ENOENT") return result;
    result.errors.push({ file: dir, error });
    return result;
  }
  const readPid = async (file: string): Promise<number> =>
    parseServerRegistryEntry(JSON.parse(await readFile(file, "utf8")), file)
      .pid;
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const file = join(dir, name);
    try {
      const pid = await readPid(file);
      if (processAlive(pid)) {
        result.kept += 1;
        continue;
      }
      if ((await readPid(file)) !== pid) {
        result.kept += 1;
        continue;
      }
      await unlink(file);
      result.removed.push(file);
    } catch (error) {
      // 読んでいる間に消えた (そのサーバが自分で片付けた) のは失敗ではない。
      if (errno(error) === "ENOENT") continue;
      result.errors.push({ file, error });
    }
  }
  return result;
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
