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
  AgentStateObservationError,
  AgentStateRecord,
} from "../core/agent-state";
import type { TmuxPanesResponse } from "../core/tmux";
import { terminalText } from "../views/terminal/i18n";
import { createSessionBoard } from "../views/terminal/session-board";
import { q } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.replaceChildren();
});

function panes(inRepo: boolean[]): TmuxPanesResponse {
  return {
    available: true,
    running: true,
    sessions: [
      {
        name: "sample",
        attached: true,
        windows: [
          {
            index: 0,
            name: "work",
            active: true,
            panes: inRepo.map((inside, index) => ({
              id: `%${index + 1}`,
              label: `sample:0.${index}`,
              paneIndex: index,
              title: `sample task ${index + 1}`,
              command: "shell",
              path: `/workspace/sample-${index + 1}`,
              pid: 0,
              width: 80,
              height: 24,
              active: index === 0,
              inRepo: inside,
            })),
          },
        ],
      },
    ],
  };
}

function states(values: Array<AgentStateRecord["state"]>): AgentStateRecord[] {
  return values.map((state, index) => ({
    target: `%${index + 1}`,
    state,
    source: "hook",
    updatedAt: 0,
    changeObserved: true,
    lastPrompt: "",
    note: "",
  }));
}

function createBoard(
  inRepo: boolean[],
  agentStates: AgentStateRecord[],
  stateErrors: AgentStateObservationError[] = [],
) {
  const board = createSessionBoard({
    getText: () => terminalText("ja"),
    onSelectShell: vi.fn(),
    onOpenPane: vi.fn(),
    onCreateShell: vi.fn(),
    onCloseShell: vi.fn(),
    onMarkRead: vi.fn(),
    onShowTab: vi.fn(),
    onOpenInTab: vi.fn(),
  });
  board.setData({
    panes: panes(inRepo),
    shells: [],
    clients: [],
    shellAvailable: true,
    shellUnavailableReason: "",
    states: agentStates,
    stateErrors,
  });
  return board;
}

test("観測エラーを全件・詳細・スタック付きで表示する", () => {
  const board = createBoard(
    [],
    [],
    [
      {
        operation: "list_terminals",
        target: "",
        at: 1,
        detail: 'Error: first failure\nDetails: {"reason":"one"}',
        stack: "Error: first failure\n  at first.ts:1:1",
      },
      {
        operation: "capture_screen",
        target: "%2",
        at: 2,
        detail: "Error: second failure",
        stack: "Error: second failure\n  at second.ts:2:2",
      },
    ],
  );
  const error = q<HTMLElement>(board.el, ".terminal-observation-errors");
  expect(error.hidden).toBe(false);
  expect(error.textContent).toContain("list_terminals");
  expect(error.textContent).toContain("reason");
  expect(error.textContent).toContain("capture_screen %2");
  expect(error.textContent).toContain("second.ts:2:2");
});

