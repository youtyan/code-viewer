// 設定とヘルプのページの枠: 見出し・左の目次・本文。中身は各ページ
// (views/settings-page.ts・views/help-page.ts) が組む。

import { PHONE_MEDIA_QUERY } from "../core/mobile-layout";

export type PageShellNavItem =
  | { kind: "heading"; label: string }
  | { kind: "item"; label: string; active: boolean; onSelect(): void };

export type PageShellParts = {
  /** どのページの枠か。別のページから移ったら「入った」と数える。 */
  page: "settings" | "help";
  title: string;
  /** 見出しの右に並べるもの (ヘルプの「キーボードショートカット」)。 */
  headerActions?: HTMLElement[];
  /** 見出しと本文の間の 1 行 (設定の検索欄)。 */
  searchRow?: HTMLElement;
  nav: PageShellNavItem[];
  article: HTMLElement;
  /** 狭い面で目次を畳んだときの 1 行の見出し (「目次: 今の節」)。 */
  toggleText: string;
  /**
   * 節を指して開いた (設定の見出しへ送るなど)。電話の段で目次の 1 段目を
   * 飛ばしてその節を出す。
   */
  openedSection: boolean;
};

export function createPageShell() {
  // 狭い面 (style.css の @container help-shell) では目次を本文の上に畳む。既定は
  // 畳み、節を選んだらまた畳む (描き直しても開いたままにはしない)。
  // 電話の段では 2 段の画面: 目次を開いている間は目次だけ (1 段目)、節を選ぶと
  // 本文だけ (2 段目。頭の「‹ 目次」で 1 段目へ戻る)。ほかの画面から入ったら
  // 1 段目から (節を指して開いたときは 2 段目)。
  let navOpen = false;
  const phoneQuery = window.matchMedia(PHONE_MEDIA_QUERY);

  /** 枠を描いて target の中身と差し替える。返す closeNav は目次の 1 段目を閉じる。 */
  function render(
    target: HTMLElement,
    parts: PageShellParts,
  ): { closeNav(): void; navOpen(): boolean } {
    const current = target.firstElementChild;
    const entering =
      !(current instanceof HTMLElement) ||
      !current.classList.contains("gdp-help-shell") ||
      current.dataset.page !== parts.page;
    if (phoneQuery.matches && (entering || parts.openedSection))
      navOpen = !parts.openedSection;

    const shell = document.createElement("section");
    shell.className = "gdp-help-shell";
    shell.dataset.page = parts.page;
    const header = document.createElement("header");
    header.className = "gdp-help-header";
    const title = document.createElement("h1");
    title.textContent = parts.title;
    header.append(title, ...(parts.headerActions ?? []));

    const layout = document.createElement("div");
    layout.className = "gdp-help-layout";
    const nav = document.createElement("nav");
    nav.className = "gdp-help-nav";
    nav.id = "gdp-help-nav";
    let activeLabel = "";
    for (const item of parts.nav) {
      if (item.kind === "heading") {
        const heading = document.createElement("div");
        heading.className = "gdp-help-nav-heading";
        heading.textContent = item.label;
        nav.appendChild(heading);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = item.active ? "active" : "";
      button.textContent = item.label;
      if (item.active) activeLabel = item.label;
      button.addEventListener("click", () => {
        navOpen = false;
        item.onSelect();
      });
      nav.appendChild(button);
    }

    // 狭い面だけで見える、目次を開閉する 1 行 (広い面では CSS が隠す)。
    const navToggle = document.createElement("button");
    navToggle.type = "button";
    navToggle.className = "gdp-help-nav-toggle";
    navToggle.setAttribute("aria-controls", nav.id);
    const syncNavOpen = () => {
      layout.classList.toggle("gdp-help-nav-open", navOpen);
      navToggle.setAttribute("aria-expanded", String(navOpen));
    };
    const toggleLabel = document.createElement("span");
    toggleLabel.className = "gdp-help-nav-toggle-label";
    toggleLabel.textContent = parts.toggleText;
    const toggleCurrent = document.createElement("span");
    toggleCurrent.className = "gdp-help-nav-toggle-current";
    toggleCurrent.textContent = activeLabel;
    navToggle.append(toggleLabel, toggleCurrent);
    navToggle.addEventListener("click", () => {
      navOpen = !navOpen;
      syncNavOpen();
    });
    syncNavOpen();

    layout.append(navToggle, nav, parts.article);
    shell.append(header, ...(parts.searchRow ? [parts.searchRow] : []), layout);
    target.replaceChildren(shell);
    return {
      closeNav: () => {
        navOpen = false;
        syncNavOpen();
      },
      navOpen: () => navOpen,
    };
  }

  return { render };
}
