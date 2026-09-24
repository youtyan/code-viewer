// New agent のダイアログ。「実行するコマンド」は開いた時点の写しではなく、今の
// 起動コマンドを出す (設定の保存が別の画面で起きても、開き直さずに合う)。
// 後半はアカウントの一覧の使用量と、「別のアカウントで続ける」の形。
// パス・名前はすべて架空。

import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { AccountStatus, AccountsResponse } from "../core/agent-accounts";
import type { AgentOverviewResponse } from "../core/agent-overview";
import type { AccountsClient } from "../views/agents/accounts-client";
import { createAccountDialogs } from "../views/agents/accounts-dialogs";
import {
  ACCOUNTS_EN,
  ACCOUNTS_JA,
  type AccountsText,
} from "../views/agents/accounts-i18n";
import { agentPane } from "./_test-helpers";

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

// ---- アカウントの一覧の使用量と、「別のアカウントで続ける」 ----

const NOW = Date.parse("2026-09-24T12:00:00Z");
const MINUTE = 60_000;

function account(
  over: Partial<AccountStatus> & Pick<AccountStatus, "id" | "name">,
): AccountStatus {
  const base = response("claude").accounts[0];
  if (!base) throw new Error("the sample response has no account");
  return {
    ...base,
    builtin: false,
    managed: true,
    configDir: `/home/sample/.local/state/code-viewer/accounts/${over.name}`,
    ...over,
  };
}

const usageOk = (
  observedAt: number,
  five: number,
  week: number,
): AccountStatus["usage"] => ({
  status: "ok",
  observedAt,
  windows: [
    {
      kind: "five_hour",
      minutes: 300,
      usedPercent: five,
      resetsAt: NOW + 90 * MINUTE,
    },
    {
      kind: "seven_day",
      minutes: 10_080,
      usedPercent: week,
      resetsAt: NOW + 3 * 24 * 60 * MINUTE,
    },
  ],
});

/** claude 3 つ・codex 1 つ。使用量は ok・古い値・取れない・未ログイン。 */
function accountsResponse(): AccountsResponse {
  const data = response("claude");
  const [builtin] = data.accounts;
  if (!builtin) throw new Error("the sample response has no account");
  return {
    ...data,
    accounts: [
      { ...builtin, usage: usageOk(NOW - 5 * MINUTE, 42, 81) },
      account({
        id: "claude:work",
        name: "Work",
        usage: usageOk(NOW - 120 * MINUTE, 10, 20),
      }),
      account({
        id: "claude:spare",
        name: "Spare",
        login: { ...builtin.login, state: "logged-out", checkedAt: NOW },
      }),
      account({
        id: "codex:default",
        agent: "codex",
        name: "",
        builtin: true,
        configDir: "/home/sample/.codex",
        usage: {
          status: "unavailable",
          reason: "no-sessions",
          detail: "",
          observedAt: 0,
        },
      }),
    ],
  };
}

function launchClient(data: AccountsResponse) {
  const launched: unknown[] = [];
  const client: AccountsClient = {
    ...fakeClient().client,
    snapshot: () => ({ data, error: "" }),
    subscribe: () => () => undefined,
    load: async () => undefined,
    launch: async (request) => {
      launched.push(request);
      return {
        paneId: "%9",
        session: "sample-session",
        created: false,
        command: "claude",
        rememberError: "",
      };
    },
  };
  return { client, launched };
}

function openDialog(
  data: AccountsResponse,
  options: Parameters<ReturnType<typeof createAccountDialogs>["launch"]>[0],
  text: AccountsText = ACCOUNTS_EN,
  overview: AgentOverviewResponse | null = null,
) {
  const { client, launched } = launchClient(data);
  const opened: string[] = [];
  const dialogs = createAccountDialogs({
    client,
    getText: () => text,
    openPane: (pane) => opened.push(pane),
    getOverview: () => overview,
    serverRoot: () => "/home/sample/work/sample-app",
    refreshOverview: async () => undefined,
  });
  const closed = dialogs.launch(options);
  return { closed, launched, opened };
}

/** 一覧の各行: 名前・札・いつの値か・使用量の行 (または理由)。 */
function accountRows() {
  return [
    ...document.querySelectorAll<HTMLElement>(".agent-launch-account"),
  ].map((row) => ({
    name: row.querySelector(".agent-launch-account-name")?.textContent,
    current:
      row.querySelector(".agent-launch-account-current")?.textContent ?? "",
    observed: row.querySelector(".agent-launch-account-observed")?.textContent,
    usage: [
      ...row.querySelectorAll(".usage-meter, .agent-launch-account-status"),
    ].map((line) =>
      line.classList.contains("usage-meter")
        ? `${line.querySelector(".usage-meter-name")?.textContent} ${line.querySelector(".usage-meter-value")?.textContent}`
        : line.textContent,
    ),
    checked: row.getAttribute("aria-checked"),
  }));
}

function cancel() {
  document
    .querySelector<HTMLButtonElement>(".gdp-dialog .gdp-dialog-cancel")
    ?.click();
}

