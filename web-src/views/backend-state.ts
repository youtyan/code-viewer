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

import { apiUrl } from "../core/api-url";
import { formatErrorDetail, responseErrorMessage } from "../core/error-detail";
import { iconSvg, SYNC_16_PATH } from "../core/icons";
import {
  type EntryBackendFailure,
  type EntryBackendStateResponse,
  isEntryBackendFailure,
} from "../core/types";
import type { ProjectsText } from "./projects/projects-i18n";
import { showFormDialog } from "./ui-dialog";

export type BackendStateDeps = {
  text(): ProjectsText;
  /** 再起動できたら画面を読み直す。 */
  reload(): void;
  /** 状態を聞けなかったとき (画面は出し続ける。理由は状態表示に残す)。 */
  reportError(operation: string, error: unknown): void;
};

function projectName(root: string): string {
  return root.split("/").pop() || root;
}

export function createBackendState(deps: BackendStateDeps) {
  let surface: HTMLElement | null = null;
  let failure: EntryBackendFailure | null = null;
  let dialogOpen = false;
  /** プロジェクトの要求が 1 つでも返ったか (返った後は「起動中」を出さない)。 */
  let projectAnswered = false;

  function ensureSurface(): HTMLElement {
    if (surface) return surface;
    const el = document.createElement("section");
    el.id = "backend-state";
    el.className = "empty empty-with-actions backend-state";
    el.hidden = true;
    el.setAttribute("role", "status");
    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = iconSvg("octicon-sync", SYNC_16_PATH);
    const title = document.createElement("h2");
    const body = document.createElement("p");
    const actions = document.createElement("div");
    actions.className = "empty-actions";
    el.append(icon, title, body, actions);
    document.getElementById("app")?.appendChild(el);
    surface = el;
    return el;
  }

  function actionButton(
    label: string,
    primary: boolean,
    run: (button: HTMLButtonElement) => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary
      ? "empty-action empty-action-primary"
      : "empty-action";
    const icon = document.createElement("span");
    icon.className = "empty-action-icon";
    icon.setAttribute("aria-hidden", "true");
    if (primary) icon.innerHTML = iconSvg("octicon-sync", SYNC_16_PATH);
    const text = document.createElement("span");
    text.className = "empty-action-label";
    text.textContent = label;
    button.append(icon, text);
    button.addEventListener("click", () => run(button));
    return button;
  }

  function render(
    mode: "starting" | "failure",
    heading: string,
    body: string,
  ): HTMLElement {
    const el = ensureSurface();
    el.dataset.backendState = mode;
    const title = el.querySelector("h2");
    if (title) title.textContent = heading;
    const text = el.querySelector("p");
    if (text) text.textContent = body;
    el.querySelector(".empty-icon")?.classList.toggle(
      "backend-state-spinning",
      mode === "starting",
    );
    el.hidden = false;
    return el;
  }

  /** ダイアログの「詳細」(理由の全文)。 */
  function detailsBlock(text: string): {
    root: HTMLElement;
    set(detail: string): void;
  } {
    const root = document.createElement("div");
    root.className = "agent-hooks-dialog";
    const details = document.createElement("details");
    details.className = "agent-hooks-dialog-details";
    const summary = document.createElement("summary");
    summary.textContent = deps.text().backendDetails;
    const pre = document.createElement("pre");
    pre.className = "agent-hooks-dialog-code terminal-mono";
    pre.textContent = text;
    details.append(summary, pre);
    root.append(details);
    return {
      root,
      set(detail) {
        pre.textContent = detail;
        details.open = true;
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
    const el = render(
      "failure",
      body.code === "backend-stopped"
        ? text.backendStoppedHeading
        : text.backendFailedTitle(name),
      // 入口が古いなら「再起動」では直らない。入口の止め方をここで出す。
      body.entryOutdated ? body.error : text.backendSurfaceText(name),
    );
    const actions = el.querySelector<HTMLElement>(".empty-actions");
    actions?.replaceChildren(
      actionButton(text.backendRestart, true, (button) => {
        if (button.disabled) return;
        button.disabled = true;
        button.classList.add("spinning");
        void restart(body.project.key).then((result) => {
          button.disabled = false;
          button.classList.remove("spinning");
          if (result.ok === false) void openDialog(result);
          else deps.reload();
        });
      }),
      actionButton(text.backendDetails, false, () => void openDialog()),
    );
    if (actions) actions.hidden = false;
    void openDialog();
  }

  function showStarting(root: string): void {
    if (failure || projectAnswered) return;
    const text = deps.text();
    const el = render(
      "starting",
      text.backendStartingTitle(projectName(root)),
      text.backendStartingText,
    );
    const actions = el.querySelector<HTMLElement>(".empty-actions");
    if (actions) actions.hidden = true;
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
      if (surface?.dataset.backendState === "starting") surface.hidden = true;
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

  return { inspect, checkStarting };
}
