// ドロワーが映している端末を xterm.js に描き、打鍵を送り返す部分。
//
// 映す対象は 2 種類あり、描き方が逆になる。
//
// - tmux ペイン: サーバが「今の画面」を丸ごと返す。だから毎フレーム全画面を
//   置き換える。途中から購読しても組み上がりが崩れない。サイズは tmux が
//   決めているので、こちらは字の大きさを合わせにいく。遡って見たくなったら
//   そのときだけ履歴を取りに行き、live の更新を止めて読ませる (下まで戻すと
//   追従が再開する)。毎フレーム履歴まで送ると 1 回が数 MB になるので、live と
//   履歴は別の経路にしてある。
// - シェル: PTY が吐いた分だけが順に届く。だから追記で描き、スクロール
//   バックを持つ。サイズはこちらが決めて PTY に伝える。
//
// xterm 自体は別バンドル (web/xterm.js)。ドロワーを開くまで落ちてこない。

import {
  clampShellSize,
  type ShellSession,
  type ShellSessionId,
} from "../../core/shell";
import {
  findImagePathsInText,
  findPathAnchors,
  findScreenImagePaths,
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
  TERMINAL_HISTORY_LINES,
  type TmuxPane,
  type TmuxScreen,
} from "../../core/tmux";
import {
  loadXterm,
  type XtermFitAddon,
  type XtermTerminal,
} from "../../core/xterm-loader";
import type { TerminalText } from "./i18n";
import { openImageLightbox } from "./image-lightbox";

const ESC = String.fromCharCode(27);

/**
 * 画面を消してから本文を書く。tmux 側は scrollback を持たせていないので、
 * これで前のフレームの残りが行として溜まることはない。
 */
const CLEAR_SCREEN = `${ESC}[H${ESC}[2J`;

/** シェルの scrollback 行数。tmux 側は 0 (毎フレーム全面置換のため)。 */
const SHELL_SCROLLBACK = 5000;

/** リサイズ通知の間引き。ドラッグ中に毎フレーム送らない。 */
const RESIZE_DEBOUNCE_MS = 150;

/**
 * 出力から拾って帯に出す画像の上限。ビルドログのように画像パスが何十個も
 * 流れるものがあるので、帯が埋まる前に止める。貼り付けた画像は数えない
 * (人が明示的に置いたものなので、機械が拾ったぶんで押し出さない)。
 */
const MAX_DETECTED_IMAGES = 12;

/**
 * 画像を覚えておく対象の数。タブを行き来しても帯が空にならないようにする
 * ためのもので、ペインを渡り歩く使い方でも際限なく溜めない。
 */
const MAX_REMEMBERED_TARGETS = 8;

/**
 * シェルの走査で次のチャンクへ持ち越す文字数。PTY の出力は任意の位置で
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

/**
 * 履歴を出すときの最低行数。表示領域から測った値がこれを割ることは普通
 * ないが、ドロワーを畳みかけている途中などで 0 が返ると何も読めなくなる。
 */
const MIN_HISTORY_ROWS = 5;

/**
 * 履歴に入った瞬間に上へ動かす行数。ホイールを 1 回転した合図として動かす。
 * 読み込んだだけで画面が動かないと、効かなかったように見える。
 */
const HISTORY_ENTER_SCROLL_LINES = 3;

/** ドロワーが映している対象。 */
export type TerminalTarget =
  | { kind: "tmux"; pane: TmuxPane }
  | { kind: "shell"; session: ShellSession };

export function targetId(target: TerminalTarget): string {
  return target.kind === "tmux" ? target.pane.id : target.session.id;
}

export type TerminalScreenDeps = {
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  /** 副作用リクエスト用のヘッダ (app.ts の actionHeaders)。 */
  actionHeaders(): HeadersInit;
  getText(): TerminalText;
  /** 画面下に出す状態メッセージ。null で消す。 */
  onStatus(message: string | null): void;
  /** 映していた対象が無くなった。一覧を取り直してもらう。 */
  onTargetGone(target: TerminalTarget): void;
  /** 人が選んだ文字サイズ (px)。tmux ではここを上限に縮む。 */
  getFontSize(): number;
};

