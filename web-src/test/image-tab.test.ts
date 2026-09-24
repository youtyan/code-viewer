import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { TerminalImageRef } from "../core/terminal-images";
import { createImageTabView, type ImageTabHandle } from "../views/image-tab";
import { contrastRatio } from "./_color-contrast";
import { themeVariants } from "./_color-themes";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

const FIRST: TerminalImageRef = {
  path: "/tmp/sample-image.png",
  candidate: "/tmp/sample-image.png",
  name: "sample-image.png",
  url: "/image/first",
  bytes: 100,
  mtimeMs: 1,
};

const SECOND: TerminalImageRef = {
  path: "/tmp/second-image.png",
  candidate: "/tmp/second-image.png",
  name: "second-image.png",
  url: "/image/second",
  bytes: 200,
  mtimeMs: 2,
};

const THIRD: TerminalImageRef = {
  path: "/tmp/third-image.png",
  candidate: "/tmp/third-image.png",
  name: "third-image.png",
  url: "/image/third",
  bytes: 300,
  mtimeMs: 3,
};

const handles: ImageTabHandle[] = [];

function rect(width: number, height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}

function createView(options?: {
  image?: TerminalImageRef;
  images?: readonly TerminalImageRef[];
  copyPath?: (path: string) => Promise<void>;
  openPath?: (path: string) => Promise<void>;
  close?: () => void;
  language?: "en" | "ja";
}): ImageTabHandle {
  const view = createImageTabView({
    image: options?.image ?? FIRST,
    images: options?.images,
    imageUrlFor: (image) => image.url,
    copyPath: options?.copyPath ?? (() => Promise.resolve()),
    openPath: options?.openPath ?? (() => Promise.resolve()),
    close: options?.close ?? (() => undefined),
    language: options?.language ?? "en",
  });
  handles.push(view);
  document.body.append(view.el);
  return view;
}

function loadImage(
  view: ImageTabHandle,
  options: {
    naturalWidth?: number;
    naturalHeight?: number;
    canvasWidth?: number;
  } = {},
): HTMLImageElement {
  const naturalWidth = options.naturalWidth ?? 1600;
  const naturalHeight = options.naturalHeight ?? 1000;
  const canvasWidth = options.canvasWidth ?? 800;
  const canvas = view.el.querySelector<HTMLElement>(".image-tab-canvas");
  const picture = view.el.querySelector<HTMLImageElement>("img");
  if (!canvas || !picture) throw new Error("image tab did not mount its image");
  vi.spyOn(canvas, "getBoundingClientRect").mockImplementation(() =>
    rect(canvasWidth, 600),
  );
  Object.defineProperties(picture, {
    naturalWidth: { configurable: true, value: naturalWidth },
    naturalHeight: { configurable: true, value: naturalHeight },
  });
  vi.spyOn(picture, "getBoundingClientRect").mockImplementation(() => {
    const displayedWidth = Number.parseFloat(picture.style.width);
    const displayedHeight = Number.parseFloat(picture.style.height);
    return rect(
      Number.isFinite(displayedWidth) ? displayedWidth : naturalWidth,
      Number.isFinite(displayedHeight) ? displayedHeight : naturalHeight,
    );
  });
  picture.dispatchEvent(new Event("load"));
  return picture;
}

function press(
  view: ImageTabHandle,
  key: string,
  modifiers: KeyboardEventInit = {},
): void {
  view.el.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...modifiers,
    }),
  );
}

