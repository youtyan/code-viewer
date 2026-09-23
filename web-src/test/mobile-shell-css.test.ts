// style.css 末尾の「Phone (SP)」の節を、カスケードの結果として検査する
// (_css-fixture.ts の at-rule 追跡)。生の文字列は見ない。
//
// 守ること:
// - 節の条件は core/mobile-layout.ts の media query と同じ (CSS は変数を読めない)
// - 電話の段では左のサイドバー・一覧の列・右の列が場所を取らず、本文が全幅
// - 下端に切替の帯、上下に安全領域
// - 指の画面では押せるものが 44px 以上
// - 足した部品と SP の名前は SP の節の外に漏れない (デスクトップを変えない)
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  LONG_PRESS_TARGETS,
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
      name: "右端の固定物",
      variable: "--chrome-right",
      expected: "env(safe-area-inset-right, 0px)",
    },
    {
      // タブ列の左端 (デスクトップでは一覧の列の頭の幅)
      name: "一覧の列の頭",
      variable: "--column-head-w",
      expected: "0px",
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
      name: "ファイル一覧を畳んだ画面",
      selector: "body.gdp-sidebar-hidden",
      variable: "--listcol-shown",
      expected: "0px",
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

  // 面に出すのはファイル一覧 (#file-list) か、一覧を出す画面ではその一覧。
  test.each([
    ["#sidebar", "body[data-list-column] #sidebar"],
    ["#file-list"],
  ])("面の一覧 %s は面の頭の下から最下段の上まで、画面の幅いっぱい", (...selectors) => {
    const box = declarationsOf(rules, selectors);
    expect(box.get("top")).toBe("var(--panel-body-top)");
    expect(box.get("bottom")).toBe("var(--chrome-bottom)");
    expect(box.get("left")).toBe("var(--chrome-left)");
    expect(box.get("right")).toBe("var(--chrome-right)");
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
    // 差分のカードの見出しの「確認済み」「ファイルを見る」と、折り返しの切替。
    ".d2h-file-header .d2h-file-collapse",
    ".d2h-file-header .gdp-view-file",
    ".mobile-wrap-toggle",
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

  // 仮想表示の木 (Files の木はいつもこれ) は、行の位置を TS が数えるので、
  // CSS も同じ max (密度の行の高さと 44px の大きい方) を使う。
  test.each([
    "#filelist.tree.tree-virtual .tree-file",
    "#filelist.tree.tree-virtual .tree-dir",
  ])("%s の行は密度の行の高さと 44px の大きい方", (selector) => {
    const box = declarationsOf(rules, [selector]);
    expect([box.get("height"), box.get("min-height")]).toEqual([
      "max(var(--ui-row-h), var(--sp-touch))",
      "max(var(--ui-row-h), var(--sp-touch))",
    ]);
  });

  test("hover の無い画面では行の操作を最初から押せる", () => {
    const actions = declarationsOf(rules, [".nav-project-actions"]);
    expect(actions.get("opacity")).toBe("1");
    expect(actions.get("pointer-events")).toBe("auto");
  });
});

// History・選んでいる作業ツリーでは、面を上下 2 段に分ける: 上に一覧、下にその
// 変更ファイルの木 (デスクトップの一覧の右の 2 列目)。以前は電話で木を出す手段が
// 無かった。2 段は同じ線 (--sp-sheet-mid) で接し、木は畳んだ設定でも出す。
describe("the History / worktree sheet stacks the list over the changed files", () => {
  const rules = withTiers(PHONE);
  test.each([
    ["history", 'body[data-list-column="history"] #history-panel'],
    [
      "worktree",
      'body[data-list-column="worktree"]:not([data-worktree-overview]) #worktree-panel',
    ],
  ])("%s", (column, listSelector) => {
    const tree = declarationsOf(rules, [
      `body[data-list-column="${column}"] #sidebar`,
    ]);
    const list = declarationsOf(rules, [listSelector]);
    const mid = bodyVariables(rules, `body[data-list-column="${column}"]`).get(
      "--sp-sheet-mid",
    );
    expect({
      treeShown: tree.get("display"),
      treeTop: tree.get("top"),
      listBottom: list.get("bottom"),
      midDefined: mid !== undefined,
    }).toEqual({
      treeShown: "block !important",
      treeTop: "var(--sp-sheet-mid)",
      listBottom: "calc(100dvh - var(--sp-sheet-mid))",
      midDefined: true,
    });
  });
});

// 差分の長い行の折り返しは電話の段だけ (切替を押したときの body の印で効く)。
// 行の番号の列はそのまま、字の欄だけを折り返す。デスクトップの規則には無い。
describe("wrapping long diff lines on the phone", () => {
  const ctn = "body.mobile-diff-wrap table.d2h-diff-table .d2h-code-line-ctn";
  test("the phone tier wraps the text column", () => {
    const text = declarationsOf(withTiers(PHONE), [ctn]);
    expect([text.get("white-space"), text.get("overflow-wrap")]).toEqual([
      "pre-wrap",
      "anywhere",
    ]);
  });

  test("the desktop has no wrap rule", () => {
    expect(declarationsOf(baseRules(sheet), [ctn]).size).toBe(0);
  });
});

// 下端の帯: いま見ている画面の入口は色と上端の線、「エージェント」には入力待ちの
// 件数の札 (場所を取らない重ね)。
describe("the bottom bar marks the current view and waiting agents", () => {
  const rules = withTiers(PHONE);
  test("the current view", () => {
    const item = declarationsOf(rules, [
      '.mobile-bar-item[aria-current="page"]',
    ]);
    expect([item.get("color"), item.get("box-shadow")]).toEqual([
      "var(--color-accent-strong)",
      "inset 0 calc(var(--space-1) / 2) 0 var(--color-accent)",
    ]);
  });

  test("the waiting badge sits over the icon without taking room", () => {
    const badge = declarationsOf(rules, [".mobile-bar-badge:not([hidden])"]);
    const item = declarationsOf(rules, [".mobile-bar-item"]);
    expect([
      badge.get("position"),
      item.get("position"),
      badge.get("background"),
    ]).toEqual(["absolute", "relative", "var(--color-waiting)"]);
  });
});

// 電話の幅では、上の行があった頃の古い節 (900px・640px) も効く。そのうち
// body.gdp-history-page #history-panel (position: static) が SP の節の
// #history-panel (fixed) に詳細度で勝ち、History の一覧だけが面の位置に来ず、
// 画面の上端から本文に重なっていた。電話の幅で効く節を全部重ね、実際の要素に
// 当たる規則だけで解く (当たりは happy-dom)。
describe("on a phone the History list sits in the sheet", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("fixed at the sheet's top, stopping where the changed files start", () => {
    document.body.className = "gdp-history-page";
    document.body.dataset.listColumn = "history";
    document.body.innerHTML = '<aside id="history-panel"></aside>';
    const panel = document.getElementById("history-panel");
    if (!panel) throw new Error("missing #history-panel");
    const onPhone = [
      ...baseRules(sheet),
      ...sheet.filter(
        (rule) =>
          rule.atRule !== null &&
          [
            "@media (max-width: 900px)",
            "@media (max-width: 640px)",
            PHONE,
            SOFT_KEYS,
            TOUCH,
          ].includes(rule.atRule),
      ),
    ];
    const won = cascadedDeclarations(
      onPhone,
      (selector) => !selector.includes("::") && panel.matches(selector),
    );
    expect([won.get("position"), won.get("top"), won.get("bottom")]).toEqual([
      "fixed",
      "var(--panel-body-top)",
      "calc(100dvh - var(--sp-sheet-mid))",
    ]);
  });
});

