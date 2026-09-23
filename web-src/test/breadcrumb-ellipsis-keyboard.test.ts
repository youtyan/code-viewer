// パンくずの畳んだ「…」は、畳んだ段への唯一の入口 (隠した段はキーでも読み上げでも
// 届かない)。Tab で届き、読み上げの名前は全体のパス、Enter / Space で畳んだ段の
// メニューを開き、選ぶとその段を押したのと同じ。Escape でフォーカスは「…」へ戻る。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

GlobalRegistrator.register();

const { fitBreadcrumb } = await import("../views/breadcrumb-fit");
const { closeContextMenu, isContextMenuOpen } = await import(
  "../views/context-menu"
);

// 測り直しは ResizeObserver から来る。happy-dom は描かないので、見始めた時点で
// 1 回だけ知らせる。
class ImmediateResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {
    /* 見始めたときの 1 回だけ知らせる */
  }
  disconnect() {
    /* 同上 */
  }
}

let savedResizeObserver: typeof ResizeObserver;
beforeAll(() => {
  savedResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver =
    ImmediateResizeObserver as unknown as typeof ResizeObserver;
});

afterAll(() => {
  globalThis.ResizeObserver = savedResizeObserver;
  GlobalRegistrator.unregister();
});

afterEach(() => {
  closeContextMenu();
  document.body.innerHTML = "";
});

const PARTS = ["sample-repo", "src", "deep", "nested", "dir"];

/**
 * 段 5 つ (最後が今の場所) を幅 50 ずつで、使える幅 150 に置いて畳む。先頭と
 * 末尾 2 段は残すので、畳むのは src と deep。
 */
function collapsedBreadcrumb(pressed: string[]) {
  const nav = document.createElement("nav");
  nav.className = "gdp-file-breadcrumb";
  PARTS.forEach((part, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "gdp-file-breadcrumb-sep";
      sep.textContent = "/";
      nav.append(sep);
    }
    const last = index === PARTS.length - 1;
    const crumb = document.createElement(last ? "span" : "button");
    crumb.className = last
      ? "gdp-file-breadcrumb-current"
      : "gdp-file-breadcrumb-part";
    crumb.textContent = part;
    Object.defineProperty(crumb, "scrollWidth", { value: 50 });
    crumb.addEventListener("click", () => pressed.push(part));
    nav.append(crumb);
  });
  Object.defineProperty(nav, "clientWidth", { value: 150 });
  document.body.append(nav);
  fitBreadcrumb(nav, PARTS.join("/"));
  const ellipsis = nav.querySelector<HTMLElement>(
    ".gdp-file-breadcrumb-ellipsis",
  );
  if (!ellipsis) throw new Error("the breadcrumb was not collapsed");
  return ellipsis;
}

function press(key: string) {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

describe("the breadcrumb ellipsis and the keyboard", () => {
  test("it is a focusable button named by the full path", () => {
    const ellipsis = collapsedBreadcrumb([]);
    expect([
      ellipsis.tabIndex,
      ellipsis.getAttribute("role"),
      ellipsis.getAttribute("aria-label"),
      ellipsis.getAttribute("aria-haspopup"),
    ]).toEqual([0, "button", PARTS.join("/"), "menu"]);
  });

  test.each([
    { open: "Enter", keys: ["Enter"], chosen: ["src"] },
    { open: " ", keys: ["ArrowDown", "Enter"], chosen: ["deep"] },
    { open: "Enter", keys: ["ArrowUp", "Enter"], chosen: ["deep"] },
  ])("$open opens the hidden levels; $keys chooses $chosen", ({
    open,
    keys,
    chosen,
  }) => {
    const pressed: string[] = [];
    const ellipsis = collapsedBreadcrumb(pressed);
    ellipsis.focus();
    press(open);
    const labels = [
      ...document.querySelectorAll(".gdp-context-menu button"),
    ].map((button) => button.textContent);
    for (const key of keys) press(key);
    expect([labels, pressed, isContextMenuOpen()]).toEqual([
      ["src", "deep"],
      chosen,
      false,
    ]);
  });

  test("Escape closes the menu and returns focus to the ellipsis", () => {
    const pressed: string[] = [];
    const ellipsis = collapsedBreadcrumb(pressed);
    ellipsis.focus();
    press("Enter");
    press("Escape");
    expect([isContextMenuOpen(), document.activeElement, pressed]).toEqual([
      false,
      ellipsis,
      [],
    ]);
  });
});
