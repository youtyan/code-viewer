// 選択中の tmux ペインを xterm.js に描き、打鍵を tmux へ送り返す部分。
//
// 描画は「差分を流し込む」のではなく「毎フレーム画面全体を置き換える」形に
// している。サーバが返すのは tmux が解釈し終えた確定済みの画面なので、途中
// から購読を始めても組み上がりが崩れない。そのぶんスクロールバックは持てない
// が、tmux 側の履歴は tmux のコピーモードで見るものなので割り切る。
//
// xterm 自体は別バンドル (web/xterm.js)。ドロワーを開くまで落ちてこない。

import type { TmuxPane, TmuxScreen } from "../../core/tmux";
import {
  loadXterm,
  type XtermFitAddon,
  type XtermTerminal,
} from "../../core/xterm-loader";
import type { TerminalText } from "./i18n";

const ESC = String.fromCharCode(27);

/**
 * 画面を消してから本文を書く。scrollback を持たせていないので、これで前の
 * フレームの残りが行として溜まることはない。
 */
const CLEAR_SCREEN = `${ESC}[H${ESC}[2J`;

/**
 * 実サイズを保ったまま、ドロワーの幅に収まるまで字を小さくする範囲。
 * 下限を割ってまで縮めない。319 桁のような広いペインを無理に収めると
 * 字が潰れて読めなくなるので、そこから先は横スクロールに逃がす
 * (.terminal-screen が overflow: auto)。
 */
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 18;
const DEFAULT_FONT_SIZE = 13;

/** proposeDimensions を使った font size の追い込み回数。数回で収束する。 */
const FIT_ITERATIONS = 6;

export type TerminalScreenDeps = {
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  /** 副作用リクエスト用のヘッダ (app.ts の actionHeaders)。 */
  actionHeaders(): HeadersInit;
  getText(): TerminalText;
  /** 画面下に出す状態メッセージ。null で消す。 */
  onStatus(message: string | null): void;
  /** ペインが閉じられていた。一覧を取り直してもらう。 */
  onPaneGone(pane: TmuxPane): void;
};

