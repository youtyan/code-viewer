// 画面に出たファイルのパスが、このプロジェクトの中で実在するファイルか
// (server/terminal/paths.ts と /_agent/paths)。
//
// 落とすと痛いもの:
//
// - 存在しないパス・ディレクトリ・プロジェクトの外のファイルをリンクにする
//   (押しても開けない / プロジェクトの外を開こうとする)
// - symlink でプロジェクトの外を指すものを中のものとして扱う
// - 相対パスを、シェルが居る場所でなくプロジェクトの根からしか解かない

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MAX_TERMINAL_PATH_QUERY } from "../core/terminal-links";
import { handleAgentRoute } from "../server/terminal/handle";
import { resolveTerminalPaths } from "../server/terminal/paths";
import { callRoute } from "./_test-helpers";

let dir: string;
let root: string;
let outside: string;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "cv-terminal-paths-")));
  root = join(dir, "sample-app");
  outside = join(dir, "elsewhere");
  mkdirSync(join(root, "src", "lib"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, "src", "app.ts"), "x");
  writeFileSync(join(root, "src", "lib", "util.ts"), "x");
  writeFileSync(join(root, "README.md"), "x");
  writeFileSync(join(outside, "secret.txt"), "x");
  symlinkSync(join(outside, "secret.txt"), join(root, "src", "link.txt"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveTerminalPaths", () => {
  test.each([
    {
      name: "プロジェクトの根からの相対パス",
      candidate: "src/app.ts",
      expected: "src/app.ts",
    },
    { name: "./ つき", candidate: "./README.md", expected: "README.md" },
    {
      name: "絶対パス (プロジェクトの中)",
      candidate: () => join(root, "src", "app.ts"),
      expected: "src/app.ts",
    },
    {
      name: "シェルの居る場所 (src/lib) からの相対パス",
      candidate: "util.ts",
      base: "lib",
      expected: "src/lib/util.ts",
    },
    {
      name: "../ でシェルの居る場所から上へ",
      candidate: "../app.ts",
      base: "lib",
      expected: "src/app.ts",
    },
    { name: "無いファイル", candidate: "src/missing.ts", expected: null },
    { name: "ディレクトリ", candidate: "src/lib", expected: null },
    {
      name: "プロジェクトの外の絶対パス",
      candidate: () => join(outside, "secret.txt"),
      expected: null,
    },
    {
      name: "外を指す symlink",
      candidate: "src/link.txt",
      expected: null,
    },
  ])("$name", ({ candidate, base, expected }) => {
    const text = typeof candidate === "function" ? candidate() : candidate;
    const bases = base === "lib" ? [join(root, "src", "lib"), root] : [root];
    const result = resolveTerminalPaths(root, bases, [text]);
    expect(result.errors).toEqual([]);
    expect(result.files.map((file) => file.path)).toEqual(
      expected === null ? [] : [expected],
    );
    if (expected !== null) {
      expect(result.files[0]?.absolute).toBe(join(root, expected));
      expect(result.files[0]?.candidate).toBe(text);
    }
  });
});

describe("/_agent/paths", () => {
  test("実在するものだけを返す", async () => {
    const res = await callRoute(
      handleAgentRoute,
      "/_agent/paths?path=src%2Fapp.ts&path=src%2Fmissing.ts",
      {},
      () => true,
      root,
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({
      files: [
        {
          candidate: "src/app.ts",
          path: "src/app.ts",
          absolute: join(root, "src", "app.ts"),
        },
      ],
    });
  });

  test("POST は受け付けない", async () => {
    const res = await callRoute(handleAgentRoute, "/_agent/paths", {
      method: "POST",
    });
    expect(res?.status).toBe(405);
  });

  test("1 回に聞ける数を超えたら 400", async () => {
    const query = Array.from(
      { length: MAX_TERMINAL_PATH_QUERY + 1 },
      (_, i) => `path=a${i}%2Fb`,
    ).join("&");
    const res = await callRoute(handleAgentRoute, `/_agent/paths?${query}`);
    expect(res?.status).toBe(400);
  });
});
