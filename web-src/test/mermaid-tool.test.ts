import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

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
          mermaid.drawn.push(node.textContent ?? "");
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

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const { createMermaidTool } = await import("../views/tools/mermaid-tool");
const { toolsText } = await import("../views/tools/i18n");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the Tools Mermaid pane draws again when the theme changes and stops watching when closed", async () => {
  const typed: string[] = [];
  const tool = createMermaidTool(toolsText("en"), "graph TD; A-->B", (value) =>
    typed.push(value),
  );
  document.body.appendChild(tool.el);
  tool.refresh();
  await settle();

  mermaid.lookChanged?.();
  await settle();
  tool.dispose();

  expect({ drawn: mermaid.drawn, stopped: mermaid.stopped, typed }).toEqual({
    drawn: ["graph TD; A-->B", "graph TD; A-->B"],
    stopped: 1,
    typed: [],
  });
});
