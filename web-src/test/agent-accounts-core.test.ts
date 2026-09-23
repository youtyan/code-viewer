// アカウントの登録簿・環境変数からの判定・起動の引数の純ロジック。
// パスはすべて架空 (/home/sample 配下)。

import { describe, expect, test } from "vitest";
import {
  type AccountEntry,
  type AccountRegistry,
  accountDirSlug,
  accountEntries,
  accountForEnv,
  addAccount,
  checkAddAccount,
  checkShareSelection,
  classifyShareEntry,
  claudeAuthKeys,
  codexAuthKeys,
  defaultLaunchSession,
  emptyAccountRegistry,
  LOGIN_SESSION,
  launchCommandLine,
  normalizeConfigDir,
  parseAccountRegistry,
  pickAccountEnv,
  RESERVED_ACCOUNT_NAMES,
  removeAccount,
  renameAccount,
  type ShareEntry,
  showPaneAccounts,
  tmuxLaunchArgs,
  tmuxSessionName,
  usageIsStale,
  usageWindowsConflict,
  usageWindowViews,
} from "../core/agent-accounts";

const HOME = "/home/sample";
const WORK = "/home/sample/.local/state/code-viewer/accounts/claude-work";

function registry(
  accounts: Partial<AccountRegistry["accounts"][number]>[] = [],
): AccountRegistry {
  return {
    ...emptyAccountRegistry(),
    accounts: accounts.map((account, index) => ({
      id: `id-${index}`,
      agent: "claude",
      name: `Sample ${index}`,
      configDir: `/home/sample/accounts/a${index}`,
      managed: false,
      createdAt: 1,
      ...account,
    })),
  };
}

describe("parseAccountRegistry", () => {
  test("reads a well-formed registry", () => {
    const parsed = parseAccountRegistry({
      version: 1,
      accounts: [
        {
          id: "a1",
          agent: "codex",
          name: " Personal ",
          configDir: "/home/sample/.codex-personal",
          managed: false,
          createdAt: 5,
        },
      ],
      launchCommands: { claude: " claude-wrapper ", codex: "" },
      lastLaunch: {
        agent: "codex",
        accountId: "a1",
        project: "/work/sample-repo",
        session: "sample",
      },
    });
    expect(parsed).toEqual({
      ok: true,
      registry: {
        version: 1,
        accounts: [
          {
            id: "a1",
            agent: "codex",
            name: "Personal",
            configDir: "/home/sample/.codex-personal",
            managed: false,
            createdAt: 5,
          },
        ],
        launchCommands: { claude: "claude-wrapper" },
        lastLaunch: {
          agent: "codex",
          accountId: "a1",
          project: "/work/sample-repo",
          session: "sample",
        },
      },
    });
  });

  test.each([
    { name: "not an object", raw: [], issue: "$: the file must contain" },
    {
      name: "wrong version",
      raw: { version: 2, accounts: [] },
      issue: "$.version",
    },
    {
      name: "accounts not an array",
      raw: { version: 1, accounts: {} },
      issue: "$.accounts: must be an array",
    },
    {
      name: "unknown agent",
      raw: {
        version: 1,
        accounts: [
          {
            id: "a",
            agent: "other",
            name: "x",
            configDir: "/x",
            managed: false,
            createdAt: 1,
          },
        ],
      },
      issue: "$.accounts[0].agent",
    },
    {
      name: "relative path",
      raw: {
        version: 1,
        accounts: [
          {
            id: "a",
            agent: "claude",
            name: "x",
            configDir: "x",
            managed: false,
            createdAt: 1,
          },
        ],
      },
      issue: "$.accounts[0].configDir",
    },
    {
      name: "a default id",
      raw: {
        version: 1,
        accounts: [
          {
            id: "claude:default",
            agent: "claude",
            name: "x",
            configDir: "/x",
            managed: false,
            createdAt: 1,
          },
        ],
      },
      issue: "$.accounts[0].id",
    },
    {
      name: "the same directory twice",
      raw: {
        version: 1,
        accounts: [
          {
            id: "a",
            agent: "claude",
            name: "x",
            configDir: "/x",
            managed: false,
            createdAt: 1,
          },
          {
            id: "b",
            agent: "claude",
            name: "y",
            configDir: "/x/",
            managed: false,
            createdAt: 1,
          },
        ],
      },
      issue: "is registered twice",
    },
    {
      name: "a control character in a command",
      raw: {
        version: 1,
        accounts: [],
        launchCommands: { claude: `claude${String.fromCharCode(10)}rm` },
      },
      issue: "$.launchCommands.claude",
    },
    {
      name: "a broken lastLaunch",
      raw: { version: 1, accounts: [], lastLaunch: { agent: "claude" } },
      issue: "$.lastLaunch",
    },
  ])("refuses $name and says where", ({ raw, issue }) => {
    const parsed = parseAccountRegistry(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) {
      expect(parsed.issues.join("\n")).toContain(issue);
    }
  });
});

