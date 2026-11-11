import { live } from "lit/directives/live.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import { apiUrl } from "../../core/api-url";
import type {
  ElasticsearchExplorerSelection,
  EsDocHit,
  EsDocResponse,
  EsDocsResponse,
  EsIndicesResponse,
  EsMappingResponse,
} from "../../core/database/types";
import { formatErrorDetail } from "../../core/error-detail";
import { isImeComposing } from "../../core/keyboard";
import { formatBytes } from "../../core/source-meta";
import { renderOwned, templateElement } from "../ui/renderer";
import { showConfirmDialog } from "../ui-dialog";
import { createAbortGuard } from "./abort-guard";
import { detailTableTemplate } from "./detail-table";
import { createDetailTabs } from "./detail-tabs";
import { type DbText, dbText } from "./i18n";
import { paneEmptyTemplate, paneStatusTemplate } from "./pane-status";
import { reportDatastoreFailure, requireOkResponse } from "./report-failure";

export type ElasticsearchExplorerCallbacks = {
  // 選択中の index / query 文字列が変わったことを外側に通知する。タブ
  // ごとに persist して reload 復元するために使う。
  onSelectionChange?: (selection: ElasticsearchExplorerSelection) => void;
  getText?: () => DbText;
  // 書き込み fetch を共通の in-flight 追跡に乗せる。未指定なら素通し。
  trackLoad?: <T>(promise: Promise<T>) => Promise<T>;
};

export type ElasticsearchExplorerView = {
  el: HTMLElement;
  // Indices リストを左サイドバー (db-sidebar) の dbToolbar 直下に mount する
  // スロット。container には含まれない。
  sidebarSlot: HTMLElement;
  load: (
    dbId: string,
    initial?: ElasticsearchExplorerSelection,
  ) => Promise<void>;
  clear: () => void;
  dispose: () => void;
  getSelection: () => ElasticsearchExplorerSelection;
  localize: () => void;
};

type PaneStatus = { status: string; error: boolean };

/** 左の index の一覧。読み込む前は空。 */
type IndexPaneState = null | PaneStatus | { indices: EsIndex[] };
type EsIndex = EsIndicesResponse["indices"][number];
/** ドキュメントの一覧。読み込む前は空。 */
type DocsPaneState = null | PaneStatus | { hits: EsDocHit[] };
type MappingPaneState = "empty" | PaneStatus | { mapping: EsMappingResponse };
/** 右のドキュメントの欄: 案内・札・中身・書き直す欄・新しく作る欄。 */
type DocPaneState =
  | "empty"
  | PaneStatus
  | { doc: EsDocResponse }
  | { edit: EsDocResponse; message: string; busy: boolean }
  | { create: true; message: string; busy: boolean };

export type EsSidebarProps = {
  text: DbText["explorer"];
  pane: IndexPaneState;
  activeIndex: string | null;
  indexMeta: (index: EsIndex) => string;
  onSelectIndex: (name: string) => void;
};

export type EsMainProps = {
  text: DbText["explorer"];
  newDocShown: boolean;
  query: string;
  docs: DocsPaneState;
  activeDoc: string | null;
  more: { shown: boolean; disabled: boolean };
  /** 詳細のタブと、その中身の箱 (中身は mapping・doc が描く)。 */
  detail: { tabs: HTMLElement; mapping: HTMLElement; doc: HTMLElement };
  onNewDoc: () => void;
  onQueryInput: (value: string) => void;
  onSearch: () => void;
  onSearchKeydown: (event: KeyboardEvent) => void;
  onMore: () => void;
  onSelectDoc: (id: string) => void;
};

export type EsMappingProps = {
  text: DbText["explorer"];
  pane: MappingPaneState;
};

export type EsDocProps = {
  text: DbText["explorer"];
  pane: DocPaneState;
  /** 中身の JSON (描けなかった値は String で)。 */
  sourceText: string;
  sourceRef: Ref<HTMLTextAreaElement>;
  idRef: Ref<HTMLInputElement>;
  onEdit: () => void;
  onDelete: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onCreate: (event: Event) => void;
  onCancelCreate: () => void;
};

export type EsExplorerView = {
  sidebar: (props: EsSidebarProps) => unknown;
  main: (props: EsMainProps) => unknown;
  mapping: (props: EsMappingProps) => unknown;
  doc: (props: EsDocProps) => unknown;
};

