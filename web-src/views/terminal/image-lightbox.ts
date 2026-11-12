// 端末で見つけた画像を大きく開くモーダル。
//
// 棚のサムネイルは小さいので、中身を読むには拡大が要る。
// 拡大縮小とドラッグ移動は core/diagram-viewport の使い回し (DB の ER 図・
// mermaid プレビューと同じ操作系)。ここが持つのは、覆いの開け閉めと
// 取り回しだけ。
//
// 同時に 1 枚しか開かない。開いている間に別の画像を開こうとしたら、前のを
// 閉じてから開く。

import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import { createDiagramViewport } from "../../core/diagram-viewport";
import { formatErrorDetail } from "../../core/error-detail";
import { filePathClipboardText } from "../../core/file-path-copy";
import {
  CHECK_16_PATHS,
  CHEVRON_LEFT_16_PATH,
  CHEVRON_RIGHT_16_PATH,
  COPY_16_PATHS,
  X_16_PATH,
} from "../../core/icons";
import { iconTemplate } from "../ui/icon";
import { detachedElement, renderOwned } from "../ui/renderer";
import type { TerminalText } from "./i18n";

const OVERLAY_CLASS = "terminal-lightbox";

/** コピーできた印 (チェック) を出しておく時間。 */
const COPIED_MARK_MS = 1200;

/**
 * いま開いているものを閉じる手続き。
 *
 * DOM から要素を消すだけでは足りない (Esc の受け口が残る) ので、閉じ方その
 * ものを 1 つだけ持っておく。
 */
let closeCurrent: (() => void) | null = null;

export type LightboxImage = {
  /** 取りにいく URL。 */
  url: string;
  /** 表示に使う名前。 */
  name: string;
  /**
   * 実体のパス。見出しに出し、コピーできる。無い画像 (ヘルプの画面のキャプチャ)
   * は見出しに名前を出し、並びのどれにも無ければコピーのボタンを置かない。
   */
  path?: string;
};

/**
 * 並びごと開くとき。棚の並び (新しい順) をそのまま渡し、index から見せる。
 * ←→ とボタンで前後に移れる。
 */
export type LightboxGallery = {
  images: readonly LightboxImage[];
  index: number;
};

export type ImageLightboxProps = {
  text: TerminalText;
  image: LightboxImage;
  /** 前後に移れるか (1 枚しか無いときも場所は取っておく)。 */
  canMove: boolean;
  /** パスのコピーのボタンを置くか (並びのどれにもパスがあるとき)。 */
  canCopy: boolean;
  copied: boolean;
  zoom: string;
  hint: string;
  /** 拡大縮小とドラッグの箱 (core/diagram-viewport)。 */
  viewport: HTMLElement;
  closeRef: Ref<HTMLButtonElement>;
  onPrevious: () => void;
  onNext: () => void;
  onCopy: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomIn: () => void;
  onClose: () => void;
  onBackdrop: (event: MouseEvent) => void;
};

export type ImageLightboxView = {
  overlay: (props: ImageLightboxProps) => unknown;
  /** 拡大縮小の箱の中の絵。 */
  picture: (props: { url: string; name: string }) => unknown;
};

// ボタンを押しても、覆いの背景を押したことにしない。
const pressed = (onClick: () => void) => (event: Event) => {
  event.stopPropagation();
  onClick();
};

function lightboxButton(label: unknown, title: string, onClick: () => void) {
  return html`<button
    type="button"
    class="terminal-font-btn"
    title=${title}
    aria-label=${title}
    @click=${pressed(onClick)}
  >${label}</button>`;
}

const lightboxIcon = (paths: string | readonly string[]) =>
  iconTemplate(paths, "terminal-lightbox-icon");

export const DEFAULT_VIEW: ImageLightboxView = {
  overlay: (p) => {
    const t = p.text;
    const path = p.image.path ?? p.image.name;
    return html`<div
      class=${OVERLAY_CLASS}
      role="dialog"
      aria-modal="true"
      aria-label=${p.image.name}
      @mousedown=${p.onBackdrop}
    ><div class="terminal-lightbox-bar"><span
          class="terminal-lightbox-path"
          title=${path}
          >${path}</span
        ><div class="terminal-lightbox-nav"><button
            type="button"
            class="terminal-font-btn"
            title=${t.previousImage}
            aria-label=${t.previousImage}
            ?disabled=${!p.canMove}
            @click=${pressed(p.onPrevious)}
          >${lightboxIcon(CHEVRON_LEFT_16_PATH)}</button><button
            type="button"
            class="terminal-font-btn"
            title=${t.nextImage}
            aria-label=${t.nextImage}
            ?disabled=${!p.canMove}
            @click=${pressed(p.onNext)}
          >${lightboxIcon(CHEVRON_RIGHT_16_PATH)}</button>${
            p.canCopy
              ? html`<button
                  type="button"
                  class="terminal-font-btn terminal-lightbox-copy"
                  title=${t.copyImagePath}
                  aria-label=${t.copyImagePath}
                  data-copied=${p.copied ? "true" : nothing}
                  @click=${pressed(p.onCopy)}
                >${
                  // 形は変えず、印だけ替える (押した後にボタンの箱を動かさない)。
                  lightboxIcon(p.copied ? CHECK_16_PATHS : COPY_16_PATHS)
                }</button>`
              : nothing
          }</div
        ><div class="terminal-lightbox-actions">${lightboxButton(
          "−",
          t.zoomOut,
          p.onZoomOut,
        )}${lightboxButton(p.zoom, t.zoomReset, p.onZoomReset)}${lightboxButton(
          "＋",
          t.zoomIn,
          p.onZoomIn,
        )}</div
        ><button
          type="button"
          class="terminal-font-btn terminal-lightbox-close"
          title=${t.closeImage}
          aria-label=${t.closeImage}
          ${ref(p.closeRef)}
          @click=${pressed(p.onClose)}
        >${lightboxIcon(X_16_PATH)}<span>${t.closeImage}</span><kbd>Esc</kbd></button></div
      >${p.viewport}<p class="terminal-lightbox-hint">${p.hint}</p></div>`;
  },
  picture: ({ url, name }) =>
    html`<img draggable="false" src=${url} alt=${name} />`,
};

