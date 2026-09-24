// 全体ボードのアカウントのカード (views/agents/accounts-band.ts) の形:
// 見出しは利用者が付けた名前 (既定は「既定」)、種類とプランの札、ログイン中の
// メールアドレスの行、窓の行 (名前・棒・割合・戻る時刻)。名前・メールアドレス・
// パスはすべて架空。時刻はテストを動かす時計の時間帯で組む (書き方もその時計)。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type {
  AccountLogin,
  AccountStatus,
  AccountsResponse,
  AccountUsage,
} from "../core/agent-accounts";
import { createAccountsBand } from "../views/agents/accounts-band";
import type { AccountsClient } from "../views/agents/accounts-client";
import type { AccountDialogs } from "../views/agents/accounts-dialogs";
import {
  ACCOUNTS_EN,
  ACCOUNTS_JA,
  type AccountsText,
} from "../views/agents/accounts-i18n";
import { resetClock } from "../views/agents/usage-meter";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.replaceChildren();
});

/** 2026-09-24 (木) 21:00、この時計の時間帯で。 */
const NOW = new Date(2026, 8, 24, 21, 0).getTime();
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 8, day, hour, minute).getTime();

function login(overrides: Partial<AccountLogin> = {}): AccountLogin {
  return {
    state: "logged-in",
    who: "user@example.com",
    whoDetail: "",
    method: "claude.ai",
    plan: "max",
    detail: "",
    checkedAt: NOW,
    ...overrides,
  };
}

const WEEK = {
  kind: "seven_day",
  minutes: 10080,
  usedPercent: 40,
  resetsAt: at(26, 9),
} as const;

const USAGE: AccountUsage = {
  status: "ok",
  windows: [
    {
      kind: "five_hour",
      minutes: 300,
      usedPercent: 16,
      resetsAt: at(24, 23, 10),
    },
    { kind: "seven_day", minutes: 10080, usedPercent: 3, resetsAt: at(28, 16) },
  ],
  observedAt: NOW - 3 * 60_000,
};

function account(overrides: Partial<AccountStatus> = {}): AccountStatus {
  return {
    id: "claude-work",
    agent: "claude",
    name: "work",
    configDir: "/home/sample/accounts/claude-work",
    builtin: false,
    managed: true,
    exists: true,
    login: login(),
    usage: USAGE,
    hooks: "none",
    statusLine: null,
    ...overrides,
  };
}

function render(accounts: AccountStatus[], t: AccountsText = ACCOUNTS_EN) {
  const data: AccountsResponse = {
    home: "/home/sample",
    serverRoot: "/home/sample/work/sample-app",
    accounts,
    registryError: null,
    registryPath: "/home/sample/.local/state/code-viewer/accounts.json",
    launchCommands: { claude: "claude", codex: "codex" },
    lastLaunch: null,
    usageFailures: { total: 0, recent: [], log: "" },
  };
  const unused = (name: string) => () => {
    throw new Error(`${name} is not used by the card`);
  };
  const client: AccountsClient = {
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
    savePreferences: unused("savePreferences"),
    login: unused("login"),
    launch: unused("launch"),
    planStatusLine: unused("planStatusLine"),
    applyStatusLine: unused("applyStatusLine"),
    clearUsageFailures: unused("clearUsageFailures"),
    usageCheck: () => null,
    checkUsage: unused("checkUsage"),
  };
  const dialogs: AccountDialogs = {
    add: unused("add"),
    login: unused("login"),
    rename: unused("rename"),
    remove: unused("remove"),
    launch: unused("launch"),
  };
  const band = createAccountsBand({
    client,
    dialogs,
    getText: () => t,
    hookStateLabel: (state) => state,
    getOverview: () => null,
    isCollapsed: () => false,
    setCollapsed: () => undefined,
    openSettings: () => undefined,
    requestRender: () => undefined,
    now: () => NOW,
  });
  document.body.appendChild(band.element);
  band.render();
  return (id: string) => {
    const card = band.element.querySelector<HTMLElement>(
      `.agents-account-card[data-account="${id}"]`,
    );
    if (!card) throw new Error(`no card ${id}`);
    return {
      card,
      name: card.querySelector(".agents-account-name")?.textContent ?? "",
      chips: [
        ...card.querySelectorAll(".agents-account-card-head > .agents-chip"),
      ].map((chip) => chip.textContent),
      who: card.querySelector(".agents-account-who")?.textContent ?? null,
      whoTitle:
        card.querySelector<HTMLElement>(".agents-account-who")?.title ?? "",
    };
  };
}

