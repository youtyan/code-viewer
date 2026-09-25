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
import type { AgentHookState, HookAgent } from "../core/agent-hooks";
import type { AgentOverviewResponse, AgentPane } from "../core/agent-overview";
import type { AgentState } from "../core/agent-state";
import { BACKGROUND_REQUEST_HEADER } from "../core/network-activity";
import { PANE_PREVIEW_DELAY_MS } from "../core/pane-preview";
import { PROJECT_COLORS, type ProjectColor } from "../core/project-colors";
import {
  type AgentsSidebarDeps,
  mountAgentsSidebar,
} from "../views/agents/agents-sidebar";
import { agentsText } from "../views/agents/i18n";
import { PANE_PREVIEW } from "../views/agents/pane-preview";
import { closeContextMenu } from "../views/context-menu";
import {
  createProjectActions,
  type ProjectActions,
} from "../views/projects/project-actions";
import {
  fakeMonitor,
  info,
  overview,
  projectNames,
} from "./_agents-sidebar-fixture";
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

function fakeActions(): ProjectActions & {
  opened: { root: string; path: string; confirmRegister?: boolean }[];
  /** 並べ替えの呼び出し (move は ±1、place は before)。 */
  reordered: (
    | { root: string; direction: -1 | 1 }
    | { root: string; before: string | null }
  )[];
  /** 色のメニューで選んだもの。 */
  recolored: { root: string; color: ProjectColor }[];
} {
  const opened: { root: string; path: string; confirmRegister?: boolean }[] =
    [];
  const reordered: (
    | { root: string; direction: -1 | 1 }
    | { root: string; before: string | null }
  )[] = [];
  const recolored: { root: string; color: ProjectColor }[] = [];
  return {
    opened,
    reordered,
    recolored,
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
    recolor: async (item, color) => {
      recolored.push({ root: item.root, color });
    },
    move: async (item, direction) => {
      reordered.push({ root: item.root, direction });
    },
    place: async (item, before) => {
      reordered.push({ root: item.root, before });
    },
    stop: async () => undefined,
  };
}

function mount(
  data: AgentOverviewResponse,
  actions = fakeActions(),
  openPane: AgentsSidebarDeps["openPane"] = () => undefined,
  notify: Parameters<typeof fakeMonitor>[1] & {
    dismissed?: boolean;
    /** 設定の節と同じフックの状態 (種類ごと)。無い種類はまだ取っていない (null)。 */
    hookStates?: Partial<Record<HookAgent, AgentHookState>>;
  } = {},
) {
  document.body.innerHTML =
    '<nav><a class="app-menu-item active" href="/history">History</a></nav><div id="nav-projects"></div>';
  const root = document.querySelector<HTMLElement>("#nav-projects");
  if (!root) throw new Error("missing sidebar root");
  const { monitor, publish } = fakeMonitor(data, notify);
  const saved: string[][] = [];
  /** 「別のアカウントで続ける…」の呼び出し (handoff.ts)。 */
  const handoffs: string[] = [];
  let dismissed = notify.dismissed ?? false;
  let stoppedOpen = false;
  mountAgentsSidebar({
    root,
    monitor,
    projects: actions,
    getText: () => agentsText("en"),
    openPane,
    viewingPane: () => null,
    launch: () => undefined,
    handoff: {
      handoff: (target) => handoffs.push(`handoff:${target.id}`),
      openHookHelp: () => handoffs.push("hook-help"),
      hookState: (agent) => notify.hookStates?.[agent] ?? null,
    },
    openBoard: () => undefined,
    getCollapsed: () => [],
    currentName: () => "sample-app",
    saveCollapsed: (roots) => saved.push(roots),
    isStoppedOpen: () => stoppedOpen,
    setStoppedOpen: (open) => {
      stoppedOpen = open;
    },
    notifyHintDismissed: () => dismissed,
    dismissNotifyHint: () => {
      dismissed = true;
    },
  });
  return {
    root,
    publish,
    actions,
    saved,
    handoffs,
    dismissed: () => dismissed,
  };
}

