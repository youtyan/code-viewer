// アカウントの一覧 (/_agent/accounts) と、エージェント一覧の各行の
// アカウント判定をまとめる。サーバのプロセスで 1 つ持つ (ログインの状態と
// プロセス調査の結果を覚えておくため)。

import { statSync } from "node:fs";
import {
  ACCOUNT_ENV,
  type AccountEntry,
  type AccountRegistry,
  type AccountStatus,
  type AccountsResponse,
  accountEntries,
  accountForEnv,
  defaultConfigDir,
  emptyAccountRegistry,
  isAccountAgent,
  type PaneAccount,
} from "../../core/agent-accounts";
import type { LauncherHealth } from "../../core/agent-hooks";
import { formatErrorDetail } from "../../core/error-detail";
import {
  agentHookStatus,
  currentHookLauncher,
  type HookLauncher,
  launcherHealth,
} from "../terminal/hooks";
import { errno } from "../terminal/settings-file";
import {
  readStatusLineFailures,
  statusLineStatus,
} from "../terminal/statusline";
import { createLoginChecker, type LoginChecker } from "./login";
import {
  createProcessEnvProber,
  type ProbeTarget,
  type ProcessEnvProber,
} from "./process-env";
import {
  type AccountPaths,
  accountPaths,
  readAccountRegistryCached,
} from "./registry";
import { readAccountUsage } from "./usage";

const DEFAULT_COMMANDS = { claude: "claude", codex: "codex" } as const;

export type PaneAccountTarget = ProbeTarget & { kind: string | null };

export type AccountService = {
  paths: AccountPaths;
  /** 登録簿 (読めなければ既定だけ) と、読めなかった理由。 */
  entries(): { entries: AccountEntry[]; registryError: string | null };
  overview(options: {
    forceLogin?: boolean;
    serverRoot: string;
  }): Promise<AccountsResponse>;
  /** 種類ごとの起動コマンド (設定されていなければ種類の名前)。 */
  launchCommands(): AccountsResponse["launchCommands"];
  paneAccounts(
    targets: readonly PaneAccountTarget[],
  ): Promise<Map<string, PaneAccount>>;
  prober: ProcessEnvProber;
  login: LoginChecker;
};

/** 設定ディレクトリがあるか。無い (ENOENT) 以外で調べられなければ理由を返す。 */
function configDirState(path: string): { exists: boolean; error: string } {
  try {
    if (statSync(path).isDirectory()) return { exists: true, error: "" };
    return { exists: false, error: `${path} is not a directory` };
  } catch (error) {
    if (errno(error) === "ENOENT") return { exists: false, error: "" };
    return {
      exists: false,
      error: `cannot check ${path}: ${formatErrorDetail(error)}`,
    };
  }
}

function launchCommandsOf(
  registry: AccountRegistry,
): AccountsResponse["launchCommands"] {
  return {
    claude: registry.launchCommands.claude ?? DEFAULT_COMMANDS.claude,
    codex: registry.launchCommands.codex ?? DEFAULT_COMMANDS.codex,
  };
}

export function createAccountService(
  paths: AccountPaths = accountPaths(),
  prober: ProcessEnvProber = createProcessEnvProber(),
  login: LoginChecker = createLoginChecker(),
): AccountService {
  function entries() {
    const read = readAccountRegistryCached(paths.registry);
    const registry = read.ok ? read.registry : emptyAccountRegistry();
    return {
      entries: accountEntries(registry, paths.home, { claude: "", codex: "" }),
      registryError: read.ok === false ? read.error : null,
      registry,
    };
  }

  async function status(
    entry: AccountEntry,
    command: string,
    forceLogin: boolean,
    launcher: { launcher: HookLauncher; health: LauncherHealth },
  ): Promise<AccountStatus> {
    const dir = configDirState(entry.configDir);
    const exists = dir.exists;
    // 失敗 (起動スクリプトが調べられない等) はそのまま投げる。一覧の応答が
    // 500 になり、理由の全文が画面に出る。
    const hooks = agentHookStatus(
      { agent: entry.agent, configDir: entry.configDir },
      launcher.launcher,
      launcher.health,
    ).state;
    const statusLine =
      entry.agent === "claude"
        ? statusLineStatus(entry.configDir, paths.usageDir)
        : null;
    const wrapped =
      statusLine?.state === "wrapped" || statusLine?.state === "added";
    const usage = readAccountUsage(entry.agent, entry.configDir, {
      usageDir: paths.usageDir,
      claudeEnvValues: entry.builtin
        ? ["", defaultConfigDir("claude", paths.home)]
        : [entry.configDir],
      wrapped,
    });
    const loginState = exists
      ? await login.status(entry, command, forceLogin)
      : {
          state: dir.error ? ("unknown" as const) : ("no-config-dir" as const),
          who: "",
          method: "",
          detail: dir.error || entry.configDir,
          checkedAt: Date.now(),
        };
    return { ...entry, exists, login: loginState, usage, hooks, statusLine };
  }

  return {
    paths,
    prober,
    login,
    entries() {
      const { entries: list, registryError } = entries();
      return { entries: list, registryError };
    },
    launchCommands() {
      return launchCommandsOf(entries().registry);
    },
    async overview(options) {
      const { entries: list, registryError, registry } = entries();
      const hookLauncher = currentHookLauncher();
      const launcher = {
        launcher: hookLauncher,
        health: launcherHealth(hookLauncher),
      };
      const accounts = await Promise.all(
        list.map((entry) =>
          status(
            entry,
            launchCommandsOf(registry)[entry.agent],
            options.forceLogin === true,
            launcher,
          ),
        ),
      );
      let usageFailures: AccountsResponse["usageFailures"];
      try {
        usageFailures = readStatusLineFailures(paths.usageDir);
      } catch (error) {
        usageFailures = {
          total: 1,
          recent: [`cannot read the failure log: ${formatErrorDetail(error)}`],
          log: paths.usageDir,
        };
      }
      return {
        home: paths.home,
        serverRoot: options.serverRoot,
        accounts,
        registryError,
        registryPath: paths.registry,
        launchCommands: launchCommandsOf(registry),
        lastLaunch: registry.lastLaunch,
        usageFailures,
      };
    },
    async paneAccounts(targets) {
      const agents = targets.filter((target) => isAccountAgent(target.kind));
      const out = new Map<string, PaneAccount>();
      if (agents.length === 0) return out;
      const probed = await prober.probe(agents);
      const { entries: list, registryError } = entries();
      for (const target of agents) {
        const agent = target.kind as "claude" | "codex";
        const result = probed.get(target.id);
        if (!result || result.status === "error") {
          out.set(target.id, {
            kind: "unknown",
            reason: result?.status === "error" ? result.reason : "not probed",
          });
          continue;
        }
        const value = result.env[ACCOUNT_ENV[agent]];
        const account = accountForEnv(agent, value, list, paths.home);
        // 登録簿が読めない間は、既定以外を「未登録」と言い切れない。
        if (account.kind === "unregistered" && registryError) {
          out.set(target.id, {
            kind: "unknown",
            reason: `the account registry cannot be read: ${registryError}`,
          });
          continue;
        }
        out.set(target.id, account);
      }
      return out;
    },
  };
}

let shared: AccountService | null = null;

/** サーバのプロセスで 1 つ。 */
export function sharedAccountService(): AccountService {
  shared ??= createAccountService();
  return shared;
}
