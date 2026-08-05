import { describe, expect, test } from "vitest";
import {
  changedPathCoversPath,
  changedPathsCoverPath,
} from "../core/changed-paths";

describe("changedPathCoversPath", () => {
  test.each([
    {
      name: "同一パスはカバーする",
      changed: "src/a.ts",
      path: "src/a.ts",
      expected: true,
    },
    {
      name: "ディレクトリ通知は直下のファイルをカバーする",
      changed: "src",
      path: "src/a.ts",
      expected: true,
    },
    {
      name: "ディレクトリ通知は孫階層もカバーする",
      changed: "src",
      path: "src/views/diff/a.ts",
      expected: true,
    },
    // 区切り文字なしの前方一致だとこの2件が誤ヒットする。境界の本体。
    {
      name: "境界: 名前が接頭辞になっている兄弟はカバーしない",
      changed: "src/a",
      path: "src/ab.ts",
      expected: false,
    },
    {
      name: "境界: 接頭辞が一致するだけの別ディレクトリはカバーしない",
      changed: "src",
      path: "srcx/a.ts",
      expected: false,
    },
    {
      name: "境界: 区切り文字直後から分岐する子はカバーする",
      changed: "src/a",
      path: "src/a/b.ts",
      expected: true,
    },
    {
      name: "無関係なパスはカバーしない",
      changed: "src",
      path: "docs/a.ts",
      expected: false,
    },
    {
      name: "ファイル通知は自分の親ディレクトリをカバーしない",
      changed: "src/a.ts",
      path: "src",
      expected: false,
    },
  ])("$name", ({ changed, path, expected }) => {
    expect(changedPathCoversPath(changed, path)).toBe(expected);
  });
});

describe("changedPathsCoverPath", () => {
  test.each([
    {
      name: "null は変更箇所不明なので全てカバーする",
      changedPaths: null,
      path: "src/a.ts",
      expected: true,
    },
    {
      name: "undefined も変更箇所不明として全てカバーする",
      changedPaths: undefined,
      path: "src/a.ts",
      expected: true,
    },
    {
      name: "空集合は何もカバーしない",
      changedPaths: new Set<string>(),
      path: "src/a.ts",
      expected: false,
    },
    {
      name: "完全一致を含む集合はカバーする",
      changedPaths: new Set(["docs/b.ts", "src/a.ts"]),
      path: "src/a.ts",
      expected: true,
    },
    {
      name: "ディレクトリ通知を含む集合は配下をカバーする",
      changedPaths: new Set(["docs/b.ts", "src"]),
      path: "src/views/a.ts",
      expected: true,
    },
    {
      name: "接頭辞が似た兄弟だけの集合はカバーしない",
      changedPaths: new Set(["src/a"]),
      path: "src/ab.ts",
      expected: false,
    },
  ])("$name", ({ changedPaths, path, expected }) => {
    expect(changedPathsCoverPath(changedPaths, path)).toBe(expected);
  });
});
