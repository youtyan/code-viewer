// New agent のダイアログの「実行するコマンド」。開いた時点の写しではなく、今の
// 起動コマンドを出す (設定の保存が別の画面で起きても、開き直さずに合う)。
// パス・名前はすべて架空。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import type { AccountsResponse } from "../core/agent-accounts";
import type { AccountsClient } from "../views/agents/accounts-client";
import { createAccountDialogs } from "../views/agents/accounts-dialogs";
import { ACCOUNTS_EN } from "../views/agents/accounts-i18n";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.replaceChildren();
});

function response(claude: string): AccountsResponse {
  return {
    home: "/home/sample",
    serverRoot: "/home/sample/work/sample-app",
    accounts: [
      {
        id: "claude:default",
        agent: "claude",
        name: "",
        configDir: "/home/sample/.claude",
        builtin: true,
        managed: false,
        exists: true,
        login: {
          state: "logged-in",
          who: "",
          method: "",
          detail: "",
          checkedAt: 1,
        },
        usage: {
          status: "unavailable",
          reason: "no-data",
          detail: "",
          observedAt: 1,
        },
        hooks: "none",
        statusLine: null,
      },
    ],
    registryError: null,
    registryPath: "/home/sample/.local/state/code-viewer/accounts.json",
    launchCommands: { claude, codex: "codex" },
    lastLaunch: null,
    usageFailures: { total: 0, recent: [], log: "" },
  };
}

function unused(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used by the launch dialog`);
  };
}

/** 取り直しで中身が変わる client。listeners は開いている間だけ付く。 */
function fakeClient() {
  let data = response("claude --old");
  const listeners = new Set<() => void>();
  let loads = 0;
  const client: AccountsClient = {
    snapshot: () => ({ data, error: "" }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: async () => {
      loads++;
    },
    retain: unused("retain"),
    planCreate: unused("planCreate"),
    planRegister: unused("planRegister"),
    create: unused("create"),
    register: unused("register"),
    remove: unused("remove"),
    rename: unused("rename"),
    savePreferences: unused("savePreferences"),
    login: unused("login"),
    launch: unused("launch"),
    planStatusLine: unused("planStatusLine"),
    applyStatusLine: unused("applyStatusLine"),
    clearUsageFailures: unused("clearUsageFailures"),
  };
  return {
    client,
    listeners,
    loads: () => loads,
    /** 別の画面で起動コマンドが保存され、周期の取り直しで届いた。 */
    arrive(claude: string) {
      data = response(claude);
      for (const listener of [...listeners]) listener();
    },
  };
}

function preview(): string {
  return document.querySelector(".agent-launch-form code")?.textContent ?? "";
}

test("開いている間に届いた起動コマンドで、表示するコマンドを合わせ直す", async () => {
  const fake = fakeClient();
  const dialogs = createAccountDialogs({
    client: fake.client,
    getText: () => ACCOUNTS_EN,
    openPane: unused("openPane"),
    getOverview: () => null,
    serverRoot: () => "/home/sample/work/sample-app",
    refreshOverview: unused("refreshOverview"),
  });
  const closed = dialogs.launch();
  // 開いた時点でも 1 回取り直す
  expect([preview(), fake.loads(), fake.listeners.size]).toEqual([
    "claude --old",
    1,
    1,
  ]);
  fake.arrive("claude --new");
  expect(preview()).toBe("claude --new");
  // 閉じたら合わせ直しをやめる
  document
    .querySelector<HTMLButtonElement>(".gdp-dialog .gdp-dialog-cancel")
    ?.click();
  await closed;
  expect(fake.listeners.size).toBe(0);
});
