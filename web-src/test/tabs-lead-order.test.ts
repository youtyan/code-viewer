// タブ列の左端の名前の枠 (#tabs-lead) と、キーボードで移る順 (DOM の並び)。
//
// 名前の枠は幅 --tabs-lead-w で、画面・2 面・左のサイドバーの開閉で名前の
// 位置を変えない。左のサイドバーを畳んだときだけ出る「サイドバーを出す」は
// 枠の外に置く (枠の中に置くと、名前が 28px 右へずれて縮んだ)。いまは最上段の
// 左端 = 一覧の列の頭 (#panel-head) の先頭。
//
// Tab で移る順は見た目の順 (DOM の並び): 左のサイドバー → 一覧の列の頭 →
// タブ列 → ファイル一覧 → 一覧 → 変更ファイルの一覧 → 本文 → 最下段。

import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

GlobalRegistrator.register();

afterAll(() => {
  GlobalRegistrator.unregister();
});

const page = new DOMParser().parseFromString(
  readFileSync("web/index.html", "utf8"),
  "text/html",
);

function byId(id: string): HTMLElement {
  const element = page.getElementById(id);
  if (!element) throw new Error(`#${id} is missing from index.html`);
  return element;
}

describe("the name box at the left end of the tab row", () => {
  test("the project name is inside the name box", () => {
    const box = byId("project-switcher").closest(".tabs-lead-name");
    expect(box?.parentElement?.id).toBe("tabs-lead");
  });

  test("the show-sidebar button is outside the name box, first in the column head", () => {
    const expand = byId("nav-expand");
    expect(expand.closest(".tabs-lead-name")).toBeNull();
    expect(expand.parentElement?.id).toBe("panel-head");
    expect(expand.nextElementSibling).toBe(byId("view-head"));
  });

  test("the name box keeps the fixed width and the button does not take from it", () => {
    const rules = baseRules(loadStyleSheet());
    // 変数は :root と html, body に分かれている。body の値が html の値を継ぐ。
    const vars = new Map([
      ...cascadedDeclarations(rules, (s) => s === ":root" || s === "html"),
      ...cascadedDeclarations(rules, (s) => s === "body"),
    ]);
    const width = resolveVar("var(--tabs-lead-w)", vars);
    expect(width).not.toBe("");
    const box = cascadedDeclarations(rules, (s) => s === ".tabs-lead-name");
    expect(resolveVar(box.get("width") ?? "", vars)).toBe(width);
    expect(resolveVar(box.get("flex") ?? "", vars)).toBe(`0 0 ${width}`);
    // 外側の #tabs-lead は幅を持たない (名前の枠の幅だけ)
    const lead = cascadedDeclarations(rules, (s) => s === ".tabs-lead");
    expect(lead.get("width")).toBeUndefined();
    expect(lead.get("flex")).toBe("none");
    const expand = cascadedDeclarations(
      rules,
      (s) => s === "#panel-head > #nav-expand",
    );
    expect(expand.get("flex")).toBe("none");
  });
});

describe("keyboard order follows the DOM order", () => {
  // ファイル一覧 → 一覧 (History・作業ツリー) → 変更ファイルの一覧 (#sidebar) →
  // 本文。Diff の一覧は #sidebar そのもの。
  const order = [
    "app-nav",
    "panel-head",
    "tabs-lead",
    "main-tabs",
    "file-list",
    "history-panel",
    "worktree-panel",
    "sidebar",
    "content",
    "statusbar",
  ];

  test(order.join(" → "), () => {
    const elements = order.map(byId);
    for (let index = 1; index < elements.length; index += 1) {
      const before = elements[index - 1];
      const after = elements[index];
      expect(
        before.compareDocumentPosition(after) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        `${order[index - 1]} before ${order[index]}`,
      ).toBeTruthy();
      expect(
        before.contains(after),
        `${order[index - 1]} holds ${order[index]}`,
      ).toBe(false);
    }
  });
});
