import { html, nothing } from "lit/html.js";
import type {
  DbColumn,
  DbForeignKey,
  DbIndexInfo,
} from "../../core/database/types";
import { formatErrorDetail } from "../../core/error-detail";
import { SYNC_16_PATH } from "../../core/icons";
import { iconTemplate } from "../ui/icon";
import { renderOwned, templateElement } from "../ui/renderer";
import { type DbText, dbText } from "./i18n";

export type TriggerDisplayInfo = {
  name: string;
  sql: string;
};

export type SchemaViewData = {
  table: string;
  columns: DbColumn[];
  indexes: DbIndexInfo[];
  foreignKeys?: DbForeignKey[];
  triggers?: TriggerDisplayInfo[];
  ddl?: string;
};

type SchemaViewExtra = {
  foreignKeys?: DbForeignKey[];
  triggers?: TriggerDisplayInfo[];
  ddl?: string;
  tableComment?: string | null;
};

export type SchemaView = {
  el: HTMLElement;
  render: (
    table: string,
    columns: DbColumn[],
    indexes: DbIndexInfo[],
    extra?: SchemaViewExtra,
  ) => void;
  clear: () => void;
  showError: (message: string) => void;
  localize: () => void;
  setRefreshBusy: (busy: boolean) => void;
};

export type SchemaTableProps = {
  header: string;
  /** 構造を読み直すボタン (読み直す口が無ければ null)。 */
  refresh: { busy: boolean; onClick: () => void } | null;
  columns: DbColumn[];
  foreignKeys: DbForeignKey[];
  indexes: DbIndexInfo[];
  triggers: TriggerDisplayInfo[];
  ddl: {
    sql: string;
    copied: boolean;
    failed: boolean;
    /** コピーに失敗した理由 (title)。 */
    failure: string | null;
    onCopy: () => void;
  } | null;
};

export type SchemaViewProps = {
  text: DbText["schema"];
  body:
    | { kind: "none" }
    | { kind: "error"; message: string }
    | ({ kind: "table" } & SchemaTableProps);
};

export type SchemaViewView = (props: SchemaViewProps) => unknown;

function schemaTable(labels: string[], rows: unknown): unknown {
  return html`<table class="db-schema-table"><thead><tr>${labels.map(
    (label) => html`<th>${label}</th>`,
  )}</tr></thead><tbody>${rows}</tbody></table>`;
}

const section = (label: string) =>
  html`<div class="db-schema-section-header">${label}</div>`;

export const DEFAULT_VIEW: SchemaViewView = ({ text: t, body }) => {
  if (body.kind === "none") return nothing;
  if (body.kind === "error")
    return html`<div class="db-pane-error">${body.message}</div>`;
  return html`<div class="db-schema-header"><span class="db-schema-header-title"
        >${body.header}</span
      >${
        body.refresh
          ? html`<button
              type="button"
              class=${body.refresh.busy ? "db-btn db-btn-icon db-grid-refresh db-schema-refresh spinning" : "db-btn db-btn-icon db-grid-refresh db-schema-refresh"}
              title=${t.refreshAction}
              aria-label=${t.refreshAction}
              aria-busy=${body.refresh.busy ? "true" : "false"}
              ?disabled=${body.refresh.busy}
              @click=${body.refresh.onClick}
            >${iconTemplate(SYNC_16_PATH, "octicon-sync")}<span
                class="db-grid-refresh-label"
              ></span></button>`
          : nothing
      }</div
    >${section(t.columns)}${schemaTable(
      [
        t.colName,
        t.colType,
        t.colNullable,
        t.colPk,
        t.colDefault,
        t.colComment,
      ],
      body.columns.map(
        (col) =>
          html`<tr class=${col.primaryKey ? "pk-row" : nothing}><td
              class="db-schema-col-name"
            >${col.name}</td><td class="db-schema-col-type">${col.type}</td><td
              >${col.nullable ? t.yes : t.no}</td
            ><td class=${col.primaryKey ? "db-schema-pk" : nothing}>${
              col.primaryKey ? t.colPk : ""
            }</td><td class="db-schema-default">${col.defaultValue ?? ""}</td><td
              class="db-schema-comment"
            >${col.comment ?? ""}</td></tr>`,
      ),
    )}${
      body.foreignKeys.length > 0
        ? html`${section(t.foreignKeys)}${schemaTable(
            [t.colName, t.refTable, t.refColumn],
            body.foreignKeys.map(
              (fk) =>
                html`<tr><td>${fk.fromColumn}</td><td>${fk.toTable}</td><td
                    >${fk.toColumn}</td
                  ></tr>`,
            ),
          )}`
        : nothing
    }${
      body.indexes.length > 0
        ? html`${section(t.indexes)}${schemaTable(
            [t.idxName, t.idxColumns, t.idxUnique],
            body.indexes.map(
              (idx) =>
                html`<tr><td>${idx.name}</td><td>${idx.columns.join(", ")}</td><td
                    >${idx.unique ? t.yes : t.no}</td
                  ></tr>`,
            ),
          )}`
        : nothing
    }${
      body.triggers.length > 0
        ? html`${section(t.triggers)}${body.triggers.map(
            (trig) =>
              html`<div class="db-schema-trigger-block"><div
                  class="db-schema-trigger-name"
                >${trig.name}</div><pre class="db-schema-ddl-pre">${trig.sql}</pre></div>`,
          )}`
        : nothing
    }${
      body.ddl
        ? html`${section(t.ddl)}<div class="db-schema-ddl-wrap"><button
              type="button"
              class=${body.ddl.failed ? "db-btn db-btn-sm db-schema-copy-btn failed" : "db-btn db-btn-sm db-schema-copy-btn"}
              title=${body.ddl.failure ?? nothing}
              @click=${body.ddl.onCopy}
            >${body.ddl.copied ? t.copied : t.copyDdl}</button><pre
              class="db-schema-ddl-pre"
            >${body.ddl.sql}</pre></div>`
        : nothing
    }`;
};

