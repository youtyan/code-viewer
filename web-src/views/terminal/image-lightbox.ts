// 端末で見つけた画像を大きく開くモーダル。
//
// 棚のサムネイルは小さいので、中身を読むには拡大が要る。
// 拡大縮小とドラッグ移動は core/diagram-viewport の使い回し (DB の ER 図・
// mermaid プレビューと同じ操作系)。ここが持つのは、覆いの開け閉めと
// 取り回しだけ。
//
// 同時に 1 枚しか開かない。開いている間に別の画像を開こうとしたら、前のを
// 閉じてから開く。

import { createDiagramViewport } from "../../core/diagram-viewport";
import { formatErrorDetail } from "../../core/error-detail";
import { filePathClipboardText } from "../../core/file-path-copy";
import {
  CHECK_16_PATHS,
  CHEVRON_LEFT_16_PATH,
  CHEVRON_RIGHT_16_PATH,
  COPY_16_PATHS,
  iconSvg,
  X_16_PATH,
} from "../../core/icons";
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

/**
 * 画像を覆いの上に大きく出す。1 枚でも、棚の並びごとでも開ける。
 *
 * @returns 閉じる関数。Esc・背景・閉じるボタンでも閉じる。
 */
export function openImageLightbox(
  target: LightboxImage | LightboxGallery,
  text: TerminalText,
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

  const overlay = document.createElement("div");
  overlay.className = OVERLAY_CLASS;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  let zoomReset: HTMLButtonElement | null = null;
  const viewport = createDiagramViewport({
    containerClassName: "terminal-lightbox-view",
    contentClassName: "terminal-lightbox-stage",
    onScaleChange: (scale) => {
      if (zoomReset) zoomReset.textContent = `${Math.round(scale * 100)}%`;
    },
  });
  const picture = document.createElement("img");
  picture.draggable = false;
  viewport.content.appendChild(picture);

  const bar = document.createElement("div");
  bar.className = "terminal-lightbox-bar";
  const title = document.createElement("span");
  title.className = "terminal-lightbox-path";
  const nav = document.createElement("div");
  nav.className = "terminal-lightbox-nav";
  const actions = document.createElement("div");
  actions.className = "terminal-lightbox-actions";

  const hint = document.createElement("p");
  hint.className = "terminal-lightbox-hint";
  hint.textContent = text.imageHint;

  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  const close = () => {
    if (closeCurrent === close) closeCurrent = null;
    document.removeEventListener("keydown", onKeyDown, true);
    if (copiedTimer) clearTimeout(copiedTimer);
    overlay.remove();
    viewport.dispose();
    previouslyFocused?.focus?.();
  };

  const button = (label: string, title: string, onClick: () => void) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "terminal-font-btn";
    el.textContent = label;
    el.title = title;
    el.setAttribute("aria-label", title);
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return el;
  };
  const iconButton = (
    paths: string | string[],
    title: string,
    onClick: () => void,
  ) => {
    const el = button("", title, onClick);
    el.innerHTML = iconSvg("terminal-lightbox-icon", paths);
    return el;
  };

  const show = (next: number) => {
    index = (next + images.length) % images.length;
    const image = current();
    picture.src = image.url;
    picture.alt = image.name;
    title.textContent = image.path ?? image.name;
    title.title = image.path ?? image.name;
    overlay.setAttribute("aria-label", image.name);
    viewport.reset();
  };

  const previous = iconButton(CHEVRON_LEFT_16_PATH, text.previousImage, () =>
    show(index - 1),
  );
  const next = iconButton(CHEVRON_RIGHT_16_PATH, text.nextImage, () =>
    show(index + 1),
  );
  // 1 枚しか無いときも場所は取っておく (押す場所が動かないように)。
  previous.disabled = images.length < 2;
  next.disabled = images.length < 2;

  const copy = iconButton(COPY_16_PATHS, text.copyImagePath, () => {
    // コピーのボタンは、並びのどれにもパスがあるときだけ置く (下)。
    const imagePath = current().path;
    if (imagePath === undefined)
      throw new Error(
        `openImageLightbox: the image "${current().name}" has no path to copy`,
      );
    const path = filePathClipboardText(imagePath);
    navigator.clipboard.writeText(path).then(
      () => {
        // 形は変えず、印だけ替える (押した後にボタンの箱を動かさない)。
        copy.innerHTML = iconSvg("terminal-lightbox-icon", CHECK_16_PATHS);
        copy.dataset.copied = "true";
        hint.textContent = text.imagePathCopied;
        if (copiedTimer) clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
          copiedTimer = null;
          copy.innerHTML = iconSvg("terminal-lightbox-icon", COPY_16_PATHS);
          delete copy.dataset.copied;
          hint.textContent = text.imageHint;
        }, COPIED_MARK_MS);
      },
      (error: unknown) => {
        console.error("[code-viewer] image path copy failed", error);
        hint.textContent = `${text.copyImagePathFailed} ${formatErrorDetail(error)}`;
      },
    );
  });
  copy.classList.add("terminal-lightbox-copy");
  nav.append(previous, next);
  if (images.every((image) => image.path !== undefined)) nav.append(copy);

  zoomReset = button("100%", text.zoomReset, () => viewport.reset());
  // 閉じるは拡大縮小の塊から離して右端に置き、絵・文字・キーで閉じるものだと
  // 分かるようにする (「× 」だけが − 100% ＋ と同じ形で並んでいて、閉じ方が
  // 分からなかった)。
  const closeButton = iconButton(X_16_PATH, text.closeImage, close);
  closeButton.classList.add("terminal-lightbox-close");
  const closeLabel = document.createElement("span");
  closeLabel.textContent = text.closeImage;
  const closeKey = document.createElement("kbd");
  closeKey.textContent = "Esc";
  closeButton.append(closeLabel, closeKey);
  actions.append(
    button("−", text.zoomOut, () => viewport.zoomOut()),
    zoomReset,
    button("＋", text.zoomIn, () => viewport.zoomIn()),
  );
  bar.append(title, nav, actions, closeButton);

  overlay.append(bar, viewport.container, hint);
  show(index);

  // 背景を押したら閉じる。画像やボタンの上は素通ししない。
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay || event.target === viewport.container)
      close();
  });

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
  document.body.appendChild(overlay);
  closeButton.focus();
  closeCurrent = close;
  return close;
}
