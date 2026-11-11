// 配布スキル (skills/*/SKILL.md) と README に書いた `code-viewer <サブコマンド> …` の例を、
// 実際の引数の解釈 (server/*-cli.ts の parse…Args) に通す。書いた例と CLI がずれると
// 落ちる (エージェントは例をそのまま打つ)。サブコマンドごとの細かい検査は各 CLI の
// テスト (journal-cli・query-cli・accounts-cli) にある。ここは全部の文書を横に見る。

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseAccountsArgs } from "../server/accounts-cli";
import { parseAnnotateArgs } from "../server/annotate-cli";
import { parseDoctorCliArgs } from "../server/doctor-cli";
import { parseFileArgs } from "../server/file-cli";
import { parseJournalArgs } from "../server/journal-cli";
import { parseQueryArgs } from "../server/query-cli";
import { parseSearchArgs } from "../server/search-cli";
import { parseShowArgs } from "../server/show-cli";
import { parseSkillArgs } from "../server/skill-cli";
import { parseStatusArgs } from "../server/status-cli";
import { parseTerminalArgs } from "../server/terminal-cli";
import { extractDocumentedSubcommandInvocations } from "./_documented-cli-fixture";

const REPO_ROOT = process.cwd();

const PARSERS: Record<string, (argv: string[]) => { ok: boolean }> = {
  accounts: parseAccountsArgs,
  annotate: parseAnnotateArgs,
  // doctor だけ結果の形が違う (kind)。失敗は kind が error。
  doctor: (argv) => ({ ok: parseDoctorCliArgs(argv).kind !== "error" }),
  file: parseFileArgs,
  journal: parseJournalArgs,
  query: parseQueryArgs,
  search: parseSearchArgs,
  show: parseShowArgs,
  skill: parseSkillArgs,
  status: parseStatusArgs,
  terminal: parseTerminalArgs,
};

const DOCUMENTS = [
  ...readdirSync(join(REPO_ROOT, "skills")).map((name) =>
    join("skills", name, "SKILL.md"),
  ),
  "README.md",
  "README_ja.md",
];

describe("documented code-viewer examples parse", () => {
  test.each(DOCUMENTS)("%s", (document) => {
    const text = readFileSync(join(REPO_ROOT, document), "utf8");
    const failures: string[] = [];
    for (const [subcommand, parse] of Object.entries(PARSERS)) {
      for (const argv of extractDocumentedSubcommandInvocations(
        text,
        subcommand,
      )) {
        if (!parse(argv).ok)
          failures.push(`code-viewer ${subcommand} ${argv.join(" ")}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("the documents do have examples to check", () => {
    const count = DOCUMENTS.flatMap((document) => {
      const text = readFileSync(join(REPO_ROOT, document), "utf8");
      return Object.keys(PARSERS).flatMap((subcommand) =>
        extractDocumentedSubcommandInvocations(text, subcommand),
      );
    }).length;
    expect(count).toBeGreaterThan(20);
  });
});
