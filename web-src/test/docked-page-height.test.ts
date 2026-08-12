import { describe, expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

// 自前の箱で画面いっぱいを占めるページ (topbar を隠し、#content に高さを
// 与えられていないページ) は、高さを --content-h からしか取れない。親に
// 高さが無いので height: 100% は解決先を失って auto に落ち、ページ全体が
// 中身の高さまで縮む。実際にその上書きが入り、下パネルを「画面内」にした
// ときだけデータストア / ワークログが画面途中で切れていた。
const rules = baseRules(loadStyleSheet());

type Page = {
  /** 失敗ログ用の表示名。 */
  name: string;
  /** body に付くページクラス。--chrome-h をここで上書きしている。 */
  bodyClass: string;
  /** #content 直下で画面いっぱいを占める箱。 */
  box: string;
};

const PAGES: Page[] = [
  { name: "datastore", bodyClass: "gdp-database-page", box: ".db-root" },
  { name: "journal", bodyClass: "gdp-journal-page", box: ".journal-page" },
];

/** 下パネルが画面内 (docked) か、本文の上に浮いている (overlay) か。 */
type PanelLayout = "docked" | "overlay";

function bodyVariables(page: Page, layout: PanelLayout): Map<string, string> {
  return cascadedDeclarations(
    rules,
    (selector) =>
      selector === ":root" ||
      selector === "html" ||
      selector === "body" ||
      selector === `body.${page.bodyClass}` ||
      (layout === "docked" && selector === "body.app-panel-docked"),
  );
}

function boxHeight(page: Page, layout: PanelLayout): string {
  const declarations = cascadedDeclarations(
    rules,
    (selector) =>
      selector === page.box ||
      (layout === "docked" && selector === `body.app-panel-docked ${page.box}`),
  );
  const height = declarations.get("height");
  if (!height) throw new Error(`Missing height declaration for ${page.box}`);
  return resolveVar(height, bodyVariables(page, layout));
}

function panelOccupiedHeight(page: Page, layout: PanelLayout): string {
  const variables = bodyVariables(page, layout);
  const occupied = variables.get("--app-panel-visible-height");
  if (!occupied) throw new Error("Missing --app-panel-visible-height");
  return resolveVar(occupied, variables);
}

const CASES = PAGES.flatMap((page) =>
  (["overlay", "docked"] as PanelLayout[]).map((layout) => ({
    name: `${page.name} / ${layout}`,
    page,
    layout,
  })),
);

describe("full-height pages under the bottom panel", () => {
  test.each(
    CASES,
  )("$name: sizes its box from the viewport minus the panel it shares space with", ({
    page,
    layout,
  }) => {
    const height = boxHeight(page, layout);
    // viewport 由来でなくなっていたら、親依存の height (100% など) に
    // 上書きされている。
    expect(height).toContain("100vh");
    // 下パネルが占有する分が引かれていること。
    expect(height).toContain(panelOccupiedHeight(page, layout));
  });

  test.each(
    PAGES,
  )("$name: shrinks when the bottom panel takes space in the layout", (page) => {
    expect(boxHeight(page, "docked")).not.toBe(boxHeight(page, "overlay"));
  });
});
