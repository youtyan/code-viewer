// 登録簿の操作・一覧との合流と並び・開くの判断・止められるかの判定・
// ユーザー単位の設定の優先順位 (いずれも DOM とファイルに触らない部分)。

import { describe, expect, test } from "vitest";
import {
  type AgentPane,
  type AgentProjectInfo,
  type AgentProjectServer,
  groupAgentPanes,
  groupAgentPanesByPlace,
} from "../core/agent-overview";
import type { AgentState } from "../core/agent-state";
import { PROJECT_COLORS, type ProjectColor } from "../core/project-colors";
import {
  addProject,
  canStopProjectServer,
  decideProjectOpen,
  emptyProjectRegistry,
  matchesProjectQuery,
  moveProject,
  type ProjectRegistry,
  parseProjectRegistry,
  placeProject,
  projectDestination,
  projectDropBefore,
  recolorProject,
  registeredProjectInfos,
  removeProject,
  renameProject,
  withRegistryColors,
} from "../core/projects";
import type { AppSettingsState } from "../core/types";
import {
  isUserSettingKey,
  pickUserSettings,
  splitSettingsPatch,
  withUserSettings,
} from "../core/user-settings";
import { agentPane } from "./_test-helpers";

const NOW = Date.parse("2026-09-21T00:00:00.000Z");

function registry(...roots: string[]): ProjectRegistry {
  return {
    version: 1,
    projects: roots.map((root) => ({
      root,
      name: root.slice(root.lastIndexOf("/") + 1),
      addedAt: "2026-09-20T00:00:00.000Z",
    })),
  };
}

function roots(value: ProjectRegistry): string[] {
  return value.projects.map((project) => project.root);
}

describe("parseProjectRegistry", () => {
  test("reads a valid registry in its order", () => {
    const raw = {
      version: 1,
      projects: [
        { root: "/work/b", name: "b", addedAt: "2026-09-20T00:00:00.000Z" },
        { root: "/work/a", name: "a", addedAt: "2026-09-20T00:00:00.000Z" },
      ],
    };
    expect(parseProjectRegistry(raw)).toEqual({ ok: true, registry: raw });
  });

  test.each([
    ["not an object", [], ["not a JSON object"]],
    [
      "unknown version",
      { version: 2, projects: [] },
      ["unsupported version: 2"],
    ],
    ["projects missing", { version: 1 }, ["projects is not an array"]],
    [
      "relative root",
      {
        version: 1,
        projects: [{ root: "work/a", name: "a", addedAt: "x" }],
      },
      ["projects[0].root: not an absolute path"],
    ],
    [
      "the same root twice",
      {
        version: 1,
        projects: [
          { root: "/work/a", name: "a", addedAt: "x" },
          { root: "/work/a", name: "a2", addedAt: "x" },
        ],
      },
      ["projects[1].root: listed twice (/work/a)"],
    ],
    [
      "empty name, missing addedAt (all reported; a port of an older version is not checked)",
      {
        version: 1,
        projects: [{ root: "/work/a", name: " ", port: 70000 }],
      },
      ["projects[0].name: empty", "projects[0].addedAt: not a string"],
    ],
    [
      "entry is not an object",
      { version: 1, projects: ["/work/a"] },
      ["projects[0]: not an object"],
    ],
    [
      "a color outside the palette (not dropped: the next write would lose it)",
      {
        version: 1,
        projects: [
          { root: "/work/a", name: "a", addedAt: "x", color: "teal" },
          { root: "/work/b", name: "b", addedAt: "x", color: 3 },
        ],
      },
      [
        `projects[0].color: "teal" is not one of ${PROJECT_COLORS.join(", ")}`,
        `projects[1].color: 3 is not one of ${PROJECT_COLORS.join(", ")}`,
      ],
    ],
  ])("rejects %s with every reason", (_label, raw, issues) => {
    expect(parseProjectRegistry(raw)).toEqual({ ok: false, issues });
  });
});

