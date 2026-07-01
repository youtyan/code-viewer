// Wires the playback state machine to the player bar DOM and the
// browser speechSynthesis API.

import {
  createAnnotationPlayerCore,
  type PlayerItem,
  type PlayerState,
} from "../core/annotation-player-core";
import {
  annotationDisplayMs,
  annotationSpeechText,
} from "../core/annotation-speech";
import {
  iconSvg,
  NEXT_16_PATHS,
  PAUSE_16_PATHS,
  PLAY_16_PATH,
  PREVIOUS_16_PATHS,
  VOLUME_MUTED_16_PATHS,
  VOLUME_UNMUTED_16_PATHS,
} from "../core/icons";
import type { AnnotationEntry } from "../core/types";

export type AnnotationsPlayerDeps = {
  $: <T extends Element>(sel: string) => T;
  getActiveSessionEntries(): AnnotationEntry[];
  openAnnotationEntry(entryId: string): Promise<void>;
  setAnnotationPanelOpen(open: boolean): void;
  onAnnotationsChanged(cb: () => void): void;
  onAnnotationOpened(cb: (entryId: string) => void): void;
  getActiveAnnotationId(): string | null;
  getMuted(): boolean;
  setMuted(muted: boolean): void;
  getRate(): number | undefined;
  setRate(rate: number): void;
};

function setIconButton(
  button: HTMLButtonElement,
  label: string,
  iconClass: string,
  paths: string | string[],
) {
  button.innerHTML = iconSvg(iconClass, paths);
  button.title = label;
  button.setAttribute("aria-label", label);
}

