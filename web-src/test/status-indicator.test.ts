import { describe, expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

const rules = loadStyleSheet();

function statusDotDeclarations(state: string): Map<string, string> {
  return cascadedDeclarations(
    baseRules(rules),
    (selector) =>
      selector === "#status::before" || selector === `#status.${state}::before`,
  );
}

describe("header status indicator", () => {
  // 繋がっている間 (live) もずっと出ている点なので、どの状態でも動かさない
  // (点滅させるとページが毎秒 60 回描き直され、端末の打鍵の表示が遅れた)。
  test.each([
    { state: "live" },
    { state: "refreshing" },
    { state: "error" },
    { state: "idle" },
  ])("$state の点は動かない", ({ state }) => {
    expect(statusDotDeclarations(state).get("animation")).toBeUndefined();
  });
});
