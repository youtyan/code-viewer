// 画像の棚の項目 (views/terminal/image-shelf.ts) の操作と見本。
//
// 落とすと痛いもの:
//
// - 押して開いた後、矢印で隣の画像へ移れない (フォーカスが棚に残るので、画像の
//   タブの ←→ は効かない。利用者の声)
// - 動画が棚に出ない・出ても img で壊れた絵になる
//
// 棚だけを作って見る (端末とサーバは要らない)。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { terminalText } from "../views/terminal/i18n";
import {
  createImageShelf,
  type ShelfOpenMode,
} from "../views/terminal/image-shelf";
import type { ShelfEntry } from "../views/terminal/image-shelf-list";
import { q } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function entry(name: string): ShelfEntry {
  const path = `/repo/out/${name}`;
  return {
    key: path,
    name,
    path,
    candidates: [`out/${name}`],
    seq: 1,
    image: {
      path,
      candidate: `out/${name}`,
      name,
      url: `/_agent/image?path=${encodeURIComponent(path)}&v=1-1`,
      bytes: 1,
      mtimeMs: 0,
    },
    reason: null,
    bytes: null,
    detail: null,
    origins: [],
  };
}

/** 読めなかった項目 (押すと確かめ直しになる)。 */
function failed(name: string): ShelfEntry {
  return { ...entry(name), image: null, reason: "too-large", bytes: 9 };
}

/** 棚の並び (出た所が分からないので 1 つのまとまり)。 */
const ENTRIES = [
  entry("a.png"),
  entry("b.png"),
  entry("c.mp4"),
  failed("x.png"),
];

let opened: string[];

beforeEach(() => {
  document.body.replaceChildren();
  opened = [];
  const shelf = createImageShelf({
    getText: () => terminalText("en"),
    isCollapsed: () => false,
    setCollapsed: () => undefined,
    onOpen: (item: ShelfEntry, mode: ShelfOpenMode) => {
      opened.push(`${item.name}:${mode}`);
    },
    onImageError: () => undefined,
    onLocate: () => undefined,
    onReveal: () => undefined,
  });
  document.body.append(shelf.el);
  shelf.render(ENTRIES);
});

const button = (name: string) =>
  q<HTMLButtonElement>(
    document,
    `.terminal-image-shelf-item[data-key="/repo/out/${name}"] .terminal-image-shelf-open`,
  );

function focusedName(): string | undefined {
  return (document.activeElement as HTMLElement | null)
    ?.closest<HTMLElement>(".terminal-image-shelf-item")
    ?.dataset.key?.split("/")
    .pop();
}

describe("矢印で隣の項目へ", () => {
  test("押した項目にフォーカスを置いて開く (Safari は押してもフォーカスを移さない)", () => {
    button("b.png").click();
    expect({ focused: focusedName(), opened }).toEqual({
      focused: "b.png",
      opened: ["b.png:tab"],
    });
  });

  test.each([
    { name: "↓ で次を開く", from: "a.png", key: "ArrowDown", to: "b.png" },
    { name: "→ も次", from: "a.png", key: "ArrowRight", to: "b.png" },
    { name: "↑ で前", from: "b.png", key: "ArrowUp", to: "a.png" },
    { name: "← も前", from: "b.png", key: "ArrowLeft", to: "a.png" },
    {
      name: "動画へも移って開く",
      from: "b.png",
      key: "ArrowDown",
      to: "c.mp4",
    },
    { name: "Home で先頭", from: "c.mp4", key: "Home", to: "a.png" },
  ])("$name", ({ from, key, to }) => {
    button(from).focus();
    button(from).dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
    expect({ focused: focusedName(), opened }).toEqual({
      focused: to,
      opened: [`${to}:tab`],
    });
  });

  test.each([
    {
      name: "読めなかった項目へは移るだけ (確かめ直しにしない)",
      from: "c.mp4",
      key: "ArrowDown",
      shiftKey: false,
      focused: "x.png",
    },
    {
      name: "End で最後 (読めなかった項目) へ移るだけ",
      from: "a.png",
      key: "End",
      shiftKey: false,
      focused: "x.png",
    },
    {
      name: "端では動かず開き直さない",
      from: "a.png",
      key: "ArrowUp",
      shiftKey: false,
      focused: "a.png",
    },
    {
      name: "修飾キー付きは見送る",
      from: "a.png",
      key: "ArrowDown",
      shiftKey: true,
      focused: "a.png",
    },
  ])("$name", ({ from, key, shiftKey, focused }) => {
    button(from).focus();
    button(from).dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect({ focused: focusedName(), opened }).toEqual({
      focused,
      opened: [],
    });
  });
});

describe("動画の見本", () => {
  test.each([
    {
      name: "画像は img",
      item: "a.png",
      expected: { tag: "IMG", muted: null, src: null, play: false },
    },
    {
      name: "動画は音を消した video を最初の辺りで止めて、再生の印",
      item: "c.mp4",
      expected: {
        tag: "VIDEO",
        muted: true,
        src: "/_agent/image?path=%2Frepo%2Fout%2Fc.mp4&v=1-1#t=0.1",
        play: true,
      },
    },
  ])("$name", ({ item, expected }) => {
    const frame = button(item).querySelector(".terminal-image-shelf-frame");
    const media = frame?.firstElementChild;
    expect({
      tag: media?.tagName,
      muted: media instanceof HTMLVideoElement ? media.muted : null,
      src: media instanceof HTMLVideoElement ? media.getAttribute("src") : null,
      play: frame?.querySelector(".terminal-image-shelf-play") !== null,
    }).toEqual(expected);
  });

  test.each([
    {
      item: "a.png",
      expected: [
        "Open in new tab",
        "Open in the viewer (Alt+click)",
        "Show in terminal",
      ],
    },
    // 覆いの拡大表示は画像だけ。動画はタブで再生する。
    { item: "c.mp4", expected: ["Open in new tab", "Show in terminal"] },
  ])("$item の右クリックのメニュー", ({ item, expected }) => {
    button(item).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    expect(
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".gdp-context-menu button",
        ),
      ].map((menuItem) => menuItem.textContent),
    ).toEqual(expected);
  });
});
