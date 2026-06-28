import { s3ObjectName } from "../../core/database/s3-keys";
import type {
  S3BucketInfo,
  S3BucketsResponse,
  S3ExplorerSelection,
  S3FolderResponse,
  S3ObjectHeadResponse,
  S3ObjectInfo,
  S3ObjectsResponse,
  S3ObjectTextResponse,
  S3SearchMode,
  S3SortMode,
  S3ViewMode,
} from "../../core/database/types";
import {
  CHEVRON_DOWN_12_PATH,
  FOLDER_ICON_PATHS,
  iconSvg,
} from "../../core/icons";
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
import { type DbText, dbText } from "./i18n";
import { setPaneEmpty, setPaneStatus } from "./pane-status";
import { makePrefToggle } from "./pref-toggle";

export type S3ExplorerCallbacks = {
  onSelectionChange?: (selection: S3ExplorerSelection) => void;
  getText?: () => DbText;
  // ホバープレビュー tooltip の ON/OFF (db-ui.json の prefs に永続化)。
  // localStorage は使わない。callback 未指定なら ON 固定で永続化なし。
  getTooltipEnabled?: () => boolean;
  setTooltipEnabled?: (enabled: boolean) => void;
  // 書き込み fetch を共通の in-flight 追跡に乗せる。未指定なら素通し。
  trackLoad?: <T>(promise: Promise<T>) => Promise<T>;
};

