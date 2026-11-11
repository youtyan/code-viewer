// ボタンの種類 (style.css の「ボタンの種類」の節): 主・薄塗り・枠線・小・文字だけ・アイコン。
// どのボタンも、実際に置かれる場所 (親の「.x button」の規則が効く所) で、その種類の
// 色になる。部品の規則が地・文字・枠の色を書き足すと、種類の決まりに勝ってここで落ちる。
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test } from "vitest";
import { themeVariants } from "./_color-themes";
import { baseRules, loadStyleSheet, resolveVar } from "./_css-fixture";
import { withoutHover } from "./_css-without-hover";

const dark = themeVariants(baseRules(loadStyleSheet())).find(
  (variant) => variant.name === "default dark",
);
if (!dark) throw new Error("button variants test: no default dark theme");
const token = (name: string) => resolveVar(`var(${name})`, dark.vars);

// 薄塗りの面と文字は color-mix() で、happy-dom は計算できない (宣言ごと落とす)。
// その 2 つの名前だけを計算できる色に差し替えて、薄塗りの名前を読んでいることを見る。
const TONAL_STAND_IN = {
  "--color-info-surface": "#010203",
  "--color-on-info-surface": "#040506",
} as const;

beforeAll(() => {
  GlobalRegistrator.register();
  const style = document.createElement("style");
  style.textContent = withoutHover(readFileSync("web/style.css", "utf8"));
  const standIn = document.createElement("style");
  standIn.textContent = `:root { ${Object.entries(TONAL_STAND_IN)
    .map(([name, value]) => `${name}: ${value} !important;`)
    .join(" ")} }`;
  document.head.append(style, standIn);
  document.documentElement.dataset.theme = "dark";
});

const expected = (name: string) =>
  name in TONAL_STAND_IN
    ? TONAL_STAND_IN[name as keyof typeof TONAL_STAND_IN]
    : token(name);

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const KIND_TEXT = {
  primary: "--color-on-accent",
  tonal: "--color-on-info-surface",
  outlined: "--color-accent",
  micro: "--color-accent",
  text: "--color-accent",
  icon: "--color-text-2",
  danger: "--color-failed",
} as const;

