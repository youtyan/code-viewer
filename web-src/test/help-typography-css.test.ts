// 設定とヘルプのページの文字の決まり (style.css の「設定とヘルプのページの文字と部品」)。
// 実物の style.css を happy-dom に流し込み、計算値で見る。
//
// 守ること:
// - 階層: ページの見出し > 節の見出し > 群の見出し > 手順の動作 > 本文。見出しは太く、
//   本文は一覧の文字 (body) より一段大きい。設定の節の見出しはヘルプの群の見出しと同じ段
// - 色: 本文は本来の文字色、要約・設定の説明だけ一段薄い色 (--color-text-2)
// - 行間は日本語で読みやすい 1.7〜1.8
// - 1 行の長さ: 本文は --doc-measure まで。日本語は em で 40 字前後、英語は ch で 70 字前後
// - 表示密度で文字が比例して変わる
// - 設定の「変更を保存」は本文の箱の下端に貼り付く
//
// happy-dom は var() を解決するが calc() は解かずに返し、em の max-width は NaNpx に
// なる。大きさは下の px() で読み、幅は宣言を _css-fixture のカスケードで読む。
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

beforeAll(() => {
  GlobalRegistrator.register();
  const style = document.createElement("style");
  style.textContent = readFileSync("web/style.css", "utf8");
  document.head.append(style);
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

/** 計算値の長さを px の数にする。`14px` と、密度の段階の `calc(4px * 3.75)` だけ。 */
function px(value: string): number {
  const plain = /^(-?[\d.]+)px$/.exec(value);
  if (plain) return Number(plain[1]);
  const scaled = /^calc\(([\d.]+)px \* ([\d.]+)\)$/.exec(value);
  if (scaled) return Number(scaled[1]) * Number(scaled[2]);
  throw new Error(`not a length this test reads: ${JSON.stringify(value)}`);
}

// page-shell.ts・help-page.ts・help-blocks.ts・viewer-settings.ts が組む形。
function renderPages(lang: "en" | "ja"): void {
  document.body.className = "gdp-help-page";
  document.body.innerHTML = `
    <section class="gdp-help-shell" data-page="help" lang="${lang}">
      <header class="gdp-help-header"><h1 id="page-title">Help</h1></header>
      <div class="gdp-help-layout">
        <article class="gdp-help-content">
          <h2 id="section-title">Getting started</h2>
          <p id="summary">What this section is for.</p>
          <section class="gdp-help-group">
            <h3 id="group-title">Start it</h3>
            <p id="body">Body text.</p>
            <ol class="gdp-help-steps"><li>
              <p class="gdp-help-step-title" id="step-title">Start it</p>
              <p class="gdp-help-step-text" id="step-text">It opens.</p>
            </li></ol>
          </section>
        </article>
      </div>
    </section>
    <section class="gdp-help-shell" data-page="settings" lang="${lang}">
      <div class="gdp-help-layout">
        <article class="gdp-help-content">
          <div class="scope-settings">
            <div class="scope-settings-section">
              <strong class="scope-settings-section-title" id="settings-title">Notifications</strong>
              <p class="scope-settings-help" id="settings-help">What it is for.</p>
              <label id="settings-label">Theme</label>
            </div>
            <div class="scope-settings-footer" id="settings-footer"></div>
          </div>
        </article>
      </div>
    </section>`;
}

// ai-dup-check: allow -- ok:history-resizer-visibility.test.ts の computed は 2 つのプロパティだけを返す別の形。3 行の取り出しを共有の置き場に出すほどではない
function style(id: string): CSSStyleDeclaration {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return getComputedStyle(element);
}

describe("the help and settings pages", () => {
  test("headings step down in size from the page title to the body, and are bold", () => {
    renderPages("ja");
    const ids = [
      "page-title",
      "section-title",
      "group-title",
      "step-title",
      "body",
    ];
    const sizes = ids.map((id) => px(style(id).fontSize));
    expect({
      stepsDown: sizes.every(
        (size, i) => i === 0 || size < (sizes[i - 1] ?? 0),
      ),
      weights: ids.map((id) => style(id).fontWeight),
    }).toEqual({
      stepsDown: true,
      weights: ["700", "700", "700", "600", "normal"],
    });
  });

  test("the body is one step larger than the list text of the app", () => {
    renderPages("ja");
    expect(px(style("body").fontSize)).toBeGreaterThan(
      px(getComputedStyle(document.body).fontSize),
    );
  });

  test("a settings section title is on the same step as a help group title", () => {
    renderPages("ja");
    expect([
      style("settings-title").fontSize,
      style("settings-title").fontWeight,
    ]).toEqual([
      style("group-title").fontSize,
      style("group-title").fontWeight,
    ]);
  });

  test("settings: section title > label > description", () => {
    renderPages("ja");
    const sizes = ["settings-title", "settings-label", "settings-help"].map(
      (id) => px(style(id).fontSize),
    );
    expect(sizes[0] > sizes[1] && sizes[1] > sizes[2]).toBe(true);
  });

  test.each([
    "light",
    "dark",
  ] as const)("in %s the body is the text colour and only summaries are one step lighter", (theme) => {
    document.documentElement.dataset.theme = theme;
    renderPages("ja");
    const root = getComputedStyle(document.documentElement);
    const text = root.getPropertyValue("--color-text").trim();
    const text2 = root.getPropertyValue("--color-text-2").trim();
    expect({
      body: style("body").color,
      stepText: style("step-text").color,
      label: style("settings-label").color,
      summary: style("summary").color,
      settingsHelp: style("settings-help").color,
      different: text !== text2,
    }).toEqual({
      body: text,
      stepText: text,
      label: text,
      summary: text2,
      settingsHelp: text2,
      different: true,
    });
  });

  test.each([
    "body",
    "summary",
    "step-text",
  ])("%s has a line height between 1.7 and 1.8", (id) => {
    renderPages("ja");
    const lineHeight = Number(style(id).lineHeight);
    expect(lineHeight >= 1.7 && lineHeight <= 1.8).toBe(true);
  });

  test.each([
    { name: "compact is smaller", density: "compact", compare: -1 },
    { name: "large is larger", density: "large", compare: 1 },
  ])("the body scales with the density: $name", ({ density, compare }) => {
    renderPages("ja");
    const regular = px(style("body").fontSize);
    document.body.dataset.sidebarFontSize = density;
    const scaled = px(style("body").fontSize);
    delete document.body.dataset.sidebarFontSize;
    expect(Math.sign(scaled - regular)).toBe(compare);
  });

  test.each([
    { lang: "ja", unit: "em", min: 36, max: 44 },
    { lang: "en", unit: "ch", min: 60, max: 78 },
  ] as const)("a line is about $min-$max $unit long in $lang", ({
    lang,
    unit,
    min,
    max,
  }) => {
    renderPages(lang);
    const shell = document.querySelector(".gdp-help-shell");
    if (!shell) throw new Error("missing shell");
    const measure = getComputedStyle(shell)
      .getPropertyValue("--doc-measure")
      .trim();
    const match = /^([\d.]+)(em|ch)$/.exec(measure);
    expect({
      unit: match?.[2],
      inRange: Number(match?.[1]) >= min && Number(match?.[1]) <= max,
    }).toEqual({ unit, inRange: true });
  });

  // 幅の宣言そのもの (happy-dom は em の max-width を解けない)。
  const rules = baseRules(loadStyleSheet());
  test.each([
    ".gdp-help-content > p",
    ".gdp-help-group p",
    ".gdp-help-list",
    ".gdp-help-steps",
    ".gdp-help-note",
    ".gdp-help-command",
    ".gdp-help-table",
    ".gdp-help-details",
    ".scope-settings-help",
  ])("%s stops at the reading measure", (selector) => {
    const width = cascadedDeclarations(
      rules,
      (candidate) => candidate === selector,
    ).get("max-width");
    expect(width).toBe("var(--doc-measure)");
  });

  test("the settings save bar sticks to the bottom of the content box", () => {
    renderPages("ja");
    const footer = style("settings-footer");
    expect([footer.position, footer.bottom, footer.marginTop]).toEqual([
      "sticky",
      "0px",
      "auto",
    ]);
  });
});