const isStatus = (pane: unknown): pane is PaneStatus =>
  typeof pane === "object" && pane !== null && "status" in pane;

export const DEFAULT_VIEW: EsExplorerView = {
  sidebar: (p) =>
    html`<div class="db-explorer-pane-header">${p.text.es.indices}</div><div
        class="es-index-list"
      >${
        p.pane === null
          ? nothing
          : isStatus(p.pane)
            ? paneStatusTemplate(p.pane.status, p.pane.error)
            : p.pane.indices.map(
                (ix) =>
                  html`<div
                    class=${ix.name === p.activeIndex ? "es-index-item active" : "es-index-item"}
                    data-index-name=${ix.name}
                    @click=${() => p.onSelectIndex(ix.name)}
                  ><span class="es-index-name" title=${ix.name}>${ix.name}</span
                    ><span class="es-index-meta">${p.indexMeta(ix)}</span></div>`,
              )
      }</div>`,
  main: (p) =>
    html`<div class="es-doc-list-pane"><div
          class="db-explorer-pane-header es-doc-list-header"
        ><span>${p.text.es.docs}</span><button
            type="button"
            class="db-btn db-btn-sm es-new-doc-btn"
            title=${p.text.es.newDoc}
            ?hidden=${!p.newDocShown}
            @click=${p.onNewDoc}
          >＋ ${p.text.es.newDoc}</button></div
        ><div class="es-search-bar"><input
            type="text"
            class="es-search-input"
            placeholder=${p.text.es.queryPlaceholder}
            .value=${live(p.query)}
            @input=${(event: Event) =>
              p.onQueryInput((event.currentTarget as HTMLInputElement).value)}
            @keydown=${p.onSearchKeydown}
          /><button type="button" class="es-search-btn" @click=${p.onSearch}
            >${p.text.common.search}</button
          ></div
        ><div class="es-doc-list">${
          p.docs === null
            ? nothing
            : isStatus(p.docs)
              ? paneStatusTemplate(p.docs.status, p.docs.error)
              : p.docs.hits.map(
                  (hit) =>
                    html`<div
                      class=${hit._id === p.activeDoc ? "es-doc-item active" : "es-doc-item"}
                      data-doc-id=${hit._id}
                      @click=${() => p.onSelectDoc(hit._id)}
                    ><span class="es-doc-id" title=${hit._id}>${hit._id}</span
                      ><span class="es-doc-preview"
                        >${previewSource(hit._source)}</span
                      ></div>`,
                )
        }</div><button
          type="button"
          class="es-doc-more-btn"
          ?hidden=${!p.more.shown}
          ?disabled=${p.more.disabled}
          @click=${p.onMore}
        >${p.text.common.loadMore}</button></div
      ><div class="db-detail-pane">${p.detail.tabs}${p.detail.mapping}${p.detail.doc}</div>`,
  mapping: ({ text: t, pane }) => {
    if (pane === "empty") return paneEmptyTemplate(t.es.selectIndex);
    if (isStatus(pane)) return paneStatusTemplate(pane.status, pane.error);
    const props = pane.mapping.mapping.properties;
    return html`<div class="es-mapping-header">${pane.mapping.mapping.index}</div>${detailTableTemplate(
      [t.es.fieldHeader, t.es.typeHeader],
      Object.keys(props)
        .sort()
        .map((key) => {
          const field = props[key];
          return [
            key,
            field.type ?? (field.properties ? "object" : t.es.unknownType),
          ];
        }),
      t.es.noMappedFields,
    )}`;
  },
  doc: (p) => {
    const t = p.text;
    const pane = p.pane;
    if (pane === "empty") return paneEmptyTemplate(t.es.selectDoc);
    if (isStatus(pane)) return paneStatusTemplate(pane.status, pane.error);
    const status = (message: string) =>
      html`<span class="es-doc-edit-status">${message}</span>`;
    if ("edit" in pane)
      return html`<div class="es-doc-edit-bar"><button
            type="button"
            class="db-btn db-btn-primary db-btn-sm"
            ?disabled=${pane.busy}
            @click=${p.onSave}
          >${t.common.save}</button><button
            type="button"
            class="db-btn db-btn-sm"
            ?disabled=${pane.busy}
            @click=${p.onCancelEdit}
          >${t.common.cancel}</button>${status(pane.message)}</div
        ><textarea
          class="es-doc-edit-textarea"
          .value=${p.sourceText}
          ${ref(p.sourceRef)}
        ></textarea>`;
    if ("create" in pane)
      return html`<form class="es-new-doc-form" @submit=${p.onCreate}><div
          class="es-doc-edit-bar"
        ><button
            type="submit"
            class="db-btn db-btn-primary db-btn-sm"
            ?disabled=${pane.busy}
          >${t.es.create}</button><button
            type="button"
            class="db-btn db-btn-sm"
            @click=${p.onCancelCreate}
          >${t.common.cancel}</button>${status(pane.message)}</div
        ><input
          type="text"
          class="es-new-doc-id"
          placeholder=${t.es.newDocIdPlaceholder}
          autocomplete="off"
          ${ref(p.idRef)}
        /><textarea
          class="es-doc-edit-textarea"
          placeholder=${t.es.sourceJsonPlaceholder}
          ${ref(p.sourceRef)}
        ></textarea></form>`;
    const doc = pane.doc;
    return html`<div class="es-doc-detail-header"><span
          >${doc.index} / ${doc.id}</span
        >${
          doc.found
            ? html`<div class="es-doc-actions"><button
                  type="button"
                  class="db-btn db-btn-sm"
                  @click=${p.onEdit}
                >${t.common.edit}</button><button
                  type="button"
                  class="db-btn db-btn-sm"
                  @click=${p.onDelete}
                >${t.common.delete}</button></div>`
            : nothing
        }</div
      >${
        !doc.found
          ? paneStatusTemplate(t.es.docNotFound)
          : html`${
              doc.seqNo !== undefined || doc.primaryTerm !== undefined
                ? html`<div class="es-doc-detail-meta"
                    >_seq_no=${doc.seqNo ?? "?"} _primary_term=${doc.primaryTerm ?? "?"}</div
                  >`
                : nothing
            }<pre class="es-doc-source">${p.sourceText}</pre>`
      }`;
  },
};

