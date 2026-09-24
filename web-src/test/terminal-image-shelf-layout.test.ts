// 画像の棚の置き場所・大きさ・狭いときの畳み方 (views/terminal/image-shelf.ts)。
//
// 落とすと痛いもの:
//
// - 棚が狭すぎて画像も名前も入らない / 幅を変えられない (利用者の声)
// - 置き場所を変えても覚えない・掴む縁が端末の側にない
// - 端末が狭いのに棚が場所を取り続け、端末の桁が足りなくなる
// - 狭くて畳んだことを設定に書き、広げても開かない
// - 札がほかのサムネイルや画面の外にはみ出す
//
// 棚だけを作って見る (端末とサーバは要らない)。見た目の計算値は実画面で撮る
// (作業報告)。

import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  TERMINAL_IMAGE_SHELF_HEIGHT,
  TERMINAL_IMAGE_SHELF_WIDTH,
} from "../core/panel-sizes";
import type { TerminalImageShelfPlacement } from "../core/terminal-images";
import { terminalText } from "../views/terminal/i18n";
import {
  createImageShelf,
  type ImageShelfHandle,
  type ImageShelfLayout,
  SHELF_AUTO_COLLAPSE_ROOM,
} from "../views/terminal/image-shelf";
import type { ShelfEntry } from "../views/terminal/image-shelf-list";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const ENTRY: ShelfEntry = {
  key: "/repo/out/a.png",
  name: "a.png",
  path: "/repo/out/a.png",
  candidates: ["out/a.png"],
  seq: 1,
  image: {
    path: "/repo/out/a.png",
    candidate: "out/a.png",
    name: "a.png",
    url: "/_agent/image?path=%2Frepo%2Fout%2Fa.png&v=1-1",
    bytes: 1,
    mtimeMs: 0,
  },
  reason: null,
  bytes: null,
  detail: null,
  origins: [],
};

let layout: ImageShelfLayout;
let layoutChanges: Array<Partial<ImageShelfLayout>>;
let collapsed: boolean;
let collapsedChanges: boolean[];
let shelf: ImageShelfHandle;

beforeEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("style");
  layout = { placement: "right", width: 220, height: 180 };
  layoutChanges = [];
  collapsed = false;
  collapsedChanges = [];
  shelf = createImageShelf({
    getText: () => terminalText("en"),
    isCollapsed: () => collapsed,
    setCollapsed: (value) => {
      collapsed = value;
      collapsedChanges.push(value);
    },
    onOpen: () => undefined,
    onImageError: () => undefined,
    onLocate: () => undefined,
    onReveal: () => undefined,
    getLayout: () => layout,
    setLayout: (patch) => {
      layoutChanges.push(patch);
      layout = { ...layout, ...patch };
    },
  });
  document.body.append(shelf.el);
  shelf.render([ENTRY]);
});

function rootVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

function resizer(): HTMLElement {
  const el = shelf.el.querySelector<HTMLElement>(
    ".terminal-image-shelf-resizer",
  );
  if (!el) throw new Error("no resizer");
  return el;
}

