// メインの面のタブ列 (上の行の直下、`#main-tabs`)。1 面か左右 2 面。
//
// ファイルと各画面 (route のタブ) の中身は今までどおり route (URL) 1 つで
// 決まり、本文は 1 つしか描けない。そこで本文は「route のタブを選んでいる面」
// (両方ならフォーカスのある面) に置き (routeSide)、もう一方の面の route の
// タブは置き札になる。ターミナルと画像のタブは面ごとの箱に描く (app.ts)。
//
// route が変わるたび (setRoute / applyRouteFromLocation の後) に syncRoute が
// 呼ばれ、その route のタブを開くか前面に出す。だから URL・戻る・進む・既存の
// 全部の入口 (木・パレット・行リンク・Diff や History から開く) がそのまま
// タブになる。
//
// 配置は core/main-tabs.ts の純関数だけで変える。タブごとの最後の route は
// ここが覚える (モデルの target は同一判定に要る分だけ: ファイルならパス)。
//
// 保存はプロジェクトごと (/_state/tabs)。読み戻しが済むまでは保存しない
// (起動直後の 1 枚だけの配置で、保存してあった配置を上書きしないため)。

import type { AgentState } from "../../core/agent-state";
import { attachDragResizer } from "../../core/drag-resizer";
import { iconSvg } from "../../core/icons";
import {
  activate,
  activateIndex,
  activeTab,
  canSplit,
  close,
  closeOthers,
  closeToRight,
  DEFAULT_SPLIT,
  emptyLayout,
  findTab,
  focusPane,
  keepOpen,
  type Layout,
  move,
  moveToOtherSide,
  nextTab,
  type OpenOptions,
  open,
  PAGE_KINDS,
  type PageKind,
  type PaneSide,
  parseLayout,
  prevTab,
  type SerializedLayout,
  sameTarget,
  serializeLayout,
  setSplit,
  splitRight,
  type Tab,
  type TabTarget,
  tabMenu,
} from "../../core/main-tabs";
import type { AppRoute } from "../../core/routes";
import { basenameOf } from "../../core/terminal-board";
import { terminalImageExtension } from "../../core/terminal-images";
import type { ContextMenuItem } from "../context-menu";
import { showContextMenu } from "../context-menu";
import { type MainTabsLang, mainTabsText } from "./i18n";
import {
  CLOSE_ICON_PATH,
  type PageIconPaths,
  pageIconPaths,
} from "./tab-icons";

/** 保存をまとめる間隔。並べ替えや連続した移動を 1 回の書き込みにする。 */
const SAVE_DELAY_MS = 300;
const DRAG_TYPE = "application/x-code-viewer-main-tab";
/** 2 面のときの各面の最小の幅 (px)。これが 2 つ置けない幅では分割しない。 */
export const MIN_PANE_WIDTH = 360;
/** 面の境界の線の幅 (px)。CSS の --split-divider-w へ JS が書く。 */
const DIVIDER_WIDTH = 1;
const SIDES: readonly PaneSide[] = ["left", "right"];

export type FrontChange = "navigate" | "sync" | "stay";

/** 面ごとの前面のタブと、本文 (route の中身) を置く面。 */
export type PanesView = {
  split: boolean;
  focused: PaneSide;
  fronts: Record<PaneSide, Tab | null>;
  /** 本文を置く面。どちらの前面も route のタブでなければ null。 */
  routeSide: PaneSide | null;
};

export type MainTabsDeps = {
  mount: HTMLElement;
  getLanguage(): MainTabsLang;
  /** page のタブの名前 (上の行の入口と同じ文言)。 */
  pageLabel(page: PageKind): string;
  /** その route を開く (replace なら履歴を積まない)。 */
  navigate(route: AppRoute, replace?: boolean): void;
  /** 今の画面の route (URL の最新)。タブを離れるときに覚える。 */
  currentRoute(): AppRoute;
  /** 覚えた route が無いタブ (読み戻したタブ) を開くときの route。 */
  defaultRoute(target: TabTarget): AppRoute;
  copyPath(path: string): void;
  /** ＋ボタン。 */
  onNewTab(): void;
  loadSaved(): Promise<unknown>;
  save(layout: SerializedLayout, keepalive: boolean): Promise<void>;
  /** ターミナルのタブの名前と状態 (エージェントを映していれば、その状態)。 */
  terminalInfo(session: string): { label: string; state: AgentState | null };
  /**
   * 面の前面のタブ・フォーカス・分割が変わった。how は URL の扱い:
   * navigate = これから route へ移る (URL はそちらが積む)、sync = URL から
   * 来た (URL は触らない)、stay = 移らずに前面だけ変わった (URL を積み直す)。
   */
  onPanes(view: PanesView, how: FrontChange): void;
  /** 開いているターミナルのタブ (一覧の印) と、閉じたもの (購読をやめる)。 */
  onTerminals(open: ReadonlySet<string>, closed: string[]): void;
};

