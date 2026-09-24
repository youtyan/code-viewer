// メインの面のタブ列 (#main-tabs) が、利用者が何もしていないのに並び替わる経路の
// 再現と、直した後の回帰テスト (1〜3 とも直した)。
//
// 1. グループの並びが「左の一覧の並び」になっていなかった。PROJECT_LOOKS.order() が
//    エージェント一覧の応答の projects の並び (tmux のペインの順が先、登録簿が後)
//    をそのまま返し、エージェントが起きる・終わるたびにグループの順が動いた。
//    直した: compareProjectsByRegistry で並べ、一覧から消えた根も前の位置に残す。
// 2. シェルのタブのグループが一瞬分からなくなる (tmux の一覧が取れなかった応答・
//    シェルが映すペインを一瞬見失う・cd で別のプロジェクトへ出て戻る) と、戻った
//    ときにそのタブがグループの末尾へ行っていた (regroup は「今の位置」で並べ直す
//    ため)。直した: 分からない間は控えのまま (shellGroupOf)、外れて戻ったタブは
//    元の左隣の右へ (main-tabs-view の returnHome)。この節は緑。
// 3. 2 つの窓が同時に並べ替えると、どちらも動かしていないタブが端へ飛んだ
//    (mergeLayouts が「すぐ左のタブが変わった」タブを全部「動かした」と数えた)。
//    直した: 動かしたタブは最長共通部分列に入らないものだけ (乱数の回帰テストは
//    main-tabs-merge.test.ts)。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { groupAgentPanesByPlace } from "../core/agent-overview";
import type { Layout, Tab, TabTarget } from "../core/main-tabs";
import { mergeLayouts } from "../core/main-tabs-merge";
import type { RegisteredProjectInfo } from "../core/projects";
import type { AppRoute } from "../core/routes";
import type { ShellSession } from "../core/shell";
import type { TmuxPanesResponse } from "../core/tmux";
import {
  type AgentOverviewDeps,
  buildAgentOverview,
} from "../server/terminal/overview";
import {
  createMainTabsView,
  type MainTabsDeps,
  shellGroupOf,
} from "../views/main-tabs/main-tabs-view";
import { createProjectLooks } from "../views/projects/project-looks";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.replaceChildren();
});

const ALPHA = "/work/sample-alpha";
const BETA = "/work/sample-beta";
const GAMMA = "/work/sample-gamma";
/** 登録していないが、エージェントが居るプロジェクト。 */
const LOOSE = "/work/sample-loose";

const registered: RegisteredProjectInfo[] = [
  { root: ALPHA, name: "sample-alpha", color: "violet", order: 0 },
  { root: BETA, name: "sample-beta", color: "green", order: 1 },
  { root: GAMMA, name: "sample-gamma", color: "orange", order: 2 },
];

// ai-dup-check: allow -- todo:agent-overview-server.test.ts の panesResponse と共通の部品へ移す (このファイルを足した調査では他のテストに手を入れない)
function panesAt(
  panes: { id: string; path: string; command: string }[],
): TmuxPanesResponse {
  return {
    available: true,
    running: true,
    sessions: [
      {
        name: "sample-session",
        attached: false,
        windows: [
          {
            index: 0,
            name: "main",
            active: true,
            panes: panes.map((item, index) => ({
              id: item.id,
              label: `sample-session:0.${index}`,
              paneIndex: index,
              title: "",
              command: item.command,
              path: item.path,
              pid: 0,
              width: 80,
              height: 24,
              active: index === 0,
              inRepo: true,
            })),
          },
        ],
      },
    ],
  };
}

/** 本物の buildAgentOverview に、tmux のペインと登録簿だけを差し込む。 */
function overviewDeps(
  panes: { id: string; path: string; command: string }[],
): AgentOverviewDeps {
  return {
    serverInstance: "sample-instance",
    home: "/work",
    serverRoot: ALPHA,
    listPanes: async () => panesAt(panes),
    listStates: () => [],
    activityObservedAt: () => 0,
    observationErrors: () => [],
    listShells: () => [],
    listClients: async () => ({ status: "ok", clients: [] }),
    firstListed: new Map(),
    resolveProject: async (path) => ({
      kind: "root",
      root: path,
      toplevel: path,
    }),
    findServer: async () => ({ status: "absent" }),
    forgetServer: () => undefined,
    paneAccounts: async () => new Map(),
    readRegistry: () => ({
      projects: registered,
      error: "",
      path: "/work/projects.json",
    }),
    rootExists: () => true,
    now: () => 1000,
  };
}

