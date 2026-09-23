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
  drawerDragOffset,
  edgeSwipeAction,
  type MobileBarView,
  mobileBarCurrent,
  PHONE_MEDIA_QUERY,
  softKeyboardInset,
  TERMINAL_SOFT_KEYS,
  type TerminalSoftKey,
  TOUCH_MEDIA_QUERY,
  type ViewportTier,
  viewportTier,
} from "../core/mobile-layout";
import { pageIconPaths } from "./main-tabs/tab-icons";
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
};

export type MobileShell = {
  /** 今の幅の段。 */
  tier(): ViewportTier;
  openDrawer(): void;
  openSheet(): void;
  /** 開いている引き出し・面を閉じる。 */
  close(): void;
  /** 下端の帯の「エージェント」に出す入力待ちの件数 (0 で札を隠す)。 */
  setWaitingAgents(count: number): void;
  /** 足した部品と見張りを外す (テスト用。アプリは一度だけ作る)。 */
  dispose(): void;
};

type Panel = "drawer" | "sheet";

const OPEN_CLASS: Record<Panel, string> = {
  drawer: "mobile-nav-open",
  sheet: "mobile-sheet-open",
};

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
  const row = target.closest("#filelist li");
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
  barItems.list.setAttribute("aria-controls", "sidebar");
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

  app.append(scrim, keys, bar);

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
    for (const panel of ["drawer", "sheet"] as const) {
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
  const langObserver = new MutationObserver(localize);
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
    close,
    setWaitingAgents(count) {
      waitingAgents = count;
      syncBar();
    },
    dispose() {
      close();
      endDrag();
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
    },
  };
}
