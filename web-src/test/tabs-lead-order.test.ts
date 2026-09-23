// いま見ているプロジェクトの名前は一覧の列の頭 (#panel-head) の 1 段目
// (#project-head) にあり、タブ列の左端 (#tabs-lead) には名前の枠を置かない
// (タブ列はその分だけ左から始まる)。左のサイドバーを畳んだときだけ出る
// 「サイドバーを出す」は 1 段目の先頭。
//
// Tab で移る順は見た目の順 (DOM の並び): 左のサイドバー → 一覧の列の頭 (1 段目の
// サイドバーを出す・名前 → 2 段目の絵柄・畳む) → タブ列 → ファイル一覧 → 一覧 →
// 変更ファイルの一覧 → 本文 → 最下段。

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

describe("the project name lives in the first row of the column head", () => {
  test("the name, its mark and the branch are in the first row; the view strip is in the second", () => {
    const head = byId("panel-head");
    const rows = [...head.children].map((row) => row.id);
    expect(rows).toEqual(["project-head", "view-head"]);
    expect(
      [
        "project-switcher",
        "project-title",
        "project-mark",
        "project-branch",
      ].map((id) => byId(id).closest(".project-head")?.id),
    ).toEqual(["project-head", "project-head", "project-head", "project-head"]);
    // 名前と ▾ だけが切替のボタン (ブランチは押せない)。
    expect(byId("project-branch").closest("button")).toBeNull();
    expect(byId("project-title").parentElement?.id).toBe("project-switcher");
  });

  test("the tab row lead holds no name box", () => {
    const lead = byId("tabs-lead");
    expect(lead.children.length).toBe(0);
    expect(page.querySelector(".tabs-lead-name")).toBeNull();
  });

  test("the show-sidebar button comes first in the first row", () => {
    const expand = byId("nav-expand");
    expect(expand.parentElement?.id).toBe("project-head");
    expect(expand.nextElementSibling).toBe(byId("project-switcher"));
    const rules = baseRules(loadStyleSheet());
    expect(
      cascadedDeclarations(
        rules,
        (s) => s === "#project-head > #nav-expand",
      ).get("flex"),
    ).toBe("none");
  });

  test("the tab row lead takes no width on the desktop", () => {
    const rules = baseRules(loadStyleSheet());
    const lead = cascadedDeclarations(rules, (s) => s === ".tabs-lead");
    expect({
      width: lead.get("width"),
      flex: lead.get("flex"),
      padding: lead.get("padding"),
    }).toEqual({ width: undefined, flex: "none", padding: undefined });
    // 名前の枠の幅の変数はデスクトップには無い。
    const vars = new Map([
      ...cascadedDeclarations(rules, (s) => s === ":root" || s === "html"),
      ...cascadedDeclarations(rules, (s) => s === "body"),
    ]);
    expect(vars.has("--tabs-lead-w")).toBe(false);
    expect(() => resolveVar("var(--tabs-lead-w)", vars)).toThrow(
      "Unresolved CSS variable --tabs-lead-w",
    );
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