const range = { from: "HEAD", to: "worktree" };
const fileRoute = (path: string): AppRoute => ({
  screen: "file",
  path,
  ref: "worktree",
  range,
  view: "blob",
});

/** タブ列 (グループごとの札とタブ) を持つ画面の部品を 1 つ作る。 */
function mountTabs(saved: unknown, extra: Partial<MainTabsDeps>) {
  const mount = document.createElement("nav");
  document.body.append(mount);
  let current: AppRoute = fileRoute("src/app.ts");
  const initials: Record<string, string> = {
    [ALPHA]: "AL",
    [BETA]: "BE",
    [GAMMA]: "GA",
    [LOOSE]: "LO",
  };
  const handle = createMainTabsView({
    mount,
    getLanguage: () => "en",
    pageLabel: (page) => page,
    navigate: (route) => {
      current = route;
      handle.syncRoute(route);
    },
    currentRoute: () => current,
    defaultRoute: (target: TabTarget): AppRoute =>
      target.kind === "file"
        ? fileRoute(target.path)
        : ({ screen: "diff", range } as AppRoute),
    homeRoute: () => ({ screen: "repo", ref: "worktree", path: "", range }),
    copyPath: () => undefined,
    onNewTab: () => undefined,
    stopTerminal: () => undefined,
    terminalMenuItems: () => [],
    loadSaved: async () => ({ layout: saved, rev: 1, root: ALPHA }),
    save: async () => undefined,
    backupSaved: async () => {
      throw new Error("no backup in this test");
    },
    newTabId: (() => {
      let n = 0;
      return () => `n${++n}`;
    })(),
    terminalInfo: (session) => ({ label: session, state: null }),
    onPanes: () => undefined,
    onTerminals: () => undefined,
    projectLook: (root) =>
      initials[root]
        ? { root, name: root, initials: initials[root], color: null }
        : null,
    foreignInPlace: () => true,
    switchProject: () => undefined,
    ...extra,
  });
  handle.syncRoute(current);
  /** 左の面のタブ列を並びのまま書く: `札(タブ タブ)`。 */
  const strip = () =>
    [
      ...mount.querySelectorAll<HTMLElement>(
        '.main-tabs-pane[data-side="left"] .main-tabs-strip > [data-group]:not(.main-tab-group)',
      ),
    ].map((group) => {
      const root = group.getAttribute("data-group") ?? "";
      const tabs = [...group.querySelectorAll(".main-tab-name")].map(
        (name) => name.textContent,
      );
      return `${initials[root] ?? "-"}(${tabs.join(" ")})`;
    });
  return { handle, strip };
}

const owned = (id: string, path: string, project: string) => ({
  id,
  preview: false,
  target: { kind: "file", path, project },
});

