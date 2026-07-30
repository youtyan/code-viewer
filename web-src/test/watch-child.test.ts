import { describe, expect, test } from "bun:test";
import { parsePorcelainV2 } from "../server/watch-child";
import { supportsNativeRecursiveWatch } from "../server/worktree-watcher";

describe("supportsNativeRecursiveWatch", () => {
  test.each([
    // libuv passes the recursive flag straight to FSEvents / bWatchSubtree.
    {
      name: "macOS はネイティブ再帰監視を使える",
      platform: "darwin",
      expected: true,
    },
    {
      name: "Windows はネイティブ再帰監視を使える",
      platform: "win32",
      expected: true,
    },
    // Node emulates recursive watching in JS here, creating one watcher per file
    // and directory, so it would be strictly worse than the existing strategy.
    {
      name: "Linux はネイティブ再帰監視を使えない",
      platform: "linux",
      expected: false,
    },
    {
      name: "その他のOSもネイティブ再帰監視を使えない",
      platform: "freebsd",
      expected: false,
    },
  ])("$name", ({ platform, expected }) => {
    expect(supportsNativeRecursiveWatch(platform)).toBe(expected);
  });
});

describe("parsePorcelainV2", () => {
  test.each([
    {
      name: "branch.oid を HEAD として取り出す",
      raw: "# branch.oid 1111111111111111111111111111111111111111\0# branch.head main\0",
      expectedHead: "1111111111111111111111111111111111111111",
      expectedPaths: [],
    },
    {
      name: "1 レコード（変更あり）のパスを取り出す",
      raw: "1 .M N... 100644 100644 100644 aaa bbb src/sample.ts\0",
      expectedHead: "",
      expectedPaths: ["src/sample.ts"],
    },
    {
      name: "1 レコードのパスにスペースが含まれても全体を取り出す",
      raw: "1 .M N... 100644 100644 100644 aaa bbb src/sample file.ts\0",
      expectedHead: "",
      expectedPaths: ["src/sample file.ts"],
    },
    {
      name: "2 レコード（rename）は新しいパスを取り、元パスのフィールドを消費する",
      raw: "2 R. N... 100644 100644 100644 aaa bbb R100 src/new.ts\0src/old.ts\0",
      expectedHead: "",
      expectedPaths: ["src/new.ts"],
    },
    {
      name: "u レコード（コンフリクト）のパスを取り出す",
      raw: "u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts\0",
      expectedHead: "",
      expectedPaths: ["src/conflict.ts"],
    },
    {
      name: "? レコード（未追跡）のパスを取り出す",
      raw: "? src/untracked.ts\0",
      expectedHead: "",
      expectedPaths: ["src/untracked.ts"],
    },
    {
      name: "! レコード（無視）のパスを取り出す",
      raw: "! dist/bundle.js\0",
      expectedHead: "",
      expectedPaths: ["dist/bundle.js"],
    },
    {
      name: "rename の直後のレコードを取りこぼさない",
      raw:
        "2 R. N... 100644 100644 100644 aaa bbb R100 src/new.ts\0src/old.ts\0" +
        "? src/untracked.ts\0",
      expectedHead: "",
      expectedPaths: ["src/new.ts", "src/untracked.ts"],
    },
    {
      name: "複数種類のレコードを混在して取り出す",
      raw:
        "# branch.oid 2222222222222222222222222222222222222222\0" +
        "1 .M N... 100644 100644 100644 aaa bbb src/changed.ts\0" +
        "? src/new-file.ts\0",
      expectedHead: "2222222222222222222222222222222222222222",
      expectedPaths: ["src/changed.ts", "src/new-file.ts"],
    },
    {
      name: "空入力は HEAD なし・パスなしになる",
      raw: "",
      expectedHead: "",
      expectedPaths: [],
    },
  ])("$name", ({ raw, expectedHead, expectedPaths }) => {
    const parsed = parsePorcelainV2(raw);
    expect(parsed.head).toBe(expectedHead);
    expect(parsed.entries.map((entry) => entry.path)).toEqual(expectedPaths);
  });

  test("同じパスの状態が変わると status も変わる", () => {
    const modified = parsePorcelainV2(
      "1 .M N... 100644 100644 100644 aaa bbb src/sample.ts\0",
    );
    const staged = parsePorcelainV2(
      "1 M. N... 100644 100644 100644 aaa bbb src/sample.ts\0",
    );
    expect(modified.entries[0].path).toBe("src/sample.ts");
    expect(staged.entries[0].path).toBe("src/sample.ts");
    expect(modified.entries[0].status).not.toBe(staged.entries[0].status);
  });
});
