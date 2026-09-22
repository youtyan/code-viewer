import { apiUrl } from "../../core/api-url";
// 設定画面の「エージェント連携」の節。claude と codex に状態を知らせる
// フックを、書き込む内容を見せて確認してから入れる・外す。
//
//   エージェント連携
//   claude  ● 設定済み        ~/.claude/settings.json        [外す]
//   codex   ○ 未設定          ~/.codex/hooks.json            [入れる]
//   ▸ フックの申告が code-viewer に届かなかったことが 3 件あります
//
// 1 行に置くボタンは 1 つ (次にやること)。押すとサーバに計画を作らせ
// (/_agent/hooks/plan、書かない)、確認の画面で「どのファイルの・どこに・
// 何が」足される・消されるかを見せる。実行するとその計画を作ったときの
// 中身のハッシュを添えて書かせるので、見せたものと書くものがずれない。
// 結果 (バックアップの場所か、失敗の理由の全文) はその行に残す。

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
import { showFormDialog } from "../ui-dialog";
import type { AgentHooksText } from "./i18n";

export type AgentHooksSettingsDeps = {
  getText(): AgentHooksText;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  actionHeaders(): HeadersInit;
  /** 入れた・外した後。エージェント一覧の案内を出し直すため。 */
  onChanged(status: AgentHooksResponse): void;
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

type RowResult = { ok: boolean; text: string };

async function failureText(res: Response, operation: string): Promise<string> {
  const body = await res.text();
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") detail = parsed.error;
  } catch {
    // JSON でなければ本文をそのまま出す。
  }
  return `${operation} (HTTP ${res.status}): ${detail || res.statusText}`;
}

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

function paragraph(text: string, className = ""): HTMLParagraphElement {
  const p = document.createElement("p");
  if (className) p.className = className;
  p.textContent = text;
  return p;
}

/** 見出し付きの値 1 つ。短い値 (パス) は横に、長い値 (JSON) は下に置く。 */
function labeled(label: string, value: string, block: boolean): HTMLElement {
  const box = document.createElement("div");
  box.className = block
    ? "agent-hooks-dialog-block"
    : "agent-hooks-dialog-field";
  const name = document.createElement("span");
  name.className = "agent-hooks-dialog-label";
  name.textContent = label;
  const code = document.createElement(block ? "pre" : "code");
  code.className = block
    ? "agent-hooks-dialog-code terminal-mono"
    : "terminal-mono";
  code.textContent = value;
  box.append(name, code);
  return box;
}

