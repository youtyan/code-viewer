// 「使用量を確かめる」の画面の部品 (views/agents/usage-check.ts) と、それを
// 出す 2 か所 (全体ボードのアカウントのカード・設定の使用量の行)、確認の
// 状態を持つ AccountsClient。パス・名前はすべて架空。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  type AccountStatus,
  type AccountsResponse,
  type AccountUsage,
  USAGE_STALE_MS,
  type UsageCheckResponse,
} from "../core/agent-accounts";
import { createAccountsBand } from "../views/agents/accounts-band";
import {
  type AccountsClient,
  createAccountsClient,
  type UsageCheckState,
} from "../views/agents/accounts-client";
import type { AccountDialogs } from "../views/agents/accounts-dialogs";
import { ACCOUNTS_EN, ACCOUNTS_JA } from "../views/agents/accounts-i18n";
import { createAccountsSettings } from "../views/agents/accounts-settings";
import {
  usageCheckBlock,
  usageCheckMenuItem,
} from "../views/agents/usage-check";
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

const NOW = 1_800_000_000_000;
const t = ACCOUNTS_EN;

const STATUS_LINE: NonNullable<AccountStatus["statusLine"]> = {
  state: "wrapped",
  path: "/home/sample/.claude/settings.json",
  realPath: "/home/sample/.claude/settings.json",
  symlink: false,
  writeBlocked: "",
  detail: "",
  command: "sample-statusline",
  wrapperMissing: false,
};

function account(overrides: Partial<AccountStatus> = {}): AccountStatus {
  return {
    id: "claude-sample",
    agent: "claude",
    name: "sample",
    configDir: "/home/sample/accounts/claude-sample",
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
      checkedAt: NOW,
    },
    usage: {
      status: "unavailable",
      reason: "no-data",
      detail: "",
      observedAt: 0,
    },
    hooks: "none",
    statusLine: STATUS_LINE,
    ...overrides,
  };
}

const FRESH: Extract<AccountUsage, { status: "ok" }> = {
  status: "ok",
  windows: [{ kind: "five_hour", minutes: 300, usedPercent: 12, resetsAt: 0 }],
  observedAt: NOW - 1000,
};

function failed(
  reason: Extract<UsageCheckResponse, { status: "failed" }>["reason"],
  extra: Partial<UsageCheckResponse> = {},
): UsageCheckResponse {
  return {
    accountId: "claude-sample",
    status: "failed",
    reason,
    detail: `the claude screen shows "sample marker"`,
    evidence: ["sample line one", "sample line two"],
    usage: null,
    session: "code-viewer-usage-claude-sampl-x",
    closeError: "",
    joined: false,
    startedAt: NOW - 5000,
    finishedAt: NOW,
    ...extra,
  } as UsageCheckResponse;
}

/** 確認の状態だけを持つ偽の client (ほかの操作は呼ばれない)。 */
function fakeClient(
  states: Record<string, UsageCheckState> = {},
  data: AccountsResponse | null = null,
) {
  const pressed: string[] = [];
  const unused = (name: string) => () => {
    throw new Error(`${name} is not used here`);
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
    usageCheck: (id) => states[id] ?? null,
    async checkUsage(id) {
      pressed.push(id);
    },
  };
  return { client, pressed };
}

function shown(element: HTMLElement | null) {
  if (!element) return null;
  const button = element.querySelector<HTMLButtonElement>(
    ".usage-check-button",
  );
  return {
    button: button
      ? {
          text: button.textContent,
          disabled: button.disabled,
          title: button.title,
        }
      : null,
    status: element.querySelector(".usage-check-status")?.textContent ?? "",
    reason: element.querySelector(".usage-check-failed")?.textContent ?? "",
    next: element.querySelector(".usage-check-next")?.textContent ?? "",
    more: element.querySelector(".usage-check-detail")?.textContent ?? "",
  };
}

const BUTTON = {
  text: t.usageCheck,
  disabled: false,
  title: t.usageCheckTitle,
};

