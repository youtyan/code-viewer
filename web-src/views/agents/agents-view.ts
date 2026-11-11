// エージェントの全体ボード (/agents) の表示。agents-presenter.ts が渡す値
// (AgentsBoardViewProps) だけから描く。

import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
import type { AgentPane, AgentStateFilter } from "../../core/agent-overview";
import {
  CHEVRON_DOWN_16_PATH,
  KEBAB_16_PATH,
  PLUS_16_PATH,
  SYNC_16_PATH,
  X_16_PATH,
} from "../../core/icons";
import type { ProjectLook } from "../projects/project-looks";
import { projectMarkTemplate } from "../projects/project-looks";
import { iconTemplate } from "../ui/icon";
import { agentRowTemplate } from "./agent-card";

/** 描き直しの前後で同じ要素を指すための鍵。 */
export const NAV_ATTR = "data-agent-nav";

export type BoardRowProps = {
  id: string;
  state: AgentPane["state"];
  active: boolean;
  unread: boolean;
  title: string;
  previewName: string;
  card: TemplateResult;
};

export type BoardActivity =
  | { kind: "starting"; text: string }
  | { kind: "failed"; title: string; detail: string; dismissLabel: string };

export type BoardProjectProps = {
  root: string;
  name: string;
  look: ProjectLook;
  collapsed: boolean;
  toggleTitle: string;
  error: string | null;
  server:
    | { kind: "here"; text: string; title: string }
    | { kind: "problem"; title: string }
    | {
        kind: "open";
        text: string;
        title: string;
        starting: boolean;
        stopped: boolean;
      }
    | null;
  launchTitle: string | null;
  menuTitle: string;
  activity: BoardActivity | null;
  noAgents: string | null;
  rows: BoardRowProps[];
};

export type BoardNotify =
  | { kind: "ask"; status: string | null; label: string; title: string }
  | { kind: "granted"; label: string; title: string }
  | { kind: "denied"; status: string; help: string; reload: string }
  | { kind: "unsupported"; status: string };

export type AgentsBoardViewProps = {
  ariaLabel: string;
  title: string;
  refreshLabel: string;
  launch: { label: string; title: string };
  notify: BoardNotify;
  notifyError: string | null;
  hookHint: { text: string; open: string; close: string } | null;
  problems: { summary: string; body: string; forceOpen: boolean } | null;
  accountsBand: Element;
  board: {
    title: string;
    count: number;
    filterLabel: string;
    filters: {
      filter: AgentStateFilter;
      label: string;
      count: number;
      active: boolean;
    }[];
    allPanes: { label: string; title: string; checked: boolean };
    /** 並びの切替 (プロジェクトごと・急ぐ順)。 */
    order: {
      label: string;
      options: {
        order: BoardOrder;
        label: string;
        title: string;
        active: boolean;
      }[];
    };
    hint: string;
  };
  /** 一覧の中身 (順に並べる)。 */
  list: BoardListEntry[];
  onRefresh(): void;
  onLaunch(project?: string): void;
  onNotifyEnable(): void;
  onNotifySettings(): void;
  onReload(): void;
  onHookOpen(): void;
  onHookClose(): void;
  onFilter(filter: AgentStateFilter): void;
  onAllPanes(checked: boolean): void;
  onOrder(order: BoardOrder): void;
  onListKeydown(event: KeyboardEvent): void;
  onOpenPane(id: string, event: MouseEvent): void;
  onPaneMenu(id: string, event: MouseEvent): void;
  onToggleProject(root: string): void;
  onOpenProject(root: string): void;
  onProjectMenu(root: string, anchor: HTMLElement): void;
  onDismissActivity(root: string): void;
  onToggleStopped(): void;
  /** 一覧の箱が描かれたとき (覗き窓を見張る)。 */
  listRef(el: Element | undefined): void;
};

/** 全体ボードの並び。 */
export type BoardOrder = "project" | "urgency";

