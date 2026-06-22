import type { RedisDatabasesResponse } from "../../core/database/types";

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

  const mainPane = document.createElement("div");
  mainPane.className = "redis-main-pane";
  mainPane.textContent = "Select a database to view keys.";

  container.append(dbListPane, mainPane);

  let currentDbId: string | null = null;

  function setStatus(message: string, isError = false) {
    dbList.innerHTML = "";
    const note = document.createElement("div");
    note.className = isError ? "redis-error" : "redis-note";
    note.textContent = message;
    dbList.appendChild(note);
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
      dbList.appendChild(item);
    }
  }

  async function load(dbId: string): Promise<void> {
    currentDbId = dbId;
    setStatus("Loading databases...");
    try {
      const res = await fetch(
        `/_db/redis/databases?db=${encodeURIComponent(dbId)}`,
      );
      if (!res.ok) {
        const text = await res.text();
        setStatus(`Error: ${text || res.statusText}`, true);
        return;
      }
      const data = (await res.json()) as RedisDatabasesResponse;
      if (currentDbId !== dbId) return; // stale response
      renderDatabases(data.databases);
    } catch (err) {
      setStatus(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
  }

  function clear(): void {
    currentDbId = null;
    dbList.innerHTML = "";
    mainPane.textContent = "Select a database to view keys.";
  }

  return { el: container, load, clear };
}
