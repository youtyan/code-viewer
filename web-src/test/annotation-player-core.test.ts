// web-src/test/annotation-player-core.test.ts
import { describe, expect, test } from "bun:test";
import {
  createAnnotationPlayerCore,
  type PlayerCoreDeps,
  type PlayerState,
} from "../core/annotation-player-core";

function makeHarness(
  items: { entryId: string; speechText: string }[],
  opts: { speechAvailable?: boolean } = {},
) {
  const states: PlayerState[] = [];
  const jumps: string[] = [];
  const spoken: { text: string; rate: number }[] = [];
  const scheduled: number[] = [];
  let pendingEnd: (() => void) | null = null;
  let pendingTimer: (() => void) | null = null;
  let speechCancels = 0;
  const deps: PlayerCoreDeps = {
    items: () => items,
    jump: (id) => {
      jumps.push(id);
      return Promise.resolve();
    },
    speak: (text, rate, onEnd) => {
      spoken.push({ text, rate });
      pendingEnd = onEnd;
      return () => {
        speechCancels += 1;
        pendingEnd = null;
      };
    },
    schedule: (ms, cb) => {
      scheduled.push(ms);
      pendingTimer = cb;
      return () => {
        pendingTimer = null;
      };
    },
    displayMs: (text) => Math.max(3000, text.length * 150),
    speechAvailable: () => opts.speechAvailable !== false,
    onStateChange: (s) => states.push(s),
  };
  const core = createAnnotationPlayerCore(deps);
  return {
    core,
    states,
    jumps,
    spoken,
    scheduled,
    get speechCancels() {
      return speechCancels;
    },
    endSpeech: () => {
      const end = pendingEnd;
      pendingEnd = null;
      end?.();
    },
    fireTimer: () => {
      const cb = pendingTimer;
      pendingTimer = null;
      cb?.();
    },
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("annotation-player-core", () => {
  test("play jumps to first entry and speaks it (status playing, index 0)", async () => {
    const h = makeHarness([
      { entryId: "a", speechText: "Hello" },
      { entryId: "b", speechText: "World" },
    ]);
    h.core.play();
    await flush();
    expect(h.core.getState().status).toBe("playing");
    expect(h.core.getState().index).toBe(0);
    expect(h.jumps).toEqual(["a"]);
    expect(h.spoken).toEqual([{ text: "Hello", rate: 1 }]);
  });

  test("play with fromIndex starts at that entry", async () => {
    const h = makeHarness([
      { entryId: "a", speechText: "Hello" },
      { entryId: "b", speechText: "World" },
      { entryId: "c", speechText: "Third" },
    ]);
    h.core.play(1);
    await flush();
    expect(h.core.getState().index).toBe(1);
    expect(h.jumps).toEqual(["b"]);
  });

  test("jumpTo while playing moves playback to that entry", async () => {
    const h = makeHarness([
      { entryId: "a", speechText: "Hello" },
      { entryId: "b", speechText: "World" },
      { entryId: "c", speechText: "Third" },
    ]);
    h.core.play();
    await flush();
    h.core.jumpTo(2);
    await flush();
    expect(h.core.getState().status).toBe("playing");
    expect(h.core.getState().index).toBe(2);
    expect(h.jumps).toEqual(["a", "c"]);
  });

  test("jumpTo while idle does nothing", async () => {
    const h = makeHarness([{ entryId: "a", speechText: "Hello" }]);
    h.core.jumpTo(0);
    await flush();
    expect(h.core.getState().status).toBe("idle");
    expect(h.jumps).toEqual([]);
  });

  test("speech end advances to next entry; ending the last entry returns to idle", async () => {
    const h = makeHarness([
      { entryId: "a", speechText: "Hello" },
      { entryId: "b", speechText: "World" },
    ]);
    h.core.play();
    await flush();
    h.endSpeech();
    await flush();
    expect(h.core.getState().index).toBe(1);
    expect(h.jumps).toEqual(["a", "b"]);
    h.endSpeech();
    await flush();
    expect(h.core.getState().status).toBe("idle");
    expect(h.core.getState().index).toBe(-1);
  });

  test("muted playback uses timer with displayMs (3000 for short text), no speak calls", async () => {
    const h = makeHarness([{ entryId: "a", speechText: "Hi" }]);
    h.core.setMuted(true);
    h.core.play();
    await flush();
    expect(h.spoken).toHaveLength(0);
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]).toBe(3000);
  });

  test("empty speech text falls back to timer even when unmuted", async () => {
    const h = makeHarness([{ entryId: "a", speechText: "" }]);
    h.core.play();
    await flush();
    expect(h.spoken).toHaveLength(0);
    expect(h.scheduled).toHaveLength(1);
  });

  test("pause cancels speech; play resumes current entry from start", async () => {
    const h = makeHarness([
      { entryId: "a", speechText: "Hello" },
      { entryId: "b", speechText: "World" },
    ]);
    h.core.play();
    await flush();
    h.core.pause();
    expect(h.speechCancels).toBe(1);
    expect(h.core.getState().status).toBe("paused");
    h.core.play();
    await flush();
    expect(h.jumps).toEqual(["a", "a"]);
    expect(h.spoken).toHaveLength(2);
  });

  test("next and prev move within bounds; prev at 0 stays 0", async () => {
    const h = makeHarness([
      { entryId: "a", speechText: "A" },
      { entryId: "b", speechText: "B" },
      { entryId: "c", speechText: "C" },
    ]);
    h.core.play();
    await flush();
    expect(h.core.getState().index).toBe(0);
    h.core.next();
    await flush();
    expect(h.core.getState().index).toBe(1);
    h.core.prev();
    await flush();
    expect(h.core.getState().index).toBe(0);
    h.core.prev();
    await flush();
    expect(h.core.getState().index).toBe(0);
  });

  test("next past the end stops playback (idle)", async () => {
    const h = makeHarness([
      { entryId: "a", speechText: "A" },
      { entryId: "b", speechText: "B" },
    ]);
    h.core.play();
    await flush();
    h.core.next();
    await flush();
    expect(h.core.getState().index).toBe(1);
    h.core.next();
    await flush();
    expect(h.core.getState().status).toBe("idle");
    expect(h.core.getState().index).toBe(-1);
  });

  test("setRate while playing restarts current entry with new rate", async () => {
    const h = makeHarness([
      { entryId: "a", speechText: "Hello" },
      { entryId: "b", speechText: "World" },
    ]);
    h.core.play();
    await flush();
    expect(h.spoken[0].rate).toBe(1);
    h.core.setRate(1.5);
    await flush();
    expect(h.spoken).toHaveLength(2);
    expect(h.spoken[1].rate).toBe(1.5);
    expect(h.core.getState().index).toBe(0);
  });

  test("speechAvailable false falls back to timer", async () => {
    const h = makeHarness([{ entryId: "a", speechText: "Hello" }], {
      speechAvailable: false,
    });
    h.core.play();
    await flush();
    expect(h.spoken).toHaveLength(0);
    expect(h.scheduled).toHaveLength(1);
  });

  test("play with no items does nothing (idle)", () => {
    const h = makeHarness([]);
    h.core.play();
    expect(h.core.getState().status).toBe("idle");
    expect(h.states).toHaveLength(0);
  });

  test("jump rejection still advances playback", async () => {
    const states: PlayerState[] = [];
    let callCount = 0;
    const items = [
      { entryId: "a", speechText: "Hello" },
      { entryId: "b", speechText: "World" },
    ];
    const deps: PlayerCoreDeps = {
      items: () => items,
      jump: () => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("jump failed"));
        return Promise.resolve();
      },
      speak: () => () => undefined,
      schedule: () => () => undefined,
      displayMs: () => 3000,
      speechAvailable: () => true,
      onStateChange: (s) => states.push(s),
    };
    const core = createAnnotationPlayerCore(deps);
    core.play();
    await flush();
    // Should still be playing (not stuck/stopped) after jump rejection
    expect(core.getState().status).toBe("playing");
    expect(core.getState().index).toBe(0);
  });
});
