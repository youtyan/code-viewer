// /_agent/hooks* の入口と、申告に添えられる種類 (agent)。
//
// 設定ディレクトリと状態ディレクトリは環境変数で一時ディレクトリへ向ける
// (CLAUDE_CONFIG_DIR / CODEX_HOME / CODE_VIEWER_TEST_STATE_DIR)。利用者の
// ~/.claude や ~/.codex は読みも書きもしない。

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type {
  AgentHookApplyResponse,
  AgentHookPlanResponse,
  AgentHooksResponse,
} from "../core/agent-hooks";
import {
  clearAgentStates,
  getAgentState,
} from "../server/terminal/agent-state";
import { handleAgentRoute } from "../server/terminal/handle";
import { callRoute, postRoute } from "./_test-helpers";

const ENV_KEYS = [
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "CODE_VIEWER_TEST_STATE_DIR",
] as const;
const saved = new Map<string, string | undefined>();
let root: string;
let claudeDir: string;
let codexDir: string;

const call = (
  path: string,
  init?: RequestInit,
  sideEffectAllowed?: (req: Request) => boolean,
) => callRoute(handleAgentRoute, path, init, sideEffectAllowed);
const post = (
  path: string,
  body: unknown,
  sideEffectAllowed?: (req: Request) => boolean,
) => postRoute(handleAgentRoute, path, body, sideEffectAllowed);

