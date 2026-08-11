import { describe, expect, test } from "vitest";
import { DEFAULT_AGENT_SCREEN_RULES } from "../core/agent-screen";
import { handleAgentRoute } from "../server/terminal/handle";
import { resetAgentScreenRulesForTest } from "../server/terminal/rules";
import { withTempDir } from "./_test-helpers";

function request(
  root: string,
  method: "GET" | "PUT" | "DELETE",
  body?: unknown,
  sideEffectAllowed: (request: Request) => boolean = () => true,
): Promise<Response | null> {
  const url = new URL("http://127.0.0.1:0/_agent/rules");
  return handleAgentRoute(
    new Request(url, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
    url,
    root,
    sideEffectAllowed,
  );
}

describe("terminal screen rule route", () => {
  test("GET は未保存時の既定ルールを返す", async () => {
    await withTempDir("screen-rule-route-", async (root) => {
      resetAgentScreenRulesForTest();
      const response = await request(root, "GET");
      expect(response?.status).toBe(200);
      expect(await response?.json()).toEqual({
        rules: DEFAULT_AGENT_SCREEN_RULES,
        source: "default",
        errors: [],
        generation: 1,
      });
    });
  });

  test("PUT は全検証エラーを返し、設定を保存しない", async () => {
    await withTempDir("screen-rule-route-", async (root) => {
      resetAgentScreenRulesForTest();
      const response = await request(root, "PUT", {
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
      expect(response?.status).toBe(400);
      const body = (await response?.json()) as {
        errors: Array<{ code: string }>;
      };
      expect(body.errors.map((error) => error.code)).toEqual(
        expect.arrayContaining([
          "unsupported_version",
          "invalid_regex",
          "invalid_id",
          "invalid_state",
        ]),
      );
      const after = await request(root, "GET");
      expect((await after?.json()) as unknown).toEqual({
        rules: DEFAULT_AGENT_SCREEN_RULES,
        source: "default",
        errors: [],
        generation: 1,
      });
    });
  });

  test.each([
    { method: "PUT" as const, body: { version: 1, rules: [] } },
    { method: "DELETE" as const, body: undefined },
  ])("$method は副作用許可が無ければ拒否する", async ({ method, body }) => {
    await withTempDir("screen-rule-route-", async (root) => {
      const response = await request(root, method, body, () => false);
      expect(response?.status).toBe(403);
    });
  });

  test("保存と既定への復帰を往復できる", async () => {
    await withTempDir("screen-rule-route-", async (root) => {
      resetAgentScreenRulesForTest();
      const savedRules = { version: 1, rules: [] };
      const saved = await request(root, "PUT", savedRules);
      expect(saved?.status).toBe(200);
      const savedBody = (await saved?.json()) as {
        generation: number;
        rules: typeof savedRules;
        source: "saved";
        errors: unknown[];
      };
      expect(savedBody).toEqual({
        rules: savedRules,
        source: "saved",
        errors: [],
        generation: expect.any(Number),
      });
      const reset = await request(root, "DELETE");
      expect(reset?.status).toBe(200);
      const resetBody = (await reset?.json()) as {
        generation: number;
      };
      expect(resetBody).toEqual({
        rules: DEFAULT_AGENT_SCREEN_RULES,
        source: "default",
        errors: [],
        generation: expect.any(Number),
      });
      expect(resetBody.generation).toBeGreaterThan(savedBody.generation);
    });
  });
});
