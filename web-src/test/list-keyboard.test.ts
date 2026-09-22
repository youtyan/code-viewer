// 一覧の列の一覧 (Diff の変更ファイル・History のコミット) と、History の木を
// 開く帯のボタンのキー操作 (views/list-tab-stop.ts)。決まりは Files の木
// (file-tree-keyboard.test.ts) と同じ: Tab の止まり場所は選んでいる行 (無ければ
// 先頭の行) 1 つ、行の中のボタンは止まり場所の行の分だけ Tab に入る、選び直すと
// フォーカスは選んだ行へ移る。作業ツリーの一覧と変更ファイルは
// worktree-view.test.ts。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { AppRoute } from "../core/routes";
import {
  createHistoryView,
  HISTORY_WORKTREE_COMMIT,
  installHistoryPageDom,
} from "../views/history-view";
import {
  focusedListRow,
  onListRowKeys,
  syncListTabStop,
} from "../views/list-tab-stop";
import { createListTreeOpen } from "../views/list-tree-open";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";
import { createSidebarForTest, installSidebarDom } from "./_sidebar-fixture";
import { waitFor } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const originalFetch = globalThis.fetch;
const OriginalIntersectionObserver = globalThis.IntersectionObserver;

afterEach(() => {
  document.body.innerHTML = "";
  globalThis.fetch = originalFetch;
  globalThis.IntersectionObserver = OriginalIntersectionObserver;
});

function press(
  target: HTMLElement,
  key: string,
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {},
): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    ...modifiers,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

// ---- 部品 (views/list-tab-stop.ts) ----

function installRows(keys: string[], active: string | null) {
  document.body.innerHTML = `<div id="box"><ol id="list">${keys
    .map(
      (key) =>
        `<li data-key="${key}" class="${key === active ? "active" : ""}"><button>${key}</button></li>`,
    )
    .join("")}</ol></div>`;
  const list = document.getElementById("list") as HTMLElement;
  return { list, rows: [...list.querySelectorAll<HTMLElement>("li")] };
}

function syncRows(list: HTMLElement, rows: HTMLElement[], memo?: HTMLElement) {
  return syncListTabStop(list, {
    rows,
    keyOf: (row) => row.dataset.key ?? "",
    isActive: (row) => row.classList.contains("active"),
    actionSelector: "button",
    ariaSelected: true,
    ...(memo ? { memo } : {}),
  });
}

