// `code-viewer accounts` — claude / codex のアカウントを CLI から登録し、
// ログインを始める。設定の Accounts の画面と同じ入口 (/_agent/accounts・
// /_agent/accounts/login) を叩くだけで、規則 (共有してよいもの・名前・
// 設定ディレクトリの重なり) はサーバが持つ。
//
// ログインの承認はブラウザで利用者が行う。この CLI は公式のログインの
// コマンドを tmux のウィンドウで起こし、状態を訊き直すだけで、認証情報には
// 触れない。
//
// 構成は terminal-cli と同じ「parse して run」。

import {
  type AccountAgent,
  type AccountStatus,
  type AccountsResponse,
  type CreateAccountPlan,
  defaultShareSelection,
  isAccountAgent,
  type StoredAccount,
} from "../core/agent-accounts";
import { HOOK_AGENTS } from "../core/agent-hooks";
import type { LaunchedPane } from "./accounts/launch";
import {
  ensureAgentServerUrl,
  requestJson,
  resolveRepoRoot,
  takeGlobalCliOption,
  takeValue,
} from "./cli-helpers";

/** サーバ探索に使う疎通先。読み取り専用。 */
const HEALTH_PATH = "/_agent/states";
/** wait がログイン状態を訊き直す間隔。 */
const WAIT_INTERVAL_MS = 3_000;
const DEFAULT_WAIT_SECONDS = 600;

export type AccountsCommand =
  | { mode: "help" }
  | { mode: "agent-help" }
  | { mode: "list"; json: boolean; refresh: boolean }
  | { mode: "plan"; agent: AccountAgent; name: string; json: boolean }
  | {
      mode: "create";
      agent: AccountAgent;
      name: string;
      share: string[];
      json: boolean;
    }
  | {
      mode: "register";
      agent: AccountAgent;
      name: string;
      configDir: string;
      json: boolean;
    }
  | { mode: "rename"; account: string; name: string; json: boolean }
  | { mode: "remove"; account: string; json: boolean }
  | { mode: "login"; account: string; json: boolean }
  | { mode: "wait"; account: string; timeoutSeconds: number; json: boolean };

export type AccountsArgs = {
  command: AccountsCommand;
  cwd: string | undefined;
  server: string | undefined;
};

export type AccountsParseResult =
  | { ok: true; args: AccountsArgs }
  | { ok: false; error: string };

export const ACCOUNTS_HELP = `code-viewer accounts — add, sign in, rename and remove claude / codex accounts

Usage:
  code-viewer accounts list [--refresh] [--json]
  code-viewer accounts plan --agent <agent> --name <name> [--json]
  code-viewer accounts create --agent <agent> --name <name> [--share <entry>]... [--json]
  code-viewer accounts register --agent <agent> --name <name> --config-dir <dir> [--json]
  code-viewer accounts login --account <id> [--json]
  code-viewer accounts wait --account <id> [--timeout <seconds>] [--json]
  code-viewer accounts rename --account <id> --name <name> [--json]
  code-viewer accounts remove --account <id> [--json]

Commands:
  list      Every account with its sign-in state and who it is signed in as.
  plan      What create would make: the new settings directory and which
            entries of the default settings directory it would link.
  create    Make a new settings directory under code-viewer's state directory
            and register it. The entries the official documentation calls
            user settings are linked from the default account; add others
            with --share.
  register  Register a settings directory that already exists.
  login     Open the official sign-in command for the account in a new tmux
            window. The human approves it in the browser.
  wait      Ask the account's sign-in state again every few seconds until it
            is signed in. Exits 1 when --timeout passes first.
  rename    Change the display name. The agent and the settings directory
            cannot change; remove and register again for that.
  remove    Take the account off the list. Its settings directory (sign-in,
            history) is left as it is, and running agents keep running.

Options:
  --agent <agent>     ${HOOK_AGENTS.join(" | ")}
  --name <name>       Display name. Use one no other account of the agent has.
  --share <entry>     Also link this entry of the default settings directory
                      (only entries plan lists as optional). Repeatable.
  --config-dir <dir>  Existing settings directory (register only).
  --account <id>      Account id from list or create. The default accounts
                      (claude:default, codex:default) cannot be renamed or
                      removed.
  --timeout <seconds> How long wait waits. Default ${DEFAULT_WAIT_SECONDS}.
  --refresh           Ask every CLI for its sign-in state again (list only).
  --json              Machine-readable output.
  --cwd <path>        Repository to talk to. Default: current directory.
  --server <url>      code-viewer server URL (default: auto-discover).

Examples:
  code-viewer accounts create --agent claude --name work
  code-viewer accounts login --account <id>
  code-viewer accounts wait --account <id>
`;

