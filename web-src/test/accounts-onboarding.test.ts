// code-viewer が作った claude のアカウントに「初回の案内を済ませた」印を足す
// (server/accounts/onboarding.ts)。`claude auth login` はこの印を付けないので、
// 対話で開くと初回の案内とログインをやり直させていた。触るのはこの 1 項目だけ。
// パス・名前・値はすべて架空。

import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AccountEntry } from "../core/agent-accounts";
import { createLoginChecker } from "../server/accounts/login";
import {
  markClaudeOnboarded,
  type OnboardingMark,
} from "../server/accounts/onboarding";

describe("markClaudeOnboarded", () => {
  let dir: string;
  const file = () => join(dir, ".claude.json");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cv-onboarding-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.each([
    {
      name: "印が無ければ足し、ほかの項目は残す",
      before: {
        oauthAccount: { emailAddress: "sample@example.invalid" },
        n: 1,
      },
      status: "marked",
      after: {
        oauthAccount: { emailAddress: "sample@example.invalid" },
        n: 1,
        hasCompletedOnboarding: true,
      },
    },
    {
      name: "印が false なら true にする",
      before: { hasCompletedOnboarding: false },
      status: "marked",
      after: { hasCompletedOnboarding: true },
    },
    {
      name: "もう付いていれば書かない",
      before: { hasCompletedOnboarding: true, n: 2 },
      status: "already",
      after: { hasCompletedOnboarding: true, n: 2 },
    },
  ])("$name", async ({ before, status, after }) => {
    writeFileSync(file(), JSON.stringify(before), { mode: 0o600 });
    await expect(markClaudeOnboarded(dir)).resolves.toEqual({ status });
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual(after);
    expect(statSync(file()).mode & 0o777).toBe(0o600);
  });

  test("ファイルがまだ無ければ何も作らない", async () => {
    await expect(markClaudeOnboarded(dir)).resolves.toEqual({
      status: "no-file",
    });
    expect(() => statSync(file())).toThrow();
  });

  test.each([
    {
      name: "JSON でない",
      text: '{"oauthAccount": "sample-secret-value"',
      reason: "is not valid JSON",
    },
    { name: "配列", text: "[1, 2]", reason: "is not a JSON object" },
  ])("$name なら書かずに理由を返す (中身は理由に載せない)", async ({
    text,
    reason,
  }) => {
    writeFileSync(file(), text);
    const out = await markClaudeOnboarded(dir);
    expect(out.status).toBe("failed");
    const detail = out.status === "failed" ? out.detail : "";
    expect(detail).toContain(reason);
    expect(detail).not.toContain("sample-secret-value");
    expect(readFileSync(file(), "utf8")).toBe(text);
  });
});

describe("login check marks only code-viewer's own claude accounts", () => {
  const SIGNED_IN = JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    email: "sample@example.invalid",
    subscriptionType: "max",
  });
  const account = (overrides: Partial<AccountEntry>): AccountEntry => ({
    id: "sample-id",
    agent: "claude",
    name: "work",
    configDir: "/home/sample/accounts/claude-work",
    builtin: false,
    managed: true,
    ...overrides,
  });

  function checker(
    stdout: string,
    code: number,
    mark: OnboardingMark,
    marked: string[],
  ) {
    return createLoginChecker({
      async run() {
        return { code, stdout, stderr: "" };
      },
      async rpc() {
        throw new Error("rpc is not used for claude");
      },
      now: () => 0,
      async markOnboarded(configDir) {
        marked.push(configDir);
        return mark;
      },
    });
  }

  test.each([
    {
      name: "code-viewer が作ったログイン済みのアカウント",
      entry: account({}),
      stdout: SIGNED_IN,
      code: 0,
      marked: ["/home/sample/accounts/claude-work"],
    },
    {
      name: "既定のアカウントには触らない",
      entry: account({ builtin: true, managed: false }),
      stdout: SIGNED_IN,
      code: 0,
      marked: [],
    },
    {
      name: "登録しただけのディレクトリには触らない",
      entry: account({ managed: false }),
      stdout: SIGNED_IN,
      code: 0,
      marked: [],
    },
    {
      name: "未ログインなら足さない",
      entry: account({}),
      stdout: JSON.stringify({ loggedIn: false }),
      code: 1,
      marked: [],
    },
  ])("$name", async ({ entry, stdout, code, marked }) => {
    const calls: string[] = [];
    await checker(stdout, code, { status: "marked" }, calls).status(
      entry,
      "claude",
    );
    expect(calls).toEqual(marked);
  });

  test("足せなければ理由を setupDetail に載せ、サーバのログにも出す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {
      // テストの出力に出さない (呼ばれた中身は下で見る)。
    });
    try {
      const login = await checker(
        SIGNED_IN,
        0,
        { status: "failed", detail: "could not write sample: EACCES" },
        [],
      ).status(account({}), "claude");
      expect(login).toMatchObject({
        state: "logged-in",
        setupDetail: "could not write sample: EACCES",
      });
      expect(error).toHaveBeenCalledWith(
        "[code-viewer] could not mark the claude account sample-id as onboarded: could not write sample: EACCES",
      );
    } finally {
      error.mockRestore();
    }
  });
});
