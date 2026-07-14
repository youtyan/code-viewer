import type {
  DynamoDbAttributeValue,
  DynamoDbExplorerSelection,
  DynamoDbItem,
  DynamoDbItemResponse,
  DynamoDbItemsResponse,
  DynamoDbKey,
  DynamoDbSecondaryIndexDescription,
  DynamoDbTableDescription,
  DynamoDbTableResponse,
  DynamoDbTablesResponse,
} from "../../core/database/types";
import { isImeComposing } from "../../core/keyboard";
import { formatBytes } from "../../core/source-meta";
import { createAbortGuard } from "./abort-guard";
import { type DbText, dbText } from "./i18n";
import { setPaneEmpty, setPaneStatus } from "./pane-status";

export type DynamoDbExplorerCallbacks = {
  onSelectionChange?: (selection: DynamoDbExplorerSelection) => void;
  getText?: () => DbText;
  trackLoad?: <T>(promise: Promise<T>) => Promise<T>;
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

const ATTRIBUTE_VALUE_TAG_ORDER = [
  "S",
  "N",
  "B",
  "BOOL",
  "NULL",
  "M",
  "L",
  "SS",
  "NS",
  "BS",
] as const;

// AttributeValue ({S: "x"} 等) が実際にどの DynamoDB 型かを1文字/略号タグで返す。
// AttributeDefinitions はキー属性しか記述しないため、非キー属性の型はロード済み
// アイテムから実際の値を見て推測するしかない (DynamoDB はスキーマレス)。
function attributeValueTag(av: DynamoDbAttributeValue): string {
  for (const tag of ATTRIBUTE_VALUE_TAG_ORDER) {
    if (tag in av) return tag;
  }
  return "?";
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
  const trackLoad = <T>(promise: Promise<T>): Promise<T> =>
    callbacks.trackLoad ? callbacks.trackLoad(promise) : promise;

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

  const tableMoreBtn = document.createElement("button");
  tableMoreBtn.type = "button";
  tableMoreBtn.className = "dynamodb-item-more-btn dynamodb-table-more-btn";
  tableMoreBtn.textContent = text().common.loadMore;
  tableMoreBtn.hidden = true;
  sidebarSlot.appendChild(tableMoreBtn);

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
  moreBtn.textContent = text().common.loadMore;
  moreBtn.hidden = true;
  itemListPane.appendChild(moreBtn);

  // ----- pane: detail (structure + item), es-explorer の mapping/doc タブと同じ構成 -----
  const detailPane = document.createElement("div");
  detailPane.className = "dynamodb-detail-pane";

  const detailTabs = document.createElement("div");
  detailTabs.className = "dynamodb-detail-tabs";
  const structureTabBtn = document.createElement("button");
  structureTabBtn.type = "button";
  structureTabBtn.className = "dynamodb-detail-tab active";
  structureTabBtn.textContent = text().dynamodb.structureTab;
  const itemTabBtn = document.createElement("button");
  itemTabBtn.type = "button";
  itemTabBtn.className = "dynamodb-detail-tab";
  itemTabBtn.textContent = text().dynamodb.itemTab;
  detailTabs.append(structureTabBtn, itemTabBtn);
  detailPane.appendChild(detailTabs);

  const structureBody = document.createElement("div");
  structureBody.className = "dynamodb-structure-body";
  setPaneEmpty(structureBody, text().dynamodb.selectTable);
  const itemBody = document.createElement("div");
  itemBody.className = "dynamodb-item-body";
  itemBody.hidden = true;
  setPaneEmpty(itemBody, text().dynamodb.selectItem);
  detailPane.append(structureBody, itemBody);

  container.append(itemListPane, detailPane);

  // ----- state -----
  let currentDbId: string | null = null;
  let currentTable: string | null = null;
  let currentMode: "scan" | "query" = "scan";
  let currentScanIndexForward = true;
  let currentTableInfo: DynamoDbTableDescription | null = null;
  let currentTableNextToken: string | undefined;
  let currentNextToken: DynamoDbKey | undefined;
  let currentItemKeyToken: string | null = null;
  // Load more は都度そのページ分だけを返すため、ステータス行 (shown/scanned)
  // は累積値を自前で足し込む (レスポンスの値をそのまま出すと直近ページだけの
  // 件数に見えてしまう)。
  let cumulativeShownCount = 0;
  let cumulativeScannedCount = 0;
  let detailTab: "structure" | "item" = "structure";
  // 言語ライブ切替時に描画済みのアイテム内容を再ローカライズするための保持。
  let lastRenderedItem: DynamoDbItem | null = null;
  let disposed = false;
  let loadRunId = 0;
  let itemRunId = 0;
  let suppressNotify = false;
  let activeTableRow: HTMLElement | null = null;
  let activeItemRow: HTMLElement | null = null;
  const itemsByKeyToken = new Map<string, DynamoDbItem>();
  const itemRowsByKeyToken = new Map<string, HTMLElement>();
  const tableGuard = createAbortGuard();
  const tablePageGuard = createAbortGuard();
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

  function setDetailTab(tab: "structure" | "item"): void {
    detailTab = tab;
    structureTabBtn.classList.toggle("active", tab === "structure");
    itemTabBtn.classList.toggle("active", tab === "item");
    structureBody.hidden = tab !== "structure";
    itemBody.hidden = tab !== "item";
  }
  structureTabBtn.addEventListener("click", () => {
    setDetailTab("structure");
    notifySelectionChange();
  });
  itemTabBtn.addEventListener("click", () => {
    setDetailTab("item");
    notifySelectionChange();
  });

  function renderTables(tableNames: string[], append = false): void {
    if (!append) {
      tableList.innerHTML = "";
      activeTableRow = null;
    }
    if (tableNames.length === 0 && !append) {
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

  function projectionText(
    projection: DynamoDbSecondaryIndexDescription["Projection"],
  ): string {
    const t = text().dynamodb;
    if (!projection?.ProjectionType) return "";
    if (projection.ProjectionType === "ALL") return t.projectionAll;
    if (projection.ProjectionType === "KEYS_ONLY") return t.projectionKeysOnly;
    return t.projectionInclude((projection.NonKeyAttributes ?? []).join(", "));
  }

  function renderSecondaryIndexes(
    label: string,
    indexes: DynamoDbSecondaryIndexDescription[] | undefined,
  ): void {
    if (!indexes || indexes.length === 0) return;
    const section = document.createElement("div");
    section.className = "dynamodb-index-section";
    const heading = document.createElement("div");
    heading.className = "dynamodb-index-heading";
    heading.textContent = label;
    section.appendChild(heading);
    for (const ix of indexes) {
      const row = document.createElement("div");
      row.className = "dynamodb-index-row";
      const name = document.createElement("div");
      name.className = "dynamodb-index-name";
      name.textContent = ix.IndexName ?? "";
      const detail = document.createElement("div");
      detail.className = "dynamodb-index-detail";
      const keyPart = (ix.KeySchema ?? [])
        .map((k) => `${k.AttributeName} (${k.KeyType})`)
        .join(", ");
      detail.textContent = [
        keyPart,
        projectionText(ix.Projection),
        ix.ItemCount !== undefined
          ? `${ix.ItemCount.toLocaleString()} items`
          : undefined,
      ]
        .filter(Boolean)
        .join(" / ");
      row.append(name, detail);
      section.appendChild(row);
    }
    structureBody.appendChild(section);
  }

  // テーブル本体の KeySchema/AttributeDefinitions に加え、GSI/LSI も含めた
  // 「テーブル構造」全体を表示する。アイテム選択有無に関わらず常に見える
  // ように、アイテム詳細 (renderItemDetail) とは別タブに分離している。
  function renderTableStructure(): void {
    structureBody.innerHTML = "";
    if (!currentTableInfo) {
      setPaneEmpty(structureBody, text().dynamodb.selectTable);
      return;
    }
    const t = text().dynamodb;
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
      currentTableInfo.TableSizeBytes !== undefined
        ? formatBytes(currentTableInfo.TableSizeBytes)
        : undefined,
      currentTableInfo.BillingModeSummary?.BillingMode,
    ]
      .filter(Boolean)
      .join(" / ");
    structureBody.append(header, meta);

    // AttributeDefinitions には (DynamoDB の仕様上) テーブルの KeySchema と
    // 各 GSI/LSI の KeySchema で参照される属性だけが載る。スキーマレスな
    // その他の item 属性はここには現れない。
    const attributeTypeByName = new Map(
      (currentTableInfo.AttributeDefinitions ?? []).map((a) => [
        a.AttributeName,
        a.AttributeType,
      ]),
    );
    const keyRoleByName = new Map(
      (currentTableInfo.KeySchema ?? []).map((k) => [
        k.AttributeName,
        k.KeyType,
      ]),
    );
    const table = document.createElement("table");
    table.className = "dynamodb-attr-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of [t.attributeHeader, t.typeHeader, t.keyRoleHeader]) {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const attrNames = [...attributeTypeByName.keys()];
    // AttributeDefinitions に載らない非キー属性は、現在読み込み済みのアイテム
    // を実際に見て型を推測する以外に知る方法がない (DynamoDB はキー以外の
    // スキーマを強制しない)。表示中のテーブルに切り替わった直後の itemsByKeyToken
    // だけを対象にするため、テーブル切り替え時は selectTable() 側で必ず先に
    // itemsByKeyToken.clear() されている前提。
    const inferredTypesByName = new Map<string, Set<string>>();
    for (const item of itemsByKeyToken.values()) {
      for (const [attrName, av] of Object.entries(item)) {
        if (attributeTypeByName.has(attrName)) continue;
        const set = inferredTypesByName.get(attrName) ?? new Set<string>();
        set.add(attributeValueTag(av));
        inferredTypesByName.set(attrName, set);
      }
    }
    const inferredNames = [...inferredTypesByName.keys()].sort();

    const tbody = document.createElement("tbody");
    if (attrNames.length === 0 && inferredNames.length === 0) {
      const row = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.className = "dynamodb-value-empty";
      td.textContent = t.noAttributes;
      row.appendChild(td);
      tbody.appendChild(row);
    }
    for (const name of attrNames) {
      const row = document.createElement("tr");
      const nameTd = document.createElement("td");
      nameTd.className = "dynamodb-attr-name";
      nameTd.textContent = name;
      const typeTd = document.createElement("td");
      typeTd.className = "dynamodb-attr-type";
      typeTd.textContent = attributeTypeByName.get(name) ?? "";
      const roleTd = document.createElement("td");
      roleTd.className = "dynamodb-attr-role";
      roleTd.textContent = keyRoleByName.get(name) ?? "";
      row.append(nameTd, typeTd, roleTd);
      tbody.appendChild(row);
    }
    for (const name of inferredNames) {
      const row = document.createElement("tr");
      const nameTd = document.createElement("td");
      nameTd.className = "dynamodb-attr-name";
      nameTd.textContent = name;
      const typeTd = document.createElement("td");
      typeTd.className = "dynamodb-attr-type";
      typeTd.textContent = [...(inferredTypesByName.get(name) ?? [])].join(
        ", ",
      );
      const roleTd = document.createElement("td");
      roleTd.className = "dynamodb-attr-role";
      row.append(nameTd, typeTd, roleTd);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    structureBody.appendChild(table);

    const note = document.createElement("div");
    note.className = "dynamodb-attr-note";
    note.textContent =
      inferredNames.length === 0
        ? t.keySchemaOnlyHint
        : t.inferredAttributesNote(itemsByKeyToken.size);
    structureBody.appendChild(note);

    renderSecondaryIndexes(
      t.globalSecondaryIndexes,
      currentTableInfo.GlobalSecondaryIndexes,
    );
    renderSecondaryIndexes(
      t.localSecondaryIndexes,
      currentTableInfo.LocalSecondaryIndexes,
    );
  }

  function renderItemDetail(item: DynamoDbItem): void {
    lastRenderedItem = item;
    itemBody.innerHTML = "";
    const header = document.createElement("div");
    header.className = "dynamodb-item-detail-header";
    const title = document.createElement("span");
    title.textContent = currentTable ?? "";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "db-btn db-btn-sm dynamodb-copy-key-btn";
    copyBtn.textContent = text().dynamodb.copyKey;
    const copyStatus = document.createElement("span");
    copyStatus.className = "dynamodb-copy-status";
    copyStatus.setAttribute("aria-live", "polite");
    copyBtn.addEventListener("click", async () => {
      copyStatus.textContent = "";
      try {
        const key = extractItemKey(item, currentTableInfo?.KeySchema);
        await navigator.clipboard.writeText(JSON.stringify(key));
        copyStatus.textContent = text().dynamodb.copied;
      } catch {
        copyStatus.textContent = text().dynamodb.copyFailed;
      }
    });
    header.append(title, copyBtn, copyStatus);
    itemBody.appendChild(header);
    const pre = document.createElement("pre");
    pre.className = "dynamodb-item-source";
    try {
      pre.textContent = JSON.stringify(unwrapItem(item), null, 2);
    } catch {
      pre.textContent = String(item);
    }
    itemBody.appendChild(pre);
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
    setDetailTab("item");
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
      const res = await trackLoad(
        fetch(`/_db/dynamodb/items?${params}`, { signal: slot.signal }),
      );
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
      // 読み込んだアイテムから推測する非キー属性一覧 (renderTableStructure 内)
      // を最新化する。currentTableInfo 未取得ならヘッダ自体まだ描画されて
      // いないので、fetchTableInfo 側の renderTableStructure に任せる。
      if (currentTableInfo) renderTableStructure();
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
    const isStaleRequest = (): boolean =>
      disposed ||
      slot.isStale() ||
      requestDbId !== currentDbId ||
      currentTable !== table;
    try {
      const params = new URLSearchParams({ db: requestDbId, table });
      const res = await trackLoad(
        fetch(`/_db/dynamodb/table?${params}`, { signal: slot.signal }),
      );
      if (isStaleRequest()) return;
      if (!res.ok) {
        const errText = await res.text();
        setPaneStatus(structureBody, `Error: ${errText || res.statusText}`, {
          error: true,
        });
        return;
      }
      const data = (await res.json()) as DynamoDbTableResponse;
      if (isStaleRequest()) return;
      currentTableInfo = data.table;
      renderTableStructure();
    } catch (err) {
      // テーブル情報の取得失敗はアイテム一覧の妨げにしない (ベストエフォート)。
      // ただし構造タブの「Loading table...」表示は必ず終端させる (Request
      // Lifecycle Discipline: 全経路でローディング状態をクリアする)。
      if (isStaleRequest()) return;
      setPaneStatus(
        structureBody,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        { error: true },
      );
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
      const res = await trackLoad(
        fetch(`/_db/dynamodb/item?${params}`, { signal: slot.signal }),
      );
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
    lastRenderedItem = null;
    // renderTableStructure() は itemsByKeyToken から非キー属性を推測するため、
    // fetchTableInfo() が呼ぶ最初の renderTableStructure() より前に、直前の
    // テーブルのアイテムを破棄しておく (さもないと切り替え直後に前のテーブルの
    // 推測属性が一瞬混ざって見えてしまう)。
    itemsByKeyToken.clear();
    itemRowsByKeyToken.clear();
    structureBody.innerHTML = "";
    setPaneStatus(structureBody, "Loading table...");
    itemBody.innerHTML = "";
    setPaneEmpty(itemBody, text().dynamodb.selectItem);
    setDetailTab("structure");
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
  tableMoreBtn.addEventListener("click", async () => {
    if (!currentDbId || !currentTableNextToken || disposed) return;
    const slot = tablePageGuard.start();
    const requestDbId = currentDbId;
    const requestToken = currentTableNextToken;
    tableMoreBtn.disabled = true;
    tableMoreBtn.title = "";
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        exclusiveStartTableName: requestToken,
      });
      const res = await trackLoad(
        fetch(`/_db/dynamodb/tables?${params}`, { signal: slot.signal }),
      );
      if (disposed || slot.isStale() || requestDbId !== currentDbId) return;
      if (!res.ok) {
        tableMoreBtn.title = (await res.text()) || res.statusText;
        return;
      }
      const data = (await res.json()) as DynamoDbTablesResponse;
      if (disposed || slot.isStale() || requestDbId !== currentDbId) return;
      renderTables(data.tableNames, true);
      currentTableNextToken = data.lastEvaluatedTableName;
      tableMoreBtn.hidden = !currentTableNextToken;
      if (currentTable) highlightActiveTable(currentTable);
    } catch (err) {
      if (slot.isStale()) return;
      tableMoreBtn.title = err instanceof Error ? err.message : String(err);
    } finally {
      slot.finish();
      if (!slot.isStale()) tableMoreBtn.disabled = false;
    }
  });
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
    tablePageGuard.dispose();
    tableInfoGuard.dispose();
    itemsGuard.dispose();
    itemGuard.dispose();
    const slot = tableGuard.start();
    const requestRunId = ++loadRunId;
    currentDbId = dbId;
    currentTable = null;
    currentTableInfo = null;
    currentTableNextToken = undefined;
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
    tableMoreBtn.hidden = true;
    lastRenderedItem = null;
    structureBody.innerHTML = "";
    setPaneEmpty(structureBody, text().dynamodb.selectTable);
    itemBody.innerHTML = "";
    setPaneEmpty(itemBody, text().dynamodb.selectItem);
    setDetailTab("structure");
    setPaneStatus(tableList, "Loading tables...");
    try {
      const res = await trackLoad(
        fetch(`/_db/dynamodb/tables?db=${encodeURIComponent(dbId)}`, {
          signal: slot.signal,
        }),
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
      currentTableNextToken = data.lastEvaluatedTableName;
      tableMoreBtn.hidden = !currentTableNextToken;
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
        // selectItemByKey() (→ selectItem()) はアイテム復元のため常に "item"
        // タブへ切り替える。initial.detailTab が明示されていれば (更新ボタン
        // 経由の forceReload など)、更新前に見ていたタブへ最終的に戻す。
        if (initial?.detailTab) setDetailTab(initial.detailTab);
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
    tablePageGuard.dispose();
    tableInfoGuard.dispose();
    itemsGuard.dispose();
    itemGuard.dispose();
    loadRunId++;
    itemRunId++;
    suppressNotify = false;
    currentDbId = null;
    currentTable = null;
    currentTableInfo = null;
    currentTableNextToken = undefined;
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
    tableMoreBtn.hidden = true;
    tableMoreBtn.disabled = false;
    tableMoreBtn.title = "";
    activeTableRow = null;
    itemStatus.textContent = "";
    itemList.innerHTML = "";
    itemsByKeyToken.clear();
    itemRowsByKeyToken.clear();
    activeItemRow = null;
    moreBtn.hidden = true;
    lastRenderedItem = null;
    structureBody.innerHTML = "";
    setPaneEmpty(structureBody, text().dynamodb.selectTable);
    itemBody.innerHTML = "";
    setPaneEmpty(itemBody, text().dynamodb.selectItem);
    setDetailTab("structure");
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
      detailTab,
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
    tableMoreBtn.textContent = t.common.loadMore;
    moreBtn.textContent = t.common.loadMore;
    structureTabBtn.textContent = t.dynamodb.structureTab;
    itemTabBtn.textContent = t.dynamodb.itemTab;
    if (currentTableInfo) renderTableStructure();
    else setPaneEmpty(structureBody, t.dynamodb.selectTable);
    if (lastRenderedItem) renderItemDetail(lastRenderedItem);
    else setPaneEmpty(itemBody, t.dynamodb.selectItem);
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
