// 左のプロジェクトの一覧を「起動中」と「停止中」に分ける。
//
// 登録したプロジェクトが増えると、エージェントも居ない・開いてもいないものが
// 下に長く続き、いま使っているものが見つからない。守りたいのは次のこと。
//
// - 起動中かどうかは 1 つの純粋な関数で決める (サイドバー・全体ボード・切替の
//   小窓が同じ判定を使う)。起動中 = エージェントのペインかシェルが居る・裏の
//   プロセスが動いている・いま見ている・起こしている最中
// - 停止中は一覧の下の「停止中 (n)」の中に 1 行ずつ。既定は畳む。開いた・畳んだ
//   は覚える
// - 各節の中の並びは登録の順のまま。節の間を移っても登録の順は変えない
// - 切替の小窓 (p) は絞り込みと ↑↓ で選ぶので畳まず、起動中 → 区切り → 停止中

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type {
  AgentOverviewResponse,
  AgentOverviewShell,
  AgentPane,
  AgentProjectInfo,
} from "../core/agent-overview";
import {
  partitionProjectsByRunning,
  runningProjectRoots,
} from "../core/project-running";
import { mountAgentsSidebar } from "../views/agents/agents-sidebar";
import { agentsText } from "../views/agents/i18n";
import type { ProjectActions } from "../views/projects/project-actions";
import { mountProjectSwitcher } from "../views/projects/project-switcher";
import { PROJECTS_EN } from "../views/projects/projects-i18n";
import {
  fakeMonitor,
  info,
  overview,
  projectNames,
} from "./_agents-sidebar-fixture";
import { agentPane, q } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

function pane(
  id: string,
  project: string,
  over: Partial<AgentPane> = {},
): AgentPane {
  return agentPane({ id, path: project, project, ...over });
}

/** 生きているシェル。cwd はシェルを起こした場所。 */
function shell(id: string, cwd: string): AgentOverviewShell {
  return { id, window: null, cwd };
}

describe("起動中かどうかの判定 (runningProjectRoots)", () => {
  const APP = "/work/sample-app";
  const LIB = "/work/sample-lib";
  const NESTED = "/work/sample-app/packages/sample-ui";
  const projects = [info(APP, 0), info(LIB, 1), info(NESTED, 2)];

  test.each([
    {
      name: "エージェントのペインが居る",
      panes: [pane("%1", LIB)],
      shells: [],
      servers: {},
      extra: [],
      expected: [LIB],
    },
    {
      name: "エージェントでないペイン (シェルだけのペイン) は数えない",
      panes: [pane("%1", LIB, { kind: null, command: "zsh" })],
      shells: [],
      servers: {},
      extra: [],
      expected: [],
    },
    {
      name: "ブラウザのシェルがそのプロジェクトの中で動いている",
      panes: [],
      shells: [shell("shell-1", `${LIB}/src`)],
      servers: {},
      extra: [],
      expected: [LIB],
    },
    {
      name: "入れ子のプロジェクトでは、シェルの場所に一番近い根",
      panes: [],
      shells: [shell("shell-1", `${NESTED}/src`)],
      servers: {},
      extra: [],
      expected: [NESTED],
    },
    {
      name: "ペインを映しているシェルは、起こした場所でなくペインのプロジェクト",
      panes: [pane("%1", LIB, { kind: null, shownInShell: "shell-1" })],
      shells: [shell("shell-1", APP)],
      servers: {},
      extra: [],
      expected: [LIB],
    },
    {
      name: "どのプロジェクトの中でもないシェルは数えない",
      panes: [],
      shells: [shell("shell-1", "/tmp")],
      servers: {},
      extra: [],
      expected: [],
    },
    {
      name: "裏のプロセスが動いている",
      panes: [],
      shells: [],
      servers: { [LIB]: { status: "running", url: "/p/lib/", launched: true } },
      extra: [],
      expected: [LIB],
    },
    {
      name: "いま見ている",
      panes: [],
      shells: [],
      servers: { [APP]: { status: "current" } },
      extra: [],
      expected: [APP],
    },
    {
      name: "裏のプロセスを確かめられなかった (問題の印を畳みの中に隠さない)",
      panes: [],
      shells: [],
      servers: { [LIB]: { status: "unreachable", detail: "timed out" } },
      extra: [],
      expected: [LIB],
    },
    {
      name: "起こしている最中 (画面が持つ状態を足す)",
      panes: [],
      shells: [],
      servers: {},
      extra: [LIB],
      expected: [LIB],
    },
    {
      name: "何も無ければ停止中",
      panes: [],
      shells: [],
      servers: {},
      extra: [],
      expected: [],
    },
  ] as {
    name: string;
    panes: AgentPane[];
    shells: AgentOverviewShell[];
    servers: Record<string, AgentProjectInfo["server"]>;
    extra: string[];
    expected: string[];
  }[])("$name", ({ panes, shells, servers, extra, expected }) => {
    const withServers = projects.map((item) =>
      servers[item.root] ? { ...item, server: servers[item.root] } : item,
    );
    const running = runningProjectRoots(
      overview(panes, withServers, shells),
      extra,
    );
    expect([...running].sort()).toEqual([...expected].sort());
  });

  test("起動中と停止中に分けても、それぞれの中の並びは渡した順のまま", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(
      partitionProjectsByRunning(items, (item) => item, new Set(["b", "d"])),
    ).toEqual({ running: ["b", "d"], stopped: ["a", "c", "e"] });
  });
});