describe("adding and removing", () => {
  test.each([
    {
      name: "a new directory",
      input: { name: "Work", configDir: WORK },
      expected: null,
    },
    {
      name: "an empty name",
      input: { name: "  ", configDir: WORK },
      expected: { code: "name", issue: "empty" },
    },
    {
      name: "a relative path",
      input: { name: "Work", configDir: "accounts/work" },
      expected: { code: "relative-path", configDir: "accounts/work" },
    },
    {
      name: "the default directory",
      input: { name: "Work", configDir: "/home/sample/.claude/" },
      expected: { code: "default-path", configDir: "/home/sample/.claude" },
    },
    {
      name: "a directory that is already registered (trailing slash)",
      input: { name: "Again", configDir: "/home/sample/accounts/a0/" },
      expected: {
        code: "duplicate-path",
        configDir: "/home/sample/accounts/a0",
        existing: "Sample 0",
      },
    },
  ])("$name", ({ input, expected }) => {
    expect(
      checkAddAccount(
        registry([{}]),
        { agent: "claude", managed: false, ...input },
        HOME,
      ),
    ).toEqual(expected);
  });

  test("the same directory may be registered for the other agent", () => {
    expect(
      checkAddAccount(
        registry([{}]),
        {
          agent: "codex",
          name: "x",
          configDir: "/home/sample/accounts/a0",
          managed: false,
        },
        HOME,
      ),
    ).toBeNull();
  });

  test("adding normalizes the path and trims the name", () => {
    const next = addAccount(
      emptyAccountRegistry(),
      { agent: "claude", name: " Work ", configDir: `${WORK}/`, managed: true },
      "new-id",
      9,
    );
    expect(next.accounts).toEqual([
      {
        id: "new-id",
        agent: "claude",
        name: "Work",
        configDir: WORK,
        managed: true,
        createdAt: 9,
      },
    ]);
  });

  test.each([
    { id: "claude:default", expected: { ok: false, code: "builtin" } },
    { id: "codex:default", expected: { ok: false, code: "builtin" } },
    { id: "missing", expected: { ok: false, code: "not-found" } },
  ])("removing $id is refused", ({ id, expected }) => {
    expect(removeAccount(registry([{}]), id)).toEqual(expected);
  });

  test("removing drops the entry and a lastLaunch that pointed at it", () => {
    const base = {
      ...registry([{}, {}]),
      lastLaunch: {
        agent: "claude" as const,
        accountId: "id-1",
        project: "/work/sample-repo",
        session: "sample",
      },
    };
    const result = removeAccount(base, "id-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.registry.accounts.map((account) => account.id)).toEqual([
        "id-0",
      ]);
      expect(result.registry.lastLaunch).toBeNull();
      expect(result.removed.id).toBe("id-1");
    }
  });

  // 表示名の変更。同じ種類の中で重なる名前・既定のアカウントの表示名と同じ
  // 名前・空などは、理由の種類を返して断る。自分と同じ名前 (大文字小文字だけ
  // 違うものを含む) は通す。
  test.each([
    {
      name: "renames a registered account",
      id: "id-1",
      next: "  Work laptop ",
      expected: { ok: true, name: "Work laptop" },
    },
    {
      name: "keeps its own name with a different case",
      id: "id-1",
      next: "sample 1",
      expected: { ok: true, name: "sample 1" },
    },
    {
      name: "the same name as another account of the same agent",
      id: "id-1",
      next: "SAMPLE 0",
      expected: { ok: false, code: "duplicate", existing: "Sample 0" },
    },
    {
      name: "the same name as an account of the other agent is fine",
      id: "id-1",
      next: "Sample 2",
      expected: { ok: true, name: "Sample 2" },
    },
    {
      name: "the English name of the default account",
      id: "id-1",
      next: "default",
      expected: { ok: false, code: "reserved" },
    },
    {
      name: "the Japanese name of the default account",
      id: "id-1",
      next: "既定",
      expected: { ok: false, code: "reserved" },
    },
    {
      name: "an empty name",
      id: "id-1",
      next: "   ",
      expected: { ok: false, code: "name", issue: "empty" },
    },
    {
      name: "the default account",
      id: "claude:default",
      next: "Mine",
      expected: { ok: false, code: "builtin" },
    },
    {
      name: "an unknown account",
      id: "missing",
      next: "Mine",
      expected: { ok: false, code: "not-found" },
    },
  ])("rename: $name", ({ id, next, expected }) => {
    const base = registry([{}, {}, { agent: "codex" }]);
    const result = renameAccount(base, id, next);
    if (result.ok) {
      expect({ ok: true, name: result.renamed.name }).toEqual(expected);
      expect(
        result.registry.accounts.map((account) => [account.id, account.name]),
      ).toEqual([
        ["id-0", "Sample 0"],
        ["id-1", result.renamed.name],
        ["id-2", "Sample 2"],
      ]);
    } else {
      expect(result).toEqual(expected);
    }
  });

  // 画面が既定のアカウントに付ける名前 (accounts-i18n の defaultName) は、
  // 登録するアカウントの名前に使えない一覧と同じでなければならない。
  test("reserved names cover every display name of the default account", async () => {
    const { ACCOUNTS_EN, ACCOUNTS_JA } = await import(
      "../views/agents/accounts-i18n"
    );
    expect(
      [ACCOUNTS_EN.defaultName, ACCOUNTS_JA.defaultName].map((name) =>
        name.toLocaleLowerCase(),
      ),
    ).toEqual([...RESERVED_ACCOUNT_NAMES]);
  });

  test("entries put the default first for each agent", () => {
    const list = accountEntries(
      registry([{ agent: "codex", name: "Personal" }, { name: "Work" }]),
      HOME,
      { claude: "Default", codex: "Default" },
    );
    expect(
      list.map((entry) => [
        entry.id,
        entry.name,
        entry.builtin,
        entry.configDir,
      ]),
    ).toEqual([
      ["claude:default", "Default", true, "/home/sample/.claude"],
      ["id-1", "Work", false, "/home/sample/accounts/a1"],
      ["codex:default", "Default", true, "/home/sample/.codex"],
      ["id-0", "Personal", false, "/home/sample/accounts/a0"],
    ]);
  });
});

