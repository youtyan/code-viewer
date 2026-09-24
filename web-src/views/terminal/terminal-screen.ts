import { apiUrl } from "../../core/api-url";
import { UNINTERRUPTIBLE_REQUEST_HEADER } from "../../core/network-activity";
// ドロワーが映しているターミナルを xterm.js に描き、打鍵を送り返す部分。
//
// 映すのは PTY のシェル 1 本だけ。PTY が吐いた分だけが順に届くので、描き方は
// 追記になり、スクロールバックは xterm 自身が持つ。大きさはこちらが決めて
// PTY に伝えるので、表示領域が変われば PTY をその寸法にリサイズするだけで
// 中で動いているものが追従する。tmux もその 1 つで、シェルの中で起動すれば
// 他の端末で使うのと同じように動く (ドロワーが tmux を特別扱いすることは
// 無くなった)。
//
// xterm 自体は別バンドル (web/xterm.js)。ドロワーを開くまで落ちてこない。

import {
  formatErrorDetail,
  responseErrorMessage,
} from "../../core/error-detail";
import {
  softKeySequence,
  type TerminalSoftKey,
} from "../../core/mobile-layout";
import {
  clampShellSize,
  type ShellSession,
  type ShellSessionId,
} from "../../core/shell";
import {
  findImagePathLinks,
  findImagePathsNewestFirst,
  MAX_TERMINAL_IMAGE_QUERY,
  type PathLink,
  stripAnsi,
  type TerminalImageHistoryResponse,
  type TerminalImageRef,
  type TerminalImagesResponse,
  type TerminalPaneBox,
  type TerminalPaneLayout,
  type TerminalPaneLayoutResponse,
  type TerminalRevealRequest,
  validateTerminalImageResponseUrls,
} from "../../core/terminal-images";
import {
  findTextLinks,
  MAX_TERMINAL_PATH_QUERY,
  type TerminalPathHit,
  type TerminalPathsResponse,
} from "../../core/terminal-links";
import {
  isShiftEnter,
  type PasteImageResponse,
  SHIFT_ENTER_SEQUENCE,
} from "../../core/terminal-paste";
import type { TmuxClientWindow } from "../../core/tmux";
import {
  loadXterm,
  type XtermBufferLine,
  type XtermFitAddon,
  type XtermTerminal,
  type XtermTheme,
} from "../../core/xterm-loader";
import type { TerminalText } from "./i18n";
import { openImageLightbox } from "./image-lightbox";
import {
  createImageShelf,
  type ImageShelfLayout,
  type ShelfOpenMode,
} from "./image-shelf";
import {
  addShelfOrigins,
  mergeShelf,
  type ShelfEntry,
  type ShelfOrigin,
  type ShelfUpdate,
  shelfEntryByCandidate,
  shelfGallery,
} from "./image-shelf-list";
import {
  createTerminalLinkLayer,
  type LinkSegment,
  type ScreenLink,
  screenLinkKey,
} from "./terminal-links-layer";
import { useWebglRenderer } from "./terminal-renderer";
import { tmuxCover } from "./tmux-cover";

/** シェルの scrollback 行数。 */
const SHELL_SCROLLBACK = 5000;

/** リサイズ通知の間引き。ドラッグ中に毎フレーム送らない。 */
const RESIZE_DEBOUNCE_MS = 150;

/**
 * 端末のフォント。powerline のセパレータやファイラのアイコンは私用領域
 * (U+E000-) の字なので、普通の等幅フォントには入っていない。持っている
 * フォント (Nerd Font) を先に並べておく。
 *
 * フォント指定は字ごとに後ろへ落ちるので、Nerd Font が入っていない環境でも
 * 本文は下の等幅フォントでそのまま出る (アイコンだけ豆腐になる)。逆に
 * アイコンだけを持つ Symbols Nerd Font Mono は等幅フォントの後ろに置く。
 * 本文は使い慣れたフォントのまま、無い字だけを拾わせるため。
 *
 * どれも Mono 版を先に置く。Nerd Font の通常版と Propo 版はアイコンを
 * 1 マスに収めず可変幅で描くので、桁がずれて tmux の升目と合わなくなる。
 */
const TERMINAL_FONT_FAMILY = [
  '"JetBrainsMono Nerd Font Mono"',
  '"FiraCode Nerd Font Mono"',
  '"Hack Nerd Font Mono"',
  '"MesloLGS NF"',
  '"HackGen Console NF"',
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Consolas",
  '"Liberation Mono"',
  '"Symbols Nerd Font Mono"',
  "monospace",
].join(", ");

/**
 * 棚を覚えておく対象の数。パネルのタブを行き来しても棚が空にならないように
 * するためのもので、シェルを渡り歩く使い方でも際限なく溜めない。
 */
const MAX_REMEMBERED_TARGETS = 8;

/**
 * 出力の走査で次のチャンクへ持ち越す文字数。PTY の出力は任意の位置で
 * 切れるので、境界をまたいだパスを拾うには前の末尾が要る。
 */
const SHELL_SCAN_TAIL = 512;

/**
 * 同じ綴りを聞き直すまでの間。同じパスがもう一度出力に出たら、上書きされた
 * かもしれないので聞き直す (更新時刻が変わっていれば棚の先頭へ上がる)。
 * 全画面を描き直すアプリの下では同じ画面が続けて届くので、間を空ける。
 */
const IMAGE_REQUERY_MS = 3000;

/** 画面のファイルのパスを確かめられなかったとき、聞き直すまでの間。 */
const PATH_LOOKUP_RETRY_MS = 5000;

/** 「ターミナルで見る」で示したペインの枠を残す間。 */
const REVEAL_FRAME_MS = 3000;

/**
 * tmux でないシェルで、パスが出た行を探しにさかのぼる行数 (新しい方から)。
 * 棚の出どころと「ターミナルで見る」の両方がこの範囲を見る。
 */
const SHELL_ORIGIN_SEARCH_LINES = 1000;

export type TerminalScreenDeps = {
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  /** 副作用リクエスト用のヘッダ (app.ts の actionHeaders)。 */
  actionHeaders(): HeadersInit;
  getText(): TerminalText;
  /** 画面下に出す状態メッセージ。null で消す。 */
  onStatus(message: string | null): void;
  /** 映していたシェルが無くなった。一覧を取り直してもらう。 */
  onTargetGone(session: ShellSession): void;
  /** 映していたシェルが終わった (exit・tmux から抜けた・映していたペインが終わった)。 */
  onShellExited(session: ShellSession): void;
  /**
   * そのシェルの中の tmux の端末とウインドウの大きさ (全画面共通の取り直しで
   * 届いた最後の値)。tmux が動いていなければ null。
   */
  tmuxWindow(session: ShellSession): TmuxClientWindow | null;
  /** 端末の大きさを変えた。tmux の大きさを早めに取り直してもらう。 */
  onTmuxWindowStale(): void;
  /** 人が選んだ文字サイズ (px)。 */
  getFontSize(): number;
  /** 画像の棚を畳んでいるか (ユーザー単位の設定)。 */
  isImageShelfCollapsed(): boolean;
  /** 棚を畳んだ・開いた。保存は呼び出し側。 */
  setImageShelfCollapsed(collapsed: boolean): void;
  /** 棚の置き場所と大きさ (ユーザー単位の設定)。無ければ右・既定の大きさ。 */
  getImageShelfLayout?(): ImageShelfLayout;
  /** そのペインのエージェントの名前 (棚の見出し)。エージェントでなければ null。 */
  paneName?(paneId: string): string | null;
  /**
   * 画面のファイルのパスを code-viewer で開く (path はプロジェクトの根からの
   * 相対パス、line は行)。kept なら固定のタブ。
   */
  onOpenFile?(path: string, line: number | undefined, kept: boolean): void;
  /** 棚の置き場所か大きさを変えた。保存とほかの棚への当て直しは呼び出し側。 */
  setImageShelfLayout?(patch: Partial<ImageShelfLayout>): void;
  /** 棚の画像を画像のタブで開く。無ければ覆いで開く。 */
  /** kept なら固定のタブで (中ボタン・⌘/Ctrl・右クリックの「タブで開く」)。 */
  onOpenImage?: (
    image: TerminalImageRef,
    gallery: TerminalImageRef[],
    kept: boolean,
  ) => void;
};

