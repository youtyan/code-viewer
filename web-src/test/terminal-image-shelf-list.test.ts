// 画像の棚に並べる一覧の決まり (views/terminal/image-shelf-list.ts)。
//
// 落とすと痛いもの:
//
// - 新しい順でない / 同じ画像が 2 つ並ぶ
// - エージェントが同じ名前で上書きしたのに、棚の古い位置に古い版のまま残る
// - 読めなかった画像が黙って消える (大きすぎる・消された)
// - 逆に、拾い過ぎた候補の「無い」まで並んで棚が埋まる

import { describe, expect, test } from "vitest";
import {
  MAX_SHELF_IMAGES,
  type TerminalImageRef,
  type TerminalImageRejection,
} from "../core/terminal-images";
import {
  mergeShelf,
  type ShelfEntry,
  type ShelfSeq,
  shelfEntryByCandidate,
  shelfGallery,
} from "../views/terminal/image-shelf-list";

function image(
  name: string,
  overrides: Partial<TerminalImageRef> = {},
): TerminalImageRef {
  const path = `/tmp/sample-images/${name}`;
  return {
    path,
    candidate: path,
    name,
    url: `/_agent/image?path=${encodeURIComponent(path)}&v=1000-3`,
    bytes: 3,
    mtimeMs: 1000,
    ...overrides,
  };
}

function rejection(
  name: string,
  reason: TerminalImageRejection["reason"],
  overrides: Partial<TerminalImageRejection> = {},
): TerminalImageRejection {
  const path = `/tmp/sample-images/${name}`;
  return { candidate: path, path, name, reason, ...overrides };
}

/** 出力から見つけた順に番号を振る (ブラウザの棚と同じ振り方)。 */
function liveSeq(start = 0): ShelfSeq {
  let seq = start;
  return {
    added: () => {
      seq += 1;
      return seq;
    },
    changed: () => {
      seq += 1;
      return seq;
    },
  };
}

const names = (list: readonly ShelfEntry[]) => list.map((entry) => entry.name);

describe("mergeShelf の並び", () => {
  test.each([
    {
      name: "後に見つけたものが先頭",
      updates: [[image("a.png"), image("b.png")], [image("c.png")]],
      expected: ["c.png", "b.png", "a.png"],
    },
    {
      name: "同じパスは 1 つにまとめる (位置は動かさない)",
      updates: [[image("a.png"), image("b.png")], [image("a.png")]],
      expected: ["b.png", "a.png"],
    },
    {
      name: "同じ画像を別の綴りで見つけても 1 つ",
      updates: [
        [image("a.png")],
        [image("a.png", { candidate: "sample-images/a.png" })],
      ],
      expected: ["a.png"],
    },
    {
      name: "更新時刻が変わったら先頭へ",
      updates: [
        [image("a.png"), image("b.png")],
        [image("a.png", { mtimeMs: 2000 })],
      ],
      expected: ["a.png", "b.png"],
    },
    {
      name: "大きさだけ変わっても先頭へ",
      updates: [
        [image("a.png"), image("b.png")],
        [image("a.png", { bytes: 4 })],
      ],
      expected: ["a.png", "b.png"],
    },
  ])("$name", ({ updates, expected }) => {
    const seq = liveSeq();
    let list: ShelfEntry[] = [];
    for (const images of updates) {
      list = mergeShelf(list, { images, rejected: [] }, seq);
    }
    expect(names(list)).toEqual(expected);
  });

  test("同じ画像の綴りを全部覚える (リンクの位置を探すのに使う)", () => {
    const seq = liveSeq();
    let list = mergeShelf([], { images: [image("a.png")], rejected: [] }, seq);
    list = mergeShelf(
      list,
      {
        images: [image("a.png", { candidate: "sample-images/a.png" })],
        rejected: [],
      },
      seq,
    );
    expect(list[0]?.candidates).toEqual([
      "/tmp/sample-images/a.png",
      "sample-images/a.png",
    ]);
    expect(shelfEntryByCandidate(list, "sample-images/a.png")?.name).toBe(
      "a.png",
    );
    expect(shelfEntryByCandidate(list, "other.png")).toBeNull();
  });

  test("上書きされたら新しい版の URL に替わる", () => {
    const seq = liveSeq();
    let list = mergeShelf([], { images: [image("a.png")], rejected: [] }, seq);
    const newer = image("a.png", { mtimeMs: 2000, url: "/_agent/image?v=2" });
    list = mergeShelf(list, { images: [newer], rejected: [] }, seq);
    expect(list[0]?.image?.url).toBe("/_agent/image?v=2");
  });

  test.each([
    {
      name: "上限ちょうど",
      count: MAX_SHELF_IMAGES,
      expected: MAX_SHELF_IMAGES,
    },
    {
      name: "上限を超えたら古いものから落とす",
      count: MAX_SHELF_IMAGES + 5,
      expected: MAX_SHELF_IMAGES,
    },
  ])("$name", ({ count, expected }) => {
    const images = Array.from({ length: count }, (_, i) => image(`${i}.png`));
    const list = mergeShelf([], { images, rejected: [] }, liveSeq());
    expect(list).toHaveLength(expected);
    // 残るのは新しいほう (後に見つけたもの)。
    expect(list[0]?.name).toBe(`${count - 1}.png`);
    expect(list[list.length - 1]?.name).toBe(`${count - expected}.png`);
  });

  test.each([
    {
      name: "順を渡せば、読めたものと読めなかったものをその順で番号付けする",
      order: [
        "/tmp/sample-images/huge.png",
        "/tmp/sample-images/a.png",
        "/tmp/sample-images/b.png",
      ],
      // 古い順に渡したので、最後の b が先頭。huge は一番古い。
      expected: ["b.png", "a.png", "huge.png"],
    },
    {
      name: "順を渡さなければ、読めたもの・読めなかったものの順",
      order: [],
      expected: ["huge.png", "b.png", "a.png"],
    },
  ])("$name", ({ order, expected }) => {
    const list = mergeShelf(
      [],
      {
        images: [image("a.png"), image("b.png")],
        rejected: [rejection("huge.png", "too-large")],
      },
      liveSeq(),
      order,
    );
    expect(names(list)).toEqual(expected);
  });

  test("履歴で見つけたものは、出力で見つけたものより下", () => {
    // 履歴の応答は新しい順。負の番号を振って、繋いでから見つけたものより
    // 古い扱いにする。
    let list = mergeShelf(
      [],
      { images: [image("live.png")], rejected: [] },
      liveSeq(),
    );
    list = mergeShelf(
      list,
      { images: [image("old-newest.png"), image("old.png")], rejected: [] },
      { added: (index) => -(index + 1), changed: () => 99 },
    );
    expect(names(list)).toEqual(["live.png", "old-newest.png", "old.png"]);
  });
});