describe("list tab stop", () => {
  test.each([
    { name: "選んでいる行が無ければ先頭の行", active: null, stop: "a" },
    { name: "選んでいる行があればその行だけ", active: "b", stop: "b" },
  ])("$name", ({ active, stop }) => {
    const { list, rows } = installRows(["a", "b", "c"], active);
    syncRows(list, rows);
    expect({
      rows: rows.filter((row) => row.tabIndex === 0).map((r) => r.dataset.key),
      buttons: rows
        .filter((row) => row.querySelector("button")?.tabIndex === 0)
        .map((r) => r.dataset.key),
      selected: rows
        .filter((row) => row.getAttribute("aria-selected") === "true")
        .map((r) => r.dataset.key),
    }).toEqual({
      rows: [stop],
      buttons: [stop],
      selected: active ? [active] : [],
    });
  });

  test("選び直したら、選んだ行へフォーカスを移す", () => {
    const { list, rows } = installRows(["a", "b", "c"], "a");
    syncRows(list, rows);
    rows[0].focus();
    rows[0].classList.remove("active");
    rows[2].classList.add("active");
    syncRows(list, rows);
    expect(document.activeElement?.getAttribute("data-key")).toBe("c");
  });

  test("選び直していなければ、同じ行の同じ部品に残る (作り直しをまたいで)", () => {
    // 作り直す一覧は、前回選んでいた行を作り直さない箱 (memo) に覚える。
    const first = installRows(["a", "b"], "a");
    syncRows(first.list, first.rows, document.body);
    first.rows[0].querySelector("button")?.focus();
    const focused = { key: "a", onAction: true };
    // 行を作り直す (同じ box の中身を入れ替える)。
    const again = installRows(["a", "b"], "a");
    syncListTabStop(again.list, {
      rows: again.rows,
      keyOf: (row) => row.dataset.key ?? "",
      isActive: (row) => row.classList.contains("active"),
      actionSelector: "button",
      focused,
      memo: document.body,
    });
    expect({
      tag: document.activeElement?.tagName,
      key: document.activeElement?.closest("li")?.getAttribute("data-key"),
    }).toEqual({ tag: "BUTTON", key: "a" });
  });

  test("行の中の 2 つ目の部品にいたら、作り直した後も 2 つ目へ戻す", () => {
    const rowsHtml = (keys: string[]) =>
      keys
        .map(
          (key) =>
            `<li data-key="${key}" class="${key === "a" ? "active" : ""}"><button>copy</button><button>menu</button></li>`,
        )
        .join("");
    document.body.innerHTML = `<div id="box"><ol id="list">${rowsHtml(["a", "b"])}</ol></div>`;
    const box = document.getElementById("box") as HTMLElement;
    const options = (list: HTMLElement) => ({
      rows: [...list.querySelectorAll<HTMLElement>("li")],
      keyOf: (row: HTMLElement) => row.dataset.key ?? "",
      isActive: (row: HTMLElement) => row.classList.contains("active"),
      actionSelector: "button",
      memo: box,
    });
    let list = document.getElementById("list") as HTMLElement;
    syncListTabStop(list, options(list));
    list
      .querySelectorAll<HTMLElement>("li")[0]
      .querySelectorAll("button")[1]
      .focus();
    const focused = focusedListRow(list, "li", (row) => row.dataset.key ?? "");
    box.innerHTML = `<ol id="list">${rowsHtml(["a", "b"])}</ol>`;
    list = document.getElementById("list") as HTMLElement;
    syncListTabStop(list, { ...options(list), focused });
    expect(document.activeElement?.textContent).toBe("menu");
  });

  test.each([
    { key: "ArrowDown", modifiers: {}, handled: "ArrowDown:b" },
    { key: "End", modifiers: {}, handled: "End:b" },
    { key: "ArrowDown", modifiers: { shiftKey: true }, handled: null },
    { key: "a", modifiers: {}, handled: null },
  ])("行の上のキー: $key ($modifiers)", ({ key, modifiers, handled }) => {
    const { list, rows } = installRows(["a", "b"], null);
    const calls: string[] = [];
    onListRowKeys(list, "li", {
      ArrowDown: (row) => calls.push(`ArrowDown:${row.dataset.key}`),
      End: (row) => calls.push(`End:${row.dataset.key}`),
    });
    const prevented = press(rows[1], key, modifiers);
    expect({ calls, prevented }).toEqual({
      calls: handled ? [handled] : [],
      prevented: handled !== null,
    });
  });

  test("行の中のボタンの上のキーはボタンに任せる", () => {
    const { list, rows } = installRows(["a"], null);
    const calls: string[] = [];
    onListRowKeys(list, "li", { Enter: () => calls.push("row") });
    const button = rows[0].querySelector("button") as HTMLElement;
    expect({ prevented: press(button, "Enter"), calls }).toEqual({
      prevented: false,
      calls: [],
    });
  });
});

// ---- Diff の変更ファイル (views/sidebar.ts の差分の一覧) ----

const FILES = [
  { path: "src", type: "tree" as const },
  { path: "src/alpha.ts", type: "blob" as const, status: "M" },
  { path: "src/beta.ts", type: "blob" as const, status: "A" },
  { path: "README.md", type: "blob" as const, status: "M" },
];

function diffRowKey(row: Element | null): string | null {
  if (!(row instanceof HTMLElement)) return null;
  return row.dataset.path ?? row.dataset.dirpath ?? null;
}

function diffRow(path: string): HTMLElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>(
      "#filelist li[data-path], #filelist li[data-dirpath]",
    ),
  ].find((row) => diffRowKey(row) === path);
  if (!found) throw new Error(`missing row ${path}`);
  return found;
}

function diffSnapshot() {
  const rows = [
    ...document.querySelectorAll<HTMLElement>(
      "#filelist li[data-path], #filelist li[data-dirpath]",
    ),
  ];
  return {
    tabStops: rows.filter((row) => row.tabIndex === 0).map(diffRowKey),
    buttonsInTab: [
      ...document.querySelectorAll<HTMLElement>("#filelist button"),
    ]
      .filter((button) => button.tabIndex >= 0)
      .map((button) => diffRowKey(button.closest("li"))),
    selected: rows
      .filter((row) => row.getAttribute("aria-selected") === "true")
      .map(diffRowKey),
  };
}

function mountDiffList() {
  installSidebarDom();
  const sidebar = createSidebarForTest();
  sidebar.renderSidebar(FILES);
  return sidebar;
}

