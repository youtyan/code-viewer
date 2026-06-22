import type {
  RedisDatabasesResponse,
  RedisKeysResponse,
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
      keyList.appendChild(row);
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
