import { apiUrl } from "../../core/api-url";
// メインの面 (左 / 右) のターミナルのタブの中身。映すのは PTY のシェルで、
// tmux はその中で普通に動く。
//
// xterm の枠は面ごとに 1 つ (tabs.left / tabs.right)。タブを切り替えても
// 枠は作り直さず、映すシェルを付け替える。反対側へ移したタブは枠ごと
// 入れ替える (attach し直さない)。
//
// シェルの一覧はここが最後に取ったものを覚えておく (knownShells)。タブ列の
// 「＋」のメニューとパレットがそれを読み、開く直前に取り直す。

import {
  formatErrorDetail,
  responseErrorMessage,
} from "../../core/error-detail";
import type { TerminalSoftKey } from "../../core/mobile-layout";
import type {
  ShellListResponse,
  ShellSession,
  ShellSessionId,
} from "../../core/shell";
import type { TerminalImageRef } from "../../core/terminal-images";
import {
  clampTerminalFontSize,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_STEP,
} from "../../core/tmux";
import type { ContextMenuItem } from "../context-menu";
import { type TerminalLang, type TerminalText, terminalText } from "./i18n";
import {
  createTerminalScreen,
  type TerminalScreenHandle,
} from "./terminal-screen";

export type TerminalViewDeps = {
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
  /**
   * そのシェルのタブを開いて前面に出してもらう。pane は tmux ペインから
   * 開いたとき、そのペイン (シェルとペインの対応をサーバがまだ知らないときの
   * 名前付けに使う)。
   */
  onOpenInTab(
    session: ShellSession,
    pane: string | undefined,
    side: TabSide,
  ): void;
  /** 棚の画像を画像のタブで開く (既定の押し方)。 */
  onOpenImage?: (
    image: TerminalImageRef,
    gallery: TerminalImageRef[],
    kept: boolean,
  ) => void;
};

export type TerminalViewHandle = {
  /** 器の大きさが変わったとき。端末の桁数・行数を測り直す。 */
  refit(): void;
  /**
   * ターミナルのタブの右クリックに足す操作 (文字の大きさ・入力のオンオフ)。
   * 文字の大きさと入力のオンオフは全部のタブに効く。
   */
  menuItems(): ContextMenuItem[];
  localize(): void;
  dispose(): void;
  /** メインの面 (左 / 右) のターミナルの置き場所。app がその面の箱に置く。 */
  tabPaneFor(side: TabSide): HTMLElement;
  /**
   * そのシェルを面の箱で映す。もう一方の面で映していれば、同じ xterm を
   * 枠ごと付け替える (attach し直さない)。
   */
  showInTab(id: ShellSessionId, side: TabSide): Promise<void>;
  /** タブを閉じた。タブの箱がそのシェルを映していれば購読をやめる (シェルは止めない)。 */
  releaseTab(id: ShellSessionId): void;
  /** tmux ペインを、そのセッションのシェルでタブに開く。失敗はその面の箱に出す。 */
  openPaneInTab(pane: string, side: TabSide): Promise<void>;
  /** 新しいシェルを開き、そのタブを前面に出してもらう。失敗は reject する。 */
  createShell(side: TabSide): Promise<void>;
  /** シェルを止める。映していたタブの購読もやめる。失敗は reject する。 */
  closeShell(id: ShellSessionId): Promise<void>;
  /** シェルの一覧を取り直す。失敗は reject する (覚えている一覧は変えない)。 */
  loadShells(): Promise<ShellListResponse>;
  /** 最後に取ったシェルの一覧 (まだ取っていなければ null)。 */
  knownShells(): ShellListResponse | null;
  focusTab(side: TabSide): void;
  /** その面の端末へ操作札のキーを送る (映していなければ何もしない)。 */
  sendSoftKey(side: TabSide, key: TerminalSoftKey): void;
  /**
   * 文字の大きさ (deps.getFontSize) を全部の端末に当て直す。電話の段の出入りと
   * ピンチで、読む値が変わったとき。
   */
  applyFontSize(): void;
};

/** メインの面の左右。core/main-tabs.ts の PaneSide と同じ値。 */
export type TabSide = "left" | "right";

/** xterm 1 つと、その下の状態の行。左右の面の間で箱ごと付け替える。 */
type ScreenSlot = {
  el: HTMLElement;
  screen: TerminalScreenHandle;
  /** 画面の下端の 1 行 (画面を映している間の状態)。 */
  status: HTMLElement;
  /**
   * 何も映していない間に、画面の代わりに真ん中に出す案内 (文字は status と同じ)。
   * status とは別の要素にする: 同じ要素を真ん中から下端へ動かすと、画面が
   * 付いたときにレイアウトシフトになっていた (読み込みで 0.30)。
   */
  hint: HTMLElement;
};

