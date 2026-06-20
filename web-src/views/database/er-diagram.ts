import type { DbColumn, DbSchemaResponse } from "../../core/database/types";

type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  run(options: {
    nodes: HTMLElement[];
    suppressErrors?: boolean;
  }): Promise<void>;
};

type MermaidModule = { default: MermaidApi };

let mermaidPromise: Promise<MermaidApi | null> | null = null;
let mermaidInitialized = false;

async function loadMermaid(): Promise<MermaidApi | null> {
  if (!mermaidPromise) {
    mermaidPromise = import("/" + "mermaid.js")
      .then((mod: unknown) => {
        const typed = mod as MermaidModule;
        const mermaid = typed.default;
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "default",
            er: { useMaxWidth: false },
          });
          mermaidInitialized = true;
        }
        return mermaid;
      })
      .catch(() => null);
  }
  return mermaidPromise;
}

export type ErDiagram = {
  el: HTMLElement;
  render: (
    schema: DbSchemaResponse,
    columnsMap: Map<string, DbColumn[]>,
  ) => Promise<void>;
  clear: () => void;
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
    const toTable = schema.tables.find((t) => t.name === fk.toTable);
    if (!toTable || toTable.type === "view") continue;
    lines.push(`  ${toId} ||--o{ ${fromId} : "${fk.fromColumn}"`);
  }

  return lines.join("\n");
}

export function createErDiagram(): ErDiagram {
  const el = document.createElement("div");
  el.className = "db-er-diagram";
  el.hidden = true;

  const toolbar = document.createElement("div");
  toolbar.className = "db-er-toolbar";

  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.className = "db-er-zoom-btn";
  zoomIn.textContent = "+";
  zoomIn.title = "Zoom in";

  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.className = "db-er-zoom-btn";
  zoomOut.textContent = "−";
  zoomOut.title = "Zoom out";

  const zoomReset = document.createElement("button");
  zoomReset.type = "button";
  zoomReset.className = "db-er-zoom-btn";
  zoomReset.textContent = "1:1";
  zoomReset.title = "Reset zoom";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "db-er-zoom-btn";
  copyBtn.textContent = "Copy Mermaid";
  copyBtn.title = "Copy mermaid source to clipboard";

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
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = "Copy Mermaid";
          }, 1500);
        },
        () => {},
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
  window.addEventListener("mousemove", (e) => {
    if (!dragState) return;
    container.scrollLeft = dragState.sl - (e.clientX - dragState.x);
    container.scrollTop = dragState.st - (e.clientY - dragState.y);
  });
  window.addEventListener("mouseup", () => {
    if (dragState) {
      dragState = null;
      container.style.cursor = "";
    }
  });

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
      svgWrap.textContent = "No tables to display.";
      return;
    }

    const markup = buildErMarkup(schema, columnsMap);
    lastMarkup = markup;

    const mermaid = await loadMermaid();
    if (!mermaid) {
      svgWrap.textContent = "Failed to load mermaid.js";
      return;
    }

    const node = document.createElement("div");
    node.className = "mermaid";
    node.textContent = markup;
    svgWrap.appendChild(node);

    try {
      await mermaid.run({ nodes: [node], suppressErrors: true });
    } catch {
      svgWrap.textContent = "Failed to render ER diagram.";
    }
  }

  function clear() {
    el.hidden = true;
    svgWrap.innerHTML = "";
    lastMarkup = "";
  }

  return { el, render, clear };
}
