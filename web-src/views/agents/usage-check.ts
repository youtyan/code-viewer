// 使用量の更新状態を、アカウントのカードと設定画面で共有する。
// Claude /usage と Codex account/rateLimits/read はモデルに応答を求めない。
// 更新に失敗したら理由と全文のコピーを出す。旧サーバからの画面待ちの応答も扱う。

import {
  type AccountStatus,
  type UsageCheckFailure,
  usageIsStale,
} from "../../core/agent-accounts";
import { abbreviateHome } from "../../core/agent-overview";
import { showCopyFailure } from "../../core/copy-failure";
import { formatErrorDetail } from "../../core/error-detail";
import type { ContextMenuItem } from "../context-menu";
import type { AccountsClient, UsageCheckState } from "./accounts-client";
import {
  type AccountDialogs,
  accountDisplayName,
  el,
} from "./accounts-dialogs";
import type { AccountsText } from "./accounts-i18n";

/** 開いている「詳しく」(アカウントの id と中身)。 */
const openDetails = new Set<string>();

/** 値が無い・古いときはカードにも更新ボタンを出す。 */
export function usageCheckWanted(account: AccountStatus, now: number): boolean {
  const usage = account.usage;
  return usage.status !== "ok" || usageIsStale(usage.observedAt, now);
}

/**
 * カードの中にボタンを出すか。確かめる意味があり、押せば進みうるとき。
 * 未ログインにはログインのボタンを使う。statusLine の設定は不要。
 */
export function usageCheckOffered(
  account: AccountStatus,
  now: number,
): boolean {
  if (!usageCheckWanted(account, now)) return false;
  return (
    account.login.state !== "logged-out" &&
    account.login.state !== "no-config-dir"
  );
}

/** ⋯ のメニューの項目。新しい値があっても取り直せる。 */
export function usageCheckMenuItem(
  account: AccountStatus,
  client: AccountsClient,
  t: AccountsText,
): Exclude<ContextMenuItem, { kind: "separator" }> | null {
  const running = client.usageCheck(account.id)?.running === true;
  return {
    label: running ? t.usageChecking : t.usageCheck,
    title: t.usageCheckTitle,
    disabled: running,
    onSelect: () => void client.checkUsage(account.id),
  };
}

/**
 * claude の画面で止まった (時間切れは、画面で何かを待っている見込み) 理由。
 * そのアカウントで開いて済ませれば進むので、カードに「このアカウントで開く」
 * (ログインは既存の「ログイン」) と「もう一度確かめる」を出す。
 */
const SCREEN_STOPS = ["onboarding", "trust", "login", "timeout"] as const;
type ScreenStop = (typeof SCREEN_STOPS)[number];

function isScreenStop(reason: UsageCheckFailure): reason is ScreenStop {
  return (SCREEN_STOPS as readonly string[]).includes(reason);
}

type Failure = {
  reason: string;
  next: string;
  more: string;
  /** 画面で止まった: その理由とフォルダ。 */
  stop: { kind: ScreenStop; folder: string } | null;
};

