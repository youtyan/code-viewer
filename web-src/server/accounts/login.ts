// アカウントのログインの状態とメールアドレスを、CLI 自身に訊いて得る。
// アプリの推測では決めない。
//
// - claude: `claude auth status --json` (ログイン済みなら exit 0、未ログインなら
//   exit 1。https://code.claude.com/docs/en/cli-reference)。JSON の loggedIn・
//   email・authMethod・subscriptionType を使う
// - codex: `codex login status` (「Logged in using ChatGPT」「Not logged in」)。
//   誰としてかはこの文に出ないので、ログイン済みのときだけ `codex app-server`
//   の `account/read` を訊く (応答の account.email・planType。型は
//   `codex app-server generate-json-schema` の GetAccountResponse)。未ログイン
//   のディレクトリには app-server を起こさない (起こすとそこに状態のファイルを
//   作るため)
//
// どちらも起動コマンドと同じ対話シェル (launch.ts の agentCommandArgv) を通す
// ので、シェルの初期化が stdout に端末向けの文字列 (OSC 7 など) を先に出す
// ことがある。JSON は出力の中の { … } を取り出して読む (jsonIn)。以前はこれを
// そのまま JSON.parse して失敗し、ログイン済みの claude が「不明」になっていた。
//
// トークンなどの秘密の値は読まない。認証ファイル・キーチェーンは開かない。
// 答えから取り出すのは状態・メールアドレス・方式・プランの欄だけで、ほかの欄は
// 応答にもログにも残さない。コマンドの出力にはメールアドレスが入るので、ログ・
// 失敗の説明には stdout の中身を載せない (コマンド・終了コード・長さ・stderr の
// 先頭だけ)。JSON.parse のエラー文も入力の一部を引用するので載せない。
//
// コマンドの起動は 1〜3 秒かかるので、LOGIN_CACHE_MS の間は覚えておく。

import { spawn } from "node:child_process";
import type { AccountEntry, AccountLogin } from "../../core/agent-accounts";
import { ACCOUNT_ENV } from "../../core/agent-accounts";
import { formatErrorDetail } from "../../core/error-detail";
import { type RunResult, runAsync } from "../runtime";
import { accountReadArgv, loginStatusArgv } from "./launch";

export const LOGIN_CACHE_MS = 60_000;
const LOGIN_TIMEOUT_MS = 8000;
/** app-server の出力を溜める上限。通知が続いても膨らませない。 */
const RPC_MAX_BYTES = 1024 * 1024;

/** app-server に送る行。account/read の id で答えの行を探す。 */
export const ACCOUNT_READ_ID = 2;
export const ACCOUNT_READ_REQUESTS = [
  JSON.stringify({
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "code-viewer", version: "0" } },
  }),
  JSON.stringify({ method: "initialized" }),
  JSON.stringify({
    id: ACCOUNT_READ_ID,
    method: "account/read",
    params: { refreshToken: false },
  }),
];

/** 行ごとに読む対話の結果。timedOut なら code は null。 */
export type RpcResult = {
  code: number | null;
  lines: string[];
  stderr: string;
  timedOut: boolean;
};

export type LoginDeps = {
  run(args: string[], env: NodeJS.ProcessEnv): Promise<RunResult>;
  /**
   * requests を 1 行ずつ書き、done が真になる行が来たら stdin を閉じて終わりを
   * 待つ。stdin を先に閉じると codex app-server は答える前に終わる。
   */
  rpc(
    args: string[],
    env: NodeJS.ProcessEnv,
    requests: readonly string[],
    done: (line: string) => boolean,
  ): Promise<RpcResult>;
  now(): number;
};

