// 入口のサーバの下で、このプロジェクトの裏のプロセスが止まった (502)・
// 起きなかった (503)・起動中のときの見せ方。
//
// - 中央の面 (ヘッダより下・左のサイドバーの右・下のパネルより上) を空表示
//   (`.empty`) で覆う。各画面が受け取った 502 の本文 (生の JSON) はその下に
//   隠れる。下のパネル (ターミナル) は入口が受けるので覆わない
// - 止まった・起きなかったときは、理由と「再起動」のダイアログも出す。理由の
//   全文 (detail・裏の出力の末尾 log) はダイアログの「詳細」に畳む。再起動が
//   失敗したときも、その理由の全文を同じ「詳細」に出して開く
// - 起動中は、入口に裏の状態を 1 度だけ聞き (apiUrl("entryBackend"))、起こしている
//   最中なら「起動中」を出す。プロジェクトの要求が 1 つでも返ったら消す

import { html, nothing } from "lit/html.js";
import { apiUrl } from "../core/api-url";
import { formatErrorDetail, responseErrorMessage } from "../core/error-detail";
import { SYNC_16_PATH } from "../core/icons";
import {
  type EntryBackendFailure,
  type EntryBackendStateResponse,
  isEntryBackendFailure,
} from "../core/types";
import type { ProjectsText } from "./projects/projects-i18n";
import { iconTemplate } from "./ui/icon";
import { detachedElement } from "./ui/renderer";
import { showFormDialog } from "./ui-dialog";

export type BackendStateDeps = {
  text(): ProjectsText;
  /** 再起動できたら画面を読み直す。 */
  reload(): void;
  /** 状態を聞けなかったとき (画面は出し続ける。理由は状態表示に残す)。 */
  reportError(operation: string, error: unknown): void;
};

/** 中央の面を覆う空表示 (起動中・止まった)。 */
export type BackendSurfaceProps = {
  hidden: boolean;
  mode: "starting" | "failure" | null;
  heading: string;
  body: string;
  /** 止まったときだけ (起動中は隠す)。 */
  actions: {
    restart: { label: string; busy: boolean; onClick(): void };
    details: { label: string; onClick(): void };
  } | null;
};

/** ダイアログの「詳細」(理由の全文)。 */
export type BackendDetailsProps = {
  summary: string;
  text: string;
  open: boolean;
};

export type BackendStateView = {
  surface(props: BackendSurfaceProps): unknown;
  details(props: BackendDetailsProps): unknown;
};

const actionTemplate = (
  label: string,
  primary: boolean,
  onClick: () => void,
  busy = false,
) => html`<button
  type="button"
  class=${`${primary ? "empty-action empty-action-primary" : "empty-action"}${busy ? " spinning" : ""}`}
  ?disabled=${busy}
  @click=${onClick}
><span class="empty-action-icon" aria-hidden="true">${
  primary ? iconTemplate(SYNC_16_PATH, "octicon-sync") : nothing
}</span><span class="empty-action-label">${label}</span></button>`;

export const DEFAULT_VIEW: BackendStateView = {
  surface: (props) => html`<section
    id="backend-state"
    class="empty empty-with-actions backend-state"
    ?hidden=${props.hidden}
    role="status"
    data-backend-state=${props.mode ?? nothing}
  ><div
      class=${props.mode === "starting" ? "empty-icon backend-state-spinning" : "empty-icon"}
      aria-hidden="true"
    >${iconTemplate(SYNC_16_PATH, "octicon-sync")}</div><h2>${props.heading}</h2><p
      >${props.body}</p
    ><div class="empty-actions" ?hidden=${!props.actions}>${
      props.actions
        ? html`${actionTemplate(
            props.actions.restart.label,
            true,
            props.actions.restart.onClick,
            props.actions.restart.busy,
          )}${actionTemplate(props.actions.details.label, false, props.actions.details.onClick)}`
        : nothing
    }</div></section>`,
  details: (props) => html`<div class="agent-hooks-dialog"><details
      class="agent-hooks-dialog-details"
      .open=${props.open}
    ><summary>${props.summary}</summary><pre
        class="agent-hooks-dialog-code terminal-mono"
      >${props.text}</pre></details></div>`,
};

function projectName(root: string): string {
  return root.split("/").pop() || root;
}

