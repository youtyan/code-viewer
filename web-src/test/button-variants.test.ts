// ボタンの種類 (style.css の「ボタンの種類」の節): 主・枠線・文字だけ・アイコン。
// どのボタンも、実際に置かれる場所 (親の「.x button」の規則が効く所) で、その種類の
// 色になる。部品の規則が地・文字・枠の色を書き足すと、種類の決まりに勝ってここで落ちる。
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test } from "vitest";
import { themeVariants } from "./_color-themes";
import { baseRules, loadStyleSheet, resolveVar } from "./_css-fixture";

const dark = themeVariants(baseRules(loadStyleSheet())).find(
  (variant) => variant.name === "default dark",
);
if (!dark) throw new Error("button variants test: no default dark theme");
const token = (name: string) => resolveVar(`var(${name})`, dark.vars);

// happy-dom は :hover を常に当たるものとして扱うので、hover の選択子を外した CSS で
// 休んでいるときの色を見る (選択子の並びのうち :hover を含むものだけを外す)。
function withoutHover(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/([^{}]+)\{/g, (whole, head: string) => {
      if (head.trim().startsWith("@")) return whole;
      const kept = head
        .split(/,(?![^(]*\))/)
        .filter((part) => !part.includes(":hover"));
      return `${kept.length > 0 ? kept.join(",") : ":not(*)"}{`;
    });
}

beforeAll(() => {
  GlobalRegistrator.register();
  const style = document.createElement("style");
  style.textContent = withoutHover(readFileSync("web/style.css", "utf8"));
  document.head.append(style);
  document.documentElement.dataset.theme = "dark";
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const KIND_TEXT = {
  primary: "--color-on-accent",
  outlined: "--color-accent",
  text: "--color-accent",
  icon: "--color-text-2",
} as const;

const PLACES: {
  name: string;
  kind: keyof typeof KIND_TEXT;
  html: string;
}[] = [
  {
    name: "the agents board start",
    kind: "primary",
    html: `<button class="agents-primary" id="x"></button>`,
  },
  {
    name: "the dialog confirm",
    kind: "primary",
    html: `<div class="gdp-dialog"><button class="gdp-dialog-button gdp-dialog-confirm" id="x"></button></div>`,
  },
  {
    name: "the work log save",
    kind: "primary",
    html: `<div class="journal-editor-actions"><button class="journal-primary-action" id="x"></button></div>`,
  },
  {
    name: "the data run",
    kind: "primary",
    html: `<div class="db-root"><button class="db-btn db-btn-primary" id="x"></button></div>`,
  },
  {
    name: "the empty state main action",
    kind: "primary",
    html: `<button class="empty-action empty-action-primary" id="x"></button>`,
  },
  {
    name: "the annotation panel action",
    kind: "primary",
    html: `<div id="annotation-panel"><button class="annotation-primary" id="x"></button></div>`,
  },
  {
    name: "the dialog cancel",
    kind: "outlined",
    html: `<div class="gdp-dialog"><button class="gdp-dialog-button gdp-dialog-cancel" id="x"></button></div>`,
  },
  {
    name: "the agents board secondary",
    kind: "outlined",
    html: `<button class="agents-secondary" id="x"></button>`,
  },
  {
    name: "the data button",
    kind: "outlined",
    html: `<div class="db-root"><button class="db-btn" id="x"></button></div>`,
  },
  {
    name: "the empty state action",
    kind: "outlined",
    html: `<button class="empty-action" id="x"></button>`,
  },
  {
    name: "the page button",
    kind: "outlined",
    html: `<button class="gdp-btn" id="x"></button>`,
  },
  {
    name: "the agents board text action",
    kind: "text",
    html: `<button class="agents-text-action" id="x"></button>`,
  },
  {
    name: "a status bar action",
    kind: "icon",
    html: `<div id="statusbar"><div class="statusbar-actions"><button class="global-icon-action" id="x"></button></div></div>`,
  },
  {
    name: "a sidebar head action",
    kind: "icon",
    html: `<div id="app-nav"><div class="nav-section-head"><button class="nav-icon-action" id="x"></button></div></div>`,
  },
  {
    name: "the tab strip action",
    kind: "icon",
    html: `<div id="main-tabs"><button class="main-tabs-action" id="x"></button></div>`,
  },
  {
    name: "a file list head action",
    kind: "icon",
    html: `<div id="file-list"><div class="sb-head"><button class="sb-icon-action" id="x"></button></div></div>`,
  },
  {
    name: "a data icon button",
    kind: "icon",
    html: `<div class="db-root"><button class="db-icon-btn" id="x"></button></div>`,
  },
];

test.each(PLACES)("$name is a $kind button", ({ kind, html }) => {
  document.body.innerHTML = html;
  const element = document.getElementById("x");
  if (!element) throw new Error("button variants test: missing #x");
  const style = getComputedStyle(element);
  expect({
    text: style.color,
    face: kind === "primary" ? style.backgroundColor : "-",
    edge: kind === "outlined" ? style.borderTopColor : "-",
  }).toEqual({
    text: token(KIND_TEXT[kind]),
    face: kind === "primary" ? token("--color-accent") : "-",
    edge: kind === "outlined" ? token("--color-line-strong") : "-",
  });
});
