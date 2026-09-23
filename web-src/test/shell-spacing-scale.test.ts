// 骨格 (style.css 末尾の「Workspace shell」から後ろ) の余白と寸法は、名前の層
// (--space-* / --pad-* / --indent-step / --icon-* / --ui-*) だけで書く。
//
// 余白を段階の外の px で書くと、面ごとに少しずつずれて基準線がそろわなくなる
// (実際に、文書の面の中で行ごとに 14px・34px・41px と字下げがばらついた)。
// 密度の設定で比例して変わるのも、名前を通しているときだけ。
//
// 線の太さ (2px 以下) は余白ではないので許す。古い部品 (この区切りより前) は
// 対象外 (触ったときに寄せる。ui-surface.md)。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const MARKER = "Workspace shell — ";

/** 余白・位置・大きさを決めるプロパティ。 */
const SPACING_PROPERTY =
  /^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left|width|height|min-width|min-height|max-width|max-height|grid-template-columns|grid-template-rows|flex-basis)(-|$)/;

function shellDeclarations(): {
  selector: string;
  property: string;
  value: string;
}[] {
  const css = readFileSync("web/style.css", "utf8");
  const start = css.indexOf(MARKER);
  if (start < 0) throw new Error(`missing "${MARKER}" in web/style.css`);
  const body = css.slice(start).replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; property: string; value: string }[] = [];
  for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "").trim();
    for (const raw of (match[2] ?? "").split(";")) {
      const colon = raw.indexOf(":");
      if (colon < 0) continue;
      const property = raw.slice(0, colon).trim();
      const value = raw.slice(colon + 1).trim();
      if (property.startsWith("--")) continue;
      if (!SPACING_PROPERTY.test(property)) continue;
      out.push({ selector, property, value });
    }
  }
  return out;
}

/** 線の太さ以外の px (2px を超えるもの)。 */
function rawLengths(value: string): string[] {
  return [...value.matchAll(/(-?\d*\.?\d+)px\b/g)]
    .filter((match) => Math.abs(Number(match[1])) > 2)
    .map((match) => match[0]);
}

describe("workspace shell spacing", () => {
  test("the shell section exists and has spacing declarations to check", () => {
    expect(shellDeclarations().length).toBeGreaterThan(50);
  });

  test("spacing and sizes use the named scale, not raw pixels", () => {
    const offenders = shellDeclarations()
      .map((item) => ({ ...item, raw: rawLengths(item.value) }))
      .filter((item) => item.raw.length > 0)
      .map((item) => `${item.selector} { ${item.property}: ${item.value} }`);
    expect(offenders).toEqual([]);
  });

  test.each([
    ["padding: 0 12px", ["12px"]],
    ["gap: 2px", []],
    ["width: var(--icon-md)", []],
    ["padding: 1.5px 16px", ["16px"]],
  ])("rawLengths(%s)", (declaration, expected) => {
    expect(rawLengths(declaration)).toEqual(expected);
  });
});
