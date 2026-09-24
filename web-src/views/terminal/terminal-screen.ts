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
  validateTerminalImageResponseUrls,
} from "../../core/terminal-images";
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
  type XtermLink,
  type XtermTerminal,
  type XtermTheme,
} from "../../core/xterm-loader";
import type { TerminalText } from "./i18n";
import { openImageLightbox } from "./image-lightbox";
import { createImageShelf, type ShelfOpenMode } from "./image-shelf";
import {
  mergeShelf,
  type ShelfEntry,
  type ShelfUpdate,
  shelfEntryByCandidate,
  shelfGallery,
} from "./image-shelf-list";
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
};

/**
 * 端末の色。style.css 先頭の名前の層 (--color-term*) から読む。xterm は
 * CSS 変数を読めないので、作るときとテーマが変わったときに値を渡す。
 */
function terminalTheme(): XtermTheme {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const background = read("--color-term");
  const foreground = read("--color-term-text");
  return {
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
}

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
    onLocate: (entry) => markPathOnScreen(entry),
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
  let themeObserver: MutationObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let inputEnabled = true;
  let disposed = false;
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
  let markedPath = false;
  /** 棚の中身 (新しい順)。 */
  let shelfEntries: ShelfEntry[] = [];
  /** 見つけた順番の最後。新しく見つけたものほど大きい番号を振る。 */
  let shelfSeq = 0;
  /** ペインの作業場所を引けなかったことを、この attach で伝えたか。 */
  let baseErrorShown = false;
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
        deps.onStatus(
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
      deps.onStatus(
        `${deps.getText().resizeFailed}\n${formatErrorDetail(error)}`,
      );
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
        deps.onStatus(
          await responseErrorMessage(res, deps.getText().shellClosed),
        );
        deps.onTargetGone(target);
        return;
      }
      if (!res.ok) {
        deps.onStatus(
          await responseErrorMessage(res, deps.getText().sendFailed),
        );
      }
    } catch (error) {
      // 中断 (ナビゲーション) と通信断。打った内容は失われるので伝える。
      if (!disposed) {
        console.error("[code-viewer] shell input request failed", error);
        deps.onStatus(
          `${deps.getText().sendFailed}\n${formatErrorDetail(error)}`,
        );
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
    if (!body.base?.error || baseErrorShown) return;
    baseErrorShown = true;
    console.error(
      "[code-viewer] terminal image base fell back",
      body.base.source,
      body.base.error,
    );
    deps.onStatus(`${deps.getText().imageBaseFailed}\n${body.base.error}`);
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
        deps.onStatus(
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
    } catch (error) {
      // 中断 (ナビゲーション) と通信断。覚えたままにすると聞き直せないので
      // 忘れる。同じパスがまた流れれば拾い直せる。
      for (const path of paths) queried.delete(path);
      if (!disposed && myGen === generation) {
        console.error("[code-viewer] terminal image lookup failed", error);
        deps.onStatus(
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
        deps.onStatus(
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
    } catch (error) {
      if (!disposed && myGen === generation) {
        console.error("[code-viewer] terminal image history failed", error);
        deps.onStatus(
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
  function readRow(line: XtermBufferLine | undefined): {
    text: string;
    cells: number[];
    widths: number[];
  } {
    if (!line) return { text: "", cells: [], widths: [] };
    let text = "";
    const cells: number[] = [];
    const widths: number[] = [];
    for (let x = 0; x < line.length; x += 1) {
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

  /**
   * xterm のリンク。棚にある画像のパスに下線を引き、カーソルが載ったら棚の
   * 同じ画像を強調する。文字の上には何も出さない。押すと拡大表示。
   *
   * 1 行ぶんを聞かれるので、前後 1 行も合わせて見る (折り返し・CLI が割った
   * 行は 2 行にまたがる)。
   */
  function provideImageLinks(
    bufferLineNumber: number,
    callback: (links: XtermLink[] | undefined) => void,
  ): void {
    if (!term || shelfEntries.length === 0) {
      callback(undefined);
      return;
    }
    const buffer = term.buffer.active;
    const y = bufferLineNumber - 1;
    const first = Math.max(0, y - 1);
    const rows = [first, first + 1, first + 2].map((index) => ({
      index,
      ...readRow(buffer.getLine(index)),
    }));
    const known = new Set<string>();
    for (const entry of shelfEntries) {
      for (const candidate of entry.candidates) known.add(candidate);
    }
    const links: XtermLink[] = [];
    for (const link of findImagePathLinks(
      rows.map((row) => row.text),
      term.cols,
      (candidate) => known.has(candidate),
    )) {
      const cells = linkCells(rows, link);
      if (!cells || cells.startY > y || cells.endY < y) continue;
      const entry = shelfEntryByCandidate(shelfEntries, link.candidate);
      if (!entry) continue;
      links.push({
        range: {
          start: { x: cells.startX + 1, y: cells.startY + 1 },
          end: { x: cells.endX + 1, y: cells.endY + 1 },
        },
        text: link.candidate,
        decorations: { pointerCursor: true, underline: true },
        activate: (event) => {
          // Shift は xterm の選択に任せる。Alt は覆い、⌘/Ctrl は固定のタブ
          // (棚と同じ押し分け。ui-surface.md の「タブの決まり」)。
          if (event.shiftKey) return;
          const current = shelfEntryByCandidate(shelfEntries, link.candidate);
          if (current)
            openShelfEntry(
              current,
              event.altKey
                ? "overlay"
                : event.metaKey || event.ctrlKey
                  ? "kept-tab"
                  : "tab",
            );
        },
        hover: () => {
          const current = shelfEntryByCandidate(shelfEntries, link.candidate);
          shelf.highlight(current?.key ?? null);
        },
        leave: () => shelf.highlight(null),
      });
    }
    callback(links.length > 0 ? links : undefined);
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
   * 棚のサムネイルにカーソルかフォーカスが載ったら、端末の画面の中でその画像の
   * パスが出ている所を xterm の選択で示す (null で外す)。棚の 1 枚が画面の
   * どの文字列に当たるかを見せるため。
   *
   * - 文字の上に何も重ねない。decoration は代替画面 (tmux が使う) では付かない
   *   ので、xterm の標準の選択を使う
   * - 画面に何度も出ていれば一番下 (新しい方)。画面に無ければ何もしない
   *   (端末のスクロールは触らない)
   * - 利用者が選択中なら上書きせず、外すときも自分が付けた選択だけを消す
   */
  function markPathOnScreen(entry: ShelfEntry | null): void {
    if (!term) return;
    if (markedPath) {
      markedPath = false;
      term.clearSelection();
    }
    if (!entry || term.hasSelection()) return;
    const buffer = term.buffer.active;
    const top = buffer.viewportY;
    // 1 行上から読む (画面の頭で折り返しの続きになっているパス)。
    const first = Math.max(0, top - 1);
    const rows = Array.from({ length: top + term.rows - first }, (_, i) => ({
      index: first + i,
      ...readRow(buffer.getLine(first + i)),
    }));
    const known = new Set(entry.candidates);
    let found: ReturnType<typeof linkCells> = null;
    for (const link of findImagePathLinks(
      rows.map((row) => row.text),
      term.cols,
      (candidate) => known.has(candidate),
    )) {
      const cells = linkCells(rows, link);
      if (!cells || cells.endY < top) continue;
      if (
        !found ||
        cells.startY > found.startY ||
        (cells.startY === found.startY && cells.startX > found.startX)
      ) {
        found = cells;
      }
    }
    if (!found) return;
    term.select(
      found.startX,
      found.startY,
      (found.endY - found.startY) * term.cols + found.endX - found.startX + 1,
    );
    markedPath = true;
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
  async function pasteImage(file: File): Promise<void> {
    if (!attached) return;
    let read: { base64: string; url: string };
    try {
      read = await readAsBase64(file);
    } catch (error) {
      console.error("[code-viewer] pasted image read failed", error);
      deps.onStatus(
        `${deps.getText().pasteFailed}\n${formatErrorDetail(error)}`,
      );
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
        deps.onStatus(
          await responseErrorMessage(res, deps.getText().pasteFailed),
        );
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
      deps.onStatus(null);
    } catch (error) {
      if (!disposed) {
        console.error("[code-viewer] pasted image save failed", error);
        deps.onStatus(
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
      theme: terminalTheme(),
    });
    // テーマ (html の data-theme / data-palette) が変わったら色を当て直す。
    themeObserver ??= new MutationObserver(() => {
      if (term) term.options.theme = terminalTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-palette"],
    });
    const fit = new api.FitAddon();
    created.loadAddon(fit);
    created.open(screenEl);
    created.registerLinkProvider({ provideLinks: provideImageLinks });
    // 桁数・行数が変われば覆う所も変わる (届いている tmux の大きさと合わなく
    // なれば、合うまで隠す)。
    created.onResize(() => renderTmuxCover());
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
        deps.onStatus(null);
      } catch (error) {
        console.error("[code-viewer] terminal output event failed", error);
        deps.onStatus(
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
        deps.onStatus(
          `${deps.getText().shellExited(null)}\n${formatErrorDetail(error)}`,
        );
        closeSource();
        deps.onShellExited(session);
        return;
      }
      deps.onStatus(deps.getText().shellExited(code));
      closeSource();
      deps.onShellExited(session);
    });
    stream.addEventListener("gone", () => {
      if (stale()) return;
      deps.onStatus(deps.getText().shellClosed);
      closeSource();
      deps.onTargetGone(session);
    });
    stream.onerror = () => {
      // EventSource は自動で繋ぎ直す。落ちたままなら状態表示だけ残す。
      if (stale()) return;
      if (stream.readyState === EventSource.CLOSED) {
        deps.onStatus(deps.getText().screenFailed);
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
    deps.onStatus(deps.getText().connecting);

    const created = await ensureTerminal(myGen);
    if (!created) {
      if (myGen === generation && !disposed) {
        deps.onStatus(deps.getText().loadFailed);
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
    markedPath = false;
    recheckedUrls = new Set<string>();
    baseErrorShown = false;
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
    deps.onStatus(null);
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
      renderTmuxCover();
    },
    updateTmuxCover: renderTmuxCover,
    dispose() {
      disposed = true;
      generation += 1;
      closeSource();
      shelf.dispose();
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      themeObserver?.disconnect();
      themeObserver = null;
      destroyTerminal();
      attached = null;
    },
  };
}
