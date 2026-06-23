import { describe, expect, test } from "bun:test";
import {
  isDiffShellDomIntact,
  shouldRenderDiffSidebar,
} from "../views/diff-view";

function element(className: string, key?: string): Element {
  const classes = new Set(className.split(/\s+/).filter(Boolean));
  return {
    classList: {
      contains(name: string) {
        return classes.has(name);
      },
    },
    dataset: key ? { key } : {},
  } as unknown as Element;
}

function target(children: Element[]): Element {
  return { children } as unknown as Element;
}

describe("diff view fast path", () => {
  test("accepts the fast path only when direct diff cards match the file list", () => {
    expect(
      isDiffShellDomIntact(
        target([
          element("gdp-file-shell pending", "src/a.ts"),
          element("gdp-file-shell loaded", "src/b.ts"),
        ]),
        ["src/a.ts", "src/b.ts"],
      ),
    ).toBe(true);
    expect(
      isDiffShellDomIntact(
        target([
          element("gdp-file-shell pending", "src/b.ts"),
          element("gdp-file-shell loaded", "src/a.ts"),
        ]),
        ["src/a.ts", "src/b.ts"],
      ),
    ).toBe(false);
  });

  test("rejects repository shells even when they contain nested file-shell elements", () => {
    const repoShell = element("gdp-repo-shell");
    Object.assign(repoShell, {
      children: [element("gdp-file-shell loaded gdp-repo-list-shell")],
    });

    expect(isDiffShellDomIntact(target([repoShell]), ["src/a.ts"])).toBe(false);
  });

  test("refreshes the sidebar when the file list is unchanged but the diff DOM was replaced", () => {
    expect(shouldRenderDiffSidebar(true, true)).toBe(false);
    expect(shouldRenderDiffSidebar(true, false)).toBe(true);
    expect(shouldRenderDiffSidebar(false, true)).toBe(true);
  });
});
