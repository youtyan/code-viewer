// SP の 1 ペイン表示。エージェントのペインを 1 つだけ、スマホの幅で読めるように映し、
// 返事・キー・選択肢を送る。全画面で重ねて出し、戻るで閉じる。
//
// デスクトップのターミナルと違い、tmux に attach しない。サーバが tmux の control mode
// で 1 つのペインの画面と出力を流し (server/tmux/pane-stream.ts)、ここでは見えない
// 端末 (xterm を開かずに使う) にそのまま書き込む。ペインの幅は PC の分割のまま
// (100 桁以上) なので、升目のままでは狭すぎる。既定の「読む」は、端末の中身を
// スマホの幅で折り返した文に起こして出す (core/pane-reflow.ts)。全画面のアプリ
// (vim など) は升目のままの「画面」で見る。
//
// - 上へスクロールして読んでいる間は描き直さない (読んでいる文が動かない)。
//   続きが来たら「最新へ」を出す
// - 送るのは 1 本ずつ順に (打った順が入れ替わらない)。失敗は理由を出す
// - 流しが切れたら EventSource が繋ぎ直し、サーバが今の画面を送り直す

import type { AgentState } from "../../core/agent-state";
import { apiUrl } from "../../core/api-url";
import {
  formatErrorDetail,
  responseErrorMessage,
} from "../../core/error-detail";
import { escapeHtml } from "../../core/html-escape";
import { IMAGE_16_PATH, iconSvg } from "../../core/icons";
import {
  pinchFontSize,
  softKeySequence,
  TERMINAL_SOFT_KEYS,
} from "../../core/mobile-layout";
import { UNINTERRUPTIBLE_REQUEST_HEADER } from "../../core/network-activity";
import {
  collapseBlankLines,
  DEFAULT_COLOR,
  findChoices,
  lineText,
  logicalLineStart,
  paragraphStart,
  type ReflowColors,
  type ReflowLine,
  readLogicalLines,
  readParagraphs,
  runCss,
  terminalPalette,
  withoutTransient,
} from "../../core/pane-reflow";
import { matchTextLinks } from "../../core/terminal-links";
import {
  PASTE_IMAGE_TYPES,
  pasteImageExtension,
} from "../../core/terminal-paste";
import {
  paneSnapshotSequence,
  type TmuxPaneId,
  type TmuxPaneSnapshot,
} from "../../core/tmux";
import {
  loadXterm,
  type XtermApi,
  type XtermBuffer,
  type XtermDisposable,
  type XtermMarker,
  type XtermTerminal,
} from "../../core/xterm-loader";
import { SOFT_KEY_CAPS } from "../mobile-shell-i18n";
import type { TerminalText } from "./i18n";
import { uploadPastedImage } from "./paste-upload";
import {
  TERMINAL_MINIMUM_CONTRAST_RATIO,
  terminalTheme,
} from "./terminal-screen";

/** 見えない端末が覚えておく過去の行数。 */
const PANE_VIEW_SCROLLBACK = 5000;
/** 「読む」で最初に描く行数 (端末の行で数える)。前の出力は押すたびにこれだけ足す。 */
const READ_LINES_STEP = 600;
/** 続けて出力が来ている間に描き直す間隔の下限。 */
const RENDER_INTERVAL_MS = 100;
/**
 * 一番下にいるとみなす、下端からの距離。広くすると、指で少しだけ上へ送って
 * 離したときにも一番下とみなして引き戻した (32px で起きた)。
 */
const AT_BOTTOM_PX = 4;
/** 上端からこの距離まで読み進めて止まったら、押さなくても前の出力を足す。 */
const AT_TOP_PX = 200;
/**
 * スクロールが止まったとみなす間。動いている間に前を足すと、iOS の慣性の
 * スクロールが止まって跳ぶ。
 */
const SCROLL_SETTLE_MS = 150;
/** 選択肢を探す、末尾からの行数 (端末の行で数える)。 */
const CHOICE_TAIL_ROWS = 40;
/** 「画面」の文字の大きさの範囲。幅に合わせて決め、読めないほど小さくしない。 */
const GRID_FONT_MIN = 7;
const GRID_FONT_MAX = 14;
/** ピンチで大きくできる上限 (横にスクロールして読む)。 */
const GRID_FONT_PINCH_MAX = 24;
/** 等幅の字の幅と文字の大きさの比 (おおよそ)。 */
const MONO_WIDTH_RATIO = 0.6;

export type PaneViewMode = "read" | "screen";
/** 出し方: 読む (幅で折り返す)・升目の文 (PC の桁で折り返す)・端末 (xterm)。 */
type PaneView = "read" | "grid" | "terminal";

export type PaneDescription = {
  title: string;
  detail: string;
  state: AgentState;
};

