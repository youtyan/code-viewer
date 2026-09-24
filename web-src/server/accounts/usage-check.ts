// 「使用量を確かめる」。claude の使用量は statusLine に渡される JSON の
// rate_limits にしか無く、それはそのセッションで最初の API の応答が返った後に
// しか入らない (https://code.claude.com/docs/en/statusline の rate_limits)。
// 利用者が押したときだけ、この確認のためだけの tmux のセッションで claude を
// 起こし、短い一言を送って、包むスクリプト (terminal/statusline.ts) が新しい
// 使用量を保存するのを待つ。わずかに使用量を使う。
//
// - 起動は「新しいエージェント」と同じ部品 (tmuxLaunchArgs・agentCommandArgv)。
//   アカウントの環境の作り方をここに書かない
// - 包んだ statusLine を --settings で渡す (usageCheckArgs)。プロジェクトの
//   設定に statusLine があると、ユーザーの設定の (包んだ) ものより優先され、
//   使用量が保存されない
// - claude が終わっても対話シェルは印の行を出して眠るので、ペインは残る。
//   起動に失敗した理由をペインの画面から読める
// - 閉じるのは自分が作ったペインの pid のプロセスグループだけ (SIGHUP、残れば
//   SIGKILL)。tmux のセッションやペインを終了させるコマンドは使わない
//   (agents.md の「やってはいけないこと」)。シェルが終われば端末が閉じ、
//   tmux がペインとセッションを片付ける (remain-on-exit はこのペインで off)
// - 同じアカウントで走っている間は起こさず、走っている確認の結果を返す

import {
  type AccountEntry,
  type AccountUsage,
  tmuxLaunchArgs,
  USAGE_CHECK_SESSION_PREFIX,
  type UsageCheckFailure,
  type UsageCheckResponse,
} from "../../core/agent-accounts";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import { signalProcessGroup } from "../runtime";
import { runTmux, type TmuxRunResult } from "../tmux/command";
import { agentCommandArgv, sessionExists } from "./launch";
import { AccountError } from "./registry";
import { sharedAccountService } from "./service";

/** 送る一言。返事は 1 語でよい (使用量を少しでも減らす)。 */
export const USAGE_CHECK_PROMPT = "Reply with just: ok";
/** いちばん軽いモデルの別名 (公式の --model の別名)。 */
export const USAGE_CHECK_MODEL = "haiku";
/** 新しい使用量を待つ上限。 */
export const USAGE_CHECK_TIMEOUT_MS = 60_000;
/** 使用量の記録を読み直す間隔。 */
const POLL_MS = 1000;
/** ペインの画面を読む間隔。 */
const SCREEN_EVERY_MS = 2000;
/** 閉じた後、セッションが消えるのを待つ上限 (信号 1 つごと)。 */
const CLOSE_WAIT_MS = 3000;
/** 根拠として返す画面の最後の行数と、1 行の長さの上限。 */
const EVIDENCE_LINES = 12;
const EVIDENCE_LINE_MAX = 300;

/**
 * claude が終わった後に対話シェルが出す印。これが画面にあれば起動に失敗した。
 * 眠るのは、ペインを残して理由を読むため (閉じるのはこちら)。サーバが途中で
 * 落ちても、眠り終わればシェルが終わり、tmux がセッションを片付ける。
 */
const EXIT_MARKER = "[code-viewer] usage check: claude exited with";
const AFTER_EXIT = `rc=$?; printf "\\n${EXIT_MARKER} %s\\n" "$rc"; sleep 600`;

/**
 * 確認を先へ進められない Claude Code の画面を見分ける文言。**Claude Code の
 * 内部の文言で、公式に約束されたものではない** (agents.md の 11「内部形式に
 * 頼っている箇所」)。2.1.282 の画面の文字列から取った。版が上がって変われば、
 * その画面で止まらずに時間切れになる (時間切れの応答にはペインの最後の行が
 * 付くので、それを見てここを直す)。上から順に見る。
 */
