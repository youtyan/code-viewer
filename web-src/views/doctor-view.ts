// Doctor screen. Fetches /_doctor and renders OK/WARN/ERROR pills with
// remediation hints. Uses module-level generation counter to drop stale
// responses (see AGENTS.md Request Lifecycle Discipline).
//
// The sheet (#doctor-sheet in index.html) is drawn from one template; the
// state is what the last load produced.

import { html, nothing, type TemplateResult } from "lit/html.js";
import { apiUrl } from "../core/api-url";
import type {
  DoctorGroup,
  DoctorReport,
  DoctorRow,
  DoctorStatus,
} from "../core/doctor-types";
import { formatErrorDetail, responseErrorMessage } from "../core/error-detail";
import { renderOwned } from "./ui/renderer";

export type DoctorLang = "en" | "ja";

type DoctorText = {
  title: string;
  refresh: string;
  refreshing: string;
  loadFailed: string;
  worstOk: string;
  worstWarn: string;
  worstError: string;
  empty: string;
  close: string;
  statusLabels: Record<DoctorStatus, string>;
};

const TEXT: Record<DoctorLang, DoctorText> = {
  en: {
    title: "Environment doctor",
    refresh: "Re-run checks",
    refreshing: "Running checks…",
    loadFailed: "Failed to load doctor report",
    worstOk: "All checks passed.",
    worstWarn: "Some checks reported warnings.",
    worstError: "Some checks failed. See the items marked ERROR below.",
    empty: "No checks ran.",
    close: "Close",
    statusLabels: { ok: "OK", warn: "WARN", error: "ERROR" },
  },
  ja: {
    title: "環境ドクター",
    refresh: "再診断",
    refreshing: "診断中…",
    loadFailed: "doctor の結果を取得できませんでした",
    worstOk: "すべての診断項目が OK です。",
    worstWarn: "一部の項目に注意があります (WARN)。",
    worstError: "失敗している項目があります。下の ERROR を確認してください。",
    empty: "診断項目がありません。",
    close: "閉じる",
    statusLabels: { ok: "OK", warn: "警告", error: "エラー" },
  },
};

export type DoctorViewDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T | null;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  getLanguage(): DoctorLang;
  onWorstStatusChange?: (status: DoctorStatus | null) => void;
  onCloseRequest?: () => void;
};

let viewGeneration = 0;

export function doctorText(lang: DoctorLang): DoctorText {
  return TEXT[lang];
}

function statusLabel(text: DoctorText, status: DoctorStatus): string {
  return text.statusLabels[status];
}

function rowTemplate(text: DoctorText, row: DoctorRow): TemplateResult {
  return html`<div class="doctor-row ui-table-row" data-status=${row.status}><span
      class=${`doctor-row-pill doctor-row-pill-${row.status}`}
      >${statusLabel(text, row.status)}</span
    ><div class="doctor-row-body"><div class="doctor-row-title">${row.title}</div>${
      row.detail
        ? html`<div class="doctor-row-detail">${row.detail}</div>`
        : nothing
    }${row.hint ? html`<div class="doctor-row-hint">${row.hint}</div>` : nothing}</div></div>`;
}

function groupTemplate(text: DoctorText, group: DoctorGroup): unknown {
  if (group.rows.length === 0) return nothing;
  return html`<section class="doctor-group" data-group=${group.id}><h2
      class="doctor-group-title"
    >${group.title}</h2>${group.rows.map((row) => rowTemplate(text, row))}</section>`;
}

/** 診断の結果の段階。idle はまだ一度も読んでいない。 */
type DoctorState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "report"; report: DoctorReport }
  | { kind: "failed"; message: string };

export type DoctorViewHandle = {
  open(): Promise<void>;
  close(): void;
  isOpen(): boolean;
  refresh(): Promise<void>;
};

