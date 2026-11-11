import { html, nothing, type TemplateResult } from "lit/html.js";
import { showCopyFailure } from "../core/copy-failure";
import { filePathClipboardText } from "../core/file-path-copy";
import { COPY_16_PATHS } from "../core/icons";
import type { AppRoute, DiffRange, SourceFileTarget } from "../core/routes";
import { isPreviewableSource, sourceDisplayKind } from "../core/source-meta";
import { pageLanguage } from "./page-language";
import { SOURCE_READING_TEXT } from "./source-preview-i18n";
import { iconTemplate } from "./ui/icon";
import { templateElement } from "./ui/renderer";

export type FileShellView = "blob" | "blame" | "history";
export type SourceBlobTab = "preview" | "code";
export type FileViewTab = SourceBlobTab | "blame" | "history";

export type BlobOrBlameFileRoute = Extract<AppRoute, { screen: "file" }> & {
  view: "blob" | "blame";
};

export type FileShellMountDeps = {
  /** カードを差し込む先 (本文なら #diff、右の面ならその面の箱の本体)。 */
  mountRoot(): HTMLElement;
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
  createRepositoryWebLink?(target: SourceFileTarget): HTMLAnchorElement | null;
  // "Older / newer revision" stepper for the file; null when not applicable
  // (the History tab has its own commit list).
  createRevisionNav?(
    target: SourceFileTarget,
    activeTab: FileViewTab,
  ): HTMLElement | null;
};

export type FileViewTabsOptions = {
  includeFileTabs?: boolean;
  previewable?: boolean;
  sourceTabClick?: "route" | "manual";
  /** タブの右に置くコピーのボタン (要素かテンプレート)。 */
  sourceCopyButton?: unknown;
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

// ツリー / サイドバーから別ファイルへ移るとき、いま開いているタブ
// (Preview / Code / Blame / History) を引き継いだ file route を作る。
// Preview はプレビューできないファイルでは成立しないので Code に落とす。
// line / commit はファイル固有の状態なので引き継がない。
export function fileRouteKeepingActiveView(
  currentRoute: AppRoute,
  target: SourceFileTarget,
  range: DiffRange,
): Extract<AppRoute, { screen: "file" }> {
  const base = {
    screen: "file" as const,
    path: target.path,
    ref: target.ref,
    range,
  };
  if (currentRoute.screen !== "file") return { ...base, view: "blob" };
  if (currentRoute.view === "blame" || currentRoute.view === "history")
    return { ...base, view: currentRoute.view };
  const keepPreview =
    currentRoute.view === "blob" &&
    !!currentRoute.preview &&
    (isPreviewableSource(target.path) || isMediaPreviewOnlySource(target.path));
  return {
    ...base,
    view: "blob",
    ...(keepPreview ? { preview: true as const } : {}),
  };
}

/** Blame / History のタブ。押すとそのファイルのその画面へ移る。 */
function fileViewTabTemplate(
  deps: FileViewTabDeps,
  target: SourceFileTarget,
  view: FileShellView,
  label: string,
  active: boolean,
): TemplateResult {
  return html`<button
    type="button"
    class=${active ? "active" : ""}
    data-file-view=${view}
    data-source-tab=${view === "blob" ? "code" : view}
    @click=${() => {
      if (active) return;
      if (view === "blob") deps.setPreferredSourceTab?.("code");
      deps.setRoute({
        screen: "file",
        path: target.path,
        ref: target.ref,
        view,
        range: deps.currentRange(),
      });
    }}
  >${label}</button>`;
}

/** Preview / Code のタブ。 */
function blobSourceTabTemplate(
  deps: FileViewTabDeps,
  target: SourceFileTarget,
  sourceTab: SourceBlobTab,
  active: boolean,
  options: FileViewTabsOptions = {},
): TemplateResult {
  const text = SOURCE_READING_TEXT[pageLanguage()];
  return html`<button
    type="button"
    class=${active ? "active" : ""}
    data-file-view="blob"
    data-file-tab=${sourceTab}
    data-source-tab=${sourceTab}
    @click=${() => {
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
    }}
  >${sourceTab === "preview" ? text.tabPreview : text.tabCode}</button>`;
}

/** ファイルのタブの並び (Preview・Code・Blame・History と、あればコピー)。 */
export function fileViewTabsTemplate(
  deps: FileViewTabDeps,
  target: SourceFileTarget,
  activeTab: FileViewTab,
  options: FileViewTabsOptions = {},
): TemplateResult {
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
  const text = SOURCE_READING_TEXT[pageLanguage()];
  return html`${
    showPreview
      ? blobSourceTabTemplate(
          deps,
          target,
          "preview",
          activeTab === "preview" || (mediaOnly && activeTab === "code"),
          options,
        )
      : nothing
  }${
    mediaOnly
      ? nothing
      : blobSourceTabTemplate(
          deps,
          target,
          "code",
          activeTab === "code",
          options,
        )
  }${
    includeFileTabs
      ? html`${fileViewTabTemplate(
          deps,
          target,
          "blame",
          text.tabBlame,
          activeTab === "blame",
        )}${fileViewTabTemplate(
          deps,
          target,
          "history",
          text.tabHistory,
          activeTab === "history",
        )}`
      : nothing
  }${options.sourceCopyButton ?? nothing}`;
}

function filePathCopyTemplate(target: SourceFileTarget): TemplateResult {
  const label = SOURCE_READING_TEXT[pageLanguage()].copyFilePath;
  return html`<button
    type="button"
    class="gdp-file-header-icon gdp-copy-path"
    title=${label}
    aria-label=${label}
    @click=${async (event: MouseEvent) => {
      event.stopPropagation();
      const copy = event.currentTarget as HTMLButtonElement;
      try {
        await navigator.clipboard.writeText(filePathClipboardText(target.path));
        // 写せた印は少しの間だけ (ボタンの色だけを替える)。
        copy.classList.add("copied");
        setTimeout(() => copy.classList.remove("copied"), 1200);
      } catch (error) {
        showCopyFailure(
          copy,
          "copying the file path failed",
          error,
          "copy file path",
          1200,
        );
      }
    }}
  >${iconTemplate(COPY_16_PATHS, "octicon-copy")}</button>`;
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
  const sticky = templateElement(
    html`<div class="gdp-file-detail-sticky"><div class="gdp-file-detail-header"><div
          class="gdp-file-detail-path"
        >${deps.createFileBreadcrumb(target.path, target.ref)}${filePathCopyTemplate(
          target,
        )}</div>${deps.createRepositoryWebLink?.(target) ?? nothing}${
          deps.createRevisionNav?.(target, activeTab) ?? nothing
        }</div><div class="gdp-file-detail-tabs"><div
          class="gdp-source-tabs gdp-file-view-tabs"
        >${fileViewTabsTemplate(deps, target, activeTab, options)}</div></div></div>`,
  );
  const header = sticky.querySelector<HTMLElement>(".gdp-file-detail-header");
  const tabsHost = sticky.querySelector<HTMLElement>(".gdp-file-detail-tabs");
  if (!header || !tabsHost)
    throw new Error("file shell: the sticky header was not drawn");
  return { sticky, header, tabsHost };
}

export function mountFileShellCard(
  deps: FileShellMountDeps,
  target: SourceFileTarget,
  card: HTMLElement,
  repoTarget = deps.repoFileTargetFromRoute(),
  options: { loadSidebar?: boolean } = {},
): void {
  const root = deps.mountRoot();
  if (repoTarget) {
    root.prepend(
      templateElement(html`<div class="gdp-repo-blob-layout">${card}</div>`),
    );
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
