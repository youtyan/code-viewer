import type { DbColumn, DbSchemaResponse } from "../../core/database/types";
import { loadMermaid } from "../../core/mermaid-loader";
import { type DbText, dbText } from "./i18n";

export type ErDiagram = {
  el: HTMLElement;
  render: (
    schema: DbSchemaResponse,
    columnsMap: Map<string, DbColumn[]>,
  ) => Promise<void>;
  clear: () => void;
  dispose: () => void;
  localize: () => void;
};

function mermaidType(sqlType: string): string {
  const upper = sqlType.toUpperCase();
  if (upper.includes("INT")) return "int";
  if (
    upper.includes("TEXT") ||
    upper.includes("VARCHAR") ||
    upper.includes("CHAR")
  )
    return "string";
  if (
    upper.includes("REAL") ||
    upper.includes("FLOAT") ||
    upper.includes("DOUBLE")
  )
    return "float";
  if (upper.includes("BLOB")) return "blob";
  if (upper.includes("BOOL")) return "bool";
  if (upper.includes("DATE") || upper.includes("TIME")) return "datetime";
  if (upper.includes("NUMERIC") || upper.includes("DECIMAL")) return "decimal";
  return sqlType.replace(/[^a-zA-Z0-9]/g, "_") || "text";
}

function sanitizeMermaidId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function buildErMarkup(
  schema: DbSchemaResponse,
  columnsMap: Map<string, DbColumn[]>,
): string {
  const lines: string[] = ["erDiagram"];

  for (const table of schema.tables) {
    if (table.type === "view") continue;
    if (!columnsMap.has(table.name)) continue;
    const id = sanitizeMermaidId(table.name);
    const cols = columnsMap.get(table.name) || [];
    lines.push(`  ${id} {`);
    for (const col of cols) {
      const markers: string[] = [];
      if (col.primaryKey) markers.push("PK");
      const fk = schema.foreignKeys.find(
        (f) => f.fromTable === table.name && f.fromColumn === col.name,
      );
      if (fk) markers.push("FK");
      const comment = markers.length ? `"${markers.join(",")}"` : "";
      lines.push(
        `    ${mermaidType(col.type)} ${sanitizeMermaidId(col.name)}${comment ? ` ${comment}` : ""}`,
      );
    }
    lines.push("  }");
  }

  const seen = new Set<string>();
  for (const fk of schema.foreignKeys) {
    const fromId = sanitizeMermaidId(fk.fromTable);
    const toId = sanitizeMermaidId(fk.toTable);
    const key = `${fromId}--${toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!columnsMap.has(fk.fromTable) || !columnsMap.has(fk.toTable)) continue;
    const toTable = schema.tables.find((t) => t.name === fk.toTable);
    if (!toTable || toTable.type === "view") continue;
    lines.push(`  ${toId} ||--o{ ${fromId} : "${fk.fromColumn}"`);
  }

  return lines.join("\n");
}

export function createErDiagram(
  deps: { getText?: () => DbText } = {},
): ErDiagram {
  const text = (): DbText => deps.getText?.() ?? dbText("en");
  const el = document.createElement("div");
  el.className = "db-er-diagram";
  el.hidden = true;

  const toolbar = document.createElement("div");
  toolbar.className = "db-er-toolbar";

  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.className = "db-btn db-er-zoom-btn";
  zoomIn.textContent = "+";
  zoomIn.title = text().er.zoomIn;

  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.className = "db-btn db-er-zoom-btn";
  zoomOut.textContent = "−";
  zoomOut.title = text().er.zoomOut;

  const zoomReset = document.createElement("button");
  zoomReset.type = "button";
  zoomReset.className = "db-btn db-er-zoom-btn";
  zoomReset.textContent = "1:1";
  zoomReset.title = text().er.zoomReset;

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "db-btn db-er-zoom-btn";
  copyBtn.textContent = text().er.copyMermaid;
  copyBtn.title = text().er.copyMermaidTitle;

  toolbar.append(zoomIn, zoomOut, zoomReset, copyBtn);

  const container = document.createElement("div");
  container.className = "db-er-container";

  const svgWrap = document.createElement("div");
  svgWrap.className = "db-er-svg-wrap";
  container.appendChild(svgWrap);

  el.append(toolbar, container);

  let scale = 1;
  let lastMarkup = "";

  function applyZoom() {
    svgWrap.style.transform = `scale(${scale})`;
    svgWrap.style.transformOrigin = "top left";
  }

  zoomIn.addEventListener("click", () => {
    scale = Math.min(3, scale + 0.2);
    applyZoom();
  });
  zoomOut.addEventListener("click", () => {
    scale = Math.max(0.2, scale - 0.2);
    applyZoom();
  });
  zoomReset.addEventListener("click", () => {
    scale = 1;
    applyZoom();
  });
  copyBtn.addEventListener("click", () => {
    if (lastMarkup) {
      navigator.clipboard.writeText(lastMarkup).then(
        () => {
          copyBtn.textContent = text().er.copied;
          setTimeout(() => {
            copyBtn.textContent = text().er.copyMermaid;
          }, 1500);
        },
        () => undefined,
      );
    }
  });

  let dragState: { x: number; y: number; sl: number; st: number } | null = null;
  container.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragState = {
      x: e.clientX,
      y: e.clientY,
      sl: container.scrollLeft,
      st: container.scrollTop,
    };
    container.style.cursor = "grabbing";
    e.preventDefault();
  });
  const onWindowMouseMove = (e: MouseEvent) => {
    if (!dragState) return;
    container.scrollLeft = dragState.sl - (e.clientX - dragState.x);
    container.scrollTop = dragState.st - (e.clientY - dragState.y);
  };
  const onWindowMouseUp = () => {
    if (dragState) {
      dragState = null;
      container.style.cursor = "";
    }
  };
  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mouseup", onWindowMouseUp);

  container.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        scale = Math.max(0.2, Math.min(3, scale + delta));
        applyZoom();
      }
    },
    { passive: false },
  );

  async function render(
    schema: DbSchemaResponse,
    columnsMap: Map<string, DbColumn[]>,
  ) {
    el.hidden = false;
    svgWrap.innerHTML = "";
    scale = 1;
    applyZoom();

    const tables = schema.tables.filter((t) => t.type === "table");
    if (tables.length === 0) {
      svgWrap.textContent = text().er.noTables;
      return;
    }

    const markup = buildErMarkup(schema, columnsMap);
    lastMarkup = markup;

    const mermaid = await loadMermaid();
    if (!mermaid) {
      svgWrap.textContent = text().er.loadError;
      return;
    }

    const node = document.createElement("div");
    node.className = "mermaid";
    node.textContent = markup;
    svgWrap.appendChild(node);

    try {
      await mermaid.run({ nodes: [node], suppressErrors: true });
    } catch {
      svgWrap.textContent = text().er.renderError;
    }
  }

  function clear() {
    el.hidden = true;
    svgWrap.innerHTML = "";
    lastMarkup = "";
    dragState = null;
    container.style.cursor = "";
  }

  function dispose(): void {
    clear();
    window.removeEventListener("mousemove", onWindowMouseMove);
    window.removeEventListener("mouseup", onWindowMouseUp);
  }

  function localize(): void {
    const t = text().er;
    zoomIn.title = t.zoomIn;
    zoomOut.title = t.zoomOut;
    zoomReset.title = t.zoomReset;
    copyBtn.title = t.copyMermaidTitle;
    // コピー直後のフィードバック表示中でなければラベルを再適用する。
    if (copyBtn.textContent !== t.copied) copyBtn.textContent = t.copyMermaid;
  }

  return { el, render, clear, dispose, localize };
}
