// Media (image / video / audio) embedding for binary file diffs.
// Pure helpers extracted from app.ts — no app state involved.

import type { FileMeta } from "../core/types";
import { createMediaPlayer } from "./media-player";

const MEDIA_RE =
  /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|mp4|webm|mov|mp3|wav|ogg|flac|m4a|aac|opus)(\?.*)?$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i;
const VIDEO_RE = /\.(mp4|webm|mov)$/i;
const AUDIO_RE = /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i;
export function isMedia(p: string): boolean {
  return MEDIA_RE.test(p);
}
export function isImage(p: string): boolean {
  return IMAGE_RE.test(p);
}
export function isVideo(p: string): boolean {
  return VIDEO_RE.test(p);
}
export function isAudio(p: string): boolean {
  return AUDIO_RE.test(p);
}

export type MediaCardSide = "before" | "after";

export type MediaCardOptions = {
  fileUrl(side: MediaCardSide): string;
  onMediaError?(side: MediaCardSide, media: HTMLElement): void;
};

function fileURL(path: string, side: MediaCardSide): string {
  const ref = side === "before" ? "HEAD" : "worktree";
  return `/_file?path=${encodeURIComponent(path)}&ref=${ref}`;
}

function createMediaElement(
  path: string,
  side: MediaCardSide,
  options?: MediaCardOptions,
): HTMLElement {
  const url = options?.fileUrl(side) ?? fileURL(path, side);
  const onMediaError = options?.onMediaError;
  if (isImage(path)) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    if (onMediaError) {
      img.addEventListener("error", () => onMediaError(side, img), {
        once: true,
      });
    }
    return img;
  }
  const kind = isVideo(path) ? "video" : "audio";
  const player = createMediaPlayer(url, kind, path);
  const media = player.querySelector<HTMLMediaElement>(kind);
  if (media && onMediaError) {
    media.addEventListener("error", () => onMediaError(side, player), {
      once: true,
    });
  }
  return player;
}

function createMediaSide(
  path: string | null,
  mediaSide: MediaCardSide | null,
  label: string,
  labelType: "add" | "del",
  options?: MediaCardOptions,
): HTMLElement {
  const side = document.createElement("div");
  side.className = "media-side";
  const labelEl = document.createElement("div");
  labelEl.className = `media-label ${labelType}`;
  labelEl.textContent = label;
  side.appendChild(labelEl);
  if (path && mediaSide) {
    side.appendChild(createMediaElement(path, mediaSide, options));
  } else {
    const empty = document.createElement("div");
    empty.className = "media-empty";
    empty.textContent = label;
    side.appendChild(empty);
  }
  return side;
}

// Per-card media enhancer (replaces the global walk; only touches this card)
export function enhanceMediaCard(
  file: Pick<FileMeta, "path" | "status" | "media_kind">,
  card: Element,
  options?: MediaCardOptions,
) {
  const path = file.path;
  if (!file.media_kind && !isMedia(path)) return;
  const wrapper = card.querySelector(".d2h-file-wrapper");
  if (!wrapper) return;
  const body =
    wrapper.querySelector(".d2h-files-diff") ||
    wrapper.querySelector(".d2h-file-diff");
  if (!body) return;
  const container = document.createElement("div");
  container.className = "gdp-media";

  if (file.status === "A") {
    container.appendChild(
      createMediaSide(null, null, "Not in HEAD", "del", options),
    );
    container.appendChild(
      createMediaSide(path, "after", "After", "add", options),
    );
  } else if (file.status === "D") {
    container.appendChild(
      createMediaSide(path, "before", "Before", "del", options),
    );
    container.appendChild(
      createMediaSide(null, null, "Deleted", "add", options),
    );
  } else {
    container.appendChild(
      createMediaSide(path, "before", "Before", "del", options),
    );
    container.appendChild(
      createMediaSide(path, "after", "After", "add", options),
    );
  }
  body.replaceWith(container);
}

// Scrollspy: pick the file whose wrapper contains a scan line just below
// the fixed topbar. Avoids IntersectionObserver weirdness with sticky headers.