export type TerminalScreenHandle = {
  el: HTMLElement;
  /** 文字サイズが変わった。作り直さずに今の端末へ当て直す。 */
  applyFontSize(): void;
  attach(session: ShellSession): Promise<void>;
  detach(): void;
  /** ドロワーの幅が変わったとき。 */
  refit(): void;
  focus(): void;
  /** 端末の操作札 (電話・指の画面) を押した。打鍵と同じ経路で送る。 */
  sendSoftKey(key: TerminalSoftKey): void;
  setInputEnabled(enabled: boolean): void;
  dispose(): void;
  /** 今映しているシェル。tmux へ「このペインを開いて」と頼む宛先になる。 */
  getAttached(): ShellSession | null;
  /** 表示領域に入る桁数・行数。新しいシェルを開くときの寸法に使う。 */
  measure(): { cols: number; rows: number } | null;
  /** 言語が変わった。棚の文言を当て直す。 */
  localize(): void;
  /** tmux の大きさが届いた。ウインドウの外側の覆いを描き直す。 */
  updateTmuxCover(): void;
  /** 画像の棚の置き場所と大きさを設定から当て直す。 */
  applyImageShelfLayout(): void;
};

/**
 * 文字と地のコントラスト比の下限 (WCAG の AA)。TUI が暗い地を前提に選んだ
 * 256 色の薄い灰や、明るい地の上の淡い色を、xterm が色相を保ったまま読める
 * 明るさまで動かす (淡色 (SGR 2) はこの半分。xterm の決まり)。
 */
export const TERMINAL_MINIMUM_CONTRAST_RATIO = 4.5;

/**
 * 端末の色。style.css 先頭の名前の層 (--color-term*) から読む。xterm は
 * CSS 変数を読めないので、作るときとテーマ・ターミナルの明暗が変わったときに
 * 値を渡す。
 *
 * 読むのはターミナルの面 ([data-terminal-surface]) の値 (ターミナルの明暗が
 * ダークなら、画面がライトでもダークの配色。style.css の「ダーク」の塊)。
 * 画面の箱そのものではなく body に置いた見本の箱から読む: 裏にあるタブの端末は
 * 文書から外れていることがあり、外れた箱の計算値は空になる。
 */
export function terminalTheme(): XtermTheme {
  const probe = document.createElement("div");
  probe.dataset.terminalSurface = "";
  probe.hidden = true;
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const background = read("--color-term");
  const foreground = read("--color-term-text");
  const theme = {
    background,
    foreground,
    cursor: read("--color-accent-strong"),
    cursorAccent: background,
    selectionBackground: read("--color-term-select"),
    // 端末の中の色も状態の色と揃え、ライトの地でも読めるようにする
    // (xterm の既定の ANSI の色は暗い地向け)。
    red: read("--color-failed"),
    green: read("--color-working"),
    yellow: read("--color-waiting"),
    magenta: read("--color-done"),
    white: read("--color-term-white"),
    brightWhite: read("--color-term-text"),
  };
  probe.remove();
  return theme;
}

/** 貼り付けの知らせ (保存した場所) を出しておく時間。読み切れる長さ。 */
const PASTE_NOTICE_MS = 8000;

