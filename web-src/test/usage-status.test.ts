// 最下段の使用量と、押すと開くポップオーバー (views/agents/usage-status.ts)。
//
// 落とすと痛いもの:
//
// - 値に「いつの値か」が付かない (古い値を今の値と誤る。agents.md の 5)
// - 未ログインのアカウントに 0% や空のバーを出す (値を作る)
// - 80% 以上を色だけで示す (「注意」の文字が無い)
// - Esc・外側のクリックで閉じない / 閉じたらフォーカスが迷子になる
// - 取り直しの失敗を黙る

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import type { AccountStatus, AccountsResponse } from "../core/agent-accounts";
import type { AccountsSnapshot } from "../views/agents/accounts-client";
import { agentsText } from "../views/agents/i18n";
import { mountUsageStatus } from "../views/agents/usage-status";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const NOW = Date.now();
const MINUTE = 60_000;

function account(
  overrides: Partial<AccountStatus> & Pick<AccountStatus, "id">,
): AccountStatus {
  return {
    agent: "claude",
    name: "",
    configDir: "/home/sample/.claude",
    builtin: true,
    managed: false,
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
      status: "ok",
      observedAt: NOW - 15 * MINUTE,
      windows: [
        {
          kind: "five_hour",
          minutes: 300,
          usedPercent: 42,
          resetsAt: NOW + 118 * MINUTE,
        },
        {
          kind: "seven_day",
          minutes: 10080,
          usedPercent: 81,
          resetsAt: NOW + 3 * 24 * 60 * MINUTE,
        },
      ],
    },
    hooks: "none",
    statusLine: null,
    ...overrides,
  };
}

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

type Harness = {
  root: HTMLElement;
  logins: string[];
  boards: number;
  loads: number;
  setSnapshot(next: AccountsSnapshot): void;
  failNextLoad: string;
};

let harness: Harness;

function mount(accounts: AccountStatus[]): void {
  document.body.style.setProperty("--space-4", "16px");
  const root = document.createElement("div");
  root.id = "usage-status";
  document.body.appendChild(root);
  const listeners = new Set<() => void>();
  let snapshot: AccountsSnapshot = { data: response(accounts), error: "" };
  const h: Harness = {
    root,
    logins: [],
    boards: 0,
    loads: 0,
    failNextLoad: "",
    setSnapshot(next) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
  mountUsageStatus({
    root,
    client: {
      snapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async load() {
        h.loads += 1;
        if (h.failNextLoad) {
          h.setSnapshot({ data: snapshot.data, error: h.failNextLoad });
          h.failNextLoad = "";
        }
      },
    },
    getText: () => agentsText("en"),
    openSettings: () => undefined,
    openBoard: () => {
      h.boards += 1;
    },
    login: async (target) => {
      h.logins.push(target.id);
      return "Sign-in opened";
    },
  });
  harness = h;
}

function popover(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".usage-popover");
}

function openPopover(): HTMLElement {
  const item =
    harness.root.querySelector<HTMLButtonElement>(".usage-status-item");
  if (!item) throw new Error("no usage item");
  item.click();
  const panel = popover();
  if (!panel) throw new Error("popover did not open");
  return panel;
}

beforeEach(() => {
  document.body.replaceChildren();
  document.body.removeAttribute("style");
});
afterEach(() => {
  document.body.replaceChildren();
  document.getElementById("usage-popover-placement-style")?.remove();
});

