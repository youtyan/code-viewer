// エージェントの行に載せたときに出す、シェル (tmux のペイン) の中の覗き窓。
// 左のサイドバーと全体ボードの行が同じ 1 つの窓を使う (同時に問い合わせるのは
// 1 つのペインだけ)。
//
// - マウスで行に載せて (ポインタが動いて行に入って) PANE_PREVIEW_DELAY_MS で出す。出ている間にほかの行へ
//   移ったら待たずに切り替える。キーボードで行に来たときも同じ待ちで出す
// - 窓は body 直下の position: fixed で本文の上に重ねる。行や周りは 1px も動かない
// - 出ている間は PANE_PREVIEW_REFRESH_MS ごとに取り直す (前の応答が返ってから
//   数えるので、問い合わせは常に 1 本)。消えたら取り消して止める
// - 見るだけ。窓はポインタを受けず (pointer-events: none)、行を押せば今までどおり
//   そのシェルを開く。Esc・行を押す・行を離れる・スクロールで消える
// - 電話・指の画面では出さない (SOFT_KEYS_MEDIA_QUERY)
// - 読み上げは中身でなく「プレビュー: 行の名前」(窓の aria-label。行の
//   aria-describedby で結ぶ。中身の pre は aria-hidden)
//
// 行は取り直しのたびに描き直される (要素が差し替わる) ので、覚えるのは要素でなく
// ペインの id。位置を合わせるたびに入れ物から同じ id の行を探し直す。

import { apiUrl } from "../../core/api-url";
import {
  formatErrorDetail,
  responseErrorMessage,
} from "../../core/error-detail";
import { SOFT_KEYS_MEDIA_QUERY } from "../../core/mobile-layout";
import { BACKGROUND_REQUEST_HEADER } from "../../core/network-activity";
import {
  PANE_PREVIEW_DELAY_MS,
  PANE_PREVIEW_LINES,
  PANE_PREVIEW_REFRESH_MS,
  type PanePreviewPlacement,
  panePreviewLines,
  panePreviewPosition,
} from "../../core/pane-preview";
import type { TerminalCaptureResponse } from "../../core/terminal-capture";

/** 覗ける行の印。値はペインの id (`%3`)。 */
const PANE_ATTR = "data-preview-pane";
/** 窓の見出しに出す行の名前。 */
const NAME_ATTR = "data-preview-name";

export type PanePreviewText = {
  /** 窓の読み上げの名前 (中身ではなく「プレビュー」と分かるもの)。 */
  label: (name: string) => string;
  loading: string;
  /** ペインが閉じた (410)。取り直しを止める。 */
  gone: string;
  failed: (detail: string) => string;
};

/** 行を覗ける行にする。name は窓の見出し (種類 · 要約 · 場所)。 */
export function markPreviewRow(row: HTMLElement, pane: string, name: string) {
  row.setAttribute(PANE_ATTR, pane);
  row.setAttribute(NAME_ATTR, name);
}

/** 410 (ペインが閉じた)。ほかの失敗と分けて、取り直しを止める。 */
export class PaneGoneError extends Error {}

export type PanePreviewDeps = {
  /** 画面を 1 回読む (テストで差し替える)。 */
  read(pane: string, signal: AbortSignal): Promise<string>;
  /** 電話・指の画面 (出さない)。 */
  fingerScreen(): boolean;
};

export type PanePreview = {
  /** 行の入れ物を見張る。戻り値で外す。 */
  watch(
    container: HTMLElement,
    options: { placement: PanePreviewPlacement; getText(): PanePreviewText },
  ): () => void;
  hide(): void;
  /** true の間は出さない (見出しのドラッグの間)。 */
  setPaused(paused: boolean): void;
  /** 出している・出す待ちのペイン。 */
  current(): string | null;
};

type Watch = {
  container: HTMLElement;
  placement: PanePreviewPlacement;
  getText(): PanePreviewText;
};

type Target = { pane: string; watch: Watch; by: "pointer" | "focus" };

async function readScreen(pane: string, signal: AbortSignal): Promise<string> {
  const url = `${apiUrl("agentCapture")}?target=${encodeURIComponent(pane)}&history=0`;
  // 数秒おきの読み取りなので、通信中の表示と画面切替の中断の巻き添えにしない
  // (server.md の Request Lifecycle の表)。消えたら自分の signal で止める。
  const res = await fetch(url, {
    headers: { [BACKGROUND_REQUEST_HEADER]: "1" },
    signal,
  });
  if (res.status === 410) {
    throw new PaneGoneError(await responseErrorMessage(res, `GET ${url}`));
  }
  if (!res.ok) throw new Error(await responseErrorMessage(res, `GET ${url}`));
  return ((await res.json()) as TerminalCaptureResponse).content;
}