export type TerminalScreenHandle = {
  el: HTMLElement;
  /** 文字サイズが変わった。作り直さずに今の端末へ当て直す。 */
  applyFontSize(): void;
  attach(target: TerminalTarget): Promise<void>;
  detach(): void;
  /** ドロワーの幅が変わったとき。 */
  refit(): void;
  focus(): void;
  setInputEnabled(enabled: boolean): void;
  localize(): void;
  dispose(): void;
};

export function createTerminalScreen(
  deps: TerminalScreenDeps,
): TerminalScreenHandle {
  const el = document.createElement("div");
  el.className = "terminal-pane-body";

  // 貼り付けた画像の帯。ターミナルの上に置く。
  //
  // xterm のマス目の中に描かないのは、tmux ペインが毎フレーム全画面を置き
  // 換えるため。中に書いた画像は次のフレームで消える。外に出しておけば
  // tmux でもシェルでも残る。
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
  /** いま作ってある xterm がどちらの描き方向けか。変わったら作り直す。 */
  let termKind: TerminalTarget["kind"] | null = null;
  let source: EventSource | null = null;
  let attached: TerminalTarget | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  /** 埋め行数の頼み直しを間引くタイマー (tmux のみ)。 */
  let refillTimer: ReturnType<typeof setTimeout> | null = null;
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
  // 出力から拾ったパスのうち、もう問い合わせたもの。tmux は毎フレーム全画面
  // を送ってくるので、覚えておかないと同じ画像を何度も問い合わせることになる。
  // attach ごとに作り直す (clear するのではなく作り直すのは、飛んでいる問い
  // 合わせが次の対象の集合を触らないようにするため)。
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
  /** シェルの走査で持ち越している末尾。 */
  let shellScanTail = "";
  /**
   * 履歴を読み込んで止めている最中か (tmux のみ)。
   *
   * 購読が返すのは「今の画面」だけなので、遡るぶんは別に取ってきて端末へ
   * 流し込む。流し込んだ後も購読を当て続けると、次のフレームで画面が全部
   * 書き換わって遡っていた位置が意味を失うので、この間だけ描画を止める。
   * tmux のコピーモードでも同じことが起きる (見ている間は止まる)。
   */
  let historyMode = false;
  /** 履歴を取りに行っている最中。ホイールを回し続けても二重に取らない。 */
  let historyLoading = false;
  /**
   * 履歴に入ってから一度でも上へ動かしたか。読み込み直後は一番下に居るので、
   * これを見ないと「下まで戻ったから live に復帰」がその場で走ってしまう。
   */
  let historyScrolledUp = false;
  /** 履歴に入る前の画面。live へ戻したときに次のフレームを待たずに描き戻す。 */
  let lastScreen: TmuxScreen | null = null;
  /**
   * いま購読に頼んでいる埋め行数 (tmux のみ)。
   *
   * ペインがドロワーの表示領域より縦に短いと、そのままでは上が空く。空いた
   * ぶんはそのペインが少し前に出していた行なので、購読に足して送ってもらう。
   * 表示領域が変わったら頼み直す (値が変わったときだけ購読を開き直す)。
   */
  let streamFill = 0;
  /**
   * live のとき、枠のスクロールを下端に貼り付けておくか。
   *
   * ペインが表示領域より縦に長いと、放っておくと上 (古い行) が見えたままに
   * なる。人が自分で上へ動かしたら剥がし、下端へ戻したらまた貼る。
   */
  let stickToBottom = true;

  // 枠のスクロールは人が動かすこともあるので、位置を見て貼り直しを決める。
  screenEl.addEventListener("scroll", () => {
    if (historyMode) return;
    stickToBottom = isAtBottom();
  });

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
    // 打った結果を見たいはずなので、遡って見ている状態なら live に戻す。
    // 止めたまま送ると、送ったのに画面が動かないように見える。
    if (historyMode) exitHistory();
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
   * tmux 用: 人が選んだ大きさをそのまま使う。
   *
   * 以前はドロワーに収まるまで自動で縮めていたが、それだと 300 桁のような広い
   * ペインでは常に下限まで潰れ、文字サイズを変えても見た目が動かなかった。
   * 収まらないぶんは横スクロールに逃がす (.terminal-screen が overflow: auto)。
   * 選んだ値がそのまま出るほうが、操作した結果が分かる。
   */
  function fitFontToPane(): void {
    if (!term) return;
    term.options.fontSize = deps.getFontSize();
  }

  /** シェル用: 表示領域に合わせて桁数・行数を決め、PTY にも伝える。 */
  function fitShellToContainer(): void {
    if (!term || !fitAddon || !attached || attached.kind !== "shell") return;
    fitAddon.fit();
    const size = clampShellSize(term.cols, term.rows);
    if (
      size.cols === attached.session.cols &&
      size.rows === attached.session.rows
    ) {
      return;
    }
    // 通ってから記録する。先に書き換えると、失敗しても「同じサイズ」と見えて
    // 送り直されず、PTY 側だけ古い桁数のまま残る。
    void sendShellResize(attached.session.id, size.cols, size.rows);
  }

  /**
   * 上を埋めるのに要る行数。表示領域に入る行数から、ペインの行数を引いたぶん。
   *
   * ペインのほうが縦に長ければ 0 (埋める必要がなく、はみ出しはスクロールに
   * 逃げる)。
   */
  function neededFill(): number {
    if (attached?.kind !== "tmux") return 0;
    const boxRows = fitAddon?.proposeDimensions()?.rows ?? 0;
    const paneRows = lastScreen?.height || attached.pane.height;
    if (boxRows <= 0 || paneRows <= 0) return 0;
    return Math.max(0, boxRows - paneRows);
  }

  /**
   * 埋め行数が変わっていたら購読を開き直す。
   *
   * 頼む行数は URL に載せているので、変えるには繋ぎ直すしかない。ドラッグ中に
   * 毎フレーム繋ぎ直さないよう、呼び出し側で間引く。
   */
  function refillStream(): void {
    if (attached?.kind !== "tmux" || disposed || historyMode) return;
    const fill = neededFill();
    if (fill === streamFill) return;
    const target = attached;
    closeSource();
    openSource(target, generation);
  }

  function refit(): void {
    if (!attached) return;
    if (attached.kind === "tmux") {
      fitFontToPane();
      scheduleRefill();
    } else scheduleShellResize();
  }

  /** 埋め行数の頼み直しを間引く。ドラッグ中は最後の 1 回だけ効けばよい。 */
  function scheduleRefill(): void {
    if (refillTimer) clearTimeout(refillTimer);
    refillTimer = setTimeout(() => {
      refillTimer = null;
      refillStream();
    }, RESIZE_DEBOUNCE_MS);
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
      if (!res.ok) return;
      // 通った分だけ記録する。切り替え済みなら書き戻さない。
      if (attached?.kind === "shell" && attached.session.id === id) {
        attached.session.cols = cols;
        attached.session.rows = rows;
      }
    } catch {
      // 中断・通信断。記録しないので、次のリサイズで送り直される。
    }
  }

  function applyTmuxScreen(screen: TmuxScreen): void {
    // 切り替え前のペインのフレームが遅れて届くことがある。id が一致しない
    // ものは捨てる (購読における世代照合)。
    if (!term || attached?.kind !== "tmux") return;
    if (screen.pane !== attached.pane.id) return;
    // 描かないときも控えておく。live へ戻したときに、次のフレームを待たずに
    // ここから描き直す。
    lastScreen = screen;
    // 履歴を見ている間は当てない。画面を書き換えると、遡っていた位置が
    // 何を指していたのか分からなくなる。
    if (historyMode) return;
    // 画面の手前に履歴が付いているぶん、端末はそのぶん高くする。付いていない
    // (historyLines が 0) ならペインの実寸そのまま。
    const rows = screen.height + screen.historyLines;
    if (
      screen.width > 0 &&
      rows > 0 &&
      (term.cols !== screen.width || term.rows !== rows)
    ) {
      term.resize(screen.width, rows);
      fitFontToPane();
    }
    // 末尾の改行をそのまま書くと 1 行ぶんスクロールして最上行が消える。
    const body = screen.content.replace(/\n$/, "");
    // カーソルは画面の中の位置なので、前置きの履歴のぶん下へずらす。
    const cursorRow = screen.historyLines + screen.cursorY + 1;
    const cursor = `${ESC}[${cursorRow};${screen.cursorX + 1}H`;
    term.write(`${CLEAR_SCREEN}${body}${cursor}`);
    stickBottom();
    scanTmuxScreen(screen);
  }

  /**
   * ペインが表示領域より縦に長いとき、下端に寄せておく。
   *
   * 端末は新しい出力が下に出るので、上を向いたまま置くと古い行しか見えない
   * (プロンプトも入力欄も下端にある)。人が自分で上へ動かしている間は触らない。
   *
   * 字を縮めて全部入れる手もあるが、それは以前入れて外してある。99 行を
   * 表示領域に収めると 1 行 4px 弱になって読めない。
   */
  function stickBottom(): void {
    if (!stickToBottom) return;
    screenEl.scrollTop = screenEl.scrollHeight;
  }

  /** 下端に居るか。1px のずれは丸める (端数で毎回外れる)。 */
  function isAtBottom(): boolean {
    const slack = screenEl.scrollHeight - screenEl.clientHeight;
    return slack <= 0 || screenEl.scrollTop >= slack - 1;
  }

  /**
   * 遡って見る状態に入る。
   *
   * 購読が返すのは「今の画面」だけなので、遡るぶんはここで取りに行き、端末の
   * スクロールバックへ流し込む。取ってきたものは 1 回きりの写しなので、以後
   * live のフレームは当てない (当てると、遡っている間に画面だけが進んで、
   * 上に積んだ履歴と繋がらなくなる)。tmux のコピーモードと同じ止まり方。
   */
  async function enterHistory(): Promise<void> {
    if (historyMode || historyLoading || !term) return;
    if (attached?.kind !== "tmux") return;
    const pane = attached.pane.id;
    const myGen = generation;
    historyLoading = true;
    deps.onStatus(deps.getText().historyLoading);
    try {
      const res = await deps.trackLoad(
        fetch(
          `/_tmux/history?pane=${encodeURIComponent(pane)}&lines=${TERMINAL_HISTORY_LINES}`,
        ),
      );
      // 待つ間に別の対象へ切り替えられていたら、そちらへ履歴を流し込まない。
      if (disposed || myGen !== generation) return;
      if (!res.ok) {
        deps.onStatus(deps.getText().historyFailed);
        return;
      }
      const screen = (await res.json()) as TmuxScreen;
      if (disposed || myGen !== generation) return;
      if (attached?.kind !== "tmux" || screen.pane !== attached.pane.id) return;
      showHistory(screen);
    } catch {
      // 中断 (ナビゲーション) と通信断。
      if (!disposed) deps.onStatus(deps.getText().historyFailed);
    } finally {
      historyLoading = false;
    }
  }

  function showHistory(screen: TmuxScreen): void {
    if (!term) return;
    historyMode = true;
    historyScrolledUp = false;
    // 重ねている画像は画面の行に紐づいている。中身を総入れ替えするので外す。
    clearInlineImages();
    // 行数は表示領域に合わせる。ペインの実寸のままだとドロワーからはみ出し、
    // 「外側の枠のスクロール」と「端末のスクロール」が二重になって、どちらが
    // 動いているのか分からなくなる。桁数はペインのままにする (折り返すと
    // 履歴の見た目が元の画面と変わる)。
    const rows = fitAddon?.proposeDimensions()?.rows ?? term.rows;
    term.options.scrollback = TERMINAL_HISTORY_LINES;
    term.resize(
      screen.width > 0 ? screen.width : term.cols,
      Math.max(MIN_HISTORY_ROWS, rows),
    );
    term.reset();
    // 末尾の改行を残すと、そのぶん最下行が空で流れる。
    //
    // 書き込みは非同期 (xterm が分割して解釈する) なので、位置を動かすのは
    // 解釈が終わってから。直後に動かしても、まだ 1 行も積まれていない。
    term.write(screen.content.replace(/\n+$/, ""), () => {
      // 待つ間に live へ戻された / 別の対象へ切り替えられた。
      if (!historyMode || !term) return;
      // 回した 1 回ぶんは xterm に渡していないので、ここで動かしておく。
      // 読み込みだけ済んで画面が動かないと、効かなかったように見える。
      term.scrollLines(-HISTORY_ENTER_SCROLL_LINES);
    });
    deps.onStatus(deps.getText().historyPaused);
  }

  /** live に戻す。止めていた間に届いた最後の画面をその場で描き直す。 */
  function exitHistory(): void {
    if (!historyMode || !term) return;
    resetHistoryState(term);
    deps.onStatus(null);
    // 購読は前回と同じ内容のフレームを送り直さないので、待っていても戻らない。
    // 止めている間も控えてある最後の画面から描き直す。
    if (lastScreen) applyTmuxScreen(lastScreen);
  }

  /** 履歴の状態だけを畳む。描き直しは呼び出し側の都合に任せる。 */
  function resetHistoryState(target: XtermTerminal | null): void {
    historyMode = false;
    historyLoading = false;
    historyScrolledUp = false;
    // 0 に戻すと積んであった履歴も落ちる。live では毎フレーム全画面を
    // 置き換えるので、持たせたままにする理由がない。
    if (target) target.options.scrollback = 0;
  }

  function keyEndpoint(): { url: string; body: (data: string) => string } {
    if (attached?.kind === "shell") {
      const id = attached.session.id;
      return {
        url: "/_shell/keys",
        body: (data) => JSON.stringify({ id, data }),
      };
    }
    const pane = attached?.kind === "tmux" ? attached.pane.id : "";
    return {
      url: "/_tmux/keys",
      body: (data) => JSON.stringify({ pane, data }),
    };
  }

  async function flushInput(): Promise<void> {
    if (sending || !pendingInput || !attached || disposed) return;
    sending = true;
    const target = attached;
    const endpoint = keyEndpoint();
    const data = pendingInput;
    pendingInput = "";
    try {
      const res = await deps.trackLoad(
        fetch(endpoint.url, {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
          },
          body: endpoint.body(data),
        }),
      );
      if (disposed) return;
      if (res.status === 410) {
        deps.onTargetGone(target);
        return;
      }
      if (!res.ok) deps.onStatus(deps.getText().sendFailed);
    } catch {
      // 中断 (ナビゲーション) と通信断。打った内容は失われるので伝える。
      if (!disposed) deps.onStatus(deps.getText().sendFailed);
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
      const id = targetId(attached);
      const list = rememberedImages.get(id);
      if (list) {
        rememberedImages.set(
          id,
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
      // なので、覚えたままにして聞き直さない (毎フレーム再送すると、落ちて
      // いる相手に 8 回/秒で投げ続けることになる)。
      if (!res.ok) return;
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
    } catch {
      // 中断 (ナビゲーション) と通信断。覚えたままにすると二度と拾えないので
      // 忘れる。tmux は同じ画面を送り続けるので、次のフレームで拾い直せる。
      for (const path of paths) queried.delete(path);
    }
  }

  /** 見つけた画像を対象ごとに覚える。同じ 1 枚は 1 回だけ。 */
  function rememberImage(image: TerminalImageRef): void {
    if (!attached) return;
    const id = targetId(attached);
    const list = rememberedImages.get(id) ?? [];
    if (list.some((entry) => entry.path === image.path)) return;
    list.push(image);
    rememberedImages.set(id, list);
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
  function restoreRememberedImages(target: TerminalTarget): void {
    for (const image of rememberedImages.get(targetId(target)) ?? []) {
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
   * xterm のマス目に書き込んでも、tmux は次のフレームで全画面を置き換えるので
   * 消える。そこで画面の上に自前の層を 1 枚重ね、そこへ絶対位置で置く。
   *
   * xterm の decoration (行に紐づく DOM) は使わない。tmux ペインは毎フレーム
   * 画面を書き直すため、行に打った目印がそのつど捨てられ、画像が 2 回/秒で
   * 作り直されて点滅した。自前の層なら、位置が変わらない限り何も触らない。
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
      .map((anchor) => `${anchor.candidate}@${anchor.row},${anchor.col}`)
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
    element.style.top = `${(anchor.row + 1) * cell.height}px`;
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
   * tmux の 1 フレームから画像パスを拾う。
   *
   * 毎フレーム全画面が届くので、同じパスが何十回も出てくる。実際に問い合わせ
   * るのは初めて見たものだけ (queueImagePaths)。
   */
  function scanTmuxScreen(screen: TmuxScreen): void {
    queueImagePaths(findScreenImagePaths(screen.content, screen.width));
  }

  /**
   * シェルの出力から拾う。追記なので、チャンクの境界だけ気にすればよい。
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
   * 2. そのパスをペインへ打ち込む。CLI のエージェントはパスを読める
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
    } catch {
      deps.onStatus(deps.getText().pasteFailed);
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
        deps.onStatus(deps.getText().pasteFailed);
        return;
      }
      const saved = (await res.json()) as PasteImageResponse;
      if (disposed || !attached) return;
      addAttachment(read.url, saved.name, saved.path);
      // このパスはこの後ペインへ打ち込まれ、画面に出る。拾い直すと同じ画像が
      // 帯に 2 枚並ぶので、問い合わせ済みにしておく。
      queriedImagePaths.add(saved.path);
      // パスに空白は入らない命名にしてあるが、引用しておけば将来変えても壊れない。
      pendingInput += `'${saved.path}' `;
      void flushInput();
      deps.onStatus(null);
    } catch {
      if (!disposed) deps.onStatus(deps.getText().pasteFailed);
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
    termKind = null;
  }

  async function ensureTerminal(
    kind: TerminalTarget["kind"],
    myGen: number,
  ): Promise<XtermTerminal | null> {
    // 描き方が変わると scrollback の要否も変わる。作り直すのが確実。
    if (term && termKind === kind) return term;
    if (term) destroyTerminal();
    const api = await loadXterm();
    // 読み込みを待つ間に切り替え / 破棄された。
    if (!api || disposed || myGen !== generation) return null;
    if (term && termKind === kind) return term;
    const created = new api.Terminal({
      fontSize: deps.getFontSize(),
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      // tmux は毎フレーム全画面を書き直すので、履歴を持たせると際限なく
      // 積み上がる。シェルは追記なので普通に持たせる。
      scrollback: kind === "shell" ? SHELL_SCROLLBACK : 0,
      cursorBlink: kind === "shell",
      convertEol: kind === "tmux",
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
    // tmux ペインのホイールは自分で捌く。
    //
    // xterm は「scrollback を持たない端末」でホイールを受けると、それを ↑/↓
    // キーに変換してアプリへ送る (vim や tmux のような全画面アプリを実端末で
    // スクロールさせるための仕様)。ここで映しているのは実端末ではなくペインの
    // 複製で、live の間は scrollback を持たせていないので必ずこの経路に入る。
    // 結果、ホイールを回すと AI CLI の入力欄に履歴 (過去の発言) が呼び出され、
    // そのうえ preventDefault されるので画面はスクロールしない。
    //
    // false を返せば xterm は何もしない。イベントはそのまま外側へ流れ、ペインが
    // 表示領域より縦に長いときは .terminal-screen (overflow: auto) が普通に
    // スクロールする。上端で更に上へ回したときだけ、遡って見る状態に入る。
    //
    // シェルは実端末なので既定のまま。scrollback があるうちは xterm 自身が
    // スクロールし、alt buffer のアプリ (vim, less) では ↑/↓ 変換が正しく効く。
    if (kind === "tmux") {
      created.attachCustomWheelEventHandler((event) => {
        // 履歴を積んである間は xterm がスクロールを持っている。
        if (historyMode) return true;
        if (event.deltaY < 0 && screenEl.scrollTop <= 0) void enterHistory();
        return false;
      });
      // 一番下まで戻したら live に復帰する。tmux のコピーモードを抜けるのと
      // 同じ操作感。読み込んだ直後は下端に居るので、一度上へ動いたことを
      // 見てから判定する。
      created.onScroll(() => {
        if (!historyMode || !term) return;
        const buffer = term.buffer.active;
        if (buffer.viewportY < buffer.baseY) {
          historyScrolledUp = true;
          return;
        }
        if (historyScrolledUp) exitHistory();
      });
    }
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
    // 重ねている画像の置き直しは描画のたびに見る。tmux は毎フレーム全画面を
    // 書き直すので、パスの居場所もフレームごとに変わりうる。
    created.onRender(() => refreshInlineImages());
    term = created;
    fitAddon = fit;
    termKind = kind;
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => refit());
      resizeObserver.observe(screenEl);
    }
    return created;
  }

  function openSource(target: TerminalTarget, myGen: number): void {
    if (target.kind === "tmux") streamFill = neededFill();
    const url =
      target.kind === "tmux"
        ? `/_tmux/stream?pane=${encodeURIComponent(target.pane.id)}&fill=${streamFill}`
        : `/_shell/stream?id=${encodeURIComponent(target.session.id)}`;
    const stream = new EventSource(url);
    source = stream;

    const stale = () => disposed || myGen !== generation;

    stream.addEventListener("screen", (event) => {
      if (stale()) return;
      try {
        applyTmuxScreen(JSON.parse((event as MessageEvent<string>).data));
        deps.onStatus(null);
      } catch {
        deps.onStatus(deps.getText().screenFailed);
      }
    });
    stream.addEventListener("output", (event) => {
      if (stale() || !term) return;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          data: string;
        };
        term.write(payload.data);
        scanShellOutput(payload.data);
        deps.onStatus(null);
      } catch {
        deps.onStatus(deps.getText().screenFailed);
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
      } catch {
        // 終了コードが読めなくても、終わったことは伝える。
      }
      deps.onStatus(deps.getText().shellExited(code));
      closeSource();
    });
    stream.addEventListener("gone", () => {
      if (stale()) return;
      deps.onStatus(
        target.kind === "tmux"
          ? deps.getText().paneClosed
          : deps.getText().shellClosed,
      );
      closeSource();
      deps.onTargetGone(target);
    });
    stream.addEventListener("failed", () => {
      if (stale()) return;
      deps.onStatus(deps.getText().screenFailed);
    });
    stream.onerror = () => {
      // EventSource は自動で繋ぎ直す。落ちたままなら状態表示だけ残す。
      if (stale()) return;
      if (stream.readyState === EventSource.CLOSED) {
        deps.onStatus(deps.getText().screenFailed);
      }
    };
  }

  async function attach(target: TerminalTarget): Promise<void> {
    if (disposed) return;
    const myGen = ++generation;
    clearAttachments();
    closeSource();
    pendingInput = "";
    attached = target;
    // 同じ対象へ戻ってきたなら、前に見つけた画像を帯へ戻す。タブを行き来した
    // だけで消えると、パスが流れた後は二度と開けない。
    restoreRememberedImages(target);
    setControlArmed(false);
    syncShortcutControls();
    deps.onStatus(deps.getText().connecting);

    const created = await ensureTerminal(target.kind, myGen);
    if (!created) {
      if (myGen === generation && !disposed) {
        deps.onStatus(deps.getText().loadFailed);
      }
      return;
    }
    if (myGen !== generation || disposed) return;

    if (target.kind === "tmux") {
      // 前の対象を履歴で止めたまま切り替えられていることがある。live で
      // 描き始める前に畳む (端末は使い回されるので、scrollback も戻す)。
      resetHistoryState(created);
      // 埋め行数はこのペインの行数から決まるので、前のペインのぶんを残さない。
      lastScreen = null;
      streamFill = 0;
      // 先に実サイズへ合わせておく。最初のフレームが来る前に前のペインの
      // 大きさで一瞬描かれるのを防ぐ。
      if (target.pane.width > 0 && target.pane.height > 0) {
        created.resize(target.pane.width, target.pane.height);
        fitFontToPane();
      }
      created.write(CLEAR_SCREEN);
      stickToBottom = true;
    } else {
      // シェルは表示領域がサイズを決める。購読前に PTY へ伝えておく。
      created.reset();
      fitShellToContainer();
    }
    openSource(target, myGen);
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
    resetHistoryState(term);
    lastScreen = null;
    attached = null;
    setControlArmed(false);
    syncShortcutControls();
    pendingInput = "";
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = null;
    if (refillTimer) clearTimeout(refillTimer);
    refillTimer = null;
    streamFill = 0;
    deps.onStatus(null);
  }

  return {
    el,
    applyFontSize() {
      if (!term) return;
      // まず選ばれた値に戻す。tmux はこの後 fitFontToPane が実サイズに
      // 合わせて縮める (縮んだ状態から始めると二度と大きくならない)。
      term.options.fontSize = deps.getFontSize();
      if (attached?.kind === "tmux") fitFontToPane();
      else scheduleShellResize();
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
    dispose() {
      disposed = true;
      generation += 1;
      closeSource();
      clearInlineImages();
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = null;
      if (refillTimer) clearTimeout(refillTimer);
      refillTimer = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      destroyTerminal();
      attached = null;
    },
  };
}