export function createDoctorView(deps: DoctorViewDeps): DoctorViewHandle {
  let state: DoctorState = { kind: "idle" };
  let busy = false;

  function getMount(): HTMLElement | null {
    return deps.$<HTMLElement>("#doctor-sheet");
  }

  function getOverlay(): HTMLElement | null {
    return deps.$<HTMLElement>("#doctor-sheet-overlay");
  }

  function sheetTemplate(): TemplateResult {
    const text = doctorText(deps.getLanguage());
    const report = state.kind === "report" ? state.report : null;
    const summary = !report
      ? ""
      : report.worstStatus === "error"
        ? text.worstError
        : report.worstStatus === "warn"
          ? text.worstWarn
          : text.worstOk;
    const content =
      state.kind === "loading"
        ? html`<div class="doctor-empty">${text.refreshing}</div>`
        : state.kind === "failed"
          ? html`<div class="doctor-empty">${`${text.loadFailed}: ${state.message}`}</div>`
          : report && !report.groups.length
            ? html`<div class="doctor-empty">${text.empty}</div>`
            : report
              ? report.groups.map((group) => groupTemplate(text, group))
              : nothing;
    return html`<div class="doctor-header"><h1>${text.title}</h1><button
        type="button"
        class="doctor-refresh"
        ?disabled=${busy}
        @click=${(event: Event) => {
          event.preventDefault();
          void load();
        }}
      >${text.refresh}</button><button
        type="button"
        class="doctor-close"
        aria-label=${text.close}
        title=${text.close}
        @click=${(event: Event) => {
          event.preventDefault();
          deps.onCloseRequest?.();
        }}
      >×</button></div><div class="doctor-summary">${summary}</div><div
        class="doctor-content"
      >${content}</div>`;
  }

  function draw(): void {
    const mount = getMount();
    if (mount) renderOwned(mount, sheetTemplate());
  }

  async function load(): Promise<void> {
    viewGeneration += 1;
    const myGen = viewGeneration;
    busy = true;
    state = { kind: "loading" };
    draw();
    try {
      const res = await deps.trackLoad(fetch(apiUrl("doctor")));
      if (myGen !== viewGeneration) return;
      if (!res.ok) {
        throw new Error(await responseErrorMessage(res, "GET /_doctor"));
      }
      const data = (await res.json()) as DoctorReport;
      if (myGen !== viewGeneration) return;
      state = { kind: "report", report: data };
      deps.onWorstStatusChange?.(data.worstStatus);
    } catch (err) {
      if (myGen !== viewGeneration) return;
      console.error(
        "[code-viewer] the doctor report could not be loaded:",
        err,
      );
      state = { kind: "failed", message: formatErrorDetail(err) };
      deps.onWorstStatusChange?.(null);
    } finally {
      if (myGen === viewGeneration) {
        busy = false;
        draw();
      }
    }
  }

  function isOpen(): boolean {
    const mount = getMount();
    return mount ? !mount.hidden : false;
  }

  async function open(): Promise<void> {
    const mount = getMount();
    if (!mount) return;
    draw();
    mount.hidden = false;
    mount.setAttribute("aria-hidden", "false");
    // The drawer keeps display:block while [hidden] for the slide-out
    // animation, so Tab focus would still land on .doctor-refresh /
    // .doctor-close after close. `inert` makes the subtree non-focusable
    // and inert to events while it is visually off-screen.
    mount.removeAttribute("inert");
    const overlay = getOverlay();
    if (overlay) {
      overlay.hidden = false;
      overlay.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("doctor-sheet-open");
    await load();
  }

  function close(): void {
    const mount = getMount();
    if (!mount) return;
    mount.hidden = true;
    mount.setAttribute("aria-hidden", "true");
    mount.setAttribute("inert", "");
    const overlay = getOverlay();
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("doctor-sheet-open");
    // Invalidate any in-flight /_doctor fetch by bumping the generation;
    // late responses will see myGen !== viewGeneration and bail out.
    viewGeneration += 1;
  }

  async function refresh(): Promise<void> {
    if (!getMount()) return;
    await load();
  }

  return { open, close, isOpen, refresh };
}