export type S3ExplorerView = {
  el: HTMLElement;
  // Bucket セレクタと List/Explorer 切替セグメント。空 datastore-sidebar
  // (kind=s3 のとき空白) を有効活用するため、左サイドバーの dbToolbar 直下に
  // mount される。el には含まれない。
  sidebarSlot: HTMLElement;
  load: (dbId: string, initial?: S3ExplorerSelection) => Promise<void>;
  clear: () => void;
  dispose: () => void;
  getSelection: () => S3ExplorerSelection;
  localize: () => void;
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

// ファイル種別をひと目で判別できる短いラベル。詳細 (例: "PNG image") は
// title 属性に出す。
const KIND_LABELS: Record<
  ReturnType<typeof sourceDisplayKind>,
  { text: string; cls: string }
> = {
  image: { text: "Image", cls: "kind-image" },
  video: { text: "Video", cls: "kind-video" },
  audio: { text: "Audio", cls: "kind-audio" },
  pdf: { text: "PDF", cls: "kind-pdf" },
  text: { text: "Text", cls: "kind-text" },
  unsupported: { text: "Binary", cls: "kind-binary" },
};

function createKindBadge(key: string, contentType?: string): HTMLElement {
  const { text, cls } = KIND_LABELS[sourceDisplayKind(key)];
  const badge = document.createElement("span");
  badge.className = `s3-kind-badge ${cls}`;
  badge.textContent = text;
  badge.title = objectTypeLabel(key, contentType);
  return badge;
}

// folderPrefix は末尾 "/" を含むフルパス ("a/b/")。表示名は末尾セグメント。
function folderDisplayName(folderPrefix: string): string {
  const trimmed = folderPrefix.replace(/\/$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function setExplorerFolderIcon(el: HTMLElement, collapsed: boolean): void {
  el.innerHTML = iconSvg(
    collapsed
      ? "octicon-file-directory-fill"
      : "octicon-file-directory-open-fill",
    collapsed ? FOLDER_ICON_PATHS.closed : FOLDER_ICON_PATHS.open,
  );
}

export function createS3Explorer(
  callbacks: S3ExplorerCallbacks = {},
): S3ExplorerView {
  const text = (): DbText["explorer"]["s3"] =>
    (callbacks.getText?.() ?? dbText("en")).explorer.s3;
  const tCommon = (): DbText["explorer"]["common"] =>
    (callbacks.getText?.() ?? dbText("en")).explorer.common;
  const container = document.createElement("div");
  container.className = "s3-explorer";

  // 左サイドバー (db-sidebar) の dbToolbar 直下にぶら下がる、Bucket セレクタ +
  // List/Explorer セグメント。container には append しない。
  const sidebarSlot = document.createElement("div");
  sidebarSlot.className = "db-explorer-sidebar-slot s3-sidebar-slot";

  const bucketRow = document.createElement("div");
  bucketRow.className = "s3-bucket-row";
  const bucketLabel = document.createElement("label");
  bucketLabel.className = "s3-field-label";
  bucketLabel.textContent = text().bucket;
  const bucketSelect = document.createElement("select");
  bucketSelect.className = "s3-bucket-select";
  bucketLabel.appendChild(bucketSelect);
  bucketRow.appendChild(bucketLabel);

  // List (フラット一覧) と Explorer (フォルダツリー) の切替。既存の .seg
  // パターンを踏襲。
  const viewSeg = document.createElement("div");
  viewSeg.className = "seg s3-view-seg";
  const listViewBtn = document.createElement("button");
  listViewBtn.type = "button";
  listViewBtn.textContent = "List";
  const explorerViewBtn = document.createElement("button");
  explorerViewBtn.type = "button";
  explorerViewBtn.textContent = "Explorer";
  viewSeg.append(listViewBtn, explorerViewBtn);
  bucketRow.appendChild(viewSeg);

  // ホバー tooltip ON/OFF。db-ui.json の prefs.s3TooltipEnabled に永続化、
  // default ON。画像プレビュー込みで重く感じる場合のオフスイッチ。共通の
  // .db-pref-toggle スタイルを使い、bucketRow 内で stretch しないよう
  // .s3-tooltip-toggle で align-self を上書き。
  const tooltipToggle = makePrefToggle({
    title: "Toggle hover preview tooltip",
    label: "Hover preview",
    pathD:
      "M8 3.5C4.5 3.5 1.7 5.7 0 8c1.7 2.3 4.5 4.5 8 4.5s6.3-2.2 8-4.5C14.3 5.7 11.5 3.5 8 3.5Zm0 7.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
    extraClass: "s3-tooltip-toggle",
  });
  bucketRow.appendChild(tooltipToggle);
  sidebarSlot.appendChild(bucketRow);

  // List/Explorer 共通: 検索バー / モード / sort / オブジェクトリスト /
  // ツリーは全部 sidebarSlot に積む。右側はプレビューだけが残る。
  const searchRow = document.createElement("form");
  searchRow.className = "s3-search-row";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "s3-search-input";
  searchInput.placeholder = text().searchPlaceholder;
  searchInput.autocomplete = "off";
  const searchBtn = document.createElement("button");
  searchBtn.type = "submit";
  searchBtn.className = "db-btn db-btn-primary s3-search-btn";
  searchBtn.textContent = tCommon().search;
  searchRow.append(searchInput, searchBtn);
  sidebarSlot.appendChild(searchRow);

  const optionRow = document.createElement("div");
  optionRow.className = "s3-options-row";
  const modeSeg = document.createElement("div");
  modeSeg.className = "seg s3-mode-seg";
  const prefixModeBtn = document.createElement("button");
  prefixModeBtn.type = "button";
  prefixModeBtn.textContent = text().prefixMode;
  const containsModeBtn = document.createElement("button");
  containsModeBtn.type = "button";
  containsModeBtn.textContent = text().containsMode;
  modeSeg.append(prefixModeBtn, containsModeBtn);

  const sortSelect = document.createElement("select");
  sortSelect.className = "s3-sort-select";
  const sortUpdated = document.createElement("option");
  sortUpdated.value = "updated-desc";
  sortUpdated.textContent = text().sortUpdated;
  const sortKey = document.createElement("option");
  sortKey.value = "key-asc";
  sortKey.textContent = text().sortKey;
  sortSelect.append(sortUpdated, sortKey);
  const newObjectBtn = document.createElement("button");
  newObjectBtn.type = "button";
  newObjectBtn.className = "db-btn db-btn-sm s3-new-object-btn";
  newObjectBtn.textContent = `＋ ${text().newObject}`;
  newObjectBtn.title = text().newObject;
  newObjectBtn.hidden = true;
  optionRow.append(modeSeg, sortSelect, newObjectBtn);
  sidebarSlot.appendChild(optionRow);

  const objectStatus = document.createElement("div");
  objectStatus.className = "s3-object-status";
  sidebarSlot.appendChild(objectStatus);

  const objectList = document.createElement("div");
  objectList.className = "s3-object-list";
  sidebarSlot.appendChild(objectList);

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "s3-object-more-btn";
  moreBtn.textContent = tCommon().loadMore;
  moreBtn.hidden = true;
  sidebarSlot.appendChild(moreBtn);

  // Explorer 表示: 既存ツリーと同じ DOM/クラス (.tree, .tree-dir, .tree-file,
  // .chev, .dir-icon ...) を使い、データは delimiter ベースの遅延ロードで賄う。
  // sidebarSlot 内で List のオブジェクトリストと同じ位置に置き、表示は
  // applyViewVisibility で排他切替する。
  const explorerTree = document.createElement("div");
  explorerTree.className = "s3-object-list s3-tree tree";
  explorerTree.hidden = true;
  sidebarSlot.appendChild(explorerTree);

  const previewPane = document.createElement("div");
  previewPane.className = "s3-preview-pane";
  setPaneEmpty(previewPane, text().selectObject);

  container.append(previewPane);

  let currentDbId: string | null = null;
  let currentBucket: string | null = null;
  let currentKey: string | null = null;
  let currentMode: S3SearchMode = "prefix";
  let currentSort: S3SortMode = "updated-desc";
  let currentSearch = "";
  let currentView: S3ViewMode = "list";
  let currentNextToken: string | undefined;
  const objectsByKey = new Map<string, S3ObjectInfo>();
  const objectRowsByKey = new Map<string, HTMLElement>();
  // Explorer 表示の状態。folder prefix ("a/b/") 単位でロード済み/ロード中を管理。
  const explorerRowsByKey = new Map<string, HTMLElement>();
  const explorerLoadedFolders = new Set<string>();
  const explorerLoadingFolders = new Map<string, Promise<void>>();
  // 各階層 (container prefix) の追加ページ取得関数。1 ページ追加できれば true。
  const explorerPagerByPrefix = new Map<string, () => Promise<boolean>>();
  // バケット/DB 切替・dispose 時に進行中の folder fetch をまとめて中断する。
  let explorerAbort: AbortController | null = null;
  let explorerRootLoaded = false;
  let listLoaded = false;
  let disposed = false;
  let loadRunId = 0;
  let objectRunId = 0;
  let suppressNotify = false;
  let activeObjectRow: HTMLElement | null = null;
  const bucketGuard = createAbortGuard();
  const objectGuard = createAbortGuard();
  const previewGuard = createAbortGuard();
  const explorerGuard = createAbortGuard();

  function notifySelectionChange(): void {
    if (suppressNotify) return;
    callbacks.onSelectionChange?.(getSelection());
  }

  // ----- ホバーで全パスを表示する floating tooltip -----
  // sidebar 内では key 末尾しか見えないので、行ホバーで全 key + メタを別 DOM
  // に展開する。preview pane 側へはみ出して読めるよう document.body に attach。
  // 状態は db-ui.json の prefs.s3TooltipEnabled に集約 (localStorage は使わない)。
  // callback 未提供時は ON 固定で永続化なし。
  let tooltipEnabled = callbacks.getTooltipEnabled?.() ?? true;

  function applyTooltipToggleState(): void {
    tooltipToggle.classList.toggle("active", tooltipEnabled);
    tooltipToggle.setAttribute("aria-pressed", String(tooltipEnabled));
  }
  applyTooltipToggleState();

  tooltipToggle.addEventListener("click", () => {
    tooltipEnabled = !tooltipEnabled;
    callbacks.setTooltipEnabled?.(tooltipEnabled);
    applyTooltipToggleState();
    if (!tooltipEnabled) hideKeyTooltip();
  });

  const keyTooltip = document.createElement("div");
  keyTooltip.className = "s3-key-tooltip";
  keyTooltip.hidden = true;
  document.body.appendChild(keyTooltip);

  function positionKeyTooltip(row: HTMLElement): void {
    // 画像など中身の load 完了でサイズが伸びることがあるので、表示直後と
    // load 後の双方から呼ばれる。
    const rect = row.getBoundingClientRect();
    const tw = keyTooltip.offsetWidth;
    const th = keyTooltip.offsetHeight;
    const gap = 8;
    const fitsRight = rect.right + gap + tw < window.innerWidth - 8;
    const left = fitsRight
      ? rect.right + gap
      : Math.max(8, rect.left - tw - gap);
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - th - 8));
    keyTooltip.style.left = `${left}px`;
    keyTooltip.style.top = `${top}px`;
  }

  function showKeyTooltip(row: HTMLElement, object: S3ObjectInfo): void {
    if (!tooltipEnabled) return;
    keyTooltip.innerHTML = "";

    // 画像オブジェクトのときはサムネイルを上に挟む。s3-preview の raw URL
    // をそのまま <img> に渡すだけ。max-width / max-height で抑える。
    if (currentDbId && currentBucket) {
      const displayKind = sourceDisplayKind(object.key);
      if (displayKind === "image") {
        const img = document.createElement("img");
        img.className = "s3-key-tooltip-image";
        img.src = buildS3RawUrl(currentDbId, currentBucket, object.key);
        img.alt = "";
        img.decoding = "async";
        img.loading = "lazy";
        // load 完了で実サイズが反映された後に再 position する (はみ出し回避)。
        img.addEventListener("load", () => positionKeyTooltip(row), {
          once: true,
        });
        img.addEventListener("error", () => img.remove(), { once: true });
        keyTooltip.appendChild(img);
      }
    }

    const path = document.createElement("div");
    path.className = "s3-key-tooltip-path";
    path.textContent = object.key;
    keyTooltip.appendChild(path);
    const metaText = [
      objectTypeLabel(object.key, object.contentType),
      formatBytes(object.sizeBytes),
      formatFileDate(object.updatedAt),
    ]
      .filter(Boolean)
      .join(" / ");
    if (metaText) {
      const meta = document.createElement("div");
      meta.className = "s3-key-tooltip-meta";
      meta.textContent = metaText;
      keyTooltip.appendChild(meta);
    }
    // position 計算前に offset を取りたいので一旦表示する。
    keyTooltip.hidden = false;
    keyTooltip.style.left = "0px";
    keyTooltip.style.top = "0px";
    positionKeyTooltip(row);
  }

  function hideKeyTooltip(): void {
    if (tooltipShowTimer !== null) {
      clearTimeout(tooltipShowTimer);
      tooltipShowTimer = null;
    }
    keyTooltip.hidden = true;
  }

  // 行の高速スイープでも `<img src>` が連発しないよう、表示を 150ms 遅らせる。
  // 途中で mouseleave が来たら timer をクリアして画像取得自体を起こさない。
  const TOOLTIP_SHOW_DELAY_MS = 150;
  let tooltipShowTimer: ReturnType<typeof setTimeout> | null = null;

  function attachKeyTooltip(row: HTMLElement, object: S3ObjectInfo): void {
    row.addEventListener("mouseenter", () => {
      if (tooltipShowTimer !== null) clearTimeout(tooltipShowTimer);
      tooltipShowTimer = setTimeout(() => {
        tooltipShowTimer = null;
        showKeyTooltip(row, object);
      }, TOOLTIP_SHOW_DELAY_MS);
    });
    row.addEventListener("mouseleave", hideKeyTooltip);
  }

  function setMode(mode: S3SearchMode): void {
    currentMode = mode;
    prefixModeBtn.classList.toggle("active", mode === "prefix");
    containsModeBtn.classList.toggle("active", mode === "contains");
    searchInput.placeholder =
      mode === "prefix" ? text().prefixPlaceholder : text().containsPlaceholder;
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
    const rows =
      currentView === "explorer" ? explorerRowsByKey : objectRowsByKey;
    // ノード同一性で比較する。キー一致だけで早期 return すると、再描画で
    // 行が差し替わったときに古い (detached な) 行を指したままになる。
    const target = key ? (rows.get(key) ?? null) : null;
    if (target === activeObjectRow) return;
    activeObjectRow?.classList.remove("active");
    activeObjectRow = target;
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

  function splitKey(key: string): { parent: string; name: string } {
    const lastSlash = key.lastIndexOf("/");
    return lastSlash >= 0
      ? { parent: key.slice(0, lastSlash + 1), name: key.slice(lastSlash + 1) }
      : { parent: "", name: key };
  }

  function appendObjects(objects: S3ObjectInfo[]): void {
    const fragment = document.createDocumentFragment();
    for (const object of objects) {
      objectsByKey.set(object.key, object);
      const row = document.createElement("div");
      row.className = "s3-object-item";
      row.dataset.key = object.key;
      objectRowsByKey.set(object.key, row);

      const { parent, name: fileName } = splitKey(object.key);
      // 1 行目: 親パス (薄)。サイドバー狭幅でも判別できるよう、末尾を省略。
      if (parent) {
        const parentEl = document.createElement("div");
        parentEl.className = "s3-object-parent";
        parentEl.textContent = parent;
        row.appendChild(parentEl);
      }
      // 2 行目: kindBadge + ファイル名 (主役)。末尾セグメントだけにして
      // 短い key 名に最大限の表示幅を渡す。
      const head = document.createElement("div");
      head.className = "s3-object-head";
      const name = document.createElement("span");
      name.className = "s3-object-name";
      name.textContent = fileName;
      head.append(createKindBadge(object.key, object.contentType), name);
      row.appendChild(head);
      // 3 行目: メタ。
      const meta = document.createElement("span");
      meta.className = "s3-object-meta";
      const kind = objectTypeLabel(object.key, object.contentType);
      const size = formatBytes(object.sizeBytes);
      const updated = formatFileDate(object.updatedAt);
      meta.textContent = [kind, size, updated].filter(Boolean).join(" / ");
      row.appendChild(meta);

      attachKeyTooltip(row, object);
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
      listLoaded = true;
      objectList.innerHTML = "";
      objectsByKey.clear();
      objectRowsByKey.clear();
      activeObjectRow = null;
      currentKey = null;
      currentNextToken = undefined;
      setPaneStatus(objectList, "Loading objects...");
      setPaneEmpty(previewPane, text().selectObject);
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
            : text().noObjects,
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

  function mkBtn(label: string, cls: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    return b;
  }

  async function postS3Write(body: Record<string, unknown>): Promise<void> {
    const doFetch = fetch("/_db/s3/write", {
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
    if (!res.ok) throw new Error((await res.text()) || res.statusText);
  }

  function refreshObjectList(): void {
    if (currentView === "explorer") void loadExplorerRoot();
    else void loadObjects(false);
  }

  // テキストオブジェクトの内容を取得して textarea 編集する。保存は PUT (上書き)。
  async function startObjectEdit(object: S3ObjectInfo): Promise<void> {
    if (!currentDbId || !currentBucket) return;
    const bodyEl = previewPane.querySelector<HTMLElement>(".s3-preview-body");
    if (!bodyEl) return;
    setPaneStatus(bodyEl, tCommon().saving);
    let current = "";
    try {
      const params = new URLSearchParams({
        db: currentDbId,
        bucket: currentBucket,
        key: object.key,
      });
      const res = await fetch(`/_db/s3/text?${params}`);
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      current = ((await res.json()) as S3ObjectTextResponse).text;
    } catch (err) {
      setPaneStatus(
        bodyEl,
        tCommon().saveError(err instanceof Error ? err.message : String(err)),
        { error: true },
      );
      return;
    }
    bodyEl.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "s3-edit-bar";
    const save = mkBtn(tCommon().save, "db-btn db-btn-primary db-btn-sm");
    const cancel = mkBtn(tCommon().cancel, "db-btn db-btn-sm");
    const status = document.createElement("span");
    status.className = "s3-edit-status";
    bar.append(save, cancel, status);
    const ta = document.createElement("textarea");
    ta.className = "s3-edit-textarea";
    ta.value = current;
    bodyEl.append(bar, ta);
    cancel.addEventListener("click", () => void selectObject(object));
    save.addEventListener("click", async () => {
      if (!currentDbId || !currentBucket) return;
      save.disabled = true;
      cancel.disabled = true;
      status.textContent = tCommon().saving;
      try {
        await postS3Write({
          db: currentDbId,
          bucket: currentBucket,
          key: object.key,
          content: ta.value,
          contentType: object.contentType || "text/plain",
        });
        await selectObject(object);
      } catch (err) {
        save.disabled = false;
        cancel.disabled = false;
        status.textContent = tCommon().saveError(
          err instanceof Error ? err.message : String(err),
        );
      }
    });
    ta.focus();
  }

  async function deleteObject(object: S3ObjectInfo): Promise<void> {
    if (!currentDbId || !currentBucket) return;
    if (!window.confirm(text().confirmDeleteObject(object.key))) return;
    try {
      await postS3Write({
        db: currentDbId,
        bucket: currentBucket,
        key: object.key,
        op: "delete",
      });
      currentKey = null;
      setPaneEmpty(previewPane, text().selectObject);
      refreshObjectList();
    } catch (err) {
      setPaneStatus(
        previewPane,
        tCommon().saveError(err instanceof Error ? err.message : String(err)),
        { error: true },
      );
    }
  }

  // 新規オブジェクト (テキスト) 作成フォームを preview に表示する。
  function showNewObjectForm(): void {
    if (!currentBucket) {
      setPaneStatus(previewPane, text().selectObject);
      return;
    }
    previewPane.innerHTML = "";
    const form = document.createElement("form");
    form.className = "s3-new-object-form";
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.className = "s3-new-object-key";
    keyInput.placeholder = text().newObjectKeyPlaceholder;
    keyInput.autocomplete = "off";
    const ta = document.createElement("textarea");
    ta.className = "s3-edit-textarea";
    ta.placeholder = text().contentPlaceholder;
    const bar = document.createElement("div");
    bar.className = "s3-edit-bar";
    const create = mkBtn(text().create, "db-btn db-btn-primary db-btn-sm");
    create.type = "submit";
    const cancel = mkBtn(tCommon().cancel, "db-btn db-btn-sm");
    const status = document.createElement("span");
    status.className = "s3-edit-status";
    bar.append(create, cancel, status);
    form.append(bar, keyInput, ta);
    previewPane.appendChild(form);
    keyInput.focus();
    cancel.addEventListener("click", () =>
      setPaneEmpty(previewPane, text().selectObject),
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentDbId || !currentBucket) return;
      const key = keyInput.value.trim();
      if (!key) {
        keyInput.focus();
        return;
      }
      create.disabled = true;
      status.textContent = tCommon().saving;
      try {
        await postS3Write({
          db: currentDbId,
          bucket: currentBucket,
          key,
          content: ta.value,
          contentType: "text/plain",
          op: "create",
        });
        refreshObjectList();
        setPaneEmpty(previewPane, text().selectObject);
      } catch (err) {
        create.disabled = false;
        status.textContent = tCommon().saveError(
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  }

  newObjectBtn.addEventListener("click", () => showNewObjectForm());

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
      open.textContent = text().openRaw;
      const download = document.createElement("a");
      download.className = "db-btn db-btn-sm";
      download.href = rawUrl;
      download.download = s3ObjectName(object.key);
      download.textContent = text().download;
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "db-btn db-btn-sm";
      copy.textContent = text().copyUri;
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            s3Uri(currentBucket || "", object.key),
          );
          copy.textContent = text().copied;
          window.setTimeout(() => {
            copy.textContent = text().copyUri;
          }, 1200);
        } catch {
          copy.textContent = text().copyFailed;
        }
      });
      actions.append(open, download, copy);
      // テキストオブジェクトのみ編集可。削除は種類を問わず可。
      if (sourceDisplayKind(object.key) === "text") {
        const editBtn = mkBtn(tCommon().edit, "db-btn db-btn-sm");
        editBtn.addEventListener("click", () => void startObjectEdit(object));
        actions.appendChild(editBtn);
      }
      const delBtn = mkBtn(tCommon().delete, "db-btn db-btn-sm");
      delBtn.addEventListener("click", () => void deleteObject(object));
      actions.appendChild(delBtn);
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
      message: text().unsupported,
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
      note.textContent = text().truncatedNotice(formatBytes(512 * 1024));
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

  // ---- Explorer (フォルダツリー) ----

  type ExplorerDir = {
    childUl: HTMLElement;
    expand: () => Promise<void>;
  };
  const explorerDirByPath = new Map<string, ExplorerDir>();

  function indentPad(depth: number): string {
    return `${12 + depth * 14}px`;
  }

  function setExplorerChevron(el: HTMLElement): void {
    el.innerHTML =
      '<svg class="octicon octicon-chevron-down" viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">' +
      `<path fill="currentColor" d="${CHEVRON_DOWN_12_PATH}"></path></svg>`;
  }

  function resetExplorer(): void {
    // 進行中の folder fetch を中断してから状態を捨てる。
    explorerAbort?.abort();
    explorerAbort = new AbortController();
    explorerTree.innerHTML = "";
    explorerRowsByKey.clear();
    explorerDirByPath.clear();
    explorerPagerByPrefix.clear();
    explorerLoadedFolders.clear();
    explorerLoadingFolders.clear();
    explorerRootLoaded = false;
  }

  async function fetchFolder(
    prefix: string,
    token?: string,
  ): Promise<S3FolderResponse | null> {
    if (!currentDbId || !currentBucket) return null;
    const params = new URLSearchParams({
      db: currentDbId,
      bucket: currentBucket,
    });
    if (prefix) params.set("prefix", prefix);
    if (token) params.set("token", token);
    const res = await fetch(`/_db/s3/folder?${params}`, {
      signal: explorerAbort?.signal,
    });
    if (!res.ok) throw new Error((await res.text()) || res.statusText);
    return (await res.json()) as S3FolderResponse;
  }

  function makeTreeMessageRow(
    cls: string,
    depth: number,
    text: string,
  ): HTMLElement {
    const el = document.createElement("div");
    el.className = cls;
    el.style.setProperty("--lvl-pad", indentPad(depth));
    el.textContent = text;
    return el;
  }

  function createExplorerFileRow(
    object: S3ObjectInfo,
    depth: number,
  ): HTMLElement {
    objectsByKey.set(object.key, object);
    const row = document.createElement("div");
    row.className = "tree-file";
    row.dataset.key = object.key;
    row.style.setProperty("--lvl-pad", indentPad(depth));
    const spacer = document.createElement("span");
    spacer.className = "chev-spacer";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = s3ObjectName(object.key) || object.key;
    name.title = object.key;
    row.append(spacer, createKindBadge(object.key, object.contentType), name);
    explorerRowsByKey.set(object.key, row);
    // active の付与は highlightActiveObject に一元化する (renderFolderLevel 末尾で
    // 同期)。ここで直付けすると activeObjectRow と二重管理になりずれる。
    row.addEventListener("click", () => void selectObject(object));
    attachKeyTooltip(row, object);
    return row;
  }

  function createExplorerDirRow(
    folderPrefix: string,
    depth: number,
  ): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "s3-tree-node";

    const row = document.createElement("div");
    row.className = "tree-dir collapsed";
    row.dataset.dirpath = folderPrefix;
    row.style.setProperty("--lvl-pad", indentPad(depth));

    const chev = document.createElement("span");
    chev.className = "chev";
    setExplorerChevron(chev);
    const dirIcon = document.createElement("span");
    dirIcon.className = "dir-icon";
    setExplorerFolderIcon(dirIcon, true);
    const label = document.createElement("span");
    label.className = "dir-label";
    const dn = document.createElement("span");
    dn.className = "dir-name";
    dn.textContent = folderDisplayName(folderPrefix);
    dn.title = folderPrefix;
    label.appendChild(dn);
    row.append(chev, dirIcon, label);

    const childUl = document.createElement("div");
    childUl.className = "tree-children";
    wrap.append(row, childUl);

    const expand = async (): Promise<void> => {
      if (!row.classList.contains("collapsed")) return;
      await ensureFolderLoaded(folderPrefix, childUl, depth + 1);
      row.classList.remove("collapsed");
      setExplorerFolderIcon(dirIcon, false);
    };
    const collapse = (): void => {
      row.classList.add("collapsed");
      setExplorerFolderIcon(dirIcon, true);
    };
    row.addEventListener("click", () => {
      if (row.classList.contains("collapsed")) void expand();
      else collapse();
    });

    explorerDirByPath.set(folderPrefix, { childUl, expand });
    return wrap;
  }

  function renderFolderLevel(
    parent: HTMLElement,
    prefix: string,
    depth: number,
    data: S3FolderResponse,
    append: boolean,
  ): void {
    if (!append) {
      parent.innerHTML = "";
      explorerPagerByPrefix.delete(prefix);
    }
    if (!append && data.folders.length === 0 && data.objects.length === 0) {
      parent.appendChild(makeTreeMessageRow("s3-tree-empty", depth, "(empty)"));
      if (currentKey) highlightActiveObject(currentKey);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const folder of data.folders) {
      fragment.appendChild(createExplorerDirRow(folder, depth));
    }
    for (const object of data.objects) {
      fragment.appendChild(createExplorerFileRow(object, depth));
    }
    parent.appendChild(fragment);
    if (data.nextToken) {
      const dbId = currentDbId;
      const bucket = currentBucket;
      const more = document.createElement("button");
      more.type = "button";
      more.className = "s3-tree-more";
      more.style.setProperty("--lvl-pad", indentPad(depth));
      more.textContent = "Load more";
      // ボタン押下と、復元時のプログラム的なページ送り (expandExplorerToKey) を
      // 同じ関数で扱う。1 ページ追加できれば true を返す。
      const loadMore = async (): Promise<boolean> => {
        if (more.disabled) return false;
        more.disabled = true;
        try {
          const next = await fetchFolder(prefix, data.nextToken);
          if (
            !next ||
            disposed ||
            dbId !== currentDbId ||
            bucket !== currentBucket
          ) {
            return false;
          }
          more.remove();
          renderFolderLevel(parent, prefix, depth, next, true);
          return true;
        } catch (err) {
          if (isAbortError(err) || disposed) return false;
          more.disabled = false;
          more.textContent = `Load more failed: ${err instanceof Error ? err.message : String(err)}`;
          return false;
        }
      };
      explorerPagerByPrefix.set(prefix, loadMore);
      more.addEventListener("click", () => void loadMore());
      parent.appendChild(more);
    } else {
      explorerPagerByPrefix.delete(prefix);
    }
    // active は highlightActiveObject に一元化。再描画後にここで同期する。
    if (currentKey) highlightActiveObject(currentKey);
  }

  function ensureFolderLoaded(
    prefix: string,
    childUl: HTMLElement,
    depth: number,
  ): Promise<void> {
    if (explorerLoadedFolders.has(prefix)) return Promise.resolve();
    const existing = explorerLoadingFolders.get(prefix);
    if (existing) return existing;
    const dbId = currentDbId;
    const bucket = currentBucket;
    childUl.replaceChildren(
      makeTreeMessageRow("s3-tree-loading", depth, "Loading…"),
    );
    const load = (async () => {
      try {
        const data = await fetchFolder(prefix);
        if (disposed || dbId !== currentDbId || bucket !== currentBucket)
          return;
        if (!data) {
          childUl.innerHTML = "";
          return;
        }
        renderFolderLevel(childUl, prefix, depth, data, false);
        explorerLoadedFolders.add(prefix);
      } catch (err) {
        // バケット切替/dispose による中断はエラー表示しない。
        if (isAbortError(err) || disposed) {
          childUl.innerHTML = "";
          return;
        }
        childUl.replaceChildren(
          makeTreeMessageRow(
            "s3-tree-error",
            depth,
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      } finally {
        explorerLoadingFolders.delete(prefix);
      }
    })();
    explorerLoadingFolders.set(prefix, load);
    return load;
  }

  async function loadExplorerRoot(): Promise<void> {
    if (!currentDbId || !currentBucket || disposed) return;
    if (explorerRootLoaded) return;
    resetExplorer();
    const dbId = currentDbId;
    const bucket = currentBucket;
    explorerGuard.dispose();
    const slot = explorerGuard.start();
    setPaneStatus(explorerTree, "Loading objects...");
    try {
      const data = await fetchFolder("");
      if (
        disposed ||
        slot.isStale() ||
        dbId !== currentDbId ||
        bucket !== currentBucket
      ) {
        return;
      }
      explorerTree.innerHTML = "";
      if (!data) return;
      renderFolderLevel(explorerTree, "", 0, data, false);
      explorerRootLoaded = true;
    } catch (err) {
      if (slot.isStale() || isAbortError(err)) return;
      setPaneStatus(
        explorerTree,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        { error: true },
      );
    } finally {
      slot.finish();
    }
  }

  // 復元用: 指定キーまで祖先フォルダを順に展開し、ファイルを選択する。
  // 祖先フォルダがページ分割の先にある場合は、その親階層の追加ページを
  // 見つかるまで自動でたどる。fallbackHead は List 復元と同様、行が読めない
  // ときのメタ情報フォールバック。
  async function expandExplorerToKey(
    key: string,
    fallbackHead?: S3ObjectInfo | null,
  ): Promise<void> {
    await loadExplorerRoot();
    const parts = key.split("/");
    let parentPrefix = "";
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      parentPrefix = prefix;
      prefix += `${parts[i]}/`;
      let dir = explorerDirByPath.get(prefix);
      // まだ読み込まれていなければ、親階層の追加ページをたどって探す。
      while (!dir) {
        const pager = explorerPagerByPrefix.get(parentPrefix);
        if (!pager) break;
        const advanced = await pager();
        if (disposed) return;
        if (!advanced) break;
        dir = explorerDirByPath.get(prefix);
      }
      if (!dir) break;
      await dir.expand();
      if (disposed) return;
    }
    const object = objectsByKey.get(key) ??
      fallbackHead ?? { key, sizeBytes: 0 };
    await selectObject(object);
    explorerRowsByKey.get(key)?.scrollIntoView({ block: "nearest" });
  }

  // UI の表示切替のみ (ロードは伴わない)。load() からも使う。
  // List/Explorer どちらでも sidebarSlot に全 UI が積まれていて、表示は
  // モードごとに排他で切替える (Search/options/objectList ↔ explorerTree)。
  function applyViewVisibility(view: S3ViewMode): void {
    currentView = view;
    listViewBtn.classList.toggle("active", view === "list");
    explorerViewBtn.classList.toggle("active", view === "explorer");
    const explorer = view === "explorer";
    searchRow.hidden = explorer;
    optionRow.hidden = explorer;
    objectStatus.hidden = explorer;
    objectList.hidden = explorer;
    moreBtn.hidden = explorer || !currentNextToken;
    explorerTree.hidden = !explorer;
  }

  function setView(view: S3ViewMode): void {
    applyViewVisibility(view);
    // ハイライト行は表示中ビューのものを指すよう取り直す。
    activeObjectRow?.classList.remove("active");
    activeObjectRow = null;
    if (currentKey) highlightActiveObject(currentKey);
    // ビュー初回表示時に対応するデータを遅延ロードする。
    if (view === "explorer") void loadExplorerRoot();
    else if (!listLoaded) void loadObjects(false);
  }

  async function selectBucket(bucket: string): Promise<void> {
    if (disposed || !currentDbId) return;
    currentBucket = bucket;
    currentKey = null;
    currentNextToken = undefined;
    listLoaded = false;
    resetExplorer();
    // バケット選択後は新規オブジェクト作成を許可する。
    newObjectBtn.hidden = false;
    notifySelectionChange();
    if (currentView === "explorer") await loadExplorerRoot();
    else await loadObjects(false);
  }

  bucketSelect.addEventListener("change", () => {
    if (bucketSelect.value) void selectBucket(bucketSelect.value);
  });
  listViewBtn.addEventListener("click", () => {
    if (currentView === "list") return;
    setView("list");
    notifySelectionChange();
  });
  explorerViewBtn.addEventListener("click", () => {
    if (currentView === "explorer") return;
    setView("explorer");
    notifySelectionChange();
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
    const initialView: S3ViewMode =
      initial?.view === "explorer" ? "explorer" : "list";
    currentDbId = dbId;
    currentBucket = null;
    currentKey = null;
    listLoaded = false;
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
    resetExplorer();
    applyViewVisibility(initialView);
    setPaneEmpty(previewPane, text().selectObject);
    setPaneStatus(
      initialView === "explorer" ? explorerTree : objectList,
      "Loading buckets...",
    );
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
        setPaneStatus(objectList, text().noBuckets);
        return;
      }
      bucketSelect.value = selected;
      // バケットが決まったので新規オブジェクト作成を許可する。
      newObjectBtn.hidden = false;
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
        if (initialView === "explorer") {
          await loadExplorerRoot();
          if (currentDbId !== dbId) return;
          if (initial?.key) {
            const head = headPromise ? await headPromise : null;
            await expandExplorerToKey(initial.key, head);
          }
        } else {
          await loadObjects(false);
          if (currentDbId !== dbId) return;
          if (initial?.key) {
            const object =
              objectsByKey.get(initial.key) ||
              (headPromise ? await headPromise : null) ||
              ({ key: initial.key, sizeBytes: 0 } satisfies S3ObjectInfo);
            await selectObject(object);
          }
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
    explorerGuard.dispose();
    currentDbId = null;
    currentBucket = null;
    currentKey = null;
    currentSearch = "";
    currentNextToken = undefined;
    currentSort = "updated-desc";
    listLoaded = false;
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
    resetExplorer();
    applyViewVisibility("list");
    setPaneEmpty(previewPane, text().selectObject);
  }

  function getSelection(): S3ExplorerSelection {
    return {
      bucket: currentBucket ?? undefined,
      ...(currentMode === "prefix"
        ? { prefix: currentSearch || undefined }
        : { query: currentSearch || undefined }),
      mode: currentMode,
      sort: currentSort,
      view: currentView,
      key: currentKey ?? undefined,
    };
  }

  function dispose(): void {
    disposed = true;
    clear();
    // body に attach した tooltip を取り除く。タブ切替で複数残ると DOM leak。
    keyTooltip.remove();
    if (tooltipShowTimer !== null) {
      clearTimeout(tooltipShowTimer);
      tooltipShowTimer = null;
    }
  }

  setMode("prefix");
  applyViewVisibility("list");

  function localize(): void {
    const t = text();
    // bucketLabel は先頭テキストノード + select。テキストノードのみ更新する。
    if (bucketLabel.firstChild) bucketLabel.firstChild.textContent = t.bucket;
    searchBtn.textContent = tCommon().search;
    prefixModeBtn.textContent = t.prefixMode;
    containsModeBtn.textContent = t.containsMode;
    sortUpdated.textContent = t.sortUpdated;
    sortKey.textContent = t.sortKey;
    newObjectBtn.textContent = `＋ ${t.newObject}`;
    newObjectBtn.title = t.newObject;
    moreBtn.textContent = tCommon().loadMore;
    searchInput.placeholder =
      currentMode === "prefix" ? t.prefixPlaceholder : t.containsPlaceholder;
    if (!currentKey) setPaneEmpty(previewPane, t.selectObject);
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