describe("accountForEnv", () => {
  const entries: AccountEntry[] = accountEntries(
    registry([{ configDir: WORK }]),
    HOME,
    { claude: "", codex: "" },
  );
  test.each([
    {
      name: "unset",
      value: undefined,
      expected: { kind: "default", id: "claude:default" },
    },
    {
      name: "empty",
      value: "",
      expected: { kind: "default", id: "claude:default" },
    },
    {
      name: "the default written out",
      value: "/home/sample/.claude/",
      expected: { kind: "default", id: "claude:default" },
    },
    {
      name: "registered",
      value: WORK,
      expected: { kind: "registered", id: "id-0" },
    },
    {
      name: "registered with a trailing slash",
      value: `${WORK}/`,
      expected: { kind: "registered", id: "id-0" },
    },
    {
      name: "unregistered",
      value: "/home/sample/other",
      expected: { kind: "unregistered", configDir: "/home/sample/other" },
    },
    {
      name: "relative",
      value: "other",
      expected: { kind: "unregistered", configDir: "other" },
    },
  ])("$name", ({ value, expected }) => {
    expect(accountForEnv("claude", value, entries, HOME)).toEqual(expected);
  });

  test("a claude directory does not match for codex", () => {
    expect(accountForEnv("codex", WORK, entries, HOME)).toEqual({
      kind: "unregistered",
      configDir: WORK,
    });
  });
});