export const CLAUDE_BLOCKING_SCREENS: readonly {
  reason: Extract<UsageCheckFailure, "onboarding" | "trust" | "login">;
  markers: readonly string[];
}[] = [
  // 初回の案内 (テーマの選択)。
  {
    reason: "onboarding",
    markers: ["Choose the text style", "Let's get started."],
  },
  // フォルダの信頼の確認。
  {
    reason: "trust",
    markers: [
      "Accessing workspace:",
      "Yes, I trust this folder",
      "Is this a project you created or one you trust?",
    ],
  },
  // ログインの方法の選択・ログインし直しを求める行。
  {
    reason: "login",
    markers: [
      "Select login method:",
      "run /login",
      "Sign in again to continue",
      "Invalid API key",
    ],
  },
];

/** 罫線と空白の並びを 1 つの空白にする (Ink が行を折り返しても見分けられる)。 */
function normalized(text: string): string {
  return text
    .replace(/[\s─-╿]+/g, " ")
    .trim()
    .toLowerCase();
}

/** 画面の最後の行 (空行を除く)。 */
export function evidenceLines(screen: string): string[] {
  return screen
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(-EVIDENCE_LINES)
    .map((line) =>
      line.length > EVIDENCE_LINE_MAX
        ? `${line.slice(0, EVIDENCE_LINE_MAX)}…`
        : line,
    );
}

export type ScreenVerdict =
  | { kind: "exited"; code: string }
  | {
      kind: "blocked";
      reason: Extract<UsageCheckFailure, "onboarding" | "trust" | "login">;
      marker: string;
    }
  | null;

/** ペインの画面 (色なしの文字) から、待っても進まない画面かを決める。 */
export function classifyUsageCheckScreen(screen: string): ScreenVerdict {
  const exited = screen.match(
    new RegExp(`${EXIT_MARKER.replace(/[[\]]/g, "\\$&")} (\\S+)`),
  );
  if (exited) return { kind: "exited", code: exited[1] ?? "" };
  const text = normalized(screen);
  for (const screenKind of CLAUDE_BLOCKING_SCREENS) {
    for (const marker of screenKind.markers) {
      if (text.includes(normalized(marker))) {
        return { kind: "blocked", reason: screenKind.reason, marker };
      }
    }
  }
  return null;
}

/**
 * claude に足す引数。包んだ statusLine を --settings で渡す: コマンドラインの
 * 設定はプロジェクトの設定 (.claude/settings.json) より優先されるので、作業
 * 場所のプロジェクトに別の statusLine があっても使用量が保存される
 * (https://code.claude.com/docs/en/settings の優先順位)。引数は "$@" で渡る
 * (agentCommandArgv) ので、JSON をシェルの文字列に埋め込まない。
 */
export function usageCheckArgs(statusLineCommand: string): string[] {
  return [
    "--settings",
    JSON.stringify({
      statusLine: { type: "command", command: statusLineCommand },
    }),
    "--model",
    USAGE_CHECK_MODEL,
    USAGE_CHECK_PROMPT,
  ];
}

/** セッションの名前。アカウントの id を tmux で安全な文字にし、時刻で重ならない。 */
export function usageCheckSessionName(
  accountId: string,
  startedAt: number,
): string {
  const safe =
    accountId
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 12)
      .replace(/-+$/, "") || "account";
  return `${USAGE_CHECK_SESSION_PREFIX}${safe}-${startedAt.toString(36)}`;
}

export type UsageCheckDeps = {
  runTmux(args: string[], cwd: string): Promise<TmuxRunResult>;
  /**
   * そのアカウントの今の使用量と、包んだ statusLine のコマンド (包んでいない・
   * 包むスクリプトが無いなら null)。
   */
  usage(account: AccountEntry): {
    usage: AccountUsage;
    statusLineCommand: string | null;
  };
  /** 起動コマンド (登録簿の launch command)。 */
  launchCommand(account: AccountEntry): string;
  signalGroup(pid: number, signal: NodeJS.Signals): void;
  now(): number;
  sleep(ms: number): Promise<void>;
  env: NodeJS.ProcessEnv;
};

