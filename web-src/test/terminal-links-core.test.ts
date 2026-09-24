// ターミナルの画面の文字から URL とファイルのパスを拾う (core/terminal-links.ts)。
//
// 落とすと痛いもの:
//
// - 文の終わりの句読点や閉じ括弧まで URL に含めて、開くと 404
// - URL の途中 (`//example.com/a/b`) をファイルのパスとして拾う
// - 行番号 (`src/app.ts:12:3`) を落として、その行へ飛べない
// - 端末の幅で折り返した URL・パスを 2 つに割る

import { describe, expect, test } from "vitest";
import { findTextLinks, matchTextLinks } from "../core/terminal-links";

type Row = {
  kind: string;
  candidate: string;
  path: string;
  line?: number;
  column?: number;
};

const rows = (text: string): Row[] =>
  matchTextLinks(text).map(({ kind, candidate, path, line, column }) => ({
    kind,
    candidate,
    path,
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  }));

describe("matchTextLinks", () => {
  test.each<{ name: string; text: string; expected: Row[] }>([
    {
      name: "https の URL",
      text: "see https://example.com/docs/setup for details",
      expected: [
        {
          kind: "url",
          candidate: "https://example.com/docs/setup",
          path: "https://example.com/docs/setup",
        },
      ],
    },
    {
      name: "文の終わりの点と閉じ括弧は含めない",
      text: "(docs: https://example.com/a.)",
      expected: [
        {
          kind: "url",
          candidate: "https://example.com/a",
          path: "https://example.com/a",
        },
      ],
    },
    {
      name: "URL の中の対になった括弧は含める",
      text: "https://example.com/wiki/A_(b)",
      expected: [
        {
          kind: "url",
          candidate: "https://example.com/wiki/A_(b)",
          path: "https://example.com/wiki/A_(b)",
        },
      ],
    },
    {
      name: "全角の字の前で URL を切る",
      text: "参考：https://example.com/docs/setupを見る",
      expected: [
        {
          kind: "url",
          candidate: "https://example.com/docs/setup",
          path: "https://example.com/docs/setup",
        },
      ],
    },
    {
      name: "URL の途中はファイルのパスにしない",
      text: "http://localhost:8080/api/items",
      expected: [
        {
          kind: "url",
          candidate: "http://localhost:8080/api/items",
          path: "http://localhost:8080/api/items",
        },
      ],
    },
    {
      name: "行と桁つきの相対パス",
      text: "error at src/app.ts:12:3",
      expected: [
        {
          kind: "file",
          candidate: "src/app.ts:12:3",
          path: "src/app.ts",
          line: 12,
          column: 3,
        },
      ],
    },
    {
      name: "行だけ",
      text: "変更したファイル: src/greeting.ts:3",
      expected: [
        {
          kind: "file",
          candidate: "src/greeting.ts:3",
          path: "src/greeting.ts",
          line: 3,
        },
      ],
    },
    {
      name: "./ と ../ と ~/ (区切り 1 つでも拾う)",
      text: "./README.md ../notes.txt ~/todo.md",
      expected: [
        { kind: "file", candidate: "./README.md", path: "./README.md" },
        { kind: "file", candidate: "../notes.txt", path: "../notes.txt" },
        { kind: "file", candidate: "~/todo.md", path: "~/todo.md" },
      ],
    },
    {
      name: "絶対パス、文の終わりの点は含めない",
      text: "wrote /work/sample-app/out/report.txt.",
      expected: [
        {
          kind: "file",
          candidate: "/work/sample-app/out/report.txt",
          path: "/work/sample-app/out/report.txt",
        },
      ],
    },
    {
      name: "区切りの無い語・1 段の絶対パスは拾わない",
      text: "package.json /tmp done",
      expected: [],
    },
    {
      name: "枠の線に挟まれていても、線は含めない",
      text: "│ src/app.ts │",
      expected: [{ kind: "file", candidate: "src/app.ts", path: "src/app.ts" }],
    },
  ])("$name", ({ text, expected }) => {
    expect(rows(text)).toEqual(expected);
  });
});

describe("findTextLinks (画面の行)", () => {
  test("1 行の中の範囲 (col は文字列の添字、end は含まない)", () => {
    const [link] = findTextLinks(["x https://example.com/a y"], 80);
    expect(link?.start).toEqual({ row: 0, col: 2 });
    expect(link?.end).toEqual({ row: 0, col: 23 });
  });

  test("端末の幅で折り返した URL は 1 つとして拾う", () => {
    const links = findTextLinks(
      ["see https://example.com/ve", "ry/long/page next"],
      26,
    );
    expect(links.map((link) => link.candidate)).toEqual([
      "https://example.com/very/long/page",
    ]);
    expect(links[0]?.start).toEqual({ row: 0, col: 4 });
    expect(links[0]?.end).toEqual({ row: 1, col: 12 });
  });

  test("幅いっぱいでない行は次の行と繋がない", () => {
    const links = findTextLinks(["see src/app.ts", "more/text"], 80);
    expect(links.map((link) => link.candidate)).toEqual([
      "src/app.ts",
      "more/text",
    ]);
  });
});
