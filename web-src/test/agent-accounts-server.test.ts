// アカウントのファイル操作・プロセス調査・ログインの状態・使用量の読み取り。
// 本物のファイルシステムで、一時ディレクトリを HOME と状態ディレクトリとして
// 使う (利用者の ~/.claude・~/.codex・状態ディレクトリには触らない)。
// 外部コマンド (ps・claude・codex) は差し替えて呼ばない。

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  defaultShareSelection,
  SHARED_CONFIG_ENTRIES,
} from "../core/agent-accounts";
import { loginWindowArgv } from "../server/accounts/launch";
import {
  accountEnv,
  createLoginChecker,
  parseClaudeAuthStatus,
  parseCodexLoginStatus,
} from "../server/accounts/login";
import {
  createProcessEnvProber,
  findAgentProcess,
  type ProcessEnvDeps,
  parseAccountEnvLines,
  parseProcessRows,
} from "../server/accounts/process-env";
import {
  AccountError,
  type AccountPaths,
  accountPaths,
  applyCreateAccount,
  applyRegisterAccount,
  applyRemoveAccount,
  planCreateAccount,
  readAccountRegistry,
  updateAccountRegistry,
} from "../server/accounts/registry";
import {
  claudeUsageFile,
  lastCodexUsage,
  parseClaudeStatusline,
  posixCksum,
  readClaudeUsage,
  readCodexUsage,
} from "../server/accounts/usage";