export const ACCOUNTS_AGENT_HELP = `code-viewer accounts — agent guide

What it is for
  Adding more claude / codex accounts for the human without them clicking
  through Settings > Accounts. Each account is its own settings directory
  (CLAUDE_CONFIG_DIR / CODEX_HOME), so sign-ins, history and usage stay apart.

Flow for one new account
  1. code-viewer accounts list --json
     See what exists. Pick a name no other account of that agent uses (create
     does not refuse a repeated name yet).
  2. code-viewer accounts create --agent claude --name work --json
     Prints the new account (id, configDir) and the linked entries.
  3. code-viewer accounts login --account <id> --json
     Opens the official sign-in command in a tmux window and prints its pane
     id. Read what it shows with:
       code-viewer terminal capture --target <paneId>
  4. Tell the human to approve in the browser, signed in as the account they
     want. For a second account of the same service, they must switch the
     browser's signed-in account (or open the URL in another browser profile)
     first, otherwise the approval goes to the account already signed in.
  5. code-viewer accounts wait --account <id>
     Returns when the CLI reports signed in, with the email it answered.

Renaming and removing
  code-viewer accounts rename --account <id> --name <new name>
  code-viewer accounts remove --account <id>
  Confirm with the human before remove. It only takes the account off the
  list; the settings directory stays, so register brings it back.

What you must not do
  Never ask for, read, copy or type passwords, tokens or one-time codes.
  The approval is the human's. If the sign-in window asks a question you
  cannot answer from its text, relay it to the human.

Rerun this guide
  code-viewer accounts agent-help
`;

function parseSeconds(value: string): number | { error: string } {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: "--timeout must be a positive integer (seconds)" };
  }
  return parsed;
}

const SUBCOMMANDS = [
  "list",
  "plan",
  "create",
  "register",
  "login",
  "wait",
  "rename",
  "remove",
] as const;

export function parseAccountsArgs(argv: string[]): AccountsParseResult {
  const sub = argv[0];
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    return {
      ok: true,
      args: { command: { mode: "help" }, cwd: undefined, server: undefined },
    };
  }
  if (sub === "agent-help") {
    return {
      ok: true,
      args: {
        command: { mode: "agent-help" },
        cwd: undefined,
        server: undefined,
      },
    };
  }
  if (!(SUBCOMMANDS as readonly string[]).includes(sub)) {
    return { ok: false, error: `unknown accounts subcommand: ${sub}` };
  }

  let cwd: string | undefined;
  let server: string | undefined;
  let json = false;
  let refresh = false;
  let agent: AccountAgent | null = null;
  let name: string | null = null;
  let configDir: string | null = null;
  let account: string | null = null;
  let timeoutSeconds: number | null = null;
  const share: string[] = [];

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const global = takeGlobalCliOption(argv, i, { allowServer: true });
    if (global.kind === "error") return { ok: false, error: global.error };
    if (global.kind === "cwd" || global.kind === "server") {
      if (global.kind === "cwd") cwd = global.value;
      else server = global.value;
      i = global.next;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--refresh") {
      refresh = true;
      continue;
    }
    if (
      arg === "--agent" ||
      arg === "--name" ||
      arg === "--share" ||
      arg === "--config-dir" ||
      arg === "--account" ||
      arg === "--timeout"
    ) {
      const taken = takeValue(argv, i, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      i = taken.next;
      if (arg === "--name") name = taken.value;
      else if (arg === "--share") share.push(taken.value);
      else if (arg === "--config-dir") configDir = taken.value;
      else if (arg === "--account") account = taken.value;
      else if (arg === "--timeout") {
        const parsed = parseSeconds(taken.value);
        if (typeof parsed !== "number") {
          return { ok: false, error: parsed.error };
        }
        timeoutSeconds = parsed;
      } else if (isAccountAgent(taken.value)) {
        agent = taken.value;
      } else {
        return {
          ok: false,
          error: `--agent must be one of: ${HOOK_AGENTS.join(", ")}`,
        };
      }
      continue;
    }
    return { ok: false, error: `unknown option: ${arg}` };
  }

  const done = (command: AccountsCommand): AccountsParseResult => ({
    ok: true,
    args: { command, cwd, server },
  });
  const onlyFor = (flag: string, used: boolean, allowed: boolean) =>
    used && !allowed ? `${flag} is not an option of accounts ${sub}` : null;
  const byAccount =
    sub === "login" || sub === "wait" || sub === "rename" || sub === "remove";
  const byAgent = sub === "plan" || sub === "create" || sub === "register";
  const misplaced =
    onlyFor("--refresh", refresh, sub === "list") ??
    onlyFor("--share", share.length > 0, sub === "create") ??
    onlyFor("--config-dir", configDir !== null, sub === "register") ??
    onlyFor("--timeout", timeoutSeconds !== null, sub === "wait") ??
    onlyFor("--agent", agent !== null, byAgent) ??
    onlyFor("--account", account !== null, byAccount) ??
    onlyFor("--name", name !== null, byAgent || sub === "rename");
  if (misplaced) return { ok: false, error: misplaced };

  if (sub === "list") return done({ mode: "list", json, refresh });
  const named = name !== null && name.trim() !== "" ? name : null;
  if (byAccount) {
    if (account === null) return { ok: false, error: "--account is required" };
    if (sub === "login") return done({ mode: "login", account, json });
    if (sub === "remove") return done({ mode: "remove", account, json });
    if (sub === "wait") {
      return done({
        mode: "wait",
        account,
        timeoutSeconds: timeoutSeconds ?? DEFAULT_WAIT_SECONDS,
        json,
      });
    }
    if (named === null) return { ok: false, error: "--name is required" };
    return done({ mode: "rename", account, name: named, json });
  }
  if (agent === null) return { ok: false, error: "--agent is required" };
  if (named === null) return { ok: false, error: "--name is required" };
  if (sub === "plan") return done({ mode: "plan", agent, name: named, json });
  if (sub === "create") {
    return done({ mode: "create", agent, name: named, share, json });
  }
  if (!configDir) return { ok: false, error: "--config-dir is required" };
  return done({ mode: "register", agent, name: named, configDir, json });
}

