import { apiUrl } from "../../core/api-url";
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

import type {
  AgentStateObservationError,
  AgentStateRecord,
  AgentStatesResponse,
} from "../../core/agent-state";
import { attachDragResizer } from "../../core/drag-resizer";
import {
  formatErrorDetail,
  responseErrorMessage,
} from "../../core/error-detail";
import { iconSvg, SIDEBAR_SHOW_16_PATHS } from "../../core/icons";
import { blockScrollChaining } from "../../core/scroll-chaining";
import type {
  ShellListResponse,
  ShellSession,
  ShellSessionId,
} from "../../core/shell";
import { readStoredSize, writeStoredSize } from "../../core/stored-size";
import {
  clampTerminalFontSize,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_STEP,
  type TmuxClientsResponse,
  type TmuxPanesResponse,
} from "../../core/tmux";
import type { ContextMenuItem } from "../context-menu";
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
  /** 画像の棚を畳んでいるか (ユーザー単位の設定)。 */
  isImageShelfCollapsed(): boolean;
  /** 棚を畳んだ・開いた。保存は呼び出し側 (app.ts) が持つ。 */
  onImageShelfCollapsedChange(collapsed: boolean): void;
  /** セッションの一覧 (左の列) を開いているか (ユーザー単位の設定)。 */
  isSessionsOpen(): boolean;
  /** 一覧を開いた・畳んだ。保存は呼び出し側 (app.ts) が持つ。 */
  onSessionsOpenChange(open: boolean): void;
  onCloseRequest?: () => void;
  /** 映している対象が変わったとき。URL 同期に使う。 */
  onTargetChange?: (id: string | null) => void;
  /** タブで開いているシェルを選んだ。パネルでは映さず、そのタブを前面に出す。 */
  onShowTab?: (id: ShellSessionId) => void;
  /**
   * 「タブで開く」。そのシェルのタブを開いて前面に出してもらう。pane は
   * tmux ペインから開いたとき、そのペイン (シェルとペインの対応をサーバが
   * まだ知らないときの名前付けに使う)。
   */
  onOpenInTab?: (session: ShellSession, pane?: string) => void;
};

export type TerminalViewHandle = {
  open(targetId?: string | null): Promise<void>;
  /**
   * tmux ペインを開いてそれを映す。ツリーでペインを押したときと同じ経路
   * (/_tmux/open) を通る。エージェント一覧から使う。
   */
  openPane(pane: string): Promise<void>;
  close(): void;
  isOpen(): boolean;
  getActiveTarget(): string | null;
  /** 器の大きさが変わったとき。端末の桁数・行数を測り直す。 */
  refit(): void;
  /**
   * パネルの見出しの行の「⋯」に入れる、ターミナルの操作 (文字の大きさ・入力の
   * オンオフ・一覧の取り直し)。開いていないときは空。
   */
  menuItems(): ContextMenuItem[];
  localize(): void;
  dispose(): void;
  /** メインの面のターミナルのタブの箱。app が本文の位置に 1 度だけ置く。 */
  tabElement: HTMLElement;
  /**
   * そのシェルをタブの箱で映す。パネルで映していれば、同じ xterm を箱ごと
   * 付け替える (attach し直さない)。
   */
  showInTab(id: ShellSessionId): Promise<void>;
  /** タブを閉じた。タブの箱がそのシェルを映していれば購読をやめる (シェルは止めない)。 */
  releaseTab(id: ShellSessionId): void;
  /** タブで映しているシェルを、同じ xterm のままパネルへ移す。 */
  moveTabToPanel(id: ShellSessionId): Promise<void>;
  /** タブで開いているシェル。一覧に印を付け、パネルでは映さない。 */
  setTabbed(ids: ReadonlySet<string>): void;
  /** tmux ペインを、そのセッションのシェルでタブに開く。 */
  openPaneInTab(pane: string): Promise<void>;
  /** タブの箱が映しているシェル。 */
  getTabTarget(): string | null;
  focusTab(): void;
};