let root: string;
let paths: AccountPaths;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cv-accounts-"));
  const home = join(root, "home");
  mkdirSync(join(home, ".claude", "skills"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  paths = accountPaths(
    { CODE_VIEWER_TEST_STATE_DIR: join(root, "state") },
    home,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seedDefaultClaude(): void {
  const dir = join(paths.home, ".claude");
  writeFileSync(join(dir, "settings.json"), '{"model":"sample"}\n');
  writeFileSync(join(dir, "CLAUDE.md"), "# sample\n");
  // 共有してはいけないもの。中身は架空。
  writeFileSync(join(dir, ".credentials.json"), '{"sample":"secret"}');
  writeFileSync(join(dir, ".claude.json"), '{"oauthAccount":{}}');
  writeFileSync(join(dir, "history.jsonl"), "");
  mkdirSync(join(dir, "projects"));
  mkdirSync(join(dir, "sessions"));
  mkdirSync(join(dir, "plugins"));
}

describe("paths", () => {
  test.each([
    {
      env: { CODE_VIEWER_TEST_STATE_DIR: "/tmp/sample-state" },
      expected: "/tmp/sample-state",
    },
    { env: { XDG_STATE_HOME: "/x" }, expected: "/x/code-viewer" },
    { env: {}, expected: "/home/sample/.local/state/code-viewer" },
  ])("state dir for $env", ({ env, expected }) => {
    const out = accountPaths(env, "/home/sample");
    expect(out.registry).toBe(`${expected}/accounts.json`);
    expect(out.managedRoot).toBe(`${expected}/accounts`);
    expect(out.usageDir).toBe(`${expected}/agent-usage`);
  });
});

/** 既定の設定ディレクトリの直下に、3 つの分類のものを置く (中身は架空)。 */
function seedMixedClaude(): void {
  seedDefaultClaude();
  const dir = join(paths.home, ".claude");
  writeFileSync(join(dir, "mcp.json"), "{}");
  writeFileSync(join(dir, "statusline-command.sh"), "echo sample");
  writeFileSync(join(dir, "sample-token.txt"), "sample");
  writeFileSync(join(dir, "state.sqlite"), "");
}

async function create(share: string[] | "default", name = "Work") {
  const plan = planCreateAccount(paths, "claude", name);
  return applyCreateAccount(
    paths,
    {
      agent: "claude",
      name,
      configDir: plan.configDir,
      share: share === "default" ? defaultShareSelection(plan.entries) : share,
    },
    7,
  );
}

describe("creating an account", () => {
  test("lists everything in the default directory in three groups", () => {
    seedMixedClaude();
    const plan = planCreateAccount(paths, "claude", "Work");
    expect(
      plan.entries.map((entry) => [
        entry.name,
        entry.category,
        entry.reason,
        entry.directory,
      ]),
    ).toEqual([
      ["CLAUDE.md", "shared", null, false],
      ["settings.json", "shared", null, false],
      ["skills", "shared", null, true],
      ["mcp.json", "optional", null, false],
      ["plugins", "optional", null, true],
      ["statusline-command.sh", "optional", null, false],
      [".claude.json", "blocked", "identity", false],
      [".credentials.json", "blocked", "auth", false],
      ["history.jsonl", "blocked", "history", false],
      ["projects", "blocked", "history", true],
      ["sample-token.txt", "blocked", "suspect", false],
      ["sessions", "blocked", "session", true],
      ["state.sqlite", "blocked", "state", false],
    ]);
    expect(plan.missingShared).toEqual([
      "rules",
      "commands",
      "agents",
      "workflows",
      "output-styles",
      "keybindings.json",
      "themes",
    ]);
  });

  test("by default links the shared settings only, and registers the account", async () => {
    seedMixedClaude();
    const account = await create("default");
    const dir = account.configDir;
    const made = readdirSync(dir).sort();
    expect(made).toEqual(["CLAUDE.md", "settings.json", "skills"]);
    for (const name of made) {
      expect(lstatSync(join(dir, name)).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(dir, name))).toBe(
        join(paths.home, ".claude", name),
      );
    }
    expect(readAccountRegistry(paths.registry)).toEqual({
      ok: true,
      registry: {
        version: 1,
        accounts: [
          {
            id: account.id,
            agent: "claude",
            name: "Work",
            configDir: dir,
            managed: true,
            createdAt: 7,
          },
        ],
        launchCommands: {},
        lastLaunch: null,
      },
    });
  });

  test.each([
    {
      name: "an optional item turned on",
      share: ["settings.json", "plugins", "mcp.json"],
      expected: ["mcp.json", "plugins", "settings.json"],
    },
    {
      name: "a shared item turned off",
      share: ["CLAUDE.md"],
      expected: ["CLAUDE.md"],
    },
    { name: "nothing", share: [], expected: [] },
  ])("links exactly what was chosen: $name", async ({ share, expected }) => {
    seedMixedClaude();
    expect(readdirSync((await create(share)).configDir).sort()).toEqual(
      expected,
    );
  });

  test.each([
    {
      name: "credentials",
      share: ["settings.json", ".credentials.json"],
      code: "invalid",
      message: ".credentials.json cannot be shared (auth)",
    },
    {
      name: "a suspicious name",
      share: ["sample-token.txt"],
      code: "invalid",
      message: "sample-token.txt cannot be shared (suspect)",
    },
    {
      name: "a database",
      share: ["state.sqlite"],
      code: "invalid",
      message: "state.sqlite cannot be shared (state)",
    },
    {
      name: "a name that is not there",
      share: ["../outside"],
      code: "conflict",
      message: "../outside is no longer in the default settings directory",
    },
    {
      name: "a name twice",
      share: ["mcp.json", "mcp.json"],
      code: "invalid",
      message: "mcp.json is listed twice",
    },
  ])("refuses a selection with $name and creates nothing", async ({
    share,
    code,
    message,
  }) => {
    seedMixedClaude();
    let caught: unknown;
    try {
      await create(share);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AccountError);
    expect((caught as AccountError).code).toBe(code);
    expect((caught as Error).message).toContain(message);
    expect(existsSync(join(paths.managedRoot, "claude-work"))).toBe(false);
    expect(existsSync(paths.registry)).toBe(false);
  });

  test.each([
    "claude",
    "codex",
  ] as const)("the %s shared list never names an auth, identity or history file", (agent) => {
    const unsafe =
      /credential|auth|\.claude\.json|history|session|installation_id|projects/i;
    for (const name of SHARED_CONFIG_ENTRIES[agent]) {
      expect(name).not.toMatch(unsafe);
    }
  });

  test("codex: config, instructions, hooks and rules are shared; auth.json cannot be", async () => {
    const dir = join(paths.home, ".codex");
    writeFileSync(join(dir, "config.toml"), 'model = "sample"\n');
    writeFileSync(join(dir, "AGENTS.md"), "# sample\n");
    writeFileSync(join(dir, "hooks.json"), "{}");
    mkdirSync(join(dir, "rules"));
    writeFileSync(join(dir, "auth.json"), '{"sample":"secret"}');
    writeFileSync(join(dir, "installation_id"), "sample");
    writeFileSync(join(dir, "sample.sqlite"), "");
    const plan = planCreateAccount(paths, "codex", "Personal");
    expect(plan.entries.map((entry) => [entry.name, entry.category])).toEqual([
      ["AGENTS.md", "shared"],
      ["config.toml", "shared"],
      ["hooks.json", "shared"],
      ["rules", "shared"],
      ["auth.json", "blocked"],
      ["installation_id", "blocked"],
      ["sample.sqlite", "blocked"],
    ]);
    const account = await applyCreateAccount(paths, {
      agent: "codex",
      name: "Personal",
      configDir: plan.configDir,
      share: defaultShareSelection(plan.entries),
    });
    expect(readdirSync(account.configDir).sort()).toEqual([
      "AGENTS.md",
      "config.toml",
      "hooks.json",
      "rules",
    ]);
  });

  test("names auth-related keys in the shared settings without reading values out", () => {
    writeFileSync(
      join(paths.home, ".claude", "settings.json"),
      JSON.stringify({
        apiKeyHelper: "/bin/sample-helper",
        env: { ANTHROPIC_API_KEY: "sample-secret" },
      }),
    );
    const plan = planCreateAccount(paths, "claude", "Work");
    expect(plan.authKeysInShared).toEqual([
      "apiKeyHelper",
      "env.ANTHROPIC_API_KEY",
    ]);
    expect(JSON.stringify(plan)).not.toContain("sample-secret");
  });

  test("a taken directory name gets a suffix", () => {
    mkdirSync(join(paths.managedRoot, "claude-work"), { recursive: true });
    expect(planCreateAccount(paths, "claude", "Work").configDir).toBe(
      join(paths.managedRoot, "claude-work-2"),
    );
  });

  test("refuses when the directory shown is no longer the one to create", async () => {
    seedDefaultClaude();
    const plan = planCreateAccount(paths, "claude", "Work");
    mkdirSync(plan.configDir, { recursive: true });
    await expect(
      applyCreateAccount(paths, {
        agent: "claude",
        name: "Work",
        configDir: plan.configDir,
        share: [],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(readdirSync(plan.configDir)).toEqual([]);
  });
});

describe("account registry updates", () => {
  test("a nested update reads the result of the update holding the lock", async () => {
    let inner: unknown;
    const outer = updateAccountRegistry(paths.registry, (registry) => {
      inner = updateAccountRegistry(paths.registry, (current) => ({
        registry: {
          ...current,
          launchCommands: { ...current.launchCommands, codex: "inner" },
        },
        result: null,
      }));
      return {
        registry: {
          ...registry,
          launchCommands: { ...registry.launchCommands, claude: "outer" },
        },
        result: null,
      };
    });

    await outer;
    await inner;
    const read = readAccountRegistry(paths.registry);
    expect(read.ok && read.registry.launchCommands).toEqual({
      claude: "outer",
      codex: "inner",
    });
  });
});

describe("registering, removing and a broken registry", () => {
  test("registers an existing directory without touching it", async () => {
    const dir = join(root, "existing");
    mkdirSync(dir);
    writeFileSync(join(dir, "keep.txt"), "sample");
    const added = await applyRegisterAccount(
      paths,
      "codex",
      "Personal",
      `${dir}/`,
    );
    expect(added.configDir).toBe(dir);
    expect(readdirSync(dir)).toEqual(["keep.txt"]);
  });

  test.each([
    {
      name: "a missing directory",
      path: () => join(root, "missing"),
      code: "invalid",
    },
    {
      name: "a file",
      path: () => {
        const file = join(root, "file");
        writeFileSync(file, "");
        return file;
      },
      code: "invalid",
    },
    {
      name: "the default directory",
      path: () => join(paths.home, ".codex"),
      code: "invalid",
    },
  ])("refuses $name", async ({ path, code }) => {
    await expect(
      applyRegisterAccount(paths, "codex", "x", path()),
    ).rejects.toMatchObject({ code });
    expect(existsSync(paths.registry)).toBe(false);
  });

  test("refuses to register the same directory twice", async () => {
    const dir = join(root, "existing");
    mkdirSync(dir);
    await applyRegisterAccount(paths, "codex", "One", dir);
    await expect(
      applyRegisterAccount(paths, "codex", "Two", dir),
    ).rejects.toThrow(/already registered as "One"/);
  });

  test("removing keeps the settings directory", async () => {
    const dir = join(root, "existing");
    mkdirSync(dir);
    const added = await applyRegisterAccount(paths, "codex", "Personal", dir);
    expect((await applyRemoveAccount(paths, added.id)).id).toBe(added.id);
    expect(existsSync(dir)).toBe(true);
    const read = readAccountRegistry(paths.registry);
    expect(read.ok && read.registry.accounts).toEqual([]);
  });

  test.each([
    { id: "claude:default", code: "builtin" },
    { id: "missing", code: "not-found" },
  ])("removing $id is refused", async ({ id, code }) => {
    await expect(applyRemoveAccount(paths, id)).rejects.toMatchObject({ code });
  });

  test.each([
    { name: "not JSON", text: "{ broken" },
    { name: "an unexpected shape", text: '{"version":1,"accounts":"x"}' },
  ])("a registry that is $name is reported and never overwritten", async ({
    text,
  }) => {
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.registry, text);
    const read = readAccountRegistry(paths.registry);
    expect(read.ok).toBe(false);
    const dir = join(root, "existing");
    mkdirSync(dir);
    let caught: unknown;
    try {
      await applyRegisterAccount(paths, "codex", "x", dir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AccountError);
    expect((caught as AccountError).code).toBe("unreadable");
    expect(readFileSync(paths.registry, "utf8")).toBe(text);
  });
});

describe("process environment", () => {
  const SECRET = "sample-secret-value";

  test("parses the process table (comm may contain spaces)", () => {
    expect(
      parseProcessRows(
        "  10     1 /bin/zsh\n  11    10 /opt/sample app/claude\nnoise\n",
      ),
    ).toEqual([
      { pid: 10, ppid: 1, comm: "/bin/zsh" },
      { pid: 11, ppid: 10, comm: "/opt/sample app/claude" },
    ]);
  });

  test.each([
    {
      name: "the pane process itself (the shell exec'd into it)",
      rows: [{ pid: 5, ppid: 1, comm: "/x/claude" }],
      expected: 5,
    },
    {
      name: "a child of the shell",
      rows: [
        { pid: 5, ppid: 1, comm: "/bin/zsh" },
        { pid: 6, ppid: 5, comm: "/x/claude" },
      ],
      expected: 6,
    },
    {
      name: "the shallowest match",
      rows: [
        { pid: 5, ppid: 1, comm: "/bin/zsh" },
        { pid: 6, ppid: 5, comm: "/bin/sh" },
        { pid: 7, ppid: 6, comm: "/x/claude" },
        { pid: 8, ppid: 7, comm: "/x/claude" },
      ],
      expected: 7,
    },
    {
      name: "nothing with that name",
      rows: [{ pid: 5, ppid: 1, comm: "/bin/zsh" }],
      expected: null,
    },
  ])("finds $name", ({ rows, expected }) => {
    expect(findAgentProcess(rows, 5, "claude")).toBe(expected);
  });

  test("keeps only the two account variables from ps eww", () => {
    const out = parseAccountEnvLines(
      ` 11 claude --x HOME=/home/sample ANTHROPIC_API_KEY=${SECRET} CLAUDE_CONFIG_DIR=/home/sample/w\n 12 codex OPENAI_API_KEY=${SECRET}\n`,
    );
    expect([...out]).toEqual([
      [11, { CLAUDE_CONFIG_DIR: "/home/sample/w" }],
      [12, {}],
    ]);
    expect(JSON.stringify([...out])).not.toContain(SECRET);
  });

  function deps(over: Partial<ProcessEnvDeps> = {}) {
    let now = 1000;
    const calls = { list: 0, env: 0 };
    const value: ProcessEnvDeps & { tick(ms: number): void } = {
      async listProcesses() {
        calls.list += 1;
        return [
          { pid: 5, ppid: 1, comm: "/x/claude" },
          { pid: 9, ppid: 1, comm: "/x/codex" },
        ];
      },
      async readAccountEnv(pids) {
        calls.env += 1;
        return new Map(
          pids.map((pid) => [
            pid,
            pid === 5 ? { CLAUDE_CONFIG_DIR: "/home/sample/w" } : {},
          ]),
        );
      },
      now: () => now,
      tick(ms) {
        now += ms;
      },
      ...over,
    };
    return { value, calls };
  }

  const targets = [
    { id: "%1", pid: 5, command: "claude" },
    { id: "%2", pid: 9, command: "codex" },
  ];

  test("probes once, then answers from memory until the pane changes", async () => {
    const { value, calls } = deps();
    const prober = createProcessEnvProber(value, 30_000);
    const first = await prober.probe(targets);
    expect([...first]).toEqual([
      ["%1", { status: "ok", env: { CLAUDE_CONFIG_DIR: "/home/sample/w" } }],
      ["%2", { status: "ok", env: {} }],
    ]);
    await prober.probe(targets);
    value.tick(10_000);
    await prober.probe(targets);
    expect(calls).toEqual({ list: 1, env: 1 });
    // コマンドが変わったペインは、待って調べ直す。
    await prober.probe([{ id: "%1", pid: 5, command: "zsh" }, targets[1]!]);
    expect(calls.list).toBe(2);
  });

  test("an old entry is answered at once and refreshed in the background", async () => {
    const { value, calls } = deps();
    const prober = createProcessEnvProber(value, 30_000);
    await prober.probe(targets);
    value.tick(31_000);
    const again = await prober.probe(targets);
    expect(again.get("%1")).toEqual({
      status: "ok",
      env: { CLAUDE_CONFIG_DIR: "/home/sample/w" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual({ list: 2, env: 2 });
  });

  test.each([
    {
      name: "ps -A fails",
      over: {
        async listProcesses(): Promise<never> {
          throw new Error("ps -A exited with 1\nstderr: sample failure");
        },
      },
      reason: "ps -A exited with 1",
    },
    {
      name: "ps eww fails",
      over: {
        async readAccountEnv(): Promise<never> {
          throw new Error("ps eww exited with 2\nstderr: sample failure");
        },
      },
      reason: "ps eww exited with 2",
    },
  ])("when $name the reason is kept for the row", async ({ over, reason }) => {
    const { value } = deps(over);
    const out = await createProcessEnvProber(value).probe(targets);
    expect(out.get("%1")).toEqual({
      status: "error",
      reason: expect.stringContaining(reason),
    });
  });
});

describe("login status (official commands only)", () => {
  const AT = 5;
  test.each([
    {
      name: "claude signed in",
      result: {
        code: 0,
        stdout:
          '{"loggedIn":true,"authMethod":"claude.ai","email":"sample@example.invalid","subscriptionType":"max"}',
        stderr: "",
      },
      expected: {
        state: "logged-in",
        who: "sample@example.invalid",
        method: "claude.ai (max)",
      },
    },
    {
      name: "claude signed out",
      result: { code: 1, stdout: '{"loggedIn":false}', stderr: "" },
      expected: { state: "logged-out", who: "", method: "" },
    },
    {
      name: "claude missing",
      result: { code: 1, stdout: "", stderr: "spawn claude ENOENT" },
      expected: {
        state: "unknown",
        detail: "the claude command was not found",
      },
    },
  ])("$name", ({ result, expected }) => {
    expect(parseClaudeAuthStatus(result, AT)).toMatchObject(expected);
  });

  test("an unreadable claude answer does not repeat its output (it may hold an email)", () => {
    const login = parseClaudeAuthStatus(
      { code: 2, stdout: "sample@example.invalid not json", stderr: "" },
      AT,
    );
    expect(login.state).toBe("unknown");
    expect(login.detail).not.toContain("sample@example.invalid");
    expect(login.detail).toContain("exited with 2");
  });

  test.each([
    {
      name: "ChatGPT",
      out: { code: 0, stdout: "", stderr: "Logged in using ChatGPT\n" },
      expected: { state: "logged-in", method: "ChatGPT", who: "" },
    },
    {
      name: "an API key (the key's tail is not kept)",
      out: {
        code: 0,
        stdout: "Logged in using an API key - sk-sample***TAIL\n",
        stderr: "",
      },
      expected: { state: "logged-in", method: "API key", who: "" },
    },
    {
      name: "signed out",
      out: { code: 1, stdout: "", stderr: "Not logged in\n" },
      expected: { state: "logged-out" },
    },
    {
      name: "something else",
      out: { code: 3, stdout: "sample output", stderr: "" },
      expected: { state: "unknown" },
    },
  ])("codex $name", ({ out, expected }) => {
    const login = parseCodexLoginStatus(out, AT);
    expect(login).toMatchObject(expected);
    expect(JSON.stringify(login)).not.toContain("TAIL");
    expect(JSON.stringify(login)).not.toContain("sample output");
  });

  test("the default account unsets the variable, others set it", () => {
    const base = { CLAUDE_CONFIG_DIR: "/somewhere", PATH: "/bin" };
    expect(
      accountEnv(
        { agent: "claude", builtin: true, configDir: "/home/sample/.claude" },
        base,
      ),
    ).toEqual({ PATH: "/bin" });
    expect(
      accountEnv(
        { agent: "codex", builtin: false, configDir: "/home/sample/c" },
        base,
      ),
    ).toEqual({ ...base, CODEX_HOME: "/home/sample/c" });
  });

  test("answers from memory for a while, and can be forced", async () => {
    let runs = 0;
    const checker = createLoginChecker({
      async run() {
        runs += 1;
        return { code: 0, stdout: '{"loggedIn":true}', stderr: "" };
      },
      now: () => 0,
    });
    const account = {
      id: "claude:default",
      agent: "claude" as const,
      name: "",
      configDir: "/home/sample/.claude",
      builtin: true,
      managed: false,
    };
    await checker.status(account);
    await checker.status(account);
    await checker.status(account, true);
    expect(runs).toBe(2);
  });
});

describe("usage", () => {
  test.each([
    ["", 4294967295],
    ["/tmp/a b/c'd", 2935524053],
    ["/Users/sample/.local/state/code-viewer/accounts/claude-work", 3049091338],
  ])("posixCksum(%j) matches the cksum command", (text, expected) => {
    expect(posixCksum(text)).toBe(expected);
  });

  test.each([
    {
      name: "both windows",
      input:
        '{"rate_limits":{"five_hour":{"used_percentage":42.5,"resets_at":1700000000},"seven_day":{"used_percentage":81,"resets_at":1700600000}}}',
      expected: {
        status: "ok",
        observedAt: 9,
        windows: [
          {
            kind: "five_hour",
            minutes: 300,
            usedPercent: 42.5,
            resetsAt: 1700000000000,
          },
          {
            kind: "seven_day",
            minutes: 10080,
            usedPercent: 81,
            resetsAt: 1700600000000,
          },
        ],
      },
    },
    {
      name: "no rate limits (not Pro / Max, or before the first answer)",
      input: '{"model":{}}',
      expected: { status: "unavailable", reason: "no-limits" },
    },
    {
      name: "not JSON",
      input: '{"rate_limits": {',
      expected: { status: "unavailable", reason: "unreadable" },
    },
    {
      name: "a percentage that is not a number",
      input: '{"rate_limits":{"five_hour":{"used_percentage":"high"}}}',
      expected: { status: "unavailable", reason: "unreadable" },
    },
  ])("claude statusline: $name", ({ input, expected }) => {
    expect(parseClaudeStatusline(input, 9)).toMatchObject(expected);
  });

  test("claude: missing file says whether the status line is wrapped", () => {
    expect(readClaudeUsage(paths.usageDir, [""], false)).toMatchObject({
      status: "unavailable",
      reason: "not-wrapped",
    });
    expect(readClaudeUsage(paths.usageDir, [""], true)).toMatchObject({
      status: "unavailable",
      reason: "no-data",
    });
  });

  test("claude: the newest of the candidate files wins and its time is kept", () => {
    mkdirSync(paths.usageDir, { recursive: true });
    const older = claudeUsageFile(paths.usageDir, "");
    const newer = claudeUsageFile(paths.usageDir, "/home/sample/.claude");
    writeFileSync(older, '{"rate_limits":{"five_hour":{"used_percentage":1}}}');
    writeFileSync(newer, '{"rate_limits":{"five_hour":{"used_percentage":2}}}');
    utimesSync(older, 100, 100);
    utimesSync(newer, 200, 200);
    const usage = readClaudeUsage(
      paths.usageDir,
      ["", "/home/sample/.claude"],
      true,
    );
    expect(usage).toMatchObject({ status: "ok", observedAt: 200_000 });
    expect(usage.status === "ok" && usage.windows[0]?.usedPercent).toBe(2);
  });

  const tokenLine = (
    rateLimits: unknown,
    timestamp = "2026-01-02T03:04:05.000Z",
  ) =>
    JSON.stringify({
      timestamp,
      type: "event_msg",
      payload: { type: "token_count", info: null, rate_limits: rateLimits },
    });
  const usageBaseMs = Date.parse("2026-01-01T00:00:00.000Z");
  const hourMs = 60 * 60_000;
  const rateLimitsAt = (
    usedPercent: number,
    [primaryResetHour, secondaryResetHour]: readonly [number, number],
  ) => ({
    primary: {
      used_percent: usedPercent,
      window_minutes: 300,
      resets_at: (usageBaseMs + primaryResetHour * hourMs) / 1000,
    },
    secondary: {
      used_percent: usedPercent,
      window_minutes: 10080,
      resets_at: (usageBaseMs + secondaryResetHour * hourMs) / 1000,
    },
  });

  test.each([
    {
      name: "the last token_count with limits",
      text: [
        tokenLine({
          primary: { used_percent: 10, window_minutes: 300, resets_at: 1 },
        }),
        tokenLine(
          {
            primary: {
              used_percent: 55,
              window_minutes: 10080,
              resets_at: 1790000000,
            },
            secondary: null,
          },
          "2026-01-02T03:05:00.000Z",
        ),
        tokenLine(null),
        '{"type":"response_item","payload":{"type":"message"}}',
      ].join("\n"),
      expected: {
        status: "ok",
        observedAt: Date.parse("2026-01-02T03:05:00.000Z"),
        windows: [
          {
            kind: "seven_day",
            minutes: 10080,
            usedPercent: 55,
            resetsAt: 1790000000000,
          },
        ],
      },
    },
    {
      name: "no token_count",
      text: '{"type":"session_meta"}\n',
      expected: null,
    },
    {
      name: "a broken token_count line",
      text: '{"type":"event_msg","payload":{"type":"token_count"',
      expected: { status: "unavailable", reason: "unreadable" },
    },
    {
      name: "an incomplete trailing token_count after a complete value",
      text: `${tokenLine({ primary: { used_percent: 42, window_minutes: 300 } })}\n{"type":"event_msg","payload":{"type":"token_count"`,
      expected: { status: "ok", windows: [{ usedPercent: 42 }] },
    },
    {
      name: "a complete invalid trailing token_count after a complete value",
      text: `${tokenLine({ primary: { used_percent: 42, window_minutes: 300 } })}\n${tokenLine({ primary: { used_percent: "x" } })}`,
      expected: { status: "unavailable", reason: "unreadable" },
    },
    {
      name: "a window without a number",
      text: tokenLine({ primary: { used_percent: "x" } }),
      expected: { status: "unavailable", reason: "unreadable" },
    },
  ])("codex: $name", ({ text, expected }) => {
    const usage = lastCodexUsage(text);
    if (expected === null) expect(usage).toBeNull();
    else expect(usage).toMatchObject(expected);
  });

  test("codex: reads the newest session log, and says when there is none", () => {
    const codexHome = join(root, "codex-home");
    expect(readCodexUsage(codexHome)).toMatchObject({
      status: "unavailable",
      reason: "no-sessions",
    });
    const day = join(codexHome, "sessions", "2026", "01", "02");
    mkdirSync(day, { recursive: true });
    const old = join(day, "rollout-a.jsonl");
    const recent = join(day, "rollout-b.jsonl");
    writeFileSync(
      old,
      `${tokenLine({ primary: { used_percent: 90, window_minutes: 300 } })}\n`,
    );
    writeFileSync(
      recent,
      `${tokenLine({ primary: { used_percent: 20, window_minutes: 300 } })}\n`,
    );
    utimesSync(old, 100, 100);
    utimesSync(recent, 200, 200);
    const usage = readCodexUsage(codexHome);
    expect(usage.status === "ok" && usage.windows[0]?.usedPercent).toBe(20);
  });

  test("codex: a newer weekly-only event cannot gain a five-hour window from mtime order", () => {
    const codexHome = join(root, "codex-event-order");
    const day = join(codexHome, "sessions", "2026", "01", "02");
    mkdirSync(day, { recursive: true });
    const olderEvent = join(day, "rollout-newer-mtime.jsonl");
    const newerEvent = join(day, "rollout-older-mtime.jsonl");
    writeFileSync(
      olderEvent,
      `${tokenLine({ primary: { used_percent: 88, window_minutes: 10080 }, secondary: null }, "2026-01-02T03:00:00.000Z")}\n`,
    );
    writeFileSync(
      newerEvent,
      `${tokenLine({ primary: { used_percent: 34, window_minutes: 10080 }, secondary: null }, "2026-01-02T04:00:00.000Z")}\n`,
    );
    utimesSync(olderEvent, 200, 200);
    utimesSync(newerEvent, 100, 100);

    const usage = readCodexUsage(codexHome);
    expect(usage).toEqual({
      status: "ok",
      observedAt: Date.parse("2026-01-02T04:00:00.000Z"),
      windows: [
        {
          kind: "seven_day",
          minutes: 10080,
          usedPercent: 34,
          resetsAt: 0,
        },
      ],
    });
  });

  test.each([
    {
      name: "normal five-hour reset",
      newer: [6, [11, 168]],
      older: [0, [5, 168]],
      mixed: false,
    },
    {
      name: "normal weekly reset",
      newer: [2, [5, 169]],
      older: [0, [5, 1]],
      mixed: false,
    },
    {
      name: "reset moves backward",
      newer: [3, [12, 120]],
      older: [0, [24, 168]],
      mixed: true,
    },
    {
      name: "two resets at the same observation time",
      newer: [0, [24, 336]],
      older: [0, [5, 168]],
      mixed: true,
    },
    {
      name: "clock skew inside tolerance",
      newer: [0, [5.5, 168.5]],
      older: [0, [5, 168]],
      mixed: false,
    },
  ] as const)("codex mixed detection: $name", ({
    name,
    newer,
    older,
    mixed,
  }) => {
    const codexHome = join(root, `codex-window-${name.replace(/ /g, "-")}`);
    const day = join(codexHome, "sessions", "2026", "01", "02");
    mkdirSync(day, { recursive: true });
    const newerFile = join(day, "rollout-newer.jsonl");
    const olderFile = join(day, "rollout-older.jsonl");
    writeFileSync(
      newerFile,
      `${tokenLine(rateLimitsAt(4, newer[1]), new Date(usageBaseMs + newer[0] * hourMs).toISOString())}\n`,
    );
    writeFileSync(
      olderFile,
      `${tokenLine(rateLimitsAt(97, older[1]), new Date(usageBaseMs + older[0] * hourMs).toISOString())}\n`,
    );
    utimesSync(newerFile, 200, 200);
    utimesSync(olderFile, 100, 100);

    const usage = readCodexUsage(codexHome);
    expect(usage.status).toBe("ok");
    expect(usage.status === "ok" && Boolean(usage.mixed)).toBe(mixed);
  });

  test("codex: logs from two accounts in one home are flagged as mixed, same account is not", () => {
    const codexHome = join(root, "codex-mixed");
    const day = join(codexHome, "sessions", "2026", "01", "02");
    mkdirSync(day, { recursive: true });
    const current = join(day, "rollout-current.jsonl");
    const other = join(day, "rollout-other.jsonl");
    const week = (used_percent: number, resets_at: number) => ({
      primary: { used_percent, window_minutes: 10080, resets_at },
    });
    writeFileSync(current, `${tokenLine(week(97, 1_790_438_922))}\n`);
    writeFileSync(other, `${tokenLine(week(0, 1_790_655_110))}\n`);
    utimesSync(other, 100, 100);
    utimesSync(current, 200, 200);
    const mixed = readCodexUsage(codexHome);
    expect(mixed).toMatchObject({
      status: "ok",
      windows: [{ usedPercent: 97 }],
      mixed: { windows: [{ usedPercent: 0, resetsAt: 1_790_655_110_000 }] },
    });
    // 同じアカウントの古い記録 (リセットの時刻が同じ) は混在ではない。
    writeFileSync(other, `${tokenLine(week(80, 1_790_438_922))}\n`);
    utimesSync(other, 100, 100);
    const same = readCodexUsage(codexHome);
    expect(same).toMatchObject({
      status: "ok",
      windows: [{ usedPercent: 97 }],
    });
    expect(same.status === "ok" && same.mixed).toBeUndefined();
  });

  test("codex: only the tail of a large log is read", () => {
    const day = join(root, "big", "sessions", "2026", "01", "02");
    mkdirSync(day, { recursive: true });
    const file = join(day, "rollout-big.jsonl");
    // 先頭に上限の行、その後ろに 1MB 以上の会話。末尾だけ読むので見つからない。
    writeFileSync(
      file,
      `${tokenLine({ primary: { used_percent: 99, window_minutes: 300 } })}\n${`${JSON.stringify({ type: "response_item", payload: { text: "x".repeat(1000) } })}\n`.repeat(1200)}`,
    );
    expect(readCodexUsage(join(root, "big"))).toMatchObject({
      status: "unavailable",
      reason: "no-token-count",
    });
  });
});

describe("the login window", () => {
  test.each([
    "claude",
    "codex",
  ] as const)("%s: runs the command as separate arguments, then waits for Enter", (agent) => {
    const argv = loginWindowArgv(agent);
    expect(argv.slice(0, 2)).toEqual(["/bin/sh", "-c"]);
    // コマンドの代わりに、引用符と空白を含む引数を渡しても崩れない。
    const out = spawnSync(
      argv[0] ?? "",
      [...argv.slice(1, 4), "printf", "[%s]", "it's a 'sample' $HOME"],
      { input: "\n", encoding: "utf8" },
    );
    expect(out.stdout).toBe(
      "[it's a 'sample' $HOME]\n[code-viewer] sign-in command exited with 0. Press Enter to close this window.\n",
    );
    expect(out.status).toBe(0);
    expect(argv.slice(4)).toEqual(
      agent === "claude" ? ["claude", "auth", "login"] : ["codex", "login"],
    );
  });
});
