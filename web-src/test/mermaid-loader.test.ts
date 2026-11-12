import "./_dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PROJECT_COLORS } from "../core/project-colors";

const bundle = vi.hoisted(() => ({ initialize: vi.fn() }));

vi.mock("../core/lazy-bundle", () => ({
  createBundleLoader: () => () =>
    Promise.resolve({
      default: { initialize: bundle.initialize, run: () => Promise.resolve() },
    }),
}));

const DARK_LOOK: Record<string, string> = {
  "--color-doc": "#101018",
  "--color-inset": "#0a0a10",
  "--color-raised": "#202030",
  "--color-select": "#302848",
  "--color-text": "#eeeef4",
  "--color-text-2": "#aaaab8",
  "--color-text-3": "#888898",
  "--color-line-strong": "#3a3a48",
  "--color-accent": "#9e87dd",
  "--font-ui": "sans-serif",
  "--project-ink": "#16121f",
  // プロジェクトの色は並びの番号の色 (1 番目が #000001)。mermaid には読める
  // 色の値しか渡せないので、見本も色の値にする。
  ...Object.fromEntries(
    PROJECT_COLORS.map((color, i) => [
      `--project-${color}`,
      `#${(i + 1).toString(16).padStart(6, "0")}`,
    ]),
  ),
};

function setLook(theme: "light" | "dark", look: Record<string, string>) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  for (const [name, value] of Object.entries(look))
    root.style.setProperty(name, value);
}

// MutationObserver の知らせはマイクロタスクで届く。
const flushObservers = () => new Promise((resolve) => setTimeout(resolve, 0));

// アプリの色の名前の値には color-mix() で書いたものがある。mermaid 12 はそれを
// 読めずに図ごと描けなかったので、塗って読み戻した実際の色にして渡す。
describe("mermaidColor", () => {
  const painted =
    (rgba: readonly [number, number, number, number] | null) => () =>
      rgba;

  test.each([
    ["a hex color goes as it is", "#0d1117", null, "#0d1117"],
    ["rgb() goes as it is", "rgb(1, 2, 3)", null, "rgb(1, 2, 3)"],
    [
      "color-mix() becomes the painted color",
      "color-mix(in srgb, #f0f6fc 20%, #0d1117)",
      [58, 64, 71, 255] as const,
      "#3a4047",
    ],
    [
      "a see-through color keeps its alpha",
      "color-mix(in srgb, #f0f6fc 20%, transparent)",
      [240, 246, 252, 51] as const,
      "rgba(240, 246, 252, 0.2)",
    ],
  ])("%s", async (_name, value, rgba, expected) => {
    const { mermaidColor } = await import("../core/mermaid-loader");
    expect(mermaidColor(value, "--sample", painted(rgba))).toBe(expected);
  });

  test("names the variable whose color cannot be read", async () => {
    const { mermaidColor } = await import("../core/mermaid-loader");
    expect(() =>
      mermaidColor(
        "color-mix(in nowhere, red, blue)",
        "--sample",
        painted(null),
      ),
    ).toThrow(
      "Mermaid colors: --sample (color-mix(in nowhere, red, blue)) could not be turned into a color mermaid reads",
    );
  });
});

describe("loadMermaid", () => {
  beforeEach(() => {
    vi.resetModules();
    bundle.initialize.mockReset();
  });

  afterEach(() => {
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.colorTheme;
  });

  test("draws with the app colors of the current theme", async () => {
    setLook("dark", DARK_LOOK);
    const { loadMermaid } = await import("../core/mermaid-loader");

    await loadMermaid();

    expect(bundle.initialize).toHaveBeenCalledOnce();
    expect(bundle.initialize.mock.calls[0][0]).toMatchObject({
      theme: "base",
      securityLevel: "strict",
      themeVariables: {
        darkMode: true,
        background: "#101018",
        primaryColor: "#302848",
        primaryTextColor: "#eeeef4",
        lineColor: "#aaaab8",
        edgeLabelBackground: "#101018",
        clusterBkg: "#0a0a10",
        noteBkgColor: "#202030",
        pie1: "#000001",
        pie9: "#000009",
        pieSectionTextColor: "#16121f",
        cScaleLabel0: "#16121f",
      },
    });
  });

  test("does not set the colors again while the theme stays the same", async () => {
    setLook("dark", DARK_LOOK);
    const { loadMermaid } = await import("../core/mermaid-loader");

    await loadMermaid();
    await loadMermaid();

    expect(bundle.initialize).toHaveBeenCalledOnce();
  });

  test("sets the colors again after the theme changes", async () => {
    setLook("dark", DARK_LOOK);
    const { loadMermaid } = await import("../core/mermaid-loader");
    await loadMermaid();

    setLook("light", { "--color-doc": "#fafafa", "--color-text": "#222222" });
    await loadMermaid();

    expect(bundle.initialize).toHaveBeenCalledTimes(2);
    expect(bundle.initialize.mock.calls[1][0]).toMatchObject({
      themeVariables: {
        darkMode: false,
        background: "#fafafa",
        textColor: "#222222",
      },
    });
  });

  test("names the color the stylesheet left empty", async () => {
    setLook("dark", DARK_LOOK);
    document.documentElement.style.removeProperty("--color-text-2");
    const { loadMermaid } = await import("../core/mermaid-loader");

    await expect(loadMermaid()).rejects.toThrow(
      "Mermaid colors: the CSS variable --color-text-2 has no value",
    );
    expect(bundle.initialize).not.toHaveBeenCalled();
  });
});

describe("onMermaidLookChange", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.colorTheme;
    delete document.documentElement.dataset.sample;
  });

  test.each([
    {
      name: "switching light to dark",
      act: (root: HTMLElement) => {
        root.dataset.theme = "dark";
      },
      calls: 1,
    },
    {
      name: "picking a color theme",
      act: (root: HTMLElement) => {
        root.dataset.colorTheme = "ink";
      },
      calls: 1,
    },
    {
      name: "writing the same theme again",
      act: (root: HTMLElement) => {
        root.dataset.theme = "light";
      },
      calls: 0,
    },
    {
      name: "changing an unrelated attribute",
      act: (root: HTMLElement) => {
        root.dataset.sample = "1";
      },
      calls: 0,
    },
  ])("$name calls the listener $calls time(s)", async ({ act, calls }) => {
    const root = document.documentElement;
    root.dataset.theme = "light";
    const { onMermaidLookChange } = await import("../core/mermaid-loader");
    const listener = vi.fn();
    const stop = onMermaidLookChange(listener);

    act(root);
    await flushObservers();

    expect(listener).toHaveBeenCalledTimes(calls);
    stop();
  });

  test("stops calling after the returned function is called", async () => {
    document.documentElement.dataset.theme = "light";
    const { onMermaidLookChange } = await import("../core/mermaid-loader");
    const listener = vi.fn();
    const stop = onMermaidLookChange(listener);

    stop();
    document.documentElement.dataset.theme = "dark";
    await flushObservers();

    expect(listener).not.toHaveBeenCalled();
  });
});
