// Data の表の「いつ足された・変わった行か」を読む純ロジック
// (core/database/recency.ts)。時差の無い値を画面の時計で読むかどうかの判定を
// 確かめるため、この file の間だけ UTC の東 (Asia/Tokyo, +09:00) で動かす。

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  changeAge,
  isFutureTime,
  parseTimestamp,
  recencyColumns,
  recencySort,
  rowChange,
  timeColumnIndexes,
  zoneModeFor,
} from "../core/database/recency";
import type { DbColumn, DbValue } from "../core/database/types";

const savedTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Asia/Tokyo";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

/** 2026-10-02T00:00:00Z */
const NOW = 1790899200000;

function column(name: string, type: string, primaryKey = false): DbColumn {
  return { name, type, nullable: true, primaryKey, defaultValue: null };
}

describe("recencyColumns", () => {
  test.each([
    {
      name: "snake_case timestamps and an integer key",
      columns: [
        column("id", "INTEGER", true),
        column("created_at", "TEXT"),
        column("updated_at", "TEXT"),
      ],
      expected: { created: "created_at", updated: "updated_at", serial: "id" },
    },
    {
      name: "camelCase timestamps and a uuid key",
      columns: [
        column("id", "uuid", true),
        column("createdAt", "timestamp without time zone"),
        column("updatedAt", "timestamp with time zone"),
      ],
      expected: { created: "createdAt", updated: "updatedAt", serial: null },
    },
    {
      name: "a boolean named like a timestamp is skipped",
      columns: [
        column("updated", "BOOLEAN"),
        column("modified_at", "DATETIME"),
      ],
      expected: { created: null, updated: "modified_at", serial: null },
    },
    {
      name: "a date-only column has no time of day",
      columns: [column("created_on", "date")],
      expected: { created: null, updated: null, serial: null },
    },
    {
      name: "a composite key is not a serial",
      columns: [column("a", "INTEGER", true), column("b", "INTEGER", true)],
      expected: { created: null, updated: null, serial: null },
    },
    {
      name: "a bigserial key is a serial",
      columns: [column("id", "bigserial", true), column("name", "text")],
      expected: { created: null, updated: null, serial: "id" },
    },
    {
      name: "a tinyint(1) key is a flag, not a serial",
      columns: [column("flag", "tinyint(1)", true)],
      expected: { created: null, updated: null, serial: null },
    },
    {
      name: "the earlier name in the list wins over column order",
      columns: [column("created", "TEXT"), column("inserted_at", "TEXT")],
      expected: { created: "inserted_at", updated: null, serial: null },
    },
    {
      name: "epoch integers and untyped SQLite columns count",
      columns: [column("created_at", "INTEGER"), column("mtime", "")],
      expected: { created: "created_at", updated: "mtime", serial: null },
    },
    {
      name: "a table without any of them",
      columns: [column("key", "TEXT", true), column("value", "TEXT")],
      expected: { created: null, updated: null, serial: null },
    },
  ])("$name", ({ columns, expected }) => {
    expect(recencyColumns(columns)).toEqual(expected);
  });
});

describe("recencySort", () => {
  test.each([
    {
      name: "updated wins",
      input: { created: "created_at", updated: "updated_at", serial: "id" },
      expected: { column: "updated_at", direction: "desc" },
    },
    {
      name: "created without updated",
      input: { created: "created_at", updated: null, serial: "id" },
      expected: { column: "created_at", direction: "desc" },
    },
    {
      name: "the serial key without timestamps",
      input: { created: null, updated: null, serial: "id" },
      expected: { column: "id", direction: "desc" },
    },
    {
      name: "nothing to sort by",
      input: { created: null, updated: null, serial: null },
      expected: null,
    },
  ])("$name", ({ input, expected }) => {
    expect(recencySort(input)).toEqual(expected);
  });
});

