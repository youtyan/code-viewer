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
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  defaultShareSelection,
  SHARED_CONFIG_ENTRIES,
} from "../core/agent-accounts";
import {
  accountReadArgv,
  agentCommandArgv,
  interactiveShell,
  loginStatusArgv,
  loginWindowArgv,
} from "../server/accounts/launch";
import {
  ACCOUNT_READ_ID,
  ACCOUNT_READ_REQUESTS,
  accountEnv,
  createLoginChecker,
  DEFAULT_LOGIN_DEPS,
  parseClaudeAuthStatus,
  parseCodexAccountRead,
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
  applyRenameAccount,
  planCreateAccount,
  readAccountRegistry,
  updateAccountRegistry,
} from "../server/accounts/registry";
import { createAccountService } from "../server/accounts/service";
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
    expect(out.usageCheckDir).toBe(`${expected}/usage-check`);
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

  test("renaming writes the new name and keeps the directory and id", async () => {
    const dir = join(root, "existing");
    mkdirSync(dir);
    const added = await applyRegisterAccount(paths, "codex", "Personal", dir);
    const renamed = await applyRenameAccount(paths, added.id, " Side project ");
    const read = readAccountRegistry(paths.registry);
    expect([
      renamed.name,
      read.ok &&
        read.registry.accounts.map((account) => [
          account.id,
          account.name,
          account.configDir,
        ]),
    ]).toEqual(["Side project", [[added.id, "Side project", dir]]]);
  });

  test.each([
    {
      name: "the name of another account",
      next: "Other",
      code: "conflict",
      message: /"Other" is already the name of another codex account/,
    },
    {
      name: "the name of the default account",
      next: "Default",
      code: "invalid",
      message: /"Default" is the name of the default account/,
    },
    {
      name: "an empty name",
      next: "  ",
      code: "invalid",
      message: /invalid account name \(empty\)/,
    },
  ])("renaming to $name is refused with the reason", async ({
    next,
    code,
    message,
  }) => {
    const one = join(root, "one");
    const two = join(root, "two");
    mkdirSync(one);
    mkdirSync(two);
    const added = await applyRegisterAccount(paths, "codex", "Personal", one);
    await applyRegisterAccount(paths, "codex", "Other", two);
    const rename = applyRenameAccount(paths, added.id, next);
    await expect(rename).rejects.toMatchObject({ code });
    await expect(rename).rejects.toThrow(message);
    const read = readAccountRegistry(paths.registry);
    expect(read.ok && read.registry.accounts.map((a) => a.name)).toEqual([
      "Personal",
      "Other",
    ]);
  });

  test.each([
    { id: "claude:default", code: "builtin" },
    { id: "missing", code: "not-found" },
  ])("renaming $id is refused", async ({ id, code }) => {
    await expect(applyRenameAccount(paths, id, "Mine")).rejects.toMatchObject({
      code,
    });
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
  ] as const;

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
    await prober.probe([{ id: "%1", pid: 5, command: "zsh" }, targets[1]]);
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

  const spawnFailure = Object.assign(new Error("spawn ps EAGAIN"), {
    code: "EAGAIN",
  });
  test.each([
    {
      name: "ps -A fails",
      over: {
        async listProcesses(): Promise<never> {
          throw Object.assign(new Error("ps -A exited with 1"), {
            cause: spawnFailure,
          });
        },
      },
      reason:
        'Error: ps -A exited with 1\nCaused by: Error: spawn ps EAGAIN\nDetails: {"code":"EAGAIN"}',
    },
    {
      name: "ps eww fails",
      over: {
        async readAccountEnv(): Promise<never> {
          throw Object.assign(new Error("ps eww exited with 2"), {
            cause: spawnFailure,
          });
        },
      },
      reason:
        'Error: ps eww exited with 2\nCaused by: Error: spawn ps EAGAIN\nDetails: {"code":"EAGAIN"}',
    },
  ])("when $name the reason and its cause are kept for the row", async ({
    over,
    reason,
  }) => {
    const { value } = deps(over);
    const out = await createProcessEnvProber(value).probe(targets);
    expect(out.get("%1")).toEqual({ status: "error", reason });
  });
});

