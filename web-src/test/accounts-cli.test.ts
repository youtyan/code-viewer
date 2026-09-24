// `code-viewer accounts` の引数パースと表示。
//
// この CLI は AI が利用者の代わりにアカウントを作るために呼ぶ。綴り違いや
// 別のサブコマンドのオプションを黙って通すと、頼んだものと違うアカウントが
// できる。受け付ける値と弾く値を表で固定する。サーバへの往復は cli-helpers と
// サーバ側 (agent-accounts-server.test.ts) の責務なのでここでは扱わない。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { AccountStatus, CreateAccountPlan } from "../core/agent-accounts";
import {
  formatAccountLine,
  formatCreatePlan,
  parseAccountsArgs,
} from "../server/accounts-cli";
import { extractDocumentedSubcommandInvocations } from "./_documented-cli-fixture";

describe("parseAccountsArgs — 受け付けるもの", () => {
  test.each([
    { name: "引数なしはヘルプ", argv: [], command: { mode: "help" } },
    { name: "-h はヘルプ", argv: ["-h"], command: { mode: "help" } },
    {
      name: "agent-help はエージェント向けガイド",
      argv: ["agent-help"],
      command: { mode: "agent-help" },
    },
    {
      name: "list",
      argv: ["list"],
      command: { mode: "list", json: false, refresh: false },
    },
    {
      name: "list --refresh --json",
      argv: ["list", "--refresh", "--json"],
      command: { mode: "list", json: true, refresh: true },
    },
    {
      name: "plan",
      argv: ["plan", "--agent", "codex", "--name", "work"],
      command: { mode: "plan", agent: "codex", name: "work", json: false },
    },
    {
      name: "create は --share なしなら追加の共有なし",
      argv: ["create", "--agent", "claude", "--name", "work"],
      command: {
        mode: "create",
        agent: "claude",
        name: "work",
        share: [],
        json: false,
      },
    },
    {
      name: "create は --share を重ねて受ける",
      argv: [
        "create",
        "--agent",
        "claude",
        "--name",
        "work",
        "--share",
        "plugins",
        "--share",
        "scripts",
        "--json",
      ],
      command: {
        mode: "create",
        agent: "claude",
        name: "work",
        share: ["plugins", "scripts"],
        json: true,
      },
    },
    {
      name: "register",
      argv: [
        "register",
        "--agent",
        "codex",
        "--name",
        "old",
        "--config-dir",
        "/tmp/sample-codex",
      ],
      command: {
        mode: "register",
        agent: "codex",
        name: "old",
        configDir: "/tmp/sample-codex",
        json: false,
      },
    },
    {
      name: "login",
      argv: ["login", "--account", "claude:default", "--json"],
      command: { mode: "login", account: "claude:default", json: true },
    },
    {
      name: "wait の既定は 600 秒",
      argv: ["wait", "--account", "a1"],
      command: {
        mode: "wait",
        account: "a1",
        timeoutSeconds: 600,
        json: false,
      },
    },
    {
      name: "wait --timeout 1 (下限)",
      argv: ["wait", "--account", "a1", "--timeout", "1"],
      command: { mode: "wait", account: "a1", timeoutSeconds: 1, json: false },
    },
    {
      name: "rename",
      argv: ["rename", "--account", "a1", "--name", "personal"],
      command: { mode: "rename", account: "a1", name: "personal", json: false },
    },
    {
      name: "remove",
      argv: ["remove", "--account", "a1", "--json"],
      command: { mode: "remove", account: "a1", json: true },
    },
  ])("$name", ({ argv, command }) => {
    const parsed = parseAccountsArgs(argv);
    expect(parsed).toEqual({
      ok: true,
      args: { command, cwd: undefined, server: undefined },
    });
  });

  test("--cwd と --server はどのサブコマンドでも受ける", () => {
    const parsed = parseAccountsArgs([
      "list",
      "--cwd",
      "/tmp/sample-app",
      "--server",
      "http://127.0.0.1:4000",
    ]);
    expect(parsed.ok && parsed.args.cwd).toBe("/tmp/sample-app");
    expect(parsed.ok && parsed.args.server).toBe("http://127.0.0.1:4000");
  });
});

