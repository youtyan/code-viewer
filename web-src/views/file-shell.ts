import type { AppRoute, DiffRange, SourceFileTarget } from "../core/routes";
import { isPreviewableSource } from "../core/source-meta";

export type RepositoryFileView = "blob" | "blame" | "history";
export type SourceBlobTab = "preview" | "code";
export type FileViewTab = SourceBlobTab | "blame" | "history";

export type RepositoryFileRoute = Extract<AppRoute, { screen: "file" }> & {
  view: "blob" | "blame";
};

export type FileShellMountDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  repoFileTargetFromRoute(): string | null;
  renderRepoBlobSidebar(path: string, ref: string): Promise<unknown> | unknown;
  placeSidebarToggle(): void;
};

export type FileViewTabDeps = {
  currentRange(): DiffRange;
  setRoute(route: AppRoute, replace?: boolean): void;
  setPreferredSourceTab?(tab: SourceBlobTab): void;
};

export function isRepositoryFileViewRoute(
  route: AppRoute,
): route is RepositoryFileRoute {
  return (
    route.screen === "file" && (route.view === "blob" || route.view === "blame")
  );
}

export function createFileViewTabButton(
  deps: FileViewTabDeps,
  target: SourceFileTarget,
  view: RepositoryFileView,
  label: string,
  active: boolean,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = active ? "active" : "";
  btn.dataset.fileView = view;
  btn.dataset.sourceTab = view === "blob" ? "code" : view;
  btn.textContent = label;
  btn.addEventListener("click", () => {
    if (active) return;
    if (view === "blob") deps.setPreferredSourceTab?.("code");
    deps.setRoute({
      screen: "file",
      path: target.path,
      ref: target.ref,
      view,
      range: deps.currentRange(),
    });
  });
  return btn;
}

function createBlobSourceTabButton(
  deps: FileViewTabDeps,
  target: SourceFileTarget,
  sourceTab: SourceBlobTab,
  active: boolean,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = active ? "active" : "";
  btn.dataset.fileView = "blob";
  btn.dataset.fileTab = sourceTab;
  btn.dataset.sourceTab = sourceTab;
  btn.textContent = sourceTab === "preview" ? "Preview" : "Code";
  btn.addEventListener("click", () => {
    if (active) return;
    deps.setPreferredSourceTab?.(sourceTab);
    deps.setRoute({
      screen: "file",
      path: target.path,
      ref: target.ref,
      view: "blob",
      ...(sourceTab === "preview" ? { preview: true as const } : {}),
      range: deps.currentRange(),
    });
  });
  return btn;
}

export function appendFileViewTabs(
  tabs: HTMLElement,
  deps: FileViewTabDeps,
  target: SourceFileTarget,
  activeTab: FileViewTab,
): void {
  if (isPreviewableSource(target.path)) {
    tabs.appendChild(
      createBlobSourceTabButton(
        deps,
        target,
        "preview",
        activeTab === "preview",
      ),
    );
  }
  tabs.appendChild(
    createBlobSourceTabButton(deps, target, "code", activeTab === "code"),
  );
  tabs.appendChild(
    createFileViewTabButton(
      deps,
      target,
      "blame",
      "Blame",
      activeTab === "blame",
    ),
  );
  tabs.appendChild(
    createFileViewTabButton(
      deps,
      target,
      "history",
      "History",
      activeTab === "history",
    ),
  );
}

export function createFileViewTabs(
  deps: FileViewTabDeps,
  target: SourceFileTarget,
  activeTab: FileViewTab,
): HTMLElement {
  const tabs = document.createElement("div");
  tabs.className = "gdp-source-tabs gdp-file-view-tabs";
  appendFileViewTabs(tabs, deps, target, activeTab);
  return tabs;
}

export function mountFileShellCard(
  deps: FileShellMountDeps,
  target: SourceFileTarget,
  card: HTMLElement,
  repoTarget = deps.repoFileTargetFromRoute(),
): void {
  const root = deps.$<HTMLElement>("#diff");
  if (repoTarget) {
    const layout = document.createElement("div");
    layout.className = "gdp-repo-blob-layout";
    layout.appendChild(card);
    root.prepend(layout);
    void Promise.resolve(deps.renderRepoBlobSidebar(target.path, repoTarget))
      .catch(() => {
        // renderRepoBlobSidebar owns its visible error state.
      })
      .finally(() => deps.placeSidebarToggle());
  } else {
    root.prepend(card);
  }
  deps.placeSidebarToggle();
}