describe("置き場所と大きさ", () => {
  test.each([
    {
      name: "既定の範囲はそのまま",
      set: { width: 300, height: 200 },
      expected: { w: "300px", h: "200px" },
    },
    {
      name: "範囲の外は下限・上限へ",
      set: { width: 9999, height: 1 },
      expected: {
        w: `${TERMINAL_IMAGE_SHELF_WIDTH.max}px`,
        h: `${TERMINAL_IMAGE_SHELF_HEIGHT.min}px`,
      },
    },
  ])("$name (:root の変数に書く)", ({ set, expected }) => {
    layout = { ...layout, ...set };
    shelf.applyLayout();
    expect(rootVar("--terminal-shelf-w")).toBe(expected.w);
    expect(rootVar("--terminal-shelf-h")).toBe(expected.h);
  });

  test("既定の幅はサムネイルと名前が入る 220px", () => {
    expect(TERMINAL_IMAGE_SHELF_WIDTH.default).toBe(220);
  });

  test.each([
    { placement: "right", orientation: "vertical" },
    { placement: "left", orientation: "vertical" },
    { placement: "bottom", orientation: "horizontal" },
    { placement: "top", orientation: "horizontal" },
  ] as const)("$placement に置くと、掴みは $orientation の縁", ({
    placement,
    orientation,
  }) => {
    layout = { ...layout, placement };
    shelf.applyLayout();
    expect(shelf.el.dataset.placement).toBe(placement);
    expect(resizer().getAttribute("aria-orientation")).toBe(orientation);
  });

  test("見出しの ⋯ から置き場所を選ぶと、設定に書いてもらう", () => {
    shelf.el
      .querySelector<HTMLButtonElement>(".terminal-image-shelf-move")
      ?.click();
    const items = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".gdp-context-menu button",
      ),
    ];
    expect(items.map((item) => item.textContent)).toEqual([
      "Right of the terminal",
      "Left of the terminal",
      "Below the terminal",
      "Above the terminal",
    ]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    items[2]?.click();
    expect(layoutChanges).toEqual([{ placement: "bottom" }]);
  });

  test.each([
    // 右に置いた棚は、縁を左 (端末の側) へ動かすと広がる。
    { placement: "right", key: "ArrowLeft", patch: { width: 236 } },
    { placement: "left", key: "ArrowRight", patch: { width: 236 } },
    { placement: "bottom", key: "ArrowUp", patch: { height: 196 } },
    { placement: "top", key: "ArrowDown", patch: { height: 196 } },
  ] as const)("$placement: 縁を端末の側へ動かすと広がり、終わりに覚える", ({
    placement,
    key,
    patch,
  }) => {
    layout = { ...layout, placement };
    shelf.applyLayout();
    resizer().dispatchEvent(new KeyboardEvent("keydown", { key }));
    expect(layoutChanges).toEqual([patch]);
  });
});

describe("端末が狭いときの畳み方", () => {
  const room = (placement: TerminalImageShelfPlacement) =>
    placement === "right" || placement === "left"
      ? {
          narrow: {
            width: 220 + SHELF_AUTO_COLLAPSE_ROOM.width - 1,
            height: 800,
          },
          wide: { width: 220 + SHELF_AUTO_COLLAPSE_ROOM.width, height: 800 },
        }
      : {
          narrow: {
            width: 1200,
            height: 180 + SHELF_AUTO_COLLAPSE_ROOM.height - 1,
          },
          wide: { width: 1200, height: 180 + SHELF_AUTO_COLLAPSE_ROOM.height },
        };

  test.each([
    "right",
    "left",
    "bottom",
    "top",
  ] as const)("%s: 狭ければ設定を変えずに畳み、広がれば開く", (placement) => {
    layout = { ...layout, placement };
    shelf.applyLayout();
    shelf.setRoom(room(placement).narrow);
    expect(shelf.el.dataset.collapsed).toBe("true");
    shelf.setRoom(room(placement).wide);
    expect(shelf.el.dataset.collapsed).toBe("false");
    expect(collapsedChanges).toEqual([]);
  });

  test("狭くて畳んだ帯を押せば開く (設定は書かない)。一度広がってまた狭まれば畳む", () => {
    shelf.setRoom(room("right").narrow);
    shelf.el
      .querySelector<HTMLButtonElement>(".terminal-image-shelf-expand")
      ?.click();
    expect(shelf.el.dataset.collapsed).toBe("false");
    expect(collapsedChanges).toEqual([]);
    shelf.setRoom(room("right").wide);
    shelf.setRoom(room("right").narrow);
    expect(shelf.el.dataset.collapsed).toBe("true");
  });

  test("自分で畳んだ棚は、広くても畳んだまま", () => {
    shelf.el
      .querySelector<HTMLButtonElement>(".terminal-image-shelf-collapse")
      ?.click();
    shelf.setRoom(room("right").wide);
    expect(shelf.el.dataset.collapsed).toBe("true");
    expect(collapsedChanges).toEqual([true]);
  });
});