describe("changing the registry", () => {
  test.each([
    [
      "adds with the folder name",
      registry(),
      "/work/sample-repo",
      undefined,
      "sample-repo",
    ],
    [
      "adds with a given name",
      registry(),
      "/work/sample-repo",
      " Sample ",
      "Sample",
    ],
    [
      "empty name falls back to the folder",
      registry(),
      "/work/sample-repo",
      "  ",
      "sample-repo",
    ],
  ])("%s", (_label, start, root, name, expected) => {
    const result = addProject(start, { root, name }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).toEqual({
      root,
      name: expected,
      addedAt: "2026-09-21T00:00:00.000Z",
      color: "violet",
    });
    expect(roots(result.registry)).toEqual([root]);
  });

  test.each([
    [
      "the same git root twice",
      registry("/work/a"),
      { root: "/work/a" },
      { code: "duplicate", existing: "a" },
    ],
    [
      "a relative path",
      registry(),
      { root: "work/a" },
      { code: "root", issue: "not an absolute path" },
    ],
    [
      "a name with a control character",
      registry(),
      { root: "/work/a", name: `a${String.fromCharCode(7)}` },
      { code: "name", issue: "contains a control character" },
    ],
  ])("refuses %s", (_label, start, input, issue) => {
    expect(addProject(start, input, NOW)).toEqual({ ok: false, issue });
  });

  test("removes only that project", () => {
    const result = removeProject(registry("/work/a", "/work/b"), "/work/a");
    expect(result.ok && roots(result.registry)).toEqual(["/work/b"]);
  });

  test.each([
    ["renames", "Sample B", "Sample B"],
    ["empty goes back to the folder name", "", "b"],
  ])("%s", (_label, name, expected) => {
    const result = renameProject(
      registry("/work/a", "/work/b"),
      "/work/b",
      name,
    );
    expect(result.ok && result.project.name).toBe(expected);
  });

  test.each<[string, string, -1 | 1, string[]]>([
    ["moves up", "/work/b", -1, ["/work/b", "/work/a", "/work/c"]],
    ["moves down", "/work/b", 1, ["/work/a", "/work/c", "/work/b"]],
    ["stays at the top", "/work/a", -1, ["/work/a", "/work/b", "/work/c"]],
    ["stays at the bottom", "/work/c", 1, ["/work/a", "/work/b", "/work/c"]],
  ])("%s", (_label, root, direction, expected) => {
    const start = registry("/work/a", "/work/b", "/work/c");
    const result = moveProject(start, root, direction);
    expect(result.ok && roots(result.registry)).toEqual(expected);
  });

  test("an edge move returns the same registry (nothing to write)", () => {
    const start = registry("/work/a", "/work/b");
    const result = moveProject(start, "/work/a", -1);
    expect(result.ok && result.registry).toBe(start);
  });

  // ドラッグで落とした位置 (隣の鍵の前、null は末尾) へ置く。
  test.each<[string, string, string | null, string[]]>([
    [
      "to the top",
      "/work/c",
      "/work/a",
      ["/work/c", "/work/a", "/work/b", "/work/d"],
    ],
    [
      "into the middle, upwards",
      "/work/d",
      "/work/b",
      ["/work/a", "/work/d", "/work/b", "/work/c"],
    ],
    [
      "into the middle, downwards",
      "/work/a",
      "/work/c",
      ["/work/b", "/work/a", "/work/c", "/work/d"],
    ],
    [
      "to the end",
      "/work/a",
      null,
      ["/work/b", "/work/c", "/work/d", "/work/a"],
    ],
    [
      "the last to the end stays",
      "/work/d",
      null,
      ["/work/a", "/work/b", "/work/c", "/work/d"],
    ],
    [
      "before the next one stays",
      "/work/b",
      "/work/c",
      ["/work/a", "/work/b", "/work/c", "/work/d"],
    ],
    [
      "before itself stays",
      "/work/b",
      "/work/b",
      ["/work/a", "/work/b", "/work/c", "/work/d"],
    ],
  ])("placeProject: %s", (_label, root, before, expected) => {
    const start = registry("/work/a", "/work/b", "/work/c", "/work/d");
    const result = placeProject(start, root, before);
    expect(result.ok && roots(result.registry)).toEqual(expected);
  });

  test.each<[string, string, string | null]>([
    ["the last to the end", "/work/b", null],
    ["before the next one", "/work/a", "/work/b"],
    ["before itself", "/work/a", "/work/a"],
  ])("placeProject that changes nothing returns the same registry (%s)", (_label, root, before) => {
    const start = registry("/work/a", "/work/b");
    const result = placeProject(start, root, before);
    expect(result.ok && result.registry).toBe(start);
  });

  test.each<[string, string, string | null, string]>([
    ["an unknown project", "/work/x", "/work/a", "/work/x"],
    ["an unknown neighbour", "/work/a", "/work/x", "/work/x"],
  ])("placeProject with %s is not-found", (_label, root, before, missing) => {
    expect(placeProject(registry("/work/a", "/work/b"), root, before)).toEqual({
      ok: false,
      issue: { code: "not-found", root: missing },
    });
  });

  // 並べたことの無いもの (後から登録) は末尾に付き、外したものは順から抜ける。
  test("a later registration goes to the end and a removed one leaves the order", () => {
    let current = registry("/work/a", "/work/b", "/work/c");
    const steps: [
      string,
      (value: ProjectRegistry) => ReturnType<typeof placeProject>,
    ][] = [
      ["place c first", (value) => placeProject(value, "/work/c", "/work/a")],
      ["add d", (value) => addProject(value, { root: "/work/d" }, NOW)],
      ["remove a", (value) => removeProject(value, "/work/a")],
      ["move d up", (value) => moveProject(value, "/work/d", -1)],
    ];
    const seen = steps.map(([label, step]) => {
      const result = step(current);
      if (result.ok === false)
        throw new Error(`${label}: ${JSON.stringify(result.issue)}`);
      current = result.registry;
      return [label, roots(current)];
    });
    expect(seen).toEqual([
      ["place c first", ["/work/c", "/work/a", "/work/b"]],
      ["add d", ["/work/c", "/work/a", "/work/b", "/work/d"]],
      ["remove a", ["/work/c", "/work/b", "/work/d"]],
      ["move d up", ["/work/c", "/work/d", "/work/b"]],
    ]);
  });

  test.each([
    ["remove", (value: ProjectRegistry) => removeProject(value, "/work/x")],
    [
      "rename",
      (value: ProjectRegistry) => renameProject(value, "/work/x", "x"),
    ],
    ["move", (value: ProjectRegistry) => moveProject(value, "/work/x", 1)],
    [
      "recolor",
      (value: ProjectRegistry) => recolorProject(value, "/work/x", "blue"),
    ],
  ])("%s of an unknown project is not-found", (_label, change) => {
    expect(change(registry("/work/a"))).toEqual({
      ok: false,
      issue: { code: "not-found", root: "/work/x" },
    });
  });

  test("a port remembered by an older version is read and dropped", () => {
    expect(
      parseProjectRegistry({
        version: 1,
        projects: [{ root: "/work/a", name: "a", port: 64123, addedAt: "x" }],
      }),
    ).toEqual({
      ok: true,
      registry: {
        version: 1,
        projects: [{ root: "/work/a", name: "a", addedAt: "x" }],
      },
    });
  });

  test("a registry without colors (an older version's) reads as it is", () => {
    const raw = {
      version: 1,
      projects: [
        { root: "/work/a", name: "a", addedAt: "x" },
        { root: "/work/b", name: "b", addedAt: "x", color: "pink" },
      ],
    };
    expect(parseProjectRegistry(raw)).toEqual({ ok: true, registry: raw });
  });

  test("an empty registry has version 1", () => {
    expect(emptyProjectRegistry()).toEqual({ version: 1, projects: [] });
  });
});

