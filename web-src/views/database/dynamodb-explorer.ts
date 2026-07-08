import type {
  DynamoDbAttributeValue,
  DynamoDbExplorerSelection,
  DynamoDbItem,
  DynamoDbItemResponse,
  DynamoDbItemsResponse,
  DynamoDbKey,
  DynamoDbTableDescription,
  DynamoDbTableResponse,
  DynamoDbTablesResponse,
} from "../../core/database/types";
import { isImeComposing } from "../../core/keyboard";
import { createAbortGuard } from "./abort-guard";
import { type DbText, dbText } from "./i18n";
import { setPaneEmpty, setPaneStatus } from "./pane-status";

export type DynamoDbExplorerCallbacks = {
  onSelectionChange?: (selection: DynamoDbExplorerSelection) => void;
  getText?: () => DbText;
};

export type DynamoDbExplorerView = {
  el: HTMLElement;
  // Table リストを左サイドバー (db-sidebar) の dbToolbar 直下に mount するスロット。
  sidebarSlot: HTMLElement;
  load: (dbId: string, initial?: DynamoDbExplorerSelection) => Promise<void>;
  clear: () => void;
  dispose: () => void;
  getSelection: () => DynamoDbExplorerSelection;
  localize: () => void;
};

// DynamoDB の AttributeValue ({S: "x"} 等のラップ) を、人間が読める素の値に
// 展開する。表示専用 (書き込みには使わない)。
function unwrapAttributeValue(av: DynamoDbAttributeValue | undefined): unknown {
  if (!av) return undefined;
  if ("S" in av) return av.S;
  if ("N" in av) return av.N;
  if ("BOOL" in av) return av.BOOL;
  if ("NULL" in av) return null;
  if ("B" in av) return "(binary)";
  if ("SS" in av) return av.SS;
  if ("NS" in av) return av.NS;
  if ("BS" in av) return "(binary set)";
  if ("L" in av) return av.L.map(unwrapAttributeValue);
  if ("M" in av) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(av.M)) out[k] = unwrapAttributeValue(v);
    return out;
  }
  return undefined;
}

function unwrapItem(item: DynamoDbItem): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) out[k] = unwrapAttributeValue(v);
  return out;
}

// アイテム一覧の1行に出す要約テキスト。属性が多い/値が長いテーブルでも
// サイドバー幅で崩れないよう、先頭6属性・各値40文字で丸める。
function previewItem(item: DynamoDbItem): string {
  const entries = Object.entries(item).slice(0, 6);
  const parts = entries.map(([key, rawValue]) => {
    const value = unwrapAttributeValue(rawValue);
    const text =
      value !== null && typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
    return `${key}=${text.length > 40 ? `${text.slice(0, 40)}...` : text}`;
  });
  return parts.join(" / ");
}

// KeySchema が判明していればキー属性だけ、そうでなければアイテム全体を
// 選択識別トークンにする (KeySchema 未取得のタイミングでも一覧クリックが
// 機能するようにするためのフォールバック)。
function extractItemKey(
  item: DynamoDbItem,
  keySchema: DynamoDbTableDescription["KeySchema"] | undefined,
): DynamoDbKey {
  if (!keySchema || keySchema.length === 0) return item;
  const key: DynamoDbKey = {};
  for (const k of keySchema) {
    if (item[k.AttributeName] !== undefined)
      key[k.AttributeName] = item[k.AttributeName];
  }
  return Object.keys(key).length > 0 ? key : item;
}

// JSON.stringify の replacer 配列はネスト先まで含めた「全体で許可する
// キー名」のグローバルフィルタとして働くため、トップレベルのキー順だけ
// ソートしたいなら、AttributeValue のネスト値 (S/N/BOOL 等) を破棄しない
// よう新しいオブジェクトへ詰め替えてから stringify する。
function itemKeyToken(key: DynamoDbKey): string {
  const sorted: DynamoDbKey = {};
  for (const k of Object.keys(key).sort()) sorted[k] = key[k];
  return JSON.stringify(sorted);
}

function parseAttributeValuesJson(
  raw: string,
): Record<string, DynamoDbAttributeValue> | null {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, DynamoDbAttributeValue>;
  } catch {
    return null;
  }
}

