import { describe, expect, test } from "vitest";
import { compileNamePatterns } from "../server/name-pattern";

describe("compileNamePatterns", () => {
  test.each([
    {
      name: "リテラル完全一致",
      patterns: [".DS_Store"],
      input: ".DS_Store",
      expected: true,
    },
    {
      name: "リテラルは大文字小文字を無視する",
      patterns: [".DS_Store"],
      input: ".ds_store",
      expected: true,
    },
    {
      name: "リテラル不一致",
      patterns: ["dist"],
      input: "distant",
      expected: false,
    },
    {
      name: "* は0文字以上にマッチする",
      patterns: ["test-*"],
      input: "test-",
      expected: true,
    },
    {
      name: "* は任意の文字列にマッチする",
      patterns: ["*.log"],
      input: "error.log",
      expected: true,
    },
    {
      name: "* があっても拡張子が違えば非マッチ",
      patterns: ["*.log"],
      input: "error.txt",
      expected: false,
    },
    {
      name: "? は1文字にマッチする",
      patterns: ["a?c"],
      input: "abc",
      expected: true,
    },
    {
      name: "? は0文字には非マッチ",
      patterns: ["a?c"],
      input: "ac",
      expected: false,
    },
    {
      name: "? は2文字には非マッチ",
      patterns: ["a?c"],
      input: "abbc",
      expected: false,
    },
    {
      name: "[abc] は文字クラス内にマッチする",
      patterns: ["[abc]og"],
      input: "bog",
      expected: true,
    },
    {
      name: "[abc] は文字クラス外には非マッチ",
      patterns: ["[abc]og"],
      input: "dog",
      expected: false,
    },
    {
      name: "[a-z] はレンジ内にマッチする",
      patterns: ["[a-z]og"],
      input: "log",
      expected: true,
    },
    {
      name: "[a-z] はレンジ外には非マッチ",
      patterns: ["[a-z]og"],
      input: "5og",
      expected: false,
    },
    {
      name: "[!abc] は否定文字クラスにマッチする",
      patterns: ["[!abc]og"],
      input: "dog",
      expected: true,
    },
    {
      name: "[!abc] は否定対象の文字には非マッチ",
      patterns: ["[!abc]og"],
      input: "bog",
      expected: false,
    },
    {
      name: "gitignore に無いブレース展開は文字通りにしか一致しない",
      patterns: ["*.{ts,js}"],
      input: "a.ts",
      expected: false,
    },
  ])("$name", ({ patterns, input, expected }) => {
    expect(compileNamePatterns(patterns).matches(input)).toBe(expected);
  });

  test("複数パターンのいずれかにマッチすればtrue", () => {
    const set = compileNamePatterns(["*.log", "dist", "[0-9]*.tmp"]);
    expect(set.matches("app.log")).toBe(true);
    expect(set.matches("dist")).toBe(true);
    expect(set.matches("9x.tmp")).toBe(true);
    expect(set.matches("app.ts")).toBe(false);
  });

  test("パターンが空配列なら何にもマッチしない", () => {
    const set = compileNamePatterns([]);
    expect(set.matches("anything")).toBe(false);
  });
});
