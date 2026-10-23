import {
  type ErBox,
  type ErLayoutGap,
  erEdgeShape,
  layoutErDiagram,
} from "../../core/database/er-layout";
import type {
  DbColumn,
  DbForeignKey,
  DbSchemaResponse,
  DbTableInfo,
} from "../../core/database/types";
import { createDiagramViewport } from "../../core/diagram-viewport";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import { isImeComposing } from "../../core/keyboard";
import { type DbText, dbText } from "./i18n";
import { reportDatastoreFailure } from "./report-failure";
import { formatRowCount } from "./table-list";

export type ErOption = "erShowComments" | "erKeysOnly";

export type ErDiagram = {
  el: HTMLElement;
  render: (
    schema: DbSchemaResponse,
    columnsMap: Map<string, DbColumn[]>,
  ) => void;
  clear: () => void;
  dispose: () => void;
  localize: () => void;
};

type ErKey = "PK" | "FK" | "UQ";

type ErTable = { info: DbTableInfo; columns: DbColumn[] };

type ErRelation = {
  key: string;
  fk: DbForeignKey;
  /** FK の列が NULL を許す (参照される側が 0 か 1)。 */
  nullable: boolean;
  /** FK の列が単独の主キーか一意 (参照する側も 1)。 */
  unique: boolean;
};

type ErModel = {
  tables: ErTable[];
  relations: ErRelation[];
  /** 表 → 単独の列の一意インデックスを持つ列。 */
  uniqueColumns: Map<string, Set<string>>;
  /** 表 → FK を持つ列。 */
  foreignColumns: Map<string, Set<string>>;
  /** 表 → どこかの FK から参照される列 (「キー列だけ」でも残す)。 */
  referencedColumns: Map<string, Set<string>>;
};

type CardView = {
  name: string;
  el: HTMLElement;
  box: ErBox;
  /** 列の名前 → カードの上端から行の中心までの高さ。 */
  rowY: Map<string, number>;
  rows: Map<string, HTMLElement>;
  headY: number;
};

type EdgeView = {
  relation: ErRelation;
  g: SVGGElement;
  line: SVGPathElement;
  marks: SVGPathElement;
  dots: SVGPathElement;
};

const OPTION_DEFAULTS: Record<ErOption, boolean> = {
  erShowComments: true,
  erKeysOnly: false,
};

const LAYOUT_GAP: ErLayoutGap = { column: 96, row: 28, group: 72 };
// 図の右と下に残す余白。自分自身への FK の線が箱の右へ回り込む分。
const EDGE_ROOM = 64;
// 最初に開いたとき、全体が収まる倍率がこれより小さければここで止める
// (文字が読めない大きさにしない。全体は「全体」のボタンで見られる)。
const INITIAL_FIT_FLOOR = 0.75;
// 押してから離すまでにこれより動いたらドラッグ。クリックとして扱わない。
const CLICK_SLOP = 4;
const DEFAULT_ASPECT = 1.6;
const SVG_NS = "http://www.w3.org/2000/svg";

// PostgreSQL の information_schema は型を長い正式名で返す。カードの幅を食うので
// よく使う短い別名で出す (元の名前は行の title に出す)。
const SHORT_TYPE_NAMES: Record<string, string> = {
  "character varying": "varchar",
  character: "char",
  "timestamp without time zone": "timestamp",
  "timestamp with time zone": "timestamptz",
  "time without time zone": "time",
  "time with time zone": "timetz",
};

function shownType(sqlType: string): string {
  return SHORT_TYPE_NAMES[sqlType.toLowerCase()] ?? sqlType;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0];
}

