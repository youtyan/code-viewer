// 左のサイドバーの「プロジェクト → エージェント」の一覧の表示。
// agents-sidebar-presenter が渡す値 (AgentsSidebarViewProps) だけから描く。

import { html, nothing, type TemplateResult } from "lit/html.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import type { AgentPane } from "../../core/agent-overview";
import {
  CHEVRON_DOWN_16_PATH,
  KEBAB_16_PATH,
  PLUS_16_PATH,
} from "../../core/icons";
import type { ProjectLook } from "../projects/project-looks";
import { projectMarkTemplate } from "../projects/project-looks";
import { iconTemplate } from "../ui/icon";
import { agentStateMarkTemplate } from "./agent-card";
import { markPreviewRow } from "./pane-preview";

/** 描き直しの前後で同じ要素を指すための鍵。木の行 (矢印で動く) の分。 */
export const NAV_ATTR = "data-nav-item";
/**
 * 木の行でない操作 (＋・⋯・案内や登録のボタン) の鍵。取り直しのたびに
 * 描き直すので、鍵が無いとフォーカスが落ち、次の Tab が同じボタンにもう一度止まる。
 */
export const FOCUS_ATTR = "data-nav-focus";
/** 上の区画 (登録したもの) のプロジェクトの箱の印。値は root。並べ替えの対象。 */
export const ORDER_ATTR = "data-nav-order";

export type AgentRowProps = {
  id: string;
  state: AgentPane["state"];
  active: boolean;
  unread: boolean;
  title: string;
  ariaLabel: string;
  /** 覗き窓の名前 (pane-preview.ts)。 */
  previewName: string;
  /** カードの中身 (agent-card.ts の agentCardTemplate)。 */
  card: TemplateResult;
};

export type SidebarProjectProps = {
  root: string;
  name: string;
  look: ProjectLook;
  here: boolean;
  starting: boolean;
  collapsed: boolean;
  hasAgents: boolean;
  /** 登録したもの (並べ替えの対象)。 */
  registered: boolean;
  /** 見出しを掴んで並べ替えられる (指の画面では掴まない)。 */
  draggable: boolean;
  toggleTitle: string;
  twistyLabel: string;
  /** 畳んでいても中に何があるか分かる印。起こしている最中は回る点線。 */
  mark: AgentPane["state"] | "starting" | null;
  startingLabel: string | null;
  count: number | null;
  problem: string | null;
  open: { title: string } | null;
  menuTitle: string;
  activity: { title: string; detail: string; dismissLabel: string } | null;
  rows: AgentRowProps[];
};

export type SidebarNote = { cls: string; text: string; title?: string };

export type AgentsSidebarViewProps = {
  ariaLabel: string;
  /** 登録の失敗 (理由の全文)。 */
  general: SidebarNote[];
  /** 一覧を読めるまでの文 (読めたら null)。 */
  loading: SidebarNote | null;
  running: SidebarProjectProps[];
  empty: {
    title: string;
    body: string;
    register: { label: string; title: string };
    byPath: string;
  } | null;
  detected: {
    title: string;
    tooltip: string;
    projects: SidebarProjectProps[];
  } | null;
  stopped: {
    open: boolean;
    label: string;
    title: string;
    problem: string | null;
    projects: SidebarProjectProps[];
  } | null;
  notes: SidebarNote[];
  notify: {
    body: string;
    allow: string;
    hide: string;
  } | null;
  notifyError: string | null;
  problems: string | null;
  onOpenPane(id: string, event: MouseEvent): void;
  onPaneMenu(id: string, event: MouseEvent): void;
  onToggleCollapsed(root: string): void;
  onSwitchProject(root: string): void;
  onProjectMenu(root: string, anchor: HTMLElement, event?: MouseEvent): void;
  onOpenProjectMenu(root: string, anchor: HTMLElement): void;
  onProjectDragStart(root: string, event: DragEvent): void;
  onProjectDragEnd(): void;
  onDismissActivity(root: string): void;
  onToggleStopped(): void;
  onRegisterCurrent(): void;
  onRegisterByPath(): void;
  onNotifyAllow(): void;
  onNotifyHide(): void;
  onOpenBoard(): void;
};

export type AgentsSidebarView = (props: AgentsSidebarViewProps) => unknown;

function note(item: SidebarNote): TemplateResult {
  return html`<div
    class=${`nav-note ${item.cls}`}
    title=${ifDefined(item.title || undefined)}
  >${item.text}</div>`;
}

