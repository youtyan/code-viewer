import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { renderMarkdownPreview } from "../core/markdown-preview";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const DOC = ["# First", "", "body", "", "# Second", "", "body", ""].join("\n");

type ScrollSpy = HTMLElement & { scrolls: number[] };

/** tools ドロワーの出力ペインのように、自前のスクロール領域を持つ入れ物。 */
function createScrollablePane(): ScrollSpy {
  const host = document.createElement("div") as unknown as ScrollSpy;
  host.style.overflowY = "auto";
  Object.defineProperty(host, "scrollHeight", {
    value: 2000,
    configurable: true,
  });
  Object.defineProperty(host, "clientHeight", {
    value: 200,
    configurable: true,
  });
  host.scrolls = [];
  host.scrollTo = ((options: ScrollToOptions) => {
    host.scrolls.push(options?.top ?? 0);
  }) as typeof host.scrollTo;
  return host;
}

let windowScrolls: number;

beforeEach(() => {
  document.body.replaceChildren();
  windowScrolls = 0;
  window.scrollTo = (() => {
    windowScrolls += 1;
  }) as typeof window.scrollTo;
});

describe("markdown table of contents navigation", () => {
  test("scrolls the containing pane instead of the window", async () => {
    const pane = createScrollablePane();
    document.body.appendChild(pane);
    pane.appendChild(
      await renderMarkdownPreview(
        DOC,
        { path: "scratchpad.md", ref: "worktree" },
        { syntaxHighlight: false },
      ),
    );

    const link = pane.querySelector<HTMLAnchorElement>(
      ".gdp-markdown-toc a[data-target]",
    );
    if (!link) throw new Error("expected a table of contents entry");
    link.click();

    expect(pane.scrolls.length).toBe(1);
    expect(windowScrolls).toBe(0);
  });

  test("falls back to the window when nothing around it scrolls", async () => {
    const plain = document.createElement("div");
    document.body.appendChild(plain);
    plain.appendChild(
      await renderMarkdownPreview(
        DOC,
        { path: "scratchpad.md", ref: "worktree" },
        { syntaxHighlight: false },
      ),
    );

    const link = plain.querySelector<HTMLAnchorElement>(
      ".gdp-markdown-toc a[data-target]",
    );
    if (!link) throw new Error("expected a table of contents entry");
    link.click();

    expect(windowScrolls).toBe(1);
  });
});