describe("グループの並び (左の一覧の並び)", () => {
  test("タブのグループの並びは、左の一覧の並び (登録した順 → 登録していないもの) と同じ", async () => {
    // 登録していない LOOSE と、登録簿の最後の GAMMA にだけエージェントが居る。
    const overview = await buildAgentOverview(
      overviewDeps([
        { id: "%1", path: LOOSE, command: "claude" },
        { id: "%2", path: GAMMA, command: "codex" },
      ]),
    );
    const looks = createProjectLooks();
    looks.update(overview);
    const sidebar = groupAgentPanesByPlace(
      overview.panes.filter((pane) => pane.kind !== null),
      overview.projects,
      { includeEmptyRegistered: true },
    ).map((group) => group.info.root);
    expect(sidebar).toEqual([ALPHA, BETA, GAMMA, LOOSE]);
    // 前は [LOOSE, GAMMA, ALPHA, BETA] (tmux のペインの順が先に来た)。
    expect(looks.order()).toEqual(sidebar);
  });

  test("エージェントが終わっても、タブのグループの並びは動かない", async () => {
    const looks = createProjectLooks();
    looks.update(
      await buildAgentOverview(
        overviewDeps([{ id: "%1", path: GAMMA, command: "claude" }]),
      ),
    );
    const { handle, strip } = mountTabs(
      {
        version: 5,
        focused: "left",
        panes: [
          {
            side: "left",
            activeId: "a1",
            tabs: [
              owned("a1", "src/app.ts", ALPHA),
              owned("g1", "src/gamma.ts", GAMMA),
            ],
          },
        ],
      },
      { projectOrder: () => looks.order() },
    );
    await handle.restore();
    const before = strip();
    // GAMMA のエージェントが終わった (ペインが無くなった) 次の取り直し。
    looks.update(await buildAgentOverview(overviewDeps([])));
    handle.localize();
    // 前は before が GAMMA 先・after が ALPHA 先 (グループの札ごと入れ替わった)。
    expect({ before, after: strip() }).toEqual({
      before: ["AL(app.ts)", "GA(gamma.ts)"],
      after: ["AL(app.ts)", "GA(gamma.ts)"],
    });
  });

  test("一覧から消えたプロジェクトも、前の位置に残す (一覧に無いもの全部と同じ末尾へ飛ばない)", async () => {
    const looks = createProjectLooks();
    const EXTRA = "/work/sample-extra";
    looks.update(
      await buildAgentOverview(
        overviewDeps([
          { id: "%1", path: LOOSE, command: "claude" },
          { id: "%2", path: EXTRA, command: "codex" },
        ]),
      ),
    );
    const before = looks.order();
    // 名前の順で先の EXTRA のエージェントが終わった。
    looks.update(
      await buildAgentOverview(
        overviewDeps([{ id: "%1", path: LOOSE, command: "claude" }]),
      ),
    );
    expect({ before, after: looks.order() }).toEqual({
      before: [ALPHA, BETA, GAMMA, EXTRA, LOOSE],
      after: [ALPHA, BETA, GAMMA, EXTRA, LOOSE],
    });
  });

  test("tmux の一覧が取れなかった応答では、前の並び・色・頭文字を保ち、知らせない", async () => {
    const looks = createProjectLooks();
    const agent = [{ id: "%1", path: LOOSE, command: "claude" }];
    looks.update(await buildAgentOverview(overviewDeps(agent)));
    const before = { order: looks.order(), alpha: looks.get(ALPHA) };
    let told = 0;
    looks.subscribe(() => {
      told += 1;
    });
    const failed = await buildAgentOverview({
      ...overviewDeps(agent),
      listPanes: async () => {
        throw new Error("sample tmux failure");
      },
    });
    expect(failed.projects).toEqual([]);
    looks.update(failed);
    expect({
      order: looks.order(),
      alpha: looks.get(ALPHA),
      told,
    }).toEqual({ ...before, told: 0 });
    expect(before.alpha?.color).toBe("violet");
  });
});

