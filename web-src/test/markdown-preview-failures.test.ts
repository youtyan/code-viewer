import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";
import type { MermaidApi } from "../core/mermaid-loader";
import type { ShikiHighlighter } from "../core/shiki-loader";

const mermaidLoad = vi.hoisted(() => ({
  next: null as null | (() => Promise<MermaidApi>),
}));

vi.mock("../core/mermaid-loader", () => ({
  loadMermaid: () => {
    if (!mermaidLoad.next) throw new Error("mermaid load was not arranged");
    return mermaidLoad.next();
  },
}));

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const { renderMarkdownHtml, renderMarkdownPreview, resolveMarkdownLinkTarget } =
  await import("../core/markdown-preview");

const TARGET = { path: "docs/guide.md", ref: "worktree" };

let errorSpy = vi.spyOn(console, "error");

function captureConsoleErrors() {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
    /* asserted per test */
  });
}

afterEach(() => {
  errorSpy.mockRestore();
  mermaidLoad.next = null;
  document.body.replaceChildren();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("markdown preview failure paths", () => {
  test.each([
    {
      name: "a broken percent sequence in the path",
      href: "./bad%E0%A4%A.md",
      path: "docs/bad%E0%A4%A.md",
      hash: "",
    },
    {
      name: "a broken percent sequence in the fragment",
      href: "./other.md#part%ZZ",
      path: "docs/other.md",
      hash: "part%ZZ",
    },
  ])("$name keeps the link as written and returns the decode failure", ({
    href,
    path,
    hash,
  }) => {
    const link = resolveMarkdownLinkTarget(TARGET.path, href);
    expect(link).toMatchObject({ path, hash, directory: false });
    expect(link?.decodeError?.message).toContain("invalid percent-encoding");
    expect(link?.decodeError).toMatchObject({ cause: expect.any(URIError) });
  });

  test("a link that cannot be decoded is marked with the reason", () => {
    captureConsoleErrors();
    const host = document.createElement("div");
    host.innerHTML = renderMarkdownHtml(
      "[broken](./bad%E0%A4%A.md)",
      TARGET,
      null,
    );
    const anchor = host.querySelector("a");
    expect(anchor?.classList.contains("mkdp-link-decode-failed")).toBe(true);
    expect(anchor?.title).toContain("URIError");
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  test("a highlighter failure shows the code as text and says why", () => {
    captureConsoleErrors();
    const highlighter: ShikiHighlighter = {
      codeToHtml: () => {
        throw new Error("sample grammar failure");
      },
    } as unknown as ShikiHighlighter;
    const host = document.createElement("div");
    host.innerHTML = renderMarkdownHtml(
      "```ts\nconst a = 1 < 2;\n```",
      TARGET,
      highlighter,
    );
    const pre = host.querySelector("pre");
    expect(pre?.classList.contains("gdp-highlight-failed")).toBe(true);
    expect(pre?.title).toContain("Error: sample grammar failure");
    expect(pre?.textContent).toBe("const a = 1 < 2;\n");
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  test("a refused code copy shows the reason on the button", async () => {
    captureConsoleErrors();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(new DOMException("sample refusal", "NotAllowedError")),
      },
    });
    const root = await renderMarkdownPreview("```\nplain\n```", TARGET, {
      syntaxHighlight: false,
    });
    const button = root.querySelector<HTMLButtonElement>(".mkdp-code-copy");
    button?.click();
    await settle();
    expect(button?.classList.contains("failed")).toBe(true);
    expect(button?.title).toContain("copying the code block failed");
    expect(button?.title).toContain("NotAllowedError: sample refusal");
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  test.each([
    {
      name: "Mermaid cannot be loaded",
      arrange: () => Promise.reject(new Error("sample bundle failure")),
      title: "Mermaid could not be loaded",
      detail: ["loading Mermaid failed", "Error: sample bundle failure"],
    },
    {
      name: "the batch render throws",
      arrange: () =>
        Promise.resolve({
          initialize: () => undefined,
          run: () => Promise.reject(new Error("sample render failure")),
        }),
      title: "Mermaid syntax error",
      detail: [
        "rendering Mermaid diagrams failed",
        "Error: sample render failure",
      ],
    },
  ])("when $name the diagram shows the reason", async ({
    arrange,
    title,
    detail,
  }) => {
    captureConsoleErrors();
    mermaidLoad.next = arrange;
    const root = await renderMarkdownPreview(
      "```mermaid\ngraph TD; A-->B\n```",
      TARGET,
      { syntaxHighlight: false },
    );
    await settle();
    expect(root.querySelector(".mkdp-mermaid-error-title")?.textContent).toBe(
      title,
    );
    const text = root.querySelector(".mkdp-mermaid-error-detail")?.textContent;
    for (const part of detail) expect(text).toContain(part);
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  test("a diagram that cannot be measured opens with the layout size and says so", async () => {
    captureConsoleErrors();
    // The lightbox measures a clone, so the failure goes on the prototype.
    const proto = Object.getPrototypeOf(
      document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    ) as SVGSVGElement & { getBBox?: unknown };
    const originalGetBBox = Object.getOwnPropertyDescriptor(proto, "getBBox");
    Object.defineProperty(proto, "getBBox", {
      configurable: true,
      value: () => {
        throw new Error("sample measure failure");
      },
    });
    onTestFinished(() => {
      if (originalGetBBox)
        Object.defineProperty(proto, "getBBox", originalGetBBox);
      else delete proto.getBBox;
    });
    mermaidLoad.next = () =>
      Promise.resolve({
        initialize: () => undefined,
        run: async ({ nodes }: { nodes: Element[] }) => {
          for (const node of nodes) {
            node.replaceChildren(
              document.createElementNS("http://www.w3.org/2000/svg", "svg"),
            );
          }
        },
      });
    const root = await renderMarkdownPreview(
      "```mermaid\ngraph TD; A-->B\n```",
      TARGET,
      { syntaxHighlight: false },
    );
    document.body.appendChild(root);
    await settle();
    root
      .querySelector(".mermaid svg")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const hint = document.querySelector<HTMLElement>(".mkdp-lightbox-hint");
    expect(hint?.textContent).toContain("size estimated from the layout");
    expect(hint?.title).toContain("Error: sample measure failure");
    expect(errorSpy).toHaveBeenCalledOnce();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
});
