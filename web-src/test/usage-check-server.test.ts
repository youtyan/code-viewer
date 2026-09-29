import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  type AccountEntry,
  agentTmuxPanes,
  USAGE_CHECK_SESSION_PREFIX,
} from "../core/agent-accounts";
import { usageCheckFolder } from "../server/accounts/handle";
import { accountPaths } from "../server/accounts/registry";
import { createAccountService } from "../server/accounts/service";
import { createUsageChecker } from "../server/accounts/usage-check";
import {
  statusLineWrapperPath,
  wrappedCommand,
  writeStatusLineWrapper,
} from "../server/terminal/statusline";

const ACCOUNT: AccountEntry = {
  id: "sample",
  agent: "claude",
  name: "sample",
  configDir: "/sample/config",
  builtin: false,
  managed: true,
};
const START = 1_800_000_000_000;
const REPORT = {
  type: "assistant",
  usage_report: {
    rate_limits: {
      limits: [
        { kind: "session", percent: 12, resets_at: "2027-01-15T12:00:00Z" },
        { kind: "weekly_all", percent: 45, resets_at: "2027-01-20T00:00:00Z" },
      ],
    },
  },
};
const RESULT = {
  type: "result",
  local_command: "usage",
  subtype: "success",
  is_error: false,
  num_turns: 0,
  total_cost_usd: 0,
  duration_api_ms: 0,
};
function harness(lines: unknown[] = [REPORT, RESULT]) {
  const run = vi.fn(async () => ({
    code: 0,
    stdout: lines.map((line) => JSON.stringify(line)).join("\n"),
    stderr: "",
    failure: null,
  }));
  const rpc = vi.fn(async () => ({
    code: 0,
    lines: [
      JSON.stringify({
        id: 2,
        result: {
          rateLimits: {
            primary: {
              usedPercent: 17,
              windowDurationMins: 300,
              resetsAt: 1800010000,
            },
            secondary: null,
          },
        },
      }),
    ],
    stderr: "",
    timedOut: false,
    tooMuchOutput: false,
  }));
  const publish = vi.fn();
  const checker = createUsageChecker({
    run,
    rpc,
    publish,
    launchCommand: (a) => a.agent,
    now: () => START,
    env: { SHELL: "/bin/sh" },
  });
  return { checker, run, rpc, publish };
}

