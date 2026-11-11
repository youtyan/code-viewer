import { live } from "lit/directives/live.js";
import { html } from "lit/html.js";
import { errorWithCause, formatErrorDetail } from "../core/error-detail";
import {
  FULLSCREEN_ENTER_16_PATHS,
  FULLSCREEN_EXIT_16_PATHS,
  PAUSE_16_PATHS,
  PLAY_16_PATH,
  VOLUME_MUTED_16_PATHS,
  VOLUME_UNMUTED_16_PATHS,
} from "../core/icons";
import { pageLanguage } from "./page-language";
import { MEDIA_PLAYER_TEXT } from "./source-preview-i18n";
import { iconTemplate } from "./ui/icon";
import { detachedElement } from "./ui/renderer";

type MediaKind = "video" | "audio";

const PLAYBACK_RATES = [1, 1.25, 1.5, 2];

function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

type MediaButtonProps = {
  label: string;
  icon: { cls: string; paths: string | string[] };
  onClick(): void;
};

/** 動画・音の再生の箱 (createMediaPlayer) の中。 */
export type MediaPlayerProps = {
  kind: MediaKind;
  label: string;
  url: string;
  title: string;
  play: MediaButtonProps;
  time: { current: string; duration: string };
  seek: {
    label: string;
    value: number;
    onInput(percent: number): void;
    onGrab(): void;
    onRelease(): void;
  };
  volume: MediaButtonProps & {
    sliderLabel: string;
    value: number;
    onInput(value: number): void;
  };
  speed: { label: string; text: string; onClick(): void };
  /** 動画だけ。 */
  fullscreen: MediaButtonProps | null;
  onMediaClick(): void;
  onKeyDown(event: KeyboardEvent): void;
};

export type MediaPlayerView = (props: MediaPlayerProps) => unknown;

const controlButton = (props: MediaButtonProps) => html`<button
  type="button"
  class="gdp-media-control"
  title=${props.label}
  aria-label=${props.label}
  @click=${props.onClick}
>${iconTemplate(props.icon.paths, props.icon.cls)}</button>`;

export const DEFAULT_VIEW: MediaPlayerView = (props) => html`<div
  class=${`gdp-media-player kind-${props.kind}`}
  tabindex="0"
  role="region"
  aria-label=${props.label}
  @keydown=${props.onKeyDown}
>${
  props.kind === "video"
    ? html`<video
        src=${props.url}
        preload="metadata"
        aria-label=${props.title}
        @click=${props.onMediaClick}
      ></video>`
    : html`<audio
        src=${props.url}
        preload="metadata"
        aria-label=${props.title}
        @click=${props.onMediaClick}
      ></audio>`
}<div class="gdp-media-controls">${controlButton(props.play)}<span
      class="gdp-media-time"
    >${props.time.current}</span><span class="gdp-media-time"
      >${props.time.duration}</span
    ><input
      type="range"
      class="gdp-media-seek"
      min="0"
      max="100"
      aria-label=${props.seek.label}
      .value=${live(String(props.seek.value))}
      @input=${(event: Event) =>
        props.seek.onInput(
          Number((event.currentTarget as HTMLInputElement).value),
        )}
      @mousedown=${props.seek.onGrab}
      @mouseup=${props.seek.onRelease}
    />${controlButton(props.volume)}<input
      type="range"
      class="gdp-media-volume"
      min="0"
      max="1"
      step="0.05"
      aria-label=${props.volume.sliderLabel}
      .value=${live(String(props.volume.value))}
      @input=${(event: Event) =>
        props.volume.onInput(
          Number((event.currentTarget as HTMLInputElement).value),
        )}
    /><button
      type="button"
      class="gdp-media-speed"
      title=${props.speed.label}
      aria-label=${props.speed.label}
      @click=${props.speed.onClick}
    >${props.speed.text}</button>${
      props.fullscreen ? controlButton(props.fullscreen) : ""
    }</div></div>`;

