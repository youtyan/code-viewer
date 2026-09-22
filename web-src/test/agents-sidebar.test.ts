// 左のサイドバーの「プロジェクト → エージェント」。
//
// 守りたいのは次の 4 つ。
// - 状態が変わっても行が動かない (押そうとしたものが逃げない)
// - 登録したものの区画と、tmux で見つかった未登録の区画が分かれ、未登録が
//   出入りしても登録したものの位置が変わらない。未登録が 0 件なら区画ごと無い
// - 名前を押すと移る。いま見ているプロジェクトは何もしない。未登録は確かめずに
//   登録してから移る
// - 畳む / 開くは山形だけ (名前を押しても畳まない)

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
  AgentOverviewResponse,
  AgentPane,
  AgentProjectInfo,
} from "../core/agent-overview";
import type { AgentState } from "../core/agent-state";
import type {
  AgentMonitor,
  AgentMonitorSnapshot,
} from "../views/agents/agent-monitor";
import {
  type AgentsSidebarDeps,
  mountAgentsSidebar,
} from "../views/agents/agents-sidebar";
import { agentsText } from "../views/agents/i18n";
import { closeContextMenu } from "../views/context-menu";
import {
  createProjectActions,
  type ProjectActions,
} from "../views/projects/project-actions";
import { closeOpenDialog } from "./_dialog-helpers";
import { agentPane } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  closeContextMenu();
  closeOpenDialog();
  vi.unstubAllGlobals();
});

function info(
  root: string,
  order: number | null,
  server: AgentProjectInfo["server"] = { status: "absent" },
): AgentProjectInfo {
  const name = root.slice(root.lastIndexOf("/") + 1);
  return {
    root,
    name,
    displayRoot: root,
    git: true,
    error: "",
    server,
    registered: order === null ? null : { root, name, order },
  };
}

function pane(
  id: string,
  label: string,
  project: string,
  state: AgentState,
  title = `task ${id}`,
): AgentPane {
  return agentPane({
    id,
    label,
    session: "work",
    title,
    path: project,
    state,
    source: "screen",
    project,
  });
}

function overview(
  panes: AgentPane[],
  projects: AgentProjectInfo[],
): AgentOverviewResponse {
  return {
    serverInstance: "sample",
    observedAt: 0,
    tmux: { available: true, running: true, error: "" },
    panes,
    projects,
    errors: [],
    registry: {
      projects: projects
        .filter((item) => item.registered)
        .map((item) => ({
          root: item.root,
          name: item.name,
          order: item.registered?.order ?? 0,
          port: null,
        })),
      error: "",
      path: "/state/projects.json",
    },
  };
}

function fakeMonitor(
  initial: AgentOverviewResponse,
  notify: {
    sawWaiting?: boolean;
    permission?: ReturnType<AgentMonitor["permission"]>;
    permissionAsked?: boolean;
    requested?: ReturnType<AgentMonitor["permission"]>;
  } = {},
) {
  let snapshot: AgentMonitorSnapshot = {
    overview: initial,
    error: "",
    notifyError: "",
    unread: new Map(),
    sawWaiting: notify.sawWaiting ?? false,
    permissionAsked: notify.permissionAsked ?? false,
  };
  const listeners = new Set<() => void>();
  const monitor: AgentMonitor = {
    start: () => undefined,
    refresh: async () => undefined,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markRead: () => undefined,
    permission: () => notify.permission ?? "default",
    requestPermission: async () => {
      snapshot = { ...snapshot, permissionAsked: true };
      notify.permission = notify.requested ?? "default";
      return notify.permission;
    },
  };
  return {
    monitor,
    publish(next: AgentOverviewResponse) {
      snapshot = { ...snapshot, overview: next };
      for (const listener of listeners) listener();
    },
  };
}

function fakeActions(): ProjectActions & {
  opened: { root: string; path: string; confirmRegister?: boolean }[];
} {
  const opened: { root: string; path: string; confirmRegister?: boolean }[] =
    [];
  return {
    opened,
    activity: () => null,
    signature: () => "",
    dismiss: () => undefined,
    subscribe: () => () => undefined,
    open: async (item, path, options) => {
      opened.push({
        root: item.root,
        path,
        confirmRegister: options?.confirmRegister,
      });
    },
    registerCurrent: async () => undefined,
    registerRoot: async () => undefined,
    registerByPath: async () => undefined,
    unregister: async () => undefined,
    rename: async () => undefined,
    move: async () => undefined,
    stop: async () => undefined,
  };
}