describe("シェルのタブのグループが一瞬分からなくなる", () => {
  // グループが一瞬外れて戻る: cd で別のプロジェクトへ出て戻る・控えの無いシェルが
  // 一瞬どのグループでもなくなる。戻ったら元の左隣の右へ入る (前はグループの
  // 末尾へ入っていた: regroup は今の位置で並べ直す)。
  const shellTab = (id: string, session: string) => ({
    id,
    preview: false,
    target: { kind: "terminal", session },
  });
  const saved = (extra: object = {}) => ({
    version: 5,
    focused: "left",
    panes: [
      {
        side: "left",
        activeId: "a1",
        tabs: [
          owned("a1", "src/app.ts", ALPHA),
          shellTab("s1", "shell-one"),
          shellTab("s2", "shell-two"),
          owned("a2", "README.md", ALPHA),
          owned("b1", "src/beta.ts", BETA),
        ],
      },
    ],
    ...extra,
  });
  type Groups = Record<string, string | null | undefined>;
  /** 描き直し (一覧の取り直し) ごとのシェルのグループ。書いていないシェルは ALPHA。 */
  function mountShells(extra: object = {}) {
    let groups: Groups = {};
    const mounted = mountTabs(saved(extra), {
      projectOrder: () => [ALPHA, BETA],
      terminalProject: (session) =>
        session in groups ? groups[session] : ALPHA,
    });
    const step = (next: Groups) => {
      groups = next;
      mounted.handle.localize();
      return mounted.strip();
    };
    return { ...mounted, step };
  }

  test.each([
    {
      name: "どのグループでもなくなって (右端へ) 戻る",
      away: [{ "shell-one": null }],
      close: null,
      expected: ["AL(app.ts shell-one shell-two README.md)", "BE(beta.ts)"],
    },
    {
      name: "別のプロジェクトのグループへ出て戻る",
      away: [{ "shell-one": BETA }],
      close: null,
      expected: ["AL(app.ts shell-one shell-two README.md)", "BE(beta.ts)"],
    },
    {
      name: "2 つ一緒に外れて一緒に戻る",
      away: [{ "shell-one": null, "shell-two": null }],
      close: null,
      expected: ["AL(app.ts shell-one shell-two README.md)", "BE(beta.ts)"],
    },
    {
      name: "2 つ一緒に外れ、右のものが先に戻る",
      away: [{ "shell-one": null, "shell-two": null }, { "shell-one": null }],
      close: null,
      expected: ["AL(app.ts shell-one shell-two README.md)", "BE(beta.ts)"],
    },
    {
      name: "外れている間に元の左隣が閉じられた (グループの先頭へ)",
      away: [{ "shell-one": BETA }],
      close: "a1",
      expected: ["AL(shell-one shell-two README.md)", "BE(beta.ts)"],
    },
    {
      name: "外れている間に元の左隣が閉じられた (残っているいちばん近い左の右へ)",
      away: [{ "shell-two": BETA }],
      close: "s1",
      expected: ["AL(app.ts shell-two README.md)", "BE(beta.ts)"],
    },
  ])("$name と、グループの中の元の位置に戻る", async ({
    away,
    close,
    expected,
  }) => {
    const { handle, strip, step } = mountShells();
    await handle.restore();
    expect(strip()).toEqual([
      "AL(app.ts shell-one shell-two README.md)",
      "BE(beta.ts)",
    ]);
    for (const groups of away) step(groups);
    if (close) handle.closeTab(close);
    expect(step({})).toEqual(expected);
  });

  test("グループが一時的に分からない (undefined) 間は、控えのまま動かない", async () => {
    const { handle, strip, step } = mountShells({
      terminalGroups: { "shell-one": ALPHA, "shell-two": ALPHA },
    });
    await handle.restore();
    const before = strip();
    expect([
      step({ "shell-one": undefined }),
      step({ "shell-one": undefined, "shell-two": undefined }),
      step({}),
    ]).toEqual([before, before, before]);
  });
});