// 電話の段のタブの一覧: 入口 (タブ列の右端) はデスクトップでは hidden で消え、
// 一覧は一覧の面と同じ場所に下から出す。行と×は指の大きさ。
describe("the open tabs sheet", () => {
  const rules = withTiers(SOFT_KEYS, PHONE);
  const vars = bodyVariables(rules);

  test("the entry in the tab strip is gone while hidden (the desktop)", () => {
    expect(
      declarationsOf(baseRules(sheet), [".main-tabs-list-open[hidden]"]).get(
        "display",
      ),
    ).toBe("none");
  });

  test("the sheet sits where the list sheet does, off screen until opened", () => {
    const closed = declarationsOf(rules, [".mobile-tabs:not([hidden])"]);
    const opened = declarationsOf(rules, [
      "body.mobile-tabs-open .mobile-tabs:not([hidden])",
    ]);
    const scrim = declarationsOf(rules, [
      "body.mobile-tabs-open .mobile-scrim:not([hidden])",
    ]);
    expect({
      closed: [
        closed.get("position"),
        closed.get("top"),
        closed.get("bottom"),
        closed.get("transform"),
        closed.get("visibility"),
      ],
      opened: [opened.get("transform"), opened.get("visibility")],
      scrim: scrim.get("display"),
    }).toEqual({
      closed: [
        "fixed",
        "var(--sp-sheet-top)",
        "var(--chrome-bottom)",
        "translateY(100vh)",
        "hidden",
      ],
      opened: ["none", "visible"],
      scrim: "block",
    });
  });

  test.each([
    { selector: ".mobile-tabs-open", property: "min-height" },
    { selector: ".mobile-tabs-x", property: "width" },
    { selector: ".mobile-tabs-x", property: "height" },
  ])("$selector $property is a finger's size", ({ selector, property }) => {
    const box = declarationsOf(rules, [selector]);
    expect(resolveVar(box.get(property) ?? "", vars)).toBe("44px");
  });
});

