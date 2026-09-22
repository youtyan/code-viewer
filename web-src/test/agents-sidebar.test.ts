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
import { mountAgentsSidebar } from "../views/agents/agents-sidebar";
import { agentsText } from "../views/agents/i18n";
import {
  createProjectActions,
  type ProjectActions,
} from "../views/projects/project-actions";
import { closeOpenDialog } from "./_dialog-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
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
): AgentPane {
  return {
    id,
    label,
    session: "work",
    title: `task ${id}`,
    command: "claude",
    path: project,
    kind: "claude",
    state,
    source: "screen",
    updatedAt: 0,
    watchedSince: 0,
    project,
    worktree: "",
    shownInShell: "",
    account: null,
  };
}

function overview(
  panes: AgentPane[],
  projects: AgentProjectInfo[],
): AgentOverviewResponse {
  return {
    serverInstance: "sample",
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

function fakeMonitor(initial: AgentOverviewResponse) {
  let snapshot: AgentMonitorSnapshot = {
    overview: initial,
    error: "",
    notifyError: "",
    unread: new Map(),
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
    permission: () => "default",
    requestPermission: async () => "default",
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

function mount(data: AgentOverviewResponse, actions = fakeActions()) {
  document.body.innerHTML =
    '<nav><a class="app-menu-item active" href="/history">History</a></nav><div id="nav-projects"></div>';
  const root = document.querySelector<HTMLElement>("#nav-projects");
  if (!root) throw new Error("missing sidebar root");
  const { monitor, publish } = fakeMonitor(data);
  const saved: string[][] = [];
  mountAgentsSidebar({
    root,
    monitor,
    projects: actions,
    getText: () => agentsText("en"),
    openPane: () => undefined,
    viewingPane: () => null,
    launch: () => undefined,
    openBoard: () => undefined,
    getCollapsed: () => [],
    currentName: () => "sample-app",
    saveCollapsed: (roots) => saved.push(roots),
  });
  return { root, publish, actions, saved };
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
});

describe("agents sidebar heading marks", () => {
  test("a folded project shows its most urgent state; a starting one shows Starting", () => {
    const actions = fakeActions();
    actions.activity = (root) =>
      root === "/work/sample-docs" ? { kind: "starting" } : null;
    const { root } = mount(
      overview(
        [
          pane("%1", "work:0.0", "/work/sample-lib", "working"),
          pane("%2", "work:1.0", "/work/sample-lib", "waiting"),
        ],
        REGISTERED,
      ),
      actions,
    );
    const icon = (name: string) =>
      [...root.querySelectorAll<HTMLElement>(".nav-project-head")]
        .find(
          (el) => el.querySelector(".nav-project-name")?.textContent === name,
        )
        ?.querySelector(".nav-project-icon");
    expect(
      icon("sample-lib")?.querySelector(".terminal-mark-waiting"),
    ).not.toBeNull();
    expect(icon("sample-app")?.querySelector("svg")).not.toBeNull();
    expect(
      icon("sample-docs")?.querySelector(".nav-mark-starting"),
    ).not.toBeNull();
    expect(root.querySelector(".nav-project-status")?.textContent).toBe(
      agentsText("en").sidebar.starting,
    );
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
