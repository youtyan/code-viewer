import { apiUrl } from "../../core/api-url";

// 設定画面の「エージェント連携」の節。claude と codex に状態を知らせる
// フックを、書き込む内容を見せて確認してから入れる・外す。
//
//   エージェント連携
//   入れると、claude と codex が作業中・入力待ち・完了を自分で知らせる…
//   入れ方と、入れると何が変わるかは ヘルプ › はじめに にあります。
//   claude  ● 設定済み        ~/.claude/settings.json        [外す]
//   codex   ○ 未設定          ~/.codex/hooks.json            [入れる]
//   ▸ フックの申告が code-viewer に届かなかったことが 3 件あります
//
// 1 行に置くボタンは 1 つ (次にやること)。押すとサーバに計画を作らせ
// (/_agent/hooks/plan、書かない)、確認の画面で「どのファイルの・どこに・
// 何が」足される・消されるかを見せる。実行するとその計画を作ったときの
// 中身のハッシュを添えて書かせるので、見せたものと書くものがずれない。
// 結果 (バックアップの場所か、失敗の理由の全文) はその行に残す。

import { html, nothing, type TemplateResult } from "lit/html.js";
import type {
  AgentHookApplyResponse,
  AgentHookPlanResponse,
  AgentHookStatus,
  AgentHooksResponse,
  HookAction,
  HookAgent,
  HookChange,
} from "../../core/agent-hooks";
import { hookRowAction, hookRowTone } from "../../core/agent-hooks";
import { abbreviateHome } from "../../core/agent-overview";
import { formatErrorDetail } from "../../core/error-detail";
import { BACKGROUND_REQUEST_HEADER } from "../../core/network-activity";
import { renderOwned, templateElement } from "../ui/renderer";
import { showFormDialog } from "../ui-dialog";
import { responseFailure } from "./accounts-client";
import {
  labeledTemplate,
  notesTemplate,
  resultLineTemplate,
} from "./accounts-dialogs";
import type { AgentHooksText } from "./i18n";
import { settingsDiffTemplate } from "./settings-diff";

export type AgentHooksSettingsDeps = {
  getText(): AgentHooksText;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  actionHeaders(): HeadersInit;
  /** 入れた・外した後。エージェント一覧の案内を出し直すため。 */
  onChanged(status: AgentHooksResponse): void;
  /**
   * 説明の下に置くヘルプへのリンク。label はヘルプの節の名前 (「ヘルプ ›
   * はじめに」)、href は中ボタン・コピー用、押すと open。
   */
  helpLink(): { label: string; href: string };
  openHelp(): void;
  /**
   * 既定のアカウントで今のプロジェクトのフォルダのエージェントを起こし、
   * ターミナルのタブで前に出す (入れた後の「開く」)。戻り値は、使用量を
   * 記録できないなどの知らせ (無ければ空)。
   */
  openAgent(agent: HookAgent): Promise<string>;
};

export type AgentHooksSettings = {
  element: HTMLElement;
  refresh(): Promise<void>;
  localize(): void;
};

/** 節が画面にある間の取り直しの間隔。 */
const AGENT_HOOKS_POLL_MS = 3000;

/** 見出しの id。エージェント一覧の案内からここへ飛ぶ。 */
export const AGENT_HOOKS_SECTION_ID = "agent-hooks-section-title";

/** 説明の下のリンクが開くヘルプの節 (フックの入れ方と、状態の決め方)。 */
export const AGENT_HOOKS_HELP_SECTION = "agent-hooks";

type RowResult = {
  ok: boolean;
  text: string;
  /** 入れた後: 「開く」を出す。opened はそれを押した結果。 */
  open?: boolean;
  opened?: { ok: boolean; text: string };
};

/** 足す・消すものを、設定ファイルの hooks と同じ形にまとめて見せる。 */
function changesJson(changes: HookChange[]): string {
  const hooks: Record<string, unknown[]> = {};
  for (const change of changes) {
    const list = hooks[change.event] ?? [];
    list.push(change.entry);
    hooks[change.event] = list;
  }
  return JSON.stringify({ hooks }, null, 2);
}

