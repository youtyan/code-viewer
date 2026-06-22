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
  setStatus(status: "live"): void;
};

export function showEmptyHistoryDiffPane(deps: EmptyDiffPaneDeps) {
  if (deps.diff) deps.diff.innerHTML = "";
  deps.renderSidebar([], undefined);
  deps.setFiles([]);
  deps.clearLastMeta();
  deps.renderMeta(null);
  deps.invalidateRepoSidebar();
  deps.clearLoadQueue();
  if (deps.empty) {
    deps.empty.classList.remove("hidden");
    const h2 = deps.empty.querySelector("h2");
    if (h2) h2.textContent = "No commit selected";
    const p = deps.empty.querySelector("p");
    if (p) p.textContent = "Select a commit from the list to see its changes.";
  }
  deps.setStatus("live");
}