describe("pickAccountEnv", () => {
  // ps eww の 1 行 (引数の後ろに環境変数)。値はすべて架空。
  const SECRET = "sample-secret-value";
  test.each([
    {
      name: "neither variable",
      line: `claude --model sample HOME=/home/sample ANTHROPIC_API_KEY=${SECRET} TERM=xterm`,
      expected: {},
    },
    {
      name: "CLAUDE_CONFIG_DIR between other variables",
      line: `claude HOME=/home/sample CLAUDE_CONFIG_DIR=${WORK} ANTHROPIC_API_KEY=${SECRET}`,
      expected: { CLAUDE_CONFIG_DIR: WORK },
    },
    {
      name: "a value with spaces",
      line: `codex OPENAI_API_KEY=${SECRET} CODEX_HOME=/home/sample/my codex PATH=/usr/bin`,
      expected: { CODEX_HOME: "/home/sample/my codex" },
    },
    {
      name: "the last variable on the line",
      line: `codex TERM=xterm CODEX_HOME=/home/sample/.codex-personal`,
      expected: { CODEX_HOME: "/home/sample/.codex-personal" },
    },
    {
      name: "the same name in the arguments and the environment",
      line: `env CODEX_HOME=/arg codex CODEX_HOME=/env TERM=x`,
      expected: { CODEX_HOME: "/env" },
    },
  ])("$name", ({ line, expected }) => {
    const picked = pickAccountEnv(line);
    expect(picked).toEqual(expected);
    // ほかの変数は、名前も値も結果に入らない。
    expect(JSON.stringify(picked)).not.toContain(SECRET);
    expect(JSON.stringify(picked)).not.toContain("API_KEY");
  });
});

describe("showPaneAccounts", () => {
  test.each([
    {
      name: "defaults only",
      registered: 0,
      panes: [{ account: { kind: "default" as const, id: "claude:default" } }],
      expected: false,
    },
    {
      name: "no agents",
      registered: 0,
      panes: [{ account: null }],
      expected: false,
    },
    {
      name: "a registered account exists",
      registered: 1,
      panes: [],
      expected: true,
    },
    {
      name: "an agent on an unregistered directory",
      registered: 0,
      panes: [{ account: { kind: "unregistered" as const, configDir: "/x" } }],
      expected: true,
    },
    {
      name: "an agent on an unknown account",
      registered: 0,
      panes: [{ account: { kind: "unknown" as const, reason: "x" } }],
      expected: true,
    },
  ])("$name → $expected", ({ registered, panes, expected }) => {
    expect(showPaneAccounts(registered, panes)).toBe(expected);
  });
});

describe("usage windows from two accounts in one config directory", () => {
  const fiveHours = (usedPercent: number, resetsAt: number) => ({
    kind: "five_hour" as const,
    minutes: 300,
    usedPercent,
    resetsAt,
  });
  const week = (usedPercent: number, resetsAt: number) => ({
    kind: "seven_day" as const,
    minutes: 10080,
    usedPercent,
    resetsAt,
  });
  const HOUR = 60 * 60_000;
  test.each([
    {
      name: "a normal five-hour reset advances after the old window ended",
      newer: { windows: [fiveHours(4, 910 * HOUR)], observedAt: 906 * HOUR },
      older: { windows: [fiveHours(97, 905 * HOUR)], observedAt: 900 * HOUR },
      expected: false,
    },
    {
      name: "a normal weekly reset advances after the old window ended",
      newer: { windows: [week(4, 1_068 * HOUR)], observedAt: 901 * HOUR },
      older: { windows: [week(97, 900 * HOUR)], observedAt: 800 * HOUR },
      expected: false,
    },
    {
      name: "the newer observation moving reset backward is another account",
      newer: { windows: [week(0, 850 * HOUR)], observedAt: 910 * HOUR },
      older: { windows: [week(97, 1_000 * HOUR)], observedAt: 900 * HOUR },
      expected: true,
    },
    {
      name: "two reset times observed together while the old window is active conflict",
      newer: { windows: [week(0, 1_150 * HOUR)], observedAt: 900 * HOUR },
      older: { windows: [week(97, 1_000 * HOUR)], observedAt: 900 * HOUR },
      expected: true,
    },
    {
      name: "the same reset time is the same account",
      newer: { windows: [week(98, 1_000 * HOUR)], observedAt: 910 * HOUR },
      older: { windows: [week(97, 1_000 * HOUR)], observedAt: 900 * HOUR },
      expected: false,
    },
    {
      name: "reset times within the tolerance (clock drift)",
      newer: {
        windows: [week(97, 1_000 * HOUR + 30 * 60_000)],
        observedAt: 900 * HOUR,
      },
      older: { windows: [week(97, 1_000 * HOUR)], observedAt: 900 * HOUR },
      expected: false,
    },
    {
      name: "different windows are not compared",
      newer: { windows: [fiveHours(0, 5 * HOUR)], observedAt: HOUR },
      older: { windows: [week(97, 1_000 * HOUR)], observedAt: HOUR },
      expected: false,
    },
    {
      name: "a window without a reset time cannot conflict",
      newer: { windows: [week(0, 1_150 * HOUR)], observedAt: 900 * HOUR },
      older: { windows: [week(97, 0)], observedAt: 800 * HOUR },
      expected: false,
    },
  ])("usageWindowsConflict: $name", ({ newer, older, expected }) => {
    expect(usageWindowsConflict(newer, older)).toBe(expected);
  });
});

