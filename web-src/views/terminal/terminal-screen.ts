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
  clampShellSize,
  type ShellSession,
  type ShellSessionId,
} from "../../core/shell";
import {
  findImagePathsInText,
  findPathAnchors,
  MAX_TERMINAL_IMAGE_QUERY,
  type PathAnchor,
  stripAnsi,
  type TerminalImageRef,
  type TerminalImagesResponse,
} from "../../core/terminal-images";
import {
  controlSequenceForInput,
  isShiftEnter,
  type PasteImageResponse,
  SHIFT_ENTER_SEQUENCE,
} from "../../core/terminal-paste";
import {
  loadXterm,
  type XtermFitAddon,
  type XtermTerminal,
} from "../../core/xterm-loader";
import type { TerminalText } from "./i18n";
import { openImageLightbox } from "./image-lightbox";

const ESC = String.fromCharCode(27);

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
 * 出力から拾って帯に出す画像の上限。ビルドログのように画像パスが何十個も
 * 流れるものがあるので、帯が埋まる前に止める。貼り付けた画像は数えない
 * (人が明示的に置いたものなので、機械が拾ったぶんで押し出さない)。
 */
const MAX_DETECTED_IMAGES = 12;

/**
 * 画像を覚えておく対象の数。タブを行き来しても帯が空にならないようにする
 * ためのもので、シェルを渡り歩く使い方でも際限なく溜めない。
 */
const MAX_REMEMBERED_TARGETS = 8;

/**
 * 出力の走査で次のチャンクへ持ち越す文字数。PTY の出力は任意の位置で
 * 切れるので、境界をまたいだパスを拾うには前の末尾が要る。
 */
const SHELL_SCAN_TAIL = 512;

/**
 * 画面に重ねる画像の大きさ (端末のマス目の数)。
 *
 * 端末の中身を隠す前提なので、パスの行が読める程度に小さく取る。開きたい
 * ときは押せば元のサイズで別タブに出る。
 */
const INLINE_IMAGE_COLS = 30;
const INLINE_IMAGE_ROWS = 8;

export type TerminalScreenDeps = {
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  /** 副作用リクエスト用のヘッダ (app.ts の actionHeaders)。 */
  actionHeaders(): HeadersInit;
  getText(): TerminalText;
  /** 画面下に出す状態メッセージ。null で消す。 */
  onStatus(message: string | null): void;
  /** 映していたシェルが無くなった。一覧を取り直してもらう。 */
  onTargetGone(session: ShellSession): void;
  /** 人が選んだ文字サイズ (px)。 */
  getFontSize(): number;
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
  setInputEnabled(enabled: boolean): void;
  localize(): void;
  dispose(): void;
  /** 今映しているシェル。tmux へ「このペインを開いて」と頼む宛先になる。 */
  getAttached(): ShellSession | null;
  /** 表示領域に入る桁数・行数。新しいシェルを開くときの寸法に使う。 */
  measure(): { cols: number; rows: number } | null;
};

