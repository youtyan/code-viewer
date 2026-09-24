// ターミナルの画面の上の、画像のパス・URL・ファイルのパスの印と操作。
//
// xterm の decoration は代替画面 (tmux が使う) では付かず、リンクの下線は
// カーソルを載せるまで出ない。tmux のマウスが有効な (代替画面でマウスの報告が
// オンの) ときは、xterm のリンクの出入りと押下も tmux へ流れる。そこで、画面に
// 見えている範囲のリンクをこちらで持ち、`.xterm-screen` の中の薄い層に描き、
// マウスもこちらで受ける。
//
// - 常に薄い印: 画像のパスだけ、文字の下端に細い線 (URL とパスは量が多いので
//   常時の印は出さない)
// - ホバー: その文字列全体に強調色の面と下線。棚の項目にカーソルが載ったときも
//   同じ強い強調で示す (setStrong)
// - 帯: 文字列のすぐ上 (上に余裕が無ければ下) に［開く］［コピー］。画像なら
//   小さな見本 (最大 240px 四方) と名前・寸法も。文字列か帯にカーソルがある間
//   だけ出し、離れて LINK_BAR_HIDE_MS で消す
// - 押下: そのまま押すと開く、⌘/Ctrl は固定のタブ、Alt は画像の拡大表示、Shift は
//   選択に任せる。⌘/Ctrl を押しながらの押下は tmux に渡さない (マウスの報告が
//   オンでも必ず開く)
//
// 層は文字の上に重なるが、印は線と半透明の面だけで、操作は下の端末へ通す
// (pointer-events: none)。帯だけが押せる。

import { formatErrorDetail } from "../../core/error-detail";
import {
  CHECK_16_PATHS,
  COPY_16_PATHS,
  iconSvg,
  OPEN_EXTERNAL_16_PATH,
} from "../../core/icons";
import type { XtermTerminal } from "../../core/xterm-loader";
import type { TerminalText } from "./i18n";
import type { ShelfOpenMode } from "./image-shelf";

/** 帯を消すまでの間。文字列から帯へカーソルを移す間に消えないように。 */
export const LINK_BAR_HIDE_MS = 300;

/** 「コピーしました」を出している間。 */
const COPIED_MS = 1200;

/** 帯と文字列の間、帯と画面の端の間 (px)。 */
const BAR_GAP = 4;
const BAR_EDGE = 8;

/** 画面の 1 行の中の、リンクが占める桁 (バッファの行と桁、x1 は含む)。 */
export type LinkSegment = { y: number; x0: number; x1: number };

export type ScreenLinkKind = "image" | "url" | "file";

/** 画面に見えているリンク 1 つ。 */
export type ScreenLink = {
  kind: ScreenLinkKind;
  /** 同じ 1 つかを決める鍵 (綴りと、画面の上の始まりの位置)。 */
  key: string;
  /** 画面に出た綴り。 */
  text: string;
  segments: LinkSegment[];
  /** 画像なら、その見本の URL・名前 (棚の項目から)。 */
  image?: { url: string; name: string };
  /** URL なら開く先。 */
  url?: string;
  /** ファイルなら、プロジェクトの中の相対パス・絶対パス・行と桁。 */
  file?: { path: string; absolute: string; line?: number; column?: number };
};

/** リンクの鍵 (綴りと始まりの位置)。 */
export function screenLinkKey(text: string, first: LinkSegment): string {
  return `${first.y}:${first.x0}:${text}`;
}

/** 桁と行 (画面の上の位置) にあるリンク。 */
export function linkAt(
  links: readonly ScreenLink[],
  x: number,
  y: number,
): ScreenLink | null {
  return (
    links.find((link) =>
      link.segments.some(
        (segment) => segment.y === y && x >= segment.x0 && x <= segment.x1,
      ),
    ) ?? null
  );
}

type Box = { left: number; top: number; width: number; height: number };

