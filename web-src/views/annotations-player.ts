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
import type { AnnotationEntry } from "../core/types";

export type AnnotationsPlayerDeps = {
  $: <T extends Element>(sel: string) => T;
  getActiveSessionEntries(): AnnotationEntry[];
  openAnnotationEntry(entryId: string): Promise<void>;
  setAnnotationPanelOpen(open: boolean): void;
  onAnnotationsChanged(cb: () => void): void;
};

const MUTE_KEY = "gdp:annotation-muted";
const RATE_KEY = "gdp:annotation-rate";

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
  let currentUtterance: SpeechSynthesisUtterance | null = null;

  function speak(text: string, rate: number, onEnd: () => void): () => void {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      currentUtterance = null;
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
    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
    return () => {
      done = true;
      currentUtterance = null;
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
    toggleBtn.textContent = state.status === "playing" ? "⏸" : "▶";
    progress.textContent =
      state.status === "idle" || state.index < 0
        ? `${state.total}`
        : `${state.index + 1}/${state.total}`;
    muteBtn.textContent = state.muted ? "🔇" : "🔊";
    prevBtn.disabled = state.status === "idle";
    nextBtn.disabled = state.status === "idle";
  }

  const core = createAnnotationPlayerCore({
    items,
    jump: (entryId) => deps.openAnnotationEntry(entryId),
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
  if (localStorage.getItem(MUTE_KEY) === "1") core.setMuted(true);
  const savedRate = Number(localStorage.getItem(RATE_KEY));
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

  toggleBtn.addEventListener("click", () => {
    const state = core.getState();
    if (state.status === "playing") {
      core.pause();
    } else {
      deps.setAnnotationPanelOpen(true);
      core.play();
    }
  });
  prevBtn.addEventListener("click", () => core.prev());
  nextBtn.addEventListener("click", () => core.next());
  muteBtn.addEventListener("click", () => {
    const muted = !core.getState().muted;
    core.setMuted(muted);
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  });
  rateSel.addEventListener("change", () => {
    const rate = Number(rateSel.value) || 1;
    core.setRate(rate);
    localStorage.setItem(RATE_KEY, String(rate));
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

  syncVisibility();
  render(core.getState());

  return { stop: () => core.stop(), syncVisibility };
}
