// エージェント一覧・ヘッダの件数・通知が共有する規則。
//
// 見落としに直結するのは「どのプロジェクトにまとまるか」「どれが上に来るか」
// 「何を未読にし、いつ知らせるか」なので、ここを表で固定する。

import { describe, expect, test } from "vitest";
import {
  type AgentKind,
  type AgentKindReport,
  type AgentListFilter,
  type AgentPane,
  type AgentProjectInfo,
  type AgentStateFilter,
  type AgentTransition,
  abbreviateHome,
  agentKindOf,
  agentTransition,
  filterAgentPanes,
  groupAgentPanes,
  headerAgentCounts,
  matchesStateFilter,
  nextAgentUnread,
  paneTaskText,
  shouldNotifyAgent,
  titleWithUnread,
  withFinishedAsDone,
} from "../core/agent-overview";
import type { AgentState, AgentStateSource } from "../core/agent-state";

function pane(over: Partial<AgentPane> & { id: string }): AgentPane {
  return {
    label: `sample-session:0.${over.id.slice(1)}`,
    session: "sample-session",
    title: "",
    command: "claude",
    path: "/work/sample-repo",
    kind: "claude",
    state: "idle",
    source: "screen",
    updatedAt: 0,
    watchedSince: 0,
    project: "/work/sample-repo",
    worktree: "",
    shownInShell: "",
    account: null,
    ...over,
  };
}

function project(root: string, name: string): AgentProjectInfo {
  return {
    root,
    name,
    displayRoot: root,
    git: true,
    error: "",
    server: { status: "absent" },
    registered: null,
  };
}

describe("agentKindOf", () => {
  test.each<{
    name: string;
    command: string;
    source: AgentStateSource | null;
    report?: AgentKindReport;
    expected: AgentKind | null;
  }>([
    {
      name: "claude の名前",
      command: "claude",
      source: null,
      expected: "claude",
    },
    {
      name: "claude 単体版の版番号",
      command: "2.1.0",
      source: null,
      expected: "claude",
    },
    {
      name: "大文字・前後の空白",
      command: " Claude ",
      source: null,
      expected: "claude",
    },
    { name: "codex", command: "codex", source: null, expected: "codex" },
    {
      name: "数字 2 つは版番号とみなさない",
      command: "2.1",
      source: null,
      expected: null,
    },
    {
      name: "数字 4 つは版番号とみなさない",
      command: "2.1.0.1",
      source: null,
      expected: null,
    },
    { name: "ただのシェル", command: "zsh", source: null, expected: null },
    {
      name: "画面から状態が取れてもシェルはシェル",
      command: "zsh",
      source: "screen",
      expected: null,
    },
    {
      name: "申告してきた知らないコマンドは other",
      command: "node",
      source: "hook",
      expected: "other",
    },
    {
      name: "申告があっても claude は claude",
      command: "claude",
      source: "hook",
      expected: "claude",
    },
    {
      name: "node として動く claude はフックが名乗った種類",
      command: "node",
      source: "hook",
      report: { agent: "claude" },
      expected: "claude",
    },
    {
      name: "名乗った種類は画面観測に変わっても残る",
      command: "node",
      source: "screen",
      report: { agent: "codex" },
      expected: "codex",
    },
    {
      name: "セッションを終えたペインはシェルに戻る",
      command: "zsh",
      source: "hook",
      report: { agent: "claude", ended: true },
      expected: null,
    },
    {
      name: "コマンド名で分かるものは終了の印より優先",
      command: "codex",
      source: "hook",
      report: { ended: true },
      expected: "codex",
    },
  ])("$name", ({ command, source, report, expected }) => {
    expect(agentKindOf(command, source, report ?? null)).toBe(expected);
  });
});