function fakeActions(starting: string[] = []) {
  const opened: string[] = [];
  const actions: ProjectActions = {
    activity: (root) => (starting.includes(root) ? { kind: "starting" } : null),
    signature: () => starting.join(","),
    dismiss: () => undefined,
    subscribe: () => () => undefined,
    open: async (item) => {
      opened.push(item.root);
    },
    registerCurrent: async () => undefined,
    registerRoot: async () => undefined,
    registerByPath: async () => undefined,
    unregister: async () => undefined,
    rename: async () => undefined,
    recolor: async () => undefined,
    move: async () => undefined,
    place: async () => undefined,
    stop: async () => undefined,
  };
  return { actions, opened };
}

function mount(
  data: AgentOverviewResponse,
  options: { stoppedOpen?: boolean; starting?: string[] } = {},
) {
  document.body.innerHTML =
    '<nav><a class="app-menu-item active" href="/history">History</a></nav><div id="nav-projects"></div>';
  const root = document.querySelector<HTMLElement>("#nav-projects");
  if (!root) throw new Error("missing sidebar root");
  const { monitor, publish } = fakeMonitor(data);
  const { actions, opened } = fakeActions(options.starting);
  const savedOpen: boolean[] = [];
  let stoppedOpen = options.stoppedOpen ?? false;
  mountAgentsSidebar({
    root,
    monitor,
    projects: actions,
    getText: () => agentsText("en"),
    openPane: () => undefined,
    viewingPane: () => null,
    launch: () => undefined,
    handoff: {
      handoff: () => undefined,
      openHookHelp: () => undefined,
    },
    openBoard: () => undefined,
    getCollapsed: () => [],
    currentName: () => "sample-app",
    saveCollapsed: () => undefined,
    notifyHintDismissed: () => true,
    dismissNotifyHint: () => undefined,
    // 停止中の節を開いているか。保存先は app.ts が決める。
    isStoppedOpen: () => stoppedOpen,
    setStoppedOpen: (open: boolean) => {
      stoppedOpen = open;
      savedOpen.push(open);
    },
  });
  return { root, publish, opened, savedOpen };
}

/** 一覧の直下 (起動中) と、停止中の節の中の見出しの名前。 */
function sections(root: HTMLElement) {
  const stopped = root.querySelector(".nav-stopped-list");
  return {
    running: projectNames(root),
    stopped: stopped && projectNames(stopped),
  };
}

function stoppedToggle(root: HTMLElement): HTMLButtonElement {
  return q<HTMLButtonElement>(root, ".nav-stopped-toggle");
}

const APP = info("/work/sample-app", 0, { status: "current" });
const LIB = info("/work/sample-lib", 1);
const DOCS = info("/work/sample-docs", 2);
const SITE = info("/work/sample-site", 3, {
  status: "running",
  url: "/p/site/",
  launched: true,
});
const TOOLS = info("/work/sample-tools", 4);

