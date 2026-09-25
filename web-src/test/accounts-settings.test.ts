// 設定の「アカウント」の分類: 1 アカウント 1 行の表 (状態は 3 つ)、行ごとの
// 操作、使用量の 1 行、起動コマンドの下書き (保存はページの「変更を保存」)。
// パス・名前・メールアドレスはすべて架空。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type {
  AccountLogin,
  AccountStatus,
  AccountsResponse,
} from "../core/agent-accounts";
import type { AccountsClient } from "../views/agents/accounts-client";
import type { AccountDialogs } from "../views/agents/accounts-dialogs";
import { ACCOUNTS_EN, ACCOUNTS_JA } from "../views/agents/accounts-i18n";
import {
  createAccountsSettings,
  shownLoginState,
} from "../views/agents/accounts-settings";
import { deferred } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.replaceChildren();
});

const NOW = 10 * 60_000;
const EMAIL = "sample@example.invalid";

function login(overrides: Partial<AccountLogin>): AccountLogin {
  return {
    state: "logged-in",
    who: "",
    whoDetail: "",
    method: "",
    plan: "",
    detail: "",
    checkedAt: NOW,
    ...overrides,
  };
}

function account(
  overrides: Partial<AccountStatus> & Pick<AccountStatus, "id">,
): AccountStatus {
  return {
    agent: "codex",
    name: "",
    configDir: "/home/sample/accounts/one",
    builtin: false,
    managed: true,
    exists: true,
    login: login({}),
    usage: {
      status: "unavailable",
      reason: "no-data",
      detail: "",
      observedAt: 0,
    },
    hooks: "none",
    statusLine: null,
    ...overrides,
  };
}

const ROWS: AccountStatus[] = [
  account({
    id: "claude:default",
    agent: "claude",
    builtin: true,
    managed: false,
    configDir: "/home/sample/.claude",
    login: login({ who: EMAIL, method: "claude.ai", plan: "max" }),
    usage: {
      status: "ok",
      windows: [],
      observedAt: NOW - 20_000,
    },
    statusLine: {
      state: "wrapped",
      path: "/home/sample/.claude/settings.json",
      realPath: "/home/sample/dotfiles/claude/settings.json",
      symlink: true,
      writeBlocked: "",
      detail: "",
      command: "sample-statusline",
      wrapperMissing: false,
    },
  }),
  account({
    id: "codex:default",
    builtin: true,
    managed: false,
    configDir: "/home/sample/.codex",
    login: login({
      who: EMAIL,
      method: "ChatGPT",
      plan: "pro",
      checkedAt: NOW - 3 * 60_000,
    }),
  }),
  account({
    id: "codex-work",
    name: "work",
    configDir: "/home/sample/.local/state/code-viewer/accounts/codex-work",
    login: login({ state: "logged-out" }),
  }),
  account({
    id: "claude-lab",
    agent: "claude",
    name: "lab",
    configDir: "/home/sample/lab-claude",
    login: login({
      state: "unknown",
      detail:
        "claude auth status --json exited with 1 (stdout 0 bytes, not shown); no JSON object in the output",
    }),
  }),
  account({
    id: "codex-key",
    name: "key",
    configDir: "/home/sample/codex-key",
    login: login({
      method: "API key",
      whoDetail: "signed in with API key, which has no email",
    }),
  }),
  account({
    id: "codex-gone",
    name: "gone",
    configDir: "/home/sample/codex-gone",
    exists: false,
    login: login({
      state: "no-config-dir",
      detail: "/home/sample/codex-gone",
    }),
  }),
];

function response(): AccountsResponse {
  return {
    home: "/home/sample",
    serverRoot: "/home/sample/work/sample-app",
    accounts: ROWS,
    registryError: null,
    registryPath: "/home/sample/.local/state/code-viewer/accounts.json",
    launchCommands: { claude: "claude", codex: "codex" },
    lastLaunch: null,
    usageFailures: { total: 0, recent: [], log: "" },
  };
}

