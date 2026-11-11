// アカウントまわりの presenter のテストで共有する組み立て: 一覧の答え・偽の
// 取得 (AccountsClient)・偽のダイアログ。使わない操作は呼ばれたら落とす。
// 名前・メールアドレス・パスはすべて架空。

import type { AccountStatus, AccountsResponse } from "../core/agent-accounts";
import type { AccountsClient } from "../views/agents/accounts-client";
import type { AccountDialogs } from "../views/agents/accounts-dialogs";

export function sampleAccount(
  overrides: Partial<AccountStatus> = {},
): AccountStatus {
  return {
    id: "claude-work",
    agent: "claude",
    name: "work",
    configDir: "/home/sample/accounts/claude-work",
    builtin: false,
    managed: true,
    exists: true,
    login: {
      state: "logged-in",
      who: "user@example.com",
      whoDetail: "",
      method: "claude.ai",
      plan: "max",
      detail: "",
      checkedAt: 0,
    },
    usage: { status: "unavailable", reason: "no-data", detail: "" },
    hooks: "none",
    statusLine: null,
    ...overrides,
  } as AccountStatus;
}

export function accountsData(accounts: AccountStatus[]): AccountsResponse {
  return {
    home: "/home/sample",
    serverRoot: "/home/sample/work/sample-app",
    accounts,
    registryError: null,
    registryPath: "/home/sample/.local/state/code-viewer/accounts.json",
    launchCommands: { claude: "claude", codex: "codex" },
    lastLaunch: null,
    usageFailures: { total: 0, recent: [], log: "" },
  };
}

const unused = (name: string) => () => {
  throw new Error(`${name} is not used by this test`);
};

/** calls には呼ばれた操作の名前が入る。 */
export function fakeAccountsClient(
  data: AccountsResponse,
  calls: string[] = [],
): AccountsClient {
  return {
    snapshot: () => ({ data, error: "" }),
    subscribe: () => () => undefined,
    load: async () => undefined,
    retain: () => () => undefined,
    planCreate: unused("planCreate"),
    planRegister: unused("planRegister"),
    create: unused("create"),
    register: unused("register"),
    remove: unused("remove"),
    rename: unused("rename"),
    setTags: unused("setTags"),
    savePreferences: async (commands) => {
      calls.push(`savePreferences ${JSON.stringify(commands)}`);
    },
    login: unused("login"),
    launch: unused("launch"),
    planStatusLine: unused("planStatusLine"),
    applyStatusLine: unused("applyStatusLine"),
    clearUsageFailures: unused("clearUsageFailures"),
    checkAllUsage: async () => {
      calls.push("checkAllUsage");
    },
    usageCheck: () => null,
    checkUsage: unused("checkUsage"),
    noteUsageCheckOpened: unused("noteUsageCheckOpened"),
  } as AccountsClient;
}

/** calls には開いたダイアログの名前とアカウントの id が入る。 */
export function fakeAccountDialogs(calls: string[] = []): AccountDialogs {
  const note =
    (name: string) =>
    async (row?: { id?: string } | unknown): Promise<string | null> => {
      const id =
        row && typeof row === "object" && "id" in row ? String(row.id) : "";
      calls.push(`${name} ${id}`.trim());
      return null;
    };
  return {
    add: note("add"),
    login: note("login"),
    rename: note("rename"),
    tags: note("tags"),
    remove: note("remove"),
    launch: unused("launch"),
    openHere: unused("openHere"),
    statusLine: note("statusLine"),
  } as unknown as AccountDialogs;
}