describe("project colors in the registry", () => {
  function colored(...entries: [string, ProjectColor | undefined][]) {
    return {
      version: 1 as const,
      projects: entries.map(([root, color]) => ({
        root,
        name: root.slice(root.lastIndexOf("/") + 1),
        addedAt: "2026-09-20T00:00:00.000Z",
        ...(color ? { color } : {}),
      })),
    };
  }
  const colors = (value: ProjectRegistry) =>
    value.projects.map((project) => project.color);

  test.each<[string, ProjectRegistry, ProjectColor]>([
    ["the first registration gets the first color", colored(), "violet"],
    [
      "a registration takes a color nobody uses",
      colored(["/work/a", "violet"], ["/work/b", "green"]),
      "orange",
    ],
    [
      "the color of a removed project is handed out again",
      colored(["/work/a", "violet"], ["/work/c", "orange"]),
      "green",
    ],
  ])("%s", (_label, start, expected) => {
    const result = addProject(start, { root: "/work/new" }, NOW);
    if (result.ok === false) throw new Error(JSON.stringify(result.issue));
    expect(result.project.color).toBe(expected);
  });

  test("recolorProject changes only that project's color", () => {
    const result = recolorProject(
      colored(["/work/a", "violet"], ["/work/b", "green"]),
      "/work/b",
      "red",
    );
    if (result.ok === false) throw new Error(JSON.stringify(result.issue));
    expect(colors(result.registry)).toEqual(["violet", "red"]);
  });

  test("recolorProject to the same color returns the same registry (nothing to write)", () => {
    const start = colored(["/work/a", "violet"]);
    const result = recolorProject(start, "/work/a", "violet");
    expect(result.ok && result.registry).toBe(start);
  });

  test.each<[string, ProjectRegistry, ProjectColor[]]>([
    [
      "every project of an older registry gets a color in its order",
      colored(
        ["/work/a", undefined],
        ["/work/b", undefined],
        ["/work/c", undefined],
      ),
      ["violet", "green", "orange"],
    ],
    [
      "colors already chosen stay and are not handed out twice",
      colored(["/work/a", undefined], ["/work/b", "violet"]),
      ["green", "violet"],
    ],
  ])("withRegistryColors: %s", (_label, start, expected) => {
    expect(colors(withRegistryColors(start))).toEqual(expected);
  });

  test("withRegistryColors returns the same registry when every project has a color", () => {
    const start = colored(["/work/a", "blue"]);
    expect(withRegistryColors(start)).toBe(start);
  });

  test("registeredProjectInfos always has a color (even before it is saved)", () => {
    expect(
      registeredProjectInfos(
        colored(["/work/a", undefined], ["/work/b", "violet"]),
      ),
    ).toEqual([
      { root: "/work/a", name: "a", color: "green", order: 0 },
      { root: "/work/b", name: "b", color: "violet", order: 1 },
    ]);
  });
});

