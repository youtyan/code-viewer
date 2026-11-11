// 端末で見つけた画像と動画を出す要素。棚とリンクの帯の見本 (thumbnail) と、
// 画像のタブの本体 (player) が使う。種類は拡張子で決める (core/terminal-images.ts
// の terminalMediaKind。配る側と同じ判定)。
//
// 動画の見本は音を消した video を最初の辺りで止めたまま見せる。読むのは寸法と
// 最初の辺りだけ (preload="metadata")。

import { html, nothing } from "lit/html.js";
import {
  type TerminalImageRef,
  terminalMediaKind,
} from "../../core/terminal-images";
import { templateElement } from "../ui/renderer";

export type MediaElement = HTMLImageElement | HTMLVideoElement;

export function createMediaElement(
  image: Pick<TerminalImageRef, "url" | "name" | "path">,
  use: "thumbnail" | "player",
): MediaElement {
  if (terminalMediaKind(image.path) !== "video")
    return templateElement<HTMLImageElement>(
      html`<img
        loading=${use === "thumbnail" ? "lazy" : nothing}
        decoding="async"
        alt=${image.name}
        src=${image.url}
      />`,
    );
  // 見本は音を消して最初の辺りで止める。最初の辺りへ送っておかないと、Safari は
  // preload="metadata" で絵を出さない。
  return templateElement<HTMLVideoElement>(
    use === "player"
      ? html`<video
          .playsInline=${true}
          preload="metadata"
          aria-label=${image.name}
          .controls=${true}
          src=${image.url}
        ></video>`
      : html`<video
          .playsInline=${true}
          preload="metadata"
          aria-label=${image.name}
          .muted=${true}
          src=${`${image.url}#t=0.1`}
        ></video>`,
  );
}

/** 寸法が分かったら呼ぶ (画像は load、動画は loadedmetadata)。 */
export function onMediaReady(
  media: MediaElement,
  listener: (size: { width: number; height: number }) => void,
): void {
  if (media instanceof HTMLVideoElement) {
    media.addEventListener("loadedmetadata", () =>
      listener({ width: media.videoWidth, height: media.videoHeight }),
    );
    return;
  }
  media.addEventListener("load", () =>
    listener({ width: media.naturalWidth, height: media.naturalHeight }),
  );
}

/**
 * 読めなかった理由の詳しいこと。動画は MediaError のコードと文 (どの段階で
 * 失敗したか)、画像はブラウザが理由を渡さないので空。
 */
export function mediaErrorDetail(media: MediaElement): string {
  if (!(media instanceof HTMLVideoElement) || !media.error) return "";
  const { code, message } = media.error;
  return message ? `MediaError ${code}: ${message}` : `MediaError ${code}`;
}