describe("mergeShelf の読めなかった項目", () => {
  test.each([
    { reason: "too-large" as const, expected: ["huge.png"] },
    { reason: "not-file" as const, expected: ["huge.png"] },
    { reason: "empty" as const, expected: ["huge.png"] },
    { reason: "unreadable" as const, expected: ["huge.png"] },
    // 拾い過ぎた候補の「無い」は並べない。
    { reason: "missing" as const, expected: [] },
    { reason: "unsupported" as const, expected: [] },
    { reason: "invalid" as const, expected: [] },
  ])("知らない候補の $reason", ({ reason, expected }) => {
    const list = mergeShelf(
      [],
      { images: [], rejected: [rejection("huge.png", reason)] },
      liveSeq(),
    );
    expect(names(list)).toEqual(expected);
  });

  test("大きすぎる画像は理由と大きさを持つ", () => {
    const [entry] = mergeShelf(
      [],
      {
        images: [],
        rejected: [rejection("huge.png", "too-large", { bytes: 9_000_000 })],
      },
      liveSeq(),
    );
    expect(entry).toMatchObject({
      name: "huge.png",
      image: null,
      reason: "too-large",
      bytes: 9_000_000,
    });
  });

  test("棚にある画像が消えたら、位置はそのままで理由に替わる", () => {
    const seq = liveSeq();
    let list = mergeShelf(
      [],
      { images: [image("a.png"), image("b.png")], rejected: [] },
      seq,
    );
    list = mergeShelf(
      list,
      { images: [], rejected: [rejection("a.png", "missing")] },
      seq,
    );
    expect(names(list)).toEqual(["b.png", "a.png"]);
    expect(list[1]).toMatchObject({ image: null, reason: "missing" });
    // 拡大表示で回すのは読めるものだけ。
    expect(shelfGallery(list).map((item) => item.name)).toEqual(["b.png"]);
  });

  test("消えたことは画面の綴りでも突き合わせる (/tmp と /private/tmp)", () => {
    const seq = liveSeq();
    let list = mergeShelf(
      [],
      {
        images: [
          image("a.png", {
            path: "/private/tmp/sample-images/a.png",
            candidate: "/tmp/sample-images/a.png",
          }),
        ],
        rejected: [],
      },
      seq,
    );
    list = mergeShelf(
      list,
      { images: [], rejected: [rejection("a.png", "missing")] },
      seq,
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: "missing", image: null });
  });

  test("読めなかったものが読めるようになったら先頭へ", () => {
    const seq = liveSeq();
    let list = mergeShelf(
      [],
      { images: [image("b.png")], rejected: [rejection("a.png", "too-large")] },
      seq,
    );
    list = mergeShelf(list, { images: [image("c.png")], rejected: [] }, seq);
    list = mergeShelf(list, { images: [image("a.png")], rejected: [] }, seq);
    expect(names(list)).toEqual(["a.png", "c.png", "b.png"]);
    expect(list[0]?.reason).toBeNull();
  });
});