describe("decideProjectOpen / canStopProjectServer", () => {
  const running: AgentProjectServer = {
    status: "running",
    url: "http://127.0.0.1:64101/",
    launched: true,
  };
  test.each<[string, AgentProjectServer, boolean, boolean, unknown]>([
    ["this screen", { status: "current" }, true, true, { kind: "current" }],
    [
      "running (registered or not)",
      running,
      false,
      true,
      { kind: "navigate", url: "http://127.0.0.1:64101/" },
    ],
    [
      "stopped and registered",
      { status: "absent" },
      true,
      true,
      { kind: "start" },
    ],
    [
      "stopped and not registered",
      { status: "absent" },
      false,
      true,
      { kind: "register-first" },
    ],
    [
      "outside git",
      { status: "none" },
      true,
      false,
      { kind: "unavailable", reason: "not a git repository" },
    ],
    [
      "registry entry not answering",
      { status: "unreachable", detail: "timed out" },
      true,
      true,
      { kind: "unavailable", reason: "timed out" },
    ],
  ])("%s", (_label, server, registered, git, expected) => {
    expect(decideProjectOpen({ server, registered, git })).toEqual(expected);
  });

  test.each<[string, AgentProjectServer, boolean]>([
    ["started by code-viewer", running, true],
    ["started by the user", { ...running, launched: false }, false],
    ["this screen", { status: "current" }, false],
    ["not running", { status: "absent" }, false],
    ["unreachable", { status: "invalid", detail: "x" }, false],
  ])("stop: %s", (_label, server, expected) => {
    expect(canStopProjectServer(server)).toBe(expected);
  });
});

