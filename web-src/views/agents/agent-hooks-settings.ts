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

/** 1 つのエージェントの行。 */
export type AgentHooksRowProps = {
  agent: HookAgent;
  state: AgentHookStatus["state"];
  stateLabel: string;
  path: { text: string; title: string };
  /** 次にやること (無ければ場所だけ取る)。 */
  action: {
    label: string;
    title: string;
    disabled: boolean;
    onClick(trigger: HTMLElement): void;
  } | null;
  detail: { text: string; problem: boolean } | null;
  result: { ok: boolean; text: string } | null;
  /** 入れた後の「開く」と、押した結果。 */
  open: {
    label: string;
    title: string;
    disabled: boolean;
    onClick(): void;
    opened: { ok: boolean; text: string } | null;
  } | null;
};

/** 届かなかった記録の畳み。 */
export type AgentHooksFailuresProps = {
  summary: string;
  lines: string;
  log: string;
  clearLabel: string;
  onClear(): void;
} | null;

export type AgentHooksSectionProps = {
  title: string;
  intro: string;
  help: {
    before: string;
    label: string;
    href: string;
    after: string;
    onOpen(): void;
  };
  /** 状態を読む前は null。 */
  rows: AgentHooksRowProps[] | null;
  loading: string | null;
  loadError: string | null;
  failures: AgentHooksFailuresProps;
  failuresError: string | null;
};

/** 確認の画面の中身。書けない設定ファイルなら手順 (guide)、書けるなら差分。 */
export type AgentHooksPlanBodyProps =
  | {
      kind: "guide";
      steps: string[];
      changesLabel: string;
      changes: string;
      notes: string[];
      detailsLabel: string;
      file: { label: string; value: string };
      link: { label: string; value: string } | null;
      writeBlocked: string;
    }
  | {
      kind: "diff";
      plan: AgentHookPlanResponse;
      home: string;
      diffText: { file: string; unchanged: string; drawFailed: string };
      notes: string[];
    };

export type AgentHooksView = {
  section(props: AgentHooksSectionProps): unknown;
  planBody(props: AgentHooksPlanBodyProps): unknown;
};

function rowTemplate(row: AgentHooksRowProps): TemplateResult {
  return html`<div class="agent-hooks-row ui-table-row" data-agent=${row.agent}><span
    class="agent-hooks-name"
  >${row.agent}</span><span class=${`agent-hooks-state agent-hooks-state-${row.state}`}
    ><i class="agent-hooks-mark" aria-hidden="true"></i>${row.stateLabel}</span
  ><span class="agent-hooks-path terminal-mono" title=${row.path.title}
    >${row.path.text}</span
  >${
    // 押せる動作が無くても場所は取っておく (行ごとに列がずれない)。
    row.action
      ? html`<button
          type="button"
          class="gdp-btn gdp-btn-sm agent-hooks-action"
          title=${row.action.title}
          ?disabled=${row.action.disabled}
          @click=${(event: MouseEvent) =>
            row.action?.onClick(event.currentTarget as HTMLElement)}
        >${row.action.label}</button>`
      : html`<button type="button" class="gdp-btn gdp-btn-sm agent-hooks-action" hidden></button>`
  }${
    row.detail
      ? html`<p
          class=${`agent-hooks-detail${row.detail.problem ? " agent-hooks-detail-problem" : ""}`}
        >${row.detail.text}</p>`
      : nothing
  }${row.result ? resultLineTemplate(row.result) : nothing}${
    row.open
      ? html`<div class="agent-hooks-open"><button
          type="button"
          class="gdp-btn gdp-btn-sm"
          title=${row.open.title}
          ?disabled=${row.open.disabled}
          @click=${row.open.onClick}
        >${row.open.label}</button>${
          row.open.opened ? resultLineTemplate(row.open.opened) : nothing
        }</div>`
      : nothing
  }</div>`;
}

function failuresTemplate(props: AgentHooksSectionProps): TemplateResult {
  const list = props.failures;
  return html`<details class="agent-hooks-failures" ?hidden=${!list}><summary
      >${list?.summary ?? ""}</summary
    ><pre class="terminal-observation-errors">${list?.lines ?? ""}</pre><div
      class="agent-hooks-failures-footer"
    ><p class="scope-settings-help">${list?.log ?? ""}</p><button
      type="button"
      class="gdp-btn gdp-btn-sm"
      @click=${() => list?.onClear()}
    >${list?.clearLabel ?? ""}</button></div><p
      class="scope-settings-help scope-settings-refresh-error"
      ?hidden=${props.failuresError === null}
    >${props.failuresError ?? ""}</p></details>`;
}

