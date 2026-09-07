// 相対時刻。単位の境目と、言語ごとの言い方。時刻は固定して渡すので実時計に
// 依存しない。

import { describe, expect, test } from "vitest";
import {
  absoluteWhen,
  describeWhen,
  formatRelativeTime,
  relativeTimeUnit,
} from "../core/relative-time";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTimeUnit", () => {
  test.each([
    { name: "zero", elapsedMs: 0, expected: null },
    { name: "just under a minute", elapsedMs: 59_000, expected: null },
    {
      name: "one minute",
      elapsedMs: MINUTE,
      expected: { value: 1, unit: "minute" },
    },
    {
      name: "just under an hour",
      elapsedMs: 59 * MINUTE,
      expected: { value: 59, unit: "minute" },
    },
    { name: "one hour", elapsedMs: HOUR, expected: { value: 1, unit: "hour" } },
    {
      name: "just under a day",
      elapsedMs: 23 * HOUR,
      expected: { value: 23, unit: "hour" },
    },
    { name: "one day", elapsedMs: DAY, expected: { value: 1, unit: "day" } },
    {
      name: "just under a week",
      elapsedMs: 6 * DAY,
      expected: { value: 6, unit: "day" },
    },
    {
      name: "one week",
      elapsedMs: 7 * DAY,
      expected: { value: 1, unit: "week" },
    },
    {
      name: "just under a month",
      elapsedMs: 29 * DAY,
      expected: { value: 4, unit: "week" },
    },
    {
      name: "one month",
      elapsedMs: 30 * DAY,
      expected: { value: 1, unit: "month" },
    },
    {
      name: "just under a year",
      elapsedMs: 11 * 30 * DAY,
      expected: { value: 11, unit: "month" },
    },
    {
      name: "one year",
      elapsedMs: 12 * 30 * DAY,
      expected: { value: 1, unit: "year" },
    },
    {
      name: "two years",
      elapsedMs: 24 * 30 * DAY,
      expected: { value: 2, unit: "year" },
    },
    // 時計が戻っていても「未来」とは言わない。
    { name: "a negative gap", elapsedMs: -5 * MINUTE, expected: null },
  ])("$name", ({ elapsedMs, expected }) => {
    expect(relativeTimeUnit(elapsedMs)).toEqual(expected);
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-09-07T09:00:00.000Z");

  test.each([
    {
      name: "under a minute has its own words",
      elapsedMs: 30_000,
      en: "just now",
      ja: "たった今",
    },
    {
      name: "minutes",
      elapsedMs: 13 * MINUTE,
      en: "13 minutes ago",
      ja: "13 分前",
    },
    {
      name: "hours",
      elapsedMs: 20 * HOUR,
      en: "20 hours ago",
      ja: "20 時間前",
    },
    {
      name: "one day has its own word",
      elapsedMs: DAY,
      en: "yesterday",
      ja: "昨日",
    },
    { name: "days", elapsedMs: 3 * DAY, en: "3 days ago", ja: "3 日前" },
    {
      name: "one week has its own word",
      elapsedMs: 7 * DAY,
      en: "last week",
      ja: "先週",
    },
    { name: "weeks", elapsedMs: 14 * DAY, en: "2 weeks ago", ja: "2 週間前" },
    {
      name: "one month has its own word",
      elapsedMs: 30 * DAY,
      en: "last month",
      ja: "先月",
    },
    {
      name: "months",
      elapsedMs: 150 * DAY,
      en: "5 months ago",
      ja: "5 か月前",
    },
    {
      name: "one year has its own word",
      elapsedMs: 360 * DAY,
      en: "last year",
      ja: "昨年",
    },
    { name: "years", elapsedMs: 720 * DAY, en: "2 years ago", ja: "2 年前" },
  ])("$name", ({ elapsedMs, en, ja }) => {
    expect(formatRelativeTime(now - elapsedMs, now, "en")).toBe(en);
    expect(formatRelativeTime(now - elapsedMs, now, "ja")).toBe(ja);
  });
});

// ローカル時刻で組み立てるので、タイムゾーンが違っても期待値は同じ。
describe("absoluteWhen", () => {
  test.each([
    {
      name: "pads month, day, hour, and minute",
      when: new Date(2026, 8, 7, 9, 5).getTime(),
      expected: "2026-09-07 09:05",
    },
    {
      name: "keeps two-digit fields as they are",
      when: new Date(2026, 11, 31, 23, 59).getTime(),
      expected: "2026-12-31 23:59",
    },
  ])("$name", ({ when, expected }) => {
    expect(absoluteWhen(when)).toBe(expected);
  });
});

describe("describeWhen", () => {
  const now = new Date(2026, 8, 7, 9, 5).getTime();

  test.each([
    {
      name: "relative first, exact time in parentheses",
      iso: new Date(2026, 8, 6, 9, 5).toISOString(),
      lang: "en" as const,
      expected: "yesterday (2026-09-06 09:05)",
    },
    {
      name: "the same shape in Japanese",
      iso: new Date(2026, 8, 6, 9, 5).toISOString(),
      lang: "ja" as const,
      expected: "昨日 (2026-09-06 09:05)",
    },
    {
      name: "a moment ago",
      iso: new Date(2026, 8, 7, 9, 4, 50).toISOString(),
      lang: "en" as const,
      expected: "just now (2026-09-07 09:04)",
    },
    {
      name: "an unreadable value is returned untouched",
      iso: "not a date",
      lang: "en" as const,
      expected: "not a date",
    },
  ])("$name", ({ iso, lang, expected }) => {
    expect(describeWhen(iso, now, lang)).toBe(expected);
  });
});
