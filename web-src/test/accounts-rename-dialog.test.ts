// 登録したアカウントの表示名を変えるダイアログと、タグを付け外しするダイアログ。
// 押す前の検査はサーバと同じ規則 (renameAccount・checkAccountTags) で理由を出し、
// サーバが断ったときはその理由をダイアログに出す (閉じない)。パス・名前はすべて架空。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type {
  AccountStatus,
  AccountsResponse,
  AccountTag,
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
  tags: [{ name: "work", color: "blue" }],
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
  setTags: AccountsClient["setTags"] = unused("setTags"),
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
    setTags,
    savePreferences: unused("savePreferences"),
    login: unused("login"),
    launch: unused("launch"),
    planStatusLine: unused("planStatusLine"),
    applyStatusLine: unused("applyStatusLine"),
    clearUsageFailures: unused("clearUsageFailures"),
    checkAllUsage: unused("checkAllUsage"),
    usageCheck: () => null,
    checkUsage: unused("checkUsage"),
    noteUsageCheckOpened: unused("noteUsageCheckOpened"),
  };
}

function dialogs(
  rename: (id: string, name: string) => Promise<StoredAccount>,
  setTags?: AccountsClient["setTags"],
) {
  return createAccountDialogs({
    client: client(rename, setTags),
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
  ])(
    "refuses $value before sending, with the reason",
    async ({ value, reason }) => {
      const sent: string[] = [];
      void dialogs(async (id, name) => {
        sent.push(`${id}:${name}`);
        return stored(name);
      }).rename(PERSONAL);
      expect([await submitWith(value), sent]).toEqual([reason, []]);
    },
  );

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
      'Error: rename the account (HTTP 409 Conflict): "Newer" is already the name of another codex account ("Newer")',
      true,
    ]);
  });
});

describe("tags dialog", () => {
  /** 送った内容を控え、そのまま返す。 */
  function tagsDialog(account: AccountStatus) {
    const sent: Array<[string, AccountTag[]]> = [];
    const out = dialogs(unused("rename"), async (id, tags) => {
      sent.push([id, tags]);
      return tags;
    }).tags(account);
    return { out, sent };
  }

  function field(): HTMLInputElement {
    return q<HTMLInputElement>(document, ".gdp-dialog .account-tags-input");
  }

  /** 欄に打って、そのキーを押す。 */
  function press(value: string, init: KeyboardEventInit): void {
    field().value = value;
    field().dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  }

  function chips(): string[] {
    return Array.from(
      document.querySelectorAll(".gdp-dialog .account-tag-pick"),
      (chip) => chip.textContent ?? "",
    );
  }

  async function confirm(): Promise<string> {
    document
      .querySelector<HTMLButtonElement>(".gdp-dialog .gdp-dialog-confirm")
      ?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return (
      document.querySelector(".gdp-dialog .gdp-dialog-error")?.textContent ?? ""
    );
  }

  test.each<{
    name: string;
    start: AccountTag[];
    value: string;
    init: KeyboardEventInit;
    expected: string[];
  }>([
    {
      name: "Enter adds the typed tag",
      start: [],
      value: " 仕事 ",
      init: { key: "Enter" },
      expected: ["仕事"],
    },
    {
      name: "a comma adds the typed tag",
      start: [],
      value: "api",
      init: { key: "," },
      expected: ["api"],
    },
    {
      name: "a Japanese comma adds the typed tag",
      start: [],
      value: "検証",
      init: { key: "、" },
      expected: ["検証"],
    },
    {
      name: "Enter while converting Japanese does not add",
      start: [],
      value: "しごと",
      init: { key: "Enter", isComposing: true },
      expected: [],
    },
    {
      name: "the same tag in another case is not added twice",
      start: [{ name: "api", color: null }],
      value: "API",
      init: { key: "Enter" },
      expected: ["api"],
    },
    {
      name: "Backspace in the empty field removes the last tag",
      start: [
        { name: "api", color: null },
        { name: "work", color: "blue" },
      ],
      value: "",
      init: { key: "Backspace" },
      expected: ["api"],
    },
  ])("$name", ({ start, value, init, expected }) => {
    tagsDialog(account({ id: "id-1", name: "Personal", tags: start }));

    press(value, init);

    expect(chips()).toEqual(expected);
  });

  test("saves the tags with the chosen color, a tag from another account and a tag still being typed", async () => {
    const { out, sent } = tagsDialog(
      account({
        id: "id-1",
        name: "Personal",
        tags: [{ name: "api", color: null }],
      }),
    );
    press("仕事", { key: "Enter" });
    q<HTMLButtonElement>(
      document,
      '.gdp-dialog .account-tag-swatch[data-project-color="green"]',
    ).click();
    q<HTMLButtonElement>(document, ".gdp-dialog .account-tags-suggest").click();
    field().value = "draft";

    await confirm();

    expect([await out, sent]).toEqual([
      "Saved the tags of codex Personal.",
      [
        [
          "id-1",
          [
            { name: "api", color: null },
            { name: "仕事", color: "green" },
            { name: "work", color: "blue" },
            { name: "draft", color: null },
          ],
        ],
      ],
    ]);
  });
});