export function createPanePreview(
  deps: PanePreviewDeps = {
    read: readScreen,
    fingerScreen: () =>
      window.matchMedia?.(SOFT_KEYS_MEDIA_QUERY).matches ?? false,
  },
): PanePreview {
  const watches = new Set<Watch>();
  let box: {
    root: HTMLElement;
    head: HTMLElement;
    screen: HTMLElement;
  } | null = null;
  /** 出す待ち (timer が動いている)。 */
  let pending: Target | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** 出している。 */
  let shown: Target | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  /** 古い応答を捨てるための世代。 */
  let generation = 0;
  /** Esc・押したで消したペイン。行を離れるかほかの行へ移るまで出し直さない。 */
  let dismissed: string | null = null;
  /** 最後の入力がキーボードか (フォーカスで出すのはキーボードで来たときだけ)。 */
  let keyboard = false;
  let paused = false;
  /** 最後に動いたポインタの位置 (止まったままの over・move を見分ける)。 */
  let lastMove: { x: number; y: number } | null = null;

  function ensureBox() {
    if (box) return box;
    const root = document.createElement("div");
    root.className = "pane-preview";
    root.id = "pane-preview";
    root.role = "tooltip";
    root.hidden = true;
    root.style.setProperty("--pane-preview-lines", String(PANE_PREVIEW_LINES));
    const head = document.createElement("div");
    head.className = "pane-preview-head";
    head.setAttribute("aria-hidden", "true");
    const screen = document.createElement("pre");
    screen.className = "pane-preview-screen terminal-mono";
    screen.setAttribute("aria-hidden", "true");
    root.append(head, screen);
    document.body.appendChild(root);
    box = { root, head, screen };
    return box;
  }

  function rowOf(target: Target): HTMLElement | null {
    for (const row of target.watch.container.querySelectorAll<HTMLElement>(
      `[${PANE_ATTR}]`,
    )) {
      if (row.getAttribute(PANE_ATTR) === target.pane) return row;
    }
    return null;
  }

  function clearTimers(): void {
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    pendingTimer = null;
    refreshTimer = null;
  }

  function hide(): void {
    clearTimers();
    generation += 1;
    inFlight?.abort(new DOMException("pane preview hidden", "AbortError"));
    inFlight = null;
    pending = null;
    if (shown) rowOf(shown)?.removeAttribute("aria-describedby");
    shown = null;
    if (box) box.root.hidden = true;
  }

  function place(): void {
    if (!shown || !box) return;
    const row = rowOf(shown);
    if (!row) {
      // 行が無くなった (エージェントが終わった・畳んだ)。
      hide();
      return;
    }
    row.setAttribute("aria-describedby", box.root.id);
    const rect = box.root.getBoundingClientRect();
    const anchor = row.getBoundingClientRect();
    // 右に出すものは、行でなく一覧の右端から離す (サイドバーの縁に掛けない)。
    const edge = shown.watch.container.getBoundingClientRect().right;
    const at = panePreviewPosition({
      anchor: {
        left: anchor.left,
        top: anchor.top,
        bottom: anchor.bottom,
        right: Math.max(anchor.right, edge),
      },
      size: { width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement: shown.watch.placement,
    });
    box.root.style.left = `${at.left}px`;
    box.root.style.top = `${at.top}px`;
  }

  function setScreen(text: string, tone: "" | "muted" | "failed"): void {
    if (!box) return;
    box.screen.textContent = text;
    box.screen.dataset.tone = tone;
  }

  function load(target: Target): void {
    const mine = ++generation;
    const controller = new AbortController();
    inFlight = controller;
    deps.read(target.pane, controller.signal).then(
      (content) => {
        if (mine !== generation) return;
        inFlight = null;
        setScreen(panePreviewLines(content, PANE_PREVIEW_LINES).join("\n"), "");
        place();
        refreshTimer = setTimeout(() => load(target), PANE_PREVIEW_REFRESH_MS);
      },
      (cause: unknown) => {
        if (mine !== generation) return;
        inFlight = null;
        const text = target.watch.getText();
        if (cause instanceof PaneGoneError) {
          setScreen(text.gone, "muted");
          place();
          return;
        }
        console.error(
          `[code-viewer] pane preview failed (pane ${target.pane})`,
          cause,
        );
        setScreen(text.failed(formatErrorDetail(cause)), "failed");
        place();
        refreshTimer = setTimeout(() => load(target), PANE_PREVIEW_REFRESH_MS);
      },
    );
  }

  function show(target: Target): void {
    hide();
    const row = rowOf(target);
    if (!row) return;
    const { root, head } = ensureBox();
    const text = target.watch.getText();
    const name = row.getAttribute(NAME_ATTR) ?? target.pane;
    head.textContent = name;
    root.setAttribute("aria-label", text.label(name));
    setScreen(text.loading, "muted");
    shown = target;
    root.hidden = false;
    place();
    load(target);
  }

  /** そのペインを出す。出ている間の乗り換えは待たない。 */
  function request(target: Target): void {
    if (paused || deps.fingerScreen() || target.pane === dismissed) return;
    const active = shown ?? pending;
    if (active?.pane === target.pane && active.watch === target.watch) {
      active.by = target.by;
      return;
    }
    if (shown) {
      show(target);
      return;
    }
    hide();
    pending = target;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      pending = null;
      show(target);
    }, PANE_PREVIEW_DELAY_MS);
  }

  /** by で出したもの (出す待ちを含む) だけを消す。 */
  function hideIf(by: Target["by"]): void {
    if ((shown ?? pending)?.by === by) hide();
  }

  function paneRow(watch: Watch, node: EventTarget | null): HTMLElement | null {
    if (!(node instanceof Element)) return null;
    const row = node.closest<HTMLElement>(`[${PANE_ATTR}]`);
    return row && watch.container.contains(row) ? row : null;
  }

  function onScroll(event: Event): void {
    if (!shown) return;
    const row = rowOf(shown);
    const scroller = event.target;
    // 行を動かすスクロールだけ (端末の出力で xterm が送るものは関係無い)。
    if (
      !row ||
      scroller === document ||
      (scroller instanceof Node && scroller.contains(row))
    ) {
      hide();
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    keyboard = true;
    if (event.key !== "Escape") return;
    const target = shown ?? pending;
    if (!target) return;
    dismissed = target.pane;
    hide();
  }

  function onPointerdown(): void {
    keyboard = false;
  }

  function onVisibility(): void {
    if (document.hidden) hide();
  }

  function listenDocument(on: boolean): void {
    const method = on ? "addEventListener" : "removeEventListener";
    document[method]("keydown", onKeydown, true);
    document[method]("pointerdown", onPointerdown, true);
    document[method]("scroll", onScroll, true);
    document[method]("visibilitychange", onVisibility);
  }

  return {
    watch(container, options) {
      const watch: Watch = { container, ...options };
      const onMove = (event: PointerEvent) => {
        // 指とペンは除く (指の画面は長押しのメニューに任せる)。
        if (event.pointerType && event.pointerType !== "mouse") return;
        // 動いたときだけ見る。描き直しで行が差し替わると、ブラウザは止まった
        // ポインタの下の新しい要素へ over を送る (押して消した窓が 0.4 秒後に
        // 戻っていた)。読み込み直後の止まったポインタでも出さない。
        if (lastMove?.x === event.clientX && lastMove.y === event.clientY) {
          return;
        }
        lastMove = { x: event.clientX, y: event.clientY };
        const row = paneRow(watch, event.target);
        const pane = row?.getAttribute(PANE_ATTR) ?? null;
        if (pane !== dismissed) dismissed = null;
        if (pane === null) hideIf("pointer");
        else request({ pane, watch, by: "pointer" });
      };
      const onLeave = () => {
        dismissed = null;
        hideIf("pointer");
      };
      const onDown = (event: PointerEvent) => {
        // 押したら消す (行はそのシェルを開く)。離れるまで出し直さない。
        const pane = paneRow(watch, event.target)?.getAttribute(PANE_ATTR);
        if (!pane) return;
        dismissed = pane;
        hide();
      };
      const onFocusIn = (event: FocusEvent) => {
        if (!keyboard) return;
        const row = paneRow(watch, event.target);
        const pane = row?.getAttribute(PANE_ATTR) ?? null;
        if (pane !== dismissed) dismissed = null;
        if (pane === null) hideIf("focus");
        else request({ pane, watch, by: "focus" });
      };
      const onFocusOut = () => {
        // 描き直しは同じペインの新しい行へフォーカスを戻す。戻し終わってから、
        // 行の外へ出たかを見る。
        setTimeout(() => {
          const target = shown ?? pending;
          if (target?.by !== "focus") return;
          const row = paneRow(target.watch, document.activeElement);
          if (row?.getAttribute(PANE_ATTR) !== target.pane) hide();
        }, 0);
      };
      container.addEventListener("pointermove", onMove);
      container.addEventListener("pointerleave", onLeave);
      container.addEventListener("pointerdown", onDown);
      container.addEventListener("focusin", onFocusIn);
      container.addEventListener("focusout", onFocusOut);
      if (watches.size === 0) listenDocument(true);
      watches.add(watch);
      return () => {
        container.removeEventListener("pointermove", onMove);
        container.removeEventListener("pointerleave", onLeave);
        container.removeEventListener("pointerdown", onDown);
        container.removeEventListener("focusin", onFocusIn);
        container.removeEventListener("focusout", onFocusOut);
        if ((shown ?? pending)?.watch === watch) hide();
        watches.delete(watch);
        if (watches.size === 0) listenDocument(false);
      };
    },
    hide,
    setPaused(value) {
      paused = value;
      if (value) hide();
    },
    current: () => (shown ?? pending)?.pane ?? null,
  };
}

/** 左のサイドバーと全体ボードが共有する 1 つ (同時に覗くのは 1 つのペイン)。 */
export const PANE_PREVIEW = createPanePreview();
