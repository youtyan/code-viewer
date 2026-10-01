// Data の表で「いつ足された行か・いつ変わった行か」を読むための純ロジック。
// 列の名前と型から時刻の列 (created_at / updated_at など) を選び、セルの値
// (ISO の文字列・"YYYY-MM-DD HH:MM:SS"・UNIX 秒 / ミリ秒) を時刻に直す。
// DOM には触らない (表への組み込みは views/database/grid-recency.ts)。

import type { DbColumn, DbOrderDirection, DbValue } from "./types";

export type RecencyColumns = {
  /** 行が足された時刻の列。 */
  created: string | null;
  /** 行が最後に変わった時刻の列。 */
  updated: string | null;
  /** 足された順に増える 1 列だけの整数の主キー。時刻は無いので並びだけに使う。 */
  serial: string | null;
};

// 名前は小文字にして英数字以外を落としてから比べる (created_at・createdAt・
// CREATED-AT を同じに扱う)。先にあるものほど優先する。
const CREATED_NAMES = [
  "createdat",
  "insertedat",
  "createdon",
  "created",
  "createddate",
  "createdtime",
  "createdatetime",
  "datecreated",
  "createtime",
  "createdate",
  "creationdate",
  "creationtime",
  "inserteddate",
  "insertdate",
  "inserttime",
  "addedat",
  "dateadded",
];
const UPDATED_NAMES = [
  "updatedat",
  "modifiedat",
  "updatedon",
  "modifiedon",
  "updated",
  "modified",
  "updateddate",
  "updatedtime",
  "dateupdated",
  "updatetime",
  "updatedate",
  "modifieddate",
  "modifiedtime",
  "datemodified",
  "modifytime",
  "lastmodified",
  "lastmodifiedat",
  "lastmodifieddate",
  "lastupdated",
  "lastupdatedat",
  "changedat",
  "lastchanged",
  "mtime",
];

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 時刻を入れられる型か。真偽値・バイト列・JSON・日付だけ (時刻が無い) は外す。 */
function canHoldTime(type: string): boolean {
  const t = type.trim().toLowerCase();
  if (/bool|blob|binary|bytea|json|uuid|tinyint\(1\)/.test(t)) return false;
  return !/^date$/.test(t);
}

function pickByName(columns: DbColumn[], names: string[]): string | null {
  for (const name of names) {
    const hit = columns.find(
      (column) => nameKey(column.name) === name && canHoldTime(column.type),
    );
    if (hit) return hit.name;
  }
  return null;
}

export function recencyColumns(columns: DbColumn[]): RecencyColumns {
  const keys = columns.filter((column) => column.primaryKey);
  const serial =
    keys.length === 1 &&
    /int|serial/i.test(keys[0].type) &&
    !/tinyint\(1\)/i.test(keys[0].type)
      ? keys[0].name
      : null;
  return {
    created: pickByName(columns, CREATED_NAMES),
    updated: pickByName(columns, UPDATED_NAMES),
    serial,
  };
}

/**
 * 「新しい順」の並べ方。変わった時刻 → 足された時刻 → 整数の主キーの順に選ぶ
 * (変わった時刻で並べると、足したばかりの行も先頭に来る)。並べられないなら null。
 */
export function recencySort(
  columns: RecencyColumns,
): { column: string; direction: DbOrderDirection } | null {
  const column = columns.updated ?? columns.created ?? columns.serial;
  return column ? { column, direction: "desc" } : null;
}

/** 時差の書かれていない値を UTC と読むか、画面の時計 (ローカル) と読むか。 */
export type ZoneMode = "utc" | "local";

const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

// 時計のずれと、書き込みから読むまでの差を見込む。これより先の時刻は「未来」。
const FUTURE_SLACK_MS = 2 * 60_000;

type DateTimeParts = {
  fields: [number, number, number, number, number, number, number];
  /** 値に書かれた時差 (分)。書かれていなければ null。 */
  offsetMinutes: number | null;
};

function dateTimeParts(text: string): DateTimeParts | null {
  const m = DATE_TIME.exec(text.trim());
  if (!m) return null;
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
  const fields: DateTimeParts["fields"] = [
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] ? Number(m[6]) : 0,
    ms,
  ];
  const zone = m[8];
  if (!zone) return { fields, offsetMinutes: null };
  if (zone.toUpperCase() === "Z") return { fields, offsetMinutes: 0 };
  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  return { fields, offsetMinutes: sign * (hours * 60 + minutes) };
}

