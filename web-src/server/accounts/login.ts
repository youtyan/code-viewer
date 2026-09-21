// アカウントのログインの状態を、公式のコマンドで得る。
//
// - claude: `claude auth status --json` (ログイン済みなら exit 0、未ログインなら
//   exit 1。https://code.claude.com/docs/en/cli-reference)。JSON の loggedIn・
//   email・authMethod・subscriptionType を使う
// - codex: `codex login status`。「Logged in using ChatGPT」などの文だけで、
//   誰としてかは出ない。誰としてかを知るには認証ファイル (auth.json) を
//   開く必要があるので、開かずに「分からない」とする
//
// トークンなどの秘密の値は読まない。認証ファイル・キーチェーンは開かない。
// コマンドの出力にメールアドレスが含まれるので、ログ・失敗の説明には
// 出力の中身を載せない (終了コードと、長さと、stderr の先頭だけ)。
//
// コマンドの起動は数百 ms かかるので、LOGIN_CACHE_MS の間は覚えておく。

import type { AccountEntry, AccountLogin } from "../../core/agent-accounts";
import { ACCOUNT_ENV } from "../../core/agent-accounts";
import { formatErrorDetail } from "../../core/error-detail";
import { type RunResult, runAsync } from "../runtime";

export const LOGIN_CACHE_MS = 60_000;
const LOGIN_TIMEOUT_MS = 8000;

export type LoginDeps = {
  run(args: string[], env: NodeJS.ProcessEnv): Promise<RunResult>;
  now(): number;
};

export const DEFAULT_LOGIN_DEPS: LoginDeps = {
  run: (args, env) => runAsync(args, "/", { env, timeout: LOGIN_TIMEOUT_MS }),
  now: Date.now,
};

/** そのアカウントを選ぶ環境。既定のアカウントなら変数を外す。 */
export function accountEnv(
  account: Pick<AccountEntry, "agent" | "builtin" | "configDir">,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base };
  const name = ACCOUNT_ENV[account.agent];
  if (account.builtin) delete env[name];
  else env[name] = account.configDir;
  return env;
}

function describeFailure(command: string, result: RunResult): string {
  const stderr = result.stderr.trim().split("\n")[0]?.slice(0, 200) ?? "";
  return `${command} exited with ${result.code}${stderr ? `: ${stderr}` : ""} (stdout ${result.stdout.length} bytes, not shown)`;
}

function isNotFound(result: RunResult): boolean {
  return result.code === 127 || /ENOENT|not found/i.test(result.stderr);
}

export function parseClaudeAuthStatus(
  result: RunResult,
  checkedAt: number,
): AccountLogin {
  const base = { who: "", method: "", detail: "", checkedAt };
  if (isNotFound(result) && result.stdout.trim() === "") {
    return {
      ...base,
      state: "unknown",
      detail: "the claude command was not found",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    return {
      ...base,
      state: "unknown",
      detail: `${describeFailure("claude auth status --json", result)}; the output is not JSON (${formatErrorDetail(error).split("\n")[0]})`,
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return {
      ...base,
      state: "unknown",
      detail: "claude auth status --json did not print an object",
    };
  }
  const record = parsed as Record<string, unknown>;
  const text = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : "";
  if (record.loggedIn === false) return { ...base, state: "logged-out" };
  if (record.loggedIn !== true) {
    return {
      ...base,
      state: "unknown",
      detail: "claude auth status --json has no loggedIn field",
    };
  }
  const plan = text("subscriptionType");
  const method = text("authMethod");
  return {
    ...base,
    state: "logged-in",
    who: text("email"),
    method: plan ? `${method || "claude"} (${plan})` : method,
  };
}

export function parseCodexLoginStatus(
  result: RunResult,
  checkedAt: number,
): AccountLogin {
  const base = { who: "", method: "", detail: "", checkedAt };
  const output = `${result.stdout}\n${result.stderr}`;
  if (/not logged in/i.test(output)) return { ...base, state: "logged-out" };
  const using = /logged in using (chatgpt|an api key|[a-z][a-z ]{0,30})/i.exec(
    output,
  );
  if (using?.[1]) {
    const kind = using[1].toLowerCase();
    return {
      ...base,
      state: "logged-in",
      // API キーの行にはキーの一部が続くので、方式の名前だけを残す。
      method:
        kind === "chatgpt"
          ? "ChatGPT"
          : kind.startsWith("an api")
            ? "API key"
            : kind,
    };
  }
  if (isNotFound(result)) {
    return {
      ...base,
      state: "unknown",
      detail: "the codex command was not found",
    };
  }
  return {
    ...base,
    state: "unknown",
    detail: describeFailure("codex login status", result),
  };
}

export type LoginChecker = {
  status(account: AccountEntry, force?: boolean): Promise<AccountLogin>;
};

export function createLoginChecker(
  deps: LoginDeps = DEFAULT_LOGIN_DEPS,
): LoginChecker {
  const cache = new Map<string, { at: number; value: Promise<AccountLogin> }>();

  async function check(account: AccountEntry): Promise<AccountLogin> {
    const env = accountEnv(account);
    const args =
      account.agent === "claude"
        ? ["claude", "auth", "status", "--json"]
        : ["codex", "login", "status"];
    let result: RunResult;
    try {
      result = await deps.run(args, env);
    } catch (error) {
      return {
        state: "unknown",
        who: "",
        method: "",
        detail: `${args.join(" ")} could not run: ${formatErrorDetail(error)}`,
        checkedAt: deps.now(),
      };
    }
    return account.agent === "claude"
      ? parseClaudeAuthStatus(result, deps.now())
      : parseCodexLoginStatus(result, deps.now());
  }

  return {
    status(account, force = false) {
      const key = `${account.agent}\n${account.builtin ? "" : account.configDir}`;
      const hit = cache.get(key);
      if (!force && hit && deps.now() - hit.at < LOGIN_CACHE_MS)
        return hit.value;
      const value = check(account);
      cache.set(key, { at: deps.now(), value });
      return value;
    },
  };
}
