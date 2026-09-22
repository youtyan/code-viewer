// エージェントのペインを開く入口 (views/agents/agent-pane-opener.ts)。
// 通知・サイドバー・全体ボード・パレットの 4 つが同じ入口を呼ぶ。行き先が
// 別のプロジェクトなら、そこへ移って `?open-pane=` で開く。
import { expect, test } from "vitest";
import type {
  AgentOverviewResponse,
  AgentPane,
  AgentProjectInfo,
  AgentProjectServer,
} from "../core/agent-overview";
import { agentPaneTarget } from "../core/projects";
import { parseOpenPaneOverlay, withOpenPaneOverlay } from "../core/routes";
import { createAgentPaneOpener } from "../views/agents/agent-pane-opener";

function project(
  root: string,
  server: AgentProjectServer,
  options: { registered?: boolean; git?: boolean } = {},
): AgentProjectInfo {
  const name = root.slice(root.lastIndexOf("/") + 1);
  return {
    root,
    name,
    displayRoot: root,
    git: options.git ?? true,
    error: "",
    server,
    registered: options.registered === false ? null : { root, name, order: 0 },
  };
}

function pane(id: string, root: string): AgentPane {
  return {
    id,
    label: `sample:0.${id.slice(1)}`,
    session: "sample",
    title: "",
    command: "claude",
    path: root,
    kind: "claude",
    state: "waiting",
    source: null,
    updatedAt: 0,
    watchedSince: 0,
    project: root,
    worktree: "",
    shownInShell: "",
    account: null,
  };
}

const OTHER_URL = "http://127.0.0.1:64101/p/0123456789abcdef/";

function overview(other: AgentProjectInfo): AgentOverviewResponse {
  return {
    serverInstance: "sample",
    observedAt: 0,
    tmux: { available: true, running: true, error: "" },
    panes: [pane("%1", "/work/sample-app"), pane("%2", other.root)],
    projects: [project("/work/sample-app", { status: "current" }), other],
    errors: [],
    registry: { projects: [], error: "", path: "/state/projects.json" },
  };
}

const RUNNING = project("/work/sample-lib", {
  status: "running",
  url: OTHER_URL,
  launched: true,
});

test.each([
  { name: "this project", pane: "%1", other: RUNNING, expected: "here" },
  {
    name: "another running project",
    pane: "%2",
    other: RUNNING,
    expected: "/history?open-pane=%252",
  },
  {
    name: "another registered project that is stopped",
    pane: "%2",
    other: project("/work/sample-lib", { status: "absent" }),
    expected: "/history?open-pane=%252",
  },
  {
    name: "another project not registered yet",
    pane: "%2",
    other: project(
      "/work/sample-lib",
      { status: "absent" },
      { registered: false },
    ),
    expected: "/history?open-pane=%252",
  },
  {
    name: "a folder outside git (cannot move there)",
    pane: "%2",
    other: project("/work/plain", { status: "none" }, { git: false }),
    expected: "here",
  },
  {
    name: "a project whose server does not answer",
    pane: "%2",
    other: project("/work/sample-lib", {
      status: "unreachable",
      detail: "timed out",
    }),
    expected: "here",
  },
  {
    name: "a pane not in the list",
    pane: "%9",
    other: RUNNING,
    expected: "here",
  },
])("destination: $name → $expected", ({ pane: id, other, expected }) => {
  const target = agentPaneTarget(id, overview(other), "/history");
  expect(target.kind === "project" ? target.path : target.kind).toBe(expected);
});

test("before the first listing, a pane opens here", () => {
  expect(agentPaneTarget("%2", null, "/")).toEqual({ kind: "here" });
});

test.each([
  ["?open-pane=%2512", "%12"],
  ["?open-pane=12", null],
  ["?pane=right", null],
  ["", null],
])("the open-pane parameter %s → %s", (search, expected) => {
  expect(parseOpenPaneOverlay(search)).toBe(expected);
});

test("adding and removing the parameter keeps the rest of the URL", () => {
  const added = withOpenPaneOverlay("/history?pane=right", "%3");
  expect(parseOpenPaneOverlay(added.slice(added.indexOf("?")))).toBe("%3");
  expect(withOpenPaneOverlay(added, null)).toBe("/history?pane=right");
});

// 4 つの経路は同じ入口を、次の形で呼ぶ (app.ts の配線: 通知は
// onNotificationClick、サイドバーは openPane (Alt+クリックは opposite)、
// 全体ボードは openPane、パレットは Agents の run)。
const ENTRIES = [
  { entry: "notification", destination: undefined },
  { entry: "sidebar", destination: undefined },
  { entry: "sidebar (Alt+click)", destination: "opposite" as const },
  { entry: "board", destination: undefined },
  { entry: "palette", destination: undefined },
];

test.each(
  ENTRIES.flatMap((row) => [
    { ...row, pane: "%1", expected: { here: "%1", moved: null } },
    {
      ...row,
      pane: "%2",
      expected: {
        here: null,
        moved: "/work/sample-lib /agents?open-pane=%252",
      },
    },
  ]),
)("$entry, pane $pane → $expected", ({ pane: id, destination, expected }) => {
  let here: string | null = null;
  let moved: string | null = null;
  const open = createAgentPaneOpener({
    overview: () => overview(RUNNING),
    currentPath: () => "/agents",
    openProject: async (info, path) => {
      moved = `${info.root} ${path}`;
    },
    openHere: (paneId) => {
      here = paneId;
    },
  });
  open(id, destination);
  expect({ here, moved }).toEqual(expected);
});
