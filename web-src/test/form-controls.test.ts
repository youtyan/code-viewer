// 部品の節 (style.css の「ボタンの種類」の後ろ): チェックボックス・ラジオ・スライダー、
// 入力欄と選ぶ欄、右クリックのメニュー、カード、リンク。どの部品も、実際に置かれる
// 場所 (親の規則が効く所) で節の決めた見た目になる。部品の規則が地・縁・色を書き足すと、
// 節の決まりに勝ってここで落ちる。
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { themeVariants } from "./_color-themes";
import { baseRules, loadStyleSheet, resolveVar } from "./_css-fixture";
import { withoutHover } from "./_css-without-hover";

const dark = themeVariants(baseRules(loadStyleSheet())).find(
  (variant) => variant.name === "default dark",
);
if (!dark) throw new Error("form controls test: no default dark theme");
const token = (name: string) => resolveVar(`var(${name})`, dark.vars);

// 無効と誤りの縁の名前は color-mix() で、happy-dom は計算できない (宣言ごと落とす)。
// その名前だけを計算できる色に差し替えて、部品がその名前を読んでいることを見る。
const STAND_IN = {
  "--color-disabled": "#010203",
  "--color-disabled-surface": "#040506",
  "--color-error-line": "#070809",
} as const;
const expected = (name: string) =>
  name in STAND_IN ? STAND_IN[name as keyof typeof STAND_IN] : token(name);

