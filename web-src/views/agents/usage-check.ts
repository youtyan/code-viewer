// 「使用量を確かめる」の部品。全体ボードのアカウントのカード (accounts-band.ts) と、
// 設定のアカウントの使用量の行 (accounts-settings.ts) が同じものを出す。
//
//   [使用量を確かめる]                     ← 値が無い・古い claude のときだけ
//   確かめています…                         ← 走っている間 (ボタンは押せない)
//   時間内に使用量が届きませんでした         ← 失敗: 理由
//   claude が画面で何かを…                   ← 次の手順
//   ▸ 詳しく                                 ← 判定に使った根拠 (画面の最後の行など)
//
// claude の画面 (初回の案内・信頼の確認・ログイン) で止まったときは、次の手順の
// 文の代わりに、そのフォルダとその場で済ませるボタンを出す:
//
//   このフォルダをこのアカウントでまだ信頼していません
//   ~/work/…/sample-app                      ← 等幅、長ければ真ん中を省略
//   [このアカウントで開く] [もう一度確かめる]  ← ログインなら [ログイン]
//   開いたタブで答えてから、「もう一度確かめる」を押してください。  ← 開いた後
//
// 押すと確認の画面を出さずにすぐ始める (わずかに使用量を使うことはボタンの
// title に書く)。codex には出さない (codex はセッション記録から読む)。
// 状態は AccountsClient が持つので、カードと設定の行で同じ結果が見える。
// 値が取れたら何も出さず、カードは普段の表示 (使用量のバー) に戻る。

import {
  type AccountStatus,
  type UsageCheckFailure,
  usageIsStale,
} from "../../core/agent-accounts";
import { abbreviateHome } from "../../core/agent-overview";
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

/** 確かめる意味があるか (claude で、値が無い・古い)。 */
export function usageCheckWanted(account: AccountStatus, now: number): boolean {
  if (account.agent !== "claude") return false;
  const usage = account.usage;
  return usage.status !== "ok" || usageIsStale(usage.observedAt, now);
}

/**
 * カードの中にボタンを出すか。確かめる意味があり、押せば進みうるとき。
 * statusLine を包んでいない (設定で有効にするのが先) と未ログイン (カードに
 * ログインのボタンがある) には出さない。⋯ のメニューからは押せる (理由が返る)。
 */
export function usageCheckOffered(
  account: AccountStatus,
  now: number,
): boolean {
  if (!usageCheckWanted(account, now)) return false;
  if (account.usage.status !== "ok" && account.usage.reason === "not-wrapped")
    return false;
  return (
    account.login.state !== "logged-out" &&
    account.login.state !== "no-config-dir"
  );
}

/** ⋯ のメニューの項目。claude だけ。 */
export function usageCheckMenuItem(
  account: AccountStatus,
  client: AccountsClient,
  t: AccountsText,
): Exclude<ContextMenuItem, { kind: "separator" }> | null {
  if (account.agent !== "claude") return null;
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
  if (account.agent !== "claude") return null;
  const state = client.usageCheck(account.id);
  const running = state?.running === true;
  // 失敗は、値が無い・古い間だけ出す (ほかのセッションで値が届いたら消す)。
  // 閉じられなかったことは値に関係なく出す。
  const failure = state ? failureLines(state, t) : null;
  const showFailure =
    failure !== null &&
    (usageCheckWanted(account, now) ||
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
  if (running || (offered && !stop && !startFailed)) {
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
    more.append(
      el("summary", "", t.usageCheckMore),
      el("pre", "usage-check-detail terminal-mono", failure.more),
    );
    box.appendChild(more);
  }
  return box;
}
