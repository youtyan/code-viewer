// 公開リポジトリのデータ衛生を機械で検査する。
//
// 何を防ぐか: ローカル DB / スクリーンショット / API 応答で観測した実データの
// 名前を、テストのフィクスチャ・コメント・ドキュメントへ写してしまう事故。
// この形はこのリポジトリで 3 回起きている。
//   - Supabase の project_id フィクスチャに実プロジェクト名 (c8875fe で修正)
//   - datastore テストのフィクスチャに実テーブル名 (このコミットで修正)
//   - 折り返しバグの症状説明として、実テーブル名を CSS のコメントに引用
//     (c31e668 で修正)
// 3 回とも AGENTS.md に散文の規範はあった。止まらなかったのは検査が無く
// 「これは引用であってデータではない」と自分に説明できてしまったため。
// だから散文を足すのではなく、ここで機械的に落とす。
//
// 仕組み: 事故が起きた場所 (テストの文字列とコメント / CSS・HTML のコメント /
// ドキュメント) に現れる snake_case の識別子を集め、既知の一覧と突き合わせる。
// **新しい名前が増えたときだけ落ちる** ラチェット方式。落ちたら、その名前が
// 観測データ由来でないことを確認してから一覧へ足す。
//
// なぜ「一覧に足す」を要求するか: 観測データか技術用語かは機械には区別でき
// ない。人間 (またはエージェント) が 1 件ずつ立ち止まる場所を作るのが目的で、
// 一覧の肥大それ自体は問題ではない。
//
// この検査が見ないもの: 識別子でない固有名詞 (画面に出ていた日本語の名称、
// 顧客名、URL)、カラムの値。**緑でも「監査した」ことにはならない。**

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { KNOWN_SNAKE_CASE_IDENTIFIERS } from "./_hygiene-known-identifiers";

// 過去 3 回の事故が起きた場所。ここを広げるとノイズが増えて一覧が回らなく
// なるので、実際に事故が起きた面だけを見る。
const SCAN_DIRECTORIES = ["web-src/test", "skills"];
const SCAN_FILES = [
  "web/style.css",
  "web/index.html",
  "README.md",
  "AGENTS.md",
];
const SCAN_EXTENSIONS = new Set([".ts", ".md"]);
const SKIP_DIRECTORIES = new Set(["node_modules", "vendor", ".git", "dist"]);

// 2 語以上の snake_case。DB のテーブル名 / カラム名はほぼこの形になる。
const SNAKE_CASE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

// 中立プレースホルダは常に許可する (これを使うのが正解なので一覧に載せない)。
const PLACEHOLDER_PREFIXES = ["sample_", "example_"];

function collectFiles(): string[] {
  const found = [...SCAN_FILES];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRECTORIES.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (SCAN_EXTENSIONS.has(extname(name))) found.push(full);
    }
  };
  for (const dir of SCAN_DIRECTORIES) walk(dir);
  return found;
}

/** 名前が「データとして書かれている」箇所だけを取り出す。 */
function dataRegions(path: string, source: string): string[] {
  // Markdown は全文が説明文なのでそのまま見る。
  if (extname(path) === ".md") return [source];
  const regions = [...(source.match(/\/\*[\s\S]*?\*\//g) ?? [])];
  if (extname(path) !== ".ts") return regions;
  regions.push(...(source.match(/\/\/[^\n]*/g) ?? []));
  regions.push(...(source.match(/"(?:[^"\\\n]|\\.)*"/g) ?? []));
  regions.push(...(source.match(/'(?:[^'\\\n]|\\.)*'/g) ?? []));
  regions.push(...(source.match(/`(?:[^`\\]|\\.)*`/g) ?? []));
  return regions;
}

describe("public repository data hygiene", () => {
  test("no unreviewed database-shaped identifier enters the repository", () => {
    const files = collectFiles();
    // 対象の取りこぼしで素通りしないこと。
    expect(files.length).toBeGreaterThan(100);
    const known = new Set(KNOWN_SNAKE_CASE_IDENTIFIERS);

    const unknown = new Map<string, string>();
    for (const file of files) {
      // この検査自身は識別子の形を説明に使うので対象外。
      if (file.endsWith("public-repo-hygiene.test.ts")) continue;
      if (file.endsWith("_hygiene-known-identifiers.ts")) continue;
      const source = readFileSync(file, "utf8");
      for (const region of dataRegions(file, source)) {
        for (const token of region.match(SNAKE_CASE) ?? []) {
          if (PLACEHOLDER_PREFIXES.some((p) => token.startsWith(p))) continue;
          if (known.has(token)) continue;
          if (!unknown.has(token)) unknown.set(token, file);
        }
      }
    }

    // 落ちたときの手順:
    //   1. その名前をどこで見たか思い出す。ローカル DB / スクリーンショット /
    //      API 応答 / ログで観測したものなら、sample_ か example_ の名前へ
    //      置き換える (git 履歴に残ると取り返しがつかない)。
    //   2. 技術用語・SQL の予約語・自プロジェクトの識別子なら、
    //      _hygiene-known-identifiers.ts へ 1 行足す。
    expect(Object.fromEntries(unknown)).toEqual({});
  });

  test("the known-identifier list stays sorted and free of duplicates", () => {
    const sorted = [...KNOWN_SNAKE_CASE_IDENTIFIERS].sort();
    expect(KNOWN_SNAKE_CASE_IDENTIFIERS).toEqual(sorted);
    expect(new Set(KNOWN_SNAKE_CASE_IDENTIFIERS).size).toBe(
      KNOWN_SNAKE_CASE_IDENTIFIERS.length,
    );
  });

  // プレースホルダ接頭辞は一覧を経由せずに通る = 正しい書き方が摩擦ゼロで
  // 済むこと。ここが壊れると、全員が一覧へ足す方向に流れる。
  test("placeholder names never need an entry in the list", () => {
    const known = new Set(KNOWN_SNAKE_CASE_IDENTIFIERS);
    for (const name of ["sample_orders", "example_line_items"]) {
      expect(known.has(name)).toBe(false);
      expect(PLACEHOLDER_PREFIXES.some((p) => name.startsWith(p))).toBe(true);
    }
  });
});
