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
import { CHEVRON_LEFT_16_PATH, iconSvg } from "../../core/icons";
import {
  pinchFontSize,
  softKeySequence,
  TERMINAL_SOFT_KEYS,
} from "../../core/mobile-layout";
import { UNINTERRUPTIBLE_REQUEST_HEADER } from "../../core/network-activity";
import {
  DEFAULT_COLOR,
  findChoices,
  logicalLineStart,
  type ReflowColors,
  type ReflowLine,
  readLogicalLines,
  runCss,
  terminalPalette,
} from "../../core/pane-reflow";
import {
  paneSnapshotSequence,
  type TmuxPaneId,
  type TmuxPaneSnapshot,
} from "../../core/tmux";
import {
  loadXterm,
  type XtermApi,
  type XtermDisposable,
  type XtermTerminal,
} from "../../core/xterm-loader";
import { SOFT_KEY_CAPS } from "../mobile-shell-i18n";
import type { TerminalText } from "./i18n";
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
/** 一番下にいるとみなす、下端からの距離。 */
const AT_BOTTOM_PX = 32;
/** 「画面」の文字の大きさの範囲。幅に合わせて決め、読めないほど小さくしない。 */
const GRID_FONT_MIN = 7;
const GRID_FONT_MAX = 14;
/** ピンチで大きくできる上限 (横にスクロールして読む)。 */
const GRID_FONT_PINCH_MAX = 24;
/** 等幅の字の幅と文字の大きさの比 (おおよそ)。 */
const MONO_WIDTH_RATIO = 0.6;

export type PaneViewMode = "read" | "screen";

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
  open(pane: TmuxPaneId): void;
  close(): void;
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

function lineHtml(line: ReflowLine, colors: ReflowColors): string {
  const body = line.runs
    .map((run) =>
      plain(run)
        ? escapeHtml(run.text)
        : `<span style="${runCss(run.style, colors)}">${escapeHtml(run.text)}</span>`,
    )
    .join("");
  return `<div class="pane-line${line.rule ? " pane-line-rule" : ""}">${body}</div>`;
}

function lineText(line: ReflowLine): string {
  return line.runs.map((run) => run.text).join("");
}