function addTo(map: Map<string, Set<string>>, key: string, value: string) {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

function buildModel(
  schema: DbSchemaResponse,
  columnsMap: Map<string, DbColumn[]>,
): ErModel {
  const tables: ErTable[] = [];
  for (const info of schema.tables) {
    if (info.type !== "table") continue;
    const columns = columnsMap.get(info.name);
    if (!columns) continue;
    tables.push({ info, columns });
  }
  const byName = new Map(tables.map((table) => [table.info.name, table]));
  const uniqueColumns = new Map<string, Set<string>>();
  for (const index of schema.indexes) {
    if (index.unique && index.columns.length === 1)
      addTo(uniqueColumns, index.table, index.columns[0]);
  }
  const foreignColumns = new Map<string, Set<string>>();
  const referencedColumns = new Map<string, Set<string>>();
  const relations: ErRelation[] = [];
  const seen = new Set<string>();
  for (const fk of schema.foreignKeys) {
    const from = byName.get(fk.fromTable);
    if (!from || !byName.has(fk.toTable)) continue;
    const key = [fk.fromTable, fk.fromColumn, fk.toTable, fk.toColumn].join(
      "\0",
    );
    if (seen.has(key)) continue;
    seen.add(key);
    addTo(foreignColumns, fk.fromTable, fk.fromColumn);
    addTo(referencedColumns, fk.toTable, fk.toColumn);
    const column = from.columns.find((c) => c.name === fk.fromColumn);
    const primary = from.columns.filter((c) => c.primaryKey);
    relations.push({
      key,
      fk,
      nullable: column?.nullable === true,
      unique:
        (primary.length === 1 && primary[0].name === fk.fromColumn) ||
        uniqueColumns.get(fk.fromTable)?.has(fk.fromColumn) === true,
    });
  }
  return {
    tables,
    relations,
    uniqueColumns,
    foreignColumns,
    referencedColumns,
  };
}

function columnKeys(model: ErModel, table: string, column: DbColumn): ErKey[] {
  const keys: ErKey[] = [];
  if (column.primaryKey) keys.push("PK");
  if (model.foreignColumns.get(table)?.has(column.name)) keys.push("FK");
  if (!column.primaryKey && model.uniqueColumns.get(table)?.has(column.name))
    keys.push("UQ");
  return keys;
}

// --- Mermaid の書き出し ---

function mermaidEntity(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

// mermaid の erDiagram が属性の型と名前に受ける語 (英字・_・* か U+00C0 以降で
// 始まり、英数字・-_[]().,* と U+00C0 以降が続く) に寄せる。
function mermaidWord(value: string, fallback: string): string {
  const word = value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9\-_[\]().,*À-￿]/g, "_");
  if (!word) return fallback;
  return /^[*A-Za-z_À-￿]/.test(word) ? word : `_${word}`;
}