describe("when the check is offered", () => {
  test.each([
    { name: "claude with no value yet", account: account(), button: BUTTON },
    {
      name: "claude with an old value",
      account: account({
        usage: { ...FRESH, observedAt: NOW - USAGE_STALE_MS - 1 },
      }),
      button: BUTTON,
    },
    {
      name: "claude whose sign-in state is unknown",
      account: account({
        login: { ...account().login, state: "unknown", detail: "sample" },
      }),
      button: BUTTON,
    },
    {
      name: "claude with a fresh value",
      account: account({ usage: FRESH }),
      button: null,
    },
    {
      name: "claude whose status line is not wrapped (turn it on first)",
      account: account({
        usage: {
          status: "unavailable",
          reason: "not-wrapped",
          detail: "",
          observedAt: 0,
        },
      }),
      button: null,
    },
    {
      name: "claude that is signed out (the card offers Sign in)",
      account: account({ login: { ...account().login, state: "logged-out" } }),
      button: null,
    },
    {
      name: "codex (read from its session logs)",
      account: account({
        agent: "codex",
        statusLine: null,
        usage: {
          status: "unavailable",
          reason: "no-sessions",
          detail: "",
          observedAt: 0,
        },
      }),
      button: null,
    },
  ])("$name", ({ account: row, button }) => {
    const { client } = fakeClient();
    const block = shown(usageCheckBlock(row, NOW, client, t));
    expect(block?.button ?? null).toEqual(button);
    // ⋯ のメニューは claude なら値に関係なくある (理由は押した結果で返る)。
    expect(usageCheckMenuItem(row, client, t)?.label ?? null).toBe(
      row.agent === "claude" ? t.usageCheck : null,
    );
  });

  test("pressing starts the check at once (no confirmation)", () => {
    const { client, pressed } = fakeClient();
    const block = usageCheckBlock(account(), NOW, client, t);
    block?.querySelector<HTMLButtonElement>(".usage-check-button")?.click();
    expect(pressed).toEqual(["claude-sample"]);
    usageCheckMenuItem(account(), client, t)?.onSelect();
    expect(pressed).toEqual(["claude-sample", "claude-sample"]);
  });
});

describe("while checking and after", () => {
  test.each([
    {
      name: "checking",
      state: { running: true },
      row: account(),
      want: {
        button: { ...BUTTON, disabled: true },
        status: t.usageChecking,
        reason: "",
        next: "",
        more: "",
      },
    },
    {
      name: "stopped at the trust question: reason, next step and the screen",
      state: { running: false, response: failed("trust") },
      row: account(),
      want: {
        button: BUTTON,
        status: "",
        reason: t.usageCheckFailed.trust,
        next: t.usageCheckNext.trust,
        more: `the claude screen shows "sample marker"\n\n${t.usageCheckEvidence}\nsample line one\nsample line two`,
      },
    },
    {
      name: "timed out",
      state: {
        running: false,
        response: failed("timeout", {
          detail: "no new usage arrived within 60s",
        }),
      },
      row: account(),
      want: {
        button: BUTTON,
        status: "",
        reason: t.usageCheckFailed.timeout,
        next: t.usageCheckNext.timeout,
        more: `no new usage arrived within 60s\n\n${t.usageCheckEvidence}\nsample line one\nsample line two`,
      },
    },
    {
      name: "the request itself failed",
      state: {
        running: false,
        error: "check the usage (HTTP 500): sample failure",
      },
      row: account(),
      want: {
        button: BUTTON,
        status: "",
        reason: t.usageCheckRequestFailed,
        next: "",
        more: "check the usage (HTTP 500): sample failure",
      },
    },
    {
      name: "a failure is dropped once a fresh value arrived another way",
      state: { running: false, response: failed("trust") },
      row: account({ usage: FRESH }),
      want: null,
    },
    {
      name: "got the value but could not close the session",
      state: {
        running: false,
        response: {
          ...failed("trust"),
          status: "ok",
          usage: FRESH,
          closeError: "the tmux session sample is still open",
        } as UsageCheckResponse,
      },
      row: account({ usage: FRESH }),
      want: {
        button: null,
        status: "",
        reason: t.usageCheckCloseFailed,
        next: "",
        more: "the tmux session sample is still open",
      },
    },
  ])("$name", ({ state, row, want }) => {
    const { client } = fakeClient({
      "claude-sample": state as UsageCheckState,
    });
    expect(shown(usageCheckBlock(row, NOW, client, t))).toEqual(want);
  });

  test("the words exist in both languages for every reason", () => {
    for (const text of [ACCOUNTS_EN, ACCOUNTS_JA]) {
      for (const reason of [
        "not-wrapped",
        "onboarding",
        "trust",
        "login",
        "timeout",
        "start-failed",
      ] as const) {
        expect(text.usageCheckFailed[reason]).not.toBe("");
        expect(text.usageCheckNext[reason]).not.toBe("");
      }
    }
    expect(ACCOUNTS_JA.usageChecking).toBe("確かめています…");
  });
});

const DIALOGS: AccountDialogs = {
  add: async () => null,
  login: async () => null,
  rename: async () => null,
  remove: async () => null,
  launch: async () => null,
};

