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
import type { AgentStateRecord } from "../core/agent-state";
import type { TmuxPanesResponse } from "../core/tmux";
import { terminalText } from "../views/terminal/i18n";
import { createSessionBoard } from "../views/terminal/session-board";

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
    lastPrompt: "",
    note: "",
  }));
}

function createBoard(inRepo: boolean[], agentStates: AgentStateRecord[]) {
  const board = createSessionBoard({
    getText: () => terminalText("ja"),
    onSelectShell: vi.fn(),
    onOpenPane: vi.fn(),
    onCreateShell: vi.fn(),
    onCloseShell: vi.fn(),
    onMarkRead: vi.fn(),
  });
  board.setData({
    panes: panes(inRepo),
    shells: [],
    clients: [],
    shellAvailable: true,
    shellUnavailableReason: "",
    states: agentStates,
  });
  return board;
}

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
