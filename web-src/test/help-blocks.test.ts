// ヘルプの本文の部品 (views/help-blocks.ts)。部品ごとに、出す DOM の形と操作を見る。
// 見た目 (文字・幅・行間) は help-typography-css.test.ts。

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
import {
  type HelpText,
  helpBlocks,
  helpInline,
  renderHelpTable,
  UI_TABLE_STRIPE_MIN_ROWS,
} from "../views/help-blocks";
import { helpFigure } from "../views/help-images";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});
afterAll(() => {
  GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** 要素の並びを「タグ.クラス:文字」の短い形にする (形を 1 行で比べるため)。 */
function shape(nodes: readonly Node[]): string[] {
  return nodes.map((node) => {
    if (!(node instanceof Element)) return `#text:${node.textContent}`;
    const cls = node.getAttribute("class");
    return `${node.tagName.toLowerCase()}${cls ? `.${cls}` : ""}:${node.textContent}`;
  });
}

/** 本文の枠に入れて置く (画像の並びは本文の中で数える)。 */
function mount(...elements: HTMLElement[]): HTMLElement {
  const article = document.createElement("article");
  article.className = "gdp-help-content";
  article.append(...elements);
  document.body.appendChild(article);
  return article;
}

describe("the inline parts of a sentence", () => {
  test.each<{ name: string; text: HelpText; expected: string[] }>([
    { name: "plain text", text: "Open it.", expected: ["#text:Open it."] },
    {
      name: "inline code",
      text: { code: "code-viewer doctor" },
      expected: ["code:code-viewer doctor"],
    },
    {
      name: "a key cap",
      text: { key: "⌘K" },
      expected: ["kbd.gdp-help-key:⌘K"],
    },
    {
      name: "a button name",
      text: { ui: "Settings" },
      expected: ["b.gdp-help-ui:Settings"],
    },
    {
      name: "a mixed sentence",
      text: ["Press ", { ui: "Save" }, " or ", { key: "⌘S" }, "."],
      expected: [
        "#text:Press ",
        "b.gdp-help-ui:Save",
        "#text: or ",
        "kbd.gdp-help-key:⌘S",
        "#text:.",
      ],
    },
  ])("$name", ({ text, expected }) => {
    expect(shape(helpInline(text))).toEqual(expected);
  });

  test.each([
    {
      name: "a plain click opens in the app",
      init: {},
      opened: 1,
      prevented: true,
    },
    {
      name: "⌘-click is left to the browser",
      init: { metaKey: true },
      opened: 0,
      prevented: false,
    },
    {
      name: "Ctrl-click is left to the browser",
      init: { ctrlKey: true },
      opened: 0,
      prevented: false,
    },
    {
      name: "a middle click is left to the browser",
      init: { button: 1 },
      opened: 0,
      prevented: false,
    },
  ])("a link: $name", ({ init, opened, prevented }) => {
    const open = vi.fn();
    const [link] = helpInline({
      link: "Projects",
      href: "/help?section=projects",
      open,
    });
    if (!(link instanceof HTMLAnchorElement)) throw new Error("not a link");
    document.body.appendChild(link);
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    link.dispatchEvent(event);
    expect({
      href: link.getAttribute("href"),
      opened: open.mock.calls.length,
      prevented: event.defaultPrevented,
    }).toEqual({ href: "/help?section=projects", opened, prevented });
  });
});

describe("numbered steps", () => {
  const figure = helpFigure("en", "overview", "The screen right after start");

  test("a step puts its action, command, capture, sentence and link in that order", () => {
    const list = helpBlocks("en").steps([
      {
        title: "Start it",
        command: "npx @youtyan/code-viewer --open",
        figures: [figure],
        text: "The screen opens in the browser.",
        link: "→ Projects",
      },
    ]);
    expect(shape([...(list.querySelector("li")?.children ?? [])])).toEqual([
      "p.gdp-help-step-title:Start it",
      "div.gdp-help-command:npx @youtyan/code-viewer --open",
      "a.gdp-help-figure:",
      "p.gdp-help-step-text:The screen opens in the browser.",
      "p.gdp-help-step-link:→ Projects",
    ]);
  });

  test.each([
    {
      name: "a step without an action leads with its sentence",
      item: { text: "Open Settings.", figures: [figure] },
      expected: ["p.gdp-help-step-text:Open Settings.", "a.gdp-help-figure:"],
    },
    {
      name: "a plain string is the sentence",
      item: "Press Save.",
      expected: ["p.gdp-help-step-text:Press Save."],
    },
  ])("$name", ({ item, expected }) => {
    const list = helpBlocks("en").steps([item]);
    expect(shape([...(list.querySelector("li")?.children ?? [])])).toEqual(
      expected,
    );
  });

  test("each step is one numbered item", () => {
    const list = helpBlocks("en").steps(["One.", "Two.", "Three."]);
    expect([list.tagName, list.className, list.children.length]).toEqual([
      "OL",
      "gdp-help-steps",
      3,
    ]);
  });
});

describe("a capture", () => {
  const first = helpFigure("en", "overview", "First screen");
  const second = helpFigure("en", "agent-launch", "Second screen");

  test("links to the image and describes it", () => {
    const link = helpBlocks("en").figure(first);
    const img = link.querySelector("img");
    expect({
      href: link.getAttribute("href"),
      target: link.target,
      src: img?.getAttribute("src"),
      alt: img?.alt,
      loading: img?.getAttribute("loading"),
    }).toEqual({
      href: "/help-images/overview.en.webp",
      target: "_blank",
      src: "/help-images/overview.en.webp",
      alt: "First screen",
      loading: "lazy",
    });
  });

  test("a click opens it large with the other captures of the page, without a copy button", () => {
    const blocks = helpBlocks("en");
    const links = [blocks.figure(first), blocks.figure(second)];
    mount(...links);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    links[1]?.dispatchEvent(event);
    const box = document.querySelector(".terminal-lightbox");
    expect({
      prevented: event.defaultPrevented,
      src: box?.querySelector("img")?.getAttribute("src"),
      title: box?.querySelector(".terminal-lightbox-path")?.textContent,
      canGoBack: !box?.querySelector<HTMLButtonElement>(
        ".terminal-lightbox-nav button",
      )?.disabled,
      copy: box?.querySelector(".terminal-lightbox-copy") !== null,
    }).toEqual({
      prevented: true,
      src: "http://localhost/help-images/agent-launch.en.webp",
      title: "Second screen",
      canGoBack: true,
      copy: false,
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  test("⌘-click is left to the browser (a new tab)", () => {
    const link = helpBlocks("en").figure(first);
    mount(link);
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    link.dispatchEvent(event);
    expect([
      event.defaultPrevented,
      document.querySelector(".terminal-lightbox"),
    ]).toEqual([false, null]);
  });
});

describe("a note", () => {
  test.each([
    { lang: "en", kind: "warning", label: "Caution" },
    { lang: "en", kind: "info", label: "Note" },
    { lang: "ja", kind: "warning", label: "注意" },
    { lang: "ja", kind: "info", label: "補足" },
  ] as const)("$lang $kind is labeled $label", ({ lang, kind, label }) => {
    const note = helpBlocks(lang).note(kind, [
      "First.",
      ["Second ", { code: "x" }],
    ]);
    expect({
      tag: note.tagName,
      kind: note.dataset.kind,
      icon: note.querySelector(".gdp-help-note-icon svg") !== null,
      body: shape([
        ...(note.querySelector(".gdp-help-note-body")?.children ?? []),
      ]),
    }).toEqual({
      tag: "ASIDE",
      kind,
      icon: true,
      body: [`strong.gdp-help-note-label:${label}`, "p:First.", "p:Second x"],
    });
  });
});

describe("a command", () => {
  test("shows the command with an optional title", () => {
    const blocks = helpBlocks("en");
    expect([
      shape([...blocks.command("code-viewer doctor", "Check").children]),
      shape([...blocks.command("code-viewer doctor").children]),
    ]).toEqual([
      [
        "div.gdp-help-command-title:Check",
        "div.gdp-help-command-body:code-viewer doctor",
      ],
      ["div.gdp-help-command-body:code-viewer doctor"],
    ]);
  });

  test.each([
    { lang: "en", label: "Copy the command" },
    { lang: "ja", label: "コマンドをコピー" },
  ] as const)("the copy button copies the command ($lang)", async ({
    lang,
    label,
  }) => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const block = helpBlocks(lang).command("code-viewer skill install");
    const copy = block.querySelector<HTMLButtonElement>(
      ".gdp-help-command-copy",
    );
    const labelBefore = copy?.getAttribute("aria-label");
    copy?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect([labelBefore, writeText.mock.calls, copy?.dataset.copied]).toEqual([
      label,
      [["code-viewer skill install"]],
      "true",
    ]);
  });

  test("a failed copy shows the reason on the button and the console", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("permission denied")),
      },
    });
    const copy = helpBlocks("en")
      .command("code-viewer doctor")
      .querySelector<HTMLButtonElement>(".gdp-help-command-copy");
    copy?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([
      copy?.classList.contains("failed"),
      copy?.title.includes("permission denied"),
      errors.mock.calls.length,
    ]).toEqual([true, true, 1]);
  });
});

