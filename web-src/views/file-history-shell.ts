import { html } from "lit/html.js";
import { GIT_BRANCH_16_PATH } from "../core/icons";
import type { AppRoute, SourceFileTarget } from "../core/routes";
import type { EmptyDiffPaneText } from "./empty-diff-pane";
import {
  createFileShellSticky,
  type FileShellMountDeps,
  type FileShellStickyDeps,
  mountFileShellCard,
} from "./file-shell";
import {
  buildHistoryCommitInfoDom,
  buildHistoryPanelDom,
  type HistoryViewMount,
} from "./history-view";
import { iconTemplate } from "./ui/icon";
import { templateElement } from "./ui/renderer";

export type FileHistoryRoute = Extract<AppRoute, { screen: "file" }> & {
  view: "history";
};

export type FileHistoryShellDeps = FileShellMountDeps &
  FileShellStickyDeps & {
    emptyText(): EmptyDiffPaneText;
  };

export type FileHistoryShellMount = HistoryViewMount & {
  diffHost: HTMLElement;
  emptyHost: HTMLElement;
};

export function removeFileHistoryShell(): void {
  document.querySelectorAll(".gdp-standalone-file-history").forEach((el) => {
    (el.closest(".gdp-repo-blob-layout") || el).remove();
  });
}

export function renderFileHistoryShell(
  deps: FileHistoryShellDeps,
  route: FileHistoryRoute,
  options: { loadSidebar?: boolean } = {},
): FileHistoryShellMount {
  removeFileHistoryShell();
  const target: SourceFileTarget = { path: route.path, ref: route.ref };
  const { sticky } = createFileShellSticky(deps, target, "history");
  const panelDom = buildHistoryPanelDom({ variant: "file" });
  const commitInfo = buildHistoryCommitInfoDom({ variant: "file" });
  const emptyText = deps.emptyText();
  const card = templateElement(
    html`<article
      class="gdp-file-shell loaded gdp-standalone-file-history gdp-file-history-mode"
      data-path=${target.path}
    ><div class="gdp-file-detail-wrapper">${sticky}<div
          class="gdp-file-detail-body gdp-file-history-body"
        ><div class="gdp-file-history-embed">${panelDom.panel}<main
              class="gdp-file-history-diff-pane"
            >${commitInfo}<div class="empty gdp-file-history-empty hidden"><div
                  class="empty-icon"
                >${iconTemplate(GIT_BRANCH_16_PATH, "octicon-git-branch")}</div><h2
                  >${emptyText.noCommitSelectedTitle}</h2
                ><p>${emptyText.noCommitSelectedBody}</p></div><div
                class="gdp-file-history-diff"
              ></div></main></div></div></div></article>`,
  );
  const empty = card.querySelector<HTMLElement>(".gdp-file-history-empty");
  const diffHost = card.querySelector<HTMLElement>(".gdp-file-history-diff");
  if (!empty || !diffHost)
    throw new Error("file history: the history card was not drawn");

  mountFileShellCard(deps, target, card, target.ref, options);
  return {
    ...panelDom,
    commitInfo,
    diffHost,
    emptyHost: empty,
  };
}
