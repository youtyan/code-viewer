import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

// 下パネルを「画面内 (docked)」にしたとき #content がスクロール容器になるのは、
// data-content-scrolls-when-docked を持つページだけ。ページクラスの列挙ではなく
// 属性で判定する (ui-layout.md「ページクラスの列挙をレイアウト規則に書かない」)。
// 作業ツリー画面が列挙から漏れて docked で差分がスクロールできなかった不具合の
// 検査。#history-resizer の表示条件 (data-history-list-panel) も同じ型で見る。
beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.body.className = "";
  document.body.removeAttribute("data-content-scrolls-when-docked");
  document.body.removeAttribute("data-history-list-panel");
});

function installDom(): void {
  const style = document.createElement("style");
  style.textContent = readFileSync("web/style.css", "utf8");
  document.head.appendChild(style);
  document.body.innerHTML = `
    <div id="content"><div id="diff"></div></div>
    <div id="history-resizer"></div>
  `;
}

function computed(id: string, property: "overflow" | "display"): string {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return getComputedStyle(el)[property];
}

describe("docked content scrolling", () => {
  test("docked page with the attribute: #content becomes the scroll container", () => {
    installDom();
    document.body.classList.add("app-panel-docked");
    document.body.toggleAttribute("data-content-scrolls-when-docked", true);
    expect(computed("content", "overflow")).toBe("auto");
  });

  test("docked page without the attribute: #content does not scroll", () => {
    installDom();
    document.body.classList.add("app-panel-docked");
    // happy-dom は未宣言のプロパティに "" を返す ("visible" ではない)。
    // not.toBe("auto") が空振りしないことは、上の成功系が同じプロパティで
    // "auto" を実際に観測できていることで保証される。
    expect(computed("content", "overflow")).not.toBe("auto");
  });

  test("attribute alone without docked: #content does not scroll", () => {
    installDom();
    document.body.toggleAttribute("data-content-scrolls-when-docked", true);
    expect(computed("content", "overflow")).not.toBe("auto");
  });
});

describe("history resizer visibility", () => {
  test("hidden on pages without the list panel attribute", () => {
    installDom();
    expect(computed("history-resizer", "display")).toBe("none");
  });

  test("shown on pages with the list panel attribute", () => {
    installDom();
    document.body.toggleAttribute("data-history-list-panel", true);
    expect(computed("history-resizer", "display")).toBe("block");
  });
});
