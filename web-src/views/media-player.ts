import {
  FULLSCREEN_ENTER_16_PATHS,
  FULLSCREEN_EXIT_16_PATHS,
  PAUSE_16_PATHS,
  PLAY_16_PATH,
  VOLUME_MUTED_16_PATHS,
  VOLUME_UNMUTED_16_PATHS,
  iconSvg,
} from "../core/icons";

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

export function createMediaPlayer(
  url: string,
  kind: MediaKind,
  title: string,
): HTMLElement {
  const container = document.createElement("div");
  container.className = `gdp-media-player kind-${kind}`;
  container.tabIndex = 0;
  container.setAttribute("role", "region");
  container.setAttribute(
    "aria-label",
    `${kind === "video" ? "Video" : "Audio"} player: ${title}`,
  );

  const media: HTMLVideoElement | HTMLAudioElement =
    kind === "video"
      ? document.createElement("video")
      : document.createElement("audio");
  media.src = url;
  media.preload = "metadata";
  media.setAttribute("aria-label", title);
  container.appendChild(media);

  const controls = document.createElement("div");
  controls.className = "gdp-media-controls";

  const playButton = createIconButton("Play", PLAY_16_PATH);
  const currentTimeEl = document.createElement("span");
  currentTimeEl.className = "gdp-media-time";
  currentTimeEl.textContent = "0:00";
  const durationEl = document.createElement("span");
  durationEl.className = "gdp-media-time";
  durationEl.textContent = " / 0:00";

  const seek = document.createElement("input");
  seek.type = "range";
  seek.className = "gdp-media-seek";
  seek.min = "0";
  seek.max = "100";
  seek.value = "0";
  seek.setAttribute("aria-label", "Seek");

  const volumeButton = createIconButton("Mute", VOLUME_UNMUTED_16_PATHS);
  const volume = document.createElement("input");
  volume.type = "range";
  volume.className = "gdp-media-volume";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.05";
  volume.value = "1";
  volume.setAttribute("aria-label", "Volume");

  const speedButton = document.createElement("button");
  speedButton.type = "button";
  speedButton.className = "gdp-media-speed";
  speedButton.textContent = "1x";
  speedButton.title = "Playback speed";
  speedButton.setAttribute("aria-label", "Playback speed");

  controls.append(
    playButton,
    currentTimeEl,
    durationEl,
    seek,
    volumeButton,
    volume,
    speedButton,
  );

  let fullscreenButton: HTMLButtonElement | null = null;
  if (kind === "video") {
    fullscreenButton = createIconButton(
      "Enter fullscreen",
      FULLSCREEN_ENTER_16_PATHS,
    );
    controls.appendChild(fullscreenButton);
  }

  container.appendChild(controls);

  let rateIndex = 0;
  let wasPlayingBeforeSeek = false;
  let raf = 0;

  function updatePlayButton() {
    playButton.innerHTML = iconSvg(
      media.paused ? "octicon-play" : "octicon-pause",
      media.paused ? PLAY_16_PATH : PAUSE_16_PATHS,
    );
    playButton.title = media.paused ? "Play" : "Pause";
    playButton.setAttribute("aria-label", media.paused ? "Play" : "Pause");
  }

  function updateVolumeButton() {
    const muted = media.muted || media.volume === 0;
    volumeButton.innerHTML = iconSvg(
      muted ? "octicon-volume-mute" : "octicon-volume",
      muted ? VOLUME_MUTED_16_PATHS : VOLUME_UNMUTED_16_PATHS,
    );
    volumeButton.title = muted ? "Unmute" : "Mute";
    volumeButton.setAttribute("aria-label", muted ? "Unmute" : "Mute");
  }

  function updateFullscreenButton() {
    if (!fullscreenButton) return;
    const isFullscreen = document.fullscreenElement === container;
    fullscreenButton.innerHTML = iconSvg(
      isFullscreen ? "octicon-screen-normal" : "octicon-screen-full",
      isFullscreen ? FULLSCREEN_EXIT_16_PATHS : FULLSCREEN_ENTER_16_PATHS,
    );
    fullscreenButton.title = isFullscreen
      ? "Exit fullscreen"
      : "Enter fullscreen";
    fullscreenButton.setAttribute(
      "aria-label",
      isFullscreen ? "Exit fullscreen" : "Enter fullscreen",
    );
  }

  function syncSeek() {
    const pct = media.duration ? (media.currentTime / media.duration) * 100 : 0;
    seek.value = String(pct);
  }

  function updateTime() {
    currentTimeEl.textContent = formatMediaTime(media.currentTime);
    durationEl.textContent = ` / ${formatMediaTime(media.duration)}`;
  }

  function onTimeUpdate() {
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncSeek();
        updateTime();
      });
    }
  }

  function togglePlay() {
    if (media.paused) {
      void media.play().catch(() => {
        // Autoplay restrictions or unloaded media; ignore.
      });
    } else {
      media.pause();
    }
  }

  function toggleMute() {
    media.muted = !media.muted;
    if (media.muted) {
      volume.value = "0";
    } else if (media.volume === 0) {
      media.volume = 0.5;
      volume.value = "0.5";
    } else {
      volume.value = String(media.volume);
    }
    updateVolumeButton();
  }

  function cycleSpeed() {
    rateIndex = (rateIndex + 1) % PLAYBACK_RATES.length;
    media.playbackRate = PLAYBACK_RATES[rateIndex];
    speedButton.textContent = `${PLAYBACK_RATES[rateIndex]}x`;
  }

  function seekToPercent(percent: number) {
    if (!media.duration || !Number.isFinite(media.duration)) return;
    media.currentTime = (percent / 100) * media.duration;
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === container) {
      void document.exitFullscreen();
    } else {
      void container.requestFullscreen();
    }
  }

  playButton.addEventListener("click", togglePlay);
  volumeButton.addEventListener("click", toggleMute);
  speedButton.addEventListener("click", cycleSpeed);
  volume.addEventListener("input", () => {
    const value = Number(volume.value);
    media.volume = value;
    media.muted = value === 0;
    updateVolumeButton();
  });
  seek.addEventListener("input", () => {
    seekToPercent(Number(seek.value));
  });
  seek.addEventListener("mousedown", () => {
    wasPlayingBeforeSeek = !media.paused;
    media.pause();
  });
  seek.addEventListener("mouseup", () => {
    if (wasPlayingBeforeSeek) {
      void media.play().catch(() => {
        // Playback may be blocked or media unavailable; keep state consistent.
      });
    }
  });
  media.addEventListener("click", togglePlay);
  media.addEventListener("play", updatePlayButton);
  media.addEventListener("pause", updatePlayButton);
  media.addEventListener("timeupdate", onTimeUpdate);
  media.addEventListener("durationchange", updateTime);
  media.addEventListener("volumechange", updateVolumeButton);
  media.addEventListener("loadedmetadata", () => {
    updateTime();
    syncSeek();
  });
  media.addEventListener("ended", () => {
    updatePlayButton();
  });
  if (fullscreenButton) {
    fullscreenButton.addEventListener("click", toggleFullscreen);
  }
  document.addEventListener("fullscreenchange", updateFullscreenButton);

  container.addEventListener("keydown", (e) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLButtonElement
    ) {
      // Let range/button inputs handle their own keys, except media shortcuts.
      if (e.key !== " " && e.key !== "ArrowLeft" && e.key !== "ArrowRight")
        return;
    }
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowLeft":
        e.preventDefault();
        media.currentTime = Math.max(0, media.currentTime - 5);
        break;
      case "ArrowRight":
        e.preventDefault();
        media.currentTime = Math.min(
          media.duration || 0,
          media.currentTime + 5,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        media.volume = Math.min(1, media.volume + 0.1);
        volume.value = String(media.volume);
        break;
      case "ArrowDown":
        e.preventDefault();
        media.volume = Math.max(0, media.volume - 0.1);
        volume.value = String(media.volume);
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
  });

  const cleanupObserver = new MutationObserver(() => {
    if (!container.isConnected) {
      cleanupObserver.disconnect();
      document.removeEventListener("fullscreenchange", updateFullscreenButton);
      if (raf) cancelAnimationFrame(raf);
    }
  });
  cleanupObserver.observe(document.body, { childList: true, subtree: true });

  updatePlayButton();
  updateVolumeButton();
  updateTime();

  return container;
}

function createIconButton(
  label: string,
  path: string | string[],
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gdp-media-control";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = iconSvg(
    `octicon-${label.toLowerCase().replace(/\s+/g, "-")}`,
    path,
  );
  return button;
}
