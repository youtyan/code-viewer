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