export function createPaneView(deps: PaneViewDeps): PaneViewHandle {
  const text = () => deps.getText().paneView;

  const el = document.createElement("section");
  el.className = "pane-view";
  // 中の色は端末と同じ (ターミナルの明暗の設定に従う)。
  el.dataset.terminalSurface = "";
  el.hidden = true;

  const head = document.createElement("header");
  head.className = "pane-view-head";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "pane-view-back";
  back.innerHTML = iconSvg("pane-view-back-icon", [CHEVRON_LEFT_16_PATH]);
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
  head.append(back, mark, titles, modes);

  const body = document.createElement("div");
  body.className = "pane-view-body";
  const older = document.createElement("button");
  older.type = "button";
  older.className = "pane-view-older";
  older.hidden = true;
  const read = document.createElement("div");
  read.className = "pane-view-read";
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
  compose.append(input, sendButton);

  el.append(head, body, choices, keys, compose);

  let pane: TmuxPaneId | null = null;
  let generation = 0;
  let source: EventSource | null = null;
  let xterm: XtermApi | null = null;
  let term: XtermTerminal | null = null;
  let termSubscriptions: XtermDisposable[] = [];
  let mode: PaneViewMode = "read";
  let colors: ReflowColors | null = null;
  let readLines = READ_LINES_STEP;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRender = 0;
  /** 上へスクロールしている間に届いた続き。一番下へ戻ったら描く。 */
  let behind = false;
  let ended = false;
  let sending: Promise<unknown> = Promise.resolve();
  let inputSequence = 0;
  /** 「画面」の文字の大きさ。ピンチで決めるまでは幅に合わせる (null)。 */
  let screenFontSize: number | null = null;
  /** 開いたときに履歴を 1 つ積んだか (戻るで閉じる)。 */
  let pushedHistory = false;

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

  function render(): void {
    if (!term || !colors) return;
    const buffer = term.buffer.active;
    const from = logicalLineStart(
      buffer,
      Math.max(0, buffer.length - readLines),
    );
    const lines = readLogicalLines(buffer, from, buffer.length);
    while (lines.length > 0 && lines[lines.length - 1].runs.length === 0)
      lines.pop();
    renderChoices(lines.slice(-30).map(lineText));
    if (mode !== "read") return;
    if (!atBottom()) {
      behind = true;
      latest.hidden = false;
      return;
    }
    behind = false;
    latest.hidden = true;
    older.hidden = from === 0;
    const palette = colors;
    read.innerHTML = lines.map((line) => lineHtml(line, palette)).join("");
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

  function fitScreenFont(): void {
    if (!term || mode !== "screen") return;
    const width = screen.clientWidth;
    if (width < 1) return;
    const fit = Math.floor(width / (term.cols * MONO_WIDTH_RATIO));
    term.options.fontSize =
      screenFontSize ?? Math.min(GRID_FONT_MAX, Math.max(GRID_FONT_MIN, fit));
  }

  function openScreen(): void {
    if (!term || mode !== "screen") return;
    if (!term.element) {
      screen.replaceChildren();
      term.open(screen);
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
    read.hidden = next !== "read";
    older.hidden = next !== "read" || older.hidden;
    screen.hidden = next !== "screen";
    latest.hidden = true;
    if (next === "screen") openScreen();
    else {
      behind = false;
      requestAnimationFrame(() => {
        scrollToBottom();
        render();
      });
    }
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
    openScreen();
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
    back.setAttribute("aria-label", t.back);
    back.title = t.back;
    modes.setAttribute("aria-label", t.modeLabel);
    modeButtons.get("read")?.replaceChildren(t.read);
    modeButtons.get("screen")?.replaceChildren(t.screen);
    older.textContent = t.older;
    latest.textContent = `↓ ${t.latest}`;
    keys.setAttribute("aria-label", t.keys);
    choices.setAttribute("aria-label", t.choices);
    input.placeholder = t.placeholder;
    input.setAttribute("aria-label", t.placeholder);
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
    read.replaceChildren();
    screen.replaceChildren();
    choices.replaceChildren();
    delete choices.dataset.signature;
    el.hidden = true;
    document.body.classList.remove("pane-view-open");
    deps.onClose(closed);
  }

  function open(target: TmuxPaneId): void {
    if (pane === target) return;
    if (pane) {
      // 開いたまま別のペインへ: 積んだ履歴はそのまま使う。
      const keep = pushedHistory;
      pushedHistory = false;
      close();
      pushedHistory = keep;
    } else {
      history.pushState(history.state, "");
      pushedHistory = true;
    }
    pane = target;
    generation += 1;
    const myGen = generation;
    readLines = READ_LINES_STEP;
    behind = false;
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

  back.addEventListener("click", () => close());
  older.addEventListener("click", () => {
    readLines += READ_LINES_STEP;
    const height = body.scrollHeight;
    const top = body.scrollTop;
    behind = false;
    const palette = colors;
    if (!term || !palette) return;
    const buffer = term.buffer.active;
    const from = logicalLineStart(
      buffer,
      Math.max(0, buffer.length - readLines),
    );
    read.innerHTML = readLogicalLines(buffer, from, buffer.length)
      .map((line) => lineHtml(line, palette))
      .join("");
    older.hidden = from === 0;
    // 読んでいた所をそのままにする (上に足した分だけ下げる)。
    body.scrollTop = top + (body.scrollHeight - height);
  });
  latest.addEventListener("click", () => {
    scrollToBottom();
    render();
  });
  body.addEventListener("scroll", () => {
    if (behind && atBottom()) render();
  });
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

  // 「画面」は 2 本の指のピンチで文字の大きさを変える (横は箱がスクロールする)。
  let pinch: { startSize: number; startDistance: number } | null = null;
  const fingers = (event: TouchEvent) =>
    Math.hypot(
      event.touches[0].clientX - event.touches[1].clientX,
      event.touches[0].clientY - event.touches[1].clientY,
    );
  screen.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 2 || !term) return;
      pinch = {
        startSize: term.options.fontSize ?? GRID_FONT_MIN,
        startDistance: fingers(event),
      };
    },
    { passive: true },
  );
  screen.addEventListener(
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
      term.options.fontSize = screenFontSize;
    },
    { passive: false },
  );
  screen.addEventListener("touchend", (event) => {
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
    handlePopState() {
      if (!pane) return false;
      pushedHistory = false;
      close();
      return true;
    },
    localize,
    dispose() {
      close();
      window.removeEventListener("resize", onResize);
      el.remove();
    },
  };
}