describe("the diff list is one tab stop", () => {
  test("with nothing selected, the first row (and only its folder button)", () => {
    mountDiffList();
    expect(diffSnapshot()).toEqual({
      tabStops: ["src"],
      buttonsInTab: ["src"],
      selected: [],
    });
  });

  test("with a selected file, only that row", () => {
    const sidebar = mountDiffList();
    sidebar.markActive("src/beta.ts");
    expect(diffSnapshot()).toEqual({
      tabStops: ["src/beta.ts"],
      buttonsInTab: [],
      selected: ["src/beta.ts"],
    });
  });

  test("a re-selection moves the focus from a row to the selected row", () => {
    const sidebar = mountDiffList();
    sidebar.markActive("src/alpha.ts");
    diffRow("src/alpha.ts").focus();
    sidebar.markActive("README.md");
    expect(diffRowKey(document.activeElement)).toBe("README.md");
  });

  test("a redraw keeps the focus on the selected row", () => {
    const sidebar = mountDiffList();
    sidebar.markActive("src/alpha.ts");
    diffRow("src/alpha.ts").focus();
    sidebar.renderSidebar(FILES);
    const focused = document.activeElement;
    expect({
      path: diffRowKey(focused),
      connected: focused?.isConnected,
    }).toEqual({ path: "src/alpha.ts", connected: true });
  });

  test("folding the folder of the tab stop moves the stop to a shown row", () => {
    const sidebar = mountDiffList();
    sidebar.markActive("src/beta.ts");
    diffRow("src").click();
    expect({
      stops: diffSnapshot().tabStops,
      expanded: diffRow("src").getAttribute("aria-expanded"),
    }).toEqual({ stops: ["src"], expanded: "false" });
  });

  test("roles: a tree of tree items with groups, named", () => {
    mountDiffList();
    const list = document.getElementById("filelist");
    expect({
      role: list?.getAttribute("role"),
      label: list?.getAttribute("aria-label"),
      rows: [
        ...document.querySelectorAll<HTMLElement>(
          "#filelist li[data-path], #filelist li[data-dirpath]",
        ),
      ].map((row) => row.getAttribute("role")),
      groups: [...document.querySelectorAll("#filelist .tree-children")].map(
        (group) => group.getAttribute("role"),
      ),
      expanded: diffRow("src").getAttribute("aria-expanded"),
    }).toEqual({
      role: "tree",
      label: "Changed files",
      rows: ["treeitem", "treeitem", "treeitem", "treeitem"],
      groups: ["group"],
      expanded: "true",
    });
  });
});

// ---- History のコミットの一覧 (views/history-view.ts) ----

const COMMITS = ["aaaa111", "bbbb222", "cccc333"].map((sha, index) => ({
  sha,
  parents: [`p${index}`],
  subject: `subject ${sha}`,
  body: "",
  author: "Sample Author",
  when: new Date().toISOString(),
}));

// 一覧の末尾の読み足し (IntersectionObserver) はここでは見ない。
class NoopIntersectionObserver {
  observe() {
    /* 読み足しは見ない */
  }
  unobserve() {
    /* 読み足しは見ない */
  }
  disconnect() {
    /* 読み足しは見ない */
  }
  takeRecords() {
    return [];
  }
}

async function mountHistory() {
  document.body.innerHTML =
    '<aside id="history-panel"></aside><section id="history-commit-info"></section>';
  installHistoryPageDom();
  globalThis.IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/_log")
      ? { commits: COMMITS, hasMore: false }
      : { content: "" };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
  let route: AppRoute = {
    screen: "history",
    ref: "HEAD",
    range: { from: "HEAD", to: "worktree" },
  };
  const view = createHistoryView({
    $: <T extends Element>(selector: string) => {
      const found = document.querySelector<T>(selector);
      if (!found) throw new Error(`missing ${selector}`);
      return found;
    },
    escapeHtml: (value) =>
      String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;"),
    getRoute: () => route,
    setRoute: (next) => {
      route = next;
    },
    applyCommitRange: async () => undefined,
    showEmptyDiffPane: () => undefined,
    getSyntaxHighlight: () => false,
    getLanguage: () => "en",
    trackLoad: (promise) => promise,
  });
  await view.enterHistory();
  await waitFor(() => historyRows().length === COMMITS.length + 1);
  return view;
}

function historyRows(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>("#history-list .history-item"),
  ];
}

function historyRow(sha: string): HTMLElement {
  const row = historyRows().find((item) => item.dataset.sha === sha);
  if (!row) throw new Error(`missing row ${sha}`);
  return row;
}

function historySnapshot() {
  return {
    stops: historyRows()
      .filter((row) => row.tabIndex === 0)
      .map((row) => row.dataset.sha),
    active: historyRows()
      .filter((row) => row.classList.contains("active"))
      .map((row) => row.dataset.sha),
    focused: (document.activeElement as HTMLElement | null)?.dataset?.sha,
  };
}

async function settle(expectedActive: string) {
  await waitFor(() => historyRow(expectedActive).classList.contains("active"));
}

