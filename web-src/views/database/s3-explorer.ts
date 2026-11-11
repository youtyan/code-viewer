import { keyed } from "lit/directives/keyed.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import { apiUrl } from "../../core/api-url";
import { showCopyFailure } from "../../core/copy-failure";
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
import { CHEVRON_DOWN_12_PATH, FOLDER_ICON_PATHS } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import { renderMarkdownPreview } from "../../core/markdown-preview";
import {
  formatBytes,
  formatFileDate,
  humanFileKind,
  sourceDisplayKind,
  sourcePreviewKind,
} from "../../core/source-meta";
import { pageLanguage } from "../page-language";
import {
  appendMediaEmbed,
  renderDelimitedPreview,
  renderHtmlPreviewFrame,
  renderUnsupportedPreview,
} from "../source-preview-elements";
import { iconTemplate } from "../ui/icon";
import { renderOwned, templateElement } from "../ui/renderer";
import { showConfirmDialog } from "../ui-dialog";
import { createAbortGuard } from "./abort-guard";
import { type DbText, dbText } from "./i18n";
import { paneEmptyTemplate, paneStatusTemplate } from "./pane-status";
import { reportDatastoreFailure, requireOkResponse } from "./report-failure";

export type S3ExplorerCallbacks = {
  onSelectionChange?: (selection: S3ExplorerSelection) => void;
  getText?: () => DbText;
  // ホバープレビュー tooltip の ON/OFF (db-ui.json の prefs に永続化)。
  // 設定パネル (#datastore-s3-tooltip) からのみ操作される。callback 未指定なら
  // ON 固定。pref 値はホバー判定のたびに毎回読まれる (= 設定の即時反映)。
  getTooltipEnabled?: () => boolean;
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
  return `${apiUrl("dbS3Raw")}?${params}`;
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
    pageLanguage(),
  );
}

// ファイル種別をひと目で判別できる短いラベル (文言は i18n の explorer.s3.kind)。
// 詳細 (例: "PNG image") は title 属性に出す。
const KIND_CLASSES: Record<ReturnType<typeof sourceDisplayKind>, string> = {
  image: "kind-image",
  video: "kind-video",
  audio: "kind-audio",
  pdf: "kind-pdf",
  text: "kind-text",
  unsupported: "kind-binary",
};

