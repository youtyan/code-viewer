// Doctor screen. Fetches /_doctor and renders OK/WARN/ERROR pills with
// remediation hints. Uses module-level generation counter to drop stale
// responses (see AGENTS.md Request Lifecycle Discipline).

import type {
  DoctorGroup,
  DoctorReport,
  DoctorRow,
  DoctorStatus,
} from "../core/doctor-types";

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
  escapeHtml(s: unknown): string;
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

function renderRow(
  text: DoctorText,
  esc: (s: unknown) => string,
  row: DoctorRow,
): string {
  const pill =
    `<span class="doctor-row-pill doctor-row-pill-${row.status}">` +
    `${esc(statusLabel(text, row.status))}</span>`;
  const body =
    `<div class="doctor-row-body">` +
    `<div class="doctor-row-title">${esc(row.title)}</div>` +
    (row.detail
      ? `<div class="doctor-row-detail">${esc(row.detail)}</div>`
      : "") +
    (row.hint ? `<div class="doctor-row-hint">${esc(row.hint)}</div>` : "") +
    `</div>`;
  return `<div class="doctor-row" data-status="${esc(row.status)}">${pill}${body}</div>`;
}

function renderGroup(
  text: DoctorText,
  esc: (s: unknown) => string,
  group: DoctorGroup,
): string {
  if (group.rows.length === 0) return "";
  const rows = group.rows.map((row) => renderRow(text, esc, row)).join("");
  return (
    `<section class="doctor-group" data-group="${esc(group.id)}">` +
    `<h2 class="doctor-group-title">${esc(group.title)}</h2>` +
    rows +
    `</section>`
  );
}

function renderReport(
  mount: HTMLElement,
  report: DoctorReport,
  text: DoctorText,
  esc: (s: unknown) => string,
): void {
  const summary = mount.querySelector<HTMLElement>(".doctor-summary");
  if (summary) {
    const message =
      report.worstStatus === "error"
        ? text.worstError
        : report.worstStatus === "warn"
          ? text.worstWarn
          : text.worstOk;
    summary.textContent = message;
  }
  const content = mount.querySelector<HTMLElement>(".doctor-content");
  if (!content) return;
  if (!report.groups.length) {
    content.innerHTML = `<div class="doctor-empty">${esc(text.empty)}</div>`;
    return;
  }
  content.innerHTML = report.groups
    .map((group) => renderGroup(text, esc, group))
    .join("");
}

function ensureSkeleton(
  mount: HTMLElement,
  text: DoctorText,
  esc: (s: unknown) => string,
): void {
  if (mount.querySelector(".doctor-header")) return;
  mount.innerHTML =
    `<div class="doctor-header">` +
    `<h1>${esc(text.title)}</h1>` +
    `<button type="button" class="doctor-refresh">${esc(text.refresh)}</button>` +
    `<button type="button" class="doctor-close" aria-label="${esc(text.close)}" title="${esc(text.close)}">×</button>` +
    `</div>` +
    `<div class="doctor-summary"></div>` +
    `<div class="doctor-content"></div>`;
}

export type DoctorViewHandle = {
  open(): Promise<void>;
  close(): void;
  isOpen(): boolean;
  refresh(): Promise<void>;
};

export function createDoctorView(deps: DoctorViewDeps): DoctorViewHandle {
  function getMount(): HTMLElement | null {
    return deps.$<HTMLElement>("#doctor-sheet");
  }

  function getOverlay(): HTMLElement | null {
    return deps.$<HTMLElement>("#doctor-sheet-overlay");
  }

  function setRefreshState(mount: HTMLElement, busy: boolean): void {
    const btn = mount.querySelector<HTMLButtonElement>(".doctor-refresh");
    if (!btn) return;
    btn.disabled = busy;
  }

  async function load(mount: HTMLElement): Promise<void> {
    viewGeneration += 1;
    const myGen = viewGeneration;
    const lang = deps.getLanguage();
    const text = doctorText(lang);
    setRefreshState(mount, true);
    const content = mount.querySelector<HTMLElement>(".doctor-content");
    if (content)
      content.innerHTML = `<div class="doctor-empty">${deps.escapeHtml(text.refreshing)}</div>`;
    const summary = mount.querySelector<HTMLElement>(".doctor-summary");
    if (summary) summary.textContent = "";
    try {
      const res = await deps.trackLoad(fetch("/_doctor"));
      if (myGen !== viewGeneration) return;
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as DoctorReport;
      if (myGen !== viewGeneration) return;
      renderReport(mount, data, text, deps.escapeHtml);
      deps.onWorstStatusChange?.(data.worstStatus);
    } catch (err) {
      if (myGen !== viewGeneration) return;
      if (content) {
        const message = err instanceof Error ? err.message : String(err);
        content.innerHTML = `<div class="doctor-empty">${deps.escapeHtml(`${text.loadFailed}: ${message}`)}</div>`;
      }
      deps.onWorstStatusChange?.(null);
    } finally {
      if (myGen === viewGeneration) setRefreshState(mount, false);
    }
  }

  function applyLocalizedLabels(mount: HTMLElement, text: DoctorText): void {
    const title = mount.querySelector<HTMLElement>(".doctor-header h1");
    if (title) title.textContent = text.title;
    const refreshBtn =
      mount.querySelector<HTMLButtonElement>(".doctor-refresh");
    if (refreshBtn) refreshBtn.textContent = text.refresh;
    const closeBtn = mount.querySelector<HTMLButtonElement>(".doctor-close");
    if (closeBtn) {
      closeBtn.setAttribute("aria-label", text.close);
      closeBtn.setAttribute("title", text.close);
    }
  }

  function bindOnce(mount: HTMLElement): void {
    if (mount.dataset.bound) return;
    mount.dataset.bound = "1";
    const text = doctorText(deps.getLanguage());
    ensureSkeleton(mount, text, deps.escapeHtml);
    const refreshBtn =
      mount.querySelector<HTMLButtonElement>(".doctor-refresh");
    refreshBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      void load(mount);
    });
    const closeBtn = mount.querySelector<HTMLButtonElement>(".doctor-close");
    closeBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      deps.onCloseRequest?.();
    });
  }

  function isOpen(): boolean {
    const mount = getMount();
    return mount ? !mount.hidden : false;
  }

  async function open(): Promise<void> {
    const mount = getMount();
    if (!mount) return;
    bindOnce(mount);
    applyLocalizedLabels(mount, doctorText(deps.getLanguage()));
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
    await load(mount);
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
    const mount = getMount();
    if (!mount) return;
    await load(mount);
  }

  return { open, close, isOpen, refresh };
}
