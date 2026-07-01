import { describe, expect, test } from "bun:test";
import type { DiffMeta, FileMeta, SidebarItem } from "../core/types";
import { showEmptyHistoryDiffPane } from "../views/empty-diff-pane";

function textElement(text = "") {
  return { textContent: text };
}

function emptyElement() {
  const h2 = textElement("Previous heading");
  const p = textElement("Previous text");
  const removedClasses: string[] = [];
  return {
    el: {
      classList: {
        remove(name: string) {
          removedClasses.push(name);
        },
      },
      querySelector(selector: string) {
        if (selector === "h2") return h2;
        if (selector === "p") return p;
        return null;
      },
    } as unknown as HTMLElement,
    h2,
    p,
    removedClasses,
  };
}

describe("history empty diff pane", () => {
  test("clears stale diff sidebar, metadata, and repo sidebar cache", () => {
    const diff = { innerHTML: "<section>stale diff</section>" };
    const empty = emptyElement();
    let files: FileMeta[] = [{ path: "stale.ts", load_url: "/stale" }];
    let lastMeta: DiffMeta | null = {
      files,
      totals: { files: 1, additions: 1, deletions: 0 },
    };
    const sidebarRenders: SidebarItem[][] = [];
    const metaRenders: Array<DiffMeta | null> = [];
    let repoInvalidated = 0;
    let loadQueueCleared = 0;
    let togglePlaced = 0;
    const statuses: string[] = [];

    showEmptyHistoryDiffPane({
      diff: diff as HTMLElement,
      empty: empty.el,
      renderSidebar(nextFiles) {
        sidebarRenders.push(nextFiles);
      },
      setFiles(nextFiles) {
        files = nextFiles;
      },
      clearLastMeta() {
        lastMeta = null;
      },
      renderMeta(meta) {
        metaRenders.push(meta);
      },
      invalidateRepoSidebar() {
        repoInvalidated++;
      },
      clearLoadQueue() {
        loadQueueCleared++;
      },
      placeSidebarToggle() {
        togglePlaced++;
      },
      setStatus(status) {
        statuses.push(status);
      },
      emptyText: () => ({
        noCommitSelectedTitle: "No commit selected",
        noCommitSelectedBody:
          "Select a commit from the list to see its changes.",
      }),
    });

    expect(diff.innerHTML).toBe("");
    expect(sidebarRenders).toEqual([[]]);
    expect(files).toEqual([]);
    expect(lastMeta).toBeNull();
    expect(metaRenders).toEqual([null]);
    expect(repoInvalidated).toBe(1);
    expect(loadQueueCleared).toBe(1);
    expect(togglePlaced).toBe(1);
    expect(empty.removedClasses).toEqual(["hidden"]);
    expect(empty.h2.textContent).toBe("No commit selected");
    expect(empty.p.textContent).toBe(
      "Select a commit from the list to see its changes.",
    );
    expect(statuses).toEqual(["live"]);
  });

  test("uses injected copy for the empty history pane", () => {
    const empty = emptyElement();

    showEmptyHistoryDiffPane({
      diff: null,
      empty: empty.el,
      renderSidebar() {
        /* noop */
      },
      setFiles() {
        /* noop */
      },
      clearLastMeta() {
        /* noop */
      },
      renderMeta() {
        /* noop */
      },
      invalidateRepoSidebar() {
        /* noop */
      },
      clearLoadQueue() {
        /* noop */
      },
      placeSidebarToggle() {
        /* noop */
      },
      setStatus() {
        /* noop */
      },
      emptyText: () => ({
        noCommitSelectedTitle: "コミット未選択",
        noCommitSelectedBody: "一覧からコミットを選ぶと変更内容を表示します。",
      }),
    });

    expect(empty.h2.textContent).toBe("コミット未選択");
    expect(empty.p.textContent).toBe(
      "一覧からコミットを選ぶと変更内容を表示します。",
    );
  });
});
