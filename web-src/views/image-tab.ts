import { clampDiagramScale, stepDiagramScale } from "../core/diagram-viewport";
import { formatErrorDetail } from "../core/error-detail";
import {
  CHECK_16_PATHS,
  CHEVRON_LEFT_16_PATH,
  CHEVRON_RIGHT_16_PATH,
  COPY_16_PATHS,
  FOLDER_ICON_PATHS,
  iconSvg,
  X_16_PATH,
} from "../core/icons";
import type { TerminalImageRef } from "../core/terminal-images";
import {
  type ImageTabLanguage,
  type ImageTabText,
  imageTabText,
} from "./image-tab-i18n";

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

export function createImageTabView(deps: ImageTabDeps): ImageTabHandle {
  const el = document.createElement("section");
  el.className = "image-tab";
  el.tabIndex = 0;
  el.setAttribute("role", "region");

  const toolbar = document.createElement("div");
  toolbar.className = "image-tab-toolbar";

  const primary = document.createElement("div");
  primary.className = "image-tab-primary";
  const secondary = document.createElement("div");
  secondary.className = "image-tab-secondary";

  const zoom = document.createElement("div");
  zoom.className = "image-tab-zoom";
  const modes = document.createElement("div");
  modes.className = "image-tab-modes";
  const navigation = document.createElement("div");
  navigation.className = "image-tab-navigation";
  const meta = document.createElement("div");
  meta.className = "image-tab-meta";
  const actions = document.createElement("div");
  actions.className = "image-tab-actions";

  const button = (
    action: string,
    onClick: () => void,
    icon?: string | string[],
  ): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "image-tab-button";
    control.dataset.action = action;
    if (icon) {
      control.innerHTML = iconSvg("image-tab-icon", icon);
      control.classList.add("icon-only");
    }
    control.addEventListener("click", onClick);
    return control;
  };

  const zoomOut = button("zoom-out", () => applyCustomScale(-1));
  zoomOut.textContent = "−";
  const scaleValue = document.createElement("output");
  scaleValue.className = "image-tab-scale";
  scaleValue.textContent = "100%";
  const zoomIn = button("zoom-in", () => applyCustomScale(1));
  zoomIn.textContent = "+";
  zoom.append(zoomOut, scaleValue, zoomIn);

  const actual = button("actual", () => applyScale(1, "actual"));
  const fit = button("fit", () => applyFit());
  modes.append(actual, fit);

  const previous = button("previous", () => navigate(-1), CHEVRON_LEFT_16_PATH);
  const next = button("next", () => navigate(1), CHEVRON_RIGHT_16_PATH);
  navigation.append(previous, next);

  const path = document.createElement("span");
  path.className = "image-tab-path";
  const dimensions = document.createElement("span");
  dimensions.className = "image-tab-dimensions";
  dimensions.textContent = "—×—";
  meta.append(path, dimensions);

  const copy = button("copy", () => void copyCurrentPath(), COPY_16_PATHS);
  copy.classList.remove("icon-only");
  const copyLabel = document.createElement("span");
  copy.append(copyLabel);
  const open = button(
    "open",
    () => void openCurrentPath(),
    FOLDER_ICON_PATHS.open,
  );
  open.classList.remove("icon-only");
  const openLabel = document.createElement("span");
  open.append(openLabel);
  // 閉じる: 本文いっぱいに開くと、タブ列の小さな × しか閉じ方が無かった。
  // 「閉じる」「Esc」を添えて、ほかの操作から離して置く。
  const close = button("close", () => deps.close(), X_16_PATH);
  close.classList.remove("icon-only");
  close.classList.add("image-tab-close");
  const closeLabel = document.createElement("span");
  const closeKey = document.createElement("kbd");
  closeKey.textContent = "Esc";
  close.append(closeLabel, closeKey);
  actions.append(copy, open, close);

  primary.append(zoom, modes, navigation);
  secondary.append(meta, actions);
  toolbar.append(primary, secondary);

  const canvas = document.createElement("div");
  canvas.className = "image-tab-canvas";
  const stage = document.createElement("div");
  stage.className = "image-tab-stage";
  const status = document.createElement("pre");
  status.className = "image-tab-status";
  status.hidden = true;
  status.setAttribute("aria-live", "polite");
  canvas.append(stage, status);
  el.append(toolbar, canvas);

  let language = deps.language;
  let images: readonly TerminalImageRef[] = [];
  let index = 0;
  let picture: HTMLImageElement | null = null;
  let naturalWidth = 0;
  let naturalHeight = 0;
  let scale = 1;
  let scaleMode: ScaleMode = "fit";
  let statusKind: StatusKind | null = null;
  let statusMessage: StatusMessage | null = null;
  let loadVersion = 0;
  let disposed = false;
  let resizeObserver: ResizeObserver | null = null;
  let scaleFrame: number | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

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

  function updateStatus(): void {
    if (!statusMessage || !statusKind) {
      status.hidden = true;
      status.textContent = "";
      status.removeAttribute("data-kind");
      status.setAttribute("role", "status");
      return;
    }
    status.hidden = false;
    status.dataset.kind = statusKind;
    status.setAttribute("role", statusKind === "error" ? "alert" : "status");
    status.textContent = statusMessage(imageTabText(language));
  }

  function setStatus(kind: StatusKind, message: StatusMessage): void {
    statusKind = kind;
    statusMessage = message;
    updateStatus();
  }

  function clearStatus(): void {
    statusKind = null;
    statusMessage = null;
    updateStatus();
  }

  function updateScaleValue(): void {
    if (!picture || naturalWidth <= 0) {
      scaleValue.textContent = "—";
      return;
    }
    const measuredWidth = picture.getBoundingClientRect().width;
    const renderedScale =
      Number.isFinite(measuredWidth) && measuredWidth > 0
        ? measuredWidth / naturalWidth
        : scale;
    scaleValue.textContent = `${Math.round(renderedScale * 100)}%`;
  }

  function scheduleScaleRead(): void {
    if (scaleFrame !== null || typeof requestAnimationFrame !== "function")
      return;
    scaleFrame = requestAnimationFrame(() => {
      scaleFrame = null;
      if (!disposed) updateScaleValue();
    });
  }

  function updateModeButtons(): void {
    actual.dataset.active = scaleMode === "actual" ? "true" : "false";
    fit.dataset.active = scaleMode === "fit" ? "true" : "false";
    actual.setAttribute("aria-pressed", String(scaleMode === "actual"));
    fit.setAttribute("aria-pressed", String(scaleMode === "fit"));
  }

  function applyScale(next: number, mode: ScaleMode): void {
    if (!picture || naturalWidth <= 0 || naturalHeight <= 0) return;
    scale = clampDiagramScale(next);
    scaleMode = mode;
    picture.style.width = `${naturalWidth * scale}px`;
    picture.style.height = `${naturalHeight * scale}px`;
    updateModeButtons();
    updateScaleValue();
    scheduleScaleRead();
  }

  function stageHorizontalPadding(): number {
    const computed = getComputedStyle(stage);
    const left = Number.parseFloat(computed.paddingLeft);
    const right = Number.parseFloat(computed.paddingRight);
    return (
      (Number.isFinite(left) ? left : 0) + (Number.isFinite(right) ? right : 0)
    );
  }

  function availableImageWidth(): number {
    const measured = canvas.getBoundingClientRect().width || canvas.clientWidth;
    return Math.max(1, measured - stageHorizontalPadding());
  }

  function applyFit(): void {
    if (!picture || naturalWidth <= 0) return;
    applyScale(availableImageWidth() / naturalWidth, "fit");
  }

  function applyCustomScale(direction: -1 | 1): void {
    applyScale(stepDiagramScale(scale, direction), "custom");
  }

  function updateNavigation(): void {
    const disabled = images.length < 2;
    previous.disabled = disabled;
    next.disabled = disabled;
  }

  function showCurrent(): void {
    const image = current();
    const myVersion = ++loadVersion;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = null;
    setCopyIcon(false);
    naturalWidth = 0;
    naturalHeight = 0;
    scale = 1;
    scaleMode = "fit";
    path.textContent = image.path;
    path.title = image.path;
    dimensions.textContent = "—×—";
    el.setAttribute("aria-label", imageTabText(language).imageView(image.name));
    updateNavigation();
    updateModeButtons();
    for (const control of [zoomOut, zoomIn, actual, fit])
      control.disabled = true;
    setStatus("loading", (text) => text.loading);

    let url: string;
    try {
      url = deps.imageUrlFor(image);
      if (!url) throw new Error("imageUrlFor returned an empty URL");
    } catch (error) {
      console.error("[code-viewer] image tab URL creation failed", error);
      setStatus(
        "error",
        (text) =>
          `${text.imageLoadFailed}\n${text.pathLabel}: ${image.path}\n${formatErrorDetail(error)}`,
      );
      stage.replaceChildren();
      picture = null;
      return;
    }

    const nextPicture = document.createElement("img");
    nextPicture.alt = image.name;
    nextPicture.draggable = false;
    nextPicture.decoding = "async";
    nextPicture.addEventListener("load", () => {
      if (myVersion !== loadVersion || picture !== nextPicture) return;
      naturalWidth = nextPicture.naturalWidth;
      naturalHeight = nextPicture.naturalHeight;
      if (naturalWidth <= 0 || naturalHeight <= 0) {
        setStatus(
          "error",
          (text) =>
            `${text.imageLoadFailed}\n${text.pathLabel}: ${image.path}\n${text.eventLabel}: invalid dimensions ${naturalWidth}×${naturalHeight}`,
        );
        nextPicture.hidden = true;
        return;
      }
      dimensions.textContent = `${naturalWidth}×${naturalHeight}`;
      for (const control of [zoomOut, zoomIn, actual, fit])
        control.disabled = false;
      clearStatus();
      applyFit();
    });
    nextPicture.addEventListener("error", (event) => {
      if (myVersion !== loadVersion || picture !== nextPicture) return;
      nextPicture.hidden = true;
      setStatus(
        "error",
        (text) =>
          `${text.imageLoadFailed}\n${text.pathLabel}: ${image.path}\n${text.eventLabel}: ${event.type}`,
      );
    });
    picture = nextPicture;
    stage.replaceChildren(nextPicture);
    nextPicture.src = url;
  }

  function navigate(direction: -1 | 1): void {
    if (images.length < 2) return;
    index = (index + direction + images.length) % images.length;
    showCurrent();
  }

  function setCopyIcon(copied: boolean): void {
    const existing = copy.querySelector("svg");
    existing?.remove();
    copy.insertAdjacentHTML(
      "afterbegin",
      iconSvg("image-tab-icon", copied ? CHECK_16_PATHS : COPY_16_PATHS),
    );
    copy.dataset.copied = copied ? "true" : "false";
  }

  async function copyCurrentPath(): Promise<void> {
    const image = current();
    const myVersion = loadVersion;
    copy.disabled = true;
    try {
      await deps.copyPath(image.path);
      if (myVersion !== loadVersion) return;
      setCopyIcon(true);
      setStatus("info", (text) => text.pathCopied);
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copiedTimer = null;
        setCopyIcon(false);
      }, COPY_FEEDBACK_MS);
    } catch (error) {
      console.error("[code-viewer] image tab path copy failed", error);
      setStatus(
        "error",
        (text) =>
          `${text.copyFailed}\n${text.pathLabel}: ${image.path}\n${formatErrorDetail(error)}`,
      );
    } finally {
      copy.disabled = false;
    }
  }

  async function openCurrentPath(): Promise<void> {
    const image = current();
    open.disabled = true;
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
      open.disabled = false;
    }
  }

  function applyLanguage(): void {
    const text = imageTabText(language);
    zoomOut.title = text.zoomOut;
    zoomOut.setAttribute("aria-label", text.zoomOut);
    zoomIn.title = text.zoomIn;
    zoomIn.setAttribute("aria-label", text.zoomIn);
    actual.textContent = text.actualSize;
    actual.title = text.actualSize;
    fit.textContent = text.fitWidth;
    fit.title = text.fitWidth;
    previous.title = text.previousImage;
    previous.setAttribute("aria-label", text.previousImage);
    next.title = text.nextImage;
    next.setAttribute("aria-label", text.nextImage);
    copyLabel.textContent = text.copyPath;
    copy.title = text.copyPath;
    copy.setAttribute("aria-label", text.copyPath);
    openLabel.textContent = text.openFolder;
    open.title = text.openFolder;
    open.setAttribute("aria-label", text.openFolder);
    closeLabel.textContent = text.closeTab;
    close.title = text.closeTab;
    close.setAttribute("aria-label", text.closeTab);
    if (images.length > 0)
      el.setAttribute("aria-label", text.imageView(current().name));
    updateStatus();
  }

  const onKeyDown = (event: KeyboardEvent): void => {
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
      case "ArrowLeft":
        navigate(-1);
        break;
      case "ArrowRight":
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
  };
  el.addEventListener("keydown", onKeyDown);

  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (width > 0) el.dataset.narrow = String(width < NARROW_WIDTH);
      if (scaleMode === "fit") applyFit();
    });
    resizeObserver.observe(el);
  }

  configureImages(deps.image, deps.images);
  applyLanguage();
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
      applyLanguage();
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
      el.removeEventListener("keydown", onKeyDown);
      if (scaleFrame !== null && typeof cancelAnimationFrame === "function")
        cancelAnimationFrame(scaleFrame);
      scaleFrame = null;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = null;
    },
  };
}