describe("abbreviateHome", () => {
  test.each([
    {
      name: "ホーム配下は ~/ に縮める",
      path: "/home/sample/work/sample-repo",
      home: "/home/sample",
      expected: "~/work/sample-repo",
    },
    {
      name: "ホームそのものは ~",
      path: "/home/sample",
      home: "/home/sample",
      expected: "~",
    },
    {
      name: "ホームの末尾の / は無視する",
      path: "/home/sample/notes",
      home: "/home/sample/",
      expected: "~/notes",
    },
    {
      name: "前方だけ一致する別のフォルダは縮めない",
      path: "/home/sample-old/notes",
      home: "/home/sample",
      expected: "/home/sample-old/notes",
    },
    {
      name: "ホームの外はそのまま",
      path: "/tmp/sample-repo",
      home: "/home/sample",
      expected: "/tmp/sample-repo",
    },
    {
      name: "ホームが分からなければそのまま",
      path: "/home/sample/notes",
      home: "",
      expected: "/home/sample/notes",
    },
  ])("$name", ({ path, home, expected }) => {
    expect(abbreviateHome(path, home)).toBe(expected);
  });
});

describe("matchesStateFilter", () => {
  test.each<{ state: AgentState; filter: AgentStateFilter; expected: boolean }>(
    [
      { state: "waiting", filter: "all", expected: true },
      { state: "waiting", filter: "waiting", expected: true },
      { state: "working", filter: "waiting", expected: false },
      { state: "working", filter: "working", expected: true },
      { state: "idle", filter: "working", expected: false },
      { state: "idle", filter: "idle", expected: true },
      { state: "done", filter: "idle", expected: true },
      { state: "done", filter: "waiting", expected: false },
    ],
  )("$state は $filter の札で $expected", ({ state, filter, expected }) => {
    expect(matchesStateFilter(state, filter)).toBe(expected);
  });
});

describe("filterAgentPanes", () => {
  const panes = [
    pane({ id: "%1", state: "waiting" }),
    pane({ id: "%2", state: "working", kind: "codex" }),
    pane({ id: "%3", state: "idle" }),
    pane({ id: "%4", state: "idle", kind: null, command: "zsh" }),
    pane({ id: "%5", state: "waiting", kind: null, command: "zsh" }),
  ];
  test.each<{ name: string; filter: AgentListFilter; expected: string[] }>([
    {
      name: "既定: エージェントのペインだけ、全状態",
      filter: { allPanes: false, state: "all" },
      expected: ["%1", "%2", "%3"],
    },
    {
      name: "すべてのペイン: シェルも出す",
      filter: { allPanes: true, state: "all" },
      expected: ["%1", "%2", "%3", "%4", "%5"],
    },
    {
      name: "入力待ちだけ (シェルの入力待ちは既定では出さない)",
      filter: { allPanes: false, state: "waiting" },
      expected: ["%1"],
    },
    {
      name: "すべてのペイン + 入力待ち",
      filter: { allPanes: true, state: "waiting" },
      expected: ["%1", "%5"],
    },
    {
      name: "作業中",
      filter: { allPanes: false, state: "working" },
      expected: ["%2"],
    },
    {
      name: "待機",
      filter: { allPanes: false, state: "idle" },
      expected: ["%3"],
    },
  ])("$name", ({ filter, expected }) => {
    expect(filterAgentPanes(panes, filter).map((item) => item.id)).toEqual(
      expected,
    );
  });
});

