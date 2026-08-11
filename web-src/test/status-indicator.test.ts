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
  test.each([
    { state: "live", animated: true },
    { state: "refreshing", animated: false },
    { state: "error", animated: false },
    { state: "idle", animated: false },
  ])("$state のアニメーションは $animated", ({ state, animated }) => {
    const animation = statusDotDeclarations(state).get("animation");
    expect(Boolean(animation)).toBe(animated);
    if (animated) expect(animation).toContain("status-live-pulse");
  });

  test("動きを減らす設定ではパルスを止める", () => {
    const reducedMotionRules = rules.filter(
      (rule) => rule.atRule === "@media (prefers-reduced-motion: reduce)",
    );
    const declarations = cascadedDeclarations(
      reducedMotionRules,
      (selector) => selector === "#status.live::before",
    );

    expect(declarations.get("animation")).toBe("none");
    expect(
      rules.some((rule) => rule.atRule === "@keyframes status-live-pulse"),
    ).toBe(true);
  });
});
