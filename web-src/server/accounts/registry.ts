// アカウントの登録簿 (ユーザー単位の 1 ファイル) と、アカウントを足す・
// 外す操作。
//
// 変える外部状態と戻し方 (server.md「外部状態を変える機能」):
//
// - 登録簿 `<状態ディレクトリ>/accounts.json`。消せば既定のアカウントだけに
//   戻る (設定ディレクトリは消えない)
// - 「新しく作る」は `<状態ディレクトリ>/accounts/<種類>-<名前>/` を作り、
//   既定の設定ディレクトリの設定ファイルへのシンボリックリンクを置く
//   (SHARED_CONFIG_ENTRIES)。登録簿から外してもディレクトリは残す (中に
//   そのアカウントの認証と履歴があるため)。消すなら利用者が `rm -r` する
//
// 検出は doctor の agent-accounts グループ (server/doctor.ts)。
//
// 壊れた登録簿は上書きしない。読めない間は足す・外すを断り、理由を全部返す。

import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type AccountAgent,
  type AccountRegistry,
  type AddAccountInput,
  type AddAccountIssue,
  accountDirSlug,
  addAccount,
  type CreateAccountPlan,
  checkAddAccount,
  checkShareSelection,
  classifyShareEntry,
  claudeAuthKeys,
  codexAuthKeys,
  defaultConfigDir,
  emptyAccountRegistry,
  normalizeConfigDir,
  parseAccountRegistry,
  type RegisterAccountPlan,
  removeAccount,
  SHARED_CONFIG_ENTRIES,
  type ShareEntry,
  type ShareSelectionIssue,
  type StoredAccount,
} from "../../core/agent-accounts";
import { errorWithCause } from "../../core/error-detail";
import { resolvedFilePath, withFileLock } from "../file-lock";
import {
  cachedRegistryReader,
  type RegistryFileRead,
  readRegistryFile,
} from "../registry-file";
import { errno, writeFileAtomic } from "../terminal/settings-file";
import { codeViewerStateDir } from "../user-state-dir";

type Env = Record<string, string | undefined>;

export type AccountPaths = {
  home: string;
  stateDir: string;
  registry: string;
  /** 「新しく作る」の設定ディレクトリを置く場所。 */
  managedRoot: string;
  /** statusLine を包むスクリプトが使用量を保存する場所。 */
  usageDir: string;
};

export function accountPaths(
  env: Env = process.env,
  home: string = homedir(),
): AccountPaths {
  const stateDir = codeViewerStateDir(env, home);
  return {
    home,
    stateDir,
    registry: join(stateDir, "accounts.json"),
    managedRoot: join(stateDir, "accounts"),
    usageDir: join(stateDir, "agent-usage"),
  };
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid"
      | "conflict"
      | "not-found"
      | "builtin"
      | "unreadable"
      | "failed",
    options?: { cause?: unknown },
  ) {
    super(message);
    if (options && "cause" in options) {
      Object.assign(this, { cause: options.cause });
    }
  }
}

export type RegistryRead = RegistryFileRead<AccountRegistry>;

/** 読む。無ければ空。読めない・形が違えば ok: false と理由の全文。 */
export function readAccountRegistry(path: string): RegistryRead {
  return readRegistryFile(path, parseAccountRegistry, emptyAccountRegistry);
}

/** 一覧の取り直しのたびに読むので、変わっていなければ前回の結果を使う。 */
export const readAccountRegistryCached =
  cachedRegistryReader(readAccountRegistry);

function registryOrThrow(path: string): AccountRegistry {
  const read = readAccountRegistry(path);
  if (read.ok === false) {
    throw new AccountError(
      `the account registry cannot be read, so it was not changed.\n${read.error}`,
      "unreadable",
    );
  }
  return read.registry;
}

export function writeAccountRegistry(
  path: string,
  registry: AccountRegistry,
): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, `${JSON.stringify(registry, null, 2)}\n`, 0o600);
  } catch (error) {
    throw new AccountError(`failed to write ${path}`, "failed", {
      cause: error,
    });
  }
}

/** 読めることを確かめて、変えて、書く。 */
export async function updateAccountRegistry<T>(
  path: string,
  change: (registry: AccountRegistry) => {
    registry: AccountRegistry;
    result: T;
  },
): Promise<T> {
  const realPath = resolvedFilePath(path);
  return withFileLock(`${realPath}.lock`, () => {
    const { registry, result } = change(registryOrThrow(realPath));
    writeAccountRegistry(realPath, registry);
    return result;
  });
}

