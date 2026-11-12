// 畳んだサイドバーの「サイドバーを表示」(#nav-expand) の、手が要るエージェントの印。
// app.ts の syncNavExpandMark が一番急ぐもの (attentionPanes の先頭) の状態を
// data-attention に付け、style.css が入力待ち・完了の色の点を右上に重ねる。

import { describe, expect, test } from "vitest";
import { attentionPanes } from "../core/agent-overview";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";
import { agentPane } from "./_test-helpers";

const rules = baseRules(loadStyleSheet());
const root = cascadedDeclarations(rules, (selector) => selector === ":root");

function dot(attention: string): Map<string, string> {
  return cascadedDeclarations(
    rules,
    (selector) =>
      selector === "#nav-expand[data-attention]::after" ||
      selector === `#nav-expand[data-attention="${attention}"]::after`,
  );
}

describe("the mark on Show sidebar", () => {
  test.each([
    ["waiting", "--color-waiting"],
    ["done", "--color-done"],
  ])("%s is drawn in %s", (attention, token) => {
    const declarations = dot(attention);
    expect(declarations.get("content")).toBe('""');
    expect(resolveVar(declarations.get("background") ?? "", root)).toBe(
      resolveVar(`var(${token})`, root),
    );
  });

  test("the mark follows the most urgent agent (waiting before done)", () => {
    const panes = [
      agentPane({ id: "%1", state: "done", kind: "claude" }),
      agentPane({ id: "%2", state: "waiting", kind: "claude" }),
    ];
    expect(attentionPanes(panes)[0]?.state).toBe("waiting");
    expect(
      attentionPanes([panes[0] ?? agentPane({ id: "%9" })])[0]?.state,
    ).toBe("done");
  });
});
