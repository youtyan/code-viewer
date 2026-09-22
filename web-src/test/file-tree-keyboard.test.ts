// Files の木は Tab の止まり場所を 1 つだけ持ち (roving tabindex)、行の上の
// ↑↓ / Home / End / → / ← で動く。vim 風のキー (j k h l) はページのキー割り当て
// のまま (ここでは見ない)。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { createSidebarForTest, installSidebarDom } from "./_sidebar-fixture";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

const FILES = [
  { path: "src", type: "tree" as const },
  { path: "src/alpha.ts", type: "blob" as const },
  { path: "src/beta.ts", type: "blob" as const },
  { path: "README.md", type: "blob" as const },
];

function rowPath(row: Element | null): string | null {
  if (!(row instanceof HTMLElement)) return null;
  return row.dataset.path ?? row.dataset.dirpath ?? null;
}

function mountTree() {
  installSidebarDom();
  const sidebar = createSidebarForTest();
  const opened: string[] = [];
  sidebar.renderSidebar(FILES, (file) => opened.push(file.path));
  return { sidebar, opened };
}

function row(path: string): HTMLElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>("#filelist > li"),
  ].find((item) => rowPath(item) === path);
  if (!found) throw new Error(`missing row ${path}`);
  return found;
}

/** 木の様子: フォーカス・選んでいる行・Tab の止まり場所・並んでいる行。 */
function snapshot() {
  const rows = [...document.querySelectorAll<HTMLElement>("#filelist > li")];
  return {
    focused: rowPath(document.activeElement),
    active: rowPath(document.querySelector("#filelist > li.active")),
    tabStops: rows.filter((item) => item.tabIndex === 0).map(rowPath),
    rows: rows.map(rowPath),
  };
}

function press(target: HTMLElement, key: string, shiftKey = false): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

const ALL = ["src", "src/alpha.ts", "src/beta.ts", "README.md"];

describe("the file tree is one tab stop", () => {
  test("with nothing selected, the first row", () => {
    mountTree();
    expect(snapshot().tabStops).toEqual(["src"]);
  });

  test("with a selected row, only that row", () => {
    const { sidebar } = mountTree();
    sidebar.markActive("src/beta.ts");
    expect(snapshot().tabStops).toEqual(["src/beta.ts"]);
  });

  test("a redraw keeps the focus on the selected row", () => {
    const { sidebar } = mountTree();
    sidebar.markActive("src/alpha.ts");
    row("src/alpha.ts").focus();
    sidebar.rerenderVirtualSidebar();
    const focused = document.activeElement;
    expect({ path: rowPath(focused), connected: focused?.isConnected }).toEqual(
      {
        path: "src/alpha.ts",
        connected: true,
      },
    );
  });

  test("only the tab stop row keeps its folder button in Tab", () => {
    const { sidebar } = mountTree();
    sidebar.markActive("README.md");
    const inTab = () =>
      [...document.querySelectorAll<HTMLElement>("#filelist > li button")]
        .filter((button) => button.tabIndex >= 0)
        .map((button) => rowPath(button.closest("li")));
    const onFile = inTab();
    sidebar.markActive("src");
    expect({ onFile, onFolder: inTab() }).toEqual({
      onFile: [],
      onFolder: ["src"],
    });
  });

  // Tab で行からその中のボタンへ移ると、ボタンを見せるスクロールで描き直しが
  // 走る。選んでいる行が無くても #sidebar へ戻さない (戻すと木の頭へ一周した)。
  test.each([
    ["a selected folder", "src"],
    ["nothing selected (the first row is the stop)", null],
  ])("a redraw keeps focus on the row's button: %s", (_name, selected) => {
    const { sidebar } = mountTree();
    if (selected) sidebar.markActive(selected);
    row("src").querySelector<HTMLElement>("button")?.focus();
    sidebar.rerenderVirtualSidebar();
    const focused = document.activeElement;
    expect({
      tag: focused?.tagName,
      row: rowPath(focused?.closest("li") ?? null),
      connected: focused?.isConnected,
    }).toEqual({ tag: "BUTTON", row: "src", connected: true });
  });

  // 差分の一覧も止まり場所を 1 つ持つ (views/list-tab-stop.ts。詳しくは
  // list-keyboard.test.ts)。
  test("the diff list has its own tab stop (the first row)", () => {
    installSidebarDom();
    createSidebarForTest().renderSidebar(FILES);
    expect(snapshot().tabStops).toEqual(["src"]);
  });
});

describe("keys on a tree row", () => {
  test.each<{
    name: string;
    from: string | null;
    key: string;
    shift?: boolean;
    focused: string;
    rows: string[];
    prevented: boolean;
  }>([
    {
      name: "↓ from the row entered by Tab",
      from: null,
      key: "ArrowDown",
      focused: "src/alpha.ts",
      rows: ALL,
      prevented: true,
    },
    {
      name: "↓",
      from: "src/alpha.ts",
      key: "ArrowDown",
      focused: "src/beta.ts",
      rows: ALL,
      prevented: true,
    },
    {
      name: "↑",
      from: "src/beta.ts",
      key: "ArrowUp",
      focused: "src/alpha.ts",
      rows: ALL,
      prevented: true,
    },
    {
      name: "End",
      from: "src",
      key: "End",
      focused: "README.md",
      rows: ALL,
      prevented: true,
    },
    {
      name: "Home",
      from: "README.md",
      key: "Home",
      focused: "src",
      rows: ALL,
      prevented: true,
    },
    {
      name: "← on an open folder folds it",
      from: "src",
      key: "ArrowLeft",
      focused: "src",
      rows: ["src", "README.md"],
      prevented: true,
    },
    {
      name: "← on a file goes to its folder",
      from: "src/beta.ts",
      key: "ArrowLeft",
      focused: "src",
      rows: ALL,
      prevented: true,
    },
    {
      name: "→ on a file does nothing",
      from: "README.md",
      key: "ArrowRight",
      focused: "README.md",
      rows: ALL,
      prevented: true,
    },
    {
      name: "Shift+↓ is not the tree's",
      from: "src",
      key: "ArrowDown",
      shift: true,
      focused: "src",
      rows: ALL,
      prevented: false,
    },
  ])("$name", ({ from, key, shift, focused, rows, prevented }) => {
    const { sidebar } = mountTree();
    if (from) sidebar.markActive(from);
    const start = from ? row(from) : row("src");
    start.focus();
    const handled = press(start, key, shift);
    expect({ ...snapshot(), prevented: handled }).toEqual({
      focused,
      active: from === null && !prevented ? null : focused,
      tabStops: [focused],
      rows,
      prevented,
    });
  });

  test("→ opens a folded folder and ← folds it again", () => {
    const { sidebar } = mountTree();
    sidebar.markActive("src");
    row("src").focus();
    press(row("src"), "ArrowLeft");
    const folded = snapshot().rows;
    press(row("src"), "ArrowRight");
    expect({
      folded,
      opened: snapshot().rows,
      focused: snapshot().focused,
    }).toEqual({
      folded: ["src", "README.md"],
      opened: ALL,
      focused: "src",
    });
  });
});