describe("groupAgentPanes", () => {
  const projects = [
    project("/work/alpha", "alpha"),
    project("/work/beta", "beta"),
    project("/work/gamma", "gamma"),
    project("/work/delta", "delta"),
  ];

  test("入力待ちを含む → 作業中を含む → それ以外の順にプロジェクトを並べる", () => {
    const groups = groupAgentPanes(
      [
        pane({
          id: "%1",
          project: "/work/alpha",
          state: "idle",
          updatedAt: 900,
        }),
        pane({
          id: "%2",
          project: "/work/beta",
          state: "working",
          updatedAt: 100,
        }),
        pane({
          id: "%3",
          project: "/work/gamma",
          state: "waiting",
          updatedAt: 50,
        }),
        pane({
          id: "%4",
          project: "/work/beta",
          state: "idle",
          updatedAt: 800,
        }),
      ],
      projects,
    );
    expect(groups.map((group) => group.info.name)).toEqual([
      "gamma",
      "beta",
      "alpha",
    ]);
  });

  test("同じ段のプロジェクトは状態が変わったのが新しい順、同時刻なら名前順", () => {
    const groups = groupAgentPanes(
      [
        pane({
          id: "%1",
          project: "/work/alpha",
          state: "working",
          updatedAt: 100,
        }),
        pane({
          id: "%2",
          project: "/work/beta",
          state: "working",
          updatedAt: 300,
        }),
        pane({
          id: "%3",
          project: "/work/delta",
          state: "working",
          updatedAt: 200,
        }),
        pane({
          id: "%4",
          project: "/work/gamma",
          state: "working",
          updatedAt: 200,
        }),
      ],
      projects,
    );
    expect(groups.map((group) => group.info.name)).toEqual([
      "beta",
      "delta",
      "gamma",
      "alpha",
    ]);
  });

  test("プロジェクトの中は 入力待ち → 完了 (未読) → 作業中 → 待機、同じ状態は新しい順、時刻不明は最後", () => {
    const [group] = groupAgentPanes(
      [
        pane({ id: "%1", state: "idle", updatedAt: 500 }),
        pane({ id: "%2", state: "working", updatedAt: 100 }),
        pane({ id: "%3", state: "idle", updatedAt: 0 }),
        pane({ id: "%4", state: "waiting", updatedAt: 10 }),
        pane({ id: "%5", state: "working", updatedAt: 400 }),
        pane({ id: "%6", state: "done", updatedAt: 1 }),
        pane({ id: "%7", state: "idle", updatedAt: 700 }),
      ],
      [project("/work/sample-repo", "sample-repo")],
    );
    expect(group?.panes.map((item) => item.id)).toEqual([
      "%4",
      "%6",
      "%5",
      "%2",
      "%7",
      "%1",
      "%3",
    ]);
    expect(group?.counts).toEqual({ waiting: 1, working: 2, done: 1, idle: 3 });
  });

  test("プロジェクト情報が無い鍵は、git 管理外としてフォルダ名で出す", () => {
    const [group] = groupAgentPanes(
      [pane({ id: "%1", project: "/work/notes" })],
      [],
    );
    expect(group?.info).toEqual({
      root: "/work/notes",
      name: "notes",
      displayRoot: "/work/notes",
      git: false,
      error: "",
      server: { status: "none" },
      registered: null,
    });
  });

  test("ペインの無いプロジェクトは出さない", () => {
    expect(groupAgentPanes([], projects)).toEqual([]);
  });
});

describe("headerAgentCounts", () => {
  test("エージェントのペインの入力待ちと作業中だけを数える", () => {
    expect(
      headerAgentCounts([
        pane({ id: "%1", state: "waiting" }),
        pane({ id: "%2", state: "waiting", kind: "codex" }),
        pane({ id: "%3", state: "working" }),
        pane({ id: "%4", state: "done" }),
        pane({ id: "%5", state: "idle" }),
        pane({ id: "%6", state: "waiting", kind: null }),
        pane({ id: "%7", state: "working", kind: null }),
      ]),
    ).toEqual({ waiting: 2, working: 1 });
  });
});

describe("agentTransition", () => {
  test.each<{
    previous: AgentState | undefined;
    next: AgentState;
    expected: AgentTransition | null;
  }>([
    { previous: "working", next: "waiting", expected: "waiting" },
    { previous: "working", next: "idle", expected: "finished" },
    { previous: "working", next: "done", expected: "finished" },
    { previous: "working", next: "working", expected: null },
    { previous: "idle", next: "waiting", expected: null },
    { previous: "waiting", next: "idle", expected: null },
    { previous: "done", next: "idle", expected: null },
    { previous: undefined, next: "waiting", expected: null },
    // 完了は申告でしか出ないので、作業中を見逃していても変化として拾う。
    { previous: "idle", next: "done", expected: "finished" },
    { previous: "waiting", next: "done", expected: "finished" },
    { previous: "done", next: "done", expected: null },
    { previous: undefined, next: "done", expected: null },
  ])("$previous → $next は $expected", ({ previous, next, expected }) => {
    expect(agentTransition(previous, next)).toBe(expected);
  });
});

