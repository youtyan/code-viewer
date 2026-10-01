// 設定の「外部接続」の分類の中身。入口のサーバが待ち受けと cloudflared を動かす
// (server/entry/remote-control.ts)。
//
//   状態
//   待ち受け     ● 開いています       127.0.0.1:64161（https://viewer.example.com 用）
//   cloudflared  ● 接続中（4 本）     cloudflared 2026.9.0（pid 123）
//   トークン     ● 保存済み           Tunnel ID 0000…
//   [停止]  ☑ code-viewer の起動時に開始する
//   Cloudflare の値  (未保存)
//   公開 URL / Team domain / AUD / 待ち受けのポート / Tunnel のトークン
//   ▸ cloudflared の出力（最後の 200 行）
//
// 開始・停止・「起動時に開始する」は押した時点で当てる。値とトークンの保存は
// ページの「変更を保存」1 つ (draft を viewer-settings に渡す)。トークンは
// 送るだけで、画面には戻ってこない (Tunnel の ID だけ)。
//
// 状態は節が画面にある間だけ 2 秒ごとに取り直す (cloudflared の接続は勝手に
// 変わる)。操作の最中は取り直さず、古い応答は要求の番号で捨てる。

import { apiUrl } from "../core/api-url";
import { errorWithCause, formatErrorDetail } from "../core/error-detail";
import { BACKGROUND_REQUEST_HEADER } from "../core/network-activity";
import {
  REMOTE_LOCAL_ONLY_CODE,
  type RemoteAccessSaveRequest,
  type RemoteAccessStatus,
  type RemoteAccessValues,
} from "../core/remote-access";
import { responseFailure } from "./agents/accounts-client";
import { el } from "./agents/accounts-dialogs";
import type { RemoteAccessSettingsText } from "./remote-access-settings-i18n";
import type { SettingsDraft } from "./viewer-settings";

export type RemoteAccessSettingsDeps = {
  getText(): RemoteAccessSettingsText;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  actionHeaders(): HeadersInit;
};

export type RemoteAccessSettings = {
  element: HTMLElement;
  refresh(): Promise<void>;
  localize(): void;
  draft: SettingsDraft;
};

/** 見出しの id。 */
export const REMOTE_ACCESS_SECTION_ID = "remote-access-section-title";

const POLL_MS = 2000;

type Tone = "ok" | "warn" | "error" | "idle";

/** 状態の印の色は「エージェント連携」の行と同じもの (style.css の agent-hooks-state)。 */
const TONE_CLASS: Record<Tone, string> = {
  ok: "agent-hooks-state-installed",
  warn: "agent-hooks-state-partial",
  error: "agent-hooks-state-unreadable",
  idle: "",
};

/** 画面に出せない理由 (外から開いた・--standalone)。読み込みの失敗とは分ける。 */
type Unavailable = "local-only" | "standalone" | null;

const FIELDS = ["origin", "teamDomain", "audience", "port"] as const;
type Field = (typeof FIELDS)[number];