/**
 * 画像を覆いの上に大きく出す。1 枚でも、棚の並びごとでも開ける。
 * 閉じるは拡大縮小の塊から離して右端に置き、絵・文字・キーで閉じるものだと
 * 分かるようにする (「× 」だけが − 100% ＋ と同じ形で並んでいて、閉じ方が
 * 分からなかった)。
 *
 * @returns 閉じる関数。Esc・背景・閉じるボタンでも閉じる。
 */
export function openImageLightbox(
  target: LightboxImage | LightboxGallery,
  text: TerminalText,
  view: ImageLightboxView = DEFAULT_VIEW,
): () => void {
  closeCurrent?.();

  const images: readonly LightboxImage[] =
    "images" in target ? target.images : [target];
  if (images.length === 0) {
    throw new Error("openImageLightbox needs at least one image");
  }
  let index =
    "images" in target
      ? Math.min(Math.max(Math.trunc(target.index) || 0, 0), images.length - 1)
      : 0;
  const current = () => images[index] as LightboxImage;
  let zoom = "100%";
  let copied = false;
  let hint = text.imageHint;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  const closeRef = createRef<HTMLButtonElement>();

  // 描き方の箱は覆いを作った後に決まる (倍率は viewport が作る途中で知らせる)。
  let draw = (): void => undefined;
  const viewport = createDiagramViewport({
    containerClassName: "terminal-lightbox-view",
    contentClassName: "terminal-lightbox-stage",
    onScaleChange: (scale) => {
      zoom = `${Math.round(scale * 100)}%`;
      draw();
    },
  });

  const close = () => {
    if (closeCurrent === close) closeCurrent = null;
    document.removeEventListener("keydown", onKeyDown, true);
    if (copiedTimer) clearTimeout(copiedTimer);
    overlay.element.remove();
    viewport.dispose();
    previouslyFocused?.focus?.();
  };

  const show = (next: number) => {
    index = (next + images.length) % images.length;
    const image = current();
    renderOwned(
      viewport.content,
      view.picture({ url: image.url, name: image.name }),
    );
    draw();
    viewport.reset();
  };

  const copyPath = () => {
    // コピーのボタンは、並びのどれにもパスがあるときだけ置く。
    const imagePath = current().path;
    if (imagePath === undefined)
      throw new Error(
        `openImageLightbox: the image "${current().name}" has no path to copy`,
      );
    navigator.clipboard.writeText(filePathClipboardText(imagePath)).then(
      () => {
        copied = true;
        hint = text.imagePathCopied;
        draw();
        if (copiedTimer) clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
          copiedTimer = null;
          copied = false;
          hint = text.imageHint;
          draw();
        }, COPIED_MARK_MS);
      },
      (error: unknown) => {
        console.error("[code-viewer] image path copy failed", error);
        hint = `${text.copyImagePathFailed} ${formatErrorDetail(error)}`;
        draw();
      },
    );
  };

  const overlay = detachedElement(() =>
    view.overlay({
      text,
      image: current(),
      canMove: images.length >= 2,
      canCopy: images.every((image) => image.path !== undefined),
      copied,
      zoom,
      hint,
      viewport: viewport.container,
      closeRef,
      onPrevious: () => show(index - 1),
      onNext: () => show(index + 1),
      onCopy: copyPath,
      onZoomOut: () => viewport.zoomOut(),
      onZoomReset: () => viewport.reset(),
      onZoomIn: () => viewport.zoomIn(),
      onClose: close,
      // 背景を押したら閉じる。画像やボタンの上は素通ししない。
      onBackdrop: (event) => {
        if (
          event.target === event.currentTarget ||
          event.target === viewport.container
        )
          close();
      },
    }),
  );
  draw = overlay.draw;
  show(index);

  // Esc と ←→ は捕捉フェーズで受ける。ドロワー側の Esc (パネルを閉じる) より
  // 先に止めないと、画像だけ閉じたいのにパネルごと畳まれる。←→ も、覆いの
  // 下のターミナルやページへ流さない。
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    if (images.length < 2) return;
    show(event.key === "ArrowLeft" ? index - 1 : index + 1);
  };
  document.addEventListener("keydown", onKeyDown, true);

  const previouslyFocused = document.activeElement as HTMLElement | null;
  document.body.appendChild(overlay.element);
  closeRef.value?.focus();
  closeCurrent = close;
  return close;
}
