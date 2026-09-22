// メインの面のタブ列 (上の行の直下、`#main-tabs`)。
//
// 画面そのものは今までどおり route (URL) 1 つで決まる。タブは「開いている
// route の並び」で、押すとそのタブの route へ移るだけ。route が変わるたび
// (setRoute / applyRouteFromLocation の後) に syncRoute が呼ばれ、その route の
// タブを開くか前面に出す。だから URL・戻る・進む・既存の全部の入口
// (木・パレット・行リンク・Diff や History から開く) がそのままタブになる。
//
// 配置は core/main-tabs.ts の純関数だけで変える。タブごとの最後の route は
// ここが覚える (モデルの target は同一判定に要る分だけ: ファイルならパス)。
//
// 保存はプロジェクトごと (/_state/tabs)。読み戻しが済むまでは保存しない
// (起動直後の 1 枚だけの配置で、保存してあった配置を上書きしないため)。

import { iconSvg } from "../../core/icons";
import {
  activate,
  activateIndex,
  activeTab,
  close,
  closeOthers,
  closeToRight,
  emptyLayout,
  findTab,
  keepOpen,
  type Layout,
  move,
  nextTab,
  open,
  PAGE_KINDS,
  type PageKind,
  parseLayout,
  prevTab,
  type SerializedLayout,
  serializeLayout,
  type Tab,
  type TabTarget,
  tabMenu,
} from "../../core/main-tabs";
import type { AppRoute } from "../../core/routes";
import { basenameOf } from "../../core/terminal-board";
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

export type MainTabsDeps = {
  mount: HTMLElement;
  getLanguage(): MainTabsLang;
  /** page のタブの名前 (上の行の入口と同じ文言)。 */
  pageLabel(page: PageKind): string;
  /** その route を開く (pushState して画面を合わせる)。 */
  navigate(route: AppRoute): void;
  /** 今の画面の route (URL の最新)。タブを離れるときに覚える。 */
  currentRoute(): AppRoute;
  /** 覚えた route が無いタブ (読み戻したタブ) を開くときの route。 */
  defaultRoute(target: TabTarget): AppRoute;
  copyPath(path: string): void;
  /** ＋ボタン。 */
  onNewTab(): void;
  loadSaved(): Promise<unknown>;
  save(layout: SerializedLayout, keepalive: boolean): Promise<void>;
};