export type UsageChecker = {
  check(account: AccountEntry, cwd: string): Promise<UsageCheckResponse>;
};

function usageLine(usage: AccountUsage): string {
  const when =
    usage.observedAt > 0 ? new Date(usage.observedAt).toISOString() : "never";
  return usage.status === "ok"
    ? `latest saved usage: observed at ${when}`
    : `latest saved usage: unavailable (${usage.reason}), observed at ${when}${usage.detail ? `\n${usage.detail}` : ""}`;
}

export function createUsageChecker(deps: UsageCheckDeps): UsageChecker {
  const running = new Map<string, Promise<UsageCheckResponse>>();

  async function tmuxOk(
    args: string[],
    cwd: string,
    what: string,
  ): Promise<string> {
    const result = await deps.runTmux(args, cwd);
    if (result.status === "ok") return result.stdout;
    const message = `tmux could not ${what} (${result.status})`;
    throw result.status === "error"
      ? errorWithCause(message, result.error)
      : new Error(message);
  }

  /** 作ったペインのプロセスグループを止め、セッションが消えたことを確かめる。 */
  async function close(
    session: string,
    pid: number,
    cwd: string,
  ): Promise<string> {
    if (!(pid > 0)) {
      return `the pid of the check's pane is unknown, so the tmux session ${session} was left open; close it in tmux`;
    }
    const problems: string[] = [];
    for (const signal of ["SIGHUP", "SIGKILL"] as const) {
      try {
        deps.signalGroup(pid, signal);
      } catch (error) {
        problems.push(
          `could not send ${signal} to process group ${pid}: ${formatErrorDetail(error)}`,
        );
        continue;
      }
      const until = deps.now() + CLOSE_WAIT_MS;
      for (;;) {
        try {
          if (!(await sessionExists(session, cwd, deps.runTmux))) return "";
        } catch (error) {
          problems.push(
            `could not check whether ${session} is closed: ${formatErrorDetail(error)}`,
          );
          break;
        }
        if (deps.now() >= until) break;
        await deps.sleep(200);
      }
    }
    return [
      `the tmux session ${session} is still open after SIGHUP and SIGKILL to process group ${pid}; close it in tmux`,
      ...problems,
    ].join("\n");
  }

  async function run(
    account: AccountEntry,
    cwd: string,
  ): Promise<UsageCheckResponse> {
    const startedAt = deps.now();
    const base = {
      accountId: account.id,
      session: "",
      closeError: "",
      joined: false,
      startedAt,
    };
    const first = deps.usage(account);
    if (first.statusLineCommand === null) {
      return {
        ...base,
        status: "failed",
        reason: "not-wrapped",
        detail: `the statusLine of ${account.configDir} is not wrapped (or its wrapper script is missing), so there is nothing to receive the usage`,
        evidence: [],
        usage: first.usage,
        finishedAt: deps.now(),
      };
    }
    const session = usageCheckSessionName(account.id, startedAt);
    const argv = agentCommandArgv(
      deps.launchCommand(account),
      usageCheckArgs(first.statusLineCommand),
      deps.env,
      AFTER_EXIT,
    );
    const failed = (
      reason: UsageCheckFailure,
      detail: string,
      evidence: string[],
      created: string,
    ): UsageCheckResponse => ({
      ...base,
      session: created,
      status: "failed",
      reason,
      detail,
      evidence,
      usage: deps.usage(account).usage,
      finishedAt: deps.now(),
    });

    let paneId: string;
    try {
      paneId = (
        await tmuxOk(
          tmuxLaunchArgs({
            agent: account.agent,
            configDir: account.builtin ? null : account.configDir,
            cwd,
            session,
            sessionExists: false,
            windowName: "usage-check",
            argv,
          }),
          cwd,
          `start the session ${session}`,
        )
      ).trim();
    } catch (error) {
      return failed("start-failed", formatErrorDetail(error), [], "");
    }
    // ここから先は、どう終わってもこのセッションを閉じる。
    let pid = 0;
    let outcome: UsageCheckResponse;
    try {
      if (!/^%\d+$/.test(paneId)) {
        throw new Error(
          `tmux did not report the new pane (output: ${JSON.stringify(paneId.slice(0, 200))})`,
        );
      }
      pid = Number.parseInt(
        (
          await tmuxOk(
            ["display-message", "-p", "-t", paneId, "#{pane_pid}"],
            cwd,
            `read the pid of ${paneId}`,
          )
        ).trim(),
        10,
      );
      // 利用者の設定で remain-on-exit が付いていても、シェルが終われば閉じる。
      await tmuxOk(
        ["set-option", "-p", "-t", paneId, "remain-on-exit", "off"],
        cwd,
        `set remain-on-exit off on ${paneId}`,
      );
      outcome = await wait(account, cwd, paneId, session, startedAt, failed);
    } catch (error) {
      outcome = failed("start-failed", formatErrorDetail(error), [], session);
    }
    const closeError = await close(session, pid, cwd);
    return { ...outcome, closeError, finishedAt: deps.now() };
  }

  async function wait(
    account: AccountEntry,
    cwd: string,
    paneId: string,
    session: string,
    startedAt: number,
    failed: (
      reason: UsageCheckFailure,
      detail: string,
      evidence: string[],
      created: string,
    ) => UsageCheckResponse,
  ): Promise<UsageCheckResponse> {
    const deadline = startedAt + USAGE_CHECK_TIMEOUT_MS;
    let screen = "";
    let screenAt = 0;
    for (;;) {
      const { usage } = deps.usage(account);
      if (usage.status === "ok" && usage.observedAt >= startedAt) {
        return {
          accountId: account.id,
          session,
          closeError: "",
          joined: false,
          startedAt,
          status: "ok",
          usage,
          finishedAt: deps.now(),
        };
      }
      const now = deps.now();
      if (now >= deadline) {
        return failed(
          "timeout",
          `no new usage arrived within ${USAGE_CHECK_TIMEOUT_MS / 1000}s\n${usageLine(usage)}`,
          evidenceLines(screen),
          session,
        );
      }
      if (now - screenAt >= SCREEN_EVERY_MS) {
        screenAt = now;
        const captured = await deps.runTmux(
          ["capture-pane", "-p", "-t", paneId],
          cwd,
        );
        if (captured.status !== "ok") {
          const message = `tmux could not read the screen of ${paneId} (${captured.status})`;
          throw captured.status === "error"
            ? errorWithCause(message, captured.error)
            : new Error(message);
        }
        screen = captured.stdout;
        const verdict = classifyUsageCheckScreen(screen);
        if (verdict?.kind === "exited") {
          return failed(
            "start-failed",
            `claude exited with ${verdict.code} before the usage arrived`,
            evidenceLines(screen),
            session,
          );
        }
        if (verdict?.kind === "blocked") {
          return failed(
            verdict.reason,
            `the claude screen shows "${verdict.marker}"`,
            evidenceLines(screen),
            session,
          );
        }
      }
      await deps.sleep(POLL_MS);
    }
  }

  return {
    async check(account, cwd) {
      if (account.agent !== "claude") {
        throw new AccountError(
          "the usage check is for claude accounts (codex usage is read from its session logs)",
          "invalid",
        );
      }
      const current = running.get(account.id);
      if (current) return { ...(await current), joined: true };
      const started = run(account, cwd).finally(() =>
        running.delete(account.id),
      );
      running.set(account.id, started);
      return started;
    },
  };
}

let shared: UsageChecker | null = null;

/** サーバのプロセスで 1 つ (二重に起こさないため)。 */
export function sharedUsageChecker(): UsageChecker {
  shared ??= createUsageChecker({
    runTmux,
    usage: (account) => sharedAccountService().usage(account),
    launchCommand: (account) =>
      sharedAccountService().launchCommands()[account.agent],
    signalGroup: signalProcessGroup,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    env: process.env,
  });
  return shared;
}
