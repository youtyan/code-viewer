// 登録したアカウントの表示名を変えるダイアログ。押す前の検査はサーバと同じ
// 規則 (renameAccount) で理由を出し、サーバが断ったときはその理由をダイアログ
// に出す (閉じない)。パス・名前はすべて架空。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type {
  AccountStatus,
  AccountsResponse,
  StoredAccount,
} from "../core/agent-accounts";
import type { AccountsClient } from "../views/agents/accounts-client";
import { createAccountDialogs } from "../views/agents/accounts-dialogs";
import { ACCOUNTS_EN } from "../views/agents/accounts-i18n";
import { q } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.replaceChildren();
});

function account(
  overrides: Partial<AccountStatus> & Pick<AccountStatus, "id">,
): AccountStatus {
  return {
    agent: "codex",
    name: "",
    configDir: "/home/sample/accounts/one",
    builtin: false,
    managed: false,
    exists: true,
    login: {
      state: "logged-in",
      who: "",
      whoDetail: "",
      method: "",
      plan: "",
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
    ...overrides,
  };
}

const PERSONAL = account({ id: "id-1", name: "Personal" });
const OTHER = account({
  id: "id-2",
  name: "Other",
  configDir: "/home/sample/accounts/two",
});

function response(): AccountsResponse {
  return {
    home: "/home/sample",
    serverRoot: "/home/sample/work/sample-app",
    accounts: [
      account({
        id: "codex:default",
        builtin: true,
        configDir: "/home/sample/.codex",
      }),
      PERSONAL,
      OTHER,
    ],
    registryError: null,
    registryPath: "/home/sample/.local/state/code-viewer/accounts.json",
    launchCommands: { claude: "claude", codex: "codex" },
    lastLaunch: null,
    usageFailures: { total: 0, recent: [], log: "" },
  };
}

/** このテストで使わない操作は、呼ばれたら失敗させる。 */
function unused(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used by the rename dialog`);
  };
}

function client(
  rename: (id: string, name: string) => Promise<StoredAccount>,
): AccountsClient {
  return {
    snapshot: () => ({ data: response(), error: "" }),
    subscribe: unused("subscribe"),
    load: unused("load"),
    retain: unused("retain"),
    planCreate: unused("planCreate"),
    planRegister: unused("planRegister"),
    create: unused("create"),
    register: unused("register"),
    remove: unused("remove"),
    rename,
    savePreferences: unused("savePreferences"),
    login: unused("login"),
    launch: unused("launch"),
    planStatusLine: unused("planStatusLine"),
    applyStatusLine: unused("applyStatusLine"),
    clearUsageFailures: unused("clearUsageFailures"),
  };
}

function dialogs(rename: (id: string, name: string) => Promise<StoredAccount>) {
  return createAccountDialogs({
    client: client(rename),
    getText: () => ACCOUNTS_EN,
    openPane: unused("openPane"),
    getOverview: () => null,
    serverRoot: () => "/home/sample/work/sample-app",
    refreshOverview: unused("refreshOverview"),
  });
}

function nameInput(): HTMLInputElement {
  return q<HTMLInputElement>(document, ".gdp-dialog input.gdp-dialog-input");
}

async function submitWith(value: string): Promise<string> {
  nameInput().value = value;
  document
    .querySelector<HTMLButtonElement>(".gdp-dialog .gdp-dialog-confirm")
    ?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return (
    document.querySelector(".gdp-dialog .gdp-dialog-error")?.textContent ?? ""
  );
}

const stored = (name: string): StoredAccount => ({
  id: "id-1",
  agent: "codex",
  name,
  configDir: "/home/sample/accounts/one",
  managed: false,
  createdAt: 1,
});

describe("rename dialog", () => {
  test("renames and reports the old and new names", async () => {
    const sent: string[] = [];
    const out = dialogs(async (id, name) => {
      sent.push(`${id}:${name}`);
      return stored(name.trim());
    }).rename(PERSONAL);
    expect(nameInput().value).toBe("Personal");
    await submitWith("Side project");
    expect([await out, sent]).toEqual([
      "Renamed Personal to Side project.",
      ["id-1:Side project"],
    ]);
  });

  test.each([
    { value: "  ", reason: "Enter a name." },
    {
      value: "Default",
      reason:
        '"Default" is the name of the default account. Choose another name.',
    },
    {
      value: "other",
      reason: 'Another codex account is already named "Other".',
    },
  ])("refuses $value before sending, with the reason", async ({
    value,
    reason,
  }) => {
    const sent: string[] = [];
    void dialogs(async (id, name) => {
      sent.push(`${id}:${name}`);
      return stored(name);
    }).rename(PERSONAL);
    expect([await submitWith(value), sent]).toEqual([reason, []]);
  });

  test("shows the reason the server gave and stays open", async () => {
    void dialogs(async () => {
      throw new Error(
        'rename the account (HTTP 409 Conflict): "Newer" is already the name of another codex account ("Newer")',
      );
    }).rename(PERSONAL);
    expect([
      await submitWith("Newer"),
      document.querySelector(".gdp-dialog") !== null,
    ]).toEqual([
      'rename the account (HTTP 409 Conflict): "Newer" is already the name of another codex account ("Newer")',
      true,
    ]);
  });
});
