import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

// #history-resizer (左の一覧パネルの幅の掴み) を出すのは、一覧パネルを持つページ
// (data-history-list-panel) だけ。ページクラスの列挙ではなく属性で判定する
// (ui-layout.md「ページクラスの列挙をレイアウト規則に書かない」)。
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
