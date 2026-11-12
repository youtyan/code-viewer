// 生の色 (16 進・rgb()・hsl()) を書いてよいのは、色の名前を決める塊 (:root と
// 明暗・テーマ・ターミナルの明暗の塊) だけ。部品は名前 (--color-* と、部品だけの
// --app-*) を読む。部品に直書きした色はテーマも明暗も追わない: 以前は
// var(--warning, #9a6700) のように定義の無い名前の予備の色が全テーマで出ていて、
// Blame のダークの色は付かない選択子 (:root.dark) に書かれていた。

import { expect, test } from "vitest";
import { loadStyleSheet } from "./_css-fixture";

const TOKEN_SCOPE =
  /^(:root|\[data-theme="(light|dark)"\]|\[data-color-theme="[\w-]+"\]|\[data-terminal-tone="dark"\])/;
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i;

test("raw colors appear only in the token blocks", () => {
  const offenders = loadStyleSheet()
    .filter((rule) => !TOKEN_SCOPE.test(rule.selector))
    .flatMap((rule) =>
      [...rule.declarations]
        .filter(([, value]) => COLOR_LITERAL.test(value))
        .map(([prop, value]) => `${rule.selector} { ${prop}: ${value} }`),
    );
  expect(offenders).toEqual([]);
});
