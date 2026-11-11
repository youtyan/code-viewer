// 部品 (cv-*) と宣言的な描き方の決まりを守らせる検査。決まりの本文は
// .agents/skills/project-rules/references/ui-components.md。
//
// 1. どの部品の外側の要素も箱を作らない (display: contents)。web/style.css の
//    「部品の外側の要素」の並びに名前が無いと、外側の要素が親の flex・grid の
//    並びに 1 つ余計な箱として入り、見た目が変わる。
// 2. 宣言的に書き直した画面に、命令的に DOM を組み立てる書き方 (createElement・
//    innerHTML・insertAdjacentHTML・outerHTML) が戻っていない (不在の証明)。
//    まだ書き直していない所の数は上限で抑え、書き直すたびに下げる。

import "./_dom";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const VIEWS = "web-src/views";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const VIEW_FILES = [...sourceFiles(VIEWS), "web-src/app.ts"];

/** ソースに書かれた部品の名前 (export const CV_X = "cv-x")。 */
function componentNames(): string[] {
  const names: string[] = [];
  for (const file of VIEW_FILES) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /export const CV_[A-Z_]+ = "([^"]+)";/g,
    ))
      names.push(match[1]);
  }
  return names.sort();
}

describe("component outer elements", () => {
  const names = componentNames();

  test("there are components to check", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  test("every component name starts with cv-", () => {
    expect(names.filter((name) => !name.startsWith("cv-"))).toEqual([]);
  });

  test("every component's outer element makes no box of its own", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("web/style.css", "utf8");
    document.head.appendChild(style);
    const boxed = names.filter((name) => {
      const el = document.createElement(name);
      document.body.appendChild(el);
      const display = getComputedStyle(el).display;
      el.remove();
      return display !== "contents";
    });
    style.remove();
    expect(boxed).toEqual([]);
  });
});

/** 命令的に DOM を組み立てる書き方。 */
const IMPERATIVE_DOM =
  /createElement(NS)?\(|\.innerHTML\s*=|insertAdjacentHTML|\.outerHTML\s*=/g;

/** 宣言的に書き直した所。中に命令的な組み立てが 1 つも無いこと。 */
const DECLARATIVE = ["web-src/views/ui/", "web-src/views/tools/"];

/**
 * 書き直した所の中で、外の部品が DOM を作る・外の部品に DOM を渡すために
 * 命令的な書き方が残る所。ファイルごとの数と理由。
 */
const EXCEPTIONS: Record<string, { count: number; reason: string }> = {};

/** まだ書き直していない所も含めた、命令的な組み立ての数の上限。書き直したら下げる。 */
const IMPERATIVE_LIMIT = 2207;

function imperativeCount(file: string): number {
  return [...readFileSync(file, "utf8").matchAll(IMPERATIVE_DOM)].length;
}

describe("declarative views", () => {
  test("rewritten screens build no DOM imperatively", () => {
    const found = VIEW_FILES.filter((file) =>
      DECLARATIVE.some((prefix) => file.startsWith(prefix)),
    )
      .map((file) => ({ file, count: imperativeCount(file) }))
      .filter(({ file, count }) => count !== (EXCEPTIONS[file]?.count ?? 0));
    expect(found).toEqual([]);
  });

  test("the imperative DOM left in screens not yet rewritten does not grow", () => {
    const total = VIEW_FILES.reduce(
      (sum, file) => sum + imperativeCount(file),
      0,
    );
    expect(total).toBeLessThanOrEqual(IMPERATIVE_LIMIT);
  });
});
