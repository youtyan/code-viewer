import { html, nothing } from "lit/html.js";
import { clampDiagramScale, stepDiagramScale } from "../core/diagram-viewport";
import { formatErrorDetail } from "../core/error-detail";
import {
  CHECK_16_PATHS,
  CHEVRON_LEFT_16_PATH,
  CHEVRON_RIGHT_16_PATH,
  COPY_16_PATHS,
  FOLDER_ICON_PATHS,
  X_16_PATH,
} from "../core/icons";
import type { TerminalImageRef } from "../core/terminal-images";
import {
  type ImageTabLanguage,
  type ImageTabText,
  imageTabText,
} from "./image-tab-i18n";
import {
  createMediaElement,
  type MediaElement,
  mediaErrorDetail,
  onMediaReady,
} from "./terminal/media-element";
import { iconTemplate } from "./ui/icon";
import { detachedElement } from "./ui/renderer";

const NARROW_WIDTH = 720;
const COPY_FEEDBACK_MS = 1200;

type ScaleMode = "fit" | "actual" | "custom";
type StatusKind = "loading" | "info" | "error";
type StatusMessage = (text: ImageTabText) => string;

export type ImageTabDeps = {
  image: TerminalImageRef;
  /** URL の経路は組み込む側が決める。 */
  imageUrlFor(image: TerminalImageRef): string;
  copyPath(path: string): Promise<void>;
  openPath(path: string): Promise<void>;
  /** この画像のタブを閉じる (タブ列は組み込む側が持つ)。閉じるボタンと Esc。 */
  close(): void;
  language: ImageTabLanguage;
  /** 前へ・次へ回す並び。無ければ移動ボタンは無効。 */
  images?: readonly TerminalImageRef[];
  /** 出す画像が変わった (開いた・前後へ送った)。棚の印を合わせてもらう。 */
  onShow?(image: TerminalImageRef): void;
};

export type ImageTabHandle = {
  el: HTMLElement;
  setImage(image: TerminalImageRef, images?: readonly TerminalImageRef[]): void;
  setLanguage(language: ImageTabLanguage): void;
  focus(): void;
  dispose(): void;
};

function imageMatches(
  left: TerminalImageRef,
  right: TerminalImageRef,
): boolean {
  return (
    left.path === right.path &&
    left.mtimeMs === right.mtimeMs &&
    left.bytes === right.bytes
  );
}

type ImageTabButtonProps = {
  label: string;
  disabled: boolean;
  onClick(): void;
};

/** 画像のタブ (createImageTabView) の中。 */
export type ImageTabProps = {
  label: string;
  /** 狭い幅か (ResizeObserver が測るまでは無し)。 */
  narrow: boolean | null;
  zoom: {
    value: string;
    out: ImageTabButtonProps;
    in: ImageTabButtonProps;
  };
  actual: ImageTabButtonProps & { pressed: boolean };
  fit: ImageTabButtonProps & { pressed: boolean };
  previous: ImageTabButtonProps;
  next: ImageTabButtonProps;
  path: string;
  dimensions: string;
  copy: ImageTabButtonProps & { copied: boolean };
  open: ImageTabButtonProps;
  close: { label: string; onClick(): void };
  /** 画像・動画の要素 (media-element.ts が作る)。読めないときは null。 */
  picture: HTMLElement | null;
  status: { kind: StatusKind; text: string } | null;
  onKeyDown(event: KeyboardEvent): void;
};

export type ImageTabView = (props: ImageTabProps) => unknown;

const iconButton = (
  action: string,
  props: ImageTabButtonProps,
  icon: string | string[],
  extra = "",
) => html`<button
  type="button"
  class=${`image-tab-button${extra}`}
  data-action=${action}
  title=${props.label}
  aria-label=${props.label}
  ?disabled=${props.disabled}
  @click=${props.onClick}
>${iconTemplate(icon, "image-tab-icon")}</button>`;