function agentRow(props: AgentsSidebarViewProps, row: AgentRowProps): unknown {
  const cls = [
    `nav-agent nav-agent-${row.state}`,
    row.active ? "active" : "",
    row.unread ? "unread" : "",
    "agent-card",
  ]
    .filter(Boolean)
    .join(" ");
  // ターミナルは 1 か所にしか置けず、仮にもならないので、中ボタン・⌘/Ctrl・Alt
  // も 1 回押すと同じ (開くか前面に出す)。
  return html`<button
    type="button"
    class=${cls}
    role="treeitem"
    tabindex=${live("-1")}
    data-nav-item=${`pane:${row.id}`}
    aria-current=${row.active ? "true" : nothing}
    title=${row.title}
    aria-label=${row.ariaLabel}
    ${ref((el) => {
      if (el instanceof HTMLElement)
        markPreviewRow(el, row.id, row.previewName);
    })}
    @click=${(event: MouseEvent) => props.onOpenPane(row.id, event)}
    @auxclick=${(event: MouseEvent) => props.onOpenPane(row.id, event)}
    @contextmenu=${(event: MouseEvent) => props.onPaneMenu(row.id, event)}
  >${row.card}</button>`;
}

function iconAction(
  cls: string,
  focusKey: string,
  icon: unknown,
  title: string,
  onClick: (button: HTMLElement) => void,
): TemplateResult {
  return html`<button
    type="button"
    class=${`nav-row-action ${cls}`}
    data-nav-focus=${focusKey}
    title=${title}
    aria-label=${title}
    aria-haspopup="menu"
    @click=${(event: MouseEvent) => {
      // 行 (畳む / 開く) の click にしない。メニューは文書全体の click で
      // 閉じるので、開いたばかりのメニューを閉じさせない。
      event.stopPropagation();
      onClick(event.currentTarget as HTMLElement);
    }}
  >${icon}</button>`;
}