describe("見出しの行の詳しい表示 (浮く札は作らない)", () => {
  const head = () => {
    const el = shelf.el.querySelector<HTMLElement>(
      ".terminal-image-shelf-head",
    );
    if (!el) throw new Error("no head");
    return el;
  };
  const shown = () => ({
    title: !shelf.el.querySelector<HTMLElement>(".terminal-image-shelf-title")
      ?.hidden,
    detail: shelf.el.querySelector<HTMLElement>(".terminal-image-shelf-detail")
      ?.hidden
      ? null
      : [
          ".terminal-image-shelf-detail-dir",
          ".terminal-image-shelf-detail-name",
          ".terminal-image-shelf-detail-facts",
        ].map((selector) => shelf.el.querySelector(selector)?.textContent),
  });
  const open = () => {
    const el = shelf.el.querySelector<HTMLElement>(
      ".terminal-image-shelf-open",
    );
    if (!el) throw new Error("no item");
    return el;
  };

  test.each([
    { name: "カーソル", enter: "pointerenter", leave: "pointerleave" },
    { name: "フォーカス", enter: "focus", leave: "blur" },
  ])("$name が載っている間だけ、題と件数の代わりにパスを出す", ({
    enter,
    leave,
  }) => {
    expect(shown()).toEqual({ title: true, detail: null });
    open().dispatchEvent(new Event(enter));
    // パスはディレクトリとファイル名に分け、省略はディレクトリの側だけ (CSS)。
    expect(shown()).toEqual({
      title: false,
      detail: ["/repo/out/", "a.png", ""],
    });
    // 全文はその行の title (パスは 1 回だけ)。
    expect(head().title).toBe("/repo/out/a.png");
    // 見出しの行の中だけで切り替える (浮く札を作らない)。
    expect(document.querySelector(".title-tooltip, [role=tooltip]")).toBeNull();
    open().dispatchEvent(new Event(leave));
    expect(shown()).toEqual({ title: true, detail: null });
    expect(head().hasAttribute("title")).toBe(false);
  });

  test("読めなかった画像は理由を出す", () => {
    shelf.render([
      {
        ...ENTRY,
        image: null,
        reason: "too-large",
        bytes: 30 * 1024 * 1024,
      },
    ]);
    open().dispatchEvent(new Event("pointerenter"));
    expect(shown().detail).toEqual(["", "Too large (30 MB)", ""]);
    expect(head().title).toBe("Too large (30 MB)\n/repo/out/a.png");
  });

  test.each([
    "right",
    "bottom",
  ] as const)("%s に置いても同じ見出しの行で切り替える", (placement) => {
    layout = { ...layout, placement };
    shelf.applyLayout();
    open().dispatchEvent(new Event("pointerenter"));
    expect(
      head().querySelector<HTMLElement>(".terminal-image-shelf-detail")?.hidden,
    ).toBe(false);
  });
});

describe("見た目 (style.css の計算値)", () => {
  function withStyle(run: () => void): void {
    const style = document.createElement("style");
    style.textContent = readFileSync("web/style.css", "utf8");
    document.head.append(style);
    try {
      run();
    } finally {
      style.remove();
    }
  }

  test("棚の見出し・ペインの見出し・画像の名前は、縁のドラッグで選択されない", () => {
    shelf.render([
      {
        ...ENTRY,
        origins: [
          {
            candidate: "out/a.png",
            pane: {
              id: "%1",
              index: 0,
              title: "",
              command: "zsh",
              folder: "sample-app",
              left: 0,
              top: 0,
              width: 80,
              height: 24,
            },
            shell: null,
            line: "wrote out/a.png",
          },
        ],
      },
    ]);
    withStyle(() => {
      for (const selector of [
        ".terminal-image-shelf-head",
        ".terminal-image-shelf-group-head",
        ".terminal-image-shelf-name",
      ]) {
        const el = shelf.el.querySelector<HTMLElement>(selector);
        if (!el) throw new Error(`${selector} is missing`);
        expect(getComputedStyle(el).userSelect, selector).toBe("none");
      }
    });
  });

  test.each([
    "bottom",
    "top",
  ] as const)("%s: ペインの見出しは横書き (回転させない)", (placement) => {
    layout = { ...layout, placement };
    shelf.applyLayout();
    withStyle(() => {
      const head = shelf.el.querySelector<HTMLElement>(
        ".terminal-image-shelf-group-head",
      );
      if (!head) throw new Error("no group head");
      expect(getComputedStyle(head).writingMode).not.toMatch(/vertical/);
    });
  });
});