export type MainTabsHandle = {
  /**
   * route が変わった。その route のタブを開くか前面に出す。activate = false
   * (URL の置き換えだけ) なら、前面のタブは変えずに覚えた route だけ更新する。
   */
  syncRoute(route: AppRoute, activate?: boolean): void;
  /** そのシェルのターミナルのタブを開いて前面に出す。 */
  openTerminal(session: string, pane?: OpenOptions["pane"]): void;
  /** そのシェルのターミナルのタブを閉じる (シェルは止めない)。 */
  closeTerminal(session: string): void;
  /** 画像のタブを開いて前面に出す。 */
  openImage(path: string, pane?: OpenOptions["pane"]): void;
  /** フォーカスのある面の前面のタブ。 */
  front(): Tab | null;
  /** 今の面の様子 (前面・フォーカス・本文を置く面)。 */
  panes(): PanesView;
  /** そのシェルのターミナルのタブがあるか。 */
  hasTerminal(session: string): boolean;
  /** そのファイルのタブを固定にする (木のダブルクリック)。 */
  keepFileOpen(path: string): void;
  /** page のタブがあれば、そのタブが最後に見ていた route。 */
  routeForPage(page: PageKind): AppRoute | null;
  /** 面にフォーカスを移す。2 面でなければ何もしない。 */
  focusSide(side: PaneSide): void;
  /** 画面の x 座標がどちらの面か (2 面でなければ null)。 */
  sideAt(clientX: number): PaneSide | null;
  focusOther(): void;
  next(): void;
  previous(): void;
  closeActive(): void;
  activateNth(n: number): void;
  restore(): Promise<void>;
  flush(keepalive: boolean): void;
  localize(): void;
  /** テストと確認用。 */
  layout(): Layout;
};

export function isPageKind(value: string | undefined): value is PageKind {
  return (PAGE_KINDS as readonly (string | undefined)[]).includes(value);
}

/** ファイルと各画面 (route で中身が決まり、本文に描くタブ)。 */
export function isRouteTab(tab: Tab | null): boolean {
  return tab?.target.kind === "file" || tab?.target.kind === "page";
}

/**
 * route をタブの中身に。画像のファイルを開く route (view が無いか blob) は
 * 画像のタブ。画像でも履歴・blame の route はファイルのタブ (ファイルの画面の
 * History / Blame を無くさない)。タブにならない route は null。
 */
export function routeTarget(route: AppRoute): TabTarget | null {
  switch (route.screen) {
    case "file":
      if (
        terminalImageExtension(route.path) !== null &&
        (route.view === undefined || route.view === "blob")
      )
        return { kind: "image", path: route.path };
      return route.line === undefined
        ? { kind: "file", path: route.path }
        : { kind: "file", path: route.path, line: route.line };
    case "repo":
    case "diff":
    case "history":
    case "worktree":
    case "database":
    case "journal":
    case "agents":
    case "help":
      return { kind: "page", page: route.screen };
    case "unknown":
      return null;
  }
}

function allTabs(layout: Layout): Tab[] {
  return [...layout.panes.left.tabs, ...(layout.panes.right?.tabs ?? [])];
}

function frontOf(layout: Layout, side: PaneSide): Tab | null {
  const pane = side === "left" ? layout.panes.left : layout.panes.right;
  if (!pane?.activeId) return null;
  return pane.tabs.find((tab) => tab.id === pane.activeId) ?? null;
}

/** 本文を置く面: フォーカスのある面の前面が route のタブならそこ、無ければもう一方。 */
export function routeSideOf(layout: Layout): PaneSide | null {
  const other: PaneSide = layout.focused === "left" ? "right" : "left";
  if (isRouteTab(frontOf(layout, layout.focused))) return layout.focused;
  if (layout.panes.right && isRouteTab(frontOf(layout, other))) return other;
  return null;
}

