import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";
import { sourceFixture } from "./source-fixture";

const html = readFileSync("web/index.html", "utf8");
const appSource = sourceFixture(
  readFileSync("web-src/app.ts", "utf8") +
    readFileSync("web-src/views/sidebar.ts", "utf8") +
    readFileSync("web-src/views/diff-view.ts", "utf8"),
);
const style = readFileSync("web/style.css", "utf8");

describe("mark viewed toolbar button", () => {
  test("uses per-file viewed checkboxes instead of toolbar controls", () => {
    expect(html.includes('id="mark-viewed"')).toBe(false);
    expect(html.includes('id="collapse"')).toBe(false);
    expect(
      appSource.includes("$('#mark-viewed').addEventListener('click'"),
    ).toBe(false);
    expect(appSource.includes("$('#collapse').addEventListener('click'")).toBe(
      false,
    );
    expect(appSource.includes("gdp-viewed-checkbox")).toBe(false);
    expect(appSource.includes("gdp-viewed-label")).toBe(false);
    expect(appSource.includes("d2h-file-collapse-input")).toBe(true);
    expect(appSource.includes("gdp-file-toggle")).toBe(true);
    expect(appSource.includes("gdp-file-unfold")).toBe(true);
    expect(appSource.includes("octicon-copy")).toBe(true);
  });

  test("tracks per-file viewed paths without dimming diff bodies", () => {
    expect(appSource.includes("STATE.viewedFiles.add(path)")).toBe(true);
    expect(appSource.includes("STATE.viewedFiles.delete(path)")).toBe(true);
    expect(
      appSource.includes("setFileViewed(file.path, checkbox.checked)"),
    ).toBe(true);
    expect(
      appSource.includes(
        "li.classList.toggle('viewed', !onFileClick && STATE.viewedFiles.has(f.path))",
      ),
    ).toBe(true);
    expect(appSource.includes("li.classList.toggle('viewed'")).toBe(true);
    expect(appSource.includes("if (isRepositorySidebarMode()) return")).toBe(
      true,
    );
    expect(appSource.includes("STATE.viewedFiles.has(path)")).toBe(true);
    expect(
      appSource.includes(
        "function syncViewedCardDisplay(card: HTMLElement, viewed: boolean)",
      ),
    ).toBe(true);
    expect(
      appSource.includes(
        "function applyViewedToCard(card: HTMLElement, viewed: boolean, collapseLoaded = false)",
      ),
    ).toBe(true);
    expect(
      appSource.includes("setFileCollapsed(card as DiffCardElement, viewed)"),
    ).toBe(true);
    expect(appSource.includes("syncViewedCardDisplay(card, viewed)")).toBe(
      true,
    );
    expect(appSource.includes("applyViewedToCard(card, viewed, true)")).toBe(
      true,
    );
    expect(
      appSource.includes(
        "applyViewedToCard(card, STATE.viewedFiles.has(file.path), true)",
      ),
    ).toBe(true);
    // 閲覧済みの行の印 (行末のチェック)。変更ファイルの一覧とファイル一覧で同じ
    // 規則 (生の文字列ではなく、宣言のカスケードで見る。testing.md)。
    const rules = baseRules(loadStyleSheet());
    const viewedMark = cascadedDeclarations(
      rules,
      (selector) =>
        selector === ":is(#filelist, #file-list-rows) li.viewed::after",
    );
    expect(viewedMark.get("content")).toBe('"✓"');
    expect(style.includes("border-left-color: var(--success)")).toBe(true);
    expect(style.includes(".gdp-viewed-checkbox")).toBe(false);
    expect(style.includes(".gdp-file-shell.viewed {\n  opacity")).toBe(false);
  });
});