describe("projectDestination", () => {
  test.each([
    ["the same screen", "/history", "http://127.0.0.1:64101/history"],
    [
      "with a query",
      "/todif?from=HEAD&to=worktree",
      "http://127.0.0.1:64101/todif?from=HEAD&to=worktree",
    ],
    [
      "another origin is refused",
      "//example.invalid/x",
      "http://127.0.0.1:64101/",
    ],
    [
      "a full URL is refused",
      "http://example.invalid/",
      "http://127.0.0.1:64101/",
    ],
  ])("%s", (_label, path, expected) => {
    expect(projectDestination("http://127.0.0.1:64101/", path)).toBe(expected);
  });

  // 入口のサーバの下では、プロジェクトの根は `/p/<鍵>/`。パスはその下に付く。
  test.each([
    [
      "the same screen",
      "/history",
      "http://127.0.0.1:64101/p/0123456789abcdef/history",
    ],
    ["the top", "/", "http://127.0.0.1:64101/p/0123456789abcdef/"],
    [
      "with a query",
      "/file?path=README.md",
      "http://127.0.0.1:64101/p/0123456789abcdef/file?path=README.md",
    ],
    [
      "another origin is refused",
      "//example.invalid/x",
      "http://127.0.0.1:64101/p/0123456789abcdef/",
    ],
  ])("under the entry server: %s", (_label, path, expected) => {
    expect(
      projectDestination("http://127.0.0.1:64101/p/0123456789abcdef/", path),
    ).toBe(expected);
  });

  test.each([
    ["an external host", "https://example.invalid/"],
    ["a lookalike loopback host", "http://127.0.0.1.example.invalid:64101/"],
    ["an executable scheme", "javascript:alert(1)"],
  ])("rejects %s as a project server URL", (_label, serverUrl) => {
    expect(() => projectDestination(serverUrl, "/history")).toThrow(
      "project server URL must be an HTTP loopback URL",
    );
  });

  test.each([
    "/../admin",
    "/%2e%2e/admin",
    "/a/../../admin",
  ])("keeps an escaping path inside the project prefix: %s", (path) => {
    expect(
      projectDestination("http://127.0.0.1:64101/p/0123456789abcdef/", path),
    ).toBe("http://127.0.0.1:64101/p/0123456789abcdef/");
  });
});

describe("matchesProjectQuery", () => {
  test.each([
    ["", true],
    ["sample", true],
    ["SAMPLE repo", true],
    ["work other", false],
    ["other", false],
  ])("%j", (query, expected) => {
    expect(
      matchesProjectQuery(
        { name: "sample-repo", root: "/work/sample-repo" },
        query,
      ),
    ).toBe(expected);
  });
});

describe("groupAgentPanes with registered projects", () => {
  function info(root: string, order: number | null): AgentProjectInfo {
    const name = root.slice(root.lastIndexOf("/") + 1);
    return {
      root,
      name,
      displayRoot: root,
      git: true,
      error: "",
      server: { status: "absent" },
      registered:
        order === null ? null : { root, name, order, color: "violet" },
    };
  }
  function pane(id: string, project: string, state: AgentState): AgentPane {
    return agentPane({
      id,
      label: `s:${id}`,
      session: "s",
      path: project,
      state,
      source: "screen",
      updatedAt: 100,
      project,
    });
  }
  const projects = [
    info("/work/reg-first", 0),
    info("/work/reg-second", 1),
    info("/work/reg-idle", 2),
    info("/work/other-idle", null),
    info("/work/other-waiting", null),
  ];
  const panes = [
    pane("%1", "/work/other-idle", "idle"),
    pane("%2", "/work/reg-idle", "idle"),
    pane("%3", "/work/other-waiting", "waiting"),
    pane("%4", "/work/reg-second", "working"),
  ];

  // 全体ボードもサイドバーと同じ 1 つの順。入力待ちを含むものも前へ出ない。
  test("registered in the user's order, then the rest by name, whatever the states", () => {
    const order = groupAgentPanes(panes, projects, {
      includeEmptyRegistered: true,
    }).map((group) => [group.info.root, group.panes.length]);
    expect(order).toEqual([
      ["/work/reg-first", 0],
      ["/work/reg-second", 1],
      ["/work/reg-idle", 1],
      ["/work/other-idle", 1],
      ["/work/other-waiting", 1],
    ]);
  });

  // 並べた順は 1 つ: 全体ボードとサイドバーでプロジェクトの並びが同じ。
  test.each<[string, AgentState[]]>([
    ["all idle", ["idle", "idle", "idle", "idle"]],
    ["waiting in an unregistered one", ["idle", "idle", "waiting", "idle"]],
    ["working in the last registered", ["idle", "idle", "idle", "working"]],
    ["mixed", ["done", "waiting", "working", "idle"]],
  ])("the board and the sidebar list projects in the same order (%s)", (_label, states) => {
    const mixed = panes.map((item, index) => ({
      ...item,
      state: states[index] ?? "idle",
    }));
    const board = groupAgentPanes(mixed, projects, {
      includeEmptyRegistered: true,
    }).map((group) => group.info.root);
    const sidebar = groupAgentPanesByPlace(mixed, projects, {
      includeEmptyRegistered: true,
    }).map((group) => group.info.root);
    expect([board, sidebar]).toEqual([
      [
        "/work/reg-first",
        "/work/reg-second",
        "/work/reg-idle",
        "/work/other-idle",
        "/work/other-waiting",
      ],
      [
        "/work/reg-first",
        "/work/reg-second",
        "/work/reg-idle",
        "/work/other-idle",
        "/work/other-waiting",
      ],
    ]);
  });

  test("registered projects without agents are left out while filtering", () => {
    const order = groupAgentPanes(panes, projects).map(
      (group) => group.info.root,
    );
    expect(order).not.toContain("/work/reg-first");
  });
});

