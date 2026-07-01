import type { DiffMeta, FileMeta, SidebarItem } from "../core/types";

export type EmptyDiffPaneDeps = {
  diff: HTMLElement | null;
  empty: HTMLElement | null;
  renderSidebar(files: SidebarItem[], onFileClick?: unknown): void;
  setFiles(files: FileMeta[]): void;
  clearLastMeta(): void;
  renderMeta(meta: DiffMeta | null): void;
  invalidateRepoSidebar(): void;
  clearLoadQueue(): void;
  placeSidebarToggle(): void;
  setStatus(status: "live"): void;
  emptyText(): EmptyDiffPaneText;
};

export type EmptyDiffPaneText = {
  noCommitSelectedTitle: string;
  noCommitSelectedBody: string;
};

export function showEmptyHistoryDiffPane(deps: EmptyDiffPaneDeps) {
  if (deps.diff) deps.diff.innerHTML = "";
  deps.placeSidebarToggle();
  deps.renderSidebar([], undefined);
  deps.setFiles([]);
  deps.clearLastMeta();
  deps.renderMeta(null);
  deps.invalidateRepoSidebar();
  deps.clearLoadQueue();
  if (deps.empty) {
    deps.empty.classList.remove("hidden");
    deps.empty.classList.remove("empty-with-actions");
    const text = deps.emptyText();
    const h2 = deps.empty.querySelector("h2");
    if (h2) h2.textContent = text.noCommitSelectedTitle;
    const p = deps.empty.querySelector("p");
    if (p) p.textContent = text.noCommitSelectedBody;
    const actions = deps.empty.querySelector<HTMLElement>(".empty-actions");
    if (actions) actions.hidden = true;
  }
  deps.setStatus("live");
}
