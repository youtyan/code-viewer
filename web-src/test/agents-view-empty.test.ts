// 全体ボードでエージェントが 1 つも居ないときの案内 (views/agents/agents-view.ts
// の noAgentsState、共通の部品 views/empty-state.ts)。次にやること (新しい
// エージェント・プロジェクトの登録) と、ボードへ戻るキー。ペインはあるが
// エージェントでないだけなら、登録の代わりに今までの「すべてのペインを表示」。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AgentOverviewResponse, AgentPane } from "../core/agent-overview";
import type { AgentMonitor } from "../views/agents/agent-monitor";
import { createAgentsView } from "../views/agents/agents-view";
import { agentsText } from "../views/agents/i18n";
import type { PanePreview } from "../views/agents/pane-preview";
import type { ProjectActions } from "../views/projects/project-actions";
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
) {
  document.body.innerHTML = '<main id="content"></main>';
  const calls: string[] = [];
  const snapshot = {
    overview: overview(panes),
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
    permission: () => "granted",
    requestPermission: async () => "granted",
  };
  const projects: ProjectActions = {
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
    onVisibilityChange: () => undefined,
    projects,
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