function unused(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used by the accounts section`);
  };
}

function harness(language: "en" | "ja" = "en") {
  const data = response();
  const listeners: Array<() => void> = [];
  const loads: Array<Parameters<AccountsClient["load"]>[0]> = [];
  const saves: Array<Record<string, string>> = [];
  let gate: Promise<void> | null = null;
  const client: AccountsClient = {
    snapshot: () => ({ data, error: "" }),
    subscribe(listener) {
      listeners.push(listener);
      return () => undefined;
    },
    async load(options) {
      loads.push(options);
      if (gate) await gate;
      for (const listener of listeners) listener();
    },
    retain: () => () => undefined,
    planCreate: unused("planCreate"),
    planRegister: unused("planRegister"),
    create: unused("create"),
    register: unused("register"),
    remove: unused("remove"),
    rename: unused("rename"),
    async savePreferences(commands) {
      saves.push(commands);
      data.launchCommands = {
        claude: commands.claude || "claude",
        codex: commands.codex || "codex",
      };
      for (const listener of listeners) listener();
    },
    login: unused("login"),
    launch: unused("launch"),
    planStatusLine: unused("planStatusLine"),
    applyStatusLine: unused("applyStatusLine"),
    clearUsageFailures: unused("clearUsageFailures"),
    usageCheck: () => null,
    checkUsage: unused("checkUsage"),
    noteUsageCheckOpened: unused("noteUsageCheckOpened"),
  };
  const dialogs: AccountDialogs = {
    add: unused("add"),
    login: unused("login"),
    rename: unused("rename"),
    remove: unused("remove"),
    launch: unused("launch"),
    openHere: unused("openHere"),
    statusLine: unused("statusLine"),
  };
  const settings = createAccountsSettings({
    client,
    dialogs,
    getText: () => (language === "ja" ? ACCOUNTS_JA : ACCOUNTS_EN),
    now: () => NOW,
  });
  document.body.appendChild(settings.element);
  settings.localize();
  return {
    settings,
    data,
    loads,
    saves,
    hold() {
      const wait = deferred<void>();
      gate = wait.promise;
      return () => {
        gate = null;
        wait.resolve();
      };
    },
  };
}

function row(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `.agent-accounts-row[data-account="${id}"]`,
  );
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

function cellText(parent: HTMLElement, selector: string): string {
  return parent.querySelector(selector)?.textContent ?? "";
}

describe("the sign-in table", () => {
  test.each([
    { state: "logged-in", shown: "in" },
    { state: "logged-out", shown: "out" },
    { state: "no-config-dir", shown: "out" },
    { state: "unknown", shown: "unknown" },
  ] as const)("$state is shown as $shown", ({ state, shown }) => {
    expect(shownLoginState({ state })).toBe(shown);
  });

  test.each([
    {
      id: "claude:default",
      login: "in",
      name: "claudeDefault",
      email: EMAIL,
      plan: "Max",
      state: "Signed in",
      checked: "just now",
      reason: "",
      actions: ["Check again"],
      path: "~/.claude",
    },
    {
      id: "codex:default",
      login: "in",
      name: "codexDefault",
      email: EMAIL,
      plan: "Pro",
      state: "Signed in",
      checked: "3m ago",
      reason: "",
      actions: ["Check again"],
      path: "~/.codex",
    },
    {
      id: "codex-work",
      login: "out",
      name: "codexwork",
      email: "—",
      plan: "",
      state: "Not signed in",
      checked: "just now",
      reason: "",
      actions: ["Check again", "Sign in", "Rename", "Remove"],
      path: "~/.local/state/code-viewer/accounts/codex-work",
    },
    {
      id: "claude-lab",
      login: "unknown",
      name: "claudelab",
      email: "—",
      plan: "",
      state: "Unknown",
      checked: "just now",
      reason:
        "Could not check: claude auth status --json exited with 1 (stdout 0 bytes, not shown); no JSON object in the output",
      actions: ["Check again", "Rename", "Remove"],
      path: "~/lab-claude",
    },
    {
      id: "codex-key",
      login: "in",
      name: "codexkey",
      email: "—",
      plan: "",
      state: "Signed in",
      checked: "just now",
      reason: "No email: signed in with API key, which has no email",
      actions: ["Check again", "Rename", "Remove"],
      path: "~/codex-key",
    },
    {
      id: "codex-gone",
      login: "out",
      name: "codexgone",
      email: "—",
      plan: "",
      state: "Not signed in",
      checked: "just now",
      reason: "The settings directory does not exist: /home/sample/codex-gone",
      actions: ["Check again", "Rename", "Remove"],
      path: "~/codex-gone",
    },
  ])("$id: $state", (expected) => {
    harness();
    const box = row(expected.id);
    expect(box.dataset.login).toBe(expected.login);
    expect(cellText(box, ".agent-accounts-name-cell")).toBe(expected.name);
    expect(cellText(box, ".agent-accounts-address")).toBe(expected.email);
    expect(cellText(box, ".agent-accounts-plan")).toBe(expected.plan);
    expect(cellText(box, ".agent-accounts-state-label")).toBe(expected.state);
    expect(cellText(box, ".agent-accounts-checked")).toBe(expected.checked);
    expect(cellText(box, ".agent-hooks-detail")).toBe(expected.reason);
    expect(
      Array.from(
        box.querySelectorAll(".agent-accounts-actions button"),
        (button) => button.textContent,
      ),
    ).toEqual(expected.actions);
    expect(cellText(box, ".agent-accounts-path")).toBe(expected.path);
  });

  test("every row has the same cells in the same order, under one header", () => {
    harness();
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(".agent-accounts-row"),
    );
    expect(rows).toHaveLength(ROWS.length + 1);
    const header = rows[0];
    expect(header?.classList.contains("agent-accounts-head")).toBe(true);
    expect(
      Array.from(header?.children ?? [], (cell) => cell.textContent),
    ).toEqual(["Account", "Signed in as", "State", "Last checked"]);
    for (const box of rows.slice(1)) {
      expect(
        Array.from(box.children)
          .slice(0, 6)
          .map((cell) => cell.className.split(" ")[0]),
      ).toEqual([
        "agent-accounts-name-cell",
        "agent-accounts-email",
        "agent-accounts-state",
        "agent-accounts-checked",
        "agent-accounts-actions",
        "agent-accounts-path",
      ]);
    }
  });

  test("the three states have different marks, not only different colors", () => {
    harness();
    const mark = (id: string) =>
      row(id).querySelector<HTMLElement>(".agent-accounts-mark");
    expect(mark("claude:default")?.querySelector("svg")).not.toBeNull();
    expect(mark("codex-work")?.textContent).toBe("");
    expect(mark("codex-work")?.querySelector("svg")).toBeNull();
    expect(mark("claude-lab")?.textContent).toBe("?");
  });

  test("the states read in Japanese", () => {
    harness("ja");
    expect(cellText(row("claude:default"), ".agent-accounts-state-label")).toBe(
      "ログイン済み",
    );
    expect(cellText(row("codex-work"), ".agent-accounts-state-label")).toBe(
      "未ログイン",
    );
    expect(cellText(row("claude-lab"), ".agent-accounts-state-label")).toBe(
      "不明",
    );
    expect(cellText(row("codex:default"), ".agent-accounts-checked")).toBe(
      "3分前",
    );
  });

  test("Check again asks the CLI again for that account only, and says it is checking", async () => {
    const view = harness();
    const release = view.hold();
    row("codex-work")
      .querySelector<HTMLButtonElement>(".agent-accounts-actions button")
      ?.click();
    expect(view.loads).toEqual([{ refreshLogin: true, account: "codex-work" }]);
    expect(cellText(row("codex-work"), ".agent-accounts-checked")).toBe(
      "Checking…",
    );
    expect(cellText(row("codex:default"), ".agent-accounts-checked")).toBe(
      "3m ago",
    );
    release();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(cellText(row("codex-work"), ".agent-accounts-checked")).toBe(
      "just now",
    );
  });

  test("the headings are Sign-in, Usage and Launch commands (not Accounts twice), and nothing saves on its own", () => {
    harness();
    expect(
      Array.from(
        document.querySelectorAll(".agent-accounts-subtitle"),
        (heading) => heading.textContent,
      ),
    ).toEqual(["Sign-in", "Usage", "Launch commands"]);
    expect(
      Array.from(document.querySelectorAll("button"), (b) => b.textContent),
    ).not.toContain("Save");
  });
});

describe("usage", () => {
  test("one line says whether usage arrives and when it last did; how it works is folded", () => {
    harness();
    const line = document.querySelector<HTMLElement>(
      ".agent-accounts-usage-row",
    );
    expect(line?.dataset.usage).toBe("on");
    expect(cellText(line as HTMLElement, ".agent-accounts-usage-line")).toBe(
      "Receiving the 5-hour and weekly usage (last received: just now)",
    );
    expect(
      cellText(line as HTMLElement, ".agent-accounts-actions button"),
    ).toBe("Turn off…");
    const how = document.querySelector<HTMLDetailsElement>(
      ".agent-accounts-how",
    );
    expect(how?.open).toBe(false);
    expect(how?.textContent).toContain("can wrap the status line command");
    expect(how?.textContent).toContain(
      "Settings file: ~/.claude/settings.json → ~/dotfiles/claude/settings.json",
    );
    expect(how?.textContent).toContain("Your command: sample-statusline");
    expect(line?.textContent).not.toContain("wrap");
  });

  test.each([
    {
      name: "not wrapped",
      state: "plain" as const,
      observedAt: 0,
      tone: "off",
      text: "Not receiving the 5-hour and weekly usage.",
      button: "Turn on…",
    },
    {
      name: "wrapped, nothing received yet",
      state: "wrapped" as const,
      observedAt: 0,
      tone: "waiting",
      text: "On, but nothing received yet. It arrives when a claude session with this account gets a response.",
      button: "Turn off…",
    },
  ])("$name", ({ state, observedAt, tone, text, button }) => {
    const view = harness();
    const claude = view.data.accounts[0] as AccountStatus;
    view.data.accounts = [
      {
        ...claude,
        usage:
          observedAt > 0
            ? { status: "ok", windows: [], observedAt }
            : {
                status: "unavailable",
                reason: "no-data",
                detail: "",
                observedAt: 0,
              },
        statusLine: claude.statusLine && { ...claude.statusLine, state },
      },
    ];
    view.settings.localize();
    const line = document.querySelector<HTMLElement>(
      ".agent-accounts-usage-row",
    ) as HTMLElement;
    expect(line.dataset.usage).toBe(tone);
    expect(cellText(line, ".agent-accounts-usage-line")).toBe(text);
    expect(cellText(line, ".agent-accounts-actions button")).toBe(button);
  });
});

describe("launch commands (saved by the page's Save changes)", () => {
  function inputs() {
    return {
      claude: document.querySelector<HTMLInputElement>(
        'input[data-agent="claude"]',
      ) as HTMLInputElement,
      codex: document.querySelector<HTMLInputElement>(
        'input[data-agent="codex"]',
      ) as HTMLInputElement,
    };
  }
  const unsaved = () =>
    document.querySelector<HTMLElement>(".agent-accounts-unsaved");

  test("editing marks it unsaved and tells the page; saving sends it and clears the mark", async () => {
    const view = harness();
    let notified = 0;
    view.settings.draft.subscribe(() => {
      notified += 1;
    });
    expect(view.settings.draft.dirty()).toBe(false);
    expect(unsaved()?.hidden).toBe(true);

    inputs().claude.value = "/opt/sample/claude-wrapper";
    inputs().claude.dispatchEvent(new Event("input"));
    expect(view.settings.draft.dirty()).toBe(true);
    expect(unsaved()?.hidden).toBe(false);
    expect(unsaved()?.textContent).toBe("Unsaved");
    expect(notified).toBeGreaterThan(0);

    await view.settings.draft.save();
    expect(view.saves).toEqual([
      { claude: "/opt/sample/claude-wrapper", codex: "" },
    ]);
    expect(view.settings.draft.dirty()).toBe(false);
    expect(unsaved()?.hidden).toBe(true);
    expect(inputs().claude.value).toBe("/opt/sample/claude-wrapper");
  });

  test("typing the saved value back is not a change", () => {
    const view = harness();
    inputs().codex.value = "codex-x";
    inputs().codex.dispatchEvent(new Event("input"));
    inputs().codex.value = "codex";
    inputs().codex.dispatchEvent(new Event("input"));
    expect(view.settings.draft.dirty()).toBe(false);
  });

  test("Restore default launch commands sits with the commands and is saved like any edit", async () => {
    const view = harness();
    view.data.launchCommands = {
      claude: "/opt/sample/claude-wrapper",
      codex: "sample-codex",
    };
    view.settings.localize();
    const reset = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".agent-accounts-commands button",
      ),
    );
    expect(reset.map((button) => button.textContent)).toEqual([
      "Restore default launch commands",
    ]);
    reset[0]?.click();
    expect(inputs().claude.value).toBe("claude");
    expect(inputs().codex.value).toBe("codex");
    expect(view.saves).toEqual([]);
    expect(view.settings.draft.dirty()).toBe(true);
    await view.settings.draft.save();
    // 既定の名前は「既定」として保存する (登録簿から外れる)。
    expect(view.saves).toEqual([{ claude: "", codex: "" }]);
  });
});