function mount(
  data: AgentOverviewResponse,
  actions = fakeActions(),
  openPane: AgentsSidebarDeps["openPane"] = () => undefined,
  notify: Parameters<typeof fakeMonitor>[1] & { dismissed?: boolean } = {},
) {
  document.body.innerHTML =
    '<nav><a class="app-menu-item active" href="/history">History</a></nav><div id="nav-projects"></div>';
  const root = document.querySelector<HTMLElement>("#nav-projects");
  if (!root) throw new Error("missing sidebar root");
  const { monitor, publish } = fakeMonitor(data, notify);
  const saved: string[][] = [];
  let dismissed = notify.dismissed ?? false;
  mountAgentsSidebar({
    root,
    monitor,
    projects: actions,
    getText: () => agentsText("en"),
    openPane,
    viewingPane: () => null,
    launch: () => undefined,
    openBoard: () => undefined,
    getCollapsed: () => [],
    currentName: () => "sample-app",
    saveCollapsed: (roots) => saved.push(roots),
    notifyHintDismissed: () => dismissed,
    dismissNotifyHint: () => {
      dismissed = true;
    },
  });
  return { root, publish, actions, saved, dismissed: () => dismissed };
}

/** 区画ごとの見出しの並び (登録 / tmux で検出)。 */
function layout(root: HTMLElement) {
  const names = (scope: Element) =>
    [...scope.querySelectorAll(":scope > .nav-project .nav-project-name")].map(
      (el) => el.textContent,
    );
  const detected = root.querySelector(".nav-detected");
  return { registered: names(root), detected: detected && names(detected) };
}

function rowIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(".nav-agent")].map(
    (el) => el.getAttribute("data-nav-item") ?? "",
  );
}

const REGISTERED = [
  info("/work/sample-app", 0, { status: "current" }),
  info("/work/sample-lib", 1),
  info("/work/sample-docs", 2),
];

describe("agents sidebar order", () => {
  test("state changes do not move projects or rows", () => {
    const panes = (states: AgentState[]) => [
      pane("%1", "work:0.0", "/work/sample-app", states[0] ?? "idle"),
      pane("%2", "work:1.0", "/work/sample-app", states[1] ?? "idle"),
      pane("%3", "work:2.0", "/work/sample-lib", states[2] ?? "idle"),
    ];
    const { root, publish } = mount(
      overview(panes(["idle", "idle", "idle"]), REGISTERED),
    );
    const before = { layout: layout(root), rows: rowIds(root) };
    expect(before.layout.registered).toEqual([
      "sample-app",
      "sample-lib",
      "sample-docs",
    ]);

    publish(overview(panes(["idle", "working", "waiting"]), REGISTERED));
    expect({ layout: layout(root), rows: rowIds(root) }).toEqual(before);
    publish(overview(panes(["done", "idle", "idle"]), REGISTERED));
    expect({ layout: layout(root), rows: rowIds(root) }).toEqual(before);
  });

  test("unregistered projects appear in their own section and leave the registered ones in place", () => {
    const base = [pane("%1", "work:0.0", "/work/sample-app", "idle")];
    const { root, publish } = mount(overview(base, REGISTERED));
    const before = layout(root);
    expect(before.detected).toBeNull();

    const withDetected = overview(
      [
        ...base,
        pane("%8", "work:8.0", "/work/zeta-tool", "waiting"),
        pane("%9", "work:9.0", "/work/alpha-tool", "idle"),
      ],
      [
        ...REGISTERED,
        info("/work/zeta-tool", null),
        info("/work/alpha-tool", null),
      ],
    );
    publish(withDetected);
    expect(layout(root)).toEqual({
      registered: before.registered,
      detected: ["alpha-tool", "zeta-tool"],
    });
    expect(root.querySelector(".nav-detected-title")?.textContent).toBe(
      agentsText("en").sidebar.detected,
    );

    // 未登録が居なくなったら、区画ごと消える。登録したものの並びはそのまま。
    publish(overview(base, REGISTERED));
    expect(layout(root)).toEqual(before);
  });
});

