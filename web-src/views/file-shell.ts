import type { AppRoute, DiffRange, SourceFileTarget } from "../core/routes";

export type RepositoryFileView = "blob" | "blame" | "history";

export type RepositoryFileRoute = Extract<AppRoute, { screen: "file" }> & {
  view: RepositoryFileView;
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
};

export function isRepositoryFileViewRoute(
  route: AppRoute,
): route is RepositoryFileRoute {
  return (
    route.screen === "file" &&
    (route.view === "blob" ||
      route.view === "blame" ||
      route.view === "history")
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
