import { s3ObjectName } from "../../core/database/s3-keys";
import type {
  S3BucketInfo,
  S3BucketsResponse,
  S3ExplorerSelection,
  S3ObjectHeadResponse,
  S3ObjectInfo,
  S3ObjectsResponse,
  S3ObjectTextResponse,
  S3SearchMode,
  S3SortMode,
} from "../../core/database/types";
import { isImeComposing } from "../../core/keyboard";
import { renderMarkdownPreview } from "../../core/markdown-preview";
import {
  formatBytes,
  formatFileDate,
  humanFileKind,
  sourceDisplayKind,
  sourcePreviewKind,
} from "../../core/source-meta";
import {
  appendMediaEmbed,
  renderHtmlPreviewFrame,
  renderUnsupportedPreview,
} from "../source-preview-elements";
import { createAbortGuard } from "./abort-guard";
import { setPaneStatus } from "./pane-status";

export type S3ExplorerCallbacks = {
  onSelectionChange?: (selection: S3ExplorerSelection) => void;
};

export type S3ExplorerView = {
  el: HTMLElement;
  load: (dbId: string, initial?: S3ExplorerSelection) => Promise<void>;
  clear: () => void;
  dispose: () => void;
  getSelection: () => S3ExplorerSelection;
};

function buildS3RawUrl(dbId: string, bucket: string, key: string): string {
  const params = new URLSearchParams({ db: dbId, bucket, key });
  return `/_db/s3/raw?${params}`;
}

