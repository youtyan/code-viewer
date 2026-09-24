import { apiUrl, PROJECT_HEADER } from "../../core/api-url";
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
import { TERMINAL_16_PATHS } from "../../core/icons";
import type { TerminalSoftKey } from "../../core/mobile-layout";
import { UNINTERRUPTIBLE_REQUEST_HEADER } from "../../core/network-activity";
import type {
  ShellListResponse,
  ShellSession,
  ShellSessionId,
} from "../../core/shell";
import type { TerminalImageRef } from "../../core/terminal-images";
import type { TmuxClientWindow, TmuxPlace } from "../../core/tmux";
import {
  clampTerminalFontSize,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_STEP,
} from "../../core/tmux";
import type { ContextMenuItem } from "../context-menu";
import { renderEmptyState } from "../empty-state";
import { type TerminalLang, type TerminalText, terminalText } from "./i18n";
import type { ImageShelfLayout } from "./image-shelf";
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
  /** 画像の棚の置き場所と大きさ (ユーザー単位の設定)。 */
  getImageShelfLayout?(): ImageShelfLayout;
  /** そのペインのエージェントの名前 (棚の見出し)。エージェントでなければ null。 */
  paneName?(paneId: string): string | null;
  /** 画面のファイルのパスを開く (プロジェクトの根からの相対パスと行)。 */
  onOpenFile?(path: string, line: number | undefined, kept: boolean): void;
  /** 棚の置き場所か大きさを変えた。保存は呼び出し側 (app.ts) が持つ。 */
  onImageShelfLayoutChange?(patch: Partial<ImageShelfLayout>): void;
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
  /**
   * そのシェルが終わった (exit・tmux から抜けた・映していたペインが終わった)。
   * タブを閉じて知らせてもらう。「セッションを止める」で止めたシェルには呼ばない
   * (止めた人は知っている)。前面でないタブのシェルの終わりはここには来ない
   * (購読していない)。app が全画面共通の取り直しで拾う。
   */
  onShellEnded(id: ShellSessionId): void;
  /**
   * tmux のペインを開けなかった。理由はその面の状態の行にも出すが、前面が
   * その端末でないと見えないので、常に見える場所にも出してもらう。
   */
  onOpenFailed(message: string): void;
  /**
   * 「新しいシェルで開き直す」でカレントにするプロジェクトの鍵 (そのタブの
   * グループのプロジェクト。undefined ならこのページのプロジェクト)。無ければ
   * このページのプロジェクトで開く。
   */
  reopenProject?(id: ShellSessionId): Promise<string | undefined>;
  /** そのシェルの中の tmux の端末とウインドウの大きさ。無ければ null。 */
  tmuxWindow(id: ShellSessionId): TmuxClientWindow | null;
  /** 端末の大きさを変えた。tmux の大きさを早めに取り直してもらう。 */
  onTmuxWindowStale(): void;
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
  /** 画像の棚の置き場所と大きさを設定から当て直す (設定の欄・別の窓で変えたとき)。 */
  applyImageShelfLayout(): void;
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
  /**
   * 新しいシェルを開き、そのタブを前面に出してもらう。失敗は reject する。
   * project はカレントにするプロジェクトの鍵 (無ければこのページのプロジェクト)。
   * id はそのタブのシェルの ID のまま開き直すとき (サーバが起き直して終わった)。
   */
  createShell(
    side: TabSide,
    project?: string,
    id?: ShellSessionId,
  ): Promise<void>;
  /**
   * サーバが起き直して終わったシェルのタブを、同じ ID のシェルで保存した tmux の
   * 場所へ繋ぎ直す。そのシェルを映していた面は新しいシェルを映し直す。場所が
   * もう無い・合わない (tmux が起き直した) なら "gone"。ほかの失敗は reject する。
   */
  reviveInTab(
    id: ShellSessionId,
    place: TmuxPlace,
  ): Promise<"revived" | "gone">;
  /**
   * サーバが起き直して終わった、tmux を映していなかったシェルのタブ。閉じずに、
   * 映す面では端末の代わりに空の状態の案内と「新しいシェルで開き直す」を出す。
   */
  markEnded(id: ShellSessionId): void;
  /** シェルを止める。映していたタブの購読もやめる。失敗は reject する。 */
  closeShell(id: ShellSessionId): Promise<void>;
  /** シェルの一覧を取り直す。失敗は reject する (覚えている一覧は変えない)。 */
  loadShells(): Promise<ShellListResponse>;
  /** 最後に取ったシェルの一覧 (まだ取っていなければ null)。 */
  knownShells(): ShellListResponse | null;
  /** tmux の大きさが新しく届いた。映している端末の覆いを描き直す。 */
  updateTmuxCovers(): void;
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
  /** 「セッションを止める」で止めている最中のシェル。終わっても知らせない。 */
  const stopping = new Set<ShellSessionId>();
  /**
   * サーバが起き直して終わった、tmux を映していなかったシェル。開き直すまで、
   * そのタブを映す面に案内を出す (markEnded)。
   */
  const ended = new Set<ShellSessionId>();
  /** 面ごとの、タブが映すよう頼んだシェル (showInTab。タブを閉じたら null)。 */
  const showing: Record<TabSide, ShellSessionId | null> = {
    left: null,
    right: null,
  };

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
      onShellExited: (session) => {
        forgetShell(session.id);
        if (!stopping.has(session.id)) deps.onShellEnded(session.id);
      },
      tmuxWindow: (session) => deps.tmuxWindow(session.id),
      onTmuxWindowStale: deps.onTmuxWindowStale,
      isImageShelfCollapsed: deps.isImageShelfCollapsed,
      setImageShelfCollapsed: deps.onImageShelfCollapsedChange,
      getImageShelfLayout: deps.getImageShelfLayout,
      paneName: deps.paneName,
      onOpenFile: deps.onOpenFile,
      // 棚で変えたら、保存してから両方の面の棚に当て直す。
      setImageShelfLayout: (patch) => {
        deps.onImageShelfLayoutChange?.(patch);
        for (const slot of slots()) slot.screen.applyImageShelfLayout();
      },
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
    if (existing) {
      // 終わったシェルの案内を出していた面は枠に戻す。
      if (existing.el.parentElement !== tabPanes[side])
        tabPanes[side].replaceChildren(existing.el);
      return existing;
    }
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
      // 同じ ID で開き直したシェルは、前のものと入れ替える。
      sessions: [
        ...(shells?.sessions ?? []).filter((item) => item.id !== session.id),
        session,
      ],
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
    const report = (message: string) => {
      writeStatus(slot, message);
      deps.onOpenFailed(message);
    };
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

  async function createShell(
    side: TabSide,
    project?: string,
    id?: ShellSessionId,
  ): Promise<void> {
    const size = tabs[side]?.screen.measure();
    const res = await deps.trackLoad(
      fetch(apiUrl("shellCreate"), {
        method: "POST",
        headers: {
          ...deps.actionHeaders(),
          "Content-Type": "application/json",
          // 入口はシェルの作業場所をこの鍵で決める (server/entry/server.ts)。
          ...(project ? { [PROJECT_HEADER]: project } : {}),
        },
        body: JSON.stringify({ id, cols: size?.cols, rows: size?.rows }),
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
    // 止めたことは止めた人が知っている。終わりの知らせ (onShellEnded) は出さない。
    // 止める応答より先に「終わった」が流れに届くので、頼む前に印を付ける。
    stopping.add(id);
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
      if (!res.ok)
        throw new Error(
          await responseErrorMessage(res, text().shellCloseFailed),
        );
      if (disposed) return;
      releaseTab(id);
      forgetShell(id);
    } finally {
      stopping.delete(id);
    }
  }

  async function showInTab(id: ShellSessionId, side: TabSide): Promise<void> {
    if (disposed) return;
    showing[side] = id;
    if (ended.has(id)) {
      showEnded(side, id);
      return;
    }
    const myGen = ++tabGeneration[side];
    if (tabs[otherSide(side)]?.screen.getAttached()?.id === id) {
      // もう一方の面で映していたシェル (反対側へ移したタブ)。枠ごと付け替える。
      showing[otherSide(side)] = null;
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
    ended.delete(id);
    for (const side of ["left", "right"] as const) {
      if (showing[side] === id) showing[side] = null;
      const slot = tabs[side];
      if (slot?.screen.getAttached()?.id !== id) continue;
      tabGeneration[side] += 1;
      slot.screen.detach();
    }
  }

  /** 終わったシェルのタブを映す面に、端末の代わりに案内を出す。 */
  function showEnded(side: TabSide, id: ShellSessionId): void {
    tabGeneration[side] += 1;
    tabs[side]?.screen.detach();
    const current = text();
    tabPanes[side].replaceChildren(
      renderEmptyState({
        icon: TERMINAL_16_PATHS,
        title: current.shellEndedByRestart,
        hint: current.shellEndedByRestartHint,
        actions: [
          {
            label: current.reopenShell,
            primary: true,
            run: () => void reopenEnded(id, side),
          },
        ],
      }),
    );
  }

  /** 案内の「新しいシェルで開き直す」: 同じ ID のシェルを開き、そのタブで映す。 */
  async function reopenEnded(id: ShellSessionId, side: TabSide): Promise<void> {
    // 開いたシェルのタブを前面に出す (onOpenInTab) と、すぐ映しに来る。その前に外す。
    ended.delete(id);
    try {
      await createShell(side, await deps.reopenProject?.(id), id);
    } catch (error) {
      ended.add(id);
      console.error(`[code-viewer] could not reopen the shell ${id}`, error);
      deps.onOpenFailed(formatErrorDetail(error));
    }
    // 前面に出しても配置が変わらなければ映しに来ない。案内を出したままの面を映し直す。
    for (const side of ["left", "right"] as const)
      if (showing[side] === id) void showInTab(id, side);
  }

  function markEnded(id: ShellSessionId): void {
    ended.add(id);
    forgetShell(id);
    for (const side of ["left", "right"] as const)
      if (showing[side] === id) showEnded(side, id);
  }

  async function reviveInTab(
    id: ShellSessionId,
    place: TmuxPlace,
  ): Promise<"revived" | "gone"> {
    const res = await deps.trackLoad(
      fetch(apiUrl("tmuxOpen"), {
        method: "POST",
        headers: {
          ...deps.actionHeaders(),
          "Content-Type": "application/json",
          // 画面の切替の取消で止めない (サーバだけがシェルを開き、タブは古いまま残る)。
          [UNINTERRUPTIBLE_REQUEST_HEADER]: "1",
        },
        body: JSON.stringify({
          pane: place.pane,
          revive: { shell: id, session: place.session, window: place.window },
        }),
      }),
    );
    if (res.status === 410) return "gone";
    if (!res.ok)
      throw new Error(await responseErrorMessage(res, text().paneOpenFailed));
    const body = (await res.json()) as { session: ShellSession };
    if (disposed) return "revived";
    addShell(body.session);
    // 映していた面の購読は前のサーバで切れている (読み直した直後なら、シェルが
    // 無いので付いていない)。新しいシェルに付け直す。
    for (const side of ["left", "right"] as const) {
      if (showing[side] !== id) continue;
      const slot = tabSlot(side);
      tabGeneration[side] += 1;
      await slot.screen.attach(body.session);
    }
    return "revived";
  }

  return {
    tabPaneFor: (side) => tabPanes[side],
    showInTab,
    releaseTab,
    openPaneInTab,
    createShell,
    reviveInTab,
    markEnded,
    closeShell,
    loadShells,
    knownShells: () => shells,
    updateTmuxCovers: () => {
      for (const slot of slots()) slot.screen.updateTmuxCover();
    },
    focusTab: (side) => tabs[side]?.screen.focus(),
    sendSoftKey: (side, key) => tabs[side]?.screen.sendSoftKey(key),
    refit: () => {
      for (const slot of slots()) slot.screen.refit();
    },
    applyFontSize: () => {
      for (const slot of slots()) slot.screen.applyFontSize();
    },
    menuItems,
    applyImageShelfLayout() {
      for (const slot of slots()) slot.screen.applyImageShelfLayout();
    },
    localize() {
      for (const slot of slots()) slot.screen.localize();
      for (const side of ["left", "right"] as const) {
        const id = showing[side];
        if (id !== null && ended.has(id)) showEnded(side, id);
      }
    },
    dispose() {
      disposed = true;
      for (const slot of slots()) slot.screen.dispose();
      tabs.left = null;
      tabs.right = null;
    },
  };
}