describe("token-free usage checks", () => {
  test("Claude reads structured limits without a model turn or status line", async () => {
    const { checker, run, publish } = harness();
    const result = await checker.check(ACCOUNT, "/sample/check");
    expect(result).toMatchObject({
      status: "ok",
      usage: {
        observedAt: START,
        windows: [
          {
            kind: "five_hour",
            minutes: 300,
            usedPercent: 12,
            resetsAt: 1800014400000,
          },
          {
            kind: "seven_day",
            minutes: 10080,
            usedPercent: 45,
            resetsAt: 1800403200000,
          },
        ],
      },
    });
    expect(run).toHaveBeenCalledWith(
      expect.arrayContaining([
        "--safe-mode",
        "--print",
        "/usage",
        "--output-format",
        "stream-json",
      ]),
      "/sample/check",
      expect.objectContaining({
        CLAUDE_CONFIG_DIR: "/sample/config",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
      }),
    );
    expect(publish).toHaveBeenCalledOnce();
  });
  test("Codex asks for rate limits without creating a thread", async () => {
    const { checker, rpc } = harness();
    const result = await checker.check(
      { ...ACCOUNT, agent: "codex" },
      "/sample/check",
    );
    expect(result).toMatchObject({
      status: "ok",
      usage: {
        windows: [
          { kind: "five_hour", usedPercent: 17, resetsAt: 1800010000000 },
        ],
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      expect.arrayContaining(["app-server"]),
      expect.objectContaining({ CODEX_HOME: "/sample/config" }),
      expect.arrayContaining(['{"id":2,"method":"account/rateLimits/read"}']),
      expect.any(Function),
      true,
    );
  });
  test.each([
    { name: "missing usage report", lines: [RESULT] },
    {
      name: "missing current limits",
      lines: [
        { type: "assistant", usage_report: { rate_limits: { limits: null } } },
        RESULT,
      ],
    },
    {
      name: "invalid percentage",
      lines: [
        {
          type: "assistant",
          usage_report: {
            rate_limits: {
              limits: [{ kind: "session", percent: "12", resets_at: null }],
            },
          },
        },
        RESULT,
      ],
    },
    {
      name: "unexpected model turn",
      lines: [REPORT, { ...RESULT, num_turns: 1 }],
    },
    {
      name: "command failure",
      lines: [
        REPORT,
        {
          ...RESULT,
          is_error: true,
          errors: [
            { code: "first" },
            { code: "second", details: { field: "sample" } },
          ],
        },
      ],
    },
  ])("$name fails and does not publish fresh data", async ({ lines }) => {
    const { checker, publish } = harness(lines);
    expect(await checker.check(ACCOUNT, "/sample/check")).toMatchObject({
      status: "failed",
      reason: "read-failed",
    });
    expect(publish).not.toHaveBeenCalled();
  });
  test("retains every RPC error field", async () => {
    const h = harness();
    h.rpc.mockResolvedValue({
      code: 0,
      lines: [
        '{"id":2,"error":{"code":-1,"message":"unavailable","data":{"errors":[{"code":"first"},{"code":"second","field":"sample"}]}}}',
      ],
      stderr: "",
      timedOut: false,
      tooMuchOutput: false,
    });
    const result = await h.checker.check(
      { ...ACCOUNT, agent: "codex" },
      "/sample/check",
    );
    expect(result).toMatchObject({
      status: "failed",
      detail: expect.stringContaining('"second"'),
    });
    expect(h.publish).not.toHaveBeenCalled();
  });
  test("joins duplicate checks and permits retry after a failure", async () => {
    const h = harness();
    let fail: (error: Error) => void = () => {
      throw new Error("not running");
    };
    h.run.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const a = h.checker.check(ACCOUNT, "/sample/check");
    const b = h.checker.check(ACCOUNT, "/sample/check");
    fail(new Error("sample process failed"));
    expect(await a).toMatchObject({
      status: "failed",
      joined: false,
      detail: expect.stringContaining("sample process failed"),
    });
    expect(await b).toMatchObject({ status: "failed", joined: true });
    expect(await h.checker.check(ACCOUNT, "/sample/check")).toMatchObject({
      status: "ok",
    });
    expect(h.run).toHaveBeenCalledTimes(2);
  });
});

describe("the wrapped status line used when launching an agent", () => {
  // 本物のファイルで: ユーザーの設定の statusLine の状態から、包むスクリプトに
  // 元のコマンドを渡した形を作る。包んでいない・包むスクリプトが無いなら null。
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  function setup(statusLine: unknown, wrapper: boolean) {
    const root = mkdtempSync(join(tmpdir(), "cv-usage-check-"));
    dirs.push(root);
    const home = join(root, "home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    const paths = accountPaths(
      { CODE_VIEWER_TEST_STATE_DIR: join(root, "state") },
      home,
    );
    if (wrapper) writeStatusLineWrapper(paths.usageDir);
    const wrapperPath = statusLineWrapperPath(paths.usageDir);
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify(
        statusLine === undefined
          ? {}
          : {
              statusLine: JSON.parse(
                JSON.stringify(statusLine).split("<wrapper>").join(wrapperPath),
              ),
            },
      ),
    );
    const service = createAccountService(paths);
    const entry = service
      .entries()
      .entries.find((item) => item.id === "claude:default");
    if (!entry) throw new Error("no default claude account");
    return { command: service.usage(entry).statusLineCommand, wrapperPath };
  }

  test.each([
    {
      name: "wrapped around the user's command",
      statusLine: {
        type: "command",
        command: "'<wrapper>' 'sample-statusline --short'",
      },
      wrapper: true,
      original: "sample-statusline --short",
    },
    {
      name: "only the wrapper (no command of the user's)",
      statusLine: { type: "command", command: "'<wrapper>'" },
      wrapper: true,
      original: null,
    },
    {
      name: "not wrapped",
      statusLine: { type: "command", command: "sample-statusline" },
      wrapper: true,
      original: undefined,
    },
    {
      name: "no status line",
      statusLine: undefined,
      wrapper: true,
      original: undefined,
    },
    {
      name: "wrapped, but the wrapper script is missing",
      statusLine: { type: "command", command: "'<wrapper>'" },
      wrapper: false,
      original: undefined,
    },
  ])("$name", ({ statusLine, wrapper, original }) => {
    const { command, wrapperPath } = setup(statusLine, wrapper);
    expect(command).toBe(
      original === undefined ? null : wrappedCommand(wrapperPath, original),
    );
  });
});

describe("the check's sessions are not agents", () => {
  // 一覧・件数・通知 (terminal/overview.ts) と巡回 (terminal/activity.ts) は
  // agentTmuxPanes を通したペインだけを見る。判定はセッション名の頭だけ。
  test.each([
    { session: `${USAGE_CHECK_SESSION_PREFIX}default-check`, shown: false },
    { session: `${USAGE_CHECK_SESSION_PREFIX}sample`, shown: false },
    { session: "sample-app", shown: true },
    { session: "code-viewer-login", shown: true },
    { session: "code-viewer-usages", shown: true },
    { session: `my-${USAGE_CHECK_SESSION_PREFIX}sample`, shown: true },
  ])("$session", ({ session, shown }) => {
    const pane = (id: string) => ({
      id,
      label: `${session}:0.0`,
      paneIndex: 0,
      title: "",
      command: "claude",
      path: "/work/sample-app",
      pid: 1,
      width: 80,
      height: 24,
      active: true,
      inRepo: true,
    });
    const sessions = [
      {
        name: "sample-other",
        attached: false,
        windows: [
          { index: 0, name: "main", active: true, panes: [pane("%1")] },
        ],
      },
      {
        name: session,
        attached: false,
        windows: [
          { index: 0, name: "main", active: true, panes: [pane("%2")] },
        ],
      },
    ];
    expect(agentTmuxPanes(sessions).map((item) => item.id)).toEqual(
      shown ? ["%1", "%2"] : ["%1"],
    );
  });
});

describe("usageCheckFolder", () => {
  // 見ているプロジェクトではなく確認専用のフォルダで起こす。どの画面で押しても
  // 同じ場所で、信頼の確認はアカウントごとに最初の 1 回だけで済む。
  test("is the dedicated folder under the state directory, created private", () => {
    const state = mkdtempSync(join(tmpdir(), "cv-usage-folder-"));
    try {
      const paths = accountPaths(
        { CODE_VIEWER_TEST_STATE_DIR: state },
        "/home/sample",
      );
      const folder = usageCheckFolder(paths);
      expect(folder).toBe(join(state, "usage-check"));
      expect(statSync(folder).isDirectory()).toBe(true);
      expect(statSync(folder).mode & 0o777).toBe(0o700);
      expect(usageCheckFolder(paths)).toBe(folder);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });
});
