// 差分の読み込み (app.ts の load) は、HTTP の失敗を差分として描かない。裏の
// プロセスが止まると入口は 502 と `{error, code, project: {key, root}}` を返し、
// 本文を確かめずに DiffMeta として読んでいたので、見出しのプロジェクト名が
// "[object Object]" になり、差分が空の画面になった。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const source = readFileSync(join(__dirname, "..", "app.ts"), "utf8");

test("差分の読み込みは response.ok を見てから JSON を読む", () => {
  const start = source.indexOf('apiUrl("diffJson")');
  const end = source.indexOf("trackLoad<DiffMeta>(", start);
  expect([start > 0, end > start]).toEqual([true, true]);
  const block = source.slice(start, end);
  expect([
    block.includes("if (!response.ok)"),
    block.includes("responseErrorMessage("),
    /\.then\(\(r\) => r\.json\(\)\)/.test(block),
  ]).toEqual([true, true, false]);
});
