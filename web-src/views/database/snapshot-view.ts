import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import { apiUrl } from "../../core/api-url";
import type {
  DbTableInfo,
  SnapshotDiffRow,
  SnapshotDiffTableSummary,
  SnapshotMeta,
} from "../../core/database/types";
import { errorWithCause } from "../../core/error-detail";
import { isImeComposing } from "../../core/keyboard";
import { detachedElement, templateElements } from "../ui/renderer";
import { type DbText, dbText } from "./i18n";
import { reportDatastoreFailure, requireOkResponse } from "./report-failure";

export type SnapshotViewDeps = {
  getDbId: () => string | null;
  getSchema: () => string | null;
  getTables: () => DbTableInfo[];
  getText?: () => DbText;
  /**
   * AGENTS.md Request Lifecycle Discipline で要求されている in-flight 登録。
   * snapshot 系 fetch を全てこの関数経由で走らせ、view 切替時に
   * cancelInFlightRequests でまとめて abort できるようにする。
   */
  trackLoad?: <T>(promise: Promise<T>) => Promise<T>;
  /** 「前回チェックしていたテーブル」を取得する。dbId+schema scope。
   *  値がなければ null/undefined を返す → caller 側の fallback (= 直前 done
   *  snapshot の tables) を使う。 */
  getStoredSelectedTables?: () => string[] | undefined;
  /** チェック内容が変わった時点で永続保存する (db-ui.json) callback。 */
  setStoredSelectedTables?: (tables: string[]) => void;
  /** URL ?diffBefore=&diffAfter= の現在値。リロード復元用。 */
  getRouteDiff?: () => { before?: string; after?: string } | undefined;
  /** diff 表示 / 解除のタイミングで URL を更新する。 */
  setRouteDiff?: (diff: { before?: string; after?: string } | null) => void;
};

type ActiveJob = {
  id: string;
  table?: string;
  index?: number;
  total: number;
  /** server から終端 SSE が来たか (created/aborted/error)。
   *  done になっても progress row はしばらく残し、結果を見せる。 */
  done: boolean;
  aborted?: boolean;
  errorMessage?: string;
};

export type SnapshotView = {
  el: HTMLElement;
  refresh: () => void;
  handleSse: (data: string) => void;
  dispose: () => void;
  localize: () => void;
  /** URL ?diffBefore=&diffAfter= の値があれば、対応する diff を inline 表示する。
   *  snapshots がまだ読み込まれていない場合、内部で refresh を待ってから走る。 */
  restoreDiffFromRoute: () => void;
};

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

type Failure = { operation: string; message: string };

/** 差分の 1 テーブル分の行: 読み込み中・失敗・描いた表 (行が無ければ空)。 */
type DiffRowsState =
  | { loading: true }
  | { failure: Failure }
  | { nodes: Node[] };

/** 右の差分の欄。seq が変わるたびに作り直す (前の目次の見張りも外す)。 */
type DiffPane =
  | null
  | { seq: number; loading: true }
  | { seq: number; failure: Failure }
  | {
      seq: number;
      beforeId: string;
      afterId: string;
      tables: SnapshotDiffTableSummary[];
    };

