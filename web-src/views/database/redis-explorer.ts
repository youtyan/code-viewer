import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import { apiUrl } from "../../core/api-url";
import type {
  RedisDatabasesResponse,
  RedisExplorerSelection,
  RedisItem,
  RedisKeysResponse,
  RedisValue,
  RedisValueResponse,
} from "../../core/database/types";
import { formatBytes } from "../../core/source-meta";
import { renderOwned, templateElement } from "../ui/renderer";
import { showConfirmDialog } from "../ui-dialog";
import { createAbortGuard } from "./abort-guard";
import { type DbText, dbText } from "./i18n";
import { paneEmptyTemplate, paneStatusTemplate } from "./pane-status";
import { reportDatastoreFailure, requireOkResponse } from "./report-failure";

function isBinaryItem(item: RedisItem): item is { binaryBase64: string } {
  return typeof item === "object" && item !== null && "binaryBase64" in item;
}

// item の中身。binary なら base64 の札を頭に付ける。
function itemTemplate(item: RedisItem, binaryBadge: string): unknown {
  if (isBinaryItem(item))
    return html`<span class="redis-binary-badge">${binaryBadge}</span>${item.binaryBase64}`;
  return item;
}

export type RedisExplorerCallbacks = {
  // 選択中 (db index / key) が変わったことを外側に通知する。タブごとに
  // persist して reload 復元するために使う。
  onSelectionChange?: (selection: RedisExplorerSelection) => void;
  getText?: () => DbText;
  // 書き込み fetch を共通の in-flight 追跡に乗せる (AGENTS.md の Request
  // Lifecycle Discipline)。未指定なら素通し。
  trackLoad?: <T>(promise: Promise<T>) => Promise<T>;
};

export type RedisExplorerView = {
  el: HTMLElement;
  // Database リスト (db0/db1/...) を左サイドバー (db-sidebar) の dbToolbar
  // 直下に mount するためのスロット。container には含まれない。
  sidebarSlot: HTMLElement;
  load: (dbId: string, initial?: RedisExplorerSelection) => Promise<void>;
  clear: () => void;
  dispose: () => void;
  getSelection: () => RedisExplorerSelection;
  localize: () => void;
};

type PaneStatus = { status: string; error: boolean };
const isStatus = (pane: unknown): pane is PaneStatus =>
  typeof pane === "object" && pane !== null && "status" in pane;
type RedisKey = RedisKeysResponse["keys"][number];
type RedisDatabase = RedisDatabasesResponse["databases"][number];

/** 右の欄: 案内・札・値 (その場で書き直す欄を含む)・新しいキーを作る欄。 */
type RedisMainPane =
  | { empty: "selectKey" | "selectDatabase" }
  | PaneStatus
  | {
      key: string;
      value: RedisValue;
      editing: { current: string; message: string; busy: boolean } | null;
    }
  | { create: true; message: string; busy: boolean };

export type RedisSidebarProps = {
  text: DbText["explorer"];
  databases: null | PaneStatus | { list: RedisDatabase[] };
  activeDb: number | null;
  onSelectDb: (index: number) => void;
};

