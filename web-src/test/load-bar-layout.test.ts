import { describe, expect, test } from "vitest";
import {
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

const rules = loadStyleSheet();

/**
 * #load-bar とその上の body だけを見る。他の要素はこのテストの関心外。
 * body には :root の値に加えて `html, body` の規則 (密度で変わる --space-unit・
 * タブ列の高さ・上に居座る固定物の合計) が載る。
 */
function selectorMatches(
  selector: string,
  target: "body" | "load-bar",
  bodyClass?: string,
): boolean {
  if (target === "body") {
    return (
      selector === ":root" ||
      selector === "body" ||
      selector === `body.${bodyClass}`
    );
  }
  return (
    selector === "#load-bar" ||
    (bodyClass != null && selector === `body.${bodyClass} #load-bar`)
  );
}

function loadBarTopFor(bodyClass?: string): string {
  const bodyDeclarations = cascadedDeclarations(rules, (selector) =>
    selectorMatches(selector, "body", bodyClass),
  );
  const loadBarDeclarations = cascadedDeclarations(rules, (selector) =>
    selectorMatches(selector, "load-bar", bodyClass),
  );
  const top = loadBarDeclarations.get("top");
  if (!top) throw new Error("Missing #load-bar top declaration");
  return resolveVar(top, bodyDeclarations);
}

/** 既定の密度の body での固定物の高さ。値そのものは固定しない (密度や骨格で変わる)。 */
function rootLength(name: string): string {
  const root = cascadedDeclarations(
    rules,
    (selector) => selector === ":root" || selector === "body",
  );
  return resolveVar(`var(${name})`, root);
}

describe("load-bar layout", () => {
  test("keeps the global loading bar below visible diff chrome", () => {
    expect(loadBarTopFor()).toBe(
      `calc(${rootLength("--global-header-h")} + ${rootLength("--topbar-h")})`,
    );
  });

  test("places the loading bar directly below the header on pages without topbar", () => {
    const header = rootLength("--global-header-h");
    expect(loadBarTopFor("gdp-database-page")).toBe(header);
    expect(loadBarTopFor("gdp-file-detail-page")).toBe(header);
    expect(loadBarTopFor("gdp-repo-page")).toBe(header);
  });
});