describe("parseAccountsArgs — 弾くもの", () => {
  test.each([
    {
      name: "未知のサブコマンド",
      argv: ["delete", "--account", "a1"],
      error: "unknown accounts subcommand: delete",
    },
    {
      name: "rename の名前なし",
      argv: ["rename", "--account", "a1"],
      error: "--name is required",
    },
    {
      name: "remove のアカウントなし",
      argv: ["remove"],
      error: "--account is required",
    },
    {
      name: "--account で決まるサブコマンドの --agent",
      argv: ["rename", "--account", "a1", "--agent", "claude", "--name", "x"],
      error: "--agent is not an option of accounts rename",
    },
    {
      name: "--agent で決まるサブコマンドの --account",
      argv: ["create", "--agent", "claude", "--name", "w", "--account", "a1"],
      error: "--account is not an option of accounts create",
    },
    {
      name: "remove の --name (名前で外すと取り違える)",
      argv: ["remove", "--account", "a1", "--name", "work"],
      error: "--name is not an option of accounts remove",
    },
    {
      name: "wait 以外の --timeout は既定と同じ値でも弾く",
      argv: ["login", "--account", "a1", "--timeout", "600"],
      error: "--timeout is not an option of accounts login",
    },
    {
      name: "未知のオプション",
      argv: ["list", "--all"],
      error: "unknown option: --all",
    },
    {
      name: "未知の種類",
      argv: ["create", "--agent", "gemini", "--name", "work"],
      error: "--agent must be one of: claude, codex",
    },
    {
      name: "種類なし",
      argv: ["create", "--name", "work"],
      error: "--agent is required",
    },
    {
      name: "名前なし",
      argv: ["create", "--agent", "claude"],
      error: "--name is required",
    },
    {
      name: "空白だけの名前",
      argv: ["plan", "--agent", "claude", "--name", "  "],
      error: "--name is required",
    },
    {
      name: "register の設定ディレクトリなし",
      argv: ["register", "--agent", "claude", "--name", "old"],
      error: "--config-dir is required",
    },
    {
      name: "login のアカウントなし",
      argv: ["login"],
      error: "--account is required",
    },
    {
      name: "wait のアカウントなし",
      argv: ["wait", "--timeout", "30"],
      error: "--account is required",
    },
    {
      name: "wait --timeout 0 (下限の下)",
      argv: ["wait", "--account", "a1", "--timeout", "0"],
      error: "--timeout must be a positive integer (seconds)",
    },
    {
      name: "wait --timeout に小数",
      argv: ["wait", "--account", "a1", "--timeout", "1.5"],
      error: "--timeout must be a positive integer (seconds)",
    },
    {
      name: "値の抜けたオプション",
      argv: ["login", "--account"],
      error: "--account requires a value",
    },
    {
      name: "create 以外の --share",
      argv: [
        "register",
        "--agent",
        "claude",
        "--name",
        "o",
        "--config-dir",
        "/tmp/d",
        "--share",
        "x",
      ],
      error: "--share is not an option of accounts register",
    },
    {
      name: "register 以外の --config-dir",
      argv: [
        "create",
        "--agent",
        "claude",
        "--name",
        "w",
        "--config-dir",
        "/tmp/d",
      ],
      error: "--config-dir is not an option of accounts create",
    },
    {
      name: "list 以外の --refresh",
      argv: ["wait", "--account", "a1", "--refresh"],
      error: "--refresh is not an option of accounts wait",
    },
    {
      name: "wait 以外の --timeout",
      argv: ["login", "--account", "a1", "--timeout", "30"],
      error: "--timeout is not an option of accounts login",
    },
  ])("$name", ({ argv, error }) => {
    expect(parseAccountsArgs(argv)).toEqual({ ok: false, error });
  });
});

