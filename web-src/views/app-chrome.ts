// app.ts (画面全体をつなぐ所) が作る要素の形。app.ts は画面の箱 (web/index.html) に
// あるボタンへ絵を入れたり、小さな部品を作って外の部品へ渡したりする。その形を
// ここに集め、app.ts は値と押したときの呼び出しだけを渡す。
//
// 入れる先の多くは、ほかの所も中身や属性を書き換える箱 (文言を入れ直すボタンなど)
// なので、描く係 (lit の根) を置かず、templateFragment で作った中身を入れる。

import { html, nothing } from "lit/html.js";
import {
  GIT_BRANCH_16_PATH,
  NEXT_16_PATHS,
  PREVIOUS_16_PATHS,
  TRIANGLE_DOWN_16_PATH,
} from "../core/icons";
import { openPathButtonTemplate } from "./open-path-button";
import {
  type ProjectLook,
  projectMarkTemplate,
} from "./projects/project-looks";
import { iconTemplate } from "./ui/icon";
import { templateFragment } from "./ui/renderer";

type IconPaths = string | readonly string[];

export type RefSelectorProps = {
  id: string;
  placeholder: string;
  title?: string;
  wrapperId?: string;
  extraClass?: string;
  hidden?: boolean;
  value?: string;
};

export type RevisionNavProps = {
  olderTitle: string;
  newerTitle: string;
  /** 1 つ前・1 つ後の版。まだ分からない・無いときは null (ボタンは押せない)。 */
  previous: string | null;
  next: string | null;
  onGo: (sha: string) => void;
};

export type ForeignCrumbsProps = {
  label: string;
  look: ProjectLook;
  /** プロジェクトの名前から始まる、パスの区切りごとの表示。 */
  parts: readonly string[];
};

export type EmptyDiffActionsProps = {
  onReload: (button: HTMLButtonElement) => void;
  onHistory: (event: MouseEvent) => void;
};

export type AppChromeView = {
  /** 箱の中身にする絵 1 つ。 */
  icon(paths: IconPaths, cls: string, size?: 12 | 16): unknown;
  /** Split / Unified のボタンの中身 (絵と、帯が狭いと畳む名前)。 */
  layoutButton(paths: IconPaths, label: string): unknown;
  /** 空の差分の案内のボタンの中身 (絵と名前)。 */
  emptyAction(iconClass: string, paths: IconPaths, label: string): unknown;
  emptyDiffActions(props: EmptyDiffActionsProps): unknown;
  refSelector(props: RefSelectorProps): unknown;
  openPathButton(
    title: string,
    onOpen: (button: HTMLButtonElement) => void,
  ): unknown;
  revisionNav(props: RevisionNavProps): unknown;
  downloadLink(url: string, fileName: string): unknown;
  resizePreview(id: string): unknown;
  paneHost(side: string): unknown;
  /** 面の箱に入れるソース表示の枠 (スクロールする外枠と、カードを入れる中)。 */
  paneSource(extraClass: string): unknown;
  paneMessage(message: string): unknown;
  foreignCrumbs(props: ForeignCrumbsProps): unknown;
  hiddenSlot(): unknown;
};

export const DEFAULT_VIEW: AppChromeView = {
  icon: (paths, cls, size = 16) => iconTemplate(paths, cls, size),
  layoutButton: (paths, label) =>
    html`${iconTemplate(paths, "seg-icon")}<span class="seg-label"
        >${label}</span
      >`,
  emptyAction: (iconClass, paths, label) =>
    html`<span class="empty-action-icon" aria-hidden="true"
        >${iconTemplate(paths, iconClass)}</span
      ><span class="empty-action-label">${label}</span>`,
  emptyDiffActions: ({ onReload, onHistory }) =>
    html`<div class="empty-actions" hidden
      ><button
        type="button"
        class="empty-action empty-action-primary"
        data-empty-action="reload"
        @click=${(event: MouseEvent) =>
          onReload(event.currentTarget as HTMLButtonElement)}
      ></button
      ><a
        class="empty-action"
        data-empty-action="history"
        @click=${onHistory}
      ></a
    ></div>`,
  refSelector: (props) =>
    html`<div
      class=${`ref-selector${props.extraClass ? ` ${props.extraClass}` : ""}`}
      data-ref-selector=""
      id=${props.wrapperId || nothing}
      ?hidden=${!!props.hidden}
    ><span class="ref-selector-icon" aria-hidden="true"
        >${iconTemplate(GIT_BRANCH_16_PATH, "octicon-git-branch")}</span
      ><input
        class="ref-input"
        id=${props.id}
        readonly
        autocomplete="off"
        placeholder=${props.placeholder}
        title=${props.title || nothing}
        aria-label=${props.title || nothing}
        .value=${props.value ?? ""}
      /><span class="ref-selector-caret" aria-hidden="true"
        >${iconTemplate(TRIANGLE_DOWN_16_PATH, "octicon-triangle-down")}</span
      ></div>`,
  openPathButton: (title, onOpen) => openPathButtonTemplate(title, onOpen),
  revisionNav: ({ olderTitle, newerTitle, previous, next, onGo }) => {
    const button = (title: string, paths: IconPaths, sha: string | null) =>
      html`<button
        type="button"
        class="gdp-file-header-icon gdp-file-revision-btn"
        title=${title}
        aria-label=${title}
        ?disabled=${!sha}
        @click=${() => {
          if (sha) onGo(sha);
        }}
      >${iconTemplate(paths, "octicon-revision")}</button>`;
    return html`<span class="gdp-file-revision-nav"
      >${button(olderTitle, PREVIOUS_16_PATHS, previous)}${button(
        newerTitle,
        NEXT_16_PATHS,
        next,
      )}</span
    >`;
  },
  downloadLink: (url, fileName) =>
    html`<a href=${url} download=${fileName}></a>`,
  resizePreview: (id) => html`<div id=${id}></div>`,
  paneHost: (side) =>
    html`<div class="main-pane-host" data-side=${side}></div>`,
  paneSource: (extraClass) =>
    html`<div
      class=${extraClass ? `main-pane-source ${extraClass}` : "main-pane-source"}
      tabindex="-1"
    ><div class="main-pane-source-body"></div></div>`,
  paneMessage: (message) => html`<p class="main-pane-message">${message}</p>`,
  foreignCrumbs: ({ label, look, parts }) =>
    html`<nav
      class="gdp-file-breadcrumb main-pane-foreign-crumb"
      aria-label=${label}
    >${projectMarkTemplate(look, "main-pane-foreign-mark")}${parts.map(
      (part, index) =>
        html`${
          index > 0
            ? html`<span class="gdp-file-breadcrumb-sep">/</span>`
            : nothing
        }<span
              class=${
                index === parts.length - 1
                  ? "gdp-file-breadcrumb-current"
                  : "gdp-file-breadcrumb-part"
              }
              >${part}</span
            >`,
    )}</nav
    >`,
  hiddenSlot: () => html`<span hidden></span>`,
};

/** 箱の中身を template の結果に入れ替える (箱に描く係は置かない)。 */
export function fillWith(el: Element, template: unknown): void {
  el.replaceChildren(templateFragment(template));
}
