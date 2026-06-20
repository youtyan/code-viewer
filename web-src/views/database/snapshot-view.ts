import type {
  DbTableInfo,
  SnapshotDiffRow,
  SnapshotDiffTableSummary,
  SnapshotMeta,
} from "../../core/database/types";

export type SnapshotViewDeps = {
  getDbId: () => string | null;
  getTables: () => DbTableInfo[];
};

export type SnapshotView = {
  el: HTMLElement;
  refresh: () => void;
  handleSse: (data: string) => void;
};

function changeTypeLabel(type: SnapshotDiffRow["changeType"]): string {
  if (type === "inserted") return "追加";
  if (type === "updated") return "更新";
  return "削除";
}

function snapshotLabel(s: SnapshotMeta): string {
  const date = new Date(s.createdAt).toLocaleString();
  const note = s.note ? ` — ${s.note}` : "";
  return `${date} (${s.tables.length}テーブル)${note}`;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Code-Viewer-Action": "1",
    },
    body: JSON.stringify(body),
  });
}

export function createSnapshotView(deps: SnapshotViewDeps): SnapshotView {
  const el = document.createElement("div");
  el.className = "db-snapshot-view";

  const guide = document.createElement("div");
  guide.className = "db-snapshot-guide";
  guide.innerHTML =
    '<div class="db-snapshot-guide-title">スナップショット差分</div>' +
    '<div class="db-snapshot-guide-body">' +
    "① スナップショット取得 → ② アプリやテストでDB操作 → ③ もう一度取得すると自動で差分表示されます" +
    "</div>";

  const toolbar = document.createElement("div");
  toolbar.className = "db-snapshot-toolbar";

  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "db-snapshot-create-btn";
  createBtn.textContent = "スナップショット取得";

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "db-snapshot-refresh-btn";
  refreshBtn.textContent = "更新";

  toolbar.append(createBtn, refreshBtn);

  const tableSelector = document.createElement("div");
  tableSelector.className = "db-snapshot-table-selector";
  tableSelector.hidden = true;

  const tableSelectorHeader = document.createElement("div");
  tableSelectorHeader.className = "db-snapshot-table-selector-header";
  tableSelectorHeader.textContent = "対象テーブルを選択";

  const tableCheckboxes = document.createElement("div");
  tableCheckboxes.className = "db-snapshot-table-checkboxes";

  const selectActions = document.createElement("div");
  selectActions.className = "db-snapshot-select-actions";

  const selectAllBtn = document.createElement("button");
  selectAllBtn.type = "button";
  selectAllBtn.textContent = "すべて選択";

  const deselectAllBtn = document.createElement("button");
  deselectAllBtn.type = "button";
  deselectAllBtn.textContent = "選択解除";

  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.className = "db-snapshot-note-input";
  noteInput.placeholder = "例: ユーザー登録テスト前";

  const noteField = document.createElement("label");
  noteField.className = "db-snapshot-note-field";
  const noteLabel = document.createElement("span");
  noteLabel.className = "db-snapshot-note-label";
  noteLabel.textContent = "メモ";
  noteField.append(noteLabel, noteInput);

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "db-snapshot-confirm-btn";
  confirmBtn.textContent = "取得開始";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "db-snapshot-cancel-btn";
  cancelBtn.textContent = "キャンセル";

  selectActions.append(
    selectAllBtn,
    deselectAllBtn,
    noteField,
    confirmBtn,
    cancelBtn,
  );
  tableSelector.append(tableSelectorHeader, tableCheckboxes, selectActions);

  const mainArea = document.createElement("div");
  mainArea.className = "db-snapshot-main-area";

  el.append(guide, toolbar, tableSelector, mainArea);

  let snapshots: SnapshotMeta[] = [];

  function showTableSelector() {
    const tables = deps.getTables();
    const lastTables = getLastTables();
    tableCheckboxes.innerHTML = "";
    for (const t of tables) {
      if (t.type !== "table") continue;
      const label = document.createElement("label");
      label.className = "db-snapshot-table-label";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = lastTables.length === 0 || lastTables.includes(t.name);
      cb.value = t.name;
      const rowInfo = t.rowCount != null ? ` (${t.rowCount}件)` : "";
      label.append(cb, ` ${t.name}${rowInfo}`);
      tableCheckboxes.appendChild(label);
    }
    tableSelector.hidden = false;
    noteInput.value = "";
  }

  function getLastTables(): string[] {
    const dbId = deps.getDbId();
    if (!dbId) return [];
    const done = snapshots.filter((s) => s.status === "done");
    return done.length > 0 ? done[0].tables : [];
  }

  function getSelectedTables(): string[] {
    return Array.from(
      tableCheckboxes.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]:checked',
      ),
    ).map((cb) => cb.value);
  }

  selectAllBtn.addEventListener("click", () => {
    tableCheckboxes
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((cb) => {
        cb.checked = true;
      });
  });

  deselectAllBtn.addEventListener("click", () => {
    tableCheckboxes
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((cb) => {
        cb.checked = false;
      });
  });

  createBtn.addEventListener("click", showTableSelector);
  cancelBtn.addEventListener("click", () => {
    tableSelector.hidden = true;
  });

  confirmBtn.addEventListener("click", async () => {
    const dbId = deps.getDbId();
    if (!dbId) return;
    const tables = getSelectedTables();
    if (tables.length === 0) return;

    confirmBtn.disabled = true;
    confirmBtn.textContent = "取得中...";

    try {
      await postJson("/_db/snapshot/create", {
        db: dbId,
        tables,
        note: noteInput.value.trim(),
      });
      tableSelector.hidden = true;
      setTimeout(() => refreshAndAutoDiff(), 3000);
    } catch {
      // ignore
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "取得開始";
    }
  });

  refreshBtn.addEventListener("click", refresh);

  async function refresh() {
    const dbId = deps.getDbId();
    if (!dbId) return;

    try {
      const snapRes = await fetch(
        `/_db/snapshot/list?db=${encodeURIComponent(dbId)}`,
      );
      if (snapRes.ok) {
        const data = (await snapRes.json()) as { snapshots: SnapshotMeta[] };
        snapshots = data.snapshots;
      }
      renderMain();
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
    mainArea.innerHTML = "";

    const done = snapshots.filter((s) => s.status === "done");

    if (snapshots.length === 0) {
      mainArea.innerHTML =
        '<div class="db-snapshot-empty">まだスナップショットがありません。「スナップショット取得」で開始します。</div>';
      return;
    }

    const snapshotSection = document.createElement("div");
    snapshotSection.className = "db-snapshot-list-section";

    const snapTitle = document.createElement("h3");
    snapTitle.className = "db-snapshot-section-title";
    snapTitle.textContent = `スナップショット (${done.length}件)`;
    snapshotSection.appendChild(snapTitle);

    for (const snap of snapshots) {
      const item = document.createElement("div");
      item.className = "db-snapshot-item";

      const info = document.createElement("div");
      info.className = "db-snapshot-info";
      info.innerHTML =
        `<span class="db-snapshot-date">${new Date(snap.createdAt).toLocaleString()}</span>` +
        `<span class="db-snapshot-tables-count" title="${snap.tables.join(", ")}">${snap.tables.length}テーブル</span>` +
        (snap.note ? `<span class="db-snapshot-note">${snap.note}</span>` : "");

      const actions = document.createElement("div");
      actions.className = "db-snapshot-actions";
      const noteBtn = document.createElement("button");
      noteBtn.type = "button";
      noteBtn.textContent = "メモ";
      noteBtn.addEventListener("click", () => editNote(snap.id, snap.note));
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.textContent = "削除";
      deleteBtn.addEventListener("click", () => deleteSnap(snap.id));
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

      const sorted = [...done].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
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
        beforeSelect.selectedIndex = sorted.length - 2;
        afterSelect.selectedIndex = sorted.length - 1;
      }

      const diffBtn = document.createElement("button");
      diffBtn.type = "button";
      diffBtn.className = "db-snapshot-diff-btn";
      diffBtn.textContent = "手動で差分チェック";
      diffBtn.addEventListener("click", async () => {
        diffBtn.disabled = true;
        diffBtn.textContent = "比較中...";
        try {
          showDiffInline(beforeSelect.value, afterSelect.value);
        } finally {
          diffBtn.disabled = false;
          diffBtn.textContent = "手動で差分チェック";
        }
      });

      diffCreate.append(
        beforeSelect,
        document.createTextNode(" → "),
        afterSelect,
        diffBtn,
      );
      snapshotSection.appendChild(diffCreate);
    }

    mainArea.appendChild(snapshotSection);
  }

  async function showDiffInline(beforeId: string, afterId: string) {
    const existing = mainArea.querySelector(".db-snapshot-diff-inline");
    if (existing) existing.remove();

    const loading = document.createElement("div");
    loading.className = "db-snapshot-diff-inline";
    loading.innerHTML =
      '<div class="db-snapshot-loading">差分を計算中...</div>';
    mainArea.appendChild(loading);

    try {
      const res = await fetch(
        `/_db/snapshot/diff/tables?before=${encodeURIComponent(beforeId)}&after=${encodeURIComponent(afterId)}`,
      );
      if (!res.ok) {
        loading.innerHTML =
          '<div class="db-snapshot-error">差分の計算に失敗しました</div>';
        return;
      }
      const data = (await res.json()) as {
        tables: SnapshotDiffTableSummary[];
      };
      loading.remove();
      renderDiffInline(beforeId, afterId, data.tables);
    } catch {
      loading.innerHTML =
        '<div class="db-snapshot-error">差分の計算に失敗しました</div>';
    }
  }

  function renderDiffInline(
    beforeId: string,
    afterId: string,
    tables: SnapshotDiffTableSummary[],
  ) {
    const existing = mainArea.querySelector(".db-snapshot-diff-inline");
    if (existing) existing.remove();

    const section = document.createElement("div");
    section.className = "db-snapshot-diff-inline";

    const changedTables = tables.filter(
      (t) => t.insertedCount + t.updatedCount + t.deletedCount > 0,
    );
    const unchangedCount = tables.length - changedTables.length;

    const summary = document.createElement("div");
    summary.className = "db-snapshot-diff-summary";
    if (changedTables.length === 0) {
      summary.textContent = "変更は検出されませんでした。";
      section.appendChild(summary);
      mainArea.appendChild(section);
      return;
    }
    summary.textContent =
      `${changedTables.length}テーブルに変更あり` +
      (unchangedCount > 0 ? `、${unchangedCount}テーブルは変更なし` : "");
    section.appendChild(summary);

    for (const t of changedTables) {
      const tableEl = document.createElement("div");
      tableEl.className = "db-snapshot-diff-table";

      const tableHeader = document.createElement("div");
      tableHeader.className = "db-snapshot-diff-table-header";

      const nameSpan = document.createElement("span");
      nameSpan.className = "db-snapshot-diff-table-name";
      nameSpan.textContent = t.tableName;

      const statsSpan = document.createElement("span");
      statsSpan.className = "db-snapshot-diff-table-stats";
      const parts: string[] = [];
      if (t.insertedCount > 0) parts.push(`+${t.insertedCount}`);
      if (t.updatedCount > 0) parts.push(`~${t.updatedCount}`);
      if (t.deletedCount > 0) parts.push(`-${t.deletedCount}`);
      statsSpan.textContent = parts.join(" ");

      tableHeader.append(nameSpan, statsSpan);
      tableHeader.style.cursor = "pointer";

      const rowsContainer = document.createElement("div");
      rowsContainer.className = "db-snapshot-diff-rows-container";

      loadDiffRows(beforeId, afterId, t.tableName, rowsContainer);

      tableHeader.addEventListener("click", () => {
        rowsContainer.hidden = !rowsContainer.hidden;
      });

      tableEl.append(tableHeader, rowsContainer);
      section.appendChild(tableEl);
    }

    mainArea.appendChild(section);
  }

  async function loadDiffRows(
    beforeId: string,
    afterId: string,
    table: string,
    container: HTMLElement,
  ) {
    container.innerHTML =
      '<div class="db-snapshot-loading">読み込み中...</div>';
    try {
      const res = await fetch(
        `/_db/snapshot/diff/rows?before=${encodeURIComponent(beforeId)}&after=${encodeURIComponent(afterId)}&table=${encodeURIComponent(table)}&limit=200`,
      );
      if (!res.ok) {
        container.innerHTML =
          '<div class="db-snapshot-error">読み込みに失敗しました</div>';
        return;
      }
      const data = (await res.json()) as {
        rows: SnapshotDiffRow[];
        total: number;
      };
      renderDiffRows(container, data.rows, data.total);
    } catch {
      container.innerHTML =
        '<div class="db-snapshot-error">読み込みに失敗しました</div>';
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

    const table = document.createElement("table");
    table.className = "db-snap-diff-grid";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const thType = document.createElement("th");
    thType.textContent = "";
    headRow.appendChild(thType);
    for (const col of columns) {
      const th = document.createElement("th");
      th.textContent = col;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      if (row.changeType === "updated" && row.beforeValues && row.afterValues) {
        const trBefore = document.createElement("tr");
        trBefore.className = "snap-diff-del";
        const tdTypeBefore = document.createElement("td");
        tdTypeBefore.className = "snap-diff-type-cell";
        tdTypeBefore.textContent = "更新前";
        tdTypeBefore.rowSpan = 2;
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
        trAfter.className = "snap-diff-add";
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
        tr.className =
          row.changeType === "inserted" ? "snap-diff-add" : "snap-diff-del";
        const tdType = document.createElement("td");
        tdType.className = "snap-diff-type-cell";
        tdType.textContent = changeTypeLabel(row.changeType);
        tr.appendChild(tdType);
        const values =
          row.changeType === "inserted" ? row.afterValues : row.beforeValues;
        for (const col of columns) {
          const td = document.createElement("td");
          const v = values?.[col];
          td.textContent = v == null ? "NULL" : String(v);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }
    table.appendChild(tbody);
    container.appendChild(table);

    if (total > rows.length) {
      const more = document.createElement("div");
      more.className = "db-snapshot-diff-more";
      more.textContent = `全${total}件中 ${rows.length}件を表示中`;
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
    input.placeholder = "メモを入力";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "保存";
    saveBtn.className = "db-snapshot-confirm-btn";
    const cancelDlgBtn = document.createElement("button");
    cancelDlgBtn.type = "button";
    cancelDlgBtn.textContent = "キャンセル";
    cancelDlgBtn.addEventListener("click", () => dialog.remove());
    saveBtn.addEventListener("click", async () => {
      await postJson("/_db/snapshot/update-note", {
        id: snapshotId,
        note: input.value,
      });
      dialog.remove();
      refresh();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveBtn.click();
      if (e.key === "Escape") dialog.remove();
    });
    dialog.append(input, saveBtn, cancelDlgBtn);
    const item = el
      .querySelector(`.db-snapshot-item [title="${snapshotId}"]`)
      ?.closest(".db-snapshot-item");
    if (item) {
      item.after(dialog);
    } else {
      mainArea.prepend(dialog);
    }
    input.focus();
  }

  async function deleteSnap(snapshotId: string) {
    await postJson("/_db/snapshot/delete", { id: snapshotId });
    refresh();
  }

  function handleSse(data: string) {
    try {
      const parsed = JSON.parse(data) as { action: string };
      if (parsed.action === "created" || parsed.action === "error") {
        refreshAndAutoDiff();
      }
    } catch {
      // ignore
    }
  }

  return { el, refresh, handleSse };
}
