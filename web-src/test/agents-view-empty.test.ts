// 全体ボードでエージェントが 1 つも居ないときの案内 (views/agents/agents-view.ts
// の noAgentsState、共通の部品 views/empty-state.ts)。次にやること (新しい
// エージェント・プロジェクトの登録) と、ボードへ戻るキー。ペインはあるが
// エージェントでないだけなら、登録の代わりに今までの「すべてのペインを表示」。
// 起動中でない登録プロジェクトは、左のサイドバーと同じ判定で下の「停止中」へ。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type {
  AgentOverviewResponse,
  AgentPane,
  AgentProjectInfo,
} from "../core/agent-overview";
import type { AgentMonitor } from "../views/agents/agent-monitor";
import { createAgentsView } from "../views/agents/agents-view";
import { agentsText } from "../views/agents/i18n";
import type { PanePreview } from "../views/agents/pane-preview";
import type { ProjectActions } from "../views/projects/project-actions";
import { info, overview as overviewWith } from "./_agents-sidebar-fixture";
import { agentPane } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

function overview(panes: AgentPane[]): AgentOverviewResponse {
  return {
    serverInstance: "sample",
    observedAt: 0,
    tmux: { available: true, running: true, error: "" },
    panes,
    projects: [],
    errors: [],
    registry: { projects: [], error: "", path: "/state/projects.json" },
  };
}

async function mountBoard(
  panes: AgentPane[],
  lang: "en" | "ja" = "en",
  preview?: PanePreview,
  projects?: AgentProjectInfo[],
  extra: {
    permission?: "granted" | "denied" | "default" | "unsupported";
    tmux?: AgentOverviewResponse["tmux"];
  } = {},
) {
  document.body.innerHTML = '<main id="content"></main>';
  const calls: string[] = [];
  const base = projects ? overviewWith(panes, projects) : overview(panes);
  const snapshot = {
    overview: extra.tmux ? { ...base, tmux: extra.tmux } : base,
    error: "",
    notifyError: "",
    unread: new Map(),
    sawWaiting: false,
    permissionAsked: false,
  };
  const monitor: AgentMonitor = {
    start: () => undefined,
    refresh: async () => undefined,
    snapshot: () => snapshot,
    subscribe: () => () => undefined,
    markRead: () => undefined,
    permission: () => extra.permission ?? "granted",
    requestPermission: async () => "granted",
  };
  const actions: ProjectActions = {
    activity: () => null,
    signature: () => "",
    dismiss: () => undefined,
    subscribe: () => () => undefined,
    open: async () => undefined,
    registerCurrent: async () => undefined,
    registerRoot: async () => undefined,
    registerByPath: async () => {
      calls.push("register");
    },
    unregister: async () => undefined,
    rename: async () => undefined,
    recolor: async () => undefined,
    move: async () => undefined,
    place: async () => undefined,
    stop: async () => undefined,
  };
  const view = createAgentsView({
    monitor,
    getText: () => agentsText(lang),
    setPageMode: () => undefined,
    syncHeaderMenu: () => undefined,
    openPane: () => undefined,
    openNotificationSettings: () => undefined,
    reloadPage: () => {
      calls.push("reload");
    },
    tmuxInstallHelp: () => {
      calls.push("tmux-help");
      const box = document.createElement("div");
      box.className = "sample-install-help";
      return box;
    },
    getHookStatus: () => null,
    refreshHookStatus: async () => undefined,
    hookHintDismissed: () => true,
    dismissHookHint: () => undefined,
    openHookSettings: () => undefined,
    accountsBand: {
      element: document.createElement("div"),
      render: () => undefined,
      signature: () => "",
    },
    getAccounts: () => null,
    launch: () => {
      calls.push("launch");
    },
    handoff: {
      handoff: (pane) => {
        calls.push(`handoff:${pane.id}`);
      },
      openHookHelp: () => {
        calls.push("hook-help");
      },
      hookState: () => null,
    },
    onVisibilityChange: () => undefined,
    projects: actions,
    preview,
  });
  await view.enter();
  return { view, calls };
}

async function board(panes: AgentPane[], lang: "en" | "ja" = "en") {
  const { calls } = await mountBoard(panes, lang);
  const empty = document.querySelector<HTMLElement>(".empty-state");
  if (!empty) throw new Error("no empty state on the board");
  return { empty, calls };
}

const actions = (empty: HTMLElement) =>
  [...empty.querySelectorAll<HTMLButtonElement>(".empty-action")].map(
    (button) => button.textContent,
  );

describe("the board with no agents", () => {
  test.each([
    {
      name: "no panes at all: New agent and register a project",
      panes: [],
      lang: "en" as const,
      expected: ["New agent", "Register a project…"],
    },
    {
      name: "日本語",
      panes: [],
      lang: "ja" as const,
      expected: [agentsText("ja").accounts.launchButton, "プロジェクトを登録…"],
    },
    {
      name: "only plain shells: New agent and show all panes (as before)",
      panes: [agentPane({ id: "%1", kind: null, command: "zsh" })],
      lang: "en" as const,
      expected: ["New agent", "Show all panes"],
    },
  ])("$name", async ({ panes, lang, expected }) => {
    const { empty } = await board(panes, lang);
    expect([
      empty.querySelector("h2")?.textContent,
      actions(empty),
      [...empty.querySelectorAll(".empty-key kbd")].map(
        (key) => key.textContent,
      ),
    ]).toEqual([agentsText(lang).emptyNoAgentsTitle, expected, ["g", "a"]]);
  });

  test("the actions start a new agent and register a project", async () => {
    const { empty, calls } = await board([]);
    for (const button of empty.querySelectorAll<HTMLButtonElement>(
      ".empty-action",
    ))
      button.click();
    expect(calls).toEqual(["launch", "register"]);
  });
});