beforeAll(() => {
  GlobalRegistrator.register();
  const style = document.createElement("style");
  style.textContent = withoutHover(readFileSync("web/style.css", "utf8"));
  const standIn = document.createElement("style");
  standIn.textContent = `:root { ${Object.entries(STAND_IN)
    .map(([name, value]) => `${name}: ${value} !important;`)
    .join(" ")} }`;
  document.head.append(style, standIn);
  document.documentElement.dataset.theme = "dark";
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

// happy-dom は text-decoration の一括指定を text-decoration-line に分けないので、
// 一括指定の値の最初の語 (線の種類) を読む。
const underline = (style: CSSStyleDeclaration) =>
  (style.getPropertyValue("text-decoration") || "").split(" ")[0];

function styleOf(html: string): CSSStyleDeclaration {
  document.body.innerHTML = html;
  const element = document.getElementById("x");
  if (!element) throw new Error("form controls test: missing #x");
  return getComputedStyle(element);
}

describe("checkboxes, radios and sliders take the accent color in every place", () => {
  test.each([
    {
      name: "a settings toggle",
      html: `<div class="scope-settings"><label class="scope-settings-toggle"><input type="checkbox" id="x"><span></span></label></div>`,
    },
    {
      name: "the diff Viewed box",
      html: `<div class="d2h-file-header"><label class="d2h-file-collapse"><input type="checkbox" class="d2h-file-collapse-input" id="x"> Viewed</label></div>`,
    },
    {
      name: "the agents board all panes",
      html: `<label class="agents-all-panes"><input type="checkbox" id="x"> All</label>`,
    },
    {
      name: "a shortcut place",
      html: `<div class="scope-settings"><label class="shortcut-where"><input type="checkbox" id="x"> Input</label></div>`,
    },
    {
      name: "a connection form box",
      html: `<form class="db-connection-form"><input type="checkbox" id="x"></form>`,
    },
    {
      name: "a markdown task",
      html: `<div class="gdp-markdown-preview"><ul><li class="task-list-item"><input type="checkbox" id="x"></li></ul></div>`,
    },
    {
      name: "a radio",
      html: `<label><input type="radio" id="x"> One</label>`,
    },
    {
      name: "the watch limit slider",
      html: `<div class="scope-watch-limit-row"><input type="range" id="x"></div>`,
    },
    {
      name: "the media seek bar",
      html: `<div><input type="range" class="gdp-media-seek" id="x"></div>`,
    },
  ])("$name", ({ html }) => {
    expect(styleOf(html).accentColor).toBe(token("--color-accent"));
  });

  test("a disabled checkbox takes the disabled color, not a dimmed one", () => {
    const style = styleOf(
      `<label class="agents-all-panes"><input type="checkbox" disabled id="x"> All</label>`,
    );
    expect([style.accentColor, style.opacity || "1"]).toEqual([
      expected("--color-disabled"),
      "1",
    ]);
  });

  test("a settings toggle is a checkbox, not a switch", () => {
    // スイッチの形は appearance: none で描いていた。チェックボックスの節は標準の形。
    const style = styleOf(
      `<div class="scope-settings"><label class="scope-settings-toggle"><input type="checkbox" id="x"><span></span></label></div>`,
    );
    expect(style.appearance === "none").toBe(false);
  });
});

const FIELDS: { name: string; html: string }[] = [
  {
    name: "a dialog field",
    html: `<div class="gdp-dialog"><input class="gdp-dialog-input" id="x"></div>`,
  },
  {
    name: "a settings select",
    html: `<div class="scope-settings"><select id="x"><option>a</option></select></div>`,
  },
  {
    name: "a settings list",
    html: `<div class="scope-settings"><textarea id="scope-omit-dirs"></textarea><textarea id="x"></textarea></div>`,
  },
  {
    name: "the settings search",
    html: `<input class="scope-settings-search" type="search" id="x">`,
  },
  {
    name: "the file filter",
    html: `<div id="file-list"><div class="sb-head"><input id="file-list-filter" type="search"><input class="sb-filter" type="search" id="x"></div></div>`,
  },
  {
    name: "the history filter",
    html: `<div id="history-panel"><input class="history-filter" id="x"></div>`,
  },
  {
    name: "the search results field",
    html: `<input class="search-results-input" id="x">`,
  },
  {
    name: "a work log task field",
    html: `<div class="journal-task-fields"><select id="x"><option>a</option></select></div>`,
  },
  {
    name: "a work log title",
    html: `<input class="journal-title-input" id="x">`,
  },
  {
    name: "the work log date",
    html: `<div class="journal-section-head"><input type="date" id="x"></div>`,
  },
  {
    name: "a data file select",
    html: `<div class="db-root"><select class="db-file-select" id="x"><option>a</option></select></div>`,
  },
  {
    name: "a data table filter",
    html: `<div class="db-root"><input class="db-table-filter" id="x"></div>`,
  },
  {
    name: "a snapshot compare select",
    html: `<div class="db-root"><div class="db-snapshot-diff-row"><select class="db-snapshot-diff-select" id="x"><option>a</option></select></div></div>`,
  },
  {
    name: "an annotation edit field",
    html: `<div class="annotation-edit-fields"><textarea id="x"></textarea></div>`,
  },
  {
    name: "the source line jump",
    html: `<div class="gdp-file-detail-sticky"><form class="gdp-source-line-jump"><input id="x"></form></div>`,
  },
];

describe("fields and selects take the shared look in every place", () => {
  test.each(FIELDS)("$name", ({ html }) => {
    const style = styleOf(html);
    expect({
      face: style.backgroundColor,
      edge: style.borderTopColor,
      text: style.color,
    }).toEqual({
      face: token("--color-inset"),
      edge: token("--color-line"),
      text: token("--color-text"),
    });
  });

  test("a field marked invalid takes the error edge", () => {
    const style = styleOf(
      `<div class="gdp-dialog"><input class="gdp-dialog-input" aria-invalid="true" id="x"></div>`,
    );
    expect(style.borderTopColor).toBe(expected("--color-error-line"));
  });

  test("a disabled field takes the disabled colors, not a dimmed one", () => {
    const style = styleOf(
      `<div class="scope-settings"><select disabled id="x"><option>a</option></select></div>`,
    );
    expect({
      face: style.backgroundColor,
      text: style.color,
      opacity: style.opacity || "1",
    }).toEqual({
      face: expected("--color-disabled-surface"),
      text: expected("--color-disabled"),
      opacity: "1",
    });
  });

  test("a select draws its own arrow", () => {
    const style = styleOf(
      `<div class="db-root"><select class="db-file-select" id="x"><option>a</option></select></div>`,
    );
    expect(style.appearance).toBe("none");
  });
});

describe("menus share one look", () => {
  test.each([
    {
      name: "a context menu",
      html: `<div class="gdp-context-menu" role="menu" id="x"></div>`,
    },
    {
      name: "the data export menu",
      html: `<div class="db-root"><div class="db-grid-export-menu" id="x"></div></div>`,
    },
  ])("$name is a floating surface", ({ html }) => {
    const style = styleOf(html);
    expect([style.backgroundColor, style.borderTopColor]).toEqual([
      token("--color-overlay"),
      token("--color-line-strong"),
    ]);
  });

  test.each([
    {
      name: "a context menu item",
      html: `<div class="gdp-context-menu"><button role="menuitem" id="x"></button></div>`,
      text: "--color-text",
    },
    {
      name: "a data export item",
      html: `<div class="db-root"><div class="db-grid-export-menu"><button class="db-grid-export-item" id="x"></button></div></div>`,
      text: "--color-text",
    },
    {
      name: "a dangerous item",
      html: `<div class="gdp-context-menu"><button role="menuitem" class="danger" id="x"></button></div>`,
      text: "--color-failed",
    },
    {
      name: "a disabled item",
      html: `<div class="gdp-context-menu"><button role="menuitem" class="danger" disabled id="x"></button></div>`,
      text: "--color-disabled",
    },
  ])("$name", ({ html, text }) => {
    expect(styleOf(html).color).toBe(expected(text));
  });

  test("a separator is the row line", () => {
    const style = styleOf(
      `<div class="gdp-context-menu"><hr class="gdp-context-menu-sep" id="x"></div>`,
    );
    expect(style.borderTopColor).toBe(token("--color-line-row"));
  });
});

describe("cards share one face and edge", () => {
  test.each([
    {
      name: "a diff file",
      html: `<div class="d2h-wrapper"><div class="d2h-file-wrapper" id="x"></div></div>`,
    },
    {
      name: "an account",
      html: `<div class="agents-accounts-cards"><div class="agents-account-card" id="x"></div></div>`,
    },
    {
      name: "a work log column",
      html: `<div class="journal-task-board"><section class="journal-task-column" id="x"></section></div>`,
    },
  ])("$name", ({ html }) => {
    const style = styleOf(html);
    expect([style.backgroundColor, style.borderTopColor]).toEqual([
      token("--color-doc"),
      token("--color-line-row"),
    ]);
  });
});

describe("links", () => {
  test("a link in a sentence is the accent color and underlined", () => {
    const style = styleOf(
      `<div class="gdp-markdown-preview"><p><a href="#a" id="x">a</a></p></div>`,
    );
    expect([style.color, underline(style)]).toEqual([
      token("--color-accent"),
      "underline",
    ]);
  });

  test("a link among many (the table of contents) is not underlined at rest", () => {
    const style = styleOf(
      `<nav class="quick-help-foot"><a href="#a" id="x">a</a></nav>`,
    );
    expect(underline(style)).toBe("none");
  });

  test("a button made of a link is not underlined", () => {
    const style = styleOf(`<a class="gdp-btn" href="#a" id="x">a</a>`);
    expect(underline(style)).toBe("none");
  });
});
