// Data の表の日時の列を出し直すタイムゾーンの純ロジック
// (core/database/time-zone.ts): 書式・短い名前・時差・選択窓の絞り込み。

import { describe, expect, test } from "vitest";
import {
  formatInZone,
  formatUtcOffset,
  timeZoneMatches,
  timeZoneOffsetMinutes,
  timeZoneShortName,
} from "../core/database/time-zone";

/** 2026-10-02T00:00:00Z */
const NOW = 1790899200000;

describe("formatInZone", () => {
  test.each([
    {
      name: "UTC",
      at: 1790858096000,
      zone: "UTC",
      expected: "2026-10-01 12:34:56",
    },
    {
      name: "Tokyo crosses the date",
      at: 1790858096000,
      zone: "Asia/Tokyo",
      expected: "2026-10-01 21:34:56",
    },
    {
      name: "New York in summer time",
      at: 1790858096000,
      zone: "America/New_York",
      expected: "2026-10-01 08:34:56",
    },
    {
      name: "midnight is 00, not 24",
      at: 1790899200000,
      zone: "UTC",
      expected: "2026-10-02 00:00:00",
    },
    {
      name: "milliseconds are kept",
      at: 1790858096789,
      zone: "UTC",
      expected: "2026-10-01 12:34:56.789",
    },
  ])("$name", ({ at, zone, expected }) => {
    expect(formatInZone(at, zone)).toBe(expected);
  });

  test("an unknown time zone throws RangeError", () => {
    expect(() => formatInZone(0, "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("timeZoneShortName", () => {
  test.each([
    { name: "UTC", zone: "UTC", language: "en", expected: "UTC" },
    {
      name: "Tokyo in English",
      zone: "Asia/Tokyo",
      language: "en",
      expected: "GMT+9",
    },
    {
      name: "Tokyo in Japanese",
      zone: "Asia/Tokyo",
      language: "ja",
      expected: "JST",
    },
  ])("$name", ({ zone, language, expected }) => {
    expect(timeZoneShortName(zone, NOW, language)).toBe(expected);
  });
});

describe("timeZoneOffsetMinutes", () => {
  test.each([
    { name: "UTC", zone: "UTC", at: NOW, expected: 0 },
    { name: "Tokyo", zone: "Asia/Tokyo", at: NOW, expected: 540 },
    { name: "Kolkata half hour", zone: "Asia/Kolkata", at: NOW, expected: 330 },
    {
      name: "New York in summer time",
      zone: "America/New_York",
      at: NOW,
      expected: -240,
    },
    {
      name: "New York in winter time",
      zone: "America/New_York",
      at: 1798761600000,
      expected: -300,
    },
    {
      name: "milliseconds do not shift the offset",
      zone: "Asia/Tokyo",
      at: NOW + 999,
      expected: 540,
    },
  ])("$name", ({ zone, at, expected }) => {
    expect(timeZoneOffsetMinutes(zone, at)).toBe(expected);
  });
});

describe("formatUtcOffset", () => {
  test.each([
    { minutes: 0, expected: "+00:00" },
    { minutes: 540, expected: "+09:00" },
    { minutes: 330, expected: "+05:30" },
    { minutes: -240, expected: "-04:00" },
    { minutes: -570, expected: "-09:30" },
  ])("$minutes minutes", ({ minutes, expected }) => {
    expect(formatUtcOffset(minutes)).toBe(expected);
  });
});

describe("timeZoneMatches", () => {
  test.each([
    {
      name: "empty query",
      query: "  ",
      zone: "Asia/Tokyo",
      offset: "+09:00",
      expected: true,
    },
    {
      name: "city, any case",
      query: "TOKYO",
      zone: "Asia/Tokyo",
      offset: "+09:00",
      expected: true,
    },
    {
      name: "region and city words",
      query: "america new york",
      zone: "America/New_York",
      offset: "-04:00",
      expected: true,
    },
    {
      name: "underscore in the query",
      query: "new_york",
      zone: "America/New_York",
      offset: "-04:00",
      expected: true,
    },
    {
      name: "a word that is not there",
      query: "tokyo osaka",
      zone: "Asia/Tokyo",
      offset: "+09:00",
      expected: false,
    },
    {
      name: "+9",
      query: "+9",
      zone: "Asia/Tokyo",
      offset: "+09:00",
      expected: true,
    },
    {
      name: "+09:00",
      query: "+09:00",
      zone: "Asia/Tokyo",
      offset: "+09:00",
      expected: true,
    },
    {
      name: "9 without a sign matches +09",
      query: "9",
      zone: "Asia/Tokyo",
      offset: "+09:00",
      expected: true,
    },
    {
      name: "9 without a sign matches -09",
      query: "9",
      zone: "America/Anchorage",
      offset: "-09:00",
      expected: true,
    },
    {
      name: "+9 does not match -09",
      query: "+9",
      zone: "America/Anchorage",
      offset: "-09:00",
      expected: false,
    },
    {
      name: "minus sign",
      query: "−4",
      zone: "America/New_York",
      offset: "-04:00",
      expected: true,
    },
    {
      name: "half hour",
      query: "+5:30",
      zone: "Asia/Kolkata",
      offset: "+05:30",
      expected: true,
    },
    {
      name: "+5:30 does not match +05:00",
      query: "+5:30",
      zone: "Asia/Karachi",
      offset: "+05:00",
      expected: false,
    },
    {
      name: "utc+9",
      query: "utc+9",
      zone: "Asia/Tokyo",
      offset: "+09:00",
      expected: true,
    },
    {
      name: "GMT-4",
      query: "GMT-4",
      zone: "America/New_York",
      offset: "-04:00",
      expected: true,
    },
    {
      name: "utc alone is a name",
      query: "utc",
      zone: "UTC",
      offset: "+00:00",
      expected: true,
    },
    {
      name: "an offset query against an option without offset",
      query: "+9",
      zone: "Time as stored",
      offset: "",
      expected: false,
    },
  ])("$name", ({ query, zone, offset, expected }) => {
    expect(timeZoneMatches(query, zone, offset)).toBe(expected);
  });
});
