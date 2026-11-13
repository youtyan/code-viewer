// 左のファイル一覧と変更ファイルの一覧 (sidebar.ts) の行と絵の形。presenter
// (createSidebar) が木・仮想表示の窓・開閉を決め、行ごとに値と押したときの呼び出し
// を渡す。

import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
import {
  CHEVRON_DOWN_12_PATH,
  COLLAPSE_ALL_16_PATHS,
  EXPAND_ALL_16_PATHS,
  FILE_16_PATH,
  FOLDER_ICON_PATHS,
  GIT_BRANCH_16_PATH,
  LINK_16_PATH,
  SIDEBAR_HIDE_16_PATHS,
  SIDEBAR_SHOW_16_PATHS,
} from "../core/icons";
import type { FileStatusMark } from "../core/types";
import { fileStatusBadgeTemplate } from "./diff-view";
import { openPathButtonTemplate } from "./open-path-button";
import { iconTemplate } from "./ui/icon";

/** 行の名前。開く先があればリンク、無ければ文字だけ。 */
export type SidebarRowLinkProps = {
  className: string;
  text: string;
  title: string;
  /** 開く先 (無いと null)。押し始めにもう一度求める (行を描き直していなくても
   * 今の範囲・ref に合わせる)。 */
  href: () => string | null;
};

/** 名前の横の印 (読まないフォルダ・大きい差分・バイナリ・サブモジュール)。 */
export type SidebarTagProps = {
  className: string;
  label: string;
  title: string;
};

/** シンボリックリンクの行の「→ 先」。 */
export type SidebarSymlinkProps = {
  broken: boolean;
  target: string;
  title: string;
};

export type SidebarBadgeProps = {
  status: string;
  titles: Record<FileStatusMark, string>;
};

export type SidebarDirRowProps = {
  path: string;
  className: string;
  title: string | undefined;
  omittedReason: string | undefined;
  explicit: boolean;
  style: string;
  onRowClick: (event: MouseEvent) => void;
  /** 開閉の印と絵を押したとき。中を読まないフォルダは null (印の代わりに空き)。 */
  onToggle: ((event: Event) => void) | null;
  collapsed: boolean;
  link: SidebarRowLinkProps;
  badge: SidebarBadgeProps | null;
  omitted: SidebarTagProps | null;
  symlink: SidebarSymlinkProps | null;
  openPath: {
    title: string;
    /** 行の中のボタンとして Tab の止まり場所から外す。 */
    rowAction: boolean;
    onOpen: (button: HTMLButtonElement) => void;
  };
};

/** ファイルの行の絵 (状態の札が無いとき)。 */
export type SidebarEntryIcon = "file" | "symlink" | "commit";

export type SidebarFileRowProps = {
  path: string;
  type: string;
  className: string;
  title: string | undefined;
  disabled: boolean;
  style: string;
  /** 押す・中ボタン・ダブルクリック。 */
  onOpen: (event: MouseEvent) => void;
  /** 指したときに先読みする (差分の一覧だけ)。 */
  onHover: (() => void) | null;
  badge: SidebarBadgeProps | null;
  icon: SidebarEntryIcon;
  link: SidebarRowLinkProps;
  symlink: SidebarSymlinkProps | null;
  kindTag: SidebarTagProps | null;
};

export type SidebarFlatRowProps = Omit<
  SidebarFileRowProps,
  "disabled" | "style" | "symlink"
> & { index: number };

export type SidebarView = {
  folderIcon(collapsed: boolean): unknown;
  expandAllIcon(): unknown;
  collapseAllIcon(): unknown;
  /** 一覧の列を畳む / 出すボタンの絵。 */
  toggleIcon(hidden: boolean): unknown;
  /** 一覧の列を畳む / 出すボタン (index.html に無いときに作る)。 */
  toggleButton(): unknown;
  dirRow(props: SidebarDirRowProps): TemplateResult;
  /** 差分の一覧の木のフォルダ: フォルダの行と、中の行の並び。 */
  treeDir(row: TemplateResult, children: readonly unknown[]): unknown;
  fileRow(props: SidebarFileRowProps): TemplateResult;
  flatRow(props: SidebarFlatRowProps): TemplateResult;
};

function rowLink({ className, text, title, href }: SidebarRowLinkProps) {
  const current = href();
  if (current === null)
    return html`<span class=${className} title=${title}>${text}</span>`;
  return html`<a
    class=${className}
    href=${current}
    tabindex="-1"
    draggable="false"
    title=${title}
    @pointerdown=${(event: PointerEvent) => {
      const next = href();
      if (next !== null) (event.currentTarget as HTMLAnchorElement).href = next;
    }}
  >${text}</a>`;
}

