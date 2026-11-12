import { html } from "lit/html.js";
import { apiUrl } from "../core/api-url";
// Media (image / video / audio) embedding for binary file diffs.
// Pure helpers extracted from app.ts — no app state involved.

import type { FileMeta } from "../core/types";
import { createMediaPlayer } from "./media-player";
import { templateElement } from "./ui/renderer";

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
  return `${apiUrl("file")}?path=${encodeURIComponent(path)}&ref=${ref}`;
}

function mediaTemplate(
  path: string,
  side: MediaCardSide,
  options?: MediaCardOptions,
): unknown {
  const url = options?.fileUrl(side) ?? fileURL(path, side);
  const onMediaError = options?.onMediaError;
  if (isImage(path))
    return html`<img
      src=${url}
      alt=""
      loading="lazy"
      @error=${{
        handleEvent: (event: Event) =>
          onMediaError?.(side, event.currentTarget as HTMLElement),
        once: true,
      }}
    />`;
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

function mediaSideTemplate(
  path: string | null,
  mediaSide: MediaCardSide | null,
  label: string,
  labelType: "add" | "del",
  options?: MediaCardOptions,
): unknown {
  return html`<div class="media-side"><div class=${`media-label ${labelType}`}
      >${label}</div
    >${
      path && mediaSide
        ? mediaTemplate(path, mediaSide, options)
        : html`<div class="media-empty">${label}</div>`
    }</div>`;
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
  const sides =
    file.status === "A"
      ? [
          mediaSideTemplate(null, null, "Not in HEAD", "del", options),
          mediaSideTemplate(path, "after", "After", "add", options),
        ]
      : file.status === "D"
        ? [
            mediaSideTemplate(path, "before", "Before", "del", options),
            mediaSideTemplate(null, null, "Deleted", "add", options),
          ]
        : [
            mediaSideTemplate(path, "before", "Before", "del", options),
            mediaSideTemplate(path, "after", "After", "add", options),
          ];
  body.replaceWith(
    templateElement(html`<div class="gdp-media">${sides}</div>`),
  );
}

// Scrollspy: pick the file whose wrapper contains a scan line just below
// the fixed topbar. Avoids IntersectionObserver weirdness with sticky headers.
