// 左のファイル一覧と変更ファイルの一覧 (views/sidebar.ts) の view。描き方を記録する
// view に差し替え、木の行に presenter が渡す値と、押したときの呼び出しを見る。

import "./_dom";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_VIEW, type SidebarView } from "../views/sidebar-view";
import { createSidebarForTest, installSidebarDom } from "./_sidebar-fixture";

afterEach(() => {
  document.body.replaceChildren();
});

describe("the sidebar view", () => {
  test("passes each tree row's values to the view", () => {
    installSidebarDom();
    const dirs: Parameters<SidebarView["dirRow"]>[0][] = [];
    const files: Parameters<SidebarView["fileRow"]>[0][] = [];
    const opened: [string, string, HTMLButtonElement][] = [];
    const sidebar = createSidebarForTest({
      view: {
        ...DEFAULT_VIEW,
        dirRow: (props) => {
          dirs.push(props);
          return DEFAULT_VIEW.dirRow(props);
        },
        fileRow: (props) => {
          files.push(props);
          return DEFAULT_VIEW.fileRow(props);
        },
      },
      openPathFromButton: (path, kind, button) =>
        opened.push([path, kind, button]),
    });
    sidebar.renderSidebar(
      [
        { path: "src/sample.ts", type: "blob", status: "M" },
        { path: "src/other.ts", type: "blob" },
      ],
      () => undefined,
    );

    // 一覧は描いた後にもう一度描き直すことがあるので、最後に描いた行を見る。
    expect(
      dirs
        .slice(-1)
        .map((dir) => [dir.path, dir.collapsed, dir.openPath.rowAction]),
    ).toEqual([["src", false, true]]);
    expect(
      files
        .slice(-2)
        .map((file) => [
          file.path,
          file.badge?.status ?? null,
          file.icon,
          file.link.text,
        ]),
    ).toEqual([
      ["src/sample.ts", "M", "file", "sample.ts"],
      ["src/other.ts", null, "file", "other.ts"],
    ]);

    const button = document.querySelector<HTMLButtonElement>(
      'li[data-dirpath="src"] .gdp-open-path',
    );
    button?.click();
    expect(opened).toEqual([["src", "directory", button]]);
  });

  test("titles the status badge from the injected titles", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();
    sidebar.renderSidebar([{ path: "sample.ts", type: "blob", status: "A" }]);
    const badge = document.querySelector('li[data-path="sample.ts"] .badge');
    expect([
      badge?.className,
      badge?.textContent,
      badge?.getAttribute("title"),
    ]).toEqual(["badge A", "A", "added"]);
  });
});
