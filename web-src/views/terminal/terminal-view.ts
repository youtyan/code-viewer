// Terminal ドロワー。映すのは PTY のシェル 1 本だけで、tmux はその中で
// 普通に動く。
//
// 左のツリーが「今 tmux がどうなっているか」を見せ、右がターミナル本体。
// ツリーの tmux ペインを押すと、そのペインが見える状態にしてもらう
// (今映しているシェルで tmux が動いていればそれを動かし、動いていなければ
// サーバがシェルを 1 つ開いて attach する)。ドロワー自身は tmux の画面を
// 描かないので、寸法合わせは PTY のリサイズだけで済む。
//
// 開閉の作りは tools ドロワー (views/tools/tools-view.ts) と同じ右ドロワー。
//
// 一覧は開いている間だけ定期的に取り直す。tmux 上の AI CLI は作業内容を
// ペインタイトルに出すので、一覧が固定だと「今どれが動いているか」が分から
// なくなる。取り直しは generation で世代を照合し、切り替え後に届いた古い
// レスポンスで画面を巻き戻さない。

import type { AgentStateRecord } from "../../core/agent-state";
import { attachDragResizer } from "../../core/drag-resizer";
import {
  formatErrorDetail,
  responseErrorMessage,
} from "../../core/error-detail";
import { blockScrollChaining } from "../../core/scroll-chaining";
import type {
  ShellListResponse,
  ShellSession,
  ShellSessionId,
} from "../../core/shell";
import { readStoredSize, writeStoredSize } from "../../core/stored-size";
import type { BoardRow } from "../../core/terminal-board";
import {
  clampTerminalFontSize,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_STEP,
  type TmuxClientsResponse,
  type TmuxPanesResponse,
} from "../../core/tmux";
import { type TerminalLang, type TerminalText, terminalText } from "./i18n";
import { createSessionBoard, type SessionBoardHandle } from "./session-board";
import {
  createTerminalScreen,
  type TerminalScreenHandle,
} from "./terminal-screen";

/** 一覧を取り直す間隔。ペインタイトルの変化に追従するための頻度。 */
const PANE_LIST_INTERVAL_MS = 3000;

/** 左の一覧の幅 (px) の許容範囲。 */
const MIN_LIST_WIDTH = 300;
const MAX_LIST_WIDTH = 720;
/** CSS 側の既定値 (--terminal-list-width の fallback) と揃える。 */
const DEFAULT_LIST_WIDTH = 440;
const LIST_WIDTH_STORAGE_KEY = "code-viewer:terminal-list-width";

export type TerminalViewDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T | null;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  /** 副作用リクエスト用のヘッダ (app.ts の actionHeaders)。 */
  actionHeaders(): HeadersInit;
  getLanguage(): TerminalLang;
  /** 保存してある文字サイズ (px)。 */
  getFontSize(): number;
  /** 文字サイズが変わった。保存は呼び出し側 (app.ts) が持つ。 */
  onFontSizeChange(size: number): void;
  onCloseRequest?: () => void;
  /** 映している対象が変わったとき。URL 同期に使う。 */
  onTargetChange?: (id: string | null) => void;
};

export type TerminalViewHandle = {
  open(targetId?: string | null): Promise<void>;
  close(): void;
  isOpen(): boolean;
  getActiveTarget(): string | null;
  /** 器の大きさが変わったとき。端末の桁数・行数を測り直す。 */
  refit(): void;
  localize(): void;
  dispose(): void;
};