describe("the usage popover", () => {
  test("every account block says when its value is from", () => {
    const text = agentsText("en").accounts;
    mount([
      account({ id: "claude:default" }),
      account({
        id: "codex:personal",
        agent: "codex",
        builtin: false,
        name: "Personal",
        login: {
          state: "logged-out",
          who: "",
          whoDetail: "",
          method: "",
          plan: "",
          detail: "",
          checkedAt: NOW - 5 * MINUTE,
        },
        usage: {
          status: "unavailable",
          reason: "no-sessions",
          detail: "",
          observedAt: 0,
        },
      }),
    ]);
    const panel = openPopover();
    const observed = [...panel.querySelectorAll(".usage-popover-observed")].map(
      (node) => node.textContent,
    );
    expect(observed).toEqual([
      text.observed(text.duration(15 * MINUTE)),
      text.loginChecked(text.duration(5 * MINUTE)),
    ]);
  });

  test("the status bar shows every window, and marks values mixed with another account", () => {
    mount([
      account({ id: "claude:default" }),
      account({
        id: "codex:default",
        agent: "codex",
        usage: {
          status: "ok",
          observedAt: NOW - MINUTE,
          windows: [
            {
              kind: "seven_day",
              minutes: 10080,
              usedPercent: 97,
              resetsAt: NOW + 2 * 24 * 60 * MINUTE,
            },
          ],
          mixed: {
            observedAt: NOW - MINUTE,
            windows: [
              {
                kind: "seven_day",
                minutes: 10080,
                usedPercent: 0,
                resetsAt: NOW + 7 * 24 * 60 * MINUTE,
              },
            ],
          },
        },
      }),
    ]);
    const items = [...harness.root.querySelectorAll(".usage-status-item")];
    expect(items).toHaveLength(2);
    const claudeWindows = [
      ...(items[0]?.querySelectorAll(".usage-status-window") ?? []),
    ].map((el) => el.textContent);
    expect(claudeWindows).toEqual(["5h42%", "week81%"]);
    expect(items[0]?.querySelector(".usage-status-mixed")).toBeNull();
    const codexMixed = items[1]?.querySelector(".usage-status-mixed");
    expect(codexMixed?.textContent).toBe("Mixed");
    expect(items[1]?.getAttribute("title")).toContain("Week 0%");
  });

  test("a signed-out account gets no bars and no percentage, only the sign-in", () => {
    mount([
      account({
        id: "codex:personal",
        agent: "codex",
        login: {
          state: "logged-out",
          who: "",
          whoDetail: "",
          method: "",
          plan: "",
          detail: "",
          checkedAt: NOW,
        },
      }),
    ]);
    // 最下段の塊は値があるときだけなので、ポップオーバーは値のあるもう 1 つから開く。
    harness.setSnapshot({
      data: response([
        account({ id: "claude:default" }),
        account({
          id: "codex:personal",
          agent: "codex",
          login: {
            state: "logged-out",
            who: "",
            whoDetail: "",
            method: "",
            plan: "",
            detail: "",
            checkedAt: NOW,
          },
        }),
      ]),
      error: "",
    });
    const panel = openPopover();
    const blocks = panel.querySelectorAll(".usage-popover-account");
    const signedOut = blocks[1];
    expect(signedOut?.querySelector(".usage-meter")).toBeNull();
    expect(signedOut?.textContent).not.toContain("%");
    signedOut?.querySelector<HTMLButtonElement>(".usage-popover-link")?.click();
    expect(harness.logins).toEqual(["codex:personal"]);
  });

  test.each([
    [79, false],
    [80, true],
    [91, true],
  ])("%i%% is marked High in words, not only in color: %s", (percent, warn) => {
    mount([
      account({
        id: "claude:default",
        usage: {
          status: "ok",
          observedAt: NOW,
          windows: [
            {
              kind: "five_hour",
              minutes: 300,
              usedPercent: percent,
              resetsAt: NOW + MINUTE * 30,
            },
          ],
        },
      }),
    ]);
    const meter = openPopover().querySelector(".usage-meter");
    expect(meter?.classList.contains("warn")).toBe(warn);
    expect(meter?.querySelector(".usage-meter-warn")?.textContent ?? "").toBe(
      warn ? "High" : "",
    );
  });

  test("Escape closes it and gives the focus back to the usage in the status bar", () => {
    mount([account({ id: "claude:default" })]);
    const panel = openPopover();
    panel.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(popover()).toBeNull();
    expect(
      document.activeElement?.classList.contains("usage-status-item"),
    ).toBe(true);
  });

  test.each([
    "Enter",
    " ",
  ])("the %j key on the status-bar usage opens it", (key) => {
    mount([account({ id: "claude:default" })]);
    const item =
      harness.root.querySelector<HTMLButtonElement>(".usage-status-item");
    item?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(popover()).not.toBeNull();
  });

  test("a press outside closes it; a press inside does not", () => {
    mount([account({ id: "claude:default" })]);
    const panel = openPopover();
    panel.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(popover()).not.toBeNull();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(popover()).toBeNull();
  });

  test("the popover keeps the surface inset from the viewport edge", () => {
    mount([account({ id: "claude:default" })]);
    document.body.style.setProperty("--space-4", "calc(4px * 4)");
    const style = document.createElement("style");
    style.id = "usage-popover-placement-style";
    style.textContent = ".usage-popover-head { padding: 16px; }";
    document.head.appendChild(style);
    harness.root.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 900,
        top: 900,
        right: 0,
        bottom: 928,
        left: 0,
        width: 0,
        height: 28,
        toJSON: () => ({}),
      }) as DOMRect;
    expect(openPopover().style.left).toBe("16px");
  });

  test("a failed check-again is shown with its reason", async () => {
    mount([account({ id: "claude:default" })]);
    const panel = openPopover();
    harness.failNextLoad = "GET /_agent/accounts failed: 500";
    panel.querySelector<HTMLButtonElement>(".usage-popover-refresh")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.loads).toBe(1);
    expect(popover()?.textContent).toContain(
      "GET /_agent/accounts failed: 500",
    );
  });
});

describe("usage collection that is off", () => {
  test("the popover links to the account card, where it can be turned on", () => {
    const text = agentsText("en").accounts;
    mount([
      account({ id: "claude:default" }),
      account({
        id: "claude:work",
        builtin: false,
        name: "Work",
        usage: {
          status: "unavailable",
          reason: "not-wrapped",
          detail: "",
          observedAt: 0,
        },
      }),
    ]);
    const panel = openPopover();
    const link = panel.querySelector<HTMLButtonElement>(
      ".usage-popover-enable",
    );
    expect(link?.textContent).toBe(`${text.usagePopoverEnable} →`);
    expect(panel.textContent).toContain(text.usageReason["not-wrapped"]);
    link?.click();
    expect(harness.boards).toBe(1);
    // 移ったら小窓は閉じる。
    expect(popover()).toBeNull();
  });
});