describe("usage windows", () => {
  const NOW = 1_000_000_000_000;
  test.each([
    { used: 79.9, resetsAt: NOW + 1, warn: false, expired: false },
    { used: 80, resetsAt: NOW + 1, warn: true, expired: false },
    { used: 99, resetsAt: NOW, warn: false, expired: true },
    { used: 95, resetsAt: 0, warn: true, expired: false },
  ])("$used% resetting at $resetsAt → warn $warn, expired $expired", ({
    used,
    resetsAt,
    warn,
    expired,
  }) => {
    const [view] = usageWindowViews(
      {
        status: "ok",
        observedAt: NOW,
        windows: [
          { kind: "five_hour", minutes: 300, usedPercent: used, resetsAt },
        ],
      },
      NOW,
    );
    expect(view).toMatchObject({ warn, expired });
  });

  test("windows are shown 5 hours, then week, then others", () => {
    const views = usageWindowViews(
      {
        status: "ok",
        observedAt: 1,
        windows: [
          { kind: "other", minutes: 60, usedPercent: 1, resetsAt: 0 },
          { kind: "seven_day", minutes: 10080, usedPercent: 1, resetsAt: 0 },
          { kind: "five_hour", minutes: 300, usedPercent: 1, resetsAt: 0 },
        ],
      },
      1,
    );
    expect(views.map((view) => view.window.kind)).toEqual([
      "five_hour",
      "seven_day",
      "other",
    ]);
  });

  test.each([
    { age: 29 * 60_000, stale: false },
    { age: 31 * 60_000, stale: true },
  ])("a value $age ms old is stale: $stale", ({ age, stale }) => {
    expect(usageIsStale(NOW - age, NOW)).toBe(stale);
  });
});

describe("auth-related keys in shared settings (names only)", () => {
  test.each([
    { name: "none", root: { model: "x" }, expected: [] },
    {
      name: "apiKeyHelper",
      root: { apiKeyHelper: "/bin/helper" },
      expected: ["apiKeyHelper"],
    },
    {
      name: "env keys",
      root: {
        env: {
          ANTHROPIC_API_KEY: "v",
          OTHER: "v",
          CLAUDE_CODE_OAUTH_TOKEN: "v",
        },
      },
      expected: ["env.ANTHROPIC_API_KEY", "env.CLAUDE_CODE_OAUTH_TOKEN"],
    },
  ])("claude: $name", ({ root, expected }) => {
    expect(claudeAuthKeys(root)).toEqual(expected);
  });

  test.each([
    { text: 'model = "x"\n', expected: [] },
    {
      text: [
        "[model_providers.sample]",
        'experimental_bearer_token = "v"',
        "",
      ].join("\n"),
      expected: ["experimental_bearer_token"],
    },
    {
      text: 'model_providers.sample.bearer_token = "v"\n',
      expected: ["bearer_token"],
    },
  ])("codex: %#", ({ text, expected }) => {
    expect(codexAuthKeys(text)).toEqual(expected);
  });
});