describe("起動の画面のアカウントの一覧", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("選んだ種類のアカウントを、使用量といつの値かと一緒に並べる", async () => {
    const { closed } = openDialog(accountsResponse(), {});
    expect(accountRows()).toEqual([
      {
        name: "Default",
        current: "",
        observed: "as of 5m ago",
        usage: ["5h 42%", "week 81%High"],
        checked: "true",
      },
      {
        name: "Work",
        current: "",
        observed: "old value · 2h 0m ago",
        usage: ["5h 10%", "week 20%"],
        checked: "false",
      },
      {
        name: "Spare",
        current: "",
        observed: "Checked just now",
        usage: ["Not signed in"],
        checked: "false",
      },
    ]);
    // 種類を codex にすると codex のアカウントだけ (取れない理由を 1 行で)
    [...document.querySelectorAll<HTMLButtonElement>(".seg button")]
      .find((button) => button.textContent === "codex")
      ?.click();
    expect(accountRows().map((row) => [row.name, row.usage])).toEqual([
      ["Default", ["Usage unavailable · No codex session yet"]],
    ]);
    cancel();
    await closed;
  });

  test("行を押す・上下の矢印で選び直し、実行するコマンドが追いかける", async () => {
    const { closed } = openDialog(accountsResponse(), {});
    const rows = () => [
      ...document.querySelectorAll<HTMLElement>(".agent-launch-account"),
    ];
    rows()[1]?.click();
    expect(preview()).toBe(
      "CLAUDE_CONFIG_DIR=~/.local/state/code-viewer/accounts/Work claude",
    );
    rows()[1]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect([
      accountRows().map((row) => row.checked),
      document.activeElement?.getAttribute("data-account"),
      preview(),
    ]).toEqual([
      ["false", "false", "true"],
      "claude:spare",
      "CLAUDE_CONFIG_DIR=~/.local/state/code-viewer/accounts/Spare claude",
    ]);
    cancel();
    await closed;
  });
});

describe("別のアカウントで続ける (起動の画面を引き継ぎの形で開く)", () => {
  const LOG = "/home/sample/.claude/projects/-work-sample-lib/sample.jsonl";
  const from = agentPane({
    id: "%4",
    session: "sample-agents",
    path: "/home/sample/work/sample-lib/src",
    kind: "claude",
    account: { kind: "registered", id: "claude:work" },
    conversation: {
      sessionId: "abc123",
      transcriptPath: LOG,
      cwd: "/home/sample/work/sample-lib",
    },
  });

  test("前の担当と違うアカウントを選び、フォルダとセッションを合わせ、指示と --add-dir を渡す", async () => {
    const { closed, launched, opened } = openDialog(accountsResponse(), {
      handoff: from,
    });
    const dialog = document.querySelector<HTMLElement>(".gdp-dialog");
    const prompt = `Take over the work of the previous agent (claude · Work). Its conversation log is at ${LOG} (JSONL). Read the last request and how far it got, then continue the work. If anything is unclear, ask before you start.`;
    expect({
      title: dialog?.querySelector(".gdp-dialog-title")?.textContent,
      intro: dialog?.querySelector(".gdp-dialog-description")?.textContent,
      log: dialog?.querySelector(".agent-launch-log")?.textContent,
      rows: accountRows().map((row) => [row.name, row.current, row.checked]),
      project: document.querySelector<HTMLSelectElement>(
        ".agent-launch-choice-select",
      )?.value,
      session: document.querySelector<HTMLInputElement>(
        ".agent-launch-row input",
      )?.value,
      preview: preview(),
      submit: dialog?.querySelector(".gdp-dialog-confirm")?.textContent,
    }).toEqual({
      title: "Continue with another account",
      intro:
        "Start an agent with another account. It reads the conversation log of claude · Work and continues the work.",
      log: "~/.claude/projects/-work-sample-lib/sample.jsonl",
      rows: [
        ["Default", "", "true"],
        ["Work", "in use now", "false"],
        ["Spare", "", "false"],
      ],
      project: "/home/sample/work/sample-lib",
      session: "sample-agents",
      preview: `claude '${prompt}' --add-dir /home/sample/.claude/projects/-work-sample-lib`,
      submit: "Start and hand over",
    });
    dialog?.querySelector<HTMLButtonElement>(".gdp-dialog-confirm")?.click();
    await closed;
    // 画面が送るのはペイン・言語・前の担当の名前だけ (記録の場所はサーバが
    // フックの記録から引く)。
    expect([launched, opened]).toEqual([
      [
        {
          accountId: "claude:default",
          project: "/home/sample/work/sample-lib",
          session: "sample-agents",
          handoff: { pane: "%4", language: "en", fromAccount: "Work" },
        },
      ],
      ["%9"],
    ]);
  });

  test("codex を選ぶと --add-dir を付けず、画面の言語の指示を渡す", async () => {
    const { closed, launched } = openDialog(
      accountsResponse(),
      { handoff: from },
      ACCOUNTS_JA,
    );
    [...document.querySelectorAll<HTMLButtonElement>(".seg button")]
      .find((button) => button.textContent === "codex")
      ?.click();
    expect(preview()).toBe(
      `codex '前の担当（claude・Work）の作業を引き継いでください。前の担当の会話記録は ${LOG}（JSONL）にあります。最後の依頼と、どこまで進んだかを読んで、続きをやってください。わからないことは、作業を始める前に聞いてください。'`,
    );
    document
      .querySelector<HTMLButtonElement>(".gdp-dialog .gdp-dialog-confirm")
      ?.click();
    await closed;
    expect(launched).toEqual([
      {
        accountId: "codex:default",
        project: "/home/sample/work/sample-lib",
        session: "sample-agents",
        handoff: { pane: "%4", language: "ja", fromAccount: "Work" },
      },
    ]);
  });

  test("会話記録の場所の無いペインでは開かない", async () => {
    await expect(
      openDialog(accountsResponse(), {
        handoff: { ...from, conversation: undefined },
      }).closed,
    ).rejects.toThrow("launch dialog: %4 has no conversation log to hand over");
    expect(document.querySelector(".gdp-dialog")).toBeNull();
  });
});