export type BoardListEntry =
  | { kind: "activity"; activity: BoardActivity; root: string }
  | {
      /** 急ぐ順の 1 段 (状態ごと。プロジェクトをまたぐ)。 */
      kind: "section";
      /** 状態の段。留めた段は null。 */
      state: AgentPane["state"] | null;
      label: string;
      rows: BoardRowProps[];
    }
  | { kind: "content"; content: unknown }
  | { kind: "project"; project: BoardProjectProps }
  | {
      kind: "stopped";
      open: boolean;
      label: string;
      title: string;
      projects: BoardProjectProps[];
    };

export type AgentsBoardView = (props: AgentsBoardViewProps) => unknown;

function activityTemplate(
  props: AgentsBoardViewProps,
  root: string,
  activity: BoardActivity,
): TemplateResult {
  if (activity.kind === "starting")
    return html`<div class="agents-project-activity agents-project-starting" role="status">${activity.text}</div>`;
  return html`<div class="agents-project-activity agents-project-failed" role="alert"><div
      class="agents-project-activity-head"
    ><strong>${activity.title}</strong><button
      type="button"
      class="agents-icon-action"
      title=${activity.dismissLabel}
      aria-label=${activity.dismissLabel}
      @click=${() => props.onDismissActivity(root)}
    >${iconTemplate(X_16_PATH, "octicon-x")}</button></div><pre
      class="terminal-observation-errors"
    >${activity.detail}</pre></div>`;
}

function rowTemplate(props: AgentsBoardViewProps, row: BoardRowProps): unknown {
  return agentRowTemplate({
    base: "agents-row",
    ...row,
    onOpen: (event) => props.onOpenPane(row.id, event),
    onMenu: (event) => props.onPaneMenu(row.id, event),
  });
}

function serverTemplate(
  props: AgentsBoardViewProps,
  project: BoardProjectProps,
): unknown {
  const server = project.server;
  if (!server) return nothing;
  if (server.kind === "here")
    return html`<span class="agents-server-here" title=${server.title}>${server.text}</span>`;
  if (server.kind === "problem")
    return html`<span
      class="agents-server-problem"
      title=${server.title}
      aria-label=${server.title}
    >!</span>`;
  return html`<button
    type="button"
    class=${server.stopped ? "agents-server-link stopped" : "agents-server-link"}
    ?disabled=${server.starting}
    aria-busy=${String(server.starting)}
    title=${server.title}
    @click=${() => props.onOpenProject(project.root)}
  >${server.text}</button>`;
}

function projectTemplate(
  props: AgentsBoardViewProps,
  project: BoardProjectProps,
): TemplateResult {
  return html`<section
    class=${project.noAgents !== null ? "agents-project agents-project-empty" : "agents-project"}
  ><div class="agents-project-head"><button
    type="button"
    class="agents-project-toggle"
    data-agent-nav=${`project:${project.root}`}
    tabindex=${live("-1")}
    aria-expanded=${String(!project.collapsed)}
    title=${project.toggleTitle}
    @click=${() => props.onToggleProject(project.root)}
  >${projectMarkTemplate(project.look, "agents-project-mark")}<span
    class="agents-project-name"
  >${project.name}</span><span
    class=${project.collapsed ? "terminal-tree-twisty agents-project-twisty collapsed" : "terminal-tree-twisty agents-project-twisty"}
    aria-hidden="true"
  >${iconTemplate(CHEVRON_DOWN_16_PATH, "octicon-chevron-down")}</span></button>${
    project.error !== null
      ? html`<span
          class="agents-server-problem"
          title=${project.error}
          aria-label=${project.error}
        >!</span>`
      : nothing
  }<span class="agents-project-actions">${serverTemplate(props, project)}${
    project.launchTitle !== null
      ? html`<button
          type="button"
          class="agents-icon-action agents-project-launch"
          title=${project.launchTitle}
          aria-label=${project.launchTitle}
          @click=${() => props.onLaunch(project.root)}
        >${iconTemplate(PLUS_16_PATH, "octicon-plus")}</button>`
      : nothing
  }<button
    type="button"
    class="agents-icon-action agents-project-menu"
    title=${project.menuTitle}
    aria-label=${project.menuTitle}
    aria-haspopup="menu"
    @click=${(event: MouseEvent) => {
      // 文書全体の click で閉じる処理に、開いたばかりのメニューを閉じさせない。
      event.stopPropagation();
      props.onProjectMenu(project.root, event.currentTarget as HTMLElement);
    }}
  >${iconTemplate(KEBAB_16_PATH, "octicon-kebab-horizontal")}</button></span></div>${
    project.activity
      ? activityTemplate(props, project.root, project.activity)
      : nothing
  }${
    project.noAgents !== null
      ? html`<div class="agents-project-none" ?hidden=${project.collapsed}>${project.noAgents}</div>`
      : html`<div class="agents-rows" role="group" ?hidden=${project.collapsed}>${repeat(
          project.rows,
          (row) => row.id,
          (row) => rowTemplate(props, row),
        )}</div>`
  }</section>`;
}

