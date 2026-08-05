// ドロワーに並べる行の組み立て。
//
// 見落としに直結するのは並び順と件数なので、そこを表で固定する。DOM は
// 触らないので、描画を動かさずに規則だけ確かめられる。

import { describe, expect, test } from "vitest";
import type { AgentState, AgentStateRecord } from "../core/agent-state";
import type { ShellSession } from "../core/shell";
import {
  attentionRows,
  type BoardRow,
  type BoardScope,
  basenameOf,
  buildBoardRows,
  buildBoardTree,
  countBoardStates,
  elapsedBucket,
  filterBoardRows,
  filterByScope,
  groupByWindow,
  sessionNames,
  sortBoardRows,
} from "../core/terminal-board";
import {
  clampTerminalFontSize,
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  type TmuxClient,
  type TmuxPanesResponse,
} from "../core/tmux";

function pane(
  over: Partial<{
    id: string;
    title: string;
    path: string;
    paneIndex: number;
    inRepo: boolean;
  }> = {},
) {
  return {
    id: over.id ?? "%1",
    label: `0:0.${over.paneIndex ?? 0}`,
    paneIndex: over.paneIndex ?? 0,
    title: over.title ?? "テーブルを実装する",
    command: "node",
    path: over.path ?? "/home/me/work/board",
    width: 120,
    height: 40,
    active: false,
    inRepo: over.inRepo ?? true,
  };
}

function panesResponse(ids: string[]): TmuxPanesResponse {
  return {
    available: true,
    running: true,
    sessions: [
      {
        name: "0",
        attached: true,
        windows: [
          {
            index: 0,
            name: "main",
            active: true,
            panes: ids.map((id) => pane({ id })),
          },
        ],
      },
    ],
  };
}

function shell(over: Partial<ShellSession> = {}): ShellSession {
  return {
    id: "shell-abc123",
    command: "/bin/zsh",
    cwd: "/home/me/work/buffer",
    createdAt: "2026-08-01T09:41:58.000Z",
    cols: 80,
    rows: 24,
    exited: false,
    exitCode: null,
    tty: "",
    ...over,
  };
}

function state(
  target: string,
  agentState: AgentState,
  updatedAt: number,
): AgentStateRecord {
  return {
    target,
    state: agentState,
    source: "hook",
    updatedAt,
    lastPrompt: "",
    note: "",
  };
}

function row(over: Partial<BoardRow> = {}): BoardRow {
  return {
    target: "%1",
    kind: "tmux",
    task: "作業",
    place: "board",
    locator: "0:0.0",
    session: "0",
    window: "0 · main",
    paneIndex: "0",
    inRepo: true,
    linkedTarget: "",
    agent: "node",
    state: "idle",
    source: null,
    lastPrompt: "",
    note: "",
    updatedAt: 0,
    cols: 80,
    rows: 24,
    exited: false,
    ...over,
  };
}

describe("basenameOf", () => {
  test.each([
    { name: "末尾を取る", path: "/home/me/work/board", expected: "board" },
    {
      name: "末尾のスラッシュを無視する",
      path: "/home/me/board/",
      expected: "board",
    },
    { name: "スラッシュが無ければそのまま", path: "board", expected: "board" },
    { name: "根はそのまま空になる", path: "/", expected: "" },
    { name: "空文字はそのまま", path: "", expected: "" },
  ])("$name", ({ path, expected }) => {
    expect(basenameOf(path)).toBe(expected);
  });
});

