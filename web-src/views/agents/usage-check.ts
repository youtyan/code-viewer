// 「使用量を確かめる」の部品。全体ボードのアカウントのカード (accounts-band.ts) と、
// 設定のアカウントの使用量の行 (accounts-settings.ts) が同じものを出す。
//
//   [使用量を確かめる]                     ← 値が無い・古い claude のときだけ
//   確かめています…                         ← 走っている間 (ボタンは押せない)
//   フォルダの信頼の確認で止まりました       ← 失敗: 理由
//   このアカウントで…を済ませてから押してください  ← 次の手順
//   ▸ 詳しく                                 ← 判定に使った根拠 (画面の最後の行など)
//
// 押すと確認の画面を出さずにすぐ始める (わずかに使用量を使うことはボタンの
// title に書く)。codex には出さない (codex はセッション記録から読む)。
// 状態は AccountsClient が持つので、カードと設定の行で同じ結果が見える。
// 値が取れたら何も出さず、カードは普段の表示 (使用量のバー) に戻る。

import { type AccountStatus, usageIsStale } from "../../core/agent-accounts";
import type { ContextMenuItem } from "../context-menu";
import type { AccountsClient, UsageCheckState } from "./accounts-client";
import { el } from "./accounts-dialogs";
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

function failureLines(
  state: UsageCheckState,
  t: AccountsText,
): { reason: string; next: string; more: string } | null {
  if (state.running) return null;
  if (state.error) {
    return { reason: t.usageCheckRequestFailed, next: "", more: state.error };
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
    };
  }
  const evidence = response.evidence.length
    ? `${t.usageCheckEvidence}\n${response.evidence.join("\n")}`
    : "";
  return {
    reason: t.usageCheckFailed[response.reason],
    next: t.usageCheckNext[response.reason],
    more: [
      response.detail,
      evidence,
      response.closeError
        ? `${t.usageCheckCloseFailed}\n${response.closeError}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * ボタン・走っている間の文・失敗の理由と次の手順。出すものが無ければ null。
 * name はボタンに添える表示名 (設定の行で複数のアカウントが並ぶとき)。
 */
export function usageCheckBlock(
  account: AccountStatus,
  now: number,
  client: AccountsClient,
  t: AccountsText,
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
  const offered = usageCheckOffered(account, now);
  if (!running && !showFailure && !offered) return null;

  const box = el("div", "usage-check");
  box.dataset.account = account.id;
  if (offered || running) {
    const button = el(
      "button",
      "agents-secondary usage-check-button",
      options.name ? t.usageCheckFor(options.name) : t.usageCheck,
    );
    button.type = "button";
    button.title = t.usageCheckTitle;
    button.disabled = running;
    button.addEventListener("click", () => void client.checkUsage(account.id));
    box.appendChild(button);
  }
  if (running) {
    const line = el("p", "usage-check-status", t.usageChecking);
    line.setAttribute("role", "status");
    box.appendChild(line);
    return box;
  }
  if (showFailure && failure) {
    const reason = el("p", "usage-check-failed", failure.reason);
    reason.setAttribute("role", "alert");
    box.appendChild(reason);
    if (failure.next)
      box.appendChild(el("p", "usage-check-next", failure.next));
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
  }
  return box;
}