export function createAgentHooksSettings(
  deps: AgentHooksSettingsDeps,
): AgentHooksSettings {
  const element = document.createElement("div");
  element.className = "scope-settings-section agent-hooks-section";
  const title = document.createElement("strong");
  title.className = "scope-settings-section-title";
  title.id = AGENT_HOOKS_SECTION_ID;
  const intro = paragraph("", "scope-settings-help");
  const rows = document.createElement("div");
  rows.className = "agent-hooks-rows";
  const loadError = paragraph(
    "",
    "scope-settings-help scope-settings-refresh-error",
  );
  loadError.hidden = true;
  const failures = document.createElement("details");
  failures.className = "agent-hooks-failures";
  failures.hidden = true;
  const failuresSummary = document.createElement("summary");
  const failuresBody = document.createElement("pre");
  failuresBody.className = "terminal-observation-errors";
  const failuresFooter = document.createElement("div");
  failuresFooter.className = "agent-hooks-failures-footer";
  const failuresLog = paragraph("", "scope-settings-help");
  const failuresClear = document.createElement("button");
  failuresClear.type = "button";
  failuresClear.className = "gdp-btn gdp-btn-sm";
  const failuresError = paragraph(
    "",
    "scope-settings-help scope-settings-refresh-error",
  );
  failuresError.hidden = true;
  failuresFooter.append(failuresLog, failuresClear);
  failures.append(failuresSummary, failuresBody, failuresFooter, failuresError);
  element.append(title, intro, rows, loadError, failures);

  let status: AgentHooksResponse | null = null;
  let generation = 0;
  /** 動作中の行。二重に押させない。 */
  let busy: HookAgent | null = null;
  const results = new Map<HookAgent, RowResult>();
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  failuresClear.addEventListener("click", () => void clearFailures());

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
      if (!res.ok) throw new Error(await failureText(res, text.loadFailed));
      const next = (await res.json()) as AgentHooksResponse;
      if (mine !== generation) return;
      status = next;
      loadError.hidden = true;
      loadError.textContent = "";
      deps.onChanged(next);
    } catch (error) {
      if (mine !== generation) return;
      console.error("[code-viewer] agent hook status failed", error);
      loadError.textContent = `${text.loadFailed}\n${formatErrorDetail(error)}`;
      loadError.hidden = false;
    }
    render();
  }

  function stateLabel(row: AgentHookStatus): HTMLElement {
    const text = deps.getText();
    const label = document.createElement("span");
    label.className = `agent-hooks-state agent-hooks-state-${row.state}`;
    const mark = document.createElement("i");
    mark.className = "agent-hooks-mark";
    mark.setAttribute("aria-hidden", "true");
    label.append(mark, text.state[row.state]);
    return label;
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

  function createRow(row: AgentHookStatus): HTMLElement {
    const text = deps.getText();
    const box = document.createElement("div");
    box.className = "agent-hooks-row";
    box.dataset.agent = row.agent;
    const name = document.createElement("span");
    name.className = "agent-hooks-name";
    name.textContent = row.agent;
    const path = document.createElement("span");
    path.className = "agent-hooks-path terminal-mono";
    const home = status?.home ?? "";
    path.textContent = row.symlink
      ? `${abbreviateHome(row.path, home)} → ${abbreviateHome(row.realPath, home)}`
      : abbreviateHome(row.path, home);
    path.title = row.symlink
      ? `${row.path}\n${text.symlinkTo(row.realPath)}`
      : row.path;
    const choice = hookRowAction(row);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-btn gdp-btn-sm agent-hooks-action";
    if (choice) {
      button.textContent = text.action[choice.kind];
      button.title = text.actionTitle(row.agent, text.action[choice.kind]);
      button.disabled = busy !== null;
      button.addEventListener(
        "click",
        () => void review(row.agent, choice.action, button),
      );
    } else {
      // 押せる動作が無くても場所は取っておく (行ごとに列がずれない)。
      button.hidden = true;
    }
    box.append(name, stateLabel(row), path, button);
    const detail = detailText(row);
    if (detail) {
      box.appendChild(
        paragraph(
          detail,
          `agent-hooks-detail${hookRowTone(row) === "problem" ? " agent-hooks-detail-problem" : ""}`,
        ),
      );
    }
    const result = results.get(row.agent);
    if (result) {
      const out = paragraph(
        result.text,
        `agent-hooks-result ${result.ok ? "agent-hooks-result-ok" : "agent-hooks-result-error"}`,
      );
      out.setAttribute("role", result.ok ? "status" : "alert");
      box.appendChild(out);
    }
    return box;
  }

  function renderFailures(): void {
    const text = deps.getText();
    const list = status?.failures;
    if (!list || list.total === 0) {
      failures.hidden = true;
      return;
    }
    failures.hidden = false;
    failuresSummary.textContent = text.failures(list.total);
    failuresBody.textContent = list.recent
      .map((item) => {
        const time = item.at ? new Date(item.at).toLocaleString() : "?";
        const where = [item.agent, item.hookEvent, item.target, item.server]
          .filter(Boolean)
          .join(" ");
        return `${text.failureLine(time, item.stage, where)}\n${item.detail}`;
      })
      .join("\n\n");
    failuresLog.textContent = text.failuresLog(list.log);
    failuresClear.textContent = text.failuresClear;
  }

  function render(): void {
    const text = deps.getText();
    title.textContent = text.title;
    intro.textContent = text.intro;
    rows.replaceChildren();
    if (!status) {
      if (loadError.hidden)
        rows.appendChild(paragraph(text.loading, "scope-settings-help"));
    } else {
      for (const row of status.agents) rows.appendChild(createRow(row));
    }
    renderFailures();
  }

  async function fetchPlan(
    agent: HookAgent,
    action: HookAction,
  ): Promise<AgentHookPlanResponse> {
    const query = new URLSearchParams({ agent, action });
    const res = await deps.trackLoad(
      fetch(`${apiUrl("agentHooksPlan")}?${query}`),
    );
    if (!res.ok)
      throw new Error(await failureText(res, deps.getText().planFailed));
    return (await res.json()) as AgentHookPlanResponse;
  }

  /** 設定ファイルを書き換える必要があるのに書けない。 */
  function blockedPlan(plan: AgentHookPlanResponse): boolean {
    return plan.writeBlocked !== "" && plan.changed;
  }

  function notesList(notes: string[]): HTMLElement {
    const list = document.createElement("ul");
    list.className = "agent-hooks-dialog-notes";
    for (const note of notes) {
      const item = document.createElement("li");
      item.textContent = note;
      list.appendChild(item);
    }
    return list;
  }

  /**
   * 生成された (書けない) 設定ファイルのときの手順。エラーではないので
   * 注意の色は使わない。書けない生の理由は捨てずに「詳細」に畳む。
   */
  function guideBody(plan: AgentHookPlanResponse): HTMLElement {
    const text = deps.getText();
    const body = document.createElement("div");
    body.className = "agent-hooks-dialog";
    const steps = document.createElement("ol");
    steps.className = "agent-hooks-dialog-steps";
    for (const step of text.guideSteps[plan.action]) {
      const item = document.createElement("li");
      item.textContent = step;
      steps.appendChild(item);
    }
    body.appendChild(steps);
    const changes = plan.added.length > 0 ? plan.added : plan.removed;
    body.appendChild(
      labeled(
        plan.added.length > 0 ? text.dialogAdded : text.dialogRemoved,
        changesJson(changes),
        true,
      ),
    );
    const notes = [text.dialogKept(plan.kept)];
    if (plan.action === "install") {
      notes.push(text.guideLauncher(plan.launcher.path));
    }
    body.appendChild(notesList(notes));
    const details = document.createElement("details");
    details.className = "agent-hooks-dialog-details";
    const summary = document.createElement("summary");
    summary.textContent = text.guideDetails;
    details.append(
      summary,
      labeled(text.dialogFile, plan.path, false),
      ...(plan.symlink
        ? [labeled(text.dialogLinkTarget, plan.realPath, false)]
        : []),
      labeled("", plan.writeBlocked, true),
    );
    body.appendChild(details);
    return body;
  }

  function planBody(plan: AgentHookPlanResponse): HTMLElement {
    if (blockedPlan(plan)) return guideBody(plan);
    const text = deps.getText();
    const body = document.createElement("div");
    body.className = "agent-hooks-dialog";
    body.appendChild(labeled(text.dialogFile, plan.path, false));
    if (plan.symlink)
      body.appendChild(labeled(text.dialogLinkTarget, plan.realPath, false));
    if (plan.added.length > 0) {
      body.appendChild(
        labeled(text.dialogAdded, changesJson(plan.added), true),
      );
    }
    if (plan.removed.length > 0) {
      body.appendChild(
        labeled(text.dialogRemoved, changesJson(plan.removed), true),
      );
    }
    if (!plan.changed) body.appendChild(paragraph(text.dialogNothing));
    const notes: string[] = [];
    if (plan.changed) {
      notes.push(
        plan.backupPath
          ? text.dialogBackup(
              // 名前の時刻は書いた瞬間のものになる。確認した時点の時刻を
              // 出すと結果と食い違うので伏せる。
              plan.backupPath.replace(/-\d{8}-\d{6}$/, "-<YYYYMMDD-HHMMSS>"),
            )
          : text.dialogNewFile,
      );
    }
    notes.push(text.dialogKept(plan.kept));
    if (plan.changed && plan.formattingChanged)
      notes.push(text.dialogFormatting);
    if (plan.launcher.write)
      notes.push(text.dialogLauncher(plan.launcher.path));
    notes.push(text.effect[plan.agent][plan.action]);
    body.appendChild(notesList(notes));
    return body;
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
      if (!res.ok) throw new Error(await failureText(res, text.applyFailed));
      const result = (await res.json()) as AgentHookApplyResponse;
      const lines = launcherOnly
        ? [text.dialogCopied]
        : [result.changed ? text.applied[plan.action] : text.unchanged];
      if (result.backupPath) lines.push(text.backupAt(result.backupPath));
      if (result.launcherWritten)
        lines.push(text.launcherWritten(plan.launcher.path));
      if (!launcherOnly && (result.changed || result.launcherWritten)) {
        lines.push(text.effect[plan.agent][plan.action]);
      }
      return { ok: true, text: lines.join("\n") };
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
    failuresError.hidden = true;
    try {
      const res = await deps.trackLoad(
        fetch(apiUrl("agentHooksFailures"), {
          method: "DELETE",
          headers: deps.actionHeaders(),
        }),
      );
      if (!res.ok)
        throw new Error(await failureText(res, text.failuresClearFailed));
    } catch (error) {
      console.error("[code-viewer] clearing hook failures failed", error);
      failuresError.textContent = formatErrorDetail(error);
      failuresError.hidden = false;
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
