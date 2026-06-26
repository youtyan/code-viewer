import type {
  RedisDatabasesResponse,
  RedisExplorerSelection,
  RedisItem,
  RedisKeysResponse,
  RedisValue,
  RedisValueResponse,
} from "../../core/database/types";
import { formatBytes } from "../../core/source-meta";
import { createAbortGuard } from "./abort-guard";
import { setPaneEmpty, setPaneStatus } from "./pane-status";

function isBinaryItem(item: RedisItem): item is { binaryBase64: string } {
  return typeof item === "object" && item !== null && "binaryBase64" in item;
}

// item を element に書き込む。binary なら base64 badge を頭に付ける。
// innerHTML 経由を避けて textContent + 要素生成で組み立てる。
function renderItemInto(el: HTMLElement, item: RedisItem): void {
  el.textContent = "";
  if (isBinaryItem(item)) {
    const badge = document.createElement("span");
    badge.className = "redis-binary-badge";
    badge.textContent = "binary, base64";
    el.appendChild(badge);
    el.appendChild(document.createTextNode(item.binaryBase64));
    return;
  }
  el.textContent = item;
}

export type RedisExplorerCallbacks = {
  // 選択中 (db index / key) が変わったことを外側に通知する。タブごとに
  // persist して reload 復元するために使う。
  onSelectionChange?: (selection: RedisExplorerSelection) => void;
};

export type RedisExplorerView = {
  el: HTMLElement;
  load: (dbId: string, initial?: RedisExplorerSelection) => Promise<void>;
  clear: () => void;
  dispose: () => void;
  getSelection: () => RedisExplorerSelection;
};

