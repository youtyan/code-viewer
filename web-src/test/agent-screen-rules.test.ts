import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_AGENT_SCREEN_RULES } from "../core/agent-screen";
import {
  agentScreenRulesFilePath,
  getActiveAgentScreenRules,
  reloadAgentScreenRules,
  resetAgentScreenRules,
  resetAgentScreenRulesForTest,
  saveAgentScreenRules,
} from "../server/terminal/rules";

afterEach(() => resetAgentScreenRulesForTest());

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
    const rules = {
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
    const saved = await saveAgentScreenRules(root, rules);
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
      JSON.parse(await readFile(agentScreenRulesFilePath(root), "utf8")),
    ).toEqual(rules);
  });

  test("不正な設定は全エラーを返し、既存ファイルと有効ルールを変えない", async () => {
    const root = await mkdtemp(join(tmpdir(), "screen-rules-"));
    await saveAgentScreenRules(root, { version: 1, rules: [] });
    const before = await readFile(agentScreenRulesFilePath(root), "utf8");
    const result = await saveAgentScreenRules(root, {
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
    expect(await readFile(agentScreenRulesFilePath(root), "utf8")).toBe(before);
    expect(getActiveAgentScreenRules()).toEqual({ version: 1, rules: [] });
  });

  test("壊れた保存ファイルを隠さず、既定ルールと検証エラーを返す", async () => {
    const root = await mkdtemp(join(tmpdir(), "screen-rules-"));
    const file = agentScreenRulesFilePath(root);
    await saveAgentScreenRules(root, { version: 1, rules: [] });
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
      (await readdir(join(root, ".code-viewer"))).filter((name) =>
        name.startsWith("agent-screen-rules.json.corrupt-"),
      ),
    ).toHaveLength(1);
  });

  test("既定に戻すと保存ファイルを削除し、将来の既定値に追従する", async () => {
    const root = await mkdtemp(join(tmpdir(), "screen-rules-"));
    await saveAgentScreenRules(root, { version: 1, rules: [] });
    await expect(resetAgentScreenRules(root)).resolves.toEqual({
      rules: DEFAULT_AGENT_SCREEN_RULES,
      source: "default",
      errors: [],
      generation: 2,
    });
    await expect(
      readFile(agentScreenRulesFilePath(root), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