export function createRemoteAccessSettings(
  deps: RemoteAccessSettingsDeps,
): RemoteAccessSettings {
  const element = el("div", "scope-settings-section remote-access-section");
  const statusTitle = el("strong", "agent-accounts-subtitle");
  statusTitle.id = REMOTE_ACCESS_SECTION_ID;
  const notice = el("p", "scope-settings-help");
  const loadError = el("p", "scope-settings-help scope-settings-refresh-error");
  const rows = el("div", "agent-hooks-rows");
  const actions = el("div", "remote-access-actions");
  // 開始と停止は別のボタン。待ち受けが開いていて cloudflared が止まっている
  // (落ちた・入れた直後・--remote-access で起動した) ときは、両方押せる。
  const startButton = el("button", "gdp-btn gdp-btn-sm remote-access-start");
  startButton.type = "button";
  const stopButton = el("button", "gdp-btn gdp-btn-sm remote-access-stop");
  stopButton.type = "button";
  const autoStart = el("label", "scope-settings-toggle");
  const autoStartInput = el("input");
  autoStartInput.type = "checkbox";
  const autoStartText = el("span");
  autoStart.append(autoStartInput, autoStartText);
  const installButton = el(
    "button",
    "gdp-btn gdp-btn-sm remote-access-install",
  );
  installButton.type = "button";
  installButton.hidden = true;
  actions.append(startButton, stopButton, installButton);
  const result = el("p", "agent-hooks-result agent-hooks-result-error");
  const valuesHead = el("div", "agent-accounts-subtitle-row");
  const valuesTitle = el("strong", "agent-accounts-subtitle");
  const unsaved = el("span", "agent-accounts-unsaved");
  valuesHead.append(valuesTitle, unsaved);
  const valuesIntro = el("p", "scope-settings-help");
  const fields = el("div", "remote-access-fields");
  function fieldRow(field: Field | "token"): {
    label: HTMLLabelElement;
    input: HTMLInputElement;
  } {
    const input = el("input", "gdp-dialog-input");
    input.id = `remote-access-${field}`;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.type =
      field === "port" ? "number" : field === "token" ? "password" : "text";
    const label = el("label");
    label.htmlFor = input.id;
    fields.append(label, input);
    return { label, input };
  }
  const originField = fieldRow("origin");
  const teamDomainField = fieldRow("teamDomain");
  const audienceField = fieldRow("audience");
  const portField = fieldRow("port");
  const tokenField = fieldRow("token");
  const inputs: Record<Field, HTMLInputElement> = {
    origin: originField.input,
    teamDomain: teamDomainField.input,
    audience: audienceField.input,
    port: portField.input,
  };
  const tokenInput = tokenField.input;
  inputs.origin.placeholder = "https://viewer.example.com";
  inputs.teamDomain.placeholder = "your-team.cloudflareaccess.com";
  inputs.port.placeholder = "64161";
  inputs.port.min = "1";
  inputs.port.max = "65535";
  inputs.port.step = "1";
  const tokenHelp = el("p", "scope-settings-help");
  const savedTo = el("p", "scope-settings-help remote-access-path");
  const log = el("details", "agent-accounts-how remote-access-log");
  const logSummary = el("summary");
  const logBody = el("pre", "agent-hooks-dialog-code");
  log.append(logSummary, logBody);
  /** 外から開いた画面・入口でないサーバでは、案内の 1 文だけを出して隠す部分。 */
  const body = el("div");
  body.append(
    rows,
    actions,
    result,
    autoStart,
    valuesHead,
    valuesIntro,
    fields,
    tokenHelp,
    savedTo,
    log,
  );
  element.append(statusTitle, notice, loadError, body);

  let status: RemoteAccessStatus | null = null;
  let unavailable: Unavailable = null;
  /** 操作の最中 (二重に押させない・周期の取り直しを止める)。 */
  let busy = false;
  let actionError = "";
  /** 欄を利用者が触った (取り直しで上書きしない)。 */
  let edited = false;
  let request = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  /** 最後に描いた状態の行 (同じなら描き直さない。2 秒ごとに作り直さない)。 */
  let rowsKey = "";
  const draftListeners = new Set<() => void>();

  function text(): RemoteAccessSettingsText {
    return deps.getText();
  }

  function savedValues(): RemoteAccessValues | null {
    return status?.config.state === "ok" ? status.config.values : null;
  }

  function fieldText(values: RemoteAccessValues | null, field: Field): string {
    return values ? String(values[field]) : "";
  }

  function valuesDirty(): boolean {
    if (!edited) return false;
    const saved = savedValues();
    return FIELDS.some(
      (field) => inputs[field].value.trim() !== fieldText(saved, field),
    );
  }

  function dirty(): boolean {
    return valuesDirty() || tokenInput.value.trim() !== "";
  }

  function draftChanged(): void {
    unsaved.hidden = !dirty();
    for (const listener of draftListeners) listener();
  }

  async function load(options: { background?: boolean; probe?: boolean }) {
    if (options.background && busy) return;
    const mine = ++request;
    const url = apiUrl(options.probe ? "entryRemoteProbe" : "entryRemote");
    try {
      // cloudflared の確かめ直しはサーバで子プロセスを起こすので POST で送る。
      const res = options.background
        ? await fetch(url, { headers: { [BACKGROUND_REQUEST_HEADER]: "1" } })
        : await deps.trackLoad(
            fetch(
              url,
              options.probe
                ? { method: "POST", headers: deps.actionHeaders() }
                : {},
            ),
          );
      if (mine !== request) return;
      const reason = await unavailableReason(res);
      if (reason) {
        unavailable = reason;
        status = null;
      } else {
        if (!res.ok)
          throw await responseFailure(
            res,
            `${options.probe ? "POST" : "GET"} ${url}`,
          );
        const next = (await res.json()) as RemoteAccessStatus;
        if (mine !== request) return;
        unavailable = null;
        status = next;
      }
      loadError.hidden = true;
      loadError.textContent = "";
    } catch (error) {
      if (mine !== request) return;
      console.error("[code-viewer] remote access status failed", error);
      loadError.textContent = `${text().loadFailed}\n${formatErrorDetail(error)}`;
      loadError.hidden = false;
    }
    render();
    draftChanged();
  }

  /**
   * 外から開いた画面 (403 remote-local-only) と、入口でないサーバ (404。
   * --standalone か、外部接続を知らない古い入口) を見分ける。ほかの 403 は
   * 読み込みの失敗として本文ごと出す。
   */
  async function unavailableReason(res: Response): Promise<Unavailable> {
    if (res.status === 404) return "standalone";
    if (
      res.status !== 403 ||
      !res.headers.get("content-type")?.includes("application/json")
    )
      return null;
    const body = (await res.clone().json()) as { code?: unknown };
    return body.code === REMOTE_LOCAL_ONLY_CODE ? "local-only" : null;
  }

  /** 書き込みの操作。応答の状態をそのまま映す。失敗は節の結果の行に全文。 */
  async function act(
    path:
      | "entryRemoteStart"
      | "entryRemoteStop"
      | "entryRemoteConfig"
      | "entryRemoteInstall",
    body?: RemoteAccessSaveRequest,
  ): Promise<void> {
    const mine = ++request;
    const res = await deps.trackLoad(
      fetch(apiUrl(path), {
        method: "POST",
        headers: {
          ...deps.actionHeaders(),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    if (!res.ok) throw await responseFailure(res, `POST ${apiUrl(path)}`);
    const next = (await res.json()) as RemoteAccessStatus;
    if (mine === request) status = next;
  }

  async function run(operation: string, action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    actionError = "";
    render();
    try {
      await action();
    } catch (error) {
      console.error(`[code-viewer] ${operation}`, error);
      actionError = `${operation}\n${formatErrorDetail(error)}`;
    } finally {
      busy = false;
      render();
      draftChanged();
    }
  }

  /** note は補足 (無彩色)、problem は理由 (赤)。どちらも全文を折り返して出す。 */
  function stateRow(
    name: string,
    tone: Tone,
    label: string,
    detail: string,
    extra: { problem?: string; note?: string } = {},
  ): HTMLElement {
    const row = el("div", "agent-hooks-row remote-access-row ui-table-row");
    const state = el("span", `agent-hooks-state ${TONE_CLASS[tone]}`.trim());
    const mark = el("i", "agent-hooks-mark");
    mark.setAttribute("aria-hidden", "true");
    state.append(mark, label);
    const detailCell = el("span", "agent-hooks-path", detail);
    detailCell.title = detail;
    row.append(el("span", "agent-hooks-name", name), state, detailCell);
    if (extra.problem)
      row.append(
        el("p", "agent-hooks-detail agent-hooks-detail-problem", extra.problem),
      );
    if (extra.note) row.append(el("p", "agent-hooks-detail", extra.note));
    return row;
  }

  function listenerRow(current: RemoteAccessStatus): HTMLElement {
    const t = text();
    const { listener } = current;
    if (listener.state === "running")
      return stateRow(
        t.rowListener,
        "ok",
        t.listenerRunning,
        t.listenerTarget(listener.port, listener.origin),
      );
    if (listener.state === "failed")
      return stateRow(t.rowListener, "error", t.listenerFailed, "", {
        problem: listener.error,
      });
    return stateRow(t.rowListener, "idle", t.listenerStopped, "");
  }

  function tunnelRow(current: RemoteAccessStatus): HTMLElement {
    const t = text();
    const { tunnel, cloudflared } = current;
    const version = cloudflared.state === "ok" ? cloudflared.version : "";
    const probeProblem =
      cloudflared.state === "unavailable" ? cloudflared.error : "";
    const installNote =
      cloudflared.state === "unavailable" && cloudflared.installable
        ? t.installHint
        : "";
    if (tunnel.state === "running")
      return stateRow(
        t.rowTunnel,
        tunnel.connections > 0 ? "ok" : "warn",
        tunnel.connections > 0
          ? t.tunnelConnected(tunnel.connections)
          : t.tunnelWaiting,
        t.tunnelProcess(version, tunnel.pid),
      );
    if (tunnel.state === "exited")
      return stateRow(
        t.rowTunnel,
        "error",
        t.tunnelExited,
        version ? t.cloudflaredVersion(version) : "",
        { problem: tunnel.error, note: installNote },
      );
    if (cloudflared.state === "installing")
      return stateRow(t.rowTunnel, "warn", t.installing, "", {
        note: t.installingNote,
      });
    if (tunnel.state === "skipped")
      return stateRow(t.rowTunnel, "idle", t.tunnelSkipped, "", {
        note: t.tunnelSkippedDetail,
      });
    return stateRow(
      t.rowTunnel,
      probeProblem ? "error" : "idle",
      probeProblem ? t.tunnelUnavailable : t.tunnelStopped,
      version ? t.cloudflaredVersion(version) : "",
      { problem: probeProblem, note: installNote },
    );
  }

  function tokenRow(current: RemoteAccessStatus): HTMLElement {
    const t = text();
    const { token } = current;
    if (token.state === "ok")
      return stateRow(
        t.rowToken,
        "ok",
        t.tokenSaved,
        t.tokenTunnelId(token.tunnelId),
      );
    if (token.state === "invalid")
      return stateRow(t.rowToken, "error", t.tokenInvalid, "", {
        problem: token.error,
      });
    return stateRow(t.rowToken, "idle", t.tokenAbsent, "");
  }

  function render(): void {
    const t = text();
    statusTitle.textContent = t.statusTitle;
    startButton.textContent = t.start;
    stopButton.textContent = t.stop;
    autoStartText.textContent = t.autoStart;
    valuesTitle.textContent = t.valuesTitle;
    unsaved.textContent = t.unsaved;
    valuesIntro.textContent = t.valuesIntro;
    originField.label.textContent = t.originLabel;
    teamDomainField.label.textContent = t.teamDomainLabel;
    audienceField.label.textContent = t.audienceLabel;
    portField.label.textContent = t.portLabel;
    tokenField.label.textContent = t.tokenLabel;
    tokenHelp.textContent = t.tokenHelp;
    result.hidden = !actionError;
    result.textContent = actionError;
    const current = status;
    body.hidden = unavailable !== null;
    for (const control of [startButton, stopButton, autoStartInput, tokenInput])
      control.disabled = !current || busy;
    for (const input of Object.values(inputs))
      input.disabled = !current || busy;
    notice.classList.toggle(
      "scope-settings-refresh-error",
      current?.config.state === "invalid",
    );
    if (!current) {
      // 読み込みに失敗したときは loadError が理由を出す。
      notice.hidden = !unavailable && !loadError.hidden;
      notice.textContent =
        unavailable === "local-only"
          ? t.localOnly
          : unavailable === "standalone"
            ? t.standalone
            : t.loading;
      rows.replaceChildren();
      rowsKey = "";
      installButton.hidden = true;
      savedTo.textContent = "";
      log.hidden = true;
      return;
    }
    const installing = current.cloudflared.state === "installing";
    // 開始し終えた = 待ち受けが開き、cloudflared が動いている (トークンが無くて
    // 起こさなかったときも、それ以上することは無い)。
    const started =
      current.listener.state === "running" &&
      (current.tunnel.state === "running" ||
        current.tunnel.state === "skipped");
    if (started || current.config.state !== "ok" || installing)
      startButton.disabled = true;
    if (
      current.listener.state !== "running" &&
      current.tunnel.state !== "running"
    )
      stopButton.disabled = true;
    installButton.textContent = t.install;
    installButton.hidden = !(
      installing ||
      (current.cloudflared.state === "unavailable" &&
        current.cloudflared.installable)
    );
    installButton.disabled = busy || installing;
    notice.hidden = current.config.state === "ok";
    notice.textContent =
      current.config.state === "invalid"
        ? `${t.configInvalid}\n${current.config.error}`
        : t.needValues;
    const key = JSON.stringify([
      t.statusTitle,
      current.listener,
      current.tunnel,
      current.token,
      current.cloudflared,
    ]);
    if (key !== rowsKey) {
      rowsKey = key;
      rows.replaceChildren(
        listenerRow(current),
        tunnelRow(current),
        tokenRow(current),
      );
    }
    // 切り替えた答えを待つ間は、押したとおりの位置のままにする。
    if (!busy)
      autoStartInput.checked =
        current.config.state === "ok" && current.config.autoStart;
    if (current.config.state !== "ok") autoStartInput.disabled = true;
    if (!edited) {
      const saved = savedValues();
      for (const field of FIELDS) inputs[field].value = fieldText(saved, field);
    }
    tokenInput.placeholder =
      current.token.state === "ok"
        ? t.tokenPlaceholderSaved
        : t.tokenPlaceholderAbsent;
    savedTo.textContent = current.configFromFlag
      ? t.fromFlag(current.configPath, current.tokenPath)
      : t.savedTo(current.configPath, current.tokenPath);
    log.hidden = false;
    logSummary.textContent = t.logTitle(current.log.length);
    const logText = current.log.length ? current.log.join("\n") : t.logEmpty;
    if (logBody.textContent !== logText) {
      // 末尾を見ていたら、新しい行に付いていく。
      const atEnd =
        logBody.scrollTop + logBody.clientHeight >= logBody.scrollHeight - 4;
      logBody.textContent = logText;
      if (atEnd) logBody.scrollTop = logBody.scrollHeight;
    }
  }

  installButton.addEventListener("click", () => {
    void run(text().installFailed, () => act("entryRemoteInstall"));
  });
  startButton.addEventListener("click", () => {
    void run(text().startFailed, () => act("entryRemoteStart"));
  });
  stopButton.addEventListener("click", () => {
    void run(text().stopFailed, () => act("entryRemoteStop"));
  });
  autoStartInput.addEventListener("change", () => {
    const next = autoStartInput.checked;
    void run(text().autoStartFailed, () =>
      act("entryRemoteConfig", { autoStart: next }),
    );
  });
  for (const input of Object.values(inputs)) {
    input.addEventListener("input", () => {
      edited = true;
      draftChanged();
    });
  }
  tokenInput.addEventListener("input", draftChanged);

  function portValue(): number | null {
    const raw = inputs.port.value.trim();
    const port = Number(raw);
    return /^\d+$/.test(raw) && port >= 1 && port <= 65535 ? port : null;
  }

  const draft: SettingsDraft = {
    dirty,
    problem() {
      return valuesDirty() && portValue() === null ? text().portProblem : null;
    },
    async save() {
      if (busy)
        throw new Error(
          `${text().saveFailed}: another remote access action is still running`,
        );
      const request: RemoteAccessSaveRequest = {};
      if (valuesDirty()) {
        const port = portValue();
        if (port === null) throw new Error(text().portProblem);
        request.values = {
          origin: inputs.origin.value.trim(),
          teamDomain: inputs.teamDomain.value.trim(),
          audience: inputs.audience.value.trim(),
          port,
        };
      }
      if (tokenInput.value.trim()) request.token = tokenInput.value;
      busy = true;
      render();
      try {
        await act("entryRemoteConfig", request);
        edited = false;
        tokenInput.value = "";
      } catch (error) {
        throw errorWithCause(text().saveFailed, error);
      } finally {
        busy = false;
        render();
        draftChanged();
      }
    },
    subscribe(listener) {
      draftListeners.add(listener);
    },
  };

  function schedule(): void {
    if (pollTimer !== null) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      if (!element.isConnected) return;
      void load({ background: true }).finally(schedule);
    }, POLL_MS);
  }

  async function refresh(): Promise<void> {
    await load({ probe: true });
    schedule();
  }

  render();
  return { element, refresh, localize: render, draft };
}
