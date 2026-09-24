// ファイルのツリーの字下げの線 (Indent guides、行の ::before) は、行の枠線の
// 内側から測った位置に描く。フォルダの行だけ左に枠線があると線がその分右に
// ずれ、縦の線が行ごとに左右に揺れた。フォルダの行とファイルの行で、線の起点に
// 効く値 (左の枠線・::before の left) が同じであることを、実物の style.css の
// カスケードで確かめる。
import { describe, expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

const rules = baseRules(loadStyleSheet());

function declarationsFor(row: "tree-dir" | "tree-file", state: string) {
  const selectors = new Set([
    `:is(#filelist, #file-list-rows) li`,
    `:is(#filelist, #file-list-rows).tree .${row}`,
    `:is(#filelist, #file-list-rows).tree .${row}${state}`,
  ]);
  return cascadedDeclarations(rules, (selector) => selectors.has(selector));
}

function guideStart(row: "tree-dir" | "tree-file") {
  return cascadedDeclarations(
    rules,
    (selector) =>
      selector === `:is(#filelist, #file-list-rows).tree .${row}::before`,
  ).get("left");
}

describe("file tree indent guides", () => {
  test.each([
    { name: "plain", state: "" },
    { name: "active", state: ".active" },
  ])("$name: folder and file rows have the same left border", ({ state }) => {
    const dir = declarationsFor("tree-dir", state);
    const file = declarationsFor("tree-file", state);
    expect({
      dir: dir.get("border-left") ?? dir.get("border-left-width"),
      file: file.get("border-left") ?? file.get("border-left-width"),
    }).toEqual({ dir: "0", file: "0" });
  });

  test("folder and file rows start the guide at the same place", () => {
    expect([guideStart("tree-dir"), guideStart("tree-file")]).toEqual([
      "12px",
      "12px",
    ]);
  });
});