function status(overrides: Partial<AccountStatus>): AccountStatus {
  return {
    id: "a1",
    agent: "claude",
    name: "work",
    configDir: "/tmp/state/accounts/claude-work",
    builtin: false,
    managed: true,
    exists: true,
    login: {
      state: "logged-in",
      who: "user@example.com",
      whoDetail: "",
      method: "",
      plan: "",
      detail: "",
      checkedAt: 0,
    },
    usage: {} as AccountStatus["usage"],
    hooks: {} as AccountStatus["hooks"],
    statusLine: null,
    ...overrides,
  };
}

describe("formatAccountLine", () => {
  test.each([
    {
      name: "登録したアカウントは名前とメールを出す",
      account: status({}),
      line: "a1\tclaude\twork\tlogged-in\tuser@example.com\t/tmp/state/accounts/claude-work",
    },
    {
      name: "既定のアカウントは (default)、メールが無ければ -",
      account: status({
        id: "codex:default",
        agent: "codex",
        name: "",
        builtin: true,
        configDir: "/tmp/home/.codex",
        login: { ...status({}).login, state: "logged-out", who: "" },
      }),
      line: "codex:default\tcodex\t(default)\tlogged-out\t-\t/tmp/home/.codex",
    },
  ])("$name", ({ account, line }) => {
    expect(formatAccountLine(account)).toBe(line);
  });
});

describe("formatCreatePlan", () => {
  const plan: CreateAccountPlan = {
    agent: "claude",
    name: "work",
    configDir: "/tmp/state/accounts/claude-work",
    parent: "/tmp/state/accounts",
    defaultDir: "/t",
    entries: [
      {
        name: "settings.json",
        target: "/t/settings.json",
        directory: false,
        category: "shared",
        reason: null,
      },
      {
        name: "skills",
        target: "/t/skills",
        directory: true,
        category: "shared",
        reason: null,
      },
      {
        name: "plugins",
        target: "/t/plugins",
        directory: true,
        category: "optional",
        reason: null,
      },
      {
        name: "projects",
        target: "/t/projects",
        directory: true,
        category: "blocked",
        reason: "history",
      },
    ],
    missingShared: [],
    authKeysInShared: [],
  };

  test("作る場所・リンクするもの・選べるもの・リンクしないものを並べる", () => {
    expect(formatCreatePlan(plan)).toBe(
      [
        "settings directory: /tmp/state/accounts/claude-work",
        "entries below are in the default directory: /t",
        "linked from the default account: settings.json, skills",
        "not linked, optional (add with --share): plugins",
        "never linked: projects (history)",
      ].join("\n"),
    );
  });

  test("空の分類は - と出し、認証に関わるキーは注意の行を足す", () => {
    expect(
      formatCreatePlan({
        ...plan,
        entries: [],
        authKeysInShared: ["apiKeyHelper"],
      }),
    ).toBe(
      [
        "settings directory: /tmp/state/accounts/claude-work",
        "entries below are in the default directory: /t",
        "linked from the default account: -",
        "not linked, optional (add with --share): -",
        "never linked: -",
        "note: the linked settings contain sign-in related keys (apiKeyHelper); the new account will use them too",
      ].join("\n"),
    );
  });
});

describe("bundled accounts skill tracks the CLI contract", () => {
  test("every documented code-viewer accounts example parses", () => {
    const text = readFileSync(
      join(process.cwd(), "skills/code-viewer-accounts/SKILL.md"),
      "utf8",
    );
    const invocations = extractDocumentedSubcommandInvocations(
      text,
      "accounts",
    );
    expect(invocations.length).toBe(13);
    const failures = invocations
      .filter((argv) => !parseAccountsArgs(argv).ok)
      .map((argv) => argv.join(" "));
    expect(failures).toEqual([]);
  });
});
