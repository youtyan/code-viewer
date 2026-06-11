// web-src/core/annotation-player-core.ts
// Playback state machine for annotation sessions. No DOM, no
// speechSynthesis; everything side-effectful is injected so the
// machine is unit-testable.

export type PlayerStatus = "idle" | "playing" | "paused";

export type PlayerItem = {
  entryId: string;
  speechText: string;
};

export type PlayerState = {
  status: PlayerStatus;
  index: number;
  total: number;
  muted: boolean;
  rate: number;
};

export type PlayerCoreDeps = {
  items(): PlayerItem[];
  jump(entryId: string): Promise<void>;
  speak(text: string, rate: number, onEnd: () => void): () => void;
  schedule(ms: number, cb: () => void): () => void;
  displayMs(text: string): number;
  speechAvailable(): boolean;
  onStateChange(state: PlayerState): void;
};

export function createAnnotationPlayerCore(deps: PlayerCoreDeps) {
  let status: PlayerStatus = "idle";
  let index = -1;
  let muted = false;
  let rate = 1;
  let cancelCurrent: (() => void) | null = null;
  let generation = 0;

  function getState(): PlayerState {
    return { status, index, total: deps.items().length, muted, rate };
  }

  function emit() {
    deps.onStateChange(getState());
  }

  function cancelPending() {
    cancelCurrent?.();
    cancelCurrent = null;
    generation += 1;
  }

  function startEntry(at: number) {
    const items = deps.items();
    if (at < 0 || at >= items.length) {
      stop();
      return;
    }
    cancelPending();
    index = at;
    status = "playing";
    emit();
    const gen = generation;
    const item = items[at];
    const proceed = () => {
      if (gen !== generation || status !== "playing") return;
      const text = item.speechText;
      const advance = () => {
        if (gen !== generation || status !== "playing") return;
        cancelCurrent = null;
        startEntry(index + 1);
      };
      if (!muted && text && deps.speechAvailable()) {
        cancelCurrent = deps.speak(text, rate, advance);
      } else {
        cancelCurrent = deps.schedule(deps.displayMs(text), advance);
      }
    };
    deps.jump(item.entryId).then(proceed, proceed);
  }

  function play() {
    if (status === "playing") return;
    if (status === "paused") {
      startEntry(index);
      return;
    }
    if (deps.items().length === 0) return;
    startEntry(0);
  }

  function pause() {
    if (status !== "playing") return;
    cancelPending();
    status = "paused";
    emit();
  }

  function stop() {
    cancelPending();
    status = "idle";
    index = -1;
    emit();
  }

  function moveTo(at: number) {
    const total = deps.items().length;
    const clamped = Math.max(0, at);
    if (clamped >= total) {
      stop();
      return;
    }
    if (status === "playing") {
      startEntry(clamped);
    } else if (status === "paused") {
      cancelPending();
      index = clamped;
      emit();
      const item = deps.items()[clamped];
      if (item) void deps.jump(item.entryId).catch(() => {});
    }
  }

  function next() {
    if (status === "idle") return;
    moveTo(index + 1);
  }

  function prev() {
    if (status === "idle") return;
    moveTo(Math.max(0, index - 1));
  }

  function restartCurrentIfPlaying() {
    if (status === "playing") {
      startEntry(index);
    } else {
      emit();
    }
  }

  function setMuted(value: boolean) {
    if (muted === value) return;
    muted = value;
    restartCurrentIfPlaying();
  }

  function setRate(value: number) {
    if (rate === value) return;
    rate = value;
    restartCurrentIfPlaying();
  }

  return { play, pause, stop, next, prev, setMuted, setRate, getState };
}