function listEntryTemplate(
  props: AgentsBoardViewProps,
  entry: BoardListEntry,
): unknown {
  switch (entry.kind) {
    case "activity":
      return activityTemplate(props, entry.root, entry.activity);
    case "content":
      return entry.content;
    case "section":
      return html`<section class="agents-project agents-urgency-section"><div
        class="agents-project-head"
      ><span class="agents-project-name">${entry.label}</span><span
        class="agents-chip"
      >${entry.rows.length}</span></div><div class="agents-rows" role="group">${repeat(
        entry.rows,
        (row) => row.id,
        (row) => rowTemplate(props, row),
      )}</div></section>`;
    case "project":
      return projectTemplate(props, entry.project);
    case "stopped":
      return html`<section class="agents-stopped"><button
        type="button"
        class="agents-stopped-toggle"
        data-agent-nav="stopped"
        tabindex=${live("-1")}
        aria-expanded=${String(entry.open)}
        title=${entry.title}
        @click=${() => props.onToggleStopped()}
      ><span
        class=${entry.open ? "terminal-tree-twisty agents-project-twisty" : "terminal-tree-twisty agents-project-twisty collapsed"}
        aria-hidden="true"
      >${iconTemplate(CHEVRON_DOWN_16_PATH, "octicon-chevron-down")}</span><span
      >${entry.label}</span></button><div class="agents-stopped-list" ?hidden=${!entry.open}>${entry.projects.map(
        (project) => projectTemplate(props, project),
      )}</div></section>`;
  }
}

function notifyTemplate(props: AgentsBoardViewProps): unknown {
  const notify = props.notify;
  const error = props.notifyError
    ? html`<span
        class="agents-notify-error"
        title=${props.notifyError}
        aria-label=${props.notifyError}
      >!</span>`
    : nothing;
  if (notify.kind === "ask")
    return html`${
      notify.status !== null
        ? html`<span class="agents-notify-status">${notify.status}</span>`
        : nothing
    }<button
      type="button"
      class="agents-secondary agents-notify-enable"
      title=${notify.title}
      @click=${() => props.onNotifyEnable()}
    >${notify.label}</button>${error}`;
  if (notify.kind === "granted")
    return html`<button
      type="button"
      class="agents-text-action agents-notify-on"
      title=${notify.title}
      @click=${() => props.onNotifySettings()}
    >${notify.label}</button>${error}`;
  if (notify.kind === "denied")
    // 許可した後の再読み込み (ブラウザの設定はページからは開けない)。
    return html`<span class="agents-notify-status agents-notify-denied" title=${notify.help}
        >${notify.status}</span
      ><span class="agents-notify-help">${notify.help}</span><button
        type="button"
        class="agents-text-action agents-notify-reload"
        @click=${() => props.onReload()}
      >${notify.reload}</button>${error}`;
  return html`<span class="agents-notify-status">${notify.status}</span>${error}`;
}

