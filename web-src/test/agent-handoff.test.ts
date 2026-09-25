// 「別のアカウントで続ける」のサーバ側。
//
// 1. フックの入力 (claude・codex の公式の共通欄 session_id・transcript_path・
//    cwd) から会話の場所を取り出し、申告に載せる
// 2. 申告を受けたサーバがペインの会話の場所として持ち (状態の記録とは別。
//    保存と読み戻しは agent-conversations.test.ts)、/_agent/overview のペインに
//    載せる (セッションが終われば外す)
// 3. 起動の経路 (/_agent/launch の handoff) が、次の担当に渡す最初の指示と
//    --add-dir を、send-keys ではなく起動の引数の配列で組む
//
// パス・名前はすべて架空。利用者の ~/.claude・~/.codex・状態ディレクトリは
// 読みも書きもしない (状態ディレクトリは CODE_VIEWER_TEST_STATE_DIR で逃がす)。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
} from "vitest";
import {
  handoffArgs,
  handoffPrompt,
  launchCommandLine,
  tmuxLaunchArgs,
} from "../core/agent-accounts";
import type { AgentHookFailure } from "../core/agent-hooks";
import type { AgentPane } from "../core/agent-overview";
import {
  conversationFromHookInput,
  MAX_CONVERSATION_FIELD,
} from "../core/agent-state";
import { agentCommandArgv } from "../server/accounts/launch";
import {
  clearAgentStates,
  getAgentConversation,
  getAgentState,
  listAgentStates,
  recordAgentState,
} from "../server/terminal/agent-state";
import { handleAgentRoute } from "../server/terminal/handle";
import {
  type HookReportDeps,
  reportAgentHook,
} from "../server/terminal/hook-report";
import {
  type AgentOverviewDeps,
  buildAgentOverview,
} from "../server/terminal/overview";
import { postRoute, tmuxPanes } from "./_test-helpers";

const CLAUDE_LOG =
  "/home/sample/.claude/projects/-work-sample-app/0b3c-sample.jsonl";
const CODEX_LOG =
  "/home/sample/.codex/sessions/2026/09/24/rollout-sample.jsonl";

// 公式の例の形 (https://code.claude.com/docs/en/hooks の共通欄、
// https://learn.chatgpt.com/docs/hooks の共通欄)。
const CLAUDE_PROMPT = {
  session_id: "abc123",
  transcript_path: CLAUDE_LOG,
  cwd: "/work/sample-app",
  permission_mode: "default",
  hook_event_name: "UserPromptSubmit",
  prompt: "sample request",
};
const CODEX_START = {
  session_id: "sample_thread",
  transcript_path: CODEX_LOG,
  cwd: "/work/sample-app",
  hook_event_name: "SessionStart",
  model: "sample-model",
  source: "startup",
};
const CODEX_START_WITHOUT_LOG = { ...CODEX_START, transcript_path: null };

describe("conversationFromHookInput", () => {
  test.each([
    {
      name: "claude の公式の形",
      input: CLAUDE_PROMPT,
      conversation: {
        sessionId: "abc123",
        transcriptPath: CLAUDE_LOG,
        cwd: "/work/sample-app",
      },
      rejected: [],
    },
    {
      name: "codex の公式の形",
      input: CODEX_START,
      conversation: {
        sessionId: "sample_thread",
        transcriptPath: CODEX_LOG,
        cwd: "/work/sample-app",
      },
      rejected: [],
    },
    {
      name: "codex の transcript_path が null (公式: string | null)",
      input: CODEX_START_WITHOUT_LOG,
      conversation: {
        sessionId: "sample_thread",
        transcriptPath: "",
        cwd: "/work/sample-app",
      },
      rejected: [],
    },
    {
      name: "3 つとも無い",
      input: { hook_event_name: "Stop" },
      conversation: null,
      rejected: [],
    },
    {
      name: "相対パスは受け取らない",
      input: { ...CLAUDE_PROMPT, transcript_path: "sample.jsonl" },
      conversation: {
        sessionId: "abc123",
        transcriptPath: "",
        cwd: "/work/sample-app",
      },
      rejected: ["transcriptPath"],
    },
    {
      name: "制御文字・文字列でない値・長すぎる値",
      input: {
        session_id: 42,
        transcript_path: "/home/sample/a\nb.jsonl",
        cwd: `/${"x".repeat(MAX_CONVERSATION_FIELD)}`,
      },
      conversation: null,
      rejected: ["sessionId", "transcriptPath", "cwd"],
    },
  ])("$name", ({ input, conversation, rejected }) => {
    expect(conversationFromHookInput(input)).toEqual({
      conversation,
      rejected,
    });
  });
});

