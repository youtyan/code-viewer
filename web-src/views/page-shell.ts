// 設定とヘルプのページの枠: 見出し・左の目次・本文。中身は各ページ
// (views/settings-page.ts・views/help-page.ts) が組む。
//
// 枠は箱 (cv-page-shell。箱を作らない要素) の中に描く。本文を出す #diff はほかの
// 画面も中身を差し替えるので、枠を描くたびに箱が #diff に居るかを確かめ、
// 居なければ箱を作り直して置く。

import { html, nothing } from "lit/html.js";
import { phoneMediaQuery } from "./shell/workspace";
import { renderOwned, templateElement } from "./ui/renderer";

export const CV_PAGE_SHELL = "cv-page-shell";

export type PageShellNavItem =
  | { kind: "heading"; label: string }
  | { kind: "item"; label: string; active: boolean; onSelect(): void };

export type PageShellParts = {
  /** どのページの枠か。別のページから移ったら「入った」と数える。 */
  page: "settings" | "help";
  /**
   * 本文の言語 (lang 属性)。1 行の長さを言語で変える (style.css の --doc-measure。
   * ヘルプは ?lang= でアプリと別の言語を開ける)。
   */
  lang: "en" | "ja";
  title: string;
  /** 見出しの右に並べるもの (ヘルプの「キーボードショートカット」)。 */
  headerActions?: unknown;
  /** 見出しと本文の間の 1 行 (設定の検索欄)。 */
  searchRow?: unknown;
  nav: PageShellNavItem[];
  /** 本文 (article.gdp-help-content の要素かテンプレート)。 */
  article: unknown;
  /** 狭い面で目次を畳んだときの 1 行の見出し (「目次: 今の節」)。 */
  toggleText: string;
  /**
   * 節を指して開いた (設定の見出しへ送るなど)。電話の段で目次の 1 段目を
   * 飛ばしてその節を出す。
   */
  openedSection: boolean;
};

/** 枠に描くもの。 */
export type PageShellProps = {
  page: PageShellParts["page"];
  lang: PageShellParts["lang"];
  title: string;
  headerActions: unknown;
  searchRow: unknown;
  nav: (
    | { kind: "heading"; label: string }
    | { kind: "item"; label: string; active: boolean; onSelect(): void }
  )[];
  article: unknown;
  /** 狭い面の目次の開閉。 */
  toggle: { text: string; current: string; open: boolean; onToggle(): void };
};

export type PageShellView = (props: PageShellProps) => unknown;

export const DEFAULT_VIEW: PageShellView = (props) => html`<section
  class="gdp-help-shell"
  data-page=${props.page}
  lang=${props.lang}
><header class="gdp-help-header"><h1>${props.title}</h1>${
  props.headerActions ?? nothing
}</header>${props.searchRow ?? nothing}<div
  class=${props.toggle.open ? "gdp-help-layout gdp-help-nav-open" : "gdp-help-layout"}
><button
  type="button"
  class="gdp-help-nav-toggle"
  aria-controls="gdp-help-nav"
  aria-expanded=${String(props.toggle.open)}
  @click=${props.toggle.onToggle}
><span class="gdp-help-nav-toggle-label">${props.toggle.text}</span><span
  class="gdp-help-nav-toggle-current"
>${props.toggle.current}</span></button><nav class="gdp-help-nav" id="gdp-help-nav">${props.nav.map(
  (item) =>
    item.kind === "heading"
      ? html`<div class="gdp-help-nav-heading">${item.label}</div>`
      : html`<button
          type="button"
          class=${item.active ? "active" : ""}
          @click=${item.onSelect}
        >${item.label}</button>`,
)}</nav>${props.article}</div></section>`;

export function createPageShell(view: PageShellView = DEFAULT_VIEW) {
  // 狭い面 (style.css の @container help-shell) では目次を本文の上に畳む。既定は
  // 畳み、節を選んだらまた畳む (描き直しても開いたままにはしない)。
  // 電話の段では 2 段の画面: 目次を開いている間は目次だけ (1 段目)、節を選ぶと
  // 本文だけ (2 段目。頭の「‹ 目次」で 1 段目へ戻る)。ほかの画面から入ったら
  // 1 段目から (節を指して開いたときは 2 段目)。
  let navOpen = false;
  const phoneQuery = phoneMediaQuery();
  let host: HTMLElement | null = null;
  let parts: PageShellParts | null = null;

  function shellProps(current: PageShellParts): PageShellProps {
    const active = current.nav.find(
      (item): item is Extract<PageShellNavItem, { kind: "item" }> =>
        item.kind === "item" && item.active,
    );
    return {
      page: current.page,
      lang: current.lang,
      title: current.title,
      headerActions: current.headerActions,
      searchRow: current.searchRow,
      nav: current.nav.map((item) =>
        item.kind === "heading"
          ? item
          : {
              ...item,
              onSelect: () => {
                navOpen = false;
                item.onSelect();
              },
            },
      ),
      article: current.article,
      toggle: {
        text: current.toggleText,
        current: active?.label ?? "",
        open: navOpen,
        onToggle: () => {
          navOpen = !navOpen;
          draw();
        },
      },
    };
  }

  function draw(): void {
    if (host && parts) renderOwned(host, view(shellProps(parts)));
  }

  /** 枠を描いて target の中身と差し替える。返す closeNav は目次の 1 段目を閉じる。 */
  function render(
    target: HTMLElement,
    next: PageShellParts,
  ): { closeNav(): void; navOpen(): boolean } {
    const placed =
      host !== null && target.firstElementChild === host
        ? host.querySelector<HTMLElement>(":scope > .gdp-help-shell")
        : null;
    const entering = !placed || placed.dataset.page !== next.page;
    if (phoneQuery.matches && (entering || next.openedSection))
      navOpen = !next.openedSection;
    if (!placed) {
      host = templateElement(html`<cv-page-shell></cv-page-shell>`);
      target.replaceChildren(host);
    }
    parts = next;
    draw();
    return {
      closeNav: () => {
        navOpen = false;
        draw();
      },
      navOpen: () => navOpen,
    };
  }

  return { render };
}