function addIssueMessage(issue: AddAccountIssue): string {
  switch (issue.code) {
    case "name":
      return `invalid account name (${issue.issue})`;
    case "relative-path":
      return `the settings directory must be an absolute path: ${issue.configDir}`;
    case "default-path":
      return `${issue.configDir} is the default account; it is always listed`;
    case "duplicate-path":
      return `${issue.configDir} is already registered as "${issue.existing}"`;
    case "too-many":
      return `at most ${issue.limit} accounts can be registered`;
  }
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (errno(error) === "ENOENT") return false;
    throw errorWithCause(`failed to check ${path}`, error);
  }
}

/** 共有する設定ファイルの中の、認証に関わるキーの名前 (値は読まない)。 */
function authKeysIn(agent: AccountAgent, defaultDir: string): string[] {
  const file = join(
    defaultDir,
    agent === "claude" ? "settings.json" : "config.toml",
  );
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (errno(error) === "ENOENT") return [];
    throw errorWithCause(`failed to read ${file}`, error);
  }
  if (agent === "codex") return codexAuthKeys(text);
  try {
    return claudeAuthKeys(JSON.parse(text));
  } catch (error) {
    throw errorWithCause(`${file} is not valid JSON`, error);
  }
}

/** 名前から作る場所を決める。既にあるなら -2, -3 … を付ける。 */
function freeManagedDir(
  paths: AccountPaths,
  agent: AccountAgent,
  name: string,
  registry: AccountRegistry,
): string {
  const base = join(paths.managedRoot, `${agent}-${accountDirSlug(name)}`);
  const taken = new Set(
    registry.accounts.map((account) => normalizeConfigDir(account.configDir)),
  );
  for (let n = 1; n <= 50; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(normalizeConfigDir(candidate)) && !exists(candidate)) {
      return candidate;
    }
  }
  throw new AccountError(`no free directory name next to ${base}`, "conflict");
}

export function planCreateAccount(
  paths: AccountPaths,
  agent: AccountAgent,
  name: string,
): CreateAccountPlan {
  const registry = registryOrThrow(paths.registry);
  const configDir = freeManagedDir(paths, agent, name, registry);
  const issue = checkAddAccount(
    registry,
    { agent, name, configDir, managed: true },
    paths.home,
  );
  if (issue) throw new AccountError(addIssueMessage(issue), "invalid");
  const defaultDir = defaultConfigDir(agent, paths.home);
  const entries = listShareEntries(agent, defaultDir);
  const present = new Set(entries.map((entry) => entry.name));
  return {
    agent,
    name: name.trim(),
    configDir,
    parent: paths.managedRoot,
    entries,
    missingShared: SHARED_CONFIG_ENTRIES[agent].filter(
      (entry) => !present.has(entry),
    ),
    authKeysInShared: authKeysIn(agent, defaultDir),
  };
}

/**
 * 既定の設定ディレクトリの直下にあるものを分類して並べる (中身は開かない。
 * 名前と、ディレクトリかどうかだけを見る)。既定のディレクトリが無ければ空。
 */
function listShareEntries(
  agent: AccountAgent,
  defaultDir: string,
): ShareEntry[] {
  let names: string[];
  try {
    names = readdirSync(defaultDir);
  } catch (error) {
    if (errno(error) === "ENOENT") return [];
    throw errorWithCause(`failed to list ${defaultDir}`, error);
  }
  const order: Record<ShareEntry["category"], number> = {
    shared: 0,
    optional: 1,
    blocked: 2,
  };
  return names
    .map((name) => {
      const target = join(defaultDir, name);
      let directory = false;
      try {
        directory = statSync(target).isDirectory();
      } catch (error) {
        // 壊れたリンクは「ファイル」として並べる (リンク先が無いだけ)。
        if (errno(error) !== "ENOENT") {
          throw errorWithCause(`failed to check ${target}`, error);
        }
      }
      return { name, target, directory, ...classifyShareEntry(agent, name) };
    })
    .sort(
      (a, b) =>
        order[a.category] - order[b.category] || a.name.localeCompare(b.name),
    );
}

function shareIssueMessage(issue: ShareSelectionIssue): string {
  if (issue.code === "blocked") {
    return `${issue.name} cannot be shared (${issue.reason})`;
  }
  if (issue.code === "duplicate") return `${issue.name} is listed twice`;
  return `${issue.name} is no longer in the default settings directory`;
}

/**
 * 確認の画面で見せた計画と、利用者が選んだ共有のとおりに作る。計画を
 * 作り直し、場所が変わっていれば作らない。選択は画面の検査に頼らず
 * ここで検査し、共有できないものを含むなら何も作らない。
 */
