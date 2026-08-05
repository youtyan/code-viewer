// 端末で見つけた画像を大きく開くモーダル。
//
// 帯のサムネイルも画面に重ねたぶんも小さいので、中身を読むには拡大が要る。
// 拡大縮小とドラッグ移動は core/diagram-viewport の使い回し (DB の ER 図・
// mermaid プレビューと同じ操作系)。ここが持つのは、覆いの開け閉めと
// 取り回しだけ。
//
// 同時に 1 枚しか開かない。開いている間に別の画像を開こうとしたら、前のを
// 閉じてから開く。

import { createDiagramViewport } from "../../core/diagram-viewport";
import type { TerminalText } from "./i18n";

const OVERLAY_CLASS = "terminal-lightbox";

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
  /** 実体のパス。見出しに出す。 */
  path: string;
};

/**
 * 画像を 1 枚、覆いの上に大きく出す。
 *
 * @returns 閉じる関数。Esc・背景・閉じるボタンでも閉じる。
 */
export function openImageLightbox(
  image: LightboxImage,
  text: TerminalText,
): () => void {
  closeCurrent?.();

  const overlay = document.createElement("div");
  overlay.className = OVERLAY_CLASS;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", image.name);

  let zoomReset: HTMLButtonElement | null = null;
  const viewport = createDiagramViewport({
    containerClassName: "terminal-lightbox-view",
    contentClassName: "terminal-lightbox-stage",
    onScaleChange: (scale) => {
      if (zoomReset) zoomReset.textContent = `${Math.round(scale * 100)}%`;
    },
  });
  const picture = document.createElement("img");
  picture.src = image.url;
  picture.alt = image.name;
  picture.draggable = false;
  viewport.content.appendChild(picture);

  const bar = document.createElement("div");
  bar.className = "terminal-lightbox-bar";
  const title = document.createElement("span");
  title.className = "terminal-lightbox-path";
  title.textContent = image.path;
  const actions = document.createElement("div");
  actions.className = "terminal-lightbox-actions";

  const close = () => {
    if (closeCurrent === close) closeCurrent = null;
    document.removeEventListener("keydown", onKeyDown, true);
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

  zoomReset = button("100%", text.zoomReset, () => viewport.reset());
  actions.append(
    button("−", text.zoomOut, () => viewport.zoomOut()),
    zoomReset,
    button("＋", text.zoomIn, () => viewport.zoomIn()),
    button("×", text.closeImage, close),
  );
  bar.append(title, actions);

  const hint = document.createElement("p");
  hint.className = "terminal-lightbox-hint";
  hint.textContent = text.imageHint;

  overlay.append(bar, viewport.container, hint);

  // 背景を押したら閉じる。画像やボタンの上は素通ししない。
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay || event.target === viewport.container)
      close();
  });

  // Esc は捕捉フェーズで受ける。ドロワー側の Esc (パネルを閉じる) より先に
  // 止めないと、画像だけ閉じたいのにパネルごと畳まれる。
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  document.addEventListener("keydown", onKeyDown, true);

  const previouslyFocused = document.activeElement as HTMLElement | null;
  document.body.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>("button:last-of-type")?.focus();
  closeCurrent = close;
  return close;
}