function epochOf(parts: DateTimeParts, zone: ZoneMode): number {
  const [y, mo, d, h, mi, s, ms] = parts.fields;
  if (parts.offsetMinutes !== null)
    return Date.UTC(y, mo, d, h, mi, s, ms) - parts.offsetMinutes * 60_000;
  return zone === "utc"
    ? Date.UTC(y, mo, d, h, mi, s, ms)
    : new Date(y, mo, d, h, mi, s, ms).getTime();
}

// UNIX 時刻として読む範囲。秒は 2001 年から、ミリ秒は 2001 年から。間の桁は
// どちらとも決められないので読まない (YYYYMMDD の整数なども外れる)。
function epochFromNumber(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  if (n >= 1e9 && n < 1e11) return Math.round(n * 1000);
  if (n >= 1e12 && n < 1e14) return Math.round(n);
  return null;
}

/** セルの値を時刻 (UNIX ミリ秒) にする。時刻と読めなければ null。 */
export function parseTimestamp(value: DbValue, zone: ZoneMode): number | null {
  if (typeof value === "number") return epochFromNumber(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^\d+(\.\d+)?$/.test(text)) return epochFromNumber(Number(text));
  const parts = dateTimeParts(text);
  if (!parts) return null;
  const epoch = epochOf(parts, zone);
  return Number.isFinite(epoch) ? epoch : null;
}

/**
 * 時差の無い値の読み方を、列の値から決める。UTC と読むと最新の値が未来になり、
 * ローカルと読むと未来にならないなら、その列は画面の時計で書かれている
 * (UTC の東の地域でアプリがローカル時刻を書いている)。それ以外は UTC と読む
 * (多くのフレームワークと SQLite の CURRENT_TIMESTAMP は UTC で書く)。
 */
export function zoneModeFor(values: Iterable<DbValue>, now: number): ZoneMode {
  let latest: DateTimeParts | null = null;
  let latestUtc = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (typeof value !== "string") continue;
    const parts = dateTimeParts(value);
    if (!parts || parts.offsetMinutes !== null) continue;
    const utc = epochOf(parts, "utc");
    if (utc > latestUtc) {
      latestUtc = utc;
      latest = parts;
    }
  }
  if (!latest || latestUtc <= now + FUTURE_SLACK_MS) return "utc";
  return epochOf(latest, "local") <= now + FUTURE_SLACK_MS ? "local" : "utc";
}

export type RowChange = { kind: "added" | "updated"; at: number };

// 足したときに両方の列へ書く時刻は、フレームワークによって少しずれる。
const SAME_MOMENT_MS = 1000;

/** 行が足されたのか変わったのか、いつか。どちらの時刻も無ければ null。 */
export function rowChange(
  created: number | null,
  updated: number | null,
): RowChange | null {
  if (
    updated !== null &&
    (created === null || updated - created > SAME_MOMENT_MS)
  )
    return { kind: "updated", at: updated };
  if (created !== null) return { kind: "added", at: created };
  return null;
}

/** 濃さの段: 1 時間以内 / 24 時間以内 / それより前。未来の時刻は強調しない。 */
export type ChangeAge = "fresh" | "recent" | "old";

export function changeAge(at: number, now: number): ChangeAge {
  if (at > now + FUTURE_SLACK_MS) return "old";
  const elapsed = now - at;
  if (elapsed < 60 * 60_000) return "fresh";
  if (elapsed < 24 * 60 * 60_000) return "recent";
  return "old";
}

/** 未来の時刻か (相対の「〜前」では書けない)。 */
export function isFutureTime(at: number, now: number): boolean {
  return at > now + FUTURE_SLACK_MS;
}

// --- 日時の列を、選んだタイムゾーンで表示し直す ---

/** 時刻らしい名前 (created_at・updatedAt・*_at・*_time・*Date など)。 */
const TIME_NAME = /(?:_at|At|_on|_time|Time|_date|Date|timestamp|Timestamp)$/;
const TIME_TYPE = /timestamp|datetime|date\s*time/i;

/**
 * 表示し直してよい列の番号。型が日時の列と、型が時刻を入れられて名前が
 * 時刻らしい列 (SQLite の TEXT・UNIX 時刻の整数)。値が時刻と読めないセルは
 * 列が当たっても元の値のまま出す (呼び出し側が parseTimestamp で見る)。
 */
export function timeColumnIndexes(columns: DbColumn[]): number[] {
  const out: number[] = [];
  columns.forEach((column, index) => {
    if (!canHoldTime(column.type)) return;
    if (TIME_TYPE.test(column.type) || TIME_NAME.test(column.name))
      out.push(index);
  });
  return out;
}
