// 設定とヘルプのページの枠 (views/page-shell.ts) の presenter。表示を記録する view
// に差し替え、目次の開閉と、節を選んだときに目次を畳むことを見る。

import "./_dom";
import { afterEach, describe, expect, test } from "vitest";
import {
  createPageShell,
  DEFAULT_VIEW,
  type PageShellProps,
} from "../views/page-shell";

afterEach(() => {
  document.body.replaceChildren();
});

describe("the page shell presenter", () => {
  test("opens the contents with the toggle and folds it again when a section is picked", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const shown: PageShellProps[] = [];
    const picked: string[] = [];
    const shell = createPageShell((props) => {
      shown.push(props);
      return DEFAULT_VIEW(props);
    });
    shell.render(target, {
      page: "help",
      lang: "en",
      title: "Help",
      nav: [
        {
          kind: "item",
          label: "One",
          active: true,
          onSelect: () => picked.push("one"),
        },
        {
          kind: "item",
          label: "Two",
          active: false,
          onSelect: () => picked.push("two"),
        },
      ],
      article: document.createElement("article"),
      toggleText: "Contents",
      openedSection: false,
    });
    const last = () => shown[shown.length - 1];
    expect([last()?.toggle.open, last()?.toggle.current]).toEqual([
      false,
      "One",
    ]);
    last()?.toggle.onToggle();
    expect(last()?.toggle.open).toBe(true);
    const two = last()?.nav[1];
    if (two?.kind !== "item") throw new Error("no second item");
    two.onSelect();
    expect(picked).toEqual(["two"]);
    shell.render(target, {
      page: "help",
      lang: "en",
      title: "Help",
      nav: [],
      article: document.createElement("article"),
      toggleText: "Contents",
      openedSection: false,
    });
    expect(last()?.toggle.open).toBe(false);
  });
});
