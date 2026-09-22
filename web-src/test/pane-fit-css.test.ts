// 狭い面・狭い帯でも、中身が面の外へはみ出したり語が潰れたりしないための宣言。
import { expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

const rules = baseRules(loadStyleSheet());

test.each([
  // fit は親の computed の寸法から行・桁を決め、親の余白を引かない
  [".terminal-screen-row > .terminal-screen", "box-sizing", "content-box"],
  // 画像のタブの 2 段目: 縮むのはパスだけ
  [".image-tab-actions", "flex", "none"],
  // Diff の帯の詰め方は窓でなく帯の実幅 (@container topbar) で決める
  ["#topbar", "container", "topbar / inline-size"],
  // 左の列の見出し: 「ツリー / 一覧」と題の語を折らない
  ["#sidebar .sb-head .sb-view-seg", "min-width", "max-content"],
  ["#sidebar .sb-head > .sb-title", "white-space", "nowrap"],
])("%s has %s: %s", (selector, property, expected) => {
  expect(
    cascadedDeclarations(rules, (candidate) => candidate === selector).get(
      property,
    ),
  ).toBe(expected);
});
