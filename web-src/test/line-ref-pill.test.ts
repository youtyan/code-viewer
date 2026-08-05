import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { createLineRefPill } from "../views/line-ref-pill";

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