/** 区画ごとの見出しの並び (登録 / tmux で検出)。 */
function layout(root: HTMLElement) {
  const detected = root.querySelector(".nav-detected");
  return {
    registered: projectNames(root),
    detected: detected && projectNames(detected),
  };
}

function rowIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(".nav-agent")].map(
    (el) => el.getAttribute("data-nav-item") ?? "",
  );
}

/**
 * 裏のプロセスが動いている (起動中)。並び・印・ドラッグのテストは起動中の側
 * (一覧の直下) で見る。停止中の節への分け方は agents-sidebar-running-split.test.ts。
 */
const RUNNING = {
  status: "running",
  url: "/p/sample/",
  launched: true,
} as const;

const REGISTERED = [
  info("/work/sample-app", 0, { status: "current" }),
  info("/work/sample-lib", 1, RUNNING),
  info("/work/sample-docs", 2, RUNNING),
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

  // ui-surface.md の「タブの決まり」の例外: ターミナルは 1 か所にしか置けず仮にも
  // ならないので、中ボタン・⌘/Ctrl も 1 回押すと同じ。Alt は反対の面。右ボタンは開かない。
  test.each([
    ["click", "click", {}, [["%1", undefined]]],
    ["Cmd+click", "click", { metaKey: true }, [["%1", undefined]]],
    ["middle click", "auxclick", { button: 1 }, [["%1", undefined]]],
    ["Alt+click", "click", { altKey: true }, [["%1", "opposite"]]],
    ["right button", "auxclick", { button: 2 }, []],
  ])("%s on an agent row opens %j", (_label, type, init, expected) => {
    const opened: Array<[string, "opposite" | undefined]> = [];
    const { root } = mount(withAgents, fakeActions(), (id, target) =>
      opened.push([id, target]),
    );
    root
      .querySelector<HTMLElement>('[data-nav-item="pane:%1"]')
      ?.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, ...init }),
      );
    expect(opened).toEqual(expected);
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
    // 3 つ目からは「別のアカウントで続ける…」(フックの無いペインなので押せず、
    // 入れ方の案内が並ぶ。handoff の表は agents-handoff.test.ts)。
    expect(items.map((item) => item.textContent)).toEqual([
      "Open in a tab",
      "Open in the opposite pane",
      "Continue with another account…",
      "Needs the agent hooks — show how to install",
    ]);
    items[1]?.click();
    expect(opened).toEqual([
      ["%1", undefined],
      ["%1", "opposite"],
      ["%1", "opposite"],
    ]);
  });

  // 「別のアカウントで続ける…」は、フックが会話記録の場所を知らせたペインだけ
  // 押せる。知らせていなければ押せず、次の行に理由を書く: その種類のフックが
  // 入っていれば「一度話しかけると使えます」(押せない。入れ方へは送らない)、
  // 入っていない・まだ分からなければフックの入れ方へ送る。
  // エージェントでないペインには出さない。
  const LOCATION = {
    conversation: {
      sessionId: "abc123",
      transcriptPath: "/home/sample/log/sample.jsonl",
      cwd: "/work/sample-app",
    },
  };
  const NEEDS_HOOKS = "Needs the agent hooks — show how to install";
  const WAITING = "Send the agent one message first";
  const HANDOFF = "Continue with another account…";
  test.each([
    ...(
      [
        ["installed", "installed"],
        ["not installed", "none"],
        ["not known yet", undefined],
      ] as const
    ).map(([hooks, state]) => ({
      name: `会話記録の場所があれば押せる (フック: ${hooks})`,
      over: LOCATION,
      hookStates: state ? { claude: state } : {},
      items: [[HANDOFF, false]],
      click: HANDOFF,
      called: ["handoff:%1"],
    })),
    {
      name: "場所が無く、フックが入っていれば「一度話しかけると使えます」(入れ方へは送らない)",
      over: {},
      hookStates: { claude: "installed" } as const,
      items: [
        [HANDOFF, true],
        [WAITING, true],
      ],
      click: WAITING,
      called: [],
    },
    ...(
      [
        ["not installed", { claude: "none" }],
        ["partly installed", { claude: "partial" }],
        ["not known yet", {}],
        ["installed only for codex", { codex: "installed" }],
      ] as const
    ).map(([hooks, hookStates]) => ({
      name: `場所が無く、フックが ${hooks} なら押せず、入れ方へ送る`,
      over: {},
      hookStates,
      items: [
        [HANDOFF, true],
        [NEEDS_HOOKS, false],
      ],
      click: NEEDS_HOOKS,
      called: ["hook-help"],
    })),
    ...(
      [
        ["installed", "installed", WAITING, true, []],
        ["not installed", "none", NEEDS_HOOKS, false, ["hook-help"]],
      ] as const
    ).map(([hooks, state, reason, disabled, called]) => ({
      name: `codex の transcript_path が null (空) なら押せない (フック: ${hooks})`,
      over: {
        kind: "codex" as const,
        command: "codex",
        conversation: {
          sessionId: "sample_thread",
          transcriptPath: "",
          cwd: "/work/sample-app",
        },
      },
      hookStates: { codex: state },
      items: [
        [HANDOFF, true],
        [reason, disabled],
      ],
      click: reason,
      called: [...called],
    })),
    {
      name: "エージェントでないペインには出さない",
      over: { kind: null, command: "zsh" },
      hookStates: { claude: "installed" } as const,
      items: [],
      click: null,
      called: [],
    },
  ])("右クリックの「別のアカウントで続ける…」: $name", ({
    over,
    hookStates,
    items,
    click,
    called,
  }) => {
    const data = overview(
      [{ ...pane("%1", "work:0.0", "/work/sample-app", "idle"), ...over }],
      REGISTERED,
    );
    const { root, handoffs } = mount(data, undefined, undefined, {
      hookStates,
    });
    root
      .querySelector<HTMLElement>('[data-nav-item="pane:%1"]')
      ?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".gdp-context-menu button",
      ),
    ].slice(2);
    expect(
      buttons.map((button) => [button.textContent, button.disabled]),
    ).toEqual(items);
    buttons.find((button) => button.textContent === click)?.click();
    expect(handoffs).toEqual(called);
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
    expect(lib?.querySelector(`.nav-project-state ${selector}`)).not.toBeNull();
  });

  test("an idle project has no mark after its name", () => {
    const { root } = mount(
      overview(
        [pane("%1", "work:0.0", "/work/sample-lib", "idle")],
        REGISTERED,
      ),
    );
    expect(root.querySelectorAll(".nav-project-state")).toHaveLength(0);
  });

  // 見出しの頭はフォルダの絵ではなく、プロジェクトの色の四角と頭文字。
  // 登録していないもの (tmux で見つけただけ) は色なし。
  test("each heading starts with its color square and initials", () => {
    const { root } = mount(
      overview(
        [pane("%1", "work:0.0", "/work/other-repo", "idle")],
        [...REGISTERED, info("/work/other-repo", null)],
      ),
    );
    expect(
      [...root.querySelectorAll<HTMLElement>(".nav-project-head")].map(
        (head) => {
          const mark = head.querySelector<HTMLElement>(
            ".nav-project-toggle > .project-mark:first-child",
          );
          return [
            head.querySelector(".nav-project-name")?.textContent,
            mark?.textContent,
            mark?.dataset.projectColor,
            head.dataset.projectColor,
            head.classList.contains("current"),
          ];
        },
      ),
    ).toEqual([
      ["sample-app", "SA", "violet", "violet", true],
      ["sample-lib", "SL", "green", "green", false],
      ["sample-docs", "SD", "orange", "orange", false],
      ["other-repo", "OR", "none", "none", false],
    ]);
  });

  test("the menu's Color… lists the palette and saves the chosen color", () => {
    // 色の一覧は「色…」の同じ click の中で開き直す (待たない)。
    const actions = fakeActions();
    const { root } = mount(overview([], REGISTERED), actions);
    const head = [
      ...root.querySelectorAll<HTMLElement>(".nav-project-head"),
    ][1];
    head?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    const menuItems = () => [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".gdp-context-menu button",
      ),
    ];
    const text = agentsText("en").projects;
    menuItems()
      .find((item) => item.textContent === text.color)
      ?.click();
    expect(
      menuItems().map((item) => [
        item.textContent,
        item.getAttribute("role"),
        item.getAttribute("aria-checked"),
      ]),
    ).toEqual(
      PROJECT_COLORS.map((color) => [
        `SL${text.colorNames[color]}`,
        "menuitemradio",
        String(color === "green"),
      ]),
    );
    expect(
      menuItems().map(
        (item) =>
          item.querySelector<HTMLElement>(".project-mark")?.dataset
            .projectColor,
      ),
    ).toEqual([...PROJECT_COLORS]);
    menuItems()[3]?.click();
    expect(actions.recolored).toEqual([
      { root: "/work/sample-lib", color: PROJECT_COLORS[3] },
    ]);
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
        ?.querySelector(".nav-project-state");
    expect(
      icon("sample-docs")?.querySelector(".nav-mark-starting"),
    ).not.toBeNull();
    expect(root.querySelector(".nav-project-status")?.textContent).toBe(
      agentsText("en").sidebar.starting,
    );
  });
});

