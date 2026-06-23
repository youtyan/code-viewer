import type {
  ElasticsearchExplorerSelection,
  EsDocHit,
  EsDocResponse,
  EsDocsResponse,
  EsIndicesResponse,
  EsMappingResponse,
} from "../../core/database/types";
import { formatBytes } from "../../core/source-meta";

export type ElasticsearchExplorerCallbacks = {
  // 選択中の index / query 文字列が変わったことを外側に通知する。タブ
  // ごとに persist して reload 復元するために使う。
  onSelectionChange?: (selection: ElasticsearchExplorerSelection) => void;
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
};

export function createElasticsearchExplorer(
  callbacks: ElasticsearchExplorerCallbacks = {},
): ElasticsearchExplorerView {
  const container = document.createElement("div");
  container.className = "es-explorer";

  // ----- pane: indices -----
  const indexListPane = document.createElement("div");
  indexListPane.className = "es-index-list-pane";

  const indexListHeader = document.createElement("div");
  indexListHeader.className = "es-pane-header";
  indexListHeader.textContent = "Indices";
  indexListPane.appendChild(indexListHeader);

  const indexList = document.createElement("div");
  indexList.className = "es-index-list";
  indexListPane.appendChild(indexList);

  // ----- pane: docs list -----
  const docListPane = document.createElement("div");
  docListPane.className = "es-doc-list-pane";

  const docListHeader = document.createElement("div");
  docListHeader.className = "es-pane-header";
  docListHeader.textContent = "Docs";
  docListPane.appendChild(docListHeader);

  const searchBar = document.createElement("div");
  searchBar.className = "es-search-bar";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "lucene query (e.g. field:value)";
  searchInput.className = "es-search-input";
  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "es-search-btn";
  searchBtn.textContent = "Search";
  searchBar.append(searchInput, searchBtn);
  docListPane.appendChild(searchBar);

  const docList = document.createElement("div");
  docList.className = "es-doc-list";
  docListPane.appendChild(docList);

  const docMoreBtn = document.createElement("button");
  docMoreBtn.type = "button";
  docMoreBtn.className = "es-doc-more-btn";
  docMoreBtn.textContent = "Load more";
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
  tabMapping.textContent = "Mapping";
  const tabDoc = document.createElement("button");
  tabDoc.type = "button";
  tabDoc.className = "es-detail-tab";
  tabDoc.textContent = "Doc";
  detailTabs.append(tabMapping, tabDoc);
  detailPane.appendChild(detailTabs);

  const mappingBody = document.createElement("div");
  mappingBody.className = "es-mapping-body";
  mappingBody.textContent = "Select an index to view its mapping.";
  const docBody = document.createElement("div");
  docBody.className = "es-doc-body";
  docBody.hidden = true;
  docBody.textContent = "Select a doc to view its _source.";
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
  let indexAbort: AbortController | null = null;
  let mappingAbort: AbortController | null = null;
  let docsAbort: AbortController | null = null;
  let docAbort: AbortController | null = null;

  function notifySelectionChange(): void {
    if (suppressNotify) return;
    callbacks.onSelectionChange?.({
      index: currentIndex ?? undefined,
      query: currentQuery || undefined,
    });
  }

  function setIndexStatus(message: string, isError = false) {
    indexList.innerHTML = "";
    const note = document.createElement("div");
    note.className = isError ? "es-error" : "es-note";
    note.textContent = message;
    indexList.appendChild(note);
  }

  function setDocStatus(message: string, isError = false) {
    docList.innerHTML = "";
    const note = document.createElement("div");
    note.className = isError ? "es-error" : "es-note";
    note.textContent = message;
    docList.appendChild(note);
    docMoreBtn.hidden = true;
  }

  function renderIndices(indices: EsIndicesResponse["indices"]): void {
    indexList.innerHTML = "";
    if (indices.length === 0) {
      setIndexStatus("(no indices)");
      return;
    }
    for (const ix of indices) {
      const item = document.createElement("div");
      item.className = "es-index-item";
      item.dataset.indexName = ix.name;
      const name = document.createElement("span");
      name.className = "es-index-name";
      name.textContent = ix.name;
      name.title = ix.name;
      const meta = document.createElement("span");
      meta.className = "es-index-meta";
      meta.textContent = `${ix.docCount.toLocaleString()} docs / ${formatBytes(ix.sizeBytes)}`;
      item.append(name, meta);
      item.addEventListener("click", () => selectIndex(ix.name));
      indexList.appendChild(item);
    }
  }

  function highlightActiveIndex(name: string) {
    for (const item of indexList.querySelectorAll<HTMLElement>(
      ".es-index-item",
    )) {
      item.classList.toggle("active", item.dataset.indexName === name);
    }
  }

  function appendDocs(hits: EsDocHit[]): void {
    for (const hit of hits) {
      const row = document.createElement("div");
      row.className = "es-doc-item";
      row.dataset.docId = hit._id;
      const id = document.createElement("span");
      id.className = "es-doc-id";
      id.textContent = hit._id;
      id.title = hit._id;
      const preview = document.createElement("span");
      preview.className = "es-doc-preview";
      preview.textContent = previewSource(hit._source);
      row.append(id, preview);
      row.addEventListener("click", () => selectDoc(hit._id));
      docList.appendChild(row);
    }
  }

  function previewSource(src: unknown): string {
    if (src === null || src === undefined) return "";
    try {
      const s = JSON.stringify(src);
      return s.length > 200 ? `${s.slice(0, 200)}…` : s;
    } catch {
      return String(src);
    }
  }

  function highlightActiveDoc(id: string) {
    for (const row of docList.querySelectorAll<HTMLElement>(".es-doc-item")) {
      row.classList.toggle("active", row.dataset.docId === id);
    }
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
    mappingBody.innerHTML = "";
    const header = document.createElement("div");
    header.className = "es-mapping-header";
    header.textContent = resp.mapping.index;
    mappingBody.appendChild(header);
    const table = document.createElement("table");
    table.className = "es-mapping-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of ["Field", "Type"]) {
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
      td.textContent = "(no mapped fields)";
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
    docBody.innerHTML = "";
    const header = document.createElement("div");
    header.className = "es-doc-detail-header";
    header.textContent = `${resp.index} / ${resp.id}`;
    docBody.appendChild(header);
    if (!resp.found) {
      const note = document.createElement("div");
      note.className = "es-note";
      note.textContent = "(doc not found)";
      docBody.appendChild(note);
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
    mappingAbort?.abort();
    const abort = new AbortController();
    mappingAbort = abort;
    const requestRunId = loadRunId;
    const requestDbId = currentDbId;
    mappingBody.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "es-note";
    loading.textContent = "Loading mapping...";
    mappingBody.appendChild(loading);
    try {
      const params = new URLSearchParams({ db: requestDbId, index });
      const res = await fetch(`/_db/elasticsearch/mapping?${params}`, {
        signal: abort.signal,
      });
      if (disposed || abort.signal.aborted) return;
      if (!res.ok) {
        const text = await res.text();
        mappingBody.innerHTML = "";
        const err = document.createElement("div");
        err.className = "es-error";
        err.textContent = `Error: ${text || res.statusText}`;
        mappingBody.appendChild(err);
        return;
      }
      const data = (await res.json()) as EsMappingResponse;
      if (
        disposed ||
        requestRunId !== loadRunId ||
        requestDbId !== currentDbId ||
        currentIndex !== index
      ) {
        return;
      }
      renderMapping(data);
    } catch (err) {
      if (abort.signal.aborted) return;
      if (requestRunId !== loadRunId || requestDbId !== currentDbId) return;
      mappingBody.innerHTML = "";
      const errEl = document.createElement("div");
      errEl.className = "es-error";
      errEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      mappingBody.appendChild(errEl);
    } finally {
      if (mappingAbort === abort) mappingAbort = null;
    }
  }

  async function loadDocs(append: boolean): Promise<void> {
    if (disposed || !currentDbId || !currentIndex) return;
    docsAbort?.abort();
    const abort = new AbortController();
    docsAbort = abort;
    const requestRunId = loadRunId;
    const requestDbId = currentDbId;
    const requestIndex = currentIndex;
    const requestQuery = currentQuery;
    docMoreBtn.disabled = true;
    if (!append) {
      lastSort = undefined;
      setDocStatus("Loading docs...");
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
        signal: abort.signal,
      });
      if (disposed || abort.signal.aborted) return;
      if (!res.ok) {
        const text = await res.text();
        setDocStatus(`Error: ${text || res.statusText}`, true);
        return;
      }
      const data = (await res.json()) as EsDocsResponse;
      if (
        disposed ||
        requestRunId !== loadRunId ||
        requestDbId !== currentDbId ||
        requestIndex !== currentIndex ||
        data.index !== requestIndex ||
        requestQuery !== currentQuery
      ) {
        return;
      }
      if (!append) docList.innerHTML = "";
      if (data.hits.length === 0 && !append) {
        setDocStatus("(no docs)");
      } else {
        appendDocs(data.hits);
      }
      lastSort = data.lastSort;
      // 続きがないか、size を満たさない返却なら more 不要。
      docMoreBtn.hidden = data.hits.length < 200 || !lastSort;
    } catch (err) {
      if (abort.signal.aborted) return;
      if (requestRunId !== loadRunId || requestDbId !== currentDbId) return;
      setDocStatus(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    } finally {
      if (docsAbort === abort) docsAbort = null;
      if (!docsAbort) docMoreBtn.disabled = false;
    }
  }

  async function selectIndex(name: string): Promise<void> {
    if (disposed) return;
    currentIndex = name;
    notifySelectionChange();
    highlightActiveIndex(name);
    docBody.innerHTML = "";
    docBody.textContent = "Select a doc to view its _source.";
    setDetailTab("mapping");
    await Promise.all([fetchMapping(name), loadDocs(false)]);
  }

  async function selectDoc(id: string): Promise<void> {
    if (disposed || !currentDbId || !currentIndex) return;
    docAbort?.abort();
    const abort = new AbortController();
    docAbort = abort;
    const requestRunId = ++docRunId;
    const requestDbId = currentDbId;
    const requestIndex = currentIndex;
    highlightActiveDoc(id);
    setDetailTab("doc");
    docBody.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "es-note";
    loading.textContent = "Loading doc...";
    docBody.appendChild(loading);
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        index: requestIndex,
        id,
      });
      const res = await fetch(`/_db/elasticsearch/doc?${params}`, {
        signal: abort.signal,
      });
      if (disposed || abort.signal.aborted) return;
      if (!res.ok) {
        const text = await res.text();
        docBody.innerHTML = "";
        const err = document.createElement("div");
        err.className = "es-error";
        err.textContent = `Error: ${text || res.statusText}`;
        docBody.appendChild(err);
        return;
      }
      const data = (await res.json()) as EsDocResponse;
      if (
        disposed ||
        requestRunId !== docRunId ||
        requestDbId !== currentDbId ||
        requestIndex !== currentIndex ||
        id !== data.id
      ) {
        return;
      }
      renderDoc(data);
    } catch (err) {
      if (abort.signal.aborted) return;
      if (requestRunId !== docRunId || requestDbId !== currentDbId) return;
      docBody.innerHTML = "";
      const errEl = document.createElement("div");
      errEl.className = "es-error";
      errEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      docBody.appendChild(errEl);
    } finally {
      if (docAbort === abort) docAbort = null;
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
    indexAbort?.abort();
    mappingAbort?.abort();
    docsAbort?.abort();
    docAbort?.abort();
    const abort = new AbortController();
    indexAbort = abort;
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
    docMoreBtn.hidden = true;
    mappingBody.innerHTML = "";
    mappingBody.textContent = "Select an index to view its mapping.";
    docBody.innerHTML = "";
    docBody.textContent = "Select a doc to view its _source.";
    setDetailTab("mapping");
    setIndexStatus("Loading indices...");
    try {
      const res = await fetch(
        `/_db/elasticsearch/indices?db=${encodeURIComponent(dbId)}`,
        { signal: abort.signal },
      );
      if (disposed || abort.signal.aborted) return;
      if (!res.ok) {
        const text = await res.text();
        setIndexStatus(`Error: ${text || res.statusText}`, true);
        return;
      }
      const data = (await res.json()) as EsIndicesResponse;
      if (disposed || requestRunId !== loadRunId || currentDbId !== dbId)
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
      if (abort.signal.aborted) return;
      setIndexStatus(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    } finally {
      if (indexAbort === abort) indexAbort = null;
    }
  }

  function clear(): void {
    indexAbort?.abort();
    mappingAbort?.abort();
    docsAbort?.abort();
    docAbort?.abort();
    indexAbort = null;
    mappingAbort = null;
    docsAbort = null;
    docAbort = null;
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
    docMoreBtn.hidden = true;
    mappingBody.innerHTML = "";
    mappingBody.textContent = "Select an index to view its mapping.";
    docBody.innerHTML = "";
    docBody.textContent = "Select a doc to view its _source.";
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

  return { el: container, load, clear, dispose, getSelection };
}
