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

  // 本文の中の `[…](#見出し)` も目次と同じく自分で送る (ブラウザに任せると # が
  // 変わったあとの描き直しで先頭へ戻り、押しても動かなかった)。
  test("an in-document link scrolls its pane to the heading", async () => {
    const pane = createScrollablePane();
    document.body.appendChild(pane);
    pane.appendChild(
      await renderMarkdownPreview(
        ["[jump](#second)", "", "# First", "", "body", "", "# Second", ""].join(
          "\n",
        ),
        { path: "scratchpad.md", ref: "worktree" },
        { syntaxHighlight: false },
      ),
    );
    const link = [
      ...pane.querySelectorAll<HTMLAnchorElement>(".markdown-body a"),
    ].find((item) => item.textContent === "jump");
    if (!link) throw new Error("expected the in-document link");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect([
      click.defaultPrevented,
      pane.scrolls.length,
      location.hash,
    ]).toEqual([true, 1, "#second"]);
  });

  // 本文の箱 (#content) の中で上に貼り付くファイルの見出しの下に、送った見出しを
  // 隠さない。箱の余白 18px + 貼り付く位置 -18px + 高さ 56px = 箱の上端から 56px。
  test("leaves room for the file header that sticks inside the pane", async () => {
    const pane = createScrollablePane();
    Object.defineProperty(pane, "scrollTop", {
      value: 1000,
      configurable: true,
    });
    pane.style.paddingTop = "18px";
    const header = document.createElement("div");
    header.className = "gdp-file-detail-sticky";
    header.style.position = "sticky";
    header.style.top = "-18px";
    header.getBoundingClientRect = () => new DOMRect(0, 0, 400, 56);
    pane.appendChild(header);
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

    // 見出しと箱の上端はどちらも 0 (happy-dom は配置しない): 1000 - 56 - 12。
    expect(pane.scrolls).toEqual([932]);
  });
});
