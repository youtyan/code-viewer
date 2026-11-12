// メインの面のタブ列の表示。main-tabs-presenter が渡す値 (MainTabsViewProps)
// だけから、面ごとのタブ列 (#main-tabs の中) と、面の境界・右に分割の落とす先
// (重ね合わせの層) を描く。並び・前面・畳む・保存はすべて presenter が持つ。

import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { type RefOrCallback, ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { html, nothing } from "lit/html.js";
import { CHEVRON_DOWN_12_PATH } from "../../core/icons";
import type { PaneSide } from "../../core/main-tabs";
import type { ProjectLook } from "../projects/project-looks";
import { projectMarkTemplate } from "../projects/project-looks";
import { iconTemplate } from "../ui/icon";
import {
  CLOSE_ICON_PATH,
  type PageIconPaths,
  pageIconPaths,
} from "./tab-icons";

/** タブ 1 枚。 */
export type MainTabProps = {
  id: string;
  kind: string;
  active: boolean;
  /** 選択タブの上端の線を強調色にする (フォーカスのある面の選択タブ)。 */
  focused: boolean;
  preview: boolean;
  dragging: boolean;
  title: string;
  /** エージェントを映しているターミナルは、絵の代わりに状態の印。 */
  state: string | null;
  icon: PageIconPaths;
  /** 狭くなったら題より先に省略するプロジェクト名 (グループに入っていない別のプロジェクト)。 */
  project: string | null;
  name: string;
  closeTitle: string;
};

/** プロジェクトのグループ (札とそのタブの並び)。 */
export type MainTabGroupProps = {
  key: string;
  look: ProjectLook;
  collapsed: boolean;
  current: boolean;
  /** 前面のタブがこのグループにある。 */
  front: boolean;
  count: number;
  toggleLabel: string;
  toggleTitle: string;
  menuLabel: string;
  listLabel: string;
  tabs: MainTabProps[];
};

export type MainTabsSectionProps = {
  side: PaneSide;
  focused: boolean;
  grouped: boolean;
  groups: MainTabGroupProps[];
  /** どのプロジェクトのものでもないタブ (グループが無ければ全部)。 */
  loose: MainTabProps[];
  listLabel: string;
  newTitle: string;
  split: {
    label: string;
    disabled: boolean;
    parked: boolean;
    icon: "split" | "unsplit";
  };
  /** 面の中の「この面を閉じる」(左の面だけ)。 */
  closePane: { label: string } | null;
  /** 電話の段だけ出す「開いているタブ」と枚数の枠 (左の面だけ)。 */
  tabList: {
    hidden: boolean;
    label: string;
    count: number;
    title: string;
  } | null;
  /** 列の頭に置く外の要素 (左の面だけ)。 */
  lead: Element | null;
};

export type MainTabsViewProps = {
  sections: MainTabsSectionProps[];
  onTabClick(id: string): void;
  onTabDblClick(id: string, event: MouseEvent): void;
  onTabAuxClick(id: string, event: MouseEvent): void;
  onTabContextMenu(id: string, event: MouseEvent): void;
  onTabDragStart(id: string, event: DragEvent): void;
  onTabDragEnd(event: DragEvent): void;
  onTabClose(id: string, event: MouseEvent): void;
  onNewTab(side: PaneSide): void;
  onSplit(side: PaneSide): void;
  onClosePane(): void;
  onTabList(): void;
  onGroupToggle(side: PaneSide, key: string): void;
  onGroupMenu(side: PaneSide, key: string, event: MouseEvent): void;
  onStripKeydown(side: PaneSide, event: KeyboardEvent): void;
  onStripDragOver(side: PaneSide, event: DragEvent): void;
  onStripDragLeave(side: PaneSide, event: DragEvent): void;
  onStripDrop(side: PaneSide, event: DragEvent): void;
  onStripWheel(side: PaneSide, event: WheelEvent): void;
  /** 列の箱が描かれた / 外れたとき (寸法を見張る)。 */
  stripRef(side: PaneSide): RefOrCallback;
};

export type MainTabsView = (props: MainTabsViewProps) => unknown;

/** タブの絵。エージェントを映しているターミナルは、絵の代わりに状態の印 (形で区別する)。
 * タブ列とタブの一覧 (電話の段) で同じもの。 */
export function tabIconTemplate(
  state: string | null | undefined,
  icon: string | readonly string[],
): unknown {
  return state
    ? terminalMarkTemplate(state)
    : iconTemplate(icon, "main-tab-svg");
}

/** エージェントの状態の印 (形で区別する)。 */
export function terminalMarkTemplate(state: string): unknown {
  return html`<i class=${`terminal-mark terminal-mark-${state}`} aria-hidden="true"></i>`;
}

/** 面の境界と、1 面のときに右に分割の落とす先 (body の層)。 */
export type MainSplitViewProps = {
  dividerLabel: string;
  /** 左の面の幅 (本文の幅に対する %)。2 面でないときは null。 */
  value: { now: string; min: string; max: string } | null;
  dropHidden: boolean;
  dropOver: boolean;
  dropLabel: string;
  dividerRef: RefOrCallback;
  onDropDragOver(event: DragEvent): void;
  onDropDragLeave(): void;
  onDrop(event: DragEvent): void;
};

function tabTemplate(props: MainTabsViewProps, tab: MainTabProps): unknown {
  const cls = [
    "main-tab",
    tab.active ? "main-tab-active" : "",
    tab.focused ? "main-tab-focused" : "",
    tab.preview ? "main-tab-preview" : "",
    tab.kind === "file" ? "main-tab-file" : "",
    // 掴んでいる最中に描き直した (端末の名前・未読の更新など) ときも、掴んで
    // いるタブの印を付け直す。
    tab.dragging ? "main-tab-dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");
  // class・tabindex は描き直すたびに値を当て直す (ドラッグの落とす先の印・キーで
  // 移ったフォーカスの印を、描き直しで今の状態に戻す)。
  return html`<div
    class=${live(cls)}
    data-tab-id=${tab.id}
    data-kind=${tab.kind}
    role="tab"
    aria-selected=${String(tab.active)}
    tabindex=${live(tab.active ? "0" : "-1")}
    draggable="true"
    title=${tab.title}
    @click=${() => props.onTabClick(tab.id)}
    @dblclick=${(event: MouseEvent) => props.onTabDblClick(tab.id, event)}
    @auxclick=${(event: MouseEvent) => props.onTabAuxClick(tab.id, event)}
    @contextmenu=${(event: MouseEvent) => props.onTabContextMenu(tab.id, event)}
    @dragstart=${(event: DragEvent) => props.onTabDragStart(tab.id, event)}
    @dragend=${(event: DragEvent) => props.onTabDragEnd(event)}
  ><span class="main-tab-icon">${tabIconTemplate(tab.state, tab.icon)}</span>${
    tab.project === null
      ? html`<span class="main-tab-name">${tab.name}</span>`
      : // 狭くなったら題より先にプロジェクト名を省略する (style.css の .main-tab-project)。
        html`<span class="main-tab-name main-tab-name-project"><span class="main-tab-project">${tab.project}</span><span class="main-tab-title">${tab.name}</span></span>`
  }<button
    type="button"
    class="main-tab-close"
    tabindex="-1"
    title=${tab.closeTitle}
    aria-hidden="true"
    @click=${(event: MouseEvent) => props.onTabClose(tab.id, event)}
  >${iconTemplate(CLOSE_ICON_PATH, "main-tab-close-svg")}</button></div>`;
}

function tabsTemplate(props: MainTabsViewProps, tabs: MainTabProps[]): unknown {
  return repeat(
    tabs,
    (tab) => tab.id,
    (tab) => tabTemplate(props, tab),
  );
}

function groupHeadTemplate(
  props: MainTabsViewProps,
  side: PaneSide,
  group: MainTabGroupProps,
): unknown {
  const cls = [
    "main-tab-group",
    group.collapsed ? "main-tab-group-collapsed" : "",
    group.current ? "main-tab-group-current" : "",
    group.front ? "main-tab-group-front" : "",
  ]
    .filter(Boolean)
    .join(" ");
  // 札は色の四角と頭文字と ▾ だけ (名前は title・aria-label と ▾ のメニューの頭)。
  // 畳んだときだけ頭文字の横に枚数。
  return html`<div
    class=${cls}
    data-group=${group.key}
    data-project-color=${group.look.color ?? "none"}
    @contextmenu=${(event: MouseEvent) => {
      event.preventDefault();
      props.onGroupMenu(side, group.key, event);
    }}
  ><button
    type="button"
    class="main-tab-group-toggle"
    aria-expanded=${String(!group.collapsed)}
    title=${group.toggleTitle}
    aria-label=${group.toggleLabel}
    @click=${() => props.onGroupToggle(side, group.key)}
  >${projectMarkTemplate(group.look, "main-tab-group-mark")}<span
    class="main-tab-group-count"
    ?hidden=${!group.collapsed}
    aria-hidden="true"
  >${group.count}</span></button><button
    type="button"
    class="main-tab-group-menu"
    aria-haspopup="menu"
    title=${group.menuLabel}
    aria-label=${group.menuLabel}
    @click=${(event: MouseEvent) => props.onGroupMenu(side, group.key, event)}
  >${iconTemplate(CHEVRON_DOWN_12_PATH, "main-tab-group-menu-icon")}</button></div>`;
}

type StripItem =
  | { key: string; kind: "head" | "list"; group: MainTabGroupProps }
  | { key: "new"; kind: "new" }
  | { key: "loose"; kind: "loose" };

function stripTemplate(
  props: MainTabsViewProps,
  section: MainTabsSectionProps,
): unknown {
  const { side } = section;
  // ＋ は最後のグループのタブのすぐ右、どのプロジェクトのものでもないタブは列の
  // 右端 (style.css の .main-tabs-grouped)。グループが無ければ [タブ][＋]。
  // 並びが変わっても要素は動かすだけにする (＋ のフォーカスを外さない)。
  const items: StripItem[] = section.grouped
    ? [
        ...section.groups.flatMap((group): StripItem[] => [
          { key: `head:${group.key}`, kind: "head", group },
          { key: `list:${group.key}`, kind: "list", group },
        ]),
        { key: "new", kind: "new" },
        { key: "loose", kind: "loose" },
      ]
    : [
        { key: "loose", kind: "loose" },
        { key: "new", kind: "new" },
      ];
  return html`<div
    class=${section.grouped ? "main-tabs-strip main-tabs-grouped" : "main-tabs-strip"}
    ${ref(props.stripRef(side))}
    @keydown=${(event: KeyboardEvent) => props.onStripKeydown(side, event)}
    @dragover=${(event: DragEvent) => props.onStripDragOver(side, event)}
    @dragleave=${(event: DragEvent) => props.onStripDragLeave(side, event)}
    @drop=${(event: DragEvent) => props.onStripDrop(side, event)}
    @wheel=${{
      handleEvent: (event: WheelEvent) => props.onStripWheel(side, event),
      passive: false,
    }}
  >${repeat(
    items,
    (item) => item.key,
    (item) => {
      switch (item.kind) {
        case "head":
          return groupHeadTemplate(props, side, item.group);
        case "list":
          return html`<div
            class="main-tabs-list main-tabs-group-list"
            role="tablist"
            aria-label=${item.group.listLabel}
            data-group=${item.group.key}
            data-project-color=${item.group.look.color ?? "none"}
          >${tabsTemplate(props, item.group.tabs)}</div>`;
        case "new":
          // 押すとメニュー (ファイル・新しいシェル・セッション) が開く。
          return html`<button
            type="button"
            class="main-tabs-action main-tabs-new"
            aria-haspopup="menu"
            title=${section.newTitle}
            aria-label=${section.newTitle}
            @click=${() => props.onNewTab(side)}
          >${iconTemplate(pageIconPaths("new"), "main-tabs-action-icon")}</button>`;
        case "loose":
          // tablist にはタブだけを置く (押せるボタンを混ぜない)。
          return html`<div
            class="main-tabs-list"
            role="tablist"
            aria-label=${section.listLabel}
          >${tabsTemplate(props, section.loose)}</div>`;
      }
    },
  )}</div>`;
}

function actionsTemplate(
  props: MainTabsViewProps,
  section: MainTabsSectionProps,
): unknown {
  const { split, tabList, closePane } = section;
  return html`<div class="main-tabs-actions">${
    tabList
      ? // 「タブ」と、枚数を四角の枠に入れて出す。
        html`<button
          type="button"
          class="main-tabs-action main-tabs-list-open"
          aria-haspopup="dialog"
          ?hidden=${tabList.hidden}
          title=${tabList.title}
          aria-label=${tabList.title}
          @click=${() => props.onTabList()}
        ><span class="main-tabs-list-label" aria-hidden="true">${tabList.label}</span><span
          class="main-tabs-list-count"
          aria-hidden="true"
        >${tabList.count}</span></button>`
      : nothing
  }<button
    type="button"
    class=${split.parked ? "main-tabs-action main-tabs-split main-tabs-action-parked" : "main-tabs-action main-tabs-split"}
    aria-disabled=${String(split.disabled)}
    title=${split.label}
    aria-label=${split.label}
    @click=${() => props.onSplit(section.side)}
  >${iconTemplate(pageIconPaths(split.icon), "main-tabs-action-icon")}</button>${
    closePane
      ? // 分割の絵 (向きだけ違う unsplit) と取り違えないよう、閉じるの × にする。
        html`<button
          type="button"
          class="main-tabs-action main-tabs-close-pane"
          title=${closePane.label}
          aria-label=${closePane.label}
          @click=${() => props.onClosePane()}
        >${iconTemplate(CLOSE_ICON_PATH, "main-tabs-action-icon")}</button>`
      : nothing
  }</div>`;
}

/** 既定の表示。面ごとのタブ列 (面が増えた・減ったときだけ箱を足す・外す)。 */
export const DEFAULT_VIEW: MainTabsView = (props) =>
  repeat(
    props.sections,
    (section) => section.side,
    (section) =>
      html`<div
        class=${section.focused ? "main-tabs-pane main-tabs-pane-focused" : "main-tabs-pane"}
        data-side=${section.side}
      >${section.lead ?? nothing}${stripTemplate(props, section)}${actionsTemplate(props, section)}</div>`,
  );

/** 面の境界 (掴みしろ 6px、線は 1px) と、右に分割の落とす先。 */
export function mainSplitTemplate(props: MainSplitViewProps): unknown {
  return html`<div
      class="main-split-divider"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-label=${props.dividerLabel}
      aria-valuenow=${ifDefined(props.value?.now)}
      aria-valuemin=${ifDefined(props.value?.min)}
      aria-valuemax=${ifDefined(props.value?.max)}
      ${ref(props.dividerRef)}
    ></div><div
      class=${props.dropOver ? "main-split-drop main-split-drop-over" : "main-split-drop"}
      ?hidden=${props.dropHidden}
      @dragover=${props.onDropDragOver}
      @dragleave=${props.onDropDragLeave}
      @drop=${props.onDrop}
    ><span class="main-split-drop-icon">${iconTemplate(pageIconPaths("split"), "main-tabs-action-icon")}</span><span
      class="main-split-drop-label"
    >${props.dropLabel}</span></div>`;
}
