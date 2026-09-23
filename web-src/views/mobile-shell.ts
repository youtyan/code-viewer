// 電話の幅 (SP) の骨格: 左のサイドバーの引き出し (drawer)・右の列を下から
// 出す面 (sheet)・下端の切替の帯・端末の操作札。
//
// 配置と見た目は style.css 末尾の「Phone (SP)」の節が media query だけで決める
// (JS が動く前の初回描画から崩れない)。ここが持つのは開け閉めの状態
// (body の mobile-nav-open / mobile-sheet-open) と、デスクトップでは要らない
// 部品を hidden にすることだけ。デスクトップ (幅の段が desktop で、指の画面でも
// ない) では足した部品は全部 hidden で、骨格の class も付けない。
//
// 幅の段の判定は core/mobile-layout.ts の viewportTier。CSS の条件
// (PHONE_MEDIA_QUERY) と同じ。

import {
  iconSvg,
  SIDEBAR_HIDE_16_PATHS,
  SIDEBAR_SHOW_16_PATHS,
} from "../core/icons";
import {
  bottomSwipeAction,
  drawerDragOffset,
  edgeSwipeAction,
  LONG_PRESS_MS,
  LONG_PRESS_TARGETS,
  longPressMoved,
  type MobileBarView,
  mobileBarCurrent,
  PHONE_MEDIA_QUERY,
  pinchFontSize,
  softKeyboardInset,
  TERMINAL_SOFT_KEYS,
  type TerminalSoftKey,
  TOUCH_MEDIA_QUERY,
  type ViewportTier,
  viewportTier,
} from "../core/mobile-layout";
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from "../core/tmux";
import type { TabListEntry } from "./main-tabs/main-tabs-view";
import { CLOSE_ICON_PATH, pageIconPaths } from "./main-tabs/tab-icons";
import {
  type MobileShellLang,
  type MobileShellText,
  mobileShellText,
  SOFT_KEY_CAPS,
} from "./mobile-shell-i18n";

export type MobileShellDeps = {
  getLanguage(): MobileShellLang;
  /** 前面 (左の面) の端末へ操作札のキーを送る。 */
  sendTerminalKey(key: TerminalSoftKey): void;
  /** 前面 (左の面) の端末に入力を向ける (ソフトキーボードが出る)。 */
  focusTerminal(): void;
  /**
   * 開いているタブの一覧の面 (電話の段のタブ列の右端の入口から開く。
   * main-tabs-view.ts の tabList など)。無ければ面を作らない。
   */
  tabs?: MobileTabsDeps;
  /** 左の面の端末の文字の大きさ (電話の段の値)。ピンチで変える。 */
  terminalFontSize?(): number;
  setTerminalFontSize?(size: number): void;
};

export type MobileTabsDeps = {
  list(): TabListEntry[];
  bringToFront(id: string): void;
  close(id: string): void;
  /** タブ列を描き直したら呼ぶ。外す関数を返す。 */
  onRender(listener: () => void): () => void;
};

export type MobileShell = {
  /** 今の幅の段。 */
  tier(): ViewportTier;
  openDrawer(): void;
  openSheet(): void;
  /** 開いているタブの一覧の面を開く。 */
  openTabs(): void;
  /** 開いている引き出し・面を閉じる。 */
  close(): void;
  /** 下端の帯の「エージェント」に出す入力待ちの件数 (0 で札を隠す)。 */
  setWaitingAgents(count: number): void;
  /** 足した部品と見張りを外す (テスト用。アプリは一度だけ作る)。 */
  dispose(): void;
};

type Panel = "drawer" | "sheet" | "tabs";

const OPEN_CLASS: Record<Panel, string> = {
  drawer: "mobile-nav-open",
  sheet: "mobile-sheet-open",
  tabs: "mobile-tabs-open",
};

/** ピンチで端末の文字を変える場所 (左の面の端末)。 */
const TERMINAL_HOST = '.main-pane-host[data-side="left"][data-kind="terminal"]';

/** 押したら引き出しを閉じるもの (移る・開く)。山形や行の操作では閉じない。 */
const DRAWER_CLOSING_TARGETS =
  ".nav-agent, .nav-project-toggle, a[href], #nav-launch, #search-btn, #quick-help-btn";

