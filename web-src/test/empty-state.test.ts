// 空の状態の案内の部品 (views/empty-state.ts)。既存の .empty の形 (絵の箱・
// 見出し・一文・.empty-actions) に、キーキャップの行を足したもの。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PLUS_16_PATH } from "../core/icons";
import { renderEmptyState } from "../views/empty-state";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

function shape(el: HTMLElement) {
  return {
    className: el.className,
    icon: !!el.querySelector(".empty-icon svg"),
    title: el.querySelector("h2")?.textContent,
    hint: el.querySelector("p")?.textContent ?? null,
    actions: [...el.querySelectorAll<HTMLButtonElement>(".empty-action")].map(
      (button) =>
        `${button.textContent}${button.classList.contains("empty-action-primary") ? " (primary)" : ""}`,
    ),
    keys: [...el.querySelectorAll(".empty-key")].map((key) => [
      [...key.querySelectorAll("kbd")].map((cap) => cap.textContent),
      key.querySelector("dd")?.textContent,
    ]),
    keysLabel: el.querySelector(".empty-keys")?.getAttribute("aria-label"),
  };
}

describe("renderEmptyState", () => {
  test.each([
    {
      name: "the line alone",
      options: { title: "Nothing here" },
      expected: {
        className: "empty empty-with-actions empty-state",
        icon: false,
        title: "Nothing here",
        hint: null,
        actions: [],
        keys: [],
        keysLabel: undefined,
      },
    },
    {
      name: "every part, placed inside a screen",
      options: {
        icon: PLUS_16_PATH,
        title: "Open something",
        hint: "Pick one of these.",
        actions: [
          { label: "Open a file", primary: true, run: () => undefined },
          { label: "New shell", run: () => undefined },
        ],
        // 空白で区切ると順に押すキー、+ でつないだものは 1 つのキー。
        keys: [
          { keys: "⌘K", label: "Open a file" },
          { keys: "Ctrl+`", label: "New shell" },
          { keys: "g d", label: "Diff" },
        ],
        keysLabel: "Keys",
        compact: true,
      },
      expected: {
        className: "empty empty-with-actions empty-state empty-compact",
        icon: true,
        title: "Open something",
        hint: "Pick one of these.",
        actions: ["Open a file (primary)", "New shell"],
        keys: [
          [["⌘K"], "Open a file"],
          [["Ctrl+`"], "New shell"],
          [["g", "d"], "Diff"],
        ],
        keysLabel: "Keys",
      },
    },
  ])("$name", ({ options, expected }) => {
    expect(shape(renderEmptyState(options))).toEqual(expected);
  });

  test("an action runs when pressed", () => {
    const ran: string[] = [];
    const el = renderEmptyState({
      title: "t",
      actions: [{ label: "Go", run: () => ran.push("go") }],
    });
    el.querySelector<HTMLButtonElement>(".empty-action")?.click();
    expect(ran).toEqual(["go"]);
  });

  // 次にやることがぼやけないよう、操作は 2 つ・キーは 3 つまで。読み上げの名前の
  // 無いキーの一覧も作らない。
  test.each([
    {
      name: "three actions",
      options: {
        title: "t",
        actions: ["a", "b", "c"].map((label) => ({
          label,
          run: () => undefined,
        })),
      },
      message: 'empty state "t": 3 actions (at most 2)',
    },
    {
      name: "four keys",
      options: {
        title: "t",
        keys: ["1", "2", "3", "4"].map((keys) => ({ keys, label: keys })),
        keysLabel: "Keys",
      },
      message: 'empty state "t": 4 keys (at most 3)',
    },
    {
      name: "keys without a label for the list",
      options: { title: "t", keys: [{ keys: "g a", label: "All agents" }] },
      message: 'empty state "t": keys need a keysLabel',
    },
  ])("refuses $name", ({ options, message }) => {
    expect(() => renderEmptyState(options)).toThrow(message);
  });
});