describe("nextAgentUnread", () => {
  const notViewing = () => false;

  test("最初の取得では何も起きたことにしない", () => {
    const update = nextAgentUnread(
      new Map(),
      null,
      [pane({ id: "%1", state: "waiting" }), pane({ id: "%2", state: "idle" })],
      notViewing,
    );
    expect([...update.unread]).toEqual([]);
    expect(update.transitions).toEqual([]);
  });

  test.each<{
    name: string;
    previous: AgentState;
    next: AgentState;
    kind: AgentKind | null;
    viewing: boolean;
    unread: [string, AgentTransition][];
    transitions: AgentTransition[];
  }>([
    {
      name: "作業中 → 入力待ちで未読になり、知らせる候補になる",
      previous: "working",
      next: "waiting",
      kind: "claude",
      viewing: false,
      unread: [["%1", "waiting"]],
      transitions: ["waiting"],
    },
    {
      name: "作業中 → 待機で「終わった」の未読",
      previous: "working",
      next: "idle",
      kind: "codex",
      viewing: false,
      unread: [["%1", "finished"]],
      transitions: ["finished"],
    },
    {
      name: "いま見ているペインは未読にしない (候補には残す)",
      previous: "working",
      next: "waiting",
      kind: "claude",
      viewing: true,
      unread: [],
      transitions: ["waiting"],
    },
    {
      name: "シェルは数えない",
      previous: "working",
      next: "waiting",
      kind: null,
      viewing: false,
      unread: [],
      transitions: [],
    },
    {
      name: "待機 → 入力待ちは知らせない",
      previous: "idle",
      next: "waiting",
      kind: "claude",
      viewing: false,
      unread: [],
      transitions: [],
    },
  ])("$name", ({ previous, next, kind, viewing, unread, transitions }) => {
    const update = nextAgentUnread(
      new Map(),
      new Map([["%1", previous]]),
      [pane({ id: "%1", state: next, kind })],
      () => viewing,
    );
    expect([...update.unread]).toEqual(unread);
    expect(update.transitions.map((item) => item.transition)).toEqual(
      transitions,
    );
  });

  test.each<{
    name: string;
    state: AgentState;
    present: boolean;
    viewing: boolean;
    expected: [string, AgentTransition][];
  }>([
    {
      name: "状態が変わらなければ未読は残る",
      state: "waiting",
      present: true,
      viewing: false,
      expected: [["%1", "waiting"]],
    },
    {
      name: "作業中に戻ったら (誰かが応えた) 未読を解く",
      state: "working",
      present: true,
      viewing: false,
      expected: [],
    },
    {
      name: "そのペインを見たら未読を解く",
      state: "waiting",
      present: true,
      viewing: true,
      expected: [],
    },
    {
      name: "ペインが消えたら未読を落とす",
      state: "waiting",
      present: false,
      viewing: false,
      expected: [],
    },
  ])("既にある未読: $name", ({ state, present, viewing, expected }) => {
    const update = nextAgentUnread(
      new Map([["%1", "waiting"]]),
      new Map([["%1", "waiting"]]),
      present ? [pane({ id: "%1", state })] : [],
      () => viewing,
    );
    expect([...update.unread]).toEqual(expected);
    expect(update.transitions).toEqual([]);
  });
});