function installResizeObserver(): {
  trigger(width: number): void;
  disconnected: ReturnType<typeof vi.fn>;
} {
  let callback: ResizeObserverCallback | null = null;
  let observer: ResizeObserver | null = null;
  const disconnected = vi.fn();
  const observed = new Set<Element>();
  class FakeResizeObserver {
    constructor(next: ResizeObserverCallback) {
      callback = next;
      observer = this as unknown as ResizeObserver;
    }
    observe(target: Element): void {
      observed.add(target);
    }
    unobserve(target: Element): void {
      observed.delete(target);
    }
    disconnect(): void {
      observed.clear();
      disconnected();
    }
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return {
    trigger(width) {
      if (!callback || !observer)
        throw new Error("ResizeObserver was not installed");
      callback(
        [{ contentRect: rect(width, 600) } as ResizeObserverEntry],
        observer,
      );
    },
    disconnected,
  };
}

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("image tab zoom", () => {
  test.each([
    {
      name: "Fit width is based on rendered width",
      action: "fit",
      expected: "50%",
    },
    { name: "Actual size is 100%", action: "actual", expected: "100%" },
    {
      name: "Zoom in advances one 20% step",
      action: "zoom-in",
      expected: "70%",
    },
    {
      name: "Zoom out advances one 20% step",
      action: "zoom-out",
      expected: "30%",
    },
  ])("$name", ({ action, expected }) => {
    const view = createView();
    loadImage(view);

    view.el
      .querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
      ?.click();

    expect(view.el.querySelector(".image-tab-scale")?.textContent).toBe(
      expected,
    );
  });

  test.each([
    { name: "+ zooms in", key: "+", expected: "70%" },
    { name: "- zooms out", key: "-", expected: "30%" },
    { name: "0 selects Actual size", key: "0", expected: "100%" },
    { name: "1 selects Fit width", key: "1", expected: "50%" },
  ])("$name", ({ key, expected }) => {
    const view = createView();
    loadImage(view);
    view.focus();

    press(view, key);

    expect(view.el.querySelector(".image-tab-scale")?.textContent).toBe(
      expected,
    );
  });
});

describe("image tab navigation", () => {
  test.each([
    {
      name: "right moves to the next image",
      key: "ArrowRight",
      expected: "/tmp/second-image.png",
    },
    {
      name: "left wraps to the last image",
      key: "ArrowLeft",
      expected: "/tmp/third-image.png",
    },
  ])("$name", ({ key, expected }) => {
    const view = createView({ images: [FIRST, SECOND, THIRD] });
    loadImage(view);
    view.focus();

    press(view, key);

    expect(view.el.querySelector(".image-tab-path")?.textContent).toBe(
      expected,
    );
  });

  test("previous and next buttons move without changing their boxes", () => {
    const view = createView({ images: [FIRST, SECOND, THIRD] });
    loadImage(view);

    view.el.querySelector<HTMLButtonElement>('[data-action="next"]')?.click();
    expect(view.el.querySelector(".image-tab-path")?.textContent).toBe(
      "/tmp/second-image.png",
    );
    view.el
      .querySelector<HTMLButtonElement>('[data-action="previous"]')
      ?.click();
    expect(view.el.querySelector(".image-tab-path")?.textContent).toBe(
      "/tmp/sample-image.png",
    );
  });

  test("keys do nothing while focus is outside the component", () => {
    const view = createView({ images: [FIRST, SECOND] });
    loadImage(view);

    press(view, "ArrowRight");
    expect(view.el.querySelector(".image-tab-path")?.textContent).toBe(
      "/tmp/sample-image.png",
    );

    view.focus();
    press(view, "ArrowRight");
    expect(view.el.querySelector(".image-tab-path")?.textContent).toBe(
      "/tmp/second-image.png",
    );
  });

  test("a late failure from the previous image does not replace current state", () => {
    const view = createView({ images: [FIRST, SECOND] });
    const firstPicture = view.el.querySelector<HTMLImageElement>("img");

    view.el.querySelector<HTMLButtonElement>('[data-action="next"]')?.click();
    firstPicture?.dispatchEvent(new Event("error"));

    expect(view.el.querySelector(".image-tab-path")?.textContent).toBe(
      "/tmp/second-image.png",
    );
    expect(view.el.querySelector(".image-tab-status")?.textContent).toBe(
      "Loading image…",
    );
  });
});

describe("image tab layout and failures", () => {
  test.each([
    { name: "719px uses the two-row toolbar", width: 719, expected: "true" },
    { name: "720px keeps the one-row toolbar", width: 720, expected: "false" },
  ])("$name", ({ width, expected }) => {
    const resize = installResizeObserver();
    const view = createView();

    resize.trigger(width);

    expect(view.el.dataset.narrow).toBe(expected);
  });

  test("an unreadable image leaves the load reason inside the component", () => {
    const view = createView();
    const picture = view.el.querySelector<HTMLImageElement>("img");
    picture?.dispatchEvent(new Event("error"));

    const failure = view.el.querySelector<HTMLElement>(".image-tab-status");
    expect(failure?.getAttribute("role")).toBe("alert");
    expect(failure?.textContent).toContain("Could not load the image.");
    expect(failure?.textContent).toContain("/tmp/sample-image.png");
    expect(failure?.textContent).toContain("Event: error");
    expect(picture?.hidden).toBe(true);
  });

  test.each([
    {
      name: "copy delegates the current path",
      action: "copy",
      expectedCall: "copy",
    },
    {
      name: "open delegates the current path",
      action: "open",
      expectedCall: "open",
    },
  ])("$name", async ({ action, expectedCall }) => {
    const copyPath = vi.fn(() => Promise.resolve());
    const openPath = vi.fn(() => Promise.resolve());
    const calls = { copy: copyPath, open: openPath };
    const view = createView({ copyPath, openPath });

    view.el
      .querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
      ?.click();
    await Promise.resolve();

    expect(calls[expectedCall as keyof typeof calls]).toHaveBeenCalledWith(
      "/tmp/sample-image.png",
    );
  });

  test("a late copy success does not mark a different image as copied", async () => {
    let resolveCopy: (() => void) | null = null;
    const copyPath = () =>
      new Promise<void>((resolve) => {
        resolveCopy = resolve;
      });
    const view = createView({ images: [FIRST, SECOND], copyPath });
    view.el.querySelector<HTMLButtonElement>('[data-action="copy"]')?.click();

    view.el.querySelector<HTMLButtonElement>('[data-action="next"]')?.click();
    if (!resolveCopy) throw new Error("copy operation did not start");
    resolveCopy();
    await Promise.resolve();

    expect(
      view.el.querySelector<HTMLButtonElement>('[data-action="copy"]')?.dataset
        .copied,
    ).toBe("false");
  });

  test("language changes update visible controls and a retained failure", () => {
    const view = createView();
    view.el.querySelector("img")?.dispatchEvent(new Event("error"));

    view.setLanguage("ja");

    expect(
      view.el.querySelector<HTMLButtonElement>('[data-action="actual"]')
        ?.textContent,
    ).toBe("等倍");
    expect(view.el.querySelector(".image-tab-status")?.textContent).toContain(
      "画像を読み込めませんでした。",
    );
  });

  test("dispose disconnects width observation", () => {
    const resize = installResizeObserver();
    const view = createView();

    view.dispose();

    expect(resize.disconnected).toHaveBeenCalledTimes(1);
  });
});

describe("image tab close", () => {
  test.each([
    { name: "English", language: "en" as const, label: "Close" },
    { name: "Japanese", language: "ja" as const, label: "閉じる" },
  ])("the close button shows the X, the word and Esc ($name)", ({
    language,
    label,
  }) => {
    const view = createView({ language });

    const close = view.el.querySelector<HTMLButtonElement>(
      '.image-tab-actions [data-action="close"]',
    );

    expect({
      icon: close?.querySelector("svg.image-tab-icon") !== null,
      label: close?.querySelector("span")?.textContent,
      key: close?.querySelector("kbd")?.textContent,
      name: close?.getAttribute("aria-label"),
      last: close?.parentElement?.lastElementChild === close,
    }).toEqual({ icon: true, label, key: "Esc", name: label, last: true });
  });

  test("switching the language relabels the close button", () => {
    const view = createView();

    view.setLanguage("ja");

    expect(
      view.el.querySelector('[data-action="close"] span')?.textContent,
    ).toBe("閉じる");
  });

  test("pressing the close button asks the embedder to close the tab", () => {
    const close = vi.fn();
    const view = createView({ close });

    view.el.querySelector<HTMLButtonElement>('[data-action="close"]')?.click();

    expect(close).toHaveBeenCalledTimes(1);
  });

  test.each([
    { name: "Esc closes", key: "Escape", modifiers: {}, calls: 1 },
    {
      name: "Shift+Esc closes",
      key: "Escape",
      modifiers: { shiftKey: true },
      calls: 1,
    },
    {
      name: "Ctrl+Esc is left alone",
      key: "Escape",
      modifiers: { ctrlKey: true },
      calls: 0,
    },
    {
      name: "Cmd+Esc is left alone",
      key: "Escape",
      modifiers: { metaKey: true },
      calls: 0,
    },
    {
      name: "Alt+Esc is left alone",
      key: "Escape",
      modifiers: { altKey: true },
      calls: 0,
    },
    { name: "Enter does not close", key: "Enter", modifiers: {}, calls: 0 },
    { name: "Delete does not close", key: "Delete", modifiers: {}, calls: 0 },
    { name: "x does not close", key: "x", modifiers: {}, calls: 0 },
    {
      name: "Backspace does not close",
      key: "Backspace",
      modifiers: {},
      calls: 0,
    },
  ])("$name while the image tab has focus", ({ key, modifiers, calls }) => {
    const close = vi.fn();
    const view = createView({ close });
    view.focus();

    press(view, key, modifiers);

    expect(close).toHaveBeenCalledTimes(calls);
  });

  test("Esc does nothing while focus is outside the image tab", () => {
    const close = vi.fn();
    const view = createView({ close });

    press(view, "Escape");

    expect(close).toHaveBeenCalledTimes(0);
  });
});

describe("image tab close look", () => {
  const rules = baseRules(loadStyleSheet());
  const plain = cascadedDeclarations(rules, (s) => s === ".image-tab-button");
  const close = cascadedDeclarations(
    rules,
    (s) => s === ".image-tab-button.image-tab-close",
  );
  const toolbar = cascadedDeclarations(
    rules,
    (s) => s === ".image-tab-toolbar",
  );

  // 枠の色だけを比べる (ほかのボタンの枠は border の一括指定の最後の語)。
  // 全部のテーマ × 明暗。
  test.each(
    themeVariants(rules),
  )("the close border stands out more than the other buttons' ($name)", ({
    vars,
  }) => {
    const ground = resolveVar(toolbar.get("background") ?? "", vars);
    const plainBorder = resolveVar(
      (plain.get("border") ?? "").split(" ").pop() ?? "",
      vars,
    );
    const closeBorder = resolveVar(close.get("border-color") ?? "", vars);

    expect(contrastRatio(closeBorder, ground)).toBeGreaterThan(
      contrastRatio(plainBorder, ground),
    );
  });
});