function failureLines(state: UsageCheckState, t: AccountsText): Failure | null {
  if (state.running) return null;
  if (state.error) {
    return {
      reason: t.usageCheckRequestFailed,
      next: "",
      more: state.error,
      stop: null,
    };
  }
  const response = state.response;
  if (!response) return null;
  if (response.status === "ok") {
    // 値は取れたが、確認のために開いたセッションを閉じられなかった。
    if (!response.closeError) return null;
    return {
      reason: t.usageCheckCloseFailed,
      next: "",
      more: response.closeError,
      stop: null,
    };
  }
  const evidence = response.evidence.length
    ? `${t.usageCheckEvidence}\n${response.evidence.join("\n")}`
    : "";
  const reason = response.reason;
  return {
    reason: t.usageCheckFailed[reason],
    next:
      reason === "timeout" || !isScreenStop(reason)
        ? t.usageCheckNext[reason]
        : "",
    more: [
      response.detail,
      evidence,
      response.closeError
        ? `${t.usageCheckCloseFailed}\n${response.closeError}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    stop: isScreenStop(reason) ? { kind: reason, folder: response.cwd } : null,
  };
}

/**
 * フォルダの場所。~ で縮め、最後の段を残して前を省略する (真ん中が「…」に
 * なる。CSS の .usage-check-folder)。全文は title。
 */
function folderLine(folder: string, home: string): HTMLElement {
  const shown = home ? abbreviateHome(folder, home) : folder;
  const cut = shown.lastIndexOf("/", shown.length - 2) + 1;
  const line = el("p", "usage-check-folder terminal-mono");
  line.append(
    el("span", "usage-check-folder-head", shown.slice(0, cut)),
    el("span", "usage-check-folder-tail", shown.slice(cut)),
  );
  line.title = folder;
  return line;
}

/**
 * 「このアカウントで開く」「ログイン」「起動コマンドを開く」を押したとき。
 * openLaunchCommands は設定のアカウントの起動コマンドの欄へ移り、焦点を当てる。
 */
export type UsageCheckOpeners = Pick<AccountDialogs, "openHere" | "login"> & {
  openLaunchCommands(): void;
};

/**
 * ボタン・走っている間の文・失敗の理由と次の手順。出すものが無ければ null。
 * name はボタンに添える表示名 (設定の行で複数のアカウントが並ぶとき)。
 */
export function usageCheckBlock(
  account: AccountStatus,
  now: number,
  client: AccountsClient,
  t: AccountsText,
  openers: UsageCheckOpeners,
  options: { name?: string } = {},
): HTMLElement | null {
  const state = client.usageCheck(account.id);
  const running = state?.running === true;
  // 今回の取得失敗は、保存済みの値が新しくても隠さない。
  const failure = state ? failureLines(state, t) : null;
  const refreshFailed =
    (state?.response?.status === "failed" &&
      state.response.reason === "read-failed") ||
    !!state?.error;
  const showFailure =
    failure !== null &&
    (refreshFailed ||
      usageCheckWanted(account, now) ||
      (state?.response?.status === "ok" && !!state.response.closeError));
  const stop = showFailure ? (failure?.stop ?? null) : null;
  const offered = usageCheckOffered(account, now);
  if (!running && !showFailure && !offered) return null;

  const box = el("div", "usage-check");
  box.dataset.account = account.id;
  const checkButton = (label: string) => {
    const button = el("button", "agents-secondary usage-check-button", label);
    button.type = "button";
    button.title = t.usageCheckTitle;
    button.disabled = running;
    button.addEventListener("click", () => void client.checkUsage(account.id));
    return button;
  };
  // 画面で止まった・起動に失敗したときは、下の「もう一度確かめる」が同じ役をする。
  const startFailed =
    showFailure &&
    state?.response?.status === "failed" &&
    state.response.reason === "start-failed";
  if (running || ((offered || refreshFailed) && !stop && !startFailed)) {
    box.appendChild(
      checkButton(options.name ? t.usageCheckFor(options.name) : t.usageCheck),
    );
  }
  if (running) {
    const line = el("p", "usage-check-status", t.usageChecking);
    line.setAttribute("role", "status");
    box.appendChild(line);
    return box;
  }
  if (!showFailure || !failure) return box;
  const reason = el("p", "usage-check-failed", failure.reason);
  reason.setAttribute("role", "alert");
  box.appendChild(reason);
  if (stop) {
    box.appendChild(
      folderLine(stop.folder, client.snapshot().data?.home ?? ""),
    );
    const actions = el("div", "usage-check-actions");
    const open = el(
      "button",
      "agents-secondary usage-check-open",
      stop.kind === "login" ? t.loginButton : t.usageCheckOpenHere,
    );
    open.type = "button";
    open.title =
      stop.kind === "login"
        ? t.loginTitle(accountDisplayName(account, t))
        : t.usageCheckOpenHereTitle(stop.folder);
    open.addEventListener("click", async () => {
      try {
        let notice = "";
        if (stop.kind === "login") await openers.login(account);
        else notice = await openers.openHere(account, stop.folder);
        client.noteUsageCheckOpened(account.id, "", notice);
      } catch (error) {
        console.error("[code-viewer] could not open the account", error);
        client.noteUsageCheckOpened(account.id, formatErrorDetail(error));
      }
    });
    actions.append(open, checkButton(t.usageCheckAgain));
    box.appendChild(actions);
    const opened = state?.opened;
    if (opened?.error) {
      box.appendChild(el("p", "usage-check-failed", t.usageCheckOpenFailed));
      box.appendChild(el("p", "usage-check-next", opened.error));
    } else if (opened) {
      box.appendChild(
        el(
          "p",
          "usage-check-next",
          t.usageCheckAfterOpen(
            stop.kind === "login"
              ? "login"
              : stop.kind === "timeout"
                ? "look"
                : "answer",
            t.usageCheckAgain,
          ),
        ),
      );
      if (opened.notice) {
        box.appendChild(el("p", "usage-check-failed", opened.notice));
      }
    }
  }
  if (failure.next) box.appendChild(el("p", "usage-check-next", failure.next));
  // 起動コマンドで claude を起こせなかった: その欄へ移るボタン。
  if (startFailed) {
    const commands = el(
      "button",
      "agents-secondary usage-check-commands",
      t.usageCheckOpenCommands,
    );
    commands.type = "button";
    commands.addEventListener("click", () => openers.openLaunchCommands());
    const actions = el("div", "usage-check-actions");
    actions.append(commands, checkButton(t.usageCheckAgain));
    box.appendChild(actions);
  }
  if (failure.more) {
    const more = el("details", "usage-check-more");
    // 一覧の取り直しのたびに描き直すので、開いたことを結果ごとに覚える。
    const key = `${account.id}\n${failure.more}`;
    more.open = openDetails.has(key);
    more.addEventListener("toggle", () => {
      if (more.open) openDetails.add(key);
      else openDetails.delete(key);
    });
    const copy = el(
      "button",
      "agents-secondary usage-check-copy",
      t.usageCheckCopy,
    );
    copy.type = "button";
    const copied = el("span", "usage-check-status");
    copied.setAttribute("role", "status");
    copy.addEventListener("click", async () => {
      copy.disabled = true;
      copied.textContent = "";
      try {
        await navigator.clipboard.writeText(failure.more);
        copied.textContent = t.copiedLocation;
      } catch (error) {
        showCopyFailure(
          copy,
          "copying usage error details failed",
          error,
          t.usageCheckCopy,
          1500,
        );
        copied.textContent = `${t.copyLocationFailed}: ${formatErrorDetail(error)}`;
      } finally {
        copy.disabled = false;
      }
    });
    const copyRow = el("div", "usage-check-actions");
    copyRow.append(copy, copied);
    more.append(
      el("summary", "", t.usageCheckMore),
      copyRow,
      el("pre", "usage-check-detail terminal-mono", failure.more),
    );
    box.appendChild(more);
  }
  return box;
}