function mermaidText(value: string): string {
  return value.replace(/"/g, "'").replace(/\s*\r?\n\s*/g, " ");
}

function buildErMarkup(model: ErModel): string {
  const lines: string[] = ["erDiagram"];
  for (const table of model.tables) {
    lines.push(`  ${mermaidEntity(table.info.name)} {`);
    for (const column of table.columns) {
      const keys = columnKeys(model, table.info.name, column).map((key) =>
        key === "UQ" ? "UK" : key,
      );
      const comment = column.comment?.trim();
      lines.push(
        `    ${mermaidWord(column.type, "any")} ${mermaidWord(column.name, "_")}${keys.length > 0 ? ` ${keys.join(", ")}` : ""}${comment ? ` "${mermaidText(comment)}"` : ""}`,
      );
    }
    lines.push("  }");
  }
  const seen = new Set<string>();
  for (const relation of model.relations) {
    const fromId = mermaidEntity(relation.fk.fromTable);
    const toId = mermaidEntity(relation.fk.toTable);
    const pair = `${fromId}--${toId}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const parentEnd = relation.nullable ? "|o" : "||";
    const childEnd = relation.unique ? "o|" : "o{";
    lines.push(
      `  ${toId} ${parentEnd}--${childEnd} ${fromId} : "${mermaidText(relation.fk.fromColumn)}"`,
    );
  }
  return lines.join("\n");
}

export function createErDiagram(
  deps: {
    getText?: () => DbText;
    /** 表示の切替 (コメント・キー列だけ) の覚えている値。 */
    getOption?: (key: ErOption, fallback: boolean) => boolean;
    /** 表示の切替を覚える。失敗は throw。 */
    saveOption?: (key: ErOption, on: boolean) => Promise<void>;
    /** カードの見出しのダブルクリック・Enter でそのテーブルを開く。 */
    onOpenTable?: (table: string) => void;
  } = {},
): ErDiagram {
  const text = (): DbText => deps.getText?.() ?? dbText("en");
  const el = document.createElement("div");
  el.className = "db-er-diagram";
  el.hidden = true;

  const toolbar = document.createElement("div");
  toolbar.className = "db-er-toolbar";

  const toolButton = (label: string, extraClass = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `db-btn db-btn-sm db-er-tool ${extraClass}`.trim();
    button.textContent = label;
    return button;
  };

  const zoomOut = toolButton("−", "db-er-zoom-btn");
  const zoomLevel = document.createElement("span");
  zoomLevel.className = "db-er-zoom-level";
  const zoomIn = toolButton("+", "db-er-zoom-btn");
  const zoomReset = toolButton("1:1", "db-er-zoom-btn");
  const fitBtn = toolButton("", "db-er-fit");

  const findInput = document.createElement("input");
  findInput.type = "search";
  findInput.className = "db-er-find";
  findInput.spellcheck = false;

  const commentsToggle = toolButton("", "db-er-toggle");
  const keysToggle = toolButton("", "db-er-toggle");
  const optionButtons: Record<ErOption, HTMLButtonElement> = {
    erShowComments: commentsToggle,
    erKeysOnly: keysToggle,
  };
  commentsToggle.dataset.option = "erShowComments";
  keysToggle.dataset.option = "erKeysOnly";

  const copyBtn = toolButton("", "db-er-copy");

  const zoomGroup = document.createElement("div");
  zoomGroup.className = "db-er-tool-group";
  zoomGroup.append(zoomOut, zoomLevel, zoomIn, zoomReset, fitBtn);
  const viewGroup = document.createElement("div");
  viewGroup.className = "db-er-tool-group";
  viewGroup.append(commentsToggle, keysToggle);
  toolbar.append(zoomGroup, findInput, viewGroup, copyBtn);

  // 図の大きさ (拡大前)。viewport が作られた直後に倍率を知らせてくるので先に置く。
  let stageSize = { width: 0, height: 0 };
  // 拡大縮小は transform なので、置き場の中で図が取る場所は拡大前の大きさのまま
  // 残る (縮小してもスクロールの範囲が減らない)。拡大で増えた・縮小で減った分を
  // 外側の余白で足し引きして、スクロールの範囲を見えている図に合わせる。
  let extentTarget: HTMLElement | null = null;
  const syncCanvasExtent = (scale: number) => {
    // viewport を作る途中 (倍率 1 の初期化) は中身がまだ無く、図も空。
    if (!extentTarget) return;
    extentTarget.style.marginRight = `${stageSize.width * (scale - 1)}px`;
    extentTarget.style.marginBottom = `${stageSize.height * (scale - 1)}px`;
  };
  const viewport = createDiagramViewport({
    containerClassName: "db-er-container",
    contentClassName: "db-er-canvas",
    onScaleChange: (scale) => {
      zoomLevel.textContent = `${Math.round(scale * 100)}%`;
      syncCanvasExtent(scale);
    },
  });
  const container = viewport.container;
  const canvas = viewport.content;
  extentTarget = canvas;
  el.append(toolbar, container);

  let lastSchema: DbSchemaResponse | null = null;
  let lastColumns: Map<string, DbColumn[]> | null = null;
  let model: ErModel | null = null;
  const options: Record<ErOption, boolean> = { ...OPTION_DEFAULTS };
  let stage: HTMLElement | null = null;
  let edgeLayer: SVGSVGElement | null = null;
  const cards = new Map<string, CardView>();
  const edges = new Map<string, EdgeView>();
  // 関係を強調する表: クリックで固定 (focused)、固定が無い間はマウスの下 (hovered)。
  let focused: string | null = null;
  let hovered: string | null = null;
  // マウスの下の行に繋がる線。
  let hotRelations: Set<string> | null = null;
  let hotRow: HTMLElement | null = null;
  const linkedRows: HTMLElement[] = [];
  let query = "";
  let matchCursor = -1;
  // 箱を測れない (画面に出ていない) 間に描いたら、出た時に並べ直す。
  let layoutPending = false;
  let fitOnLayout = false;
  let pressedAt: { x: number; y: number } | null = null;
  let drag: {
    card: CardView;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null = null;

  function readOption(key: ErOption): boolean {
    return deps.getOption
      ? deps.getOption(key, OPTION_DEFAULTS[key])
      : OPTION_DEFAULTS[key];
  }

  function syncToggle(key: ErOption): void {
    const button = optionButtons[key];
    button.setAttribute("aria-pressed", options[key] ? "true" : "false");
  }

  function syncLabels(): void {
    const t = text().er;
    zoomIn.title = t.zoomIn;
    zoomOut.title = t.zoomOut;
    zoomReset.title = t.zoomReset;
    zoomLevel.title = t.zoomLevel;
    fitBtn.textContent = t.fit;
    fitBtn.title = t.fitTitle;
    findInput.placeholder = t.find;
    findInput.setAttribute("aria-label", t.find);
    commentsToggle.textContent = t.showComments;
    keysToggle.textContent = t.keysOnly;
    if (!commentsToggle.dataset.saveFailed)
      commentsToggle.title = t.showCommentsTitle;
    if (!keysToggle.dataset.saveFailed) keysToggle.title = t.keysOnlyTitle;
    copyBtn.title = t.copyMermaidTitle;
    // コピー直後のフィードバック表示中でなければラベルを再適用する。
    if (copyBtn.textContent !== t.copied) copyBtn.textContent = t.copyMermaid;
  }

  function span(className: string, value: string): HTMLSpanElement {
    const node = document.createElement("span");
    node.className = className;
    node.textContent = value;
    return node;
  }

  // clip: 長い型 (enum の値の一覧など) とコメントは幅を決めて … で切る。表のセル
  // そのものには max-width が効かないので、中の箱で切る。
  function cell(
    className: string,
    value: string,
    clip = false,
  ): HTMLTableCellElement {
    const node = document.createElement("td");
    node.className = className;
    if (clip && value) node.append(span("db-er-clip", value));
    else node.textContent = value;
    return node;
  }

  function rowTitle(current: ErModel, table: string, column: DbColumn): string {
    const t = text().er;
    const lines = [`${column.name}  ${column.type}`];
    if (column.nullable && !column.primaryKey) lines.push(t.nullable);
    if (column.defaultValue != null)
      lines.push(t.defaultValue(column.defaultValue));
    for (const relation of current.relations) {
      const { fk } = relation;
      if (fk.fromTable !== table || fk.fromColumn !== column.name) continue;
      const target = t.references(`${fk.toTable}.${fk.toColumn}`);
      lines.push(fk.inferred ? `${target} (${t.inferred})` : target);
    }
    const comment = column.comment?.trim();
    if (comment) lines.push(comment);
    return lines.join("\n");
  }

  function buildCard(current: ErModel, table: ErTable): CardView {
    const t = text().er;
    const name = table.info.name;
    const card = document.createElement("section");
    card.className = "db-er-table";
    card.dataset.table = name;

    const head = document.createElement("header");
    head.className = "db-er-table-head";
    head.tabIndex = 0;
    head.title = t.tableTitle(name);
    const headLine = document.createElement("div");
    headLine.className = "db-er-table-line";
    headLine.append(span("db-er-table-name", name));
    if (table.info.rowCount != null)
      headLine.append(
        span("db-er-table-rows", formatRowCount(table.info.rowCount)),
      );
    head.append(headLine);
    const tableComment = table.info.comment?.trim();
    if (options.erShowComments && tableComment) {
      const comment = span("db-er-table-comment", firstLine(tableComment));
      comment.title = tableComment;
      head.append(comment);
    }
    card.append(head);

    const rows = new Map<string, HTMLElement>();
    const body = document.createElement("tbody");
    let hidden = 0;
    for (const column of table.columns) {
      const keys = columnKeys(current, name, column);
      const referenced =
        current.referencedColumns.get(name)?.has(column.name) === true;
      if (options.erKeysOnly && keys.length === 0 && !referenced) {
        hidden++;
        continue;
      }
      const row = document.createElement("tr");
      row.dataset.column = column.name;
      if (column.primaryKey) row.classList.add("is-pk");
      row.title = rowTitle(current, name, column);

      const keyCell = cell("db-er-col-key", "");
      for (const key of keys) {
        const badge = span(`db-er-key db-er-key-${key.toLowerCase()}`, key);
        badge.title =
          key === "PK" ? t.primaryKey : key === "FK" ? t.foreignKey : t.unique;
        keyCell.append(badge);
      }
      row.append(
        keyCell,
        cell("db-er-col-name", column.name),
        cell("db-er-col-type", shownType(column.type), true),
        cell(
          "db-er-col-null",
          column.nullable && !column.primaryKey ? "NULL" : "",
        ),
      );
      if (options.erShowComments) {
        const comment = column.comment?.trim();
        row.append(
          cell("db-er-col-comment", comment ? firstLine(comment) : "", true),
        );
      }
      row.addEventListener("mouseenter", () => setHotRow(name, row));
      row.addEventListener("mouseleave", () => setHotRow(name, null));
      body.append(row);
      rows.set(column.name, row);
    }
    if (body.childElementCount > 0) {
      const grid = document.createElement("table");
      grid.className = "ui-table db-er-columns";
      grid.append(body);
      card.append(grid);
    }
    if (hidden > 0) {
      const more = document.createElement("div");
      more.className = "db-er-more";
      more.textContent = t.moreColumns(hidden);
      card.append(more);
    }

    card.addEventListener("mouseenter", () => {
      hovered = name;
      if (!focused) applyEmphasis();
    });
    card.addEventListener("mouseleave", () => {
      if (hovered === name) hovered = null;
      if (!focused) applyEmphasis();
    });
    head.addEventListener("dblclick", () => deps.onOpenTable?.(name));
    head.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        deps.onOpenTable?.(name);
      } else if (event.key === " ") {
        event.preventDefault();
        toggleFocus(name);
      }
    });
    return {
      name,
      el: card,
      box: { x: 0, y: 0, width: 0, height: 0 },
      rowY: new Map(),
      rows,
      headY: 0,
    };
  }

  function buildEdge(relation: ErRelation): EdgeView {
    const g = document.createElementNS(SVG_NS, "g");
    g.classList.add("db-er-edge");
    if (relation.fk.inferred) g.classList.add("is-inferred");
    const line = document.createElementNS(SVG_NS, "path");
    line.classList.add("db-er-edge-line");
    const marks = document.createElementNS(SVG_NS, "path");
    marks.classList.add("db-er-edge-marks");
    const dots = document.createElementNS(SVG_NS, "path");
    dots.classList.add("db-er-edge-dots");
    g.append(line, marks, dots);
    return { relation, g, line, marks, dots };
  }

  function rebuild(): void {
    canvas.innerHTML = "";
    cards.clear();
    edges.clear();
    linkedRows.length = 0;
    hotRow = null;
    hotRelations = null;
    stage = null;
    edgeLayer = null;
    if (!lastSchema || !lastColumns) {
      model = null;
      copyBtn.disabled = true;
      return;
    }
    const current = buildModel(lastSchema, lastColumns);
    model = current;
    copyBtn.disabled = current.tables.length === 0;
    if (current.tables.length === 0) {
      canvas.textContent = text().er.noTables;
      return;
    }
    if (focused && !current.tables.some((t) => t.info.name === focused))
      focused = null;
    stage = document.createElement("div");
    stage.className = "db-er-stage";
    edgeLayer = document.createElementNS(SVG_NS, "svg");
    edgeLayer.classList.add("db-er-edges");
    edgeLayer.setAttribute("aria-hidden", "true");
    stage.append(edgeLayer);
    for (const table of current.tables) {
      const card = buildCard(current, table);
      cards.set(card.name, card);
      stage.append(card.el);
    }
    for (const relation of current.relations) {
      const edge = buildEdge(relation);
      edges.set(relation.key, edge);
      edgeLayer.append(edge.g);
    }
    canvas.append(stage);
    try {
      layoutCards();
    } catch (error) {
      showFailure(text().er.renderError, error);
      return;
    }
    applyEmphasis();
  }

  function layoutCards(): void {
    if (!model || !stage) return;
    // 画面に出ていない (タブが裏・ページが隠れている) と箱の大きさが 0 になる。
    // 0 のまま並べると全部が左上に重なるので、出た時に並べ直す。
    if (container.clientWidth === 0) {
      layoutPending = true;
      return;
    }
    layoutPending = false;
    const scale = viewport.scale();
    for (const card of cards.values()) {
      card.box.width = card.el.offsetWidth;
      card.box.height = card.el.offsetHeight;
      const top = card.el.getBoundingClientRect().top;
      card.rowY.clear();
      for (const [column, row] of card.rows) {
        const rect = row.getBoundingClientRect();
        card.rowY.set(column, (rect.top + rect.height / 2 - top) / scale);
      }
      const head = card.el.querySelector<HTMLElement>(".db-er-table-head");
      if (!head) throw new Error(`ER card ${card.name} has no header`);
      const headRect = head.getBoundingClientRect();
      card.headY = (headRect.top + headRect.height / 2 - top) / scale;
    }
    const result = layoutErDiagram(
      [...cards.values()].map((card) => ({
        id: card.name,
        width: card.box.width,
        height: card.box.height,
      })),
      model.relations.map((relation) => ({
        from: relation.fk.fromTable,
        to: relation.fk.toTable,
      })),
      LAYOUT_GAP,
      viewAspect(),
    );
    for (const card of cards.values()) {
      const position = result.positions.get(card.name);
      if (!position)
        throw new Error(`ER layout returned no position for ${card.name}`);
      card.box.x = position.x;
      card.box.y = position.y;
      placeCard(card);
    }
    setStageSize(result.width + EDGE_ROOM, result.height + EDGE_ROOM);
    drawEdges(null);
    if (fitOnLayout) {
      fitOnLayout = false;
      fitToView(INITIAL_FIT_FLOOR);
    }
  }

  // 見せる場所が測れないほど小さいときは、横長の画面のよくある比で並べる。
  function viewAspect(): number {
    const { width, height } = viewArea();
    return width > 0 && height > 0 ? width / height : DEFAULT_ASPECT;
  }

  function placeCard(card: CardView): void {
    card.el.style.left = `${card.box.x}px`;
    card.el.style.top = `${card.box.y}px`;
  }

  function setStageSize(width: number, height: number): void {
    if (!stage || !edgeLayer) return;
    stageSize = { width, height };
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    edgeLayer.setAttribute("width", String(width));
    edgeLayer.setAttribute("height", String(height));
    syncCanvasExtent(viewport.scale());
  }

  // 図を見せる場所の 幅 / 高さ (内側の余白を除く)。
  function viewArea(): { width: number; height: number } {
    const style = getComputedStyle(container);
    return {
      width:
        container.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight),
      height:
        container.clientHeight -
        Number.parseFloat(style.paddingTop) -
        Number.parseFloat(style.paddingBottom),
    };
  }

  function drawEdges(onlyTable: string | null): void {
    for (const edge of edges.values()) {
      const { fk } = edge.relation;
      if (onlyTable && fk.fromTable !== onlyTable && fk.toTable !== onlyTable)
        continue;
      const from = cards.get(fk.fromTable);
      const to = cards.get(fk.toTable);
      if (!from || !to)
        throw new Error(
          `ER edge ${fk.fromTable}.${fk.fromColumn} -> ${fk.toTable}.${fk.toColumn} has no card`,
        );
      // 列が「キー列だけ」で隠れている・参照先に無いときは、カードの見出しに繋ぐ。
      const fromY = from.box.y + (from.rowY.get(fk.fromColumn) ?? from.headY);
      const toY = to.box.y + (to.rowY.get(fk.toColumn) ?? to.headY);
      const shape = erEdgeShape(from.box, fromY, to.box, toY, edge.relation);
      edge.line.setAttribute("d", shape.line);
      edge.marks.setAttribute("d", shape.marks);
      edge.dots.setAttribute("d", shape.dots);
    }
  }

  function fitToView(floor: number): void {
    if (stageSize.width === 0 || stageSize.height === 0) return;
    const { width, height } = viewArea();
    const fit = Math.min(width / stageSize.width, height / stageSize.height, 1);
    viewport.zoomTo(Math.max(fit, floor));
    container.scrollLeft = 0;
    container.scrollTop = 0;
  }

  function relatedTables(table: string): Set<string> {
    const related = new Set([table]);
    for (const { fk } of model?.relations ?? []) {
      if (fk.fromTable === table) related.add(fk.toTable);
      if (fk.toTable === table) related.add(fk.fromTable);
    }
    return related;
  }

  function matchingTables(): string[] {
    if (!query || !model) return [];
    return model.tables
      .filter(
        (table) =>
          table.info.name.toLowerCase().includes(query) ||
          (table.info.comment ?? "").toLowerCase().includes(query),
      )
      .map((table) => table.info.name);
  }

  function applyEmphasis(): void {
    const active = focused ?? hovered;
    const related = active ? relatedTables(active) : null;
    const matches = query ? new Set(matchingTables()) : null;
    for (const [name, card] of cards) {
      card.el.classList.toggle("is-active", name === active);
      card.el.classList.toggle(
        "is-related",
        related !== null && name !== active && related.has(name),
      );
      card.el.classList.toggle("is-match", matches?.has(name) === true);
      card.el.classList.toggle("is-focused", name === focused);
      const dimmed = related
        ? !related.has(name)
        : matches
          ? !matches.has(name)
          : false;
      card.el.classList.toggle("is-dimmed", dimmed);
    }
    for (const row of linkedRows) row.classList.remove("is-linked");
    linkedRows.length = 0;
    const raised: SVGGElement[] = [];
    for (const edge of edges.values()) {
      const { fk } = edge.relation;
      const touches =
        active !== null && (fk.fromTable === active || fk.toTable === active);
      const hot = hotRelations?.has(edge.relation.key) === true;
      edge.g.classList.toggle("is-active", touches);
      edge.g.classList.toggle("is-hot", hot);
      const dimmed = related
        ? !touches
        : matches
          ? !(matches.has(fk.fromTable) || matches.has(fk.toTable))
          : false;
      edge.g.classList.toggle("is-dimmed", dimmed && !hot);
      if (touches || hot) raised.push(edge.g);
      if (hot) {
        for (const [table, column] of [
          [fk.fromTable, fk.fromColumn],
          [fk.toTable, fk.toColumn],
        ]) {
          const row = cards.get(table)?.rows.get(column);
          if (row && row !== hotRow) {
            row.classList.add("is-linked");
            linkedRows.push(row);
          }
        }
      }
    }
    // 強調した線を後ろに描き直し、ほかの線の下に隠れないようにする。
    for (const g of raised) edgeLayer?.append(g);
  }

  function setHotRow(table: string, row: HTMLElement | null): void {
    hotRow?.classList.remove("is-hot");
    hotRow = row;
    if (!row) {
      hotRelations = null;
      applyEmphasis();
      return;
    }
    const column = row.dataset.column;
    const keys = new Set<string>();
    for (const relation of model?.relations ?? []) {
      const { fk } = relation;
      if (
        (fk.fromTable === table && fk.fromColumn === column) ||
        (fk.toTable === table && fk.toColumn === column)
      )
        keys.add(relation.key);
    }
    hotRelations = keys.size > 0 ? keys : null;
    if (hotRelations) row.classList.add("is-hot");
    applyEmphasis();
  }

  function toggleFocus(table: string | null): void {
    focused = table && focused !== table ? table : null;
    applyEmphasis();
  }

  function centerOn(card: CardView): void {
    const box = container.getBoundingClientRect();
    const rect = card.el.getBoundingClientRect();
    container.scrollLeft +=
      rect.left + rect.width / 2 - (box.left + container.clientWidth / 2);
    container.scrollTop +=
      rect.top + rect.height / 2 - (box.top + container.clientHeight / 2);
  }

  function revealMatch(direction: 1 | -1): void {
    const matches = matchingTables();
    if (matches.length === 0) return;
    matchCursor = (matchCursor + direction + matches.length) % matches.length;
    const card = cards.get(matches[matchCursor]);
    if (!card) return;
    focused = card.name;
    applyEmphasis();
    centerOn(card);
  }

  function showFailure(message: string, error: unknown) {
    const failure = errorWithCause(message, error);
    console.error(failure);
    canvas.textContent = formatErrorDetail(failure);
  }

  // --- 操作 ---

  zoomIn.addEventListener("click", () => viewport.zoomIn());
  zoomOut.addEventListener("click", () => viewport.zoomOut());
  zoomReset.addEventListener("click", () => viewport.reset());
  fitBtn.addEventListener("click", () => fitToView(0));

  findInput.addEventListener("input", () => {
    query = findInput.value.trim().toLowerCase();
    matchCursor = -1;
    if (query) focused = null;
    applyEmphasis();
  });
  findInput.addEventListener("keydown", (event) => {
    if (isImeComposing(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      revealMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape" && findInput.value) {
      event.preventDefault();
      event.stopPropagation();
      findInput.value = "";
      query = "";
      matchCursor = -1;
      applyEmphasis();
    }
  });

  for (const key of Object.keys(optionButtons) as ErOption[]) {
    const button = optionButtons[key];
    button.addEventListener("click", () => {
      const on = !options[key];
      options[key] = on;
      syncToggle(key);
      delete button.dataset.saveFailed;
      syncLabels();
      rebuild();
      deps.saveOption?.(key, on).catch((error: unknown) => {
        const detail = reportDatastoreFailure(
          "SQL",
          `remember ER diagram option ${key}`,
          error,
          on,
        );
        button.dataset.saveFailed = "1";
        button.title = text().er.optionSaveFailed(detail);
      });
    });
  }

  copyBtn.addEventListener("click", () => {
    if (!model || model.tables.length === 0) return;
    navigator.clipboard.writeText(buildErMarkup(model)).then(
      () => {
        copyBtn.textContent = text().er.copied;
        setTimeout(() => {
          copyBtn.textContent = text().er.copyMermaid;
        }, 1500);
      },
      (error) => {
        console.error("Failed to copy Mermaid source", error);
        const message = text().er.copyFailed(formatErrorDetail(error));
        copyBtn.classList.add("failed");
        copyBtn.title = message;
        setTimeout(() => copyBtn.classList.remove("failed"), 1500);
      },
    );
  });

  // 見出しを押したらカードを動かす。本体を押したときは図ごと動かす
  // (viewport のドラッグ) ので、見出しのときだけ viewport へ伝えない。
  canvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    pressedAt = { x: event.clientX, y: event.clientY };
    const target = event.target as Element;
    const head = target.closest(".db-er-table-head");
    const name = head?.closest<HTMLElement>(".db-er-table")?.dataset.table;
    const card = name ? cards.get(name) : undefined;
    if (!card) return;
    event.stopPropagation();
    event.preventDefault();
    (head as HTMLElement).focus({ preventScroll: true });
    drag = {
      card,
      startX: event.clientX,
      startY: event.clientY,
      originX: card.box.x,
      originY: card.box.y,
    };
    card.el.classList.add("is-dragging");
  });
  const onWindowMouseMove = (event: MouseEvent) => {
    if (!drag) return;
    const scale = viewport.scale();
    const { card } = drag;
    card.box.x = Math.max(
      0,
      drag.originX + (event.clientX - drag.startX) / scale,
    );
    card.box.y = Math.max(
      0,
      drag.originY + (event.clientY - drag.startY) / scale,
    );
    placeCard(card);
    setStageSize(
      Math.max(stageSize.width, card.box.x + card.box.width + EDGE_ROOM),
      Math.max(stageSize.height, card.box.y + card.box.height + EDGE_ROOM),
    );
    drawEdges(card.name);
  };
  const onWindowMouseUp = () => {
    if (!drag) return;
    drag.card.el.classList.remove("is-dragging");
    drag = null;
  };
  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mouseup", onWindowMouseUp);

  canvas.addEventListener("click", (event) => {
    const start = pressedAt;
    pressedAt = null;
    if (
      start &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP
    )
      return;
    const card = (event.target as Element).closest<HTMLElement>(".db-er-table");
    toggleFocus(card?.dataset.table ?? null);
  });

  // 画面に出ていない間に描いた図は、出て大きさが付いた時に並べる。
  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (!layoutPending) return;
          try {
            layoutCards();
            applyEmphasis();
          } catch (error) {
            showFailure(text().er.renderError, error);
          }
        })
      : null;
  resizeObserver?.observe(container);

  function render(
    schema: DbSchemaResponse,
    columnsMap: Map<string, DbColumn[]>,
  ): void {
    el.hidden = false;
    lastSchema = schema;
    lastColumns = columnsMap;
    for (const key of Object.keys(options) as ErOption[]) {
      options[key] = readOption(key);
      syncToggle(key);
    }
    focused = null;
    hovered = null;
    matchCursor = -1;
    viewport.reset();
    container.scrollLeft = 0;
    container.scrollTop = 0;
    fitOnLayout = true;
    rebuild();
  }

  function clear() {
    el.hidden = true;
    lastSchema = null;
    lastColumns = null;
    focused = null;
    hovered = null;
    query = "";
    findInput.value = "";
    matchCursor = -1;
    layoutPending = false;
    fitOnLayout = false;
    drag = null;
    rebuild();
  }

  function dispose(): void {
    clear();
    resizeObserver?.disconnect();
    window.removeEventListener("mousemove", onWindowMouseMove);
    window.removeEventListener("mouseup", onWindowMouseUp);
    viewport.dispose();
  }

  function localize(): void {
    syncLabels();
    // カードの title と「ほか n 列」も言語に合わせて組み直す。
    if (model) rebuild();
  }

  syncLabels();
  for (const key of Object.keys(options) as ErOption[]) syncToggle(key);
  copyBtn.disabled = true;

  return { el, render, clear, dispose, localize };
}