describe("サイドバーの起動中と停止中", () => {
  test("停止中は一覧の下の「停止中 (n)」に集まり、既定では畳んである", () => {
    const { root } = mount(
      overview([pane("%1", DOCS.root)], [APP, LIB, DOCS, SITE, TOOLS]),
    );

    // 起動中は今までどおり一覧の直下に、登録の順で並ぶ (見出しは出さない)。
    expect(sections(root)).toEqual({
      running: ["sample-app", "sample-docs", "sample-site"],
      stopped: ["sample-lib", "sample-tools"],
    });
    const toggle = stoppedToggle(root);
    expect(toggle.textContent).toBe("Not running (2)");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector<HTMLElement>(".nav-stopped-list")?.hidden).toBe(
      true,
    );
    // 停止中の節は一覧の最後 (エージェントの行・tmux で検出の節より下)。
    const stopped = root.querySelector(".nav-stopped");
    expect(stopped?.parentElement).toBe(root);
    expect([...root.children].indexOf(stopped as Element)).toBeGreaterThan(
      [...root.children].indexOf(
        root.querySelector(":scope > .nav-project:last-of-type") as Element,
      ),
    );
  });

  test("見出しを押すと開き、開いたことを覚えてもらう。覚えた状態で開き直すと開いたまま", () => {
    const data = overview([], [APP, LIB, TOOLS]);
    const first = mount(data);
    stoppedToggle(first.root).click();

    expect(first.savedOpen).toEqual([true]);
    expect(stoppedToggle(first.root).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(
      first.root.querySelector<HTMLElement>(".nav-stopped-list")?.hidden,
    ).toBe(false);

    const again = mount(data, { stoppedOpen: true });
    expect(
      again.root.querySelector<HTMLElement>(".nav-stopped-list")?.hidden,
    ).toBe(false);
  });

  test("停止中のプロジェクトは 1 行 (札と名前) で、押すと今までどおり開く", () => {
    const { root, opened } = mount(overview([], [APP, LIB]), {
      stoppedOpen: true,
    });
    const item = root.querySelector(".nav-stopped-list .nav-project");
    expect(item?.querySelector(".nav-project-mark")).not.toBeNull();
    expect(item?.querySelector(".nav-agents")).toBeNull();

    item?.querySelector<HTMLButtonElement>(".nav-project-toggle")?.click();
    expect(opened).toEqual([LIB.root]);
  });

  test("エージェントが来たら起動中へ移り、登録の順の位置に入る。居なくなれば停止中へ戻る", () => {
    const projects = [APP, LIB, DOCS, TOOLS];
    const { root, publish } = mount(overview([], projects));
    expect(sections(root)).toEqual({
      running: ["sample-app"],
      stopped: ["sample-lib", "sample-docs", "sample-tools"],
    });

    publish(overview([pane("%1", TOOLS.root), pane("%2", LIB.root)], projects));
    expect(sections(root)).toEqual({
      running: ["sample-app", "sample-lib", "sample-tools"],
      stopped: ["sample-docs"],
    });

    publish(overview([pane("%2", LIB.root)], projects));
    expect(sections(root)).toEqual({
      running: ["sample-app", "sample-lib"],
      stopped: ["sample-docs", "sample-tools"],
    });
  });

  test("起こしている最中のプロジェクトは起動中に出す (畳みの中で「起動中…」が隠れない)", () => {
    const { root } = mount(overview([], [APP, LIB, TOOLS]), {
      starting: [TOOLS.root],
    });
    expect(sections(root)).toEqual({
      running: ["sample-app", "sample-tools"],
      stopped: ["sample-lib"],
    });
  });

  test("停止中が 0 件なら節ごと出さない", () => {
    const { root } = mount(overview([pane("%1", LIB.root)], [APP, LIB]));
    expect(root.querySelector(".nav-stopped")).toBeNull();
  });
});

describe("切替の小窓の並び", () => {
  test("起動中が先、停止中は区切りの後。どちらも登録の順で、最初はいま居る行", () => {
    document.body.innerHTML =
      '<button id="project-switcher" type="button">sample-app</button>';
    const button = q<HTMLElement>(document.body, "#project-switcher");
    const data = overview(
      [pane("%1", TOOLS.root)],
      [APP, LIB, DOCS, SITE, TOOLS],
    );
    const switcher = mountProjectSwitcher({
      button,
      actions: fakeActions().actions,
      getText: () => PROJECTS_EN,
      getOverview: () => data,
      subscribe: () => () => undefined,
      currentPath: () => "/",
      currentName: () => "sample-app",
      shortcutLabel: () => "p",
    });
    switcher.toggle();
    const list = q<HTMLElement>(document.body, ".project-switcher-list");
    expect(
      [...list.children].map((el) =>
        el.classList.contains("project-switcher-divider")
          ? `-- ${el.textContent}`
          : el.querySelector(".project-switcher-name")?.textContent,
      ),
    ).toEqual([
      "sample-app",
      "sample-site",
      "sample-tools",
      `-- ${PROJECTS_EN.switcherStopped}`,
      "sample-lib",
      "sample-docs",
    ]);
    expect(
      list.querySelector(".project-switcher-row.active .project-switcher-name")
        ?.textContent,
    ).toBe("sample-app");
    switcher.toggle();
  });
});