describe("agents sidebar actions", () => {
  function head(root: HTMLElement, name: string): HTMLElement {
    const found = [
      ...root.querySelectorAll<HTMLElement>(".nav-project-head"),
    ].find((el) => el.querySelector(".nav-project-name")?.textContent === name);
    if (!found) throw new Error(`missing project ${name}`);
    return found;
  }
  const withAgents = overview(
    [
      pane("%1", "work:0.0", "/work/sample-app", "idle"),
      pane("%2", "work:1.0", "/work/sample-lib", "waiting"),
      pane("%3", "work:2.0", "/work/sample-tools", "idle"),
    ],
    [...REGISTERED, info("/work/sample-tools", null)],
  );

  test.each<{
    name: string;
    project: string;
    expected: { root: string; path: string; confirmRegister?: boolean }[];
  }>([
    {
      name: "the current project does nothing",
      project: "sample-app",
      expected: [],
    },
    {
      name: "another project opens on the same screen",
      project: "sample-lib",
      expected: [
        { root: "/work/sample-lib", path: "/history", confirmRegister: false },
      ],
    },
    {
      name: "an unregistered project opens without asking",
      project: "sample-tools",
      expected: [
        {
          root: "/work/sample-tools",
          path: "/history",
          confirmRegister: false,
        },
      ],
    },
  ])("clicking the name: $name", ({ project, expected }) => {
    const { root, actions } = mount(withAgents);
    head(root, project)
      .querySelector<HTMLElement>(".nav-project-toggle")
      ?.click();
    expect(actions.opened).toEqual(expected);
  });

  test("the current project is marked as the selected one", () => {
    const { root } = mount(withAgents);
    expect(head(root, "sample-app").classList.contains("current")).toBe(true);
    expect(
      head(root, "sample-app")
        .querySelector(".nav-project-toggle")
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(head(root, "sample-lib").classList.contains("current")).toBe(false);
  });

  test("only the chevron collapses; the name does not", () => {
    const { root, saved, actions } = mount(withAgents);
    const lib = head(root, "sample-lib");
    lib.querySelector<HTMLElement>(".nav-project-toggle")?.click();
    expect(saved).toEqual([]);
    expect(actions.opened).toHaveLength(1);

    head(root, "sample-lib").querySelector<HTMLElement>(".nav-twisty")?.click();
    expect(saved).toEqual([["/work/sample-lib"]]);
    const rows = head(
      root,
      "sample-lib",
    ).parentElement?.querySelector<HTMLElement>(".nav-agents");
    expect(rows?.hidden).toBe(true);
  });

  test("click, Alt+click, and the context menu use their respective targets", () => {
    const opened: Array<[string, "opposite" | undefined]> = [];
    const { root } = mount(withAgents, fakeActions(), (id, target) =>
      opened.push([id, target]),
    );
    const row = root.querySelector<HTMLElement>('[data-nav-item="pane:%1"]');
    row?.click();
    row?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, altKey: true }),
    );
    row?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    const items = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".gdp-context-menu button",
      ),
    ];
    expect(items.map((item) => item.textContent)).toEqual([
      "Open in a tab",
      "Open in the opposite pane",
    ]);
    items[1]?.click();
    expect(opened).toEqual([
      ["%1", undefined],
      ["%1", "opposite"],
      ["%1", "opposite"],
    ]);
  });
});

describe("agents sidebar heading marks", () => {
  test.each<[string, AgentState[], string]>([
    [
      "waiting wins over working",
      ["working", "waiting"],
      ".terminal-mark-waiting",
    ],
    ["done wins over working", ["working", "done"], ".terminal-mark-done"],
    [
      "working is visible on the project",
      ["working"],
      ".terminal-mark-working",
    ],
    ["idle keeps the folder", ["idle"], "svg"],
  ])("%s", (_name, states, selector) => {
    const { root } = mount(
      overview(
        states.map((state, index) =>
          pane(`%${index + 1}`, `work:${index}.0`, "/work/sample-lib", state),
        ),
        REGISTERED,
      ),
    );
    const lib = [
      ...root.querySelectorAll<HTMLElement>(".nav-project-head"),
    ].find(
      (el) =>
        el.querySelector(".nav-project-name")?.textContent === "sample-lib",
    );
    expect(lib?.querySelector(`.nav-project-icon ${selector}`)).not.toBeNull();
  });

  test("a starting project shows its progress mark and label", () => {
    const actions = fakeActions();
    actions.activity = (root) =>
      root === "/work/sample-docs" ? { kind: "starting" } : null;
    const { root } = mount(overview([], REGISTERED), actions);
    const icon = (name: string) =>
      [...root.querySelectorAll<HTMLElement>(".nav-project-head")]
        .find(
          (el) => el.querySelector(".nav-project-name")?.textContent === name,
        )
        ?.querySelector(".nav-project-icon");
    expect(
      icon("sample-docs")?.querySelector(".nav-mark-starting"),
    ).not.toBeNull();
    expect(root.querySelector(".nav-project-status")?.textContent).toBe(
      agentsText("en").sidebar.starting,
    );
  });
});