// エージェントの行は 2 行組のカード: 1 行目は作業の要約 (無ければ種類)、2 行目は
// 種類 (1 行目が要約のとき)・状態の語・経過時間。プロジェクトの見出しとは形で分かる。
describe("agents sidebar row contents", () => {
  test.each<[string, AgentState, string, string, string, string]>([
    [
      "agent title",
      "working",
      "✳ Review plan",
      "Review plan",
      "claude · Working · –",
      "Working · Review plan",
    ],
    [
      "Japanese agent title",
      "working",
      "✳ 調査中",
      "調査中",
      "claude · Working · –",
      "Working · 調査中",
    ],
    ["command title", "idle", "claude", "claude", "Idle · –", "Idle"],
    [
      "one-word shell title",
      "waiting",
      "workstation",
      "claude",
      "Needs input · –",
      "Needs input",
    ],
    [
      "empty title",
      "done",
      "",
      "claude",
      "Finished · unread · –",
      "Finished · unread",
    ],
  ])("%s", (_name, state, title, name, meta, tooltip) => {
    const { root } = mount(
      overview(
        [pane("%1", "work:0.0", "/work/sample-app", state, title)],
        REGISTERED,
      ),
    );
    const row = root.querySelector<HTMLElement>(".nav-agent");
    expect({
      name: row?.querySelector(".agent-card-head .agent-card-name")
        ?.textContent,
      meta: row?.querySelector(".agent-card-meta")?.textContent,
      tooltip: row?.title.split("\n")[0],
    }).toEqual({ name, meta, tooltip });
  });

  test("a project heading carries its agent count, not a card", () => {
    const { root } = mount(
      overview(
        [
          pane("%1", "work:0.0", "/work/sample-app", "working"),
          pane("%2", "work:1.0", "/work/sample-app", "idle"),
          pane("%3", "work:2.0", "/work/sample-lib", "waiting"),
        ],
        REGISTERED,
      ),
    );
    const heads = [...root.querySelectorAll<HTMLElement>(".nav-project-head")];
    expect(
      heads.map((head) => ({
        name: head.querySelector(".nav-project-name")?.textContent,
        count: head.querySelector(".nav-project-count")?.textContent ?? null,
        card: head.classList.contains("agent-card"),
      })),
    ).toEqual([
      { name: "sample-app", count: "2", card: false },
      { name: "sample-lib", count: "1", card: false },
      { name: "sample-docs", count: null, card: false },
    ]);
    expect(
      [...root.querySelectorAll(".nav-agent")].every((row) =>
        row.classList.contains("agent-card"),
      ),
    ).toBe(true);
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
      currentRoot: () => null,
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

describe("agents sidebar reordering projects", () => {
  const data = overview(
    [
      pane("%1", "work:0.0", "/work/sample-app", "idle"),
      pane("%2", "work:1.0", "/work/sample-lib", "working"),
      pane("%3", "work:2.0", "/work/sample-tools", "idle"),
    ],
    [...REGISTERED, info("/work/sample-tools", null)],
  );

  function toggle(root: HTMLElement, project: string): HTMLElement {
    const found = root.querySelector<HTMLElement>(
      `[data-nav-item="project:${project}"]`,
    );
    if (!found) throw new Error(`missing project ${project}`);
    return found;
  }

  function sections(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(":scope > .nav-project")];
  }

  /** 見出しを上から 40px おき (高さ 30px) に置いたことにする。 */
  function stackHeads(root: HTMLElement): void {
    sections(root).forEach((section, index) => {
      const head = section.querySelector<HTMLElement>(".nav-project-head");
      if (!head) throw new Error("missing head");
      head.getBoundingClientRect = () =>
        ({ top: index * 40, height: 30, bottom: index * 40 + 30 }) as DOMRect;
    });
  }

  function drag(target: Element, type: string, clientY = 0): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clientY", { value: clientY });
    target.dispatchEvent(event);
    return event;
  }

  test.each<{
    key: string;
    project: string;
    expected: { root: string; direction: -1 | 1 }[];
  }>([
    {
      key: "ArrowUp",
      project: "/work/sample-lib",
      expected: [{ root: "/work/sample-lib", direction: -1 }],
    },
    {
      key: "ArrowDown",
      project: "/work/sample-lib",
      expected: [{ root: "/work/sample-lib", direction: 1 }],
    },
    {
      key: "ArrowUp",
      project: "/work/sample-app",
      expected: [{ root: "/work/sample-app", direction: -1 }],
    },
    // 登録していない (下の区画の) ものは並べ替えの対象でない。
    { key: "ArrowUp", project: "/work/sample-tools", expected: [] },
  ])("Alt+$key on $project", ({ key, project, expected }) => {
    const { root, actions } = mount(data);
    const target = toggle(root, project);
    const event = new KeyboardEvent("keydown", {
      key,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    expect([actions.reordered, event.defaultPrevented]).toEqual([
      expected,
      expected.length > 0,
    ]);
  });

  test("a plain arrow still moves the focus, not the project", () => {
    const { root, actions } = mount(data);
    const first = toggle(root, "/work/sample-app");
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect([actions.reordered, document.activeElement === first]).toEqual([
      [],
      false,
    ]);
  });

  test.each([
    [
      "Move up",
      "/work/sample-lib",
      { root: "/work/sample-lib", direction: -1 },
    ],
    [
      "Move down",
      "/work/sample-lib",
      { root: "/work/sample-lib", direction: 1 },
    ],
  ])("right-click on a heading → %s", (label, project, expected) => {
    const { root, actions } = mount(data);
    const head = toggle(root, project).closest(".nav-project-head");
    if (!head) throw new Error("missing head");
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 30,
    });
    head.dispatchEvent(event);
    const item = [
      ...document.querySelectorAll<HTMLElement>(".gdp-context-menu button"),
    ].find((button) => button.textContent === label);
    item?.click();
    expect([event.defaultPrevented, actions.reordered]).toEqual([
      true,
      [expected],
    ]);
  });

  test("only registered headings can be dragged", () => {
    const { root } = mount(data);
    const draggable = [
      ...root.querySelectorAll<HTMLElement>(".nav-project-head"),
    ].map((head) => [
      head.querySelector(".nav-project-name")?.textContent,
      head.draggable === true,
    ]);
    expect(draggable).toEqual([
      ["sample-app", true],
      ["sample-lib", true],
      ["sample-docs", true],
      ["sample-tools", false],
    ]);
  });

  // 見出しは上から 0・40・80px (真ん中は 15・55・95)。
  test.each<{
    project: string;
    y: number;
    mark: [string, string] | null;
    before: string | null | undefined;
  }>([
    {
      project: "/work/sample-docs",
      y: 5,
      mark: ["sample-app", "before"],
      before: "/work/sample-app",
    },
    {
      project: "/work/sample-app",
      y: 60,
      mark: ["sample-docs", "before"],
      before: "/work/sample-docs",
    },
    {
      project: "/work/sample-app",
      y: 120,
      mark: ["sample-docs", "after"],
      before: null,
    },
    // 自分の前後の隙間は並びが変わらないので、線も出さず落とせない。
    { project: "/work/sample-lib", y: 30, mark: null, before: undefined },
    { project: "/work/sample-lib", y: 70, mark: null, before: undefined },
  ])("dragging $project to y=$y", ({ project, y, mark, before }) => {
    const { root, actions } = mount(data);
    stackHeads(root);
    const head = toggle(root, project).closest(".nav-project-head");
    if (!head) throw new Error("missing head");
    drag(head, "dragstart");
    const over = drag(root, "dragover", y);
    const marks = sections(root).flatMap((section) => {
      const name =
        section.querySelector(".nav-project-name")?.textContent ?? "";
      if (section.classList.contains("nav-project-drop-before"))
        return [[name, "before"]];
      if (section.classList.contains("nav-project-drop-after"))
        return [[name, "after"]];
      return [];
    });
    expect([over.defaultPrevented, marks]).toEqual([
      mark !== null,
      mark ? [mark] : [],
    ]);
    // 落とすまで、箱の中身 (並び) は変わらない。
    expect(
      sections(root).map(
        (section) => section.querySelector(".nav-project-name")?.textContent,
      ),
    ).toEqual(["sample-app", "sample-lib", "sample-docs"]);
    drag(root, "drop", y);
    expect(actions.reordered).toEqual(
      before === undefined ? [] : [{ root: project, before }],
    );
    expect(
      root.querySelector(
        ".nav-project-drop-before, .nav-project-drop-after, .nav-project-dragging",
      ),
    ).toBeNull();
  });

  // 掴んでいる間は取り直しが来ても描き直さない (落とす先の線のほかは動かさない)。
  // 終わったら溜めた分を描く。
  test("the sidebar is not redrawn while a heading is held", () => {
    const { root, publish } = mount(data);
    const head = toggle(root, "/work/sample-app").closest(".nav-project-head");
    if (!head) throw new Error("missing head");
    drag(head, "dragstart");
    expect(
      head.closest(".nav-project")?.classList.contains("nav-project-dragging"),
    ).toBe(true);
    const reordered = overview(data.panes, [
      info("/work/sample-lib", 0, RUNNING),
      info("/work/sample-app", 1, { status: "current" }),
      info("/work/sample-docs", 2, RUNNING),
      info("/work/sample-tools", null),
    ]);
    publish(reordered);
    expect([head.isConnected, layout(root).registered]).toEqual([
      true,
      ["sample-app", "sample-lib", "sample-docs"],
    ]);
    drag(head, "dragend");
    expect([head.isConnected, layout(root).registered]).toEqual([
      false,
      ["sample-lib", "sample-app", "sample-docs"],
    ]);
  });
});

describe("agents sidebar screen preview", () => {
  afterEach(() => {
    PANE_PREVIEW.hide();
    vi.useRealTimers();
  });

  // 行は共有の覗き窓に載り、既存の GET /_agent/capture (今の画面だけ) を
  // 裏の取り直しとして読む。押せば今までどおりそのペインを開き、窓は消える。
  test("resting on an agent asks /_agent/capture, and a click still opens the pane", async () => {
    vi.useFakeTimers();
    const requests: [string, string | null][] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push([
        url,
        new Headers(init?.headers).get(BACKGROUND_REQUEST_HEADER),
      ]);
      return new Response(
        JSON.stringify({
          target: "%1",
          kind: "tmux",
          content: "$ sample\nready\n\n",
          cursor: "",
          reset: false,
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    const opened: string[] = [];
    const { root } = mount(
      overview(
        [pane("%1", "work:0.0", "/work/sample-app", "idle", "Review plan")],
        REGISTERED,
      ),
      fakeActions(),
      (id) => opened.push(id),
    );
    const row = root.querySelector<HTMLElement>(".nav-agent");
    if (!row) throw new Error("missing agent row");
    row.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerType: "mouse",
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    const box = document.querySelector<HTMLElement>(".pane-preview");
    expect([
      requests,
      box?.hidden,
      box?.querySelector("pre")?.textContent,
      box?.querySelector(".pane-preview-head")?.textContent,
    ]).toEqual([
      [["/_agent/capture?target=%251&history=0", "1"]],
      false,
      "$ sample\nready",
      "claude · Review plan · work:0.0",
    ]);
    row.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
    );
    row.click();
    expect([opened, box?.hidden]).toEqual([["%1"], true]);
  });
});