describe("the commit list is one tab stop", () => {
  test("a listbox of options, named; the first row is the stop", async () => {
    await mountHistory();
    const list = document.getElementById("history-list");
    expect({
      role: list?.getAttribute("role"),
      label: list?.getAttribute("aria-label"),
      rows: historyRows().map((row) => row.getAttribute("role")),
      stops: historySnapshot().stops,
    }).toEqual({
      role: "listbox",
      label: "Commits",
      rows: ["option", "option", "option", "option"],
      stops: [HISTORY_WORKTREE_COMMIT],
    });
  });

  test.each([
    // Tab で入った先頭の行 (まだ選んでいない) から ↓ はその隣
    {
      name: "↓ from the row entered by Tab",
      from: HISTORY_WORKTREE_COMMIT,
      key: "ArrowDown",
      selected: "aaaa111",
    },
    { name: "↓", from: "aaaa111", key: "ArrowDown", selected: "bbbb222" },
    { name: "↑", from: "bbbb222", key: "ArrowUp", selected: "aaaa111" },
    { name: "End", from: "aaaa111", key: "End", selected: "cccc333" },
    {
      name: "Home",
      from: "cccc333",
      key: "Home",
      selected: HISTORY_WORKTREE_COMMIT,
    },
    {
      name: "Enter selects the focused row",
      from: "bbbb222",
      key: "Enter",
      selected: "bbbb222",
    },
  ])("$name", async ({ from, key, selected }) => {
    await mountHistory();
    if (from !== HISTORY_WORKTREE_COMMIT && key !== "Enter") {
      historyRow(from).click();
      await settle(from);
    }
    historyRow(from).focus();
    const prevented = press(historyRow(from), key);
    await settle(selected);
    expect({ prevented, ...historySnapshot() }).toEqual({
      prevented: true,
      stops: [selected],
      active: [selected],
      focused: selected,
    });
  });
});

// ---- History の木を開く帯のボタン (views/list-tree-open.ts) ----

describe("the folded tree's open button", () => {
  function mountFoldedTree() {
    document.body.innerHTML = `
      <aside id="sidebar"><ul id="filelist">
        <li data-path="a" tabindex="-1">a</li>
        <li data-path="b" tabindex="0">b</li>
      </ul></aside>
      <main id="content"></main>`;
    const opened: string[] = [];
    const button = createListTreeOpen({
      open: () => opened.push("open"),
      label: () => "show the changed files",
    });
    return { button, opened };
  }

  test("a named button right after the tree (Tab order: list → tree → main)", () => {
    const { button } = mountFoldedTree();
    expect({
      tag: button.tagName,
      type: button.type,
      tabbable: button.tabIndex >= 0,
      label: button.getAttribute("aria-label"),
      after: button.previousElementSibling?.id,
      before: button.nextElementSibling?.id,
    }).toEqual({
      tag: "BUTTON",
      type: "button",
      tabbable: true,
      label: "show the changed files",
      after: "sidebar",
      before: "content",
    });
  });

  test("opening moves the focus to the tree's tab stop row", () => {
    const { button, opened } = mountFoldedTree();
    button.focus();
    button.click();
    expect({
      opened,
      focused: (document.activeElement as HTMLElement | null)?.dataset.path,
    }).toEqual({ opened: ["open"], focused: "b" });
  });
});

// キーで届いた行とボタンの輪は内側に描く (行は一覧の端まで広がるので外の輪は
// 切れる)。選んでいる行は光も残す。#filelist の行 (Diff と History の変更
// ファイル) は Files の木と同じ規則 (file-tree-keyboard の CSS)。
describe("focus rings of the list column", () => {
  const rules = baseRules(loadStyleSheet());
  const shadowOf = (selector: string) =>
    cascadedDeclarations(rules, (candidate) => candidate === selector).get(
      "box-shadow",
    );
  test.each([
    {
      selector: "#history-panel .history-item:focus-visible",
      shadow: "var(--focus-ring-inset)",
    },
    {
      selector: "#history-panel .history-item.active:focus-visible",
      shadow: "var(--focus-ring-inset), var(--glow-select)",
    },
    {
      selector:
        "body.gdp-worktree-page #worktree-panel .history-item:focus-visible",
      shadow: "var(--focus-ring-inset)",
    },
    {
      selector:
        "body.gdp-worktree-page #worktree-panel .history-item.active:focus-visible",
      shadow: "var(--focus-ring-inset), var(--glow-select)",
    },
    {
      selector: "body[data-list-tree-folded] .list-tree-open:focus-visible",
      shadow: "var(--focus-ring-inset)",
    },
    {
      selector: "#filelist li:focus-visible",
      shadow: "var(--focus-ring-inset)",
    },
  ])("$selector", ({ selector, shadow }) => {
    expect(shadowOf(selector)).toBe(shadow);
  });
});