function hookDeps(env: Record<string, string>): {
  deps: HookReportDeps;
  posted: Record<string, unknown>[];
  failures: AgentHookFailure[];
} {
  const posted: Record<string, unknown>[] = [];
  const failures: AgentHookFailure[] = [];
  return {
    posted,
    failures,
    deps: {
      now: () => 1_000,
      env,
      listServers: () => ({ servers: [], errors: [] }),
      entryRecord: () => ({
        url: "http://127.0.0.1:1/",
        pid: process.pid,
        token: "0123456789abcdef",
        version: "0.0.0",
        started_at: "2026-01-01T00:00:00.000Z",
      }),
      verifyIdentity: async () => ({ status: "ok" }),
      post: async (_url, body) => {
        posted.push(body as Record<string, unknown>);
        return new Response("{}", { status: 200 });
      },
      recordFailure: (failure) => failures.push(failure),
    },
  };
}

describe("reportAgentHook の会話の場所", () => {
  test.each([
    {
      agent: "claude" as const,
      input: CLAUDE_PROMPT,
      conversation: {
        sessionId: "abc123",
        transcriptPath: CLAUDE_LOG,
        cwd: "/work/sample-app",
      },
    },
    {
      agent: "codex" as const,
      input: CODEX_START,
      conversation: {
        sessionId: "sample_thread",
        transcriptPath: CODEX_LOG,
        cwd: "/work/sample-app",
      },
    },
  ])("$agent の公式の入力から申告に載せる", async ({
    agent,
    input,
    conversation,
  }) => {
    const { deps, posted, failures } = hookDeps({ TMUX_PANE: "%7" });
    const outcome = await reportAgentHook(agent, JSON.stringify(input), deps);
    expect([outcome.kind, posted[0]?.conversation, failures]).toEqual([
      "reported",
      conversation,
      [],
    ]);
  });

  test("受け取れない欄は空にして申告は届け、欄の名前を失敗の記録に残す", async () => {
    const { deps, posted, failures } = hookDeps({ TMUX_PANE: "%7" });
    const outcome = await reportAgentHook(
      "claude",
      JSON.stringify({ ...CLAUDE_PROMPT, transcript_path: "relative.jsonl" }),
      deps,
    );
    expect(outcome.kind).toBe("reported");
    expect(posted[0]?.conversation).toEqual({
      sessionId: "abc123",
      transcriptPath: "",
      cwd: "/work/sample-app",
    });
    expect(failures.map((item) => [item.stage, item.target])).toEqual([
      ["input", "%7"],
    ]);
    expect(failures[0]?.detail).toContain(": transcriptPath");
    // 値 (パス) は記録に載せない
    expect(failures[0]?.detail).not.toContain("relative.jsonl");
  });
});

function overviewDeps(ids: string[]): AgentOverviewDeps {
  return {
    serverInstance: "sample-instance",
    home: "/home/sample",
    serverRoot: "/work/sample-app",
    listPanes: async () =>
      tmuxPanes(ids, { command: "claude", path: "/work/sample-app" }),
    listStates: listAgentStates,
    conversationOf: getAgentConversation,
    activityObservedAt: () => 0,
    observationErrors: () => [],
    listShells: () => [],
    listClients: async () => ({ status: "ok", clients: [] }),
    firstListed: new Map(),
    resolveProject: async () => ({
      kind: "root",
      root: "/work/sample-app",
      toplevel: "/work/sample-app",
    }),
    findServer: async () => ({ status: "absent" }),
    paneAccounts: async () => new Map(),
    readRegistry: () => ({ projects: [], error: "", path: "/x.json" }),
    rootExists: () => true,
    forgetServer: () => undefined,
    now: () => 5_000,
  };
}