export function createTerminalView(deps: TerminalViewDeps): TerminalViewHandle {
  /** 面ごとにタブで映す枠。最初にその面で映すときに作る。 */
  const tabs: Record<TabSide, ScreenSlot | null> = { left: null, right: null };
  /** 面ごとの、枠を置く場所 (app がその面の箱に入れる)。 */
  const tabPanes: Record<TabSide, HTMLElement> = {
    left: createTabPane(),
    right: createTabPane(),
  };
  /** 面ごとの attach の世代。待つ間に別のタブへ切り替わったら、後から来た結果を捨てる。 */
  const tabGeneration: Record<TabSide, number> = { left: 0, right: 0 };
  let shells: ShellListResponse | null = null;
  /**
   * 一覧取得の世代。最後に始めた取得の応答だけを反映する。これが無いと、
   * シェルを作った直後に古い一覧が後から届いて、作ったばかりのシェルが消える。
   */
  let listGeneration = 0;
  let inputEnabled = true;
  let disposed = false;

  function text(): TerminalText {
    return terminalText(deps.getLanguage());
  }

  function writeStatus(
    slot: Pick<ScreenSlot, "status" | "hint">,
    message: string | null,
  ): void {
    for (const el of [slot.status, slot.hint]) {
      el.textContent = message ?? "";
      el.hidden = !message;
    }
  }

  function slots(): ScreenSlot[] {
    return [tabs.left, tabs.right].filter(
      (slot): slot is ScreenSlot => slot !== null,
    );
  }

  function createSlot(): ScreenSlot {
    const status = document.createElement("p");
    status.className = "terminal-status";
    status.role = "status";
    status.hidden = true;
    // 見えるのは status か hint のどちらか一方だけ (style.css)。読み上げも
    // 見えている方から届く。
    const hint = document.createElement("p");
    hint.className = "terminal-empty-hint";
    hint.role = "status";
    hint.hidden = true;
    const screen = createTerminalScreen({
      trackLoad: deps.trackLoad,
      actionHeaders: deps.actionHeaders,
      getText: text,
      getFontSize: () => clampTerminalFontSize(deps.getFontSize()),
      // 状態の行は枠の中にあるので、付け替えても映しているシェルの状態が付いて行く。
      onStatus: (message) => writeStatus({ status, hint }, message),
      onTargetGone: (session) => forgetShell(session.id),
      isImageShelfCollapsed: deps.isImageShelfCollapsed,
      setImageShelfCollapsed: deps.onImageShelfCollapsedChange,
      onOpenImage: deps.onOpenImage,
    });
    screen.setInputEnabled(inputEnabled);
    const el = document.createElement("div");
    el.className = "terminal-slot";
    el.append(screen.el, hint, status);
    return { el, screen, status, hint };
  }

  function createTabPane(): HTMLElement {
    const pane = document.createElement("div");
    pane.className = "terminal-pane";
    return pane;
  }

  /** 左右の面の枠を入れ替える (反対側へ移したタブの xterm を付け替える)。 */
  function swapSides(): void {
    const left = tabs.right ?? createSlot();
    const right = tabs.left ?? createSlot();
    tabs.left = left;
    tabs.right = right;
    tabPanes.left.replaceChildren(left.el);
    tabPanes.right.replaceChildren(right.el);
  }

  function otherSide(side: TabSide): TabSide {
    return side === "left" ? "right" : "left";
  }

  /** その面の枠 (まだ無ければ作る)。 */
  function tabSlot(side: TabSide): ScreenSlot {
    const existing = tabs[side];
    if (existing) return existing;
    const created = createSlot();
    tabs[side] = created;
    tabPanes[side].replaceChildren(created.el);
    return created;
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
  }

  function menuItems(): ContextMenuItem[] {
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
    ];
  }

  async function loadShells(): Promise<ShellListResponse> {
    const myList = ++listGeneration;
    const res = await deps.trackLoad(fetch(apiUrl("shellList")));
    if (!res.ok)
      throw new Error(await responseErrorMessage(res, text().shellListFailed));
    const list = (await res.json()) as ShellListResponse;
    if (myList === listGeneration && !disposed) shells = list;
    return list;
  }

  /** 新しく開いたシェルを一覧に載せる (取り直しを待たずに選べるように)。 */
  function addShell(session: ShellSession): void {
    listGeneration += 1;
    shells = {
      available: true,
      sessions: [...(shells?.sessions ?? []), session],
    };
  }

  function forgetShell(id: string): void {
    if (!shells) return;
    listGeneration += 1;
    shells = {
      ...shells,
      sessions: shells.sessions.filter((item) => item.id !== id),
    };
  }

  /** 覚えている一覧に無ければ取り直して探す。閉じられていれば null。 */
  async function resolveShell(id: string): Promise<ShellSession | null> {
    const known = shells?.sessions.find((item) => item.id === id);
    if (known) return known;
    const list = await loadShells();
    return list.sessions.find((item) => item.id === id) ?? null;
  }

  async function openPaneInTab(pane: string, side: TabSide): Promise<void> {
    const slot = tabSlot(side);
    const report = (message: string) => writeStatus(slot, message);
    try {
      const size = slot.screen.measure();
      const res = await deps.trackLoad(
        fetch(apiUrl("tmuxOpen"), {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pane,
            shell: null,
            cols: size?.cols,
            rows: size?.rows,
          }),
        }),
      );
      if (disposed) return;
      if (res.status === 410) {
        report(await responseErrorMessage(res, text().paneClosed));
        return;
      }
      if (res.status === 429) {
        report(await responseErrorMessage(res, text().shellLimitReached));
        return;
      }
      if (!res.ok) {
        report(await responseErrorMessage(res, text().paneOpenFailed));
        return;
      }
      const body = (await res.json()) as {
        session: ShellSession;
        action: "switched" | "attached";
      };
      if (disposed) return;
      if (body.action === "attached") addShell(body.session);
      deps.onOpenInTab(body.session, pane, side);
    } catch (error) {
      if (disposed) return;
      console.error("[code-viewer] tmux pane open in tab failed", error);
      report(`${text().paneOpenFailed}\n${formatErrorDetail(error)}`);
    }
  }

  async function createShell(side: TabSide): Promise<void> {
    const size = tabs[side]?.screen.measure();
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
    if (res.status === 429)
      throw new Error(
        await responseErrorMessage(res, text().shellLimitReached),
      );
    if (!res.ok)
      throw new Error(
        await responseErrorMessage(res, text().shellCreateFailed),
      );
    const created = (await res.json()) as { session: ShellSession };
    if (disposed) return;
    addShell(created.session);
    deps.onOpenInTab(created.session, undefined, side);
  }

  async function closeShell(id: ShellSessionId): Promise<void> {
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
    if (!res.ok)
      throw new Error(await responseErrorMessage(res, text().shellCloseFailed));
    if (disposed) return;
    releaseTab(id);
    forgetShell(id);
  }

  async function showInTab(id: ShellSessionId, side: TabSide): Promise<void> {
    if (disposed) return;
    const myGen = ++tabGeneration[side];
    if (tabs[otherSide(side)]?.screen.getAttached()?.id === id) {
      // もう一方の面で映していたシェル (反対側へ移したタブ)。枠ごと付け替える。
      swapSides();
      tabs[side]?.screen.focus();
      return;
    }
    const slot = tabSlot(side);
    if (slot.screen.getAttached()?.id === id) {
      slot.screen.focus();
      return;
    }
    try {
      const session = await resolveShell(id);
      if (myGen !== tabGeneration[side] || disposed) return;
      if (!session) {
        slot.screen.detach();
        writeStatus(slot, text().shellClosed);
        return;
      }
      await slot.screen.attach(session);
      if (myGen === tabGeneration[side] && !disposed) slot.screen.focus();
    } catch (error) {
      if (myGen !== tabGeneration[side] || disposed) return;
      console.error("[code-viewer] terminal tab attach failed", error);
      writeStatus(slot, `${text().loadFailed}\n${formatErrorDetail(error)}`);
    }
  }

  function releaseTab(id: ShellSessionId): void {
    for (const side of ["left", "right"] as const) {
      const slot = tabs[side];
      if (slot?.screen.getAttached()?.id !== id) continue;
      tabGeneration[side] += 1;
      slot.screen.detach();
    }
  }

  return {
    tabPaneFor: (side) => tabPanes[side],
    showInTab,
    releaseTab,
    openPaneInTab,
    createShell,
    closeShell,
    loadShells,
    knownShells: () => shells,
    focusTab: (side) => tabs[side]?.screen.focus(),
    sendSoftKey: (side, key) => tabs[side]?.screen.sendSoftKey(key),
    refit: () => {
      for (const slot of slots()) slot.screen.refit();
    },
    applyFontSize: () => {
      for (const slot of slots()) slot.screen.applyFontSize();
    },
    menuItems,
    localize() {
      for (const slot of slots()) slot.screen.localize();
    },
    dispose() {
      disposed = true;
      for (const slot of slots()) slot.screen.dispose();
      tabs.left = null;
      tabs.right = null;
    },
  };
}