describe("groupAgentPanesByPlace (the sidebar order)", () => {
  function info(root: string, order: number | null): AgentProjectInfo {
    const name = root.slice(root.lastIndexOf("/") + 1);
    return {
      root,
      name,
      displayRoot: root,
      git: true,
      error: "",
      server: { status: "absent" },
      registered:
        order === null ? null : { root, name, order, color: "violet" },
    };
  }
  function pane(
    id: string,
    label: string,
    project: string,
    state: AgentState,
  ): AgentPane {
    return agentPane({
      id,
      label,
      session: label.slice(0, label.indexOf(":")),
      path: project,
      state,
      source: "screen",
      updatedAt: 100,
      project,
    });
  }
  const registered = [
    info("/work/reg-first", 0),
    info("/work/reg-second", 1),
    info("/work/reg-third", 2),
  ];
  function order(panes: AgentPane[], projects: AgentProjectInfo[]) {
    return groupAgentPanesByPlace(panes, projects, {
      includeEmptyRegistered: true,
    }).map((group) => [group.info.root, group.panes.map((item) => item.id)]);
  }

  test.each<{ name: string; states: [AgentState, AgentState, AgentState] }>([
    { name: "all idle", states: ["idle", "idle", "idle"] },
    { name: "the last one waits", states: ["idle", "idle", "waiting"] },
    { name: "the middle one works", states: ["idle", "working", "idle"] },
    { name: "the first one is done", states: ["done", "idle", "waiting"] },
  ])("state changes do not move anything: $name", ({ states }) => {
    const panes = [
      pane("%3", "work:2.0", "/work/reg-third", states[2]),
      pane("%2", "work:1.1", "/work/reg-second", states[1]),
      pane("%1", "work:1.0", "/work/reg-second", states[0]),
    ];
    expect(order(panes, registered)).toEqual([
      ["/work/reg-first", []],
      ["/work/reg-second", ["%1", "%2"]],
      ["/work/reg-third", ["%3"]],
    ]);
  });

  test("rows follow the tmux place: session, then window, then pane (as numbers)", () => {
    const panes = [
      pane("%4", "beta:0.0", "/work/reg-first", "waiting"),
      pane("%3", "alpha:10.0", "/work/reg-first", "idle"),
      pane("%2", "alpha:2.1", "/work/reg-first", "working"),
      pane("%1", "alpha:2.0", "/work/reg-first", "idle"),
    ];
    expect(order(panes, registered)[0]).toEqual([
      "/work/reg-first",
      ["%1", "%2", "%3", "%4"],
    ]);
  });

  test("unregistered projects come and go without moving the registered ones", () => {
    const base = [pane("%1", "work:0.0", "/work/reg-second", "idle")];
    const withOthers = [
      ...base,
      pane("%9", "work:9.0", "/work/zeta", "waiting"),
      pane("%8", "work:8.0", "/work/alpha", "idle"),
    ];
    const projects = [
      ...registered,
      info("/work/zeta", null),
      info("/work/alpha", null),
    ];
    const registeredPart = (rows: ReturnType<typeof order>) => rows.slice(0, 3);
    expect(registeredPart(order(withOthers, projects))).toEqual(
      registeredPart(order(base, projects)),
    );
    // 登録していないものは登録したものの後に、名前の順で。
    expect(order(withOthers, projects).slice(3)).toEqual([
      ["/work/alpha", ["%8"]],
      ["/work/zeta", ["%9"]],
    ]);
  });

  test("unregistered projects with the same name are ordered by path", () => {
    const projects = [info("/b/sample", null), info("/a/sample", null)];
    const panes = [
      pane("%1", "work:0.0", "/b/sample", "waiting"),
      pane("%2", "work:1.0", "/a/sample", "idle"),
    ];
    expect(order(panes, projects).map(([root]) => root)).toEqual([
      "/a/sample",
      "/b/sample",
    ]);
  });
});