export const DEFAULT_VIEW: AgentHooksView = {
  section: (props) => html`<strong
      class="scope-settings-section-title"
      id=${AGENT_HOOKS_SECTION_ID}
      >${props.title}</strong
    ><p class="scope-settings-help">${props.intro}</p><p class="gdp-help-shortcut-link">${props.help.before}<a
      href=${props.help.href}
      @click=${(event: MouseEvent) => {
        event.preventDefault();
        props.help.onOpen();
      }}
    >${props.help.label}</a>${props.help.after}</p><div class="agent-hooks-rows">${
      props.rows
        ? props.rows.map(rowTemplate)
        : props.loading
          ? html`<p class="scope-settings-help">${props.loading}</p>`
          : nothing
    }</div><p
      class="scope-settings-help scope-settings-refresh-error"
      ?hidden=${props.loadError === null}
    >${props.loadError ?? ""}</p>${failuresTemplate(props)}`,
  planBody: (props) =>
    props.kind === "guide"
      ? html`<div class="agent-hooks-dialog"><ol class="agent-hooks-dialog-steps">${props.steps.map(
          (step) => html`<li>${step}</li>`,
        )}</ol>${labeledTemplate(props.changesLabel, props.changes, true)}${notesTemplate(
          props.notes,
        )}<details class="agent-hooks-dialog-details"><summary>${props.detailsLabel}</summary
          >${labeledTemplate(props.file.label, props.file.value, false)}${
            props.link
              ? labeledTemplate(props.link.label, props.link.value, false)
              : nothing
          }${labeledTemplate("", props.writeBlocked, true)}</details></div>`
      : html`<div class="agent-hooks-dialog">${settingsDiffTemplate(
          props.plan,
          props.home,
          props.diffText,
        )}${notesTemplate(props.notes)}</div>`,
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
  view: AgentHooksView = DEFAULT_VIEW,
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

  function short(path: string): string {
    const home = status?.home ?? "";
    return home ? abbreviateHome(path, home) : path;
  }

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

  async function openAgent(agent: HookAgent, result: RowResult) {
    const text = deps.getText();
    opening = agent;
    render();
    try {
      const notice = await deps.openAgent(agent);
      results.set(agent, {
        ...result,
        opened: {
          ok: true,
          text: [text.openedAgent(agent), notice].filter(Boolean).join("\n"),
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
  }

  function rowProps(row: AgentHookStatus): AgentHooksRowProps {
    const text = deps.getText();
    const choice = hookRowAction(row);
    const detail = detailText(row);
    const result = results.get(row.agent) ?? null;
    return {
      agent: row.agent,
      state: row.state,
      stateLabel: text.state[row.state],
      path: {
        text: row.symlink
          ? `${short(row.path)} → ${short(row.realPath)}`
          : short(row.path),
        title: row.symlink
          ? `${row.path}\n${text.symlinkTo(row.realPath)}`
          : row.path,
      },
      action: choice
        ? {
            label: text.action[choice.kind],
            title: text.actionTitle(row.agent, text.action[choice.kind]),
            disabled: busy !== null,
            onClick: (trigger) =>
              void review(row.agent, choice.action, trigger),
          }
        : null,
      detail: detail
        ? { text: detail, problem: hookRowTone(row) === "problem" }
        : null,
      result: result ? { ok: result.ok, text: result.text } : null,
      open:
        result?.open === true
          ? {
              label: text.openAgent[row.agent],
              title: text.openAgentTitle(row.agent),
              disabled: opening === row.agent,
              onClick: () => void openAgent(row.agent, result),
              opened: result.opened ?? null,
            }
          : null,
    };
  }

  function failuresProps(): AgentHooksFailuresProps {
    const text = deps.getText();
    const list = status?.failures;
    if (!list || list.total <= 0) return null;
    return {
      summary: text.failures(list.total),
      lines: list.recent
        .map((item) => {
          const time = item.at ? new Date(item.at).toLocaleString() : "?";
          const where = [item.agent, item.hookEvent, item.target, item.server]
            .filter(Boolean)
            .join(" ");
          return `${text.failureLine(time, item.stage, where)}\n${item.detail}`;
        })
        .join("\n\n"),
      log: text.failuresLog(list.log),
      clearLabel: text.failuresClear,
      onClear: () => void clearFailures(),
    };
  }

  function sectionProps(): AgentHooksSectionProps {
    const text = deps.getText();
    const link = deps.helpLink();
    return {
      title: text.title,
      intro: text.intro,
      help: {
        before: text.helpBefore,
        label: link.label,
        href: link.href,
        after: text.helpAfter,
        onOpen: () => deps.openHelp(),
      },
      rows: status ? status.agents.map(rowProps) : null,
      loading: !status && loadError === null ? text.loading : null,
      loadError,
      failures: failuresProps(),
      failuresError,
    };
  }

  function render(): void {
    renderOwned(element, view.section(sectionProps()));
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
   * 確認の画面の中身。生成された (書けない) 設定ファイルのときは手順。エラー
   * ではないので注意の色は使わない。書けない生の理由は捨てずに「詳細」に畳む。
   * 書けるときは、書き込む先と書く前と後の差分 (サーバが plan で作ったもの)。
   */
  function planBodyProps(plan: AgentHookPlanResponse): AgentHooksPlanBodyProps {
    const text = deps.getText();
    if (blockedPlan(plan)) {
      const notes = [text.dialogKept(plan.kept)];
      if (plan.action === "install")
        notes.push(text.guideLauncher(short(plan.launcher.path)));
      return {
        kind: "guide",
        steps: [...text.guideSteps[plan.action]],
        changesLabel:
          plan.added.length > 0 ? text.dialogAdded : text.dialogRemoved,
        changes: changesJson(plan.added.length > 0 ? plan.added : plan.removed),
        notes,
        detailsLabel: text.guideDetails,
        file: { label: text.dialogFile, value: short(plan.path) },
        link: plan.symlink
          ? { label: text.dialogLinkTarget, value: short(plan.realPath) }
          : null,
        writeBlocked: plan.writeBlocked,
      };
    }
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
    return {
      kind: "diff",
      plan,
      home: status?.home ?? "",
      diffText: {
        file: text.dialogFile,
        unchanged: text.dialogNothing,
        drawFailed: text.dialogDiffFailed,
      },
      notes,
    };
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
        body: view.planBody(planBodyProps(plan)),
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
