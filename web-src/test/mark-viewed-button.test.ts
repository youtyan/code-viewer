import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sourceFixture } from "./source-fixture";

const html = readFileSync("web/index.html", "utf8");
const appSource = sourceFixture(readFileSync("web-src/app.ts", "utf8"));
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

	test("persists per-file viewed paths without dimming diff bodies", () => {
		expect(appSource.includes("localStorage.setItem('gdp:viewed-files'")).toBe(
			true,
		);
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
		expect(
			appSource.includes(
				"!isRepositorySidebarMode() && STATE.viewedFiles.has(path)",
			),
		).toBe(true);
		expect(appSource.includes("if (isRepositorySidebarMode()) return")).toBe(
			true,
		);
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
		expect(style.includes("#filelist li.viewed")).toBe(true);
		expect(style.includes("#filelist li.viewed::after")).toBe(true);
		expect(style.includes('content: "✓"')).toBe(true);
		expect(style.includes("border-left-color: var(--success)")).toBe(true);
		expect(style.includes(".gdp-viewed-checkbox")).toBe(false);
		expect(style.includes(".gdp-file-shell.viewed {\n  opacity")).toBe(false);
	});
});
