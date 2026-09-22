// フロントがサーバへ送る要求の URL は、web-src/core/api-url.ts の apiUrl() を通す。
//
// 何を防ぐか: 入口のサーバを 1 つにすると、要求の URL に前置きが要る。前置きは
// apiUrl() の中で付けるので、経路の文字列をじかに書いた 1 か所が、入口経由では
// 別のプロセスへ届く (または届かない)。以前プロセスを 1 つにまとめる案を捨てた
// 理由の 1 つがこの取りこぼしだった。散文で「apiUrl を使う」と書いても、
// fetch を足す人が読む場所とは限らないので、ここで機械的に落とす。
//
// 見るもの: web-src の .ts のうち server/ と test/ を除いたもの。引用符の直後に
// サーバの経路 (/_… と /file_… と /events と /diff.json) が来る行を拾う。
// 画面の URL (/file?… など) は buildRoute() が組み立てるので対象外。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = "web-src";
const SKIP_DIRECTORIES = new Set(["server", "test"]);
const URL_BUILDER = "web-src/core/api-url.ts";

// 引用符 (" ' `) の直後に経路が始まる形。
const SERVER_PATH_LITERAL =
  /["'`]\/(?:_|file_|events(?![\w-])|diff\.json(?![\w-]))/;

function frontendSources(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!(dir === ROOT && SKIP_DIRECTORIES.has(name))) walk(full);
      } else if (name.endsWith(".ts")) {
        found.push(relative(".", full));
      }
    }
  };
  walk(ROOT);
  return found;
}

describe("server paths go through apiUrl()", () => {
  test.each([
    ['fetch("/_tree")', true],
    ["fetch(`/_tree?${params}`)", true],
    ["'/events'", true],
    ['"/file_range?path=" + path', true],
    ["`/diff.json${query}`", true],
    ['buildRoute({ screen: "file" }) + "/file?path="', false],
    ['"/eventsource-demo"', false],
    ['apiUrl("tree")', false],
  ])("the matcher treats %s as a server path: %s", (line, expected) => {
    expect(SERVER_PATH_LITERAL.test(line)).toBe(expected);
  });

  test("the URL builder itself holds the server paths", () => {
    const lines = readFileSync(URL_BUILDER, "utf8").split("\n");
    expect(lines.some((line) => SERVER_PATH_LITERAL.test(line))).toBe(true);
  });

  test("no other frontend file writes a server path literal", () => {
    const offenders: string[] = [];
    for (const file of frontendSources()) {
      if (file === URL_BUILDER) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (SERVER_PATH_LITERAL.test(line)) {
            offenders.push(`${file}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
