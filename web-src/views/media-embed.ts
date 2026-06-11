// Media (image / video / audio) embedding for binary file diffs.
// Pure helpers extracted from app.ts — no app state involved.

import type { FileMeta } from "../core/types";

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
function fileURL(path: string, ref: string): string {
  return `/_file?path=${encodeURIComponent(path)}&ref=${ref}`;
}
function mediaTag(path: string, ref: string): string {
  const url = fileURL(path, ref);
  if (isVideo(path)) {
    return `<video src="${url}" controls preload="metadata"></video>`;
  }
  if (isAudio(path)) {
    return `<audio src="${url}" controls preload="metadata"></audio>`;
  }
  return `<img src="${url}" alt="" loading="lazy">`;
}

// Per-card media enhancer (replaces the global walk; only touches this card)
export function enhanceMediaCard(file: FileMeta, card: Element) {
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
  let leftHTML: string;
  let rightHTML: string;
  if (file.status === "A") {
    leftHTML = '<div class="media-empty">Not in HEAD</div>';
    rightHTML = mediaTag(path, "worktree");
  } else if (file.status === "D") {
    leftHTML = mediaTag(path, "HEAD");
    rightHTML = '<div class="media-empty">Deleted</div>';
  } else {
    leftHTML = mediaTag(path, "HEAD");
    rightHTML = mediaTag(path, "worktree");
  }
  container.innerHTML =
    '<div class="media-side"><div class="media-label del">Before</div>' +
    leftHTML +
    "</div>" +
    '<div class="media-side"><div class="media-label add">After</div>' +
    rightHTML +
    "</div>";
  body.replaceWith(container);
}

// Scrollspy: pick the file whose wrapper contains a scan line just below
// the fixed topbar. Avoids IntersectionObserver weirdness with sticky headers.
