// Files の木は仮想表示 (行を絶対配置で並べ、位置を TS が数える)。指の画面では
// 行を押せる最小の高さ (style.css の --sp-touch) より低くしない。以前は CSS の
// 44px が仮想表示の木に効かず、電話で木の行が 30px のままだった。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { TOUCH_MEDIA_QUERY } from "../core/mobile-layout";
import { createSidebarForTest, installSidebarDom } from "./_sidebar-fixture";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const originalMatchMedia = () => window.matchMedia;
let restoreMatchMedia: typeof window.matchMedia | null = null;

afterEach(() => {
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