describe("launch", () => {
  test.each([
    {
      name: "default account in an existing session",
      request: { configDir: null, sessionExists: true },
      expected: [
        "new-window",
        "-t",
        "=sample:",
        "-n",
        "claude",
        "-P",
        "-F",
        "#{pane_id}",
        "-c",
        "/work/sample repo's",
        "--",
        "env",
        "-u",
        "CLAUDE_CONFIG_DIR",
        "/bin/zsh",
        "-i",
        "-c",
        "claude",
      ],
    },
    {
      name: "registered account in a new session",
      request: { configDir: "/home/sample/it's a dir", sessionExists: false },
      expected: [
        "new-session",
        "-d",
        "-s",
        "sample",
        "-n",
        "claude",
        "-P",
        "-F",
        "#{pane_id}",
        "-c",
        "/work/sample repo's",
        "--",
        "env",
        "CLAUDE_CONFIG_DIR=/home/sample/it's a dir",
        "/bin/zsh",
        "-i",
        "-c",
        "claude",
      ],
    },
  ])("$name: paths stay single arguments", ({ request, expected }) => {
    expect(
      tmuxLaunchArgs({
        agent: "claude",
        cwd: "/work/sample repo's",
        session: "sample",
        windowName: "claude",
        argv: ["/bin/zsh", "-i", "-c", "claude"],
        ...request,
      }),
    ).toEqual(expected);
  });

  test("codex uses CODEX_HOME", () => {
    expect(
      tmuxLaunchArgs({
        agent: "codex",
        configDir: "/home/sample/.codex-personal",
        cwd: "/work",
        session: "s",
        sessionExists: true,
        windowName: "codex",
        argv: ["codex"],
      }).slice(-2),
    ).toEqual(["CODEX_HOME=/home/sample/.codex-personal", "codex"]);
  });

  test.each([
    { name: "sample.repo", expected: "sample-repo" },
    { name: "a:b c", expected: "a-b-c" },
    { name: "...", expected: "agents" },
  ])("session name $name → $expected", ({ name, expected }) => {
    expect(tmuxSessionName(name)).toBe(expected);
  });

  test.each([
    {
      name: "the session with most panes of the project",
      panes: [
        { project: "/p", session: "a" },
        { project: "/p", session: "b" },
        { project: "/p", session: "b" },
        { project: "/q", session: "c" },
      ],
      expected: { session: "b", exists: true },
    },
    {
      name: "the login session is not a launch target",
      panes: [{ project: "/p", session: LOGIN_SESSION }],
      expected: { session: "fallback", exists: false },
    },
    {
      name: "no pane of the project",
      panes: [{ project: "/q", session: "c" }],
      expected: { session: "fallback", exists: false },
    },
  ])("$name", ({ panes, expected }) => {
    expect(defaultLaunchSession("/p", panes, "fallback")).toEqual(expected);
  });
});

describe("paths", () => {
  test.each([
    ["/a/b/", "/a/b"],
    ["/a//b/./c", "/a/b/c"],
    ["/a/b/../c", "/a/c"],
  ])("normalizeConfigDir(%s) = %s", (input, expected) => {
    expect(normalizeConfigDir(input)).toBe(expected);
  });

  test.each([
    ["Work", "work"],
    ["仕事用", "account"],
    ["Team A / B", "team-a-b"],
  ])("accountDirSlug(%s) = %s", (input, expected) => {
    expect(accountDirSlug(input)).toBe(expected);
  });
});

