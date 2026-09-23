// プロジェクトの色の配り方・頭文字の決まり (core/project-colors.ts) と、
// 色の組が明るい配色と暗い配色の両方で読めること (web/style.css の値)。

import { describe, expect, test } from "vitest";
import {
  nextProjectColor,
  PROJECT_COLORS,
  type ProjectColor,
  projectInitials,
  withProjectColors,
} from "../core/project-colors";
import { contrastRatio } from "./_color-contrast";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

describe("nextProjectColor", () => {
  const all = [...PROJECT_COLORS];
  test.each<[string, (ProjectColor | undefined)[], ProjectColor]>([
    ["the first project gets the first color", [], "violet"],
    ["the next unused color, in the palette's order", ["violet"], "green"],
    [
      "a gap left by a removed project is filled first",
      ["violet", "orange"],
      "green",
    ],
    ["colors chosen by hand count as used", ["green", "blue"], "violet"],
    ["projects without a color do not count", [undefined, "violet"], "green"],
    ["when every color is used, the first one again", all, "violet"],
    ["then the least used one", [...all, "violet"], "green"],
    [
      "the least used one, whatever its place",
      [...all, ...all.slice(0, 4)],
      "amber",
    ],
  ])("%s", (_name, used, expected) => {
    expect(nextProjectColor(used)).toBe(expected);
  });

  test("hands out every color once before repeating", () => {
    const used: ProjectColor[] = [];
    for (let i = 0; i < PROJECT_COLORS.length * 2; i += 1) {
      used.push(nextProjectColor(used));
    }
    expect(used).toEqual([...PROJECT_COLORS, ...PROJECT_COLORS]);
  });
});

describe("withProjectColors (a registry written before colors existed)", () => {
  test.each<[string, (ProjectColor | undefined)[], ProjectColor[]]>([
    [
      "colors in the registry's order",
      [undefined, undefined, undefined],
      ["violet", "green", "orange"],
    ],
    [
      "keeps colors already chosen and skips them",
      [undefined, "violet", undefined],
      ["green", "violet", "orange"],
    ],
    [
      "a later project's color is taken as used",
      [undefined, "green"],
      ["violet", "green"],
    ],
  ])("%s", (_name, colors, expected) => {
    const items = colors.map((color, index) => ({ id: index, color }));
    expect(withProjectColors(items).map((item) => item.color)).toEqual(
      expected,
    );
  });

  test("returns the same list when every project has a color (nothing to save)", () => {
    const items = [{ color: "blue" as const }, { color: "red" as const }];
    expect(withProjectColors(items)).toBe(items);
  });
});

describe("projectInitials", () => {
  test.each([
    ["code-viewer", "CV"],
    ["sample-v2", "SV"],
    ["sample-app", "SA"],
    ["sample_app.server", "SA"],
    ["codeViewer", "CV"],
    ["HTTPServer", "HS"],
    ["  spaced   name ", "SN"],
    ["notebook", "NO"],
    ["x", "X"],
    ["2026-report", "2R"],
    ["サンプル", "サン"],
    ["サンプル アプリ", "サア"],
    ["---", "--"],
  ])("%s → %s", (name, expected) => {
    expect(projectInitials(name)).toBe(expected);
  });
});

describe("the palette in web/style.css", () => {
  const rules = baseRules(loadStyleSheet());
  const block = (selector: string) =>
    cascadedDeclarations(rules, (s) => s === selector);
  const light = block(":root");
  const themes = {
    light,
    dark: new Map([...light, ...block('[data-theme="dark"]')]),
  };
  const swatches = [...PROJECT_COLORS, "none"] as const;
  const read = (vars: Map<string, string>, name: string) => {
    const value = resolveVar(`var(${name})`, vars);
    if (!/^#[0-9a-f]{6}$/i.test(value))
      throw new Error(`project colors: ${name} is ${JSON.stringify(value)}`);
    return value;
  };

  test.each(
    Object.entries(themes),
  )("%s: the initials read on every square (4.5:1 or more)", (_theme, vars) => {
    const ink = read(vars, "--project-ink");
    const low = swatches
      .map((id) => ({
        id,
        ratio: contrastRatio(read(vars, `--project-${id}`), ink),
      }))
      .filter((item) => item.ratio < 4.5);
    expect(low).toEqual([]);
  });

  test.each(
    Object.entries(themes),
  )("%s: every color differs from the others", (_theme, vars) => {
    const values = swatches.map((id) => read(vars, `--project-${id}`));
    expect(new Set(values).size).toBe(values.length);
  });

  test.each(
    swatches,
  )("an element painted %s reads that color as --project-color", (id) => {
    for (const vars of Object.values(themes)) {
      const painted = new Map([
        ...vars,
        ...block(`[data-project-color="${id}"]`),
      ]);
      expect(resolveVar("var(--project-color)", painted)).toBe(
        read(vars, `--project-${id}`),
      );
    }
  });
});