export function createBackendState(
  deps: BackendStateDeps,
  view: BackendStateView = DEFAULT_VIEW,
) {
  let surface: { element: HTMLElement; draw(): void } | null = null;
  let shown: Omit<BackendSurfaceProps, "hidden"> = {
    mode: null,
    heading: "",
    body: "",
    actions: null,
  };
  let surfaceHidden = true;
  let restarting = false;
  let failure: EntryBackendFailure | null = null;
  let dialogOpen = false;
  /** プロジェクトの要求が 1 つでも返ったか (返った後は「起動中」を出さない)。 */
  let projectAnswered = false;

  function drawSurface(): HTMLElement {
    if (!surface) {
      surface = detachedElement(() =>
        view.surface({ ...shown, hidden: surfaceHidden }),
      );
      document.getElementById("app")?.appendChild(surface.element);
    }
    surface.draw();
    return surface.element;
  }

  function render(
    mode: "starting" | "failure",
    heading: string,
    body: string,
    actions: BackendSurfaceProps["actions"],
  ): void {
    shown = { mode, heading, body, actions };
    surfaceHidden = false;
    drawSurface();
  }

  function hideSurface(): void {
    surfaceHidden = true;
    if (surface) surface.draw();
  }

  /** ダイアログの「詳細」(理由の全文)。set で中身を替えて開く。 */
  function detailsBlock(text: string): {
    root: HTMLElement;
    set(detail: string): void;
  } {
    const state = { text, open: false };
    const block = detachedElement(() =>
      view.details({
        summary: deps.text().backendDetails,
        text: state.text,
        open: state.open,
      }),
    );
    return {
      root: block.element,
      set(detail) {
        state.text = detail;
        state.open = true;
        block.draw();
      },
    };
  }

  function failureDetail(body: EntryBackendFailure): string {
    return [body.detail, body.log].filter(Boolean).join("\n\n");
  }

  /** 再起動。失敗したら理由の全文を返す (投げない)。 */
  async function restart(
    key: string,
  ): Promise<{ ok: true } | { ok: false; message: string; detail: string }> {
    const text = deps.text();
    let res: Response;
    try {
      res = await fetch(apiUrl("entryRestart"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({ key }),
      });
    } catch (error) {
      console.error("[code-viewer] project process restart failed", error);
      return {
        ok: false,
        message: text.backendRestartFailed,
        detail: formatErrorDetail(error),
      };
    }
    if (res.ok) return { ok: true };
    const raw = await responseErrorMessage(res.clone(), "restart");
    let body: unknown = null;
    try {
      body = await res.json();
    } catch (error) {
      // 本文が JSON でない (入口より手前の失敗)。生の本文をそのまま出す。
      console.error(
        "[code-viewer] project process restart failed with a response that is not JSON",
        raw,
        error,
      );
    }
    if (isEntryBackendFailure(body)) {
      failure = body;
      return {
        ok: false,
        message: `${text.backendRestartFailed}: ${body.error}`,
        detail: failureDetail(body),
      };
    }
    console.error("[code-viewer] project process restart failed", raw);
    return { ok: false, message: text.backendRestartFailed, detail: raw };
  }

  async function openDialog(opening?: {
    message: string;
    detail: string;
  }): Promise<void> {
    const shown = failure;
    if (!shown || dialogOpen) return;
    dialogOpen = true;
    const text = deps.text();
    const name = projectName(shown.project.root);
    const details = detailsBlock(opening?.detail ?? failureDetail(shown));
    if (opening) details.set(opening.detail);
    const restarted = await showFormDialog({
      title:
        shown.code === "backend-stopped"
          ? text.backendStoppedTitle(name)
          : text.backendFailedTitle(name),
      description:
        opening?.message ??
        (shown.entryOutdated ? shown.error : text.backendDialogText),
      body: details.root,
      submitLabel: text.backendRestart,
      cancelLabel: text.close,
      wide: true,
      submit: async () => {
        const result = await restart(shown.project.key);
        if (result.ok === true) return true;
        details.set(result.detail);
        throw new Error(result.message);
      },
    });
    dialogOpen = false;
    if (restarted) deps.reload();
  }

  function showFailure(body: EntryBackendFailure): void {
    if (failure) return;
    failure = body;
    const text = deps.text();
    const name = projectName(body.project.root);
    const draw = () =>
      render(
        "failure",
        body.code === "backend-stopped"
          ? text.backendStoppedHeading
          : text.backendFailedTitle(name),
        // 入口が古いなら「再起動」では直らない。入口の止め方をここで出す。
        body.entryOutdated ? body.error : text.backendSurfaceText(name),
        {
          restart: {
            label: text.backendRestart,
            busy: restarting,
            onClick: () => {
              if (restarting) return;
              restarting = true;
              draw();
              void restart(body.project.key).then((result) => {
                restarting = false;
                draw();
                if (result.ok === false) void openDialog(result);
                else deps.reload();
              });
            },
          },
          details: {
            label: text.backendDetails,
            onClick: () => void openDialog(),
          },
        },
      );
    draw();
    void openDialog();
  }

  function showStarting(root: string): void {
    if (failure || projectAnswered) return;
    const text = deps.text();
    render(
      "starting",
      text.backendStartingTitle(projectName(root)),
      text.backendStartingText,
      null,
    );
  }

  /** 入口に、このプロジェクトの裏の状態を聞く (画面を開いたときに 1 度)。 */
  async function checkStarting(): Promise<void> {
    let res: Response;
    try {
      res = await fetch(apiUrl("entryBackend"));
    } catch (error) {
      deps.reportError("check the state of this project's process", error);
      return;
    }
    if (!res.ok) {
      deps.reportError(
        "check the state of this project's process",
        new Error(
          await responseErrorMessage(res, "GET the project process state"),
        ),
      );
      return;
    }
    const body = (await res.json()) as EntryBackendStateResponse;
    if (
      body.state === "starting" ||
      body.state === "idle-stopped" ||
      body.state === "absent"
    ) {
      showStarting(body.project.root);
    }
  }

  /** fetch の包み (onResponse) から、すべての応答で呼ぶ。 */
  function inspect(response: Response): void {
    // 応答の URL が無いのは fetch 以外で作った応答 (取り次ぎの応答ではない)。
    const path = response.url ? new URL(response.url).pathname : "";
    if (!path.startsWith("/p/")) return;
    if (response.status !== 502 && response.status !== 503) {
      projectAnswered = true;
      if (shown.mode === "starting") hideSurface();
      return;
    }
    if (!(response.headers.get("content-type") ?? "").includes("json")) return;
    response
      .clone()
      .json()
      .then(
        (body: unknown) => {
          if (isEntryBackendFailure(body)) showFailure(body);
        },
        (error: unknown) => {
          console.error(
            "[code-viewer] the entry server's error response could not be read",
            error,
          );
        },
      );
  }

  return {
    inspect,
    checkStarting,
    resetProject() {
      failure = null;
      projectAnswered = false;
      hideSurface();
    },
  };
}