/**
 * 帯の置き場所。文字列のすぐ上に、左端をそろえて出す。上に入らなければ
 * 文字列のすぐ下。左右は画面の中に収める。文字列そのものは隠さない。
 *
 * @param text 文字列の範囲 (画面の座標)
 * @param bar 帯の大きさ
 * @param bounds 収める範囲 (端末の画面)
 */
export function placeLinkBar(
  text: Box,
  bar: { width: number; height: number },
  bounds: Box,
): { left: number; top: number } {
  const above = text.top - BAR_GAP - bar.height;
  const top =
    above >= bounds.top + BAR_EDGE ? above : text.top + text.height + BAR_GAP;
  const left = Math.max(
    bounds.left + BAR_EDGE,
    Math.min(text.left, bounds.left + bounds.width - BAR_EDGE - bar.width),
  );
  return { left, top };
}

export type TerminalLinkLayerDeps = {
  getText(): TerminalText;
  term(): XtermTerminal | null;
  /** 今見えているリンク。 */
  links(): readonly ScreenLink[];
  /** 開く。mode は棚と同じ押し分け。 */
  open(link: ScreenLink, mode: ShelfOpenMode): void;
  /** コピーする値 (URL は見えているまま、パスは絶対パス)。 */
  copyValue(link: ScreenLink): string;
  /** ホバーが変わった (棚の同じ画像を強調する)。 */
  onHover(link: ScreenLink | null): void;
  /** 失敗を画面の状態の行に出す。 */
  onStatus(message: string): void;
};

export type TerminalLinkLayer = {
  /** リンクの一覧が変わった・画面が動いた。印を描き直す。 */
  render(): void;
  /** 棚から示す強い強調 (null で外す)。 */
  setStrong(segments: readonly LinkSegment[] | null): void;
  /** 読み込んだ画像の寸法 (見本に出す)。 */
  localize(): void;
  hide(): void;
  dispose(): void;
};

let barSeq = 0;

/**
 * @param host マウスを受ける箱 (端末の画面の箱。xterm より先に受ける)
 */
