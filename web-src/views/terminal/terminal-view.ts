// Terminal ドロワー。開いている tmux ペインを一覧し、選んだ 1 枚を
// xterm.js に描いて、打鍵をそのペインへ送り返す。
//
// 開閉の作りは tools ドロワー (views/tools/tools-view.ts) と同じ右ドロワー
// (hidden + inert + overlay + body クラス) を踏襲している。幅の変更も同じ
// attachDragResizer。
//
// 一覧は開いている間だけ定期的に取り直す。tmux 上の AI CLI は作業内容を
// ペインタイトルに出すので、一覧が固定だと「今どれが動いているか」が分から
// なくなる。取り直しは generation で世代を照合し、切り替え後に届いた古い
// レスポンスで画面を巻き戻さない。

import { attachDragResizer } from "../../core/drag-resizer";
import {
  findTmuxPane,
  MAX_TERMINAL_SHEET_WIDTH,
  MIN_TERMINAL_SHEET_WIDTH,
  type TmuxPane,
  type TmuxPaneId,
  type TmuxPanesResponse,
} from "../../core/tmux";
import { type TerminalLang, type TerminalText, terminalText } from "./i18n";
import { createPaneList, type PaneListHandle } from "./pane-list";
import {
  createTerminalScreen,
  type TerminalScreenHandle,
} from "./terminal-screen";

/** 一覧を取り直す間隔。ペインタイトルの変化に追従するための頻度。 */
const PANE_LIST_INTERVAL_MS = 3000;

/** ペイン一覧の高さ (px) の許容範囲。 */
const MIN_LIST_HEIGHT = 80;
const MAX_LIST_HEIGHT = 720;
// 既定値は style.css の var(--terminal-list-height, …) 側に置く。

export type TerminalViewDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T | null;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  /** 副作用リクエスト用のヘッダ (app.ts の actionHeaders)。 */
  actionHeaders(): HeadersInit;
  getLanguage(): TerminalLang;
  onCloseRequest?: () => void;
  /** 表示中のペインが変わったとき。URL 同期に使う。 */
  onPaneChange?: (paneId: TmuxPaneId | null) => void;
};

export type TerminalViewHandle = {
  open(paneId?: TmuxPaneId | null): Promise<void>;
  close(): void;
  isOpen(): boolean;
  getActivePane(): TmuxPaneId | null;
  localize(): void;
  dispose(): void;
};

