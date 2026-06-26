import type {
  ElasticsearchExplorerSelection,
  EsDocHit,
  EsDocResponse,
  EsDocsResponse,
  EsIndicesResponse,
  EsMappingResponse,
} from "../../core/database/types";
import { isImeComposing } from "../../core/keyboard";
import { formatBytes } from "../../core/source-meta";
import { createAbortGuard } from "./abort-guard";
import { type DbText, dbText } from "./i18n";
import { setPaneEmpty, setPaneStatus } from "./pane-status";

export type ElasticsearchExplorerCallbacks = {
  // 選択中の index / query 文字列が変わったことを外側に通知する。タブ
  // ごとに persist して reload 復元するために使う。
  onSelectionChange?: (selection: ElasticsearchExplorerSelection) => void;
  getText?: () => DbText;
};

export type ElasticsearchExplorerView = {
  el: HTMLElement;
  load: (
    dbId: string,
    initial?: ElasticsearchExplorerSelection,
  ) => Promise<void>;
  clear: () => void;
  dispose: () => void;
  getSelection: () => ElasticsearchExplorerSelection;
  localize: () => void;
};

export function createElasticsearchExplorer(
  callbacks: ElasticsearchExplorerCallbacks = {},
): ElasticsearchExplorerView {
  const text = (): DbText["explorer"] =>
    (callbacks.getText?.() ?? dbText("en")).explorer;
  const container = document.createElement("div");
  container.className = "es-explorer";

  // ----- pane: indices -----
  const indexListPane = document.createElement("div");
  indexListPane.className = "es-index-list-pane";

  const indexListHeader = document.createElement("div");
  indexListHeader.className = "db-explorer-pane-header";
  indexListHeader.textContent = text().es.indices;
  indexListPane.appendChild(indexListHeader);

  const indexList = document.createElement("div");
  indexList.className = "es-index-list";
  indexListPane.appendChild(indexList);

  // ----- pane: docs list -----
  const docListPane = document.createElement("div");
  docListPane.className = "es-doc-list-pane";

  const docListHeader = document.createElement("div");
  docListHeader.className = "db-explorer-pane-header";
  docListHeader.textContent = text().es.docs;
  docListPane.appendChild(docListHeader);

  const searchBar = document.createElement("div");
  searchBar.className = "es-search-bar";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = text().es.queryPlaceholder;
  searchInput.className = "es-search-input";
  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "es-search-btn";
  searchBtn.textContent = text().common.search;
  searchBar.append(searchInput, searchBtn);
  docListPane.appendChild(searchBar);

  const docList = document.createElement("div");
  docList.className = "es-doc-list";
  docListPane.appendChild(docList);

  const docMoreBtn = document.createElement("button");
  docMoreBtn.type = "button";
  docMoreBtn.className = "es-doc-more-btn";
  docMoreBtn.textContent = text().common.loadMore;
  docMoreBtn.hidden = true;
  docListPane.appendChild(docMoreBtn);

  // ----- pane: detail (mapping + doc source) -----
  const detailPane = document.createElement("div");
  detailPane.className = "es-detail-pane";

  const detailTabs = document.createElement("div");
  detailTabs.className = "es-detail-tabs";
  const tabMapping = document.createElement("button");
  tabMapping.type = "button";
  tabMapping.className = "es-detail-tab active";
  tabMapping.textContent = text().es.mapping;
  const tabDoc = document.createElement("button");
  tabDoc.type = "button";
  tabDoc.className = "es-detail-tab";
  tabDoc.textContent = text().es.doc;
  detailTabs.append(tabMapping, tabDoc);
  detailPane.appendChild(detailTabs);

  const mappingBody = document.createElement("div");
  mappingBody.className = "es-mapping-body";
  setPaneEmpty(mappingBody, text().es.selectIndex);
  const docBody = document.createElement("div");
  docBody.className = "es-doc-body";
  docBody.hidden = true;
  setPaneEmpty(docBody, text().es.selectDoc);
  detailPane.append(mappingBody, docBody);

  container.append(indexListPane, docListPane, detailPane);

  // ----- state -----
  let currentDbId: string | null = null;
  let currentIndex: string | null = null;
  let currentQuery = "";
  let lastSort: unknown[] | undefined;
  let detailTab: "mapping" | "doc" = "mapping";
  let loadRunId = 0;
  let docRunId = 0;
  let suppressNotify = false;
  let queryNotifyTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let activeIndexRow: HTMLElement | null = null;
  let activeDocRow: HTMLElement | null = null;
  // 言語ライブ切替時に描画済みのマッピング/ドキュメント内容まで再ローカライズ
  // するため、直近のレスポンスを保持しておく。
  let lastMapping: EsMappingResponse | null = null;
  let lastDoc: EsDocResponse | null = null;
  const indexRowsByName = new Map<string, HTMLElement>();
  const docRowsById = new Map<string, HTMLElement>();
  const indexGuard = createAbortGuard();
  const mappingGuard = createAbortGuard();
  const docsGuard = createAbortGuard();
  const docGuard = createAbortGuard();

  function notifySelectionChange(): void {
    if (suppressNotify) return;
    callbacks.onSelectionChange?.({
      index: currentIndex ?? undefined,
      query: currentQuery || undefined,
    });
  }

  function setIndexStatus(message: string, isError = false) {
    setPaneStatus(indexList, message, { error: isError });
  }

  function setDocStatus(message: string, isError = false) {
    setPaneStatus(docList, message, {
      error: isError,
      afterClear: () => {
        docMoreBtn.hidden = true;
      },
    });
  }

  function renderIndices(indices: EsIndicesResponse["indices"]): void {
    indexList.innerHTML = "";
    indexRowsByName.clear();
    if (indices.length === 0) {
      setIndexStatus(text().es.noIndices);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const ix of indices) {
      const item = document.createElement("div");
      item.className = "es-index-item";
      item.dataset.indexName = ix.name;
      indexRowsByName.set(ix.name, item);
      const name = document.createElement("span");
      name.className = "es-index-name";
      name.textContent = ix.name;
      name.title = ix.name;
      const meta = document.createElement("span");
      meta.className = "es-index-meta";
      meta.textContent = `${ix.docCount.toLocaleString()} docs / ${formatBytes(ix.sizeBytes)}`;
      item.append(name, meta);
      fragment.appendChild(item);
    }
    indexList.appendChild(fragment);
  }

  function highlightActiveIndex(name: string) {
    if (activeIndexRow?.dataset.indexName === name) return;
    activeIndexRow?.classList.remove("active");
    activeIndexRow = indexRowsByName.get(name) ?? null;
    activeIndexRow?.classList.add("active");
  }

  function appendDocs(hits: EsDocHit[]): void {
    const fragment = document.createDocumentFragment();
    for (const hit of hits) {
      const row = document.createElement("div");
      row.className = "es-doc-item";
      row.dataset.docId = hit._id;
      docRowsById.set(hit._id, row);
      const id = document.createElement("span");
      id.className = "es-doc-id";
      id.textContent = hit._id;
      id.title = hit._id;
      const preview = document.createElement("span");
      preview.className = "es-doc-preview";
      preview.textContent = previewSource(hit._source);
      row.append(id, preview);
      fragment.appendChild(row);
    }
    docList.appendChild(fragment);
  }

  function previewSource(src: unknown): string {
    if (src === null || src === undefined) return "";
    if (Array.isArray(src)) return `array(${src.length})`;
    if (typeof src === "object") {
      const entries = Object.entries(src as Record<string, unknown>).slice(
        0,
        6,
      );
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

  function highlightActiveDoc(id: string) {
    if (activeDocRow?.dataset.docId === id) return;
    activeDocRow?.classList.remove("active");
    activeDocRow = docRowsById.get(id) ?? null;
    activeDocRow?.classList.add("active");
  }

  function setDetailTab(tab: "mapping" | "doc") {
    detailTab = tab;
    tabMapping.classList.toggle("active", tab === "mapping");
    tabDoc.classList.toggle("active", tab === "doc");
    mappingBody.hidden = tab !== "mapping";
    docBody.hidden = tab !== "doc";
  }
  tabMapping.addEventListener("click", () => setDetailTab("mapping"));
  tabDoc.addEventListener("click", () => setDetailTab("doc"));

  function renderMapping(resp: EsMappingResponse): void {
    lastMapping = resp;
    mappingBody.innerHTML = "";
    const header = document.createElement("div");
    header.className = "es-mapping-header";
    header.textContent = resp.mapping.index;
    mappingBody.appendChild(header);
    const table = document.createElement("table");
    table.className = "es-mapping-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of [text().es.fieldHeader, text().es.typeHeader]) {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    const props = resp.mapping.properties;
    const keys = Object.keys(props).sort();
    if (keys.length === 0) {
      const row = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 2;
      td.className = "es-value-empty";
      td.textContent = text().es.noMappedFields;
      row.appendChild(td);
      tbody.appendChild(row);
    }
    for (const key of keys) {
      const row = document.createElement("tr");
      const fieldTd = document.createElement("td");
      fieldTd.className = "es-mapping-field";
      fieldTd.textContent = key;
      const typeTd = document.createElement("td");
      typeTd.className = "es-mapping-type";
      const p = props[key];
      typeTd.textContent = p.type ?? (p.properties ? "object" : "(unknown)");
      row.append(fieldTd, typeTd);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    mappingBody.appendChild(table);
  }

  function renderDoc(resp: EsDocResponse): void {
    lastDoc = resp;
    docBody.innerHTML = "";
    const header = document.createElement("div");
    header.className = "es-doc-detail-header";
    header.textContent = `${resp.index} / ${resp.id}`;
    docBody.appendChild(header);
    if (!resp.found) {
      setPaneStatus(docBody, text().es.docNotFound, {
        afterClear: () => docBody.appendChild(header),
      });
      return;
    }
    if (resp.seqNo !== undefined || resp.primaryTerm !== undefined) {
      const meta = document.createElement("div");
      meta.className = "es-doc-detail-meta";
      meta.textContent = `_seq_no=${resp.seqNo ?? "?"} _primary_term=${resp.primaryTerm ?? "?"}`;
      docBody.appendChild(meta);
    }
    const pre = document.createElement("pre");
    pre.className = "es-doc-source";
    try {
      pre.textContent = JSON.stringify(resp.source, null, 2);
    } catch {
      pre.textContent = String(resp.source);
    }
    docBody.appendChild(pre);
  }

  async function fetchMapping(index: string): Promise<void> {
    if (disposed || !currentDbId) return;
    const slot = mappingGuard.start();
    const requestRunId = loadRunId;
    const requestDbId = currentDbId;
    setPaneStatus(mappingBody, "Loading mapping...");
    try {
      const params = new URLSearchParams({ db: requestDbId, index });
      const res = await fetch(`/_db/elasticsearch/mapping?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      if (!res.ok) {
        const text = await res.text();
        setPaneStatus(mappingBody, `Error: ${text || res.statusText}`, {
          error: true,
        });
        return;
      }
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
      renderMapping(data);
    } catch (err) {
      if (slot.isStale()) return;
      if (requestRunId !== loadRunId || requestDbId !== currentDbId) return;
      setPaneStatus(
        mappingBody,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        { error: true },
      );
    } finally {
      slot.finish();
    }
  }

  async function loadDocs(append: boolean): Promise<void> {
    if (disposed || !currentDbId || !currentIndex) return;
    const slot = docsGuard.start();
    const requestRunId = loadRunId;
    const requestDbId = currentDbId;
    const requestIndex = currentIndex;
    const requestQuery = currentQuery;
    docMoreBtn.disabled = true;
    if (!append) {
      lastSort = undefined;
      setDocStatus("Loading docs...");
      docRowsById.clear();
      activeDocRow = null;
    }
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        index: requestIndex,
        size: "200",
      });
      if (requestQuery) params.set("q", requestQuery);
      if (append && lastSort)
        params.set("searchAfter", JSON.stringify(lastSort));
      const res = await fetch(`/_db/elasticsearch/docs?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      if (!res.ok) {
        const text = await res.text();
        setDocStatus(`Error: ${text || res.statusText}`, true);
        return;
      }
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
      if (!append) {
        docList.innerHTML = "";
        docRowsById.clear();
      }
      if (data.hits.length === 0 && !append) {
        setDocStatus(text().es.noDocs);
      } else {
        appendDocs(data.hits);
      }
      lastSort = data.lastSort;
      // 続きがないか、size を満たさない返却なら more 不要。
      docMoreBtn.hidden = data.hits.length < 200 || !lastSort;
    } catch (err) {
      if (slot.isStale()) return;
      if (requestRunId !== loadRunId || requestDbId !== currentDbId) return;
      setDocStatus(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    } finally {
      slot.finish();
      if (!slot.isStale()) docMoreBtn.disabled = false;
    }
  }

  async function selectIndex(name: string): Promise<void> {
    if (disposed) return;
    currentIndex = name;
    notifySelectionChange();
    highlightActiveIndex(name);
    lastDoc = null;
    docBody.innerHTML = "";
    setPaneEmpty(docBody, text().es.selectDoc);
    setDetailTab("mapping");
    await Promise.all([fetchMapping(name), loadDocs(false)]);
  }

  async function selectDoc(id: string): Promise<void> {
    if (disposed || !currentDbId || !currentIndex) return;
    const slot = docGuard.start();
    const requestRunId = ++docRunId;
    const requestDbId = currentDbId;
    const requestIndex = currentIndex;
    highlightActiveDoc(id);
    setDetailTab("doc");
    setPaneStatus(docBody, "Loading doc...");
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        index: requestIndex,
        id,
      });
      const res = await fetch(`/_db/elasticsearch/doc?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      if (!res.ok) {
        const text = await res.text();
        setPaneStatus(docBody, `Error: ${text || res.statusText}`, {
          error: true,
        });
        return;
      }
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
      renderDoc(data);
    } catch (err) {
      if (slot.isStale()) return;
      if (requestRunId !== docRunId || requestDbId !== currentDbId) return;
      setPaneStatus(
        docBody,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        { error: true },
      );
    } finally {
      slot.finish();
    }
  }

  function runSearch(): void {
    currentQuery = searchInput.value.trim();
    notifySelectionChange();
    if (!currentIndex) return;
    loadDocs(false);
  }
  searchBtn.addEventListener("click", runSearch);
  searchInput.addEventListener("keydown", (e) => {
    if (isImeComposing(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  });
  // input イベントでも query 文字列を persist する。実検索は走らせない
  // (= ユーザーが Enter または Search を押すまで保留)。
  searchInput.addEventListener("input", () => {
    currentQuery = searchInput.value.trim();
    if (queryNotifyTimer) clearTimeout(queryNotifyTimer);
    queryNotifyTimer = setTimeout(() => {
      queryNotifyTimer = null;
      notifySelectionChange();
    }, 300);
  });
  docMoreBtn.addEventListener("click", () => loadDocs(true));
  indexList.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".es-index-item",
    );
    if (!row || !indexList.contains(row)) return;
    const name = row.dataset.indexName;
    if (name) void selectIndex(name);
  });
  docList.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".es-doc-item",
    );
    if (!row || !docList.contains(row)) return;
    const id = row.dataset.docId;
    if (id) void selectDoc(id);
  });

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
    currentIndex = null;
    currentQuery = "";
    lastSort = undefined;
    // 復元したい query 文字列があれば先に searchInput に乗せておく。実検索
    // は selectIndex の中で走るので、ここでは値だけセット。
    searchInput.value = initial?.query ?? "";
    currentQuery = searchInput.value.trim();
    docList.innerHTML = "";
    docRowsById.clear();
    activeIndexRow = null;
    activeDocRow = null;
    lastMapping = null;
    lastDoc = null;
    docMoreBtn.hidden = true;
    mappingBody.innerHTML = "";
    setPaneEmpty(mappingBody, text().es.selectIndex);
    docBody.innerHTML = "";
    setPaneEmpty(docBody, text().es.selectDoc);
    setDetailTab("mapping");
    setIndexStatus(text().es.loadingIndices);
    try {
      const res = await fetch(
        `/_db/elasticsearch/indices?db=${encodeURIComponent(dbId)}`,
        { signal: slot.signal },
      );
      if (disposed || slot.isStale()) return;
      if (!res.ok) {
        const text = await res.text();
        setIndexStatus(`Error: ${text || res.statusText}`, true);
        return;
      }
      const data = (await res.json()) as EsIndicesResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        currentDbId !== dbId
      )
        return;
      renderIndices(data.indices);

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
      setIndexStatus(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
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
    currentIndex = null;
    currentQuery = "";
    lastSort = undefined;
    searchInput.value = "";
    indexList.innerHTML = "";
    docList.innerHTML = "";
    indexRowsByName.clear();
    docRowsById.clear();
    activeIndexRow = null;
    activeDocRow = null;
    lastMapping = null;
    lastDoc = null;
    docMoreBtn.hidden = true;
    mappingBody.innerHTML = "";
    setPaneEmpty(mappingBody, text().es.selectIndex);
    docBody.innerHTML = "";
    setPaneEmpty(docBody, text().es.selectDoc);
    setDetailTab("mapping");
  }

  // suppress unused diagnostic when detailTab is only used by helper.
  void detailTab;

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
    indexListHeader.textContent = t.es.indices;
    docListHeader.textContent = t.es.docs;
    searchInput.placeholder = t.es.queryPlaceholder;
    searchBtn.textContent = t.common.search;
    docMoreBtn.textContent = t.common.loadMore;
    tabMapping.textContent = t.es.mapping;
    tabDoc.textContent = t.es.doc;
    if (!currentIndex) {
      setPaneEmpty(mappingBody, t.es.selectIndex);
    } else if (lastMapping && mappingBody.querySelector(".es-mapping-table")) {
      // 描画済みのマッピングテーブル(ヘッダ/「(no mapped fields)」)を再ローカライズ。
      renderMapping(lastMapping);
    }
    if (!activeDocRow) {
      setPaneEmpty(docBody, t.es.selectDoc);
    } else if (lastDoc) {
      // 描画済みドキュメント(「(doc not found)」含む)を再ローカライズ。
      renderDoc(lastDoc);
    }
  }

  return { el: container, load, clear, dispose, getSelection, localize };
}