function selectValue(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

function visibleTargets(board: HTMLElement): string[] {
  return Array.from(
    board.querySelectorAll<HTMLButtonElement>("[data-target]"),
  ).map((button) => button.dataset.target ?? "");
}

describe("terminal session board controls", () => {
  test("表示範囲と状態をセレクトにまとめ、操作ボタンは新しいシェルだけにする", () => {
    const board = createBoard([true], states(["working"]));

    expect(
      Array.from(board.el.querySelectorAll<HTMLSelectElement>("select")).map(
        (select) => select.getAttribute("aria-label"),
      ),
    ).toEqual(["表示範囲", "状態"]);
    expect(
      Array.from(
        board.el.querySelectorAll<HTMLButtonElement>(
          ".terminal-scope button, .terminal-filters button",
        ),
      ).map((button) => button.getAttribute("aria-label")),
    ).toEqual(["このリポジトリで新しいシェルを開きます"]);
  });

  test("状態セレクトを変えると該当する行だけを表示する", () => {
    const board = createBoard([true, true], states(["waiting", "working"]));
    const stateSelect = board.el.querySelector<HTMLSelectElement>(
      '[aria-label="状態"]',
    );
    if (!stateSelect) throw new Error("missing state select");

    selectValue(stateSelect, "working");

    expect(visibleTargets(board.el)).toEqual(["%2"]);
  });

  test("表示範囲をすべてに変えると他プロジェクトの行も表示する", () => {
    const board = createBoard([true, false], states(["idle", "idle"]));
    const scopeSelect = board.el.querySelector<HTMLSelectElement>(
      '[aria-label="表示範囲"]',
    );
    if (!scopeSelect) throw new Error("missing scope select");

    selectValue(scopeSelect, "all");

    expect(visibleTargets(board.el)).toEqual(["%1", "%2"]);
  });

  test("検索中に入力欄のフォーカスとカーソル位置を維持する", () => {
    const board = createBoard([true], states(["working"]));
    document.body.appendChild(board.el);
    const search = board.el.querySelector<HTMLInputElement>(".terminal-search");
    if (!search) throw new Error("missing terminal search");
    search.value = "sample";
    search.focus();
    search.setSelectionRange(3, 3);

    search.dispatchEvent(new Event("input"));

    expect(document.activeElement).toBe(search);
    expect(search.selectionStart).toBe(3);
    expect(search.selectionEnd).toBe(3);
  });
});

describe("terminal elapsed labels", () => {
  test.each([
    { name: "日本語", lang: "ja" as const, expected: "今" },
    { name: "英語", lang: "en" as const, expected: "now" },
  ])("$name は現在時刻を短く表示する", ({ lang, expected }) => {
    expect(terminalText(lang).elapsed({ unit: "now", value: 0 })).toBe(
      expected,
    );
  });

  test.each([
    { name: "日本語", lang: "ja" as const, expected: "他 31 件" },
    { name: "英語", lang: "en" as const, expected: "31 elsewhere" },
  ])("$name は他プロジェクト件数を短く表示する", ({ lang, expected }) => {
    expect(terminalText(lang).hiddenOther(31)).toBe(expected);
  });

  test.each([
    { name: "日本語", lang: "ja" as const, expected: "作業内容・場所・宛先" },
    { name: "英語", lang: "en" as const, expected: "task, place, or id" },
  ])("$name は検索欄を短く表示する", ({ lang, expected }) => {
    expect(terminalText(lang).filterPlaceholder).toBe(expected);
  });
});

describe("your turn rows", () => {
  // 「あなたの番」は左のサイドバーのエージェントの行と同じ部品 (状態の印・
  // 種類・作業内容・経過) の 1 行。行を押すと映し、完了・未読だけ「読んだ」の
  // 小さなボタンが付く。
  test("each entry is one row with the state mark, and only done rows can be marked read", () => {
    const board = createBoard([true, true], states(["waiting", "done"]));
    document.body.append(board.el);
    const cards = [...board.el.querySelectorAll<HTMLElement>(".terminal-card")];
    expect(cards.map((card) => card.className)).toEqual([
      "terminal-card terminal-card-waiting",
      "terminal-card terminal-card-done",
    ]);
    for (const card of cards) {
      const open = q<HTMLButtonElement>(card, ".terminal-card-open");
      expect(open.querySelector(".terminal-mark")).not.toBeNull();
      expect(open.querySelector(".terminal-card-task")?.textContent).toMatch(
        /^sample task /,
      );
    }
    expect(cards[0]?.querySelector(".terminal-card-read")).toBeNull();
    expect(cards[1]?.querySelector(".terminal-card-read")).not.toBeNull();
  });
});

describe("タブで開いているシェルの印", () => {
  const shell = {
    id: "shell-a1" as const,
    command: "/bin/sh",
    cwd: "/work/sample-app",
    createdAt: "2026-09-22T06:00:00.000Z",
    cols: 80,
    rows: 24,
    exited: false,
    exitCode: null,
    tty: "",
  };

  function boardWithShell() {
    const deps = {
      getText: () => terminalText("en"),
      onSelectShell: vi.fn(),
      onOpenPane: vi.fn(),
      onCreateShell: vi.fn(),
      onCloseShell: vi.fn(),
      onMarkRead: vi.fn(),
      onShowTab: vi.fn(),
      onOpenInTab: vi.fn(),
    };
    const board = createSessionBoard(deps);
    board.setData({
      panes: null,
      shells: [shell],
      clients: [],
      shellAvailable: true,
      shellUnavailableReason: "",
      states: [],
      stateErrors: [],
    });
    document.body.append(board.el);
    const row = () =>
      q<HTMLElement>(board.el, `[data-target="shell-a1"]`).closest(
        ".terminal-row",
      ) as HTMLElement;
    return { board, deps, row };
  }

  test.each([
    {
      name: "タブで開いていない: 行を押すとパネルで映し、ボタンは「タブで開く」",
      tabbed: [] as string[],
      expected: {
        marked: false,
        title: "Open in a tab",
        rowClick: "onSelectShell",
        buttonClick: "onOpenInTab",
      },
    },
    {
      name: "タブで開いている: 印が付き、行もボタンもタブを前面に出す",
      tabbed: ["shell-a1"],
      expected: {
        marked: true,
        title: "Shown in a tab — bring it to the front",
        rowClick: "onShowTab",
        buttonClick: "onShowTab",
      },
    },
  ])("$name", ({ tabbed, expected }) => {
    const { board, deps, row } = boardWithShell();
    board.setTabbed(new Set(tabbed));
    const called = () =>
      (["onSelectShell", "onShowTab", "onOpenInTab"] as const).filter(
        (name) => deps[name].mock.calls.length > 0,
      );
    const button = q<HTMLButtonElement>(row(), ".terminal-row-tab");
    const marked = row().classList.contains("terminal-row-in-tab");
    const title = button.title;
    q<HTMLButtonElement>(row(), ".terminal-row-item").click();
    const afterRow = called();
    for (const name of ["onSelectShell", "onShowTab", "onOpenInTab"] as const)
      deps[name].mockClear();
    q<HTMLButtonElement>(row(), ".terminal-row-tab").click();
    expect({
      marked,
      title,
      rowClick: afterRow.join(","),
      buttonClick: called().join(","),
    }).toEqual(expected);
  });
});