export function createTerminalView(deps: TerminalViewDeps): TerminalViewHandle {
  let board: SessionBoardHandle | null = null;
  /**
   * 最後に映していたシェル。閉じても残す。
   *
   * パネルは Terminal と Tools がタブになっていて、切り替えると閉じる扱いに
   * なる。ここを捨てると、戻ってきたときに「選んでください」になってしまう。
   */
  let lastTargetId: string | null = null;
  let states: AgentStateRecord[] = [];
  let screen: TerminalScreenHandle | null = null;
  let reloadBtn: HTMLButtonElement | null = null;
  let fontSmaller: HTMLButtonElement | null = null;
  let fontLarger: HTMLButtonElement | null = null;
  let fontValue: HTMLElement | null = null;
  let inputToggle: HTMLButtonElement | null = null;
  let listToggle: HTMLButtonElement | null = null;
  let statusEl: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;
  let attached: ShellSession | null = null;
  let panes: TmuxPanesResponse | null = null;
  let shells: ShellListResponse | null = null;
  let clients: TmuxClientsResponse | null = null;
  let inputEnabled = true;
  // 最後に適用した一覧の幅。ドラッグが終わった時点でこれを保存する。
  let listWidth = DEFAULT_LIST_WIDTH;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  // open / 一覧取得の世代。閉じたり開き直したりした後に、待っていた GET の
  // 続きが一覧や選択を書き換えないようにする。
  let generation = 0;
  // 一覧取得そのものの世代。generation は開閉でしか動かないので、これだけ
  // では周期取得どうしの追い越しを弾けない。取得のたびに増やし、最後に
  // 始めた取得の応答だけを反映する。これが無いと、シェルを作った直後に
  // 古い一覧が後から届いて、作ったばかりのシェルが消え選択も外れる。
  let listGeneration = 0;

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

  function applyListWidth(width: number): void {
    listWidth = Math.min(
      MAX_LIST_WIDTH,
      Math.max(MIN_LIST_WIDTH, Math.round(width)),
    );
    const host = getMount();
    if (!host) return;
    host.style.setProperty("--terminal-list-width", `${listWidth}px`);
  }

  function createFontButton(label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "terminal-font-btn";
    button.textContent = label;
    return button;
  }

  /**
   * 文字サイズを 1 段変える。
   *
   * 上限・下限に当たったらボタンを無効にするだけで、押しても寸法は動かない
   * (無効時に消すと押し損ねる)。値の表示は桁を固定してあるので、2 桁と 1 桁で
   * 隣のボタンがずれることもない。
   */
  function stepFontSize(direction: 1 | -1): void {
    const next = clampTerminalFontSize(
      deps.getFontSize() + direction * TERMINAL_FONT_SIZE_STEP,
    );
    if (next === clampTerminalFontSize(deps.getFontSize())) return;
    deps.onFontSizeChange(next);
    screen?.applyFontSize();
    syncFontSize();
  }

  function syncFontSize(): void {
    const size = clampTerminalFontSize(deps.getFontSize());
    const current = text();
    if (fontValue) fontValue.textContent = String(size);
    if (fontSmaller) {
      fontSmaller.disabled = size <= MIN_TERMINAL_FONT_SIZE;
      fontSmaller.title = current.fontSmaller;
      fontSmaller.setAttribute("aria-label", current.fontSmaller);
    }
    if (fontLarger) {
      fontLarger.disabled = size >= MAX_TERMINAL_FONT_SIZE;
      fontLarger.title = current.fontLarger;
      fontLarger.setAttribute("aria-label", current.fontLarger);
    }
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

  function mobileListHidden(): boolean {
    return (
      getMount()?.classList.contains("terminal-mobile-list-hidden") ?? false
    );
  }

  function syncListToggle(): void {
    if (!listToggle) return;
    const hidden = mobileListHidden();
    const label = hidden ? text().showSessions : text().hideSessions;
    listToggle.title = label;
    listToggle.setAttribute("aria-label", label);
    listToggle.setAttribute("aria-pressed", String(!hidden));
  }

  function setMobileListHidden(hidden: boolean): void {
    const host = getMount();
    if (!host) return;
    host.classList.toggle("terminal-mobile-list-hidden", hidden);
    syncListToggle();
    screen?.refit();
  }

  function usesMobileTerminalLayout(): boolean {
    return typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 700px)").matches
      : false;
  }

  function selectShell(session: ShellSession): void {
    attached = session;
    lastTargetId = session.id;
    board?.setSelected(session.id);
    deps.onTargetChange?.(session.id);
    if (usesMobileTerminalLayout()) setMobileListHidden(true);
    // attach は xterm の読み込みを挟むので、完了を待たずに focus しても
    // ターミナルがまだ無い。待ってから当てる。待つ間に別の対象へ切り替え
    // られていたら、そちらの focus を横取りしない。
    const attaching = screen?.attach(session);
    if (!attaching) return;
    void attaching.then(
      () => {
        if (attached?.id === session.id) screen?.focus();
      },
      (error: unknown) => {
        if (attached?.id !== session.id || disposed) return;
        console.error("[code-viewer] terminal attach failed", error);
        setStatus(`${text().loadFailed}\n${formatErrorDetail(error)}`);
      },
    );
  }

  /** 一覧の中から id に一致するシェルを探す。閉じられていれば null。 */
  function findShell(id: string): ShellSession | null {
    return shells?.sessions.find((item) => item.id === id) ?? null;
  }

  function renderLists(): void {
    board?.setData({
      panes,
      shells: shells?.sessions ?? [],
      clients: clients?.clients ?? [],
      shellAvailable: shells?.available ?? true,
      shellUnavailableReason: shells?.reason ?? "",
      states,
    });
    board?.setSelected(attached?.id ?? null);
  }

  async function loadLists(myGen: number): Promise<void> {
    const myList = ++listGeneration;
    /** 開閉が起きたか、これより後の取得が始まっていたら、この応答は捨てる。 */
    const stale = () =>
      myGen !== generation || myList !== listGeneration || disposed;
    try {
      const [paneRes, shellRes, stateRes, clientRes] = await Promise.all([
        deps.trackLoad(fetch("/_tmux/panes")),
        deps.trackLoad(fetch("/_shell/list")),
        deps.trackLoad(fetch("/_agent/states")),
        deps.trackLoad(fetch("/_tmux/clients")),
      ]);
      if (stale()) return;
      const failed = [
        [paneRes, text().paneListFailed],
        [shellRes, text().shellListFailed],
        [stateRes, text().stateListFailed],
        [clientRes, text().clientListFailed],
      ] as const;
      const messages = await Promise.all(
        failed
          .filter(([response]) => !response.ok)
          .map(([response, operation]) =>
            responseErrorMessage(response, operation),
          ),
      );
      if (stale()) return;
      if (messages.length > 0) {
        setStatus(messages.join("\n\n"));
        return;
      }
      const nextPanes = (await paneRes.json()) as TmuxPanesResponse;
      const nextShells = (await shellRes.json()) as ShellListResponse;
      const nextStates = (
        (await stateRes.json()) as { states: AgentStateRecord[] }
      ).states;
      const nextClients = (await clientRes.json()) as TmuxClientsResponse;
      if (stale()) return;
      panes = nextPanes;
      shells = nextShells;
      states = nextStates ?? [];
      clients = nextClients;

      renderLists();

      // 映していたシェルが無くなっていたら選択を解く。
      if (attached && !findShell(attached.id)) {
        attached = null;
        screen?.detach();
        setMobileListHidden(false);
        deps.onTargetChange?.(null);
        setStatus(text().shellClosed);
      }
    } catch (error) {
      if (stale()) return;
      console.error("[code-viewer] terminal list refresh failed", error);
      setStatus(`${text().listLoadFailed}\n${formatErrorDetail(error)}`);
    }
  }

  /**
   * 未読を読んだことにする。人間が結果を見た合図なので、上段のボードから
   * 消えるだけで、稼働中や入力待ちの対象には効かない (サーバ側で判定する)。
   */
  async function markRead(target: string): Promise<void> {
    const myGen = generation;
    try {
      const res = await deps.trackLoad(
        fetch("/_agent/state", {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ target, event: "read", at: Date.now() }),
        }),
      );
      if (myGen !== generation || disposed) return;
      if (!res.ok) {
        setStatus(await responseErrorMessage(res, text().markReadFailed));
        return;
      }
      await loadLists(myGen);
    } catch (error) {
      if (myGen !== generation || disposed) return;
      console.error("[code-viewer] terminal mark-read failed", error);
      setStatus(`${text().markReadFailed}\n${formatErrorDetail(error)}`);
    }
  }

  /**
   * tmux ペインを見える状態にしてもらう。
   *
   * 今映しているシェルの中で tmux が動いていればそれが動き、動いていなければ
   * サーバが新しいシェルを開いて attach する。どちらになったかは応答の action
   * で分かるが、こちらは返ってきたシェルを映すだけでよい (既に映しているものと
   * 同じなら、画面はそのまま tmux が切り替わる)。
   */
  async function openPane(row: BoardRow): Promise<void> {
    const myGen = generation;
    const size = screen?.measure();
    try {
      const res = await deps.trackLoad(
        fetch("/_tmux/open", {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pane: row.target,
            shell: attached?.id ?? null,
            cols: size?.cols,
            rows: size?.rows,
          }),
        }),
      );
      if (myGen !== generation || disposed) return;
      if (res.status === 410) {
        setStatus(await responseErrorMessage(res, text().paneClosed));
        await loadLists(myGen);
        return;
      }
      if (res.status === 429) {
        setStatus(await responseErrorMessage(res, text().shellLimitReached));
        return;
      }
      if (!res.ok) {
        setStatus(await responseErrorMessage(res, text().paneOpenFailed));
        return;
      }
      const body = (await res.json()) as {
        session: ShellSession;
        action: "switched" | "attached";
      };
      if (myGen !== generation || disposed) return;
      setStatus(null);
      if (body.action === "attached") {
        // 新しく開いたシェル。一覧に載せてから選ぶ (取り直しを待たない)。
        shells = {
          available: true,
          sessions: [...(shells?.sessions ?? []), body.session],
        };
        renderLists();
        selectShell(body.session);
        return;
      }
      // 既にあるシェルの tmux が動いただけ。映しているものが同じなら画面は
      // そのまま追従するので、選び直すのは別のシェルだったときだけ。
      if (attached?.id !== body.session.id) selectShell(body.session);
      // ツリーの「今出ている行」の印は、どのペインを映しているかで決まる。
      // 切り替えたばかりの対応を反映するために取り直す。
      await loadLists(myGen);
    } catch (error) {
      if (myGen !== generation || disposed) return;
      console.error("[code-viewer] tmux pane open failed", error);
      setStatus(`${text().paneOpenFailed}\n${formatErrorDetail(error)}`);
    }
  }

  async function createShell(): Promise<void> {
    const myGen = generation;
    const size = screen?.measure();
    try {
      const res = await deps.trackLoad(
        fetch("/_shell/create", {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ cols: size?.cols, rows: size?.rows }),
        }),
      );
      if (myGen !== generation || disposed) return;
      if (res.status === 429) {
        setStatus(await responseErrorMessage(res, text().shellLimitReached));
        return;
      }
      if (!res.ok) {
        setStatus(await responseErrorMessage(res, text().shellCreateFailed));
        return;
      }
      const created = (await res.json()) as { session: ShellSession };
      if (myGen !== generation || disposed) return;
      // 一覧に載せてから選ぶ。取り直しを待たずに操作できる。
      shells = {
        available: true,
        sessions: [...(shells?.sessions ?? []), created.session],
      };
      renderLists();
      selectShell(created.session);
    } catch (error) {
      if (myGen !== generation || disposed) return;
      console.error("[code-viewer] shell create failed", error);
      setStatus(`${text().shellCreateFailed}\n${formatErrorDetail(error)}`);
    }
  }

  async function closeShell(id: ShellSessionId): Promise<void> {
    const myGen = generation;
    try {
      const res = await deps.trackLoad(
        fetch("/_shell/close", {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id }),
        }),
      );
      if (myGen !== generation || disposed) return;
      if (!res.ok) {
        setStatus(await responseErrorMessage(res, text().shellCloseFailed));
        return;
      }
    } catch (error) {
      if (myGen !== generation || disposed) return;
      console.error("[code-viewer] shell close failed", error);
      setStatus(`${text().shellCloseFailed}\n${formatErrorDetail(error)}`);
      return;
    }
    if (myGen !== generation || disposed) return;
    if (attached?.id === id) {
      attached = null;
      screen?.detach();
      deps.onTargetChange?.(null);
    }
    shells = {
      available: shells?.available ?? true,
      sessions: (shells?.sessions ?? []).filter((item) => item.id !== id),
    };
    renderLists();
  }

  function startPolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (!isOpen()) return;
      void loadLists(generation);
    }, PANE_LIST_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function mount(host: HTMLElement): void {
    if (board && screen && host.childElementCount > 0) return;
    const current = text();
    host.replaceChildren();

    // 見出しと閉じるはパネルのタブ列が持つ。ここには中身固有の操作だけ置く。
    const header = document.createElement("header");
    header.className = "terminal-header";

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

    fontSmaller = createFontButton("−");
    fontSmaller.addEventListener("click", () => stepFontSize(-1));
    fontValue = document.createElement("span");
    fontValue.className = "terminal-font-value";
    fontLarger = createFontButton("+");
    fontLarger.addEventListener("click", () => stepFontSize(1));
    const fontGroup = document.createElement("div");
    fontGroup.className = "terminal-font-size";
    fontGroup.append(fontSmaller, fontValue, fontLarger);

    reloadBtn = document.createElement("button");
    reloadBtn.type = "button";
    reloadBtn.className = "terminal-reload";
    reloadBtn.textContent = "⟳";
    reloadBtn.title = current.reload;
    reloadBtn.setAttribute("aria-label", current.reload);
    reloadBtn.addEventListener("click", () => {
      void loadLists(generation);
    });

    listToggle = document.createElement("button");
    listToggle.type = "button";
    listToggle.className = "terminal-reload terminal-list-toggle";
    listToggle.textContent = "☷";
    listToggle.addEventListener("click", () => {
      setMobileListHidden(!mobileListHidden());
    });

    actions.append(listToggle, fontGroup, inputToggle, reloadBtn);
    header.append(actions);

    board = createSessionBoard({
      getText: text,
      onSelectShell: (row) => {
        const session = findShell(row.target);
        if (session) selectShell(session);
      },
      onOpenPane: (row) => void openPane(row),
      onCreateShell: () => void createShell(),
      onCloseShell: (id) => void closeShell(id),
      onMarkRead: (row) => void markRead(row.target),
    });

    const lists = document.createElement("div");
    lists.className = "terminal-lists";
    lists.append(board.el);
    listEl = lists;

    const listResizer = document.createElement("div");
    listResizer.className = "terminal-list-resizer";
    listResizer.role = "separator";
    listResizer.tabIndex = 0;
    listResizer.setAttribute("aria-orientation", "vertical");
    listResizer.setAttribute("aria-label", current.resizeList);
    // 前回引き伸ばした幅で開く。組み立て直後に当てるので、既定の幅が一瞬
    // 見えてから縮む、ということにならない。
    applyListWidth(readStoredSize(LIST_WIDTH_STORAGE_KEY, DEFAULT_LIST_WIDTH));
    attachDragResizer({
      handle: listResizer,
      getSize: () => listEl?.getBoundingClientRect().width ?? 0,
      applySize: (width) => {
        applyListWidth(width);
        screen?.refit();
      },
      // 右へ引くと左の一覧が広がる。
      direction: 1,
      axis: "x",
      // 保存はドラッグ / キー操作が終わった時だけ。動かしている間ずっと書くと、
      // 1 回のドラッグで数十回 localStorage を叩くことになる。
      onEnd: () => writeStoredSize(LIST_WIDTH_STORAGE_KEY, listWidth),
      activeClassTarget: host,
      activeClassName: "terminal-list-resizing",
    });

    screen = createTerminalScreen({
      trackLoad: deps.trackLoad,
      actionHeaders: deps.actionHeaders,
      getText: text,
      getFontSize: () => clampTerminalFontSize(deps.getFontSize()),
      onStatus: setStatus,
      onTargetGone: () => {
        void loadLists(generation);
      },
    });
    screen.setInputEnabled(inputEnabled);

    statusEl = document.createElement("p");
    statusEl.className = "terminal-status";
    statusEl.role = "status";
    statusEl.hidden = true;

    // 左にツリー、右にターミナル。縦積みだとツリーが数行しか見えず、どれを
    // 選ぶかを決める前に画面が尽きる。
    const pane = document.createElement("div");
    pane.className = "terminal-pane";
    pane.append(screen.el, statusEl);

    const body = document.createElement("div");
    body.className = "terminal-body";
    body.append(lists, listResizer, pane);
    // 組み立てるたびに作り直す箱なので、ここで付ければ二重に登録されない。
    blockScrollChaining(body);

    host.append(header, body);
    syncInputToggle();
    syncFontSize();
    syncListToggle();
  }

  function isOpen(): boolean {
    const host = getMount();
    return host ? !host.hidden : false;
  }

  async function open(id?: string | null): Promise<void> {
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

    await loadLists(myGen);
    // 待つ間に閉じられた / 開き直された場合、この open はもう過去のもの。
    if (myGen !== generation || !isOpen() || disposed) return;

    if (id) {
      const session = findShell(id);
      if (session) {
        renderLists();
        selectShell(session);
      } else {
        setStatus(text().shellClosed);
      }
    } else if (usesMobileTerminalLayout()) {
      setMobileListHidden(false);
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
    // 閉じている間まで購読を続けない。シェル自体は残るので、開き直せば
    // 続きから見られる。
    //
    // 何を映していたかは覚えておく。Tools タブへ移って戻ったときに選び直させ
    // られると、毎回一覧から選ぶことになる。
    if (attached) lastTargetId = attached.id;
    screen?.detach();
    attached = null;
    setMobileListHidden(false);
  }

  function localize(): void {
    if (!board) return;
    const current = text();
    if (reloadBtn) {
      reloadBtn.title = current.reload;
      reloadBtn.setAttribute("aria-label", current.reload);
    }
    syncInputToggle();
    syncFontSize();
    syncListToggle();
    screen?.localize();
    board.localize();
    renderLists();
  }

  return {
    open,
    close,
    isOpen,
    getActiveTarget: () => attached?.id ?? lastTargetId,
    refit: () => screen?.refit(),
    localize,
    dispose() {
      disposed = true;
      generation += 1;
      stopPolling();
      screen?.dispose();
      screen = null;
      board = null;
    },
  };
}