export function createMediaPlayer(
  url: string,
  kind: MediaKind,
  title: string,
  view: MediaPlayerView = DEFAULT_VIEW,
): HTMLElement {
  const text = MEDIA_PLAYER_TEXT[pageLanguage()];
  let rateIndex = 0;
  let wasPlayingBeforeSeek = false;
  let raf = 0;
  /** 再生に失敗した理由 (再生ボタンの title。次の再生・一時停止で元に戻る)。 */
  let playFailure = "";
  /** 音量の欄に出す値 (音を消すと 0)。 */
  let volumeValue = 1;
  let seekPercent = 0;
  let media: HTMLVideoElement | HTMLAudioElement | null = null;
  /** 箱 (描いた後に決まる。最初に描くときは null)。 */
  let box: HTMLElement | null = null;

  function element(): HTMLVideoElement | HTMLAudioElement {
    if (!media)
      throw new Error("media player: the media element was not drawn");
    return media;
  }

  function props(): MediaPlayerProps {
    const paused = media ? media.paused : true;
    const muted = media ? media.muted || media.volume === 0 : false;
    const fullscreen = box !== null && document.fullscreenElement === box;
    const playLabel = paused ? text.play : text.pause;
    return {
      kind,
      label: text.player(kind, title),
      url,
      title,
      play: {
        label: playFailure || playLabel,
        icon: paused
          ? { cls: "octicon-play", paths: PLAY_16_PATH }
          : { cls: "octicon-pause", paths: PAUSE_16_PATHS },
        onClick: togglePlay,
      },
      time: {
        current: formatMediaTime(media?.currentTime ?? 0),
        duration: ` / ${formatMediaTime(media?.duration ?? 0)}`,
      },
      seek: {
        label: text.seek,
        value: seekPercent,
        onInput: seekToPercent,
        onGrab: () => {
          wasPlayingBeforeSeek = !element().paused;
          element().pause();
        },
        onRelease: () => {
          if (wasPlayingBeforeSeek) play();
        },
      },
      volume: {
        label: muted ? text.unmute : text.mute,
        icon: muted
          ? { cls: "octicon-volume-mute", paths: VOLUME_MUTED_16_PATHS }
          : { cls: "octicon-volume", paths: VOLUME_UNMUTED_16_PATHS },
        onClick: toggleMute,
        sliderLabel: text.volume,
        value: volumeValue,
        onInput: (value) => {
          volumeValue = value;
          element().volume = value;
          element().muted = value === 0;
          draw();
        },
      },
      speed: {
        label: text.playbackSpeed,
        text: `${PLAYBACK_RATES[rateIndex]}x`,
        onClick: cycleSpeed,
      },
      fullscreen:
        kind === "video"
          ? {
              label: fullscreen ? text.exitFullscreen : text.enterFullscreen,
              icon: fullscreen
                ? {
                    cls: "octicon-screen-normal",
                    paths: FULLSCREEN_EXIT_16_PATHS,
                  }
                : {
                    cls: "octicon-screen-full",
                    paths: FULLSCREEN_ENTER_16_PATHS,
                  },
              onClick: toggleFullscreen,
            }
          : null,
      onMediaClick: togglePlay,
      onKeyDown,
    };
  }

  const player = detachedElement(() => view(props()));
  const container = player.element;
  box = container;
  const draw = () => player.draw();
  media = container.querySelector<HTMLVideoElement | HTMLAudioElement>(
    "video, audio",
  );
  const mediaElement = element();

  function syncSeek() {
    const current = element();
    seekPercent = current.duration
      ? (current.currentTime / current.duration) * 100
      : 0;
  }

  function onTimeUpdate() {
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncSeek();
        draw();
      });
    }
  }

  function play() {
    const current = element();
    void current.play().catch((error) => {
      // 再生の開始前に pause() や src の差し替えが入ると AbortError で打ち切ら
      // れる。これは失敗ではない。
      if ((error as { name?: unknown } | null)?.name === "AbortError") return;
      const failure = errorWithCause(
        `playing ${current.currentSrc || current.src} failed`,
        error,
      );
      console.error(failure);
      playFailure = formatErrorDetail(failure);
      draw();
    });
  }

  function togglePlay() {
    if (element().paused) {
      play();
    } else {
      element().pause();
    }
  }

  function toggleMute() {
    const current = element();
    current.muted = !current.muted;
    if (current.muted) {
      volumeValue = 0;
    } else if (current.volume === 0) {
      current.volume = 0.5;
      volumeValue = 0.5;
    } else {
      volumeValue = current.volume;
    }
    draw();
  }

  function cycleSpeed() {
    rateIndex = (rateIndex + 1) % PLAYBACK_RATES.length;
    element().playbackRate = PLAYBACK_RATES[rateIndex];
    draw();
  }

  function seekToPercent(percent: number) {
    const current = element();
    seekPercent = percent;
    if (!current.duration || !Number.isFinite(current.duration)) return;
    current.currentTime = (percent / 100) * current.duration;
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === container) {
      void document.exitFullscreen();
    } else {
      void container.requestFullscreen();
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLButtonElement
    ) {
      // Let range/button inputs handle their own keys, except media shortcuts.
      if (e.key !== " " && e.key !== "ArrowLeft" && e.key !== "ArrowRight")
        return;
    }
    const current = element();
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowLeft":
        e.preventDefault();
        current.currentTime = Math.max(0, current.currentTime - 5);
        break;
      case "ArrowRight":
        e.preventDefault();
        current.currentTime = Math.min(
          current.duration || 0,
          current.currentTime + 5,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        current.volume = Math.min(1, current.volume + 0.1);
        volumeValue = current.volume;
        draw();
        break;
      case "ArrowDown":
        e.preventDefault();
        current.volume = Math.max(0, current.volume - 0.1);
        volumeValue = current.volume;
        draw();
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      case "f":
      case "F":
        if (kind === "video") toggleFullscreen();
        break;
    }
  }

  // 再生・一時停止で、再生の失敗の理由は消して元の文言に戻す。
  const onPlayState = () => {
    playFailure = "";
    draw();
  };
  mediaElement.addEventListener("play", onPlayState);
  mediaElement.addEventListener("pause", onPlayState);
  mediaElement.addEventListener("ended", draw);
  mediaElement.addEventListener("timeupdate", onTimeUpdate);
  mediaElement.addEventListener("durationchange", draw);
  mediaElement.addEventListener("volumechange", draw);
  mediaElement.addEventListener("loadedmetadata", () => {
    syncSeek();
    draw();
  });
  document.addEventListener("fullscreenchange", draw);

  const cleanupObserver = new MutationObserver(() => {
    if (!container.isConnected) {
      cleanupObserver.disconnect();
      document.removeEventListener("fullscreenchange", draw);
      if (raf) cancelAnimationFrame(raf);
    }
  });
  cleanupObserver.observe(document.body, { childList: true, subtree: true });

  draw();
  return container;
}
