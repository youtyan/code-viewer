import "./_dom";
import { afterEach, expect, test, vi } from "vitest";
import type { ToolsState } from "../core/types";

const mermaid = vi.hoisted(() => ({
  drawn: [] as string[],
  lookChanged: null as null | (() => void),
  stopped: 0,
}));

vi.mock("../core/mermaid-loader", () => ({
  loadMermaid: () =>
    Promise.resolve({
      initialize: () => undefined,
      run: async ({ nodes }: { nodes: Element[] }) => {
        for (const node of nodes) {
          // mermaid は記法を innerHTML から読み、文字参照を戻す。中にコメントなど
          // 記法でないものが混ざると、記法の誤りになる。
          mermaid.drawn.push(node.innerHTML.replace(/&gt;/g, ">"));
          node.replaceChildren(
            document.createElementNS("http://www.w3.org/2000/svg", "svg"),
          );
        }
      },
    }),
  onMermaidLookChange: (listener: () => void) => {
    mermaid.lookChanged = listener;
    return () => {
      mermaid.stopped++;
    };
  },
}));

const { createToolsPresenter } = await import("../views/tools/tools-presenter");
const { flushRenders } = await import("../views/ui/render-queue");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("the Tools Mermaid pane draws again when the theme changes and stops watching when closed", async () => {
  const stored: ToolsState = {
    version: 1,
    activeTool: "mermaid",
    drafts: { mermaid: "graph TD; A-->B" },
  };
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => stored,
    }) as unknown as Response) as typeof fetch;
  document.body.innerHTML =
    '<div id="tools-sheet-overlay" hidden></div><aside id="tools-sheet" hidden inert></aside>';
  const tools = createToolsPresenter({
    $: <T extends Element = HTMLElement>(sel: string) =>
      document.querySelector<T>(sel),
    trackLoad: (promise) => promise,
    getLanguage: () => "en",
    actionHeaders: () => ({ "Content-Type": "application/json" }),
  });
  await tools.open();
  flushRenders();
  await settle();

  mermaid.lookChanged?.();
  flushRenders();
  await settle();
  tools.dispose();

  expect({ drawn: mermaid.drawn, stopped: mermaid.stopped }).toEqual({
    drawn: ["graph TD; A-->B", "graph TD; A-->B"],
    stopped: 1,
  });
});