export type PaneViewDeps = {
  getText(): TerminalText;
  /** 見出しに出す名前と状態。エージェントの一覧に無ければ null。 */
  describePane(pane: TmuxPaneId): PaneDescription | null;
  actionHeaders(): HeadersInit;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  /** 閉じた (戻る・ペインが無くなった後に戻る)。 */
  onClose(pane: TmuxPaneId): void;
};

export type PaneViewHandle = {
  el: HTMLElement;
  /**
   * returnTo は戻る (戻るのボタン・ブラウザの戻る) で閉じた後に呼ぶ: 開いた
   * 場所 (引き出し・＋のメニュー) を出し直す。別のペインへ開き直したときは呼ばない。
   */
  open(pane: TmuxPaneId, returnTo?: () => void): void;
  close(): void;
  /**
   * 閉じてから next を呼ぶ (積んだ履歴を戻るで降ろした後)。タブ列のタブを押した
   * ときに使う: 降ろす前にタブを移ると、その移動が積んだ履歴を戻るが取り消す。
   * 開いていなければすぐ呼ぶ。
   */
  closeThen(next: () => void): void;
  currentPane(): TmuxPaneId | null;
  /** エージェントの一覧が変わった。見出しの名前と状態を描き直す。 */
  refreshHeader(): void;
  /**
   * ブラウザの戻る (popstate)。開いていれば閉じて true (アプリは URL の画面を
   * 当て直さない)。開いたときに履歴を 1 つ積むので、戻るでこの画面だけが閉じる。
   */
  handlePopState(): boolean;
  localize(): void;
  dispose(): void;
};

function plain(run: ReflowLine["runs"][number]): boolean {
  return (
    run.style.fg === DEFAULT_COLOR &&
    run.style.bg === DEFAULT_COLOR &&
    run.style.flags === 0
  );
}

type LineUrl = { index: number; length: number; path: string };

/**
 * 区切り (色の塊) 1 つの文字。行の中の URL に当たる所はリンクにする (offset は
 * この塊の行の中の位置)。ログインのペインの承認の URL をスマホのブラウザで開くのに
 * 要った (文字のままでは押せず、長くて選べなかった)。
 */