describe("the first two lines of a card", () => {
  test.each([
    {
      name: "a registered claude account with a plan",
      row: account(),
      want: { name: "work", chips: ["claude", "Max"], who: "user@example.com" },
    },
    {
      name: "the default account is called Default",
      row: account({ id: "claude:default", builtin: true, name: "" }),
      want: {
        name: ACCOUNTS_EN.defaultName,
        chips: ["claude", "Max"],
        who: "user@example.com",
      },
    },
    {
      name: "no plan: only the kind",
      row: account({ login: login({ plan: "" }) }),
      want: { name: "work", chips: ["claude"], who: "user@example.com" },
    },
    {
      name: "signed in but no email",
      row: account({
        agent: "codex",
        login: login({ who: "", plan: "", method: "API key" }),
      }),
      want: { name: "work", chips: ["codex"], who: ACCOUNTS_EN.cardNoEmail },
    },
    {
      name: "not signed in: the state, no plan",
      row: account({ login: login({ state: "logged-out", who: "" }) }),
      want: {
        name: "work",
        chips: ["claude"],
        who: ACCOUNTS_EN.login["logged-out"],
      },
    },
    {
      name: "sign-in unknown: the state",
      row: account({
        login: login({ state: "unknown", who: "", detail: "sample reason" }),
      }),
      want: {
        name: "work",
        chips: ["claude"],
        who: ACCOUNTS_EN.login.unknown,
      },
    },
  ])("$name", ({ row, want }) => {
    const shown = render([row])(row.id);
    expect({ name: shown.name, chips: shown.chips, who: shown.who }).toEqual(
      want,
    );
  });

  test("Japanese: the default account is 既定, and the state is short", () => {
    const shown = render(
      [
        account({ id: "claude:default", builtin: true, name: "" }),
        account({ login: login({ state: "logged-out", who: "" }) }),
      ],
      ACCOUNTS_JA,
    );
    expect(shown("claude:default").name).toBe("既定");
    expect(shown("claude-work").who).toBe("未ログイン");
  });

  test("the reason behind an unknown state is in the tooltip", () => {
    const row = account({
      login: login({ state: "unknown", who: "", detail: "sample reason" }),
    });
    expect(render([row])(row.id).whoTitle).toContain("sample reason");
  });
});

describe("when a window comes back", () => {
  test.each([
    {
      name: "later today",
      resetsAt: at(24, 23, 10),
      en: "resets 23:10",
      ja: "23:10 に戻る",
    },
    {
      name: "tomorrow, within 24 hours",
      resetsAt: at(25, 6, 10),
      en: "resets Fri 06:10",
      ja: "金 06:10 に戻る",
    },
    {
      name: "exactly 24 hours ahead",
      resetsAt: at(25, 21, 0),
      en: "resets Sep 25 21:00",
      ja: "9/25 21:00 に戻る",
    },
    {
      name: "days ahead",
      resetsAt: at(28, 16, 0),
      en: "resets Sep 28 16:00",
      ja: "9/28 16:00 に戻る",
    },
  ])("$name", ({ resetsAt, en, ja }) => {
    expect(resetClock(resetsAt, NOW, ACCOUNTS_EN)).toBe(en);
    expect(resetClock(resetsAt, NOW, ACCOUNTS_JA)).toBe(ja);
  });

  test("a window row reads name, bar, percent, then when it comes back", () => {
    const { card } = render([account()])("claude-work");
    const rows = [...card.querySelectorAll<HTMLElement>(".usage-meter")];
    expect(
      rows.map((row) => [...row.children].map((child) => child.className)),
    ).toEqual([
      [
        "usage-meter-name",
        "usage-meter-bar",
        "usage-meter-value",
        "usage-meter-reset",
      ],
      [
        "usage-meter-name",
        "usage-meter-bar",
        "usage-meter-value",
        "usage-meter-reset",
      ],
    ]);
    expect(
      rows.map((row) => row.querySelector(".usage-meter-reset")?.textContent),
    ).toEqual(["resets 23:10", "resets Sep 28 16:00"]);
    // 正確な日時はツールチップ。
    expect(rows[0]?.title).toContain(new Date(at(24, 23, 10)).toLocaleString());
  });

  test("codex shows only the windows it reported", () => {
    const row = account({
      id: "codex-work",
      agent: "codex",
      usage: {
        status: "ok",
        windows: [{ ...WEEK }],
        observedAt: NOW,
      },
    });
    const { card } = render([row])(row.id);
    expect(
      [...card.querySelectorAll(".usage-meter .usage-meter-name")].map(
        (name) => name.textContent,
      ),
    ).toEqual([ACCOUNTS_EN.windowName(WEEK)]);
  });
});
