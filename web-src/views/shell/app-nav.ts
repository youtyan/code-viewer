// 左のサイドバー (#app-nav) の枠: 畳む・開く・幅。中身の一覧は
// views/agents/agents-sidebar.ts。
//
// 幅と畳んだかどうかは人に付く設定 (プロジェクトを移っても同じ)。幅の
// 既定・下限・上限は core/panel-sizes.ts の NAV_WIDTH だけが持ち、ここで
// --nav-w に書く。畳んでいる間は html の data-nav-collapsed が --nav-w を
// 0 にする (ui-layout.md の「既定 + 占有時に上書き」の逆向き。固定物の
// 消費側は --chrome-left しか読まないので、ここで触るのはこの 2 つだけ)。

import { attachDragResizer } from "../../core/drag-resizer";
import { clampPanelSize, NAV_WIDTH } from "../../core/panel-sizes";
import { rememberEarlyLook } from "./early-look";

export type AppNavDeps = {
  nav: HTMLElement;
  resizer: HTMLElement;
  collapseButton: HTMLElement;
  expandButton: HTMLElement;
  getWidth(): number | undefined;
  isCollapsed(): boolean;
  save(patch: { navWidth?: number; navCollapsed?: boolean }): void;
  /** 寸法が変わった後 (ターミナルの桁数の取り直しなど)。 */
  onResize(): void;
};

export type AppNav = {
  /** 設定が外から変わったとき (別のタブ・初回の読み込み)。 */
  sync(): void;
  toggle(): void;
};

export function mountAppNav(deps: AppNavDeps): AppNav {
  let width = clampPanelSize(NAV_WIDTH, deps.getWidth() ?? NAV_WIDTH.default);

  function applyWidth(next: number): void {
    width = clampPanelSize(NAV_WIDTH, next);
    document.documentElement.style.setProperty("--nav-w", `${width}px`);
  }

  function applyCollapsed(collapsed: boolean): void {
    if (collapsed) document.documentElement.dataset.navCollapsed = "";
    else delete document.documentElement.dataset.navCollapsed;
    rememberEarlyLook({ navCollapsed: collapsed, navWidth: width });
    deps.nav.hidden = collapsed;
    deps.expandButton.hidden = !collapsed;
  }

  function setCollapsed(collapsed: boolean): void {
    applyCollapsed(collapsed);
    deps.save({ navCollapsed: collapsed });
    deps.onResize();
    // 畳んだらフォーカスを開く側へ、開いたら畳む側へ (キーボードで往復できる)。
    (collapsed ? deps.expandButton : deps.collapseButton).focus({
      preventScroll: true,
    });
  }

  attachDragResizer({
    handle: deps.resizer,
    getSize: () => width,
    applySize: applyWidth,
    direction: 1,
    activeClassTarget: document.body,
    activeClassName: "gdp-nav-resizing",
    onEnd: () => {
      rememberEarlyLook({ navWidth: width });
      deps.save({ navWidth: width });
      deps.onResize();
    },
  });
  deps.resizer.addEventListener("dblclick", () => {
    applyWidth(NAV_WIDTH.default);
    rememberEarlyLook({ navWidth: width });
    deps.save({ navWidth: width });
    deps.onResize();
  });
  deps.collapseButton.addEventListener("click", () => setCollapsed(true));
  deps.expandButton.addEventListener("click", () => setCollapsed(false));

  function sync(): void {
    applyWidth(deps.getWidth() ?? NAV_WIDTH.default);
    applyCollapsed(deps.isCollapsed());
  }
  sync();
  return {
    sync,
    toggle: () =>
      setCollapsed(!("navCollapsed" in document.documentElement.dataset)),
  };
}