export async function applyCreateAccount(
  paths: AccountPaths,
  request: {
    agent: AccountAgent;
    name: string;
    configDir: string;
    share: readonly string[];
  },
  now: number = Date.now(),
): Promise<StoredAccount> {
  const plan = planCreateAccount(paths, request.agent, request.name);
  if (plan.configDir !== request.configDir) {
    throw new AccountError(
      "the settings directory changed after it was shown; nothing was created. Review it again.",
      "conflict",
    );
  }
  const issues = checkShareSelection(plan.entries, request.share);
  if (issues.length > 0) {
    const blocked = issues.some((issue) => issue.code !== "unknown");
    throw new AccountError(
      `nothing was created:\n${issues.map(shareIssueMessage).join("\n")}`,
      blocked ? "invalid" : "conflict",
    );
  }
  const targets = new Map(plan.entries.map((entry) => [entry.name, entry]));
  const made: string[] = [];
  try {
    mkdirSync(plan.parent, { recursive: true, mode: 0o700 });
    mkdirSync(plan.configDir, { mode: 0o700 });
    made.push(plan.configDir);
    for (const name of request.share) {
      const entry = targets.get(name);
      if (!entry) continue;
      const at = join(plan.configDir, name);
      symlinkSync(entry.target, at);
      made.push(at);
    }
  } catch (error) {
    throw new AccountError(
      `failed to create the settings directory; the account was not registered.${
        made.length > 0
          ? `\nAlready created (remove them to retry):\n${made.join("\n")}`
          : ""
      }`,
      "failed",
      { cause: error },
    );
  }
  try {
    return await updateAccountRegistry(paths.registry, (registry) => {
      const input: AddAccountInput = {
        agent: plan.agent,
        name: plan.name,
        configDir: plan.configDir,
        managed: true,
      };
      const issue = checkAddAccount(registry, input, paths.home);
      if (issue) throw new AccountError(addIssueMessage(issue), "conflict");
      const id = randomUUID();
      const next = addAccount(registry, input, id, now);
      const added = next.accounts.find((account) => account.id === id);
      if (!added) throw new Error(`account ${id} was not added`);
      return { registry: next, result: added };
    });
  } catch (error) {
    throw new AccountError(
      `created ${plan.configDir}, but could not register it. Use "Register an existing directory" with that path.`,
      error instanceof AccountError ? error.code : "failed",
      { cause: error },
    );
  }
}

export function planRegisterAccount(
  paths: AccountPaths,
  agent: AccountAgent,
  name: string,
  configDir: string,
): RegisterAccountPlan {
  const registry = registryOrThrow(paths.registry);
  const issue = checkAddAccount(
    registry,
    { agent, name, configDir, managed: false },
    paths.home,
  );
  if (issue) throw new AccountError(addIssueMessage(issue), "invalid");
  let isDirectory = false;
  let found = false;
  try {
    isDirectory = statSync(configDir).isDirectory();
    found = true;
  } catch (error) {
    if (errno(error) !== "ENOENT") {
      throw new AccountError(`cannot check ${configDir}`, "failed", {
        cause: error,
      });
    }
  }
  return {
    agent,
    name: name.trim(),
    configDir: normalizeConfigDir(configDir),
    exists: found,
    isDirectory,
  };
}

/** 既にあるディレクトリを登録する。中身には触らない。 */
export async function applyRegisterAccount(
  paths: AccountPaths,
  agent: AccountAgent,
  name: string,
  configDir: string,
  now: number = Date.now(),
): Promise<StoredAccount> {
  const plan = planRegisterAccount(paths, agent, name, configDir);
  if (!plan.exists || !plan.isDirectory) {
    throw new AccountError(
      `${plan.configDir} is not an existing directory`,
      "invalid",
    );
  }
  return updateAccountRegistry(paths.registry, (registry) => {
    const input: AddAccountInput = {
      agent,
      name,
      configDir: plan.configDir,
      managed: false,
    };
    const issue = checkAddAccount(registry, input, paths.home);
    if (issue) throw new AccountError(addIssueMessage(issue), "conflict");
    const id = randomUUID();
    const next = addAccount(registry, input, id, now);
    const added = next.accounts.find((account) => account.id === id);
    if (!added) throw new Error(`account ${id} was not added`);
    return { registry: next, result: added };
  });
}

/** 登録簿から外す。設定ディレクトリは消さない。 */
export async function applyRemoveAccount(
  paths: AccountPaths,
  id: string,
): Promise<StoredAccount> {
  return updateAccountRegistry(paths.registry, (registry) => {
    const result = removeAccount(registry, id);
    if (result.ok === false) {
      throw new AccountError(
        result.code === "builtin"
          ? "the default account cannot be removed"
          : `no account ${id}`,
        result.code,
      );
    }
    return { registry: result.registry, result: result.removed };
  });
}