describe("agents sidebar row contents", () => {
  test.each<[string, AgentState, string, string, string]>([
    [
      "agent title",
      "working",
      "✳ Review plan",
      "Review plan",
      "Working · Review plan",
    ],
    [
      "Japanese agent title",
      "working",
      "✳ 調査中",
      "調査中",
      "Working · 調査中",
    ],
    ["command title", "idle", "claude", "Idle", "Idle"],
    [
      "one-word shell title",
      "waiting",
      "workstation",
      "Needs input",
      "Needs input",
    ],
    ["empty title", "done", "", "Finished · unread", "Finished · unread"],
  ])("%s", (_name, state, title, expected, tooltip) => {
    const { root } = mount(
      overview(
        [pane("%1", "work:0.0", "/work/sample-app", state, title)],
        REGISTERED,
      ),
    );
    const row = root.querySelector<HTMLElement>(".nav-agent");
    expect(row?.querySelector(".nav-agent-task")?.textContent).toBe(expected);
    expect(row?.title.split("\n")[0]).toBe(tooltip);
  });
});

describe("agents sidebar without registered projects", () => {
  test("offers to register the project on screen", () => {
    const actions = fakeActions();
    let registered = 0;
    actions.registerCurrent = async () => {
      registered += 1;
    };
    const { root } = mount(overview([], []), actions);
    const link = root.querySelector<HTMLButtonElement>(".nav-note-link");
    expect(link?.textContent).toBe(
      agentsText("en").projects.switcherRegisterCurrent("sample-app"),
    );
    link?.click();
    expect(registered).toBe(1);
  });
});

// 最初の入力待ちで 1 度だけ「通知を許可すると…」を出す。
describe("agents sidebar notification hint", () => {
  const hint = agentsText("en").notifyHint;
  test.each([
    {
      name: "after the first waiting",
      sawWaiting: true,
      permission: "default" as const,
      dismissed: false,
      shown: true,
    },
    {
      name: "before any waiting",
      sawWaiting: false,
      permission: "default" as const,
      dismissed: false,
      shown: false,
    },
    {
      name: "once allowed",
      sawWaiting: true,
      permission: "granted" as const,
      dismissed: false,
      shown: false,
    },
    {
      name: "once dismissed",
      sawWaiting: true,
      permission: "default" as const,
      dismissed: true,
      shown: false,
    },
  ])("$name → shown: $shown", ({ shown, ...notify }) => {
    const { root } = mount(
      overview([], REGISTERED),
      undefined,
      undefined,
      notify,
    );
    expect(root.textContent?.includes(hint)).toBe(shown);
  });

  test.each([
    { requested: "default" as const, dismissed: false, again: true },
    { requested: "granted" as const, dismissed: true, again: false },
    { requested: "denied" as const, dismissed: true, again: false },
  ])("allowing and answering $requested → dismissed: $dismissed", async ({
    requested,
    dismissed: expected,
    again,
  }) => {
    const { root, dismissed } = mount(
      overview([], REGISTERED),
      undefined,
      undefined,
      { sawWaiting: true, requested },
    );
    const en = agentsText("en");
    [...root.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === en.notifyEnable)
      ?.click();
    await vi.waitFor(() => {
      const buttons = [...root.querySelectorAll("button")].map(
        (button) => button.textContent,
      );
      expect({
        dismissed: dismissed(),
        notYet: root.textContent?.includes(en.notifyNotYet),
        askAgain: buttons.includes(en.notifyAskAgain),
        enable: buttons.includes(en.notifyEnable),
      }).toEqual({
        dismissed: expected,
        notYet: again,
        askAgain: again,
        enable: false,
      });
    });
  });

  test("Hide this saves the choice and removes the hint", () => {
    const { root, dismissed } = mount(
      overview([], REGISTERED),
      undefined,
      undefined,
      {
        sawWaiting: true,
      },
    );
    const hide = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === agentsText("en").hookHintClose,
    );
    hide?.click();
    expect(dismissed()).toBe(true);
    expect(root.textContent?.includes(hint)).toBe(false);
  });
});