function tag(props: SidebarTagProps | null) {
  if (!props) return nothing;
  return html`<span class=${props.className} title=${props.title}
    >${props.label}</span
  >`;
}

function symlinkTarget(props: SidebarSymlinkProps | null) {
  if (!props) return nothing;
  return html`<span
    class=${props.broken ? "symlink-target broken" : "symlink-target"}
    title=${props.title}
  >→ ${props.target}</span>`;
}

function badge(props: SidebarBadgeProps | null) {
  return props ? fileStatusBadgeTemplate(props.status, props.titles) : nothing;
}

function entryIcon(icon: SidebarEntryIcon) {
  if (icon === "symlink") return iconTemplate(LINK_16_PATH, "octicon-link");
  if (icon === "commit")
    return iconTemplate(GIT_BRANCH_16_PATH, "octicon-git-branch");
  return iconTemplate(FILE_16_PATH, "octicon-file");
}

/** 状態の札、無ければ種類の絵。 */
function badgeOrIcon(props: Pick<SidebarFileRowProps, "badge" | "icon">) {
  return props.badge
    ? badge(props.badge)
    : html`<span class="d2h-icon-wrapper">${entryIcon(props.icon)}</span>`;
}

function hoverListener(onHover: (() => void) | null) {
  return onHover ? { handleEvent: onHover, passive: true } : null;
}

export const DEFAULT_VIEW: SidebarView = {
  folderIcon: (collapsed) =>
    html`<svg
      class=${`octicon octicon-file-directory-${collapsed ? "fill" : "open-fill"}`}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    ><path
      fill="currentColor"
      d=${collapsed ? FOLDER_ICON_PATHS.closed : FOLDER_ICON_PATHS.open}
    ></path></svg>`,
  expandAllIcon: () =>
    iconTemplate(EXPAND_ALL_16_PATHS, "octicon-chevron-down"),
  collapseAllIcon: () =>
    iconTemplate(COLLAPSE_ALL_16_PATHS, "octicon-chevron-up"),
  toggleIcon: (hidden) =>
    iconTemplate(
      hidden ? SIDEBAR_SHOW_16_PATHS : SIDEBAR_HIDE_16_PATHS,
      "octicon-sidebar",
    ),
  toggleButton: () => html`<button id="sidebar-toggle" type="button"></button>`,
  dirRow: (props) =>
    html`<li
      class=${live(props.className)}
      tabindex="-1"
      data-dirpath=${props.path}
      data-type="tree"
      data-children-omitted-reason=${ifDefined(props.omittedReason)}
      data-explicit=${ifDefined(props.explicit ? "true" : undefined)}
      title=${ifDefined(props.title)}
      style=${props.style}
      @click=${props.onRowClick}
    >${
      props.onToggle
        ? html`<span class="chev" @click=${props.onToggle}>${iconTemplate(
            CHEVRON_DOWN_12_PATH,
            "octicon-chevron-down",
            12,
          )}</span>`
        : html`<span class="chev-spacer" aria-hidden="true"></span>`
    }<span class="dir-icon" @click=${props.onToggle}
      >${DEFAULT_VIEW.folderIcon(props.collapsed)}</span
    ><span class="dir-label">${rowLink(props.link)}${badge(props.badge)}${tag(
      props.omitted,
    )}${symlinkTarget(props.symlink)}</span>${openPathButtonTemplate(
      props.openPath.title,
      props.openPath.onOpen,
      props.openPath.rowAction,
    )}</li>`,
  treeDir: (row, children) =>
    html`${row}<ul class="tree-children">${children}</ul>`,
  fileRow: (props) =>
    html`<li
      class=${live(props.className)}
      tabindex="-1"
      data-path=${props.path}
      data-type=${props.type}
      title=${ifDefined(props.title)}
      aria-disabled=${ifDefined(props.disabled ? "true" : undefined)}
      style=${props.style}
      @click=${props.onOpen}
      @auxclick=${props.onOpen}
      @dblclick=${props.onOpen}
      @mouseenter=${hoverListener(props.onHover)}
    ><span class="chev-spacer"></span>${badgeOrIcon(props)}${rowLink(
      props.link,
    )}${symlinkTarget(props.symlink)}${tag(props.kindTag)}</li>`,
  flatRow: (props) =>
    html`<li
      class=${live(props.className)}
      tabindex="-1"
      data-index=${String(props.index)}
      data-path=${props.path}
      data-type=${props.type}
      title=${ifDefined(props.title)}
      @click=${props.onOpen}
      @auxclick=${props.onOpen}
      @dblclick=${props.onOpen}
      @mouseenter=${hoverListener(props.onHover)}
    >${badgeOrIcon(props)}${rowLink(props.link)}${tag(props.kindTag)}</li>`,
};