/** 既定の表示。 */
export const DEFAULT_VIEW: AgentsBoardView = (props) => {
  const { board } = props;
  return html`<header class="agents-header"><h1 class="agents-title">${props.title}</h1><span
      class="agents-spacer"
    ></span><div class="agents-notify">${notifyTemplate(props)}</div><button
      type="button"
      class="agents-icon-action agents-refresh"
      title=${props.refreshLabel}
      aria-label=${props.refreshLabel}
      @click=${() => props.onRefresh()}
    >${iconTemplate(SYNC_16_PATH, "octicon-sync")}</button><button
      type="button"
      class="agents-primary agents-launch"
      title=${props.launch.title}
      @click=${() => props.onLaunch()}
    ><span class="agents-primary-icon" aria-hidden="true">${iconTemplate(PLUS_16_PATH, "octicon-plus")}</span><span
      >${props.launch.label}</span></button></header><div
      class="agents-hook-hint"
      ?hidden=${!props.hookHint}
    ><span class="agents-hook-hint-text">${props.hookHint?.text ?? ""}</span><button
      type="button"
      class="agents-hook-hint-open"
      @click=${() => props.onHookOpen()}
    >${props.hookHint?.open ?? ""}</button><button
      type="button"
      class="agents-icon-action agents-hook-hint-close"
      title=${ifDefined(props.hookHint?.close)}
      aria-label=${ifDefined(props.hookHint?.close)}
      @click=${() => props.onHookClose()}
    >${iconTemplate(X_16_PATH, "octicon-x")}</button></div><details
      class="agents-problems"
      ?hidden=${!props.problems}
      ${ref((el) => {
        // tmux の一覧そのものが取れないときは、中身を見なくても分かるよう開く。
        if (el instanceof HTMLDetailsElement && props.problems?.forceOpen)
          el.open = true;
      })}
    ><summary>${props.problems?.summary ?? ""}</summary><pre
      class="terminal-observation-errors"
    >${props.problems?.body ?? ""}</pre></details>${props.accountsBand}<section
      class="agents-board"
    ><div class="agents-toolbar"><h2 class="agents-section-title"><span>${board.title}</span><span
      class="agents-chip"
    >${board.count}</span></h2><div class="agents-filter" role="group" aria-label=${board.filterLabel}>${board.filters.map(
      (item) => html`<button
        type="button"
        data-filter=${item.filter}
        class=${item.active ? "active" : ""}
        aria-pressed=${String(item.active)}
        @click=${() => props.onFilter(item.filter)}
      ><span class="agents-filter-label">${item.label}</span><span
        class="agents-chip agents-filter-count"
      >${item.count}</span></button>`,
    )}</div><label class="agents-all-panes" title=${board.allPanes.title}><input
      type="checkbox"
      .checked=${live(board.allPanes.checked)}
      @change=${(event: Event) =>
        props.onAllPanes((event.currentTarget as HTMLInputElement).checked)}
    /><span>${board.allPanes.label}</span></label><div
      class="agents-filter agents-order"
      role="group"
      aria-label=${board.order.label}
    >${board.order.options.map(
      (item) => html`<button
        type="button"
        data-order=${item.order}
        class=${item.active ? "active" : ""}
        aria-pressed=${String(item.active)}
        title=${item.title}
        @click=${() => props.onOrder(item.order)}
      ><span class="agents-filter-label">${item.label}</span></button>`,
    )}</div><span class="agents-spacer"></span><span
      class="agents-hint"
      title=${board.hint}
    >${board.hint}</span></div><div
      class="agents-list"
      role="tree"
      ${ref((el) => props.listRef(el))}
      @keydown=${(event: KeyboardEvent) => props.onListKeydown(event)}
    >${props.list.map((entry) => listEntryTemplate(props, entry))}</div></section>`;
};