export function createTerminalLinkLayer(
  host: HTMLElement,
  deps: TerminalLinkLayerDeps,
): TerminalLinkLayer {
  const layer = document.createElement("div");
  layer.className = "terminal-link-layer";
  layer.setAttribute("aria-hidden", "true");

  const bar = document.createElement("div");
  bar.className = "terminal-link-bar";
  bar.setAttribute("role", "toolbar");
  bar.id = `terminal-link-bar-${++barSeq}`;
  bar.hidden = true;
  const preview = document.createElement("div");
  preview.className = "terminal-link-preview";
  const previewImg = document.createElement("img");
  previewImg.alt = "";
  const previewCaption = document.createElement("div");
  previewCaption.className = "terminal-link-preview-caption";
  preview.append(previewImg, previewCaption);
  const actions = document.createElement("div");
  actions.className = "terminal-link-actions";
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "terminal-link-action";
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "terminal-link-action";
  actions.append(openButton, copyButton);
  bar.append(preview, actions);

  let hovered: ScreenLink | null = null;
  let strong: readonly LinkSegment[] | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  const sizes = new Map<string, { width: number; height: number }>();

  function screenEl(): HTMLElement | null {
    return deps.term()?.element?.querySelector(".xterm-screen") ?? null;
  }

  function cell(): { w: number; h: number } | null {
    const term = deps.term();
    const screen = screenEl();
    if (!term || !screen || term.cols <= 0 || term.rows <= 0) return null;
    return {
      w: screen.clientWidth / term.cols,
      h: screen.clientHeight / term.rows,
    };
  }

  function segmentEl(
    segment: LinkSegment,
    className: string,
    top: number,
  ): HTMLElement {
    const el = document.createElement("div");
    el.className = className;
    el.style.setProperty("--link-row", String(segment.y - top));
    el.style.setProperty("--link-col", String(segment.x0));
    el.style.setProperty("--link-cols", String(segment.x1 - segment.x0 + 1));
    return el;
  }

  function render(): void {
    const term = deps.term();
    const screen = screenEl();
    const size = cell();
    if (!term || !screen || !size) {
      layer.replaceChildren();
      return;
    }
    if (layer.parentElement !== screen) screen.append(layer);
    layer.style.setProperty("--link-cell-w", `${size.w}px`);
    layer.style.setProperty("--link-cell-h", `${size.h}px`);
    const top = term.buffer.active.viewportY;
    const visible = (segment: LinkSegment) =>
      segment.y >= top && segment.y < top + term.rows;
    const parts: HTMLElement[] = [];
    // 常に薄い印は画像のパスだけ。
    for (const link of deps.links()) {
      if (link.kind !== "image") continue;
      for (const segment of link.segments.filter(visible))
        parts.push(segmentEl(segment, "terminal-link-mark", top));
    }
    const current = hovered
      ? deps.links().find((link) => link.key === hovered?.key)
      : null;
    for (const segment of [
      ...(current?.segments ?? []),
      ...(strong ?? []),
    ].filter(visible))
      parts.push(segmentEl(segment, "terminal-link-hover", top));
    layer.replaceChildren(...parts);
    // 帯を出している間に文字列が消えた (流れた・書き換わった) ら帯も消す。
    if (hovered && !current) setHovered(null);
  }

  /** マウスの位置の桁と行 (バッファの行)。画面の外なら null。 */
  function cellAt(event: MouseEvent): { x: number; y: number } | null {
    const term = deps.term();
    const screen = screenEl();
    const size = cell();
    if (!term || !screen || !size) return null;
    const box = screen.getBoundingClientRect();
    const x = Math.floor((event.clientX - box.left) / size.w);
    const row = Math.floor((event.clientY - box.top) / size.h);
    if (x < 0 || row < 0 || x >= term.cols || row >= term.rows) return null;
    return { x, y: term.buffer.active.viewportY + row };
  }

  function hitTest(event: MouseEvent): ScreenLink | null {
    const at = cellAt(event);
    return at ? linkAt(deps.links(), at.x, at.y) : null;
  }

  function cancelHide(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
  }

  function scheduleHide(): void {
    cancelHide();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      setHovered(null);
    }, LINK_BAR_HIDE_MS);
  }

  function setHovered(link: ScreenLink | null): void {
    const changed = link?.key !== hovered?.key;
    hovered = link;
    if (!changed) return;
    host.dataset.linkHover = link ? "true" : "false";
    deps.onHover(link);
    render();
    if (link) showBar(link);
    else bar.hidden = true;
  }

  function linkBox(link: ScreenLink): Box | null {
    const term = deps.term();
    const screen = screenEl();
    const size = cell();
    if (!term || !screen || !size || link.segments.length === 0) return null;
    const box = screen.getBoundingClientRect();
    const top = term.buffer.active.viewportY;
    const first = link.segments[0];
    const last = link.segments[link.segments.length - 1];
    if (!first || !last) return null;
    return {
      left: box.left + first.x0 * size.w,
      top: box.top + (first.y - top) * size.h,
      width: Math.max(1, (first.x1 - first.x0 + 1) * size.w),
      height: (last.y - first.y + 1) * size.h,
    };
  }

  function fillBar(link: ScreenLink): void {
    const text = deps.getText();
    openButton.innerHTML = iconSvg(
      "terminal-link-action-icon",
      OPEN_EXTERNAL_16_PATH,
    );
    openButton.append(text.linkOpen);
    copyButton.innerHTML = iconSvg("terminal-link-action-icon", COPY_16_PATHS);
    copyButton.append(text.linkCopy);
    delete copyButton.dataset.copied;
    bar.setAttribute("aria-label", link.text);
    preview.hidden = !link.image;
    if (link.image) {
      if (previewImg.getAttribute("src") !== link.image.url) {
        previewImg.src = link.image.url;
      }
      const size = sizes.get(link.image.url);
      previewCaption.textContent = size
        ? `${link.image.name} · ${text.imageSize(size.width, size.height)}`
        : link.image.name;
    }
  }

  function showBar(link: ScreenLink): void {
    const anchor = linkBox(link);
    const screen = screenEl();
    if (!anchor || !screen) return;
    if (!bar.isConnected) document.body.append(bar);
    fillBar(link);
    bar.hidden = false;
    bar.style.left = "0px";
    bar.style.top = "0px";
    const size = bar.getBoundingClientRect();
    const place = placeLinkBar(anchor, size, host.getBoundingClientRect());
    bar.style.left = `${place.left}px`;
    bar.style.top = `${place.top}px`;
  }

  previewImg.addEventListener("load", () => {
    const url = previewImg.getAttribute("src");
    if (!url) return;
    sizes.set(url, {
      width: previewImg.naturalWidth,
      height: previewImg.naturalHeight,
    });
    if (hovered?.image?.url === url) {
      fillBar(hovered);
      showBar(hovered);
    }
  });

  function modeOf(event: MouseEvent): ShelfOpenMode {
    return event.altKey
      ? "overlay"
      : event.metaKey || event.ctrlKey
        ? "kept-tab"
        : "tab";
  }

  // xterm より先に受ける (捕捉フェーズ)。xterm は mousedown から選択と
  // tmux へのマウスの報告を始める。
  const onMouseMove = (event: MouseEvent) => {
    const link = hitTest(event);
    if (link) {
      cancelHide();
      if (link.key !== hovered?.key) setHovered(link);
    } else if (hovered && !hideTimer) {
      scheduleHide();
    }
  };
  const onMouseLeave = () => {
    if (hovered) scheduleHide();
  };
  // ⌘/Ctrl を押しながらのリンクの押下は tmux に渡さない (マウスの報告が
  // オンのときも必ずこちらで開く)。
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || event.shiftKey) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    if (!hitTest(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const onMouseUp = onMouseDown;
  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.shiftKey) return;
    // 文字を選んだ後の押下は開かない (選択のドラッグの終わり)。
    if (!(event.metaKey || event.ctrlKey) && deps.term()?.hasSelection())
      return;
    const link = hitTest(event);
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    deps.open(link, modeOf(event));
  };
  host.addEventListener("mousemove", onMouseMove, true);
  host.addEventListener("mouseleave", onMouseLeave);
  host.addEventListener("mousedown", onMouseDown, true);
  host.addEventListener("mouseup", onMouseUp, true);
  host.addEventListener("click", onClick, true);

  bar.addEventListener("mouseenter", cancelHide);
  bar.addEventListener("mouseleave", scheduleHide);
  openButton.addEventListener("click", (event) => {
    if (!hovered) return;
    deps.open(hovered, event.metaKey || event.ctrlKey ? "kept-tab" : "tab");
  });
  copyButton.addEventListener("click", () => {
    if (!hovered) return;
    const text = deps.getText();
    const value = deps.copyValue(hovered);
    navigator.clipboard.writeText(value).then(
      () => {
        // 形は変えず、印と文言だけ替える (押した後にボタンの箱を動かさない)。
        copyButton.innerHTML = iconSvg(
          "terminal-link-action-icon",
          CHECK_16_PATHS,
        );
        copyButton.append(text.linkCopied);
        copyButton.dataset.copied = "true";
        if (copiedTimer) clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
          copiedTimer = null;
          if (hovered) fillBar(hovered);
        }, COPIED_MS);
      },
      (error: unknown) => {
        console.error("[code-viewer] terminal link copy failed", error);
        deps.onStatus(`${text.linkCopyFailed}\n${formatErrorDetail(error)}`);
      },
    );
  });

  return {
    render,
    setStrong(segments) {
      strong = segments;
      render();
    },
    localize() {
      if (hovered && !bar.hidden) fillBar(hovered);
    },
    hide() {
      cancelHide();
      setHovered(null);
    },
    dispose() {
      cancelHide();
      if (copiedTimer) clearTimeout(copiedTimer);
      host.removeEventListener("mousemove", onMouseMove, true);
      host.removeEventListener("mouseleave", onMouseLeave);
      host.removeEventListener("mousedown", onMouseDown, true);
      host.removeEventListener("mouseup", onMouseUp, true);
      host.removeEventListener("click", onClick, true);
      layer.remove();
      bar.remove();
    },
  };
}