export function createAnnotationsPlayer(deps: AnnotationsPlayerDeps) {
  const bar = deps.$<HTMLElement>("#annotation-player");
  const toggleBtn = deps.$<HTMLButtonElement>("#annotation-player-toggle");
  const prevBtn = deps.$<HTMLButtonElement>("#annotation-player-prev");
  const nextBtn = deps.$<HTMLButtonElement>("#annotation-player-next");
  const muteBtn = deps.$<HTMLButtonElement>("#annotation-player-mute");
  const rateSel = deps.$<HTMLSelectElement>("#annotation-player-rate");
  const progress = deps.$<HTMLElement>("#annotation-player-progress");

  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  // Cache the Japanese voice; voices may load asynchronously, so refresh
  // the cache when the browser fires voiceschanged.
  let jaVoice: SpeechSynthesisVoice | null = null;
  function refreshJaVoice() {
    const voices = window.speechSynthesis.getVoices();
    jaVoice = voices.find((v) => v.lang.toLowerCase().startsWith("ja")) ?? null;
  }
  if (speechSupported) {
    refreshJaVoice();
    window.speechSynthesis.addEventListener("voiceschanged", refreshJaVoice);
  }

  // Keep a strong reference to the active utterance so Chrome does not
  // garbage-collect it mid-speech (which silently drops onend).
  let _currentUtterance: SpeechSynthesisUtterance | null = null;

  function speak(text: string, rate: number, onEnd: () => void): () => void {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      _currentUtterance = null;
      onEnd();
    };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.lang = "ja-JP";
    if (jaVoice) utterance.voice = jaVoice;
    utterance.onend = finish;
    utterance.onerror = (event) => {
      // Cancellation or interruption is triggered by our own controls;
      // do not advance the playlist in that case.
      if (event.error === "interrupted" || event.error === "canceled") return;
      finish();
    };
    window.speechSynthesis.cancel();
    _currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
    return () => {
      done = true;
      _currentUtterance = null;
      window.speechSynthesis.cancel();
    };
  }

  function items(): PlayerItem[] {
    return deps.getActiveSessionEntries().map((entry) => ({
      entryId: entry.id,
      speechText: annotationSpeechText(entry.body),
    }));
  }

  function render(state: PlayerState) {
    bar.classList.toggle("playing", state.status === "playing");
    setIconButton(
      toggleBtn,
      state.status === "playing"
        ? "Pause annotation playback"
        : "Play annotation playback",
      state.status === "playing" ? "octicon-pause" : "octicon-play",
      state.status === "playing" ? PAUSE_16_PATHS : PLAY_16_PATH,
    );
    setIconButton(
      prevBtn,
      "Previous annotation",
      "octicon-skip-back",
      PREVIOUS_16_PATHS,
    );
    setIconButton(
      nextBtn,
      "Next annotation",
      "octicon-skip-forward",
      NEXT_16_PATHS,
    );
    progress.textContent =
      state.status === "idle" || state.index < 0
        ? `${state.total}`
        : `${state.index + 1}/${state.total}`;
    setIconButton(
      muteBtn,
      state.muted ? "Unmute annotation playback" : "Mute annotation playback",
      state.muted ? "octicon-volume-muted" : "octicon-volume-unmuted",
      state.muted ? VOLUME_MUTED_16_PATHS : VOLUME_UNMUTED_16_PATHS,
    );
    prevBtn.disabled = state.status === "idle";
    nextBtn.disabled = state.status === "idle";
  }

  // Distinguishes jumps the player itself triggers from user clicks on
  // annotation rows; only the latter should move the playback position.
  let selfJumping = false;

  const core = createAnnotationPlayerCore({
    items,
    jump: async (entryId) => {
      selfJumping = true;
      try {
        await deps.openAnnotationEntry(entryId);
      } finally {
        selfJumping = false;
      }
    },
    speak,
    schedule: (ms, cb) => {
      const id = window.setTimeout(cb, ms);
      return () => window.clearTimeout(id);
    },
    displayMs: annotationDisplayMs,
    speechAvailable: () => speechSupported,
    onStateChange: render,
  });

  // Restore persisted settings.
  if (deps.getMuted()) core.setMuted(true);
  const savedRate = deps.getRate();
  if (
    savedRate &&
    savedRate >= 0.5 &&
    savedRate <= 2 &&
    Array.from(rateSel.options).some((o) => o.value === String(savedRate))
  ) {
    core.setRate(savedRate);
    rateSel.value = String(savedRate);
  }
  if (!speechSupported) {
    muteBtn.disabled = true;
    rateSel.disabled = true;
    core.setMuted(true);
  }

  function entryIndexOf(entryId: string | null): number {
    if (!entryId) return -1;
    return deps
      .getActiveSessionEntries()
      .findIndex((entry) => entry.id === entryId);
  }

  toggleBtn.addEventListener("click", () => {
    const state = core.getState();
    if (state.status === "playing") {
      core.pause();
    } else {
      deps.setAnnotationPanelOpen(true);
      if (state.status === "idle") {
        // Start from the annotation currently shown, when there is one.
        const activeIndex = entryIndexOf(deps.getActiveAnnotationId());
        core.play(activeIndex >= 0 ? activeIndex : 0);
      } else {
        core.play();
      }
    }
  });
  prevBtn.addEventListener("click", () => core.prev());
  nextBtn.addEventListener("click", () => core.next());
  muteBtn.addEventListener("click", () => {
    const muted = !core.getState().muted;
    core.setMuted(muted);
    deps.setMuted(muted);
  });
  rateSel.addEventListener("change", () => {
    const rate = Number(rateSel.value) || 1;
    core.setRate(rate);
    deps.setRate(rate);
  });

  function syncVisibility() {
    const hasEntries = deps.getActiveSessionEntries().length > 0;
    bar.hidden = !hasEntries;
    render(core.getState());
  }

  // Stop playback when sessions change (switch, edit, delete) to keep
  // the playlist consistent, then refresh bar visibility.
  deps.onAnnotationsChanged(() => {
    core.stop();
    syncVisibility();
  });

  // A user click on an annotation row moves the playback position there
  // while playing or paused; jumps issued by the player are ignored.
  deps.onAnnotationOpened((entryId) => {
    if (selfJumping) return;
    if (core.getState().status === "idle") return;
    const index = entryIndexOf(entryId);
    if (index >= 0) core.jumpTo(index);
  });

  syncVisibility();
  render(core.getState());

  return { stop: () => core.stop(), syncVisibility };
}
