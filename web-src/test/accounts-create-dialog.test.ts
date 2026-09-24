// アカウントを作る前の確認。一覧の名前 (.cc-writes/ など) がどのディレクトリの
// 何かを一覧の前に言い、「選べば共有できる」の理由はまとまりに 1 回だけ出す
// (行ごとに同じ文を繰り返すと名前が読めず、どこのパスか分からなかった)。
// パス・名前はすべて架空。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type {
  AccountAgent,
  AccountStatus,
  AccountsResponse,
  CreateAccountPlan,
} from "../core/agent-accounts";
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
    throw new Error(`${name} is not used by the create dialog`);
  };
}

function client(
  planCreate: (agent: AccountAgent, name: string) => Promise<CreateAccountPlan>,
  overrides: Partial<AccountsClient> = {},
): AccountsClient {
  return {
    snapshot: () => ({ data: response(), error: "" }),
    subscribe: unused("subscribe"),
    load: unused("load"),
    retain: unused("retain"),
    planCreate,
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
    usageCheck: () => null,
    checkUsage: unused("checkUsage"),
    noteUsageCheckOpened: unused("noteUsageCheckOpened"),
    ...overrides,
  };
}

function dialogs(
  planCreate: (agent: AccountAgent, name: string) => Promise<CreateAccountPlan>,
  overrides: Partial<AccountsClient> = {},
  openPane: (pane: string) => void = unused("openPane"),
) {
  return createAccountDialogs({
    client: client(planCreate, overrides),
    getText: () => ACCOUNTS_EN,
    openPane,
    getOverview: () => null,
    serverRoot: () => "/home/sample/work/sample-app",
    refreshOverview: unused("refreshOverview"),
  });
}

const PLAN: CreateAccountPlan = {
  agent: "claude",
  name: "Work",
  configDir: "/home/sample/.local/state/code-viewer/accounts/claude-work",
  parent: "/home/sample/.local/state/code-viewer/accounts",
  defaultDir: "/home/sample/.claude",
  entries: [
    {
      name: "settings.json",
      target: "/home/sample/.claude/settings.json",
      directory: false,
      category: "shared",
      reason: null,
    },
    {
      name: "sample-cache",
      target: "/home/sample/.claude/sample-cache",
      directory: true,
      category: "optional",
      reason: null,
    },
    {
      name: "sample-notes",
      target: "/home/sample/.claude/sample-notes",
      directory: false,
      category: "optional",
      reason: null,
    },
  ],
  missingShared: [],
  authKeysInShared: [],
};

async function openReview(
  overrides: Partial<AccountsClient> = {},
  openPane?: (pane: string) => void,
): Promise<{ done: Promise<string | null> }> {
  const done = dialogs(async () => PLAN, overrides, openPane).add();
  const name = document.querySelector<HTMLInputElement>(
    ".gdp-dialog input[type=text], .gdp-dialog input:not([type])",
  );
  if (!name) throw new Error("the name field is missing");
  name.value = "Work";
  document
    .querySelector<HTMLButtonElement>(".gdp-dialog .gdp-dialog-confirm")
    ?.click();
  for (let i = 0; i < 10; i++) {
    if (document.querySelector(".agent-accounts-share")) return { done };
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("the review did not open");
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("create account review", () => {
  test("names the default directory the entries are in, before the list", async () => {
    await openReview();
    const intro = document.querySelector(".agent-accounts-share-intro");
    expect(intro?.textContent).toBe(ACCOUNTS_EN.shareIntro("~/.claude"));
    expect(document.body.textContent).toContain(ACCOUNTS_EN.createSource);
  });

  test("gives the reason for the optional group once, not on every row", async () => {
    await openReview();
    const reasons = [
      ...document.querySelectorAll(".agent-accounts-share-why"),
    ].map((node) => node.textContent);
    expect(reasons).toEqual([ACCOUNTS_EN.shareOptionalWhy]);
  });

  test("each row shows its name and keeps the full path in the tooltip", async () => {
    await openReview();
    const rows = [
      ...document.querySelectorAll(".agent-accounts-share-item .terminal-mono"),
    ].map((node) => [node.textContent, node.getAttribute("title")]);
    expect(rows).toEqual([
      ["settings.json", "~/.claude/settings.json"],
      ["sample-cache/", "~/.claude/sample-cache"],
      ["sample-notes", "~/.claude/sample-notes"],
    ]);
  });
});

describe("after creating: sign in right there", () => {
  const CREATED = {
    id: "id-created",
    agent: "claude" as const,
    name: "Work",
    configDir: PLAN.configDir,
    managed: true,
    createdAt: 1,
  };

  test.each([
    { name: "Sign in", press: ".gdp-dialog-confirm", signsIn: true },
    { name: "Later", press: ".gdp-dialog-cancel", signsIn: false },
  ])("$name", async ({ press, signsIn }) => {
    const logins: string[] = [];
    const panes: string[] = [];
    const { done } = await openReview(
      {
        create: async () => CREATED,
        login: async (id) => {
          logins.push(id);
          return { paneId: "%5", session: "code-viewer-login" };
        },
      },
      (pane) => panes.push(pane),
    );
    document
      .querySelector<HTMLButtonElement>(".gdp-dialog .gdp-dialog-confirm")
      ?.click();
    await settle();
    // 作り終えた画面: 何ができたかと、主のボタンの［ログインする］。
    const dialog = document.querySelector<HTMLElement>(".gdp-dialog");
    expect(dialog?.querySelector(".gdp-dialog-title")?.textContent).toBe(
      ACCOUNTS_EN.createdTitle("Work"),
    );
    expect(dialog?.textContent).toContain(ACCOUNTS_EN.createdBody);
    expect(dialog?.querySelector(".gdp-dialog-confirm")?.textContent).toBe(
      ACCOUNTS_EN.createdSignIn,
    );
    dialog?.querySelector<HTMLButtonElement>(press)?.click();
    await settle();
    expect(logins).toEqual(signsIn ? ["id-created"] : []);
    expect(panes).toEqual(signsIn ? ["%5"] : []);
    expect(await done).toBe(
      signsIn
        ? `${ACCOUNTS_EN.added("Work")}\n${ACCOUNTS_EN.loginStarted("code-viewer-login")}`
        : ACCOUNTS_EN.added("Work"),
    );
  });
});

describe("rows that cannot be checked: copy where they are", () => {
  test("only the optional rows get Copy location, and it copies the absolute path", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await openReview();
    const rows = [...document.querySelectorAll(".agent-accounts-share-row")];
    expect(
      rows.map((row) => row.querySelector(".terminal-mono")?.textContent),
    ).toEqual(["sample-cache/", "sample-notes"]);
    rows[0]?.querySelector<HTMLButtonElement>("button")?.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith("/home/sample/.claude/sample-cache");
    expect(
      rows[0]?.querySelector(".agent-accounts-share-copied")?.textContent,
    ).toBe(ACCOUNTS_EN.copiedLocation);
  });

  test("a failed copy says why", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("sample clipboard refusal");
        },
      },
    });
    await openReview();
    const row = document.querySelector(".agent-accounts-share-row");
    row?.querySelector<HTMLButtonElement>("button")?.click();
    await settle();
    expect(
      row?.querySelector(".agent-accounts-share-copied")?.textContent,
    ).toContain("sample clipboard refusal");
  });
});