describe("login status (asked from the CLI itself)", () => {
  const AT = 5;
  const ESC = String.fromCharCode(27);
  // 対話シェルの初期化が JSON の前に出す端末向けの文字列 (tmux が包んだ OSC 7)。
  const SHELL_NOISE = `${ESC}Ptmux;${ESC}${ESC}]7;file://sample-host/${ESC}${ESC}\\${ESC}\\`;
  const EMAIL = "sample@example.invalid";
  const signedIn = JSON.stringify(
    {
      loggedIn: true,
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      email: EMAIL,
      orgId: "sample-org-id",
      orgName: "Sample org",
      subscriptionType: "max",
    },
    null,
    2,
  );
  const ok = (stdout: string, code = 0, stderr = "") => ({
    code,
    stdout,
    stderr,
  });

  test.each([
    {
      name: "signed in",
      result: ok(signedIn),
      expected: {
        state: "logged-in",
        who: EMAIL,
        plan: "max",
        method: "claude.ai",
        whoDetail: "",
        detail: "",
      },
    },
    {
      name: "signed in, with the interactive shell's escape before the JSON",
      result: ok(`${SHELL_NOISE}${signedIn}\n${SHELL_NOISE}`),
      expected: { state: "logged-in", who: EMAIL, plan: "max" },
    },
    {
      name: "signed in without an email (API key)",
      result: ok('{"loggedIn":true,"authMethod":"sample-method"}'),
      expected: {
        state: "logged-in",
        who: "",
        plan: "",
        whoDetail:
          "claude auth status --json did not include an email (sign-in method: sample-method)",
      },
    },
    {
      name: "signed out (exit 1)",
      result: ok(`${SHELL_NOISE}{"loggedIn":false,"authMethod":"none"}`, 1),
      expected: { state: "logged-out", who: "", detail: "" },
    },
    {
      name: "the command is missing (the shell says so)",
      result: ok("", 127, "zsh:1: command not found: claude\n"),
      expected: {
        state: "unknown",
        detail:
          "claude auth status --json: the command was not found (exit 127: zsh:1: command not found: claude)",
      },
    },
    {
      name: "the command is missing (spawn)",
      result: ok("", 1, "spawn claude ENOENT"),
      expected: {
        state: "unknown",
        detail:
          "claude auth status --json: the command was not found (exit 1: spawn claude ENOENT)",
      },
    },
    {
      name: "the answer is not JSON",
      result: ok(`${EMAIL} not json`, 2, "sample failure\nsecond line"),
      expected: {
        state: "unknown",
        detail:
          "claude auth status --json exited with 2: sample failure (stdout 31 bytes, not shown); no JSON object in the output",
      },
    },
    {
      name: "the JSON has no loggedIn",
      result: ok('{"email":"sample@example.invalid"}'),
      expected: {
        state: "unknown",
        detail:
          "claude auth status --json exited with 0 (stdout 34 bytes, not shown); the JSON has no loggedIn field",
      },
    },
  ])("claude: $name", ({ result, expected }) => {
    expect(parseClaudeAuthStatus(result, AT)).toMatchObject(expected);
  });

  test("claude: only the shown fields leave the parser, and failures never quote the output", () => {
    const withSecrets = ok(
      signedIn.replace(
        '"loggedIn": true,',
        '"loggedIn": true, "accessToken": "sample-token-SECRET", "refreshToken": "sample-refresh-SECRET",',
      ),
    );
    const login = parseClaudeAuthStatus(withSecrets, AT);
    expect(Object.keys(login).sort()).toEqual(
      [
        "checkedAt",
        "detail",
        "method",
        "plan",
        "state",
        "who",
        "whoDetail",
      ].sort(),
    );
    expect(JSON.stringify(login)).not.toMatch(
      /SECRET|sample-org-id|Sample org/,
    );
    // JSON.parse のエラー文は入力を引用する。壊れた出力の一部も理由に載らない。
    const broken = parseClaudeAuthStatus(
      ok(`{"email":"${EMAIL}", broken`, 1),
      AT,
    );
    expect(broken.state).toBe("unknown");
    expect(broken.detail).not.toMatch(/sample@|example\.invalid/);
  });

  test("claude: the launch command in the reason is the one that was run", () => {
    expect(
      parseClaudeAuthStatus(ok("", 3, "boom"), AT, "/opt/sample/claude-wrapper")
        .detail,
    ).toBe(
      "/opt/sample/claude-wrapper auth status --json exited with 3: boom (stdout 0 bytes, not shown); no JSON object in the output",
    );
  });

  test.each([
    {
      name: "ChatGPT",
      out: ok(SHELL_NOISE, 0, "Logged in using ChatGPT\n"),
      expected: { state: "logged-in", method: "ChatGPT", who: "" },
    },
    {
      name: "an API key (the key's tail is not kept)",
      out: ok("Logged in using an API key - sk-sample***TAIL\n"),
      expected: { state: "logged-in", method: "API key", who: "" },
    },
    {
      name: "signed out",
      out: ok("", 1, "Not logged in\n"),
      expected: { state: "logged-out" },
    },
    {
      name: "the command is missing",
      out: ok("", 127, "zsh:1: command not found: codex\n"),
      expected: {
        state: "unknown",
        detail:
          "codex login status: the command was not found (exit 127: zsh:1: command not found: codex)",
      },
    },
    {
      name: "something else",
      out: ok("sample output", 3, "Error loading configuration: sample\n"),
      expected: {
        state: "unknown",
        detail:
          "codex login status exited with 3: Error loading configuration: sample (stdout 13 bytes, not shown)",
      },
    },
  ])("codex: $name", ({ out, expected }) => {
    const login = parseCodexLoginStatus(out, AT);
    expect(login).toMatchObject(expected);
    expect(JSON.stringify(login)).not.toContain("TAIL");
    expect(JSON.stringify(login)).not.toContain("sample output");
  });

  const answer = (result: unknown) =>
    JSON.stringify({ id: ACCOUNT_READ_ID, result });
  const rpcOk = (...lines: string[]) => ({
    code: 0,
    lines,
    stderr: "",
    timedOut: false,
    tooMuchOutput: false,
  });
  test.each([
    {
      name: "a ChatGPT account",
      result: rpcOk(
        `${SHELL_NOISE}{"id":1,"result":{"userAgent":"sample"}}`,
        '{"method":"remoteControl/status/changed","params":{"status":"disabled"}}',
        answer({
          account: { type: "chatgpt", email: EMAIL, planType: "pro" },
          requiresOpenaiAuth: true,
          workspaceRouting: { chatgptAccountId: "sample-account-id" },
        }),
      ),
      expected: { who: EMAIL, plan: "pro", whoDetail: "" },
    },
    {
      name: "no email in the answer",
      result: rpcOk(
        answer({ account: { type: "chatgpt", email: null, planType: "plus" } }),
      ),
      expected: {
        who: "",
        plan: "plus",
        whoDetail: "codex app-server (account/read) did not include an email",
      },
    },
    {
      name: "an API key",
      result: rpcOk(answer({ account: { type: "apiKey" } })),
      expected: {
        who: "",
        whoDetail: "signed in with an API key, which has no email",
      },
    },
    {
      name: "no account",
      result: rpcOk(answer({ account: null, requiresOpenaiAuth: true })),
      expected: {
        who: "",
        whoDetail:
          "codex app-server (account/read) reports no signed-in account",
      },
    },
    {
      name: "an error answer",
      result: rpcOk(
        JSON.stringify({
          id: ACCOUNT_READ_ID,
          error: { code: -32601, message: "method not found" },
        }),
      ),
      expected: {
        who: "",
        whoDetail:
          "codex app-server (account/read) returned an error: code -32601, method not found",
      },
    },
    {
      name: "no answer before it exited",
      result: {
        code: 2,
        lines: [`${EMAIL} sample`],
        stderr: "error: unrecognized subcommand 'app-server'\n",
        timedOut: false,
        tooMuchOutput: false,
      },
      expected: {
        who: "",
        whoDetail:
          "codex app-server (account/read) exited with 2 without answering: error: unrecognized subcommand 'app-server' (1 lines on stdout, not shown)",
      },
    },
    {
      name: "no answer in time",
      result: {
        code: null,
        lines: [],
        stderr: "",
        timedOut: true,
        tooMuchOutput: false,
      },
      expected: {
        who: "",
        whoDetail:
          "codex app-server (account/read) did not answer within 8 s (0 lines on stdout, not shown)",
      },
    },
    {
      name: "the command is missing",
      result: {
        code: 127,
        lines: [],
        stderr: "zsh:1: command not found: codex",
        timedOut: false,
        tooMuchOutput: false,
      },
      expected: {
        who: "",
        whoDetail:
          "codex app-server (account/read) was not found: zsh:1: command not found: codex (0 lines on stdout, not shown)",
      },
    },
  ])("codex account/read: $name", ({ result, expected }) => {
    const out = parseCodexAccountRead(result);
    expect(out).toMatchObject(expected);
    expect(Object.keys(out).sort()).toEqual(["plan", "who", "whoDetail"]);
    expect(JSON.stringify(out)).not.toContain("sample-account-id");
  });

  const codexAccount = {
    id: "sample-id",
    agent: "codex" as const,
    name: "work",
    configDir: "/home/sample/codex-work",
    builtin: false,
    managed: true,
  };

  test("codex: asks app-server only when signed in with ChatGPT, in the account's CODEX_HOME", async () => {
    const calls: Array<{ args: string[]; home: string | undefined }> = [];
    let status = "Logged in using ChatGPT\n";
    const checker = createLoginChecker({
      async run() {
        return ok("", status.startsWith("Not") ? 1 : 0, status);
      },
      async rpc(args, env, requests, done) {
        calls.push({ args, home: env.CODEX_HOME });
        expect(requests).toEqual(ACCOUNT_READ_REQUESTS);
        const line = answer({
          account: { type: "chatgpt", email: EMAIL, planType: "pro" },
        });
        expect(done('{"id":1,"result":{}}')).toBe(false);
        expect(done(line)).toBe(true);
        return rpcOk(line);
      },
      now: () => 0,
      markOnboarded: async () => ({ status: "already" as const }),
    });
    await expect(checker.status(codexAccount, "codex")).resolves.toMatchObject({
      state: "logged-in",
      method: "ChatGPT",
      who: EMAIL,
      plan: "pro",
    });
    expect(calls).toEqual([
      {
        args: accountReadArgv("codex"),
        home: "/home/sample/codex-work",
      },
    ]);
    status = "Not logged in\n";
    await expect(
      checker.status(codexAccount, "codex", true),
    ).resolves.toMatchObject({ state: "logged-out", who: "" });
    status = "Logged in using an API key - sk-sample***TAIL\n";
    await expect(
      checker.status(codexAccount, "codex", true),
    ).resolves.toMatchObject({
      state: "logged-in",
      who: "",
      whoDetail: "signed in with API key, which has no email",
    });
    expect(calls).toHaveLength(1);
  });

  test("codex: app-server failing to start keeps the sign-in and says why there is no email", async () => {
    const checker = createLoginChecker({
      async run() {
        return ok("", 0, "Logged in using ChatGPT\n");
      },
      async rpc() {
        throw new Error("spawn /bin/sample-shell ENOENT");
      },
      now: () => 0,
      markOnboarded: async () => ({ status: "already" as const }),
    });
    const login = await checker.status(codexAccount, "codex");
    expect(login).toMatchObject({ state: "logged-in", who: "" });
    expect(login.whoDetail).toContain(
      "codex app-server could not run: Error: spawn /bin/sample-shell ENOENT",
    );
  });

  test("an app-server that floods stdout is stopped and says so", async () => {
    const fake =
      "process.stdout.write('x'.repeat(2 * 1024 * 1024)); setInterval(() => {}, 1000);";
    const result = await DEFAULT_LOGIN_DEPS.rpc(
      [process.execPath, "-e", fake],
      process.env,
      ACCOUNT_READ_REQUESTS,
      () => false,
    );
    expect(result).toMatchObject({
      code: null,
      timedOut: false,
      tooMuchOutput: true,
    });
    expect(parseCodexAccountRead(result).whoDetail).toBe(
      `codex app-server (account/read) was stopped after writing more than 1048576 bytes to stdout (${result.lines.length} lines on stdout, not shown)`,
    );
  });

  // 先に終わった app-server への書き込みは EPIPE になる (よく起きる)。これは
  // runtime.ts の onStdinWriteFailure が許す側なので失敗にしない: 終了コードは
  // 子のまま、先に届いた答えも読める。29d までは stderr に `[stdin] … EPIPE` を
  // 足していたが、結果の扱いは同じ。
  test("an app-server that closes stdin early (EPIPE) is not a failure", async () => {
    const fake = [
      "process.stdin.destroy();",
      `process.stdout.write(JSON.stringify({ id: ${ACCOUNT_READ_ID}, result: { account: { type: 'chatgpt', email: 'sample@example.invalid', planType: 'pro' } } }) + '\\n');`,
      "setTimeout(() => process.exit(0), 300);",
    ].join("\n");
    const result = await DEFAULT_LOGIN_DEPS.rpc(
      [process.execPath, "-e", fake],
      process.env,
      ["x".repeat(1024 * 1024)],
      () => false,
    );
    expect(result).toMatchObject({
      code: 0,
      stderr: "",
      timedOut: false,
      tooMuchOutput: false,
    });
    expect(parseCodexAccountRead(result)).toEqual({
      who: "sample@example.invalid",
      plan: "pro",
      whoDetail: "",
    });
  });

  // EPIPE 以外の書き込みの失敗は、入力が届いていないので失敗 (exit 1) にし、
  // 理由を残す。子は 0 で終わっても 1。
  test("a stdin write failure that is not EPIPE fails the exchange with its reason", async () => {
    vi.resetModules();
    const { EventEmitter } = await import("node:events");
    const { PassThrough, Writable } = await import("node:stream");
    const child = new EventEmitter() as InstanceType<typeof EventEmitter> & {
      stdin: InstanceType<typeof Writable>;
      stdout: InstanceType<typeof PassThrough>;
      stderr: InstanceType<typeof PassThrough>;
      kill(signal?: string): void;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error("write EACCES"), { code: "EACCES" }));
      },
    });
    child.kill = () => {
      // 偽の子には送る先が無い (pid も無いので stopProcess は送らない)。
    };
    vi.doMock("node:child_process", async () => ({
      ...(await vi.importActual<typeof import("node:child_process")>(
        "node:child_process",
      )),
      spawn: () => child,
    }));
    try {
      const login = await import("../server/accounts/login");
      const pending = login.DEFAULT_LOGIN_DEPS.rpc(
        ["anything"],
        process.env,
        login.ACCOUNT_READ_REQUESTS,
        () => false,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);

      const result = await pending;
      expect(result).toMatchObject({
        code: 1,
        stderr: '[stdin] Error: write EACCES\nDetails: {"code":"EACCES"}',
      });
      expect(login.parseCodexAccountRead(result).whoDetail).toBe(
        "codex app-server (account/read) exited with 1 without answering: [stdin] Error: write EACCES (0 lines on stdout, not shown)",
      );
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  test("the app-server exchange keeps stdin open until the answer, then closes it", async () => {
    // 本物の codex の振る舞い: stdin が閉じたら答える前に終わる。答えは
    // account/read を受け取ってから 1 行で返す。
    const fake = [
      "let buf = '';",
      "process.stdin.on('data', (c) => { buf += c;",
      "  for (const line of buf.split('\\n').slice(0, -1)) {",
      "    const m = JSON.parse(line);",
      "    if (m.method === 'account/read') setTimeout(() => process.stdout.write(JSON.stringify({ id: m.id, result: { account: { type: 'chatgpt', email: 'sample@example.invalid', planType: 'pro' } } }) + '\\n'), 50);",
      "  }",
      "  buf = buf.slice(buf.lastIndexOf('\\n') + 1); });",
      "process.stdin.on('end', () => process.exit(0));",
    ].join("\n");
    const result = await DEFAULT_LOGIN_DEPS.rpc(
      [process.execPath, "-e", fake],
      process.env,
      ACCOUNT_READ_REQUESTS,
      (line) => line.includes(`"id":${ACCOUNT_READ_ID}`),
    );
    expect(result).toMatchObject({ code: 0, timedOut: false });
    expect(parseCodexAccountRead(result)).toEqual({
      who: "sample@example.invalid",
      plan: "pro",
      whoDetail: "",
    });
  });

  test("the account list carries the email and plan, never other fields, and logs nothing from the output", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (name) => vi.spyOn(console, name),
    );
    try {
      mkdirSync(join(paths.home, ".claude"), { recursive: true });
      const service = createAccountService(
        paths,
        createProcessEnvProber({
          async listProcesses() {
            return [];
          },
          async readAccountEnv() {
            return new Map();
          },
          now: () => AT,
        }),
        createLoginChecker({
          async run(args) {
            return args.includes("--json")
              ? ok(
                  `${SHELL_NOISE}${signedIn.replace('"loggedIn": true,', '"loggedIn": true, "accessToken": "sample-token-SECRET",')}`,
                )
              : ok("", 0, "Logged in using ChatGPT\n");
          },
          async rpc() {
            return rpcOk(
              answer({
                account: { type: "chatgpt", email: EMAIL, planType: "pro" },
                workspaceRouting: { chatgptAccountId: "sample-account-id" },
                tokens: { access_token: "sample-codex-SECRET" },
              }),
            );
          },
          now: () => AT,
          markOnboarded: async () => ({ status: "already" as const }),
        }),
      );
      const body = JSON.stringify(
        await service.overview({ serverRoot: root, forceLogin: true }),
      );
      const claude = JSON.parse(body).accounts.find(
        (account: { id: string }) => account.id === "claude:default",
      );
      expect(claude.login).toMatchObject({
        state: "logged-in",
        who: EMAIL,
        plan: "max",
      });
      const codex = JSON.parse(body).accounts.find(
        (account: { id: string }) => account.id === "codex:default",
      );
      expect(codex.login).toMatchObject({
        state: "logged-in",
        who: EMAIL,
        plan: "pro",
      });
      expect(body).not.toMatch(/SECRET|sample-account-id|sample-org-id/);
      for (const spy of spies) {
        expect(JSON.stringify(spy.mock.calls)).not.toMatch(
          /sample@example|SECRET/,
        );
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
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
        return ok('{"loggedIn":true}');
      },
      async rpc() {
        throw new Error("claude does not use app-server");
      },
      now: () => 0,
      markOnboarded: async () => ({ status: "already" as const }),
    });
    const account = {
      id: "claude:default",
      agent: "claude" as const,
      name: "",
      configDir: "/home/sample/.claude",
      builtin: true,
      managed: false,
    };
    await checker.status(account, "claude");
    await checker.status(account, "claude");
    await checker.status(account, "claude", true);
    expect(runs).toBe(2);
    // 起動コマンドを変えたら、覚えた答えを使わずに訊き直す。
    await checker.status(account, "/opt/sample/claude");
    expect(runs).toBe(3);
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
  ] as const)("%s: runs the command with separate arguments, then waits for Enter in the same shell", (agent) => {
    // 起動コマンドの代わりに printf。足す引数 (auth login / login) がそのまま届き、
    // 同じシェルの中で Enter を待ってから閉じる。
    const argv = loginWindowArgv(agent, "printf '[%s]'", { SHELL: "/bin/sh" });
    const out = spawnSync(argv[0] ?? "", argv.slice(1), {
      input: "\n",
      encoding: "utf8",
    });
    expect(out.stdout).toBe(
      `${agent === "claude" ? "[auth][login]" : "[login]"}\n[code-viewer] sign-in command exited with 0. Press Enter to close this window.\n`,
    );
    expect(out.status).toBe(0);
  });
});