export type TerminalScreenHandle = {
  el: HTMLElement;
  attach(pane: TmuxPane): Promise<void>;
  detach(): void;
  /** ドロワーの幅が変わったとき。 */
  refit(): void;
  focus(): void;
  setInputEnabled(enabled: boolean): void;
  dispose(): void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createTerminalScreen(
  deps: TerminalScreenDeps,
): TerminalScreenHandle {
  const el = document.createElement("div");
  el.className = "terminal-screen";

  let term: XtermTerminal | null = null;
  let fitAddon: XtermFitAddon | null = null;
  let source: EventSource | null = null;
  let attachedPane: TmuxPane | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let inputEnabled = true;
  let disposed = false;
  // attach の世代。読み込みを待つ間に別のペインへ切り替えられたら、
  // 後から返ってきた初期化で画面を作り直さない。
  let generation = 0;
  // 送信待ちの打鍵。POST の往復中に打たれた分をここに溜め、1 本ずつ順に
  // 送る。並走させると tmux に届く順が入れ替わる。
  let pendingInput = "";
  let sending = false;

  function refit(): void {
    if (!term || !fitAddon || !term.element) return;
    const targetCols = term.cols;
    const targetRows = term.rows;
    if (!targetCols || !targetRows) return;
    for (let i = 0; i < FIT_ITERATIONS; i += 1) {
      const dims = fitAddon.proposeDimensions();
      if (!dims?.cols || !dims.rows) return;
      const ratio = Math.min(dims.cols / targetCols, dims.rows / targetRows);
      const current = term.options.fontSize ?? DEFAULT_FONT_SIZE;
      const next = clamp(
        Math.floor(current * ratio),
        MIN_FONT_SIZE,
        MAX_FONT_SIZE,
      );
      if (next === current) return;
      term.options.fontSize = next;
    }
  }

  function applyScreen(screen: TmuxScreen): void {
    // 切り替え前のペインのフレームが遅れて届くことがある。pane id が
    // 一致しないものは捨てる (購読における世代照合)。
    if (!term || !attachedPane || screen.pane !== attachedPane.id) return;
    if (
      screen.width > 0 &&
      screen.height > 0 &&
      (term.cols !== screen.width || term.rows !== screen.height)
    ) {
      term.resize(screen.width, screen.height);
      refit();
    }
    // 末尾の改行をそのまま書くと 1 行ぶんスクロールして最上行が消える。
    const body = screen.content.replace(/\n$/, "");
    const cursor = `${ESC}[${screen.cursorY + 1};${screen.cursorX + 1}H`;
    term.write(`${CLEAR_SCREEN}${body}${cursor}`);
  }

  async function flushInput(): Promise<void> {
    if (sending || !pendingInput || !attachedPane || disposed) return;
    sending = true;
    const pane = attachedPane.id;
    const data = pendingInput;
    pendingInput = "";
    try {
      const res = await deps.trackLoad(
        fetch("/_tmux/keys", {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ pane, data }),
        }),
      );
      if (disposed) return;
      if (res.status === 410) {
        if (attachedPane) deps.onPaneGone(attachedPane);
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

  function closeSource(): void {
    source?.close();
    source = null;
  }

  async function ensureTerminal(myGen: number): Promise<XtermTerminal | null> {
    if (term) return term;
    const api = await loadXterm();
    // 読み込みを待つ間に切り替え / 破棄された。
    if (!api || disposed || myGen !== generation) return null;
    if (term) return term;
    const created = new api.Terminal({
      fontSize: DEFAULT_FONT_SIZE,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      // 毎フレーム全画面を書き直すので、履歴を持たせると際限なく積み上がる。
      scrollback: 0,
      cursorBlink: false,
      convertEol: true,
    });
    const fit = new api.FitAddon();
    created.loadAddon(fit);
    created.open(el);
    created.onData((data) => {
      if (!inputEnabled || !attachedPane) return;
      pendingInput += data;
      void flushInput();
    });
    term = created;
    fitAddon = fit;
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => refit());
      resizeObserver.observe(el);
    }
    return created;
  }

  function openSource(pane: TmuxPane, myGen: number): void {
    const stream = new EventSource(
      `/_tmux/stream?pane=${encodeURIComponent(pane.id)}`,
    );
    source = stream;
    stream.addEventListener("screen", (event) => {
      if (disposed || myGen !== generation) return;
      try {
        applyScreen(JSON.parse((event as MessageEvent<string>).data));
        deps.onStatus(null);
      } catch {
        deps.onStatus(deps.getText().screenFailed);
      }
    });
    stream.addEventListener("gone", () => {
      if (disposed || myGen !== generation) return;
      deps.onStatus(deps.getText().paneClosed);
      closeSource();
      deps.onPaneGone(pane);
    });
    stream.addEventListener("failed", () => {
      if (disposed || myGen !== generation) return;
      deps.onStatus(deps.getText().screenFailed);
    });
    stream.onerror = () => {
      // EventSource は自動で繋ぎ直す。落ちたままなら状態表示だけ残す。
      if (disposed || myGen !== generation) return;
      if (stream.readyState === EventSource.CLOSED) {
        deps.onStatus(deps.getText().screenFailed);
      }
    };
  }

  async function attach(pane: TmuxPane): Promise<void> {
    if (disposed) return;
    const myGen = ++generation;
    closeSource();
    pendingInput = "";
    attachedPane = pane;
    deps.onStatus(deps.getText().connecting);

    const created = await ensureTerminal(myGen);
    if (!created) {
      if (myGen === generation && !disposed) {
        deps.onStatus(deps.getText().loadFailed);
      }
      return;
    }
    if (myGen !== generation || disposed) return;

    // 先に実サイズへ合わせておく。最初のフレームが来る前に前のペインの
    // 大きさで一瞬描かれるのを防ぐ。
    if (pane.width > 0 && pane.height > 0) {
      created.resize(pane.width, pane.height);
      refit();
    }
    created.write(CLEAR_SCREEN);
    openSource(pane, myGen);
  }

  function detach(): void {
    generation += 1;
    closeSource();
    attachedPane = null;
    pendingInput = "";
    deps.onStatus(null);
  }

  return {
    el,
    attach,
    detach,
    refit,
    focus() {
      term?.focus();
    },
    setInputEnabled(enabled: boolean) {
      inputEnabled = enabled;
    },
    dispose() {
      disposed = true;
      generation += 1;
      closeSource();
      resizeObserver?.disconnect();
      resizeObserver = null;
      term?.dispose();
      term = null;
      fitAddon = null;
      attachedPane = null;
    },
  };
}
