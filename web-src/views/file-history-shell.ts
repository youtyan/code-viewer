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
): FileHistoryShellMount {
  removeFileHistoryShell();
  const target: SourceFileTarget = { path: route.path, ref: route.ref };
  const card = document.createElement("article");
  card.className =
    "gdp-file-shell loaded gdp-standalone-file-history gdp-file-history-mode";
  card.dataset.path = target.path;

  const wrapper = document.createElement("div");
  wrapper.className = "gdp-file-detail-wrapper";
  const { sticky } = createFileShellSticky(deps, target, "history");
  wrapper.appendChild(sticky);

  const body = document.createElement("div");
  body.className = "gdp-file-detail-body gdp-file-history-body";
  const embed = document.createElement("div");
  embed.className = "gdp-file-history-embed";
  const panelDom = buildHistoryPanelDom({ variant: "file" });

  const diffPane = document.createElement("main");
  diffPane.className = "gdp-file-history-diff-pane";
  const commitInfo = buildHistoryCommitInfoDom({ variant: "file" });
  const emptyText = deps.emptyText();
  const empty = document.createElement("div");
  empty.className = "empty gdp-file-history-empty hidden";
  const emptyIcon = document.createElement("div");
  emptyIcon.className = "emoji";
  emptyIcon.textContent = "✨";
  const emptyTitle = document.createElement("h2");
  emptyTitle.textContent = emptyText.noCommitSelectedTitle;
  const emptyBody = document.createElement("p");
  emptyBody.textContent = emptyText.noCommitSelectedBody;
  empty.append(emptyIcon, emptyTitle, emptyBody);
  const diffHost = document.createElement("div");
  diffHost.className = "gdp-file-history-diff";
  diffPane.append(commitInfo, empty, diffHost);

  embed.append(panelDom.panel, diffPane);
  body.appendChild(embed);
  wrapper.appendChild(body);
  card.appendChild(wrapper);

  mountFileShellCard(deps, target, card, target.ref);
  return {
    ...panelDom,
    commitInfo,
    diffHost,
    emptyHost: empty,
  };
}