const conversationOf = async (id: string) =>
  (await buildAgentOverview(overviewDeps([id]))).panes[0]?.conversation;

const post = (path: string, body: unknown) =>
  postRoute(handleAgentRoute, path, body);

describe("申告の会話の場所 → 状態の記録 → overview", () => {
  beforeEach(() => clearAgentStates());
  afterEach(() => clearAgentStates());

  const conversation = {
    sessionId: "abc123",
    transcriptPath: CLAUDE_LOG,
    cwd: "/work/sample-app",
  };

  test("申告で受け取り、画面の観測を挟んでも残り、overview のペインに載る", async () => {
    const res = await post("/_agent/state", {
      target: "%3",
      event: "prompt",
      agent: "claude",
      conversation,
    });
    expect(res?.status).toBe(200);
    recordAgentState({
      target: "%3",
      state: "idle",
      source: "screen",
      override: true,
    });
    expect(getAgentConversation("%3")?.conversation).toEqual(conversation);
    expect(await conversationOf("%3")).toEqual(conversation);
  });

  test("会話の場所の無い申告 (read など) は前の値を残す", async () => {
    await post("/_agent/state", {
      target: "%3",
      event: "stop",
      agent: "claude",
      conversation,
    });
    await post("/_agent/state", { target: "%3", event: "read" });
    expect(await conversationOf("%3")).toEqual(conversation);
  });

  test("セッションの終わり (exit) で外し、overview にも載せない", async () => {
    await post("/_agent/state", {
      target: "%3",
      event: "stop",
      agent: "claude",
      conversation,
    });
    await post("/_agent/state", { target: "%3", event: "exit" });
    expect([getAgentConversation("%3"), await conversationOf("%3")]).toEqual([
      null,
      undefined,
    ]);
  });

  test("フックの申告が無いペインには欄が無い", async () => {
    expect(await conversationOf("%9")).toBeUndefined();
  });

  test.each([
    { name: "文字列でない", value: "abc123" },
    { name: "欄が足りない", value: { sessionId: "abc123", cwd: "/work" } },
    {
      name: "相対パス",
      value: { ...conversation, transcriptPath: "sample.jsonl" },
    },
    {
      name: "制御文字",
      value: { ...conversation, cwd: "/work/sample\u0007app" },
    },
  ])("受け取れない会話の場所は 400 で断り、状態も変えない ($name)", async ({
    value,
  }) => {
    const res = await post("/_agent/state", {
      target: "%3",
      event: "prompt",
      conversation: value,
    });
    expect([res?.status, await res?.text(), getAgentState("%3")]).toEqual([
      400,
      "invalid conversation",
      null,
    ]);
  });
});

describe("引き継ぎの起動の引数", () => {
  const prompt = handoffPrompt("en", {
    agent: "claude",
    account: "Work",
    transcriptPath: CLAUDE_LOG,
  });

  test("指示文は前の担当の種類・アカウント名・記録の場所を含む (英日)", () => {
    expect(prompt).toBe(
      `Take over the work of the previous agent (claude · Work). Its conversation log is at ${CLAUDE_LOG} (JSONL). Read the last request and how far it got, then continue the work. If anything is unclear, ask before you start.`,
    );
    expect(
      handoffPrompt("ja", {
        agent: "codex",
        account: "既定",
        transcriptPath: CODEX_LOG,
      }),
    ).toBe(
      `前の担当（codex・既定）の作業を引き継いでください。前の担当の会話記録は ${CODEX_LOG}（JSONL）にあります。最後の依頼と、どこまで進んだかを読んで、続きをやってください。わからないことは、作業を始める前に聞いてください。`,
    );
  });

  test.each([
    {
      agent: "claude" as const,
      // 指示を先に置く (--add-dir は値を複数とる)
      args: [
        "PROMPT",
        "--add-dir",
        "/home/sample/.claude/projects/-work-sample-app",
      ],
    },
    // codex の --add-dir は書き込みの許可なので付けない
    { agent: "codex" as const, args: ["PROMPT"] },
  ])("$agent に足す引数", ({ agent, args }) => {
    expect(handoffArgs(agent, "PROMPT", CLAUDE_LOG)).toEqual(args);
  });

  test("tmux の起動の配列: env でアカウントを渡し、指示は 1 つの引数のまま (send-keys を使わない)", () => {
    const argv = agentCommandArgv(
      "claude",
      handoffArgs("claude", prompt, CLAUDE_LOG),
      { SHELL: "/bin/zsh" },
    );
    const args = tmuxLaunchArgs({
      agent: "claude",
      configDir: "/home/sample/.local/state/code-viewer/accounts/claude-work",
      cwd: "/work/sample-app",
      session: "sample-session",
      sessionExists: true,
      windowName: "claude-Work",
      argv,
    });
    expect(args).toEqual([
      "new-window",
      "-t",
      "=sample-session:",
      "-n",
      "claude-Work",
      "-P",
      "-F",
      "#{pane_id}",
      "-c",
      "/work/sample-app",
      "--",
      "env",
      "CLAUDE_CONFIG_DIR=/home/sample/.local/state/code-viewer/accounts/claude-work",
      "/bin/zsh",
      "-i",
      "-c",
      'claude "$@"',
      "/bin/zsh",
      prompt,
      "--add-dir",
      "/home/sample/.claude/projects/-work-sample-app",
    ]);
    expect(args).not.toContain("send-keys");
  });

  test("画面に見せるコマンドにも同じ引数を引用して出す", () => {
    expect(
      launchCommandLine("codex", null, "codex", "/home/sample", ["it's done"]),
    ).toBe(`codex 'it'\\''s done'`);
  });
});

