import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_AGENT_SCREEN_RULES } from "../core/agent-screen";
import {
  agentScreenRulesFilePath,
  agentScreenRulesMigratedPath,
  getActiveAgentScreenRules,
  reloadAgentScreenRules,
  repoAgentScreenRulesFilePath,
  resetAgentScreenRules,
  resetAgentScreenRulesForTest,
  saveAgentScreenRules,
} from "../server/terminal/rules";

// 上書きはユーザー単位 (状態ディレクトリ)。テストごとに別の状態ディレクトリへ
// 向け、終わったら元の値に戻す (消すと実データの置き場所に戻る。agents.md 9)。
const previousStateDir = process.env.CODE_VIEWER_TEST_STATE_DIR;
let stateDir = "";
beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "screen-rules-state-"));
  process.env.CODE_VIEWER_TEST_STATE_DIR = stateDir;
});
afterEach(() => {
  resetAgentScreenRulesForTest();
  process.env.CODE_VIEWER_TEST_STATE_DIR = previousStateDir;
});

const SAMPLE_RULES = {
  version: 1,
  rules: [
    {
      id: "sample_wait",
      state: "waiting",
      priority: 20,
      region: "whole_recent",
      contains: ["sample question"],
    },
  ],
};

async function writeRepoRules(root: string, text: string): Promise<string> {
  const file = repoAgentScreenRulesFilePath(root);
  await mkdir(join(root, ".code-viewer"), { recursive: true });
  await writeFile(file, text, "utf8");
  return file;
}

describe("terminal screen rule persistence", () => {
  test("未保存なら既定ルールを使う", async () => {
    const root = await mkdtemp(join(tmpdir(), "screen-rules-"));
    await expect(reloadAgentScreenRules(root)).resolves.toEqual({
      rules: DEFAULT_AGENT_SCREEN_RULES,
      source: "default",
      errors: [],
      generation: 1,
    });
  });

  test("保存後すぐ有効化し、再読込できる", async () => {
    const root = await mkdtemp(join(tmpdir(), "screen-rules-"));
    const rules = SAMPLE_RULES;
    const saved = await saveAgentScreenRules(rules);
    expect(saved).toEqual({
      rules,
      source: "saved",
      errors: [],
      generation: 1,
    });
    expect(getActiveAgentScreenRules()).toEqual(rules);
    await expect(reloadAgentScreenRules(root)).resolves.toEqual({
      rules,
      source: "saved",
      errors: [],
      generation: 2,
    });
    expect(
      JSON.parse(await readFile(agentScreenRulesFilePath(), "utf8")),
    ).toEqual(rules);
  });

  test("不正な設定は全エラーを返し、既存ファイルと有効ルールを変えない", async () => {
    await saveAgentScreenRules({ version: 1, rules: [] });
    const before = await readFile(agentScreenRulesFilePath(), "utf8");
    const result = await saveAgentScreenRules({
      version: 2,
      rules: [
        {
          id: "Bad id",
          state: "unknown",
          priority: 1,
          region: "whole_recent",
          regex: ["("],
        },
      ],
    });
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        "unsupported_version",
        "invalid_regex",
        "invalid_id",
        "invalid_state",
      ]),
    );
    expect(await readFile(agentScreenRulesFilePath(), "utf8")).toBe(before);
    expect(getActiveAgentScreenRules()).toEqual({ version: 1, rules: [] });
  });

  test("壊れた保存ファイルを隠さず、既定ルールと検証エラーを返す", async () => {
    const root = await mkdtemp(join(tmpdir(), "screen-rules-"));
    const file = agentScreenRulesFilePath();
    await saveAgentScreenRules({ version: 1, rules: [] });
    await writeFile(file, "{broken", "utf8");
    const loaded = await reloadAgentScreenRules(root);
    expect(loaded.rules).toEqual(DEFAULT_AGENT_SCREEN_RULES);
    expect(loaded.source).toBe("default");
    expect(loaded.errors).toEqual([
      expect.objectContaining({ path: "$", code: "invalid_json" }),
    ]);
    await expect(readFile(file, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      (await readdir(stateDir)).filter((name) =>
        name.startsWith("agent-screen-rules.json.corrupt-"),
      ),
    ).toHaveLength(1);
  });

  test("既定に戻すと保存ファイルを削除し、将来の既定値に追従する", async () => {
    await saveAgentScreenRules({ version: 1, rules: [] });
    await expect(resetAgentScreenRules()).resolves.toEqual({
      rules: DEFAULT_AGENT_SCREEN_RULES,
      source: "default",
      errors: [],
      generation: 2,
    });
    await expect(
      readFile(agentScreenRulesFilePath(), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("moving the saved rules from the repository to the user", () => {
  test("the repository's rules are copied once and the repository file is left as it was", async () => {
    const root = await mkdtemp(join(tmpdir(), "screen-rules-"));
    const text = `${JSON.stringify(SAMPLE_RULES)}\n`;
    const repoFile = await writeRepoRules(root, text);
    await expect(reloadAgentScreenRules(root)).resolves.toMatchObject({
      rules: SAMPLE_RULES,
      source: "saved",
      errors: [],
    });
    expect(
      JSON.parse(await readFile(agentScreenRulesFilePath(), "utf8")),
    ).toEqual(SAMPLE_RULES);
    expect(await readFile(repoFile, "utf8")).toBe(text);
    expect(
      JSON.parse(await readFile(agentScreenRulesMigratedPath(), "utf8")),
    ).toMatchObject({ from: repoFile });
  });

  test("when both exist, the user's rules win", async () => {
    const root = await mkdtemp(join(tmpdir(), "screen-rules-"));
    await saveAgentScreenRules({ version: 1, rules: [] });
    await writeRepoRules(root, JSON.stringify(SAMPLE_RULES));
    await expect(reloadAgentScreenRules(root)).resolves.toMatchObject({
      rules: { version: 1, rules: [] },
      source: "saved",
    });
  });

  test("after going back to the defaults, the repository's old rules do not come back", async () => {
    const root = await mkdtemp(join(tmpdir(), "screen-rules-"));
    await writeRepoRules(root, JSON.stringify(SAMPLE_RULES));
    await reloadAgentScreenRules(root);
    await resetAgentScreenRules();
    await expect(reloadAgentScreenRules(root)).resolves.toMatchObject({
      rules: DEFAULT_AGENT_SCREEN_RULES,
      source: "default",
      errors: [],
    });
  });

  test("a broken repository file is reported, not moved and not renamed", async () => {
    const root = await mkdtemp(join(tmpdir(), "screen-rules-"));
    const repoFile = await writeRepoRules(root, "{broken");
    const loaded = await reloadAgentScreenRules(root);
    expect(loaded.source).toBe("default");
    expect(loaded.errors).toEqual([
      expect.objectContaining({ path: "$", code: "invalid_json" }),
    ]);
    expect(await readFile(repoFile, "utf8")).toBe("{broken");
    await expect(
      readFile(agentScreenRulesFilePath(), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