// 長押しで右クリックのメニューを出す行は、指の画面で文字の選択とリンクの既定の
// メニューを出さない (core/mobile-layout.ts の LONG_PRESS_TARGETS と同じ並び)。
describe("long press rows on a touch screen", () => {
  const targets = LONG_PRESS_TARGETS.split(",").map((part) => part.trim());
  test.each(targets)("%s: no text selection, no link callout", (selector) => {
    const onTouch = declarationsOf(withTiers(TOUCH), [selector]);
    const onDesktop = declarationsOf(baseRules(sheet), [selector]);
    expect({
      touch: [
        onTouch.get("user-select"),
        onTouch.get("-webkit-user-select"),
        onTouch.get("-webkit-touch-callout"),
      ],
      // デスクトップには足さない (タブはもともと選択しない)。
      desktop: onDesktop.get("-webkit-touch-callout") ?? null,
    }).toEqual({ touch: ["none", "none", "none"], desktop: null });
  });

  test("the menu items are a finger's height", () => {
    const rules = withTiers(SOFT_KEYS, TOUCH);
    const item = declarationsOf(rules, [".gdp-context-menu button"]);
    expect([
      item.get("height"),
      resolveVar(item.get("min-height") ?? "", bodyVariables(rules)),
    ]).toEqual(["auto", "44px"]);
  });

  test("two fingers on the terminal do not zoom the page", () => {
    expect(
      declarationsOf(withTiers(TOUCH), [
        '.main-pane-host[data-kind="terminal"]',
      ]).get("touch-action"),
    ).toBe("pan-x pan-y");
  });
});

// 横向きの電話: 高さ 390 のうち端末に残るのは 200px 前後だった。最下段を隠し、
// 下端の帯を細く (絵と名前を横に並べる) する。縦向きは変えない。
describe("a landscape phone gives the height back", () => {
  const landscape = withTiers(SOFT_KEYS, PHONE, PHONE_LANDSCAPE);

  test("the bottom is only the thin bar (no status bar)", () => {
    const vars = bodyVariables(landscape);
    vars.set("--space-unit", "U");
    expect({
      bottom: resolveVar(vars.get("--chrome-bottom") ?? "", vars),
      statusbar: declarationsOf(landscape, ["#statusbar"]).get("display"),
    }).toEqual({
      bottom: "calc(calc(U * 9) + env(safe-area-inset-bottom, 0px))",
      statusbar: "none",
    });
  });

  test("the bar lays the icon beside the name at the thin height", () => {
    const item = declarationsOf(landscape, [".mobile-bar-item"]);
    expect([item.get("flex-direction"), item.get("height")]).toEqual([
      "row",
      "var(--sp-bar-compact-h)",
    ]);
  });

  test("a portrait phone keeps the status bar", () => {
    const portrait = withTiers(SOFT_KEYS, PHONE);
    expect(declarationsOf(portrait, ["#statusbar"]).get("display")).not.toBe(
      "none",
    );
  });
});

