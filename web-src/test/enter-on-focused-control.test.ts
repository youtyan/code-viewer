// Tab で届くボタン・リンクの上の Enter は、その部品が押す。ページのキー割り当ての
// Enter (木の項目を開く) が先に拾って既定の動作を止めていたので、左のサイドバーの
// New agent・右の列の頭の画面の入口・畳むボタンが Enter で動かず、代わりに木の
// ファイルが開いていた。木の行のリンク (tabIndex -1) と何も選んでいないときは、
// 今までどおりページの Enter が開く。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  isEnterForFocusedControl,
  isPageKeymapBlockedKey,
  keymapScope,
} from "../core/focus-scope";
import { resolveKeymapAction } from "../core/keymap";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

/** app.ts の keydown と同じ組み立てで、その要素の上の Enter が何になるか。 */
function enterOn(html: string, key = "Enter"): string | null {
  document.body.innerHTML = html;
  const target = document.querySelector("#target");
  if (!target) throw new Error(`no #target in ${html}`);
  return resolveKeymapAction(
    { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false },
    {
      scope: keymapScope(target),
      editable: false,
      pageKeymapBlocked:
        isPageKeymapBlockedKey(target, false) ||
        isEnterForFocusedControl(target, key),
      composing: false,
      paletteOpen: false,
      pendingG: false,
      lightboxOpen: false,
    },
  );
}

test.each([
  {
    name: "a button in the left sidebar (New agent)",
    html: '<aside><button id="target">New agent</button></aside>',
    action: null,
  },
  {
    name: "a view link in the right column head",
    html: '<nav><a id="target" href="/history">History</a></nav>',
    action: null,
  },
  {
    name: "a button in the tree column's head",
    html: '<aside id="sidebar"><button id="target">expand</button></aside>',
    action: null,
  },
  {
    name: "a role=button (the breadcrumb ellipsis)",
    html: '<span id="target" role="button" tabindex="0">…</span>',
    action: null,
  },
  {
    name: "a select",
    html: '<select id="target"><option>a</option></select>',
    action: null,
  },
  {
    name: "a tree row link out of the Tab order: the page opens it",
    html: '<aside id="sidebar"><ul id="filelist"><li><a id="target" href="/file" tabindex="-1">a.ts</a></li></ul></aside>',
    action: "open-sidebar-item",
  },
  {
    name: "a tree row: the page opens it",
    html: '<aside id="sidebar"><ul id="filelist"><li id="target" tabindex="-1">a.ts</li></ul></aside>',
    action: "open-sidebar-item",
  },
  {
    name: "nothing focused: the page opens the tree item",
    html: '<div id="target"></div>',
    action: "open-sidebar-item",
  },
])("Enter on $name: $action", ({ html, action }) => {
  expect(enterOn(html)).toBe(action);
});

test("other keys on a focused button still reach the page keymap", () => {
  expect(
    enterOn('<aside><button id="target">New agent</button></aside>', "j"),
  ).toBe("sidebar-next");
});