function runRpc(
  args: string[],
  env: NodeJS.ProcessEnv,
  requests: readonly string[],
  done: (line: string) => boolean,
): Promise<RpcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0] as string, args.slice(1), {
      cwd: "/",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines: string[] = [];
    let pending = "";
    let bytes = 0;
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, LOGIN_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += chunk.length;
      if (bytes > RPC_MAX_BYTES) {
        child.kill("SIGKILL");
        return;
      }
      pending += chunk;
      let at = pending.indexOf("\n");
      while (at >= 0) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 1);
        lines.push(line);
        if (done(line)) child.stdin.end();
        at = pending.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk;
    });
    // 先に終わったプロセスへ書くと EPIPE になる。終わった理由は close の
    // 終了コードと stderr で分かるので、ここでは書き込みの失敗だけを添える。
    child.stdin.on("error", (error) => {
      stderr += `\n[stdin] ${formatErrorDetail(error).split("\n")[0]}`;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (pending) lines.push(pending);
      resolve({ code: timedOut ? null : code, lines, stderr, timedOut });
    });
    child.stdin.write(`${requests.join("\n")}\n`);
  });
}

export const DEFAULT_LOGIN_DEPS: LoginDeps = {
  run: (args, env) => runAsync(args, "/", { env, timeout: LOGIN_TIMEOUT_MS }),
  rpc: runRpc,
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

function stderrHead(stderr: string): string {
  return stderr.trim().split("\n")[0]?.slice(0, 200) ?? "";
}

function describeFailure(command: string, result: RunResult): string {
  const stderr = stderrHead(result.stderr);
  return `${command} exited with ${result.code}${stderr ? `: ${stderr}` : ""} (stdout ${result.stdout.length} bytes, not shown)`;
}

function isNotFound(result: { code: number | null; stderr: string }): boolean {
  return result.code === 127 || /ENOENT|not found/i.test(result.stderr);
}

/**
 * 出力の中の JSON のオブジェクト 1 つ。前後に端末向けの文字列があっても読む。
 * 読めなければ null (理由は呼び出し側が出力の中身を載せずに書く)。
 */
export function jsonIn(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    // JSON.parse のエラー文は入力 (メールアドレスを含む) を引用するので捨て、
    // null を「読めない」の意味で返す。呼び出し側が理由を書く。
    return null;
  }
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function blank(checkedAt: number): Omit<AccountLogin, "state"> {
  return {
    who: "",
    whoDetail: "",
    method: "",
    plan: "",
    detail: "",
    checkedAt,
  };
}

export function parseClaudeAuthStatus(
  result: RunResult,
  checkedAt: number,
  command = "claude",
): AccountLogin {
  const base = blank(checkedAt);
  const asked = `${command} auth status --json`;
  const record = jsonIn(result.stdout);
  if (!record) {
    if (isNotFound(result)) {
      return {
        ...base,
        state: "unknown",
        detail: `${asked}: the command was not found (exit ${result.code}${stderrHead(result.stderr) ? `: ${stderrHead(result.stderr)}` : ""})`,
      };
    }
    return {
      ...base,
      state: "unknown",
      detail: `${describeFailure(asked, result)}; no JSON object in the output`,
    };
  }
  if (record.loggedIn === false) return { ...base, state: "logged-out" };
  if (record.loggedIn !== true) {
    return {
      ...base,
      state: "unknown",
      detail: `${describeFailure(asked, result)}; the JSON has no loggedIn field`,
    };
  }
  const who = textField(record, "email");
  const method = textField(record, "authMethod");
  return {
    ...base,
    state: "logged-in",
    who,
    whoDetail: who
      ? ""
      : `${asked} did not include an email (sign-in method: ${method || "not given"})`,
    method,
    plan: textField(record, "subscriptionType"),
  };
}

export function parseCodexLoginStatus(
  result: RunResult,
  checkedAt: number,
  command = "codex",
): AccountLogin {
  const base = blank(checkedAt);
  const asked = `${command} login status`;
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
      detail: `${asked}: the command was not found (exit ${result.code}${stderrHead(result.stderr) ? `: ${stderrHead(result.stderr)}` : ""})`,
    };
  }
  return { ...base, state: "unknown", detail: describeFailure(asked, result) };
}

/**
 * app-server の account/read の答えから、メールアドレスとプランだけを取り出す。
 * 取れなければ whoDetail に理由 (出力の中身は載せない)。
 */
