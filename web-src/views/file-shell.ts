import { COPY_16_PATHS, iconSvg } from "../core/icons";
import type { AppRoute, DiffRange, SourceFileTarget } from "../core/routes";
import { isPreviewableSource, sourceDisplayKind } from "../core/source-meta";

export type FileShellView = "blob" | "blame" | "history";
export type SourceBlobTab = "preview" | "code";
export type FileViewTab = SourceBlobTab | "blame" | "history";

export type BlobOrBlameFileRoute = Extract<AppRoute, { screen: "file" }> & {
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

export type FileShellStickyDeps = FileViewTabDeps & {
  createFileBreadcrumb(path: string, ref?: string): HTMLElement;
};

export type FileViewTabsOptions = {
  includeFileTabs?: boolean;
  previewable?: boolean;
  sourceTabClick?: "route" | "manual";
  sourceCopyButton?: HTMLElement;
};

export type FileViewTabButtons = {
  codeButton: HTMLButtonElement | null;
  previewButton: HTMLButtonElement | null;
};

// Media files (image / video / audio / pdf) render as an embedded preview -
// there is no text pane behind them, so a "Code" tab would be a lie (and
// clicking it used to look like the app trying to render binary as code).
// They get a single "Preview" tab instead.
export function isMediaPreviewOnlySource(path: string): boolean {
  const kind = sourceDisplayKind(path);
  return (
    kind === "image" || kind === "video" || kind === "audio" || kind === "pdf"
  );
}

export function isBlobOrBlameFileRoute(
  route: AppRoute,
): route is BlobOrBlameFileRoute {
  return (
    route.screen === "file" && (route.view === "blob" || route.view === "blame")
  );
}

export function createFileViewTabButton(
  deps: FileViewTabDeps,
  target: SourceFileTarget,
  view: FileShellView,
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
  options: FileViewTabsOptions = {},
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
    if (options.sourceTabClick === "manual") return;
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
  options: FileViewTabsOptions = {},
): FileViewTabButtons {
  const includeFileTabs = options.includeFileTabs !== false;
  // An explicit `previewable` option pins the classic Code/Preview pair
  // (text renderers and internal paths); only the default path applies the
  // media-only rule.
  const mediaOnly =
    options.previewable === undefined && isMediaPreviewOnlySource(target.path);
  const showPreview =
    mediaOnly ||
    (options.previewable ??
      (isPreviewableSource(target.path) || activeTab === "preview"));
  let previewButton: HTMLButtonElement | null = null;
  if (showPreview) {
    previewButton = createBlobSourceTabButton(
      deps,
      target,
      "preview",
      activeTab === "preview" || (mediaOnly && activeTab === "code"),
      options,
    );
    tabs.appendChild(previewButton);
  }
  let codeButton: HTMLButtonElement | null = null;
  if (!mediaOnly) {
    codeButton = createBlobSourceTabButton(
      deps,
      target,
      "code",
      activeTab === "code",
      options,
    );
    tabs.appendChild(codeButton);
  }
  if (includeFileTabs) {
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
  if (options.sourceCopyButton) tabs.appendChild(options.sourceCopyButton);
  return { codeButton, previewButton };
}

export function createFileViewTabs(
  deps: FileViewTabDeps,
  target: SourceFileTarget,
  activeTab: FileViewTab,
  options: FileViewTabsOptions = {},
): HTMLElement {
  const tabs = document.createElement("div");
  tabs.className = "gdp-source-tabs gdp-file-view-tabs";
  appendFileViewTabs(tabs, deps, target, activeTab, options);
  return tabs;
}

function createFilePathCopyButton(target: SourceFileTarget): HTMLButtonElement {
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "gdp-file-header-icon gdp-copy-path";
  copy.title = "copy file path";
  copy.setAttribute("aria-label", "copy file path");
  copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
  copy.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(target.path);
      copy.classList.add("copied");
      setTimeout(() => copy.classList.remove("copied"), 1200);
    } catch {
      copy.classList.add("failed");
      setTimeout(() => copy.classList.remove("failed"), 1200);
    }
  });
  return copy;
}

export function createFileShellSticky(
  deps: FileShellStickyDeps,
  target: SourceFileTarget,
  activeTab: FileViewTab,
  options: FileViewTabsOptions = {},
): {
  sticky: HTMLElement;
  header: HTMLElement;
  tabsHost: HTMLElement;
} {
  const sticky = document.createElement("div");
  sticky.className = "gdp-file-detail-sticky";
  const header = document.createElement("div");
  header.className = "gdp-file-detail-header";
  const name = document.createElement("div");
  name.className = "gdp-file-detail-path";
  name.appendChild(deps.createFileBreadcrumb(target.path, target.ref));
  name.appendChild(createFilePathCopyButton(target));
  header.appendChild(name);
  sticky.appendChild(header);
  const tabsHost = document.createElement("div");
  tabsHost.className = "gdp-file-detail-tabs";
  tabsHost.appendChild(createFileViewTabs(deps, target, activeTab, options));
  sticky.appendChild(tabsHost);
  return { sticky, header, tabsHost };
}

export function mountFileShellCard(
  deps: FileShellMountDeps,
  target: SourceFileTarget,
  card: HTMLElement,
  repoTarget = deps.repoFileTargetFromRoute(),
  options: { loadSidebar?: boolean } = {},
): void {
  const root = deps.$<HTMLElement>("#diff");
  if (repoTarget) {
    const layout = document.createElement("div");
    layout.className = "gdp-repo-blob-layout";
    layout.appendChild(card);
    root.prepend(layout);
    if (options.loadSidebar !== false) {
      void Promise.resolve(deps.renderRepoBlobSidebar(target.path, repoTarget))
        .catch((error) => {
          console.error(
            "[code-viewer] failed to load repository sidebar",
            error,
          );
          // renderRepoBlobSidebar owns its visible error state.
        })
        .finally(() => deps.placeSidebarToggle());
    }
  } else {
    root.prepend(card);
  }
  deps.placeSidebarToggle();
}