function previewSource(src: unknown): string {
  if (src === null || src === undefined) return "";
  if (Array.isArray(src)) return `array(${src.length})`;
  if (typeof src === "object") {
    const entries = Object.entries(src as Record<string, unknown>).slice(0, 6);
    const parts = entries.map(([key, value]) => {
      if (value === null) return `${key}=null`;
      if (Array.isArray(value)) return `${key}=array(${value.length})`;
      if (typeof value === "object") return `${key}=object`;
      const text = String(value);
      return `${key}=${text.length > 40 ? `${text.slice(0, 40)}...` : text}`;
    });
    return parts.join(" / ");
  }
  const text = String(src);
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

/** 1 回に取るドキュメントの数。これより少なく返ったら続きは無い。 */
const DOCS_PAGE_SIZE = 200;

export function createElasticsearchExplorer(
  callbacks: ElasticsearchExplorerCallbacks = {},
  view: EsExplorerView = DEFAULT_VIEW,
): ElasticsearchExplorerView {
  const text = (): DbText["explorer"] =>
    (callbacks.getText?.() ?? dbText("en")).explorer;
  const tFailure = (): DbText["failure"] =>
    (callbacks.getText?.() ?? dbText("en")).failure;

  // ----- 詳細のタブ (dynamodb-explorer の structure/item タブと共通の部品) -----
  const detailTabs = createDetailTabs(
    [
      { id: "mapping", label: text().es.mapping },
      { id: "doc", label: text().es.doc },
    ] as const,
    "mapping",
    () => {
      // タブクリックだけでは selection は変わらないため notify しない
      // (mapping/doc の切替は getSelection() の内容に影響しない)。
    },
  );
  const mappingBody = detailTabs.bodies.mapping;
  const docBody = detailTabs.bodies.doc;
  const sourceRef = createRef<HTMLTextAreaElement>();
  const idRef = createRef<HTMLInputElement>();

  // ----- state -----
  let currentDbId: string | null = null;
  let currentIndex: string | null = null;
  let currentQuery = "";
  // 検索欄の文字 (前後の空白も入れたまま)。
  let queryInput = "";
  let lastSort: unknown[] | undefined;
  let loadRunId = 0;
  let docRunId = 0;
  let suppressNotify = false;
  let queryNotifyTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let indexPane: IndexPaneState = null;
  let docsPane: DocsPaneState = null;
  let mappingPane: MappingPaneState = "empty";
  let docPane: DocPaneState = "empty";
  let activeIndex: string | null = null;
  let activeDoc: string | null = null;
  let newDocShown = false;
  let moreShown = false;
  let moreDisabled = false;
  // 言語ライブ切替時に描画済みのドキュメント内容まで再ローカライズするため、
  // 直近のレスポンスを保持しておく。
  let lastDoc: EsDocResponse | null = null;
  const indexGuard = createAbortGuard();
  const mappingGuard = createAbortGuard();
  const docsGuard = createAbortGuard();
  const docGuard = createAbortGuard();

  const sidebarSlot = templateElement(
    html`<div class="db-explorer-sidebar-slot es-index-list-pane"></div>`,
  );
  const container = templateElement(html`<div class="es-explorer"></div>`);

  function sourceText(): string {
    const doc =
      typeof docPane === "object" && "doc" in docPane
        ? docPane.doc
        : typeof docPane === "object" && "edit" in docPane
          ? docPane.edit
          : null;
    if (!doc) return "";
    try {
      return JSON.stringify(doc.source, null, 2);
    } catch (err) {
      // 描けない値でもドキュメントは出す。描けなかった理由は console に残す。
      reportDatastoreFailure(
        "Elasticsearch",
        "doc render",
        err,
        doc.index,
        doc.id,
      );
      return String(doc.source);
    }
  }

  function draw(): void {
    const t = text();
    renderOwned(
      sidebarSlot,
      view.sidebar({
        text: t,
        pane: indexPane,
        activeIndex,
        indexMeta: (ix) =>
          text().es.indexMeta(
            ix.docCount.toLocaleString(),
            formatBytes(ix.sizeBytes),
          ),
        onSelectIndex: (name) => void selectIndex(name),
      }),
    );
    renderOwned(
      container,
      view.main({
        text: t,
        newDocShown,
        query: queryInput,
        docs: docsPane,
        activeDoc,
        more: { shown: moreShown, disabled: moreDisabled },
        detail: { tabs: detailTabs.tabsEl, mapping: mappingBody, doc: docBody },
        onNewDoc: showNewDocForm,
        onQueryInput: (value) => {
          // query 文字列を persist する。実検索は走らせない
          // (= ユーザーが Enter または Search を押すまで保留)。
          queryInput = value;
          currentQuery = value.trim();
          if (queryNotifyTimer) clearTimeout(queryNotifyTimer);
          queryNotifyTimer = setTimeout(() => {
            queryNotifyTimer = null;
            notifySelectionChange();
          }, 300);
        },
        onSearch: runSearch,
        onSearchKeydown: (e) => {
          if (isImeComposing(e)) return;
          if (e.key === "Enter") {
            e.preventDefault();
            runSearch();
          }
        },
        onMore: () => void loadDocs(true),
        onSelectDoc: (id) => void selectDoc(id),
      }),
    );
    renderOwned(mappingBody, view.mapping({ text: t, pane: mappingPane }));
    renderOwned(
      docBody,
      view.doc({
        text: t,
        pane: docPane,
        sourceText: sourceText(),
        sourceRef,
        idRef,
        onEdit: () => {
          if (typeof docPane === "object" && "doc" in docPane)
            startDocEdit(docPane.doc);
        },
        onDelete: () => {
          if (typeof docPane === "object" && "doc" in docPane)
            void deleteDoc(docPane.doc);
        },
        onSave: () => void saveEdit(),
        onCancelEdit: () => {
          if (typeof docPane === "object" && "edit" in docPane)
            showDoc(docPane.edit);
        },
        onCreate: (event) => {
          event.preventDefault();
          void createDoc();
        },
        onCancelCreate: () => {
          docPane = "empty";
          draw();
        },
      }),
    );
  }

  function notifySelectionChange(): void {
    if (suppressNotify) return;
    callbacks.onSelectionChange?.({
      index: currentIndex ?? undefined,
      query: currentQuery || undefined,
    });
  }

  function setDocStatus(message: string, isError = false) {
    docsPane = { status: message, error: isError };
    moreShown = false;
    draw();
  }

  function setDetailTab(tab: "mapping" | "doc") {
    detailTabs.setActive(tab);
  }

  async function postEsWrite(body: Record<string, unknown>): Promise<void> {
    const doFetch = fetch(apiUrl("dbElasticsearchWrite"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Code-Viewer-Action": "1",
      },
      body: JSON.stringify(body),
    });
    const res = await (callbacks.trackLoad
      ? callbacks.trackLoad(doFetch)
      : doFetch);
    await requireOkResponse(res, tFailure().esWrite);
  }

  function showDoc(resp: EsDocResponse): void {
    lastDoc = resp;
    docPane = { doc: resp };
    draw();
  }

  // 既存ドキュメントの _source を JSON 編集する。楽観ロック用に seqNo/
  // primaryTerm を一緒に送り、別更新との衝突を検出する。
  function startDocEdit(resp: EsDocResponse): void {
    docPane = { edit: resp, message: "", busy: false };
    draw();
    sourceRef.value?.focus();
  }

  async function saveEdit(): Promise<void> {
    if (typeof docPane !== "object" || !("edit" in docPane)) return;
    const resp = docPane.edit;
    const editor = sourceRef.value;
    if (!editor)
      throw new Error("Elasticsearch explorer: the editor was not drawn");
    let parsed: unknown;
    try {
      parsed = JSON.parse(editor.value);
    } catch (err) {
      docPane = {
        ...docPane,
        message: `${text().es.invalidJson}: ${formatErrorDetail(err)}`,
      };
      draw();
      return;
    }
    if (!currentDbId || !currentIndex) return;
    docPane = { ...docPane, busy: true, message: text().common.saving };
    draw();
    try {
      await postEsWrite({
        db: currentDbId,
        index: currentIndex,
        id: resp.id,
        source: parsed,
        seqNo: resp.seqNo,
        primaryTerm: resp.primaryTerm,
      });
      await selectDoc(resp.id);
    } catch (err) {
      docPane = {
        edit: resp,
        busy: false,
        message: text().common.saveError(
          reportDatastoreFailure(
            "Elasticsearch",
            "doc write",
            err,
            currentIndex,
            resp.id,
          ),
        ),
      };
      draw();
    }
  }

  async function deleteDoc(resp: EsDocResponse): Promise<void> {
    if (!currentDbId || !currentIndex) return;
    const ok = await showConfirmDialog({
      body: text().es.confirmDeleteDoc(resp.id),
      confirmLabel: text().common.delete,
      danger: true,
    });
    if (!ok) return;
    try {
      await postEsWrite({
        db: currentDbId,
        index: currentIndex,
        id: resp.id,
        op: "delete",
      });
      docPane = "empty";
      lastDoc = null;
      draw();
      loadDocs(false);
    } catch (err) {
      docPane = {
        status: text().common.saveError(
          reportDatastoreFailure(
            "Elasticsearch",
            "doc delete",
            err,
            currentIndex,
            resp.id,
          ),
        ),
        error: true,
      };
      draw();
    }
  }

  // 新規ドキュメント作成フォーム。id は任意 (空なら ES が自動採番)。
  function showNewDocForm(): void {
    if (!currentIndex) {
      docPane = { status: text().es.selectIndex, error: false };
      draw();
      return;
    }
    setDetailTab("doc");
    docPane = { create: true, message: "", busy: false };
    draw();
    idRef.value?.focus();
  }

  async function createDoc(): Promise<void> {
    if (typeof docPane !== "object" || !("create" in docPane)) return;
    if (!currentDbId || !currentIndex) return;
    const editor = sourceRef.value;
    const idInput = idRef.value;
    if (!editor || !idInput)
      throw new Error(
        "Elasticsearch explorer: the new document form was not drawn",
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(editor.value);
    } catch (err) {
      docPane = {
        ...docPane,
        message: `${text().es.invalidJson}: ${formatErrorDetail(err)}`,
      };
      draw();
      return;
    }
    const id = idInput.value.trim();
    docPane = { ...docPane, busy: true, message: text().common.saving };
    draw();
    try {
      await postEsWrite({
        db: currentDbId,
        index: currentIndex,
        ...(id ? { id } : {}),
        source: parsed,
        op: "create",
      });
      loadDocs(false);
      if (id) await selectDoc(id);
      else {
        docPane = "empty";
        draw();
      }
    } catch (err) {
      docPane = {
        create: true,
        busy: false,
        message: text().common.saveError(
          reportDatastoreFailure(
            "Elasticsearch",
            "doc create",
            err,
            currentIndex,
            id,
          ),
        ),
      };
      draw();
    }
  }

  async function fetchMapping(index: string): Promise<void> {
    if (disposed || !currentDbId) return;
    const slot = mappingGuard.start();
    const requestRunId = loadRunId;
    const requestDbId = currentDbId;
    mappingPane = { status: text().es.loadingMapping, error: false };
    draw();
    try {
      const params = new URLSearchParams({ db: requestDbId, index });
      const res = await fetch(`${apiUrl("dbElasticsearchMapping")}?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      await requireOkResponse(res, tFailure().esMapping);
      const data = (await res.json()) as EsMappingResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        requestDbId !== currentDbId ||
        currentIndex !== index
      ) {
        return;
      }
      mappingPane = { mapping: data };
      draw();
    } catch (err) {
      if (slot.isStale()) return;
      if (requestRunId !== loadRunId || requestDbId !== currentDbId) return;
      mappingPane = {
        status: reportDatastoreFailure("Elasticsearch", "mapping", err, index),
        error: true,
      };
      draw();
    } finally {
      slot.finish();
    }
  }

  const hasDoc = (id: string) =>
    docsPane !== null &&
    !isStatus(docsPane) &&
    docsPane.hits.some((hit) => hit._id === id);

  async function loadDocs(append: boolean): Promise<void> {
    if (disposed || !currentDbId || !currentIndex) return;
    const slot = docsGuard.start();
    const requestRunId = loadRunId;
    const requestDbId = currentDbId;
    const requestIndex = currentIndex;
    const requestQuery = currentQuery;
    moreDisabled = true;
    if (!append) {
      lastSort = undefined;
      activeDoc = null;
      setDocStatus(text().es.loadingDocs);
    } else draw();
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        index: requestIndex,
        size: String(DOCS_PAGE_SIZE),
      });
      if (requestQuery) params.set("q", requestQuery);
      if (append && lastSort)
        params.set("searchAfter", JSON.stringify(lastSort));
      const res = await fetch(`${apiUrl("dbElasticsearchDocs")}?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      await requireOkResponse(res, tFailure().esDocs);
      const data = (await res.json()) as EsDocsResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        requestDbId !== currentDbId ||
        requestIndex !== currentIndex ||
        data.index !== requestIndex ||
        requestQuery !== currentQuery
      ) {
        return;
      }
      const shown =
        append && docsPane !== null && !isStatus(docsPane) ? docsPane.hits : [];
      if (data.hits.length === 0 && !append) {
        docsPane = { status: text().es.noDocs, error: false };
      } else {
        docsPane = { hits: [...shown, ...data.hits] };
      }
      lastSort = data.lastSort;
      // 続きがないか、size を満たさない返却なら more 不要。
      moreShown = data.hits.length >= DOCS_PAGE_SIZE && !!lastSort;
      draw();
    } catch (err) {
      if (slot.isStale()) return;
      if (requestRunId !== loadRunId || requestDbId !== currentDbId) return;
      setDocStatus(
        reportDatastoreFailure(
          "Elasticsearch",
          "doc list",
          err,
          requestIndex,
          requestQuery,
        ),
        true,
      );
    } finally {
      slot.finish();
      if (!slot.isStale()) {
        moreDisabled = false;
        draw();
      }
    }
  }

  async function selectIndex(name: string): Promise<void> {
    if (disposed) return;
    currentIndex = name;
    notifySelectionChange();
    activeIndex =
      indexPane !== null &&
      !isStatus(indexPane) &&
      indexPane.indices.some((ix) => ix.name === name)
        ? name
        : null;
    lastDoc = null;
    docPane = "empty";
    setDetailTab("mapping");
    // インデックス選択後は新規ドキュメント作成を許可する。
    newDocShown = true;
    draw();
    await Promise.all([fetchMapping(name), loadDocs(false)]);
  }

  async function selectDoc(id: string): Promise<void> {
    if (disposed || !currentDbId || !currentIndex) return;
    const slot = docGuard.start();
    const requestRunId = ++docRunId;
    const requestDbId = currentDbId;
    const requestIndex = currentIndex;
    // 一覧にまだ無い (作った直後の) ドキュメントは、一覧で光らせない。
    activeDoc = hasDoc(id) ? id : null;
    setDetailTab("doc");
    docPane = { status: text().es.loadingDoc, error: false };
    draw();
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        index: requestIndex,
        id,
      });
      const res = await fetch(`${apiUrl("dbElasticsearchDoc")}?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      await requireOkResponse(res, tFailure().esDoc);
      const data = (await res.json()) as EsDocResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== docRunId ||
        requestDbId !== currentDbId ||
        requestIndex !== currentIndex ||
        id !== data.id
      ) {
        return;
      }
      showDoc(data);
    } catch (err) {
      if (slot.isStale()) return;
      if (requestRunId !== docRunId || requestDbId !== currentDbId) return;
      docPane = {
        status: reportDatastoreFailure(
          "Elasticsearch",
          "doc",
          err,
          requestIndex,
          id,
        ),
        error: true,
      };
      draw();
    } finally {
      slot.finish();
    }
  }

  function runSearch(): void {
    currentQuery = queryInput.trim();
    notifySelectionChange();
    if (!currentIndex) return;
    loadDocs(false);
  }

  // 一覧・詳細を何も選んでいない形に戻す (load と clear が使う)。
  function resetPanes(): void {
    currentIndex = null;
    lastSort = undefined;
    docsPane = null;
    activeIndex = null;
    activeDoc = null;
    lastDoc = null;
    moreShown = false;
    mappingPane = "empty";
    docPane = "empty";
    setDetailTab("mapping");
  }

  async function load(
    dbId: string,
    initial?: ElasticsearchExplorerSelection,
  ): Promise<void> {
    if (disposed) return;
    if (queryNotifyTimer) {
      clearTimeout(queryNotifyTimer);
      queryNotifyTimer = null;
    }
    if (currentDbId === dbId && !initial) return;
    indexGuard.dispose();
    mappingGuard.dispose();
    docsGuard.dispose();
    docGuard.dispose();
    const slot = indexGuard.start();
    const requestRunId = ++loadRunId;
    currentDbId = dbId;
    resetPanes();
    // 復元したい query 文字列があれば先に検索欄に乗せておく。実検索は
    // selectIndex の中で走るので、ここでは値だけセット。
    queryInput = initial?.query ?? "";
    currentQuery = queryInput.trim();
    indexPane = { status: text().es.loadingIndices, error: false };
    draw();
    try {
      const res = await fetch(
        `${apiUrl("dbElasticsearchIndices")}?db=${encodeURIComponent(dbId)}`,
        { signal: slot.signal },
      );
      if (disposed || slot.isStale()) return;
      await requireOkResponse(res, tFailure().esIndices);
      const data = (await res.json()) as EsIndicesResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        currentDbId !== dbId
      )
        return;
      indexPane =
        data.indices.length === 0
          ? { status: text().es.noIndices, error: false }
          : { indices: data.indices };
      draw();

      // initial.index が指定されていて実在するなら、その index を自動選択する
      // (= selectIndex を呼ぶと query が currentQuery に従って実行される)。
      if (
        initial?.index &&
        data.indices.some((ix) => ix.name === initial.index)
      ) {
        suppressNotify = true;
        try {
          await selectIndex(initial.index);
        } finally {
          suppressNotify = false;
        }
        notifySelectionChange();
      }
    } catch (err) {
      if (slot.isStale()) return;
      indexPane = {
        status: reportDatastoreFailure(
          "Elasticsearch",
          "index list",
          err,
          dbId,
        ),
        error: true,
      };
      draw();
    } finally {
      slot.finish();
    }
  }

  function clear(): void {
    indexGuard.dispose();
    mappingGuard.dispose();
    docsGuard.dispose();
    docGuard.dispose();
    loadRunId++;
    docRunId++;
    suppressNotify = false;
    if (queryNotifyTimer) {
      clearTimeout(queryNotifyTimer);
      queryNotifyTimer = null;
    }
    currentDbId = null;
    currentQuery = "";
    queryInput = "";
    indexPane = null;
    resetPanes();
    draw();
  }

  function getSelection(): ElasticsearchExplorerSelection {
    return {
      index: currentIndex ?? undefined,
      query: currentQuery || undefined,
    };
  }

  function dispose(): void {
    disposed = true;
    clear();
  }

  function localize(): void {
    const t = text();
    detailTabs.setLabels({ mapping: t.es.mapping, doc: t.es.doc });
    // 一覧で選んでいるドキュメントが無ければ、詳細は案内に戻す。あれば、描いた
    // ドキュメント(「(doc not found)」含む)を描き直す (書き直す欄も閉じる)。
    if (!activeDoc) docPane = "empty";
    else if (lastDoc) docPane = { doc: lastDoc };
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