describe("the launch command is the one login and status use", () => {
  const command = "/opt/sample/bin/wrapper --profile 'a b'";
  const shell = interactiveShell();
  test.each([
    {
      name: "claude login",
      argv: loginWindowArgv("claude", command),
      args: ["auth", "login"],
    },
    {
      name: "claude status",
      argv: loginStatusArgv("claude", command),
      args: ["auth", "status", "--json"],
    },
    {
      name: "codex login",
      argv: loginWindowArgv("codex", command),
      args: ["login"],
    },
    {
      name: "codex status",
      argv: loginStatusArgv("codex", command),
      args: ["login", "status"],
    },
  ])("$name runs the configured command", ({ argv, args }) => {
    // ログインは同じシェルで Enter を待つ文が続くので、先頭だけ見る。
    expect(argv.slice(0, 3)).toEqual([shell, "-i", "-c"]);
    expect(argv[3]?.startsWith(`${command} "$@"`)).toBe(true);
    expect(argv.slice(4)).toEqual([shell, ...args]);
  });

  test("the added arguments reach the command unchanged", () => {
    const argv = agentCommandArgv("printf '[%s]'", ["it's", "$HOME"], {
      SHELL: "/bin/sh",
    });
    const out = spawnSync(argv[0] ?? "", argv.slice(1), { encoding: "utf8" });
    expect(out.stdout).toBe("[it's][$HOME]");
  });
});
