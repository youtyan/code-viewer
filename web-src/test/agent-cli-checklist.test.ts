import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// claude / codex の版が変わったときの点検表 (.agents/skills/project-agent-cli-upgrade)
// が、今のコードの場所を指しているか。名前を変えたのに点検表を直さないと、版が
// 上がったときに確かめる所を見失う。
const SKILL_DIR = ".agents/skills/project-agent-cli-upgrade";
const CHECKLIST = readFileSync(`${SKILL_DIR}/references/checklist.md`, "utf8");
const DOCUMENTS = [CHECKLIST, readFileSync(`${SKILL_DIR}/SKILL.md`, "utf8")];

/**
 * `` `web-src/a.ts` `` と `` `web-src/a.ts#名前` `` の参照。`…` を含むものは
 * 書き方の例なので数えない。
 */
const references = DOCUMENTS.flatMap((text) =>
  [...text.matchAll(/`(web-src\/[^`#\s…]+)(?:#([A-Za-z_$][\w$]*))?`/g)].map(
    ([, path, name]) => ({ path, name }),
  ),
);
const paths = [...new Set(references.map((reference) => reference.path))];
const names = [
  ...new Map(
    references
      .filter((reference) => reference.name !== undefined)
      .map((reference) => [`${reference.path}#${reference.name}`, reference]),
  ).values(),
];

/** 点検表の行 (`| H1 |` のように ID で始まる表の行)。 */
const rows = CHECKLIST.split("\n").filter((line) =>
  /^\| [A-Z]\d+ \|/.test(line),
);

describe("the agent CLI upgrade checklist", () => {
  test("lists checked items and points at code", () => {
    expect([rows.length > 0, names.length > 0]).toEqual([true, true]);
  });

  test.each(paths)("%s exists", (path) => {
    expect(existsSync(path)).toBe(true);
  });

  test.each(names)("$path declares or uses $name", ({ path, name }) => {
    const word = new RegExp(
      `(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`,
    );
    expect(word.test(readFileSync(path, "utf8"))).toBe(true);
  });

  test.each(rows)("names where the code relies on it: %s", (row) => {
    expect(row).toMatch(/`web-src\/[^`#\s]+#[A-Za-z_$][\w$]*`/);
  });
});