export type SnapshotViewProps = {
  text: DbText["snapshot"];
  jobs: { job: ActiveJob; cancelling: boolean; onCancel: () => void }[];
  selector: {
    visible: boolean;
    tables: DbTableInfo[];
    selected: ReadonlySet<string>;
    filter: string;
    creating: boolean;
    failure: Failure | null;
  };
  left: {
    /** 一覧を描き直した回数。変わるたびに左の欄を作り直す。 */
    seq: number;
    snapshots: SnapshotMeta[];
    failure: Failure | null;
    diffBefore: string;
    diffAfter: string;
    diffBusy: boolean;
    deleteArmed: string | null;
    noteDialog: { snapshotId: string; note: string } | null;
  };
  diff: DiffPane;
  diffRows: ReadonlyMap<string, DiffRowsState>;
  hiddenTables: ReadonlySet<string>;
  activeChip: string | null;
  refs: {
    filter: Ref<HTMLInputElement>;
    note: Ref<HTMLInputElement>;
    noteDialog: Ref<HTMLInputElement>;
    right: Ref<HTMLElement>;
    toc: Ref<HTMLElement>;
  };
  onCreate: () => void;
  onRefresh: () => void;
  onFilter: (value: string) => void;
  onFilterKeydown: (event: KeyboardEvent) => void;
  onToggleTable: (name: string, checked: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onConfirm: () => void;
  onCancelSelector: () => void;
  onDiffBefore: (id: string) => void;
  onDiffAfter: (id: string) => void;
  onDiff: () => void;
  onEditNote: (snapshot: SnapshotMeta) => void;
  onDelete: (id: string) => void;
  onSaveNote: () => void;
  onCloseNote: () => void;
  onNoteKeydown: (event: KeyboardEvent) => void;
  onToggleDiffTable: (name: string) => void;
  onChip: (sectionId: string) => void;
};

export type SnapshotViewView = (props: SnapshotViewProps) => unknown;

const failureTemplate = (failure: Failure) =>
  html`<div class="db-snapshot-error" data-snapshot-failure=${failure.operation}
    >${failure.message}</div
  >`;

function diffSectionId(tableName: string): string {
  return `diff-table-${tableName.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

// 差分セクションに出す対象:
//   (1) 行差分が 1 件以上ある (coverage:"both" で +/~/- が立っている)
//   (2) 片側 snapshot だけにあるテーブル (coverage:"before-only"/"after-only")
//       — レコードが消えた/増えたのではなく「比較不能」と知らせるため。
function changedTablesOf(
  tables: SnapshotDiffTableSummary[],
): SnapshotDiffTableSummary[] {
  return tables.filter(
    (t) =>
      t.insertedCount + t.updatedCount + t.deletedCount > 0 ||
      (t.coverage && t.coverage !== "both"),
  );
}

const incomplete = (t: SnapshotDiffTableSummary) =>
  t.coverage === "before-only" || t.coverage === "after-only";

// 1 テーブルぶんのカウント / 未取得 badge。`coverage === "both"` または未指定
// なら git diff 風カウント (+N: 緑、~N: 黄、-N: 赤)、片側未取得ならニュートラル
// badge。テーブル header / toc chip の両方から使う。
function coverageOrStats(
  tx: DbText["snapshot"],
  summary: SnapshotDiffTableSummary,
): unknown {
  if (summary.coverage === "before-only")
    return html`<span class="db-snapshot-diff-coverage-badge before-only"
      >${tx.coverageBeforeOnly}</span
    >`;
  if (summary.coverage === "after-only")
    return html`<span class="db-snapshot-diff-coverage-badge after-only"
      >${tx.coverageAfterOnly}</span
    >`;
  const stat = (cls: string, prefix: string, n: number) =>
    n > 0
      ? html`<span class=${`db-snapshot-diff-stat ${cls}`}>${prefix}${n}</span>`
      : nothing;
  return html`${stat("add", "+", summary.insertedCount)}${stat(
    "upd",
    "~",
    summary.updatedCount,
  )}${stat("del", "-", summary.deletedCount)}`;
}

function progressTemplate(p: SnapshotViewProps): unknown {
  const t = p.text;
  return p.jobs.map(({ job, cancelling, onCancel }) => {
    let label: string;
    let state: string;
    if (job.errorMessage) {
      label = `${t.errorPrefix}: ${job.errorMessage}`;
      state = "error";
    } else if (job.aborted) {
      label = t.aborted;
      state = "aborted";
    } else if (job.done) {
      label = t.statusDone;
      state = "done";
    } else if (job.total > 0 && job.table) {
      // 実際に進行中の table が確定している時だけ「Snapshotting X (i/total)」
      // を出す。`started` SSE 受信直後は total はあっても table がまだ無く、
      // ここで `progressLabel("", 0, total)` を呼ぶと i18n の三項分岐が
      // "Finalizing…" 側に倒れて、開始した瞬間に「仕上げ中」と表示される
      // フリッカが出る。
      label = t.progressLabel(job.table, job.index ?? 0, job.total);
      state = "running";
    } else {
      label = t.creating;
      state = "running";
    }
    return html`<div
      class=${`db-snapshot-progress-row ${state}`}
      data-snapshot-id=${job.id}
    ><span class="db-snapshot-progress-label" title=${job.errorMessage ?? nothing}
        >${label}</span
      >${
        job.done
          ? nothing
          : html`<button
              type="button"
              class="db-snapshot-job-cancel-btn"
              ?disabled=${cancelling}
              @click=${cancelling ? nothing : onCancel}
            >${cancelling ? t.cancelling : t.cancel}</button>`
      }</div>`;
  });
}

function selectorTemplate(p: SnapshotViewProps): unknown {
  const t = p.text;
  const sel = p.selector;
  const needle = sel.filter.trim().toLowerCase();
  const shown = sel.tables.filter(
    (tbl) => !needle || tbl.name.toLowerCase().includes(needle),
  );
  return html`${sel.failure ? failureTemplate(sel.failure) : nothing}<div
      class="db-snapshot-table-selector-header"
    ><span>${t.selectTablesHeader}</span><span class="db-snapshot-table-counter"
        >${t.tableCounter(sel.selected.size, sel.tables.length)}</span
      ></div
    ><div class="db-snapshot-table-filter"><input
        type="search"
        class="db-snapshot-table-filter-input"
        placeholder=${t.filterPlaceholder}
        .value=${live(sel.filter)}
        ${ref(p.refs.filter)}
        @input=${(event: Event) =>
          p.onFilter((event.currentTarget as HTMLInputElement).value)}
        @keydown=${p.onFilterKeydown}
      /></div
    ><div class="db-snapshot-table-checkboxes">${shown.map(
      (tbl) =>
        html`<label class="db-snapshot-table-row"><input
            type="checkbox"
            .value=${tbl.name}
            .checked=${sel.selected.has(tbl.name)}
            @change=${(event: Event) =>
              p.onToggleTable(
                tbl.name,
                (event.currentTarget as HTMLInputElement).checked,
              )}
          /><span class="db-snapshot-table-row-name">${tbl.name}</span><span
            class="db-snapshot-table-row-count"
            >${tbl.rowCount != null ? t.rowCount(tbl.rowCount).trim() : ""}</span
          ></label>`,
    )}${
      shown.length === 0 && needle
        ? html`<div class="db-snapshot-table-row-empty">${t.empty}</div>`
        : nothing
    }</div
    ><div class="db-snapshot-select-actions"><button
        type="button"
        class="db-btn db-btn-sm"
        @click=${p.onSelectAll}
      >${t.selectAll}</button><button
        type="button"
        class="db-btn db-btn-sm"
        @click=${p.onDeselectAll}
      >${t.deselectAll}</button></div
    ><div class="db-snapshot-note-row"><label class="db-snapshot-note-field"
        ><span class="db-snapshot-note-label">${t.noteLabel}</span><input
          type="text"
          class="db-snapshot-note-input"
          placeholder=${t.notePlaceholder}
          ${ref(p.refs.note)}
      /></label></div
    ><div class="db-snapshot-action-row"><button
        type="button"
        class="db-snapshot-confirm-btn"
        ?disabled=${sel.creating || sel.selected.size === 0}
        @click=${p.onConfirm}
      >${sel.creating ? t.creating : t.confirm}</button><button
        type="button"
        class="db-snapshot-cancel-btn"
        @click=${p.onCancelSelector}
      >${t.cancel}</button></div>`;
}

function snapshotLabel(t: DbText["snapshot"], s: SnapshotMeta): string {
  const date = new Date(s.createdAt).toLocaleString();
  const note = s.note ? ` — ${s.note}` : "";
  return t.label(date, s.tables.length, note);
}

function leftTemplate(p: SnapshotViewProps): unknown {
  const t = p.text;
  const left = p.left;
  const failure = left.failure ? failureTemplate(left.failure) : nothing;
  const dialog = left.noteDialog;
  const dialogTemplate = dialog
    ? html`<div class="db-snapshot-inline-dialog"><input
          type="text"
          class="db-snapshot-note-input"
          placeholder=${t.noteInputPlaceholder}
          .value=${dialog.note}
          ${ref(p.refs.noteDialog)}
          @keydown=${p.onNoteKeydown}
        /><button
          type="button"
          class="db-snapshot-confirm-btn"
          @click=${p.onSaveNote}
        >${t.saveNote}</button><button type="button" @click=${p.onCloseNote}
          >${t.cancel}</button
        ></div>`
    : nothing;
  const dialogInList =
    dialog !== null &&
    left.snapshots.some((snap) => snap.id === dialog.snapshotId);
  if (left.snapshots.length === 0)
    return html`${failure}${dialogInList ? nothing : dialogTemplate}<div
        class="db-snapshot-empty"
      >${t.empty}</div>`;
  const done = left.snapshots.filter((s) => s.status === "done");
  // 新しい snapshot が上に来る並び順 (created_at desc)。
  // 大量に snapshot が溜まった時、最新を探すのにスクロールしないで済む。
  const sorted = [...done].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const select = (value: string, onChange: (id: string) => void) =>
    html`<select
      class="db-snapshot-diff-select"
      @change=${(event: Event) =>
        onChange((event.currentTarget as HTMLSelectElement).value)}
    >${sorted.map(
      (s) =>
        html`<option value=${s.id} ?selected=${s.id === value}
          >${snapshotLabel(t, s)}</option
        >`,
    )}</select>`;
  // 左ペイン上部の sticky エリア: diff 選択プルダウン + ボタン
  // (一覧が何百件あろうとプルダウンに常時アクセスできる)。左ペインは横幅が
  // 狭いので、各プルダウンを「ラベル + select」の行構成にして縦に積む。
  return html`${failure}${dialogInList ? nothing : dialogTemplate}<div
      class="db-snapshot-sticky-header"
    >${
      done.length >= 2
        ? html`<div class="db-snapshot-diff-create"><label
              class="db-snapshot-diff-row is-before"
              ><span class="db-snapshot-diff-row-label"
                >${t.compareBeforeBadge}</span
              >${select(left.diffBefore, p.onDiffBefore)}</label
            ><label class="db-snapshot-diff-row is-after"
              ><span class="db-snapshot-diff-row-label"
                >${t.compareAfterBadge}</span
              >${select(left.diffAfter, p.onDiffAfter)}</label
            ><button
              type="button"
              class="db-snapshot-diff-btn"
              ?disabled=${left.diffBusy}
              @click=${p.onDiff}
            >${left.diffBusy ? t.comparing : t.diffManual}</button></div>`
        : nothing
    }</div
    ><div class="db-snapshot-list-section"><h3 class="db-snapshot-section-title"
        >${t.listTitle(left.snapshots.length)}</h3
      >${left.snapshots.map((snap) => {
        // プルダウンで選ばれた before/after を一覧の対応行にハイライトする
        // (2 つ以上の done があるときだけ、プルダウンがある)。
        const role =
          done.length < 2
            ? null
            : snap.id === left.diffBefore
              ? "before"
              : snap.id === left.diffAfter
                ? "after"
                : null;
        const armed = left.deleteArmed === snap.id;
        return html`<div
            class=${role === null ? "db-snapshot-item" : `db-snapshot-item is-${role}`}
            data-snapshot-id=${snap.id}
          ><div class="db-snapshot-info"><span class="db-snapshot-date"
                >${new Date(snap.createdAt).toLocaleString()}</span
              ><span class=${`db-snapshot-status ${snap.status}`}>${
                snap.status === "running"
                  ? t.statusRunning
                  : snap.status === "error"
                    ? t.statusError
                    : t.statusDone
              }</span><span
                class="db-snapshot-tables-count"
                title=${snap.tables.join(", ")}
                >${t.tableCount(snap.tables.length)}</span
              >${
                snap.note
                  ? html`<span class="db-snapshot-note">${snap.note}</span>`
                  : nothing
              }${
                snap.status === "error" && snap.errorMessage
                  ? html`<span
                      class="db-snapshot-error-message"
                      title=${snap.errorMessage}
                      >${t.errorPrefix}: ${snap.errorMessage}</span
                    >`
                  : nothing
              }${
                role === null
                  ? nothing
                  : html`<span class="db-snapshot-compare-badge">${
                      role === "before"
                        ? t.compareBeforeBadge
                        : t.compareAfterBadge
                    }</span>`
              }</div
            ><div class="db-snapshot-actions"><button
                type="button"
                class="db-btn db-btn-sm"
                @click=${() => p.onEditNote(snap)}
              >${t.editNote}</button><button
                type="button"
                class="db-btn db-btn-sm"
                data-confirm=${armed ? "1" : nothing}
                @click=${() => p.onDelete(snap.id)}
              >${armed ? t.deleteConfirm : t.delete}</button></div></div
          >${dialog?.snapshotId === snap.id ? dialogTemplate : nothing}`;
      })}</div>`;
}

function diffTemplate(p: SnapshotViewProps, diff: NonNullable<DiffPane>) {
  const t = p.text;
  if ("loading" in diff)
    return html`<div class="db-snapshot-loading">${t.calculatingDiff}</div>`;
  if ("failure" in diff) return failureTemplate(diff.failure);
  const beforeMeta = p.left.snapshots.find((s) => s.id === diff.beforeId);
  const afterMeta = p.left.snapshots.find((s) => s.id === diff.afterId);
  const header =
    beforeMeta && afterMeta
      ? html`<div class="db-snapshot-diff-header">${t.diffShowing(
          new Date(beforeMeta.createdAt).toLocaleString(),
          new Date(afterMeta.createdAt).toLocaleString(),
        )}</div>`
      : nothing;
  const changed = changedTablesOf(diff.tables);
  if (changed.length === 0)
    return html`${header}<div class="db-snapshot-diff-summary">${t.noChanges}</div>`;
  // 変更テーブルが多い時、上から下までスクロールしないと目的の table に
  // 辿り着けない。sticky な「目次」を出し、chip クリックで対応 section に
  // ジャンプできるようにする。
  return html`${header}<div class="db-snapshot-diff-summary">${t.diffSummary(
    changed.length,
    diff.tables.length - changed.length,
  )}</div><div class="db-snapshot-diff-toc" ${ref(p.refs.toc)}>${changed.map(
    (table) => {
      const id = diffSectionId(table.tableName);
      return html`<button
          type="button"
          class=${[
            "db-snapshot-diff-toc-chip",
            incomplete(table) ? "coverage-incomplete" : "",
            p.activeChip === id ? "active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          data-target-id=${id}
          @click=${() => p.onChip(id)}
        ><span class="db-snapshot-diff-toc-chip-name">${table.tableName}</span
          ><span class="db-snapshot-diff-toc-chip-stats"
            >${coverageOrStats(t, table)}</span
          ></button>`;
    },
  )}</div>${changed.map((table) => {
    const rows = p.diffRows.get(table.tableName);
    const count = table.unsnapshottedRowCount ?? 0;
    // scroll の停止位置補正は CSS の `.db-snapshot-right-pane
    // { scroll-padding-top: 68px }` に一本化している。
    return html`<div
        class="db-snapshot-diff-table"
        id=${diffSectionId(table.tableName)}
      ><div
          class="db-snapshot-diff-table-header"
          style="cursor: pointer"
          @click=${() => p.onToggleDiffTable(table.tableName)}
        ><span class="db-snapshot-diff-table-name">${table.tableName}</span><span
            class="db-snapshot-diff-table-stats"
            >${coverageOrStats(t, table)}</span
          ></div
        ><div
          class="db-snapshot-diff-rows-container"
          ?hidden=${p.hiddenTables.has(table.tableName)}
        >${
          incomplete(table)
            ? // 片側未取得は比較不能。説明文だけ出す。
              html`<div class="db-snapshot-diff-coverage-note">${
                table.coverage === "before-only"
                  ? t.coverageNoteBeforeOnly(count)
                  : t.coverageNoteAfterOnly(count)
              }</div>`
            : rows === undefined
              ? nothing
              : "loading" in rows
                ? html`<div class="db-snapshot-loading">${t.loading}</div>`
                : "failure" in rows
                  ? failureTemplate(rows.failure)
                  : rows.nodes
        }</div></div>`;
  })}`;
}

export const DEFAULT_VIEW: SnapshotViewView = (p) => {
  const t = p.text;
  return html`<div class="db-snapshot-view"><div class="db-snapshot-guide"><div
        class="db-snapshot-guide-title"
      >${t.guideTitle}</div><div class="db-snapshot-guide-body">${t.guideBody}</div></div
    ><div class="db-snapshot-toolbar"><button
        type="button"
        class=${p.selector.visible ? "db-snapshot-create-btn is-active-dialog" : "db-snapshot-create-btn"}
        ?disabled=${p.selector.visible}
        @click=${p.onCreate}
      >${t.create}</button><button
        type="button"
        class="db-snapshot-refresh-btn"
        @click=${p.onRefresh}
      >${t.refresh}</button></div
    ><div class="db-snapshot-progress-area" ?hidden=${p.jobs.length === 0}>${progressTemplate(
      p,
    )}</div><div class="db-snapshot-table-selector" ?hidden=${!p.selector.visible}>${selectorTemplate(
      p,
    )}</div><div class="db-snapshot-main-area"><div class="db-snapshot-split"><div
          class="db-snapshot-left-pane"
        >${keyed(p.left.seq, leftTemplate(p))}</div><div
          class="db-snapshot-right-pane"
          ${ref(p.refs.right)}
        >${
          p.diff === null
            ? nothing
            : keyed(
                p.diff.seq,
                html`<div class="db-snapshot-diff-inline">${diffTemplate(
                  p,
                  p.diff,
                )}</div>`,
              )
        }</div></div></div></div>`;
};

export function createSnapshotView(
  deps: SnapshotViewDeps,
  view: SnapshotViewView = DEFAULT_VIEW,
): SnapshotView {
  const text = (): DbText => deps.getText?.() ?? dbText("en");
  const trackLoad = <T>(p: Promise<T>): Promise<T> =>
    deps.trackLoad ? deps.trackLoad(p) : p;
  // 通信の失敗も 4xx / 5xx も、操作の名前を付けて投げる (以前は POST の
  // 応答を見ずに成功扱いにし、GET の失敗は決まり文句だけを出していた)。
  const requestOk = async (
    operation: string,
    request: Promise<Response>,
  ): Promise<Response> => {
    let response: Response;
    try {
      response = await trackLoad(request);
    } catch (error) {
      throw errorWithCause(operation, error);
    }
    await requireOkResponse(response, operation);
    return response;
  };
  const postJson = (
    path: string,
    body: unknown,
    operation: string,
  ): Promise<Response> =>
    requestOk(
      operation,
      fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify(body),
      }),
    );
  const getJson = (path: string, operation: string): Promise<Response> =>
    requestOk(operation, fetch(path));
  /** 失敗を console に出し、画面に出す `.db-snapshot-error` の中身を作る。 */
  const failureOf = (operation: string, error: unknown): Failure => ({
    operation,
    message: reportDatastoreFailure("SQL", operation, error),
  });
  const refs: SnapshotViewProps["refs"] = {
    filter: createRef(),
    note: createRef(),
    noteDialog: createRef(),
    right: createRef(),
    toc: createRef(),
  };

  let snapshots: SnapshotMeta[] = [];
  let currentDiff: { beforeId: string; afterId: string } | null = null;
  let disposed = false;
  const autoRefreshTimers = new Set<ReturnType<typeof setTimeout>>();

  // server から id を受け取った時点で running 状態のジョブを登録。
  // create / aborted / error の SSE で done=true にし、しばらく表示してから消す。
  const activeJobs = new Map<string, ActiveJob>();
  // 各ジョブ id に紐づく cancel-row の display state。row 単位で
  // 「キャンセル中」表示を維持するため。
  const cancellingJobs = new Set<string>();
  // 終端 SSE 受信後に row を消すまでの timer。job id 単位で管理し、
  // 同じ id に終端 SSE が再着するケースを冪等に扱う。
  const jobClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // テーブル選択 UI state: フィルタ文字列 + 選択中テーブル集合。
  // 表示は filter で絞り込まれた候補のみ、選択集合は filter 越しでも保持。
  let selectorVisible = false;
  let tableSelectorTables: DbTableInfo[] = [];
  const selectedTableSet = new Set<string>();
  let tableFilterValue = "";
  let creating = false;
  let selectorFailure: Failure | null = null;

  // 左の一覧。描き直す (renderMain) たびに seq を進め、欄を作り直す。
  let leftSeq = 0;
  let leftFailure: Failure | null = null;
  let diffBefore = "";
  let diffAfter = "";
  let diffBusy = false;
  let deleteArmed: string | null = null;
  let noteDialog: SnapshotViewProps["left"]["noteDialog"] = null;

  // 右の差分。
  let diffSeq = 0;
  let diffPane: DiffPane = null;
  let diffRows = new Map<string, DiffRowsState>();
  const hiddenTables = new Set<string>();
  let activeChip: string | null = null;
  let tocObserver: IntersectionObserver | null = null;

  function props(): SnapshotViewProps {
    return {
      text: text().snapshot,
      jobs: [...activeJobs.values()].map((job) => ({
        job,
        cancelling: cancellingJobs.has(job.id),
        onCancel: () => void cancelJob(job.id),
      })),
      selector: {
        visible: selectorVisible,
        tables: tableSelectorTables,
        selected: selectedTableSet,
        filter: tableFilterValue,
        creating,
        failure: selectorFailure,
      },
      left: {
        seq: leftSeq,
        snapshots,
        failure: leftFailure,
        diffBefore,
        diffAfter,
        diffBusy,
        deleteArmed,
        noteDialog,
      },
      diff: diffPane,
      diffRows,
      hiddenTables,
      activeChip,
      refs,
      onCreate: showTableSelector,
      onRefresh: () => void refresh(),
      onFilter: (value) => {
        tableFilterValue = value;
        draw();
      },
      onFilterKeydown: (e) => {
        if (e.key === "Escape" && tableFilterValue) {
          e.preventDefault();
          tableFilterValue = "";
          draw();
        }
      },
      onToggleTable: (name, checked) => {
        if (checked) selectedTableSet.add(name);
        else selectedTableSet.delete(name);
        draw();
        persistSelectedTables();
      },
      onSelectAll: () => {
        // フィルタ中は表示中のものだけを対象に。フィルタ無い時は全テーブル対象。
        for (const tbl of filteredTables()) selectedTableSet.add(tbl.name);
        draw();
        persistSelectedTables();
      },
      onDeselectAll: () => {
        if (!tableFilterValue.trim()) selectedTableSet.clear();
        else
          for (const tbl of filteredTables()) selectedTableSet.delete(tbl.name);
        draw();
        persistSelectedTables();
      },
      onConfirm: () => void createSnapshot(),
      onCancelSelector: () => {
        selectorVisible = false;
        draw();
      },
      onDiffBefore: (id) => {
        diffBefore = id;
        draw();
      },
      onDiffAfter: (id) => {
        diffAfter = id;
        draw();
      },
      onDiff: () => void runManualDiff(),
      onEditNote: (snap) => editNote(snap.id, snap.note),
      onDelete: (id) => {
        if (deleteArmed !== id) {
          deleteArmed = id;
          draw();
          window.setTimeout(() => {
            if (deleteArmed !== id) return;
            deleteArmed = null;
            draw();
          }, 3000);
          return;
        }
        deleteArmed = null;
        draw();
        void deleteSnap(id);
      },
      onSaveNote: () => void saveNote(),
      onCloseNote: closeNoteDialog,
      onNoteKeydown: (e) => {
        if (isImeComposing(e)) return;
        if (e.key === "Enter") void saveNote();
        if (e.key === "Escape") closeNoteDialog();
      },
      onToggleDiffTable: (name) => {
        if (hiddenTables.has(name)) hiddenTables.delete(name);
        else hiddenTables.add(name);
        draw();
      },
      onChip: (sectionId) => {
        const target = diffTableElement(sectionId);
        scrollTarget = target;
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    };
  }

  const box = detachedElement(() => view(props()));
  const draw = () => {
    if (!disposed) box.draw();
  };
  const rightPane = (): HTMLElement => {
    const pane = refs.right.value;
    if (!pane) throw new Error("snapshot view: the right pane was not drawn");
    return pane;
  };
  // 目次のクリックで寄せた先。行を読み終えたら、高さが変わった分を寄せ直す。
  let scrollTarget: HTMLElement | null = null;
  const diffTableElement = (sectionId: string): HTMLElement | null =>
    rightPane().querySelector<HTMLElement>(`#${CSS.escape(sectionId)}`);

  function filteredTables(): DbTableInfo[] {
    const needle = tableFilterValue.trim().toLowerCase();
    return tableSelectorTables.filter(
      (tbl) => !needle || tbl.name.toLowerCase().includes(needle),
    );
  }

  function upsertJob(id: string, patch: Partial<ActiveJob>): void {
    const prev = activeJobs.get(id) ?? { id, total: 0, done: false };
    activeJobs.set(id, { ...prev, ...patch, id });
    draw();
  }

  function scheduleJobRemove(id: string): void {
    const existing = jobClearTimers.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      jobClearTimers.delete(id);
      cancellingJobs.delete(id);
      activeJobs.delete(id);
      draw();
    }, 5000);
    jobClearTimers.set(id, timer);
  }

  async function cancelJob(id: string): Promise<void> {
    if (cancellingJobs.has(id)) return;
    cancellingJobs.add(id);
    draw();
    try {
      // 通れば SSE 側で aborted/error が届くまで row を維持する。
      await postJson(
        apiUrl("dbSnapshotCancel"),
        { id },
        text().failure.cancelSnapshot,
      );
    } catch (error) {
      // 取り消しが届いていないので SSE も来ない。「取り消し中」を外して理由を出す。
      cancellingJobs.delete(id);
      if (!disposed) leftFailure = failureOf("snapshot cancel", error);
      draw();
    }
  }

  function showTableSelector() {
    tableSelectorTables = deps.getTables().filter((t) => t.type === "table");
    // 現在の DB に存在するテーブル名集合。保存済み選択や直前 snapshot tables
    // にはスキーマ変更で消えた名前が残ることがあるので、必ずここで intersect
    // する。残しておくと「取得開始」で存在しないテーブルを POST し、サーバ
    // adapter が "no such table" で落ちる。
    const currentTableNames = new Set(tableSelectorTables.map((t) => t.name));
    // 復元優先度:
    //   (1) 永続保存された前回チェック内容 (deps.getStoredSelectedTables)
    //   (2) 直前 done snapshot の tables (getLastTables)
    //   (3) 全選択 default
    const stored = deps.getStoredSelectedTables?.();
    const rawTables = stored?.length ? stored : getLastTables();
    const lastTables = rawTables.filter((name) => currentTableNames.has(name));
    selectedTableSet.clear();
    if (lastTables.length === 0) {
      for (const t of tableSelectorTables) selectedTableSet.add(t.name);
    } else {
      for (const name of lastTables) selectedTableSet.add(name);
    }
    tableFilterValue = "";
    // dialog 表示中は toolbar の「取得」ボタンを disabled に。重複押下や
    // 「dialog を出したつもりが二重に開く」のような混乱を防ぐ。
    selectorVisible = true;
    draw();
    const note = refs.note.value;
    if (note) note.value = "";
    refs.filter.value?.focus();
  }

  function persistSelectedTables(): void {
    deps.setStoredSelectedTables?.(Array.from(selectedTableSet).sort());
  }

  function getLastTables(): string[] {
    const dbId = deps.getDbId();
    if (!dbId) return [];
    const done = snapshots.filter((s) => s.status === "done");
    return done.length > 0 ? done[0].tables : [];
  }

  async function createSnapshot(): Promise<void> {
    const dbId = deps.getDbId();
    const schema = deps.getSchema();
    if (!dbId) return;
    const tables = Array.from(selectedTableSet);
    if (tables.length === 0) return;
    creating = true;
    draw();
    try {
      await postJson(
        apiUrl("dbSnapshotCreate"),
        {
          db: dbId,
          ...(schema ? { schema } : {}),
          tables,
          note: refs.note.value?.value.trim() ?? "",
        },
        text().failure.createSnapshot,
      );
      selectorFailure = null;
      selectorVisible = false;
      scheduleAutoRefresh(dbId, schema);
    } catch (error) {
      // 選択欄は開いたままにして、押し直せるようにする。
      if (!disposed) selectorFailure = failureOf("snapshot create", error);
    } finally {
      creating = false;
      draw();
    }
  }

  function scheduleAutoRefresh(dbId: string, schema: string | null): void {
    const timer = setTimeout(() => {
      autoRefreshTimers.delete(timer);
      if (disposed || deps.getDbId() !== dbId || deps.getSchema() !== schema) {
        return;
      }
      void refreshAndAutoDiff();
    }, 3000);
    autoRefreshTimers.add(timer);
  }

  // refresh() の inflight 制御。tab 入場時の onClick / applySourceRouteToShell
  // / restoreDiffFromRoute からほぼ同時に複数回呼ばれることがあり、そのまま
  // 並走すると /_db/snapshot/list が二重発行され、SSE auto-refresh も合わせて
  // burst になる。inflight Promise を共有して直列化する。
  let inflightRefresh: Promise<void> | null = null;

  async function refresh() {
    if (inflightRefresh) {
      await inflightRefresh;
      return;
    }
    inflightRefresh = doRefresh();
    try {
      await inflightRefresh;
    } finally {
      inflightRefresh = null;
    }
  }

  function dropDiff(): void {
    tocObserver?.disconnect();
    tocObserver = null;
    diffPane = null;
  }

  async function doRefresh() {
    const dbId = deps.getDbId();
    const schema = deps.getSchema();
    if (!dbId) return;

    try {
      const params = new URLSearchParams({ db: dbId });
      if (schema) params.set("schema", schema);
      const snapRes = await getJson(
        `${apiUrl("dbSnapshotList")}?${params}`,
        text().failure.listSnapshots,
      );
      const data = (await snapRes.json()) as { snapshots: SnapshotMeta[] };
      if (disposed || deps.getDbId() !== dbId || deps.getSchema() !== schema) {
        return;
      }
      snapshots = data.snapshots;
      renderMain(false);
      // DB/schema 切替で currentDiff の指す snapshot が新しい一覧に存在しない
      // なら、右に残った旧 diff を破棄する (IntersectionObserver も disconnect)。
      if (currentDiff) {
        const stillValid =
          snapshots.some((s) => s.id === currentDiff?.beforeId) &&
          snapshots.some((s) => s.id === currentDiff?.afterId);
        if (!stillValid) {
          dropDiff();
          currentDiff = null;
        }
      }
      draw();
    } catch (error) {
      if (disposed || deps.getDbId() !== dbId || deps.getSchema() !== schema)
        return;
      // 前の一覧は残し (古いかもしれない)、先頭に読めなかった理由を出す。
      leftFailure = failureOf("snapshot list", error);
      draw();
    }
  }

  async function refreshAndAutoDiff() {
    await refresh();

    const done = snapshots.filter((s) => s.status === "done");
    if (done.length < 2) return;

    const newest = done[0];
    const prev = done[1];
    if (!arraysEqual(newest.tables, prev.tables)) return;

    void showDiffInline(prev.id, newest.id);
  }

  // 左の一覧を作り直す。keepSelection でなければ、比較の before/after を
  // 「1 つ前 / 最新」に戻す (前の版は一覧を作り直すたびに選び直していた)。
  function renderMain(keepSelection: boolean) {
    leftSeq++;
    leftFailure = null;
    deleteArmed = null;
    noteDialog = null;
    diffBusy = false;
    if (keepSelection) return;
    const sorted = snapshots
      .filter((s) => s.status === "done")
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    diffBefore = sorted[1]?.id ?? sorted[0]?.id ?? "";
    diffAfter = sorted[0]?.id ?? "";
  }

  async function runManualDiff(): Promise<void> {
    diffBusy = true;
    draw();
    try {
      await showDiffInline(diffBefore, diffAfter);
      scrollDiffIntoView();
    } finally {
      diffBusy = false;
      draw();
    }
  }

  function scrollDiffIntoView(): void {
    const section = refs.right.value?.querySelector<HTMLElement>(
      ".db-snapshot-diff-inline",
    );
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function showDiffInline(beforeId: string, afterId: string) {
    currentDiff = { beforeId, afterId };
    // URL に before/after を反映してリロード復元に備える。
    deps.setRouteDiff?.({ before: beforeId, after: afterId });
    dropDiff();
    const seq = ++diffSeq;
    diffPane = { seq, loading: true };
    draw();
    try {
      const res = await getJson(
        `${apiUrl("dbSnapshotDiffTables")}?before=${encodeURIComponent(beforeId)}&after=${encodeURIComponent(afterId)}`,
        text().snapshot.diffError,
      );
      const data = (await res.json()) as {
        tables: SnapshotDiffTableSummary[];
      };
      showDiffTables(beforeId, afterId, data.tables);
    } catch (error) {
      // 失敗時は currentDiff を巻き戻して restoreDiffFromRoute の重複防止
      // ガード (同じ before/after では再 fetch しない) が再試行を block しない
      // ようにする。URL は残しておくとリロードで再試行できる。
      currentDiff = null;
      if (diffPane?.seq === seq)
        diffPane = { seq, failure: failureOf("snapshot diff", error) };
      draw();
    }
  }

  function showDiffTables(
    beforeId: string,
    afterId: string,
    tables: SnapshotDiffTableSummary[],
  ) {
    dropDiff();
    diffPane = { seq: ++diffSeq, beforeId, afterId, tables };
    diffRows = new Map();
    hiddenTables.clear();
    activeChip = null;
    scrollTarget = null;
    const changed = changedTablesOf(tables);
    // 各 table の rows 読み込み Promise を集めて、全部完了したら scroll-target
    // を再寄せする (load 中に table 高さが増えて click 時の scroll target が
    // 下にズレる「中途半端な位置で止まる」問題への対策)。
    const pendingLoads: Promise<void>[] = [];
    for (const table of changed) {
      if (incomplete(table)) continue;
      diffRows.set(table.tableName, { loading: true });
      pendingLoads.push(loadDiffRows(beforeId, afterId, table.tableName));
    }
    draw();
    void Promise.allSettled(pendingLoads).then(() => {
      if (scrollTarget && refs.right.value?.contains(scrollTarget)) {
        scrollTarget.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    if (changed.length > 0) watchToc();
  }

  // 現在表示中の table を toc 上で active 化する。root = 右の欄 (実際の
  // スクロール container)。上端から少し下の位置で交差判定し、最初に当たった
  // ものを active として扱う。
  function watchToc(): void {
    const right = rightPane();
    const observer = new IntersectionObserver(
      (entries) => {
        // 一番上 (rootBounds 内で y が最小) の交差中 entry を active に。
        const intersecting = entries.filter((e) => e.isIntersecting);
        if (intersecting.length === 0) return;
        intersecting.sort(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
        );
        activeChip = intersecting[0].target.id;
        draw();
        // toc 内で active chip を可視範囲に寄せる。scrollIntoView を使うと
        // ブラウザによっては親 scroll container (右の欄) も縦方向に動かして
        // 直前の click scroll を打ち消す事故が起きる。toc 自体の scrollLeft
        // のみ手動で動かして、右の欄の縦 scroll には触らない。
        const toc = refs.toc.value;
        const chip = toc?.querySelector<HTMLElement>(
          `[data-target-id="${CSS.escape(activeChip)}"]`,
        );
        if (toc && chip) {
          const tocBox = toc.getBoundingClientRect();
          const chipBox = chip.getBoundingClientRect();
          const margin = 16;
          if (chipBox.left < tocBox.left + margin) {
            toc.scrollLeft += chipBox.left - tocBox.left - margin;
          } else if (chipBox.right > tocBox.right - margin) {
            toc.scrollLeft += chipBox.right - tocBox.right + margin;
          }
        }
      },
      {
        root: right,
        rootMargin: "-48px 0px -60% 0px",
        threshold: 0,
      },
    );
    for (const table of right.querySelectorAll(".db-snapshot-diff-table"))
      observer.observe(table);
    tocObserver = observer;
  }

  async function loadDiffRows(
    beforeId: string,
    afterId: string,
    table: string,
  ) {
    const rows = diffRows;
    try {
      const res = await getJson(
        `${apiUrl("dbSnapshotDiffRows")}?before=${encodeURIComponent(beforeId)}&after=${encodeURIComponent(afterId)}&table=${encodeURIComponent(table)}&limit=200`,
        text().snapshot.loadError,
      );
      const data = (await res.json()) as {
        rows: SnapshotDiffRow[];
        total: number;
      };
      if (rows !== diffRows) return;
      rows.set(table, { nodes: diffRowsNodes(data.rows, data.total) });
    } catch (error) {
      if (rows !== diffRows) return;
      rows.set(table, { failure: failureOf("snapshot diff rows", error) });
    }
    draw();
  }

  // 1 テーブル分の差分の表。列ヘッダと body を 2 つの <table> に分け、
  // scrollLeft + 列幅を JS で同期する (table-grid.ts の headerWrap+viewport と
  // 同じ形)。1 つの <table> で thead を position:sticky にすると、rows の箱を
  // overflow-x:auto にした瞬間 sticky の scroll container が横スクロール側へ
  // 吸われて縦 sticky が効かなくなり、長い差分でカラム名が画面外に消える。
  // 1 度だけ作り、描き直しでは作り直さない (同期の結び付けがあるため)。
  function diffRowsNodes(rows: SnapshotDiffRow[], total: number): Node[] {
    if (rows.length === 0) return [];
    const allCols = new Set<string>();
    for (const row of rows) {
      if (row.beforeValues)
        for (const k of Object.keys(row.beforeValues)) allCols.add(k);
      if (row.afterValues)
        for (const k of Object.keys(row.afterValues)) allCols.add(k);
    }
    const columns = [...allCols];
    const shown = (value: unknown) => (value == null ? "NULL" : String(value));
    const cols = () => columns.concat("").map(() => html`<col />`);
    const headerWrap = createRef<HTMLElement>();
    const headerCols = createRef<HTMLElement>();
    const viewport = createRef<HTMLElement>();
    const bodyTable = createRef<HTMLElement>();
    const bodyCols = createRef<HTMLElement>();
    const tbody = createRef<HTMLElement>();
    const rowTemplate = (
      cls: string,
      mark: string,
      cells: { value: string; changed: boolean }[],
    ) =>
      html`<tr class=${cls}><td class="snap-diff-type-cell">${mark}</td>${cells.map(
        (cell) =>
          html`<td class=${cell.changed ? "snap-diff-changed-cell" : nothing}
            >${cell.value}</td
          >`,
      )}</tr>`;
    const body = rows.map((row) => {
      if (row.changeType === "updated" && row.beforeValues && row.afterValues) {
        const before = row.beforeValues;
        const after = row.afterValues;
        const pairs = columns.map((col) => ({
          before: shown(before[col]),
          after: shown(after[col]),
        }));
        return html`${rowTemplate(
          "snap-diff-del snap-diff-record-start",
          "−",
          pairs.map((pair) => ({
            value: pair.before,
            changed: pair.before !== pair.after,
          })),
        )}${rowTemplate(
          "snap-diff-add snap-diff-record-end",
          "+",
          pairs.map((pair) => ({
            value: pair.after,
            changed: pair.before !== pair.after,
          })),
        )}`;
      }
      const sideClass =
        row.changeType === "inserted" ? "snap-diff-add" : "snap-diff-del";
      const values =
        row.changeType === "inserted" ? row.afterValues : row.beforeValues;
      return rowTemplate(
        `${sideClass} snap-diff-record-start snap-diff-record-end`,
        row.changeType === "inserted" ? "+" : "−",
        columns.map((col) => ({ value: shown(values?.[col]), changed: true })),
      );
    });
    const nodes = templateElements(
      html`<div class="db-snapshot-diff-col-header-wrap" ${ref(headerWrap)}><table
            class="db-snap-diff-grid"
          ><colgroup ${ref(headerCols)}>${cols()}</colgroup><thead><tr><th
                  class="snap-diff-type-cell"
                ></th>${columns.map((col) => html`<th>${col}</th>`)}</tr></thead
            ></table
          ></div
        ><div
          class="db-snapshot-diff-rows-viewport"
          ${ref(viewport)}
          @scroll=${() => {
            // 横スクロール時、body 側の scrollLeft を列ヘッダ側に伝搬。
            // col-header-wrap は overflow:hidden で scrollbar を出さない。
            const header = headerWrap.value;
            const rowsBox = viewport.value;
            if (header && rowsBox) header.scrollLeft = rowsBox.scrollLeft;
          }}
        ><table class="db-snap-diff-grid" ${ref(bodyTable)}><colgroup
              ${ref(bodyCols)}
            >${cols()}</colgroup
            ><tbody ${ref(tbody)}>${body}</tbody></table
          ></div
        >${
          total > rows.length
            ? html`<div class="db-snapshot-diff-more">${text().snapshot.showingRows(
                rows.length,
                total,
              )}</div>`
            : nothing
        }`,
    );
    // 列幅同期: body table の各セル実幅を測って、両 table の <col> width に反映。
    // border-collapse:separate + colgroup で 1px ズレなく列幅が揃う。
    const syncColumnWidths = () => {
      if (disposed) return;
      const firstRow = tbody.value?.querySelector("tr");
      if (!firstRow) return;
      const cells = firstRow.children;
      const bodyColEls = bodyCols.value?.children ?? [];
      const headerColEls = headerCols.value?.children ?? [];
      for (let i = 0; i < cells.length; i++) {
        const w = (cells[i] as HTMLElement).offsetWidth;
        const bodyCol = bodyColEls[i] as HTMLElement | undefined;
        const headerCol = headerColEls[i] as HTMLElement | undefined;
        if (bodyCol) bodyCol.style.width = `${w}px`;
        if (headerCol) headerCol.style.width = `${w}px`;
      }
    };
    requestAnimationFrame(syncColumnWidths);
    const table = bodyTable.value;
    if (!table) throw new Error("snapshot view: the diff table was not drawn");
    new ResizeObserver(syncColumnWidths).observe(table);
    return nodes;
  }

  function editNote(snapshotId: string, currentNote: string) {
    noteDialog = { snapshotId, note: currentNote || "" };
    draw();
    refs.noteDialog.value?.focus();
  }

  function closeNoteDialog(): void {
    noteDialog = null;
    draw();
  }

  async function saveNote(): Promise<void> {
    if (disposed || !noteDialog) return;
    const snapshotId = noteDialog.snapshotId;
    const note = refs.noteDialog.value?.value ?? noteDialog.note;
    try {
      await postJson(
        apiUrl("dbSnapshotUpdateNote"),
        { id: snapshotId, note },
        text().failure.updateSnapshotNote,
      );
    } catch (error) {
      // 入力欄は残し、書いたメモを失わずに押し直せるようにする。
      if (!disposed) {
        leftFailure = failureOf("snapshot note update", error);
        draw();
      }
      return;
    }
    if (disposed) return;
    noteDialog = null;
    draw();
    void refresh();
  }

  async function deleteSnap(snapshotId: string) {
    if (disposed) return;
    try {
      await postJson(
        apiUrl("dbSnapshotDelete"),
        { id: snapshotId },
        text().failure.deleteSnapshot,
      );
    } catch (error) {
      if (!disposed) {
        leftFailure = failureOf("snapshot delete", error);
        draw();
      }
      return;
    }
    if (disposed) return;
    void refresh();
  }

  function handleSse(data: string) {
    if (disposed) return;
    let parsed: {
      action: string;
      dbId?: string;
      schema?: string;
      id?: string | null;
      table?: string;
      done?: boolean;
      index?: number;
      total?: number;
      error?: string;
    };
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      // 壊れた 1 件だけを捨てて次のイベントを待つ。捨てたことと中身は残す。
      console.error("[code-viewer] snapshot event is not JSON", data, error);
      return;
    }
    const dbId = deps.getDbId();
    const schema = deps.getSchema();
    if (parsed.dbId && dbId && parsed.dbId !== dbId) return;
    if (parsed.schema && parsed.schema !== schema) return;
    const id = parsed.id ?? null;
    if (parsed.action === "started" && id) {
      upsertJob(id, {
        done: false,
        total: parsed.total ?? 0,
        index: 0,
      });
    }
    if (parsed.action === "progress" && id) {
      upsertJob(id, {
        table: parsed.table,
        index: parsed.index,
        total: parsed.total ?? 0,
        done: parsed.done === true,
      });
    }
    if (parsed.action === "created" && id) {
      upsertJob(id, { done: true });
      scheduleJobRemove(id);
      void refreshAndAutoDiff();
    }
    if (parsed.action === "aborted" && id) {
      upsertJob(id, { done: true, aborted: true });
      scheduleJobRemove(id);
      void refresh();
    }
    if (parsed.action === "error" && id) {
      upsertJob(id, {
        done: true,
        errorMessage: parsed.error || text().snapshot.failed,
      });
      scheduleJobRemove(id);
      void refresh();
    }
  }

  function dispose(): void {
    disposed = true;
    for (const timer of autoRefreshTimers) clearTimeout(timer);
    autoRefreshTimers.clear();
    for (const timer of jobClearTimers.values()) clearTimeout(timer);
    jobClearTimers.clear();
    activeJobs.clear();
    cancellingJobs.clear();
    tocObserver?.disconnect();
  }

  function localize(): void {
    // 一覧を作り直すが、比較の before/after の選び方は残す。差分を出して
    // いれば、今の言語で出し直す。
    renderMain(true);
    draw();
    if (diffPane !== null && currentDiff) {
      void showDiffInline(currentDiff.beforeId, currentDiff.afterId);
    }
  }

  // URL の ?diffBefore=&diffAfter= を見て、対応する diff を表示する。
  // snapshots がまだ無いタイミングで呼ばれることを考慮し、refresh() で
  // snapshots を取得してから showDiffInline する。
  async function restoreDiffFromRoute(): Promise<void> {
    const target = deps.getRouteDiff?.();
    if (!target?.before || !target.after) return;
    // 既に同じ diff を表示中なら何もしない (entry が重複して走るのを防ぐ)。
    if (
      currentDiff &&
      currentDiff.beforeId === target.before &&
      currentDiff.afterId === target.after
    ) {
      return;
    }
    if (snapshots.length === 0) {
      await refresh();
    }
    if (disposed) return;
    const hasBefore = snapshots.some((s) => s.id === target.before);
    const hasAfter = snapshots.some((s) => s.id === target.after);
    if (!hasBefore || !hasAfter) {
      // URL に古い id が残っているケース。クリアして無視。
      deps.setRouteDiff?.(null);
      return;
    }
    await showDiffInline(target.before, target.after);
  }

  return {
    el: box.element,
    refresh,
    handleSse,
    dispose,
    localize,
    restoreDiffFromRoute: () => {
      void restoreDiffFromRoute();
    },
  };
}
