// 「使用量を確かめる」のサーバの部品 (server/accounts/usage-check.ts)。
// tmux・claude・プロセスへの信号は全部差し替える (本物の tmux のセッションも
// claude も起こさない)。偽の tmux は受け取った引数を記録し、画面と使用量は
// 手順ごとに決めた値を返す。時計は偽物で、眠ると進む。

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  type AccountEntry,
  type AccountUsage,
  agentTmuxPanes,
  USAGE_CHECK_SESSION_PREFIX,
} from "../core/agent-accounts";
import { usageCheckFolder } from "../server/accounts/handle";
import { AccountError, accountPaths } from "../server/accounts/registry";
import { createAccountService } from "../server/accounts/service";
import {
  CLAUDE_BLOCKING_SCREENS,
  classifyUsageCheckScreen,
  createUsageChecker,
  USAGE_CHECK_MODEL,
  USAGE_CHECK_PROMPT,
  USAGE_CHECK_TIMEOUT_MS,
  usageCheckSessionName,
} from "../server/accounts/usage-check";
import {
  statusLineWrapperPath,
  wrappedCommand,
  writeStatusLineWrapper,
} from "../server/terminal/statusline";
import type { TmuxRunResult } from "../server/tmux/command";

const START = 1_800_000_000_000;
const PANE = "%7";
const PID = 4242;

const ACCOUNT: AccountEntry = {
  id: "5d2c8a4e-0000-4000-8000-000000000001",
  agent: "claude",
  name: "sample",
  configDir: "/home/sample/.local/state/code-viewer/accounts/claude-sample",
  builtin: false,
  managed: true,
};

/** 包んだ statusLine のコマンド (包むスクリプト + 元のコマンド)。 */
const WRAPPED =
  "/home/sample/.local/state/code-viewer/agent-usage/code-viewer-statusline 'sample-statusline --flag \"x\"'";

const NO_DATA: AccountUsage = {
  status: "unavailable",
  reason: "no-data",
  detail: "",
  observedAt: 0,
};

type Scenario = {
  wrapped?: boolean;
  /** capture-pane が返す画面 (呼ばれた順。尽きたら最後のもの)。 */
  screens?: readonly string[];
  /** 使用量が新しい値になる時刻 (START からの ms)。無ければ届かない。 */
  usageAfterMs?: number;
  /** new-session の結果を差し替える。 */
  newSession?: TmuxRunResult;
  /** 信号を送ってもセッションが残る。 */
  stuck?: boolean;
};

function harness(scenario: Scenario) {
  let now = START;
  const calls: string[][] = [];
  const signals: Array<{ pid: number; signal: string }> = [];
  let open = false;
  let screen = 0;
  const usageAt = (): AccountUsage =>
    scenario.usageAfterMs !== undefined && now >= START + scenario.usageAfterMs
      ? {
          status: "ok",
          windows: [
            { kind: "five_hour", minutes: 300, usedPercent: 12, resetsAt: 0 },
          ],
          observedAt: START + scenario.usageAfterMs,
        }
      : NO_DATA;
  const checker = createUsageChecker({
    async runTmux(args) {
      calls.push(args);
      const [command] = args;
      if (command === "new-session") {
        const result = scenario.newSession ?? {
          status: "ok",
          stdout: `${PANE}\n`,
        };
        if (result.status === "ok") open = true;
        return result;
      }
      if (command === "display-message") {
        return { status: "ok", stdout: `${PID}\n` };
      }
      if (command === "set-option") return { status: "ok", stdout: "" };
      if (command === "capture-pane") {
        const screens = scenario.screens ?? [""];
        const text = screens[Math.min(screen, screens.length - 1)] ?? "";
        screen += 1;
        return { status: "ok", stdout: text };
      }
      if (command === "has-session") {
        return open ? { status: "ok", stdout: "" } : { status: "no-target" };
      }
      throw new Error(`unexpected tmux command: ${args.join(" ")}`);
    },
    usage: () => ({
      usage: usageAt(),
      statusLineCommand: (scenario.wrapped ?? true) ? WRAPPED : null,
    }),
    launchCommand: () => "sample-claude",
    signalGroup(pid, signal) {
      signals.push({ pid, signal });
      if (!scenario.stuck) open = false;
    },
    now: () => now,
    async sleep(ms) {
      now += ms;
    },
    env: { SHELL: "/bin/sh" },
  });
  return {
    checker,
    calls,
    signals,
    commands: () => calls.map((args) => args[0]),
    isOpen: () => open,
  };
}

const TRUST_SCREEN = [
  "╭──────────────────────────────────────────╮",
  "│ Accessing workspace:                     │",
  "│ /home/sample/work/sample-app             │",
  "│ Quick safety check: Is this a project    │",
  "│ you created or one you trust?            │",
  "│ ❯ 1. Yes, I trust this folder            │",
  "│   2. No, exit                            │",
  "╰──────────────────────────────────────────╯",
].join("\n");