export type MainTabsHandle = {
  /** route が変わった。その route のタブを開くか前面に出す。 */
  syncRoute(route: AppRoute): void;
  /** そのファイルのタブを固定にする (木のダブルクリック)。 */
  keepFileOpen(path: string): void;
  /** page のタブがあれば、そのタブが最後に見ていた route。 */
  routeForPage(page: PageKind): AppRoute | null;
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

/** route をタブの中身に。タブにならない route は null。 */
export function routeTarget(route: AppRoute): TabTarget | null {
  switch (route.screen) {
    case "file":
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

/** 無効にしてある項目。押せないはずなので、呼ばれたら不具合として投げる。 */
function notAvailable(): never {
  throw new Error("main tabs: splitting is not available yet");
}

export function createMainTabsView(deps: MainTabsDeps): MainTabsHandle {
  let layout: Layout = emptyLayout();
  const routes = new Map<string, AppRoute>();
  let restored = false;
  let saveEnabled = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dragId: string | null = null;

  const strip = document.createElement("div");
  strip.className = "main-tabs-strip";
  strip.setAttribute("role", "tablist");
  const actions = document.createElement("div");
  actions.className = "main-tabs-actions";
  const newButton = document.createElement("button");
  newButton.type = "button";
  newButton.className = "main-tabs-action";
  newButton.innerHTML = iconSvg("main-tabs-action-icon", pageIconPaths("new"));
  newButton.addEventListener("click", () => deps.onNewTab());
  const splitButton = document.createElement("button");
  splitButton.type = "button";
  splitButton.className = "main-tabs-action";
  splitButton.disabled = true;
  splitButton.innerHTML = iconSvg(
    "main-tabs-action-icon",
    pageIconPaths("split"),
  );
  actions.append(newButton, splitButton);
  deps.mount.replaceChildren(strip, actions);

  function text() {
    return mainTabsText(deps.getLanguage());
  }

  function labelOf(target: TabTarget): string {
    switch (target.kind) {
      case "file":
      case "image":
        return basenameOf(target.path);
      case "terminal":
        return target.session;
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

  function commit(next: Layout): void {
    layout = next;
    pruneRoutes();
    render();
    scheduleSave();
  }

  function routeOf(tab: Tab): AppRoute {
    return routes.get(tab.id) ?? deps.defaultRoute(tab.target);
  }

  /** 今のタブの route を覚えてから、配置を変えて前面のタブへ移る。 */
  function changeAndGo(change: (current: Layout) => Layout): void {
    const before = activeTab(layout);
    if (before) routes.set(before.id, deps.currentRoute());
    commit(change(layout));
    const after = activeTab(layout);
    if (!after) {
      // 面が空になった。空の面は URL で表せないので Files を開く。
      deps.navigate(deps.defaultRoute({ kind: "page", page: "repo" }));
      return;
    }
    if (after.id !== before?.id) deps.navigate(routeOf(after));
  }

  function syncRoute(route: AppRoute): void {
    const target = routeTarget(route);
    if (!target) return;
    const next = open(layout, target);
    const tab = activeTab(next);
    if (tab) routes.set(tab.id, route);
    commit(next);
  }

  function menuFor(tab: Tab): ContextMenuItem[] {
    const state = tabMenu(layout, tab.id);
    const current = text();
    const path =
      tab.target.kind === "file" || tab.target.kind === "image"
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
      // 左右の分割は次の回。モデルが可と言っても、この画面ではまだ押させない。
      { label: current.splitRight, disabled: true, onSelect: notAvailable },
      {
        label: current.moveToOtherSide,
        disabled: true,
        onSelect: notAvailable,
      },
      { kind: "separator" },
      {
        label: current.copyPath,
        disabled: !state.copyPath || path === null,
        onSelect: () => {
          if (path !== null) deps.copyPath(path);
        },
      },
    ];
  }

  function dropIndex(clientX: number): number {
    const tabs = [...strip.querySelectorAll<HTMLElement>(".main-tab")];
    for (let index = 0; index < tabs.length; index += 1) {
      const rect = tabs[index].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return index;
    }
    return tabs.length;
  }

  function clearDropMarks(): void {
    for (const el of strip.querySelectorAll(".main-tab-drop-before"))
      el.classList.remove("main-tab-drop-before");
    strip.classList.remove("main-tabs-drop-end");
  }

  function renderTab(tab: Tab, active: boolean): HTMLElement {
    const current = text();
    const label = labelOf(tab.target);
    const el = document.createElement("div");
    el.className = "main-tab";
    el.classList.toggle("main-tab-active", active);
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
    icon.innerHTML = iconSvg("main-tab-svg", iconOf(tab.target));
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
    });
    el.addEventListener("dragend", () => {
      dragId = null;
      el.classList.remove("main-tab-dragging");
      clearDropMarks();
    });
    return el;
  }

  strip.addEventListener("dragover", (event) => {
    if (!dragId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    clearDropMarks();
    const index = dropIndex(event.clientX);
    const tabs = strip.querySelectorAll<HTMLElement>(".main-tab");
    if (index < tabs.length) tabs[index].classList.add("main-tab-drop-before");
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
    clearDropMarks();
    if (!found) return;
    let index = dropIndex(event.clientX);
    // 自分より右へ落とすと、自分が抜けた分だけ 1 つ左にずれる。
    if (index > found.index) index -= 1;
    const result = move(layout, id, found.side, index);
    if (result.moved === false) {
      console.error(
        `[code-viewer] main tab ${id} was not moved: ${result.reason}`,
      );
      return;
    }
    commit(result.layout);
  });
  // 縦のホイールでも横に送る (トラックパッドの無いマウスで端のタブへ行けるように)。
  strip.addEventListener(
    "wheel",
    (event) => {
      if (event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY))
        return;
      if (strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    },
    { passive: false },
  );

  function render(): void {
    const current = text();
    strip.setAttribute("aria-label", current.tabList);
    newButton.title = current.newTab;
    newButton.setAttribute("aria-label", current.newTab);
    splitButton.title = current.splitUnavailable;
    splitButton.setAttribute("aria-label", current.splitUnavailable);
    const pane = layout.panes.left;
    strip.replaceChildren(
      ...pane.tabs.map((tab) => renderTab(tab, tab.id === pane.activeId)),
    );
    strip
      .querySelector<HTMLElement>(".main-tab-active")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
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
    let next = parsed.layout;
    // この画面はまだ 1 面だけ。右の面があれば左へ寄せる (見えないタブを作らない)。
    const right = next.panes.right;
    if (right) {
      for (const tab of right.tabs)
        next = move(next, tab.id, "left", next.panes.left.tabs.length).layout;
      console.error(
        `[code-viewer] main tabs: the saved layout has a right pane; its ${right.tabs.length} tab(s) were moved to the left pane`,
      );
    }
    // この画面ではまだ開けない種類 (ターミナル・画像) は閉じる。黙って捨てない。
    const unsupported = next.panes.left.tabs.filter(
      (tab) => tab.target.kind === "terminal" || tab.target.kind === "image",
    );
    for (const tab of unsupported) next = close(next, tab.id);
    if (unsupported.length > 0)
      console.error(
        `[code-viewer] main tabs: closed ${unsupported.length} saved tab(s) that cannot be opened yet:`,
        JSON.stringify(unsupported),
      );
    // 今の画面 (URL) のタブを、読み戻した配置の上で開き直す。
    const current = activeTab(layout);
    const currentRoute = current ? routes.get(current.id) : undefined;
    routes.clear();
    layout = next;
    if (currentRoute) syncRoute(currentRoute);
    else commit(layout);
  }

  render();

  return {
    syncRoute,
    keepFileOpen(path) {
      const tab = layout.panes.left.tabs.find(
        (item) => item.target.kind === "file" && item.target.path === path,
      );
      if (tab) commit(keepOpen(layout, tab.id));
    },
    routeForPage(page) {
      const tab = layout.panes.left.tabs.find(
        (item) => item.target.kind === "page" && item.target.page === page,
      );
      return tab ? (routes.get(tab.id) ?? null) : null;
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