function response(accounts: AccountStatus[]): AccountsResponse {
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

describe("the same part in the card and in Settings", () => {
  test("the account card shows the button and the result inside the card", () => {
    const data = response([
      account(),
      account({
        id: "codex-sample",
        agent: "codex",
        statusLine: null,
        usage: {
          status: "unavailable",
          reason: "no-sessions",
          detail: "",
          observedAt: 0,
        },
      }),
    ]);
    const { client } = fakeClient(
      { "claude-sample": { running: false, response: failed("login") } },
      data,
    );
    const band = createAccountsBand({
      client,
      dialogs: DIALOGS,
      getText: () => t,
      hookStateLabel: (state) => state,
      getOverview: () => null,
      isCollapsed: () => false,
      setCollapsed: () => undefined,
      openSettings: () => undefined,
      requestRender: () => undefined,
    });
    document.body.appendChild(band.element);
    band.render();
    const claude = band.element.querySelector<HTMLElement>(
      '.agents-account-card[data-account="claude-sample"]',
    );
    const codex = band.element.querySelector<HTMLElement>(
      '.agents-account-card[data-account="codex-sample"]',
    );
    expect(shown(claude?.querySelector(".usage-check") ?? null)).toEqual({
      button: BUTTON,
      status: "",
      reason: t.usageCheckFailed.login,
      next: t.usageCheckNext.login,
      more: `the claude screen shows "sample marker"\n\n${t.usageCheckEvidence}\nsample line one\nsample line two`,
    });
    expect(codex?.querySelector(".usage-check")).toBeNull();
  });

  test("the built-in claude card gets a ⋯ menu with only the check", () => {
    // 登録アカウントがあると帯が出る (無ければ入口の 1 行だけ)。
    const data = response([
      account({
        id: "claude:default",
        builtin: true,
        managed: false,
        name: "",
      }),
      account(),
    ]);
    const { client } = fakeClient({}, data);
    const band = createAccountsBand({
      client,
      dialogs: DIALOGS,
      getText: () => t,
      hookStateLabel: (state) => state,
      getOverview: () => null,
      isCollapsed: () => false,
      setCollapsed: () => undefined,
      openSettings: () => undefined,
      requestRender: () => undefined,
    });
    document.body.appendChild(band.element);
    band.render();
    band.element
      .querySelector<HTMLButtonElement>(
        '.agents-account-card[data-account="claude:default"] .agents-account-menu',
      )
      ?.click();
    const items = [
      ...document.querySelectorAll<HTMLElement>(
        ".gdp-context-menu [role=menuitem]",
      ),
    ].map((item) => item.textContent);
    expect(items).toEqual([t.usageCheck]);
  });

  test("the Settings usage row shows the same part", () => {
    const data = response([account()]);
    const { client } = fakeClient({ "claude-sample": { running: true } }, data);
    const settings = createAccountsSettings({
      client,
      dialogs: DIALOGS,
      getText: () => t,
      now: () => NOW,
    });
    document.body.appendChild(settings.element);
    settings.localize();
    const row = settings.element.querySelector<HTMLElement>(
      ".agent-accounts-usage-row",
    );
    expect(shown(row?.querySelector(".usage-check") ?? null)).toEqual({
      button: { ...BUTTON, disabled: true },
      status: t.usageChecking,
      reason: "",
      next: "",
      more: "",
    });
  });
});

describe("the client keeps the state of each check", () => {
  function harness() {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const replies: Array<() => Promise<Response>> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/_agent/accounts/usage-check")) {
        const reply = replies.shift();
        if (!reply) throw new Error("no reply prepared");
        return reply();
      }
      return new Response(JSON.stringify(response([account()])), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const client = createAccountsClient({
      trackLoad: (promise) => promise,
      actionHeaders: () => ({ "X-Code-Viewer-Action": "1" }),
    });
    return {
      client,
      requests,
      replies,
      restore: () => {
        globalThis.fetch = original;
      },
    };
  }

  test.each([
    {
      name: "success clears the state and reloads the list",
      reply: () =>
        new Response(
          JSON.stringify({ ...failed("trust"), status: "ok", usage: FRESH }),
          { status: 200 },
        ),
      after: null,
      reloads: 1,
    },
    {
      name: "a failed check keeps its reason",
      reply: () =>
        new Response(JSON.stringify(failed("trust")), { status: 200 }),
      after: { running: false, response: failed("trust") },
      reloads: 1,
    },
    {
      name: "a refused request keeps the whole reason",
      reply: () =>
        new Response(
          JSON.stringify({ error: "sample refusal", code: "invalid" }),
          {
            status: 400,
            statusText: "Bad Request",
          },
        ),
      after: {
        running: false,
        error:
          "Error: check the usage (HTTP 400 Bad Request): sample refusal (invalid)",
      },
      reloads: 0,
    },
  ])("$name", async ({ reply, after, reloads }) => {
    const h = harness();
    try {
      const gate = deferred<void>();
      h.replies.push(async () => {
        await gate.promise;
        return reply();
      });
      const running = h.client.checkUsage("claude-sample");
      expect(h.client.usageCheck("claude-sample")).toEqual({ running: true });
      // 走っている間にもう一度押しても、2 本目は送らない。
      await h.client.checkUsage("claude-sample");
      gate.resolve();
      await running;
      const posts = h.requests.filter((request) =>
        request.url.includes("/_agent/accounts/usage-check"),
      );
      expect(posts).toHaveLength(1);
      expect(posts[0]?.init?.method).toBe("POST");
      expect(posts[0]?.init?.headers).toEqual({ "X-Code-Viewer-Action": "1" });
      expect(JSON.parse(String(posts[0]?.init?.body))).toEqual({
        id: "claude-sample",
      });
      expect(h.client.usageCheck("claude-sample")).toEqual(after);
      expect(h.requests.length - posts.length).toBe(reloads);
    } finally {
      h.restore();
    }
  });
});
