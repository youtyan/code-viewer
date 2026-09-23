import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { createLineRefPill, readRenderedLines } from "../views/line-ref-pill";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("line reference pill repository actions", () => {
  test("shows an open action and copies the GitHub line URL", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied.push(value);
        },
      },
    });
    const githubUrl =
      "https://github.com/example/sample/blob/main/src/index.ts#L10-L12";
    const pill = createLineRefPill({
      onClose() {
        /* noop */
      },
      githubUrlForSelection: () => githubUrl,
      copyReferenceLabel: () => "Copy AI reference",
      lineCountLabel: (count) => `${count} lines`,
      githubOpenTitle: () => "Open selected lines on GitHub",
      githubCopyTitle: () => "Copy GitHub link",
    });

    pill.show("src/index.ts", 10, 12);

    const open = document.querySelector<HTMLAnchorElement>(
      "#line-ref-pill-github-open",
    );
    const copy = document.querySelector<HTMLButtonElement>(
      "#line-ref-pill-github-copy",
    );
    expect(open?.href).toBe(githubUrl);
    expect(open?.target).toBe("_blank");
    expect(open?.getAttribute("aria-label")).toBe(
      "Open selected lines on GitHub",
    );
    expect(open?.textContent).toBe("Open selected lines on GitHub");
    expect(copy?.getAttribute("aria-label")).toBe("Copy GitHub link");
    expect(copy?.textContent).toBe("Copy GitHub link");
    expect(
      document.querySelector("#line-ref-pill-copy .lrp-label")?.textContent,
    ).toBe("Copy AI reference");

    copy?.click();
    await Promise.resolve();
    expect(copied).toEqual([githubUrl]);
  });

  test("hides GitHub actions when the selection has no GitHub target", () => {
    const pill = createLineRefPill({
      onClose() {
        /* noop */
      },
      githubUrlForSelection: () => null,
      copyReferenceLabel: () => "Copy AI reference",
      lineCountLabel: (count) => `${count} lines`,
      githubOpenTitle: () => "Open selected lines on GitHub",
      githubCopyTitle: () => "Copy GitHub link",
    });

    pill.show("src/index.ts", 10, 12);

    expect(
      document.querySelector<HTMLElement>("#line-ref-pill-github-actions")
        ?.hidden,
    ).toBe(true);
  });
});

describe("line reference pill line history action", () => {
  test("opens the line history for the selected range", () => {
    const opened: Array<[string, number, number]> = [];
    const pill = createLineRefPill({
      onClose() {
        /* noop */
      },
      githubUrlForSelection: () => null,
      copyReferenceLabel: () => "Copy AI reference",
      lineCountLabel: (count) => `${count} lines`,
      githubOpenTitle: () => "Open on GitHub",
      githubCopyTitle: () => "Copy GitHub link",
      lineHistoryTitle: () => "Line history",
      openLineHistory: (path, start, end) => {
        opened.push([path, start, end]);
      },
    });
    pill.show("src/index.ts", 12, 10);
    const button = document.querySelector<HTMLButtonElement>(
      "#line-ref-pill-history",
    );
    expect(button?.hidden).toBe(false);
    expect(button?.getAttribute("aria-label")).toBe("Line history");
    button?.click();
    expect(opened).toEqual([["src/index.ts", 10, 12]]);
  });

  test("stays hidden when the host does not provide line history", () => {
    createLineRefPill({
      onClose() {
        /* noop */
      },
      githubUrlForSelection: () => null,
      copyReferenceLabel: () => "Copy AI reference",
      lineCountLabel: (count) => `${count} lines`,
      githubOpenTitle: () => "Open on GitHub",
      githubCopyTitle: () => "Copy GitHub link",
    });
    expect(
      document.querySelector<HTMLButtonElement>("#line-ref-pill-history")
        ?.hidden,
    ).toBe(true);
  });
});

describe("line reference pill reads the pane that holds the selection", () => {
  // 同じパスを左右で別の ref に開いた形: 左の本文と右の面の箱に同じ data-path。
  function twoPanes(): { left: HTMLElement; right: HTMLElement } {
    const pane = (id: string, code: string) => {
      const root = document.createElement("div");
      root.id = id;
      root.innerHTML = `<div class="gdp-file-shell" data-path="src/sample.ts"><table class="gdp-source-table"><tr data-line="2"><td class="gdp-source-line-code">${code}</td></tr></table></div>`;
      document.body.append(root);
      return root;
    };
    return {
      left: pane("left-pane", "left line"),
      right: pane("right-pane", "right line"),
    };
  }

  test.each([
    { name: "the left pane", side: "left", expected: ["left line"] },
    { name: "the right pane", side: "right", expected: ["right line"] },
  ] as const)("readRenderedLines in $name", ({ side, expected }) => {
    const panes = twoPanes();
    expect(readRenderedLines("src/sample.ts", 2, 2, panes[side])).toEqual(
      expected,
    );
  });

  test("Shift+click copies the lines of the pane given to show, not the first match", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied.push(value);
        },
      },
    });
    const { right } = twoPanes();
    const pill = createLineRefPill({
      onClose() {
        /* noop */
      },
      githubUrlForSelection: () => null,
      copyReferenceLabel: () => "Copy AI reference",
      lineCountLabel: (count) => `${count} lines`,
      githubOpenTitle: () => "Open selected lines on GitHub",
      githubCopyTitle: () => "Copy GitHub link",
    });
    pill.show("src/sample.ts", 2, 2, () => right);
    document
      .querySelector<HTMLButtonElement>("#line-ref-pill-copy")
      ?.dispatchEvent(new MouseEvent("click", { shiftKey: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("right line");
    expect(copied[0]).not.toContain("left line");
  });

  test("a pane that is gone copies the reference alone", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied.push(value);
        },
      },
    });
    twoPanes();
    const pill = createLineRefPill({
      onClose() {
        /* noop */
      },
      githubUrlForSelection: () => null,
      copyReferenceLabel: () => "Copy AI reference",
      lineCountLabel: (count) => `${count} lines`,
      githubOpenTitle: () => "Open selected lines on GitHub",
      githubCopyTitle: () => "Copy GitHub link",
    });
    pill.show("src/sample.ts", 2, 2, () => null);
    document
      .querySelector<HTMLButtonElement>("#line-ref-pill-copy")
      ?.dispatchEvent(new MouseEvent("click", { shiftKey: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(copied).toEqual(["@src/sample.ts#2"]);
  });
});
