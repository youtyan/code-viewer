import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { AnnotationEntry } from "../core/types";
import { createAnnotationsPlayer } from "../views/annotations-player";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "speechSynthesis");
  Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance");
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setupSpeechSynthesis() {
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      getVoices: () => [],
      addEventListener: () => undefined,
      cancel: () => undefined,
      speak: () => undefined,
    },
  });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    value: class {
      rate = 1;
      lang = "";
      voice: SpeechSynthesisVoice | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;

      constructor(readonly text: string) {}
    },
  });
}

function setupDom() {
  document.body.innerHTML = `
    <div id="annotation-player" hidden>
      <button id="annotation-player-toggle" type="button" title="legacy">legacy</button>
      <button id="annotation-player-prev" type="button" title="legacy">legacy</button>
      <button id="annotation-player-next" type="button" title="legacy">legacy</button>
      <span id="annotation-player-progress"></span>
      <button id="annotation-player-mute" type="button" title="legacy">legacy</button>
      <select id="annotation-player-rate" title="Speed" aria-label="Playback speed">
        <option value="0.5">0.5x</option>
        <option value="0.75">0.75x</option>
        <option value="1" selected>1x</option>
        <option value="1.25">1.25x</option>
        <option value="1.5">1.5x</option>
        <option value="2">2x</option>
      </select>
    </div>
  `;
}

function createHarness() {
  setupSpeechSynthesis();
  setupDom();
  const entries = [
    { id: "entry-1", body: "Sample annotation" } as AnnotationEntry,
  ];
  let muted = false;
  let panelOpen = false;
  const changedCallbacks: Array<() => void> = [];
  const openedCallbacks: Array<(entryId: string) => void> = [];
  const openedEntries: string[] = [];
  createAnnotationsPlayer({
    $: <T extends Element>(sel: string) => {
      const found = document.querySelector(sel);
      if (!found) throw new Error(`Missing test element: ${sel}`);
      return found as T;
    },
    getActiveSessionEntries: () => entries,
    openAnnotationEntry: (entryId) => {
      openedEntries.push(entryId);
      return Promise.resolve();
    },
    setAnnotationPanelOpen: (open) => {
      panelOpen = open;
    },
    onAnnotationsChanged: (cb) => {
      changedCallbacks.push(cb);
    },
    onAnnotationOpened: (cb) => {
      openedCallbacks.push(cb);
    },
    getActiveAnnotationId: () => null,
    getMuted: () => muted,
    setMuted: (value) => {
      muted = value;
    },
    getRate: () => undefined,
    setRate: () => undefined,
  });
  return {
    changedCallbacks,
    openedCallbacks,
    openedEntries,
    get panelOpen() {
      return panelOpen;
    },
  };
}

function button(id: string) {
  const found = document.querySelector<HTMLButtonElement>(id);
  if (!found) throw new Error(`Missing test button: ${id}`);
  return found;
}

describe("annotations player UI", () => {
  test("renders icon-only controls with accessible labels", () => {
    createHarness();
    const toggle = button("#annotation-player-toggle");
    const prev = button("#annotation-player-prev");
    const next = button("#annotation-player-next");
    const mute = button("#annotation-player-mute");

    expect(
      document.querySelector("#annotation-player")?.hasAttribute("hidden"),
    ).toBe(false);
    expect(toggle.querySelector("svg.octicon-play")).toBeTruthy();
    expect(prev.querySelector("svg.octicon-skip-back")).toBeTruthy();
    expect(next.querySelector("svg.octicon-skip-forward")).toBeTruthy();
    expect(mute.querySelector("svg.octicon-volume-unmuted")).toBeTruthy();
    expect(
      [toggle, prev, next, mute].map((control) => control.textContent).join(""),
    ).toBe("");
    expect(toggle.getAttribute("aria-label")).toBe("Play annotation playback");
    expect(mute.getAttribute("aria-label")).toBe("Mute annotation playback");
  });

  test("updates playback and mute icons when controls change state", async () => {
    const harness = createHarness();
    const toggle = button("#annotation-player-toggle");
    const prev = button("#annotation-player-prev");
    const next = button("#annotation-player-next");
    const mute = button("#annotation-player-mute");

    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(true);

    toggle.click();
    await flush();

    expect(harness.panelOpen).toBe(true);
    expect(harness.openedEntries).toEqual(["entry-1"]);
    expect(toggle.querySelector("svg.octicon-pause")).toBeTruthy();
    expect(toggle.getAttribute("aria-label")).toBe("Pause annotation playback");
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);

    mute.click();

    expect(mute.querySelector("svg.octicon-volume-muted")).toBeTruthy();
    expect(mute.getAttribute("aria-label")).toBe("Unmute annotation playback");
  });
});