export const DEFAULT_VIEW: ImageTabView = (props) => html`<section
  class="image-tab"
  tabindex="0"
  role="region"
  aria-label=${props.label}
  data-narrow=${props.narrow === null ? nothing : String(props.narrow)}
  @keydown=${props.onKeyDown}
><div class="image-tab-toolbar"><div class="image-tab-primary"><div
        class="image-tab-zoom"
      ><button
          type="button"
          class="image-tab-button"
          data-action="zoom-out"
          title=${props.zoom.out.label}
          aria-label=${props.zoom.out.label}
          ?disabled=${props.zoom.out.disabled}
          @click=${props.zoom.out.onClick}
        >−</button><output class="image-tab-scale">${props.zoom.value}</output><button
          type="button"
          class="image-tab-button"
          data-action="zoom-in"
          title=${props.zoom.in.label}
          aria-label=${props.zoom.in.label}
          ?disabled=${props.zoom.in.disabled}
          @click=${props.zoom.in.onClick}
        >+</button></div><div class="image-tab-modes">${(
          [
            ["actual", props.actual],
            ["fit", props.fit],
          ] as const
        ).map(
          ([action, mode]) => html`<button
          type="button"
          class="image-tab-button"
          data-action=${action}
          data-active=${String(mode.pressed)}
          aria-pressed=${String(mode.pressed)}
          title=${mode.label}
          ?disabled=${mode.disabled}
          @click=${mode.onClick}
        >${mode.label}</button>`,
        )}</div><div class="image-tab-navigation">${iconButton(
          "previous",
          props.previous,
          CHEVRON_LEFT_16_PATH,
          " icon-only",
        )}${iconButton("next", props.next, CHEVRON_RIGHT_16_PATH, " icon-only")}</div></div
    ><div class="image-tab-secondary"><div class="image-tab-meta"><span
          class="image-tab-path"
          title=${props.path}
        >${props.path}</span><span class="image-tab-dimensions"
          >${props.dimensions}</span
        ></div
      ><div class="image-tab-actions"><button
          type="button"
          class="image-tab-button"
          data-action="copy"
          data-copied=${String(props.copy.copied)}
          title=${props.copy.label}
          aria-label=${props.copy.label}
          ?disabled=${props.copy.disabled}
          @click=${props.copy.onClick}
        >${iconTemplate(
          props.copy.copied ? CHECK_16_PATHS : COPY_16_PATHS,
          "image-tab-icon",
        )}<span>${props.copy.label}</span></button><button
          type="button"
          class="image-tab-button"
          data-action="open"
          title=${props.open.label}
          aria-label=${props.open.label}
          ?disabled=${props.open.disabled}
          @click=${props.open.onClick}
        >${iconTemplate(FOLDER_ICON_PATHS.open, "image-tab-icon")}<span
            >${props.open.label}</span
          ></button
        ><button
          type="button"
          class="image-tab-button image-tab-close"
          data-action="close"
          title=${props.close.label}
          aria-label=${props.close.label}
          @click=${props.close.onClick}
        >${iconTemplate(X_16_PATH, "image-tab-icon")}<span>${props.close.label}</span><kbd
            >Esc</kbd
          ></button></div></div></div
  ><div class="image-tab-canvas"><div class="image-tab-stage">${props.picture ?? nothing}</div><pre
      class="image-tab-status"
      ?hidden=${!props.status}
      aria-live="polite"
      role=${props.status?.kind === "error" ? "alert" : "status"}
      data-kind=${props.status?.kind ?? nothing}
    >${props.status?.text ?? ""}</pre></div></section>`;