function runHtml(text: string, offset: number, urls: LineUrl[]): string {
  let html = "";
  let at = 0;
  for (const url of urls) {
    const start = Math.max(url.index - offset, at);
    const end = Math.min(url.index + url.length - offset, text.length);
    if (end <= start) continue;
    const href = escapeHtml(url.path).replace(/"/g, "&quot;");
    html += `${escapeHtml(text.slice(at, start))}<a class="pane-link" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(text.slice(start, end))}</a>`;
    at = end;
  }
  return html + escapeHtml(text.slice(at));
}

function lineHtml(line: ReflowLine, colors: ReflowColors): string {
  const urls = matchTextLinks(lineText(line)).filter(
    (link) => link.kind === "url",
  );
  let offset = 0;
  const body = line.runs
    .map((run) => {
      const html = runHtml(run.text, offset, urls);
      offset += run.text.length;
      return plain(run)
        ? html
        : `<span style="${runCss(run.style, colors)}">${html}</span>`;
    })
    .join("");
  // 折り返した 2 行目以降を文の始まり (箇条書きなら頭の後ろ) に揃える。
  const hang = line.hang ? ` style="--pane-hang: ${line.hang}ch"` : "";
  return `<div class="pane-line${line.rule ? " pane-line-rule" : ""}"${hang}>${body}</div>`;
}

export function createPaneView(deps: PaneViewDeps): PaneViewHandle {
  const text = () => deps.getText().paneView;

  const el = document.createElement("section");
  el.className = "pane-view";
  // 中の色は端末と同じ (ターミナルの明暗の設定に従う)。
  el.dataset.terminalSurface = "";
  el.hidden = true;

  // 戻るのボタンは置かない: 表示はタブ列と下端の帯の間にあり、ほかの画面へは
  // タブと帯で移る (押すと表示を閉じてから移る。app.ts)。ブラウザの戻るでも閉じる。
  const head = document.createElement("header");
  head.className = "pane-view-head";
  const mark = document.createElement("i");
  mark.setAttribute("aria-hidden", "true");
  const titles = document.createElement("div");
  titles.className = "pane-view-titles";
  const title = document.createElement("div");
  title.className = "pane-view-title";
  const detail = document.createElement("div");
  detail.className = "pane-view-detail";
  titles.append(title, detail);
  const modes = document.createElement("div");
  modes.className = "seg pane-view-mode";
  modes.setAttribute("role", "group");
  const modeButtons = new Map<PaneViewMode, HTMLButtonElement>();
  for (const mode of ["read", "screen"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mode = mode;
    button.addEventListener("click", () => setMode(mode));
    modeButtons.set(mode, button);
    modes.append(button);
  }
  head.append(mark, titles, modes);

  const body = document.createElement("div");
  body.className = "pane-view-body";
  const older = document.createElement("button");
  older.type = "button";
  older.className = "pane-view-older";
  older.hidden = true;
  const read = document.createElement("div");
  read.className = "pane-view-read";
  // 確定した行 (端末の過去の行) と、まだ書き換わる行 (端末の画面)。続きが
  // 来たときに描き直すのは後者だけ。
  const readStable = document.createElement("div");
  const readLive = document.createElement("div");
  read.append(readStable, readLive);
  const screen = document.createElement("div");
  screen.className = "pane-view-screen";
  screen.hidden = true;
  const latest = document.createElement("button");
  latest.type = "button";
  latest.className = "pane-view-latest";
  latest.hidden = true;
  const status = document.createElement("div");
  status.className = "pane-view-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  body.append(older, read, screen, latest, status);

  const choices = document.createElement("div");
  choices.className = "pane-view-choices";
  choices.setAttribute("role", "group");
  choices.hidden = true;

  const keys = document.createElement("div");
  keys.className = "pane-view-keys";
  keys.setAttribute("role", "toolbar");
  for (const key of TERMINAL_SOFT_KEYS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-key";
    button.textContent = SOFT_KEY_CAPS[key];
    button.dataset.key = key;
    // 押しても返事の欄から焦点を奪わない (ソフトキーボードを閉じない)。
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener(
      "click",
      () =>
        void send({
          keys: softKeySequence(
            key,
            term?.modes.applicationCursorKeysMode ?? false,
          ),
        }),
    );
    keys.append(button);
  }

  const compose = document.createElement("form");
  compose.className = "pane-view-compose";
  const input = document.createElement("textarea");
  input.className = "pane-view-input";
  input.rows = 1;
  const sendButton = document.createElement("button");
  sendButton.type = "submit";
  sendButton.className = "pane-view-send";
  // 押しても返事の欄から焦点を外さない (ソフトキーボードを閉じない)。
  sendButton.addEventListener("pointerdown", (event) => event.preventDefault());
  // 画像の添付 (写真・スクショ)。選んだ画像は PC のターミナルに貼ったときと
  // 同じ場所に保存してもらい、パスを返事の欄に足す。
  const attach = document.createElement("button");
  attach.type = "button";
  attach.className = "pane-view-attach";
  attach.innerHTML = iconSvg("pane-view-attach-icon", IMAGE_16_PATH);
  const picker = document.createElement("input");
  picker.type = "file";
  picker.className = "pane-view-picker";
  picker.accept = Object.keys(PASTE_IMAGE_TYPES).join(",");
  picker.multiple = true;
  picker.hidden = true;
  compose.append(attach, picker, input, sendButton);

  el.append(head, body, choices, keys, compose);

  let pane: TmuxPaneId | null = null;
  let generation = 0;
  let source: EventSource | null = null;
  let xterm: XtermApi | null = null;
  let term: XtermTerminal | null = null;
  let termSubscriptions: XtermDisposable[] = [];
  let mode: PaneViewMode = "read";
  /** いま出している形。null は当て直しが要る (新しい端末)。 */
  let currentView: PaneView | null = null;
  let colors: ReflowColors | null = null;
  let readLines = READ_LINES_STEP;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRender = 0;
  /** 上へスクロールしている間に届いた続き。一番下へ戻ったら描く。 */
  let behind = false;
  /**
   * 一番下に付いて、続きを追いかけているか。利用者のスクロールでだけ変わる
   * (こちらが動かした位置・箱の大きさの変化では変えない)。
   */
  let following = true;
  /** こちらが最後に動かした位置 (その scroll の知らせは利用者のものではない)。 */
  let ownScrollTop = -1;
  let ended = false;
  let sending: Promise<unknown> = Promise.resolve();
  let inputSequence = 0;
  /** 「画面」の文字の大きさ。ピンチで決めるまでは幅に合わせる (null)。 */
  let screenFontSize: number | null = null;
  /** 開いたときに履歴を 1 つ積んだか (戻るで閉じる)。 */
  let pushedHistory = false;
  /** 戻るで閉じた後に出し直す、開いた場所 (open の returnTo)。 */
  let returnTo: (() => void) | null = null;
  /**
   * 「読む」に描いた確定した行の控え。作業中の印が 1 秒に何度も書き換わる
   * たびに全部の行 (数百〜数千) を描き直し、スマホが固まった。書き換わるのは
   * 端末の画面の行だけなので、確定した行は足す・外すだけにする。
   */
  let stable: {
    term: XtermTerminal;
    type: XtermBuffer["type"];
    /** readStable の子と同じ並びの、各行の先頭のバッファの行番号。 */
    starts: number[];
    /** 確定した行の終わり (画面の行の始まり)。 */
    end: number;
    /** end の行の印。古い行が捨てられると、その分だけ line が減る。 */
    marker: XtermMarker | undefined;
  } | null = null;
  let olderTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 指が本文に触れている間。続きが届くたびに一番下へ寄せると、指でゆっくり
   * 上へ送ろうとしても 0.1 秒ほどで引き戻された。触れている間は寄せない。
   */
  let touching = false;

  function showStatus(message: string): void {
    status.textContent = message;
    status.hidden = message === "";
  }

  function setEnded(message: string): void {
    ended = true;
    showStatus(message);
    for (const control of [
      input,
      sendButton,
      attach,
      ...keys.querySelectorAll("button"),
    ])
      (control as HTMLButtonElement | HTMLTextAreaElement).disabled = true;
    choices.hidden = true;
  }

  function resetControls(): void {
    ended = false;
    for (const control of [
      input,
      sendButton,
      attach,
      ...keys.querySelectorAll("button"),
    ])
      (control as HTMLButtonElement | HTMLTextAreaElement).disabled = false;
  }

  function atBottom(): boolean {
    return (
      body.scrollHeight - body.scrollTop - body.clientHeight < AT_BOTTOM_PX
    );
  }

  function scrollToBottom(): void {
    body.scrollTop = body.scrollHeight;
    ownScrollTop = body.scrollTop;
    following = true;
  }

  function scheduleRender(): void {
    if (renderTimer) return;
    const wait = Math.max(0, lastRender + RENDER_INTERVAL_MS - Date.now());
    renderTimer = setTimeout(() => {
      renderTimer = null;
      lastRender = Date.now();
      render();
    }, wait);
  }

  function linesHtml(lines: ReflowLine[], palette: ReflowColors): string {
    return lines.map((line) => lineHtml(line, palette)).join("");
  }

  /** 行の並びを 1 つの断片にする (前にも後ろにも、並びのまま入れられる)。 */
  function linesFragment(
    lines: ReflowLine[],
    palette: ReflowColors,
  ): DocumentFragment {
    const template = document.createElement("template");
    template.innerHTML = linesHtml(lines, palette);
    return template.content;
  }

  function placeMarker(buffer: XtermBuffer): void {
    if (!stable || !term) return;
    stable.marker?.dispose();
    stable.marker =
      buffer.type === "normal"
        ? term.registerMarker(stable.end - (buffer.baseY + buffer.cursorY))
        : undefined;
  }

  /** 確定した行を from から end まで描き直す。 */
  function rebuildStable(
    buffer: XtermBuffer,
    from: number,
    end: number,
    palette: ReflowColors,
  ): void {
    if (!term) return;
    stable?.marker?.dispose();
    const lines = historyLinesIn(buffer, from, end);
    readStable.innerHTML = linesHtml(lines, palette);
    stable = {
      term,
      type: buffer.type,
      starts: lines.map((line) => line.start),
      end,
      marker: undefined,
    };
    placeMarker(buffer);
  }

  /**
   * 前に描いてから捨てられた古い行の数だけ、控えの行番号をずらす。追えない
   * (別の端末・別画面への切替・印の行まで捨てられた) なら false。
   */
  function shiftStable(buffer: XtermBuffer): boolean {
    if (!stable || stable.term !== term || stable.type !== buffer.type)
      return false;
    const marker = stable.marker;
    if (!marker || marker.isDisposed) return false;
    const shift = stable.end - marker.line;
    if (shift < 0) return false;
    if (shift > 0) {
      stable.starts = stable.starts.map((start) => start - shift);
      stable.end -= shift;
    }
    return true;
  }

  /** 確定した行の前に from までの行を足し、from より前に出た行を外す。 */
  function extendStableFront(
    buffer: XtermBuffer,
    from: number,
    palette: ReflowColors,
  ): void {
    if (!stable) return;
    while (stable.starts.length > 0 && stable.starts[0] < from) {
      readStable.firstElementChild?.remove();
      stable.starts.shift();
    }
    const first = stable.starts[0] ?? stable.end;
    if (from >= first) return;
    const lines = historyLinesIn(buffer, from, first);
    readStable.prepend(linesFragment(lines, palette));
    stable.starts.unshift(...lines.map((line) => line.start));
  }

  /** 確定した行を from から end までにそろえる (足せないときだけ描き直す)。 */
  function syncStable(
    buffer: XtermBuffer,
    from: number,
    end: number,
    palette: ReflowColors,
  ): void {
    if (!shiftStable(buffer) || !stable || stable.end > end) {
      rebuildStable(buffer, from, end, palette);
      return;
    }
    extendStableFront(buffer, from, palette);
    if (stable.end === end) return;
    const lines = historyLinesIn(buffer, stable.end, end);
    readStable.append(linesFragment(lines, palette));
    stable.starts.push(...lines.map((line) => line.start));
    stable.end = end;
    placeMarker(buffer);
  }

  /**
   * 描く行の並び。読む画面は段落 (アプリがペインの幅で入れた改行を繋ぐ。スマホ
   * の幅でもう一度折ると行の端が細切れになった)、升目の文はペインの行のまま。
   */
  function linesIn(buffer: XtermBuffer, from: number, to: number) {
    return currentView === "read" && term
      ? readParagraphs(buffer, from, to, term.cols)
      : readLogicalLines(buffer, from, to);
  }

  /**
   * 確定した行 (過去の行) に描く行。読む画面では、エージェントが作業中だけ出す
   * 表示 (作業中の印・入力欄の罫線) を外す: PC のペインが低いと過去の行がそれで
   * 埋まった。今の画面の行と「PC と同じ」は全部出す。
   */
  function historyLinesIn(buffer: XtermBuffer, from: number, to: number) {
    const lines = linesIn(buffer, from, to);
    return currentView === "read" ? withoutTransient(lines) : lines;
  }

  /** y 行目を含む、描く行 (linesIn の 1 行) の先頭。 */
  function lineStartAt(buffer: XtermBuffer, y: number): number {
    return currentView === "read" && term
      ? paragraphStart(buffer, y, term.cols)
      : logicalLineStart(buffer, y);
  }

  function readFrom(buffer: XtermBuffer): number {
    return lineStartAt(buffer, Math.max(0, buffer.length - readLines));
  }

  function render(): void {
    if (!term || !colors) return;
    applyView();
    const buffer = term.buffer.active;
    const from = readFrom(buffer);
    // 端末の画面の行 (まだ書き換わる)。その前は過去の行で、もう変わらない。
    const liveStart = Math.max(from, lineStartAt(buffer, buffer.baseY));
    // 選択肢はペインの行のまま探す (段落に繋ぐと番号の行が混ざりうる)。
    const tail = readLogicalLines(
      buffer,
      Math.min(
        liveStart,
        logicalLineStart(
          buffer,
          Math.max(from, buffer.length - CHOICE_TAIL_ROWS),
        ),
      ),
      buffer.length,
    );
    while (tail.length > 0 && tail[tail.length - 1].runs.length === 0)
      tail.pop();
    renderChoices(tail.slice(-30).map(lineText));
    if (currentView === "terminal") return;
    if (touching || !following) {
      behind = true;
      latest.hidden = following;
      return;
    }
    behind = false;
    latest.hidden = true;
    older.hidden = from === 0;
    const palette = colors;
    syncStable(buffer, from, liveStart, palette);
    const live = linesIn(buffer, liveStart, buffer.length);
    while (live.length > 0 && live[live.length - 1].runs.length === 0)
      live.pop();
    readLive.innerHTML = linesHtml(
      currentView === "read" ? collapseBlankLines(live) : live,
      palette,
    );
    scrollToBottom();
  }

  function renderChoices(lines: string[]): void {
    const found = ended ? [] : findChoices(lines);
    const signature = found
      .map((choice) => `${choice.key}:${choice.label}`)
      .join("\n");
    if (choices.dataset.signature === signature) return;
    choices.dataset.signature = signature;
    choices.replaceChildren(
      ...found.map((choice) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pane-view-choice";
        const key = document.createElement("span");
        key.className = "pane-view-choice-key";
        key.textContent = choice.key;
        const label = document.createElement("span");
        label.className = "pane-view-choice-label";
        label.textContent = choice.label;
        button.append(key, label);
        button.addEventListener("pointerdown", (event) =>
          event.preventDefault(),
        );
        button.addEventListener("click", () => void send({ keys: choice.key }));
        return button;
      }),
    );
    choices.hidden = found.length === 0;
  }

  /** 「画面」の字の大きさ: ペインの桁が幅に入る大きさ (ピンチで決めたらそれ)。 */
  function screenFont(width: number): number | null {
    if (!term || width < 1) return null;
    const fit = Math.floor(width / (term.cols * MONO_WIDTH_RATIO));
    return (
      screenFontSize ?? Math.min(GRID_FONT_MAX, Math.max(GRID_FONT_MIN, fit))
    );
  }

  /** 今の出し方 (読む・升目の文・端末) に「画面」の字の大きさを当てる。 */
  function fitScreenFont(): void {
    if (!term) return;
    if (currentView === "terminal") {
      const size = screenFont(screen.clientWidth);
      if (size !== null) term.options.fontSize = size;
      return;
    }
    if (currentView !== "grid") return;
    const size = screenFont(read.clientWidth);
    if (size === null) return;
    read.style.setProperty("--pane-grid-font", `${size}px`);
    read.style.setProperty("--pane-cols", String(term.cols));
  }

  function openScreen(): void {
    if (!term) return;
    if (!term.element) {
      screen.replaceChildren();
      term.open(screen);
    }
  }

  /**
   * 「画面」で端末 (xterm の升目) を出すのは、別画面 (vim など全画面のアプリ) の
   * ときだけ。通常の画面は、読む画面と同じ行を PC のペインの桁で折り返して出す
   * (端末だけでは、高さの低いペインは入力欄と状態の数行しか見えず、過去の行も
   * 読めなかった)。
   */
  function viewFor(): PaneView {
    if (mode === "read") return "read";
    return term?.buffer.active.type === "alternate" ? "terminal" : "grid";
  }

  /** 出し方が変わったときだけ、出す箱と字の大きさを替える。 */
  function applyView(): void {
    const next = viewFor();
    if (next === currentView) return;
    // 読む画面と升目の文では行のまとめ方が違うので、確定した行を描き直す。
    if (currentView !== null) {
      stable?.marker?.dispose();
      stable = null;
    }
    currentView = next;
    read.hidden = next === "terminal";
    read.classList.toggle("is-grid", next === "grid");
    if (next !== "grid") {
      read.style.removeProperty("--pane-grid-font");
      read.style.removeProperty("--pane-cols");
    }
    screen.hidden = next !== "terminal";
    if (next === "terminal") {
      older.hidden = true;
      latest.hidden = true;
      openScreen();
      // 読む画面の長い中身が隠れて箱が短くなっても、iPhone の Safari は
      // スクロールの位置を戻さず、何も無い所を映して真っ黒になった。
      body.scrollTop = 0;
    }
    fitScreenFont();
  }

  function setMode(next: PaneViewMode): void {
    mode = next;
    for (const [key, button] of modeButtons) {
      const active = key === next;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    latest.hidden = true;
    applyView();
    if (currentView === "terminal") return;
    behind = false;
    requestAnimationFrame(() => {
      scrollToBottom();
      render();
    });
  }

  function applySnapshot(snapshot: TmuxPaneSnapshot): void {
    if (!xterm) return;
    for (const subscription of termSubscriptions) subscription.dispose();
    term?.dispose();
    const theme = terminalTheme();
    colors = {
      palette: terminalPalette(theme),
      foreground: theme.foreground ?? "",
      background: theme.background ?? "",
      minimumContrastRatio: TERMINAL_MINIMUM_CONTRAST_RATIO,
    };
    const created = new xterm.Terminal({
      cols: snapshot.width,
      rows: snapshot.height,
      scrollback: PANE_VIEW_SCROLLBACK,
      theme,
      minimumContrastRatio: TERMINAL_MINIMUM_CONTRAST_RATIO,
    });
    term = created;
    termSubscriptions = [
      created.onWriteParsed(() => scheduleRender()),
      // 「画面」で打った文字。読む画面では端末に焦点が来ないので出ない。
      created.onData((data) => void send({ keys: data })),
    ];
    created.write(paneSnapshotSequence(snapshot));
    // 新しい端末: 出し方を当て直す (端末なら開き直す)。
    currentView = null;
    applyView();
    showStatus("");
  }

  async function send(body: {
    keys?: string;
    text?: string;
    enter?: boolean;
  }): Promise<boolean> {
    const target = pane;
    const myGen = generation;
    if (!target || ended) return false;
    inputSequence += 1;
    const sequence = inputSequence;
    const sent = sending.then(async () => {
      if (myGen !== generation) return false;
      try {
        const res = await deps.trackLoad(
          fetch(apiUrl("tmuxPaneInput"), {
            method: "POST",
            headers: {
              ...deps.actionHeaders(),
              "Content-Type": "application/json",
              // 画面の切替の取消で打鍵を捨てない (打った文字が黙って消える)。
              [UNINTERRUPTIBLE_REQUEST_HEADER]: "1",
            },
            body: JSON.stringify({
              pane: target,
              ...body,
              generation: sequence,
            }),
          }),
        );
        if (!res.ok) {
          const message = await responseErrorMessage(
            res,
            deps.getText().sendFailed,
          );
          console.error("[code-viewer] pane input failed", message);
          if (myGen === generation)
            res.status === 410 ? setEnded(text().gone) : showStatus(message);
          return false;
        }
        return true;
      } catch (error) {
        console.error("[code-viewer] pane input failed", error);
        if (myGen === generation)
          showStatus(
            `${deps.getText().sendFailed}\n${formatErrorDetail(error)}`,
          );
        return false;
      }
    });
    sending = sent;
    return sent;
  }

  function openStream(target: TmuxPaneId, myGen: number): void {
    const stream = new EventSource(
      `${apiUrl("tmuxPaneStream")}?pane=${encodeURIComponent(target)}`,
    );
    source = stream;
    const stale = () => myGen !== generation;
    stream.addEventListener("open", () => {
      if (!stale() && !ended) showStatus("");
    });
    stream.addEventListener("snapshot", (event) => {
      if (stale()) return;
      applySnapshot(JSON.parse((event as MessageEvent<string>).data));
    });
    stream.addEventListener("output", (event) => {
      if (stale() || !term) return;
      term.write(
        (JSON.parse((event as MessageEvent<string>).data) as { data: string })
          .data,
      );
    });
    stream.addEventListener("gone", () => {
      if (stale()) return;
      stream.close();
      setEnded(text().gone);
    });
    stream.addEventListener("failed", (event) => {
      if (stale()) return;
      stream.close();
      const { error } = JSON.parse((event as MessageEvent<string>).data) as {
        error: string;
      };
      console.error("[code-viewer] pane stream failed", error);
      setEnded(`${text().failed}\n${error}`);
    });
    stream.onerror = () => {
      // EventSource は自動で繋ぎ直す (繋がったらサーバが今の画面を送り直す)。
      if (stale() || ended) return;
      showStatus(
        stream.readyState === EventSource.CLOSED
          ? text().failed
          : deps.getText().connecting,
      );
    };
  }

  function refreshHeader(): void {
    if (!pane) return;
    const described = deps.describePane(pane);
    title.textContent = described?.title ?? pane;
    detail.textContent = described?.detail ?? "";
    mark.className = described
      ? `terminal-mark terminal-mark-${described.state}`
      : "terminal-mark";
  }

  function localize(): void {
    const t = text();
    modes.setAttribute("aria-label", t.modeLabel);
    modeButtons.get("read")?.replaceChildren(t.read);
    modeButtons.get("screen")?.replaceChildren(t.screen);
    older.textContent = t.older;
    latest.textContent = `↓ ${t.latest}`;
    keys.setAttribute("aria-label", t.keys);
    choices.setAttribute("aria-label", t.choices);
    input.placeholder = t.placeholder;
    input.setAttribute("aria-label", t.placeholder);
    attach.title = t.attach;
    attach.setAttribute("aria-label", t.attach);
    sendButton.textContent = t.send;
  }

  function close(): void {
    if (!pane) return;
    // 積んだ履歴は戻るで降ろす。戻るの知らせ (handlePopState) がもう一度ここへ来る。
    if (pushedHistory) {
      pushedHistory = false;
      history.back();
      return;
    }
    const closed = pane;
    const reopen = returnTo;
    returnTo = null;
    generation += 1;
    pane = null;
    source?.close();
    source = null;
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = null;
    for (const subscription of termSubscriptions) subscription.dispose();
    termSubscriptions = [];
    term?.dispose();
    term = null;
    if (olderTimer) clearTimeout(olderTimer);
    olderTimer = null;
    stable?.marker?.dispose();
    stable = null;
    readStable.replaceChildren();
    readLive.replaceChildren();
    screen.replaceChildren();
    choices.replaceChildren();
    delete choices.dataset.signature;
    el.hidden = true;
    document.body.classList.remove("pane-view-open");
    deps.onClose(closed);
    reopen?.();
  }

  function open(target: TmuxPaneId, reopen?: () => void): void {
    if (pane === target) return;
    if (pane) {
      // 開いたまま別のペインへ: 積んだ履歴はそのまま使う。前のペインを開いた
      // 場所へは戻さない (戻るで閉じたのではない)。
      const keep = pushedHistory;
      pushedHistory = false;
      returnTo = null;
      close();
      pushedHistory = keep;
    } else {
      history.pushState(history.state, "");
      pushedHistory = true;
    }
    returnTo = reopen ?? null;
    pane = target;
    generation += 1;
    const myGen = generation;
    readLines = READ_LINES_STEP;
    behind = false;
    following = true;
    touching = false;
    resetControls();
    input.value = "";
    refreshHeader();
    localize();
    setMode("read");
    el.hidden = false;
    document.body.classList.add("pane-view-open");
    showStatus(deps.getText().connecting);
    void loadXterm().then(
      (api) => {
        if (myGen !== generation) return;
        xterm = api;
        openStream(target, myGen);
      },
      (error: unknown) => {
        console.error("[code-viewer] pane view could not load xterm", error);
        if (myGen === generation)
          setEnded(`${deps.getText().loadFailed}\n${formatErrorDetail(error)}`);
      },
    );
  }

  /** 前の出力を READ_LINES_STEP だけ足す (「前の出力」・上端で止まったとき)。 */
  function showOlder(): void {
    readLines += READ_LINES_STEP;
    const palette = colors;
    if (!term || !palette) return;
    const buffer = term.buffer.active;
    // 前に足すだけにできなければ (古い行が捨てられた・画面が消えた)、一番下を
    // 描き直す。
    if (!shiftStable(buffer)) {
      behind = false;
      render();
      return;
    }
    const height = body.scrollHeight;
    const top = body.scrollTop;
    const from = readFrom(buffer);
    extendStableFront(buffer, from, palette);
    older.hidden = from === 0;
    // 読んでいた所をそのままにする (上に足した分だけ下げる)。
    body.scrollTop = top + (body.scrollHeight - height);
  }
  older.addEventListener("click", showOlder);
  latest.addEventListener("click", () => {
    scrollToBottom();
    render();
  });
  body.addEventListener(
    "touchstart",
    () => {
      touching = true;
    },
    { passive: true },
  );
  // 離したときに一番下なら続きを描く (慣性で動いている間は scroll が見る)。
  const releaseTouch = () => {
    touching = false;
    if (behind && following) render();
  };
  body.addEventListener("touchend", releaseTouch, { passive: true });
  body.addEventListener("touchcancel", releaseTouch, { passive: true });
  body.addEventListener("scroll", () => {
    if (body.scrollTop !== ownScrollTop) following = atBottom();
    if (behind && following && !touching) render();
    if (olderTimer) clearTimeout(olderTimer);
    olderTimer = null;
    if (older.hidden || body.scrollTop >= AT_TOP_PX) return;
    olderTimer = setTimeout(() => {
      olderTimer = null;
      if (!older.hidden && body.scrollTop < AT_TOP_PX) showOlder();
    }, SCROLL_SETTLE_MS);
  });
  attach.addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    const files = [...(picker.files ?? [])];
    picker.value = "";
    void attachImages(files);
  });

  /** 選んだ画像を 1 枚ずつ保存してもらい、パスを返事の欄の後ろに足す。 */
  async function attachImages(files: File[]): Promise<void> {
    const myGen = generation;
    const t = text();
    for (const file of files) {
      if (!pasteImageExtension(file.type)) {
        showStatus(t.attachUnsupported(file.name));
        return;
      }
      showStatus(t.attaching(file.name));
      const result = await uploadPastedImage(file, {
        actionHeaders: deps.actionHeaders,
        trackLoad: deps.trackLoad,
        failedText: t.attachFailed,
      });
      if (myGen !== generation) return;
      if (result.status === "failed") {
        console.error("[code-viewer] attaching an image failed", result.error);
        showStatus(result.message);
        return;
      }
      const before = input.value;
      const gap = before === "" || /\s$/.test(before) ? "" : " ";
      // パスに空白は入らない命名だが、引用しておけば将来変えても壊れない。
      input.value = `${before}${gap}'${result.saved.path}' `;
    }
    showStatus("");
  }

  compose.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value;
    void send(
      value.trim() === "" ? { enter: true } : { text: value, enter: true },
    ).then((ok) => {
      if (ok && input.value === value) input.value = "";
    });
  });
  const onResize = () => fitScreenFont();
  window.addEventListener("resize", onResize);
  // 追いかけている間は、箱が縮んでも (キーボードが出た) 一番下に付いたまま。
  const bodyResize = new ResizeObserver(() => {
    if (following && currentView !== "terminal") scrollToBottom();
  });
  bodyResize.observe(body);

  // 「画面」は 2 本の指のピンチで文字の大きさを変える (横は箱がスクロールする)。
  let pinch: { startSize: number; startDistance: number } | null = null;
  const fingers = (event: TouchEvent) =>
    Math.hypot(
      event.touches[0].clientX - event.touches[1].clientX,
      event.touches[0].clientY - event.touches[1].clientY,
    );
  body.addEventListener(
    "touchstart",
    (event) => {
      if (mode !== "screen" || event.touches.length !== 2 || !term) return;
      const width =
        currentView === "terminal" ? screen.clientWidth : read.clientWidth;
      pinch = {
        startSize: screenFont(width) ?? GRID_FONT_MIN,
        startDistance: fingers(event),
      };
    },
    { passive: true },
  );
  body.addEventListener(
    "touchmove",
    (event) => {
      if (!pinch || event.touches.length !== 2 || !term) return;
      event.preventDefault();
      screenFontSize = pinchFontSize({
        ...pinch,
        distance: fingers(event),
        min: GRID_FONT_MIN,
        max: GRID_FONT_PINCH_MAX,
      });
      fitScreenFont();
    },
    { passive: false },
  );
  body.addEventListener("touchend", (event) => {
    if (event.touches.length < 2) pinch = null;
  });

  localize();
  setMode("read");

  return {
    el,
    open,
    close,
    currentPane: () => pane,
    refreshHeader,
    closeThen(next) {
      if (!pane) {
        next();
        return;
      }
      returnTo = next;
      close();
    },
    handlePopState() {
      if (!pane) return false;
      pushedHistory = false;
      close();
      return true;
    },
    localize,
    dispose() {
      returnTo = null;
      close();
      window.removeEventListener("resize", onResize);
      bodyResize.disconnect();
      el.remove();
    },
  };
}
