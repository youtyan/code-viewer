// style.css 末尾の「Phone (SP)」の節を、カスケードの結果として検査する
// (_css-fixture.ts の at-rule 追跡)。生の文字列は見ない。
//
// 守ること:
// - 節の条件は core/mobile-layout.ts の media query と同じ (CSS は変数を読めない)
// - 電話の段では左のサイドバー・一覧の列・右の列が場所を取らず、本文が全幅
// - 下端に切替の帯、上下に安全領域
// - 指の画面では押せるものが 44px 以上
// - 足した部品と SP の名前は SP の節の外に漏れない (デスクトップを変えない)
import { describe, expect, test } from "vitest";
import {
  PHONE_LANDSCAPE_MEDIA_QUERY,
  PHONE_MEDIA_QUERY,
  SOFT_KEYS_MEDIA_QUERY,
  TOUCH_MEDIA_QUERY,
} from "../core/mobile-layout";
import {
  baseRules,
  type CssRule,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

const PHONE = `@media ${PHONE_MEDIA_QUERY}`;
const SOFT_KEYS = `@media ${SOFT_KEYS_MEDIA_QUERY}`;
const TOUCH = `@media ${TOUCH_MEDIA_QUERY}`;
const PHONE_LANDSCAPE = `@media ${PHONE_LANDSCAPE_MEDIA_QUERY}`;
const SP_AT_RULES = [PHONE, PHONE_LANDSCAPE, SOFT_KEYS, TOUCH];

const sheet = loadStyleSheet();
/** デスクトップの規則 (@media の外) に、指定した SP の節を後ろから重ねたもの。 */
function withTiers(...atRules: string[]): CssRule[] {
  return [
    ...baseRules(sheet),
    ...sheet.filter((rule) => rule.atRule && atRules.includes(rule.atRule)),
  ];
}

function declarationsOf(rules: CssRule[], selectors: string[]) {
  return cascadedDeclarations(rules, (selector) =>
    selectors.includes(selector),
  );
}

/**
 * body で決まる変数。:root と html で決めた値を、body で宣言し直した値が上書き
 * する (body は自分の宣言を使い、親から継いだ値は使わない)。この道具は要素を
 * 持たないので、:root / html と body を分けて解決して重ねる。
 */
function bodyVariables(rules: CssRule[], ...extra: string[]) {
  const onlyVariables = (map: Map<string, string>) =>
    [...map].filter(([name]) => name.startsWith("--"));
  return new Map([
    ...onlyVariables(declarationsOf(rules, [":root", "html"])),
    ...onlyVariables(declarationsOf(rules, ["body", ...extra])),
  ]);
}

describe("SP の節の条件", () => {
  test.each(SP_AT_RULES)("%s の規則がある", (atRule) => {
    expect(
      sheet.filter((rule) => rule.atRule === atRule).length,
    ).toBeGreaterThan(0);
  });

  test("SP の部品と名前は SP の節の外に書かない (デスクトップを変えない)", () => {
    const leaked = sheet
      .filter((rule) => !rule.atRule || !SP_AT_RULES.includes(rule.atRule))
      .filter(
        (rule) =>
          /mobile-|--sp-/.test(rule.selector) ||
          [...rule.declarations].some(
            ([name, value]) =>
              name.startsWith("--sp-") || value.includes("--sp-"),
          ),
      )
      .map((rule) => `${rule.atRule ?? "(base)"} ${rule.selector}`);
    expect(leaked).toEqual([]);
  });
});

describe("電話の段の骨格", () => {
  const rules = withTiers(SOFT_KEYS, PHONE);

  test.each([
    {
      name: "左の固定物",
      variable: "--chrome-left",
      expected: "env(safe-area-inset-left, 0px)",
    },
    { name: "一覧の列", variable: "--listcol-shown", expected: "0px" },
    {
      name: "右の列",
      variable: "--panelcol-shown",
      expected: "env(safe-area-inset-right, 0px)",
    },
    {
      // タブ列の右端 (デスクトップでは右の列の頭の行の幅)
      name: "右の列の頭の行",
      variable: "--panelcol-head-w",
      expected: "env(safe-area-inset-right, 0px)",
    },
    {
      name: "本文の右端",
      variable: "--page-right",
      expected: "env(safe-area-inset-right, 0px)",
    },
  ])("$name は場所を取らない (安全領域だけ)", ({ variable, expected }) => {
    const vars = bodyVariables(
      rules,
      "body.gdp-sidebar-hidden",
      "body.main-split",
    );
    expect(resolveVar(vars.get(variable) ?? "", vars)).toBe(expected);
  });

  test.each([
    {
      name: "一覧の列を出す画面",
      selector: "body[data-list-column]:not([data-list-column-hidden])",
      variable: "--listcol-shown",
      expected: "0px",
    },
    {
      name: "右の列を畳んだ画面",
      selector: "body.gdp-sidebar-hidden",
      variable: "--panelcol-shown",
      expected: "env(safe-area-inset-right, 0px)",
    },
    {
      name: "2 面",
      selector: "body.main-split",
      variable: "--page-right",
      expected: "env(safe-area-inset-right, 0px)",
    },
  ])("$name でもデスクトップの上書きに負けない", ({
    selector,
    variable,
    expected,
  }) => {
    const vars = new Map([
      ...bodyVariables(rules),
      ...[...declarationsOf(rules, [selector])].filter(([n]) =>
        n.startsWith("--"),
      ),
    ]);
    expect(resolveVar(vars.get(variable) ?? "", vars)).toBe(expected);
  });

  test("下端は最下段と切替の帯 (ホームバーの安全領域込み)", () => {
    const vars = bodyVariables(rules);
    vars.set("--statusbar-h", "S");
    vars.set("--sp-touch", "T");
    expect(resolveVar(vars.get("--chrome-bottom") ?? "", vars)).toBe(
      "calc(S + calc(T + env(safe-area-inset-bottom, 0px)))",
    );
  });

  test("上端はタブ列に安全領域を足し、タブ列はその分だけ下げて描く", () => {
    const vars = bodyVariables(rules);
    vars.set("--main-tabs-h", "M");
    expect(resolveVar(vars.get("--global-header-h") ?? "", vars)).toBe(
      "calc(M + env(safe-area-inset-top, 0px))",
    );
    const tabs = declarationsOf(rules, ["#main-tabs"]);
    expect(tabs.get("padding-top")).toBe("var(--sp-safe-top)");
    expect(tabs.get("height")).toBe("var(--global-header-h)");
  });

  test.each([
    {
      name: "閉じている引き出し",
      selectors: ["#app-nav"],
      transform: "translateX(-100%)",
      visibility: "hidden",
    },
    {
      name: "開いた引き出し",
      selectors: ["#app-nav", "body.mobile-nav-open #app-nav"],
      transform: "none",
      visibility: "visible",
    },
    {
      name: "閉じている面 (木)",
      selectors: ["#sidebar"],
      transform: "translateY(100vh)",
      visibility: "hidden",
    },
    {
      name: "開いた面 (木)",
      selectors: ["#sidebar", "body.mobile-sheet-open #sidebar"],
      transform: "none",
      visibility: "visible",
    },
    {
      name: "閉じている面 (履歴)",
      selectors: ["#history-panel"],
      transform: "translateY(100vh)",
      visibility: "hidden",
    },
    {
      name: "開いた面 (履歴)",
      selectors: ["#history-panel", "body.mobile-sheet-open #history-panel"],
      transform: "none",
      visibility: "visible",
    },
  ])("$name", ({ selectors, transform, visibility }) => {
    const box = declarationsOf(rules, selectors);
    expect(box.get("transform")).toBe(transform);
    expect(box.get("visibility")).toBe(visibility);
  });

  test("畳んだ設定 (html[data-nav-collapsed]) でも引き出しは出せる", () => {
    const box = declarationsOf(rules, [
      "#app-nav",
      "html[data-nav-collapsed] #app-nav",
    ]);
    expect(box.get("display")).toBe("flex");
  });

  test("面の一覧は面の頭の下から最下段の上まで、画面の幅いっぱい", () => {
    const box = declarationsOf(rules, [
      "#sidebar",
      "body[data-list-column] #sidebar",
    ]);
    expect(box.get("top")).toBe("var(--panel-body-top)");
    expect(box.get("bottom")).toBe("var(--chrome-bottom)");
    expect(box.get("left")).toBe("var(--chrome-left)");
    expect(box.get("right")).toBe("var(--panelcol-shown)");
  });

  test.each([
    '.main-tabs-pane[data-side="right"]',
    ".main-tabs-split",
    '.main-pane-host[data-side="right"].is-shown',
    "body.main-split .main-split-divider",
    "#app-nav-resizer",
    "#sidebar-toggle",
    "#history-resizer",
    "#statusbar .usage-status",
    "#statusbar .statusbar-actions",
  ])("2 面・幅の掴み・最下段の細部は出さない: %s", (selector) => {
    expect(declarationsOf(rules, [selector]).get("display")).toMatch(/^none/);
  });

  test("切替の帯は下端に貼り、ホームバーの分だけ内側を空ける", () => {
    const bar = declarationsOf(rules, [".mobile-bar:not([hidden])"]);
    expect(bar.get("position")).toBe("fixed");
    expect(bar.get("bottom")).toBe("0");
    expect(bar.get("height")).toBe("var(--sp-bar-h)");
    expect(bar.get("padding")).toBe(
      "0 var(--sp-safe-right) var(--sp-safe-bottom) var(--sp-safe-left)",
    );
  });

  test.each([
    { name: "縦向き", tiers: [SOFT_KEYS, PHONE], expected: "calc(H + 12vh)" },
    {
      name: "横向き",
      tiers: [SOFT_KEYS, PHONE, PHONE_LANDSCAPE],
      expected: "H",
    },
  ])("$name の面の上端", ({ tiers, expected }) => {
    const vars = bodyVariables(withTiers(...tiers));
    vars.set("--global-header-h", "H");
    expect(resolveVar(vars.get("--sp-sheet-top") ?? "", vars)).toBe(expected);
  });

  test("横向きでは引き出しの下の項目を横 1 列にし、名前は読み上げ用に残す", () => {
    const landscape = withTiers(SOFT_KEYS, PHONE, PHONE_LANDSCAPE);
    expect(declarationsOf(landscape, [".nav-foot"]).get("flex-direction")).toBe(
      "row",
    );
    const label = declarationsOf(landscape, [".nav-foot-label"]);
    expect(label.get("display")).toBeUndefined();
    expect(label.get("clip-path")).toBe("inset(50%)");
  });

  // 変数を最後まで解決する (骨格の名前が消えたら resolveVar が投げて落ちる)。
  test("面の一覧は面の頭 (タブ列と同じ高さの 1 段) の下から", () => {
    const vars = bodyVariables(withTiers(SOFT_KEYS, PHONE));
    vars.set("--global-header-h", "H");
    vars.set("--main-tabs-h", "M");
    expect(resolveVar(vars.get("--panel-body-top") ?? "", vars)).toBe(
      "calc(calc(H + 12vh) + M)",
    );
    expect(
      declarationsOf(withTiers(SOFT_KEYS, PHONE), ["#panel-head"]).get(
        "height",
      ),
    ).toBe("var(--main-tabs-h)");
  });

  // 右の列を畳んでも (一覧の画面・利用者が畳んだ) 絵柄は頭の行に残る
  // (デスクトップと同じ。帯は無い)。頭の行を隠すと面から絵柄が消える。
  test("右の列を畳んでも面の頭の絵柄は横に並んだまま出る", () => {
    const rules = withTiers(SOFT_KEYS, PHONE);
    const head = declarationsOf(rules, [
      ".view-head",
      "#panel-head > #view-head",
      "body.gdp-sidebar-hidden #panel-head > #view-head",
    ]);
    const strip = declarationsOf(rules, [
      "#panel-head > #view-head > .view-strip",
    ]);
    expect({
      display: head.get("display"),
      direction: head.get("flex-direction"),
      stripDirection: strip.get("flex-direction"),
      stripHeight: strip.get("height"),
    }).toEqual({
      display: "flex",
      direction: "row",
      stripDirection: "row",
      stripHeight: "var(--main-tabs-h)",
    });
  });

  test("タブ列の左端は引き出しのボタンと短い名前の幅", () => {
    const vars = bodyVariables(withTiers(SOFT_KEYS, PHONE));
    vars.set("--space-unit", "U");
    expect(resolveVar(vars.get("--tabs-lead-w") ?? "", vars)).toBe(
      "calc(44px + U * 30)",
    );
  });

  test("ソフトキーボードが出ている間は下端をキーボードの上にする", () => {
    const vars = declarationsOf(rules, ["body.mobile-keyboard-open"]);
    expect(vars.get("--chrome-bottom")).toBe("var(--sp-keyboard-h, 0px)");
  });
});

describe("端末の操作札", () => {
  const rules = withTiers(SOFT_KEYS);

  test.each([
    {
      name: "前面が端末でない",
      selectors: [".mobile-keys:not([hidden])"],
      expected: "none",
    },
    {
      name: "左の面の前面が端末",
      selectors: [
        ".mobile-keys:not([hidden])",
        'body:has(.main-pane-host[data-side="left"][data-kind="terminal"].is-shown) .mobile-keys:not([hidden])',
      ],
      expected: "flex",
    },
  ])("$name → display $expected", ({ selectors, expected }) => {
    expect(declarationsOf(rules, selectors).get("display")).toBe(expected);
  });

  test("札の帯の分だけ面の箱 (端末) の下端を上げる", () => {
    const vars = bodyVariables(rules);
    vars.set("--chrome-bottom", "B");
    const shown = declarationsOf(rules, [
      'body:has(.main-pane-host[data-side="left"][data-kind="terminal"].is-shown)',
    ]);
    vars.set("--sp-keys-visible-h", shown.get("--sp-keys-visible-h") ?? "");
    vars.set("--space-2", "P");
    expect(resolveVar(vars.get("--main-bottom") ?? "", vars)).toBe(
      "calc(B + calc(44px + P))",
    );
  });
});

describe("指の画面の押せる大きさ", () => {
  const rules = withTiers(SOFT_KEYS, TOUCH);
  const vars = bodyVariables(rules);

  test.each([
    ".main-tabs-action",
    ".global-icon-action",
    ".agents-icon-action",
    ".nav-icon-action",
    ".nav-row-action",
    ".view-strip-item",
    "#statusbar .agent-status",
  ])("%s は幅も高さも 44px 以上", (selector) => {
    const box = declarationsOf(rules, [selector]);
    expect(resolveVar(box.get("min-height") ?? "", vars)).toBe("44px");
    expect(resolveVar(box.get("min-width") ?? "", vars)).toBe("44px");
  });

  test.each([
    ".nav-agent",
    ".nav-project-head",
    ".nav-project-toggle",
    ".nav-foot-item",
    ".nav-search",
    ".agents-primary",
    ".agents-secondary",
    ".agents-text-action",
    ".agents-filter button",
    ".nav-empty-action",
    ".nav-note-link",
    ".history-item",
    "#filelist.tree:not(.tree-virtual) .tree-file",
    "#filelist.tree:not(.tree-virtual) .tree-dir",
    ".mobile-key",
  ])("%s の行は 44px 以上", (selector) => {
    const box = declarationsOf(rules, [selector]);
    expect(resolveVar(box.get("min-height") ?? "", vars)).toBe("44px");
  });

  test.each([
    { name: "タブ列", variable: "--main-tabs-h" },
    { name: "最下段", variable: "--statusbar-h" },
  ])("$name の高さは 44px", ({ variable }) => {
    const withDensity = new Map([
      ...vars,
      ...[...declarationsOf(rules, ["body[data-sidebar-font-size]"])].filter(
        ([n]) => n.startsWith("--"),
      ),
    ]);
    expect(resolveVar(withDensity.get(variable) ?? "", withDensity)).toBe(
      "44px",
    );
  });

  test("hover の無い画面では行の操作を最初から押せる", () => {
    const actions = declarationsOf(rules, [".nav-project-actions"]);
    expect(actions.get("opacity")).toBe("1");
    expect(actions.get("pointer-events")).toBe("auto");
  });
});
