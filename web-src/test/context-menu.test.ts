// 右クリック相当のメニューは、押した場所 (anchor) を動かすスクロールでだけ
// 閉じる。関係のない箱のスクロール (裏の更新でタブの列を描き直したときなど)
// で閉じると、開いた直後に消えて項目が押せなくなる。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "vitest";

GlobalRegistrator.register();

const { closeContextMenu, isContextMenuOpen, showContextMenu } = await import(
  "../views/context-menu"
);

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  closeContextMenu();
  document.body.innerHTML = "";
});

describe("context menu and scrolling", () => {
  test.each([
    {
      name: "a box that does not hold the anchor",
      scrolled: "other",
      open: true,
    },
    { name: "a box that holds the anchor", scrolled: "holder", open: false },
    { name: "the document", scrolled: "document", open: false },
  ])("a scroll of $name leaves it open: $open", ({ scrolled, open }) => {
    document.body.innerHTML =
      '<div id="holder"><button id="anchor">+</button></div><div id="other"></div>';
    const anchor = document.getElementById("anchor") as HTMLElement;
    showContextMenu(anchor, [
      { label: "Open a file", onSelect: () => undefined },
    ]);
    const target =
      scrolled === "document"
        ? document
        : (document.getElementById(scrolled) as HTMLElement);
    target.dispatchEvent(new Event("scroll"));
    expect(isContextMenuOpen()).toBe(open);
  });
});

// メニューはキーだけで選べる。開くと最初の項目にフォーカスがあり、上下の矢印・
// Home・End で押せる項目だけを巡り (区切りと押せない項目は飛ばす、端では反対の
// 端へ)、Enter で選ぶ。メニューが使ったキーはページのキー操作へ渡さない。
describe("context menu and the keyboard", () => {
  test.each([
    { name: "Enter on the first item", keys: ["Enter"], chosen: "Open a file" },
    {
      name: "ArrowDown then Enter",
      keys: ["ArrowDown", "Enter"],
      chosen: "New shell",
    },
    {
      name: "ArrowDown skips the separator and the disabled item",
      keys: ["ArrowDown", "ArrowDown", "Enter"],
      chosen: "All sessions",
    },
    {
      name: "ArrowDown past the last item wraps to the first",
      keys: ["ArrowDown", "ArrowDown", "ArrowDown", "Enter"],
      chosen: "Open a file",
    },
    {
      name: "ArrowUp from the first item wraps to the last",
      keys: ["ArrowUp", "Enter"],
      chosen: "All sessions",
    },
    {
      name: "End then Home",
      keys: ["End", "Home", "Enter"],
      chosen: "Open a file",
    },
  ])("$name chooses $chosen", ({ keys, chosen }) => {
    document.body.innerHTML = '<button id="anchor">+</button>';
    const anchor = document.getElementById("anchor") as HTMLElement;
    const selected: string[] = [];
    const reachedPage: string[] = [];
    const page = (event: KeyboardEvent) => reachedPage.push(event.key);
    document.addEventListener("keydown", page);
    const pick = (label: string) => ({
      label,
      onSelect: () => selected.push(label),
    });
    showContextMenu(anchor, [
      pick("Open a file"),
      pick("New shell"),
      { kind: "separator" },
      { ...pick("No shell is open yet"), disabled: true },
      pick("All sessions"),
    ]);
    for (const key of keys)
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    document.removeEventListener("keydown", page);
    expect([selected, reachedPage, isContextMenuOpen()]).toEqual([
      [chosen],
      [],
      false,
    ]);
  });
});