describe("parseTimestamp", () => {
  test.each<{
    name: string;
    value: DbValue;
    zone: "utc" | "local";
    expected: number | null;
  }>([
    {
      name: "ISO with Z and milliseconds",
      value: "2026-10-01T12:34:56.789Z",
      zone: "utc",
      expected: 1790858096789,
    },
    {
      name: "the offset wins over the local reading",
      value: "2026-10-01T12:34:56.789Z",
      zone: "local",
      expected: 1790858096789,
    },
    {
      name: "space separated without seconds, read as UTC",
      value: "2026-10-01 12:34",
      zone: "utc",
      expected: 1790858040000,
    },
    {
      name: "+09:00",
      value: "2026-10-01 12:34:56+09:00",
      zone: "utc",
      expected: 1790825696000,
    },
    {
      name: "+0900",
      value: "2026-10-01T12:34:56+0900",
      zone: "utc",
      expected: 1790825696000,
    },
    {
      name: "PostgreSQL hours-only offset",
      value: "2026-10-01 12:34:56.000000+09",
      zone: "utc",
      expected: 1790825696000,
    },
    {
      name: "-05:30",
      value: "2026-10-01 12:34:56-05:30",
      zone: "utc",
      expected: 1790877896000,
    },
    {
      name: "microseconds are cut to milliseconds",
      value: "2026-10-01 12:34:56.123456",
      zone: "utc",
      expected: 1790858096123,
    },
    {
      name: "no offset, read on the screen's clock",
      value: "2026-10-01 12:34:56",
      zone: "local",
      expected: 1790825696000,
    },
    {
      name: "UNIX seconds",
      value: 1790000000,
      zone: "utc",
      expected: 1790000000000,
    },
    {
      name: "UNIX milliseconds",
      value: 1790000000000,
      zone: "utc",
      expected: 1790000000000,
    },
    {
      name: "UNIX seconds as text (bigint columns)",
      value: "1790000000",
      zone: "utc",
      expected: 1790000000000,
    },
    {
      name: "the lowest seconds value",
      value: 1000000000,
      zone: "utc",
      expected: 1000000000000,
    },
    {
      name: "just below the seconds range",
      value: 999999999,
      zone: "utc",
      expected: null,
    },
    {
      name: "between seconds and milliseconds",
      value: 100000000000,
      zone: "utc",
      expected: null,
    },
    {
      name: "the highest milliseconds value",
      value: 99999999999999,
      zone: "utc",
      expected: 99999999999999,
    },
    {
      name: "just above the milliseconds range",
      value: 100000000000000,
      zone: "utc",
      expected: null,
    },
    {
      name: "a YYYYMMDD integer",
      value: 20261001,
      zone: "utc",
      expected: null,
    },
    { name: "a date only", value: "2026-10-01", zone: "utc", expected: null },
    { name: "words", value: "yesterday", zone: "utc", expected: null },
    { name: "NULL", value: null, zone: "utc", expected: null },
    { name: "a boolean", value: true, zone: "utc", expected: null },
    {
      name: "bytes",
      value: new Uint8Array([1, 2]),
      zone: "utc",
      expected: null,
    },
  ])("$name", ({ value, zone, expected }) => {
    expect(parseTimestamp(value, zone)).toBe(expected);
  });
});

describe("zoneModeFor (screen clock +09:00, now 2026-10-02T00:00Z)", () => {
  test.each<{ name: string; values: DbValue[]; expected: "utc" | "local" }>([
    {
      name: "a recent UTC value stays UTC",
      values: ["2026-10-01 23:50:00"],
      expected: "utc",
    },
    {
      name: "a value 9 hours ahead in UTC but past on the screen clock is local",
      values: ["2026-10-02 08:55:00"],
      expected: "local",
    },
    {
      name: "a value in the future either way stays UTC",
      values: ["2026-10-02 12:00:00"],
      expected: "utc",
    },
    {
      name: "the latest value decides",
      values: ["2026-09-30 10:00:00", "2026-10-02 08:55:00"],
      expected: "local",
    },
    {
      name: "values with an offset are not evidence",
      values: ["2026-10-02T08:55:00+09:00", 1790000000],
      expected: "utc",
    },
    {
      name: "exactly two minutes ahead is still clock drift",
      values: ["2026-10-02 00:02:00"],
      expected: "utc",
    },
    {
      name: "just past two minutes ahead is local",
      values: ["2026-10-02 00:02:01"],
      expected: "local",
    },
    { name: "no values", values: [], expected: "utc" },
  ])("$name", ({ values, expected }) => {
    expect(zoneModeFor(values, NOW)).toBe(expected);
  });
});

