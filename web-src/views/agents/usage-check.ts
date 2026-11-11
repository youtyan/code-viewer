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
import { html, nothing, type TemplateResult } from "lit/html.js";
import type { ContextMenuItem } from "../context-menu";
import { defineElement } from "../ui/element";
import type { AccountsClient, UsageCheckState } from "./accounts-client";
import { type AccountDialogs, accountDisplayName } from "./accounts-dialogs";
import type { AccountsText } from "./accounts-i18n";

export const CV_USAGE_CHECK_COPY = "cv-usage-check-copy";

/**
 * cv-usage-check-copy: 失敗の全文をコピーするボタンと、その結果の文。結果の文は
 * この部品が持つ (押してから描き直されるまでの間だけの状態)。
 */
export function defineCvUsageCheckCopy(): void {
  defineElement(
    CV_USAGE_CHECK_COPY,
    (Base) =>
      class extends Base {
        static props = ["text", "label", "copiedLabel", "failedLabel"];
        declare text: string;
        declare label: string;
        declare copiedLabel: string;
        declare failedLabel: string;
        #busy = false;
        #status = "";

        #copy = async (event: Event) => {
          const button = event.currentTarget as HTMLButtonElement;
          this.#busy = true;
          this.#status = "";
          this.renderNow();
          try {
            await navigator.clipboard.writeText(this.text);
            this.#status = this.copiedLabel;
          } catch (error) {
            showCopyFailure(
              button,
              "copying usage error details failed",
              error,
              this.label,
              1500,
            );
            this.#status = `${this.failedLabel}: ${formatErrorDetail(error)}`;
          } finally {
            this.#busy = false;
            this.renderNow();
          }
        };

        protected template() {
          return html`<div class="usage-check-actions"><button
            type="button"
            class="agents-secondary usage-check-copy"
            ?disabled=${this.#busy}
            @click=${this.#copy}
          >${this.label}</button><span class="usage-check-status" role="status">${this.#status}</span></div>`;
        }
      },
  );
}

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
function folderLineTemplate(folder: string, home: string): TemplateResult {
  const shown = home ? abbreviateHome(folder, home) : folder;
  const cut = shown.lastIndexOf("/", shown.length - 2) + 1;
  return html`<p class="usage-check-folder terminal-mono" title=${folder}><span
      class="usage-check-folder-head"
    >${shown.slice(0, cut)}</span><span class="usage-check-folder-tail"
      >${shown.slice(cut)}</span
    ></p>`;
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
): TemplateResult | null {
  defineCvUsageCheckCopy();
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

  const checkButton = (label: string) =>
    html`<button
      type="button"
      class="agents-secondary usage-check-button"
      title=${t.usageCheckTitle}
      ?disabled=${running}
      @click=${() => void client.checkUsage(account.id)}
    >${label}</button>`;
  // 画面で止まった・起動に失敗したときは、下の「もう一度確かめる」が同じ役をする。
  const startFailed =
    showFailure &&
    state?.response?.status === "failed" &&
    state.response.reason === "start-failed";
  const first =
    running || ((offered || refreshFailed) && !stop && !startFailed)
      ? checkButton(options.name ? t.usageCheckFor(options.name) : t.usageCheck)
      : nothing;
  if (running)
    return html`<div class="usage-check" data-account=${account.id}>${first}<p
        class="usage-check-status"
        role="status"
      >${t.usageChecking}</p></div>`;
  if (!showFailure || !failure)
    return html`<div class="usage-check" data-account=${account.id}>${first}</div>`;
  const opened = state?.opened;
  const stopPart = stop
    ? html`${folderLineTemplate(stop.folder, client.snapshot().data?.home ?? "")}<div
          class="usage-check-actions"
        ><button
          type="button"
          class="agents-secondary usage-check-open"
          title=${stop.kind === "login" ? t.loginTitle(accountDisplayName(account, t)) : t.usageCheckOpenHereTitle(stop.folder)}
          @click=${async () => {
            try {
              let notice = "";
              if (stop.kind === "login") await openers.login(account);
              else notice = await openers.openHere(account, stop.folder);
              client.noteUsageCheckOpened(account.id, "", notice);
            } catch (error) {
              console.error("[code-viewer] could not open the account", error);
              client.noteUsageCheckOpened(account.id, formatErrorDetail(error));
            }
          }}
        >${stop.kind === "login" ? t.loginButton : t.usageCheckOpenHere}</button>${checkButton(
          t.usageCheckAgain,
        )}</div>${
          opened?.error
            ? html`<p class="usage-check-failed">${t.usageCheckOpenFailed}</p><p
                  class="usage-check-next"
                >${opened.error}</p>`
            : opened
              ? html`<p class="usage-check-next">${t.usageCheckAfterOpen(
                  stop.kind === "login"
                    ? "login"
                    : stop.kind === "timeout"
                      ? "look"
                      : "answer",
                  t.usageCheckAgain,
                )}</p>${
                  opened.notice
                    ? html`<p class="usage-check-failed">${opened.notice}</p>`
                    : nothing
                }`
              : nothing
        }`
    : nothing;
  // 一覧の取り直しのたびに描き直すので、開いたことを結果ごとに覚える。
  const key = `${account.id}\n${failure.more}`;
  return html`<div class="usage-check" data-account=${account.id}>${first}<p
      class="usage-check-failed"
      role="alert"
    >${failure.reason}</p>${stopPart}${
      failure.next
        ? html`<p class="usage-check-next">${failure.next}</p>`
        : nothing
    }${
      // 起動コマンドで claude を起こせなかった: その欄へ移るボタン。
      startFailed
        ? html`<div class="usage-check-actions"><button
              type="button"
              class="agents-secondary usage-check-commands"
              @click=${() => openers.openLaunchCommands()}
            >${t.usageCheckOpenCommands}</button>${checkButton(t.usageCheckAgain)}</div>`
        : nothing
    }${
      failure.more
        ? html`<details
            class="usage-check-more"
            .open=${openDetails.has(key)}
            @toggle=${(event: Event) => {
              if ((event.currentTarget as HTMLDetailsElement).open)
                openDetails.add(key);
              else openDetails.delete(key);
            }}
          ><summary class="">${t.usageCheckMore}</summary><cv-usage-check-copy
            .text=${failure.more}
            .label=${t.usageCheckCopy}
            .copiedLabel=${t.copiedLocation}
            .failedLabel=${t.copyLocationFailed}
          ></cv-usage-check-copy><pre class="usage-check-detail terminal-mono">${failure.more}</pre></details>`
        : nothing
    }</div>`;
}