export function createTerminalView(deps: TerminalViewDeps): TerminalViewHandle {
  let paneList: PaneListHandle | null = null;
  let screen: TerminalScreenHandle | null = null;
  let titleEl: HTMLElement | null = null;
  let closeBtn: HTMLButtonElement | null = null;
  let reloadBtn: HTMLButtonElement | null = null;
  let inputToggle: HTMLButtonElement | null = null;
  let statusEl: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;
  let selectedPane: TmuxPane | null = null;
  let inputEnabled = true;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  // open / 一覧取得の世代。閉じたり開き直したりした後に、待っていた GET の
  // 続きが一覧や選択を書き換えないようにする。
  let generation = 0;

  function text(): TerminalText {
    return terminalText(deps.getLanguage());
  }

  function getMount(): HTMLElement | null {
    return deps.$<HTMLElement>("#terminal-sheet");
  }

  function getOverlay(): HTMLElement | null {
    return deps.$<HTMLElement>("#terminal-sheet-overlay");
  }

  function setStatus(message: string | null): void {
    if (!statusEl) return;
    statusEl.textContent = message ?? "";
    statusEl.hidden = !message;
  }

  function applySheetWidth(host: HTMLElement, width: number): void {
    const clamped = Math.min(
      MAX_TERMINAL_SHEET_WIDTH,
      Math.max(MIN_TERMINAL_SHEET_WIDTH, Math.round(width)),
    );
    host.style.setProperty("--terminal-sheet-width", `${clamped}px`);
  }

  function applyListHeight(height: number): void {
    const host = getMount();
    if (!host) return;
    const clamped = Math.min(
      MAX_LIST_HEIGHT,
      Math.max(MIN_LIST_HEIGHT, Math.round(height)),
    );
    host.style.setProperty("--terminal-list-height", `${clamped}px`);
  }

  function syncInputToggle(): void {
    if (!inputToggle) return;
    const current = text();
    inputToggle.classList.toggle("active", inputEnabled);
    inputToggle.setAttribute("aria-pressed", String(inputEnabled));
    inputToggle.textContent = inputEnabled
      ? current.writable
      : current.readOnly;
    inputToggle.title = inputEnabled
      ? current.writableTitle
      : current.readOnlyTitle;
  }

  function selectPane(pane: TmuxPane): void {
    selectedPane = pane;
    paneList?.setSelected(pane.id);
    deps.onPaneChange?.(pane.id);
    // attach は xterm の読み込みを挟むので、完了を待たずに focus しても
    // ターミナルがまだ無い。待ってから当てる。待つ間に別のペインへ
    // 切り替えられていたら、そちらの focus を横取りしない。
    void screen?.attach(pane).then(() => {
      if (selectedPane?.id === pane.id) screen?.focus();
    });
  }

  async function loadPanes(myGen: number): Promise<void> {
    try {
      const res = await deps.trackLoad(fetch("/_tmux/panes"));
      // 世代が変わっていたらこの一覧はもう過去のもの。
      if (myGen !== generation || disposed) return;
      if (!res.ok) return;
      const data = (await res.json()) as TmuxPanesResponse;
      if (myGen !== generation || disposed) return;
      paneList?.setData(data);
      paneList?.setSelected(selectedPane?.id ?? null);
      // 選んでいたペインが閉じられていたら選択を解く。
      if (selectedPane && !findTmuxPane(data.sessions, selectedPane.id)) {
        selectedPane = null;
        screen?.detach();
        deps.onPaneChange?.(null);
        setStatus(text().paneClosed);
      }
    } catch {
      // 中断・通信断。次の周期で取り直す。
    }
  }

  function startPolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (!isOpen()) return;
      void loadPanes(generation);
    }, PANE_LIST_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function mount(host: HTMLElement): void {
    if (paneList && screen && host.childElementCount > 0) return;
    const current = text();
    host.replaceChildren();

    const sheetResizer = document.createElement("div");
    sheetResizer.className = "terminal-sheet-resizer";
    sheetResizer.role = "separator";
    sheetResizer.tabIndex = 0;
    sheetResizer.setAttribute("aria-orientation", "vertical");
    sheetResizer.setAttribute("aria-label", current.resizeSheet);
    attachDragResizer({
      handle: sheetResizer,
      getSize: () => host.getBoundingClientRect().width,
      applySize: (width) => {
        applySheetWidth(host, width);
        screen?.refit();
      },
      direction: -1,
      activeClassTarget: host,
      activeClassName: "terminal-sheet-resizing",
    });

    const header = document.createElement("header");
    header.className = "terminal-header";
    titleEl = document.createElement("h1");
    titleEl.textContent = current.title;

    const actions = document.createElement("div");
    actions.className = "terminal-header-actions";

    inputToggle = document.createElement("button");
    inputToggle.type = "button";
    inputToggle.className = "terminal-input-toggle";
    inputToggle.addEventListener("click", () => {
      inputEnabled = !inputEnabled;
      screen?.setInputEnabled(inputEnabled);
      syncInputToggle();
    });

    reloadBtn = document.createElement("button");
    reloadBtn.type = "button";
    reloadBtn.className = "terminal-reload";
    reloadBtn.textContent = "⟳";
    reloadBtn.title = current.reload;
    reloadBtn.setAttribute("aria-label", current.reload);
    reloadBtn.addEventListener("click", () => {
      void loadPanes(generation);
    });

    closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "terminal-close";
    closeBtn.textContent = "×";
    closeBtn.title = current.close;
    closeBtn.setAttribute("aria-label", current.close);
    closeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      deps.onCloseRequest?.();
    });

    actions.append(inputToggle, reloadBtn, closeBtn);
    header.append(titleEl, actions);

    paneList = createPaneList({
      getText: text,
      onSelect: (pane) => selectPane(pane),
    });
    listEl = paneList.el;

    const listResizer = document.createElement("div");
    listResizer.className = "terminal-list-resizer";
    listResizer.role = "separator";
    listResizer.tabIndex = 0;
    listResizer.setAttribute("aria-orientation", "horizontal");
    listResizer.setAttribute("aria-label", current.resizeList);
    attachDragResizer({
      handle: listResizer,
      getSize: () => listEl?.getBoundingClientRect().height ?? 0,
      applySize: (height) => {
        applyListHeight(height);
        screen?.refit();
      },
      direction: 1,
      axis: "y",
      activeClassTarget: host,
      activeClassName: "terminal-list-resizing",
    });

    screen = createTerminalScreen({
      trackLoad: deps.trackLoad,
      actionHeaders: deps.actionHeaders,
      getText: text,
      onStatus: setStatus,
      onPaneGone: () => {
        void loadPanes(generation);
      },
    });
    screen.setInputEnabled(inputEnabled);

    statusEl = document.createElement("p");
    statusEl.className = "terminal-status";
    statusEl.role = "status";
    statusEl.hidden = true;

    const body = document.createElement("div");
    body.className = "terminal-body";
    body.append(paneList.el, listResizer, screen.el, statusEl);

    host.append(sheetResizer, header, body);
    syncInputToggle();
  }

  function isOpen(): boolean {
    const host = getMount();
    return host ? !host.hidden : false;
  }

  async function open(paneId?: TmuxPaneId | null): Promise<void> {
    const host = getMount();
    if (!host || disposed) return;
    const myGen = ++generation;
    mount(host);
    host.hidden = false;
    host.setAttribute("aria-hidden", "false");
    // ドロワーはスライドアウトのため [hidden] でも display:block のままなので、
    // 閉じている間に Tab フォーカスが入らないよう inert を併用する。
    host.removeAttribute("inert");
    const overlay = getOverlay();
    if (overlay) {
      overlay.hidden = false;
      overlay.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("terminal-sheet-open");
    // 既定の幅と一覧の高さは CSS 側の fallback 値が受け持つ。ここで初期値を
    // 書き込むと、ドラッグで変えた値を開き直すたびに巻き戻してしまう。
    startPolling();
    setStatus(text().selectPane);

    await loadPanes(myGen);
    // 待つ間に閉じられた / 開き直された場合、この open はもう過去のもの。
    if (myGen !== generation || !isOpen() || disposed) return;

    // URL で指定されたペインがまだ在れば、それを開く。
    if (paneId) {
      const res = await deps.trackLoad(fetch("/_tmux/panes"));
      if (myGen !== generation || !isOpen() || disposed) return;
      if (res.ok) {
        const data = (await res.json()) as TmuxPanesResponse;
        if (myGen !== generation || !isOpen() || disposed) return;
        const pane = findTmuxPane(data.sessions, paneId);
        if (pane) selectPane(pane);
        else setStatus(text().paneClosed);
      }
    }
  }

  function close(): void {
    const host = getMount();
    if (!host) return;
    host.hidden = true;
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("inert", "");
    const overlay = getOverlay();
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("terminal-sheet-open");
    // 読み込み中だった GET と、その後の選択を無効化する。
    generation += 1;
    stopPolling();
    // 閉じている間まで画面を取り続けない。
    screen?.detach();
  }

  function localize(): void {
    if (!paneList) return;
    const current = text();
    if (titleEl) titleEl.textContent = current.title;
    if (closeBtn) {
      closeBtn.title = current.close;
      closeBtn.setAttribute("aria-label", current.close);
    }
    if (reloadBtn) {
      reloadBtn.title = current.reload;
      reloadBtn.setAttribute("aria-label", current.reload);
    }
    syncInputToggle();
    paneList.localize();
    paneList.setSelected(selectedPane?.id ?? null);
  }

  return {
    open,
    close,
    isOpen,
    getActivePane: () => selectedPane?.id ?? null,
    localize,
    dispose() {
      disposed = true;
      generation += 1;
      stopPolling();
      screen?.dispose();
      screen = null;
      paneList = null;
    },
  };
}