export function createTerminalScreen(
  deps: TerminalScreenDeps,
): TerminalScreenHandle {
  const el = document.createElement("div");
  el.className = "terminal-pane-body";

  // 貼り付けた画像と、出力から拾った画像の帯。ターミナルの上に置く。
  //
  // xterm のマス目の中に描かないのは、スクロールで流れても残したいから。
  // 外に出しておけば、パスが画面から消えた後でも開き直せる。
  const attachments = document.createElement("div");
  attachments.className = "terminal-attachments";
  attachments.hidden = true;

  const screenEl = document.createElement("div");
  screenEl.className = "terminal-screen";

  const shortcutBar = document.createElement("div");
  shortcutBar.className = "terminal-shortcuts";
  shortcutBar.role = "toolbar";
  el.append(attachments, screenEl, shortcutBar);

  let term: XtermTerminal | null = null;
  let fitAddon: XtermFitAddon | null = null;
  let source: EventSource | null = null;
  let attached: ShellSession | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let inputEnabled = true;
  let controlArmed = false;
  let disposed = false;
  // attach の世代。読み込みを待つ間に別の対象へ切り替えられたら、後から
  // 返ってきた初期化で画面を作り直さない。
  let generation = 0;
  // 送信待ちの打鍵。POST の往復中に打たれた分をここに溜め、1 本ずつ順に
  // 送る。並走させると届く順が入れ替わる。
  let pendingInput = "";
  let sending = false;
  // 出力から拾ったパスのうち、もう問い合わせたもの。attach ごとに作り直す
  // (clear するのではなく作り直すのは、飛んでいる問い合わせが次の対象の
  // 集合を触らないようにするため)。
  let queriedImagePaths = new Set<string>();
  // 帯に出したリポジトリ相対パス。問い合わせ済みの集合とは別に持つ。端末に
  // 出た綴り (相対・絶対・./ 付き) と、返ってくる相対パスは同じ文字列になる
  // ことがあり、1 つの集合で兼ねると「自分で入れた候補」を「もう出した画像」
  // と取り違えて 1 枚も出せなくなる。
  let shownImagePaths = new Set<string>();
  // 画面に重ねている画像。鍵は「画面に出ている綴り」で、実体のパスではない
  // (/tmp と /private/tmp のように食い違う)。同じ 1 枚が別々の綴りで 2 か所に
  // 出ていれば、その 2 か所どちらにも重ねる。
  let inlineImages = new Map<string, TerminalImageRef>();
  /** 画面に重ねる層。xterm の画面と同じ箱に敷くので、位置がそのまま合う。 */
  let inlineLayer: HTMLElement | null = null;
  /** 綴りごとに使い回している要素。作り直すと画像が読み込み直しになる。 */
  const inlineElements = new Map<string, HTMLAnchorElement>();
  /** 最後に置いた位置と大きさ。同じなら触らない (触ると点滅する)。 */
  let inlineLayout = "";
  /**
   * 対象ごとに、これまで見つけた画像。
   *
   * パネルは Terminal と Tools がタブになっていて、切り替えると detach する。
   * 覚えていないと、戻ってきたときに帯が空になり、パスが既に流れていれば
   * 二度と出せない。
   */
  const rememberedImages = new Map<string, TerminalImageRef[]>();
  /** 見つけた検出画像の枚数。MAX_DETECTED_IMAGES まで。 */
  let detectedImages = 0;
  /** 出力の走査で持ち越している末尾。 */
  let shellScanTail = "";

  const shortcutDefinitions = [
    { key: "escape", label: "Esc", aria: "Escape", sequence: ESC },
    { key: "control", label: "Ctrl", aria: "Control", sequence: null },
    { key: "tab", label: "Tab", aria: "Tab", sequence: "\t" },
    { key: "up", label: "↑", aria: "Arrow up", sequence: `${ESC}[A` },
    { key: "down", label: "↓", aria: "Arrow down", sequence: `${ESC}[B` },
    { key: "left", label: "←", aria: "Arrow left", sequence: `${ESC}[D` },
    { key: "right", label: "→", aria: "Arrow right", sequence: `${ESC}[C` },
  ] as const;
  const shortcutButtons = new Map<string, HTMLButtonElement>();

  for (const shortcut of shortcutDefinitions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "terminal-font-btn terminal-shortcut-btn";
    button.dataset.key = shortcut.key;
    button.textContent = shortcut.label;
    button.setAttribute("aria-label", shortcut.aria);
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      if (shortcut.key === "control") {
        setControlArmed(!controlArmed);
      } else if (shortcut.sequence !== null) {
        setControlArmed(false);
        enqueueInput(shortcut.sequence);
      }
      term?.focus();
    });
    shortcutButtons.set(shortcut.key, button);
    shortcutBar.appendChild(button);
  }
  syncShortcutControls();

  function setControlArmed(armed: boolean): void {
    controlArmed = armed && inputEnabled && attached !== null && !disposed;
    syncShortcutControls();
  }

  function syncShortcutControls(): void {
    shortcutBar.setAttribute("aria-label", deps.getText().shortcutBar);
    const disabled = !inputEnabled || attached === null || disposed;
    for (const button of shortcutButtons.values()) button.disabled = disabled;
    const control = shortcutButtons.get("control");
    if (control) {
      control.classList.toggle("active", controlArmed);
      control.setAttribute("aria-pressed", String(controlArmed));
    }
  }

  function enqueueInput(data: string): void {
    if (!inputEnabled || !attached || disposed || data.length === 0) return;
    pendingInput += data;
    void flushInput();
  }

  function enqueueKeyboardInput(data: string): void {
    if (!controlArmed) {
      enqueueInput(data);
      return;
    }
    const control = controlSequenceForInput(data);
    if (control === null) {
      deps.onStatus(deps.getText().controlUnsupported);
      return;
    }
    setControlArmed(false);
    enqueueInput(control);
  }

  /**
   * 表示領域に合わせて桁数・行数を決め、PTY にも伝える。
   *
   * PTY を作り替えれば、その中で動いているもの (シェルでも tmux でも) が
   * SIGWINCH を受けて自分で追従する。こちらが中身の寸法を気にする必要は無い。
   */
  function fitShellToContainer(): void {
    if (!term || !fitAddon || !attached) return;
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
        fetch("/_shell/resize", {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
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
        fetch("/_shell/keys", {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
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

  /**
   * 画像を 1 枚ぶん帯に足す。
   *
   * src は 2 通り。貼り付けた画像はブラウザが既に持っている data URL を使う
   * (サーバへ取りに行き直す必要が無く、保存が終わる前でも出せる)。出力から
   * 拾った画像は、リポジトリのファイルなので /_file の URL を使う。
   */
  function addAttachment(src: string, name: string, path: string): void {
    const item = document.createElement("div");
    item.className = "terminal-attachment";

    // サムネイルは小さいので、押したら拡大して読めるようにする。
    const open = document.createElement("button");
    open.type = "button";
    open.className = "terminal-attachment-open";
    const openLabel = deps.getText().openImage;
    open.title = path;
    open.setAttribute("aria-label", `${openLabel}: ${name}`);
    open.addEventListener("click", () => {
      openImageLightbox({ url: src, name, path }, deps.getText());
    });

    const image = document.createElement("img");
    image.src = src;
    image.alt = name;
    // 実体が消えていれば読めない。壊れた枠を残さず外し、記憶からも落とす。
    image.addEventListener("error", () => {
      item.remove();
      attachments.hidden = attachments.childElementCount === 0;
      if (!attached) return;
      const list = rememberedImages.get(attached.id);
      if (list) {
        rememberedImages.set(
          attached.id,
          list.filter((entry) => entry.path !== path),
        );
      }
    });
    open.appendChild(image);

    const label = document.createElement("span");
    label.className = "terminal-attachment-name";
    label.textContent = name;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "terminal-attachment-close";
    remove.textContent = "×";
    const removeLabel = deps.getText().removeAttachment;
    remove.title = removeLabel;
    remove.setAttribute("aria-label", removeLabel);
    remove.addEventListener("click", () => {
      item.remove();
      attachments.hidden = attachments.childElementCount === 0;
    });

    item.append(open, label, remove);
    attachments.appendChild(item);
    attachments.hidden = false;
  }

  /**
   * 拾ったパスをサーバに問い合わせ、配れるものを画面に重ねる対象に加える。
   *
   * 実在しないもの・画像でないものはサーバ側で落ちている。取りにいく URL も
   * サーバが決めるので、こちらは組み立てない。
   *
   * @param queried 問い合わせ済みの候補。attach ごとに作り直されるので、途中
   *   で対象が変わっても前の集合を掴んだまま片付けられる
   */
  async function resolveImagePaths(
    paths: string[],
    myGen: number,
    queried: Set<string>,
  ): Promise<void> {
    const params = new URLSearchParams();
    for (const path of paths) params.append("path", path);
    try {
      const res = await deps.trackLoad(
        fetch(`/_agent/images?${params.toString()}`),
      );
      if (disposed || myGen !== generation) return;
      // 配れない候補は 200 の空配列で返る。ここに来るのはサーバ側の異常だけ
      // なので、覚えたままにして聞き直さない。
      if (!res.ok) {
        deps.onStatus(
          await responseErrorMessage(res, deps.getText().imageListFailed),
        );
        return;
      }
      const body = (await res.json()) as TerminalImagesResponse;
      // 応答を待つ間に別の対象へ切り替わっていたら、その画面には重ねない。
      if (disposed || myGen !== generation) return;
      for (const image of body.images ?? []) {
        if (detectedImages >= MAX_DETECTED_IMAGES) break;
        // 同じ 1 枚でも綴りが違えば別の場所に出ているので、綴りごとに持つ。
        if (inlineImages.has(image.candidate)) continue;
        if (!shownImagePaths.has(image.path)) {
          shownImagePaths.add(image.path);
          detectedImages += 1;
          // 帯にも 1 枚だけ残す。画面に重ねたぶんはパスの行に紐づいていて、
          // 出力が流れてパスが見えなくなると一緒に消える。見た画像を後から
          // 開き直せるように、残るほうも要る。
          addAttachment(image.url, image.name, image.path);
        }
        rememberImage(image);
        inlineImages.set(image.candidate, image);
      }
      refreshInlineImages();
    } catch (error) {
      // 中断 (ナビゲーション) と通信断。覚えたままにすると二度と拾えないので
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

  /** 見つけた画像を対象ごとに覚える。同じ 1 枚は 1 回だけ。 */
  function rememberImage(image: TerminalImageRef): void {
    if (!attached) return;
    const list = rememberedImages.get(attached.id) ?? [];
    if (list.some((entry) => entry.path === image.path)) return;
    list.push(image);
    rememberedImages.set(attached.id, list);
    // 対象がいくつも入れ替わる使い方でも際限なく溜めない。
    if (rememberedImages.size > MAX_REMEMBERED_TARGETS) {
      const oldest = rememberedImages.keys().next().value;
      if (oldest !== undefined) rememberedImages.delete(oldest);
    }
  }

  /**
   * 同じ対象へ戻ってきたとき、覚えていた画像を帯へ戻す。
   *
   * パネルは Terminal と Tools がタブなので、切り替えるだけで detach される。
   * そこで消えると、パスが既に流れていた場合に開き直せない。
   */
  function restoreRememberedImages(session: ShellSession): void {
    for (const image of rememberedImages.get(session.id) ?? []) {
      if (detectedImages >= MAX_DETECTED_IMAGES) break;
      if (shownImagePaths.has(image.path)) continue;
      shownImagePaths.add(image.path);
      detectedImages += 1;
      addAttachment(image.url, image.name, image.path);
      // 画面にまだパスが残っていれば、そのまま重ね直せる。問い合わせ済みに
      // しておけば、同じ綴りをもう一度サーバへ聞きにいかない。
      inlineImages.set(image.candidate, image);
      queriedImagePaths.add(image.candidate);
    }
  }

  /** 重ねているものを全部外す。 */
  function clearInlineImages(): void {
    for (const element of inlineElements.values()) element.remove();
    inlineElements.clear();
    inlineLayout = "";
  }

  /**
   * マス目 1 つぶんの大きさ。画面の実寸を桁数・行数で割って出す。
   *
   * 字の大きさやドロワーの幅で変わるので、そのつど測る。まだ描かれていない
   * (実寸が 0) 間は置けないので null を返す。
   */
  function cellSize(): { width: number; height: number } | null {
    if (!term || !inlineLayer) return null;
    // 測るのは層を敷いた箱 (xterm の画面) のほう。層は inset: 0 で重なって
    // いるだけなので、大きさの出どころは親に持たせる。
    const rect = (
      inlineLayer.parentElement ?? inlineLayer
    ).getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (term.cols <= 0 || term.rows <= 0) return null;
    return { width: rect.width / term.cols, height: rect.height / term.rows };
  }

  /**
   * いま画面に出ている画像パスの上に、その画像を重ね直す。
   *
   * 画面の上に自前の層を 1 枚重ね、そこへ絶対位置で置く。xterm の decoration
   * (行に紐づく DOM) は使わない。全画面を描き直すアプリ (tmux, vim) の下では
   * 行に打った目印がそのつど捨てられ、画像が作り直されて点滅する。自前の層
   * なら、位置が変わらない限り何も触らない。
   *
   * 置くのはパスの 1 行下。パスの文字自体は隠さない。
   */
  function refreshInlineImages(): void {
    if (!term || !inlineLayer || inlineImages.size === 0) {
      if (inlineElements.size > 0) clearInlineImages();
      return;
    }
    const cell = cellSize();
    if (!cell) return;
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < term.rows; row += 1) {
      lines.push(
        buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "",
      );
    }
    const anchors = findPathAnchors(lines, [...inlineImages.keys()]);
    const layout = anchors
      .map(
        (anchor) =>
          `${anchor.candidate}@${anchor.row}+${anchor.span},${anchor.col}`,
      )
      .join("|");
    // 描画のたびに呼ばれる。位置も大きさも同じなら何も触らない。作り直すと
    // 画像が読み込み直されて点滅する。
    const shape = `${layout}#${Math.round(cell.width * 100)}x${Math.round(cell.height * 100)}`;
    if (shape === inlineLayout) return;
    inlineLayout = shape;

    const keep = new Set<string>();
    for (const anchor of anchors) {
      const image = inlineImages.get(anchor.candidate);
      if (!image) continue;
      keep.add(anchor.candidate);
      placeInlineImage(image, anchor, cell);
    }
    // 画面から消えた綴りのぶんは外す。
    for (const [candidate, element] of inlineElements) {
      if (keep.has(candidate)) continue;
      element.remove();
      inlineElements.delete(candidate);
    }
  }

  /**
   * 1 枚を置く / 置き直す。要素は綴りごとに使い回す。
   *
   * 作り直すと img が読み込み直しになるので、既にあるものは位置だけ書き換える。
   */
  function placeInlineImage(
    image: TerminalImageRef,
    anchor: PathAnchor,
    cell: { width: number; height: number },
  ): void {
    if (!inlineLayer) return;
    let element = inlineElements.get(anchor.candidate);
    if (!element) {
      element = document.createElement("a");
      element.className = "terminal-inline-image";
      // href は残す (中クリックや「新しいタブで開く」がそのまま効く)。ふつうの
      // 左クリックは横取りして、その場で拡大表示にする。
      element.href = image.url;
      element.rel = "noopener";
      element.title = image.path;
      element.addEventListener("click", (event) => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.button !== 0
        ) {
          return;
        }
        event.preventDefault();
        openImageLightbox(image, deps.getText());
      });
      const picture = document.createElement("img");
      picture.src = image.url;
      picture.alt = image.name;
      element.appendChild(picture);
      inlineLayer.appendChild(element);
      inlineElements.set(anchor.candidate, element);
    }
    element.style.left = `${anchor.col * cell.width}px`;
    // 折り返しているパスは最終行の下に置く。先頭行の下だと続きに重なる。
    element.style.top = `${(anchor.row + anchor.span) * cell.height}px`;
    element.style.width = `${INLINE_IMAGE_COLS * cell.width}px`;
    element.style.height = `${INLINE_IMAGE_ROWS * cell.height}px`;
  }

  /** まだ問い合わせていない候補だけをサーバへ回す。 */
  function queueImagePaths(paths: string[]): void {
    if (!attached || detectedImages >= MAX_DETECTED_IMAGES) return;
    const fresh = paths
      .filter((path) => !queriedImagePaths.has(path))
      .slice(0, MAX_TERMINAL_IMAGE_QUERY);
    if (fresh.length === 0) return;
    const queried = queriedImagePaths;
    for (const path of fresh) queried.add(path);
    void resolveImagePaths(fresh, generation, queried);
  }

  /**
   * 出力から画像のパスを拾う。追記なので、チャンクの境界だけ気にすればよい。
   *
   * 端末側の折り返しは PTY のバイト列に入らないので幅は渡さない。CLI が自分で
   * 折り返した行は、幅と無関係に findImagePathsInText が組み直す。
   */
  function scanShellOutput(chunk: string): void {
    const text = shellScanTail + stripAnsi(chunk);
    shellScanTail = text.slice(-SHELL_SCAN_TAIL);
    queueImagePaths(findImagePathsInText(text));
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
   * 3. 帯にも出す。ちゃんと渡ったことが目で分かる
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
        fetch("/_agent/paste", {
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
      addAttachment(read.url, saved.name, saved.path);
      // このパスはこの後端末へ打ち込まれ、画面に出る。拾い直すと同じ画像が
      // 帯に 2 枚並ぶので、問い合わせ済みにしておく。
      queriedImagePaths.add(saved.path);
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

  function destroyTerminal(): void {
    // 重ねた画像は端末の DOM ごと消えるので、こちらの記録も捨てる。
    inlineElements.clear();
    inlineLayer = null;
    inlineLayout = "";
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
    });
    const fit = new api.FitAddon();
    created.loadAddon(fit);
    created.open(screenEl);
    // 画像を重ねる層。xterm の画面と同じ箱に入れるので、桁と行から出した
    // 座標がそのまま使えるうえ、枠のスクロールにも同じだけ乗る。
    inlineLayer = document.createElement("div");
    inlineLayer.className = "terminal-inline-layer";
    (created.element?.querySelector(".xterm-screen") ?? screenEl).appendChild(
      inlineLayer,
    );
    created.onData(enqueueKeyboardInput);
    // Shift+Enter は「送信せずに改行」。xterm の既定では Enter と同じ CR に
    // なってしまい、書きかけのまま送信されるので、ここで横取りする。
    created.attachCustomKeyEventHandler((event) => {
      if (!isShiftEnter(event)) return true;
      // このハンドラは keydown / keypress / keyup の全部で呼ばれる。keydown
      // だけを止めても、続く keypress を xterm が拾って CR を送ってしまう
      // (それが「Shift+Enter なのに送信される」の正体)。3 つとも握り潰し、
      // 送るのは keydown の 1 回だけにする。
      if (event.type === "keydown" && inputEnabled && attached) {
        setControlArmed(false);
        enqueueInput(SHIFT_ENTER_SEQUENCE);
      }
      return false;
    });
    // 重ねている画像の置き直しは描画のたびに見る。全画面を描き直すアプリの
    // 下ではパスの居場所がフレームごとに変わりうる。
    created.onRender(() => refreshInlineImages());
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
      `/_shell/stream?id=${encodeURIComponent(session.id)}`,
    );
    source = stream;

    const stale = () => disposed || myGen !== generation;

    stream.addEventListener("output", (event) => {
      if (stale() || !term) return;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          data: string;
        };
        term.write(payload.data);
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
        return;
      }
      deps.onStatus(deps.getText().shellExited(code));
      closeSource();
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
    clearAttachments();
    closeSource();
    pendingInput = "";
    attached = session;
    // 同じ対象へ戻ってきたなら、前に見つけた画像を帯へ戻す。タブを行き来した
    // だけで消えると、パスが流れた後は二度と開けない。
    restoreRememberedImages(session);
    setControlArmed(false);
    syncShortcutControls();
    deps.onStatus(deps.getText().connecting);

    const created = await ensureTerminal(myGen);
    if (!created) {
      if (myGen === generation && !disposed) {
        deps.onStatus(deps.getText().loadFailed);
      }
      return;
    }
    if (myGen !== generation || disposed) return;

    // 前のシェルの中身を残さない。購読が始まると、溜まっていた出力が最初に
    // まとめて流れてくる。
    created.reset();
    // 表示領域がサイズを決める。購読前に PTY へ伝えておく。
    fitShellToContainer();
    openSource(session, myGen);
  }

  function clearAttachments(): void {
    attachments.replaceChildren();
    attachments.hidden = true;
    // 帯と重ねた画像を消したら、拾い直せる状態にも戻す。集合は作り直す
    // (飛んでいる問い合わせが持っているのは前の集合なので、そちらを消しても
    // 影響しない)。
    clearInlineImages();
    inlineImages = new Map<string, TerminalImageRef>();
    queriedImagePaths = new Set<string>();
    shownImagePaths = new Set<string>();
    detectedImages = 0;
    shellScanTail = "";
  }

  function detach(): void {
    generation += 1;
    clearAttachments();
    closeSource();
    attached = null;
    setControlArmed(false);
    syncShortcutControls();
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
      // 字の大きさが変われば入る桁数・行数も変わる。PTY にも伝え直す。
      scheduleShellResize();
    },
    attach,
    detach,
    refit,
    focus() {
      term?.focus();
    },
    setInputEnabled(enabled: boolean) {
      inputEnabled = enabled;
      if (!enabled) setControlArmed(false);
      syncShortcutControls();
    },
    localize() {
      syncShortcutControls();
    },
    getAttached: () => attached,
    measure() {
      const box = fitAddon?.proposeDimensions();
      if (!box || box.cols <= 0 || box.rows <= 0) return null;
      return clampShellSize(box.cols, box.rows);
    },
    dispose() {
      disposed = true;
      generation += 1;
      closeSource();
      clearInlineImages();
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      destroyTerminal();
      attached = null;
    },
  };
}