describe("what a new account may share", () => {
  test.each([
    // 公式の「利用者の設定」: 共有する (既定でオン)
    {
      agent: "claude",
      name: "settings.json",
      category: "shared",
      reason: null,
    },
    {
      agent: "claude",
      name: "keybindings.json",
      category: "shared",
      reason: null,
    },
    { agent: "claude", name: "skills", category: "shared", reason: null },
    { agent: "codex", name: "config.toml", category: "shared", reason: null },
    { agent: "codex", name: "rules", category: "shared", reason: null },
    // 決め打ちの「共有できない」
    {
      agent: "claude",
      name: ".credentials.json",
      category: "blocked",
      reason: "auth",
    },
    {
      agent: "claude",
      name: ".claude.json",
      category: "blocked",
      reason: "identity",
    },
    {
      agent: "claude",
      name: "backups",
      category: "blocked",
      reason: "identity",
    },
    {
      agent: "claude",
      name: "projects",
      category: "blocked",
      reason: "history",
    },
    {
      agent: "claude",
      name: "sessions",
      category: "blocked",
      reason: "session",
    },
    {
      agent: "claude",
      name: "paste-cache",
      category: "blocked",
      reason: "cache",
    },
    { agent: "claude", name: "daemon", category: "blocked", reason: "state" },
    { agent: "codex", name: "auth.json", category: "blocked", reason: "auth" },
    {
      agent: "codex",
      name: "installation_id",
      category: "blocked",
      reason: "identity",
    },
    {
      agent: "codex",
      name: "sessions",
      category: "blocked",
      reason: "session",
    },
    // 名前の形 (データベース・ロック・一時ファイル)
    {
      agent: "codex",
      name: "sample_5.sqlite-wal",
      category: "blocked",
      reason: "state",
    },
    {
      agent: "claude",
      name: "daemon.lock",
      category: "blocked",
      reason: "state",
    },
    {
      agent: "claude",
      name: "sample.tmp",
      category: "blocked",
      reason: "state",
    },
    // 名前から認証を疑うもの
    {
      agent: "claude",
      name: "sample-token.txt",
      category: "blocked",
      reason: "suspect",
    },
    {
      agent: "claude",
      name: "oauth-sample",
      category: "blocked",
      reason: "suspect",
    },
    {
      agent: "claude",
      name: "sample.key",
      category: "blocked",
      reason: "suspect",
    },
    {
      agent: "claude",
      name: "sample-api-key",
      category: "blocked",
      reason: "suspect",
    },
    { agent: "claude", name: ".env", category: "blocked", reason: "suspect" },
    {
      agent: "codex",
      name: "sample-secrets",
      category: "blocked",
      reason: "suspect",
    },
    {
      agent: "codex",
      name: "mcp-oauth-locks",
      category: "blocked",
      reason: "suspect",
    },
    // 公式の一覧に無い未知のもの: 選べば共有できる (既定でオフ)
    { agent: "claude", name: "plugins", category: "optional", reason: null },
    { agent: "claude", name: "mcp.json", category: "optional", reason: null },
    {
      agent: "claude",
      name: "statusline-command.sh",
      category: "optional",
      reason: null,
    },
    {
      agent: "claude",
      name: "settings.sample.json",
      category: "optional",
      reason: null,
    },
    {
      agent: "codex",
      name: "keybindings.json",
      category: "optional",
      reason: null,
    },
    { agent: "codex", name: "skills", category: "optional", reason: null },
  ] as const)("$agent $name → $category", ({
    agent,
    name,
    category,
    reason,
  }) => {
    expect(classifyShareEntry(agent, name)).toEqual({ category, reason });
  });

  const ENTRIES: ShareEntry[] = [
    {
      name: "settings.json",
      target: "/d/settings.json",
      directory: false,
      category: "shared",
      reason: null,
    },
    {
      name: "plugins",
      target: "/d/plugins",
      directory: true,
      category: "optional",
      reason: null,
    },
    {
      name: ".credentials.json",
      target: "/d/.credentials.json",
      directory: false,
      category: "blocked",
      reason: "auth",
    },
  ];

  test.each([
    { name: "the default", share: ["settings.json"], expected: [] },
    {
      name: "an optional one",
      share: ["settings.json", "plugins"],
      expected: [],
    },
    { name: "nothing", share: [], expected: [] },
    {
      name: "a blocked one",
      share: ["settings.json", ".credentials.json"],
      expected: [
        { code: "blocked", name: ".credentials.json", reason: "auth" },
      ],
    },
    {
      name: "unknown and duplicated names",
      share: ["../x", "plugins", "plugins"],
      expected: [
        { code: "unknown", name: "../x" },
        { code: "duplicate", name: "plugins" },
      ],
    },
  ])("checkShareSelection: $name", ({ share, expected }) => {
    expect(checkShareSelection(ENTRIES, share)).toEqual(expected);
  });
});

describe("launchCommandLine (what the launch dialog shows)", () => {
  test.each([
    {
      name: "default account",
      agent: "claude",
      dir: null,
      command: "claude",
      expected: "claude",
    },
    {
      name: "under home",
      agent: "claude",
      dir: "/home/sample/.local/state/code-viewer/accounts/claude-work",
      command: "claude",
      expected:
        "CLAUDE_CONFIG_DIR=~/.local/state/code-viewer/accounts/claude-work claude",
    },
    {
      name: "a space under home is quoted in full",
      agent: "codex",
      dir: "/home/sample/my codex",
      command: "codex -m sample",
      expected: "CODEX_HOME='/home/sample/my codex' codex -m sample",
    },
    {
      name: "a quote outside home",
      agent: "claude",
      dir: "/opt/it's",
      command: "claude-wrapper",
      expected: "CLAUDE_CONFIG_DIR='/opt/it'\\''s' claude-wrapper",
    },
  ] as const)("$name", ({ agent, dir, command, expected }) => {
    expect(launchCommandLine(agent, dir, command, HOME)).toBe(expected);
  });
});