export function createAgentHooksSettings(
  deps: AgentHooksSettingsDeps,
): AgentHooksSettings {
  // 節の箱。設定のページが置き、中はここが描く。
  const element = templateElement(
    html`<div class="scope-settings-section agent-hooks-section"></div>`,
  );
  /** 状態を読めなかった理由 (読めたら null)。 */
  let loadError: string | null = null;
  /** 届かなかった記録を消せなかった理由。 */
  let failuresError: string | null = null;
  /** 入れた後の「開く」を押して待っている行。 */
  let opening: HookAgent | null = null;

  let status: AgentHooksResponse | null = null;
  let generation = 0;
  /** 動作中の行。二重に押させない。 */
  let busy: HookAgent | null = null;
  const results = new Map<HookAgent, RowResult>();
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param background 周期の取り直し。通信中の表示と取消の対象から外し
   *   (BACKGROUND_REQUEST_HEADER)、動作中の行があれば取らない。
   */
  async function load(background = false): Promise<void> {
    if (background && busy) return;
    const mine = ++generation;
    const text = deps.getText();
    try {
      const res = background
        ? await fetch(apiUrl("agentHooks"), {
            headers: { [BACKGROUND_REQUEST_HEADER]: "1" },
          })
        : await deps.trackLoad(fetch(apiUrl("agentHooks")));
      if (!res.ok) throw await responseFailure(res, text.loadFailed);
      const next = (await res.json()) as AgentHooksResponse;
      if (mine !== generation) return;
      status = next;
      loadError = null;
      deps.onChanged(next);
    } catch (error) {
      if (mine !== generation) return;
      console.error("[code-viewer] agent hook status failed", error);
      loadError = `${text.loadFailed}\n${formatErrorDetail(error)}`;
    }
    render();
  }

  function stateLabel(row: AgentHookStatus): TemplateResult {
    const text = deps.getText();
    return html`<span class=${`agent-hooks-state agent-hooks-state-${row.state}`}
      ><i class="agent-hooks-mark" aria-hidden="true"></i>${text.state[row.state]}</span
    >`;
  }

  function detailText(row: AgentHookStatus): string {
    const text = deps.getText();
    const lines: string[] = [];
    if (row.state === "unreadable") lines.push(row.detail);
    if (row.state === "no-config-dir") lines.push(text.noConfigDir(row.detail));
    if (row.state === "broken") lines.push(text.broken(row.detail));
    // 生成された設定ファイルは異常ではない。生の理由は確認の画面の「詳細」
    // に回し、ここは次にやることを 1 文で言う (設定済みなら言うことは無い)。
    if (hookRowTone(row) === "generated" && row.state !== "installed") {
      lines.push(text.generated);
    }
    return lines.join("\n");
  }

  function rowTemplate(row: AgentHookStatus): TemplateResult {
    const text = deps.getText();
    const home = status?.home ?? "";
    const choice = hookRowAction(row);
    const detail = detailText(row);
    const result = results.get(row.agent);
    return html`<div class="agent-hooks-row ui-table-row" data-agent=${row.agent}><span
      class="agent-hooks-name"
    >${row.agent}</span>${stateLabel(row)}<span
      class="agent-hooks-path terminal-mono"
      title=${row.symlink ? `${row.path}\n${text.symlinkTo(row.realPath)}` : row.path}
    >${
      row.symlink
        ? `${abbreviateHome(row.path, home)} → ${abbreviateHome(row.realPath, home)}`
        : abbreviateHome(row.path, home)
    }</span>${
      // 押せる動作が無くても場所は取っておく (行ごとに列がずれない)。
      choice
        ? html`<button
            type="button"
            class="gdp-btn gdp-btn-sm agent-hooks-action"
            title=${text.actionTitle(row.agent, text.action[choice.kind])}
            ?disabled=${busy !== null}
            @click=${(event: MouseEvent) =>
              void review(
                row.agent,
                choice.action,
                event.currentTarget as HTMLElement,
              )}
          >${text.action[choice.kind]}</button>`
        : html`<button type="button" class="gdp-btn gdp-btn-sm agent-hooks-action" hidden></button>`
    }${
      detail
        ? html`<p
            class=${`agent-hooks-detail${hookRowTone(row) === "problem" ? " agent-hooks-detail-problem" : ""}`}
          >${detail}</p>`
        : nothing
    }${
      result
        ? html`${resultLineTemplate(result)}${
            result.open ? openAgentRow(row.agent, result) : nothing
          }`
        : nothing
    }</div>`;
  }

  /** 入れた結果の下の「claude を開く」「codex を開く」と、押した結果。 */
  function openAgentRow(agent: HookAgent, result: RowResult): TemplateResult {
    const text = deps.getText();
    return html`<div class="agent-hooks-open"><button
      type="button"
      class="gdp-btn gdp-btn-sm"
      title=${text.openAgentTitle(agent)}
      ?disabled=${opening === agent}
      @click=${async () => {
        opening = agent;
        render();
        try {
          const notice = await deps.openAgent(agent);
          results.set(agent, {
            ...result,
            opened: {
              ok: true,
              text: [text.openedAgent(agent), notice]
                .filter(Boolean)
                .join("\n"),
            },
          });
        } catch (error) {
          console.error("[code-viewer] could not open the agent", error);
          results.set(agent, {
            ...result,
            opened: {
              ok: false,
              text: `${text.openAgentFailed(agent)}\n${formatErrorDetail(error)}`,
            },
          });
        }
        opening = null;
        render();
      }}
    >${text.openAgent[agent]}</button>${
      result.opened ? resultLineTemplate(result.opened) : nothing
    }</div>`;
  }

  function failuresTemplate(): TemplateResult {
    const text = deps.getText();
    const list = status?.failures;
    const shown = !!list && list.total > 0;
    return html`<details class="agent-hooks-failures" ?hidden=${!shown}><summary
        >${shown ? text.failures(list.total) : ""}</summary
      ><pre class="terminal-observation-errors">${
        shown
          ? list.recent
              .map((item) => {
                const time = item.at ? new Date(item.at).toLocaleString() : "?";
                const where = [
                  item.agent,
                  item.hookEvent,
                  item.target,
                  item.server,
                ]
                  .filter(Boolean)
                  .join(" ");
                return `${text.failureLine(time, item.stage, where)}\n${item.detail}`;
              })
              .join("\n\n")
          : ""
      }</pre><div class="agent-hooks-failures-footer"><p class="scope-settings-help">${
        shown ? text.failuresLog(list.log) : ""
      }</p><button
        type="button"
        class="gdp-btn gdp-btn-sm"
        @click=${() => void clearFailures()}
      >${shown ? text.failuresClear : ""}</button></div><p
        class="scope-settings-help scope-settings-refresh-error"
        ?hidden=${failuresError === null}
      >${failuresError ?? ""}</p></details>`;
  }

  function sectionTemplate(): TemplateResult {
    const text = deps.getText();
    const link = deps.helpLink();
    return html`<strong class="scope-settings-section-title" id=${AGENT_HOOKS_SECTION_ID}
        >${text.title}</strong
      ><p class="scope-settings-help">${text.intro}</p><p class="gdp-help-shortcut-link">${text.helpBefore}<a
        href=${link.href}
        @click=${(event: MouseEvent) => {
          event.preventDefault();
          deps.openHelp();
        }}
      >${link.label}</a>${text.helpAfter}</p><div class="agent-hooks-rows">${
        status
          ? status.agents.map(rowTemplate)
          : loadError === null
            ? html`<p class="scope-settings-help">${text.loading}</p>`
            : nothing
      }</div><p
        class="scope-settings-help scope-settings-refresh-error"
        ?hidden=${loadError === null}
      >${loadError ?? ""}</p>${failuresTemplate()}`;
  }

  function render(): void {
    renderOwned(element, sectionTemplate());
  }

  async function fetchPlan(
    agent: HookAgent,
    action: HookAction,
  ): Promise<AgentHookPlanResponse> {
    const query = new URLSearchParams({ agent, action });
    const res = await deps.trackLoad(
      fetch(`${apiUrl("agentHooksPlan")}?${query}`),
    );
    if (!res.ok) throw await responseFailure(res, deps.getText().planFailed);
    return (await res.json()) as AgentHookPlanResponse;
  }

  /** 設定ファイルを書き換える必要があるのに書けない。 */
  function blockedPlan(plan: AgentHookPlanResponse): boolean {
    return plan.writeBlocked !== "" && plan.changed;
  }

  /**
   * 生成された (書けない) 設定ファイルのときの手順。エラーではないので
   * 注意の色は使わない。書けない生の理由は捨てずに「詳細」に畳む。
   */
  function guideBody(plan: AgentHookPlanResponse): TemplateResult {
    const text = deps.getText();
    const changes = plan.added.length > 0 ? plan.added : plan.removed;
    const home = status?.home ?? "";
    const short = (path: string) => (home ? abbreviateHome(path, home) : path);
    const notes = [text.dialogKept(plan.kept)];
    if (plan.action === "install") {
      notes.push(text.guideLauncher(short(plan.launcher.path)));
    }
    return html`<div class="agent-hooks-dialog"><ol class="agent-hooks-dialog-steps">${text.guideSteps[
      plan.action
    ].map((step) => html`<li>${step}</li>`)}</ol>${labeledTemplate(
      plan.added.length > 0 ? text.dialogAdded : text.dialogRemoved,
      changesJson(changes),
      true,
    )}${notesTemplate(notes)}<details class="agent-hooks-dialog-details"><summary
      >${text.guideDetails}</summary
    >${labeledTemplate(text.dialogFile, short(plan.path), false)}${
      plan.symlink
        ? labeledTemplate(text.dialogLinkTarget, short(plan.realPath), false)
        : nothing
    }${labeledTemplate("", plan.writeBlocked, true)}</details></div>`;
  }

  function planBody(plan: AgentHookPlanResponse): TemplateResult {
    if (blockedPlan(plan)) return guideBody(plan);
    const text = deps.getText();
    // パスは ~ で縮める (statusLine の確認の画面と同じ)。
    const home = status?.home ?? "";
    const short = (path: string) => (home ? abbreviateHome(path, home) : path);
    const notes: string[] = [];
    if (plan.changed) {
      notes.push(
        plan.backupPath
          ? text.dialogBackup(
              // 名前の時刻は書いた瞬間のものになる。確認した時点の時刻を
              // 出すと結果と食い違うので伏せる。
              short(plan.backupPath).replace(
                /-\d{8}-\d{6}$/,
                "-<YYYYMMDD-HHMMSS>",
              ),
            )
          : text.dialogNewFile,
      );
    }
    notes.push(text.dialogKept(plan.kept));
    if (plan.changed && plan.formattingChanged)
      notes.push(text.dialogFormatting);
    if (plan.launcher.write)
      notes.push(text.dialogLauncher(short(plan.launcher.path)));
    notes.push(text.effect[plan.agent][plan.action]);
    // 書き込む先と、書く前と後の差分 (サーバが plan で作ったもの) が主役。
    return html`<div class="agent-hooks-dialog">${settingsDiffTemplate(
      plan,
      home,
      {
        file: text.dialogFile,
        unchanged: text.dialogNothing,
        drawFailed: text.dialogDiffFailed,
      },
    )}${notesTemplate(notes)}</div>`;
  }

  /**
   * @param launcherOnly 設定ファイルは書かず、起動スクリプトだけを用意する
   *   (書けない設定ファイルのために、利用者がフックを自分で写すとき)。
   */
  async function apply(
    plan: AgentHookPlanResponse,
    launcherOnly = false,
  ): Promise<RowResult> {
    const text = deps.getText();
    try {
      const res = await deps.trackLoad(
        fetch(apiUrl("agentHooksApply"), {
          method: "POST",
          headers: deps.actionHeaders(),
          body: JSON.stringify({
            agent: plan.agent,
            action: plan.action,
            baseHash: plan.baseHash,
            realPath: plan.realPath,
            fileIdentity: plan.fileIdentity,
            ...(launcherOnly ? { launcherOnly: true } : {}),
          }),
        }),
      );
      if (!res.ok) throw await responseFailure(res, text.applyFailed);
      const result = (await res.json()) as AgentHookApplyResponse;
      const lines = launcherOnly
        ? [text.dialogCopied]
        : [result.changed ? text.applied[plan.action] : text.unchanged];
      // 確認の画面と同じく、ホームの下は ~ で見せる。
      const home = status?.home ?? "";
      const short = (path: string) =>
        home ? abbreviateHome(path, home) : path;
      if (result.backupPath)
        lines.push(text.backupAt(short(result.backupPath)));
      if (result.launcherWritten)
        lines.push(text.launcherWritten(short(plan.launcher.path)));
      const installed =
        !launcherOnly &&
        plan.action === "install" &&
        (result.changed || result.launcherWritten);
      if (installed) lines.push(text.afterInstall[plan.agent]);
      else if (!launcherOnly && (result.changed || result.launcherWritten)) {
        lines.push(text.effect[plan.agent][plan.action]);
      }
      return { ok: true, text: lines.join("\n"), open: installed };
    } catch (error) {
      console.error("[code-viewer] agent hook change failed", error);
      return { ok: false, text: formatErrorDetail(error) };
    }
  }

  async function review(
    agent: HookAgent,
    action: HookAction,
    trigger: HTMLElement,
  ): Promise<void> {
    if (busy) return;
    const text = deps.getText();
    busy = agent;
    results.delete(agent);
    render();
    try {
      let plan: AgentHookPlanResponse;
      try {
        plan = await fetchPlan(agent, action);
      } catch (error) {
        console.error("[code-viewer] agent hook plan failed", error);
        results.set(agent, { ok: false, text: formatErrorDetail(error) });
        return;
      }
      const blocked = blockedPlan(plan);
      const outcome = await showFormDialog<RowResult>({
        title: blocked
          ? text.guideTitle(agent, action)
          : text.dialogTitle(agent, action),
        body: planBody(plan),
        wide: true,
        submitLabel: blocked ? text.dialogCopy : text.run[action],
        cancelLabel: blocked ? text.close : text.cancel,
        danger: !blocked && action === "uninstall",
        focusReturnTarget: trigger,
        submit: async () => {
          if (!blocked) return apply(plan);
          // 書けない場所 (読み取り専用のリンク先など) なら、変えるものを
          // 手で生成元に写せるように渡す。写したフックが呼ぶ起動スクリプト
          // は先に用意する (確認の画面に書いてある)。
          await navigator.clipboard.writeText(
            changesJson(plan.added.length > 0 ? plan.added : plan.removed),
          );
          if (action !== "install") {
            return { ok: true, text: text.dialogCopied };
          }
          return apply(plan, true);
        },
      });
      if (outcome) results.set(agent, outcome);
    } finally {
      busy = null;
      await load();
    }
  }

  async function clearFailures(): Promise<void> {
    const text = deps.getText();
    failuresError = null;
    render();
    try {
      const res = await deps.trackLoad(
        fetch(apiUrl("agentHooksFailures"), {
          method: "DELETE",
          headers: deps.actionHeaders(),
        }),
      );
      if (!res.ok) throw await responseFailure(res, text.failuresClearFailed);
    } catch (error) {
      console.error("[code-viewer] clearing hook failures failed", error);
      failuresError = formatErrorDetail(error);
      render();
      return;
    }
    await load();
  }

  /**
   * 節が画面にある間だけ取り直す。生成された設定ファイルに利用者が自分で
   * フックを足して生成し直したとき、押し直さなくても行が「設定済み」に
   * 変わるように。節が外れたら (別の画面へ移ったら) 止まり、次に開いた
   * ときの refresh で始まり直す。
   */
  function schedulePoll(): void {
    if (pollTimer !== null) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      if (!element.isConnected) return;
      void load(true).finally(schedulePoll);
    }, AGENT_HOOKS_POLL_MS);
  }

  async function refresh(): Promise<void> {
    await load();
    schedulePoll();
  }

  render();
  return {
    element,
    refresh,
    localize: render,
  };
}