describe("user settings", () => {
  const repo: AppSettingsState = {
    version: 1,
    theme: "dark",
    language: "ja",
    sidebarFontSize: "large",
    keybindings: { "toggle-theme": [{ key: "k" }] },
    agentHookHintDismissed: true,
    ignoreWhitespace: true,
    scopeOmitDirs: ["node_modules"],
  };

  // 移る = 別のポートのページへ移る。骨格の見た目を localStorage に置くと
  // 移るたびに戻るので、全部ユーザー単位の項目でなければならない。
  test.each([
    "theme",
    "palette",
    "navCollapsed",
    "navWidth",
    "navCollapsedProjects",
    "navStoppedProjectsOpen",
  ])("the workspace look %s is a per-person item", (key) => {
    expect(isUserSettingKey(key)).toBe(true);
  });

  test("the first run takes over only the per-person items", () => {
    expect(pickUserSettings(repo)).toEqual({
      version: 1,
      theme: "dark",
      language: "ja",
      sidebarFontSize: "large",
      keybindings: { "toggle-theme": [{ key: "k" }] },
      agentHookHintDismissed: true,
    });
  });

  test.each<
    [string, Parameters<typeof withUserSettings>[1], Partial<AppSettingsState>]
  >([
    [
      "no user settings yet: the repository values",
      null,
      { theme: "dark", language: "ja", sidebarFontSize: "large" },
    ],
    [
      "user settings win",
      { version: 1, theme: "light", language: "en" },
      { theme: "light", language: "en" },
    ],
    [
      "a per-person item missing from the user settings is the default, not the repository value",
      { version: 1, theme: "light" },
      { theme: "light", language: undefined, sidebarFontSize: undefined },
    ],
  ])("%s", (_label, user, expected) => {
    const merged = withUserSettings(repo, user);
    for (const [key, value] of Object.entries(expected)) {
      expect(merged[key as keyof AppSettingsState]).toEqual(value);
    }
    // リポジトリだけの項目はいつもリポジトリの値。
    expect(merged.ignoreWhitespace).toBe(true);
    expect(merged.scopeOmitDirs).toEqual(["node_modules"]);
  });

  test("a change is split into per-person and repository parts", () => {
    expect(
      splitSettingsPatch({
        version: 1,
        theme: "light",
        keybindings: null,
        hideTests: true,
        range: { from: "a", to: "b" },
      }),
    ).toEqual({
      user: { theme: "light", keybindings: null },
      repo: { hideTests: true, range: { from: "a", to: "b" } },
    });
  });
});

describe("projectDropBefore (where a dragged heading lands)", () => {
  const order = ["/work/a", "/work/b", "/work/c"];
  // 隙間の番号: 0 = a の前, 1 = a と b の間, 2 = b と c の間, 3 = c の後。
  test.each<[string, string, number, { before: string | null } | null]>([
    ["a to the gap before c", "/work/a", 2, { before: "/work/c" }],
    ["a to the end", "/work/a", 3, { before: null }],
    ["c to the top", "/work/c", 0, { before: "/work/a" }],
    ["c between a and b", "/work/c", 1, { before: "/work/b" }],
    ["b to the top", "/work/b", 0, { before: "/work/a" }],
    ["b to the end", "/work/b", 3, { before: null }],
    ["b just above itself does nothing", "/work/b", 1, null],
    ["b just below itself does nothing", "/work/b", 2, null],
    ["a at the top does nothing", "/work/a", 0, null],
    ["c at the end does nothing", "/work/c", 3, null],
    ["a gap past the end does nothing", "/work/a", 4, null],
    ["a negative gap does nothing", "/work/a", -1, null],
    ["an unknown heading does nothing", "/work/x", 0, null],
  ])("%s", (_label, dragged, gap, expected) => {
    expect(projectDropBefore(order, dragged, gap)).toEqual(expected);
  });
});