describe("shellGroupOf (シェルのタブのグループ)", () => {
  const shell = (over: Partial<ShellSession> = {}): ShellSession => ({
    id: "shell-one",
    command: "zsh",
    cwd: `${BETA}/src`,
    createdAt: "2026-01-01T00:00:00.000Z",
    cols: 80,
    rows: 24,
    exited: false,
    exitCode: null,
    tty: "/dev/ttys001",
    ...over,
  });
  const agentHere = [{ id: "%1", path: GAMMA, command: "claude" }];
  // 応答は本物の buildAgentOverview で作る (tmux の失敗・クライアントの一覧の失敗)。
  const overviews = {
    ok: () => buildAgentOverview(overviewDeps(agentHere)),
    tmuxFailed: () =>
      buildAgentOverview({
        ...overviewDeps(agentHere),
        listPanes: async () => {
          throw new Error("sample tmux failure");
        },
      }),
    clientsFailed: () =>
      buildAgentOverview({
        ...overviewDeps(agentHere),
        listClients: async () => ({
          status: "error",
          error: new Error("sample list-clients failure"),
        }),
      }),
  };
  test.each([
    {
      name: "一覧がまだ無い",
      overview: null,
      pane: false,
      shell: shell(),
      showed: false,
      expected: undefined,
    },
    {
      name: "映しているペインのプロジェクト",
      overview: "ok",
      pane: true,
      shell: shell(),
      showed: false,
      expected: GAMMA,
    },
    {
      name: "tmux の一覧が取れなかった",
      overview: "tmuxFailed",
      pane: false,
      shell: shell(),
      showed: false,
      expected: undefined,
    },
    {
      name: "tmux のクライアントの一覧が取れなかった",
      overview: "clientsFailed",
      pane: false,
      shell: shell(),
      showed: false,
      expected: undefined,
    },
    {
      name: "ペインを映していたシェルの結び付きが外れている",
      overview: "ok",
      pane: false,
      shell: shell(),
      showed: true,
      expected: undefined,
    },
    {
      name: "シェルの一覧がまだ無い",
      overview: "ok",
      pane: false,
      shell: null,
      showed: false,
      expected: undefined,
    },
    {
      name: "シェルの端末名がまだ引けていない",
      overview: "ok",
      pane: false,
      shell: shell({ tty: "" }),
      showed: false,
      expected: undefined,
    },
    {
      name: "素のシェルは起こしたフォルダのプロジェクト",
      overview: "ok",
      pane: false,
      shell: shell(),
      showed: false,
      expected: BETA,
    },
    {
      name: "どのプロジェクトの中でもないシェルは null",
      overview: "ok",
      pane: false,
      shell: shell({ cwd: "/tmp/sample" }),
      showed: false,
      expected: null,
    },
    {
      name: "シェルの一覧に無い (起き直して終わったシェルのタブ。開き直すまで控えのまま)",
      overview: "ok",
      pane: false,
      shell: undefined,
      showed: false,
      expected: undefined,
    },
  ] as const)("$name", async ({
    overview,
    pane,
    shell: listed,
    showed,
    expected,
  }) => {
    const response = overview === null ? null : await overviews[overview]();
    expect(
      shellGroupOf({
        overview: response,
        pane: pane ? response?.panes[0] : undefined,
        shell: listed,
        showedPane: showed,
        roots: [ALPHA, BETA, GAMMA],
      }),
    ).toBe(expected);
  });
});

describe("2 つの窓が同時に並べ替える (mergeLayouts)", () => {
  const tab = (id: string): Tab => ({
    id,
    preview: false,
    target: { kind: "file", path: `${id}.ts`, project: ALPHA },
  });
  const one = (ids: string[]): Layout => ({
    panes: {
      left: { tabs: ids.map(tab), activeId: ids[0], recent: [ids[0]] },
    },
    focused: "left",
  });

  // base は両方の窓が前に読んだ保存、theirs は別の窓が先に書いた保存、mine は
  // この窓の配置。サーバ (main-tabs-store.ts の saveMainTabs) は、この窓の base の
  // 版が古いとき mergeSerializedLayouts でこれを重ねて書く。
  test.each([
    {
      name: "両方の窓が 1 つずつ動かした: x はどちらも動かしていない",
      // この窓: c を b の前へ。別の窓: a を x の前へ。
      base: ["x", "a", "b", "c"],
      mine: ["x", "a", "c", "b"],
      theirs: ["a", "x", "b", "c"],
      // 前は a c b x (x が右端へ飛んだ)。
      expected: ["a", "x", "c", "b"],
    },
    {
      name: "この窓だけが動かし、別の窓は右端に開いただけ: a・b は誰も動かしていない",
      // この窓: 左端に m を開き、c を m の右へ。別の窓: 右端に t を開いた。
      base: ["a", "b", "c"],
      mine: ["m", "c", "a", "b"],
      theirs: ["a", "b", "c", "t"],
      // 前は b m c a t (a が b の右へ飛んだ)。
      expected: ["m", "c", "a", "b", "t"],
    },
  ])("$name", ({ base, mine, theirs, expected }) => {
    const merged = mergeLayouts(one(base), one(mine), one(theirs));
    expect(merged.layout.panes.left.tabs.map((item) => item.id)).toEqual(
      expected,
    );
  });
});
