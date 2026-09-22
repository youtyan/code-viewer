// New agent のダイアログの「実行するコマンド」。開いた時点の写しではなく、今の
// 起動コマンドを出す (設定の保存が別の画面で起きても、開き直さずに合う)。
// パス・名前はすべて架空。

import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import type { AccountsResponse } from "../core/agent-accounts";
import type { AccountsClient } from "../views/agents/accounts-client";
import { createAccountDialogs } from "../views/agents/accounts-dialogs";
import { ACCOUNTS_EN } from "../views/agents/accounts-i18n";

beforeAll(() => {
  GlobalRegistrator.register();
  const style = document.createElement("style");
  style.textContent = readFileSync("web/style.css", "utf8");
  document.head.appendChild(style);
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
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

function colorOf(className: string): string {
  const probe = document.createElement("button");
  probe.className = className;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

// 直す前は失敗を error.message だけで出し、名前と原因が画面から消えていた。
// ほかの画面のコピーと同じく、ボタンに失敗の印と理由、console に原因つきの全体。
// 失敗の色も、ほかの画面のコピーのボタン (`.global-icon-action`) と同じ。
test.each([
  {
    name: "copied",
    rejection: null,
    status: "Copied",
    title: "Copy the command",
  },
  {
    name: "failed with a cause",
    rejection: Object.assign(new Error("clipboard blocked"), {
      name: "NotAllowedError",
      cause: new TypeError("document is not focused"),
    }),
    status:
      "Could not copy the command: NotAllowedError: clipboard blocked\nCaused by: TypeError: document is not focused",
    title:
      "Error: copying the launch command failed\nCaused by: NotAllowedError: clipboard blocked\nCaused by: TypeError: document is not focused",
  },
])("コマンドのコピー: $name", async ({ rejection, status, title }) => {
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        if (rejection) throw rejection;
        written.push(text);
      },
    },
  });
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
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
  const copy = document.querySelector<HTMLButtonElement>(".agent-launch-copy");
  const result = document.querySelector(".agent-launch-copy-result");
  copy?.click();
  await vi.waitFor(() => expect(result?.textContent).not.toBe(""));

  const failedColor = colorOf("global-icon-action failed");
  expect(failedColor).not.toBe(colorOf("agents-icon-action"));
  expect({
    status: result?.textContent,
    title: copy?.title,
    failed: copy?.classList.contains("failed"),
    color: copy && getComputedStyle(copy).color,
    written,
  }).toEqual({
    status,
    title,
    failed: rejection !== null,
    color: rejection ? failedColor : colorOf("agents-icon-action"),
    written: rejection ? [] : ["claude --old"],
  });
  if (rejection) {
    const logged = consoleError.mock.calls[0]?.[0] as Error;
    expect(logged.message).toBe("copying the launch command failed");
    expect((logged as Error & { cause?: unknown }).cause).toBe(rejection);
  } else {
    expect(consoleError).not.toHaveBeenCalled();
  }
  document
    .querySelector<HTMLButtonElement>(".gdp-dialog .gdp-dialog-cancel")
    ?.click();
  await closed;
});