describe("folded details", () => {
  test.each([
    {
      name: "en default summary",
      lang: "en",
      summary: undefined,
      expected: "More details",
    },
    {
      name: "ja default summary",
      lang: "ja",
      summary: undefined,
      expected: "詳しく",
    },
    {
      name: "a given summary",
      lang: "en",
      summary: "How it works",
      expected: "How it works",
    },
  ] as const)("$name", ({ lang, summary, expected }) => {
    const blocks = helpBlocks(lang);
    const box = blocks.details([blocks.paragraph("Inside.")], summary);
    expect({
      open: box.open,
      summary: box.querySelector("summary")?.textContent,
      body: shape([
        ...(box.querySelector(".gdp-help-details-body")?.children ?? []),
      ]),
    }).toEqual({ open: false, summary: expected, body: ["p:Inside."] });
  });
});

describe("lists and tables", () => {
  test("a list holds one item per sentence", () => {
    const list = helpBlocks("en").list(["One.", ["Two ", { key: "t" }]]);
    expect([list.className, shape([...list.children])]).toEqual([
      "gdp-help-list",
      ["li:One.", "li:Two t"],
    ]);
  });

  test("a table puts the head in thead and the rows in tbody", () => {
    const table = helpBlocks("en").table(
      [
        ["SQLite does not open", [{ code: "rm -rf" }, " the cache"]],
        ["No tmux", "Install it"],
      ],
      ["Problem", "Fix"],
    );
    expect({
      head: [...table.querySelectorAll("thead th")].map((th) => th.textContent),
      rows: [...table.querySelectorAll("tbody tr")].map((tr) =>
        [...tr.children].map((cell) => cell.textContent),
      ),
    }).toEqual({
      head: ["Problem", "Fix"],
      rows: [
        ["SQLite does not open", "rm -rf the cache"],
        ["No tmux", "Install it"],
      ],
    });
  });

  test.each([
    { name: "one key", keys: "t", expected: ["kbd.gdp-help-key:t"] },
    {
      name: "two ways to press",
      keys: "Ctrl+K / Meta+K",
      expected: [
        "kbd.gdp-help-key:Ctrl+K",
        "#text: / ",
        "kbd.gdp-help-key:Meta+K",
      ],
    },
  ])("the key table splits $name into key caps", ({ keys, expected }) => {
    const table = renderHelpTable([[keys, "Open the palette"]]);
    expect([
      shape([...(table.querySelector("th")?.childNodes ?? [])]),
      table.querySelector("td")?.textContent,
    ]).toEqual([expected, "Open the palette"]);
  });

  test.each([
    { lang: "en", head: ["Key", "Action"] },
    { lang: "ja", head: ["キー", "操作"] },
  ] as const)("the key table of the help has a head row ($lang)", ({
    lang,
    head,
  }) => {
    const table = helpBlocks(lang).keyTable([["t", "Toggle the theme"]]);
    expect({
      classes: [...table.classList],
      head: [...table.querySelectorAll("thead th")].map((th) => th.textContent),
      rowHeader: table.querySelector("tbody th")?.getAttribute("scope"),
    }).toEqual({
      classes: ["ui-table", "ui-table-keys"],
      head: [...head],
      rowHeader: "row",
    });
  });

  // 行の多い表だけ 1 行おきに面を敷く (境目は UI_TABLE_STRIPE_MIN_ROWS)。
  test.each([
    { name: "1 row", rows: 1, striped: false },
    { name: "just below the limit", rows: 7, striped: false },
    { name: "at the limit", rows: 8, striped: true },
    { name: "just above the limit", rows: 9, striped: true },
  ])("a table with $name is striped: $striped", ({ rows, striped }) => {
    const blocks = helpBlocks("en");
    const cells = Array.from({ length: rows }, () => ["a", "b"]);
    expect([
      UI_TABLE_STRIPE_MIN_ROWS,
      blocks.table(cells).classList.contains("ui-table-striped"),
      blocks
        .keyTable(cells.map(() => ["t", "b"] as [string, string]))
        .classList.contains("ui-table-striped"),
    ]).toEqual([8, striped, striped]);
  });
});
