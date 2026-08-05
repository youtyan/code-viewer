import type {
  DbTableInfo,
  SnapshotDiffRow,
  SnapshotDiffTableSummary,
  SnapshotMeta,
} from "../../core/database/types";
import { isImeComposing } from "../../core/keyboard";
import { type DbText, dbText } from "./i18n";

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

export function createSnapshotView(deps: SnapshotViewDeps): SnapshotView {
  const text = (): DbText => deps.getText?.() ?? dbText("en");
  const trackLoad = <T>(p: Promise<T>): Promise<T> =>
    deps.trackLoad ? deps.trackLoad(p) : p;
  const postJson = (path: string, body: unknown): Promise<Response> =>
    trackLoad(
      fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify(body),
      }),
    );
  const getJson = (path: string): Promise<Response> => trackLoad(fetch(path));
  const changeTypeLabel = (type: SnapshotDiffRow["changeType"]): string => {
    if (type === "inserted") return "+";
    return "−";
  };
  const snapshotLabel = (s: SnapshotMeta): string => {
    const date = new Date(s.createdAt).toLocaleString();
    const note = s.note ? ` — ${s.note}` : "";
    return text().snapshot.label(date, s.tables.length, note);
  };
  const el = document.createElement("div");
  el.className = "db-snapshot-view";

  const guide = document.createElement("div");
  guide.className = "db-snapshot-guide";
  const guideTitle = document.createElement("div");
  guideTitle.className = "db-snapshot-guide-title";
  guideTitle.textContent = text().snapshot.guideTitle;
  const guideBody = document.createElement("div");
  guideBody.className = "db-snapshot-guide-body";
  guideBody.textContent = text().snapshot.guideBody;
  guide.append(guideTitle, guideBody);

  const toolbar = document.createElement("div");
  toolbar.className = "db-snapshot-toolbar";

  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "db-snapshot-create-btn";
  createBtn.textContent = text().snapshot.create;

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "db-snapshot-refresh-btn";
  refreshBtn.textContent = text().snapshot.refresh;

  toolbar.append(createBtn, refreshBtn);

  // 取得中ジョブを表示する進捗エリア。`.db-global-search-progress` のスタイルを
  // 流用し、複数ジョブを縦に並べる。各行は table 名 / 進捗 / cancel ボタンを持つ。
  const progressArea = document.createElement("div");
  progressArea.className = "db-snapshot-progress-area";
  progressArea.hidden = true;

  const tableSelector = document.createElement("div");
  tableSelector.className = "db-snapshot-table-selector";
  tableSelector.hidden = true;

  // 「対象テーブル選択」ヘッダ。右側に「N / M tables selected」カウンタを置く。
  const tableSelectorHeader = document.createElement("div");
  tableSelectorHeader.className = "db-snapshot-table-selector-header";
  const tableSelectorHeaderLabel = document.createElement("span");
  tableSelectorHeaderLabel.textContent = text().snapshot.selectTablesHeader;
  const tableSelectorCounter = document.createElement("span");
  tableSelectorCounter.className = "db-snapshot-table-counter";
  tableSelectorHeader.append(tableSelectorHeaderLabel, tableSelectorCounter);

  // フィルタ入力 + clear ボタン (Esc でも clear)。
  const filterRow = document.createElement("div");
  filterRow.className = "db-snapshot-table-filter";
  const filterInput = document.createElement("input");
  filterInput.type = "search";
  filterInput.className = "db-snapshot-table-filter-input";
  filterInput.placeholder = text().snapshot.filterPlaceholder;
  filterRow.appendChild(filterInput);

  // 縦リスト本体。row 全体クリックでチェック ON/OFF (checkbox の keyboard 操作は壊さない)。
  const tableCheckboxes = document.createElement("div");
  tableCheckboxes.className = "db-snapshot-table-checkboxes";

  // 選択アクション (全選択 / 解除)。
  const selectActions = document.createElement("div");
  selectActions.className = "db-snapshot-select-actions";

  const selectAllBtn = document.createElement("button");
  selectAllBtn.type = "button";
  selectAllBtn.textContent = text().snapshot.selectAll;

  const deselectAllBtn = document.createElement("button");
  deselectAllBtn.type = "button";
  deselectAllBtn.textContent = text().snapshot.deselectAll;

  selectActions.append(selectAllBtn, deselectAllBtn);

  // メモ欄は独立 1 行 (full-width label + input)。ボタンと混ぜないことで
  // 「メモ入れる場所が狭い」問題を解消する。
  const noteRow = document.createElement("div");
  noteRow.className = "db-snapshot-note-row";
  const noteField = document.createElement("label");
  noteField.className = "db-snapshot-note-field";
  const noteLabel = document.createElement("span");
  noteLabel.className = "db-snapshot-note-label";
  noteLabel.textContent = text().snapshot.noteLabel;
  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.className = "db-snapshot-note-input";
  noteInput.placeholder = text().snapshot.notePlaceholder;
  noteField.append(noteLabel, noteInput);
  noteRow.appendChild(noteField);

  // 取得開始 / キャンセルを別行に。
  const actionRow = document.createElement("div");
  actionRow.className = "db-snapshot-action-row";
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "db-snapshot-confirm-btn";
  confirmBtn.textContent = text().snapshot.confirm;
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "db-snapshot-cancel-btn";
  cancelBtn.textContent = text().snapshot.cancel;
  actionRow.append(confirmBtn, cancelBtn);

  tableSelector.append(
    tableSelectorHeader,
    filterRow,
    tableCheckboxes,
    selectActions,
    noteRow,
    actionRow,
  );

  const mainArea = document.createElement("div");
  mainArea.className = "db-snapshot-main-area";

  // 左ペイン: diff 選択プルダウン(sticky) + 一覧
  // 右ペイン: diff 結果。これにより一覧が何百件あってもプルダウンは常時上部
  // に固定され、diff は左ペインの一覧スクロールとは独立してスクロールできる。
  const splitContainer = document.createElement("div");
  splitContainer.className = "db-snapshot-split";

  const leftPane = document.createElement("div");
  leftPane.className = "db-snapshot-left-pane";

  const rightPane = document.createElement("div");
  rightPane.className = "db-snapshot-right-pane";

  splitContainer.append(leftPane, rightPane);
  mainArea.appendChild(splitContainer);

  el.append(guide, toolbar, progressArea, tableSelector, mainArea);

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

  function upsertJob(id: string, patch: Partial<ActiveJob>): void {
    const prev = activeJobs.get(id) ?? { id, total: 0, done: false };
    activeJobs.set(id, { ...prev, ...patch, id });
    renderProgress();
  }

  function scheduleJobRemove(id: string): void {
    const existing = jobClearTimers.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      jobClearTimers.delete(id);
      cancellingJobs.delete(id);
      activeJobs.delete(id);
      renderProgress();
    }, 5000);
    jobClearTimers.set(id, t);
  }

  async function cancelJob(id: string): Promise<void> {
    if (cancellingJobs.has(id)) return;
    cancellingJobs.add(id);
    renderProgress();
    try {
      await postJson("/_db/snapshot/cancel", { id });
    } catch {
      // ignore: SSE 側で aborted/error が届くまで row を維持する
    }
  }

  function renderProgress(): void {
    progressArea.innerHTML = "";
    if (activeJobs.size === 0) {
      progressArea.hidden = true;
      return;
    }
    progressArea.hidden = false;
    const t = text().snapshot;
    for (const job of activeJobs.values()) {
      const row = document.createElement("div");
      row.className = "db-snapshot-progress-row";
      row.dataset.snapshotId = job.id;

      const label = document.createElement("span");
      label.className = "db-snapshot-progress-label";
      if (job.errorMessage) {
        label.textContent = `${t.errorPrefix}: ${job.errorMessage}`;
        label.title = job.errorMessage;
        row.classList.add("error");
      } else if (job.aborted) {
        label.textContent = t.aborted;
        row.classList.add("aborted");
      } else if (job.done) {
        label.textContent = t.statusDone;
        row.classList.add("done");
      } else if (job.total > 0 && job.table) {
        // 実際に進行中の table が確定している時だけ「Snapshotting X (i/total)」
        // を出す。`started` SSE 受信直後は total はあっても table がまだ無く、
        // ここで `progressLabel("", 0, total)` を呼ぶと i18n の三項分岐が
        // "Finalizing…" 側に倒れて、開始した瞬間に「仕上げ中」と表示される
        // フリッカが出る。
        label.textContent = t.progressLabel(
          job.table,
          job.index ?? 0,
          job.total,
        );
        row.classList.add("running");
      } else {
        label.textContent = t.creating;
        row.classList.add("running");
      }
      row.appendChild(label);

      if (!job.done) {
        const cancelRowBtn = document.createElement("button");
        cancelRowBtn.type = "button";
        cancelRowBtn.className = "db-snapshot-job-cancel-btn";
        if (cancellingJobs.has(job.id)) {
          cancelRowBtn.disabled = true;
          cancelRowBtn.textContent = t.cancelling;
        } else {
          cancelRowBtn.textContent = t.cancel;
          cancelRowBtn.addEventListener("click", () => {
            void cancelJob(job.id);
          });
        }
        row.appendChild(cancelRowBtn);
      }
      progressArea.appendChild(row);
    }
  }

  // テーブル選択 UI state: フィルタ文字列 + 選択中テーブル集合。
  // 表示は filterValue で絞り込まれた候補のみ、選択集合は filter 越しでも保持。
  let tableSelectorTables: DbTableInfo[] = [];
  const selectedTableSet = new Set<string>();
  let tableFilterValue = "";

  function setTableSelectorVisible(visible: boolean): void {
    tableSelector.hidden = !visible;
    // dialog 表示中は toolbar の「取得」ボタンを disabled に。重複押下や
    // 「dialog を出したつもりが二重に開く」のような混乱を防ぐ。
    createBtn.disabled = visible;
    createBtn.classList.toggle("is-active-dialog", visible);
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
    filterInput.value = "";
    renderTableList();
    setTableSelectorVisible(true);
    noteInput.value = "";
    filterInput.focus();
  }

  function persistSelectedTables(): void {
    deps.setStoredSelectedTables?.(Array.from(selectedTableSet).sort());
  }

  function renderTableList(): void {
    const needle = tableFilterValue.trim().toLowerCase();
    tableCheckboxes.innerHTML = "";
    const t = text().snapshot;
    let visible = 0;
    for (const tbl of tableSelectorTables) {
      if (needle && !tbl.name.toLowerCase().includes(needle)) continue;
      visible++;
      const row = document.createElement("label");
      row.className = "db-snapshot-table-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = tbl.name;
      cb.checked = selectedTableSet.has(tbl.name);
      cb.addEventListener("change", () => {
        if (cb.checked) selectedTableSet.add(tbl.name);
        else selectedTableSet.delete(tbl.name);
        updateSelectorState();
        persistSelectedTables();
      });
      const name = document.createElement("span");
      name.className = "db-snapshot-table-row-name";
      name.textContent = tbl.name;
      const count = document.createElement("span");
      count.className = "db-snapshot-table-row-count";
      count.textContent =
        tbl.rowCount != null ? t.rowCount(tbl.rowCount).trim() : "";
      row.append(cb, name, count);
      tableCheckboxes.appendChild(row);
    }
    if (visible === 0 && needle) {
      const empty = document.createElement("div");
      empty.className = "db-snapshot-table-row-empty";
      empty.textContent = t.empty;
      tableCheckboxes.appendChild(empty);
    }
    updateSelectorState();
  }

  function updateSelectorState(): void {
    // counter とボタン disable 状態のみ更新。永続化は実際に selection が
    // 変わるパス (checkbox change / select-all / deselect-all) で別途呼ぶ。
    // ここで毎回 persist を呼ぶと filter のキーストロークでも PATCH が飛んで
    // burst になる (renderTableList が input event ごとに走るため)。
    const t = text().snapshot;
    tableSelectorCounter.textContent = t.tableCounter(
      selectedTableSet.size,
      tableSelectorTables.length,
    );
    confirmBtn.disabled = selectedTableSet.size === 0;
  }

  function getLastTables(): string[] {
    const dbId = deps.getDbId();
    if (!dbId) return [];
    const done = snapshots.filter((s) => s.status === "done");
    return done.length > 0 ? done[0].tables : [];
  }

  function getSelectedTables(): string[] {
    return Array.from(selectedTableSet);
  }

  filterInput.addEventListener("input", () => {
    tableFilterValue = filterInput.value;
    renderTableList();
  });
  filterInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && filterInput.value) {
      e.preventDefault();
      filterInput.value = "";
      tableFilterValue = "";
      renderTableList();
    }
  });

  selectAllBtn.addEventListener("click", () => {
    // フィルタ中は表示中のものだけを対象に。フィルタ無い時は全テーブル対象。
    const needle = tableFilterValue.trim().toLowerCase();
    for (const tbl of tableSelectorTables) {
      if (needle && !tbl.name.toLowerCase().includes(needle)) continue;
      selectedTableSet.add(tbl.name);
    }
    renderTableList();
    persistSelectedTables();
  });

  deselectAllBtn.addEventListener("click", () => {
    const needle = tableFilterValue.trim().toLowerCase();
    if (!needle) {
      selectedTableSet.clear();
    } else {
      for (const tbl of tableSelectorTables) {
        if (tbl.name.toLowerCase().includes(needle)) {
          selectedTableSet.delete(tbl.name);
        }
      }
    }
    renderTableList();
    persistSelectedTables();
  });

  createBtn.addEventListener("click", showTableSelector);
  cancelBtn.addEventListener("click", () => {
    setTableSelectorVisible(false);
  });
  confirmBtn.addEventListener("click", async () => {
    const dbId = deps.getDbId();
    const schema = deps.getSchema();
    if (!dbId) return;
    const tables = getSelectedTables();
    if (tables.length === 0) return;

    confirmBtn.disabled = true;
    confirmBtn.textContent = text().snapshot.creating;

    try {
      await postJson("/_db/snapshot/create", {
        db: dbId,
        ...(schema ? { schema } : {}),
        tables,
        note: noteInput.value.trim(),
      });
      setTableSelectorVisible(false);
      scheduleAutoRefresh(dbId, schema);
    } catch {
      // ignore
    } finally {
      if (!disposed) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = text().snapshot.confirm;
      }
    }
  });

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

  refreshBtn.addEventListener("click", refresh);

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

  async function doRefresh() {
    const dbId = deps.getDbId();
    const schema = deps.getSchema();
    if (!dbId) return;

    try {
      const params = new URLSearchParams({ db: dbId });
      if (schema) params.set("schema", schema);
      const snapRes = await getJson(`/_db/snapshot/list?${params}`);
      if (snapRes.ok) {
        const data = (await snapRes.json()) as { snapshots: SnapshotMeta[] };
        if (
          disposed ||
          deps.getDbId() !== dbId ||
          deps.getSchema() !== schema
        ) {
          return;
        }
        snapshots = data.snapshots;
      }
      if (disposed || deps.getDbId() !== dbId || deps.getSchema() !== schema)
        return;
      renderMain();
      // DB/schema 切替で currentDiff の指す snapshot が新しい一覧に存在しない
      // なら、rightPane に残った旧 diff を破棄する (IntersectionObserver も
      // disconnect)。 leftPane のみ clear する renderMain() だけだと、旧 DB の
      // diff content が右に残り、observer が stale node を観察し続ける。
      if (currentDiff) {
        const stillValid =
          snapshots.some((s) => s.id === currentDiff?.beforeId) &&
          snapshots.some((s) => s.id === currentDiff?.afterId);
        if (!stillValid) {
          const existing = rightPane.querySelector(".db-snapshot-diff-inline");
          if (existing) {
            const prev = existing as HTMLElement & {
              __tocObserver?: IntersectionObserver;
            };
            prev.__tocObserver?.disconnect();
            existing.remove();
          }
          currentDiff = null;
        }
      }
    } catch {
      // ignore
    }
  }

  async function refreshAndAutoDiff() {
    await refresh();

    const done = snapshots.filter((s) => s.status === "done");
    if (done.length < 2) return;

    const newest = done[0];
    const prev = done[1];
    if (!arraysEqual(newest.tables, prev.tables)) return;

    showDiffInline(prev.id, newest.id);
  }

  function renderMain() {
    leftPane.innerHTML = "";

    const done = snapshots.filter((s) => s.status === "done");

    if (snapshots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "db-snapshot-empty";
      empty.textContent = text().snapshot.empty;
      leftPane.appendChild(empty);
      return;
    }

    // 左ペイン上部の sticky エリア: diff 選択プルダウン + ボタン
    // (一覧が何百件あろうとプルダウンに常時アクセスできる)
    const stickyHeader = document.createElement("div");
    stickyHeader.className = "db-snapshot-sticky-header";

    const snapshotSection = document.createElement("div");
    snapshotSection.className = "db-snapshot-list-section";

    const snapTitle = document.createElement("h3");
    snapTitle.className = "db-snapshot-section-title";
    // タイトル件数は全 snapshot を含めた件数を出す。done だけに絞ると
    // running / error の存在が見えなくなる。diff 選択肢は引き続き done のみ。
    snapTitle.textContent = text().snapshot.listTitle(snapshots.length);
    snapshotSection.appendChild(snapTitle);

    const t = text().snapshot;
    for (const snap of snapshots) {
      const item = document.createElement("div");
      item.className = "db-snapshot-item";
      item.dataset.snapshotId = snap.id;

      const info = document.createElement("div");
      info.className = "db-snapshot-info";
      const date = document.createElement("span");
      date.className = "db-snapshot-date";
      date.textContent = new Date(snap.createdAt).toLocaleString();

      const status = document.createElement("span");
      status.className = `db-snapshot-status ${snap.status}`;
      status.textContent =
        snap.status === "running"
          ? t.statusRunning
          : snap.status === "error"
            ? t.statusError
            : t.statusDone;

      const tables = document.createElement("span");
      tables.className = "db-snapshot-tables-count";
      tables.title = snap.tables.join(", ");
      tables.textContent = t.tableCount(snap.tables.length);
      info.append(date, status, tables);
      if (snap.note) {
        const note = document.createElement("span");
        note.className = "db-snapshot-note";
        note.textContent = snap.note;
        info.appendChild(note);
      }
      if (snap.status === "error" && snap.errorMessage) {
        const errMsg = document.createElement("span");
        errMsg.className = "db-snapshot-error-message";
        errMsg.textContent = `${t.errorPrefix}: ${snap.errorMessage}`;
        errMsg.title = snap.errorMessage;
        info.appendChild(errMsg);
      }

      const actions = document.createElement("div");
      actions.className = "db-snapshot-actions";
      const noteBtn = document.createElement("button");
      noteBtn.type = "button";
      noteBtn.textContent = text().snapshot.editNote;
      noteBtn.addEventListener("click", () => editNote(snap.id, snap.note));
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.textContent = text().snapshot.delete;
      deleteBtn.addEventListener("click", () => {
        if (deleteBtn.dataset.confirm !== "1") {
          deleteBtn.dataset.confirm = "1";
          deleteBtn.textContent = text().snapshot.deleteConfirm;
          window.setTimeout(() => {
            if (deleteBtn.dataset.confirm === "1") {
              deleteBtn.dataset.confirm = "";
              deleteBtn.textContent = text().snapshot.delete;
            }
          }, 3000);
          return;
        }
        deleteBtn.dataset.confirm = "";
        deleteBtn.textContent = text().snapshot.delete;
        deleteSnap(snap.id);
      });
      actions.append(noteBtn, deleteBtn);

      item.append(info, actions);
      snapshotSection.appendChild(item);
    }

    if (done.length >= 2) {
      const diffCreate = document.createElement("div");
      diffCreate.className = "db-snapshot-diff-create";

      const beforeSelect = document.createElement("select");
      beforeSelect.className = "db-snapshot-diff-select";
      const afterSelect = document.createElement("select");
      afterSelect.className = "db-snapshot-diff-select";

      // 新しい snapshot が上に来る並び順 (created_at desc)。
      // 大量に snapshot が溜まった時、最新を探すのにスクロールしないで済む。
      const sorted = [...done].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      for (const s of sorted) {
        const optB = document.createElement("option");
        optB.value = s.id;
        optB.textContent = snapshotLabel(s);
        beforeSelect.appendChild(optB);

        const optA = document.createElement("option");
        optA.value = s.id;
        optA.textContent = snapshotLabel(s);
        afterSelect.appendChild(optA);
      }
      if (sorted.length >= 2) {
        // before = 1 つ前 (index 1)、after = 最新 (index 0)。
        beforeSelect.selectedIndex = 1;
        afterSelect.selectedIndex = 0;
      }

      const diffBtn = document.createElement("button");
      diffBtn.type = "button";
      diffBtn.className = "db-snapshot-diff-btn";
      diffBtn.textContent = text().snapshot.diffManual;
      diffBtn.addEventListener("click", async () => {
        diffBtn.disabled = true;
        diffBtn.textContent = text().snapshot.comparing;
        try {
          await showDiffInline(beforeSelect.value, afterSelect.value);
          scrollDiffIntoView();
        } finally {
          diffBtn.disabled = false;
          diffBtn.textContent = text().snapshot.diffManual;
        }
      });

      // プルダウンで選択された before/after を一覧の対応行にハイライト表示する。
      // .is-before / .is-after クラスと badge を付け替える。
      const applyDiffSelectionHighlight = () => {
        const items =
          snapshotSection.querySelectorAll<HTMLElement>(".db-snapshot-item");
        const before = beforeSelect.value;
        const after = afterSelect.value;
        for (const it of items) {
          it.classList.remove("is-before", "is-after");
          const old = it.querySelector(".db-snapshot-compare-badge");
          if (old) old.remove();
        }
        for (const it of items) {
          const id = it.dataset.snapshotId ?? "";
          let label: string | null = null;
          if (id === before) {
            it.classList.add("is-before");
            label = t.compareBeforeBadge;
          } else if (id === after) {
            it.classList.add("is-after");
            label = t.compareAfterBadge;
          }
          if (label) {
            const badge = document.createElement("span");
            badge.className = "db-snapshot-compare-badge";
            badge.textContent = label;
            const info = it.querySelector(".db-snapshot-info");
            if (info) info.appendChild(badge);
          }
        }
      };
      beforeSelect.addEventListener("change", applyDiffSelectionHighlight);
      afterSelect.addEventListener("change", applyDiffSelectionHighlight);
      applyDiffSelectionHighlight();

      // 左ペインは横幅が狭いので、各プルダウンを「ラベル + select」の
      // 行構成にして縦に積む。ラベルは一覧 item の比較元/比較先 badge と
      // 同じ文言を使い、視覚的にハイライトと結びつける。
      const beforeRow = document.createElement("label");
      beforeRow.className = "db-snapshot-diff-row is-before";
      const beforeLabel = document.createElement("span");
      beforeLabel.className = "db-snapshot-diff-row-label";
      beforeLabel.textContent = t.compareBeforeBadge;
      beforeRow.append(beforeLabel, beforeSelect);

      const afterRow = document.createElement("label");
      afterRow.className = "db-snapshot-diff-row is-after";
      const afterLabel = document.createElement("span");
      afterLabel.className = "db-snapshot-diff-row-label";
      afterLabel.textContent = t.compareAfterBadge;
      afterRow.append(afterLabel, afterSelect);

      diffCreate.append(beforeRow, afterRow, diffBtn);
      stickyHeader.appendChild(diffCreate);
    }

    leftPane.append(stickyHeader, snapshotSection);
  }

  function scrollDiffIntoView(): void {
    const section = rightPane.querySelector<HTMLElement>(
      ".db-snapshot-diff-inline",
    );
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function showDiffInline(beforeId: string, afterId: string) {
    currentDiff = { beforeId, afterId };
    // URL に before/after を反映してリロード復元に備える。
    deps.setRouteDiff?.({ before: beforeId, after: afterId });
    const existing = rightPane.querySelector(".db-snapshot-diff-inline");
    if (existing) {
      const prev = existing as HTMLElement & {
        __tocObserver?: IntersectionObserver;
      };
      prev.__tocObserver?.disconnect();
      existing.remove();
    }

    const loading = document.createElement("div");
    loading.className = "db-snapshot-diff-inline";
    const loadingText = document.createElement("div");
    loadingText.className = "db-snapshot-loading";
    loadingText.textContent = text().snapshot.calculatingDiff;
    loading.appendChild(loadingText);
    rightPane.appendChild(loading);

    try {
      const res = await getJson(
        `/_db/snapshot/diff/tables?before=${encodeURIComponent(beforeId)}&after=${encodeURIComponent(afterId)}`,
      );
      if (!res.ok) {
        // 失敗時は currentDiff を巻き戻して restoreDiffFromRoute の重複防止
        // ガード (同じ before/after では再 fetch しない) が再試行を block しない
        // ようにする。URL は残しておくとリロードで再試行できる。
        currentDiff = null;
        loading.innerHTML = "";
        const error = document.createElement("div");
        error.className = "db-snapshot-error";
        error.textContent = text().snapshot.diffError;
        loading.appendChild(error);
        return;
      }
      const data = (await res.json()) as {
        tables: SnapshotDiffTableSummary[];
      };
      loading.remove();
      renderDiffInline(beforeId, afterId, data.tables);
    } catch {
      currentDiff = null;
      loading.innerHTML = "";
      const error = document.createElement("div");
      error.className = "db-snapshot-error";
      error.textContent = text().snapshot.diffError;
      loading.appendChild(error);
    }
  }

  function renderDiffInline(
    beforeId: string,
    afterId: string,
    tables: SnapshotDiffTableSummary[],
  ) {
    const existing = rightPane.querySelector(".db-snapshot-diff-inline");
    if (existing) {
      const prev = existing as HTMLElement & {
        __tocObserver?: IntersectionObserver;
      };
      prev.__tocObserver?.disconnect();
      existing.remove();
    }

    const section = document.createElement("div");
    section.className = "db-snapshot-diff-inline";

    // どの 2 件を比較しているかを diff セクション冒頭に明示する。
    // before/after の SnapshotMeta は読み込み済みの snapshots から逆引きする。
    const beforeMeta = snapshots.find((s) => s.id === beforeId);
    const afterMeta = snapshots.find((s) => s.id === afterId);
    if (beforeMeta && afterMeta) {
      const header = document.createElement("div");
      header.className = "db-snapshot-diff-header";
      const beforeLabel = new Date(beforeMeta.createdAt).toLocaleString();
      const afterLabel = new Date(afterMeta.createdAt).toLocaleString();
      header.textContent = text().snapshot.diffShowing(beforeLabel, afterLabel);
      section.appendChild(header);
    }

    // 差分セクションに出す対象:
    //   (1) 行差分が 1 件以上ある (coverage:"both" で +/~/- が立っている)
    //   (2) 片側 snapshot だけにあるテーブル (coverage:"before-only"/"after-only")
    //       — レコードが消えた/増えたのではなく「比較不能」と知らせるため。
    const changedTables = tables.filter(
      (t) =>
        t.insertedCount + t.updatedCount + t.deletedCount > 0 ||
        (t.coverage && t.coverage !== "both"),
    );
    const unchangedCount = tables.length - changedTables.length;

    const summary = document.createElement("div");
    summary.className = "db-snapshot-diff-summary";
    if (changedTables.length === 0) {
      summary.textContent = text().snapshot.noChanges;
      section.appendChild(summary);
      rightPane.appendChild(section);
      return;
    }
    summary.textContent = text().snapshot.diffSummary(
      changedTables.length,
      unchangedCount,
    );
    section.appendChild(summary);

    // 変更テーブルが多い時、上から下までスクロールしないと目的の table に
    // 辿り着けない。sticky な「目次」を出し、chip クリックで対応 section に
    // ジャンプできるようにする。IntersectionObserver で現在表示中の section
    // を active 化。
    const toc = document.createElement("div");
    toc.className = "db-snapshot-diff-toc";
    const tocChips = new Map<string, HTMLElement>();
    section.appendChild(toc);

    // git diff 風の色付きカウント span を組み立てるヘルパ。
    // +N: 緑 (add)、~N: 黄 (update)、-N: 赤 (delete)。
    function buildStatSpans(
      target: HTMLElement,
      inserted: number,
      updated: number,
      deleted: number,
    ): void {
      const make = (cls: string, prefix: string, n: number) => {
        if (n <= 0) return;
        const s = document.createElement("span");
        s.className = `db-snapshot-diff-stat ${cls}`;
        s.textContent = `${prefix}${n}`;
        target.appendChild(s);
      };
      make("add", "+", inserted);
      make("upd", "~", updated);
      make("del", "-", deleted);
    }

    // 1 テーブルぶんのカウント / 未取得 badge を target に詰める。
    // `coverage === "both"` または未指定なら git diff 風カウント、片側未取得
    // なら ニュートラル badge。テーブル header / toc chip の両方から呼ぶ。
    function renderCoverageOrStats(
      target: HTMLElement,
      summary: SnapshotDiffTableSummary,
    ): void {
      const tx = text().snapshot;
      if (summary.coverage === "before-only") {
        const lbl = document.createElement("span");
        lbl.className = "db-snapshot-diff-coverage-badge before-only";
        lbl.textContent = tx.coverageBeforeOnly;
        target.appendChild(lbl);
      } else if (summary.coverage === "after-only") {
        const lbl = document.createElement("span");
        lbl.className = "db-snapshot-diff-coverage-badge after-only";
        lbl.textContent = tx.coverageAfterOnly;
        target.appendChild(lbl);
      } else {
        buildStatSpans(
          target,
          summary.insertedCount,
          summary.updatedCount,
          summary.deletedCount,
        );
      }
    }

    // 各 table の rows 読み込み Promise を集めて、全部完了したら scroll-target
    // を再寄せする (load 中に table 高さが増えて click 時の scroll target が
    // 下にズレる「中途半端な位置で止まる」問題への対策)。
    const pendingLoads: Promise<void>[] = [];
    let scrollTarget: HTMLElement | null = null;

    for (const t of changedTables) {
      const tableEl = document.createElement("div");
      tableEl.className = "db-snapshot-diff-table";
      const sectionId = `diff-table-${t.tableName.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      tableEl.id = sectionId;
      // scroll の停止位置補正は CSS の `.db-snapshot-right-pane
      // { scroll-padding-top: 68px }` に一本化。target 側にも
      // scroll-margin-top を持たせると両方が加算されて「下に余白が広すぎる」
      // 状態 (= 中途半端に止まる) になる。

      const tableHeader = document.createElement("div");
      tableHeader.className = "db-snapshot-diff-table-header";

      const nameSpan = document.createElement("span");
      nameSpan.className = "db-snapshot-diff-table-name";
      nameSpan.textContent = t.tableName;

      const statsSpan = document.createElement("span");
      statsSpan.className = "db-snapshot-diff-table-stats";
      renderCoverageOrStats(statsSpan, t);

      tableHeader.append(nameSpan, statsSpan);
      tableHeader.style.cursor = "pointer";

      const rowsContainer = document.createElement("div");
      rowsContainer.className = "db-snapshot-diff-rows-container";

      if (t.coverage === "before-only" || t.coverage === "after-only") {
        // 片側未取得は比較不能。説明文だけ出し、loadDiffRows は呼ばない。
        const tx = text().snapshot;
        const note = document.createElement("div");
        note.className = "db-snapshot-diff-coverage-note";
        const rows = t.unsnapshottedRowCount ?? 0;
        note.textContent =
          t.coverage === "before-only"
            ? tx.coverageNoteBeforeOnly(rows)
            : tx.coverageNoteAfterOnly(rows);
        rowsContainer.appendChild(note);
      } else {
        pendingLoads.push(
          loadDiffRows(beforeId, afterId, t.tableName, rowsContainer),
        );
      }

      tableHeader.addEventListener("click", () => {
        rowsContainer.hidden = !rowsContainer.hidden;
      });

      tableEl.append(tableHeader, rowsContainer);
      section.appendChild(tableEl);

      // 目次 chip を作る
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "db-snapshot-diff-toc-chip";
      chip.dataset.targetId = sectionId;
      const chipName = document.createElement("span");
      chipName.className = "db-snapshot-diff-toc-chip-name";
      chipName.textContent = t.tableName;
      const chipStats = document.createElement("span");
      chipStats.className = "db-snapshot-diff-toc-chip-stats";
      renderCoverageOrStats(chipStats, t);
      if (t.coverage === "before-only" || t.coverage === "after-only") {
        chip.classList.add("coverage-incomplete");
      }
      chip.append(chipName, chipStats);
      chip.addEventListener("click", () => {
        scrollTarget = tableEl;
        tableEl.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      toc.appendChild(chip);
      tocChips.set(sectionId, chip);
    }

    // 全 rows 読み込み完了後、もし click 中の target があれば再寄せして
    // 「load で table 高さが変わって位置がズレた」分を補正する。
    void Promise.allSettled(pendingLoads).then(() => {
      if (scrollTarget && rightPane.contains(scrollTarget)) {
        scrollTarget.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    // 現在表示中の table を toc 上で active 化する。
    // root = rightPane (実際のスクロール container)。
    // 上端から少し下の位置 (rootMargin: top -10%) で交差判定し、最初に当た
    // ったものを active として扱う。
    const observer = new IntersectionObserver(
      (entries) => {
        // 一番上 (rootBounds 内で y が最小) の交差中 entry を active に。
        const intersecting = entries.filter((e) => e.isIntersecting);
        if (intersecting.length === 0) return;
        intersecting.sort(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
        );
        const activeId = intersecting[0].target.id;
        for (const [id, chip] of tocChips) {
          chip.classList.toggle("active", id === activeId);
        }
        const activeChip = tocChips.get(activeId);
        // toc 内で active chip を可視範囲に寄せる。scrollIntoView を使うと
        // ブラウザによっては親 scroll container (rightPane) も縦方向に動かして
        // 直前の click scroll を打ち消す事故が起きる。toc 自体の scrollLeft
        // のみ手動で動かして、rightPane の縦 scroll には触らない。
        if (activeChip) {
          const tocBox = toc.getBoundingClientRect();
          const chipBox = activeChip.getBoundingClientRect();
          const margin = 16;
          if (chipBox.left < tocBox.left + margin) {
            toc.scrollLeft += chipBox.left - tocBox.left - margin;
          } else if (chipBox.right > tocBox.right - margin) {
            toc.scrollLeft += chipBox.right - tocBox.right + margin;
          }
        }
      },
      {
        root: rightPane,
        rootMargin: "-48px 0px -60% 0px",
        threshold: 0,
      },
    );
    for (const el of section.querySelectorAll(".db-snapshot-diff-table")) {
      observer.observe(el);
    }
    // section が remove された時に observer を解放するため、後始末を section
    // に紐付けておく (dispose / 再描画時に呼ばれる)。
    (
      section as HTMLElement & { __tocObserver?: IntersectionObserver }
    ).__tocObserver = observer;

    rightPane.appendChild(section);
  }

  async function loadDiffRows(
    beforeId: string,
    afterId: string,
    table: string,
    container: HTMLElement,
  ) {
    container.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "db-snapshot-loading";
    loading.textContent = text().snapshot.loading;
    container.appendChild(loading);
    try {
      const res = await getJson(
        `/_db/snapshot/diff/rows?before=${encodeURIComponent(beforeId)}&after=${encodeURIComponent(afterId)}&table=${encodeURIComponent(table)}&limit=200`,
      );
      if (!res.ok) {
        container.innerHTML = "";
        const error = document.createElement("div");
        error.className = "db-snapshot-error";
        error.textContent = text().snapshot.loadError;
        container.appendChild(error);
        return;
      }
      const data = (await res.json()) as {
        rows: SnapshotDiffRow[];
        total: number;
      };
      renderDiffRows(container, data.rows, data.total);
    } catch {
      container.innerHTML = "";
      const error = document.createElement("div");
      error.className = "db-snapshot-error";
      error.textContent = text().snapshot.loadError;
      container.appendChild(error);
    }
  }

  function renderDiffRows(
    container: HTMLElement,
    rows: SnapshotDiffRow[],
    total: number,
  ) {
    container.innerHTML = "";
    if (rows.length === 0) return;

    const allCols = new Set<string>();
    for (const row of rows) {
      if (row.beforeValues)
        for (const k of Object.keys(row.beforeValues)) allCols.add(k);
      if (row.afterValues)
        for (const k of Object.keys(row.afterValues)) allCols.add(k);
    }
    const columns = [...allCols];

    // 列ヘッダと body を 2 つの <table> に分け、scrollLeft + 列幅を JS で同期する
    // 構造 (Codex 設計 / 既存 table-grid.ts の headerWrap+viewport パターンの reuse)。
    // 1 つの <table> で thead を position:sticky にする旧構造は、内部の
    // rows-container を overflow-x:auto にした瞬間 sticky の scroll container が
    // 横スクロール側へ吸われて縦 sticky が殺される / 長い差分でカラム名が画面外に
    // 消える、という構造的な破綻があった。
    const colHeaderWrap = document.createElement("div");
    colHeaderWrap.className = "db-snapshot-diff-col-header-wrap";
    const colHeaderTable = document.createElement("table");
    colHeaderTable.className = "db-snap-diff-grid";
    const colHeaderColgroup = document.createElement("colgroup");
    for (let i = 0; i < columns.length + 1; i++) {
      colHeaderColgroup.appendChild(document.createElement("col"));
    }
    colHeaderTable.appendChild(colHeaderColgroup);
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const thType = document.createElement("th");
    thType.className = "snap-diff-type-cell";
    thType.textContent = "";
    headRow.appendChild(thType);
    for (const col of columns) {
      const th = document.createElement("th");
      th.textContent = col;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    colHeaderTable.appendChild(thead);
    colHeaderWrap.appendChild(colHeaderTable);

    const rowsViewport = document.createElement("div");
    rowsViewport.className = "db-snapshot-diff-rows-viewport";
    const bodyTable = document.createElement("table");
    bodyTable.className = "db-snap-diff-grid";
    const bodyColgroup = document.createElement("colgroup");
    for (let i = 0; i < columns.length + 1; i++) {
      bodyColgroup.appendChild(document.createElement("col"));
    }
    bodyTable.appendChild(bodyColgroup);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      if (row.changeType === "updated" && row.beforeValues && row.afterValues) {
        const trBefore = document.createElement("tr");
        trBefore.className = "snap-diff-del snap-diff-record-start";
        const tdTypeBefore = document.createElement("td");
        tdTypeBefore.className = "snap-diff-type-cell";
        tdTypeBefore.textContent = "−";
        trBefore.appendChild(tdTypeBefore);
        for (const col of columns) {
          const td = document.createElement("td");
          const bs =
            row.beforeValues[col] == null
              ? "NULL"
              : String(row.beforeValues[col]);
          const as_ =
            row.afterValues[col] == null
              ? "NULL"
              : String(row.afterValues[col]);
          td.textContent = bs;
          if (bs !== as_) td.classList.add("snap-diff-changed-cell");
          trBefore.appendChild(td);
        }
        tbody.appendChild(trBefore);

        const trAfter = document.createElement("tr");
        trAfter.className = "snap-diff-add snap-diff-record-end";
        const tdTypeAfter = document.createElement("td");
        tdTypeAfter.className = "snap-diff-type-cell";
        tdTypeAfter.textContent = "+";
        trAfter.appendChild(tdTypeAfter);
        for (const col of columns) {
          const td = document.createElement("td");
          const bs =
            row.beforeValues[col] == null
              ? "NULL"
              : String(row.beforeValues[col]);
          const as_ =
            row.afterValues[col] == null
              ? "NULL"
              : String(row.afterValues[col]);
          td.textContent = as_;
          if (bs !== as_) td.classList.add("snap-diff-changed-cell");
          trAfter.appendChild(td);
        }
        tbody.appendChild(trAfter);
      } else {
        const tr = document.createElement("tr");
        const sideClass =
          row.changeType === "inserted" ? "snap-diff-add" : "snap-diff-del";
        tr.className = `${sideClass} snap-diff-record-start snap-diff-record-end`;
        const tdType = document.createElement("td");
        tdType.className = "snap-diff-type-cell";
        tdType.textContent = changeTypeLabel(row.changeType);
        tr.appendChild(tdType);
        const values =
          row.changeType === "inserted" ? row.afterValues : row.beforeValues;
        for (const col of columns) {
          const td = document.createElement("td");
          td.classList.add("snap-diff-changed-cell");
          const v = values?.[col];
          td.textContent = v == null ? "NULL" : String(v);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }
    bodyTable.appendChild(tbody);
    rowsViewport.appendChild(bodyTable);
    container.append(colHeaderWrap, rowsViewport);

    // 横スクロール時、body 側の scrollLeft を列ヘッダ側に伝搬。col-header-wrap は
    // overflow:hidden で scrollbar を出さず、JS で scrollLeft だけを書き換える。
    rowsViewport.addEventListener("scroll", () => {
      colHeaderWrap.scrollLeft = rowsViewport.scrollLeft;
    });

    // 列幅同期: body table の各セル実幅を測って、両 table の <col> width に反映。
    // border-collapse:separate + colgroup で 1px ズレなく列幅が揃う。
    const syncColumnWidths = () => {
      if (disposed) return;
      const firstRow = tbody.querySelector("tr");
      if (!firstRow) return;
      const cells = firstRow.children;
      const bodyCols = bodyColgroup.children;
      const headerCols = colHeaderColgroup.children;
      for (let i = 0; i < cells.length; i++) {
        const w = (cells[i] as HTMLElement).offsetWidth;
        if (bodyCols[i]) (bodyCols[i] as HTMLElement).style.width = `${w}px`;
        if (headerCols[i])
          (headerCols[i] as HTMLElement).style.width = `${w}px`;
      }
    };
    requestAnimationFrame(syncColumnWidths);
    const ro = new ResizeObserver(syncColumnWidths);
    ro.observe(bodyTable);

    if (total > rows.length) {
      const more = document.createElement("div");
      more.className = "db-snapshot-diff-more";
      more.textContent = text().snapshot.showingRows(rows.length, total);
      container.appendChild(more);
    }
  }

  async function editNote(snapshotId: string, currentNote: string) {
    const existing = el.querySelector(".db-snapshot-inline-dialog");
    if (existing) existing.remove();

    const dialog = document.createElement("div");
    dialog.className = "db-snapshot-inline-dialog";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "db-snapshot-note-input";
    input.value = currentNote || "";
    input.placeholder = text().snapshot.noteInputPlaceholder;
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = text().snapshot.saveNote;
    saveBtn.className = "db-snapshot-confirm-btn";
    const cancelDlgBtn = document.createElement("button");
    cancelDlgBtn.type = "button";
    cancelDlgBtn.textContent = text().snapshot.cancel;
    cancelDlgBtn.addEventListener("click", () => dialog.remove());
    saveBtn.addEventListener("click", async () => {
      if (disposed) return;
      await postJson("/_db/snapshot/update-note", {
        id: snapshotId,
        note: input.value,
      });
      if (disposed) return;
      dialog.remove();
      refresh();
    });
    input.addEventListener("keydown", (e) => {
      if (isImeComposing(e)) return;
      if (e.key === "Enter") saveBtn.click();
      if (e.key === "Escape") dialog.remove();
    });
    dialog.append(input, saveBtn, cancelDlgBtn);
    const item = Array.from(
      el.querySelectorAll<HTMLElement>(".db-snapshot-item"),
    ).find((node) => node.dataset.snapshotId === snapshotId);
    if (item) {
      item.after(dialog);
    } else {
      leftPane.prepend(dialog);
    }
    input.focus();
  }

  async function deleteSnap(snapshotId: string) {
    if (disposed) return;
    await postJson("/_db/snapshot/delete", { id: snapshotId });
    if (disposed) return;
    refresh();
  }

  function handleSse(data: string) {
    if (disposed) return;
    try {
      const parsed = JSON.parse(data) as {
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
    } catch {
      // ignore
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
    const existing = rightPane.querySelector(".db-snapshot-diff-inline");
    if (existing) {
      const prev = existing as HTMLElement & {
        __tocObserver?: IntersectionObserver;
      };
      prev.__tocObserver?.disconnect();
    }
  }

  function localize(): void {
    const t = text().snapshot;
    guideTitle.textContent = t.guideTitle;
    guideBody.textContent = t.guideBody;
    createBtn.textContent = t.create;
    refreshBtn.textContent = t.refresh;
    // 進捗 row は renderProgress() で再描画する。
    renderProgress();
    tableSelectorHeader.textContent = t.selectTablesHeader;
    selectAllBtn.textContent = t.selectAll;
    deselectAllBtn.textContent = t.deselectAll;
    noteInput.placeholder = t.notePlaceholder;
    noteLabel.textContent = t.noteLabel;
    // 取得中(confirmBtn.disabled で creating 表示中)は上書きしない。
    if (!confirmBtn.disabled) confirmBtn.textContent = t.confirm;
    cancelBtn.textContent = t.cancel;

    // renderMain() は leftPane を作り直すため、before/after の選択状態を退避して
    // 再構築後に復元する。diff は rightPane にあるので renderMain では消えない。
    const prevSelects = leftPane.querySelectorAll<HTMLSelectElement>(
      ".db-snapshot-diff-select",
    );
    const prevBeforeVal = prevSelects[0]?.value;
    const prevAfterVal = prevSelects[1]?.value;
    const hadDiff = rightPane.querySelector(".db-snapshot-diff-inline") != null;

    renderMain();

    const newSelects = leftPane.querySelectorAll<HTMLSelectElement>(
      ".db-snapshot-diff-select",
    );
    if (newSelects[0] && prevBeforeVal) {
      newSelects[0].value = prevBeforeVal;
      // .value= 代入では 'change' が発火しないので、ハイライト更新リスナを
      // 明示的に発火させる (これがないと一覧の比較元/比較先ハイライトが
      // 初期既定のままになって localize 後に diff と整合しなくなる)。
      newSelects[0].dispatchEvent(new Event("change"));
    }
    if (newSelects[1] && prevAfterVal) {
      newSelects[1].value = prevAfterVal;
      newSelects[1].dispatchEvent(new Event("change"));
    }
    if (hadDiff && currentDiff) {
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
    el,
    refresh,
    handleSse,
    dispose,
    localize,
    restoreDiffFromRoute: () => {
      void restoreDiffFromRoute();
    },
  };
}