describe("/_agent/launch の handoff を断る", () => {
  const ENV = "CODE_VIEWER_TEST_STATE_DIR";
  let saved: string | undefined;
  let root = "";
  let project = "";
  let logDir = "";

  beforeAll(() => {
    saved = process.env[ENV];
  });
  afterAll(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });
  beforeEach(() => {
    clearAgentStates();
    root = mkdtempSync(join(tmpdir(), "cv-handoff-"));
    process.env[ENV] = join(root, "state");
    project = join(root, "sample-app");
    logDir = join(root, "logs");
    mkdirSync(project);
    mkdirSync(logDir);
    writeFileSync(join(logDir, "sample.jsonl"), "");
  });
  afterEach(() => {
    clearAgentStates();
    rmSync(root, { recursive: true, force: true });
  });

  const launch = (handoff: unknown) =>
    post("/_agent/launch", {
      accountId: "claude:default",
      project,
      session: "sample-session",
      handoff,
    });

  const reported = (transcriptPath: string) =>
    recordAgentState({
      target: "%5",
      event: "prompt",
      source: "hook",
      agent: "claude",
      conversation: { sessionId: "abc123", transcriptPath, cwd: project },
    });

  test.each([
    {
      name: "フックの申告が無いペイン",
      setup: () => undefined,
      handoff: { pane: "%5", language: "en", fromAccount: "Default" },
      status: 409,
      error: "has no conversation log reported by a hook",
    },
    {
      name: "記録のフォルダが無い",
      setup: () => reported("/nowhere/sample/sample.jsonl"),
      handoff: { pane: "%5", language: "ja", fromAccount: "既定" },
      status: 422,
      error: "cannot open the folder of the conversation log of %5",
    },
    {
      name: "言語が違う",
      setup: () => reported("/nowhere/sample.jsonl"),
      handoff: { pane: "%5", language: "fr", fromAccount: "Default" },
      status: 400,
      error: "invalid handoff language",
    },
    {
      name: "ペインでない",
      setup: () => undefined,
      handoff: { pane: "sample", language: "en", fromAccount: "Default" },
      status: 400,
      error: "invalid handoff pane",
    },
    {
      name: "アカウント名に制御文字",
      setup: () => undefined,
      handoff: { pane: "%5", language: "en", fromAccount: "a\u0007b" },
      status: 400,
      error: "invalid handoff account name",
    },
  ])("$name", async ({ setup, handoff, status, error }) => {
    setup();
    const res = await launch(handoff);
    const body = (await res?.json()) as { error: string };
    expect(res?.status).toBe(status);
    expect(body.error).toContain(error);
  });
});

// 型の上で AgentPane が conversation を持てること (古い版のサーバは持たない)。
const _legacyPane: Omit<AgentPane, "conversation"> | null = null;
void _legacyPane;