export function createImageTabView(
  deps: ImageTabDeps,
  view: ImageTabView = DEFAULT_VIEW,
): ImageTabHandle {
  let language = deps.language;
  let images: readonly TerminalImageRef[] = [];
  let index = 0;
  let picture: MediaElement | null = null;
  let naturalWidth = 0;
  let naturalHeight = 0;
  let scale = 1;
  let scaleMode: ScaleMode = "fit";
  /** 画面に出ている倍率 (測った幅から)。読み込む前は前の画像のまま。 */
  let scaleText = "100%";
  let dimensions = "—×—";
  /** 寸法が分かるまで、拡大縮小のボタンは押せない。 */
  let sized = false;
  let narrow: boolean | null = null;
  let copied = false;
  let copying = false;
  let opening = false;
  let statusKind: StatusKind | null = null;
  let statusMessage: StatusMessage | null = null;
  let loadVersion = 0;
  let disposed = false;
  let resizeObserver: ResizeObserver | null = null;
  let scaleFrame: number | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  function props(): ImageTabProps {
    const text = imageTabText(language);
    const single = images.length < 2;
    return {
      label: images.length > 0 ? text.imageView(current().name) : "",
      narrow,
      zoom: {
        value: scaleText,
        out: {
          label: text.zoomOut,
          disabled: !sized,
          onClick: () => applyCustomScale(-1),
        },
        in: {
          label: text.zoomIn,
          disabled: !sized,
          onClick: () => applyCustomScale(1),
        },
      },
      actual: {
        label: text.actualSize,
        disabled: !sized,
        pressed: scaleMode === "actual",
        onClick: () => applyScale(1, "actual"),
      },
      fit: {
        label: text.fitWidth,
        disabled: !sized,
        pressed: scaleMode === "fit",
        onClick: () => applyFit(),
      },
      previous: {
        label: text.previousImage,
        disabled: single,
        onClick: () => navigate(-1),
      },
      next: {
        label: text.nextImage,
        disabled: single,
        onClick: () => navigate(1),
      },
      path: images.length > 0 ? current().path : "",
      dimensions,
      copy: {
        label: text.copyPath,
        disabled: copying,
        copied,
        onClick: () => void copyCurrentPath(),
      },
      open: {
        label: text.openFolder,
        disabled: opening,
        onClick: () => void openCurrentPath(),
      },
      // 閉じる: 本文いっぱいに開くと、タブ列の小さな × しか閉じ方が無かった。
      // 「閉じる」「Esc」を添えて、ほかの操作から離して置く。
      close: { label: text.closeTab, onClick: () => deps.close() },
      picture,
      status:
        statusKind && statusMessage
          ? { kind: statusKind, text: statusMessage(text) }
          : null,
      onKeyDown,
    };
  }

  const tab = detachedElement(() => view(props()));
  const el = tab.element;
  const draw = () => {
    if (!disposed) tab.draw();
  };

  function stage(): HTMLElement | null {
    return el.querySelector<HTMLElement>(".image-tab-stage");
  }

  function canvas(): HTMLElement | null {
    return el.querySelector<HTMLElement>(".image-tab-canvas");
  }

  function current(): TerminalImageRef {
    const image = images[index];
    if (!image) throw new Error("image tab has no current image");
    return image;
  }

  function configureImages(
    image: TerminalImageRef,
    gallery?: readonly TerminalImageRef[],
  ): void {
    const nextImages = gallery && gallery.length > 0 ? [...gallery] : [image];
    const nextIndex = nextImages.findIndex((item) => imageMatches(item, image));
    if (nextIndex >= 0) {
      images = nextImages;
      index = nextIndex;
      return;
    }
    images = [image, ...nextImages];
    index = 0;
  }

  function setStatus(kind: StatusKind, message: StatusMessage): void {
    statusKind = kind;
    statusMessage = message;
    draw();
  }

  function clearStatus(): void {
    statusKind = null;
    statusMessage = null;
    draw();
  }

  function updateScaleValue(): void {
    if (!picture || naturalWidth <= 0) {
      scaleText = "—";
      draw();
      return;
    }
    const measuredWidth = picture.getBoundingClientRect().width;
    const renderedScale =
      Number.isFinite(measuredWidth) && measuredWidth > 0
        ? measuredWidth / naturalWidth
        : scale;
    scaleText = `${Math.round(renderedScale * 100)}%`;
    draw();
  }

  function scheduleScaleRead(): void {
    if (scaleFrame !== null || typeof requestAnimationFrame !== "function")
      return;
    scaleFrame = requestAnimationFrame(() => {
      scaleFrame = null;
      if (!disposed) updateScaleValue();
    });
  }

  function applyScale(next: number, mode: ScaleMode): void {
    if (!picture || naturalWidth <= 0 || naturalHeight <= 0) return;
    scale = clampDiagramScale(next);
    scaleMode = mode;
    // 寸法は画像・動画の要素そのものに当てる (外の部品が作った要素)。
    picture.style.width = `${naturalWidth * scale}px`;
    picture.style.height = `${naturalHeight * scale}px`;
    updateScaleValue();
    scheduleScaleRead();
  }

  function stageHorizontalPadding(): number {
    const box = stage();
    if (!box) return 0;
    const computed = getComputedStyle(box);
    const left = Number.parseFloat(computed.paddingLeft);
    const right = Number.parseFloat(computed.paddingRight);
    return (
      (Number.isFinite(left) ? left : 0) + (Number.isFinite(right) ? right : 0)
    );
  }

  function availableImageWidth(): number {
    const box = canvas();
    const measured = box
      ? box.getBoundingClientRect().width || box.clientWidth
      : 0;
    return Math.max(1, measured - stageHorizontalPadding());
  }

  function applyFit(): void {
    if (!picture || naturalWidth <= 0) return;
    applyScale(availableImageWidth() / naturalWidth, "fit");
  }

  function applyCustomScale(direction: -1 | 1): void {
    applyScale(stepDiagramScale(scale, direction), "custom");
  }

  function showCurrent(): void {
    const image = current();
    deps.onShow?.(image);
    const myVersion = ++loadVersion;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = null;
    copied = false;
    naturalWidth = 0;
    naturalHeight = 0;
    scale = 1;
    scaleMode = "fit";
    dimensions = "—×—";
    sized = false;
    statusKind = "loading";
    statusMessage = (text) => text.loading;

    let url: string;
    try {
      url = deps.imageUrlFor(image);
      if (!url) throw new Error("imageUrlFor returned an empty URL");
    } catch (error) {
      console.error("[code-viewer] image tab URL creation failed", error);
      picture = null;
      setStatus(
        "error",
        (text) =>
          `${text.imageLoadFailed}\n${text.pathLabel}: ${image.path}\n${formatErrorDetail(error)}`,
      );
      return;
    }

    // 動画は再生の操作つきの video (media-element.ts)。寸法と拡大縮小は画像と同じ。
    const nextPicture = createMediaElement({ ...image, url }, "player");
    nextPicture.draggable = false;
    onMediaReady(nextPicture, (size) => {
      if (myVersion !== loadVersion || picture !== nextPicture) return;
      naturalWidth = size.width;
      naturalHeight = size.height;
      if (naturalWidth <= 0 || naturalHeight <= 0) {
        nextPicture.hidden = true;
        setStatus(
          "error",
          (text) =>
            `${text.imageLoadFailed}\n${text.pathLabel}: ${image.path}\n${text.eventLabel}: invalid dimensions ${naturalWidth}×${naturalHeight}`,
        );
        return;
      }
      dimensions = `${naturalWidth}×${naturalHeight}`;
      sized = true;
      statusKind = null;
      statusMessage = null;
      clearStatus();
      applyFit();
    });
    nextPicture.addEventListener("error", (event) => {
      if (myVersion !== loadVersion || picture !== nextPicture) return;
      nextPicture.hidden = true;
      setStatus(
        "error",
        (text) =>
          `${text.imageLoadFailed}\n${text.pathLabel}: ${image.path}\n${text.eventLabel}: ${[event.type, mediaErrorDetail(nextPicture)].filter(Boolean).join(" · ")}`,
      );
    });
    picture = nextPicture;
    draw();
  }

  function navigate(direction: -1 | 1): void {
    if (images.length < 2) return;
    index = (index + direction + images.length) % images.length;
    // 動画の操作にフォーカスがあると、差し替えで動画ごと消えてフォーカスが
    // 外れ、続けて送れず Esc も効かなくなる。タブに残す。
    const focused = el.contains(document.activeElement);
    showCurrent();
    if (focused && !el.contains(document.activeElement))
      el.focus({ preventScroll: true });
  }

  async function copyCurrentPath(): Promise<void> {
    const image = current();
    const myVersion = loadVersion;
    copying = true;
    draw();
    try {
      await deps.copyPath(image.path);
      if (myVersion !== loadVersion) return;
      copied = true;
      setStatus("info", (text) => text.pathCopied);
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copiedTimer = null;
        copied = false;
        draw();
      }, COPY_FEEDBACK_MS);
    } catch (error) {
      console.error("[code-viewer] image tab path copy failed", error);
      setStatus(
        "error",
        (text) =>
          `${text.copyFailed}\n${text.pathLabel}: ${image.path}\n${formatErrorDetail(error)}`,
      );
    } finally {
      copying = false;
      draw();
    }
  }

  async function openCurrentPath(): Promise<void> {
    const image = current();
    opening = true;
    draw();
    try {
      await deps.openPath(image.path);
    } catch (error) {
      console.error("[code-viewer] image tab folder open failed", error);
      setStatus(
        "error",
        (text) =>
          `${text.openFailed}\n${text.pathLabel}: ${image.path}\n${formatErrorDetail(error)}`,
      );
    } finally {
      opening = false;
      draw();
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!el.contains(document.activeElement)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    let handled = true;
    switch (event.key) {
      case "+":
        applyCustomScale(1);
        break;
      case "-":
        applyCustomScale(-1);
        break;
      case "0":
        applyScale(1, "actual");
        break;
      case "1":
        applyFit();
        break;
      // 上下も前後 (縦に並ぶ棚から開いたとき、棚と同じ向きで送れる)。
      case "ArrowLeft":
      case "ArrowUp":
        navigate(-1);
        break;
      case "ArrowRight":
      case "ArrowDown":
        navigate(1);
        break;
      case "Escape":
        deps.close();
        break;
      default:
        handled = false;
    }
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  }

  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (width > 0 && narrow !== width < NARROW_WIDTH) {
        narrow = width < NARROW_WIDTH;
        draw();
      }
      if (scaleMode === "fit") applyFit();
    });
    resizeObserver.observe(el);
  }

  configureImages(deps.image, deps.images);
  showCurrent();

  return {
    el,
    setImage(image, gallery) {
      if (disposed) return;
      configureImages(image, gallery);
      showCurrent();
    },
    setLanguage(nextLanguage) {
      if (disposed) return;
      language = nextLanguage;
      draw();
    },
    focus() {
      if (!disposed) el.focus();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loadVersion += 1;
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (scaleFrame !== null && typeof cancelAnimationFrame === "function")
        cancelAnimationFrame(scaleFrame);
      scaleFrame = null;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = null;
    },
  };
}