function kindBadge(
  key: string,
  contentType: string | undefined,
  labels: DbText["explorer"]["s3"]["kind"],
): unknown {
  const kind = sourceDisplayKind(key);
  return html`<span
    class=${`s3-kind-badge ${KIND_CLASSES[kind]}`}
    title=${objectTypeLabel(key, contentType)}
    >${labels[kind]}</span
  >`;
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

function folderIcon(collapsed: boolean): unknown {
  return iconTemplate(
    collapsed ? FOLDER_ICON_PATHS.closed : FOLDER_ICON_PATHS.open,
    collapsed
      ? "octicon-file-directory-fill"
      : "octicon-file-directory-open-fill",
  );
}

function indentPad(depth: number): string {
  return `--lvl-pad: ${12 + depth * 14}px`;
}

type PaneStatus = { status: string; error: boolean };
const isStatus = (pane: unknown): pane is PaneStatus =>
  typeof pane === "object" && pane !== null && "status" in pane;

/** Explorer の 1 階層 (フォルダの中身、または根)。続きはページで読む。 */
export type S3Level = {
  depth: number;
  entries: ({ folder: S3Folder } | { object: S3ObjectInfo })[];
  /** 最初のページにフォルダもファイルも無い。 */
  empty: boolean;
  more: {
    disabled: boolean;
    /** 続きを読めなかった理由 (次の試行で消す)。 */
    failure: string | null;
    load: () => Promise<boolean>;
  } | null;
};

export type S3Folder = {
  prefix: string;
  depth: number;
  collapsed: boolean;
  /** 中身。読む前は null、読んでいる間と失敗は札。 */
  children: null | { loading: true } | { error: string } | S3Level;
};

/** 右のプレビューの欄。 */
type PreviewPane =
  | "empty"
  | PaneStatus
  | {
      object: S3ObjectInfo;
      body:
        | PaneStatus
        | { node: HTMLElement | null }
        | { edit: { current: string; message: string; busy: boolean } };
    }
  | { create: true; message: string; busy: boolean };

export type S3SidebarProps = {
  text: DbText["explorer"];
  view: S3ViewMode;
  mode: S3SearchMode;
  sort: S3SortMode;
  buckets: S3BucketInfo[];
  bucketsDisabled: boolean;
  newObjectShown: boolean;
  status: { text: string; warn: boolean };
  list: null | PaneStatus | { objects: S3ObjectInfo[] };
  more: { shown: boolean; disabled: boolean };
  tree: null | PaneStatus | S3Level;
  activeKey: string | null;
  bucketRef: Ref<HTMLSelectElement>;
  searchRef: Ref<HTMLInputElement>;
  onBucket: (bucket: string) => void;
  onView: (view: S3ViewMode) => void;
  onSearch: (event: Event) => void;
  onSearchKeydown: (event: KeyboardEvent) => void;
  onMode: (mode: S3SearchMode) => void;
  onSort: (sort: string) => void;
  onNewObject: () => void;
  onMore: () => void;
  onSelectObject: (object: S3ObjectInfo) => void;
  onToggleFolder: (folder: S3Folder) => void;
  onHoverObject: (row: HTMLElement, object: S3ObjectInfo) => void;
  onLeaveObject: () => void;
};

export type S3PreviewProps = {
  text: DbText["explorer"];
  pane: PreviewPane;
  /** 生の中身の URL (開く・保存)。接続とバケットが無ければ null。 */
  rawUrl: string | null;
  copyLabel: "copied" | "failed" | null;
  refs: {
    edit: Ref<HTMLTextAreaElement>;
    newKey: Ref<HTMLInputElement>;
    newContent: Ref<HTMLTextAreaElement>;
  };
  onCopyUri: (event: Event) => void;
  onEdit: () => void;
  onDelete: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onCreate: (event: Event) => void;
  onCancelCreate: () => void;
};

export type S3TooltipProps = {
  object: S3ObjectInfo;
  /** 画像のサムネイルの URL。画像でない・読めなかったときは null。 */
  imageUrl: string | null;
  meta: string;
  onImageLoad: () => void;
  onImageError: () => void;
};

export type S3ExplorerLook = {
  sidebar: (props: S3SidebarProps) => unknown;
  preview: (props: S3PreviewProps) => unknown;
  tooltip: (props: S3TooltipProps) => unknown;
};

function objectMeta(object: S3ObjectInfo): string {
  return [
    objectTypeLabel(object.key, object.contentType),
    formatBytes(object.sizeBytes),
    formatFileDate(object.updatedAt, pageLanguage()),
  ]
    .filter(Boolean)
    .join(" / ");
}

function splitKey(key: string): { parent: string; name: string } {
  const lastSlash = key.lastIndexOf("/");
  return lastSlash >= 0
    ? { parent: key.slice(0, lastSlash + 1), name: key.slice(lastSlash + 1) }
    : { parent: "", name: key };
}

const treeMessage = (cls: string, depth: number, message: string) =>
  html`<div class=${cls} style=${indentPad(depth)}>${message}</div>`;

function levelTemplate(p: S3SidebarProps, level: S3Level): unknown {
  const t = p.text;
  if (level.empty)
    return treeMessage("s3-tree-empty", level.depth, t.s3.emptyFolder);
  const hover = (object: S3ObjectInfo) => (event: Event) =>
    p.onHoverObject(event.currentTarget as HTMLElement, object);
  return html`${level.entries.map((entry) => {
    if ("object" in entry) {
      const object = entry.object;
      return html`<div
        class=${p.view === "explorer" && object.key === p.activeKey ? "tree-file active" : "tree-file"}
        data-key=${object.key}
        style=${indentPad(level.depth)}
        @click=${() => p.onSelectObject(object)}
        @mouseenter=${hover(object)}
        @mouseleave=${p.onLeaveObject}
      ><span class="chev-spacer"></span>${kindBadge(
        object.key,
        object.contentType,
        t.s3.kind,
      )}<span class="name" title=${object.key}
          >${s3ObjectName(object.key) || object.key}</span
        ></div>`;
    }
    const folder = entry.folder;
    const children = folder.children;
    return html`<div class="s3-tree-node"><div
        class=${folder.collapsed ? "tree-dir collapsed" : "tree-dir"}
        data-dirpath=${folder.prefix}
        style=${indentPad(folder.depth)}
        @click=${() => p.onToggleFolder(folder)}
      ><span class="chev">${iconTemplate(
        CHEVRON_DOWN_12_PATH,
        "octicon-chevron-down",
        12,
      )}</span><span class="dir-icon">${folderIcon(folder.collapsed)}</span><span
          class="dir-label"
          ><span class="dir-name" title=${folder.prefix}
            >${folderDisplayName(folder.prefix)}</span
          ></span
        ></div
      ><div class="tree-children">${
        children === null
          ? nothing
          : "loading" in children
            ? treeMessage(
                "s3-tree-loading",
                folder.depth + 1,
                t.s3.loadingFolder,
              )
            : "error" in children
              ? treeMessage("s3-tree-error", folder.depth + 1, children.error)
              : levelTemplate(p, children)
      }</div></div>`;
  })}${
    level.more
      ? // 続きのページごとにボタンを作り直す (前のページのボタンは外れる)。
        keyed(
          level.more,
          html`<button
          type="button"
          class="s3-tree-more"
          style=${indentPad(level.depth)}
          ?disabled=${level.more.disabled}
          @click=${level.more.load}
        >${t.common.loadMore}</button>${
          level.more.failure === null
            ? nothing
            : treeMessage("s3-tree-error", level.depth, level.more.failure)
        }`,
        )
      : nothing
  }`;
}

function previewHeader(p: S3PreviewProps, object: S3ObjectInfo): unknown {
  const t = p.text;
  return html`<div class="s3-preview-header"><div
      class="s3-preview-title"
      title=${object.key}
    >${object.key}</div><div class="s3-preview-meta">${objectMeta(object)}</div><div
      class="s3-preview-actions"
    >${
      p.rawUrl === null
        ? nothing
        : html`<a
              class="db-btn db-btn-sm"
              href=${p.rawUrl}
              target="_blank"
              rel="noreferrer"
              >${t.s3.openRaw}</a
            ><a
              class="db-btn db-btn-sm"
              href=${p.rawUrl}
              download=${s3ObjectName(object.key)}
              >${t.s3.download}</a
            ><button type="button" class="db-btn db-btn-sm" @click=${p.onCopyUri}
              >${
                p.copyLabel === "copied"
                  ? t.s3.copied
                  : p.copyLabel === "failed"
                    ? t.s3.copyFailed
                    : t.s3.copyUri
              }</button
            >${
              // テキストオブジェクトのみ編集可。削除は種類を問わず可。
              sourceDisplayKind(object.key) === "text"
                ? html`<button
                    type="button"
                    class="db-btn db-btn-sm"
                    @click=${p.onEdit}
                  >${t.common.edit}</button>`
                : nothing
            }<button type="button" class="db-btn db-btn-sm" @click=${p.onDelete}
              >${t.common.delete}</button
            >`
    }</div></div>`;
}

export const DEFAULT_VIEW: S3ExplorerLook = {
  sidebar: (p) => {
    const t = p.text;
    const explorer = p.view === "explorer";
    return html`<div class="s3-bucket-row"><label class="s3-field-label"
          >${t.s3.bucket}<select
            class="s3-bucket-select"
            ?disabled=${p.bucketsDisabled}
            ${ref(p.bucketRef)}
            @change=${(event: Event) =>
              p.onBucket((event.currentTarget as HTMLSelectElement).value)}
          >${p.buckets.map(
            (bucket) =>
              html`<option value=${bucket.name}>${bucket.name}</option>`,
          )}</select></label
        ><div class="seg s3-view-seg"><button
            type="button"
            class=${p.view === "list" ? "active" : ""}
            @click=${() => p.onView("list")}
          >${t.s3.listView}</button><button
            type="button"
            class=${explorer ? "active" : ""}
            @click=${() => p.onView("explorer")}
          >${t.s3.explorerView}</button></div></div
      ><form class="s3-search-row" ?hidden=${explorer} @submit=${p.onSearch}><input
          type="search"
          class="s3-search-input"
          placeholder=${p.mode === "prefix" ? t.s3.prefixPlaceholder : t.s3.containsPlaceholder}
          autocomplete="off"
          ${ref(p.searchRef)}
          @keydown=${p.onSearchKeydown}
        /><button type="submit" class="db-btn db-btn-primary s3-search-btn"
          >${t.common.search}</button
        ></form
      ><div class="s3-options-row" ?hidden=${explorer}><div class="seg s3-mode-seg"
          ><button
            type="button"
            class=${p.mode === "prefix" ? "active" : ""}
            @click=${() => p.onMode("prefix")}
          >${t.s3.prefixMode}</button><button
            type="button"
            class=${p.mode === "contains" ? "active" : ""}
            @click=${() => p.onMode("contains")}
          >${t.s3.containsMode}</button></div
        ><select
          class="s3-sort-select"
          .value=${p.sort}
          @change=${(event: Event) =>
            p.onSort((event.currentTarget as HTMLSelectElement).value)}
        ><option value="updated-desc">${t.s3.sortUpdated}</option><option
            value="key-asc"
          >${t.s3.sortKey}</option></select
        ><button
          type="button"
          class="db-btn db-btn-sm s3-new-object-btn"
          title=${t.s3.newObject}
          ?hidden=${!p.newObjectShown}
          @click=${p.onNewObject}
        >＋ ${t.s3.newObject}</button></div
      ><div
        class=${p.status.warn ? "s3-object-status warn" : "s3-object-status"}
        ?hidden=${explorer}
      >${p.status.text}</div><div class="s3-object-list" ?hidden=${explorer}>${
        p.list === null
          ? nothing
          : isStatus(p.list)
            ? paneStatusTemplate(p.list.status, p.list.error)
            : p.list.objects.map((object) => {
                const { parent, name } = splitKey(object.key);
                return html`<div
                  class=${!explorer && object.key === p.activeKey ? "s3-object-item active" : "s3-object-item"}
                  data-key=${object.key}
                  @click=${() => p.onSelectObject(object)}
                  @mouseenter=${(event: Event) =>
                    p.onHoverObject(event.currentTarget as HTMLElement, object)}
                  @mouseleave=${p.onLeaveObject}
                >${
                  // 1 行目: 親パス (薄)。サイドバー狭幅でも判別できるよう、末尾を省略。
                  parent
                    ? html`<div class="s3-object-parent">${parent}</div>`
                    : nothing
                }<div class="s3-object-head">${kindBadge(
                  object.key,
                  object.contentType,
                  t.s3.kind,
                )}<span class="s3-object-name">${name}</span></div><span
                    class="s3-object-meta"
                    >${objectMeta(object)}</span
                  ></div>`;
              })
      }</div><button
        type="button"
        class="s3-object-more-btn"
        ?hidden=${!p.more.shown}
        ?disabled=${p.more.disabled}
        @click=${p.onMore}
      >${t.common.loadMore}</button><div
        class="s3-object-list s3-tree tree"
        ?hidden=${!explorer}
      >${
        p.tree === null
          ? nothing
          : isStatus(p.tree)
            ? paneStatusTemplate(p.tree.status, p.tree.error)
            : levelTemplate(p, p.tree)
      }</div>`;
  },
  preview: (p) => {
    const t = p.text;
    const pane = p.pane;
    if (pane === "empty") return paneEmptyTemplate(t.s3.selectObject);
    if (isStatus(pane)) return paneStatusTemplate(pane.status, pane.error);
    const status = (message: string) =>
      html`<span class="s3-edit-status">${message}</span>`;
    if ("create" in pane)
      return html`<form class="s3-new-object-form" @submit=${p.onCreate}><div
          class="s3-edit-bar"
        ><button
            type="submit"
            class="db-btn db-btn-primary db-btn-sm"
            ?disabled=${pane.busy}
          >${t.s3.create}</button><button
            type="button"
            class="db-btn db-btn-sm"
            @click=${p.onCancelCreate}
          >${t.common.cancel}</button>${status(pane.message)}</div
        ><input
          type="text"
          class="s3-new-object-key"
          placeholder=${t.s3.newObjectKeyPlaceholder}
          autocomplete="off"
          ${ref(p.refs.newKey)}
        /><textarea
          class="s3-edit-textarea"
          placeholder=${t.s3.contentPlaceholder}
          ${ref(p.refs.newContent)}
        ></textarea></form>`;
    const body = pane.body;
    return html`${previewHeader(p, pane.object)}<div class="s3-preview-body">${
      isStatus(body)
        ? paneStatusTemplate(body.status, body.error)
        : "edit" in body
          ? html`<div class="s3-edit-bar"><button
                  type="button"
                  class="db-btn db-btn-primary db-btn-sm"
                  ?disabled=${body.edit.busy}
                  @click=${p.onSave}
                >${t.common.save}</button><button
                  type="button"
                  class="db-btn db-btn-sm"
                  ?disabled=${body.edit.busy}
                  @click=${p.onCancelEdit}
                >${t.common.cancel}</button>${status(body.edit.message)}</div
              ><textarea
                class="s3-edit-textarea"
                .value=${body.edit.current}
                ${ref(p.refs.edit)}
              ></textarea>`
          : (body.node ?? nothing)
    }</div>`;
  },
  tooltip: (p) =>
    html`${
      p.imageUrl === null
        ? nothing
        : html`<img
            class="s3-key-tooltip-image"
            src=${p.imageUrl}
            alt=""
            decoding="async"
            loading="lazy"
            @load=${p.onImageLoad}
            @error=${p.onImageError}
          />`
    }<div class="s3-key-tooltip-path">${p.object.key}</div>${
      p.meta ? html`<div class="s3-key-tooltip-meta">${p.meta}</div>` : nothing
    }`,
};

/** 一覧の 1 ページの数 (新しい順は走査で並べ替えるので多めに取る)。 */
const UPDATED_PAGE_SIZE = 1000;
const KEY_PAGE_SIZE = 200;
// 行の高速スイープでも `<img src>` が連発しないよう、表示を 150ms 遅らせる。
// 途中で mouseleave が来たら timer をクリアして画像取得自体を起こさない。
const TOOLTIP_SHOW_DELAY_MS = 150;
/** 「コピーしました」「コピーできませんでした」を出しておく時間。 */
const COPY_MARK_MS = 1200;

export function createS3Explorer(
  callbacks: S3ExplorerCallbacks = {},
  view: S3ExplorerLook = DEFAULT_VIEW,
): S3ExplorerView {
  const allText = (): DbText["explorer"] =>
    (callbacks.getText?.() ?? dbText("en")).explorer;
  const text = (): DbText["explorer"]["s3"] => allText().s3;
  const tCommon = (): DbText["explorer"]["common"] => allText().common;
  const tFailure = (): DbText["failure"] =>
    (callbacks.getText?.() ?? dbText("en")).failure;
  const bucketRef = createRef<HTMLSelectElement>();
  const searchRef = createRef<HTMLInputElement>();
  const refs = {
    edit: createRef<HTMLTextAreaElement>(),
    newKey: createRef<HTMLInputElement>(),
    newContent: createRef<HTMLTextAreaElement>(),
  };
  const drawn = <T extends Element>(target: Ref<T>, name: string): T => {
    const element = target.value;
    if (!element) throw new Error(`S3 explorer: the ${name} was not drawn`);
    return element;
  };
  const searchInput = () => drawn(searchRef, "search field");

  let currentDbId: string | null = null;
  let currentBucket: string | null = null;
  let currentKey: string | null = null;
  let currentMode: S3SearchMode = "prefix";
  let currentSort: S3SortMode = "updated-desc";
  let currentSearch = "";
  let currentView: S3ViewMode = "list";
  let currentNextToken: string | undefined;
  const objectsByKey = new Map<string, S3ObjectInfo>();
  // Explorer 表示の状態。folder prefix ("a/b/") 単位でロード済み/ロード中を管理。
  const explorerLoadedFolders = new Set<string>();
  const explorerLoadingFolders = new Map<string, Promise<void>>();
  // 各階層 (container prefix) の追加ページ取得関数。1 ページ追加できれば true。
  const explorerPagerByPrefix = new Map<string, () => Promise<boolean>>();
  const explorerDirByPath = new Map<string, S3Folder>();
  // バケット/DB 切替・dispose 時に進行中の folder fetch をまとめて中断する。
  let explorerAbort: AbortController | null = null;
  let explorerRootLoaded = false;
  let listLoaded = false;
  let disposed = false;
  let loadRunId = 0;
  let objectRunId = 0;
  let suppressNotify = false;
  let buckets: S3BucketInfo[] = [];
  let bucketsDisabled = false;
  let newObjectShown = false;
  // 言語を切り替えたときに状態の行を描き直すため、最後に描いた応答を持つ。
  let lastStatusResponse: S3ObjectsResponse | null = null;
  let statusShown = false;
  let listPane: S3SidebarProps["list"] = null;
  let moreDisabled = false;
  let treePane: S3SidebarProps["tree"] = null;
  let previewPane: PreviewPane = "empty";
  let copyLabel: S3PreviewProps["copyLabel"] = null;
  const bucketGuard = createAbortGuard();
  const objectGuard = createAbortGuard();
  const previewGuard = createAbortGuard();
  const explorerGuard = createAbortGuard();

  // 左サイドバー (db-sidebar) の dbToolbar 直下にぶら下がる、Bucket セレクタ +
  // List/Explorer セグメント・検索・一覧・ツリー。右側はプレビューだけが残る。
  const sidebarSlot = templateElement(
    html`<div class="db-explorer-sidebar-slot s3-sidebar-slot"></div>`,
  );
  const container = templateElement(
    html`<div class="s3-explorer"><div class="s3-preview-pane"></div></div>`,
  );
  const previewEl = container.firstElementChild;
  if (!(previewEl instanceof HTMLElement))
    throw new Error("S3 explorer: the preview pane was not drawn");

  // ----- ホバーで全パスを表示する floating tooltip -----
  // sidebar 内では key 末尾しか見えないので、行ホバーで全 key + メタを別の
  // 要素に展開する。preview pane 側へはみ出して読めるよう document.body に置く。
  // ON/OFF は db-ui.json の prefs.s3TooltipEnabled (設定パネルから操作)。
  // callback 未提供時は ON 固定。判定はホバー時に毎回読む (反映ラグ無し)。
  const keyTooltip = templateElement(
    html`<div class="s3-key-tooltip" hidden></div>`,
  );
  document.body.appendChild(keyTooltip);
  let tooltipShowTimer: ReturnType<typeof setTimeout> | null = null;

  function draw(): void {
    const t = allText();
    renderOwned(
      sidebarSlot,
      view.sidebar({
        text: t,
        view: currentView,
        mode: currentMode,
        sort: currentSort,
        buckets,
        bucketsDisabled,
        newObjectShown,
        status: {
          text:
            statusShown && lastStatusResponse
              ? statusText(lastStatusResponse)
              : "",
          warn: !!lastStatusResponse?.scanLimitReached,
        },
        list: listPane,
        more: {
          shown: currentView === "list" && !!currentNextToken,
          disabled: moreDisabled,
        },
        tree: treePane,
        activeKey: currentKey,
        bucketRef,
        searchRef,
        onBucket: (bucket) => {
          if (bucket) void selectBucket(bucket);
        },
        onView: (next) => {
          if (currentView === next) return;
          setView(next);
          notifySelectionChange();
        },
        onSearch: (event) => {
          event.preventDefault();
          currentSearch = searchInput().value.trim();
          notifySelectionChange();
          void loadObjects(false);
        },
        onSearchKeydown: (event) => {
          if (isImeComposing(event)) return;
          if (event.key === "Escape") {
            searchInput().value = "";
            currentSearch = "";
            notifySelectionChange();
            void loadObjects(false);
          }
        },
        onMode: (mode) => {
          currentMode = mode;
          notifySelectionChange();
          void loadObjects(false);
        },
        onSort: (sort) => {
          currentSort = sort === "key-asc" ? "key-asc" : "updated-desc";
          notifySelectionChange();
          void loadObjects(false);
        },
        onNewObject: showNewObjectForm,
        onMore: () => void loadObjects(true),
        onSelectObject: (object) => void selectObject(object),
        onToggleFolder: (folder) => {
          if (folder.collapsed) void expandFolder(folder);
          else {
            folder.collapsed = true;
            draw();
          }
        },
        onHoverObject: (row, object) => {
          if (tooltipShowTimer !== null) clearTimeout(tooltipShowTimer);
          tooltipShowTimer = setTimeout(() => {
            tooltipShowTimer = null;
            showKeyTooltip(row, object);
          }, TOOLTIP_SHOW_DELAY_MS);
        },
        onLeaveObject: hideKeyTooltip,
      }),
    );
    const object =
      typeof previewPane === "object" && "object" in previewPane
        ? previewPane.object
        : null;
    renderOwned(
      previewEl as HTMLElement,
      view.preview({
        text: t,
        pane: previewPane,
        rawUrl:
          object && currentDbId && currentBucket
            ? buildS3RawUrl(currentDbId, currentBucket, object.key)
            : null,
        copyLabel,
        refs,
        onCopyUri: (event) => {
          if (object) void copyUri(event.currentTarget as HTMLElement, object);
        },
        onEdit: () => {
          if (object) void startObjectEdit(object);
        },
        onDelete: () => {
          if (object) void deleteObject(object);
        },
        onSave: () => {
          if (object) void saveObject(object);
        },
        onCancelEdit: () => {
          if (object) void selectObject(object);
        },
        onCreate: (event) => {
          event.preventDefault();
          void createObject();
        },
        onCancelCreate: () => showPreview("empty"),
      }),
    );
  }

  function showPreview(pane: PreviewPane): void {
    previewPane = pane;
    draw();
  }

  function notifySelectionChange(): void {
    if (suppressNotify) return;
    callbacks.onSelectionChange?.(getSelection());
  }

  function tooltipEnabled(): boolean {
    return callbacks.getTooltipEnabled?.() ?? true;
  }

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
    if (!tooltipEnabled()) return;
    // 画像オブジェクトのときはサムネイルを上に挟む。s3-preview の raw URL
    // をそのまま <img> に渡すだけ。max-width / max-height で抑える。
    const imageUrl =
      currentDbId && currentBucket && sourceDisplayKind(object.key) === "image"
        ? buildS3RawUrl(currentDbId, currentBucket, object.key)
        : null;
    const drawTooltip = (url: string | null) =>
      renderOwned(
        keyTooltip,
        view.tooltip({
          object,
          imageUrl: url,
          meta: objectMeta(object),
          // load 完了で実サイズが反映された後に再 position する (はみ出し回避)。
          onImageLoad: () => positionKeyTooltip(row),
          onImageError: () => drawTooltip(null),
        }),
      );
    drawTooltip(imageUrl);
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

  function statusText(resp: S3ObjectsResponse): string {
    const t = text();
    const parts = [
      tCommon().shownCount(resp.objects.length.toLocaleString()),
      tCommon().scannedCount(resp.scannedObjects.toLocaleString()),
      resp.sort === "updated-desc" ? t.newestFirstInScan : t.sortedByKey,
    ];
    if (resp.scanLimitReached) parts.push(t.scanCapReached);
    return parts.join(" / ");
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
    const res = await fetch(`${apiUrl("dbS3Head")}?${params}`, { signal });
    await requireOkResponse(res, tFailure().s3ObjectHead);
    const data = (await res.json()) as S3ObjectHeadResponse;
    return {
      key,
      sizeBytes: data.sizeBytes ?? 0,
      ...(data.updatedAt ? { updatedAt: data.updatedAt } : {}),
      ...(data.contentType ? { contentType: data.contentType } : {}),
      ...(data.etag ? { etag: data.etag } : {}),
    };
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
    moreDisabled = true;
    if (!append) {
      listLoaded = true;
      objectsByKey.clear();
      currentKey = null;
      currentNextToken = undefined;
      listPane = { status: text().loadingObjects, error: false };
      previewPane = "empty";
    }
    draw();
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        bucket: requestBucket,
        mode: requestMode,
        sort: requestSort,
        limit: String(
          requestSort === "updated-desc" ? UPDATED_PAGE_SIZE : KEY_PAGE_SIZE,
        ),
      });
      if (requestSearch) params.set("q", requestSearch);
      if (append && currentNextToken) params.set("token", currentNextToken);
      const res = await fetch(`${apiUrl("dbS3Objects")}?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      await requireOkResponse(res, tFailure().s3Objects);
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
      const shown =
        append && listPane !== null && !isStatus(listPane)
          ? listPane.objects
          : [];
      if (data.objects.length === 0 && !append) {
        listPane = {
          status: data.scanLimitReached
            ? text().noMatchesInScan(data.scannedObjects.toLocaleString())
            : text().noObjects,
          error: false,
        };
      } else {
        for (const object of data.objects) objectsByKey.set(object.key, object);
        listPane = { objects: [...shown, ...data.objects] };
      }
      currentNextToken = data.nextToken;
      lastStatusResponse = data;
      statusShown = true;
      draw();
    } catch (err) {
      if (slot.isStale()) return;
      listPane = {
        status: reportDatastoreFailure(
          "S3",
          "object list",
          err,
          requestBucket,
          requestSearch,
        ),
        error: true,
      };
      statusShown = false;
      draw();
    } finally {
      slot.finish();
      if (!slot.isStale()) {
        moreDisabled = false;
        draw();
      }
    }
  }

  async function postS3Write(body: Record<string, unknown>): Promise<void> {
    const doFetch = fetch(apiUrl("dbS3Write"), {
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
    await requireOkResponse(res, tFailure().s3Write);
  }

  function refreshObjectList(): void {
    if (currentView === "explorer") void loadExplorerRoot();
    else void loadObjects(false);
  }

  function setPreviewBody(
    object: S3ObjectInfo,
    body: Extract<PreviewPane, { object: S3ObjectInfo }>["body"],
  ): void {
    showPreview({ object, body });
  }

  // テキストオブジェクトの内容を取得して textarea 編集する。保存は PUT (上書き)。
  async function startObjectEdit(object: S3ObjectInfo): Promise<void> {
    if (!currentDbId || !currentBucket) return;
    if (typeof previewPane !== "object" || !("object" in previewPane)) return;
    setPreviewBody(object, { status: tCommon().saving, error: false });
    let current = "";
    try {
      const params = new URLSearchParams({
        db: currentDbId,
        bucket: currentBucket,
        key: object.key,
      });
      const res = await fetch(`${apiUrl("dbS3Text")}?${params}`);
      await requireOkResponse(res, tFailure().s3ObjectText);
      current = ((await res.json()) as S3ObjectTextResponse).text;
    } catch (err) {
      setPreviewBody(object, {
        status: tCommon().saveError(
          reportDatastoreFailure(
            "S3",
            "object text",
            err,
            currentBucket,
            object.key,
          ),
        ),
        error: true,
      });
      return;
    }
    setPreviewBody(object, { edit: { current, message: "", busy: false } });
    refs.edit.value?.focus();
  }

  async function saveObject(object: S3ObjectInfo): Promise<void> {
    if (!currentDbId || !currentBucket) return;
    if (
      typeof previewPane !== "object" ||
      !("object" in previewPane) ||
      !("edit" in previewPane.body)
    )
      return;
    const edit = previewPane.body.edit;
    const content = drawn(refs.edit, "editor").value;
    setPreviewBody(object, {
      edit: { ...edit, busy: true, message: tCommon().saving },
    });
    try {
      await postS3Write({
        db: currentDbId,
        bucket: currentBucket,
        key: object.key,
        content,
        contentType: object.contentType || "text/plain",
      });
      await selectObject(object);
    } catch (err) {
      setPreviewBody(object, {
        edit: {
          ...edit,
          busy: false,
          message: tCommon().saveError(
            reportDatastoreFailure(
              "S3",
              "object write",
              err,
              currentBucket,
              object.key,
            ),
          ),
        },
      });
    }
  }

  async function deleteObject(object: S3ObjectInfo): Promise<void> {
    if (!currentDbId || !currentBucket) return;
    const ok = await showConfirmDialog({
      body: text().confirmDeleteObject(object.key),
      confirmLabel: tCommon().delete,
      danger: true,
    });
    if (!ok) return;
    try {
      await postS3Write({
        db: currentDbId,
        bucket: currentBucket,
        key: object.key,
        op: "delete",
      });
      currentKey = null;
      showPreview("empty");
      refreshObjectList();
    } catch (err) {
      showPreview({
        status: tCommon().saveError(
          reportDatastoreFailure(
            "S3",
            "object delete",
            err,
            currentBucket,
            object.key,
          ),
        ),
        error: true,
      });
    }
  }

  // 新規オブジェクト (テキスト) 作成フォームを preview に表示する。
  function showNewObjectForm(): void {
    if (!currentBucket) {
      showPreview({ status: text().selectObject, error: false });
      return;
    }
    showPreview({ create: true, message: "", busy: false });
    refs.newKey.value?.focus();
  }

  async function createObject(): Promise<void> {
    if (!currentDbId || !currentBucket) return;
    if (typeof previewPane !== "object" || !("create" in previewPane)) return;
    const keyInput = drawn(refs.newKey, "new object key");
    const key = keyInput.value.trim();
    if (!key) {
      keyInput.focus();
      return;
    }
    const content = drawn(refs.newContent, "new object content").value;
    showPreview({ create: true, busy: true, message: tCommon().saving });
    try {
      await postS3Write({
        db: currentDbId,
        bucket: currentBucket,
        key,
        content,
        contentType: "text/plain",
        op: "create",
      });
      refreshObjectList();
      showPreview("empty");
    } catch (err) {
      showPreview({
        create: true,
        busy: false,
        message: tCommon().saveError(
          reportDatastoreFailure(
            "S3",
            "object create",
            err,
            currentBucket,
            key,
          ),
        ),
      });
    }
  }

  async function copyUri(
    button: HTMLElement,
    object: S3ObjectInfo,
  ): Promise<void> {
    const uri = s3Uri(currentBucket || "", object.key);
    try {
      await navigator.clipboard.writeText(uri);
      copyLabel = "copied";
    } catch (err) {
      // ラベルは成功のときと同じく一時的に変えて戻す。理由の全文は
      // console と title/aria-label に残す (直す前は理由を捨てていた)。
      showCopyFailure(
        button,
        `copy s3 uri ${uri}`,
        err,
        text().copyUri,
        COPY_MARK_MS,
      );
      copyLabel = "failed";
    }
    draw();
    window.setTimeout(() => {
      copyLabel = null;
      draw();
    }, COPY_MARK_MS);
  }

  function mediaPreview(object: S3ObjectInfo, kind: string): HTMLElement {
    const box = templateElement(
      html`<div
        class=${`gdp-source-viewer media ${kind} s3-source-preview`}
      ></div>`,
    );
    if (!currentDbId || !currentBucket) return box;
    const url = buildS3RawUrl(currentDbId, currentBucket, object.key);
    appendMediaEmbed(box, { url, kind, title: object.key });
    return box;
  }

  async function textPreview(
    object: S3ObjectInfo,
    slot: ReturnType<typeof previewGuard.start>,
  ): Promise<HTMLElement | null> {
    if (!currentDbId || !currentBucket) return null;
    const params = new URLSearchParams({
      db: currentDbId,
      bucket: currentBucket,
      key: object.key,
    });
    const res = await fetch(`${apiUrl("dbS3Text")}?${params}`, {
      signal: slot.signal,
    });
    if (disposed || slot.isStale()) return null;
    await requireOkResponse(res, tFailure().s3ObjectText);
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
    } else if (previewKind === "csv" || previewKind === "tsv") {
      body = renderDelimitedPreview(data.text, previewKind);
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
      body = templateElement(
        html`<pre class="s3-text-preview">${data.text}</pre>`,
      );
    }
    if (!data.truncated) return body;
    return templateElement(
      html`<div class="s3-text-preview-wrap"><div
          class="datastore-value-truncation"
        >${text().truncatedNotice(formatBytes(512 * 1024))}</div>${body}</div>`,
    );
  }

  async function selectObject(object: S3ObjectInfo): Promise<void> {
    if (disposed || !currentDbId || !currentBucket) return;
    const slot = previewGuard.start();
    const requestRunId = ++objectRunId;
    const requestDbId = currentDbId;
    const requestBucket = currentBucket;
    currentKey = object.key;
    notifySelectionChange();
    copyLabel = null;
    setPreviewBody(object, { status: text().loadingPreview, error: false });
    try {
      const displayKind = sourceDisplayKind(object.key);
      let preview: HTMLElement | null;
      if (
        displayKind === "image" ||
        displayKind === "video" ||
        displayKind === "audio" ||
        displayKind === "pdf"
      ) {
        preview = mediaPreview(object, displayKind);
      } else if (displayKind === "text") {
        preview = await textPreview(object, slot);
      } else {
        preview = renderUnsupportedPreview({
          className: "s3-source-preview",
          message: text().unsupported,
        });
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
      setPreviewBody(object, { node: preview });
    } catch (err) {
      if (slot.isStale()) return;
      setPreviewBody(object, {
        status: reportDatastoreFailure(
          "S3",
          "object preview",
          err,
          requestBucket,
          object.key,
        ),
        error: true,
      });
    } finally {
      slot.finish();
    }
  }

  // ---- Explorer (フォルダツリー) ----

  function resetExplorer(): void {
    // 進行中の folder fetch を中断してから状態を捨てる。
    explorerAbort?.abort();
    explorerAbort = new AbortController();
    treePane = null;
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
    const res = await fetch(`${apiUrl("dbS3Folder")}?${params}`, {
      signal: explorerAbort?.signal,
    });
    await requireOkResponse(res, tFailure().s3Folder);
    return (await res.json()) as S3FolderResponse;
  }

  // 1 ページ分のフォルダとファイルを、その階層 (level) に足す。append でなければ
  // 階層を作り直す。続きがあれば、続きを読む関数を階層と explorerPagerByPrefix に置く。
  function addFolderPage(
    level: S3Level,
    prefix: string,
    data: S3FolderResponse,
    append: boolean,
  ): void {
    if (!append) explorerPagerByPrefix.delete(prefix);
    if (!append && data.folders.length === 0 && data.objects.length === 0) {
      level.empty = true;
      return;
    }
    for (const folderPrefix of data.folders) {
      const folder: S3Folder = {
        prefix: folderPrefix,
        depth: level.depth,
        collapsed: true,
        children: null,
      };
      explorerDirByPath.set(folderPrefix, folder);
      level.entries.push({ folder });
    }
    for (const object of data.objects) {
      objectsByKey.set(object.key, object);
      level.entries.push({ object });
    }
    const token = data.nextToken;
    if (!token) {
      level.more = null;
      explorerPagerByPrefix.delete(prefix);
      return;
    }
    const dbId = currentDbId;
    const bucket = currentBucket;
    // ボタン押下と、復元時のプログラム的なページ送り (expandExplorerToKey) を
    // 同じ関数で扱う。1 ページ追加できれば true を返す。失敗の文言はボタンの
    // ラベルに入れず (ラベルが伸びると押せる領域が動く)、ボタンの後ろの行に
    // 出し、次の試行で消す。
    const more: NonNullable<S3Level["more"]> = {
      disabled: false,
      failure: null,
      load: async () => {
        if (more.disabled) return false;
        more.disabled = true;
        more.failure = null;
        draw();
        try {
          const next = await fetchFolder(prefix, token);
          if (
            !next ||
            disposed ||
            dbId !== currentDbId ||
            bucket !== currentBucket
          ) {
            return false;
          }
          level.more = null;
          addFolderPage(level, prefix, next, true);
          draw();
          return true;
        } catch (err) {
          if (isAbortError(err) || disposed) return false;
          more.disabled = false;
          more.failure = text().loadMoreFailed(
            reportDatastoreFailure("S3", "load more", err, bucket, prefix),
          );
          draw();
          return false;
        }
      },
    };
    level.more = more;
    explorerPagerByPrefix.set(prefix, more.load);
  }

  const newLevel = (depth: number): S3Level => ({
    depth,
    entries: [],
    empty: false,
    more: null,
  });

  function ensureFolderLoaded(folder: S3Folder): Promise<void> {
    const prefix = folder.prefix;
    if (explorerLoadedFolders.has(prefix)) return Promise.resolve();
    const existing = explorerLoadingFolders.get(prefix);
    if (existing) return existing;
    const dbId = currentDbId;
    const bucket = currentBucket;
    folder.children = { loading: true };
    draw();
    const load = (async () => {
      try {
        const data = await fetchFolder(prefix);
        if (disposed || dbId !== currentDbId || bucket !== currentBucket)
          return;
        if (!data) {
          folder.children = null;
          return;
        }
        const level = newLevel(folder.depth + 1);
        addFolderPage(level, prefix, data, false);
        folder.children = level;
        explorerLoadedFolders.add(prefix);
      } catch (err) {
        // バケット切替/dispose による中断はエラー表示しない。
        folder.children =
          isAbortError(err) || disposed
            ? null
            : {
                error: reportDatastoreFailure(
                  "S3",
                  "folder",
                  err,
                  bucket,
                  prefix,
                ),
              };
      } finally {
        explorerLoadingFolders.delete(prefix);
        if (!disposed) draw();
      }
    })();
    explorerLoadingFolders.set(prefix, load);
    return load;
  }

  async function expandFolder(folder: S3Folder): Promise<void> {
    if (!folder.collapsed) return;
    await ensureFolderLoaded(folder);
    folder.collapsed = false;
    draw();
  }

  async function loadExplorerRoot(): Promise<void> {
    if (!currentDbId || !currentBucket || disposed) return;
    if (explorerRootLoaded) return;
    resetExplorer();
    const dbId = currentDbId;
    const bucket = currentBucket;
    explorerGuard.dispose();
    const slot = explorerGuard.start();
    treePane = { status: text().loadingObjects, error: false };
    draw();
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
      treePane = null;
      if (!data) {
        draw();
        return;
      }
      const level = newLevel(0);
      addFolderPage(level, "", data, false);
      treePane = level;
      explorerRootLoaded = true;
      draw();
    } catch (err) {
      if (slot.isStale() || isAbortError(err)) return;
      treePane = {
        status: reportDatastoreFailure("S3", "folder tree", err, bucket),
        error: true,
      };
      draw();
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
      await expandFolder(dir);
      if (disposed) return;
    }
    const object = objectsByKey.get(key) ??
      fallbackHead ?? { key, sizeBytes: 0 };
    await selectObject(object);
    sidebarSlot
      .querySelector(`.s3-tree .tree-file[data-key="${CSS.escape(key)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function setView(next: S3ViewMode): void {
    currentView = next;
    draw();
    // ビュー初回表示時に対応するデータを遅延ロードする。
    if (next === "explorer") void loadExplorerRoot();
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
    newObjectShown = true;
    draw();
    notifySelectionChange();
    if (currentView === "explorer") await loadExplorerRoot();
    else await loadObjects(false);
  }

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
    currentMode = initialMode;
    searchInput().value = currentSearch;
    statusShown = false;
    objectsByKey.clear();
    resetExplorer();
    currentView = initialView;
    previewPane = "empty";
    const loading = { status: text().loadingBuckets, error: false };
    if (initialView === "explorer") {
      listPane = null;
      treePane = loading;
    } else listPane = loading;
    draw();
    try {
      const res = await fetch(
        `${apiUrl("dbS3Buckets")}?db=${encodeURIComponent(dbId)}`,
        { signal: slot.signal },
      );
      if (disposed || slot.isStale()) return;
      await requireOkResponse(res, tFailure().s3Buckets);
      const data = (await res.json()) as S3BucketsResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        currentDbId !== dbId
      ) {
        return;
      }
      buckets = data.buckets;
      bucketsDisabled = data.buckets.length === 0;
      const selected =
        (initial?.bucket &&
          data.buckets.some((bucket) => bucket.name === initial.bucket) &&
          initial.bucket) ||
        data.buckets[0]?.name ||
        null;
      if (!selected) {
        listPane = { status: text().noBuckets, error: false };
        draw();
        return;
      }
      // バケットが決まったので新規オブジェクト作成を許可する。
      newObjectShown = true;
      draw();
      // 選べる候補を描いた後に、選んだバケットを欄へ入れる。
      drawn(bucketRef, "bucket select").value = selected;
      suppressNotify = true;
      try {
        currentBucket = selected;
        currentKey = null;
        currentNextToken = undefined;
        notifySelectionChange();
        // head が取れなくても復元は続ける (行の大きさが出ないだけ)。
        // ただし理由は console に残す。
        const headPromise = initial?.key
          ? fetchObjectHeadForSelection(initial.key, slot.signal).catch(
              (err: unknown) => {
                if (!isAbortError(err)) {
                  reportDatastoreFailure(
                    "S3",
                    "object head",
                    err,
                    selected,
                    initial.key,
                  );
                }
                return null;
              },
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
      listPane = {
        status: reportDatastoreFailure("S3", "bucket list", err, dbId),
        error: true,
      };
      draw();
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
    currentMode = "prefix";
    searchInput().value = "";
    buckets = [];
    statusShown = false;
    listPane = null;
    objectsByKey.clear();
    resetExplorer();
    currentView = "list";
    previewPane = "empty";
    draw();
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

  function localize(): void {
    if (!currentKey) previewPane = "empty";
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
