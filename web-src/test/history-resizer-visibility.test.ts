import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

// #history-resizer (本文の左の一覧の列の幅の掴み) を出すのは、一覧の列を出して
// いる間 (data-list-column があり、data-list-column-hidden が無い) だけ。ページ
// クラスの列挙ではなく属性で判定する (ui-layout.md「ページクラスの列挙を
// レイアウト規則に書かない」)。
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
  document.body.removeAttribute("data-list-column");
  document.body.removeAttribute("data-list-column-hidden");
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

  test.each([
    "sidebar",
    "history",
    "worktree",
  ])("shown while the list column shows the %s list", (list) => {
    installDom();
    document.body.dataset.listColumn = list;
    expect(computed("history-resizer", "display")).toBe("block");
  });

  test("hidden while the list column is hidden", () => {
    installDom();
    document.body.dataset.listColumn = "history";
    document.body.toggleAttribute("data-list-column-hidden", true);
    expect(computed("history-resizer", "display")).toBe("none");
  });
});