/** 一覧の 1 行。既定のアカウントは名前が空なので (default) と出す。 */
export function formatAccountLine(account: AccountStatus): string {
  const name = account.builtin ? "(default)" : account.name;
  const who = account.login.who || "-";
  return [
    account.id,
    account.agent,
    name,
    account.login.state,
    who,
    account.configDir,
  ].join("\t");
}

/** plan の説明。何を作り、何をリンクし、何をリンクできないか。 */
export function formatCreatePlan(plan: CreateAccountPlan): string {
  const names = (category: string) =>
    plan.entries
      .filter((entry) => entry.category === category)
      .map((entry) =>
        entry.reason ? `${entry.name} (${entry.reason})` : entry.name,
      );
  const line = (label: string, list: string[]) =>
    `${label}: ${list.length > 0 ? list.join(", ") : "-"}`;
  const lines = [
    `settings directory: ${plan.configDir}`,
    line("linked from the default account", names("shared")),
    line("not linked, optional (add with --share)", names("optional")),
    line("never linked", names("blocked")),
  ];
  if (plan.authKeysInShared.length > 0) {
    lines.push(
      `note: the linked settings contain sign-in related keys (${plan.authKeysInShared.join(", ")}); the new account will use them too`,
    );
  }
  return lines.join("\n");
}

function planQuery(agent: AccountAgent, name: string): string {
  const params = new URLSearchParams({ op: "create", agent, name });
  return `/_agent/accounts/plan?${params}`;
}

async function listAccounts(
  serverUrl: string,
  query: string,
): Promise<AccountsResponse> {
  return (await requestJson(
    serverUrl,
    `/_agent/accounts${query}`,
    "GET",
    undefined,
    "accounts list",
  )) as AccountsResponse;
}

function print(json: boolean, value: unknown, text: string): void {
  console.log(json ? JSON.stringify(value, null, 2) : text);
}

