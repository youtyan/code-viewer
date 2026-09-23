// エージェント一覧のサーバ側。ペインの cwd がどのプロジェクトにまとまるか
// (本物の git で確かめる) と、問い合わせが失敗したときに一覧が「エージェント
// なし」に化けず、失敗として返ること。

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import type { AgentProjectServer } from "../core/agent-overview";
import type { AgentStateRecord } from "../core/agent-state";
import type { TmuxPanesResponse } from "../core/tmux";
import { projectRootResultAsync } from "../server/git";
import {
  type AgentOverviewDeps,
  buildAgentOverview,
  createTtlCache,
  type ProjectResolution,
} from "../server/terminal/overview";
import { runGit } from "./_git-fixture";

let base = "";
let repo = "";
let worktree = "";
let outside = "";

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "agent-overview-")));
  repo = join(base, "sample-repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  runGit(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "README.md"), "# sample\n");
  runGit(repo, ["add", "."]);
  runGit(repo, [
    "-c",
    "user.email=sample@example.com",
    "-c",
    "user.name=sample",
    "commit",
    "-qm",
    "chore: サンプルを作る",
  ]);
  worktree = join(repo, ".worktrees", "feature-x");
  runGit(repo, ["worktree", "add", "-q", worktree, "-b", "feature-x"]);
  outside = join(base, "notes");
  mkdirSync(outside);
});

describe("projectRootResultAsync", () => {
  test("リポジトリのルートはそのまま", async () => {
    expect(await projectRootResultAsync(repo, base)).toEqual({
      kind: "root",
      root: repo,
      toplevel: repo,
    });
  });

  test("サブディレクトリはリポジトリのルートにまとまる", async () => {
    expect(await projectRootResultAsync(join(repo, "src"), base)).toEqual({
      kind: "root",
      root: repo,
      toplevel: repo,
    });
  });

  test("worktree は本体のルートにまとまり、作業ツリーのルートも返す", async () => {
    expect(await projectRootResultAsync(worktree, base)).toEqual({
      kind: "root",
      root: repo,
      toplevel: worktree,
    });
  });

  test("git 管理外は outside", async () => {
    expect(await projectRootResultAsync(outside, base)).toEqual({
      kind: "outside",
    });
  });

  test("消えたディレクトリは理由つきの error", async () => {
    const result = await projectRootResultAsync(join(base, "gone"), base);
    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.error).toContain(
      join(base, "gone"),
    );
  });
});

