// Files の木は仮想表示 (行を絶対配置で並べ、位置を TS が数える)。指の画面では
// 行を押せる最小の高さ (style.css の --sp-touch) より低くしない。以前は CSS の
// 44px が仮想表示の木に効かず、電話で木の行が 30px のままだった。

import "./_dom";
import { afterEach, expect, test, vi } from "vitest";
import { TOUCH_MEDIA_QUERY } from "../core/mobile-layout";
import { FILE_LIST_DOM } from "../views/sidebar";
import { createSidebarForTest, installSidebarDom } from "./_sidebar-fixture";

const originalMatchMedia = () => window.matchMedia;
let restoreMatchMedia: typeof window.matchMedia | null = null;

afterEach(() => {
  vi.unstubAllGlobals();
  if (restoreMatchMedia) window.matchMedia = restoreMatchMedia;
  restoreMatchMedia = null;
  document.body.innerHTML = "";
  document.body.style.removeProperty("--sp-touch");
});

function pointer(coarse: boolean) {
  restoreMatchMedia = originalMatchMedia();
  window.matchMedia = ((query: string) => ({
    matches: query === TOUCH_MEDIA_QUERY ? coarse : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

function renderTree() {
  installSidebarDom();
  // style.css の指の画面の節が body に置く値 (happy-dom は @media を当てないので
  // 手で置く)。
  document.body.style.setProperty("--sp-touch", "44px");
  const sidebar = createSidebarForTest();
  sidebar.renderSidebar(
    [
      { path: "src", type: "tree" as const },
      { path: "src/alpha.ts", type: "blob" as const },
      { path: "src/beta.ts", type: "blob" as const },
    ],
    () => {
      /* noop */
    },
  );
  const list = document.querySelector<HTMLElement>("#filelist");
  if (!list) throw new Error("missing #filelist");
  return {
    virtual: list.classList.contains("tree-virtual"),
    tops: [...list.querySelectorAll<HTMLElement>(":scope > li")].map(
      (row) => row.style.top,
    ),
    height: list.style.height,
  };
}

test.each([
  ["a mouse screen keeps the density's row height", false, "30px", "90px"],
  ["a touch screen raises rows to the touch target", true, "44px", "132px"],
])("%s", (_name, coarse, second, height) => {
  pointer(coarse);
  const tree = renderTree();
  expect({
    virtual: tree.virtual,
    second: tree.tops[1],
    height: tree.height,
  }).toEqual({ virtual: true, second, height });
});

// 一覧の箱が縦に伸びた (窓を縦に広げた) ときは、スクロールしなくても見える
// ようになった行を描く。描いた範囲 (見える範囲の上下 16 行) より広く伸びると、
// スクロールするまで下が空いたままだった。
test("the virtual tree draws the rows that come into view when the list grows taller", () => {
  pointer(false);
  const resized: Array<() => void> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: () => void) {
        resized.push(() => this.callback());
      }
      observe() {
        /* the test calls the callback itself */
      }
      disconnect() {
        /* noop */
      }
      unobserve() {
        /* noop */
      }
    },
  );
  installSidebarDom();
  const root = document.querySelector<HTMLElement>("#sidebar");
  const list = document.querySelector<HTMLElement>("#filelist");
  if (!root || !list) throw new Error("missing #sidebar or #filelist");
  const setHeight = (px: number) =>
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      value: px,
    });
  setHeight(10 * 30);
  const sidebar = createSidebarForTest();
  sidebar.renderSidebar(
    [
      { path: "src", type: "tree" as const },
      ...Array.from({ length: 200 }, (_, index) => ({
        path: `src/file-${String(index).padStart(3, "0")}.ts`,
        type: "blob" as const,
      })),
    ],
    () => {
      /* noop */
    },
  );
  const drawn = () => list.querySelectorAll(":scope > li").length;
  expect(drawn()).toBe(26);
  setHeight(100 * 30);
  for (const notify of resized) notify();
  expect(drawn()).toBe(116);
});

// 変更の通知のたびに、選んでいる行の印付け (markActive) と絞り込み (applyFilter)
// が窓を描き直す。行を描くたびに作り直していた間は、何も変わっていない木が通知の
// たびに描き直された。行は使い回し、印だけを付け替える。
test("redrawing the virtual tree keeps the row elements and moves only the active mark", () => {
  pointer(false);
  installSidebarDom(FILE_LIST_DOM);
  const sidebar = createSidebarForTest({ dom: FILE_LIST_DOM });
  sidebar.renderSidebar(
    [
      { path: "src", type: "tree" as const },
      { path: "src/alpha.ts", type: "blob" as const },
      { path: "src/beta.ts", type: "blob" as const },
    ],
    () => {
      /* noop */
    },
  );
  const row = (path: string) =>
    document.querySelector<HTMLElement>(
      `#file-list-rows li[data-path="${path}"]`,
    );
  const alpha = row("src/alpha.ts");
  const beta = row("src/beta.ts");

  sidebar.markActive("src/alpha.ts");
  sidebar.applyFilter();
  expect([
    row("src/alpha.ts") === alpha,
    alpha?.classList.contains("active"),
  ]).toEqual([true, true]);

  sidebar.markActive("src/beta.ts");
  expect({
    sameRows: row("src/alpha.ts") === alpha && row("src/beta.ts") === beta,
    alphaActive: alpha?.classList.contains("active"),
    betaActive: beta?.classList.contains("active"),
  }).toEqual({ sameRows: true, alphaActive: false, betaActive: true });
});
