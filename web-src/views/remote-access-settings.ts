// 設定の「外部接続」の分類の中身。入口のサーバが待ち受けと cloudflared を動かす
// (server/entry/remote-control.ts)。
//
//   状態
//   スマホ → Cloudflare → cloudflared（この Mac）→ サービス URL（code-viewer）…
//   サービス URL ● 開いています       http://127.0.0.1:64161（https://viewer.example.com からの転送先）
//                Tunnel の公開ルートの「サービス URL」に入れるアドレス
//   cloudflared  ● 接続中（4 本）     [ターミナルで見る]  (code-viewer の端末で動く)
//   トークン     ● 保存済み           Tunnel ID 0000…  (未設定なら [トークンの欄へ])
//   [停止]  ☑ code-viewer の起動時に開始する
//   Cloudflare の値  (未保存)
//   公開 URL / Team domain / AUD / サービス URL のポート / Tunnel のトークン
//   ▸ Homebrew と code-viewer の出力（あるときだけ。cloudflared の出力は端末のタブ）
//
// 開始・停止・「起動時に開始する」は押した時点で当てる。値とトークンの保存は
// ページの「変更を保存」1 つ (draft を viewer-settings に渡す)。トークンは
// 送るだけで、画面には戻ってこない (Tunnel の ID だけ)。
//
// 状態は節が画面にある間だけ 2 秒ごとに取り直す (cloudflared の接続は勝手に
// 変わる)。操作の最中は取り直さず、古い応答は要求の番号で捨てる。

import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
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
import type { RemoteAccessSettingsText } from "./remote-access-settings-i18n";
import { renderOwned, templateElement } from "./ui/renderer";
import type { SettingsDraft } from "./viewer-settings";