export function createDynamoDbExplorer(
  callbacks: DynamoDbExplorerCallbacks = {},
): DynamoDbExplorerView {
  const text = (): DbText["explorer"] =>
    (callbacks.getText?.() ?? dbText("en")).explorer;

  const container = document.createElement("div");
  container.className = "dynamodb-explorer";

  // ----- sidebar slot: tables -----
  const sidebarSlot = document.createElement("div");
  sidebarSlot.className = "db-explorer-sidebar-slot dynamodb-table-list-pane";

  const tableListHeader = document.createElement("div");
  tableListHeader.className = "db-explorer-pane-header";
  tableListHeader.textContent = text().dynamodb.table;
  sidebarSlot.appendChild(tableListHeader);

  const tableList = document.createElement("div");
  tableList.className = "dynamodb-table-list";
  sidebarSlot.appendChild(tableList);

  // ----- pane: item list + query form -----
  const itemListPane = document.createElement("div");
  itemListPane.className = "dynamodb-item-list-pane";

  const modeSeg = document.createElement("div");
  modeSeg.className = "seg dynamodb-mode-seg";
  const scanModeBtn = document.createElement("button");
  scanModeBtn.type = "button";
  scanModeBtn.textContent = text().dynamodb.scanMode;
  const queryModeBtn = document.createElement("button");
  queryModeBtn.type = "button";
  queryModeBtn.textContent = text().dynamodb.queryMode;
  modeSeg.append(scanModeBtn, queryModeBtn);
  itemListPane.appendChild(modeSeg);

  const queryForm = document.createElement("form");
  queryForm.className = "dynamodb-query-form";
  const keyConditionInput = document.createElement("input");
  keyConditionInput.type = "text";
  keyConditionInput.className = "dynamodb-key-condition-input";
  keyConditionInput.placeholder = text().dynamodb.keyConditionPlaceholder;
  keyConditionInput.autocomplete = "off";
  keyConditionInput.hidden = true;
  const filterInput = document.createElement("input");
  filterInput.type = "text";
  filterInput.className = "dynamodb-filter-input";
  filterInput.placeholder = text().dynamodb.filterPlaceholder;
  filterInput.autocomplete = "off";
  const attributeValuesInput = document.createElement("textarea");
  attributeValuesInput.className = "dynamodb-attribute-values-input";
  attributeValuesInput.placeholder = text().dynamodb.attributeValuesPlaceholder;
  attributeValuesInput.rows = 2;
  const runBtn = document.createElement("button");
  runBtn.type = "submit";
  runBtn.className = "db-btn db-btn-primary dynamodb-run-btn";
  runBtn.textContent = text().dynamodb.runQuery;
  queryForm.append(
    keyConditionInput,
    filterInput,
    attributeValuesInput,
    runBtn,
  );
  itemListPane.appendChild(queryForm);
  const queryError = document.createElement("div");
  queryError.className = "dynamodb-query-error";
  queryError.hidden = true;
  itemListPane.appendChild(queryError);

  const itemStatus = document.createElement("div");
  itemStatus.className = "dynamodb-item-status";
  itemListPane.appendChild(itemStatus);

  const itemList = document.createElement("div");
  itemList.className = "dynamodb-item-list";
  itemListPane.appendChild(itemList);

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "dynamodb-item-more-btn";
  moreBtn.hidden = true;
  itemListPane.appendChild(moreBtn);

  // ----- pane: detail (table info + item) -----
  const detailPane = document.createElement("div");
  detailPane.className = "dynamodb-detail-pane";
  setPaneEmpty(detailPane, text().dynamodb.selectItem);

  container.append(itemListPane, detailPane);

  // ----- state -----
  let currentDbId: string | null = null;
  let currentTable: string | null = null;
  let currentMode: "scan" | "query" = "scan";
  let currentScanIndexForward = true;
  let currentTableInfo: DynamoDbTableDescription | null = null;
  let currentNextToken: DynamoDbKey | undefined;
  let currentItemKeyToken: string | null = null;
  // Load more は都度そのページ分だけを返すため、ステータス行 (shown/scanned)
  // は累積値を自前で足し込む (レスポンスの値をそのまま出すと直近ページだけの
  // 件数に見えてしまう)。
  let cumulativeShownCount = 0;
  let cumulativeScannedCount = 0;
  let disposed = false;
  let loadRunId = 0;
  let itemRunId = 0;
  let suppressNotify = false;
  let activeTableRow: HTMLElement | null = null;
  let activeItemRow: HTMLElement | null = null;
  const itemsByKeyToken = new Map<string, DynamoDbItem>();
  const itemRowsByKeyToken = new Map<string, HTMLElement>();
  const tableGuard = createAbortGuard();
  const tableInfoGuard = createAbortGuard();
  const itemsGuard = createAbortGuard();
  const itemGuard = createAbortGuard();

  function notifySelectionChange(): void {
    if (suppressNotify) return;
    callbacks.onSelectionChange?.(getSelection());
  }

  function setMode(mode: "scan" | "query"): void {
    currentMode = mode;
    scanModeBtn.classList.toggle("active", mode === "scan");
    queryModeBtn.classList.toggle("active", mode === "query");
    keyConditionInput.hidden = mode !== "query";
  }

  function renderTables(tableNames: string[]): void {
    tableList.innerHTML = "";
    activeTableRow = null;
    if (tableNames.length === 0) {
      setPaneStatus(tableList, text().dynamodb.noTables);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const name of tableNames) {
      const row = document.createElement("div");
      row.className = "dynamodb-table-item";
      row.dataset.tableName = name;
      row.textContent = name;
      row.title = name;
      fragment.appendChild(row);
    }
    tableList.appendChild(fragment);
  }

  function highlightActiveTable(name: string): void {
    if (activeTableRow?.dataset.tableName === name) return;
    activeTableRow?.classList.remove("active");
    activeTableRow =
      tableList.querySelector<HTMLElement>(
        `[data-table-name="${CSS.escape(name)}"]`,
      ) ?? null;
    activeTableRow?.classList.add("active");
  }

  function highlightActiveItem(token: string | null): void {
    if (activeItemRow && activeItemRow.dataset.keyToken === token) return;
    activeItemRow?.classList.remove("active");
    activeItemRow = token ? (itemRowsByKeyToken.get(token) ?? null) : null;
    activeItemRow?.classList.add("active");
  }

  function appendItems(items: DynamoDbItem[]): void {
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const key = extractItemKey(item, currentTableInfo?.KeySchema);
      const token = itemKeyToken(key);
      itemsByKeyToken.set(token, item);
      const row = document.createElement("div");
      row.className = "dynamodb-item-row";
      row.dataset.keyToken = token;
      itemRowsByKeyToken.set(token, row);
      const preview = document.createElement("span");
      preview.className = "dynamodb-item-preview";
      preview.textContent = previewItem(item);
      row.appendChild(preview);
      fragment.appendChild(row);
    }
    itemList.appendChild(fragment);
  }

  function renderTableInfo(): void {
    detailPane.innerHTML = "";
    if (!currentTableInfo) return;
    const header = document.createElement("div");
    header.className = "dynamodb-table-info-header";
    header.textContent = currentTableInfo.TableName ?? currentTable ?? "";
    const meta = document.createElement("div");
    meta.className = "dynamodb-table-info-meta";
    meta.textContent = [
      currentTableInfo.TableStatus,
      currentTableInfo.ItemCount !== undefined
        ? `${currentTableInfo.ItemCount.toLocaleString()} items`
        : undefined,
    ]
      .filter(Boolean)
      .join(" / ");
    detailPane.append(header, meta);
    const keySchema = currentTableInfo.KeySchema ?? [];
    if (keySchema.length > 0) {
      const keyList = document.createElement("div");
      keyList.className = "dynamodb-table-info-keys";
      keyList.textContent = keySchema
        .map((k) => `${k.AttributeName} (${k.KeyType})`)
        .join(", ");
      detailPane.appendChild(keyList);
    }
    const empty = document.createElement("div");
    empty.className = "db-pane-empty dynamodb-table-info-empty";
    const emptyTitle = document.createElement("div");
    emptyTitle.className = "db-pane-empty-title";
    emptyTitle.textContent = text().dynamodb.selectItem;
    empty.appendChild(emptyTitle);
    detailPane.appendChild(empty);
  }

  function renderItemDetail(item: DynamoDbItem): void {
    detailPane.innerHTML = "";
    const header = document.createElement("div");
    header.className = "dynamodb-item-detail-header";
    const title = document.createElement("span");
    title.textContent = currentTable ?? "";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "db-btn db-btn-sm";
    copyBtn.textContent = text().dynamodb.copyKey;
    copyBtn.addEventListener("click", async () => {
      try {
        const key = extractItemKey(item, currentTableInfo?.KeySchema);
        await navigator.clipboard.writeText(JSON.stringify(key));
        copyBtn.textContent = text().dynamodb.copied;
        window.setTimeout(() => {
          copyBtn.textContent = text().dynamodb.copyKey;
        }, 1200);
      } catch {
        copyBtn.textContent = text().dynamodb.copyFailed;
      }
    });
    header.append(title, copyBtn);
    detailPane.appendChild(header);
    const pre = document.createElement("pre");
    pre.className = "dynamodb-item-source";
    try {
      pre.textContent = JSON.stringify(unwrapItem(item), null, 2);
    } catch {
      pre.textContent = String(item);
    }
    detailPane.appendChild(pre);
  }

  // token 省略時は現在の currentTableInfo から計算し直す (GetItem 経由の
  // 復元選択など、DOM 行の token を持たない呼び出し用)。一覧クリックからは
  // DOM の data-key-token をそのまま渡し、計算タイミングのズレによる
  // ハイライト不整合を避ける。
  function selectItem(item: DynamoDbItem, token?: string): void {
    currentItemKeyToken =
      token ?? itemKeyToken(extractItemKey(item, currentTableInfo?.KeySchema));
    highlightActiveItem(currentItemKeyToken);
    renderItemDetail(item);
    notifySelectionChange();
  }

  async function loadItems(append: boolean): Promise<void> {
    if (!currentDbId || !currentTable || disposed) return;
    const keyConditionExpression = keyConditionInput.value.trim();
    const filterExpression = filterInput.value.trim();
    const attributeValues = parseAttributeValuesJson(
      attributeValuesInput.value,
    );
    queryError.hidden = true;
    // itemsGuard.start() より前に検証する。start() 後に return すると
    // slot.finish() が呼ばれないまま次の start() まで in-flight 扱いが残る。
    if (currentMode === "query" && !keyConditionExpression) {
      queryError.hidden = false;
      queryError.textContent = text().dynamodb.keyConditionPlaceholder;
      return;
    }
    if (attributeValues === null) {
      queryError.hidden = false;
      queryError.textContent = text().dynamodb.invalidAttributeValues;
      return;
    }
    const slot = itemsGuard.start();
    const requestRunId = loadRunId;
    const requestDbId = currentDbId;
    const requestTable = currentTable;
    const requestMode = currentMode;
    moreBtn.disabled = true;
    if (!append) {
      itemList.innerHTML = "";
      itemsByKeyToken.clear();
      itemRowsByKeyToken.clear();
      activeItemRow = null;
      currentItemKeyToken = null;
      currentNextToken = undefined;
      cumulativeShownCount = 0;
      cumulativeScannedCount = 0;
      setPaneStatus(itemList, "Loading items...");
      if (!currentTableInfo)
        setPaneEmpty(detailPane, text().dynamodb.selectItem);
    }
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        table: requestTable,
        mode: requestMode,
        limit: "200",
      });
      if (filterExpression) params.set("filterExpression", filterExpression);
      if (Object.keys(attributeValues).length > 0) {
        params.set(
          "expressionAttributeValues",
          JSON.stringify(attributeValues),
        );
      }
      if (requestMode === "query") {
        params.set("keyConditionExpression", keyConditionExpression);
        params.set("scanIndexForward", String(currentScanIndexForward));
      }
      if (append && currentNextToken) {
        params.set("exclusiveStartKey", JSON.stringify(currentNextToken));
      }
      const res = await fetch(`/_db/dynamodb/items?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      if (!res.ok) {
        const errText = await res.text();
        setPaneStatus(itemList, `Error: ${errText || res.statusText}`, {
          error: true,
        });
        return;
      }
      const data = (await res.json()) as DynamoDbItemsResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        requestDbId !== currentDbId ||
        requestTable !== currentTable ||
        requestMode !== currentMode
      ) {
        return;
      }
      if (!append) itemList.innerHTML = "";
      if (data.items.length === 0 && !append) {
        setPaneStatus(itemList, text().dynamodb.noItems);
      } else {
        appendItems(data.items);
      }
      currentNextToken = data.lastEvaluatedKey;
      moreBtn.hidden = !data.lastEvaluatedKey;
      cumulativeShownCount += data.items.length;
      cumulativeScannedCount += data.scannedCount;
      itemStatus.textContent = `${cumulativeShownCount.toLocaleString()} shown / ${cumulativeScannedCount.toLocaleString()} scanned`;
      highlightActiveItem(currentItemKeyToken);
    } catch (err) {
      if (slot.isStale()) return;
      setPaneStatus(
        itemList,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        { error: true },
      );
    } finally {
      slot.finish();
      if (!slot.isStale()) moreBtn.disabled = false;
    }
  }

  async function fetchTableInfo(table: string): Promise<void> {
    if (disposed || !currentDbId) return;
    const slot = tableInfoGuard.start();
    const requestDbId = currentDbId;
    try {
      const params = new URLSearchParams({ db: requestDbId, table });
      const res = await fetch(`/_db/dynamodb/table?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      if (!res.ok) return;
      const data = (await res.json()) as DynamoDbTableResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestDbId !== currentDbId ||
        currentTable !== table
      ) {
        return;
      }
      currentTableInfo = data.table;
      if (!currentItemKeyToken) renderTableInfo();
    } catch {
      // テーブル情報の取得失敗はアイテム一覧の妨げにしない (ベストエフォート)。
    } finally {
      slot.finish();
    }
  }

  async function selectItemByKey(key: DynamoDbKey): Promise<void> {
    if (disposed || !currentDbId || !currentTable) return;
    const slot = itemGuard.start();
    const requestRunId = ++itemRunId;
    const requestDbId = currentDbId;
    const requestTable = currentTable;
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        table: requestTable,
        key: JSON.stringify(key),
      });
      const res = await fetch(`/_db/dynamodb/item?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      if (!res.ok) return;
      const data = (await res.json()) as DynamoDbItemResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== itemRunId ||
        requestDbId !== currentDbId ||
        requestTable !== currentTable ||
        !data.item
      ) {
        return;
      }
      selectItem(data.item);
    } catch {
      // ベストエフォート: 初期選択の復元に失敗しても一覧表示は継続する。
    } finally {
      slot.finish();
    }
  }

  async function selectTable(name: string): Promise<void> {
    if (disposed || !currentDbId) return;
    currentTable = name;
    currentTableInfo = null;
    currentItemKeyToken = null;
    currentNextToken = undefined;
    highlightActiveTable(name);
    notifySelectionChange();
    setPaneEmpty(detailPane, text().dynamodb.selectItem);
    // appendItems() は KeySchema (currentTableInfo) の有無で item key token の
    // 計算結果が変わる。並行実行すると loadItems が先に終わったときだけ
    // KeySchema 無しの token になり、後からのクリック選択時の再計算結果と
    // 食い違ってハイライトが効かなくなるため、fetchTableInfo を先に確定させる。
    await fetchTableInfo(name);
    await loadItems(false);
  }

  scanModeBtn.addEventListener("click", () => {
    if (currentMode === "scan") return;
    setMode("scan");
    notifySelectionChange();
    void loadItems(false);
  });
  queryModeBtn.addEventListener("click", () => {
    if (currentMode === "query") return;
    setMode("query");
    notifySelectionChange();
  });
  queryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    notifySelectionChange();
    void loadItems(false);
  });
  for (const input of [keyConditionInput, filterInput]) {
    input.addEventListener("keydown", (e) => {
      if (isImeComposing(e)) return;
    });
  }
  moreBtn.addEventListener("click", () => loadItems(true));
  tableList.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".dynamodb-table-item",
    );
    if (!row || !tableList.contains(row)) return;
    const name = row.dataset.tableName;
    if (name) void selectTable(name);
  });
  itemList.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".dynamodb-item-row",
    );
    if (!row || !itemList.contains(row)) return;
    const token = row.dataset.keyToken;
    if (!token) return;
    const item = itemsByKeyToken.get(token);
    if (item) selectItem(item, token);
  });

  async function load(
    dbId: string,
    initial?: DynamoDbExplorerSelection,
  ): Promise<void> {
    if (disposed) return;
    if (currentDbId === dbId && !initial) return;
    tableGuard.dispose();
    tableInfoGuard.dispose();
    itemsGuard.dispose();
    itemGuard.dispose();
    const slot = tableGuard.start();
    const requestRunId = ++loadRunId;
    currentDbId = dbId;
    currentTable = null;
    currentTableInfo = null;
    currentItemKeyToken = null;
    currentNextToken = undefined;
    setMode(initial?.mode === "query" ? "query" : "scan");
    currentScanIndexForward = initial?.scanIndexForward ?? true;
    keyConditionInput.value = initial?.keyConditionExpression ?? "";
    filterInput.value = initial?.filterExpression ?? "";
    attributeValuesInput.value = initial?.expressionAttributeValues ?? "";
    queryError.hidden = true;
    itemStatus.textContent = "";
    itemList.innerHTML = "";
    itemsByKeyToken.clear();
    itemRowsByKeyToken.clear();
    activeItemRow = null;
    moreBtn.hidden = true;
    setPaneEmpty(detailPane, text().dynamodb.selectItem);
    setPaneStatus(tableList, "Loading tables...");
    try {
      const res = await fetch(
        `/_db/dynamodb/tables?db=${encodeURIComponent(dbId)}`,
        { signal: slot.signal },
      );
      if (disposed || slot.isStale()) return;
      if (!res.ok) {
        const errText = await res.text();
        setPaneStatus(tableList, `Error: ${errText || res.statusText}`, {
          error: true,
        });
        return;
      }
      const data = (await res.json()) as DynamoDbTablesResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        currentDbId !== dbId
      ) {
        return;
      }
      renderTables(data.tableNames);
      const selected =
        (initial?.table &&
          data.tableNames.includes(initial.table) &&
          initial.table) ||
        data.tableNames[0] ||
        null;
      if (!selected) return;
      suppressNotify = true;
      try {
        await selectTable(selected);
        if (currentDbId !== dbId) return;
        if (initial?.itemKey) {
          try {
            const key = JSON.parse(initial.itemKey) as DynamoDbKey;
            await selectItemByKey(key);
          } catch {
            // 保存済み itemKey が壊れていても致命的ではないので無視する。
          }
        }
      } finally {
        suppressNotify = false;
      }
      notifySelectionChange();
    } catch (err) {
      if (slot.isStale()) return;
      setPaneStatus(
        tableList,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        { error: true },
      );
    } finally {
      slot.finish();
    }
  }

  function clear(): void {
    tableGuard.dispose();
    tableInfoGuard.dispose();
    itemsGuard.dispose();
    itemGuard.dispose();
    loadRunId++;
    itemRunId++;
    suppressNotify = false;
    currentDbId = null;
    currentTable = null;
    currentTableInfo = null;
    currentItemKeyToken = null;
    currentNextToken = undefined;
    cumulativeShownCount = 0;
    cumulativeScannedCount = 0;
    setMode("scan");
    keyConditionInput.value = "";
    filterInput.value = "";
    attributeValuesInput.value = "";
    queryError.hidden = true;
    tableList.innerHTML = "";
    activeTableRow = null;
    itemStatus.textContent = "";
    itemList.innerHTML = "";
    itemsByKeyToken.clear();
    itemRowsByKeyToken.clear();
    activeItemRow = null;
    moreBtn.hidden = true;
    setPaneEmpty(detailPane, text().dynamodb.selectItem);
  }

  setMode("scan");

  function getSelection(): DynamoDbExplorerSelection {
    return {
      table: currentTable ?? undefined,
      mode: currentMode,
      keyConditionExpression: keyConditionInput.value.trim() || undefined,
      filterExpression: filterInput.value.trim() || undefined,
      expressionAttributeValues: attributeValuesInput.value.trim() || undefined,
      scanIndexForward:
        currentMode === "query" ? currentScanIndexForward : undefined,
      itemKey: currentItemKeyToken ?? undefined,
    };
  }

  function dispose(): void {
    disposed = true;
    clear();
  }

  function localize(): void {
    const t = text();
    tableListHeader.textContent = t.dynamodb.table;
    scanModeBtn.textContent = t.dynamodb.scanMode;
    queryModeBtn.textContent = t.dynamodb.queryMode;
    keyConditionInput.placeholder = t.dynamodb.keyConditionPlaceholder;
    filterInput.placeholder = t.dynamodb.filterPlaceholder;
    attributeValuesInput.placeholder = t.dynamodb.attributeValuesPlaceholder;
    runBtn.textContent = t.dynamodb.runQuery;
    moreBtn.textContent = t.common.loadMore;
    if (!activeItemRow) {
      if (currentTableInfo) renderTableInfo();
      else setPaneEmpty(detailPane, t.dynamodb.selectItem);
    }
  }

  return {
    el: container,
    sidebarSlot,
    load,
    clear,
    dispose,
    getSelection,
    localize,
  };
}