describe("checking the usage", () => {
  test.each([
    {
      name: "the status line is not wrapped",
      scenario: { wrapped: false },
      status: "failed",
      reason: "not-wrapped",
      created: false,
    },
    {
      name: "the first-run screen (theme)",
      scenario: {
        screens: [
          "",
          " Let's get started.\n\n Choose the text style that looks best with your\n terminal\n ❯ 1. Dark mode",
        ],
      },
      status: "failed",
      reason: "onboarding",
      created: true,
    },
    {
      name: "the folder trust question",
      scenario: { screens: [TRUST_SCREEN] },
      status: "failed",
      reason: "trust",
      created: true,
    },
    {
      name: "the sign-in screen",
      scenario: {
        screens: [
          " Select login method:\n ❯ 1. Claude account with subscription",
        ],
      },
      status: "failed",
      reason: "login",
      created: true,
    },
    {
      name: "a signed-out footer",
      scenario: {
        screens: [" > Reply with just: ok\n Not logged in · Run /login"],
      },
      status: "failed",
      reason: "login",
      created: true,
    },
    {
      name: "claude exits (the launch command fails)",
      scenario: {
        screens: [
          "sh: sample-claude: not found\n\n[code-viewer] usage check: claude exited with 127\n",
        ],
      },
      status: "failed",
      reason: "start-failed",
      created: true,
    },
    {
      name: "tmux cannot start the session",
      scenario: {
        newSession: {
          status: "error",
          error: new Error("tmux exited with 1\nstderr: sample failure"),
        },
      },
      status: "failed",
      reason: "start-failed",
      created: false,
    },
    {
      name: "nothing arrives in time",
      scenario: { screens: [" > Reply with just: ok\n ✻ Thinking…"] },
      status: "failed",
      reason: "timeout",
      created: true,
    },
    {
      name: "the usage arrives",
      scenario: { usageAfterMs: 4000, screens: [" > Reply with just: ok"] },
      status: "ok",
      reason: null,
      created: true,
    },
  ] as const)("$name", async ({ scenario, status, reason, created }) => {
    const h = harness(scenario);
    const out = await h.checker.check(ACCOUNT, "/home/sample/work/sample-app");
    expect(out.status).toBe(status);
    expect(out.status === "failed" ? out.reason : null).toBe(reason);
    expect(out.closeError).toBe("");
    expect(out.joined).toBe(false);
    if (!created) {
      // 起こしていないものは閉じない (信号を送らない)。
      expect(h.signals).toEqual([]);
      expect(h.commands()).not.toContain("has-session");
      return;
    }
    const session = usageCheckSessionName(ACCOUNT.id, START);
    expect(out.session).toBe(session);
    // 作ったセッションは、どう終わっても閉じた: 信号は自分のペインの pid だけ。
    expect(h.signals).toEqual([{ pid: PID, signal: "SIGHUP" }]);
    expect(h.isOpen()).toBe(false);
    const checks = h.calls.filter((args) => args[0] === "has-session");
    expect(checks[checks.length - 1]).toEqual([
      "has-session",
      "-t",
      `=${session}`,
    ]);
    // tmux に何かを終了させる命令は使わない (ペインのプロセスを止めるだけ)。
    expect(
      h.commands().filter((command) => /^kill-/.test(command ?? "")),
    ).toEqual([]);
  });

  test("evidence and details say why it stopped", async () => {
    const timeout = await harness({
      screens: ["line one\n\n > Reply with just: ok\n ✻ Thinking…\n"],
    }).checker.check(ACCOUNT, "/home/sample/work/sample-app");
    expect(timeout).toMatchObject({
      status: "failed",
      reason: "timeout",
      evidence: ["line one", " > Reply with just: ok", " ✻ Thinking…"],
    });
    expect(timeout.status === "failed" && timeout.detail).toBe(
      `no new usage arrived within ${USAGE_CHECK_TIMEOUT_MS / 1000}s\nlatest saved usage: unavailable (no-data), observed at never`,
    );
    expect(timeout.finishedAt - timeout.startedAt).toBeGreaterThanOrEqual(
      USAGE_CHECK_TIMEOUT_MS,
    );

    const failed = await harness({
      newSession: {
        status: "error",
        error: new Error("tmux exited with 1\nstderr: sample failure"),
      },
    }).checker.check(ACCOUNT, "/home/sample/work/sample-app");
    // 元のエラーの全文 (stderr まで) を 1 行に丸めずに返す。
    expect(failed.status === "failed" && failed.detail).toContain(
      "stderr: sample failure",
    );
  });

  test("starts the launch command with the account's environment, haiku and one short prompt", async () => {
    const h = harness({ usageAfterMs: 0 });
    await h.checker.check(ACCOUNT, "/home/sample/work/sample-app");
    const start = h.calls.find((args) => args[0] === "new-session") ?? [];
    const session = usageCheckSessionName(ACCOUNT.id, START);
    expect(start.slice(0, start.indexOf("--"))).toEqual([
      "new-session",
      "-d",
      "-s",
      session,
      "-n",
      "usage-check",
      "-P",
      "-F",
      "#{pane_id}",
      "-c",
      "/home/sample/work/sample-app",
    ]);
    const argv = start.slice(start.indexOf("--") + 1);
    expect(argv.slice(0, 5)).toEqual([
      "env",
      `CLAUDE_CONFIG_DIR=${ACCOUNT.configDir}`,
      "/bin/sh",
      "-i",
      "-c",
    ]);
    expect(argv[5]).toMatch(/^sample-claude "\$@"; rc=\$\?; /);
    // 包んだ statusLine を --settings で渡す (プロジェクトの statusLine より
    // 優先される)。引数は "$@" で渡るので、引用符を含むコマンドもそのまま。
    expect(argv.slice(6)).toEqual([
      "/bin/sh",
      "--settings",
      JSON.stringify({ statusLine: { type: "command", command: WRAPPED } }),
      "--model",
      USAGE_CHECK_MODEL,
      USAGE_CHECK_PROMPT,
    ]);
    expect(JSON.parse(argv[8] ?? "")).toEqual({
      statusLine: { type: "command", command: WRAPPED },
    });
    // このペインだけ remain-on-exit を外す (シェルが終われば閉じる)。
    expect(h.calls).toContainEqual([
      "set-option",
      "-p",
      "-t",
      PANE,
      "remain-on-exit",
      "off",
    ]);
  });

  test("the default account unsets the variable", async () => {
    const h = harness({ usageAfterMs: 0 });
    await h.checker.check(
      { ...ACCOUNT, id: "claude:default", builtin: true, managed: false },
      "/home/sample/work/sample-app",
    );
    const start = h.calls.find((args) => args[0] === "new-session") ?? [];
    const argv = start.slice(start.indexOf("--") + 1);
    expect(argv.slice(0, 3)).toEqual(["env", "-u", "CLAUDE_CONFIG_DIR"]);
  });

  test("a second press while one runs waits for it instead of starting another", async () => {
    const h = harness({ usageAfterMs: 3000 });
    const [first, second] = await Promise.all([
      h.checker.check(ACCOUNT, "/home/sample/work/sample-app"),
      h.checker.check(ACCOUNT, "/home/sample/work/sample-app"),
    ]);
    expect(
      h.commands().filter((command) => command === "new-session"),
    ).toHaveLength(1);
    expect(first).toMatchObject({ status: "ok", joined: false });
    expect(second).toMatchObject({ status: "ok", joined: true });
    // 終わった後に押せば、また起こす。
    await h.checker.check(ACCOUNT, "/home/sample/work/sample-app");
    expect(
      h.commands().filter((command) => command === "new-session"),
    ).toHaveLength(2);
  });

  test("a session that does not go away is reported, not hidden", async () => {
    const h = harness({ usageAfterMs: 0, stuck: true });
    const out = await h.checker.check(ACCOUNT, "/home/sample/work/sample-app");
    expect(out.status).toBe("ok");
    expect(h.signals).toEqual([
      { pid: PID, signal: "SIGHUP" },
      { pid: PID, signal: "SIGKILL" },
    ]);
    expect(out.closeError).toContain(
      `the tmux session ${usageCheckSessionName(ACCOUNT.id, START)} is still open`,
    );
  });

  test("codex accounts are refused", async () => {
    const h = harness({});
    await expect(
      h.checker.check(
        { ...ACCOUNT, agent: "codex" },
        "/home/sample/work/sample-app",
      ),
    ).rejects.toBeInstanceOf(AccountError);
    expect(h.calls).toEqual([]);
  });
});