beforeAll(() => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  clearAgentStates();
  root = mkdtempSync(join(tmpdir(), "cv-hooks-route-"));
  claudeDir = join(root, "claude");
  codexDir = join(root, "codex");
  mkdirSync(claudeDir);
  mkdirSync(codexDir);
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  process.env.CODEX_HOME = codexDir;
  process.env.CODE_VIEWER_TEST_STATE_DIR = join(root, "state");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 200 で返る GET を読む。 */
async function getOk<T>(path: string): Promise<T> {
  const res = await call(path);
  expect(res?.status).toBe(200);
  return (await res?.json()) as T;
}

const hooks = () => getOk<AgentHooksResponse>("/_agent/hooks");
const plan = (agent: string, action: string) =>
  getOk<AgentHookPlanResponse>(
    `/_agent/hooks/plan?agent=${agent}&action=${action}`,
  );

describe("state reports carry the agent kind", () => {
  test("keeps the reported kind, and marks the end of a session", async () => {
    await post("/_agent/state", {
      target: "%3",
      event: "ready",
      agent: "claude",
    });
    expect(getAgentState("%3")).toMatchObject({
      state: "idle",
      agent: "claude",
    });
    expect(getAgentState("%3")?.ended).toBeUndefined();
    await post("/_agent/state", { target: "%3", event: "stop" });
    expect(getAgentState("%3")).toMatchObject({
      state: "done",
      agent: "claude",
    });
    await post("/_agent/state", {
      target: "%3",
      event: "exit",
      agent: "claude",
    });
    expect(getAgentState("%3")).toMatchObject({ state: "idle", ended: true });
    await post("/_agent/state", {
      target: "%3",
      event: "ready",
      agent: "claude",
    });
    expect(getAgentState("%3")?.ended).toBeUndefined();
  });

  test.each([
    { agent: "gemini" },
    { agent: 1 },
    { agent: "" },
  ])("rejects an unknown agent ($agent)", async ({ agent }) => {
    const res = await post("/_agent/state", {
      target: "%3",
      event: "stop",
      agent,
    });
    expect(res?.status).toBe(400);
    expect(getAgentState("%3")).toBeNull();
  });

  test.each([
    { name: "missing", at: undefined, expected: 200 },
    { name: "zero", at: 0, expected: 200 },
    { name: "the current time", at: 1000, expected: 200 },
    { name: "one millisecond in the future", at: 1001, expected: 400 },
    { name: "negative", at: -1, expected: 400 },
    { name: "fractional", at: 999.5, expected: 400 },
    { name: "a string", at: "1000", expected: 400 },
    { name: "null", at: null, expected: 400 },
  ])("accepts only a valid event timestamp ($name)", async ({
    at,
    expected,
  }) => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    try {
      const res = await post("/_agent/state", {
        target: "%3",
        event: "stop",
        at,
      });
      expect(res?.status).toBe(expected);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("state-changing request bodies", () => {
  test.each([
    { name: "state without Content-Type", path: "/_agent/state" },
    { name: "unread without Content-Type", path: "/_agent/unread" },
    { name: "state as text/plain", path: "/_agent/state", type: "text/plain" },
    {
      name: "unread as text/plain",
      path: "/_agent/unread",
      type: "text/plain",
    },
  ])("rejects $name", async ({ path, type }) => {
    const res = await call(path, {
      method: "POST",
      headers: type ? { "Content-Type": type } : {},
      body: JSON.stringify({ target: "%3", event: "stop" }),
    });
    expect(res?.status).toBe(415);
  });

  // 申告は指示文と会話の場所 (conversation) を載せるので 32 KiB
  // (handle.ts の MAX_AGENT_STATE_BODY_BYTES)。
  test.each([
    { name: "one byte below the limit", bytes: 32_767, expected: 200 },
    { name: "exactly at the limit", bytes: 32_768, expected: 200 },
    { name: "one byte above the limit", bytes: 32_769, expected: 413 },
  ])("limits state JSON bodies ($name)", async ({ bytes, expected }) => {
    const prefix = '{"target":"%3","event":"stop","padding":"';
    const suffix = '"}';
    const body = `${prefix}${"x".repeat(bytes - prefix.length - suffix.length)}${suffix}`;
    const res = await post("/_agent/state", body);
    expect(res?.status).toBe(expected);
  });
});

describe("/_agent/hooks", () => {
  test("reports both agents against the configured directories", async () => {
    const body = await hooks();
    expect(body.agents.map((row) => [row.agent, row.state, row.path])).toEqual([
      ["claude", "none", join(claudeDir, "settings.json")],
      ["codex", "none", join(codexDir, "hooks.json")],
    ]);
    expect(body.launcher.state).toBe("missing");
    expect(body.failures).toMatchObject({ total: 0, recent: [] });
  });

  test("plan, apply, and remove through the routes", async () => {
    writeFileSync(
      join(claudeDir, "settings.json"),
      '{\n  "model": "sample"\n}\n',
    );
    const install = await plan("claude", "install");
    expect(install.changed).toBe(true);
    const applied = await post("/_agent/hooks/apply", {
      agent: "claude",
      action: "install",
      baseHash: install.baseHash,
      realPath: install.realPath,
      fileIdentity: install.fileIdentity,
    });
    expect(applied?.status).toBe(200);
    const result = (await applied?.json()) as AgentHookApplyResponse;
    expect(result.backupPath).toBe(install.backupPath);
    expect((await hooks()).agents[0]?.state).toBe("installed");

    const remove = await plan("claude", "uninstall");
    await post("/_agent/hooks/apply", {
      agent: "claude",
      action: "uninstall",
      baseHash: remove.baseHash,
      realPath: remove.realPath,
      fileIdentity: remove.fileIdentity,
    });
    expect(readFileSync(join(claudeDir, "settings.json"), "utf8")).toBe(
      '{\n  "model": "sample"\n}\n',
    );
  });

  test("a stale confirmation is refused with 409 and writes nothing", async () => {
    const install = await plan("codex", "install");
    writeFileSync(join(codexDir, "hooks.json"), "{}\n");
    const res = await post("/_agent/hooks/apply", {
      agent: "codex",
      action: "install",
      baseHash: install.baseHash,
      realPath: install.realPath,
      fileIdentity: install.fileIdentity,
    });
    expect(res?.status).toBe(409);
    const body = (await res?.json()) as { error: string; code: string };
    expect(body.code).toBe("conflict");
    // code は欄で 1 度だけ (文に Details として重ねない)。
    expect(body.error).not.toContain('"code":"conflict"');
    expect(readFileSync(join(codexDir, "hooks.json"), "utf8")).toBe("{}\n");
  });

  test("an unreadable file is reported with 422 on plan", async () => {
    writeFileSync(join(claudeDir, "settings.json"), '{"hooks": []}');
    const status = await hooks();
    expect(status.agents[0]).toMatchObject({ state: "unreadable" });
    const res = await call("/_agent/hooks/plan?agent=claude&action=install");
    expect(res?.status).toBe(422);
    expect(((await res?.json()) as { error: string }).error).toContain(
      "$.hooks: hooks must be an object",
    );
  });

  test.each([
    { query: "agent=gemini&action=install" },
    { query: "agent=claude&action=delete" },
    { query: "action=install" },
  ])("plan rejects $query", async ({ query }) => {
    const res = await call(`/_agent/hooks/plan?${query}`);
    expect(res?.status).toBe(400);
  });

  test.each([
    {
      name: "bad agent",
      body: { agent: "x", action: "install", baseHash: "0".repeat(64) },
    },
    {
      name: "bad action",
      body: { agent: "claude", action: "x", baseHash: "0".repeat(64) },
    },
    {
      name: "bad hash",
      body: { agent: "claude", action: "install", baseHash: "abc" },
    },
    {
      name: "bad resolved path",
      body: {
        agent: "claude",
        action: "install",
        baseHash: "0".repeat(64),
        realPath: "relative",
        fileIdentity: "missing",
      },
    },
    {
      name: "missing file identity",
      body: {
        agent: "claude",
        action: "install",
        baseHash: "0".repeat(64),
        realPath: "/tmp/sample-settings.json",
      },
    },
    { name: "not an object", body: "[]" },
  ])("apply rejects $name", async ({ body }) => {
    const res = await post("/_agent/hooks/apply", body);
    expect(res?.status).toBe(400);
    expect(existsSync(join(claudeDir, "settings.json"))).toBe(false);
  });

  test.each([
    { path: "/_agent/hooks/apply", method: "POST" },
    { path: "/_agent/hooks/failures", method: "DELETE" },
  ])("$method $path needs a same-origin action request", async ({
    path,
    method,
  }) => {
    const res = await call(
      path,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      },
      () => false,
    );
    expect(res?.status).toBe(403);
  });

  test("launcherOnly writes the launcher and leaves the settings file alone", async () => {
    writeFileSync(join(claudeDir, "settings.json"), "{}\n");
    const res = await post("/_agent/hooks/apply", {
      agent: "claude",
      action: "install",
      baseHash: "0".repeat(64),
      launcherOnly: true,
    });
    expect(res?.status).toBe(200);
    expect(await res?.json()).toMatchObject({
      changed: false,
      backupPath: null,
      launcherWritten: true,
    });
    expect(readFileSync(join(claudeDir, "settings.json"), "utf8")).toBe("{}\n");
    expect((await hooks()).launcher.state).toBe("ok");
  });

  test("apply rejects a non-boolean launcherOnly", async () => {
    const res = await post("/_agent/hooks/apply", {
      agent: "claude",
      action: "install",
      baseHash: "0".repeat(64),
      launcherOnly: "yes",
    });
    expect(res?.status).toBe(400);
  });

  test("clears the failure log", async () => {
    const state = join(root, "state", "agent-hooks");
    mkdirSync(state, { recursive: true });
    writeFileSync(
      join(state, "failures.jsonl"),
      `${JSON.stringify({ at: 1, agent: "claude", stage: "no-server", detail: "x" })}\n`,
    );
    expect((await hooks()).failures.total).toBe(1);
    const res = await call("/_agent/hooks/failures", { method: "DELETE" });
    expect(res?.status).toBe(200);
    expect((await hooks()).failures.total).toBe(0);
  });
});