export function createRedisExplorer(
  callbacks: RedisExplorerCallbacks = {},
): RedisExplorerView {
  const container = document.createElement("div");
  container.className = "redis-explorer";

  const dbListPane = document.createElement("div");
  dbListPane.className = "redis-db-list-pane";

  const dbListHeader = document.createElement("div");
  dbListHeader.className = "db-explorer-pane-header";
  dbListHeader.textContent = "Databases";
  dbListPane.appendChild(dbListHeader);

  const dbList = document.createElement("div");
  dbList.className = "redis-db-list";
  dbListPane.appendChild(dbList);

  const keyListPane = document.createElement("div");
  keyListPane.className = "redis-key-list-pane";

  const keyListHeader = document.createElement("div");
  keyListHeader.className = "db-explorer-pane-header";
  keyListHeader.textContent = "Keys";
  keyListPane.appendChild(keyListHeader);

  const keyFilterForm = document.createElement("form");
  keyFilterForm.className = "redis-key-filter-form";
  const keyFilterInput = document.createElement("input");
  keyFilterInput.type = "search";
  keyFilterInput.className = "redis-key-filter";
  keyFilterInput.placeholder = "key pattern, e.g. user:*";
  keyFilterInput.autocomplete = "off";
  const keyFilterBtn = document.createElement("button");
  keyFilterBtn.type = "submit";
  keyFilterBtn.className = "redis-key-filter-btn";
  keyFilterBtn.textContent = "Search";
  keyFilterForm.append(keyFilterInput, keyFilterBtn);
  keyListPane.appendChild(keyFilterForm);

  const keyList = document.createElement("div");
  keyList.className = "redis-key-list";
  keyListPane.appendChild(keyList);

  const keyMoreBtn = document.createElement("button");
  keyMoreBtn.type = "button";
  keyMoreBtn.className = "redis-key-more-btn";
  keyMoreBtn.textContent = "Load more";
  keyMoreBtn.hidden = true;
  keyListPane.appendChild(keyMoreBtn);

  const mainPane = document.createElement("div");
  mainPane.className = "redis-main-pane";
  setPaneEmpty(mainPane, "Select a key to view its value.");

  container.append(dbListPane, keyListPane, mainPane);

  let currentDbId: string | null = null;
  let currentDbIndex: number | null = null;
  let currentKey: string | null = null;
  let currentKeyFilter = "*";
  let currentCursor = "0";
  let loadRunId = 0;
  let keyRunId = 0;
  let suppressNotify = false;
  let disposed = false;
  let activeDbRow: HTMLElement | null = null;
  let activeKeyRow: HTMLElement | null = null;
  const dbRowsByIndex = new Map<number, HTMLElement>();
  const keyRowsByName = new Map<string, HTMLElement>();
  const dbGuard = createAbortGuard();
  const keysGuard = createAbortGuard();
  const valueGuard = createAbortGuard();

  function notifySelectionChange(): void {
    if (suppressNotify) return;
    callbacks.onSelectionChange?.({
      dbIndex: currentDbIndex ?? undefined,
      key: currentKey ?? undefined,
      keyFilter: currentKeyFilter === "*" ? undefined : currentKeyFilter,
    });
  }

  function setDbStatus(message: string, isError = false) {
    setPaneStatus(dbList, message, { error: isError });
  }

  function setKeyStatus(message: string, isError = false) {
    setPaneStatus(keyList, message, {
      error: isError,
      afterClear: () => {
        keyMoreBtn.hidden = true;
      },
    });
  }

  function renderDatabases(
    databases: RedisDatabasesResponse["databases"],
  ): void {
    dbList.innerHTML = "";
    dbRowsByIndex.clear();
    const fragment = document.createDocumentFragment();
    for (const db of databases) {
      const item = document.createElement("div");
      item.className = "redis-db-item";
      item.dataset.dbIndex = String(db.index);
      dbRowsByIndex.set(db.index, item);
      const name = document.createElement("span");
      name.className = "redis-db-name";
      name.textContent = `db${db.index}`;
      const count = document.createElement("span");
      count.className = "redis-db-count";
      count.textContent = `${db.keyCount.toLocaleString()} keys`;
      item.append(name, count);
      fragment.appendChild(item);
    }
    dbList.appendChild(fragment);
  }

  function highlightActiveDb(index: number) {
    if (activeDbRow?.dataset.dbIndex === String(index)) return;
    activeDbRow?.classList.remove("active");
    activeDbRow = dbRowsByIndex.get(index) ?? null;
    activeDbRow?.classList.add("active");
  }

  function appendKeys(keys: RedisKeysResponse["keys"]): void {
    const fragment = document.createDocumentFragment();
    for (const k of keys) {
      const row = document.createElement("div");
      row.className = "redis-key-item";
      row.dataset.keyName = k.name;
      keyRowsByName.set(k.name, row);
      const typeBadge = document.createElement("span");
      typeBadge.className = `redis-type-badge redis-type-${k.type}`;
      typeBadge.textContent = k.type;
      const nameEl = document.createElement("span");
      nameEl.className = "redis-key-name";
      nameEl.textContent = k.name;
      nameEl.title = k.name;
      row.append(typeBadge, nameEl);
      fragment.appendChild(row);
    }
    keyList.appendChild(fragment);
  }

  function highlightActiveKey(name: string) {
    if (activeKeyRow?.dataset.keyName === name) return;
    activeKeyRow?.classList.remove("active");
    activeKeyRow = keyRowsByName.get(name) ?? null;
    activeKeyRow?.classList.add("active");
  }

  function makeNotice(message: string, kind: "info" | "warn" = "info") {
    const div = document.createElement("div");
    div.className =
      kind === "warn" ? "datastore-value-truncation" : "datastore-value-info";
    div.textContent = message;
    return div;
  }

  function renderValue(key: string, value: RedisValue): void {
    mainPane.innerHTML = "";
    const header = document.createElement("div");
    header.className = "redis-value-header";
    const typeBadge = document.createElement("span");
    typeBadge.className = `redis-type-badge redis-type-${value.type}`;
    typeBadge.textContent = value.type;
    const keyEl = document.createElement("span");
    keyEl.className = "redis-value-key-name";
    keyEl.textContent = key;
    header.append(typeBadge, keyEl);
    mainPane.appendChild(header);

    const body = document.createElement("div");
    body.className = "redis-value-body";
    if (value.type === "none") {
      body.textContent = "(key does not exist or has no value)";
      body.classList.add("redis-value-empty");
    } else if (value.type === "string") {
      if (value.binaryBase64 !== undefined) {
        body.appendChild(
          makeNotice(
            `(binary, base64; full size ${formatBytes(value.fullSize)}${value.truncated ? `, showing first ${formatBytes(64 * 1024)}` : ""})`,
            "warn",
          ),
        );
        const pre = document.createElement("pre");
        pre.className = "redis-value-string";
        pre.textContent = value.binaryBase64;
        body.appendChild(pre);
      } else {
        if (value.truncated) {
          body.appendChild(
            makeNotice(
              `(showing first ${formatBytes(64 * 1024)} of ${formatBytes(value.fullSize)})`,
              "warn",
            ),
          );
        }
        const pre = document.createElement("pre");
        pre.className = "redis-value-string";
        pre.textContent = value.value;
        body.appendChild(pre);
      }
    } else if (value.type === "hash") {
      if (value.truncated) {
        body.appendChild(
          makeNotice(
            `(showing ${Object.keys(value.fields).length} of ${value.total} fields, truncated)`,
            "warn",
          ),
        );
      }
      const table = document.createElement("table");
      table.className = "redis-value-hash-table";
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const label of ["Field", "Value"]) {
        const th = document.createElement("th");
        th.textContent = label;
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      if (value.fields.length === 0) {
        const row = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 2;
        td.className = "redis-value-empty";
        td.textContent = "(empty hash)";
        row.appendChild(td);
        tbody.appendChild(row);
      }
      for (const pair of value.fields) {
        const row = document.createElement("tr");
        const fieldTd = document.createElement("td");
        fieldTd.className = "redis-value-hash-field";
        renderItemInto(fieldTd, pair.field);
        const valTd = document.createElement("td");
        valTd.className = "redis-value-hash-val";
        renderItemInto(valTd, pair.value);
        row.append(fieldTd, valTd);
        tbody.appendChild(row);
      }
      table.appendChild(tbody);
      body.appendChild(table);
    } else if (value.type === "list") {
      if (value.truncated) {
        body.appendChild(
          makeNotice(
            `(showing ${value.items.length} of ${value.total} items, truncated)`,
            "warn",
          ),
        );
      }
      const ol = document.createElement("ol");
      ol.className = "redis-value-list";
      if (value.items.length === 0) {
        const li = document.createElement("li");
        li.className = "redis-value-empty";
        li.textContent = "(empty list)";
        ol.appendChild(li);
      }
      for (const item of value.items) {
        const li = document.createElement("li");
        renderItemInto(li, item);
        ol.appendChild(li);
      }
      body.appendChild(ol);
    } else {
      // set / zset / stream: raw JSON with truncation banner if applicable.
      if (value.truncated) {
        const shown =
          value.type === "set"
            ? value.members.length
            : value.type === "zset"
              ? value.members.length
              : value.entries.length;
        body.appendChild(
          makeNotice(
            `(showing ${shown} of ${value.total} entries, truncated)`,
            "warn",
          ),
        );
      }
      const pre = document.createElement("pre");
      pre.className = "redis-value-raw-json";
      pre.textContent = JSON.stringify(value, null, 2);
      body.appendChild(pre);
    }
    mainPane.appendChild(body);
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
    setPaneStatus(mainPane, "Loading value...");
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        dbIndex: String(requestDbIndex),
        key: name,
      });
      const res = await fetch(`/_db/redis/value?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      if (!res.ok) {
        const text = await res.text();
        setPaneStatus(mainPane, `Error: ${text || res.statusText}`, {
          error: true,
        });
        return;
      }
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
      renderValue(data.key, data.value);
    } catch (err) {
      if (slot.isStale()) return;
      if (requestRunId !== keyRunId || requestDbId !== currentDbId) return;
      setPaneStatus(
        mainPane,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        { error: true },
      );
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
    keyList.innerHTML = "";
    keyRowsByName.clear();
    activeKeyRow = null;
    setPaneEmpty(mainPane, "Select a key to view its value.");
    await loadKeys(false);
  }

  async function loadKeys(append: boolean): Promise<void> {
    if (disposed || currentDbId === null || currentDbIndex === null) return;
    const slot = keysGuard.start();
    const requestRunId = loadRunId;
    const requestDbId = currentDbId;
    const requestDbIndex = currentDbIndex;
    keyMoreBtn.disabled = true;
    if (!append) setKeyStatus("Loading keys...");
    try {
      const params = new URLSearchParams({
        db: requestDbId,
        dbIndex: String(requestDbIndex),
        pattern: currentKeyFilter || "*",
        cursor: currentCursor,
        count: "200",
      });
      const res = await fetch(`/_db/redis/keys?${params}`, {
        signal: slot.signal,
      });
      if (disposed || slot.isStale()) return;
      if (!res.ok) {
        const text = await res.text();
        setKeyStatus(`Error: ${text || res.statusText}`, true);
        return;
      }
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
      if (!append) {
        keyList.innerHTML = "";
        keyRowsByName.clear();
        activeKeyRow = null;
      }
      if (data.keys.length === 0 && !append) {
        setKeyStatus("(no keys)");
      } else {
        appendKeys(data.keys);
      }
      currentCursor = data.nextCursor;
      keyMoreBtn.hidden = currentCursor === "0";
    } catch (err) {
      if (slot.isStale()) return;
      if (requestRunId !== loadRunId || requestDbId !== currentDbId) return;
      setKeyStatus(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    } finally {
      slot.finish();
      if (!slot.isStale()) keyMoreBtn.disabled = false;
    }
  }

  keyMoreBtn.addEventListener("click", () => loadKeys(true));
  dbList.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".redis-db-item",
    );
    if (!row || !dbList.contains(row)) return;
    const raw = row.dataset.dbIndex;
    const index = raw === undefined ? NaN : Number(raw);
    if (Number.isInteger(index)) void selectDatabase(index);
  });
  keyList.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".redis-key-item",
    );
    if (!row || !keyList.contains(row)) return;
    const key = row.dataset.keyName;
    if (key) void selectKey(key);
  });

  keyFilterForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const nextFilter = keyFilterInput.value.trim() || "*";
    if (nextFilter === currentKeyFilter && currentCursor === "0") return;
    currentKeyFilter = nextFilter;
    currentKey = null;
    currentCursor = "0";
    notifySelectionChange();
    setPaneEmpty(mainPane, "Select a key to view its value.");
    void loadKeys(false);
  });

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
    keyFilterInput.value = currentKeyFilter === "*" ? "" : currentKeyFilter;
    currentCursor = "0";
    keyList.innerHTML = "";
    keyRowsByName.clear();
    activeDbRow = null;
    activeKeyRow = null;
    keyMoreBtn.hidden = true;
    setPaneEmpty(mainPane, "Select a key to view its value.");
    setDbStatus("Loading databases...");
    try {
      const res = await fetch(
        `/_db/redis/databases?db=${encodeURIComponent(dbId)}`,
        { signal: slot.signal },
      );
      if (disposed || slot.isStale()) return;
      if (!res.ok) {
        const text = await res.text();
        setDbStatus(`Error: ${text || res.statusText}`, true);
        return;
      }
      const data = (await res.json()) as RedisDatabasesResponse;
      if (
        disposed ||
        slot.isStale() ||
        requestRunId !== loadRunId ||
        currentDbId !== dbId
      )
        return;
      renderDatabases(data.databases);

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
          keyList.innerHTML = "";
          keyRowsByName.clear();
          setPaneEmpty(mainPane, "Select a key to view its value.");
          const valuePromise = initial.key
            ? selectKey(initial.key).catch(() => {})
            : null;
          await loadKeys(false);
          if (currentDbId !== dbId) return;
          if (valuePromise) {
            await valuePromise;
            if (initial.key) highlightActiveKey(initial.key);
          }
        } finally {
          suppressNotify = false;
        }
        notifySelectionChange();
      }
    } catch (err) {
      if (slot.isStale()) return;
      setDbStatus(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
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
    keyFilterInput.value = "";
    currentCursor = "0";
    dbList.innerHTML = "";
    keyList.innerHTML = "";
    dbRowsByIndex.clear();
    keyRowsByName.clear();
    activeDbRow = null;
    activeKeyRow = null;
    keyMoreBtn.hidden = true;
    setPaneEmpty(mainPane, "Select a database to view keys.");
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

  return { el: container, load, clear, dispose, getSelection };
}