/**
 * 押したら面を閉じるもの (ファイル・画面の入口)。フォルダの行では閉じない。
 * History のコミットでも閉じない: 面の下の段にそのコミットの変更ファイルが
 * 出るので (style.css の SP の節)、続けてファイルを選べる。
 */
function closesSheet(target: Element): boolean {
  if (target.closest(".view-strip-item")) return true;
  // ファイル一覧 (#file-list-rows) と変更ファイルの一覧 (#filelist) の行。
  const row = target.closest("#filelist li, #file-list-rows li");
  return row !== null && !row.classList.contains("tree-dir");
}

function requireElement(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found)
    throw new Error(`mobile shell: ${selector} is missing from index.html`);
  return found;
}

export function installMobileShell(deps: MobileShellDeps): MobileShell {
  const app = requireElement("#app");
  const nav = requireElement("#app-nav");
  const lead = requireElement("#tabs-lead");
  const phoneQuery = window.matchMedia(PHONE_MEDIA_QUERY);
  const touchQuery = window.matchMedia(TOUCH_MEDIA_QUERY);

  const topbar = requireElement("#topbar");
  const listening = new AbortController();
  const { signal } = listening;
  let current: ViewportTier = "desktop";
  let open: Panel | null = null;
  let waitingAgents = 0;
  /** 開く前にフォーカスがあった場所 (閉じたら戻す)。 */
  let returnFocus: HTMLElement | null = null;

  const menuButton = document.createElement("button");
  menuButton.id = "mobile-nav-open";
  menuButton.type = "button";
  // global-icon-action を付けない: その規則は display を決めるので、デスクトップで
  // hidden にしても場所を取る (タブ列の左が 28px 広がった)。見た目は SP の節だけ。
  menuButton.className = "mobile-nav-button";
  menuButton.setAttribute("aria-controls", "app-nav");
  menuButton.innerHTML = iconSvg("mobile-nav-icon", SIDEBAR_SHOW_16_PATHS);
  menuButton.addEventListener("click", () => toggle("drawer"));
  lead.prepend(menuButton);

  const scrim = document.createElement("div");
  scrim.id = "mobile-scrim";
  scrim.className = "mobile-scrim";
  scrim.addEventListener("click", () => close());

  // 下端の切替の帯。電話で使う 3 場面 (エージェント・Diff とファイル・
  // プロジェクト) の入口だけを置く。画面へ移るものは既存の入口のリンクを
  // 押す (タブの開き方・URL は入口と同じ経路に任せる)。
  const bar = document.createElement("nav");
  bar.id = "mobile-bar";
  bar.className = "mobile-bar";
  const barItems = {
    projects: barButton(SIDEBAR_SHOW_16_PATHS, () => toggle("drawer")),
    files: barButton(pageIconPaths("repo"), () =>
      followLink('a.view-strip-item[data-route="repo"]'),
    ),
    diff: barButton(pageIconPaths("diff"), () =>
      followLink('a.view-strip-item[data-route="diff"]'),
    ),
    agents: barButton(pageIconPaths("agents"), () =>
      followLink("#nav-board-link"),
    ),
    list: barButton(SIDEBAR_HIDE_16_PATHS, () => toggle("sheet")),
  };
  barItems.projects.setAttribute("aria-controls", "app-nav");
  // 面に出すのはファイル一覧か、一覧を出す画面ではその一覧 (style.css の SP の節)。
  barItems.list.setAttribute("aria-controls", "file-list sidebar");
  bar.append(...Object.values(barItems));
  // 「エージェント」の入力待ちの件数の札 (最下段の件数と同じ数え方。app.ts が渡す)。
  const agentsBadge = document.createElement("span");
  agentsBadge.className = "mobile-bar-badge";
  agentsBadge.setAttribute("aria-hidden", "true");
  agentsBadge.hidden = true;
  barItems.agents.append(agentsBadge);
  const pageViews: Record<MobileBarView, HTMLButtonElement> = {
    files: barItems.files,
    diff: barItems.diff,
    agents: barItems.agents,
  };

  // 差分の長い行を折り返す切替 (電話の段だけ。Diff の上の帯の端に置く)。
  // .controls の中に置かない: その規則は display を決めるので、デスクトップで
  // hidden にしても場所を取る。見た目は SP の節だけ。状態はこのセッションだけ。
  const wrapButton = document.createElement("button");
  wrapButton.type = "button";
  wrapButton.className = "mobile-wrap-toggle";
  wrapButton.setAttribute("aria-pressed", "false");
  wrapButton.addEventListener("click", () => {
    const next = !document.body.classList.contains("mobile-diff-wrap");
    document.body.classList.toggle("mobile-diff-wrap", next);
    wrapButton.setAttribute("aria-pressed", String(next));
  });
  topbar.append(wrapButton);

  // 端末の操作札。ソフトキーボードに無いキー (Esc・Ctrl+C・矢印) と、確定の
  // Enter。押してもフォーカスを端末から奪わない (キーボードが閉じない)。
  const keys = document.createElement("div");
  keys.id = "mobile-keys";
  keys.className = "mobile-keys";
  keys.setAttribute("role", "toolbar");
  const keyButtons = TERMINAL_SOFT_KEYS.map((key) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-key";
    button.dataset.key = key;
    button.textContent = SOFT_KEY_CAPS[key];
    button.addEventListener("click", () => deps.sendTerminalKey(key));
    return button;
  });
  // ⌨ は出す / しまうの切替。端末に入力が向いていれば (キーボードが出ている)
  // 外してしまい、向いていなければ端末に向けて出す。
  const keyboardButton = document.createElement("button");
  keyboardButton.type = "button";
  keyboardButton.className = "mobile-key mobile-key-keyboard";
  keyboardButton.textContent = "⌨";
  keyboardButton.addEventListener("click", () => {
    const typing = terminalTyping();
    if (typing) typing.blur();
    else deps.focusTerminal();
    localize();
  });
  keys.append(...keyButtons, keyboardButton);
  keys.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest(".mobile-key"))
      event.preventDefault();
  });

  // 開いているタブの一覧の面 (電話の段)。タブ列の右端の入口 (main-tabs-view.ts
  // の listButton) から開く。行を押すとそのタブを前面に出して閉じ、×でタブを
  // 閉じる (面は開いたまま)。
  const tabsSheet = deps.tabs ? document.createElement("section") : null;
  const tabsTitle = document.createElement("h2");
  const tabsCloseButton = document.createElement("button");
  const tabsList = document.createElement("ul");
  let stopTabsRender: (() => void) | null = null;
  if (tabsSheet && deps.tabs) {
    const tabs = deps.tabs;
    tabsSheet.id = "mobile-tabs";
    tabsSheet.className = "mobile-tabs";
    tabsSheet.setAttribute("role", "dialog");
    const head = document.createElement("div");
    head.className = "mobile-tabs-head";
    tabsTitle.className = "mobile-tabs-title";
    tabsTitle.id = "mobile-tabs-title";
    tabsSheet.setAttribute("aria-labelledby", tabsTitle.id);
    tabsCloseButton.type = "button";
    tabsCloseButton.className = "mobile-tabs-x mobile-tabs-dismiss";
    tabsCloseButton.innerHTML = iconSvg("mobile-tabs-x-icon", CLOSE_ICON_PATH);
    tabsCloseButton.addEventListener("click", () => close());
    head.append(tabsTitle, tabsCloseButton);
    tabsList.className = "mobile-tabs-list";
    tabsSheet.append(head, tabsList);
    tabsList.addEventListener("click", (event) => {
      const target = event.target as Element;
      const row = target.closest<HTMLElement>(".mobile-tabs-row");
      const id = row?.dataset.tabId;
      if (!id) return;
      if (target.closest(".mobile-tabs-x")) {
        tabs.close(id);
        return;
      }
      close();
      tabs.bringToFront(id);
    });
    stopTabsRender = tabs.onRender(() => {
      if (open === "tabs") renderTabs();
    });
  }

  app.append(scrim, keys, bar, ...(tabsSheet ? [tabsSheet] : []));

  /** タブの一覧の面の中身を今のタブから組み直す (×の後も面は開いたまま)。 */
  function renderTabs(): void {
    if (!deps.tabs) return;
    const t = text();
    const entries = deps.tabs.list();
    tabsTitle.textContent = t.tabsTitle(entries.length);
    tabsCloseButton.title = t.close;
    tabsCloseButton.setAttribute("aria-label", t.close);
    // 閉じたタブの行にフォーカスがあったら、同じ位置の行 (無ければ前の行) へ移す。
    const focusedRow =
      document.activeElement instanceof HTMLElement &&
      tabsList.contains(document.activeElement)
        ? [...tabsList.children].indexOf(
            document.activeElement.closest(".mobile-tabs-row") as Element,
          )
        : -1;
    if (entries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "mobile-tabs-empty";
      empty.textContent = t.tabsEmpty;
      tabsList.replaceChildren(empty);
      return;
    }
    tabsList.replaceChildren(
      ...entries.map((entry) => {
        const row = document.createElement("li");
        row.className = "mobile-tabs-row";
        row.dataset.tabId = entry.id;
        row.classList.toggle("is-front", entry.front);
        row.classList.toggle("is-preview", entry.preview);
        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "mobile-tabs-open";
        openButton.title = entry.title;
        if (entry.front) openButton.setAttribute("aria-current", "true");
        const icon = document.createElement("span");
        icon.className = "mobile-tabs-icon";
        icon.innerHTML = entry.iconHtml;
        const name = document.createElement("span");
        name.className = "mobile-tabs-name";
        name.textContent = entry.name;
        openButton.append(icon, name);
        if (entry.parked) {
          const tag = document.createElement("span");
          tag.className = "mobile-tabs-parked";
          tag.textContent = t.tabsParked;
          tag.title = t.tabsParkedTitle;
          openButton.append(tag);
        }
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "mobile-tabs-x";
        closeButton.innerHTML = iconSvg("mobile-tabs-x-icon", CLOSE_ICON_PATH);
        const closeLabel = t.closeTab(entry.name);
        closeButton.title = closeLabel;
        closeButton.setAttribute("aria-label", closeLabel);
        row.append(openButton, closeButton);
        return row;
      }),
    );
    if (focusedRow >= 0) {
      const rows = tabsList.querySelectorAll<HTMLElement>(".mobile-tabs-open");
      rows[Math.min(focusedRow, rows.length - 1)]?.focus({
        preventScroll: true,
      });
    }
  }

  function barButton(
    paths: string | string[],
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-bar-item";
    button.innerHTML = `${iconSvg("mobile-bar-icon", paths)}<span class="mobile-bar-label"></span>`;
    button.addEventListener("click", onClick);
    return button;
  }

  /** 左の面の端末に入力が向いているなら、その要素 (xterm の入力欄)。 */
  function terminalTyping(): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement &&
      active.closest('.main-pane-host[data-side="left"][data-kind="terminal"]')
      ? active
      : null;
  }

  /** 帯の入口に「いま見ている画面」の印と、入力待ちの件数を付け直す。 */
  function syncBar(): void {
    const leftHost = document.querySelector(
      '.main-pane-host[data-side="left"]',
    );
    const now = mobileBarCurrent(
      (name) => document.body.classList.contains(name),
      leftHost?.classList.contains("is-shown") ?? false,
    );
    for (const [view, button] of Object.entries(pageViews)) {
      if (view === now) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    agentsBadge.hidden = waitingAgents === 0;
    agentsBadge.textContent = waitingAgents > 0 ? String(waitingAgents) : "";
    const t = text();
    const agentsLabel =
      waitingAgents > 0 ? t.agentsWaiting(waitingAgents) : t.agents;
    barItems.agents.title = agentsLabel;
    barItems.agents.setAttribute("aria-label", agentsLabel);
  }

  function followLink(selector: string): void {
    close();
    requireElement(selector).click();
  }

  function text(): MobileShellText {
    return mobileShellText(deps.getLanguage());
  }

  function localize(): void {
    const t = text();
    menuButton.title = t.projects;
    menuButton.setAttribute("aria-label", t.projects);
    bar.setAttribute("aria-label", t.bar);
    for (const [name, button] of Object.entries(barItems)) {
      const label = t[name as keyof typeof barItems];
      const span = button.querySelector(".mobile-bar-label");
      if (span) span.textContent = label;
      button.title = label;
    }
    scrim.title = t.close;
    keys.setAttribute("aria-label", t.keys);
    for (const button of keyButtons) {
      const label = t.keyLabel[button.dataset.key as TerminalSoftKey];
      button.title = label;
      button.setAttribute("aria-label", label);
    }
    const keyboardLabel = terminalTyping() ? t.keyboardHide : t.keyboard;
    keyboardButton.title = keyboardLabel;
    keyboardButton.setAttribute("aria-label", keyboardLabel);
    wrapButton.textContent = t.wrap;
    wrapButton.title = t.wrapTitle;
    syncBar();
  }

  function setOpen(next: Panel | null): void {
    if (next === open) return;
    const wasOpen = open;
    open = next;
    for (const panel of ["drawer", "sheet", "tabs"] as const) {
      document.body.classList.toggle(OPEN_CLASS[panel], open === panel);
    }
    menuButton.setAttribute("aria-expanded", String(open === "drawer"));
    barItems.projects.setAttribute("aria-expanded", String(open === "drawer"));
    barItems.list.setAttribute("aria-expanded", String(open === "sheet"));
    // 閉じた引き出しは画面の外にあるので、Tab で入らないようにする。
    nav.inert = current === "phone" && open !== "drawer";
    if (open && !wasOpen) {
      returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    if (open === "drawer") {
      nav
        .querySelector<HTMLElement>("button, a[href]")
        ?.focus({ preventScroll: true });
    }
    if (open === "tabs") {
      renderTabs();
      (
        tabsList.querySelector<HTMLElement>(".is-front .mobile-tabs-open") ??
        tabsList.querySelector<HTMLElement>(".mobile-tabs-open") ??
        tabsCloseButton
      ).focus({ preventScroll: true });
    }
    if (!open && wasOpen) {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      returnFocus = null;
    }
  }

  function toggle(panel: Panel): void {
    setOpen(open === panel ? null : panel);
  }

  function close(): void {
    setOpen(null);
  }

  /** ソフトキーボードが隠している高さ。骨格の下端をその分だけ上げる。 */
  function syncKeyboardInset(): void {
    const viewport = window.visualViewport;
    const covered =
      viewport && current === "phone"
        ? softKeyboardInset({
            innerHeight: window.innerHeight,
            viewportHeight: viewport.height,
            viewportOffsetTop: viewport.offsetTop,
            scale: viewport.scale,
          })
        : 0;
    document.body.classList.toggle("mobile-keyboard-open", covered > 0);
    if (covered > 0) {
      document.documentElement.style.setProperty(
        "--sp-keyboard-h",
        `${covered}px`,
      );
    } else {
      document.documentElement.style.removeProperty("--sp-keyboard-h");
    }
  }

  function apply(): void {
    current = viewportTier({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      coarsePointer: touchQuery.matches,
    });
    const phone = current === "phone";
    menuButton.hidden = !phone;
    bar.hidden = !phone;
    wrapButton.hidden = !phone;
    scrim.hidden = !phone;
    if (tabsSheet) tabsSheet.hidden = !phone;
    keys.hidden = !(phone || touchQuery.matches);
    if (!phone) {
      close();
      nav.inert = false;
    } else {
      nav.inert = open !== "drawer";
    }
    syncKeyboardInset();
  }

  // 捕捉の段で見る: 行の click はサイドバーを描き直して行を DOM から外すので、
  // 浮上の段では押したものがもう引き出しの中に無い。
  document.addEventListener(
    "click",
    (event) => {
      if (!open || !(event.target instanceof Element)) return;
      const target = event.target;
      if (
        open === "drawer" &&
        nav.contains(target) &&
        target.closest(DRAWER_CLOSING_TARGETS)
      ) {
        close();
      } else if (open === "sheet" && closesSheet(target)) {
        close();
      }
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (open && event.key === "Escape") {
        event.preventDefault();
        close();
      }
    },
    { signal },
  );

  // 左端からのスワイプで開き、開いている間は左へのスワイプで閉じる。指を
  // 動かしている間は引き出しが指に付いて動く (drawerDragOffset)。離したときに
  // 開くか閉じるかは edgeSwipeAction が決める。
  let touchStart: { x: number; y: number; drawerOpen: boolean } | null = null;
  let dragging = false;
  function endDrag(): void {
    if (!dragging) return;
    dragging = false;
    nav.style.removeProperty("transform");
    nav.style.removeProperty("transition");
    nav.style.removeProperty("visibility");
  }
  document.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches[0];
      endDrag();
      touchStart =
        current === "phone" && event.touches.length === 1 && touch
          ? {
              x: touch.clientX,
              y: touch.clientY,
              drawerOpen: open === "drawer",
            }
          : null;
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "touchmove",
    (event) => {
      const start = touchStart;
      const touch = event.touches[0];
      if (!start || !touch || current !== "phone") return;
      const offset = drawerDragOffset({
        startX: start.x,
        startY: start.y,
        x: touch.clientX,
        y: touch.clientY,
        drawerOpen: start.drawerOpen,
        width: nav.getBoundingClientRect().width,
      });
      if (offset === null) return;
      dragging = true;
      nav.style.transition = "none";
      nav.style.visibility = "visible";
      nav.style.transform = `translateX(${offset}px)`;
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "touchend",
    (event) => {
      const start = touchStart;
      touchStart = null;
      endDrag();
      const touch = event.changedTouches[0];
      if (!start || !touch || current !== "phone") return;
      const action = edgeSwipeAction({
        startX: start.x,
        startY: start.y,
        endX: touch.clientX,
        endY: touch.clientY,
        drawerOpen: start.drawerOpen,
      });
      if (action === "open") setOpen("drawer");
      else if (action === "close" && open === "drawer") close();
      else if (!action) followBottomSwipe(start, touch);
    },
    { passive: true, signal },
  );

  /**
   * 下端の帯から上への指の動きで一覧の面を開き、開いている面 (一覧・タブ) の
   * 頭の行から下への動きで閉じる (bottomSwipeAction)。
   */
  function followBottomSwipe(
    start: { x: number; y: number; drawerOpen: boolean },
    touch: Touch,
  ): void {
    if (start.drawerOpen || bar.hidden) return;
    const head =
      open === "sheet"
        ? document.getElementById("panel-head")
        : open === "tabs"
          ? tabsSheet?.querySelector(".mobile-tabs-head")
          : null;
    const headRect = head?.getBoundingClientRect() ?? null;
    const action = bottomSwipeAction({
      startX: start.x,
      startY: start.y,
      endX: touch.clientX,
      endY: touch.clientY,
      barTop: bar.getBoundingClientRect().top,
      sheetHead: headRect
        ? { top: headRect.top, bottom: headRect.bottom }
        : null,
    });
    if (action === "open" && !open) setOpen("sheet");
    else if (action === "close") close();
  }

  // 長押しで右クリックのメニュー (LONG_PRESS_TARGETS の行)。既存の contextmenu の
  // 入口 (行ごとの右クリック) をそのまま使うため、指を置いた要素へ contextmenu を
  // 送る。長押しで出るブラウザの文字の選択と既定のメニューは、行の CSS
  // (-webkit-touch-callout・user-select) と、下の本物の contextmenu の扱いで止める。
  let press: {
    x: number;
    y: number;
    target: Element;
    timer: ReturnType<typeof setTimeout>;
    fired: boolean;
    /** 指を置いた要素に付けた見張りを外す。 */
    stop: AbortController;
  } | null = null;
  /** 合成のメニューを出した時刻 (後から届く本物の contextmenu を 2 重に出さない)。 */
  let firedAt = Number.NEGATIVE_INFINITY;
  function cancelPress(): void {
    if (!press) return;
    clearTimeout(press.timer);
    press.stop.abort();
    press = null;
  }
  function firePress(): void {
    if (!press) return;
    press.fired = true;
    firedAt = performance.now();
    press.target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: press.x,
        clientY: press.y,
      }),
    );
  }
  // 指の動きと離すのは、指を置いた要素で見る: touchmove / touchend はその要素へ
  // 届き続けるが、メニューを出した行が描き直しで DOM から外れると document まで
  // 上がってこない (Files の木で、離したときの click が止まらずメニューが閉じた)。
  document.addEventListener(
    "touchstart",
    (event) => {
      cancelPress();
      const touch = event.touches[0];
      const target = event.target;
      if (
        event.touches.length !== 1 ||
        !touch ||
        !(target instanceof Element) ||
        !target.closest(LONG_PRESS_TARGETS)
      )
        return;
      const stop = new AbortController();
      const current = {
        x: touch.clientX,
        y: touch.clientY,
        target,
        timer: setTimeout(firePress, LONG_PRESS_MS),
        fired: false,
        stop,
      };
      press = current;
      target.addEventListener(
        "touchmove",
        (move) => {
          const now = (move as TouchEvent).touches[0];
          if (
            !current.fired &&
            (!now ||
              longPressMoved(current, { x: now.clientX, y: now.clientY }))
          )
            cancelPress();
        },
        { passive: true, signal: stop.signal },
      );
      // 長押しでメニューを出したら、指を離したときの click (行を開く) を止める。
      // preventDefault するので passive にしない。
      target.addEventListener(
        "touchend",
        (end) => {
          if (current.fired && end.cancelable) end.preventDefault();
          cancelPress();
        },
        { signal: stop.signal },
      );
      target.addEventListener("touchcancel", cancelPress, {
        passive: true,
        signal: stop.signal,
      });
    },
    { passive: true, signal },
  );
  // 長押しで本物の contextmenu を出すブラウザ (Android) と 2 重にしない: 先に
  // 本物が来たら合成をやめ、合成の後に来た本物は止める。
  document.addEventListener(
    "contextmenu",
    (event) => {
      if (!event.isTrusted) return;
      if (press && !press.fired) {
        clearTimeout(press.timer);
        press.fired = true;
        return;
      }
      if (performance.now() - firedAt < LONG_PRESS_MS * 2) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true, signal },
  );

  // 左の面の端末の上の 2 本指のピンチで、端末の文字の大きさを変える (電話の段の
  // 値。保存したデスクトップの値は変えない)。ページの拡大は style.css の
  // touch-action で止める。
  let pinch: { startSize: number; startDistance: number; size: number } | null =
    null;
  const fingerDistance = (touches: TouchList): number => {
    const a = touches[0];
    const b = touches[1];
    return a && b
      ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      : 0;
  };
  document.addEventListener(
    "touchstart",
    (event) => {
      pinch = null;
      if (
        event.touches.length !== 2 ||
        current !== "phone" ||
        !deps.terminalFontSize ||
        !(event.target instanceof Element) ||
        !event.target.closest(TERMINAL_HOST)
      )
        return;
      const size = deps.terminalFontSize();
      pinch = {
        startSize: size,
        startDistance: fingerDistance(event.touches),
        size,
      };
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "touchmove",
    (event) => {
      if (!pinch || event.touches.length !== 2) return;
      const size = pinchFontSize({
        startSize: pinch.startSize,
        startDistance: pinch.startDistance,
        distance: fingerDistance(event.touches),
        min: MIN_TERMINAL_FONT_SIZE,
        max: MAX_TERMINAL_FONT_SIZE,
      });
      if (size === pinch.size) return;
      pinch.size = size;
      deps.setTerminalFontSize?.(size);
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "touchend",
    (event) => {
      if (event.touches.length < 2) pinch = null;
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "touchcancel",
    () => {
      touchStart = null;
      endDrag();
    },
    { passive: true, signal },
  );

  // 画面の切替 (body の画面の印) と、左の面の前面のタブ (端末など) の出し入れで
  // 帯の「いま見ている画面」を付け直す。
  const pageObserver = new MutationObserver(syncBar);
  pageObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  const leftHost = document.querySelector('.main-pane-host[data-side="left"]');
  if (leftHost)
    pageObserver.observe(leftHost, {
      attributes: true,
      attributeFilter: ["class"],
    });
  // ⌨ の名前 (出す / しまう) は端末に入力が向いているかで変わる。
  document.addEventListener("focusin", localize, { signal });
  document.addEventListener("focusout", localize, { signal });

  phoneQuery.addEventListener("change", apply, { signal });
  touchQuery.addEventListener("change", apply, { signal });
  window.addEventListener("resize", apply, { signal });
  window.visualViewport?.addEventListener("resize", syncKeyboardInset, {
    signal,
  });
  window.visualViewport?.addEventListener("scroll", syncKeyboardInset, {
    signal,
  });
  // 言語の切替は app.ts が html の lang に書く。それを見て当て直す。
  // タブの一覧は開いている間だけ組み直す (localize はフォーカスの出入りでも
  // 呼ぶので、そこで組み直すとフォーカスのある行が消える)。
  const langObserver = new MutationObserver(() => {
    localize();
    if (open === "tabs") renderTabs();
  });
  langObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });

  localize();
  apply();

  return {
    tier: () => current,
    openDrawer: () => setOpen("drawer"),
    openSheet: () => setOpen("sheet"),
    openTabs: () => setOpen("tabs"),
    close,
    setWaitingAgents(count) {
      waitingAgents = count;
      syncBar();
    },
    dispose() {
      close();
      endDrag();
      cancelPress();
      listening.abort();
      langObserver.disconnect();
      pageObserver.disconnect();
      wrapButton.remove();
      document.body.classList.remove("mobile-diff-wrap");
      nav.inert = false;
      menuButton.remove();
      scrim.remove();
      keys.remove();
      bar.remove();
      stopTabsRender?.();
      tabsSheet?.remove();
    },
  };
}
