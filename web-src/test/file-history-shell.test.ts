import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import type { AppRoute, DiffRange } from "../core/routes";
import {
  type FileHistoryRoute,
  renderFileHistoryShell,
} from "../views/file-history-shell";

GlobalRegistrator.register();

const RANGE: DiffRange = { from: "HEAD", to: "worktree" };

beforeEach(() => {
  document.body.innerHTML = '<main id="diff"></main>';
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

function createDeps() {
  return {
    $: <T extends Element = HTMLElement>(sel: string): T => {
      const el = document.querySelector<T>(sel);
      if (!el) throw new Error(`missing ${sel}`);
      return el;
    },
    repoFileTargetFromRoute: () => null,
    renderRepoBlobSidebar: () => Promise.resolve(),
    placeSidebarToggle() {
      /* noop */
    },
    currentRange: () => RANGE,
    setRoute(_route: AppRoute) {
      /* noop */
    },
    createFileBreadcrumb(path: string) {
      const span = document.createElement("span");
      span.textContent = path;
      return span;
    },
    emptyText: () => ({
      noCommitSelectedTitle: "コミット未選択",
      noCommitSelectedBody: "一覧からコミットを選ぶと変更内容を表示します。",
    }),
  };
}

describe("file history shell", () => {
  test("renders injected empty pane copy", () => {
    const route: FileHistoryRoute = {
      screen: "file",
      path: "src/sample.ts",
      ref: "HEAD",
      view: "history",
      range: RANGE,
    };

    const mount = renderFileHistoryShell(createDeps(), route);

    expect(mount.emptyHost.classList.contains("gdp-file-history-empty")).toBe(
      true,
    );
    expect(mount.emptyHost.querySelector("h2")?.textContent).toBe(
      "コミット未選択",
    );
    expect(mount.emptyHost.querySelector("p")?.textContent).toBe(
      "一覧からコミットを選ぶと変更内容を表示します。",
    );
    expect(
      mount.emptyHost.querySelector(".empty-icon svg.octicon-git-branch"),
    ).toBeTruthy();
    expect(mount.emptyHost.querySelector(".emoji")).toBeNull();
    expect((mount.emptyHost.textContent || "").includes("✨")).toBe(false);
    expect(document.querySelector("#diff .gdp-standalone-file-history")).toBe(
      mount.emptyHost.closest(".gdp-standalone-file-history"),
    );
  });
});
