import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

type CssRule = {
  selector: string;
  declarations: Map<string, string>;
  order: number;
  specificity: [number, number, number];
};

const css = readFileSync("web/style.css", "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseDeclarations(block: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const raw of block.split(";")) {
    const index = raw.indexOf(":");
    if (index < 0) continue;
    const prop = raw.slice(0, index).trim();
    const value = raw.slice(index + 1).trim();
    if (prop && value) declarations.set(prop, value);
  }
  return declarations;
}

function specificity(selector: string): [number, number, number] {
  const idCount = (selector.match(/#[\w-]+/g) || []).length;
  const classCount = (selector.match(/\.[\w-]+/g) || []).length;
  const pseudoClassCount = (selector.match(/:[\w-]+/g) || []).length;
  const elementCount = (selector.match(/(^|[\s>+~])([a-z][\w-]*)/gi) || [])
    .length;
  return [idCount, classCount + pseudoClassCount, elementCount];
}

function parseRules(source: string): CssRule[] {
  const rules: CssRule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  const withoutComments = stripComments(source);
  let order = 0;
  let match = pattern.exec(withoutComments);
  while (match) {
    const selectors = match[1]
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean);
    for (const selector of selectors) {
      if (selector.startsWith("@")) continue;
      rules.push({
        selector,
        declarations: parseDeclarations(match[2]),
        order: order++,
        specificity: specificity(selector),
      });
    }
    match = pattern.exec(withoutComments);
  }
  return rules;
}

const rules = parseRules(css);

function compareSpecificity(
  a: [number, number, number],
  b: [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function selectorMatches(
  selector: string,
  target: "body" | "load-bar",
  bodyClass?: string,
): boolean {
  if (target === "body") {
    return selector === ":root" || selector === `body.${bodyClass}`;
  }
  return (
    selector === "#load-bar" ||
    (bodyClass != null && selector === `body.${bodyClass} #load-bar`)
  );
}

function cascadedDeclarations(
  target: "body" | "load-bar",
  bodyClass?: string,
): Map<string, string> {
  const applied = new Map<
    string,
    { value: string; specificity: [number, number, number]; order: number }
  >();
  for (const rule of rules) {
    if (!selectorMatches(rule.selector, target, bodyClass)) continue;
    for (const [prop, value] of rule.declarations) {
      const previous = applied.get(prop);
      const wins =
        !previous ||
        compareSpecificity(rule.specificity, previous.specificity) > 0 ||
        (compareSpecificity(rule.specificity, previous.specificity) === 0 &&
          rule.order > previous.order);
      if (wins)
        applied.set(prop, {
          value,
          specificity: rule.specificity,
          order: rule.order,
        });
    }
  }
  return new Map([...applied].map(([prop, entry]) => [prop, entry.value]));
}

function resolveVar(value: string, variables: Map<string, string>): string {
  let resolvedValue = value;
  for (let i = 0; i < 8; i++) {
    const next = resolvedValue.replace(
      /var\((--[\w-]+)\)/g,
      (_, name: string) => {
        const resolved = variables.get(name);
        if (!resolved) throw new Error(`Unresolved CSS variable ${name}`);
        return resolved;
      },
    );
    if (next === resolvedValue) return next;
    resolvedValue = next;
  }
  throw new Error(`Could not resolve CSS variables in ${value}`);
}

function loadBarTopFor(bodyClass?: string): string {
  const bodyDeclarations = cascadedDeclarations("body", bodyClass);
  const loadBarDeclarations = cascadedDeclarations("load-bar", bodyClass);
  const top = loadBarDeclarations.get("top");
  if (!top) throw new Error("Missing #load-bar top declaration");
  return resolveVar(top, bodyDeclarations);
}

describe("load-bar layout", () => {
  test("keeps the global loading bar below visible diff chrome", () => {
    expect(loadBarTopFor()).toBe("calc(48px + 56px)");
  });

  test("places the loading bar directly below the header on pages without topbar", () => {
    expect(loadBarTopFor("gdp-database-page")).toBe("48px");
    expect(loadBarTopFor("gdp-file-detail-page")).toBe("48px");
    expect(loadBarTopFor("gdp-repo-page")).toBe("48px");
  });
});
