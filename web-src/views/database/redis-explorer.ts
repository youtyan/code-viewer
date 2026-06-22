import type {
  RedisDatabasesResponse,
  RedisKeysResponse,
  RedisValue,
  RedisValueResponse,
} from "../../core/database/types";

export type RedisExplorerView = {
  el: HTMLElement;
  load: (dbId: string) => Promise<void>;
  clear: () => void;
};

export function createRedisExplorer(): RedisExplorerView {
  const container = document.createElement("div");
  container.className = "redis-explorer";

  const dbListPane = document.createElement("div");
  dbListPane.className = "redis-db-list-pane";

  const dbListHeader = document.createElement("div");
  dbListHeader.className = "redis-pane-header";
  dbListHeader.textContent = "Databases";
  dbListPane.appendChild(dbListHeader);

  const dbList = document.createElement("div");
  dbList.className = "redis-db-list";
  dbListPane.appendChild(dbList);

  const keyListPane = document.createElement("div");
  keyListPane.className = "redis-key-list-pane";

  const keyListHeader = document.createElement("div");
  keyListHeader.className = "redis-pane-header";
  keyListHeader.textContent = "Keys";
  keyListPane.appendChild(keyListHeader);

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
  mainPane.textContent = "Select a key to view its value.";

  container.append(dbListPane, keyListPane, mainPane);

  let currentDbId: string | null = null;
  let currentDbIndex: number | null = null;
  let currentCursor = "0";
  let loadingKeys = false;

  function setDbStatus(message: string, isError = false) {
    dbList.innerHTML = "";
    const note = document.createElement("div");
    note.className = isError ? "redis-error" : "redis-note";
    note.textContent = message;
    dbList.appendChild(note);
  }

  function setKeyStatus(message: string, isError = false) {
    keyList.innerHTML = "";
    const note = document.createElement("div");
    note.className = isError ? "redis-error" : "redis-note";
    note.textContent = message;
    keyList.appendChild(note);
    keyMoreBtn.hidden = true;
  }

  function renderDatabases(
    databases: RedisDatabasesResponse["databases"],
  ): void {
    dbList.innerHTML = "";
    for (const db of databases) {
      const item = document.createElement("div");
      item.className = "redis-db-item";
      item.dataset.dbIndex = String(db.index);
      const name = document.createElement("span");
      name.className = "redis-db-name";
      name.textContent = `db${db.index}`;
      const count = document.createElement("span");
      count.className = "redis-db-count";
      count.textContent = `${db.keyCount.toLocaleString()} keys`;
      item.append(name, count);
      item.addEventListener("click", () => selectDatabase(db.index));
      dbList.appendChild(item);
    }
  }

  function highlightActiveDb(index: number) {
    for (const item of dbList.querySelectorAll<HTMLElement>(".redis-db-item")) {
      item.classList.toggle("active", item.dataset.dbIndex === String(index));
    }
  }

  function appendKeys(keys: RedisKeysResponse["keys"]): void {
    for (const k of keys) {
      const row = document.createElement("div");
      row.className = "redis-key-item";
      row.dataset.keyName = k.name;
      const typeBadge = document.createElement("span");
      typeBadge.className = `redis-type-badge redis-type-${k.type}`;
      typeBadge.textContent = k.type;
      const nameEl = document.createElement("span");
      nameEl.className = "redis-key-name";
      nameEl.textContent = k.name;
      nameEl.title = k.name;
      row.append(typeBadge, nameEl);
      row.addEventListener("click", () => selectKey(k.name));
      keyList.appendChild(row);
    }
  }

  function highlightActiveKey(name: string) {
    for (const row of keyList.querySelectorAll<HTMLElement>(
      ".redis-key-item",
    )) {
      row.classList.toggle("active", row.dataset.keyName === name);
    }
  }

  function formatBytes(n: number): string {
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  }

  function makeNotice(message: string, kind: "info" | "warn" = "info") {
    const div = document.createElement("div");
    div.className =
      kind === "warn" ? "redis-value-truncation" : "redis-value-info";
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
      const entries = Object.entries(value.fields);
      if (entries.length === 0) {
        const row = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 2;
        td.className = "redis-value-empty";
        td.textContent = "(empty hash)";
        row.appendChild(td);
        tbody.appendChild(row);
      }
      for (const [field, val] of entries) {
        const row = document.createElement("tr");
        const fieldTd = document.createElement("td");
        fieldTd.className = "redis-value-hash-field";
        fieldTd.textContent = field;
        const valTd = document.createElement("td");
        valTd.className = "redis-value-hash-val";
        valTd.textContent = val;
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
        li.textContent = item;
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
    if (currentDbId === null || currentDbIndex === null) return;
    highlightActiveKey(name);
    mainPane.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "redis-note";
    loading.textContent = "Loading value...";
    mainPane.appendChild(loading);
    const requestDbIndex = currentDbIndex;
    try {
      const params = new URLSearchParams({
        db: currentDbId,
        dbIndex: String(requestDbIndex),
        key: name,
      });
      const res = await fetch(`/_db/redis/value?${params}`);
      if (!res.ok) {
        const text = await res.text();
        mainPane.innerHTML = "";
        const err = document.createElement("div");
        err.className = "redis-error";
        err.textContent = `Error: ${text || res.statusText}`;
        mainPane.appendChild(err);
        return;
      }
      const data = (await res.json()) as RedisValueResponse;
      if (requestDbIndex !== currentDbIndex) return;
      renderValue(data.key, data.value);
    } catch (err) {
      mainPane.innerHTML = "";
      const errEl = document.createElement("div");
      errEl.className = "redis-error";
      errEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      mainPane.appendChild(errEl);
    }
  }

  async function selectDatabase(dbIndex: number): Promise<void> {
    currentDbIndex = dbIndex;
    currentCursor = "0";
    highlightActiveDb(dbIndex);
    keyList.innerHTML = "";
    mainPane.textContent = "Select a key to view its value.";
    await loadKeys(false);
  }

  async function loadKeys(append: boolean): Promise<void> {
    if (currentDbId === null || currentDbIndex === null) return;
    if (loadingKeys) return;
    loadingKeys = true;
    keyMoreBtn.disabled = true;
    if (!append) setKeyStatus("Loading keys...");
    try {
      const params = new URLSearchParams({
        db: currentDbId,
        dbIndex: String(currentDbIndex),
        pattern: "*",
        cursor: currentCursor,
        count: "200",
      });
      const res = await fetch(`/_db/redis/keys?${params}`);
      if (!res.ok) {
        const text = await res.text();
        setKeyStatus(`Error: ${text || res.statusText}`, true);
        return;
      }
      const data = (await res.json()) as RedisKeysResponse;
      if (currentDbIndex !== data.dbIndex) return; // stale
      if (!append) keyList.innerHTML = "";
      if (data.keys.length === 0 && !append) {
        setKeyStatus("(no keys)");
      } else {
        appendKeys(data.keys);
      }
      currentCursor = data.nextCursor;
      keyMoreBtn.hidden = currentCursor === "0";
    } catch (err) {
      setKeyStatus(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    } finally {
      loadingKeys = false;
      keyMoreBtn.disabled = false;
    }
  }

  keyMoreBtn.addEventListener("click", () => loadKeys(true));

  async function load(dbId: string): Promise<void> {
    currentDbId = dbId;
    currentDbIndex = null;
    currentCursor = "0";
    keyList.innerHTML = "";
    keyMoreBtn.hidden = true;
    mainPane.textContent = "Select a key to view its value.";
    setDbStatus("Loading databases...");
    try {
      const res = await fetch(
        `/_db/redis/databases?db=${encodeURIComponent(dbId)}`,
      );
      if (!res.ok) {
        const text = await res.text();
        setDbStatus(`Error: ${text || res.statusText}`, true);
        return;
      }
      const data = (await res.json()) as RedisDatabasesResponse;
      if (currentDbId !== dbId) return; // stale response
      renderDatabases(data.databases);
    } catch (err) {
      setDbStatus(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
  }

  function clear(): void {
    currentDbId = null;
    currentDbIndex = null;
    currentCursor = "0";
    dbList.innerHTML = "";
    keyList.innerHTML = "";
    keyMoreBtn.hidden = true;
    mainPane.textContent = "Select a database to view keys.";
  }

  return { el: container, load, clear };
}