export function createTerminalScreen(
  deps: TerminalScreenDeps,
): TerminalScreenHandle {
  const el = document.createElement("div");
  el.className = "terminal-pane-body";

  const screenEl = document.createElement("div");
  screenEl.className = "terminal-screen";

  // 画像の棚。ターミナルの画面の右に、別の列として場所を取る (文字の上に
  // 重ねない)。出力から拾った画像も、貼り付けた画像もここに並ぶ。棚が出る・
  // 畳まれると画面の幅が変わるので、screenEl を見ている ResizeObserver が
  // 桁数を測り直して PTY に伝える。
  const shelf = createImageShelf({
    getText: () => deps.getText(),
    isCollapsed: () => deps.isImageShelfCollapsed(),
    setCollapsed: (collapsed) => deps.setImageShelfCollapsed(collapsed),
    onOpen: (entry, mode) => openShelfEntry(entry, mode),
    onImageError: (entry) => recheckShelfEntry(entry),
    onLocate: (entry) => locateShelfEntry(entry),
    onReveal: (entry) => void revealShelfEntry(entry),
    getLayout: deps.getImageShelfLayout,
    paneName: deps.paneName,
    setLayout: deps.setImageShelfLayout,
  });

  const screenRow = document.createElement("div");
  screenRow.className = "terminal-screen-row";
  screenRow.append(screenEl, shelf.el);

  el.append(screenRow);

  let term: XtermTerminal | null = null;
  let fitAddon: XtermFitAddon | null = null;
  let source: EventSource | null = null;
  let attached: ShellSession | null = null;
  let resizeObserver: ResizeObserver | null = null;
  /** 棚と端末を合わせた箱の大きさを棚に知らせる (狭すぎれば棚を畳む)。 */
  let roomObserver: ResizeObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let inputEnabled = true;
  let disposed = false;
  /** 状態の行に出している文。貼り付けの知らせを時間で消すときに、後から出た別の文を消さないため。 */
  let shownStatus: string | null = null;
  let pasteNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  /** 出している貼り付けの知らせ。出力が来ても消さない (打ち込んだパスの反響で消えた)。 */
  let pasteNotice: string | null = null;
  // attach の世代。読み込みを待つ間に別の対象へ切り替えられたら、後から
  // 返ってきた初期化で画面を作り直さない。
  let generation = 0;
  // 送信待ちの打鍵。POST の往復中に打たれた分をここに溜め、1 本ずつ順に
  // 送る。並走させると届く順が入れ替わる。
  let pendingInput = "";
  let sending = false;
  // 溜め置きの出力 (購読前に出ていた分) のうち、xterm がまだ解釈し終えて
  // いない書き込みの数。流し直しの中の問い合わせ (tmux が attach したときの
  // DA など) に xterm は答え直すが、その答えを待つ者はもういないので、PTY へ
  // 送ると利用者のペインに `1;2c0;276;0c` のような文字として入る。この間に
  // xterm が出す文字は送らない。xterm の onData は答えと打鍵を区別しないので、
  // この数ミリ秒 (attach の直後、流し直しを解釈している間) に打った分も送られ
  // ない。
  let replayWrites = 0;
  // 出力から拾った綴りと、最後に問い合わせた時刻。attach ごとに作り直す
  // (clear するのではなく作り直すのは、飛んでいる問い合わせが次の対象の
  // 表を触らないようにするため)。
  let queriedImagePaths = new Map<string, number>();
  // 棚の項目に合わせて、端末の中のパスを選択で示している間 true。外すのは
  // 自分が付けた選択だけ (利用者の選択は消さない)。
  /** 画面に見えているリンク (画像のパス・URL・ファイルのパス)。 */
  let screenLinks: ScreenLink[] = [];
  /** 描き直しの予約 (requestAnimationFrame)。 */
  let linksFrame: number | null = null;
  /**
   * 画面のファイルのパス → プロジェクトの中の実在するファイル (無ければ null)。
   * attach ごとに作り直す (相対パスの起点がシェルで変わる)。
   */
  let pathCache = new Map<string, TerminalPathHit | null>();
  let pathsPending = new Set<string>();
  let pathLookupPausedUntil = 0;
  let pathLookupErrorShown = false;
  /** 棚の中身 (新しい順)。 */
  let shelfEntries: ShelfEntry[] = [];
  /** 見つけた順番の最後。新しく見つけたものほど大きい番号を振る。 */
  let shelfSeq = 0;
  /** ペインの作業場所を引けなかったことを、この attach で伝えたか。 */
  let baseErrorShown = false;
  /** ペインの並び・中身を読めなかったことを、この attach で伝えたか。 */
  let originErrorShown = false;
  /**
   * シェルが映している tmux のウインドウのペインの並び (最後に届いたもの)。
   * tmux を映していなければ null。
   */
  let paneLayout: TerminalPaneLayout | null = null;
  /** 棚の項目にカーソルが載っている間、その項目 (枠を描き直す宛先)。 */
  let locatedEntry: ShelfEntry | null = null;
  /** 「ターミナルで見る」の枠を消す時計。 */
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  /** 読めなかったサムネイルのうち、もう聞き直した URL (聞き直しの繰り返しを止める)。 */
  let recheckedUrls = new Set<string>();
  /**
   * 対象ごとの棚。
   *
   * パネルは Terminal と Tools がタブになっていて、切り替えると detach する。
   * 覚えていないと、戻ってきたときに棚が空になり、パスが既に流れていれば
   * 履歴の走査で拾える範囲しか戻らない。
   */
  const rememberedShelves = new Map<
    string,
    { entries: ShelfEntry[]; seq: number }
  >();
  /** 出力の走査で持ち越している末尾。 */
  let shellScanTail = "";
  /**
   * tmux のウインドウの外側 (tmux が点で埋める所) の覆い。xterm の画面の要素
   * (`.xterm-screen`) の中に置き、行と桁で位置を決める (箱の寸法は変えない)。
   * 操作は通す (pointer-events: none。下の端末がクリック・選択・ホイールを
   * 受ける)。
   */
  const cover = document.createElement("div");
  cover.className = "terminal-tmux-cover";
  cover.hidden = true;
  /**
   * 棚の項目の出どころのペインの枠。覆いと同じく `.xterm-screen` の中に置き、
   * 行と桁で位置を決める。描くのはペインの縁の線だけ (中の文字は覆わない)。
   */
  const paneFrame = document.createElement("div");
  paneFrame.className = "terminal-pane-frame";
  paneFrame.hidden = true;

  // 画面の中の画像のパス・URL・ファイルのパスの印と操作 (terminal-links-layer.ts)。
  const linkLayer = createTerminalLinkLayer(screenEl, {
    getText: () => deps.getText(),
    term: () => term,
    links: () => screenLinks,
    open: (link, mode) => openScreenLink(link, mode),
    copyValue: (link) =>
      link.url ??
      link.file?.absolute ??
      shelfEntryByCandidate(shelfEntries, link.text)?.path ??
      link.text,
    onHover: (link) =>
      shelf.highlight(
        link?.kind === "image"
          ? (shelfEntryByCandidate(shelfEntries, link.text)?.key ?? null)
          : null,
      ),
    onStatus: (message) => showStatus(message),
  });

  function enqueueInput(data: string): void {
    if (!inputEnabled || !attached || disposed || data.length === 0) return;
    pendingInput += data;
    void flushInput();
  }

  /**
   * 表示領域に合わせて桁数・行数を決め、PTY にも伝える。
   *
   * PTY を作り替えれば、その中で動いているもの (シェルでも tmux でも) が
   * SIGWINCH を受けて自分で追従する。こちらが中身の寸法を気にする必要は無い。
   */
  function fitShellToContainer(): void {
    if (!term || !fitAddon || !attached) return;
    // 箱が畳まれて幅 0 のときに測ると、最小の桁数が PTY に伝わり、利用者の
    // tmux のウィンドウまで縮む。見えるようになってから測り直す。
    const box = screenEl.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    fitAddon.fit();
    const size = clampShellSize(term.cols, term.rows);
    if (size.cols === attached.cols && size.rows === attached.rows) return;
    // 通ってから記録する。先に書き換えると、失敗しても「同じサイズ」と見えて
    // 送り直されず、PTY 側だけ古い桁数のまま残る。
    void sendShellResize(attached.id, size.cols, size.rows);
  }

  function refit(): void {
    if (!attached) return;
    scheduleShellResize();
  }

  function scheduleShellResize(): void {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      fitShellToContainer();
    }, RESIZE_DEBOUNCE_MS);
  }

  async function sendShellResize(
    id: ShellSessionId,
    cols: number,
    rows: number,
  ): Promise<void> {
    try {
      const res = await deps.trackLoad(
        fetch(apiUrl("shellResize"), {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
            // 画面の切替の取消で寸法の送信を捨てない (network-activity)。
            [UNINTERRUPTIBLE_REQUEST_HEADER]: "1",
          },
          body: JSON.stringify({ id, cols, rows }),
        }),
      );
      if (!res.ok) {
        showStatus(
          await responseErrorMessage(res, deps.getText().resizeFailed),
        );
        return;
      }
      // 通った分だけ記録する。切り替え済みなら書き戻さない。
      if (attached?.id === id) {
        attached.cols = cols;
        attached.rows = rows;
        // 中の tmux の大きさも変わる。覆いを合わせるため、早めに取り直す。
        deps.onTmuxWindowStale();
      }
    } catch (error) {
      if (disposed) return;
      console.error("[code-viewer] shell resize request failed", error);
      showStatus(`${deps.getText().resizeFailed}\n${formatErrorDetail(error)}`);
    }
  }

  async function flushInput(): Promise<void> {
    if (sending || !pendingInput || !attached || disposed) return;
    sending = true;
    const target = attached;
    const data = pendingInput;
    pendingInput = "";
    try {
      const res = await deps.trackLoad(
        fetch(apiUrl("shellKeys"), {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
            // 画面の切替の取消で打鍵を捨てない (打った文字が黙って消える)。
            [UNINTERRUPTIBLE_REQUEST_HEADER]: "1",
          },
          body: JSON.stringify({ id: target.id, data }),
        }),
      );
      if (disposed) return;
      if (res.status === 410) {
        showStatus(await responseErrorMessage(res, deps.getText().shellClosed));
        deps.onTargetGone(target);
        return;
      }
      if (!res.ok) {
        showStatus(await responseErrorMessage(res, deps.getText().sendFailed));
      }
    } catch (error) {
      // 中断 (ナビゲーション) と通信断。打った内容は失われるので伝える。
      if (!disposed) {
        console.error("[code-viewer] shell input request failed", error);
        showStatus(`${deps.getText().sendFailed}\n${formatErrorDetail(error)}`);
      }
    } finally {
      sending = false;
      if (pendingInput) void flushInput();
    }
  }

  /** 棚の中身を差し替えて描き直し、対象ごとの記憶にも残す。 */
  function setShelf(entries: ShelfEntry[]): void {
    shelfEntries = entries;
    shelf.render(entries);
    // 画像のパスの印は棚にある画像だけに付ける。
    scheduleLinks();
    if (!attached) return;
    rememberedShelves.delete(attached.id);
    rememberedShelves.set(attached.id, { entries, seq: shelfSeq });
    // 対象がいくつも入れ替わる使い方でも際限なく溜めない。
    if (rememberedShelves.size > MAX_REMEMBERED_TARGETS) {
      const oldest = rememberedShelves.keys().next().value;
      if (oldest !== undefined) rememberedShelves.delete(oldest);
    }
  }

  /**
   * 出力から新しく見つけた分を入れる。後に出てきたものほど新しい。
   *
   * @param order 問い合わせた候補 (古い順)
   */
  function mergeLiveUpdate(update: ShelfUpdate, order: string[]): void {
    setShelf(
      mergeShelf(
        shelfEntries,
        update,
        {
          added: () => {
            shelfSeq += 1;
            return shelfSeq;
          },
          changed: () => {
            shelfSeq += 1;
            return shelfSeq;
          },
        },
        order,
      ),
    );
  }

  /** 応答の base に失敗の理由があれば、この attach で 1 回だけ伝える。 */
  function reportBase(body: TerminalImagesResponse): void {
    if (body.originError && !originErrorShown) {
      originErrorShown = true;
      console.error(
        "[code-viewer] terminal image origins failed",
        body.originError,
      );
      showStatus(`${deps.getText().imageOriginFailed}\n${body.originError}`);
    }
    if (!body.base?.error || baseErrorShown) return;
    baseErrorShown = true;
    console.error(
      "[code-viewer] terminal image base fell back",
      body.base.source,
      body.base.error,
    );
    showStatus(`${deps.getText().imageBaseFailed}\n${body.base.error}`);
  }

  /**
   * 拾ったパスをサーバに問い合わせ、結果を棚に入れる。
   *
   * 相対パスは、このシェルが映しているペインの作業場所から解いてもらう
   * (shell を渡す)。取りにいく URL もサーバが決めるので、こちらは組み立てない。
   *
   * @param queried 問い合わせ済みの表。attach ごとに作り直されるので、途中
   *   で対象が変わっても前の表を掴んだまま片付けられる
   */
  async function resolveImagePaths(
    paths: string[],
    myGen: number,
    queried: Map<string, number>,
  ): Promise<void> {
    const target = attached;
    if (!target) return;
    const params = new URLSearchParams();
    params.set("shell", target.id);
    for (const path of paths) params.append("path", path);
    try {
      const res = await deps.trackLoad(
        fetch(`${apiUrl("agentImages")}?${params.toString()}`),
      );
      if (disposed || myGen !== generation) return;
      // 配れない候補は 200 の rejected で返る。ここに来るのはサーバ側の異常
      // だけ。
      if (!res.ok) {
        for (const path of paths) queried.delete(path);
        showStatus(
          await responseErrorMessage(res, deps.getText().imageListFailed),
        );
        return;
      }
      const body = validateTerminalImageResponseUrls(
        (await res.json()) as TerminalImagesResponse,
        window.location.href,
      );
      // 応答を待つ間に別の対象へ切り替わっていたら、その棚には入れない。
      if (disposed || myGen !== generation) return;
      reportBase(body);
      mergeLiveUpdate(body, paths);
      applyOrigins(body, paths);
    } catch (error) {
      // 中断 (ナビゲーション) と通信断。覚えたままにすると聞き直せないので
      // 忘れる。同じパスがまた流れれば拾い直せる。
      for (const path of paths) queried.delete(path);
      if (!disposed && myGen === generation) {
        console.error("[code-viewer] terminal image lookup failed", error);
        showStatus(
          `${deps.getText().imageListFailed}\n${formatErrorDetail(error)}`,
        );
      }
    }
  }

  /**
   * 繋いだときに 1 回、ペインの tmux の履歴をさかのぼって拾う。出力の流れを
   * 走査するだけでは、画面から流れた過去のパスは拾えない。
   *
   * 履歴で見つけたものは、繋いでから出力で見つけたものより古い扱いにする
   * (負の番号を振る)。応答は新しい順。
   */
  async function loadImageHistory(
    session: ShellSession,
    myGen: number,
  ): Promise<void> {
    try {
      const res = await deps.trackLoad(
        fetch(
          `${apiUrl("agentImagesHistory")}?shell=${encodeURIComponent(session.id)}`,
        ),
      );
      if (disposed || myGen !== generation) return;
      if (!res.ok) {
        showStatus(
          await responseErrorMessage(res, deps.getText().imageHistoryFailed),
        );
        return;
      }
      const body = validateTerminalImageResponseUrls(
        (await res.json()) as TerminalImageHistoryResponse,
        window.location.href,
      );
      if (disposed || myGen !== generation) return;
      reportBase(body);
      setShelf(
        mergeShelf(
          shelfEntries,
          body,
          {
            added: (index) => -(index + 1),
            changed: () => {
              shelfSeq += 1;
              return shelfSeq;
            },
          },
          body.candidates,
        ),
      );
      applyOrigins(body, body.candidates);
    } catch (error) {
      if (!disposed && myGen === generation) {
        console.error("[code-viewer] terminal image history failed", error);
        showStatus(
          `${deps.getText().imageHistoryFailed}\n${formatErrorDetail(error)}`,
        );
      }
    }
  }

  /**
   * 棚の項目を開く。画像のタブができたら開き先をここで差し替える (開く口は
   * これ 1 つ)。読めなかった項目は、押すと確かめ直す。
   */
  function openShelfEntry(entry: ShelfEntry, mode: ShelfOpenMode): void {
    if (!entry.image) {
      recheckShelfEntry(entry);
      return;
    }
    const gallery = shelfGallery(shelfEntries);
    // 既定は画像のタブ (分割していれば隣の面)。覆いは Alt / Shift か右クリック。
    if (mode !== "overlay" && deps.onOpenImage) {
      shelf.setOpened(entry.key);
      deps.onOpenImage(entry.image, gallery, mode === "kept-tab");
      return;
    }
    const index = gallery.findIndex((image) => image.path === entry.key);
    openImageLightbox(
      { images: gallery, index: Math.max(index, 0) },
      deps.getText(),
    );
  }

  /** その項目をもう一度問い合わせる (消えた・読めるようになった、を知る)。 */
  function recheckShelfEntry(entry: ShelfEntry): void {
    if (!attached) return;
    const url = entry.image?.url;
    if (url) {
      // 同じ URL で何度も失敗して聞き直し続けない。
      if (recheckedUrls.has(url)) return;
      recheckedUrls.add(url);
    }
    queriedImagePaths.set(entry.path, Date.now());
    void resolveImagePaths([entry.path], generation, queriedImagePaths);
  }

  /**
   * まだ問い合わせていない (か、しばらく聞いていない) 候補をサーバへ回す。
   *
   * @param paths 候補 (古い順)。1 回で聞ける数を超えたら新しいほうを聞く
   */
  function queueImagePaths(paths: string[]): void {
    if (!attached) return;
    const now = Date.now();
    const fresh = paths
      .filter((path) => {
        const last = queriedImagePaths.get(path);
        return last === undefined || now - last >= IMAGE_REQUERY_MS;
      })
      .slice(-MAX_TERMINAL_IMAGE_QUERY);
    if (fresh.length === 0) return;
    const queried = queriedImagePaths;
    for (const path of fresh) queried.set(path, now);
    void resolveImagePaths(fresh, generation, queried);
  }

  /**
   * 出力から画像のパスを拾う。追記なので、チャンクの境界だけ気にすればよい。
   *
   * 端末側の折り返しは PTY のバイト列に入らないので幅は渡さない。CLI が自分で
   * 折り返した行は、幅と無関係に findImagePathsInText が組み直す。
   *
   * 並びは最後に出てきた位置の古い順 (繋いだ直後やアプリの描き直しでは画面
   * 全体が 1 回で届くので、書き直して出し直したパスを新しい扱いにする)。
   */
  function scanShellOutput(chunk: string): void {
    const text = shellScanTail + stripAnsi(chunk);
    shellScanTail = text.slice(-SHELL_SCAN_TAIL);
    queueImagePaths(findImagePathsNewestFirst(text, 0).reverse());
  }

  /**
   * バッファの 1 行を文字列にし、文字列の添字 → マス目の桁の表も作る。全角の
   * 字は 2 マスを取るので、添字と桁は一致しない。
   */
  function readRow(
    line: XtermBufferLine | undefined,
    columns?: { from: number; to: number },
  ): {
    text: string;
    cells: number[];
    widths: number[];
  } {
    if (!line) return { text: "", cells: [], widths: [] };
    let text = "";
    const cells: number[] = [];
    const widths: number[] = [];
    // columns を渡すと、その桁の範囲だけを読む (tmux のペイン 1 つぶん)。
    const to = Math.min(line.length, columns?.to ?? line.length);
    for (let x = columns?.from ?? 0; x < to; x += 1) {
      const cell = line.getCell(x);
      if (!cell) break;
      const width = cell.getWidth();
      // 全角の字の後ろ半分。字は前の桁が持っている。
      if (width === 0) continue;
      const chars = cell.getChars() || " ";
      for (let i = 0; i < chars.length; i += 1) {
        cells.push(x);
        widths.push(width);
      }
      text += chars;
    }
    const trimmed = text.replace(/\s+$/, "");
    return {
      text: trimmed,
      cells: cells.slice(0, trimmed.length),
      widths: widths.slice(0, trimmed.length),
    };
  }

  /** 描き直しを次の描画の前に 1 回だけ行う (出力が続いても重くしない)。 */
  function scheduleLinks(): void {
    if (linksFrame !== null || disposed) return;
    linksFrame = requestAnimationFrame(() => {
      linksFrame = null;
      if (disposed) return;
      screenLinks = computeLinks();
      linkLayer.render();
    });
  }

  /**
   * 画面に見えている範囲のリンク。tmux を映していればペインごとに (その桁の
   * 範囲と幅で) 読む。画像のパスは棚にあるものだけ、ファイルのパスはサーバが
   * このプロジェクトの中で実在すると答えたものだけ (まだ訊いていなければ訊く)。
   */
  function computeLinks(): ScreenLink[] {
    if (!term) return [];
    const buffer = term.buffer.active;
    const top = buffer.viewportY;
    const statusTop =
      paneLayout?.statusAt === "top" ? paneLayout.statusLines : 0;
    const regions =
      paneLayout && paneLayout.panes.length > 0
        ? paneLayout.panes.map((pane) => ({
            first: top + statusTop + pane.top,
            height: pane.height,
            columns: { from: pane.left, to: pane.left + pane.width },
            width: pane.width,
          }))
        : [
            {
              first: top,
              height: term.rows,
              columns: undefined,
              width: term.cols,
            },
          ];
    const known = new Set<string>();
    for (const entry of shelfEntries) {
      if (!entry.image) continue;
      for (const candidate of entry.candidates) known.add(candidate);
    }
    const links: ScreenLink[] = [];
    const unknownPaths = new Set<string>();
    for (const region of regions) {
      const rows = Array.from({ length: region.height }, (_, i) => ({
        index: region.first + i,
        ...readRow(buffer.getLine(region.first + i), region.columns),
      }));
      const texts = rows.map((row) => row.text);
      const left = region.columns?.from ?? 0;
      const right = (region.columns?.to ?? term.cols) - 1;
      const taken = new Set<string>();
      const add = (
        link: Omit<ScreenLink, "key" | "segments">,
        found: PathLink,
      ) => {
        const segments = linkSegments(rows, found, left, right);
        const first = segments?.[0];
        if (!segments || !first) return;
        taken.add(`${found.start.row}:${found.start.col}`);
        links.push({
          ...link,
          key: screenLinkKey(link.text, first),
          segments,
        });
      };
      for (const found of findImagePathLinks(texts, region.width, (value) =>
        known.has(value),
      )) {
        const entry = shelfEntryByCandidate(shelfEntries, found.candidate);
        if (!entry?.image) continue;
        add(
          {
            kind: "image",
            text: found.candidate,
            image: { url: entry.image.url, name: entry.name },
          },
          found,
        );
      }
      for (const found of findTextLinks(texts, region.width)) {
        if (taken.has(`${found.start.row}:${found.start.col}`)) continue;
        if (found.kind === "url") {
          add({ kind: "url", text: found.candidate, url: found.path }, found);
          continue;
        }
        const hit = pathCache.get(found.path);
        if (hit === undefined) unknownPaths.add(found.path);
        if (!hit) continue;
        add(
          {
            kind: "file",
            text: found.candidate,
            file: {
              path: hit.path,
              absolute: hit.absolute,
              ...(found.line !== undefined ? { line: found.line } : {}),
              ...(found.column !== undefined ? { column: found.column } : {}),
            },
          },
          found,
        );
      }
    }
    if (unknownPaths.size > 0) queuePathLookups([...unknownPaths]);
    return links;
  }

  /**
   * 拾ったリンクを、画面の行ごとの桁の範囲にする。2 行にまたがるものは、
   * 1 行目の始まりから範囲の右端まで・2 行目の左端から終わりまで。
   */
  function linkSegments(
    rows: Array<{ index: number; cells: number[]; widths: number[] }>,
    link: PathLink,
    left: number,
    right: number,
  ): LinkSegment[] | null {
    const cells = linkCells(rows, link);
    if (!cells) return null;
    if (cells.startY === cells.endY) {
      return [{ y: cells.startY, x0: cells.startX, x1: cells.endX }];
    }
    return [
      { y: cells.startY, x0: cells.startX, x1: right },
      { y: cells.endY, x0: left, x1: cells.endX },
    ];
  }

  /** まだ確かめていないファイルのパスをサーバに訊く (見えている分だけ)。 */
  function queuePathLookups(paths: string[]): void {
    if (!attached || Date.now() < pathLookupPausedUntil) return;
    const fresh = paths
      .filter((path) => !pathsPending.has(path))
      .slice(0, MAX_TERMINAL_PATH_QUERY);
    if (fresh.length === 0) return;
    for (const path of fresh) pathsPending.add(path);
    void lookupPaths(fresh, generation, pathCache, pathsPending);
  }

  /**
   * @param cache attach ごとに作り直す表。途中で対象が変わっても前の表を
   *   掴んだまま書くので、次の対象の表を汚さない
   */
  async function lookupPaths(
    paths: string[],
    myGen: number,
    cache: Map<string, TerminalPathHit | null>,
    pending: Set<string>,
  ): Promise<void> {
    const target = attached;
    if (!target) return;
    const params = new URLSearchParams();
    params.set("shell", target.id);
    for (const path of paths) params.append("path", path);
    const text = deps.getText();
    try {
      const res = await deps.trackLoad(
        fetch(`${apiUrl("agentPaths")}?${params.toString()}`),
      );
      if (disposed || myGen !== generation) return;
      if (!res.ok) {
        pathLookupFailed(
          await responseErrorMessage(res, text.linkLookupFailed),
        );
        return;
      }
      const body = (await res.json()) as TerminalPathsResponse;
      if (disposed || myGen !== generation) return;
      const hits = new Map(body.files.map((file) => [file.candidate, file]));
      for (const path of paths) cache.set(path, hits.get(path) ?? null);
      scheduleLinks();
    } catch (error) {
      if (disposed || myGen !== generation) return;
      console.error("[code-viewer] terminal path lookup failed", error);
      pathLookupFailed(`${text.linkLookupFailed}\n${formatErrorDetail(error)}`);
    } finally {
      for (const path of paths) pending.delete(path);
    }
  }

  /** 訊けなかった: 理由をこの attach で 1 回出し、しばらく訊き直さない。 */
  function pathLookupFailed(message: string): void {
    pathLookupPausedUntil = Date.now() + PATH_LOOKUP_RETRY_MS;
    if (pathLookupErrorShown) return;
    pathLookupErrorShown = true;
    showStatus(message);
  }

  /**
   * 画面のリンクを開く。URL は新しいブラウザのタブ (opener を渡さない)、
   * ファイルは code-viewer でそのファイル (行があればその行)、画像は棚と同じ
   * 開き方。
   */
  function openScreenLink(link: ScreenLink, mode: ShelfOpenMode): void {
    if (link.kind === "url" && link.url) {
      window.open(link.url, "_blank", "noopener");
      return;
    }
    if (link.kind === "file" && link.file) {
      deps.onOpenFile?.(link.file.path, link.file.line, mode === "kept-tab");
      return;
    }
    const entry = shelfEntryByCandidate(shelfEntries, link.text);
    if (entry) openShelfEntry(entry, mode);
  }

  /**
   * 拾ったリンク (行の中の文字の添字) を、バッファのマス目の位置にする。
   * x・y とも 0 始まりで、endX は最後の字が占める最後のマス (含む)。
   */
  function linkCells(
    rows: Array<{ index: number; cells: number[]; widths: number[] }>,
    link: PathLink,
  ): { startX: number; startY: number; endX: number; endY: number } | null {
    const start = rows[link.start.row];
    const end = rows[link.end.row];
    if (!start || !end) return null;
    const lastIndex = link.end.col - 1;
    const startX = start.cells[link.start.col];
    const endCell = end.cells[lastIndex];
    if (startX === undefined || endCell === undefined) return null;
    return {
      startX,
      startY: start.index,
      endX: endCell + (end.widths[lastIndex] ?? 1) - 1,
      endY: end.index,
    };
  }

  /**
   * 応答に載っていた出どころを棚の項目に足す。tmux を映していれば、サーバが
   * ペインを読んで見つけた行 (layout と sightings)。tmux でないシェルなら、
   * 端末のバッファを新しい方からさかのぼって見つけた行。
   *
   * @param candidates 問い合わせた候補
   */
  function applyOrigins(
    body: TerminalImagesResponse,
    candidates: readonly string[],
  ): void {
    if (!attached) return;
    let origins: ShelfOrigin[] = [];
    if ("layout" in body) {
      paneLayout = body.layout ?? null;
      const panes = new Map(
        (paneLayout?.panes ?? []).map((pane) => [pane.id, pane] as const),
      );
      for (const sighting of body.sightings ?? []) {
        const pane = panes.get(sighting.pane);
        if (!pane) continue;
        origins.push({
          candidate: sighting.candidate,
          pane,
          shell: null,
          line: sighting.line,
        });
      }
    } else {
      paneLayout = null;
      const shell = shellName(attached);
      origins = candidates.flatMap((candidate) => {
        const found = findInBuffer(candidate);
        return found
          ? [{ candidate, pane: null, shell, line: found.line }]
          : [];
      });
    }
    scheduleLinks();
    if (origins.length === 0) return;
    setShelf(addShelfOrigins(shelfEntries, origins));
  }

  /** シェルの名前 (起動したコマンドの最後の部分)。 */
  function shellName(session: ShellSession): string {
    const command = session.command.trim().split(/\s+/)[0] ?? "";
    return command.slice(command.lastIndexOf("/") + 1) || command;
  }

  /**
   * tmux でないシェルのバッファを新しい方からさかのぼり、その綴りが出ている
   * 行を探す。y はその行の先頭 (折り返しの続きなら折り返し始めの行)。
   */
  function findInBuffer(candidate: string): { y: number; line: string } | null {
    if (!term) return null;
    const buffer = term.buffer.active;
    const last = buffer.length - 1;
    for (let y = last; y >= 0 && y > last - SHELL_ORIGIN_SEARCH_LINES; y -= 1) {
      if (buffer.getLine(y)?.isWrapped) continue;
      let text = "";
      for (let row = y; row <= last; row += 1) {
        const line = buffer.getLine(row);
        if (!line || (row > y && !line.isWrapped)) break;
        text += line.translateToString(
          row === last || !buffer.getLine(row + 1)?.isWrapped,
        );
      }
      if (text.includes(candidate)) return { y, line: text.trim() };
    }
    return null;
  }

  /** 棚の項目の出どころが tmux のペインなら、今の並びでのそのペイン。 */
  function originPane(entry: ShelfEntry): TerminalPaneBox | null {
    const pane = entry.origins[0]?.pane;
    if (!pane || !paneLayout) return null;
    return paneLayout.panes.find((item) => item.id === pane.id) ?? null;
  }

  /**
   * ペインの枠を描く (null で消す)。ペインの縁だけを線で囲む (中の文字の上には
   * 何も置かない)。隣にペインがある辺は、境目の線のマス (半マス外) に線を
   * 重ねる。ウインドウの端の辺はペインの内側に収める (その外はステータスの行や
   * 画面の外なので、線が文字に掛かる)。
   */
  function drawPaneFrame(pane: TerminalPaneBox | null): void {
    const screen = term?.element?.querySelector<HTMLElement>(".xterm-screen");
    if (!term || !screen || !pane || !paneLayout) {
      paneFrame.hidden = true;
      return;
    }
    if (paneFrame.parentElement !== screen) screen.append(paneFrame);
    const statusTop =
      paneLayout.statusAt === "top" ? paneLayout.statusLines : 0;
    const windowCols = Math.max(
      ...paneLayout.panes.map((item) => item.left + item.width),
    );
    const windowRows = Math.max(
      ...paneLayout.panes.map((item) => item.top + item.height),
    );
    const before = (start: number) => (start > 0 ? 0.5 : 0);
    const after = (end: number, limit: number) => (end < limit ? 0.5 : 0);
    const top = pane.top - before(pane.top);
    const left = pane.left - before(pane.left);
    const set = (name: string, value: string | number) =>
      paneFrame.style.setProperty(name, String(value));
    set("--frame-cell-w", `${screen.clientWidth / term.cols}px`);
    set("--frame-cell-h", `${screen.clientHeight / term.rows}px`);
    set("--frame-top", top + statusTop);
    set("--frame-left", left);
    set(
      "--frame-rows",
      pane.top + pane.height + after(pane.top + pane.height, windowRows) - top,
    );
    set(
      "--frame-cols",
      pane.left + pane.width + after(pane.left + pane.width, windowCols) - left,
    );
    paneFrame.hidden = false;
  }

  /**
   * 棚のサムネイルにカーソルかフォーカスが載った (null で離れた)。端末の中の
   * そのパスを選択で示し、tmux ならそのペインに枠を描く。ペインは後から動かせる
   * ので、並びを取り直して描き直す。
   */
  function locateShelfEntry(entry: ShelfEntry | null): void {
    locatedEntry = entry;
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
    markPathOnScreen(entry);
    drawPaneFrame(entry ? originPane(entry) : null);
    if (entry?.origins[0]?.pane && attached) void refreshPaneLayout(entry);
  }

  /** ペインの並びを取り直し、まだ同じ項目に載っていれば描き直す。 */
  async function refreshPaneLayout(entry: ShelfEntry): Promise<void> {
    const target = attached;
    if (!target) return;
    const myGen = generation;
    try {
      const res = await deps.trackLoad(
        fetch(
          `${apiUrl("agentImagesLayout")}?shell=${encodeURIComponent(target.id)}`,
        ),
      );
      if (disposed || myGen !== generation) return;
      if (!res.ok) {
        showStatus(
          await responseErrorMessage(res, deps.getText().imageOriginFailed),
        );
        return;
      }
      const body = (await res.json()) as TerminalPaneLayoutResponse;
      if (disposed || myGen !== generation) return;
      paneLayout = body.layout;
      scheduleLinks();
      if (locatedEntry?.key !== entry.key) return;
      markPathOnScreen(entry);
      drawPaneFrame(originPane(entry));
    } catch (error) {
      if (disposed || myGen !== generation) return;
      console.error("[code-viewer] terminal pane layout failed", error);
      showStatus(
        `${deps.getText().imageOriginFailed}\n${formatErrorDetail(error)}`,
      );
    }
  }

  /**
   * 棚のサムネイルにカーソルかフォーカスが載ったら、端末の画面の中でその画像の
   * パスが出ている所を xterm の選択で示す (null で外す)。棚の 1 枚が画面の
   * どの文字列に当たるかを見せるため。
   *
   * - 文字の上に何も重ねない。decoration は代替画面 (tmux が使う) では付かない
   *   ので、xterm の標準の選択を使う
   * - 出どころが tmux のペインなら、そのペインの中だけを探す (隣のペインに
   *   同じパスが出ていても、そのペインの行を示す)
   * - 画面に何度も出ていれば一番下 (新しい方)。画面に無ければ何もしない
   *   (端末のスクロールは触らない)
   * - 利用者が選択中なら上書きせず、外すときも自分が付けた選択だけを消す
   *
   * @returns 示せたか
   */
  function markPathOnScreen(entry: ShelfEntry | null): boolean {
    if (!term || !entry) {
      linkLayer.setStrong(null);
      return false;
    }
    const buffer = term.buffer.active;
    const pane = originPane(entry);
    const statusTop =
      paneLayout?.statusAt === "top" ? paneLayout.statusLines : 0;
    // 見る範囲: ペインが分かればそのペインの行と桁、分からなければ画面全体。
    const top = buffer.viewportY + (pane ? pane.top + statusTop : 0);
    const height = pane ? pane.height : term.rows;
    const columns = pane
      ? { from: pane.left, to: pane.left + pane.width }
      : undefined;
    // 1 行上から読む (画面の頭で折り返しの続きになっているパス)。
    const first = pane ? top : Math.max(0, top - 1);
    const rows = Array.from({ length: top + height - first }, (_, i) => ({
      index: first + i,
      ...readRow(buffer.getLine(first + i), columns),
    }));
    const known = new Set(entry.candidates);
    let found: PathLink | null = null;
    let foundCells: ReturnType<typeof linkCells> = null;
    for (const link of findImagePathLinks(
      rows.map((row) => row.text),
      pane ? pane.width : term.cols,
      (candidate) => known.has(candidate),
    )) {
      const cells = linkCells(rows, link);
      if (!cells || cells.endY < top) continue;
      if (
        !foundCells ||
        cells.startY > foundCells.startY ||
        (cells.startY === foundCells.startY && cells.startX > foundCells.startX)
      ) {
        found = link;
        foundCells = cells;
      }
    }
    const segments = found
      ? linkSegments(
          rows,
          found,
          columns?.from ?? 0,
          (columns?.to ?? term.cols) - 1,
        )
      : null;
    linkLayer.setStrong(segments);
    return segments !== null;
  }

  /**
   * 棚の項目の右クリックの「ターミナルで見る」。そのパスが出た行が見える所まで
   * 端末を動かして示す。
   *
   * - tmux のペイン: 画面に出ていればそのまま選択とペインの枠で示す。流れて
   *   いれば、そのペインを tmux のコピーモードにして後ろ向きに探させる (tmux が
   *   その行まで遡り、文字を強調する)。枠はしばらく残す
   * - tmux でないシェル: 端末のバッファをさかのぼり、その行が画面の中ほどに
   *   来るまでスクロールして選択で示す
   */
  async function revealShelfEntry(entry: ShelfEntry): Promise<void> {
    if (!term || !attached) return;
    const text = deps.getText();
    const origin = entry.origins[0];
    if (origin?.pane) {
      const pane = originPane(entry);
      const shown = markPathOnScreen(entry);
      drawPaneFrame(pane);
      holdRevealFrame();
      if (shown) return;
      const request: TerminalRevealRequest = {
        shell: attached.id,
        pane: origin.pane.id,
        text: origin.candidate,
      };
      try {
        const res = await deps.trackLoad(
          fetch(apiUrl("agentImagesReveal"), {
            method: "POST",
            headers: {
              ...deps.actionHeaders(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
          }),
        );
        if (disposed) return;
        if (!res.ok) {
          showStatus(await responseErrorMessage(res, text.imageRevealFailed));
        }
      } catch (error) {
        if (disposed) return;
        console.error("[code-viewer] terminal reveal failed", error);
        showStatus(`${text.imageRevealFailed}\n${formatErrorDetail(error)}`);
      }
      return;
    }
    const candidates = origin ? [origin.candidate] : entry.candidates;
    const found = candidates
      .map((candidate) => findInBuffer(candidate))
      .find((item) => item !== null);
    if (!found) {
      showStatus(text.imageRevealNotFound);
      return;
    }
    term.scrollToLine(Math.max(0, found.y - Math.floor(term.rows / 2)));
    markPathOnScreen(entry);
    holdRevealFrame();
  }

  /** 「ターミナルで見る」の枠を、しばらくしてから消す。 */
  function holdRevealFrame(): void {
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      revealTimer = null;
      if (locatedEntry) return;
      drawPaneFrame(null);
      linkLayer.setStrong(null);
    }, REVEAL_FRAME_MS);
  }

  /** File を base64 にする。data URL の接頭辞は落として本体だけ返す。 */
  function readAsBase64(file: File): Promise<{ base64: string; url: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.onload = () => {
        const url = String(reader.result ?? "");
        const comma = url.indexOf(",");
        if (comma < 0) {
          reject(new Error("unexpected data url"));
          return;
        }
        resolve({ base64: url.slice(comma + 1), url });
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * 画像を貼り付けたときの流れ。
   *
   * 1. サーバに保存してもらい、絶対パスを受け取る
   * 2. そのパスを端末へ打ち込む。CLI のエージェントはパスを読める
   * 3. 棚にも出す。ちゃんと渡ったことが目で分かる。出力から拾った画像と
   *    同じ棚に並べる (以前はターミナルの上に別の帯を出し、棚からは同じ綴り
   *    だけを外していた。エージェントが相対パスで出し直すと両方に並んだ)
   *
   * 打ち込むのは改行を付けない。人が続けて文章を書いてから送れるようにする
   * (勝手に送ると、画像だけが単独で送信されてしまう)。
   */
  function showStatus(message: string | null): void {
    shownStatus = message;
    deps.onStatus(message);
  }

  /** 貼り付けた画像をどこに置いたかを、しばらく状態の行に出す。 */
  function showPasteNotice(message: string): void {
    showStatus(message);
    pasteNotice = message;
    if (pasteNoticeTimer) clearTimeout(pasteNoticeTimer);
    pasteNoticeTimer = setTimeout(() => {
      pasteNoticeTimer = null;
      pasteNotice = null;
      if (!disposed && shownStatus === message) showStatus(null);
    }, PASTE_NOTICE_MS);
  }

  async function pasteImage(file: File): Promise<void> {
    if (!attached) return;
    let read: { base64: string; url: string };
    try {
      read = await readAsBase64(file);
    } catch (error) {
      console.error("[code-viewer] pasted image read failed", error);
      showStatus(`${deps.getText().pasteFailed}\n${formatErrorDetail(error)}`);
      return;
    }
    try {
      const res = await deps.trackLoad(
        fetch(apiUrl("agentPaste"), {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mime: file.type, data: read.base64 }),
        }),
      );
      if (disposed) return;
      if (!res.ok) {
        showStatus(await responseErrorMessage(res, deps.getText().pasteFailed));
        return;
      }
      const saved = (await res.json()) as PasteImageResponse;
      if (disposed || !attached) return;
      // 打ち込んだパスは画面に出るが、ここで問い合わせ済みにしておくので
      // 聞き直さない。別の綴りで出ても、同じ実体なら棚では 1 枚にまとまる。
      queueImagePaths([saved.path]);
      // パスに空白は入らない命名にしてあるが、引用しておけば将来変えても壊れない。
      pendingInput += `'${saved.path}' `;
      void flushInput();
      showPasteNotice(deps.getText().pasteSaved(saved.relativePath));
    } catch (error) {
      if (!disposed) {
        console.error("[code-viewer] pasted image save failed", error);
        showStatus(
          `${deps.getText().pasteFailed}\n${formatErrorDetail(error)}`,
        );
      }
    }
  }

  /** クリップボードから最初の画像を 1 枚取る。無ければ null。 */
  function firstImage(data: DataTransfer | null): File | null {
    for (const item of data?.items ?? []) {
      if (item.kind !== "file") continue;
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) return file;
    }
    return null;
  }

  // xterm は textarea で打鍵を受けるので、貼り付けもそこから上がってくる。
  // 画像のときだけ横取りし、文字の貼り付けは xterm にそのまま任せる。
  //
  // 捕捉フェーズで受けるのが要点。xterm の paste ハンドラは 1 行目で
  // stopPropagation() を呼ぶので、浮上フェーズで待っていると一生届かない。
  // 捕捉は根から降りてくる順なので、深い位置にある xterm より先に見られる。
  el.addEventListener(
    "paste",
    (event) => {
      const file = firstImage(event.clipboardData);
      if (!file) return;
      // 画像は xterm に渡さない。文字として貼られると化けた文字列が流れる。
      event.preventDefault();
      event.stopPropagation();
      void pasteImage(file);
    },
    true,
  );

  function closeSource(): void {
    source?.close();
    source = null;
  }

  /**
   * tmux のウインドウの外側を覆う。覆うのは、届いた大きさが今の端末の桁数・
   * 行数と同じときだけ (大きさを変えた直後の古い値で、ずれた所を覆わない。
   * 次の取り直しで描き直す)。覆う所が無ければ (アプリだけが繋がっている) 何も
   * 出さない。
   */
  function renderTmuxCover(): void {
    const window = attached ? deps.tmuxWindow(attached) : null;
    const screen = term?.element?.querySelector<HTMLElement>(".xterm-screen");
    const shown =
      term &&
      screen &&
      window &&
      window.clientCols === term.cols &&
      window.clientRows === term.rows
        ? tmuxCover(window)
        : null;
    if (!term || !screen || !window || !shown || shown.rects.length === 0) {
      cover.hidden = true;
      cover.replaceChildren();
      return;
    }
    if (cover.parentElement !== screen) screen.append(cover);
    cover.style.setProperty(
      "--tmux-cell-w",
      `${screen.clientWidth / term.cols}px`,
    );
    cover.style.setProperty(
      "--tmux-cell-h",
      `${screen.clientHeight / term.rows}px`,
    );
    const text = deps.getText();
    cover.replaceChildren(
      ...shown.rects.map((rect, index) => {
        const part = document.createElement("div");
        part.className = "terminal-tmux-cover-part";
        part.style.setProperty("--cover-top", String(rect.top));
        part.style.setProperty("--cover-left", String(rect.left));
        part.style.setProperty("--cover-rows", String(rect.rows));
        part.style.setProperty("--cover-cols", String(rect.cols));
        if (index === shown.messageIn) {
          const message = document.createElement("p");
          message.className = "terminal-tmux-cover-message";
          message.textContent = text.tmuxWindowSmaller(
            window.windowCols,
            window.windowRows,
            window.sessionClients > 1,
          );
          part.append(message);
        }
        return part;
      }),
    );
    cover.hidden = false;
  }

  function destroyTerminal(): void {
    term?.dispose();
    term = null;
    fitAddon = null;
  }

  async function ensureTerminal(myGen: number): Promise<XtermTerminal | null> {
    if (term) return term;
    const api = await loadXterm();
    // 読み込みを待つ間に切り替え / 破棄された。
    if (!api || disposed || myGen !== generation) return null;
    if (term) return term;
    const created = new api.Terminal({
      fontSize: deps.getFontSize(),
      fontFamily: TERMINAL_FONT_FAMILY,
      scrollback: SHELL_SCROLLBACK,
      cursorBlink: true,
      // 枠の線とブロックの字を升目いっぱいに描く (WebGL の描画で効く)。
      customGlyphs: true,
      theme: terminalTheme(),
      minimumContrastRatio: TERMINAL_MINIMUM_CONTRAST_RATIO,
    });
    // 明暗・テーマ・ターミナルの明暗 (html の data-theme / data-color-theme /
    // data-terminal-tone) が変わったら色を当て直す。
    themeObserver ??= new MutationObserver(() => {
      if (term) term.options.theme = terminalTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-color-theme", "data-terminal-tone"],
    });
    const fit = new api.FitAddon();
    created.loadAddon(fit);
    created.open(screenEl);
    // tmux のペインの境目の線が行ごとにずれて波打たないよう、WebGL で描く。
    // 使えなければ DOM のまま (理由は console に出る)。
    screenEl.dataset.renderer = useWebglRenderer(created, api, () => {
      screenEl.dataset.renderer = "dom";
    });
    // 画面のリンクは描き直しのたびに見えている範囲だけを読み直す (xterm の
    // リンクは代替画面・tmux のマウスの下で出入りと押下が届かないので使わない)。
    created.onRender(() => scheduleLinks());
    created.onScroll(() => scheduleLinks());
    // 桁数・行数が変われば覆う所も変わる (届いている tmux の大きさと合わなく
    // なれば、合うまで隠す)。
    created.onResize(() => {
      renderTmuxCover();
      scheduleLinks();
    });
    created.onData((data) => {
      if (replayWrites > 0) return;
      enqueueInput(data);
    });
    // Shift+Enter は「送信せずに改行」。xterm の既定では Enter と同じ CR に
    // なってしまい、書きかけのまま送信されるので、ここで横取りする。
    created.attachCustomKeyEventHandler((event) => {
      if (!isShiftEnter(event)) return true;
      // このハンドラは keydown / keypress / keyup の全部で呼ばれる。keydown
      // だけを止めても、続く keypress を xterm が拾って CR を送ってしまう
      // (それが「Shift+Enter なのに送信される」の正体)。3 つとも握り潰し、
      // 送るのは keydown の 1 回だけにする。
      if (event.type === "keydown" && inputEnabled && attached) {
        enqueueInput(SHIFT_ENTER_SEQUENCE);
      }
      return false;
    });
    term = created;
    fitAddon = fit;
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => refit());
      resizeObserver.observe(screenEl);
    }
    if (!roomObserver) {
      roomObserver = new ResizeObserver(() =>
        shelf.setRoom({
          width: screenRow.clientWidth,
          height: screenRow.clientHeight,
        }),
      );
      roomObserver.observe(screenRow);
    }
    return created;
  }

  function openSource(session: ShellSession, myGen: number): void {
    const stream = new EventSource(
      `${apiUrl("shellStream")}?id=${encodeURIComponent(session.id)}`,
    );
    source = stream;

    const stale = () => disposed || myGen !== generation;

    stream.addEventListener("output", (event) => {
      if (stale() || !term) return;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          data: string;
          replay?: boolean;
        };
        if (payload.replay === true) {
          replayWrites += 1;
          term.write(payload.data, () => {
            replayWrites -= 1;
          });
        } else {
          term.write(payload.data);
        }
        scanShellOutput(payload.data);
        // 出力が戻ったので、前の失敗の行を片付ける (貼り付けの知らせは残す)。
        if (shownStatus !== pasteNotice) showStatus(null);
      } catch (error) {
        console.error("[code-viewer] terminal output event failed", error);
        showStatus(
          `${deps.getText().screenFailed}\n${formatErrorDetail(error)}`,
        );
      }
    });
    stream.addEventListener("exited", (event) => {
      if (stale()) return;
      let code: number | null = null;
      try {
        code = (
          JSON.parse((event as MessageEvent<string>).data) as {
            exitCode: number;
          }
        ).exitCode;
      } catch (error) {
        console.error("[code-viewer] terminal exit event failed", error);
        showStatus(
          `${deps.getText().shellExited(null)}\n${formatErrorDetail(error)}`,
        );
        closeSource();
        deps.onShellExited(session);
        return;
      }
      showStatus(deps.getText().shellExited(code));
      closeSource();
      deps.onShellExited(session);
    });
    stream.addEventListener("gone", () => {
      if (stale()) return;
      showStatus(deps.getText().shellClosed);
      closeSource();
      deps.onTargetGone(session);
    });
    stream.onerror = () => {
      // EventSource は自動で繋ぎ直す。落ちたままなら状態表示だけ残す。
      if (stale()) return;
      if (stream.readyState === EventSource.CLOSED) {
        showStatus(deps.getText().screenFailed);
      }
    };
  }

  async function attach(session: ShellSession): Promise<void> {
    if (disposed) return;
    const myGen = ++generation;
    resetShelf();
    closeSource();
    pendingInput = "";
    attached = session;
    // 同じ対象へ戻ってきたなら、前の棚を戻す。タブを行き来しただけで消えると、
    // 流れた後のパスは開き直せない。
    const remembered = rememberedShelves.get(session.id);
    shelfSeq = remembered?.seq ?? 0;
    setShelf(remembered?.entries ?? []);
    showStatus(deps.getText().connecting);

    const created = await ensureTerminal(myGen);
    if (!created) {
      if (myGen === generation && !disposed) {
        showStatus(deps.getText().loadFailed);
      }
      return;
    }
    if (myGen !== generation || disposed) return;

    // 表示領域がサイズを決める。購読前に PTY へ伝えておく。
    fitShellToContainer();
    // 前のシェルの中身を残さない。購読が始まると、溜まっていた出力が最初に
    // まとめて流れてくる。
    //
    // 寸法を合わせてから作り直す (順番が逆だと tmux の画面が崩れる)。xterm は
    // 一度も使っていない代替画面 (tmux や vim が使う画面) を縮めても、その画面の
    // 行数の上限を縮めない。作った直後の 24 行から箱の行数へ縮めた後に tmux が
    // 代替画面へ入ると、画面に無いはずの行が溜まり、行の位置がずれて最後の行が
    // 重複して並ぶ。reset は今の寸法で両方の画面を作り直すので、上限も揃う。
    created.reset();
    renderTmuxCover();
    openSource(session, myGen);
    void loadImageHistory(session, myGen);
  }

  function resetShelf(): void {
    // 棚を空にしたら、拾い直せる状態にも戻す。表は作り直す (飛んでいる
    // 問い合わせが持っているのは前の表なので、そちらを消しても影響しない)。
    // 棚の中身は対象ごとの記憶に残っている。
    shelfEntries = [];
    shelfSeq = 0;
    shelf.render([]);
    shelf.highlight(null);
    shelf.setOpened(null);
    queriedImagePaths = new Map<string, number>();
    screenLinks = [];
    pathCache = new Map<string, TerminalPathHit | null>();
    pathsPending = new Set<string>();
    pathLookupPausedUntil = 0;
    pathLookupErrorShown = false;
    linkLayer.hide();
    linkLayer.setStrong(null);
    recheckedUrls = new Set<string>();
    baseErrorShown = false;
    originErrorShown = false;
    paneLayout = null;
    locatedEntry = null;
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = null;
    paneFrame.hidden = true;
    shellScanTail = "";
  }

  function detach(): void {
    generation += 1;
    resetShelf();
    closeSource();
    attached = null;
    renderTmuxCover();
    // 付いていたシェルの画面を残さない (閉じたシェルのタブに、直前にこの枠が
    // 映していた別のシェルの画面が出ていた)。
    term?.reset();
    pendingInput = "";
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = null;
    showStatus(null);
  }

  return {
    el,
    applyFontSize() {
      if (!term) return;
      term.options.fontSize = deps.getFontSize();
      // 桁数・行数が同じでもマス目の大きさが変わる。
      renderTmuxCover();
      // 字の大きさが変われば入る桁数・行数も変わる。PTY にも伝え直す。
      scheduleShellResize();
    },
    attach,
    detach,
    refit,
    focus() {
      term?.focus();
    },
    sendSoftKey(key) {
      if (!term) return;
      enqueueInput(softKeySequence(key, term.modes.applicationCursorKeysMode));
    },
    setInputEnabled(enabled: boolean) {
      inputEnabled = enabled;
    },
    getAttached: () => attached,
    measure() {
      const box = fitAddon?.proposeDimensions();
      // 見えていない箱を測ると NaN が返る。そのまま丸めると最小の桁数に
      // なってしまうので、測れなかったことにする。
      if (
        !box ||
        !Number.isFinite(box.cols) ||
        !Number.isFinite(box.rows) ||
        box.cols <= 0 ||
        box.rows <= 0
      ) {
        return null;
      }
      return clampShellSize(box.cols, box.rows);
    },
    localize() {
      shelf.localize();
      linkLayer.localize();
      renderTmuxCover();
    },
    updateTmuxCover: renderTmuxCover,
    applyImageShelfLayout: () => shelf.applyLayout(),
    dispose() {
      disposed = true;
      generation += 1;
      closeSource();
      shelf.dispose();
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = null;
      if (revealTimer) clearTimeout(revealTimer);
      revealTimer = null;
      if (linksFrame !== null) cancelAnimationFrame(linksFrame);
      linksFrame = null;
      linkLayer.dispose();
      resizeObserver?.disconnect();
      resizeObserver = null;
      roomObserver?.disconnect();
      roomObserver = null;
      themeObserver?.disconnect();
      themeObserver = null;
      destroyTerminal();
      attached = null;
    },
  };
}
