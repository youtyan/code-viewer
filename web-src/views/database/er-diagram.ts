import { live } from "lit/directives/live.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing, svg } from "lit/html.js";
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
import { renderOwned, templateElement } from "../ui/renderer";
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
  head: HTMLElement;
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

export type ErToolbarProps = {
  text: DbText["er"];
  /** 倍率 (%)。 */
  zoom: number;
  /** 検索欄の文字 (入れたまま)。 */
  find: string;
  options: Record<ErOption, boolean>;
  /** 覚えられなかった切替の理由 (title に出す)。 */
  optionFailures: Record<ErOption, string | null>;
  copy: {
    disabled: boolean;
    copied: boolean;
    failed: boolean;
    /** コピーに失敗した理由 (次に文言を当て直すまで title に出す)。 */
    failure: string | null;
  };
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFit: () => void;
  onFind: (value: string) => void;
  onFindKeydown: (event: KeyboardEvent) => void;
  onToggle: (key: ErOption) => void;
  onCopy: () => void;
};

export type ErCardRowProps = {
  column: string;
  primaryKey: boolean;
  title: string;
  keys: { key: ErKey; title: string }[];
  type: string;
  nullable: boolean;
  /** コメントの 1 行目。コメントを出さないときは null。 */
  comment: string | null;
  rowRef: (element: Element | undefined) => void;
  onEnter: () => void;
  onLeave: () => void;
};

export type ErCardProps = {
  name: string;
  title: string;
  rows: string | null;
  comment: { text: string; title: string } | null;
  columns: ErCardRowProps[];
  /** 「キー列だけ」で隠した列の数の文。 */
  more: string | null;
  headRef: Ref<HTMLElement>;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: () => void;
  onHeadKeydown: (event: KeyboardEvent) => void;
};

export type ErEdgeProps = {
  inferred: boolean;
  lineRef: Ref<SVGPathElement>;
  marksRef: Ref<SVGPathElement>;
  dotsRef: Ref<SVGPathElement>;
};

/**
 * ER 図の描き方。道具の帯は状態から描き直す。カード・線・置き場は図を組み直す
 * ときに 1 度だけ作り、強調・位置・線の形は presenter が作った要素へ書き込む
 * (マウスの動きごとに全部のカードを描き直さない)。
 */
export type ErDiagramView = {
  toolbar: (props: ErToolbarProps) => unknown;
  stage: (props: { edgesRef: Ref<SVGSVGElement> }) => unknown;
  card: (props: ErCardProps) => unknown;
  edge: (props: ErEdgeProps) => unknown;
};

const ER_OPTIONS: readonly ErOption[] = ["erShowComments", "erKeysOnly"];

// clip: 長い型 (enum の値の一覧など) とコメントは幅を決めて … で切る。表のセル
// そのものには max-width が効かないので、中の箱で切る。
function erCell(className: string, value: string, clip = false): unknown {
  return html`<td class=${className}>${
    clip && value ? html`<span class="db-er-clip">${value}</span>` : value
  }</td>`;
}