// 取り直しのたびに描き直すので、押した・Tab で止まった部品からフォーカスが
// 落ちない (落ちると次の Tab が差し替わった同じボタンにもう一度止まる)。
describe("agents sidebar focus across redraws", () => {
  const WITH_AGENT = () =>
    overview([pane("%1", "claude", "/work/sample-lib", "waiting")], REGISTERED);
  const NO_PROJECTS = () => overview([], []);
  const WITH_PROBLEM = () => ({
    ...overview([], REGISTERED),
    registry: { ...overview([], REGISTERED).registry, error: "sample" },
  });

  test.each<[string, () => AgentOverviewResponse, string]>([
    ["new agent (+)", WITH_AGENT, "launch:/work/sample-lib"],
    ["project menu (⋯)", WITH_AGENT, "menu:/work/sample-lib"],
    ["chevron", WITH_AGENT, "twisty:/work/sample-lib"],
    ["register the current repository", NO_PROJECTS, "register-current"],
    ["register by path", NO_PROJECTS, "register-path"],
    ["problems link", WITH_PROBLEM, "problems"],
  ])("%s keeps focus on the redrawn button", (_name, data, key) => {
    const { root, publish } = mount(data());
    const selector = `[data-nav-focus="${key}"]`;
    const before = root.querySelector<HTMLElement>(selector);
    before?.focus();
    expect(document.activeElement).toBe(before);
    publish({ ...data(), serverInstance: "restarted" });
    const after = root.querySelector<HTMLElement>(selector);
    expect({
      replaced: after !== before,
      focused: document.activeElement,
    }).toEqual({
      replaced: true,
      focused: after,
    });
  });

  test("a new observation time alone does not redraw", () => {
    const { root, publish } = mount(NO_PROJECTS());
    const before = root.querySelector(".nav-empty-action");
    expect(before).not.toBeNull();
    publish({ ...NO_PROJECTS(), observedAt: 1_000 });
    expect(root.querySelector(".nav-empty-action")).toBe(before);
  });

  test("a vanished agent row hands focus to its project", () => {
    const { root, publish } = mount(WITH_AGENT());
    root.querySelector<HTMLElement>('[data-nav-item="pane:%1"]')?.focus();
    publish(overview([], REGISTERED));
    expect({
      focused: document.activeElement?.getAttribute("data-nav-item"),
      tabIndex: (document.activeElement as HTMLElement | null)?.tabIndex,
    }).toEqual({ focused: "project:/work/sample-lib", tabIndex: 0 });
  });

  test("hiding the notification hint leaves focus in the tree", () => {
    const { root } = mount(overview([], REGISTERED), undefined, undefined, {
      sawWaiting: true,
    });
    const hide = root.querySelector<HTMLButtonElement>(
      '[data-nav-focus="notify-hide"]',
    );
    hide?.focus();
    hide?.click();
    expect({
      hint: root.querySelector('[data-nav-focus="notify-hide"]'),
      focused: document.activeElement?.getAttribute("data-nav-item"),
    }).toEqual({ hint: null, focused: "project:/work/sample-app" });
  });

  test("focus outside the sidebar is left alone", () => {
    const { root, publish } = mount(WITH_AGENT());
    const outside = document.querySelector<HTMLElement>("a.app-menu-item");
    outside?.focus();
    publish({ ...WITH_AGENT(), serverInstance: "restarted" });
    expect(document.activeElement).toBe(outside);
    expect(root.contains(document.activeElement)).toBe(false);
  });
});

describe("project actions open", () => {
  test("an unregistered project is registered and opened without a dialog when asked not to confirm", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        const payload =
          url === "/_agent/projects/open"
            ? { url: "http://127.0.0.1:65001" }
            : { ok: true };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const navigated: string[] = [];
    const actions = createProjectActions({
      getText: () => agentsText("en").projects,
      trackLoad: (promise) => promise,
      actionHeaders: () => ({}),
      refresh: async () => undefined,
      navigate: (url) => navigated.push(url),
    });
    await actions.open(info("/work/sample-tools", null), "/history", {
      confirmRegister: false,
    });
    expect(document.querySelector(".gdp-dialog-backdrop")).toBeNull();
    expect(calls).toEqual([
      {
        url: "/_agent/projects",
        body: { action: "add", path: "/work/sample-tools" },
      },
      { url: "/_agent/projects/open", body: { root: "/work/sample-tools" } },
    ]);
    expect(navigated).toEqual(["http://127.0.0.1:65001/history"]);
  });
});