// 設定とヘルプは電話では 2 段の画面: 目次を開いている間は目次だけ、節では本文だけ。
// 面が狭いとき (@container help-shell) の規則は 2 面のデスクトップにもあるので、
// 2 段にする規則は電話の段の中に入れ子にする (デスクトップの狭い面は今のまま)。
describe("settings on a phone are contents, then a section", () => {
  const CONTAINER = "@container help-shell (max-width: 579px)";
  const inside = (outer: string[]) =>
    sheet.filter(
      (rule) =>
        rule.atRules.length === outer.length &&
        rule.atRules.every((atRule, index) => atRule === outer[index]),
    );

  test("the phone hides the section while the contents are open, and the toggle row", () => {
    const rules = inside([PHONE, CONTAINER]);
    expect({
      content: declarationsOf(rules, [
        ".gdp-help-nav-open > .gdp-help-content",
      ]).get("display"),
      toggle: declarationsOf(rules, [
        ".gdp-help-nav-open > .gdp-help-nav-toggle",
      ]).get("display"),
    }).toEqual({ content: "none", toggle: "none" });
  });

  test("a narrow desktop side keeps the contents above the section", () => {
    const rules = inside([CONTAINER]);
    expect(
      declarationsOf(rules, [".gdp-help-nav-open > .gdp-help-content"]).size,
    ).toBe(0);
  });
});

// 電話の段の文字の大きさ: 既定の密度のときだけ画面の文字を一段大きく (large の
// 文字の段)、入力欄は iOS が拡大しない 16px。選んだ密度とデスクトップは変えない。
describe("text size on a phone", () => {
  const phone = withTiers(SOFT_KEYS, PHONE);
  const fontSteps = (rules: CssRule[], selector: string) => {
    const box = declarationsOf(rules, [selector]);
    return ["--ui-font-sm", "--ui-font-md", "--ui-font-title"].map(
      (name) => box.get(name) ?? null,
    );
  };

  test("the default density takes the large text steps", () => {
    expect({
      regular: fontSteps(phone, 'body[data-sidebar-font-size="regular"]'),
      beforeScript: fontSteps(phone, "body:not([data-sidebar-font-size])"),
      large: fontSteps(
        baseRules(sheet),
        'body[data-sidebar-font-size="large"]',
      ),
    }).toEqual({
      regular: ["12px", "15px", "17px"],
      beforeScript: ["12px", "15px", "17px"],
      large: ["12px", "15px", "17px"],
    });
  });

  test("a chosen density is left alone", () => {
    const phoneOnly = sheet.filter((rule) => rule.atRule === PHONE);
    expect(
      fontSteps(phoneOnly, 'body[data-sidebar-font-size="compact"]'),
    ).toEqual([null, null, null]);
  });

  test.each([
    "textarea",
    "select",
  ])("%s is 16px so iOS does not zoom in", (selector) => {
    const vars = bodyVariables(phone);
    const value = declarationsOf(phone, [selector]).get("font-size") ?? "";
    expect({
      // 欄ごとの id の規則に負けないよう !important (style.css のコメント)。
      important: value.endsWith("!important"),
      phone: resolveVar(value.replace(/\s*!important$/, ""), vars),
      desktop:
        declarationsOf(baseRules(sheet), [selector]).get("font-size") ?? null,
    }).toEqual({
      important: true,
      phone: "16px",
      desktop: expect.not.stringMatching(/^16px$/),
    });
  });
});