function panesResponse(
  panes: { id: string; path: string; command: string; title?: string }[],
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
              title: item.title ?? "",
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

function deps(over: Partial<AgentOverviewDeps> = {}): AgentOverviewDeps {
  const resolutions: Record<string, ProjectResolution> = {
    "/work/sample-repo": {
      kind: "root",
      root: "/work/sample-repo",
      toplevel: "/work/sample-repo",
    },
    "/work/sample-repo/.worktrees/feature-x": {
      kind: "root",
      root: "/work/sample-repo",
      toplevel: "/work/sample-repo/.worktrees/feature-x",
    },
    "/work/another-repo": {
      kind: "root",
      root: "/work/another-repo",
      toplevel: "/work/another-repo",
    },
    "/work/notes": { kind: "outside" },
  };
  const states: AgentStateRecord[] = [
    {
      target: "%1",
      state: "waiting",
      source: "screen",
      updatedAt: 1000,
      changeObserved: true,
      lastPrompt: "",
      note: "",
    },
    {
      // 見始めた時点で既に待機だった。700 は「遅くともこの時刻から」の下限。
      target: "%3",
      state: "idle",
      source: "screen",
      updatedAt: 700,
      changeObserved: false,
      lastPrompt: "",
      note: "",
    },
  ];
  return {
    serverInstance: "sample-instance",
    home: "/work",
    serverRoot: "/work/sample-repo",
    listPanes: async () =>
      panesResponse([
        { id: "%1", path: "/work/sample-repo", command: "claude" },
        {
          id: "%2",
          path: "/work/sample-repo/.worktrees/feature-x",
          command: "codex",
        },
        { id: "%3", path: "/work/another-repo", command: "2.1.0" },
        { id: "%4", path: "/work/notes", command: "zsh" },
      ]),
    listStates: () => states,
    activityObservedAt: () => 4321,
    observationErrors: () => [],
    listShells: () => [],
    listClients: async () => ({ status: "ok", clients: [] }),
    firstListed: new Map(),
    resolveProject: async (path) =>
      resolutions[path] ?? { kind: "error", error: `unknown ${path}` },
    findServer: async (root): Promise<AgentProjectServer> =>
      root === "/work/another-repo"
        ? { status: "running", url: "http://127.0.0.1:64172/", launched: false }
        : { status: "absent" },
    paneAccounts: async () => new Map(),
    readRegistry: () => ({
      projects: [],
      error: "",
      path: "/work/projects.json",
    }),
    rootExists: () => true,
    forgetServer: () => undefined,
    now: () => 5000,
    ...over,
  };
}

describe("buildAgentOverview", () => {
  test("claude / codex の行にアカウントを付け、それ以外の行は null", async () => {
    const asked: string[] = [];
    const overview = await buildAgentOverview(
      deps({
        paneAccounts: async (targets) => {
          asked.push(...targets.map((target) => `${target.id}:${target.kind}`));
          return new Map([
            ["%1", { kind: "default", id: "claude:default" }],
            ["%2", { kind: "unregistered", configDir: "/work/codex-home" }],
          ]);
        },
      }),
    );
    expect(asked).toEqual(["%1:claude", "%2:codex", "%3:claude", "%4:null"]);
    expect(overview.panes.map((item) => [item.id, item.account])).toEqual([
      ["%1", { kind: "default", id: "claude:default" }],
      ["%2", { kind: "unregistered", configDir: "/work/codex-home" }],
      // 求められなかった行は、理由つきで「分からない」。
      [
        "%3",
        {
          kind: "unknown",
          reason: "the account of this pane was not resolved",
        },
      ],
      ["%4", null],
    ]);
  });

  test("ペインを本体のルートでまとめ、worktree 名・種類・状態を付ける", async () => {
    const overview = await buildAgentOverview(deps());
    expect(overview.observedAt).toBe(4321);
    expect(
      overview.panes.map((item) => [
        item.id,
        item.project,
        item.worktree,
        item.kind,
        item.state,
      ]),
    ).toEqual([
      ["%1", "/work/sample-repo", "", "claude", "waiting"],
      ["%2", "/work/sample-repo", "feature-x", "codex", "idle"],
      ["%3", "/work/another-repo", "", "claude", "idle"],
      ["%4", "/work/notes", "", null, "idle"],
    ]);
    expect(overview.projects).toEqual([
      {
        root: "/work/sample-repo",
        name: "sample-repo",
        displayRoot: "~/sample-repo",
        git: true,
        error: "",
        server: { status: "current" },
        registered: null,
      },
      {
        root: "/work/another-repo",
        name: "another-repo",
        displayRoot: "~/another-repo",
        git: true,
        error: "",
        server: {
          status: "running",
          url: "http://127.0.0.1:64172/",
          launched: false,
        },
        registered: null,
      },
      {
        root: "/work/notes",
        name: "notes",
        displayRoot: "~/notes",
        git: false,
        error: "",
        server: { status: "none" },
        registered: null,
      },
    ]);
    expect(overview.errors).toEqual([]);
    expect(overview.tmux).toEqual({
      available: true,
      running: true,
      error: "",
    });
  });

  test("経過時間は、変わった瞬間を見たものにだけ出し、それ以外は見始めた時刻を下限として渡す", async () => {
    const overview = await buildAgentOverview(deps());
    expect(
      overview.panes.map((item) => [
        item.id,
        item.updatedAt,
        item.watchedSince,
      ]),
    ).toEqual([
      // 観測中に変わった: その時刻
      ["%1", 1000, 0],
      // 記録なし (どの画面ルールにも当たらない): 一覧に初めて載せた時刻
      ["%2", 0, 5000],
      // 見始めた時点で既にその状態: 記録の時刻は下限
      ["%3", 0, 700],
      ["%4", 0, 5000],
    ]);
  });

  test("一覧に初めて載せた時刻は、取り直しても変わらず、消えたペインは忘れる", async () => {
    let now = 5000;
    const firstListed = new Map<string, number>();
    await buildAgentOverview(deps({ firstListed, now: () => now }));
    now = 9000;
    const later = await buildAgentOverview(
      deps({
        firstListed,
        now: () => now,
        listPanes: async () =>
          panesResponse([
            { id: "%2", path: "/work/notes", command: "codex" },
            { id: "%9", path: "/work/notes", command: "codex" },
          ]),
      }),
    );
    expect(later.panes.map((item) => [item.id, item.watchedSince])).toEqual([
      ["%2", 5000],
      ["%9", 9000],
    ]);
    expect([...firstListed.keys()].sort()).toEqual(["%2", "%9"]);
  });

  test("tmux の一覧が取れなければ、空ではなく失敗として返す", async () => {
    const overview = await buildAgentOverview(
      deps({
        listPanes: async () => {
          throw new Error("sample tmux failure");
        },
      }),
    );
    expect(overview.panes).toEqual([]);
    expect(overview.tmux.error).toContain("sample tmux failure");
  });

  test.each<{
    name: string;
    response: TmuxPanesResponse;
    expected: { available: boolean; running: boolean; error: string };
  }>([
    {
      name: "tmux が無い",
      response: { available: false, running: false, sessions: [] },
      expected: { available: false, running: false, error: "" },
    },
    {
      name: "tmux サーバが動いていない",
      response: { available: true, running: false, sessions: [] },
      expected: { available: true, running: false, error: "" },
    },
  ])("$name: 失敗ではなく状態として返す", async ({ response, expected }) => {
    const overview = await buildAgentOverview(
      deps({ listPanes: async () => response }),
    );
    expect(overview.tmux).toEqual(expected);
    expect(overview.panes).toEqual([]);
  });

  test("git を呼べなかったペインは cwd でまとめ、理由を errors とプロジェクトに載せる", async () => {
    const overview = await buildAgentOverview(
      deps({
        resolveProject: async (path) =>
          path === "/work/notes"
            ? { kind: "error", error: "sample git failure" }
            : { kind: "outside" },
      }),
    );
    const notes = overview.projects.find((info) => info.root === "/work/notes");
    expect(notes?.error).toBe("sample git failure");
    expect(
      overview.errors.map((item) => [item.operation, item.target, item.detail]),
    ).toEqual([["resolve_project", "/work/notes", "sample git failure"]]);
  });

  test("端末の対応が引けなくても一覧は出し、理由を errors に載せる", async () => {
    const overview = await buildAgentOverview(
      deps({
        listClients: async () => ({
          status: "error",
          error: new Error("sample client failure"),
        }),
      }),
    );
    expect(overview.panes).toHaveLength(4);
    expect(overview.errors.map((item) => item.operation)).toEqual([
      "list_clients",
    ]);
    expect(overview.errors[0]?.detail).toContain("sample client failure");
  });

  test("登録されたサーバに届かなければ、理由を errors に載せる", async () => {
    const overview = await buildAgentOverview(
      deps({
        findServer: async () => ({
          status: "unreachable",
          detail: "sample connection refused",
        }),
      }),
    );
    expect(
      overview.errors.map((item) => [item.operation, item.target]),
    ).toEqual([["find_server", "/work/another-repo"]]);
  });

  test("このサーバのシェルが映しているペインに、そのシェルの ID を付ける", async () => {
    const overview = await buildAgentOverview(
      deps({
        listShells: () => [
          {
            id: "shell-1",
            command: "zsh",
            cwd: "/work/sample-repo",
            cols: 80,
            rows: 24,
            createdAt: "2026-01-01T00:00:00.000Z",
            exited: false,
            exitCode: null,
            tty: "/dev/ttys001",
          },
        ],
        listClients: async () => ({
          status: "ok",
          clients: [
            { tty: "/dev/ttys001", session: "sample-session", pane: "%2" },
          ],
        }),
      }),
    );
    expect(overview.panes.map((item) => [item.id, item.shownInShell])).toEqual([
      ["%1", ""],
      ["%2", "shell-1"],
      ["%3", ""],
      ["%4", ""],
    ]);
  });

  // ブラウザは shells で、前面でないタブのシェルが終わったことを知り (タブを
  // 閉じる)、tmux のウインドウの外側を覆う。端末名が空のシェルに、無関係な
  // 端末 (空の tty) の大きさを付けない。
  test("生きているシェルと、そのシェルの tmux の端末とウインドウの大きさを載せる", async () => {
    const shell = (id: string, tty: string, exited = false) => ({
      id,
      command: "zsh",
      cwd: "/work/sample-repo",
      cols: 80,
      rows: 24,
      createdAt: "2026-01-01T00:00:00.000Z",
      exited,
      exitCode: null,
      tty,
    });
    const window = {
      clientCols: 132,
      clientRows: 48,
      windowCols: 100,
      windowRows: 29,
      statusLines: 1,
      statusAt: "bottom" as const,
      sessionClients: 2,
    };
    const overview = await buildAgentOverview(
      deps({
        listShells: () => [
          shell("shell-tmux", "/dev/ttys001"),
          shell("shell-plain", "/dev/ttys002"),
          shell("shell-no-tty", ""),
          shell("shell-exited", "/dev/ttys003", true),
        ],
        listClients: async () => ({
          status: "ok",
          clients: [
            {
              tty: "/dev/ttys001",
              session: "sample-session",
              pane: "%2",
              window,
            },
            { tty: "", session: "sample-session", pane: "%3", window },
          ],
        }),
      }),
    );
    expect(overview.shells).toEqual([
      { id: "shell-tmux", window },
      { id: "shell-plain", window: null },
      { id: "shell-no-tty", window: null },
    ]);
  });

  test("tmux の一覧に失敗しても、生きているシェルは載せる (タブを閉じ損ねない)", async () => {
    const overview = await buildAgentOverview(
      deps({
        listPanes: async () => {
          throw new Error("sample tmux failure");
        },
        listShells: () => [
          {
            id: "shell-1",
            command: "zsh",
            cwd: "/work/sample-repo",
            cols: 80,
            rows: 24,
            createdAt: "2026-01-01T00:00:00.000Z",
            exited: false,
            exitCode: null,
            tty: "/dev/ttys001",
          },
        ],
      }),
    );
    expect(overview.shells).toEqual([{ id: "shell-1", window: null }]);
  });
});

describe("registered projects in the overview", () => {
  function registeredInfo(root: string, name: string, order: number) {
    return { root, name, order, color: "violet" as const, port: null };
  }

  test("the same git root is one project with the registered name; registered-only projects are listed without panes", async () => {
    const overview = await buildAgentOverview(
      deps({
        readRegistry: () => ({
          projects: [
            registeredInfo("/work/another-repo", "Another", 0),
            registeredInfo("/work/quiet-repo", "quiet-repo", 1),
            registeredInfo("/work/gone-repo", "gone-repo", 2),
          ],
          error: "",
          path: "/work/projects.json",
        }),
        rootExists: (root) => root !== "/work/gone-repo",
      }),
    );
    const byRoot = new Map(overview.projects.map((info) => [info.root, info]));
    expect(overview.projects.map((info) => info.root)).toEqual([
      "/work/sample-repo",
      "/work/another-repo",
      "/work/notes",
      "/work/quiet-repo",
      "/work/gone-repo",
    ]);
    expect(byRoot.get("/work/another-repo")).toMatchObject({
      name: "Another",
      registered: { order: 0 },
    });
    expect(
      overview.panes.filter((pane) => pane.project === "/work/another-repo"),
    ).toHaveLength(1);
    expect(byRoot.get("/work/quiet-repo")).toMatchObject({
      name: "quiet-repo",
      displayRoot: "~/quiet-repo",
      git: true,
      error: "",
      server: { status: "absent" },
    });
    expect(byRoot.get("/work/gone-repo")?.error).toBe(
      "/work/gone-repo does not exist",
    );
    expect(byRoot.get("/work/sample-repo")?.registered).toBeNull();
  });

  test("an unreadable registry keeps the list and reports the reason", async () => {
    const overview = await buildAgentOverview(
      deps({
        readRegistry: () => ({
          projects: [],
          error: "/work/projects.json is not valid JSON",
          path: "/work/projects.json",
        }),
      }),
    );
    expect(overview.panes).toHaveLength(4);
    expect(overview.registry.error).toBe(
      "/work/projects.json is not valid JSON",
    );
  });
});

describe("createTtlCache", () => {
  test("期限内は同じ結果を返し、期限を過ぎたら読み直す", async () => {
    let now = 0;
    let loads = 0;
    const cache = createTtlCache<number>(1000, () => now);
    const load = async () => {
      loads += 1;
      return loads;
    };
    expect(await cache("key", load)).toBe(1);
    now = 999;
    expect(await cache("key", load)).toBe(1);
    now = 1000;
    expect(await cache("key", load)).toBe(2);
  });

  test("上限を超えたら古いものから捨てる", async () => {
    let loads = 0;
    const cache = createTtlCache<number>(1000, () => 0, 2);
    const load = async () => {
      loads += 1;
      return loads;
    };
    await cache("a", load);
    await cache("b", load);
    await cache("c", load);
    expect(await cache("b", load)).toBe(2);
    expect(await cache("a", load)).toBe(4);
  });
});