export type RemoteAccessSettingsDeps = {
  getText(): RemoteAccessSettingsText;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  actionHeaders(): HeadersInit;
  /** cloudflared を動かしている端末をタブで開く。 */
  openShell(id: string): void;
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

/** Tunnel の公開ルートの「サービス URL」に入れる、入口が開くアドレス。 */
function serviceUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** 欄の見た目 (種類・例・範囲)。 */
const FIELD_INPUT: Record<
  Field | "token",
  { type: string; placeholder?: string; range?: true }
> = {
  origin: { type: "text", placeholder: "https://viewer.example.com" },
  teamDomain: { type: "text", placeholder: "your-team.cloudflareaccess.com" },
  audience: { type: "text" },
  port: { type: "number", placeholder: "64161", range: true },
  token: { type: "password" },
};

/** 状態の 1 行。detail が button なら 3 列目に小さなボタンを置く。 */
export type RemoteAccessRowProps = {
  name: string;
  tone: Tone;
  label: string;
  detail:
    | { kind: "text"; text: string }
    | { kind: "button"; label: string; title?: string; onClick(): void };
  /** 理由 (赤)。 */
  problem?: string;
  /** 補足 (無彩色)。 */
  note?: string;
};

export type RemoteAccessFieldProps = {
  field: Field | "token";
  label: string;
  placeholder?: string;
  disabled: boolean;
  value: string;
  onInput(value: string): void;
};

type ButtonProps = { label: string; disabled: boolean; onClick(): void };

export type RemoteAccessViewProps = {
  title: string;
  notice: { text: string; hidden: boolean; error: boolean };
  /** 読み込みの失敗の文。null は隠す。 */
  loadError: string | null;
  /** 外から開いた・入口でないサーバ: 案内の 1 文だけを出して本文を隠す。 */
  bodyHidden: boolean;
  intro: string;
  rows: RemoteAccessRowProps[];
  start: ButtonProps;
  stop: ButtonProps;
  install: ButtonProps & { hidden: boolean };
  actionError: string;
  autoStart: {
    label: string;
    checked: boolean;
    disabled: boolean;
    onChange(checked: boolean): void;
  };
  valuesTitle: string;
  unsaved: { label: string; shown: boolean };
  valuesIntro: string;
  fields: RemoteAccessFieldProps[];
  tokenHelp: string;
  savedTo: string;
  log: { hidden: boolean; summary: string; text: string };
};

export type RemoteAccessView = (props: RemoteAccessViewProps) => unknown;

function remoteRowTemplate(row: RemoteAccessRowProps): TemplateResult {
  return html`<div class="agent-hooks-row remote-access-row ui-table-row"><span
      class="agent-hooks-name"
    >${row.name}</span><span class=${`agent-hooks-state ${TONE_CLASS[row.tone]}`.trim()}
      ><i class="agent-hooks-mark" aria-hidden="true"></i>${row.label}</span
    >${
      row.detail.kind === "text"
        ? html`<span class="agent-hooks-path" title=${row.detail.text}>${row.detail.text}</span>`
        : html`<button
            type="button"
            class="gdp-btn gdp-btn-sm remote-access-row-button"
            title=${ifDefined(row.detail.title)}
            @click=${row.detail.onClick}
          >${row.detail.label}</button>`
    }${
      row.problem
        ? html`<p class="agent-hooks-detail agent-hooks-detail-problem">${row.problem}</p>`
        : nothing
    }${row.note ? html`<p class="agent-hooks-detail">${row.note}</p>` : nothing}</div>`;
}

function remoteFieldTemplate(props: RemoteAccessFieldProps): TemplateResult {
  const look = FIELD_INPUT[props.field];
  const id = `remote-access-${props.field}`;
  return html`<label for=${id}>${props.label}</label><input
      class="gdp-dialog-input"
      id=${id}
      spellcheck="false"
      autocomplete="off"
      type=${look.type}
      placeholder=${ifDefined(props.placeholder)}
      min=${ifDefined(look.range ? "1" : undefined)}
      max=${ifDefined(look.range ? "65535" : undefined)}
      step=${ifDefined(look.range ? "1" : undefined)}
      ?disabled=${props.disabled}
      .value=${live(props.value)}
      @input=${(event: Event) =>
        props.onInput((event.currentTarget as HTMLInputElement).value)}
    />`;
}

export const DEFAULT_VIEW: RemoteAccessView = (props) => html`<strong
    class="agent-accounts-subtitle"
    id=${REMOTE_ACCESS_SECTION_ID}
    >${props.title}</strong
  ><p
    class=${props.notice.error ? "scope-settings-help scope-settings-refresh-error" : "scope-settings-help"}
    ?hidden=${props.notice.hidden}
  >${props.notice.text}</p><p
    class="scope-settings-help scope-settings-refresh-error"
    ?hidden=${props.loadError === null}
  >${props.loadError ?? ""}</p><div ?hidden=${props.bodyHidden}><p
      class="scope-settings-help"
      >${props.intro}</p
    ><div class="agent-hooks-rows">${props.rows.map(remoteRowTemplate)}</div><div
      class="remote-access-actions"
    ><button
      type="button"
      class="gdp-btn gdp-btn-sm remote-access-start"
      ?disabled=${props.start.disabled}
      @click=${props.start.onClick}
    >${props.start.label}</button><button
      type="button"
      class="gdp-btn gdp-btn-sm remote-access-stop"
      ?disabled=${props.stop.disabled}
      @click=${props.stop.onClick}
    >${props.stop.label}</button><button
      type="button"
      class="gdp-btn gdp-btn-sm remote-access-install"
      ?hidden=${props.install.hidden}
      ?disabled=${props.install.disabled}
      @click=${props.install.onClick}
    >${props.install.label}</button></div><p
      class="agent-hooks-result agent-hooks-result-error"
      ?hidden=${!props.actionError}
    >${props.actionError}</p><label class="scope-settings-toggle"><input
      type="checkbox"
      ?disabled=${props.autoStart.disabled}
      .checked=${live(props.autoStart.checked)}
      @change=${(event: Event) =>
        props.autoStart.onChange(
          (event.currentTarget as HTMLInputElement).checked,
        )}
    /><span>${props.autoStart.label}</span></label><div
      class="agent-accounts-subtitle-row"
    ><strong class="agent-accounts-subtitle">${props.valuesTitle}</strong><span
        class="agent-accounts-unsaved"
        ?hidden=${!props.unsaved.shown}
        >${props.unsaved.label}</span
      ></div
    ><p class="scope-settings-help">${props.valuesIntro}</p><div
      class="remote-access-fields"
    >${props.fields.map(remoteFieldTemplate)}</div><p class="scope-settings-help"
      >${props.tokenHelp}</p
    ><p class="scope-settings-help remote-access-path">${props.savedTo}</p><details
      class="agent-accounts-how remote-access-log"
      ?hidden=${props.log.hidden}
    ><summary>${props.log.summary}</summary><pre class="agent-hooks-dialog-code"
        >${props.log.text}</pre
      ></details></div>`;

export function createRemoteAccessSettings(
  deps: RemoteAccessSettingsDeps,
  view: RemoteAccessView = DEFAULT_VIEW,
): RemoteAccessSettings {
  // 節の箱。設定のページが置き、中はここが描く。
  const element = templateElement(
    html`<div class="scope-settings-section remote-access-section"></div>`,
  );

  let status: RemoteAccessStatus | null = null;
  let unavailable: Unavailable = null;
  /** 操作の最中 (二重に押させない・周期の取り直しを止める)。 */
  let busy = false;
  let actionError = "";
  /** 読み込みの失敗の文。null は隠す (読み込む前は空のまま出しておく)。 */
  let loadError: string | null = "";
  /** 欄を利用者が触った (取り直しで上書きしない)。 */
  let edited = false;
  const fieldValues: Record<Field, string> = {
    origin: "",
    teamDomain: "",
    audience: "",
    port: "",
  };
  let token = "";
  let autoStartChecked = false;
  /** 「未保存」の印。値を読む前は出したまま (読み込みの後に決まる)。 */
  let unsavedShown = true;
  let request = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
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
      (field) => fieldValues[field].trim() !== fieldText(saved, field),
    );
  }

  function dirty(): boolean {
    return valuesDirty() || token.trim() !== "";
  }

  function draftChanged(): void {
    unsavedShown = dirty();
    render();
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
      loadError = null;
    } catch (error) {
      if (mine !== request) return;
      console.error("[code-viewer] remote access status failed", error);
      loadError = `${text().loadFailed}\n${formatErrorDetail(error)}`;
    }
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

  /** 3 列目に置く小さなボタン (列の幅に伸ばさない)。 */
  function rowButton(
    label: string,
    onClick: () => void,
    title?: string,
  ): RemoteAccessRowProps["detail"] {
    return { kind: "button", label, title, onClick };
  }

  function rowText(text: string): RemoteAccessRowProps["detail"] {
    return { kind: "text", text };
  }

  function listenerRow(current: RemoteAccessStatus): RemoteAccessRowProps {
    const t = text();
    const { listener } = current;
    const note = t.listenerNote;
    if (listener.state === "running")
      return {
        name: t.rowListener,
        tone: "ok",
        label: t.listenerRunning,
        detail: rowText(
          t.listenerTarget(serviceUrl(listener.port), listener.origin),
        ),
        note,
      };
    if (listener.state === "failed")
      return {
        name: t.rowListener,
        tone: "error",
        label: t.listenerFailed,
        detail: rowText(""),
        problem: listener.error,
        note,
      };
    const saved = savedValues();
    return {
      name: t.rowListener,
      tone: "idle",
      label: t.listenerStopped,
      detail: rowText(saved ? serviceUrl(saved.port) : ""),
      note,
    };
  }

  function tunnelRow(current: RemoteAccessStatus): RemoteAccessRowProps {
    const t = text();
    const { tunnel, cloudflared } = current;
    const version = cloudflared.state === "ok" ? cloudflared.version : "";
    const probeProblem =
      cloudflared.state === "unavailable" ? cloudflared.error : "";
    const installNote =
      cloudflared.state === "unavailable" && cloudflared.installable
        ? t.installHint
        : "";
    if (tunnel.state === "running") {
      const { shell } = tunnel;
      return {
        name: t.rowTunnel,
        tone: tunnel.connections > 0 ? "ok" : "warn",
        label:
          tunnel.connections > 0
            ? t.tunnelConnected(tunnel.connections)
            : t.tunnelWaiting,
        detail: rowButton(
          t.openTerminal,
          () => deps.openShell(shell),
          t.tunnelProcess(version, tunnel.pid),
        ),
      };
    }
    if (tunnel.state === "exited")
      return {
        name: t.rowTunnel,
        tone: "error",
        label: t.tunnelExited,
        detail: rowText(version ? t.cloudflaredVersion(version) : ""),
        problem: tunnel.error,
        note: installNote,
      };
    if (cloudflared.state === "installing")
      return {
        name: t.rowTunnel,
        tone: "warn",
        label: t.installing,
        detail: rowText(""),
        note: t.installingNote,
      };
    if (tunnel.state === "skipped")
      return {
        name: t.rowTunnel,
        tone: "idle",
        label: t.tunnelSkipped,
        detail: rowText(""),
        note: t.tunnelSkippedDetail,
      };
    return {
      name: t.rowTunnel,
      tone: probeProblem ? "error" : "idle",
      label: probeProblem ? t.tunnelUnavailable : t.tunnelStopped,
      detail: rowText(version ? t.cloudflaredVersion(version) : ""),
      problem: probeProblem,
      note: installNote,
    };
  }

  function tokenRow(current: RemoteAccessStatus): RemoteAccessRowProps {
    const t = text();
    const { token: saved } = current;
    if (saved.state === "ok")
      return {
        name: t.rowToken,
        tone: "ok",
        label: t.tokenSaved,
        detail: rowText(t.tokenTunnelId(saved.tunnelId)),
      };
    if (saved.state === "invalid")
      return {
        name: t.rowToken,
        tone: "error",
        label: t.tokenInvalid,
        detail: rowText(""),
        problem: saved.error,
      };
    // 状態の行から、貼る欄 (Cloudflare の値の最後) へ送る。
    return {
      name: t.rowToken,
      tone: "idle",
      label: t.tokenAbsent,
      detail: rowButton(t.tokenJump, () => {
        const input = element.querySelector<HTMLInputElement>(
          "#remote-access-token",
        );
        if (!input)
          throw new Error("remote access: the token field is not drawn");
        input.scrollIntoView({ block: "center" });
        input.focus();
      }),
      note: t.tokenAbsentNote,
    };
  }

  function fieldProps(
    field: Field | "token",
    label: string,
    disabled: boolean,
  ): RemoteAccessFieldProps {
    const placeholder =
      field === "token"
        ? status?.token.state === "ok"
          ? text().tokenPlaceholderSaved
          : status
            ? text().tokenPlaceholderAbsent
            : undefined
        : FIELD_INPUT[field].placeholder;
    return {
      field,
      label,
      placeholder,
      disabled,
      value: field === "token" ? token : fieldValues[field],
      onInput(value) {
        if (field === "token") {
          token = value;
        } else {
          fieldValues[field] = value;
          edited = true;
        }
        draftChanged();
      },
    };
  }

  function viewProps(): RemoteAccessViewProps {
    const t = text();
    const current = status;
    const off = !current || busy;
    const installing = current?.cloudflared.state === "installing";
    // 開始し終えた = 待ち受けが開き、cloudflared が動いている (トークンが無くて
    // 起こさなかったときも、それ以上することは無い)。
    const started =
      current?.listener.state === "running" &&
      (current.tunnel.state === "running" ||
        current.tunnel.state === "skipped");
    return {
      title: t.statusTitle,
      notice: {
        text: !current
          ? unavailable === "local-only"
            ? t.localOnly
            : unavailable === "standalone"
              ? t.standalone
              : t.loading
          : current.config.state === "invalid"
            ? `${t.configInvalid}\n${current.config.error}`
            : t.needValues,
        // 読み込みに失敗したときは loadError が理由を出す。
        hidden: current
          ? current.config.state === "ok"
          : !unavailable && loadError !== null,
        error: current?.config.state === "invalid",
      },
      loadError,
      bodyHidden: unavailable !== null,
      intro: t.statusIntro,
      rows: current
        ? [listenerRow(current), tunnelRow(current), tokenRow(current)]
        : [],
      start: {
        label: t.start,
        disabled: off || started || current.config.state !== "ok" || installing,
        onClick: () => {
          void run(text().startFailed, () => act("entryRemoteStart"));
        },
      },
      stop: {
        label: t.stop,
        disabled:
          off ||
          (current.listener.state !== "running" &&
            current.tunnel.state !== "running"),
        onClick: () => {
          void run(text().stopFailed, () => act("entryRemoteStop"));
        },
      },
      install: {
        label: t.install,
        hidden: !(
          current &&
          (installing ||
            (current.cloudflared.state === "unavailable" &&
              current.cloudflared.installable))
        ),
        disabled: busy || installing,
        onClick: () => {
          void run(text().installFailed, () => act("entryRemoteInstall"));
        },
      },
      actionError,
      autoStart: {
        label: t.autoStart,
        checked: autoStartChecked,
        disabled: off || current.config.state !== "ok",
        onChange(next) {
          autoStartChecked = next;
          void run(text().autoStartFailed, () =>
            act("entryRemoteConfig", { autoStart: next }),
          );
        },
      },
      valuesTitle: t.valuesTitle,
      unsaved: { label: t.unsaved, shown: unsavedShown },
      valuesIntro: t.valuesIntro,
      fields: [
        fieldProps("origin", t.originLabel, off),
        fieldProps("teamDomain", t.teamDomainLabel, off),
        fieldProps("audience", t.audienceLabel, off),
        fieldProps("port", t.portLabel, off),
        fieldProps("token", t.tokenLabel, off),
      ],
      tokenHelp: t.tokenHelp,
      savedTo: current
        ? current.configFromFlag
          ? t.fromFlag(current.configPath, current.tokenPath)
          : t.savedTo(current.configPath, current.tokenPath)
        : "",
      log: {
        hidden: !current || current.log.length === 0,
        summary: current ? t.logTitle(current.log.length) : "",
        text: current?.log.join("\n") ?? "",
      },
    };
  }

  function render(): void {
    const current = status;
    // 切り替えた答えを待つ間は、押したとおりの位置のままにする。
    if (current && !busy)
      autoStartChecked =
        current.config.state === "ok" && current.config.autoStart;
    if (current && !edited) {
      const saved = savedValues();
      for (const field of FIELDS) fieldValues[field] = fieldText(saved, field);
    }
    // cloudflared の出力は端末のタブで見る。ここは Homebrew と code-viewer の記録だけ。
    // 末尾を見ていたら、新しい行に付いていく。
    const logBody = element.querySelector<HTMLElement>(
      ".remote-access-log pre",
    );
    const atEnd =
      logBody !== null &&
      logBody.scrollTop + logBody.clientHeight >= logBody.scrollHeight - 4;
    const before = logBody?.textContent ?? "";
    renderOwned(element, view(viewProps()));
    if (logBody && atEnd && logBody.textContent !== before)
      logBody.scrollTop = logBody.scrollHeight;
  }

  function portValue(): number | null {
    const raw = fieldValues.port.trim();
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
          origin: fieldValues.origin.trim(),
          teamDomain: fieldValues.teamDomain.trim(),
          audience: fieldValues.audience.trim(),
          port,
        };
      }
      if (token.trim()) request.token = token;
      busy = true;
      render();
      try {
        await act("entryRemoteConfig", request);
        edited = false;
        token = "";
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