export const DEFAULT_VIEW: ErDiagramView = {
  toolbar: (p) => {
    const t = p.text;
    const optionLabel: Record<ErOption, [string, string]> = {
      erShowComments: [t.showComments, t.showCommentsTitle],
      erKeysOnly: [t.keysOnly, t.keysOnlyTitle],
    };
    return html`<div class="db-er-tool-group"><button
          type="button"
          class="db-btn db-btn-sm db-er-tool db-er-zoom-btn"
          title=${t.zoomOut}
          @click=${p.onZoomOut}
        >−</button><span class="db-er-zoom-level" title=${t.zoomLevel}
          >${p.zoom}%</span
        ><button
          type="button"
          class="db-btn db-btn-sm db-er-tool db-er-zoom-btn"
          title=${t.zoomIn}
          @click=${p.onZoomIn}
        >+</button><button
          type="button"
          class="db-btn db-btn-sm db-er-tool db-er-zoom-btn"
          title=${t.zoomReset}
          @click=${p.onZoomReset}
        >1:1</button><button
          type="button"
          class="db-btn db-btn-sm db-er-tool db-er-fit"
          title=${t.fitTitle}
          @click=${p.onFit}
        >${t.fit}</button></div
      ><input
        type="search"
        class="db-er-find"
        spellcheck="false"
        placeholder=${t.find}
        aria-label=${t.find}
        .value=${live(p.find)}
        @input=${(event: Event) =>
          p.onFind((event.currentTarget as HTMLInputElement).value)}
        @keydown=${p.onFindKeydown}
      /><div class="db-er-tool-group">${ER_OPTIONS.map(
        (key) =>
          html`<button
            type="button"
            class="db-btn db-btn-sm db-er-tool db-er-toggle"
            data-option=${key}
            data-save-failed=${p.optionFailures[key] ? "1" : nothing}
            aria-pressed=${p.options[key] ? "true" : "false"}
            title=${p.optionFailures[key] ?? optionLabel[key][1]}
            @click=${() => p.onToggle(key)}
          >${optionLabel[key][0]}</button>`,
      )}</div
      ><button
        type="button"
        class=${p.copy.failed ? "db-btn db-btn-sm db-er-tool db-er-copy failed" : "db-btn db-btn-sm db-er-tool db-er-copy"}
        title=${p.copy.failure ?? t.copyMermaidTitle}
        ?disabled=${p.copy.disabled}
        @click=${p.onCopy}
      >${p.copy.copied ? t.copied : t.copyMermaid}</button>`;
  },
  stage: ({ edgesRef }) =>
    html`<div class="db-er-stage"><svg
        class="db-er-edges"
        aria-hidden="true"
        ${ref(edgesRef)}
      ></svg></div>`,
  card: (c) =>
    html`<section
      class="db-er-table"
      data-table=${c.name}
      @mouseenter=${c.onEnter}
      @mouseleave=${c.onLeave}
    ><header
        class="db-er-table-head"
        tabindex="0"
        title=${c.title}
        ${ref(c.headRef)}
        @dblclick=${c.onOpen}
        @keydown=${c.onHeadKeydown}
      ><div class="db-er-table-line"><span class="db-er-table-name">${c.name}</span>${
        c.rows === null
          ? nothing
          : html`<span class="db-er-table-rows">${c.rows}</span>`
      }</div>${
        c.comment
          ? html`<span class="db-er-table-comment" title=${c.comment.title}
              >${c.comment.text}</span
            >`
          : nothing
      }</header
      >${
        c.columns.length > 0
          ? html`<table class="ui-table db-er-columns"><tbody>${c.columns.map(
              (r) =>
                html`<tr
                  class=${r.primaryKey ? "is-pk" : nothing}
                  data-column=${r.column}
                  title=${r.title}
                  ${ref(r.rowRef)}
                  @mouseenter=${r.onEnter}
                  @mouseleave=${r.onLeave}
                ><td class="db-er-col-key">${r.keys.map(
                  (k) =>
                    html`<span
                      class=${`db-er-key db-er-key-${k.key.toLowerCase()}`}
                      title=${k.title}
                      >${k.key}</span
                    >`,
                )}</td>${erCell("db-er-col-name", r.column)}${erCell(
                  "db-er-col-type",
                  r.type,
                  true,
                )}${erCell("db-er-col-null", r.nullable ? "NULL" : "")}${
                  r.comment === null
                    ? nothing
                    : erCell("db-er-col-comment", r.comment, true)
                }</tr>`,
            )}</tbody></table>`
          : nothing
      }${c.more === null ? nothing : html`<div class="db-er-more">${c.more}</div>`}</section
    >`,
  edge: (e) =>
    svg`<g class=${e.inferred ? "db-er-edge is-inferred" : "db-er-edge"}><path
        class="db-er-edge-line"
        ${ref(e.lineRef)}
      ></path><path class="db-er-edge-marks" ${ref(e.marksRef)}></path><path
        class="db-er-edge-dots"
        ${ref(e.dotsRef)}
      ></path></g>`,
};

/** 「コピーしました」・失敗の印を出しておく時間。 */
const COPY_MARK_MS = 1500;

