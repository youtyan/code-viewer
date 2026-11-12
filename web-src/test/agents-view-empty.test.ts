// 全体ボードでエージェントが 1 つも居ないときの案内 (views/agents/agents-view.ts
// の noAgentsState、共通の部品 views/empty-state.ts)。次にやること (新しい
// エージェント・プロジェクトの登録) と、ボードへ戻るキー。ペインはあるが
// エージェントでないだけなら、登録の代わりに今までの「すべてのペインを表示」。
// 起動中でない登録プロジェクトは、左のサイドバーと同じ判定で下の「停止中」へ。

import "./_dom";
import { describe, expect, test } from "vitest";
import type { AgentPane } from "../core/agent-overview";
import {
  type AgentsBoardViewProps,
  DEFAULT_VIEW as BOARD_DEFAULT_VIEW,
  type BoardOrder,
} from "../views/agents/agents-view";
import { agentsText } from "../views/agents/i18n";
import type { PanePreview } from "../views/agents/pane-preview";
import { flushRenders } from "../views/ui/render-queue";
import { mountBoard } from "./_agents-board";
import { info } from "./_agents-sidebar-fixture";
import { agentPane } from "./_test-helpers";

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
        "Pin to the top",
        "Mark as unread",
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
        "Pin to the top",
        "Mark as unread",
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