describe("rowChange", () => {
  test.each([
    {
      name: "same moment is an addition",
      created: NOW,
      updated: NOW,
      expected: { kind: "added", at: NOW },
    },
    {
      name: "one second apart is still the addition",
      created: NOW,
      updated: NOW + 1000,
      expected: { kind: "added", at: NOW },
    },
    {
      name: "just over one second later is an update",
      created: NOW,
      updated: NOW + 1001,
      expected: { kind: "updated", at: NOW + 1001 },
    },
    {
      name: "only the created time",
      created: NOW,
      updated: null,
      expected: { kind: "added", at: NOW },
    },
    {
      name: "only the updated time",
      created: null,
      updated: NOW,
      expected: { kind: "updated", at: NOW },
    },
    {
      name: "updated before created reads as the addition",
      created: NOW,
      updated: NOW - 5000,
      expected: { kind: "added", at: NOW },
    },
    { name: "no times", created: null, updated: null, expected: null },
  ])("$name", ({ created, updated, expected }) => {
    expect(rowChange(created, updated)).toEqual(expected);
  });
});

describe("changeAge", () => {
  test.each([
    { name: "now", at: NOW, expected: "fresh" },
    { name: "just under an hour", at: NOW - 3599999, expected: "fresh" },
    { name: "one hour", at: NOW - 3600000, expected: "recent" },
    { name: "just under a day", at: NOW - 86399999, expected: "recent" },
    { name: "one day", at: NOW - 86400000, expected: "old" },
    { name: "two minutes ahead", at: NOW + 120000, expected: "fresh" },
    { name: "past two minutes ahead", at: NOW + 120001, expected: "old" },
  ])("$name", ({ at, expected }) => {
    expect(changeAge(at, NOW)).toBe(expected);
  });
});

describe("isFutureTime", () => {
  test.each([
    { name: "now", at: NOW, expected: false },
    { name: "two minutes ahead", at: NOW + 120000, expected: false },
    { name: "past two minutes ahead", at: NOW + 120001, expected: true },
  ])("$name", ({ at, expected }) => {
    expect(isFutureTime(at, NOW)).toBe(expected);
  });
});

describe("timeColumnIndexes", () => {
  test.each([
    {
      name: "typed timestamps whatever the name",
      columns: [
        column("id", "integer", true),
        column("seen", "timestamp with time zone"),
        column("logged", "DATETIME"),
      ],
      expected: [1, 2],
    },
    {
      name: "time-like names on text and integer columns",
      columns: [
        column("created_at", "TEXT"),
        column("expiresAt", "INTEGER"),
        column("sample_start_time", ""),
        column("birthDate", "TEXT"),
      ],
      expected: [0, 1, 2, 3],
    },
    {
      name: "names that only look close",
      columns: [
        column("category", "TEXT"),
        column("sample_update_count", "INTEGER"),
        column("format", "TEXT"),
      ],
      expected: [],
    },
    {
      name: "booleans, JSON and date-only columns",
      columns: [
        column("sample_flag_at", "boolean"),
        column("sample_meta_at", "json"),
        column("sample_day_on", "date"),
      ],
      expected: [],
    },
  ])("$name", ({ columns, expected }) => {
    expect(timeColumnIndexes(columns)).toEqual(expected);
  });
});
