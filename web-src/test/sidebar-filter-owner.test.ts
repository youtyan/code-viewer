// サイドバーの絞り込みは #filelist と #diff の両方を面倒見るが、#filelist を
// 自分で組み立てる画面 (worktree) では行の出し入れと件数はその view のものになる。
//
// 印は #filelist の data-filter-owner="view"。これを見落とすと、既に view 側で
// 絞り込まれた後の行だけを数えて「1 / 1」と出す (母数が消える) 事故が起きる。
// 差分カード (.gdp-file-shell) の出し入れは印に関係なく共通のまま。

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

/** view が組み立てた後の #filelist と、本文に積まれた差分カードを再現する。 */
function installList(paths: string[], shells: string[]): void {
  const list = document.getElementById("filelist");
  if (!list) throw new Error("the file list is missing");
  list.innerHTML = paths
    .map((path) => `<li class="tree-file" data-path="${path}"></li>`)
    .join("");
  const diff = document.createElement("section");
  diff.id = "diff";
  diff.innerHTML = shells
    .map((path) => `<div class="gdp-file-shell" data-path="${path}"></div>`)
    .join("");
  document.body.appendChild(diff);
}

describe("sidebar filter ownership", () => {
  test.each([
    {
      name: "the list belongs to the shared sidebar",
      owner: "",
      expectedTotals: "1 / 2",
      expectedHidden: ["src/b.ts"],
    },
    {
      name: "the list belongs to the view that drew it",
      owner: "view",
      expectedTotals: "2 changed files",
      expectedHidden: [] as string[],
    },
  ])("leaves the count and the rows alone when $name", ({
    owner,
    expectedTotals,
    expectedHidden,
  }) => {
    installSidebarDom();
    const sidebar = createSidebarForTest();
    installList(["src/a.ts", "src/b.ts"], ["src/a.ts", "src/b.ts"]);
    const list = document.getElementById("filelist");
    const totals = document.getElementById("totals");
    if (!list || !totals) throw new Error("the sidebar header is missing");
    if (owner) list.dataset.filterOwner = owner;
    totals.textContent = "2 changed files";

    const input = document.querySelector<HTMLInputElement>("#sb-filter");
    if (!input) throw new Error("the filter is missing");
    input.value = "src/a";
    sidebar.applyFilter();

    expect(totals.textContent).toBe(expectedTotals);
    expect(
      Array.from(list.querySelectorAll<HTMLElement>("li[data-path]"))
        .filter((li) => li.classList.contains("hidden"))
        .map((li) => li.dataset.path),
    ).toEqual(expectedHidden);
  });

  test.each([
    { name: "the shared sidebar owns the list", owner: "" },
    { name: "the view owns the list", owner: "view" },
  ])("still hides the diff cards that do not match when $name", ({ owner }) => {
    installSidebarDom();
    const sidebar = createSidebarForTest();
    installList(["src/a.ts", "src/b.ts"], ["src/a.ts", "src/b.ts"]);
    const list = document.getElementById("filelist");
    if (!list) throw new Error("the file list is missing");
    if (owner) list.dataset.filterOwner = owner;

    const input = document.querySelector<HTMLInputElement>("#sb-filter");
    if (!input) throw new Error("the filter is missing");
    input.value = "src/a";
    sidebar.applyFilter();

    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>("#diff .gdp-file-shell"),
      )
        .filter((card) => card.classList.contains("hidden-by-filter"))
        .map((card) => card.dataset.path),
    ).toEqual(["src/b.ts"]);
  });
});
