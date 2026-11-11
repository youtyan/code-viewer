import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import { apiUrl } from "../../core/api-url";
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
import { formatErrorDetail } from "../../core/error-detail";
import { isImeComposing } from "../../core/keyboard";
import { formatBytes } from "../../core/source-meta";
import { renderOwned, templateElement } from "../ui/renderer";
import { createAbortGuard } from "./abort-guard";
import { detailTableTemplate } from "./detail-table";
import { createDetailTabs } from "./detail-tabs";
import { type DbText, dbText } from "./i18n";
import { paneEmptyTemplate, paneStatusTemplate } from "./pane-status";
import { reportDatastoreFailure, requireOkResponse } from "./report-failure";

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

// 読めなかったときは理由 (JSON.parse の位置つきの文、またはオブジェクトで
// ないこと) を返し、画面に出す。
function parseAttributeValuesJson(
  raw: string,
  notObject: string,
): { values: Record<string, DynamoDbAttributeValue> } | { reason: string } {
  if (!raw.trim()) return { values: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { reason: formatErrorDetail(err) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { reason: notObject };
  }
  return { values: parsed as Record<string, DynamoDbAttributeValue> };
}

type PaneStatus = { status: string; error: boolean };
const isStatus = (pane: unknown): pane is PaneStatus =>
  typeof pane === "object" && pane !== null && "status" in pane;

export type DynamoDbStructureProps = {
  title: string;
  meta: string;
  rows: string[][];
  note: string;
  indexes: {
    label: string;
    rows: { name: string; detail: string }[];
  }[];
};

export type DynamoDbSidebarProps = {
  text: DbText["explorer"];
  tables: null | PaneStatus | { names: string[] };
  activeTable: string | null;
  more: { shown: boolean; disabled: boolean; title: string };
  onSelectTable: (name: string) => void;
  onMore: () => void;
};

export type DynamoDbMainProps = {
  text: DbText["explorer"];
  mode: "scan" | "query";
  queryError: string | null;
  itemStatus: string;
  items: null | PaneStatus | { rows: { token: string; preview: string }[] };
  activeToken: string | null;
  more: { shown: boolean; disabled: boolean };
  refs: {
    keyCondition: Ref<HTMLInputElement>;
    filter: Ref<HTMLInputElement>;
    attributeValues: Ref<HTMLTextAreaElement>;
  };
  detail: { tabs: HTMLElement; structure: HTMLElement; item: HTMLElement };
  onMode: (mode: "scan" | "query") => void;
  onRun: (event: Event) => void;
  onKeydown: (event: KeyboardEvent) => void;
  onSelectItem: (token: string) => void;
  onMore: () => void;
};

export type DynamoDbStructurePaneProps = {
  text: DbText["explorer"];
  pane: "empty" | PaneStatus | DynamoDbStructureProps;
};

export type DynamoDbItemPaneProps = {
  text: DbText["explorer"];
  pane:
    | "empty"
    | {
        table: string;
        source: string;
        copy: { text: string; title: string };
        onCopy: () => void;
      };
};

export type DynamoDbExplorerLook = {
  sidebar: (props: DynamoDbSidebarProps) => unknown;
  main: (props: DynamoDbMainProps) => unknown;
  structure: (props: DynamoDbStructurePaneProps) => unknown;
  item: (props: DynamoDbItemPaneProps) => unknown;
};

export const DEFAULT_VIEW: DynamoDbExplorerLook = {
  sidebar: (p) =>
    html`<div class="db-explorer-pane-header">${p.text.dynamodb.table}</div><div
        class="dynamodb-table-list"
      >${
        p.tables === null
          ? nothing
          : isStatus(p.tables)
            ? paneStatusTemplate(p.tables.status, p.tables.error)
            : p.tables.names.map(
                (name) =>
                  html`<div
                    class=${name === p.activeTable ? "dynamodb-table-item active" : "dynamodb-table-item"}
                    data-table-name=${name}
                    title=${name}
                    @click=${() => p.onSelectTable(name)}
                  >${name}</div>`,
              )
      }</div><button
        type="button"
        class="dynamodb-item-more-btn dynamodb-table-more-btn"
        title=${p.more.title}
        ?hidden=${!p.more.shown}
        ?disabled=${p.more.disabled}
        @click=${p.onMore}
      >${p.text.common.loadMore}</button>`,
  main: (p) => {
    const t = p.text.dynamodb;
    return html`<div class="dynamodb-item-list-pane"><div
          class="seg dynamodb-mode-seg"
        ><button
            type="button"
            class=${p.mode === "scan" ? "active" : ""}
            @click=${() => p.onMode("scan")}
          >${t.scanMode}</button><button
            type="button"
            class=${p.mode === "query" ? "active" : ""}
            @click=${() => p.onMode("query")}
          >${t.queryMode}</button></div
        ><form class="dynamodb-query-form" @submit=${p.onRun}><input
            type="text"
            class="dynamodb-key-condition-input"
            placeholder=${t.keyConditionPlaceholder}
            autocomplete="off"
            ?hidden=${p.mode !== "query"}
            ${ref(p.refs.keyCondition)}
            @keydown=${p.onKeydown}
          /><input
            type="text"
            class="dynamodb-filter-input"
            placeholder=${t.filterPlaceholder}
            autocomplete="off"
            ${ref(p.refs.filter)}
            @keydown=${p.onKeydown}
          /><textarea
            class="dynamodb-attribute-values-input"
            placeholder=${t.attributeValuesPlaceholder}
            rows="2"
            ${ref(p.refs.attributeValues)}
          ></textarea><button
            type="submit"
            class="db-btn db-btn-primary dynamodb-run-btn"
          >${t.runQuery}</button></form
        ><div class="dynamodb-query-error" ?hidden=${p.queryError === null}>${
          p.queryError ?? ""
        }</div><div class="dynamodb-item-status">${p.itemStatus}</div><div
          class="dynamodb-item-list"
        >${
          p.items === null
            ? nothing
            : isStatus(p.items)
              ? paneStatusTemplate(p.items.status, p.items.error)
              : p.items.rows.map(
                  (row) =>
                    html`<div
                      class=${row.token === p.activeToken ? "dynamodb-item-row active" : "dynamodb-item-row"}
                      data-key-token=${row.token}
                      @click=${() => p.onSelectItem(row.token)}
                    ><span class="dynamodb-item-preview">${row.preview}</span></div>`,
                )
        }</div><button
          type="button"
          class="dynamodb-item-more-btn"
          ?hidden=${!p.more.shown}
          ?disabled=${p.more.disabled}
          @click=${p.onMore}
        >${p.text.common.loadMore}</button></div
      ><div class="db-detail-pane">${p.detail.tabs}${p.detail.structure}${p.detail.item}</div>`;
  },
  structure: ({ text: t, pane }) => {
    if (pane === "empty") return paneEmptyTemplate(t.dynamodb.selectTable);
    if (isStatus(pane)) return paneStatusTemplate(pane.status, pane.error);
    return html`<div class="dynamodb-table-info-header">${pane.title}</div><div
        class="dynamodb-table-info-meta"
      >${pane.meta}</div>${detailTableTemplate(
        [
          t.dynamodb.attributeHeader,
          t.dynamodb.typeHeader,
          t.dynamodb.keyRoleHeader,
        ],
        pane.rows,
        t.dynamodb.noAttributes,
      )}<div class="dynamodb-attr-note">${pane.note}</div>${pane.indexes.map(
        (section) =>
          html`<div class="dynamodb-index-section"><div
              class="dynamodb-index-heading"
            >${section.label}</div>${section.rows.map(
              (row) =>
                html`<div class="dynamodb-index-row"><div
                    class="dynamodb-index-name"
                  >${row.name}</div><div class="dynamodb-index-detail"
                    >${row.detail}</div
                  ></div>`,
            )}</div>`,
      )}`;
  },
  item: ({ text: t, pane }) => {
    if (pane === "empty") return paneEmptyTemplate(t.dynamodb.selectItem);
    return html`<div class="dynamodb-item-detail-header"><span>${pane.table}</span
        ><button
          type="button"
          class="db-btn db-btn-sm dynamodb-copy-key-btn"
          @click=${pane.onCopy}
        >${t.dynamodb.copyKey}</button><span
          class="dynamodb-copy-status"
          aria-live="polite"
          title=${pane.copy.title}
          >${pane.copy.text}</span
        ></div
      ><pre class="dynamodb-item-source">${pane.source}</pre>`;
  },
};

/** 1 回に取るアイテムの数。 */
const ITEMS_PAGE_SIZE = 200;

export function createDynamoDbExplorer(
  callbacks: DynamoDbExplorerCallbacks = {},
  view: DynamoDbExplorerLook = DEFAULT_VIEW,
): DynamoDbExplorerView {
  const text = (): DbText["explorer"] =>
    (callbacks.getText?.() ?? dbText("en")).explorer;
  const tFailure = (): DbText["failure"] =>
    (callbacks.getText?.() ?? dbText("en")).failure;
  const trackLoad = <T>(promise: Promise<T>): Promise<T> =>
    callbacks.trackLoad ? callbacks.trackLoad(promise) : promise;

  // ----- 詳細のタブ (es-explorer の mapping/doc タブと共通の部品) -----
  const detailTabs = createDetailTabs(
    [
      { id: "structure", label: text().dynamodb.structureTab },
      { id: "item", label: text().dynamodb.itemTab },
    ] as const,
    "structure",
    () => notifySelectionChange(),
  );
  const structureBody = detailTabs.bodies.structure;
  const itemBody = detailTabs.bodies.item;
  const refs = {
    keyCondition: createRef<HTMLInputElement>(),
    filter: createRef<HTMLInputElement>(),
    attributeValues: createRef<HTMLTextAreaElement>(),
  };
  const field = <T extends HTMLInputElement | HTMLTextAreaElement>(
    fieldRef: Ref<T>,
    name: string,
  ): T => {
    const element = fieldRef.value;
    if (!element)
      throw new Error(`DynamoDB explorer: the ${name} field was not drawn`);
    return element;
  };
  const keyConditionInput = () => field(refs.keyCondition, "key condition");
  const filterInput = () => field(refs.filter, "filter");
  const attributeValuesInput = () =>
    field(refs.attributeValues, "attribute values");

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
  let itemStatusShown = false;
  // 言語ライブ切替時に描画済みのアイテム内容を再ローカライズするための保持。
  let lastRenderedItem: DynamoDbItem | null = null;
  let disposed = false;
  let loadRunId = 0;
  let itemRunId = 0;
  let suppressNotify = false;
  const itemsByKeyToken = new Map<string, DynamoDbItem>();
  let tablesPane: DynamoDbSidebarProps["tables"] = null;
  let activeTable: string | null = null;
  let tableMore = { shown: false, disabled: false, title: "" };
  let queryError: string | null = null;
  let itemsPane: DynamoDbMainProps["items"] = null;
  let itemMore = { shown: false, disabled: false };
  let structurePane: DynamoDbStructurePaneProps["pane"] = "empty";
  let copyStatus = { text: "", title: "" };
  const tableGuard = createAbortGuard();
  const tablePageGuard = createAbortGuard();
  const tableInfoGuard = createAbortGuard();
  const itemsGuard = createAbortGuard();
  const itemGuard = createAbortGuard();

  const sidebarSlot = templateElement(
    html`<div class="db-explorer-sidebar-slot dynamodb-table-list-pane"></div>`,
  );
  const container = templateElement(
    html`<div class="dynamodb-explorer"></div>`,
  );

  function itemSource(item: DynamoDbItem): string {
    try {
      return JSON.stringify(unwrapItem(item), null, 2);
    } catch (err) {
      // 描けなかった理由を、項目の代わりにその場に出す (以前は
      // String(item) の "[object Object]" を黙って出していた)。
      return reportDatastoreFailure(
        "DynamoDB",
        "item render",
        err,
        currentTable,
      );
    }
  }

  function draw(): void {
    const t = text();
    renderOwned(
      sidebarSlot,
      view.sidebar({
        text: t,
        tables: tablesPane,
        activeTable,
        more: tableMore,
        onSelectTable: (name) => void selectTable(name),
        onMore: () => void loadMoreTables(),
      }),
    );
    renderOwned(
      container,
      view.main({
        text: t,
        mode: currentMode,
        queryError,
        itemStatus: itemStatusShown
          ? `${t.common.shownCount(cumulativeShownCount.toLocaleString())} / ${t.common.scannedCount(cumulativeScannedCount.toLocaleString())}`
          : "",
        items: itemsPane,
        activeToken: currentItemKeyToken,
        more: itemMore,
        refs,
        detail: {
          tabs: detailTabs.tabsEl,
          structure: structureBody,
          item: itemBody,
        },
        onMode: (mode) => {
          if (currentMode === mode) return;
          currentMode = mode;
          draw();
          notifySelectionChange();
          if (mode === "scan") void loadItems(false);
        },
        onRun: (event) => {
          event.preventDefault();
          notifySelectionChange();
          void loadItems(false);
        },
        onKeydown: (event) => {
          if (isImeComposing(event)) return;
        },
        onSelectItem: (token) => {
          const item = itemsByKeyToken.get(token);
          if (item) selectItem(item, token);
        },
        onMore: () => void loadItems(true),
      }),
    );
    renderOwned(
      structureBody,
      view.structure({ text: t, pane: structurePane }),
    );
    const item = lastRenderedItem;
    renderOwned(
      itemBody,
      view.item({
        text: t,
        pane: item
          ? {
              table: currentTable ?? "",
              source: itemSource(item),
              copy: copyStatus,
              onCopy: () => void copyKey(item),
            }
          : "empty",
      }),
    );
  }

  function notifySelectionChange(): void {
    if (suppressNotify) return;
    callbacks.onSelectionChange?.(getSelection());
  }

  function setDetailTab(tab: "structure" | "item"): void {
    detailTabs.setActive(tab);
  }

  function tableNames(): string[] {
    return tablesPane !== null && !isStatus(tablesPane) ? tablesPane.names : [];
  }

  function highlightActiveTable(name: string): void {
    activeTable = tableNames().includes(name) ? name : null;
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

  // テーブル本体の KeySchema/AttributeDefinitions に加え、GSI/LSI も含めた
  // 「テーブル構造」全体を、描く時点の値で作る。アイテム選択有無に関わらず
  // 常に見えるように、アイテム詳細とは別タブに分離している。
  function tableStructure(
    info: DynamoDbTableDescription,
  ): DynamoDbStructureProps {
    const t = text().dynamodb;
    // AttributeDefinitions には (DynamoDB の仕様上) テーブルの KeySchema と
    // 各 GSI/LSI の KeySchema で参照される属性だけが載る。スキーマレスな
    // その他の item 属性はここには現れない。
    const attributeTypeByName = new Map(
      (info.AttributeDefinitions ?? []).map((a) => [
        a.AttributeName,
        a.AttributeType,
      ]),
    );
    const keyRoleByName = new Map(
      (info.KeySchema ?? []).map((k) => [k.AttributeName, k.KeyType]),
    );
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
    const indexSection = (
      label: string,
      indexes: DynamoDbSecondaryIndexDescription[] | undefined,
    ) =>
      indexes && indexes.length > 0
        ? [
            {
              label,
              rows: indexes.map((ix) => ({
                name: ix.IndexName ?? "",
                detail: [
                  (ix.KeySchema ?? [])
                    .map((k) => `${k.AttributeName} (${k.KeyType})`)
                    .join(", "),
                  projectionText(ix.Projection),
                  ix.ItemCount !== undefined
                    ? `${ix.ItemCount.toLocaleString()} items`
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(" / "),
              })),
            },
          ]
        : [];
    return {
      title: info.TableName ?? currentTable ?? "",
      meta: [
        info.TableStatus,
        info.ItemCount !== undefined
          ? `${info.ItemCount.toLocaleString()} items`
          : undefined,
        info.TableSizeBytes !== undefined
          ? formatBytes(info.TableSizeBytes)
          : undefined,
        info.BillingModeSummary?.BillingMode,
      ]
        .filter(Boolean)
        .join(" / "),
      rows: [
        ...[...attributeTypeByName.keys()].map((name) => [
          name,
          attributeTypeByName.get(name) ?? "",
          keyRoleByName.get(name) ?? "",
        ]),
        ...inferredNames.map((name) => [
          name,
          [...(inferredTypesByName.get(name) ?? [])].join(", "),
          "",
        ]),
      ],
      note:
        inferredNames.length === 0
          ? t.keySchemaOnlyHint
          : t.inferredAttributesNote(itemsByKeyToken.size),
      indexes: [
        ...indexSection(t.globalSecondaryIndexes, info.GlobalSecondaryIndexes),
        ...indexSection(t.localSecondaryIndexes, info.LocalSecondaryIndexes),
      ],
    };
  }

  function renderTableStructure(): void {
    structurePane = currentTableInfo
      ? tableStructure(currentTableInfo)
      : "empty";
  }

  function showItemDetail(item: DynamoDbItem): void {
    lastRenderedItem = item;
    copyStatus = { text: "", title: "" };
  }

  async function copyKey(item: DynamoDbItem): Promise<void> {
    copyStatus = { text: "", title: "" };
    draw();
    try {
      const key = extractItemKey(item, currentTableInfo?.KeySchema);
      await navigator.clipboard.writeText(JSON.stringify(key));
      copyStatus = { text: text().dynamodb.copied, title: "" };
    } catch (err) {
      copyStatus = {
        text: text().dynamodb.copyFailed,
        title: reportDatastoreFailure(
          "DynamoDB",
          "copy key",
          err,
          currentTable,
        ),
      };
    }
    draw();
  }

  // token 省略時は現在の currentTableInfo から計算し直す (GetItem 経由の
  // 復元選択など、行の token を持たない呼び出し用)。一覧クリックからは
  // 行の token をそのまま渡し、計算タイミングのズレによるハイライト不整合を
  // 避ける。
  function selectItem(item: DynamoDbItem, token?: string): void {
    currentItemKeyToken =
      token ?? itemKeyToken(extractItemKey(item, currentTableInfo?.KeySchema));
    showItemDetail(item);
    setDetailTab("item");
    draw();
    notifySelectionChange();
  }

  async function loadItems(append: boolean): Promise<void> {
    if (!currentDbId || !currentTable || disposed) return;
    const keyConditionExpression = keyConditionInput().value.trim();
    const filterExpression = filterInput().value.trim();
    const parsedValues = parseAttributeValuesJson(
      attributeValuesInput().value,
      text().dynamodb.attributeValuesNotObject,
    );
    queryError = null;
    // itemsGuard.start() より前に検証する。start() 後に return すると
    // slot.finish() が呼ばれないまま次の start() まで in-flight 扱いが残る。
    if (currentMode === "query" && !keyConditionExpression) {
      queryError = text().dynamodb.keyConditionPlaceholder;
      draw();
      return;
    }
    if ("reason" in parsedValues) {
      queryError = `${text().dynamodb.invalidAttributeValues}: ${parsedValues.reason}`;
      draw();
      return;
    }
    const attributeValues = parsedValues.values;
    const slot = itemsGuard.start();
    const requestRunId = loadRunId;
    const requestDbId = currentDbId;
    const requestTable = currentTable;
    const requestMode = currentMode;
    itemMore = { ...itemMore, disabled: true };
    if (!append) {
      itemsByKeyToken.clear();
      currentItemKeyToken = null;
      currentNextToken = undefined;
      cumulativeShownCount = 0;
      cumulativeScannedCount = 0;
      itemsPane = { status: text().dynamodb.loadingItems, error: false };
    }
    draw();
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        table: requestTable,
        mode: requestMode,
        limit: String(ITEMS_PAGE_SIZE),
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
        fetch(`${apiUrl("dbDynamodbItems")}?${params}`, {
          signal: slot.signal,
        }),
      );
      if (disposed || slot.isStale()) return;
      await requireOkResponse(res, tFailure().dynamodbItems);
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
      const shown =
        append && itemsPane !== null && !isStatus(itemsPane)
          ? itemsPane.rows
          : [];
      if (data.items.length === 0 && !append) {
        itemsPane = { status: text().dynamodb.noItems, error: false };
      } else {
        const rows = data.items.map((item) => {
          const token = itemKeyToken(
            extractItemKey(item, currentTableInfo?.KeySchema),
          );
          itemsByKeyToken.set(token, item);
          return { token, preview: previewItem(item) };
        });
        itemsPane = { rows: [...shown, ...rows] };
      }
      // 読み込んだアイテムから推測する非キー属性一覧を最新化する。
      // currentTableInfo 未取得ならヘッダ自体まだ描画されていないので、
      // fetchTableInfo 側の renderTableStructure に任せる。
      if (currentTableInfo) renderTableStructure();
      currentNextToken = data.lastEvaluatedKey;
      itemMore = { ...itemMore, shown: !!data.lastEvaluatedKey };
      cumulativeShownCount += data.items.length;
      cumulativeScannedCount += data.scannedCount;
      itemStatusShown = true;
      draw();
    } catch (err) {
      if (slot.isStale()) return;
      itemsPane = {
        status: reportDatastoreFailure(
          "DynamoDB",
          "item list",
          err,
          requestTable,
          requestMode,
        ),
        error: true,
      };
      draw();
    } finally {
      slot.finish();
      if (!slot.isStale()) {
        itemMore = { ...itemMore, disabled: false };
        draw();
      }
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
        fetch(`${apiUrl("dbDynamodbTable")}?${params}`, {
          signal: slot.signal,
        }),
      );
      if (isStaleRequest()) return;
      await requireOkResponse(res, tFailure().dynamodbTable);
      const data = (await res.json()) as DynamoDbTableResponse;
      if (isStaleRequest()) return;
      currentTableInfo = data.table;
      renderTableStructure();
      draw();
    } catch (err) {
      // テーブル情報の取得失敗はアイテム一覧の妨げにしない (ベストエフォート)。
      // ただし構造タブの「Loading table...」表示は必ず終端させる (Request
      // Lifecycle Discipline: 全経路でローディング状態をクリアする)。
      if (isStaleRequest()) return;
      structurePane = {
        status: reportDatastoreFailure(
          "DynamoDB",
          "table describe",
          err,
          table,
        ),
        error: true,
      };
      draw();
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
        fetch(`${apiUrl("dbDynamodbItem")}?${params}`, { signal: slot.signal }),
      );
      if (disposed || slot.isStale()) return;
      await requireOkResponse(res, tFailure().dynamodbItem);
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
    } catch (err) {
      // 初期選択の復元に失敗しても一覧表示は継続する。理由は console に残す。
      if (!slot.isStale()) {
        reportDatastoreFailure(
          "DynamoDB",
          "item restore",
          err,
          requestTable,
          key,
        );
      }
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
    // tableStructure() は itemsByKeyToken から非キー属性を推測するため、
    // fetchTableInfo() が呼ぶ最初の renderTableStructure() より前に、直前の
    // テーブルのアイテムを破棄しておく (さもないと切り替え直後に前のテーブルの
    // 推測属性が一瞬混ざって見えてしまう)。
    itemsByKeyToken.clear();
    structurePane = { status: text().dynamodb.loadingTable, error: false };
    setDetailTab("structure");
    draw();
    // アイテムの token は KeySchema (currentTableInfo) の有無で計算結果が
    // 変わる。並行実行すると loadItems が先に終わったときだけ KeySchema 無しの
    // token になり、後からのクリック選択時の再計算結果と食い違ってハイライトが
    // 効かなくなるため、fetchTableInfo を先に確定させる。
    await fetchTableInfo(name);
    await loadItems(false);
  }

  async function loadMoreTables(): Promise<void> {
    if (!currentDbId || !currentTableNextToken || disposed) return;
    const slot = tablePageGuard.start();
    const requestDbId = currentDbId;
    const requestToken = currentTableNextToken;
    tableMore = { ...tableMore, disabled: true, title: "" };
    draw();
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        exclusiveStartTableName: requestToken,
      });
      const res = await trackLoad(
        fetch(`${apiUrl("dbDynamodbTables")}?${params}`, {
          signal: slot.signal,
        }),
      );
      if (disposed || slot.isStale() || requestDbId !== currentDbId) return;
      await requireOkResponse(res, tFailure().dynamodbTables);
      const data = (await res.json()) as DynamoDbTablesResponse;
      if (disposed || slot.isStale() || requestDbId !== currentDbId) return;
      tablesPane = { names: [...tableNames(), ...data.tableNames] };
      currentTableNextToken = data.lastEvaluatedTableName;
      tableMore = { ...tableMore, shown: !!currentTableNextToken };
      if (currentTable) highlightActiveTable(currentTable);
      draw();
    } catch (err) {
      if (slot.isStale()) return;
      tableMore = {
        ...tableMore,
        title: reportDatastoreFailure(
          "DynamoDB",
          "table list page",
          err,
          requestDbId,
          requestToken,
        ),
      };
      draw();
    } finally {
      slot.finish();
      if (!slot.isStale()) {
        tableMore = { ...tableMore, disabled: false };
        draw();
      }
    }
  }

  // 一覧・詳細を何も選んでいない形に戻す (load と clear が使う)。
  function resetPanes(mode: "scan" | "query"): void {
    currentTable = null;
    currentTableInfo = null;
    currentTableNextToken = undefined;
    currentItemKeyToken = null;
    currentNextToken = undefined;
    currentMode = mode;
    queryError = null;
    itemStatusShown = false;
    itemsPane = null;
    itemsByKeyToken.clear();
    itemMore = { ...itemMore, shown: false };
    tableMore = { ...tableMore, shown: false };
    lastRenderedItem = null;
    structurePane = "empty";
    setDetailTab("structure");
  }

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
    resetPanes(initial?.mode === "query" ? "query" : "scan");
    currentScanIndexForward = initial?.scanIndexForward ?? true;
    keyConditionInput().value = initial?.keyConditionExpression ?? "";
    filterInput().value = initial?.filterExpression ?? "";
    attributeValuesInput().value = initial?.expressionAttributeValues ?? "";
    tablesPane = { status: text().dynamodb.loadingTables, error: false };
    draw();
    try {
      const res = await trackLoad(
        fetch(`${apiUrl("dbDynamodbTables")}?db=${encodeURIComponent(dbId)}`, {
          signal: slot.signal,
        }),
      );
      if (disposed || slot.isStale()) return;
      await requireOkResponse(res, tFailure().dynamodbTables);
      const data = (await res.json()) as DynamoDbTablesResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        currentDbId !== dbId
      ) {
        return;
      }
      activeTable = null;
      tablesPane =
        data.tableNames.length === 0
          ? { status: text().dynamodb.noTables, error: false }
          : { names: data.tableNames };
      currentTableNextToken = data.lastEvaluatedTableName;
      tableMore = { ...tableMore, shown: !!currentTableNextToken };
      draw();
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
          } catch (err) {
            // 保存済み itemKey が壊れていても一覧は出す。理由は console に残す。
            reportDatastoreFailure(
              "DynamoDB",
              "saved item key",
              err,
              initial.itemKey,
            );
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
      tablesPane = {
        status: reportDatastoreFailure("DynamoDB", "table list", err, dbId),
        error: true,
      };
      draw();
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
    cumulativeShownCount = 0;
    cumulativeScannedCount = 0;
    resetPanes("scan");
    keyConditionInput().value = "";
    filterInput().value = "";
    attributeValuesInput().value = "";
    tablesPane = null;
    activeTable = null;
    tableMore = { shown: false, disabled: false, title: "" };
    draw();
  }

  function getSelection(): DynamoDbExplorerSelection {
    return {
      table: currentTable ?? undefined,
      mode: currentMode,
      keyConditionExpression: keyConditionInput().value.trim() || undefined,
      filterExpression: filterInput().value.trim() || undefined,
      expressionAttributeValues:
        attributeValuesInput().value.trim() || undefined,
      scanIndexForward:
        currentMode === "query" ? currentScanIndexForward : undefined,
      itemKey: currentItemKeyToken ?? undefined,
      detailTab: detailTabs.getActive(),
    };
  }

  function dispose(): void {
    disposed = true;
    clear();
  }

  function localize(): void {
    const t = text();
    detailTabs.setLabels({
      structure: t.dynamodb.structureTab,
      item: t.dynamodb.itemTab,
    });
    renderTableStructure();
    if (lastRenderedItem) showItemDetail(lastRenderedItem);
    draw();
  }

  draw();

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