function panesView(layout: Layout): PanesView {
  return {
    split: !!layout.panes.right,
    focused: layout.focused,
    fronts: { left: frontOf(layout, "left"), right: frontOf(layout, "right") },
    routeSide: routeSideOf(layout),
  };
}

function sameView(a: PanesView, b: PanesView): boolean {
  return (
    a.split === b.split &&
    a.focused === b.focused &&
    a.routeSide === b.routeSide &&
    a.fronts.left?.id === b.fronts.left?.id &&
    a.fronts.right?.id === b.fronts.right?.id
  );
}

export function createMainTabsView(deps: MainTabsDeps): MainTabsHandle {
  let layout: Layout = emptyLayout();
  const routes = new Map<string, AppRoute>();
  let restored = false;
  let saveEnabled = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dragId: string | null = null;
  /**
   * 本文の面に合わせて route へ移るときの、元のフォーカス。移った先の
   * syncRoute がその route のタブの面へフォーカスを持って行かないようにする。
   */
  let keepFocus: PaneSide | null = null;

  // 面ごとのタブ列 (タブの並び + 右端の ＋ と分割)。
  type Section = {
    el: HTMLElement;
    strip: HTMLElement;
    newButton: HTMLButtonElement;
    splitButton: HTMLButtonElement;
  };
  const sections = {} as Record<PaneSide, Section>;
  for (const side of SIDES) sections[side] = createSection(side);

  // 面の境界。掴みしろ 6px、線は 1px (ホバー・ドラッグ中は 2px の強調)。
  const divider = document.createElement("div");
  divider.className = "main-split-divider";
  divider.role = "separator";
  divider.tabIndex = 0;
  divider.setAttribute("aria-orientation", "vertical");
  // 1 面のとき、タブを右端へドラッグすると出る分割のドロップ先。
  const dropZone = document.createElement("div");
  dropZone.className = "main-split-drop";
  dropZone.hidden = true;
  const dropIcon = document.createElement("span");
  dropIcon.className = "main-split-drop-icon";
  dropIcon.innerHTML = iconSvg("main-tabs-action-icon", pageIconPaths("split"));
  const dropLabel = document.createElement("span");
  dropLabel.className = "main-split-drop-label";
  dropZone.append(dropIcon, dropLabel);
  document.body.append(divider, dropZone);

  function text() {
    return mainTabsText(deps.getLanguage());
  }

  function createSection(side: PaneSide): Section {
    const el = document.createElement("div");
    el.className = "main-tabs-pane";
    el.dataset.side = side;
    const strip = document.createElement("div");
    strip.className = "main-tabs-strip";
    strip.setAttribute("role", "tablist");
    const actions = document.createElement("div");
    actions.className = "main-tabs-actions";
    const newButton = document.createElement("button");
    newButton.type = "button";
    newButton.className = "main-tabs-action";
    newButton.innerHTML = iconSvg(
      "main-tabs-action-icon",
      pageIconPaths("new"),
    );
    newButton.addEventListener("click", () => {
      focusSide(side);
      deps.onNewTab();
    });
    const splitButton = document.createElement("button");
    splitButton.type = "button";
    splitButton.className = "main-tabs-action";
    splitButton.innerHTML = iconSvg(
      "main-tabs-action-icon",
      pageIconPaths("split"),
    );
    splitButton.addEventListener("click", () => {
      const front = frontOf(layout, "left");
      if (front && splitAllowed()) changeAndGo((l) => splitRight(l, front.id));
    });
    actions.append(newButton, splitButton);
    el.append(strip, actions);
    wireStrip(strip, side);
    return { el, strip, newButton, splitButton };
  }

  function labelOf(target: TabTarget): string {
    switch (target.kind) {
      case "file":
      case "image":
        return basenameOf(target.path);
      case "terminal":
        return deps.terminalInfo(target.session).label;
      case "page":
        return deps.pageLabel(target.page);
    }
  }

  function iconOf(target: TabTarget): PageIconPaths {
    switch (target.kind) {
      case "file":
        return pageIconPaths("file");
      case "image":
        return pageIconPaths("image");
      case "terminal":
        return pageIconPaths("terminal");
      case "page":
        return pageIconPaths(target.page);
    }
  }

  // ---- 幅 ----

  /** 本文の横幅 (左のサイドバーの右から窓の右端まで)。 */
  function mainWidth(): number {
    const left = deps.mount.getBoundingClientRect().left;
    return document.documentElement.clientWidth - left;
  }

  /** 2 面を置ける幅か。 */
  function splitAllowed(): boolean {
    return mainWidth() >= MIN_PANE_WIDTH * 2 + DIVIDER_WIDTH;
  }

  /** 比から左の面の幅 (px) を決める。最小幅を守れない窓では半分。 */
  function leftWidthFor(ratio: number): number {
    const width = mainWidth();
    const max = width - MIN_PANE_WIDTH - DIVIDER_WIDTH;
    if (max < MIN_PANE_WIDTH) return Math.round((width - DIVIDER_WIDTH) / 2);
    return Math.min(max, Math.max(MIN_PANE_WIDTH, Math.round(width * ratio)));
  }

  /** 面の幅を CSS 変数に書く (TS が出所。ui-layout.md の「JS 側に出るジオメトリ」)。 */
  function applyGeometry(): void {
    const root = document.documentElement.style;
    const split = !!layout.panes.right;
    document.body.classList.toggle("main-split", split);
    root.setProperty("--main-w", `${mainWidth()}px`);
    if (!split) {
      root.removeProperty("--split-left-w");
      root.removeProperty("--split-right-w");
      return;
    }
    const left = leftWidthFor(layout.split ?? DEFAULT_SPLIT);
    root.setProperty("--split-left-w", `${left}px`);
    root.setProperty(
      "--split-right-w",
      `${mainWidth() - left - DIVIDER_WIDTH}px`,
    );
    root.setProperty("--split-divider-w", `${DIVIDER_WIDTH}px`);
  }

  attachDragResizer({
    handle: divider,
    getSize: () => leftWidthFor(layout.split ?? DEFAULT_SPLIT),
    applySize: (size) => {
      const width = mainWidth();
      const clamped = Math.min(
        width - MIN_PANE_WIDTH - DIVIDER_WIDTH,
        Math.max(MIN_PANE_WIDTH, size),
      );
      // ドラッグ中は描き直さず、比と幅だけ変える。保存は onEnd で。
      layout = setSplit(layout, clamped / width);
      applyGeometry();
    },
    direction: 1,
    axis: "x",
    onEnd: () => scheduleSave(),
    activeClassTarget: document.body,
    activeClassName: "main-split-resizing",
  });
  new ResizeObserver(() => {
    applyGeometry();
    renderActions();
  }).observe(deps.mount);

  // ---- 保存 ----

  function scheduleSave(): void {
    if (!saveEnabled) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flush(false), SAVE_DELAY_MS);
  }

  function flush(keepalive: boolean): void {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    deps.save(serializeLayout(layout), keepalive).catch((error: unknown) => {
      console.error("[code-viewer] main tabs could not be saved", error);
    });
  }

  /** モデルから消えたタブの route を忘れる。 */
  function pruneRoutes(): void {
    for (const id of [...routes.keys()])
      if (!findTab(layout, id)) routes.delete(id);
  }

  function terminalsOf(target: Layout): Set<string> {
    const out = new Set<string>();
    for (const tab of allTabs(target))
      if (tab.target.kind === "terminal") out.add(tab.target.session);
    return out;
  }

  function routeOf(tab: Tab): AppRoute {
    return routes.get(tab.id) ?? deps.defaultRoute(tab.target);
  }

  function commit(next: Layout, how: FrontChange = "stay"): void {
    const before = panesView(layout);
    const terminalsBefore = terminalsOf(layout);
    layout = next;
    pruneRoutes();
    applyGeometry();
    render();
    scheduleSave();
    const terminals = terminalsOf(layout);
    const closed = [...terminalsBefore].filter((id) => !terminals.has(id));
    if (
      closed.length > 0 ||
      [...terminals].some((id) => !terminalsBefore.has(id))
    )
      deps.onTerminals(terminals, closed);
    const after = panesView(layout);
    if (!sameView(before, after)) deps.onPanes(after, how);
    followRouteSide(how);
  }

  /**
   * 本文の面の前面のタブと、いま描いている route が食い違ったら、その
   * タブの route へ移る (面を閉じた・フォーカスを移した後など)。フォーカスは
   * そのまま。URL から来たとき (sync) は履歴を積まない。
   */
  function followRouteSide(how: FrontChange): void {
    if (how === "navigate") return;
    const side = routeSideOf(layout);
    const tab = side ? frontOf(layout, side) : null;
    if (!tab) return;
    const route = routeOf(tab);
    if (JSON.stringify(route) === JSON.stringify(deps.currentRoute())) return;
    keepFocus = layout.focused;
    deps.navigate(route, how === "sync");
  }

  /**
   * 今のタブの route を覚えてから、配置を変えて前面のタブへ移る。ターミナルと
   * 画像のタブは route を持たない (本文の route は下に残ったまま)。その route
   * のタブへ戻るだけなら移り直さない (描き直してスクロールを失わない)。
   */
  function changeAndGo(change: (current: Layout) => Layout): void {
    rememberRoute();
    const next = change(layout);
    const after = activeTab(next);
    if (!after) {
      commit(next, "navigate");
      // 面が空になった。空の面は URL で表せないので Files を開く。
      deps.navigate(deps.defaultRoute({ kind: "page", page: "repo" }));
      return;
    }
    if (!isRouteTab(after)) {
      commit(next, "stay");
      return;
    }
    const route = routeOf(after);
    if (JSON.stringify(route) === JSON.stringify(deps.currentRoute())) {
      commit(next, "stay");
      return;
    }
    commit(next, "navigate");
    deps.navigate(route);
  }

  /** 本文に出ている route のタブの、今の route を覚える。 */
  function rememberRoute(): void {
    const side = routeSideOf(layout);
    const tab = side ? frontOf(layout, side) : null;
    if (tab) routes.set(tab.id, deps.currentRoute());
  }

  function syncRoute(route: AppRoute, activateTab = true): void {
    const target = routeTarget(route);
    if (!target) return;
    if (!activateTab && routeSideOf(layout) === null) {
      // 前面はターミナルか画像のまま。下に残っている画面の route だけ覚え直す。
      const existing = allTabs(layout).find((tab) =>
        sameTarget(tab.target, target),
      );
      if (existing) routes.set(existing.id, route);
      return;
    }
    let next = open(layout, target);
    const tab = activeTab(next);
    if (tab && isRouteTab(tab)) routes.set(tab.id, route);
    if (keepFocus) {
      next = focusPane(next, keepFocus);
      keepFocus = null;
    }
    commit(next, "sync");
  }

  function focusSide(side: PaneSide): void {
    if (!layout.panes.right || layout.focused === side) return;
    rememberRoute();
    commit(focusPane(layout, side));
  }

  function menuFor(tab: Tab): ContextMenuItem[] {
    const state = tabMenu(layout, tab.id);
    const current = text();
    const path =
      tab.target.kind === "file" || tab.target.kind === "image"
        ? tab.target.path
        : null;
    const repoImage =
      tab.target.kind === "image" && !tab.target.path.startsWith("/")
        ? tab.target.path
        : null;
    return [
      {
        label: current.close,
        disabled: !state.close,
        onSelect: () => changeAndGo((l) => close(l, tab.id)),
      },
      {
        label: current.closeOthers,
        disabled: !state.closeOthers,
        onSelect: () => changeAndGo((l) => closeOthers(l, tab.id)),
      },
      {
        label: current.closeToRight,
        disabled: !state.closeToRight,
        onSelect: () => changeAndGo((l) => closeToRight(l, tab.id)),
      },
      { kind: "separator" },
      {
        label: current.keepOpen,
        disabled: !state.keepOpen,
        onSelect: () => commit(keepOpen(layout, tab.id)),
      },
      {
        label: current.splitRight,
        // 狭くて 2 面が置けない幅では無効 (モデルの可否に幅の条件を足す)。
        disabled: !state.splitRight || !splitAllowed(),
        onSelect: () => changeAndGo((l) => splitRight(l, tab.id)),
      },
      {
        label: current.moveToOtherSide,
        disabled: !state.moveToOtherSide,
        onSelect: () => changeAndGo((l) => moveToOtherSide(l, tab.id)),
      },
      { kind: "separator" },
      // リポジトリの中の画像は、ファイルの画面の履歴 (History) へ行けるように。
      ...(repoImage !== null
        ? [
            {
              label: current.fileHistory,
              onSelect: () => {
                const route = deps.defaultRoute({
                  kind: "file",
                  path: repoImage,
                });
                if (route.screen !== "file")
                  throw new Error(
                    `main tabs: the file route of ${repoImage} is ${route.screen}`,
                  );
                deps.navigate({ ...route, view: "history" });
              },
            },
          ]
        : []),
      {
        label: current.copyPath,
        disabled: !state.copyPath || path === null,
        onSelect: () => {
          if (path !== null) deps.copyPath(path);
        },
      },
    ];
  }

  // ---- ドラッグ ----

  function dropIndex(strip: HTMLElement, clientX: number): number {
    const tabs = [...strip.querySelectorAll<HTMLElement>(".main-tab")];
    for (let index = 0; index < tabs.length; index += 1) {
      const rect = tabs[index].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return index;
    }
    return tabs.length;
  }

  function clearDropMarks(): void {
    for (const el of document.querySelectorAll(".main-tab-drop-before"))
      el.classList.remove("main-tab-drop-before");
    for (const side of SIDES)
      sections[side].strip.classList.remove("main-tabs-drop-end");
    dropZone.classList.remove("main-split-drop-over");
  }

  function endDrag(): void {
    dragId = null;
    clearDropMarks();
    dropZone.hidden = true;
    document.body.classList.remove("main-tab-dragging");
  }

  function wireStrip(strip: HTMLElement, side: PaneSide): void {
    strip.addEventListener("dragover", (event) => {
      if (!dragId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      clearDropMarks();
      const index = dropIndex(strip, event.clientX);
      const tabs = strip.querySelectorAll<HTMLElement>(".main-tab");
      if (index < tabs.length)
        tabs[index].classList.add("main-tab-drop-before");
      else strip.classList.add("main-tabs-drop-end");
    });
    strip.addEventListener("dragleave", (event) => {
      if (!strip.contains(event.relatedTarget as Node | null)) clearDropMarks();
    });
    strip.addEventListener("drop", (event) => {
      if (!dragId) return;
      event.preventDefault();
      const id = dragId;
      const found = findTab(layout, id);
      const index0 = dropIndex(strip, event.clientX);
      endDrag();
      if (!found) return;
      // 同じ面で自分より右へ落とすと、自分が抜けた分だけ 1 つ左にずれる。
      const index =
        found.side === side && index0 > found.index ? index0 - 1 : index0;
      const result = move(layout, id, side, index);
      if (result.moved === false) {
        console.error(
          `[code-viewer] main tab ${id} was not moved: ${result.reason}`,
        );
        return;
      }
      if (found.side === side) commit(result.layout);
      else changeAndGo(() => result.layout);
    });
    // 縦のホイールでも横に送る (トラックパッドの無いマウスで端のタブへ行けるように)。
    strip.addEventListener(
      "wheel",
      (event) => {
        if (
          event.deltaY === 0 ||
          Math.abs(event.deltaX) > Math.abs(event.deltaY)
        )
          return;
        if (strip.scrollWidth <= strip.clientWidth) return;
        event.preventDefault();
        strip.scrollLeft += event.deltaY;
      },
      { passive: false },
    );
  }

  dropZone.addEventListener("dragover", (event) => {
    if (!dragId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dropZone.classList.add("main-split-drop-over");
  });
  dropZone.addEventListener("dragleave", () =>
    dropZone.classList.remove("main-split-drop-over"),
  );
  dropZone.addEventListener("drop", (event) => {
    if (!dragId) return;
    event.preventDefault();
    const id = dragId;
    endDrag();
    changeAndGo((l) => splitRight(l, id));
  });

  function renderTab(tab: Tab, active: boolean, side: PaneSide): HTMLElement {
    const current = text();
    const label = labelOf(tab.target);
    const el = document.createElement("div");
    el.className = "main-tab";
    el.classList.toggle("main-tab-active", active);
    // 上端の線はフォーカスのある面の選択タブだけ (もう一方は面の明るさ)。
    el.classList.toggle(
      "main-tab-focused",
      active && (!layout.panes.right || layout.focused === side),
    );
    el.classList.toggle("main-tab-preview", tab.preview);
    el.classList.toggle("main-tab-file", tab.target.kind === "file");
    el.dataset.tabId = tab.id;
    el.dataset.kind = tab.target.kind;
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(active));
    el.tabIndex = active ? 0 : -1;
    el.draggable = true;
    el.title =
      tab.target.kind === "file" || tab.target.kind === "image"
        ? tab.target.path
        : label;
    if (tab.preview) el.title += `\n${current.previewHint}`;
    const icon = document.createElement("span");
    icon.className = "main-tab-icon";
    const state =
      tab.target.kind === "terminal"
        ? deps.terminalInfo(tab.target.session).state
        : null;
    // エージェントを映しているターミナルは、絵の代わりに状態の印 (形で区別する)。
    icon.innerHTML = state
      ? `<i class="terminal-mark terminal-mark-${state}" aria-hidden="true"></i>`
      : iconSvg("main-tab-svg", iconOf(tab.target));
    const name = document.createElement("span");
    name.className = "main-tab-name";
    name.textContent = label;
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "main-tab-close";
    closeButton.tabIndex = -1;
    closeButton.title = current.closeTab(label);
    closeButton.setAttribute("aria-label", current.closeTab(label));
    closeButton.innerHTML = iconSvg("main-tab-close-svg", CLOSE_ICON_PATH);
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      changeAndGo((l) => close(l, tab.id));
    });
    el.append(icon, name, closeButton);

    el.addEventListener("click", () => {
      if (activeTab(layout)?.id === tab.id) return;
      changeAndGo((l) => activate(l, tab.id));
    });
    el.addEventListener("dblclick", (event) => {
      if ((event.target as Element).closest(".main-tab-close")) return;
      commit(keepOpen(layout, tab.id));
    });
    // 中ボタンで閉じる。
    el.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      changeAndGo((l) => close(l, tab.id));
    });
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showContextMenu(el, menuFor(tab), {
        at: { x: event.clientX, y: event.clientY },
      });
    });
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        el.click();
      }
    });
    el.addEventListener("dragstart", (event) => {
      dragId = tab.id;
      event.dataTransfer?.setData(DRAG_TYPE, tab.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      el.classList.add("main-tab-dragging");
      document.body.classList.add("main-tab-dragging");
      // 1 面で分割できるときだけ、右に分割のドロップ先を出す。
      dropZone.hidden = !(
        !layout.panes.right &&
        canSplit(layout) &&
        layout.panes.left.tabs.length > 1 &&
        splitAllowed()
      );
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("main-tab-dragging");
      endDrag();
    });
    return el;
  }

  function renderActions(): void {
    const current = text();
    const split = !!layout.panes.right;
    const allowed =
      !split && layout.panes.left.tabs.length > 1 && splitAllowed();
    for (const side of SIDES) {
      const { newButton, splitButton, strip } = sections[side];
      strip.setAttribute("aria-label", current.tabList);
      newButton.title = current.newTab;
      newButton.setAttribute("aria-label", current.newTab);
      // 2 面のときと、狭くて置けないときは無効。
      splitButton.disabled = !allowed;
      const label = allowed ? current.splitRight : current.splitUnavailable;
      splitButton.title = label;
      splitButton.setAttribute("aria-label", label);
    }
    divider.setAttribute("aria-label", current.resizeSplit);
    dropLabel.textContent = current.dropToSplit;
  }

  function render(): void {
    const present = SIDES.filter((side) =>
      side === "left" ? true : !!layout.panes.right,
    );
    deps.mount.replaceChildren(...present.map((side) => sections[side].el));
    for (const side of present) {
      const pane = side === "left" ? layout.panes.left : layout.panes.right;
      if (!pane) continue;
      const strip = sections[side].strip;
      strip.replaceChildren(
        ...pane.tabs.map((tab) =>
          renderTab(tab, tab.id === pane.activeId, side),
        ),
      );
      sections[side].el.classList.toggle(
        "main-tabs-pane-focused",
        layout.focused === side,
      );
      strip
        .querySelector<HTMLElement>(".main-tab-active")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    renderActions();
  }

  async function restore(): Promise<void> {
    if (restored) return;
    restored = true;
    let saved: unknown;
    try {
      saved = await deps.loadSaved();
    } catch (error) {
      // 読めなかった配置を、この画面の配置で上書きしない。
      console.error(
        "[code-viewer] main tabs: the saved layout could not be loaded; tabs are not saved on this page",
        error,
      );
      return;
    }
    saveEnabled = true;
    if (saved === null || saved === undefined) {
      scheduleSave();
      return;
    }
    let parsed: ReturnType<typeof parseLayout>;
    try {
      parsed = parseLayout(saved);
    } catch (error) {
      console.error(
        "[code-viewer] main tabs: the saved layout is broken; starting from an empty layout. saved value:",
        JSON.stringify(saved),
        error,
      );
      scheduleSave();
      return;
    }
    if (parsed.dropped.length > 0)
      console.error(
        `[code-viewer] main tabs: dropped ${parsed.dropped.length} saved tab(s) of an unknown kind:`,
        JSON.stringify(parsed.dropped),
      );
    // 今の画面 (URL) の route。保存した配置がその route を見せていた (本文の面の
    // 前面か、フォーカスのある面の前面がそのタブ) なら、保存した前面をそのまま
    // 使う (ターミナルや画像を前面にしたまま再読み込みしても、URL に出ている
    // 下の route のタブが前へ出てこない)。そうでなければ (別の URL を開いた)
    // その route のタブを開いて前面に出す。
    const urlRoute = deps.currentRoute();
    const target = routeTarget(urlRoute);
    routes.clear();
    const restoredLayout = parsed.layout;
    const shown = [routeSideOf(restoredLayout), restoredLayout.focused]
      .map((side) => (side ? frontOf(restoredLayout, side) : null))
      .filter((tab): tab is Tab => tab !== null);
    // 本文を出す面が無い (前面がどちらもターミナルか画像) なら、URL は下に
    // 残った route を指している。そのタブが配置にあれば一致とみなす。
    const agrees =
      target !== null &&
      (shown.some((tab) => sameTarget(tab.target, target)) ||
        (routeSideOf(restoredLayout) === null &&
          allTabs(restoredLayout).some((tab) =>
            sameTarget(tab.target, target),
          )));
    layout = restoredLayout;
    if (agrees && target) {
      const tab = allTabs(restoredLayout).find((item) =>
        sameTarget(item.target, target),
      );
      if (tab && isRouteTab(tab)) routes.set(tab.id, urlRoute);
      commit(layout, "sync");
    } else syncRoute(urlRoute);
    // 読み戻した面をそのまま知らせる (前面のターミナルかどうかは URL が決める)。
    deps.onTerminals(terminalsOf(layout), []);
    deps.onPanes(panesView(layout), "sync");
  }

  function findTerminal(session: string): Tab | undefined {
    return allTabs(layout).find(
      (item) =>
        item.target.kind === "terminal" && item.target.session === session,
    );
  }

  applyGeometry();
  render();

  return {
    syncRoute,
    openTerminal(session, pane = "focused") {
      rememberRoute();
      commit(open(layout, { kind: "terminal", session }, { pane }));
    },
    closeTerminal(session) {
      const tab = findTerminal(session);
      if (tab) changeAndGo((l) => close(l, tab.id));
    },
    openImage(path, pane = "focused") {
      rememberRoute();
      commit(open(layout, { kind: "image", path }, { pane }));
    },
    front: () => activeTab(layout),
    panes: () => panesView(layout),
    hasTerminal: (session) => findTerminal(session) !== undefined,
    keepFileOpen(path) {
      const tab = allTabs(layout).find(
        (item) =>
          (item.target.kind === "file" || item.target.kind === "image") &&
          item.target.path === path,
      );
      if (tab) commit(keepOpen(layout, tab.id));
    },
    routeForPage(page) {
      const tab = allTabs(layout).find(
        (item) => item.target.kind === "page" && item.target.page === page,
      );
      return tab ? (routes.get(tab.id) ?? null) : null;
    },
    focusSide,
    sideAt(clientX) {
      if (!layout.panes.right) return null;
      const left = deps.mount.getBoundingClientRect().left;
      return clientX < left + leftWidthFor(layout.split ?? DEFAULT_SPLIT)
        ? "left"
        : "right";
    },
    focusOther() {
      focusSide(layout.focused === "left" ? "right" : "left");
    },
    next: () => changeAndGo(nextTab),
    previous: () => changeAndGo(prevTab),
    closeActive() {
      const tab = activeTab(layout);
      if (tab) changeAndGo((l) => close(l, tab.id));
    },
    activateNth: (n) => changeAndGo((l) => activateIndex(l, n)),
    restore,
    flush,
    localize: render,
    layout: () => layout,
  };
}
