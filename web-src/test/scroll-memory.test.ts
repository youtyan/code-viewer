// 戻る/進むのスクロール位置の覚え方 (本文は窓ではなく自分の箱で動くので、
// ブラウザは位置を戻さない。ui-layout.md の「本文の箱」)。
import { expect, test } from "vitest";
import {
  createScrollMemory,
  scrollKeyOfHistoryState,
} from "../core/scroll-memory";

test.each([
  ["鍵が無い state", null, null],
  ["object でない state", "h1", null],
  ["鍵の無い object", { view: "diff" }, null],
  ["空の鍵", { scrollKey: "" }, null],
  ["鍵が数値", { scrollKey: 3 }, null],
  ["鍵", { view: "diff", scrollKey: "h7" }, "h7"],
])("scrollKeyOfHistoryState: %s", (_name, state, expected) => {
  expect(scrollKeyOfHistoryState(state)).toBe(expected);
});

test.each([
  ["覚えた位置", "h1", 1500, 1500],
  ["小数は丸める", "h1", 12.4, 12],
  ["負の値は 0", "h1", -30, 0],
])("remember/recall: %s", (_name, key, top, expected) => {
  const memory = createScrollMemory();
  memory.remember(key, top);
  expect(memory.recall(key)).toBe(expected);
});

test("覚えていない項は先頭から", () => {
  const memory = createScrollMemory();
  memory.remember("h1", 900);
  expect(memory.recall("h2")).toBe(0);
  expect(memory.recall(null)).toBe(0);
});

test("鍵の無い項は覚えない", () => {
  const memory = createScrollMemory();
  memory.remember(null, 900);
  expect(memory.size()).toBe(0);
});

test("上限を超えたら古い項から捨て、覚え直した項は新しい扱いになる", () => {
  const memory = createScrollMemory(3);
  memory.remember("h1", 10);
  memory.remember("h2", 20);
  memory.remember("h3", 30);
  memory.remember("h1", 11); // 覚え直し = 新しい
  memory.remember("h4", 40);
  expect(memory.size()).toBe(3);
  expect(memory.recall("h2")).toBe(0); // 一番古いので捨てられた
  expect(memory.recall("h1")).toBe(11);
  expect(memory.recall("h3")).toBe(30);
  expect(memory.recall("h4")).toBe(40);
});