function project(
  props: AgentsSidebarViewProps,
  item: SidebarProjectProps,
): TemplateResult {
  const headCls = [
    "nav-project-head",
    item.here ? "current" : "",
    item.starting ? "starting" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const twistyCls = [
    "nav-twisty",
    item.collapsed || !item.hasAgents ? "collapsed" : "",
    item.hasAgents ? "" : "empty",
  ]
    .filter(Boolean)
    .join(" ");
  return html`<div
    class=${live("nav-project")}
    data-nav-order=${ifDefined(item.registered ? item.root : undefined)}
  >
    <div
      class=${headCls}
      data-project-color=${item.look.color ?? "none"}
      .draggable=${item.draggable}
      @contextmenu=${(event: MouseEvent) => {
        event.preventDefault();
        props.onProjectMenu(
          item.root,
          event.currentTarget as HTMLElement,
          event,
        );
      }}
      @dragstart=${(event: DragEvent) => props.onProjectDragStart(item.root, event)}
      @dragend=${() => props.onProjectDragEnd()}
    ><button
      type="button"
      class=${twistyCls}
      tabindex="-1"
      data-nav-focus=${`twisty:${item.root}`}
      ?disabled=${!item.hasAgents}
      title=${item.twistyLabel}
      aria-label=${item.twistyLabel}
      @click=${() => props.onToggleCollapsed(item.root)}
    >${iconTemplate(CHEVRON_DOWN_16_PATH, "octicon-chevron-down")}</button><button
      type="button"
      class="nav-project-toggle"
      role="treeitem"
      tabindex=${live("-1")}
      data-nav-item=${`project:${item.root}`}
      aria-expanded=${item.hasAgents ? String(!item.collapsed) : nothing}
      aria-current=${item.here ? "page" : nothing}
      aria-busy=${String(item.starting)}
      title=${item.toggleTitle}
      @click=${() => props.onSwitchProject(item.root)}
    >${projectMarkTemplate(item.look, "nav-project-mark")}<span class="nav-project-name">${item.name}</span>${
      item.mark
        ? html`<span class="nav-project-state" aria-hidden="true">${
            item.mark === "starting"
              ? html`<i class="terminal-mark nav-mark-starting"></i>`
              : agentStateMarkTemplate(item.mark)
          }</span>`
        : nothing
    }${
      item.startingLabel
        ? html`<span class="nav-project-status">${item.startingLabel}</span>`
        : nothing
    }</button>${
      item.count !== null
        ? html`<span class="nav-project-count" aria-hidden="true">${item.count}</span>`
        : nothing
    }${
      item.problem !== null
        ? html`<span class="nav-project-problem" title=${item.problem} aria-label=${item.problem}>!</span>`
        : nothing
    }<span class="nav-project-actions">${
      item.open
        ? iconAction(
            "nav-project-open",
            `open:${item.root}`,
            iconTemplate(PLUS_16_PATH, "octicon-plus"),
            item.open.title,
            (button) => props.onOpenProjectMenu(item.root, button),
          )
        : nothing
    }${iconAction(
      "nav-project-menu",
      `menu:${item.root}`,
      iconTemplate(KEBAB_16_PATH, "octicon-kebab-horizontal"),
      item.menuTitle,
      (button) => props.onProjectMenu(item.root, button),
    )}</span></div>
    ${
      item.activity
        ? html`<div class="nav-project-activity nav-project-activity-failed" role="alert"><div
              class="nav-project-activity-head"
            ><strong class="">${item.activity.title}</strong><button
              type="button"
              class="nav-row-action"
              data-nav-focus=${`dismiss:${item.root}`}
              title=${item.activity.dismissLabel}
              aria-label=${item.activity.dismissLabel}
              @click=${() => props.onDismissActivity(item.root)}
            >×</button></div><pre class="nav-project-activity-detail">${item.activity.detail}</pre></div>`
        : nothing
    }
    ${
      item.hasAgents
        ? html`<div class="nav-agents" role="group" ?hidden=${item.collapsed}>${repeat(
            item.rows,
            (row) => row.id,
            (row) => agentRow(props, row),
          )}</div>`
        : nothing
    }
  </div>`;
}

function projects(
  props: AgentsSidebarViewProps,
  items: SidebarProjectProps[],
): unknown {
  return repeat(
    items,
    (item) => item.root,
    (item) => project(props, item),
  );
}

/** 既定の表示。 */
export const DEFAULT_VIEW: AgentsSidebarView = (props) => {
  const { empty, detected, stopped, notify } = props;
  return html`${props.general.map(note)}${
    props.loading
      ? note(props.loading)
      : html`${projects(props, props.running)}${
          empty
            ? html`<div class="nav-empty"><strong class="nav-empty-title">${empty.title}</strong><span
                  class="nav-empty-body"
                >${empty.body}</span><button
                  type="button"
                  class="nav-note-link nav-empty-action"
                  data-nav-focus="register-current"
                  title=${empty.register.title}
                  @click=${() => props.onRegisterCurrent()}
                >${empty.register.label}</button></div><button
                type="button"
                class="nav-note nav-note-link"
                data-nav-focus="register-path"
                @click=${() => props.onRegisterByPath()}
              >${empty.byPath}</button>`
            : nothing
        }${
          detected
            ? html`<div class="nav-detected" role="group" aria-labelledby="nav-detected-title"><div
                class="nav-section-title nav-detected-title"
                id="nav-detected-title"
                title=${detected.tooltip}
              >${detected.title}</div>${projects(props, detected.projects)}</div>`
            : nothing
        }${
          stopped
            ? html`<div class="nav-stopped" role="group" aria-labelledby="nav-stopped-title"><button
                type="button"
                class="nav-section-title nav-stopped-toggle"
                id="nav-stopped-title"
                role="treeitem"
                tabindex=${live("-1")}
                data-nav-item="stopped"
                aria-expanded=${String(stopped.open)}
                title=${stopped.title}
                @click=${() => props.onToggleStopped()}
              >${iconTemplate(CHEVRON_DOWN_16_PATH, "octicon-chevron-down")}${stopped.label}${
                stopped.problem !== null
                  ? html`<span
                      class="nav-project-problem"
                      title=${stopped.problem}
                      aria-label=${stopped.problem}
                    >!</span>`
                  : nothing
              }</button><div class="nav-stopped-list" ?hidden=${!stopped.open}>${projects(
                props,
                stopped.projects,
              )}</div></div>`
            : nothing
        }${props.notes.map(note)}${
          notify
            ? html`<div class="nav-empty" role="note"><span class="nav-empty-body">${notify.body}</span><button
                  type="button"
                  class="nav-note-link nav-empty-action"
                  data-nav-focus="notify-allow"
                  @click=${() => props.onNotifyAllow()}
                >${notify.allow}</button></div><button
                type="button"
                class="nav-note nav-note-link"
                data-nav-focus="notify-hide"
                @click=${() => props.onNotifyHide()}
              >${notify.hide}</button>`
            : nothing
        }${props.notifyError ? note({ cls: "nav-note-error", text: props.notifyError }) : nothing}${
          props.problems
            ? html`<button
                type="button"
                class="nav-note nav-note-error nav-note-link"
                data-nav-focus="problems"
                @click=${() => props.onOpenBoard()}
              >${props.problems}</button>`
            : nothing
        }`
  }`;
};
