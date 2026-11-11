// データストアの詳細のタブ (views/database/detail-tabs.ts)。描き方を記録する view
// に差し替え、押したタブ・プログラムから選んだタブ・文言の差し替えで view に渡す
// 値と、中身の箱の出し分けを見る。

import "./_dom";
import { describe, expect, test } from "vitest";
import {
  createDetailTabs,
  DEFAULT_VIEW,
  type DetailTabsView,
} from "../views/database/detail-tabs";

describe("the detail tabs presenter", () => {
  test("selects a tab on click, shows only its body, and relabels", () => {
    const shown: Parameters<DetailTabsView>[0][] = [];
    const selected: string[] = [];
    const tabs = createDetailTabs(
      [
        { id: "mapping", label: "Mapping" },
        { id: "doc", label: "Document" },
      ],
      "mapping",
      (tab) => selected.push(tab),
      (props) => {
        shown.push(props);
        return DEFAULT_VIEW(props);
      },
    );
    const last = () => shown[shown.length - 1];
    expect(last()?.tabs.map((tab) => [tab.label, tab.active])).toEqual([
      ["Mapping", true],
      ["Document", false],
    ]);

    last()?.tabs[1]?.onClick();
    expect([
      selected,
      tabs.getActive(),
      tabs.bodies.mapping.hidden,
      tabs.bodies.doc.hidden,
      last()?.tabs.map((tab) => tab.active),
    ]).toEqual([["doc"], "doc", true, false, [false, true]]);

    // プログラムから選んだときは onSelect を呼ばない。
    tabs.setActive("mapping");
    tabs.setLabels({ mapping: "Fields", doc: "Source" });
    expect([
      selected,
      last()?.tabs.map((tab) => [tab.label, tab.active]),
    ]).toEqual([
      ["doc"],
      [
        ["Fields", true],
        ["Source", false],
      ],
    ]);
  });
});