export function parseCodexAccountRead(
  result: RpcResult,
  command = "codex",
): { who: string; plan: string; whoDetail: string } {
  const asked = `${command} app-server (account/read)`;
  const none = (whoDetail: string) => ({ who: "", plan: "", whoDetail });
  const answer = result.lines
    .map(jsonIn)
    .find((record) => record?.id === ACCOUNT_READ_ID);
  if (!answer) {
    const how = result.timedOut
      ? `did not answer within ${LOGIN_TIMEOUT_MS / 1000} s`
      : isNotFound(result)
        ? "was not found"
        : `exited with ${result.code} without answering`;
    const stderr = stderrHead(result.stderr);
    return none(
      `${asked} ${how}${stderr ? `: ${stderr}` : ""} (${result.lines.length} lines on stdout, not shown)`,
    );
  }
  const error = answer.error;
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return none(
      `${asked} returned an error: code ${String(record.code)}, ${textField(record, "message").slice(0, 200)}`,
    );
  }
  const body = answer.result;
  const account =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).account
      : undefined;
  if (account === null) {
    return none(`${asked} reports no signed-in account`);
  }
  if (typeof account !== "object" || account === undefined) {
    return none(`${asked} answered without an account field`);
  }
  const record = account as Record<string, unknown>;
  const type = textField(record, "type");
  if (type !== "chatgpt") {
    return none(
      type === "apiKey"
        ? "signed in with an API key, which has no email"
        : `${asked}: account type ${type || "(none)"} has no email`,
    );
  }
  const who = textField(record, "email");
  return {
    who,
    plan: textField(record, "planType"),
    whoDetail: who ? "" : `${asked} did not include an email`,
  };
}

export type LoginChecker = {
  /** command: その種類の起動コマンド (起動と同じものに訊く)。 */
  status(
    account: AccountEntry,
    command: string,
    force?: boolean,
  ): Promise<AccountLogin>;
};

export function createLoginChecker(
  deps: LoginDeps = DEFAULT_LOGIN_DEPS,
): LoginChecker {
  const cache = new Map<string, { at: number; value: Promise<AccountLogin> }>();

  async function codexWho(
    login: AccountLogin,
    command: string,
    env: NodeJS.ProcessEnv,
  ): Promise<AccountLogin> {
    if (login.state !== "logged-in" || login.method !== "ChatGPT") {
      return login.state === "logged-in"
        ? {
            ...login,
            whoDetail: `signed in with ${login.method || "an unknown method"}, which has no email`,
          }
        : login;
    }
    const args = accountReadArgv(command);
    let result: RpcResult;
    try {
      result = await deps.rpc(
        args,
        env,
        ACCOUNT_READ_REQUESTS,
        (line) => jsonIn(line)?.id === ACCOUNT_READ_ID,
      );
    } catch (error) {
      return {
        ...login,
        whoDetail: `${command} app-server could not run: ${formatErrorDetail(error)}`,
      };
    }
    return { ...login, ...parseCodexAccountRead(result, command) };
  }

  async function check(
    account: AccountEntry,
    command: string,
  ): Promise<AccountLogin> {
    const env = accountEnv(account);
    const args = loginStatusArgv(account.agent, command);
    let result: RunResult;
    try {
      result = await deps.run(args, env);
    } catch (error) {
      return {
        ...blank(deps.now()),
        state: "unknown",
        detail: `${args.join(" ")} could not run: ${formatErrorDetail(error)}`,
      };
    }
    if (account.agent === "claude") {
      return parseClaudeAuthStatus(result, deps.now(), command);
    }
    return codexWho(
      parseCodexLoginStatus(result, deps.now(), command),
      command,
      env,
    );
  }

  return {
    status(account, command, force = false) {
      const key = `${account.agent}\n${account.builtin ? "" : account.configDir}\n${command}`;
      const hit = cache.get(key);
      if (!force && hit && deps.now() - hit.at < LOGIN_CACHE_MS)
        return hit.value;
      const value = check(account, command);
      cache.set(key, { at: deps.now(), value });
      return value;
    },
  };
}