// 面を持つ種類はその面の色、縁を持つ種類はその縁の色も見る。
const KIND_FACE: Partial<Record<keyof typeof KIND_TEXT, string>> = {
  primary: "--color-accent",
  tonal: "--color-info-surface",
};
const KIND_EDGE: Partial<Record<keyof typeof KIND_TEXT, string>> = {
  outlined: "--color-line-strong",
  micro: "--color-line-strong",
};

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
  {
    name: "the sidebar empty state action",
    kind: "primary",
    html: `<div id="app-nav"><a class="nav-note-link nav-empty-action" id="x"></a></div>`,
  },
  {
    name: "the search index run",
    kind: "primary",
    html: `<div class="db-root"><button class="es-search-btn" id="x"></button></div>`,
  },
  {
    name: "the snapshot confirm",
    kind: "primary",
    html: `<div class="db-root"><div class="db-snapshot-action-row"><button class="db-snapshot-confirm-btn" id="x"></button></div></div>`,
  },
  {
    name: "the worktrees add",
    kind: "primary",
    html: `<div id="worktree-panel"><div class="history-head"><button class="gdp-btn gdp-btn-sm worktree-head-btn worktree-head-add" id="x"></button></div></div>`,
  },
  {
    name: "the diff expand lines",
    kind: "tonal",
    html: `<table class="d2h-diff-table"><tr><td><button class="gdp-expand-btn" id="x"></button></td></tr></table>`,
  },
  {
    name: "the annotation step",
    kind: "tonal",
    html: `<div class="gdp-annotation-inline"><button class="gdp-annotation-step" id="x"></button></div>`,
  },
  {
    name: "a pressed page button",
    kind: "tonal",
    html: `<div id="history-commit-info"><button class="gdp-btn gdp-btn-sm hci-parent" aria-pressed="true" id="x"></button></div>`,
  },
  {
    name: "a pressed file header toggle",
    kind: "tonal",
    html: `<div class="d2h-file-header"><button class="gdp-file-header-icon gdp-file-unfold" aria-pressed="true" id="x"></button></div>`,
  },
  {
    name: "the work log issue panel action",
    kind: "outlined",
    html: `<div class="journal-github-panel"><button class="journal-github-issue-action" id="x"></button></div>`,
  },
  {
    name: "the image tab close",
    kind: "outlined",
    html: `<div class="image-tab"><div class="image-tab-secondary"><button class="image-tab-button image-tab-close" id="x"></button></div></div>`,
  },
  {
    name: "the settings reset",
    kind: "outlined",
    html: `<div class="scope-settings-actions"><button class="gdp-btn" id="x"></button></div>`,
  },
  {
    name: "the data global search",
    kind: "outlined",
    html: `<div class="db-root"><button class="db-global-search-btn" id="x"></button></div>`,
  },
  {
    name: "the work log delete",
    kind: "danger",
    html: `<div class="journal-editor-actions"><button class="journal-danger-action" id="x"></button></div>`,
  },
  {
    name: "the file delete",
    kind: "danger",
    html: `<div class="gdp-repo-blob-layout"><div class="gdp-file-detail-sticky"><div class="gdp-file-detail-header"><button class="gdp-file-header-icon gdp-trash-path" id="x"></button></div></div></div>`,
  },
  {
    name: "a settings row action",
    kind: "micro",
    html: `<div class="agent-hooks-section"><button class="gdp-btn gdp-btn-sm agent-hooks-action" id="x"></button></div>`,
  },
  {
    name: "a work log section head action",
    kind: "micro",
    html: `<div class="journal-section-head"><button class="gdp-btn gdp-btn-sm" id="x"></button></div>`,
  },
  {
    name: "a snapshot row action",
    kind: "micro",
    html: `<div class="db-root"><div class="db-snapshot-actions"><button class="db-btn db-btn-sm" id="x"></button></div></div>`,
  },
  {
    name: "a source find bar action",
    kind: "micro",
    html: `<div class="gdp-source-virtual-search"><button class="gdp-btn gdp-btn-sm" id="x"></button></div>`,
  },
  {
    name: "a query history row action",
    kind: "micro",
    html: `<div class="db-root"><button class="db-query-history-action" id="x"></button></div>`,
  },
  {
    name: "a data list load more",
    kind: "text",
    html: `<div class="db-root"><button class="es-doc-more-btn" id="x"></button></div>`,
  },
  {
    name: "the project switcher action",
    kind: "text",
    html: `<div class="project-switcher"><button class="project-switcher-action" id="x"></button></div>`,
  },
  {
    name: "the diff next unviewed",
    kind: "text",
    html: `<div id="topbar"><div id="meta"><button class="chip chip-next-unviewed" id="x"></button></div></div>`,
  },
  {
    name: "a data connection icon",
    kind: "icon",
    html: `<div class="db-root"><button class="db-refresh-btn" id="x"></button></div>`,
  },
  {
    name: "a data icon-only button",
    kind: "icon",
    html: `<div class="db-root"><button class="db-btn db-btn-icon db-grid-refresh" id="x"></button></div>`,
  },
  {
    name: "a diff file header icon",
    kind: "icon",
    html: `<div class="d2h-file-header"><button class="gdp-file-header-icon" id="x"></button></div>`,
  },
  {
    name: "the diff view file",
    kind: "icon",
    html: `<div class="d2h-file-header"><button class="gdp-view-file gdp-btn gdp-btn-sm" id="x"></button></div>`,
  },
  {
    name: "a file detail header icon",
    kind: "icon",
    html: `<div class="gdp-repo-blob-layout"><div class="gdp-file-detail-sticky"><button class="gdp-file-header-icon" id="x"></button></div></div>`,
  },
  {
    name: "an image tab toolbar button",
    kind: "icon",
    html: `<div class="image-tab"><div class="image-tab-primary"><button class="image-tab-button" id="x"></button></div></div>`,
  },
  {
    name: "a work log markdown toolbar button",
    kind: "icon",
    html: `<div class="journal-markdown-toolbar"><button class="journal-toolbar-action" id="x"></button></div>`,
  },
  {
    name: "a dialog close",
    kind: "icon",
    html: `<div class="gdp-dialog"><button class="gdp-dialog-close" id="x"></button></div>`,
  },
];

test.each(PLACES)("$name is a $kind button", ({ kind, html }) => {
  document.body.innerHTML = html;
  const element = document.getElementById("x");
  if (!element) throw new Error("button variants test: missing #x");
  const style = getComputedStyle(element);
  const face = KIND_FACE[kind];
  const edge = KIND_EDGE[kind];
  expect({
    text: style.color,
    face: face ? style.backgroundColor : "-",
    edge: edge ? style.borderTopColor : "-",
  }).toEqual({
    text: expected(KIND_TEXT[kind]),
    face: face ? expected(face) : "-",
    edge: edge ? expected(edge) : "-",
  });
});