describe("buildBoardRows", () => {
  test("tmux とシェルを 1 本の並びにする", () => {
    const rows = buildBoardRows(panesResponse(["%1"]), [shell()], []);
    expect(rows.map((r) => r.kind).sort()).toEqual(["shell", "tmux"]);
  });

  test("状態を対象ごとに結び付ける", () => {
    const rows = buildBoardRows(
      panesResponse(["%1"]),
      [shell()],
      [state("%1", "waiting", 100)],
    );
    const tmuxRow = rows.find((r) => r.target === "%1");
    expect(tmuxRow?.state).toBe("waiting");
    expect(tmuxRow?.source).toBe("hook");
  });

  test("状態が無い対象は停止として出し、出どころは空にする", () => {
    // 「稼働」にすると止まっているものが動いて見え、待ちに数えると嘘の
    // 「あなたの番」が出る。分かるまでは人間の番に数えない。
    const rows = buildBoardRows(panesResponse(["%1"]), [], []);
    expect(rows[0]?.state).toBe("idle");
    expect(rows[0]?.source).toBeNull();
    expect(attentionRows(rows)).toHaveLength(0);
  });

  test("ペイン一覧が無くてもシェルだけで並ぶ", () => {
    const rows = buildBoardRows(null, [shell()], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("shell");
  });

  test("worktree の名前を置き場所に出す", () => {
    const rows = buildBoardRows(null, [shell({ cwd: "/w/agent-board" })], []);
    expect(rows[0]?.place).toBe("agent-board");
  });
});

describe("tmux の入れ子を保つ", () => {
  const nested: TmuxPanesResponse = {
    available: true,
    running: true,
    sessions: [
      {
        name: "work",
        attached: true,
        windows: [
          {
            index: 0,
            name: "main",
            active: true,
            panes: [
              pane({ id: "%1", paneIndex: 0 }),
              pane({ id: "%2", paneIndex: 1 }),
            ],
          },
          {
            index: 1,
            name: "test",
            active: false,
            panes: [pane({ id: "%3", paneIndex: 0 })],
          },
        ],
      },
      {
        name: "dev",
        attached: false,
        windows: [
          {
            index: 0,
            name: "",
            active: true,
            panes: [pane({ id: "%4", paneIndex: 0 })],
          },
        ],
      },
    ],
  };

  /** 下段の枝を、比べやすい素の形に均す。 */
  function shapeOf(sessions: ReturnType<typeof buildBoardTree>["sessions"]) {
    return sessions.map((session) => ({
      session: session.session,
      windows: session.windows.map((window) => ({
        window: window.window,
        panes: window.rows.map((row) => row.target),
      })),
    }));
  }

  test("ツリーはセッション → ウィンドウ → ペインの順を tmux のまま保つ", () => {
    // 状態で並べ替えると、更新のたびに枝が入れ替わって狙った行を押せなくなる。
    const tree = buildBoardTree(buildBoardRows(nested, [], []));

    expect(shapeOf(tree.sessions)).toEqual([
      {
        session: "work",
        windows: [
          { window: "0 · main", panes: ["%1", "%2"] },
          { window: "1 · test", panes: ["%3"] },
        ],
      },
      // 名前の無いウィンドウは番号だけの見出しになる。
      { session: "dev", windows: [{ window: "0", panes: ["%4"] }] },
    ]);
  });

  test("tmux に繋がっていないシェルは、セッションを連れずに上段へ出る", () => {
    // 素のシェルは tmux のセッションではない。混ざると、存在しないセッション名の
    // 枝が下段に生える。
    const tree = buildBoardTree(buildBoardRows(nested, [shell()], []));

    expect(tree.shells).toHaveLength(1);
    expect(tree.shells[0]?.session).toBe("");
    expect(tree.shells[0]?.windows).toEqual([]);
    // 下段の顔ぶれは変わらない。
    expect(tree.sessions.map((s) => s.session)).toEqual(["work", "dev"]);
  });

  test("シェルが開いているセッションは上段へ移り、下段から消える", () => {
    // 同じセッションが 2 か所に出ると、どちらを押せばよいのか分からなくなる。
    const rows = buildBoardRows(
      nested,
      [shell({ id: "shell-aaa111", tty: "/dev/ttys001" })],
      [],
      [{ tty: "/dev/ttys001", session: "work", pane: "%2" }],
    );
    const tree = buildBoardTree(rows);

    expect(tree.shells).toHaveLength(1);
    expect(tree.shells[0]?.session).toBe("work");
    // そのセッションのウィンドウとペインがシェルの下にぶら下がる。
    expect(
      tree.shells[0]?.windows.map((window) => ({
        window: window.window,
        panes: window.rows.map((row) => row.target),
      })),
    ).toEqual([
      { window: "0 · main", panes: ["%1", "%2"] },
      { window: "1 · test", panes: ["%3"] },
    ]);
    // 下段には残らない。
    expect(tree.sessions.map((s) => s.session)).toEqual(["dev"]);
  });

  test("セッション名を出現順に返す", () => {
    expect(sessionNames(buildBoardRows(nested, [], []))).toEqual([
      "work",
      "dev",
    ]);
  });

  test("シェルはセッション名を持たない", () => {
    expect(sessionNames(buildBoardRows(null, [shell()], []))).toEqual([]);
  });

  test("ウィンドウごとにまとめ、tmux の並び順を保つ", () => {
    const groups = groupByWindow(buildBoardRows(nested, [], []), "work");
    expect(groups.map((g) => g.window)).toEqual(["0 · main", "1 · test"]);
    expect(groups[0]?.rows.map((r) => r.target)).toEqual(["%1", "%2"]);
    expect(groups[1]?.rows.map((r) => r.target)).toEqual(["%3"]);
  });

  test("名前の無いウィンドウは番号だけを見出しにする", () => {
    const groups = groupByWindow(buildBoardRows(nested, [], []), "dev");
    expect(groups.map((g) => g.window)).toEqual(["0"]);
  });

  test("別のセッションのペインは混ざらない", () => {
    const groups = groupByWindow(buildBoardRows(nested, [], []), "dev");
    expect(groups.flatMap((g) => g.rows).map((r) => r.target)).toEqual(["%4"]);
  });

  test("ペイン番号を行に持つ", () => {
    const rows = buildBoardRows(nested, [], []);
    expect(rows.find((r) => r.target === "%2")?.paneIndex).toBe("1");
  });

  test("状態が変わってもタブとペインの並びは動かない", () => {
    // 並びが状態で入れ替わると、押したいタブが毎回別の場所へ動いて狙えない。
    // tmux で見えている順のままにする。
    const withStates = buildBoardRows(
      nested,
      [],
      [state("%4", "waiting", 500), state("%3", "done", 100)],
    );
    expect(sessionNames(withStates)).toEqual(["work", "dev"]);
    expect(withStates.map((r) => r.target)).toEqual(["%1", "%2", "%3", "%4"]);
  });

  test("上段のボードだけは待たせている順になる", () => {
    const rows = buildBoardRows(
      nested,
      [],
      [state("%4", "waiting", 500), state("%3", "done", 100)],
    );
    expect(attentionRows(rows).map((r) => r.target)).toEqual(["%3", "%4"]);
  });
});

describe("シェルと tmux ペインの対応", () => {
  // ブラウザのシェルの中で tmux を起動すると、その tmux クライアントは
  // シェルと同じ端末に載る。tty を鍵にして両者を結び付ける。
  const panes: TmuxPanesResponse = {
    available: true,
    running: true,
    sessions: [
      {
        name: "work",
        attached: true,
        windows: [
          {
            index: 0,
            name: "main",
            active: true,
            panes: [
              pane({ id: "%1", paneIndex: 0 }),
              pane({ id: "%2", paneIndex: 1 }),
            ],
          },
        ],
      },
    ],
  };

  function client(tty: string, pane: string): TmuxClient {
    return { tty, session: "work", pane };
  }

  function linkOf(rows: BoardRow[], target: string): string {
    return rows.find((row) => row.target === target)?.linkedTarget ?? "(なし)";
  }

  test("端末が一致する行どうしを両方向で結ぶ", () => {
    const rows = buildBoardRows(
      panes,
      [shell({ id: "shell-aaa111", tty: "/dev/ttys001" })],
      [],
      [client("/dev/ttys001", "%2")],
    );

    // ペインからは「映しているシェル」、シェルからは「映しているペイン」。
    expect(linkOf(rows, "%2")).toBe("shell-aaa111");
    expect(linkOf(rows, "shell-aaa111")).toBe("%2");
    // 映していないペインには何も付かない。
    expect(linkOf(rows, "%1")).toBe("");
  });

  test("tty を引けなかったシェルは何とも結ばない", () => {
    // 空の tty を素通しすると、tty が空のクライアントと当たって無関係な
    // ペインに印が付く。
    const rows = buildBoardRows(
      panes,
      [shell({ id: "shell-aaa111", tty: "" })],
      [],
      [client("", "%1")],
    );

    expect(linkOf(rows, "%1")).toBe("");
    expect(linkOf(rows, "shell-aaa111")).toBe("");
  });

  test("終了したシェルは映しているものとして数えない", () => {
    // プロセスが死んだ後も一覧には残る。端末だけ一致しても画面は出ていない。
    const rows = buildBoardRows(
      panes,
      [shell({ id: "shell-aaa111", tty: "/dev/ttys001", exited: true })],
      [],
      [client("/dev/ttys001", "%1")],
    );

    expect(linkOf(rows, "%1")).toBe("");
  });

  test("クライアントを渡さなければ全て未接続として組む", () => {
    // /_tmux/clients が落ちても、一覧そのものは出せる。
    const rows = buildBoardRows(panes, [shell({ tty: "/dev/ttys001" })], []);

    expect(rows.every((row) => row.linkedTarget === "")).toBe(true);
  });
});

describe("filterByScope", () => {
  // 既定はこのリポジトリ。tmux サーバは 1 つで全プロジェクトが同居するので、
  // 既定を「すべて」にすると件数も「あなたの番」も他プロジェクトで埋まる。
  const rows = [
    row({ target: "%1", inRepo: true }),
    row({ target: "%2", inRepo: false }),
    row({ target: "shell-abc123", kind: "shell", inRepo: true }),
  ];

  test.each([
    {
      name: "このリポジトリだけ",
      scope: "repo",
      expected: ["%1", "shell-abc123"],
    },
    {
      name: "すべて",
      scope: "all",
      expected: ["%1", "%2", "shell-abc123"],
    },
  ] satisfies {
    name: string;
    scope: BoardScope;
    expected: string[];
  }[])("$name", ({ scope, expected }) => {
    expect(filterByScope(rows, scope).map((r) => r.target)).toEqual(expected);
  });

  test("シェルは範囲に関係なく残る", () => {
    // シェルはこのサーバが開いたものなので、必ずこのリポジトリのもの。
    const shells = buildBoardRows(null, [shell()], []);
    expect(filterByScope(shells, "repo")).toHaveLength(1);
  });
});

describe("sortBoardRows", () => {
  test("人間の番が先、その中では待たせている順", () => {
    const rows = sortBoardRows([
      row({ target: "a", state: "working", updatedAt: 10 }),
      row({ target: "b", state: "done", updatedAt: 300 }),
      row({ target: "c", state: "waiting", updatedAt: 200 }),
      row({ target: "d", state: "idle", updatedAt: 20 }),
    ]);
    expect(rows.map((r) => r.target)).toEqual(["c", "b", "a", "d"]);
  });

  test("時刻の分からない行は最後に回す", () => {
    const rows = sortBoardRows([
      row({ target: "unknown", state: "idle", updatedAt: 0 }),
      row({ target: "known", state: "idle", updatedAt: 50 }),
    ]);
    expect(rows.map((r) => r.target)).toEqual(["known", "unknown"]);
  });
});

describe("countBoardStates", () => {
  test("状態ごとの件数を返す", () => {
    const counts = countBoardStates([
      row({ state: "waiting" }),
      row({ state: "waiting" }),
      row({ state: "done" }),
      row({ state: "working" }),
    ]);
    expect(counts).toEqual({ waiting: 2, done: 1, working: 1, idle: 0 });
  });

  test("空でも 4 つの状態が揃う", () => {
    expect(countBoardStates([])).toEqual({
      waiting: 0,
      done: 0,
      working: 0,
      idle: 0,
    });
  });
});

describe("filterBoardRows", () => {
  const rows = [
    row({
      target: "%1",
      task: "テーブルを実装する",
      state: "waiting",
      place: "board",
    }),
    row({
      target: "%2",
      task: "テストを書く",
      state: "working",
      place: "board",
    }),
    row({
      target: "shell-x1y2z3",
      task: "/bin/zsh",
      state: "idle",
      place: "docs",
    }),
  ];

  test.each([
    { name: "状態で絞る", state: "waiting", query: "", expected: ["%1"] },
    { name: "文字で絞る", state: null, query: "テスト", expected: ["%2"] },
    {
      name: "置き場所でも当たる",
      state: null,
      query: "docs",
      expected: ["shell-x1y2z3"],
    },
    {
      name: "宛先でも当たる",
      state: null,
      query: "shell-x1",
      expected: ["shell-x1y2z3"],
    },
    {
      name: "大文字小文字を無視する",
      state: null,
      query: "BOARD",
      expected: ["%1", "%2"],
    },
    {
      name: "状態と文字の両方",
      state: "working",
      query: "board",
      expected: ["%2"],
    },
    {
      name: "当たらなければ空",
      state: null,
      query: "見つからない",
      expected: [],
    },
    {
      name: "空の条件は全部通す",
      state: null,
      query: "   ",
      expected: ["%1", "%2", "shell-x1y2z3"],
    },
  ] satisfies {
    name: string;
    state: AgentState | null;
    query: string;
    expected: string[];
  }[])("$name", ({ state: filterState, query, expected }) => {
    const result = filterBoardRows(rows, { state: filterState, query });
    expect(result.map((r) => r.target)).toEqual(expected);
  });
});

describe("elapsedBucket", () => {
  test.each([
    { name: "境界: 0 は たった今", ms: 0, unit: "now", value: 0 },
    { name: "境界: 59 秒は たった今", ms: 59_999, unit: "now", value: 0 },
    { name: "境界: 60 秒で 1 分", ms: 60_000, unit: "minute", value: 1 },
    { name: "境界: 59 分", ms: 59 * 60_000, unit: "minute", value: 59 },
    { name: "境界: 60 分で 1 時間", ms: 60 * 60_000, unit: "hour", value: 1 },
    { name: "境界: 23 時間", ms: 23 * 3_600_000, unit: "hour", value: 23 },
    { name: "境界: 24 時間で 1 日", ms: 24 * 3_600_000, unit: "day", value: 1 },
    { name: "負の値は たった今", ms: -5, unit: "now", value: 0 },
    {
      name: "数値でなければ たった今",
      ms: Number.NaN,
      unit: "now",
      value: 0,
    },
  ])("$name", ({ ms, unit, value }) => {
    expect(elapsedBucket(ms)).toEqual({ unit, value });
  });
});

describe("clampTerminalFontSize", () => {
  // 保存値は他の設定と同じ経路で往復するので、壊れた値が来ても既定へ落として
  // 端末が読めない大きさにならないようにする。
  test.each([
    {
      name: "境界: 下限ちょうど",
      value: MIN_TERMINAL_FONT_SIZE,
      expected: MIN_TERMINAL_FONT_SIZE,
    },
    {
      name: "境界: 下限未満は下限へ",
      value: MIN_TERMINAL_FONT_SIZE - 1,
      expected: MIN_TERMINAL_FONT_SIZE,
    },
    {
      name: "境界: 上限ちょうど",
      value: MAX_TERMINAL_FONT_SIZE,
      expected: MAX_TERMINAL_FONT_SIZE,
    },
    {
      name: "境界: 上限超過は上限へ",
      value: MAX_TERMINAL_FONT_SIZE + 1,
      expected: MAX_TERMINAL_FONT_SIZE,
    },
    { name: "小数は丸める", value: 12.6, expected: 13 },
    { name: "0 は下限へ", value: 0, expected: MIN_TERMINAL_FONT_SIZE },
    { name: "負値は下限へ", value: -20, expected: MIN_TERMINAL_FONT_SIZE },
  ])("$name", ({ value, expected }) => {
    expect(clampTerminalFontSize(value)).toBe(expected);
  });

  test.each([
    { name: "未設定は既定", value: undefined },
    { name: "null は既定", value: null },
    { name: "文字列は既定", value: "14" },
    { name: "NaN は既定", value: Number.NaN },
  ])("$name", ({ value }) => {
    expect(clampTerminalFontSize(value)).toBe(DEFAULT_TERMINAL_FONT_SIZE);
  });
});