function s3Uri(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`;
}

function objectTypeLabel(key: string, contentType?: string): string {
  const kind = sourceDisplayKind(key);
  return humanFileKind(
    key,
    contentType,
    kind === "unsupported" ? "unsupported file" : kind,
  );
}

export function createS3Explorer(
  callbacks: S3ExplorerCallbacks = {},
): S3ExplorerView {
  const container = document.createElement("div");
  container.className = "s3-explorer";

  const objectPane = document.createElement("div");
  objectPane.className = "s3-object-list-pane";

  const toolbar = document.createElement("div");
  toolbar.className = "s3-toolbar";

  const bucketRow = document.createElement("div");
  bucketRow.className = "s3-bucket-row";
  const bucketLabel = document.createElement("label");
  bucketLabel.className = "s3-field-label";
  bucketLabel.textContent = "Bucket";
  const bucketSelect = document.createElement("select");
  bucketSelect.className = "s3-bucket-select";
  bucketLabel.appendChild(bucketSelect);
  bucketRow.appendChild(bucketLabel);

  const searchRow = document.createElement("form");
  searchRow.className = "s3-search-row";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "s3-search-input";
  searchInput.placeholder = "Search objects";
  searchInput.autocomplete = "off";
  const searchBtn = document.createElement("button");
  searchBtn.type = "submit";
  searchBtn.className = "db-btn db-btn-primary s3-search-btn";
  searchBtn.textContent = "Search";
  searchRow.append(searchInput, searchBtn);

  const optionRow = document.createElement("div");
  optionRow.className = "s3-options-row";
  const modeSeg = document.createElement("div");
  modeSeg.className = "seg s3-mode-seg";
  const prefixModeBtn = document.createElement("button");
  prefixModeBtn.type = "button";
  prefixModeBtn.textContent = "Prefix";
  const containsModeBtn = document.createElement("button");
  containsModeBtn.type = "button";
  containsModeBtn.textContent = "Contains";
  modeSeg.append(prefixModeBtn, containsModeBtn);

  const sortSelect = document.createElement("select");
  sortSelect.className = "s3-sort-select";
  const sortUpdated = document.createElement("option");
  sortUpdated.value = "updated-desc";
  sortUpdated.textContent = "Updated newest";
  const sortKey = document.createElement("option");
  sortKey.value = "key-asc";
  sortKey.textContent = "Key A-Z";
  sortSelect.append(sortUpdated, sortKey);
  optionRow.append(modeSeg, sortSelect);

  toolbar.append(bucketRow, searchRow, optionRow);
  objectPane.appendChild(toolbar);

  const objectStatus = document.createElement("div");
  objectStatus.className = "s3-object-status";
  objectPane.appendChild(objectStatus);

  const objectList = document.createElement("div");
  objectList.className = "s3-object-list";
  objectPane.appendChild(objectList);

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "s3-object-more-btn";
  moreBtn.textContent = "Load more";
  moreBtn.hidden = true;
  objectPane.appendChild(moreBtn);

  const previewPane = document.createElement("div");
  previewPane.className = "s3-preview-pane";
  previewPane.textContent = "Select an object to preview.";

  container.append(objectPane, previewPane);

  let currentDbId: string | null = null;
  let currentBucket: string | null = null;
  let currentKey: string | null = null;
  let currentMode: S3SearchMode = "prefix";
  let currentSort: S3SortMode = "updated-desc";
  let currentSearch = "";
  let currentNextToken: string | undefined;
  const objectsByKey = new Map<string, S3ObjectInfo>();
  const objectRowsByKey = new Map<string, HTMLElement>();
  let disposed = false;
  let loadRunId = 0;
  let objectRunId = 0;
  let suppressNotify = false;
  let activeObjectRow: HTMLElement | null = null;
  const bucketGuard = createAbortGuard();
  const objectGuard = createAbortGuard();
  const previewGuard = createAbortGuard();

  function notifySelectionChange(): void {
    if (suppressNotify) return;
    callbacks.onSelectionChange?.(getSelection());
  }

  function setMode(mode: S3SearchMode): void {
    currentMode = mode;
    prefixModeBtn.classList.toggle("active", mode === "prefix");
    containsModeBtn.classList.toggle("active", mode === "contains");
    searchInput.placeholder =
      mode === "prefix" ? "Prefix, e.g. photos/2026/" : "Filename contains";
  }

  function renderBuckets(buckets: S3BucketInfo[]): void {
    bucketSelect.innerHTML = "";
    for (const bucket of buckets) {
      const opt = document.createElement("option");
      opt.value = bucket.name;
      opt.textContent = bucket.name;
      bucketSelect.appendChild(opt);
    }
    bucketSelect.disabled = buckets.length === 0;
  }

  function setObjectStatusFromResponse(resp: S3ObjectsResponse): void {
    objectStatus.textContent = "";
    const parts = [
      `${resp.objects.length.toLocaleString()} shown`,
      `${resp.scannedObjects.toLocaleString()} scanned`,
      resp.sort === "updated-desc"
        ? "newest first in scanned objects"
        : "sorted by key",
    ];
    if (resp.scanLimitReached) {
      parts.push(
        "scan cap reached; narrow the prefix to search more precisely",
      );
    }
    objectStatus.textContent = parts.join(" / ");
    objectStatus.classList.toggle("warn", !!resp.scanLimitReached);
  }

  function highlightActiveObject(key: string | null): void {
    if (activeObjectRow?.dataset.key === key) return;
    activeObjectRow?.classList.remove("active");
    activeObjectRow = key ? (objectRowsByKey.get(key) ?? null) : null;
    activeObjectRow?.classList.add("active");
  }

  async function fetchObjectHeadForSelection(
    key: string,
    signal: AbortSignal,
  ): Promise<S3ObjectInfo> {
    if (!currentDbId || !currentBucket) return { key, sizeBytes: 0 };
    const params = new URLSearchParams({
      db: currentDbId,
      bucket: currentBucket,
      key,
    });
    const res = await fetch(`/_db/s3/head?${params}`, { signal });
    if (!res.ok) return { key, sizeBytes: 0 };
    const data = (await res.json()) as S3ObjectHeadResponse;
    return {
      key,
      sizeBytes: data.sizeBytes ?? 0,
      ...(data.updatedAt ? { updatedAt: data.updatedAt } : {}),
      ...(data.contentType ? { contentType: data.contentType } : {}),
      ...(data.etag ? { etag: data.etag } : {}),
    };
  }

  function appendObjects(objects: S3ObjectInfo[]): void {
    const fragment = document.createDocumentFragment();
    for (const object of objects) {
      objectsByKey.set(object.key, object);
      const row = document.createElement("div");
      row.className = "s3-object-item";
      row.dataset.key = object.key;
      objectRowsByKey.set(object.key, row);

      const name = document.createElement("span");
      name.className = "s3-object-name";
      name.textContent = object.key;
      name.title = object.key;

      const meta = document.createElement("span");
      meta.className = "s3-object-meta";
      const kind = objectTypeLabel(object.key, object.contentType);
      const size = formatBytes(object.sizeBytes);
      const updated = formatFileDate(object.updatedAt);
      meta.textContent = [kind, size, updated].filter(Boolean).join(" / ");

      row.append(name, meta);
      fragment.appendChild(row);
    }
    objectList.appendChild(fragment);
  }

  async function loadObjects(append: boolean): Promise<void> {
    if (!currentDbId || !currentBucket || disposed) return;
    const slot = objectGuard.start();
    const requestRunId = loadRunId;
    const requestDbId = currentDbId;
    const requestBucket = currentBucket;
    const requestSearch = currentSearch;
    const requestMode = currentMode;
    const requestSort = currentSort;
    moreBtn.disabled = true;
    if (!append) {
      objectList.innerHTML = "";
      objectsByKey.clear();
      objectRowsByKey.clear();
      activeObjectRow = null;
      currentKey = null;
      currentNextToken = undefined;
      setPaneStatus(objectList, "Loading objects...");
      previewPane.textContent = "Select an object to preview.";
    }
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        bucket: requestBucket,
        mode: requestMode,
        sort: requestSort,
        limit: requestSort === "updated-desc" ? "1000" : "200",
      });
      if (requestMode === "prefix") {
        if (requestSearch) params.set("q", requestSearch);
      } else if (requestSearch) {
        params.set("q", requestSearch);
      }
      if (append && currentNextToken) params.set("token", currentNextToken);
      const res = await fetch(`/_db/s3/objects?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      if (!res.ok) {
        const text = await res.text();
        setPaneStatus(objectList, `Error: ${text || res.statusText}`, {
          error: true,
        });
        objectStatus.textContent = "";
        return;
      }
      const data = (await res.json()) as S3ObjectsResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        requestDbId !== currentDbId ||
        requestBucket !== currentBucket ||
        requestSearch !== currentSearch ||
        requestMode !== currentMode ||
        requestSort !== currentSort
      ) {
        return;
      }
      if (!append) objectList.innerHTML = "";
      if (data.objects.length === 0 && !append) {
        setPaneStatus(
          objectList,
          data.scanLimitReached
            ? `(no matches in the first ${data.scannedObjects.toLocaleString()} scanned objects; narrow the prefix and search again)`
            : "(no objects)",
        );
      } else {
        appendObjects(data.objects);
      }
      currentNextToken = data.nextToken;
      moreBtn.hidden = !data.nextToken;
      setObjectStatusFromResponse(data);
      highlightActiveObject(currentKey);
    } catch (err) {
      if (slot.isStale()) return;
      setPaneStatus(
        objectList,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        { error: true },
      );
      objectStatus.textContent = "";
    } finally {
      slot.finish();
      if (!slot.isStale()) moreBtn.disabled = false;
    }
  }

  function renderPreviewHeader(object: S3ObjectInfo): HTMLElement {
    const header = document.createElement("div");
    header.className = "s3-preview-header";
    const title = document.createElement("div");
    title.className = "s3-preview-title";
    title.textContent = object.key;
    title.title = object.key;
    const meta = document.createElement("div");
    meta.className = "s3-preview-meta";
    meta.textContent = [
      objectTypeLabel(object.key, object.contentType),
      formatBytes(object.sizeBytes),
      formatFileDate(object.updatedAt),
    ]
      .filter(Boolean)
      .join(" / ");
    const actions = document.createElement("div");
    actions.className = "s3-preview-actions";
    if (currentDbId && currentBucket) {
      const rawUrl = buildS3RawUrl(currentDbId, currentBucket, object.key);
      const open = document.createElement("a");
      open.className = "db-btn db-btn-sm";
      open.href = rawUrl;
      open.target = "_blank";
      open.rel = "noreferrer";
      open.textContent = "Open raw";
      const download = document.createElement("a");
      download.className = "db-btn db-btn-sm";
      download.href = rawUrl;
      download.download = s3ObjectName(object.key);
      download.textContent = "Download";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "db-btn db-btn-sm";
      copy.textContent = "Copy S3 URI";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            s3Uri(currentBucket || "", object.key),
          );
          copy.textContent = "Copied";
          window.setTimeout(() => {
            copy.textContent = "Copy S3 URI";
          }, 1200);
        } catch {
          copy.textContent = "Copy failed";
        }
      });
      actions.append(open, download, copy);
    }
    header.append(title, meta, actions);
    return header;
  }

  function renderMediaPreview(object: S3ObjectInfo, kind: string): HTMLElement {
    const view = document.createElement("div");
    view.className = `gdp-source-viewer media ${kind} s3-source-preview`;
    if (!currentDbId || !currentBucket) return view;
    const url = buildS3RawUrl(currentDbId, currentBucket, object.key);
    appendMediaEmbed(view, { url, kind, title: object.key });
    return view;
  }

  function renderUnsupported(): HTMLElement {
    return renderUnsupportedPreview({
      className: "s3-source-preview",
      message: "This object type cannot be previewed safely in the browser.",
    });
  }

  async function renderTextPreview(
    object: S3ObjectInfo,
    slot: ReturnType<typeof previewGuard.start>,
  ): Promise<HTMLElement | null> {
    if (!currentDbId || !currentBucket) return null;
    const params = new URLSearchParams({
      db: currentDbId,
      bucket: currentBucket,
      key: object.key,
    });
    const res = await fetch(`/_db/s3/text?${params}`, { signal: slot.signal });
    if (disposed || slot.isStale()) return null;
    if (!res.ok) {
      const text = await res.text();
      const error = document.createElement("div");
      error.className = "db-pane-error";
      error.textContent = text || res.statusText;
      return error;
    }
    const data = (await res.json()) as S3ObjectTextResponse;
    if (disposed || slot.isStale()) return null;
    const previewKind = sourcePreviewKind(object.key);
    let body: HTMLElement;
    if (previewKind === "html") {
      body = renderHtmlPreviewFrame(
        `${object.key} preview`,
        data.text,
        "s3-html-preview",
      );
    } else if (previewKind === "markdown") {
      body = await renderMarkdownPreview(
        data.text,
        { path: object.key, ref: "s3" },
        {
          syntaxHighlight: true,
          signal: slot.signal,
          resolveAssetUrl: (path) =>
            currentDbId && currentBucket
              ? buildS3RawUrl(currentDbId, currentBucket, path)
              : null,
        },
      );
    } else {
      const pre = document.createElement("pre");
      pre.className = "s3-text-preview";
      pre.textContent = data.text;
      body = pre;
    }
    if (data.truncated) {
      const wrap = document.createElement("div");
      wrap.className = "s3-text-preview-wrap";
      const note = document.createElement("div");
      note.className = "datastore-value-truncation";
      note.textContent = `Showing first ${formatBytes(512 * 1024)}.`;
      wrap.append(note, body);
      return wrap;
    }
    return body;
  }

  async function selectObject(object: S3ObjectInfo): Promise<void> {
    if (disposed || !currentDbId || !currentBucket) return;
    const slot = previewGuard.start();
    const requestRunId = ++objectRunId;
    const requestDbId = currentDbId;
    const requestBucket = currentBucket;
    currentKey = object.key;
    notifySelectionChange();
    highlightActiveObject(object.key);
    previewPane.innerHTML = "";
    previewPane.appendChild(renderPreviewHeader(object));
    const body = document.createElement("div");
    body.className = "s3-preview-body";
    setPaneStatus(body, "Loading preview...");
    previewPane.appendChild(body);
    try {
      const displayKind = sourceDisplayKind(object.key);
      let preview: HTMLElement | null;
      if (
        displayKind === "image" ||
        displayKind === "video" ||
        displayKind === "audio" ||
        displayKind === "pdf"
      ) {
        preview = renderMediaPreview(object, displayKind);
      } else if (displayKind === "text") {
        preview = await renderTextPreview(object, slot);
      } else {
        preview = renderUnsupported();
      }
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== objectRunId ||
        requestDbId !== currentDbId ||
        requestBucket !== currentBucket ||
        object.key !== currentKey
      ) {
        return;
      }
      body.innerHTML = "";
      if (preview) body.appendChild(preview);
    } catch (err) {
      if (slot.isStale()) return;
      setPaneStatus(
        body,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        { error: true },
      );
    } finally {
      slot.finish();
    }
  }

  async function selectBucket(bucket: string): Promise<void> {
    if (disposed || !currentDbId) return;
    currentBucket = bucket;
    currentKey = null;
    currentNextToken = undefined;
    notifySelectionChange();
    await loadObjects(false);
  }

  bucketSelect.addEventListener("change", () => {
    if (bucketSelect.value) void selectBucket(bucketSelect.value);
  });
  prefixModeBtn.addEventListener("click", () => {
    setMode("prefix");
    notifySelectionChange();
    void loadObjects(false);
  });
  containsModeBtn.addEventListener("click", () => {
    setMode("contains");
    notifySelectionChange();
    void loadObjects(false);
  });
  sortSelect.addEventListener("change", () => {
    currentSort = sortSelect.value === "key-asc" ? "key-asc" : "updated-desc";
    notifySelectionChange();
    void loadObjects(false);
  });
  searchRow.addEventListener("submit", (e) => {
    e.preventDefault();
    currentSearch = searchInput.value.trim();
    notifySelectionChange();
    void loadObjects(false);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (isImeComposing(e)) return;
    if (e.key === "Escape") {
      searchInput.value = "";
      currentSearch = "";
      notifySelectionChange();
      void loadObjects(false);
    }
  });
  moreBtn.addEventListener("click", () => loadObjects(true));
  objectList.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".s3-object-item",
    );
    if (!row || !objectList.contains(row)) return;
    const key = row.dataset.key;
    if (!key) return;
    const object = objectsByKey.get(key);
    if (object) void selectObject(object);
  });

  async function load(
    dbId: string,
    initial?: S3ExplorerSelection,
  ): Promise<void> {
    if (disposed) return;
    if (currentDbId === dbId && !initial) return;
    bucketGuard.dispose();
    objectGuard.dispose();
    previewGuard.dispose();
    const slot = bucketGuard.start();
    const requestRunId = ++loadRunId;
    const initialMode = initial?.mode === "contains" ? "contains" : "prefix";
    currentDbId = dbId;
    currentBucket = null;
    currentKey = null;
    currentSearch =
      initialMode === "contains"
        ? (initial?.query ?? "")
        : (initial?.prefix ?? "");
    currentSort = initial?.sort === "key-asc" ? "key-asc" : "updated-desc";
    setMode(initialMode);
    sortSelect.value = currentSort;
    searchInput.value = currentSearch;
    objectStatus.textContent = "";
    objectList.innerHTML = "";
    objectsByKey.clear();
    objectRowsByKey.clear();
    activeObjectRow = null;
    moreBtn.hidden = true;
    previewPane.textContent = "Select an object to preview.";
    setPaneStatus(objectList, "Loading buckets...");
    try {
      const res = await fetch(
        `/_db/s3/buckets?db=${encodeURIComponent(dbId)}`,
        { signal: slot.signal },
      );
      if (disposed || slot.isStale()) return;
      if (!res.ok) {
        const text = await res.text();
        setPaneStatus(objectList, `Error: ${text || res.statusText}`, {
          error: true,
        });
        return;
      }
      const data = (await res.json()) as S3BucketsResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        currentDbId !== dbId
      ) {
        return;
      }
      renderBuckets(data.buckets);
      const selected =
        (initial?.bucket &&
          data.buckets.some((bucket) => bucket.name === initial.bucket) &&
          initial.bucket) ||
        data.buckets[0]?.name ||
        null;
      if (!selected) {
        setPaneStatus(objectList, "(no buckets)");
        return;
      }
      bucketSelect.value = selected;
      suppressNotify = true;
      try {
        currentBucket = selected;
        currentKey = null;
        currentNextToken = undefined;
        notifySelectionChange();
        highlightActiveObject(null);
        const headPromise = initial?.key
          ? fetchObjectHeadForSelection(initial.key, slot.signal).catch(
              () => null,
            )
          : null;
        await loadObjects(false);
        if (currentDbId !== dbId) return;
        if (initial?.key) {
          const object =
            objectsByKey.get(initial.key) ||
            (headPromise ? await headPromise : null) ||
            ({ key: initial.key, sizeBytes: 0 } satisfies S3ObjectInfo);
          await selectObject(object);
        }
      } finally {
        suppressNotify = false;
      }
      notifySelectionChange();
    } catch (err) {
      if (slot.isStale()) return;
      setPaneStatus(
        objectList,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        { error: true },
      );
    } finally {
      slot.finish();
    }
  }

  function clear(): void {
    bucketGuard.dispose();
    objectGuard.dispose();
    previewGuard.dispose();
    loadRunId++;
    objectRunId++;
    suppressNotify = false;
    currentDbId = null;
    currentBucket = null;
    currentKey = null;
    currentSearch = "";
    currentNextToken = undefined;
    currentSort = "updated-desc";
    setMode("prefix");
    sortSelect.value = "updated-desc";
    searchInput.value = "";
    bucketSelect.innerHTML = "";
    objectStatus.textContent = "";
    objectList.innerHTML = "";
    objectsByKey.clear();
    objectRowsByKey.clear();
    activeObjectRow = null;
    moreBtn.hidden = true;
    previewPane.textContent = "Select an object to preview.";
  }

  function getSelection(): S3ExplorerSelection {
    return {
      bucket: currentBucket ?? undefined,
      ...(currentMode === "prefix"
        ? { prefix: currentSearch || undefined }
        : { query: currentSearch || undefined }),
      mode: currentMode,
      sort: currentSort,
      key: currentKey ?? undefined,
    };
  }

  function dispose(): void {
    disposed = true;
    clear();
  }

  setMode("prefix");

  return { el: container, load, clear, dispose, getSelection };
}