/** 「コピーしました」・失敗の印を出しておく時間。 */
const COPY_MARK_MS = 1500;

export function createSchemaView(
  deps: { getText?: () => DbText; onRefresh?: () => void | Promise<void> } = {},
  view: SchemaViewView = DEFAULT_VIEW,
): SchemaView {
  const text = (): DbText => deps.getText?.() ?? dbText("en");
  // 隠す・出すはこの係と画面 (database-view) の両方が el.hidden に書くので、
  // hidden は描き方に入れず、中身だけを描く。
  const el = templateElement(html`<div class="db-schema-view" hidden></div>`);
  let refreshBusy = false;
  let error: string | null = null;
  let copied = false;
  let copyFailed = false;
  let copyFailure: string | null = null;

  // 言語切替時に同じデータで再描画するため、直近の render 引数を保持する。
  let lastArgs: {
    table: string;
    columns: DbColumn[];
    indexes: DbIndexInfo[];
    extra?: SchemaViewExtra;
  } | null = null;

  function body(): SchemaViewProps["body"] {
    if (error !== null) return { kind: "error", message: error };
    if (!lastArgs) return { kind: "none" };
    const { table, columns, indexes, extra } = lastArgs;
    const ddl = extra?.ddl;
    return {
      kind: "table",
      header: text().schema.header(table, extra?.tableComment?.trim()),
      refresh: deps.onRefresh
        ? {
            busy: refreshBusy,
            onClick: () => {
              if (refreshBusy) return;
              void deps.onRefresh?.();
            },
          }
        : null,
      columns,
      foreignKeys:
        extra?.foreignKeys?.filter((fk) => fk.fromTable === table) ?? [],
      indexes: indexes.filter((idx) => idx.table === table),
      triggers: extra?.triggers ?? [],
      ddl: ddl
        ? {
            sql: ddl,
            copied,
            failed: copyFailed,
            failure: copyFailure,
            onCopy: () => copyDdl(ddl),
          }
        : null,
    };
  }

  const draw = () =>
    renderOwned(el, view({ text: text().schema, body: body() }));

  function copyDdl(ddl: string): void {
    const t = text().schema;
    navigator.clipboard.writeText(ddl).then(
      () => {
        copied = true;
        draw();
        setTimeout(() => {
          copied = false;
          draw();
        }, COPY_MARK_MS);
      },
      (failure) => {
        console.error("Failed to copy schema DDL", failure);
        copyFailed = true;
        copyFailure = t.copyFailed(formatErrorDetail(failure));
        draw();
        setTimeout(() => {
          copyFailed = false;
          draw();
        }, COPY_MARK_MS);
      },
    );
  }

  function render(
    table: string,
    columns: DbColumn[],
    indexes: DbIndexInfo[],
    extra?: SchemaViewExtra,
  ) {
    lastArgs = { table, columns, indexes, extra };
    error = null;
    copied = false;
    copyFailed = false;
    copyFailure = null;
    el.hidden = false;
    draw();
  }

  function clear() {
    el.hidden = true;
    lastArgs = null;
    error = null;
    refreshBusy = false;
    draw();
  }

  function showError(message: string): void {
    el.hidden = false;
    lastArgs = null;
    error = message;
    refreshBusy = false;
    draw();
  }

  function localize(): void {
    if (!lastArgs || el.hidden) return;
    draw();
  }

  function setRefreshBusy(busy: boolean): void {
    refreshBusy = busy;
    draw();
  }

  return { el, render, clear, showError, localize, setRefreshBusy };
}