describe("withFinishedAsDone", () => {
  // フックが無くても、作業中 → 止まったを見てまだ読んでいないものは完了に出す。
  test.each<{
    state: AgentState;
    transition: AgentTransition | null;
    expected: AgentState;
  }>([
    { state: "idle", transition: "finished", expected: "done" },
    { state: "idle", transition: null, expected: "idle" },
    { state: "idle", transition: "waiting", expected: "idle" },
    { state: "waiting", transition: "waiting", expected: "waiting" },
    { state: "working", transition: "finished", expected: "working" },
    { state: "done", transition: "finished", expected: "done" },
  ])("$state + 未読 $transition → $expected", ({
    state,
    transition,
    expected,
  }) => {
    const unread = new Map<string, AgentTransition>(
      transition ? [["%1", transition]] : [],
    );
    expect(
      withFinishedAsDone([pane({ id: "%1", state })], unread)[0]?.state,
    ).toBe(expected);
  });
});

describe("shouldNotifyAgent", () => {
  const on = { waiting: true, finished: true };
  test.each<{
    name: string;
    transition: AgentTransition;
    settings: { waiting: boolean; finished: boolean };
    permission: "granted" | "denied" | "default" | "unsupported";
    viewing: boolean;
    expected: boolean;
  }>([
    {
      name: "許可済み・入力待ち",
      transition: "waiting",
      settings: on,
      permission: "granted",
      viewing: false,
      expected: true,
    },
    {
      name: "許可済み・完了",
      transition: "finished",
      settings: on,
      permission: "granted",
      viewing: false,
      expected: true,
    },
    {
      name: "まだ許可を求めていない",
      transition: "waiting",
      settings: on,
      permission: "default",
      viewing: false,
      expected: false,
    },
    {
      name: "拒否されている",
      transition: "waiting",
      settings: on,
      permission: "denied",
      viewing: false,
      expected: false,
    },
    {
      name: "通知の API が無い",
      transition: "waiting",
      settings: on,
      permission: "unsupported",
      viewing: false,
      expected: false,
    },
    {
      name: "前面でそのペインを見ている",
      transition: "waiting",
      settings: on,
      permission: "granted",
      viewing: true,
      expected: false,
    },
    {
      name: "入力待ちの通知を切ってある",
      transition: "waiting",
      settings: { waiting: false, finished: true },
      permission: "granted",
      viewing: false,
      expected: false,
    },
    {
      name: "入力待ちを切っても完了は出る",
      transition: "finished",
      settings: { waiting: false, finished: true },
      permission: "granted",
      viewing: false,
      expected: true,
    },
    {
      name: "完了の通知を切ってある",
      transition: "finished",
      settings: { waiting: true, finished: false },
      permission: "granted",
      viewing: false,
      expected: false,
    },
  ])("$name", ({ transition, settings, permission, viewing, expected }) => {
    expect(
      shouldNotifyAgent(transition, { settings, permission, viewing }),
    ).toBe(expected);
  });
});

describe("titleWithUnread", () => {
  test.each([
    { unread: 0, expected: "sample-repo - code viewer" },
    { unread: 1, expected: "(1) sample-repo - code viewer" },
    { unread: 12, expected: "(12) sample-repo - code viewer" },
  ])("未読 $unread", ({ unread, expected }) => {
    expect(titleWithUnread("sample-repo - code viewer", unread)).toBe(expected);
  });
});

describe("paneTaskText", () => {
  test.each([
    {
      name: "✳ の頭を落とす",
      title: "✳ Fix the parser",
      expected: "Fix the parser",
    },
    {
      name: "点字スピナーの頭を落とす",
      title: "⠋ Fix the parser",
      expected: "Fix the parser",
    },
    {
      name: "記号の無いタイトルはそのまま",
      title: "Fix the parser | sample-repo",
      expected: "Fix the parser | sample-repo",
    },
    { name: "空ならコマンド名", title: "", expected: "claude" },
    { name: "記号だけならコマンド名", title: "✳ ", expected: "claude" },
  ])("$name", ({ title, expected }) => {
    expect(paneTaskText(pane({ id: "%1", title }))).toBe(expected);
  });
});