describe("telling the claude screens apart", () => {
  test("every marker of the table is recognised, even when wrapped in a box", () => {
    for (const { reason, markers } of CLAUDE_BLOCKING_SCREENS) {
      for (const marker of markers) {
        const boxed = `│ ${marker.split(" ").join(" │\n│ ")} │`;
        expect(classifyUsageCheckScreen(boxed)).toEqual({
          kind: "blocked",
          reason,
          marker,
        });
      }
    }
  });

  test.each([
    { screen: "", verdict: null },
    { screen: " > Reply with just: ok\n ⏺ ok", verdict: null },
    {
      screen: "[code-viewer] usage check: claude exited with 0",
      verdict: { kind: "exited", code: "0" },
    },
  ])("$screen", ({ screen, verdict }) => {
    expect(classifyUsageCheckScreen(screen)).toEqual(verdict);
  });

  test("the session name says code-viewer made it and fits tmux", () => {
    expect(usageCheckSessionName("claude:default", START)).toBe(
      `${USAGE_CHECK_SESSION_PREFIX}claude-defau-${START.toString(36)}`,
    );
    expect(usageCheckSessionName(ACCOUNT.id, START)).toBe(
      `${USAGE_CHECK_SESSION_PREFIX}5d2c8a4e-000-${START.toString(36)}`,
    );
  });
});

describe("the status line the check passes with --settings", () => {
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
    { session: usageCheckSessionName("claude:default", START), shown: false },
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