export async function runAccountsCli(argv: string[]): Promise<void> {
  const parsed = parseAccountsArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error(ACCOUNTS_HELP);
    process.exit(1);
  }
  const { command, cwd, server } = parsed.args;
  if (command.mode === "help") {
    console.log(ACCOUNTS_HELP);
    return;
  }
  if (command.mode === "agent-help") {
    console.log(ACCOUNTS_AGENT_HELP);
    return;
  }

  // アカウントを持つのは入口のサーバ。
  const serverUrl = await ensureAgentServerUrl(
    resolveRepoRoot(cwd),
    server,
    HEALTH_PATH,
  );

  if (command.mode === "list") {
    const body = await listAccounts(
      serverUrl,
      command.refresh ? "?login=refresh" : "",
    );
    if (body.registryError) {
      console.error(
        `the account registry ${body.registryPath} cannot be read; only the default accounts are listed:\n${body.registryError}`,
      );
    }
    print(
      command.json,
      body.accounts,
      body.accounts.map(formatAccountLine).join("\n"),
    );
    return;
  }

  if (command.mode === "plan") {
    const plan = (await requestJson(
      serverUrl,
      planQuery(command.agent, command.name),
      "GET",
      undefined,
      "accounts plan",
    )) as CreateAccountPlan;
    print(command.json, plan, formatCreatePlan(plan));
    return;
  }

  if (command.mode === "create") {
    // 作る直前の計画を読み、その設定ディレクトリで作る。計画の後で別の誰かが
    // 同じ名前を作っていれば、サーバが conflict で断る (何も作らない)。
    const plan = (await requestJson(
      serverUrl,
      planQuery(command.agent, command.name),
      "GET",
      undefined,
      "accounts create (plan)",
    )) as CreateAccountPlan;
    const share = [...defaultShareSelection(plan.entries), ...command.share];
    const { added } = (await requestJson(
      serverUrl,
      "/_agent/accounts",
      "POST",
      {
        op: "create",
        agent: command.agent,
        name: command.name,
        configDir: plan.configDir,
        share,
      },
      "accounts create",
    )) as { added: StoredAccount };
    print(
      command.json,
      { added, linked: share, plan },
      `created ${added.agent} account "${added.name}"\nid: ${added.id}\n${formatCreatePlan(plan)}\nnext: code-viewer accounts login --account ${added.id}`,
    );
    return;
  }

  if (command.mode === "register") {
    const { added } = (await requestJson(
      serverUrl,
      "/_agent/accounts",
      "POST",
      {
        op: "register",
        agent: command.agent,
        name: command.name,
        configDir: command.configDir,
      },
      "accounts register",
    )) as { added: StoredAccount };
    print(
      command.json,
      { added },
      `registered ${added.agent} account "${added.name}"\nid: ${added.id}\nsettings directory: ${added.configDir}`,
    );
    return;
  }

  if (command.mode === "rename") {
    const { renamed } = (await requestJson(
      serverUrl,
      "/_agent/accounts",
      "POST",
      { op: "rename", id: command.account, name: command.name },
      "accounts rename",
    )) as { renamed: StoredAccount };
    print(
      command.json,
      { renamed },
      `renamed ${renamed.agent} account ${renamed.id} to "${renamed.name}"`,
    );
    return;
  }

  if (command.mode === "remove") {
    const { removed } = (await requestJson(
      serverUrl,
      "/_agent/accounts",
      "POST",
      { op: "remove", id: command.account },
      "accounts remove",
    )) as { removed: StoredAccount };
    print(
      command.json,
      { removed },
      `removed ${removed.agent} account "${removed.name}" from the list\nits settings directory is left as it is: ${removed.configDir}`,
    );
    return;
  }

  if (command.mode === "login") {
    const pane = (await requestJson(
      serverUrl,
      "/_agent/accounts/login",
      "POST",
      { id: command.account },
      "accounts login",
    )) as LaunchedPane;
    print(
      command.json,
      pane,
      `opened the sign-in window in tmux session ${pane.session} (pane ${pane.paneId}).\nApprove it in the browser, then run: code-viewer accounts wait --account ${command.account}`,
    );
    return;
  }

  await waitForLogin(serverUrl, command);
}

async function waitForLogin(
  serverUrl: string,
  command: Extract<AccountsCommand, { mode: "wait" }>,
): Promise<void> {
  const deadline = Date.now() + command.timeoutSeconds * 1000;
  const query = `?${new URLSearchParams({ login: "refresh", account: command.account })}`;
  for (;;) {
    const body = await listAccounts(serverUrl, query);
    const account = body.accounts.find((item) => item.id === command.account);
    if (!account) {
      console.error(`no account ${command.account}`);
      process.exit(1);
    }
    if (account.login.state === "logged-in") {
      print(
        command.json,
        account,
        `signed in: ${formatAccountLine(account)}${account.login.whoDetail ? `\n${account.login.whoDetail}` : ""}`,
      );
      return;
    }
    if (Date.now() >= deadline) {
      console.error(
        `${command.account} is still ${account.login.state} after ${command.timeoutSeconds} seconds${account.login.detail ? `:\n${account.login.detail}` : ""}`,
      );
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
  }
}