// 全体ボードの行も左のサイドバーと同じ覗き窓に載る (行の下に出す)。画面を
// 離れたら見張りを外す。
describe("the board rows and the screen preview", () => {
  test("rows are watched below while the board is shown, and let go when it is left", async () => {
    const watched: string[] = [];
    const preview: PanePreview = {
      watch(container, options) {
        watched.push(`watch ${container.className} ${options.placement}`);
        return () => watched.push("unwatch");
      },
      hide: () => undefined,
      setPaused: () => undefined,
      current: () => null,
    };
    const { view } = await mountBoard(
      [agentPane({ id: "%1", title: "Review plan", label: "work:0.0" })],
      "en",
      preview,
    );
    const row = document.querySelector<HTMLElement>(".agents-row");
    expect([
      row?.getAttribute("data-preview-pane"),
      row?.getAttribute("data-preview-name"),
    ]).toEqual(["%1", "claude · Review plan · work:0.0"]);
    view.suspend();
    expect(watched).toEqual(["watch agents-list below", "unwatch"]);
  });
});

describe("the board and stopped projects", () => {
  test("registered projects that are not running fold into Not running (n) at the bottom", async () => {
    const app = info("/work/sample-app", 0, { status: "current" });
    await mountBoard(
      [agentPane({ id: "%1", project: app.root, path: app.root })],
      "en",
      undefined,
      [
        app,
        info("/work/sample-lib", 1),
        info("/work/sample-docs", 2, {
          status: "running",
          url: "/p/docs/",
          launched: true,
        }),
      ],
    );
    const names = (scope: Element | null) =>
      [
        ...(scope?.querySelectorAll(
          ":scope > .agents-project .agents-project-name",
        ) ?? []),
      ].map((el) => el.textContent);
    const list = document.querySelector(".agents-list");
    const stopped = () =>
      document.querySelector<HTMLElement>(".agents-stopped-list");
    const toggle = document.querySelector<HTMLButtonElement>(
      ".agents-stopped-toggle",
    );

    expect({
      running: names(list),
      toggle: toggle?.textContent,
      expanded: toggle?.getAttribute("aria-expanded"),
      hidden: stopped()?.hidden,
    }).toEqual({
      running: ["sample-app", "sample-docs"],
      toggle: "Not running (1)",
      expanded: "false",
      hidden: true,
    });

    toggle?.click();
    expect({ hidden: stopped()?.hidden, names: names(stopped()) }).toEqual({
      hidden: false,
      names: ["sample-lib"],
    });
  });
});

// 行の右クリックのメニュー (左のサイドバーの行と同じ項目。有効・無効の表は
// agents-sidebar.test.ts)。このファイルの mountBoard を使い回す。
describe("the board row context menu", () => {
  test.each([
    {
      name: "会話記録の場所があれば引き継げる",
      conversation: {
        sessionId: "abc123",
        transcriptPath: "/home/sample/log/sample.jsonl",
        cwd: "/work/sample",
      },
      labels: [
        "Open in a tab",
        "Open in the opposite pane",
        "Continue with another account…",
      ],
      click: "Continue with another account…",
      calls: ["handoff:%1"],
    },
    {
      name: "フックが無ければ入れ方へ",
      conversation: undefined,
      labels: [
        "Open in a tab",
        "Open in the opposite pane",
        "Continue with another account…",
        "Needs the agent hooks — show how to install",
      ],
      click: "Needs the agent hooks — show how to install",
      calls: ["hook-help"],
    },
  ])("$name", async ({ conversation, labels, click, calls: expected }) => {
    const { calls } = await mountBoard([
      agentPane({ id: "%1", state: "waiting", conversation }),
    ]);
    const row = document.querySelector<HTMLElement>(".agents-row");
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    row?.dispatchEvent(event);
    const items = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".gdp-context-menu button",
      ),
    ];
    expect([
      event.defaultPrevented,
      items.map((item) => item.textContent),
    ]).toEqual([true, labels]);
    items.find((item) => item.textContent === click)?.click();
    expect(calls).toEqual(expected);
  });
});

describe("entries next to the words", () => {
  test("blocked notifications: says a page cannot change it, and offers Reload", async () => {
    const { calls } = await mountBoard([], "ja", undefined, undefined, {
      permission: "denied",
    });
    const text = agentsText("ja");
    expect(document.querySelector(".agents-notify-help")?.textContent).toBe(
      text.notifyDeniedHelp,
    );
    const reload = document.querySelector<HTMLButtonElement>(
      ".agents-notify-reload",
    );
    expect(reload?.textContent).toBe(text.notifyReload);
    reload?.click();
    expect(calls).toContain("reload");
  });

  test("tmux not found: the board adds how to install it under the words", async () => {
    const { calls } = await mountBoard([], "en", undefined, undefined, {
      tmux: { available: false, running: false, error: "" },
    });
    expect(calls).toContain("tmux-help");
    const empty = document.querySelector(".empty-state");
    expect(empty?.textContent).toContain(
      agentsText("en").emptyNotInstalledBody,
    );
    expect(empty?.nextElementSibling?.className).toBe("sample-install-help");
  });
});