// presenter (agents-presenter.ts) を、表示を差し替えて確かめる。描いた後にフォーカスの
// 戻し先と一覧の箱を読むので、差し替える view は渡された値を記録してから既定の表示に
// 渡す。見るのは view に渡す値と、絞り込み・起動 (モデルの呼び出し)。
describe("agents board presenter", () => {
  async function mountWithView(
    panes: AgentPane[],
    boardOrder?: { get(): BoardOrder | null; set(order: BoardOrder): void },
    pins?: {
      serverPins: string[];
      setPinned: (pane: string, on: boolean) => void;
    },
  ) {
    const seen: AgentsBoardViewProps[] = [];
    const mounted = await mountBoard(panes, "en", undefined, undefined, {
      boardOrder,
      ...pins,
      view: (props) => {
        seen.push(props);
        return BOARD_DEFAULT_VIEW(props);
      },
    });
    return { ...mounted, last: () => seen[seen.length - 1] };
  }

  const panes = () => [
    agentPane({
      id: "%1",
      label: "work:0.0",
      session: "work",
      title: "task 1",
      path: "/work/sample-app",
      state: "waiting",
      source: "screen",
      project: "/work/sample-app",
      kind: "claude",
    }),
  ];

  test("the agents reach the view grouped by project, with the filter counts", async () => {
    const { last } = await mountWithView(panes());
    const props = last();
    expect({
      count: props.board.count,
      filters: props.board.filters.map((item) => [item.filter, item.count]),
      projects: props.list
        .filter((entry) => entry.kind === "project")
        .map((entry) =>
          entry.kind === "project"
            ? [entry.project.name, entry.project.rows.map((row) => row.id)]
            : null,
        ),
    }).toEqual({
      count: 1,
      filters: [
        ["all", 1],
        ["waiting", 1],
        ["working", 0],
        ["idle", 0],
      ],
      projects: [["sample-app", ["%1"]]],
    });
  });

  test("a filter picked in the view narrows the next draw", async () => {
    const { last } = await mountWithView(panes());
    last().onFilter("working");
    expect([
      last().board.filters.find((item) => item.active)?.filter,
      last().list.some((entry) => entry.kind === "project"),
    ]).toEqual(["working", false]);
  });

  test("launching from the view starts a new agent", async () => {
    const { last, calls } = await mountWithView(panes());
    last().onLaunch();
    expect(calls).toEqual(["launch"]);
  });

  test("Pin to the top puts the row in a Pinned section first, in either order, until unpinned", async () => {
    const { last } = await mountWithView([
      agentPane({
        id: "%1",
        label: "work:0.1",
        state: "waiting",
        project: "/work/sample-app",
        kind: "claude",
      }),
      agentPane({
        id: "%2",
        label: "work:0.2",
        state: "idle",
        project: "/work/sample-lib",
        kind: "claude",
      }),
    ]);
    const menu = (id: string) => {
      document
        .querySelector<HTMLElement>(`[data-agent-nav="pane:${id}"]`)
        ?.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      return [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".gdp-context-menu button",
        ),
      ];
    };
    const sections = () =>
      last().list.flatMap((entry) =>
        entry.kind === "section"
          ? [[entry.state, entry.rows.map((row) => row.id)]]
          : entry.kind === "project"
            ? [[entry.project.name, entry.project.rows.map((row) => row.id)]]
            : [],
      );
    menu("%2")
      .find((item) => item.textContent === "Pin to the top")
      ?.click();
    await flushRenders();
    expect(sections()).toEqual([
      [null, ["%2"]],
      ["sample-app", ["%1"]],
    ]);
    last().onOrder("urgency");
    await flushRenders();
    expect(sections()).toEqual([
      [null, ["%2"]],
      ["waiting", ["%1"]],
    ]);
    menu("%2")
      .find((item) => item.textContent === "Unpin")
      ?.click();
    await flushRenders();
    expect(sections()).toEqual([
      ["waiting", ["%1"]],
      ["idle", ["%2"]],
    ]);
  });

  test("with a server that keeps pins, pinning goes to the server and a board opened later shows it", async () => {
    const sent: [string, boolean][] = [];
    const server: string[] = [];
    const twoPanes = [
      agentPane({
        id: "%1",
        label: "work:0.1",
        state: "waiting",
        project: "/work/sample-app",
        kind: "claude",
      }),
      agentPane({
        id: "%2",
        label: "work:0.2",
        state: "idle",
        project: "/work/sample-lib",
        kind: "claude",
      }),
    ];
    const pinnedRows = (props: AgentsBoardViewProps) =>
      props.list.flatMap((entry) =>
        entry.kind === "section" && entry.state === null
          ? entry.rows.map((row) => row.id)
          : [],
      );
    const { last } = await mountWithView(twoPanes, undefined, {
      serverPins: server,
      setPinned: (pane, on) => {
        sent.push([pane, on]);
        if (on) server.push(pane);
      },
    });
    document
      .querySelector<HTMLElement>('[data-agent-nav="pane:%2"]')
      ?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".gdp-context-menu button",
      ),
    ]
      .find((item) => item.textContent === "Pin to the top")
      ?.click();
    await flushRenders();
    expect(sent).toEqual([["%2", true]]);
    expect(pinnedRows(last())).toEqual(["%2"]);

    // 別の窓 (読み直した画面) でも、サーバの一覧のピンで留まって見える。
    const again = await mountWithView(twoPanes, undefined, {
      serverPins: server,
      setPinned: () => undefined,
    });
    expect(pinnedRows(again.last())).toEqual(["%2"]);
  });

  test("in the urgency order a section counts only its own state, not the parent lifted in by a child", async () => {
    const { last } = await mountWithView([
      agentPane({
        id: "%1",
        label: "work:0.1",
        state: "idle",
        project: "/work/sample-app",
        kind: "claude",
      }),
      {
        ...agentPane({
          id: "%2",
          label: "work:0.2",
          state: "waiting",
          project: "/work/sample-app",
          kind: "codex",
        }),
        parent: "%1",
      },
    ]);
    last().onOrder("urgency");
    await flushRenders();
    expect(
      last().list.flatMap((entry) =>
        entry.kind === "section"
          ? [[entry.state, entry.count, entry.rows.map((row) => row.id)]]
          : [],
      ),
    ).toEqual([["waiting", 1, ["%1", "%2"]]]);
    expect(
      document.querySelector(".agents-urgency-section .agents-chip")
        ?.textContent,
    ).toBe("1");
  });

  test("the chosen order is remembered, and a board opened later starts in it", async () => {
    let stored: BoardOrder | null = null;
    const memory = {
      get: () => stored,
      set: (order: BoardOrder) => {
        stored = order;
      },
    };
    const first = await mountWithView(panes(), memory);
    first.last().onOrder("urgency");
    expect(stored).toBe("urgency");

    const again = await mountWithView(panes(), memory);
    expect(
      again.last().board.order.options.map((item) => [item.order, item.active]),
    ).toEqual([
      ["project", false],
      ["urgency", true],
    ]);
    expect(again.last().list.map((entry) => entry.kind)).toEqual(["section"]);
  });

  test("Needs you first lists every project together, by state, with the project on each row", async () => {
    const row = (
      id: string,
      state: AgentPane["state"],
      project: string,
      updatedAt: number,
    ) =>
      agentPane({
        id,
        label: `work:0.${id.slice(1)}`,
        state,
        project,
        updatedAt,
        kind: "claude",
      });
    const { last } = await mountWithView([
      row("%1", "working", "/work/sample-app", 10),
      row("%2", "waiting", "/work/sample-lib", 20),
      row("%3", "done", "/work/sample-app", 30),
      row("%4", "waiting", "/work/sample-app", 40),
    ]);
    expect(
      last().board.order.options.map((item) => [item.order, item.active]),
    ).toEqual([
      ["project", true],
      ["urgency", false],
    ]);
    last().onOrder("urgency");
    await flushRenders();
    const sections = last().list.flatMap((entry) =>
      entry.kind === "section"
        ? [[entry.state, entry.rows.map((item) => item.id)]]
        : [],
    );
    expect(sections).toEqual([
      ["waiting", ["%4", "%2"]],
      ["done", ["%3"]],
      ["working", ["%1"]],
    ]);
    expect(last().list.some((entry) => entry.kind === "project")).toBe(false);
    expect(
      document.querySelector('[data-agent-nav="pane:%2"] .agents-project-label')
        ?.textContent,
    ).toBe("/work/sample-lib");
  });
});