function drawn<T extends Element>(target: Ref<T>, what: string): T {
  const element = target.value;
  if (!element) throw new Error(`ER diagram: ${what} was not drawn`);
  return element;
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
  view: ErDiagramView = DEFAULT_VIEW,
): ErDiagram {
  const text = (): DbText => deps.getText?.() ?? dbText("en");
  const el = templateElement(html`<div class="db-er-diagram" hidden></div>`);
  const toolbar = templateElement(html`<div class="db-er-toolbar"></div>`);

  // viewport は作る途中で倍率を知らせ、道具の帯を描く。帯が読む状態はその前に置く。
  const options: Record<ErOption, boolean> = { ...OPTION_DEFAULTS };
  let zoom = 100;
  let find = "";
  const optionFailures: Record<ErOption, string | null> = {
    erShowComments: null,
    erKeysOnly: null,
  };
  let copyDisabled = true;
  let copied = false;
  let copyFailed = false;
  let copyFailure: string | null = null;

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
      zoom = Math.round(scale * 100);
      drawToolbar();
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
  let stage: HTMLElement | null = null;
  let edgeLayer: SVGSVGElement | null = null;
  const cards = new Map<string, CardView>();
  // カードの要素と見出しの要素 → 表の名前 (図の上の押す・クリックを表に結ぶ)。
  let cardOf = new WeakMap<Element, string>();
  let headOf = new WeakMap<Element, string>();
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

  function drawToolbar(): void {
    renderOwned(
      toolbar,
      view.toolbar({
        text: text().er,
        zoom,
        find,
        options: { ...options },
        optionFailures: { ...optionFailures },
        copy: {
          disabled: copyDisabled,
          copied,
          failed: copyFailed,
          failure: copyFailure,
        },
        onZoomIn: () => viewport.zoomIn(),
        onZoomOut: () => viewport.zoomOut(),
        onZoomReset: () => viewport.reset(),
        onFit: () => fitToView(0),
        onFind: (value) => {
          find = value;
          query = value.trim().toLowerCase();
          matchCursor = -1;
          if (query) focused = null;
          applyEmphasis();
        },
        onFindKeydown: (event) => {
          if (isImeComposing(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            revealMatch(event.shiftKey ? -1 : 1);
          } else if (event.key === "Escape" && find) {
            event.preventDefault();
            event.stopPropagation();
            find = "";
            query = "";
            matchCursor = -1;
            drawToolbar();
            applyEmphasis();
          }
        },
        onToggle: toggleOption,
        onCopy: copyMarkup,
      }),
    );
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
    const rows = new Map<string, HTMLElement>();
    const headRef = createRef<HTMLElement>();
    const columns: ErCardRowProps[] = [];
    let hidden = 0;
    for (const column of table.columns) {
      const keys = columnKeys(current, name, column);
      const referenced =
        current.referencedColumns.get(name)?.has(column.name) === true;
      if (options.erKeysOnly && keys.length === 0 && !referenced) {
        hidden++;
        continue;
      }
      const comment = column.comment?.trim();
      columns.push({
        column: column.name,
        primaryKey: column.primaryKey,
        title: rowTitle(current, name, column),
        keys: keys.map((key) => ({
          key,
          title:
            key === "PK"
              ? t.primaryKey
              : key === "FK"
                ? t.foreignKey
                : t.unique,
        })),
        type: shownType(column.type),
        nullable: column.nullable && !column.primaryKey,
        comment: options.erShowComments
          ? comment
            ? firstLine(comment)
            : ""
          : null,
        rowRef: (element) => {
          if (element instanceof HTMLElement) rows.set(column.name, element);
        },
        onEnter: () => setHotRow(name, column.name),
        onLeave: () => setHotRow(name, null),
      });
    }
    const tableComment = table.info.comment?.trim();
    const card = templateElement(
      view.card({
        name,
        title: t.tableTitle(name),
        rows:
          table.info.rowCount != null
            ? formatRowCount(table.info.rowCount)
            : null,
        comment:
          options.erShowComments && tableComment
            ? { text: firstLine(tableComment), title: tableComment }
            : null,
        columns,
        more: hidden > 0 ? t.moreColumns(hidden) : null,
        headRef,
        onEnter: () => {
          hovered = name;
          if (!focused) applyEmphasis();
        },
        onLeave: () => {
          if (hovered === name) hovered = null;
          if (!focused) applyEmphasis();
        },
        onOpen: () => deps.onOpenTable?.(name),
        onHeadKeydown: (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            deps.onOpenTable?.(name);
          } else if (event.key === " ") {
            event.preventDefault();
            toggleFocus(name);
          }
        },
      }),
    );
    const head = drawn(headRef, `the header of ${name}`);
    cardOf.set(card, name);
    headOf.set(head, name);
    return {
      name,
      el: card,
      head,
      box: { x: 0, y: 0, width: 0, height: 0 },
      rowY: new Map(),
      rows,
      headY: 0,
    };
  }

  function buildEdge(relation: ErRelation): EdgeView {
    const props: ErEdgeProps = {
      inferred: !!relation.fk.inferred,
      lineRef: createRef(),
      marksRef: createRef(),
      dotsRef: createRef(),
    };
    const g = templateElement<SVGGElement>(view.edge(props));
    return {
      relation,
      g,
      line: drawn(props.lineRef, "an edge line"),
      marks: drawn(props.marksRef, "edge marks"),
      dots: drawn(props.dotsRef, "edge dots"),
    };
  }

  function rebuild(): void {
    canvas.replaceChildren();
    cards.clear();
    cardOf = new WeakMap();
    headOf = new WeakMap();
    edges.clear();
    linkedRows.length = 0;
    hotRow = null;
    hotRelations = null;
    stage = null;
    edgeLayer = null;
    if (!lastSchema || !lastColumns) {
      model = null;
      copyDisabled = true;
      drawToolbar();
      return;
    }
    const current = buildModel(lastSchema, lastColumns);
    model = current;
    copyDisabled = current.tables.length === 0;
    drawToolbar();
    if (current.tables.length === 0) {
      canvas.textContent = text().er.noTables;
      return;
    }
    if (focused && !current.tables.some((t) => t.info.name === focused))
      focused = null;
    const edgesRef = createRef<SVGSVGElement>();
    stage = templateElement(view.stage({ edgesRef }));
    edgeLayer = drawn(edgesRef, "the edge layer");
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
      const headRect = card.head.getBoundingClientRect();
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

  function setHotRow(table: string, column: string | null): void {
    hotRow?.classList.remove("is-hot");
    const row =
      column === null ? null : (cards.get(table)?.rows.get(column) ?? null);
    hotRow = row;
    if (!row) {
      hotRelations = null;
      applyEmphasis();
      return;
    }
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

  function toggleOption(key: ErOption): void {
    const on = !options[key];
    options[key] = on;
    optionFailures[key] = null;
    // 文言を当て直す (前と同じく、コピーの失敗の title もここで戻す)。
    copyFailure = null;
    rebuild();
    deps.saveOption?.(key, on).catch((error: unknown) => {
      const detail = reportDatastoreFailure(
        "SQL",
        `remember ER diagram option ${key}`,
        error,
        on,
      );
      optionFailures[key] = text().er.optionSaveFailed(detail);
      drawToolbar();
    });
  }

  function copyMarkup(): void {
    if (!model || model.tables.length === 0) return;
    navigator.clipboard.writeText(buildErMarkup(model)).then(
      () => {
        copied = true;
        drawToolbar();
        setTimeout(() => {
          copied = false;
          drawToolbar();
        }, COPY_MARK_MS);
      },
      (error) => {
        console.error("Failed to copy Mermaid source", error);
        copyFailed = true;
        copyFailure = text().er.copyFailed(formatErrorDetail(error));
        drawToolbar();
        setTimeout(() => {
          copyFailed = false;
          drawToolbar();
        }, COPY_MARK_MS);
      },
    );
  }

  /** target から上へたどって、map に載っている要素の名前を返す。 */
  function nameAbove(
    target: EventTarget | null,
    map: WeakMap<Element, string>,
  ): string | null {
    for (
      let node = target instanceof Element ? target : null;
      node && node !== canvas;
      node = node.parentElement
    ) {
      const name = map.get(node);
      if (name !== undefined) return name;
    }
    return null;
  }

  // 見出しを押したらカードを動かす。本体を押したときは図ごと動かす
  // (viewport のドラッグ) ので、見出しのときだけ viewport へ伝えない。
  canvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    pressedAt = { x: event.clientX, y: event.clientY };
    const name = nameAbove(event.target, headOf);
    const card = name === null ? undefined : cards.get(name);
    if (!card) return;
    event.stopPropagation();
    event.preventDefault();
    card.head.focus({ preventScroll: true });
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
    toggleFocus(nameAbove(event.target, cardOf));
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
    for (const key of ER_OPTIONS) options[key] = readOption(key);
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
    find = "";
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
    copyFailure = null;
    drawToolbar();
    // カードの title と「ほか n 列」も言語に合わせて組み直す。
    if (model) rebuild();
  }

  drawToolbar();

  return { el, render, clear, dispose, localize };
}
