// アカウントを選んで、tmux の新しいウィンドウでエージェント (やその
// ログイン) を起動する。
//
// キー入力を送って (send-keys) コマンドを打ち込む方式にはしない。シェルの
// 履歴や、そのシェルに入力中の別の文字に混ざるため。代わりに tmux の
// new-window / new-session に実行するもの (引数の配列) をそのまま渡す。
// アカウントは env の引数で渡す (tmuxLaunchArgs)。
//
// 起動したウィンドウには remain-on-exit failed を付ける。起動に失敗して
// すぐ終わったときも、ウィンドウが消えずにエラーが読める (正常に終われば
// 閉じる)。これは作ったウィンドウだけのオプションで、ウィンドウと一緒に
// 消える。

import {
  type AccountAgent,
  type AccountEntry,
  tmuxLaunchArgs,
  tmuxSessionName,
} from "../../core/agent-accounts";
import { hasControlCharacter } from "../../core/control-chars";
import { runTmux } from "../tmux/command";
import { AccountError } from "./registry";

export type LaunchedPane = {
  paneId: string;
  session: string;
  created: boolean;
};

/** 対話シェル。ユーザーのラッパー (シェルの関数) を使えるように -i で起こす。 */
export function interactiveShell(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHELL || "/bin/sh";
}

async function sessionExists(session: string, cwd: string): Promise<boolean> {
  const result = await runTmux(["has-session", "-t", `=${session}`], cwd);
  if (result.status === "ok") return true;
  if (result.status === "no-server" || result.status === "no-target")
    return false;
  if (result.status === "missing") {
    throw new AccountError("tmux is not installed", "failed");
  }
  // has-session はセッションが無いとき exit 1 を返し、stderr の文言は版で
  // 違う (can't find session / session not found)。
  if (/session not found|can't find session/i.test(result.error.message)) {
    return false;
  }
  throw new AccountError(
    `failed to check the tmux session ${session}`,
    "failed",
    {
      cause: result.error,
    },
  );
}

/**
 * 新しいウィンドウで argv を動かす。セッションが無ければ作る (tmux の
 * サーバが動いていなければ、それも起動する)。
 */
export async function openAccountWindow(options: {
  agent: AccountAgent;
  account: AccountEntry;
  cwd: string;
  session: string;
  windowName: string;
  argv: string[];
}): Promise<LaunchedPane> {
  if (
    hasControlCharacter(options.session) ||
    hasControlCharacter(options.cwd)
  ) {
    throw new AccountError(
      "the session or directory has control characters",
      "invalid",
    );
  }
  const session = tmuxSessionName(options.session);
  const exists = await sessionExists(session, options.cwd);
  const args = tmuxLaunchArgs({
    agent: options.agent,
    configDir: options.account.builtin ? null : options.account.configDir,
    cwd: options.cwd,
    session,
    sessionExists: exists,
    windowName: options.windowName,
    argv: options.argv,
  });
  const created = await runTmux(args, options.cwd);
  if (created.status !== "ok") {
    throw new AccountError(
      `tmux could not open a window in ${session} (${created.status})`,
      "failed",
      created.status === "error" ? { cause: created.error } : undefined,
    );
  }
  const paneId = created.stdout.trim();
  if (!/^%\d+$/.test(paneId)) {
    throw new AccountError(
      `tmux did not report the new pane (output: ${JSON.stringify(created.stdout.slice(0, 200))})`,
      "failed",
    );
  }
  const option = await runTmux(
    ["set-option", "-p", "-t", paneId, "remain-on-exit", "failed"],
    options.cwd,
  );
  // すぐ終わったペインはもう無い (no-target)。失敗で終わったなら
  // remain-on-exit が間に合わず消えている。成功のときと区別できないので、
  // 作ったことだけを返し、ペインが無いことは画面の側で分かる。
  if (option.status === "error") {
    throw new AccountError(
      `opened ${paneId}, but could not keep it open on failure`,
      "failed",
      { cause: option.error },
    );
  }
  return { paneId, session, created: !exists };
}

/** 種類ごとの公式のログインコマンド (引数の配列)。 */
export function loginArgv(agent: AccountAgent): string[] {
  return agent === "claude" ? ["claude", "auth", "login"] : ["codex", "login"];
}

/**
 * ログインのウィンドウで動かすもの。公式のコマンドを動かした後、結果を
 * 読めるように Enter を待ってから閉じる (成功するとすぐ閉じてしまい、
 * 何が起きたか見えないため)。コマンドは "$@" で渡し、文字列に埋め込まない。
 */
export function loginWindowArgv(agent: AccountAgent): string[] {
  const script =
    '"$@"; status=$?; printf "\\n[code-viewer] sign-in command exited with %s. Press Enter to close this window.\\n" "$status"; read -r _; exit "$status"';
  return ["/bin/sh", "-c", script, "sh", ...loginArgv(agent)];
}

export function accountWindowName(agent: AccountAgent, account: AccountEntry) {
  return account.builtin
    ? agent
    : `${agent}-${account.name.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 24)}`;
}