/** xterm 1 つと、その下の状態の行。パネルとタブの間で箱ごと付け替える。 */
type ScreenSlot = {
  el: HTMLElement;
  screen: TerminalScreenHandle;
  status: HTMLElement;
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
  let stateErrors: AgentStateObservationError[] = [];
  /** パネルで映す枠。 */
  let panel: ScreenSlot | null = null;
  /** タブで映す枠。最初にタブで映すときに作る。 */
  let tab: ScreenSlot | null = null;
  /** パネルの中の、枠を置く場所。 */
  let panelPane: HTMLElement | null = null;
  const tabElement = document.createElement("div");
  tabElement.id = "terminal-tab";
  tabElement.className = "terminal-tab";
  const tabPane = document.createElement("div");
  tabPane.className = "terminal-pane";
  tabElement.append(tabPane);
  /** タブで開いているシェル。 */
  let tabbed: ReadonlySet<string> = new Set();
  /** タブの箱の attach の世代。待つ間に別のタブへ切り替わったら、後から来た結果を捨てる。 */
  let tabGeneration = 0;
  /** 見出しの行 (パネルのタブの行) に置く、このビューの小さな操作。 */
  let viewActions: HTMLElement | null = null;
  let sessionsToggle: HTMLButtonElement | null = null;
  let readOnlyBadge: HTMLElement | null = null;
  /**
   * セッションの一覧 (左の列) を開いているか。既定は畳む: エージェントは常設の
   * サイドバーから開けるので、一覧は必要なときだけ見出しのボタンで出す。
   * 開いたかどうかはユーザー単位の設定に残す (再読み込みやプロジェクトの
   * 移動で畳まれてしまわないように)。
   */
  let listsOpen = deps.isSessionsOpen();
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

  function writeStatus(el: HTMLElement, message: string | null): void {
    el.textContent = message ?? "";
    el.hidden = !message;
  }

  /** パネルの状態の行。 */
  function setStatus(message: string | null): void {
    if (panel) writeStatus(panel.status, message);
  }

  function slots(): ScreenSlot[] {
    return [panel, tab].filter((slot): slot is ScreenSlot => slot !== null);
  }

  function createSlot(): ScreenSlot {
    const status = document.createElement("p");
    status.className = "terminal-status";
    status.role = "status";
    status.hidden = true;
    const screen = createTerminalScreen({
      trackLoad: deps.trackLoad,
      actionHeaders: deps.actionHeaders,
      getText: text,
      getFontSize: () => clampTerminalFontSize(deps.getFontSize()),
      // 状態の行は枠の中にあるので、付け替えても映しているシェルの状態が付いて行く。
      onStatus: (message) => writeStatus(status, message),
      onTargetGone: () => {
        void loadLists(generation);
      },
      isImageShelfCollapsed: deps.isImageShelfCollapsed,
      setImageShelfCollapsed: deps.onImageShelfCollapsedChange,
    });
    screen.setInputEnabled(inputEnabled);
    const el = document.createElement("div");
    el.className = "terminal-slot";
    el.append(screen.el, status);
    return { el, screen, status };
  }

  /** パネルとタブの枠を入れ替える。xterm は作り直さず、DOM の親だけ変わる。 */
  function swapSlots(): void {
    if (!panel || !panelPane) return;
    const toTab = panel;
    const toPanel = tab ?? createSlot();
    panel = toPanel;
    tab = toTab;
    panelPane.replaceChildren(toPanel.el);
    tabPane.replaceChildren(toTab.el);
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

  /**
   * 文字サイズを 1 段変える。上限・下限では何もしない (メニューの項目は
   * そのとき押せなくしてある)。
   */
  function stepFontSize(direction: 1 | -1): void {
    const next = clampTerminalFontSize(
      deps.getFontSize() + direction * TERMINAL_FONT_SIZE_STEP,
    );
    if (next === clampTerminalFontSize(deps.getFontSize())) return;
    deps.onFontSizeChange(next);
    for (const slot of slots()) slot.screen.applyFontSize();
  }

  function setInputEnabled(enabled: boolean): void {
    inputEnabled = enabled;
    for (const slot of slots()) slot.screen.setInputEnabled(inputEnabled);
    syncViewActions();
  }

  function setListsOpen(open: boolean): void {
    listsOpen = open;
    deps.onSessionsOpenChange(open);
    getMount()?.classList.toggle("terminal-lists-open", open);
    syncViewActions();
    // 画面の幅が変わるので桁数を測り直す。
    panel?.screen.refit();
  }

  /** 見出しの行の操作の文言と状態。開いていない間は出さない。 */
  function syncViewActions(): void {
    if (!viewActions) return;
    const current = text();
    viewActions.hidden = !isOpen();
    if (sessionsToggle) {
      const label = listsOpen ? current.sessionsHide : current.sessionsShow;
      sessionsToggle.title = label;
      sessionsToggle.setAttribute("aria-label", label);
      sessionsToggle.setAttribute("aria-pressed", String(listsOpen));
      sessionsToggle.classList.toggle("active", listsOpen);
    }
    if (readOnlyBadge) {
      // 入力を止めているときだけ、止まっていることを見出しの行に出す。
      readOnlyBadge.hidden = inputEnabled;
      readOnlyBadge.textContent = current.readOnly;
      readOnlyBadge.title = current.readOnlyTitle;
    }
  }

  function menuItems(): ContextMenuItem[] {
    if (!isOpen()) return [];
    const current = text();
    const size = clampTerminalFontSize(deps.getFontSize());
    return [
      {
        label: `${current.fontLarger} (${size})`,
        disabled: size >= MAX_TERMINAL_FONT_SIZE,
        onSelect: () => stepFontSize(1),
      },
      {
        label: `${current.fontSmaller} (${size})`,
        disabled: size <= MIN_TERMINAL_FONT_SIZE,
        onSelect: () => stepFontSize(-1),
      },
      {
        label: inputEnabled ? current.readOnly : current.writable,
        title: inputEnabled ? current.readOnlyTitle : current.writableTitle,
        onSelect: () => setInputEnabled(!inputEnabled),
      },
      {
        label: current.reload,
        onSelect: () => void loadLists(generation),
      },
    ];
  }

  function selectShell(session: ShellSession): void {
    // タブで開いているシェルはパネルでは映さない (同じシェルを 2 か所に描かない)。
    if (tabbed.has(session.id)) {
      deps.onShowTab?.(session.id);
      return;
    }
    attached = session;
    lastTargetId = session.id;
    board?.setSelected(session.id);
    deps.onTargetChange?.(session.id);
    // attach は xterm の読み込みを挟むので、完了を待たずに focus しても
    // ターミナルがまだ無い。待ってから当てる。待つ間に別の対象へ切り替え
    // られていたら、そちらの focus を横取りしない。
    const attaching = panel?.screen.attach(session);
    if (!attaching) return;
    void attaching.then(
      () => {
        if (attached?.id === session.id) panel?.screen.focus();
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
      stateErrors,
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
        deps.trackLoad(fetch(apiUrl("tmuxPanes"))),
        deps.trackLoad(fetch(apiUrl("shellList"))),
        deps.trackLoad(fetch(apiUrl("agentStates"))),
        deps.trackLoad(fetch(apiUrl("tmuxClients"))),
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
      const nextStateResponse = (await stateRes.json()) as AgentStatesResponse;
      const nextClients = (await clientRes.json()) as TmuxClientsResponse;
      if (stale()) return;
      panes = nextPanes;
      shells = nextShells;
      states = nextStateResponse.states ?? [];
      stateErrors = nextStateResponse.errors ?? [];
      clients = nextClients;

      renderLists();

      // 映していたシェルが無くなっていたら選択を解く。
      if (attached && !findShell(attached.id)) {
        attached = null;
        panel?.screen.detach();
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
        fetch(apiUrl("agentState"), {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
          },
          // relay: ほかの code-viewer サーバにも伝える (server/terminal/read-relay.ts)。
          body: JSON.stringify({
            target,
            event: "read",
            at: Date.now(),
            relay: true,
          }),
        }),
      );
      if (myGen !== generation || disposed) return;
      if (!res.ok) {
        setStatus(await responseErrorMessage(res, text().markReadFailed));
        return;
      }
      const body = (await res.json()) as { relay?: { failures: string[] } };
      if (myGen !== generation || disposed) return;
      const failures = body.relay?.failures ?? [];
      if (failures.length > 0) {
        setStatus(`${text().markReadFailed}\n${failures.join("\n")}`);
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
  type PaneShellResult =
    | {
        ok: true;
        session: ShellSession;
        action: "switched" | "attached";
      }
    | { ok: false; gone: boolean };

  /**
   * tmux ペインを、そのセッションのシェルで見られる状態にしてもらう
   * (apiUrl("tmuxOpen"))。既にそのセッションを映しているシェルがあればそれが、
   * 無ければ新しく開いたシェルが返る。失敗は理由を report に渡す。
   */
  async function requestPaneShell(
    pane: string,
    size: { cols: number; rows: number } | null | undefined,
    report: (message: string) => void,
  ): Promise<PaneShellResult> {
    const res = await deps.trackLoad(
      fetch(apiUrl("tmuxOpen"), {
        method: "POST",
        headers: {
          ...deps.actionHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pane,
          shell: attached?.id ?? null,
          cols: size?.cols,
          rows: size?.rows,
        }),
      }),
    );
    if (res.status === 410) {
      report(await responseErrorMessage(res, text().paneClosed));
      return { ok: false, gone: true };
    }
    if (res.status === 429) {
      report(await responseErrorMessage(res, text().shellLimitReached));
      return { ok: false, gone: false };
    }
    if (!res.ok) {
      report(await responseErrorMessage(res, text().paneOpenFailed));
      return { ok: false, gone: false };
    }
    const body = (await res.json()) as {
      session: ShellSession;
      action: "switched" | "attached";
    };
    return { ok: true, ...body };
  }

  /** 新しく開いたシェルを一覧に載せる (取り直しを待たずに選べるように)。 */
  function addShell(session: ShellSession): void {
    shells = {
      available: true,
      sessions: [...(shells?.sessions ?? []), session],
    };
    renderLists();
  }

  async function openPane(pane: string): Promise<void> {
    const myGen = generation;
    try {
      const result = await requestPaneShell(
        pane,
        panel?.screen.measure(),
        (message) => {
          if (myGen === generation && !disposed) setStatus(message);
        },
      );
      if (myGen !== generation || disposed) return;
      if (result.ok === false) {
        if (result.gone) await loadLists(myGen);
        return;
      }
      setStatus(null);
      if (result.action === "attached") {
        addShell(result.session);
        selectShell(result.session);
        return;
      }
      // 既にあるシェルの tmux が動いただけ。映しているものが同じなら画面は
      // そのまま追従するので、選び直すのは別のシェルだったときだけ。
      if (attached?.id !== result.session.id) selectShell(result.session);
      // ツリーの「今出ている行」の印は、どのペインを映しているかで決まる。
      // 切り替えたばかりの対応を反映するために取り直す。
      await loadLists(myGen);
    } catch (error) {
      if (myGen !== generation || disposed) return;
      console.error("[code-viewer] tmux pane open failed", error);
      setStatus(`${text().paneOpenFailed}\n${formatErrorDetail(error)}`);
    }
  }

  /** タブの箱の状態の行 (まだ枠が無ければ作る)。 */
  function tabSlot(): ScreenSlot {
    if (!tab) {
      tab = createSlot();
      tabPane.replaceChildren(tab.el);
    }
    return tab;
  }

  async function openPaneInTab(pane: string): Promise<void> {
    const slot = tabSlot();
    try {
      const result = await requestPaneShell(
        pane,
        slot.screen.measure() ?? panel?.screen.measure(),
        (message) => writeStatus(slot.status, message),
      );
      if (disposed || !result.ok) return;
      if (result.action === "attached") addShell(result.session);
      deps.onOpenInTab?.(result.session, pane);
    } catch (error) {
      if (disposed) return;
      console.error("[code-viewer] tmux pane open in tab failed", error);
      writeStatus(
        slot.status,
        `${text().paneOpenFailed}\n${formatErrorDetail(error)}`,
      );
    }
  }

  /** 一覧に無ければ取り直して探す。閉じられていれば null。 */
  async function resolveShell(id: string): Promise<ShellSession | null> {
    const known = findShell(id);
    if (known) return known;
    const res = await deps.trackLoad(fetch(apiUrl("shellList")));
    if (!res.ok)
      throw new Error(await responseErrorMessage(res, text().shellListFailed));
    const list = (await res.json()) as ShellListResponse;
    return list.sessions.find((item) => item.id === id) ?? null;
  }

  async function showInTab(id: ShellSessionId): Promise<void> {
    if (disposed) return;
    const myGen = ++tabGeneration;
    if (panel && panel.screen.getAttached()?.id === id) {
      // パネルで映しているシェルをタブへ。同じ xterm を箱ごと付け替える。
      // パネルに来る枠 (前のタブの枠) は、別のシェルを映していれば離す。
      swapSlots();
      panel.screen.detach();
      attached = null;
      lastTargetId = null;
      board?.setSelected(null);
      deps.onTargetChange?.(null);
      if (isOpen()) setStatus(text().selectPane);
      return;
    }
    const slot = tabSlot();
    if (slot.screen.getAttached()?.id === id) return;
    try {
      const session = await resolveShell(id);
      if (myGen !== tabGeneration || disposed) return;
      if (!session) {
        slot.screen.detach();
        writeStatus(slot.status, text().shellClosed);
        return;
      }
      await slot.screen.attach(session);
      if (myGen === tabGeneration && !disposed) slot.screen.focus();
    } catch (error) {
      if (myGen !== tabGeneration || disposed) return;
      console.error("[code-viewer] terminal tab attach failed", error);
      writeStatus(
        slot.status,
        `${text().loadFailed}\n${formatErrorDetail(error)}`,
      );
    }
  }

  function releaseTab(id: ShellSessionId): void {
    if (tab?.screen.getAttached()?.id !== id) return;
    tabGeneration += 1;
    tab.screen.detach();
  }

  async function moveTabToPanel(id: ShellSessionId): Promise<void> {
    const session = tab?.screen.getAttached();
    if (session?.id !== id) {
      // タブの箱が映していない (まだ前面に出していない) なら、パネルで開くだけ。
      await open(id);
      return;
    }
    if (!isOpen()) await open(null);
    if (disposed || !isOpen() || tab?.screen.getAttached()?.id !== id) return;
    panel?.screen.detach();
    swapSlots();
    tabGeneration += 1;
    attached = session;
    lastTargetId = session.id;
    board?.setSelected(session.id);
    deps.onTargetChange?.(session.id);
    setStatus(null);
    panel?.screen.focus();
  }

  async function createShell(): Promise<void> {
    const myGen = generation;
    const size = panel?.screen.measure();
    try {
      const res = await deps.trackLoad(
        fetch(apiUrl("shellCreate"), {
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
        fetch(apiUrl("shellClose"), {
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
      panel?.screen.detach();
      deps.onTargetChange?.(null);
    }
    if (tab?.screen.getAttached()?.id === id) tab.screen.detach();
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
    if (board && panel && host.childElementCount > 0) return;
    const current = text();
    host.replaceChildren();

    // 見出しと閉じるはパネルのタブの行が持つ。このビューの操作はその行の
    // 右の枠 (#app-panel-view-actions) に置く: セッションの一覧の開閉と、
    // 入力を止めているときの札。文字の大きさ・入力のオンオフ・取り直しは
    // その行の「⋯」(menuItems)。
    const actionsHost = deps.$<HTMLElement>("#app-panel-view-actions");
    if (actionsHost) {
      actionsHost.replaceChildren();
      readOnlyBadge = document.createElement("span");
      readOnlyBadge.className = "terminal-readonly-badge";
      readOnlyBadge.hidden = true;
      sessionsToggle = document.createElement("button");
      sessionsToggle.type = "button";
      sessionsToggle.className = "app-panel-icon terminal-sessions-toggle";
      sessionsToggle.innerHTML = iconSvg(
        "octicon-sidebar-expand",
        SIDEBAR_SHOW_16_PATHS,
      );
      sessionsToggle.addEventListener("click", () => setListsOpen(!listsOpen));
      actionsHost.append(readOnlyBadge, sessionsToggle);
      viewActions = actionsHost;
    }
    host.classList.toggle("terminal-lists-open", listsOpen);

    board = createSessionBoard({
      getText: text,
      onSelectShell: (row) => {
        const session = findShell(row.target);
        if (session) selectShell(session);
      },
      onOpenPane: (row) => void openPane(row.target),
      onCreateShell: () => void createShell(),
      onCloseShell: (id) => void closeShell(id),
      onShowTab: (id) => deps.onShowTab?.(id),
      onOpenInTab: (row) => {
        if (row.kind === "tmux") {
          void openPaneInTab(row.target);
          return;
        }
        const session = findShell(row.target);
        if (session) deps.onOpenInTab?.(session);
      },
      onMarkRead: (row) => void markRead(row.target),
    });

    // 一覧を作る前に知らされたタブの印を渡す。
    board.setTabbed(tabbed);

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
        panel?.screen.refit();
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

    panel = createSlot();

    // 左にツリー、右にターミナル。縦積みだとツリーが数行しか見えず、どれを
    // 選ぶかを決める前に画面が尽きる。
    const pane = document.createElement("div");
    pane.className = "terminal-pane";
    pane.append(panel.el);
    panelPane = pane;

    const body = document.createElement("div");
    body.className = "terminal-body";
    body.append(lists, listResizer, pane);
    // 組み立てるたびに作り直す箱なので、ここで付ければ二重に登録されない。
    blockScrollChaining(body);

    host.append(body);
    syncViewActions();
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
    syncViewActions();
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
    syncViewActions();
    // 読み込み中だった GET と、その後の選択を無効化する。
    generation += 1;
    stopPolling();
    // 閉じている間まで購読を続けない。シェル自体は残るので、開き直せば
    // 続きから見られる。
    //
    // 何を映していたかは覚えておく。Tools タブへ移って戻ったときに選び直させ
    // られると、毎回一覧から選ぶことになる。
    if (attached) lastTargetId = attached.id;
    panel?.screen.detach();
    attached = null;
  }

  function localize(): void {
    if (!board) return;
    syncViewActions();
    board.localize();
    for (const slot of slots()) slot.screen.localize();
    renderLists();
  }

  async function openPaneFromOutside(pane: string): Promise<void> {
    if (!isOpen()) await open(null);
    if (disposed || !isOpen()) return;
    await openPane(pane);
  }

  return {
    open,
    openPane: openPaneFromOutside,
    close,
    isOpen,
    getActiveTarget: () => attached?.id ?? lastTargetId,
    tabElement,
    showInTab,
    releaseTab,
    moveTabToPanel,
    setTabbed(ids) {
      tabbed = ids;
      board?.setTabbed(ids);
    },
    openPaneInTab,
    getTabTarget: () => tab?.screen.getAttached()?.id ?? null,
    focusTab: () => tab?.screen.focus(),
    refit: () => {
      for (const slot of slots()) slot.screen.refit();
    },
    menuItems,
    localize,
    dispose() {
      disposed = true;
      generation += 1;
      stopPolling();
      for (const slot of slots()) slot.screen.dispose();
      panel = null;
      tab = null;
      board = null;
    },
  };
}