export type RedisMainProps = {
  text: DbText["explorer"];
  filterRef: Ref<HTMLInputElement>;
  keys: null | PaneStatus | { list: RedisKey[] };
  activeKey: string | null;
  more: { shown: boolean; disabled: boolean };
  pane: RedisMainPane;
  refs: {
    edit: Ref<HTMLTextAreaElement>;
    newName: Ref<HTMLInputElement>;
    newValue: Ref<HTMLTextAreaElement>;
  };
  onNewKey: () => void;
  onFilter: (event: Event) => void;
  onMore: () => void;
  onSelectKey: (name: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onCreate: (event: Event) => void;
  onCancelCreate: () => void;
};

export type RedisExplorerLook = {
  sidebar: (props: RedisSidebarProps) => unknown;
  main: (props: RedisMainProps) => unknown;
};

const notice = (message: string) =>
  html`<div class="datastore-value-truncation">${message}</div>`;

function valueBody(t: DbText["explorer"], value: RedisValue): unknown {
  const badge = t.redis.binaryBadge;
  if (value.type === "none")
    return html`<div class="redis-value-body redis-value-empty">${t.redis.noValue}</div>`;
  let content: unknown;
  if (value.type === "string") {
    content =
      value.binaryBase64 !== undefined
        ? html`${notice(
            value.truncated
              ? t.redis.binaryTruncatedNotice(
                  formatBytes(value.fullSize),
                  formatBytes(64 * 1024),
                )
              : t.redis.binaryNotice(formatBytes(value.fullSize)),
          )}<pre class="redis-value-string">${value.binaryBase64}</pre>`
        : html`${
            value.truncated
              ? notice(
                  t.redis.truncatedString(
                    formatBytes(64 * 1024),
                    formatBytes(value.fullSize),
                  ),
                )
              : nothing
          }<pre class="redis-value-string">${value.value}</pre>`;
  } else if (value.type === "hash") {
    content = html`${
      value.truncated
        ? notice(
            t.redis.truncatedFields(
              Object.keys(value.fields).length.toLocaleString(),
              value.total.toLocaleString(),
            ),
          )
        : nothing
    }<table class="redis-value-hash-table"><thead><tr><th>${t.redis.fieldHeader}</th><th
            >${t.redis.valueHeader}</th
          ></tr></thead
        ><tbody>${
          value.fields.length === 0
            ? html`<tr><td colspan="2" class="redis-value-empty"
                  >${t.redis.emptyHash}</td
                ></tr>`
            : nothing
        }${value.fields.map(
          (pair) =>
            html`<tr><td class="redis-value-hash-field">${itemTemplate(
              pair.field,
              badge,
            )}</td><td class="redis-value-hash-val">${itemTemplate(
              pair.value,
              badge,
            )}</td></tr>`,
        )}</tbody></table>`;
  } else if (value.type === "list") {
    content = html`${
      value.truncated
        ? notice(
            t.redis.truncatedItems(
              value.items.length.toLocaleString(),
              value.total.toLocaleString(),
            ),
          )
        : nothing
    }<ol class="redis-value-list">${
      value.items.length === 0
        ? html`<li class="redis-value-empty">${t.redis.emptyList}</li>`
        : nothing
    }${value.items.map((item) => html`<li>${itemTemplate(item, badge)}</li>`)}</ol>`;
  } else {
    // set / zset / stream: raw JSON with truncation banner if applicable.
    const shown =
      value.type === "set" || value.type === "zset"
        ? value.members.length
        : value.entries.length;
    content = html`${
      value.truncated
        ? notice(
            t.redis.truncatedEntries(
              shown.toLocaleString(),
              value.total.toLocaleString(),
            ),
          )
        : nothing
    }<pre class="redis-value-raw-json">${JSON.stringify(value, null, 2)}</pre>`;
  }
  return html`<div class="redis-value-body">${content}</div>`;
}

function mainPaneTemplate(p: RedisMainProps): unknown {
  const t = p.text;
  const pane = p.pane;
  if ("empty" in pane)
    return paneEmptyTemplate(
      pane.empty === "selectKey" ? t.redis.selectKey : t.redis.selectDatabase,
    );
  if (isStatus(pane)) return paneStatusTemplate(pane.status, pane.error);
  const status = (message: string) =>
    html`<span class="redis-value-edit-status">${message}</span>`;
  if ("create" in pane)
    return html`<form class="redis-new-key-form" @submit=${p.onCreate}><div
        class="redis-value-edit-bar"
      ><button
          type="submit"
          class="db-btn db-btn-primary db-btn-sm"
          ?disabled=${pane.busy}
        >${t.redis.create}</button><button
          type="button"
          class="db-btn db-btn-sm"
          @click=${p.onCancelCreate}
        >${t.common.cancel}</button>${status(pane.message)}</div
      ><input
        type="text"
        class="redis-new-key-name"
        placeholder=${t.redis.newKeyNamePlaceholder}
        autocomplete="off"
        ${ref(p.refs.newName)}
      /><textarea
        class="redis-new-key-value"
        placeholder=${t.redis.newKeyValuePlaceholder}
        ${ref(p.refs.newValue)}
      ></textarea></form>`;
  const value = pane.value;
  // 値編集アクション。文字列 (全文・非バイナリ) は Edit、存在するキーは Delete。
  const editable =
    value.type === "string" &&
    value.binaryBase64 === undefined &&
    !value.truncated;
  return html`<div class="redis-value-header"><span
        class=${`redis-type-badge redis-type-${value.type}`}
        >${value.type}</span
      ><span class="redis-value-key-name">${pane.key}</span><div
        class="redis-value-actions"
      >${
        editable
          ? html`<button type="button" class="db-btn db-btn-sm" @click=${p.onEdit}
              >${t.common.edit}</button
            >`
          : nothing
      }${
        value.type !== "none"
          ? html`<button
              type="button"
              class="db-btn db-btn-sm"
              @click=${p.onDelete}
            >${t.common.delete}</button>`
          : nothing
      }</div></div
    >${
      pane.editing
        ? html`<div class="redis-value-body"><div class="redis-value-edit-bar"
              ><button
                type="button"
                class="db-btn db-btn-primary db-btn-sm"
                ?disabled=${pane.editing.busy}
                @click=${p.onSave}
              >${t.common.save}</button><button
                type="button"
                class="db-btn db-btn-sm"
                ?disabled=${pane.editing.busy}
                @click=${p.onCancelEdit}
              >${t.common.cancel}</button>${status(pane.editing.message)}</div
            ><textarea
              class="redis-value-edit-textarea"
              .value=${pane.editing.current}
              ${ref(p.refs.edit)}
            ></textarea></div>`
        : valueBody(t, value)
    }`;
}

export const DEFAULT_VIEW: RedisExplorerLook = {
  sidebar: (p) =>
    html`<div class="db-explorer-pane-header">${p.text.redis.databases}</div><div
        class="redis-db-list"
      >${
        p.databases === null
          ? nothing
          : isStatus(p.databases)
            ? paneStatusTemplate(p.databases.status, p.databases.error)
            : p.databases.list.map(
                (db) =>
                  html`<div
                    class=${db.index === p.activeDb ? "redis-db-item active" : "redis-db-item"}
                    data-db-index=${db.index}
                    @click=${() => p.onSelectDb(db.index)}
                  ><span class="redis-db-name">db${db.index}</span><span
                      class="redis-db-count"
                      >${p.text.redis.keyCount(db.keyCount.toLocaleString())}</span
                    ></div>`,
              )
      }</div>`,
  main: (p) =>
    html`<div class="redis-key-list-pane"><div
          class="db-explorer-pane-header redis-key-list-header"
        ><span>${p.text.redis.keys}</span><button
            type="button"
            class="db-btn db-btn-sm redis-new-key-btn"
            title=${p.text.redis.newKey}
            @click=${p.onNewKey}
          >＋ ${p.text.redis.newKey}</button></div
        ><form class="redis-key-filter-form" @submit=${p.onFilter}><input
            type="search"
            class="redis-key-filter"
            placeholder=${p.text.redis.keyFilterPlaceholder}
            autocomplete="off"
            ${ref(p.filterRef)}
          /><button type="submit" class="redis-key-filter-btn"
            >${p.text.common.search}</button
          ></form
        ><div class="redis-key-list">${
          p.keys === null
            ? nothing
            : isStatus(p.keys)
              ? paneStatusTemplate(p.keys.status, p.keys.error)
              : p.keys.list.map(
                  (k) =>
                    html`<div
                      class=${k.name === p.activeKey ? "redis-key-item active" : "redis-key-item"}
                      data-key-name=${k.name}
                      @click=${() => p.onSelectKey(k.name)}
                    ><span class=${`redis-type-badge redis-type-${k.type}`}
                        >${k.type}</span
                      ><span class="redis-key-name" title=${k.name}
                        >${k.name}</span
                      ></div>`,
                )
        }</div><button
          type="button"
          class="redis-key-more-btn"
          ?hidden=${!p.more.shown}
          ?disabled=${p.more.disabled}
          @click=${p.onMore}
        >${p.text.common.loadMore}</button></div
      ><div class="redis-main-pane">${mainPaneTemplate(p)}</div>`,
};

/** 1 回に取るキーの数。 */
const KEYS_PAGE_SIZE = 200;

export function createRedisExplorer(
  callbacks: RedisExplorerCallbacks = {},
  view: RedisExplorerLook = DEFAULT_VIEW,
): RedisExplorerView {
  const text = (): DbText["explorer"] =>
    (callbacks.getText?.() ?? dbText("en")).explorer;
  const tFailure = (): DbText["failure"] =>
    (callbacks.getText?.() ?? dbText("en")).failure;
  const filterRef = createRef<HTMLInputElement>();
  const refs = {
    edit: createRef<HTMLTextAreaElement>(),
    newName: createRef<HTMLInputElement>(),
    newValue: createRef<HTMLTextAreaElement>(),
  };
  const drawn = <T extends Element>(target: Ref<T>, name: string): T => {
    const element = target.value;
    if (!element) throw new Error(`Redis explorer: the ${name} was not drawn`);
    return element;
  };

  let currentDbId: string | null = null;
  let currentDbIndex: number | null = null;
  let currentKey: string | null = null;
  let currentKeyFilter = "*";
  let currentCursor = "0";
  let loadRunId = 0;
  let keyRunId = 0;
  let suppressNotify = false;
  let disposed = false;
  let dbPane: RedisSidebarProps["databases"] = null;
  let activeDb: number | null = null;
  let keysPane: RedisMainProps["keys"] = null;
  let activeKey: string | null = null;
  let keyMore = { shown: false, disabled: false };
  let mainPane: RedisMainPane = { empty: "selectKey" };
  const dbGuard = createAbortGuard();
  const keysGuard = createAbortGuard();
  const valueGuard = createAbortGuard();

  const sidebarSlot = templateElement(
    html`<div class="db-explorer-sidebar-slot redis-db-list-pane"></div>`,
  );
  const container = templateElement(html`<div class="redis-explorer"></div>`);

  function draw(): void {
    const t = text();
    renderOwned(
      sidebarSlot,
      view.sidebar({
        text: t,
        databases: dbPane,
        activeDb,
        onSelectDb: (index) => void selectDatabase(index),
      }),
    );
    renderOwned(
      container,
      view.main({
        text: t,
        filterRef,
        keys: keysPane,
        activeKey,
        more: keyMore,
        pane: mainPane,
        refs,
        onNewKey: showNewKeyForm,
        onFilter: (event) => {
          event.preventDefault();
          applyFilter();
        },
        onMore: () => void loadKeys(true),
        onSelectKey: (name) => void selectKey(name),
        onEdit: () => {
          if ("key" in mainPane && mainPane.value.type === "string")
            startStringEdit(mainPane.value.value);
        },
        onDelete: () => {
          if ("key" in mainPane) void deleteCurrentKey(mainPane.key);
        },
        onSave: () => void saveString(),
        onCancelEdit: () => {
          if ("key" in mainPane) void selectKey(mainPane.key);
        },
        onCreate: (event) => {
          event.preventDefault();
          void createKey();
        },
        onCancelCreate: () => {
          if (currentKey) void selectKey(currentKey);
          else showMain({ empty: "selectKey" });
        },
      }),
    );
  }

  function showMain(pane: RedisMainPane): void {
    mainPane = pane;
    draw();
  }

  function notifySelectionChange(): void {
    if (suppressNotify) return;
    callbacks.onSelectionChange?.({
      dbIndex: currentDbIndex ?? undefined,
      key: currentKey ?? undefined,
      keyFilter: currentKeyFilter === "*" ? undefined : currentKeyFilter,
    });
  }

  function setKeyStatus(message: string, isError = false) {
    keysPane = { status: message, error: isError };
    keyMore = { ...keyMore, shown: false };
    draw();
  }

  function highlightActiveDb(index: number) {
    activeDb =
      dbPane !== null &&
      !isStatus(dbPane) &&
      dbPane.list.some((db) => db.index === index)
        ? index
        : null;
  }

  function highlightActiveKey(name: string) {
    activeKey =
      keysPane !== null &&
      !isStatus(keysPane) &&
      keysPane.list.some((k) => k.name === name)
        ? name
        : null;
  }

  function writeBase(): { db: string; dbIndex: number } | null {
    if (currentDbId === null || currentDbIndex === null) return null;
    return { db: currentDbId, dbIndex: currentDbIndex };
  }

  async function postRedisWrite(body: Record<string, unknown>): Promise<void> {
    const doFetch = fetch(apiUrl("dbRedisWrite"), {
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
    await requireOkResponse(res, tFailure().redisWrite);
  }

  async function deleteCurrentKey(key: string): Promise<void> {
    const base = writeBase();
    if (!base) return;
    const ok = await showConfirmDialog({
      body: text().redis.confirmDeleteKey(key),
      confirmLabel: text().common.delete,
      danger: true,
    });
    if (!ok) return;
    try {
      await postRedisWrite({ ...base, key, op: "delete" });
      currentKey = null;
      showMain({ empty: "selectKey" });
      await loadKeys(false);
    } catch (err) {
      showMain({
        status: text().common.saveError(
          reportDatastoreFailure("Redis", "key delete", err, base.dbIndex, key),
        ),
        error: true,
      });
    }
  }

  // 文字列値をその場で textarea 編集する。truncated/binary は対象外
  // (全文が手元に無いため上書きで欠損する)。
  function startStringEdit(current: string): void {
    if (!("key" in mainPane)) return;
    showMain({
      ...mainPane,
      editing: { current, message: "", busy: false },
    });
    refs.edit.value?.focus();
  }

  async function saveString(): Promise<void> {
    if (!("key" in mainPane) || !mainPane.editing) return;
    const editingPane = mainPane;
    const editing = mainPane.editing;
    const key = mainPane.key;
    const base = writeBase();
    if (!base) return;
    const value = drawn(refs.edit, "editor").value;
    showMain({
      ...editingPane,
      editing: { ...editing, busy: true, message: text().common.saving },
    });
    try {
      await postRedisWrite({ ...base, key, op: "setString", value });
      await selectKey(key);
    } catch (err) {
      showMain({
        ...editingPane,
        editing: {
          ...editing,
          busy: false,
          message: text().common.saveError(
            reportDatastoreFailure(
              "Redis",
              "key write",
              err,
              base.dbIndex,
              key,
            ),
          ),
        },
      });
    }
  }

  // 新規キー (文字列) 作成フォームを右の欄に出す。
  function showNewKeyForm(): void {
    if (currentDbIndex === null) {
      showMain({ status: text().redis.selectDatabase, error: false });
      return;
    }
    showMain({ create: true, message: "", busy: false });
    refs.newName.value?.focus();
  }

  async function createKey(): Promise<void> {
    if (!("create" in mainPane)) return;
    const base = writeBase();
    if (!base) return;
    const nameInput = drawn(refs.newName, "new key name");
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const value = drawn(refs.newValue, "new key value").value;
    showMain({ create: true, busy: true, message: text().common.saving });
    try {
      await postRedisWrite({ ...base, key: name, op: "createString", value });
      await loadKeys(false);
      await selectKey(name);
    } catch (err) {
      showMain({
        create: true,
        busy: false,
        message: text().common.saveError(
          reportDatastoreFailure(
            "Redis",
            "key create",
            err,
            base.dbIndex,
            name,
          ),
        ),
      });
    }
  }

  async function selectKey(name: string): Promise<void> {
    if (disposed || currentDbId === null || currentDbIndex === null) return;
    const slot = valueGuard.start();
    const requestRunId = ++keyRunId;
    const requestDbId = currentDbId;
    const requestDbIndex = currentDbIndex;
    currentKey = name;
    notifySelectionChange();
    highlightActiveKey(name);
    showMain({ status: text().redis.loadingValue, error: false });
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        dbIndex: String(requestDbIndex),
        key: name,
      });
      const res = await fetch(`${apiUrl("dbRedisValue")}?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      await requireOkResponse(res, tFailure().redisValue);
      const data = (await res.json()) as RedisValueResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== keyRunId ||
        requestDbId !== currentDbId ||
        requestDbIndex !== currentDbIndex ||
        name !== currentKey
      ) {
        return;
      }
      showMain({ key: data.key, value: data.value, editing: null });
    } catch (err) {
      if (slot.isStale()) return;
      if (requestRunId !== keyRunId || requestDbId !== currentDbId) return;
      showMain({
        status: reportDatastoreFailure(
          "Redis",
          "value",
          err,
          requestDbIndex,
          name,
        ),
        error: true,
      });
    } finally {
      slot.finish();
    }
  }

  async function selectDatabase(dbIndex: number): Promise<void> {
    if (disposed) return;
    currentDbIndex = dbIndex;
    currentKey = null;
    currentCursor = "0";
    notifySelectionChange();
    highlightActiveDb(dbIndex);
    keysPane = null;
    activeKey = null;
    showMain({ empty: "selectKey" });
    await loadKeys(false);
  }

  async function loadKeys(append: boolean): Promise<void> {
    if (disposed || currentDbId === null || currentDbIndex === null) return;
    const slot = keysGuard.start();
    const requestRunId = loadRunId;
    const requestDbId = currentDbId;
    const requestDbIndex = currentDbIndex;
    keyMore = { ...keyMore, disabled: true };
    if (!append) setKeyStatus(text().redis.loadingKeys);
    else draw();
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        dbIndex: String(requestDbIndex),
        pattern: currentKeyFilter || "*",
        cursor: currentCursor,
        count: String(KEYS_PAGE_SIZE),
      });
      const res = await fetch(`${apiUrl("dbRedisKeys")}?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      await requireOkResponse(res, tFailure().redisKeys);
      const data = (await res.json()) as RedisKeysResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        requestDbId !== currentDbId ||
        requestDbIndex !== currentDbIndex ||
        data.dbIndex !== requestDbIndex
      ) {
        return;
      }
      const shown =
        append && keysPane !== null && !isStatus(keysPane) ? keysPane.list : [];
      if (!append) activeKey = null;
      currentCursor = data.nextCursor;
      if (data.keys.length === 0 && !append) {
        setKeyStatus(text().redis.noKeys);
        keyMore = { ...keyMore, shown: currentCursor !== "0" };
      } else {
        keysPane = { list: [...shown, ...data.keys] };
        keyMore = { ...keyMore, shown: currentCursor !== "0" };
      }
      draw();
    } catch (err) {
      if (slot.isStale()) return;
      if (requestRunId !== loadRunId || requestDbId !== currentDbId) return;
      setKeyStatus(
        reportDatastoreFailure(
          "Redis",
          "key list",
          err,
          requestDbIndex,
          currentKeyFilter,
        ),
        true,
      );
    } finally {
      slot.finish();
      if (!slot.isStale()) {
        keyMore = { ...keyMore, disabled: false };
        draw();
      }
    }
  }

  function applyFilter(): void {
    const nextFilter = drawn(filterRef, "key filter").value.trim() || "*";
    if (nextFilter === currentKeyFilter && currentCursor === "0") return;
    currentKeyFilter = nextFilter;
    currentKey = null;
    currentCursor = "0";
    notifySelectionChange();
    showMain({ empty: "selectKey" });
    void loadKeys(false);
  }

  async function load(
    dbId: string,
    initial?: RedisExplorerSelection,
  ): Promise<void> {
    if (disposed) return;
    if (currentDbId === dbId && !initial) return;
    dbGuard.dispose();
    keysGuard.dispose();
    valueGuard.dispose();
    const slot = dbGuard.start();
    const requestRunId = ++loadRunId;
    currentDbId = dbId;
    currentDbIndex = null;
    currentKey = null;
    currentKeyFilter = initial?.keyFilter?.trim() || "*";
    drawn(filterRef, "key filter").value =
      currentKeyFilter === "*" ? "" : currentKeyFilter;
    currentCursor = "0";
    keysPane = null;
    activeDb = null;
    activeKey = null;
    keyMore = { ...keyMore, shown: false };
    mainPane = { empty: "selectKey" };
    dbPane = { status: text().redis.loadingDatabases, error: false };
    draw();
    try {
      const res = await fetch(
        `${apiUrl("dbRedisDatabases")}?db=${encodeURIComponent(dbId)}`,
        { signal: slot.signal },
      );
      if (disposed || slot.isStale()) return;
      await requireOkResponse(res, tFailure().redisDatabases);
      const data = (await res.json()) as RedisDatabasesResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        currentDbId !== dbId
      )
        return;
      dbPane = { list: data.databases };
      draw();

      // initial.dbIndex が指定されていて、かつ実在する db index ならその db を
      // 自動選択し、さらに initial.key が指定されていればその key も再選択する。
      // load 自体が「タブ復元」用に呼ばれることがあるので、ここで再現する。
      if (
        initial?.dbIndex !== undefined &&
        data.databases.some((d) => d.index === initial.dbIndex)
      ) {
        suppressNotify = true;
        try {
          currentDbIndex = initial.dbIndex;
          currentKey = null;
          currentCursor = "0";
          highlightActiveDb(initial.dbIndex);
          keysPane = null;
          showMain({ empty: "selectKey" });
          const valuePromise = initial.key
            ? selectKey(initial.key).catch((err: unknown) => {
                reportDatastoreFailure(
                  "Redis",
                  "key restore",
                  err,
                  initial.dbIndex,
                  initial.key,
                );
              })
            : null;
          await loadKeys(false);
          if (currentDbId !== dbId) return;
          if (valuePromise) {
            await valuePromise;
            if (initial.key) {
              highlightActiveKey(initial.key);
              draw();
            }
          }
        } finally {
          suppressNotify = false;
        }
        notifySelectionChange();
      }
    } catch (err) {
      if (slot.isStale()) return;
      dbPane = {
        status: reportDatastoreFailure("Redis", "database list", err, dbId),
        error: true,
      };
      draw();
    } finally {
      slot.finish();
    }
  }

  function clear(): void {
    dbGuard.dispose();
    keysGuard.dispose();
    valueGuard.dispose();
    loadRunId++;
    keyRunId++;
    suppressNotify = false;
    currentDbId = null;
    currentDbIndex = null;
    currentKey = null;
    currentKeyFilter = "*";
    drawn(filterRef, "key filter").value = "";
    currentCursor = "0";
    dbPane = null;
    keysPane = null;
    activeDb = null;
    activeKey = null;
    keyMore = { ...keyMore, shown: false };
    showMain({ empty: "selectDatabase" });
  }

  function getSelection(): RedisExplorerSelection {
    return {
      dbIndex: currentDbIndex ?? undefined,
      key: currentKey ?? undefined,
      keyFilter: currentKeyFilter === "*" ? undefined : currentKeyFilter,
    };
  }

  function dispose(): void {
    disposed = true;
    clear();
  }

  function localize(): void {
    // 空状態のプレースホルダは「DB未選択」か「キー未選択」かで文言が異なる。
    // 値を描いている欄 (見出し・切り詰めの注記・操作ボタン) は、描き直すと
    // 今の言語になる。書き直している欄は触らない。
    if (!currentKey)
      mainPane = { empty: currentDbId ? "selectKey" : "selectDatabase" };
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
