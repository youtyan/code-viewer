// statusLine を包む・戻す確認の画面 (views/agents/accounts-dialogs.ts の
// statusLine)。設定の使用量の行と、全体ボードのカードの［使用量の取得を有効にする…］が
// 同じものを開く。書けない (別の場所から生成される) ファイルでは、写す内容を
// コピーのボタンで写す。パスはすべて架空。

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
  AccountStatus,
  AccountsResponse,
  StatusLinePlanResponse,
} from "../core/agent-accounts";
import type { AccountsClient } from "../views/agents/accounts-client";
import {
  createAccountDialogs,
  statusLineCopyText,
} from "../views/agents/accounts-dialogs";
import { ACCOUNTS_EN } from "../views/agents/accounts-i18n";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const ACCOUNT: AccountStatus = {
  id: "claude-work",
  agent: "claude",
  name: "Work",
  configDir: "/home/sample/accounts/claude-work",
  builtin: false,
  managed: true,
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
    reason: "not-wrapped",
    detail: "",
    observedAt: 0,
  },
  hooks: "none",
  statusLine: null,
};

function plan(overrides: Partial<StatusLinePlanResponse> = {}) {
  return {
    action: "install",
    configDir: ACCOUNT.configDir,
    path: `${ACCOUNT.configDir}/settings.json`,
    realPath: `${ACCOUNT.configDir}/settings.json`,
    symlink: false,
    fileExists: true,
    before: { type: "command", command: "sample-line" },
    after: {
      type: "command",
      command:
        "/home/sample/.local/state/code-viewer/agent-usage/code-viewer-statusline 'sample-line'",
    },
    changed: true,
    backupPath: null,
    diff: "",
    formattingChanged: false,
    wrapper: { path: "/home/sample/wrapper", write: false },
    usageDir: "/home/sample/.local/state/code-viewer/agent-usage",
    writeBlocked: "",
    baseHash: "0".repeat(64),
    fileIdentity: "sample",
    ...overrides,
  } satisfies StatusLinePlanResponse;
}

function unused(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used by the statusLine dialog`);
  };
}

function setup(planned: StatusLinePlanResponse) {
  const applied: string[] = [];
  const data: AccountsResponse = {
    home: "/home/sample",
    serverRoot: "/home/sample/work/sample-app",
    accounts: [ACCOUNT],
    registryError: null,
    registryPath: "/home/sample/.local/state/code-viewer/accounts.json",
    launchCommands: { claude: "claude", codex: "codex" },
    lastLaunch: null,
    usageFailures: { total: 0, recent: [], log: "" },
  };
  const client: AccountsClient = {
    snapshot: () => ({ data, error: "" }),
    subscribe: unused("subscribe"),
    load: unused("load"),
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
    planStatusLine: async () => planned,
    applyStatusLine: async (_plan, account) => {
      applied.push(account);
      return {
        path: planned.path,
        changed: true,
        backupPath: null,
        wrapperWritten: false,
      };
    },
    clearUsageFailures: unused("clearUsageFailures"),
    usageCheck: () => null,
    checkUsage: unused("checkUsage"),
    noteUsageCheckOpened: unused("noteUsageCheckOpened"),
  };
  const dialogs = createAccountDialogs({
    client,
    getText: () => ACCOUNTS_EN,
    openPane: unused("openPane"),
    getOverview: () => null,
    serverRoot: () => "/home/sample/work/sample-app",
    refreshOverview: unused("refreshOverview"),
  });
  return { dialogs, applied };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const dialog = () => document.querySelector<HTMLElement>(".gdp-dialog");

describe("the statusLine dialog", () => {
  test("turning it on writes through the plan and says so", async () => {
    const { dialogs, applied } = setup(plan());
    const done = dialogs.statusLine(ACCOUNT, "install");
    await settle();
    expect(dialog()?.querySelector(".gdp-dialog-confirm")?.textContent).toBe(
      ACCOUNTS_EN.statusLineInstall.replace(/…$/, ""),
    );
    dialog()?.querySelector<HTMLButtonElement>(".gdp-dialog-confirm")?.click();
    await settle();
    expect(applied).toEqual(["claude-work"]);
    expect(await done).toBe(ACCOUNTS_EN.statusLineApplied.install);
  });

  test("a generated file: shows what to paste, copies it, writes nothing", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const blocked = plan({ writeBlocked: "the file is generated by sample" });
    const { dialogs, applied } = setup(blocked);
    const done = dialogs.statusLine(ACCOUNT, "install");
    await settle();
    const body = dialog()?.textContent ?? "";
    expect(body).toContain(ACCOUNTS_EN.statusLineBlocked);
    expect(body).toContain(statusLineCopyText(blocked));
    expect(body).toContain("the file is generated by sample");
    expect(dialog()?.querySelector(".gdp-dialog-confirm")?.textContent).toBe(
      ACCOUNTS_EN.statusLineCopy,
    );
    expect(dialog()?.querySelector(".gdp-dialog-cancel")?.textContent).toBe(
      ACCOUNTS_EN.close,
    );
    dialog()?.querySelector<HTMLButtonElement>(".gdp-dialog-confirm")?.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(statusLineCopyText(blocked));
    expect(applied).toEqual([]);
    expect(await done).toBe(ACCOUNTS_EN.statusLineCopied);
  });

  test("a failed copy keeps the dialog open with the reason", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("sample clipboard refusal");
        },
      },
    });
    const { dialogs } = setup(plan({ writeBlocked: "generated" }));
    void dialogs.statusLine(ACCOUNT, "install");
    await settle();
    dialog()?.querySelector<HTMLButtonElement>(".gdp-dialog-confirm")?.click();
    await settle();
    expect(dialog()?.querySelector(".gdp-dialog-error")?.textContent).toContain(
      "sample clipboard refusal",
    );
  });

  test("the text to paste is one JSON member", () => {
    expect(statusLineCopyText(plan())).toBe(
      `"statusLine": ${JSON.stringify(plan().after, null, 2)}`,
    );
  });
});
