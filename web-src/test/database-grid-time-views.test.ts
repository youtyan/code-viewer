// Data の表の時刻まわりの 2 つの presenter (views/database/grid-recency.ts の
// 「変更」の列と、time-zone-picker.ts のタイムゾーンの窓)。描き方を記録する view
// に差し替え、presenter が view に渡す値と、押したときの呼び出しを見る。

import "./_dom";
import { afterEach, describe, expect, test } from "vitest";
import type { DbColumn } from "../core/database/types";
import {
  createGridRecency,
  type GridRecencyView,
  DEFAULT_VIEW as RECENCY_VIEW,
} from "../views/database/grid-recency";
import { dbText } from "../views/database/i18n";
import {
  createTimeZonePicker,
  DEFAULT_VIEW as PICKER_VIEW,
  type TimeZonePickerProps,
} from "../views/database/time-zone-picker";

/** 2026-10-02T00:00:00Z */
const NOW = 1790899200000;

function column(name: string): DbColumn {
  return {
    name,
    type: "TEXT",
    nullable: true,
    primaryKey: false,
    defaultValue: null,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("the recency column presenter", () => {
  test("passes the change and its age to the view, and repaints on refresh", () => {
    const changes: Parameters<GridRecencyView["change"]>[0][] = [];
    const lefts: number[] = [];
    let now = NOW;
    const recency = createGridRecency(
      { text: () => dbText("en"), now: () => now },
      {
        ...RECENCY_VIEW,
        cell: (props) => {
          lefts.push(props.left);
          return RECENCY_VIEW.cell(props);
        },
        change: (props) => {
          changes.push(props);
          return RECENCY_VIEW.change(props);
        },
      },
    );
    recency.reset([column("id"), column("created_at"), column("updated_at")]);
    const cell = recency.cell(
      [1, "2026-10-01 23:55:00", "2026-10-01 23:55:00"],
      40,
    );
    document.body.append(cell);
    expect([
      lefts,
      changes[changes.length - 1]?.kind,
      cell.classList.contains("is-fresh"),
    ]).toEqual([[40], "added", true]);
    const firstLabel = changes[changes.length - 1]?.when;

    now += 3 * 60 * 60 * 1000;
    recency.refreshLabels(document.body);
    expect([
      changes.length,
      changes[changes.length - 1]?.when !== firstLabel,
      cell.classList.contains("is-fresh"),
    ]).toEqual([2, true, false]);
  });
});

describe("the time zone picker presenter", () => {
  test("filters, highlights and chooses through the view's handlers", async () => {
    const shown: TimeZonePickerProps[] = [];
    const saved: (string | null)[] = [];
    let changed = 0;
    const picker = createTimeZonePicker(
      {
        text: () => dbText("en"),
        get: () => "",
        set: async (pref) => {
          saved.push(pref);
        },
        onChange: () => changed++,
      },
      (props) => {
        shown.push(props);
        return PICKER_VIEW(props);
      },
    );
    document.body.append(picker.el);
    const last = () => shown[shown.length - 1] as TimeZonePickerProps;
    picker.sync();
    picker.setShown(true);
    expect([last().label, last().open, last().groups]).toEqual([
      "Time as stored",
      false,
      [],
    ]);

    last().onToggle();
    const firstGroup = last().groups[0];
    expect([
      last().open,
      firstGroup?.options.map((o) => [o.value, o.selected]),
    ]).toEqual([
      true,
      [
        ["", true],
        ["local", false],
        ["UTC", false],
      ],
    ]);

    // 「この PC」はこの PC のタイムゾーンの名前でも当たるので、比べるのはそれ以外。
    last().onQuery("los angeles");
    const visible = last()
      .groups.flatMap((group) => group.options)
      .filter((o) => !o.hidden);
    expect([
      visible.filter((o) => o.value !== "local").map((o) => o.value),
      visible.map((o) => o.highlighted),
      last().groups.map((group) => group.hidden),
    ]).toEqual([
      ["America/Los_Angeles"],
      visible.map((_, i) => i === 0),
      [true, true],
    ]);

    last().onKeydown(new KeyboardEvent("keydown", { key: "Enter" }));
    await Promise.resolve();
    expect([saved, changed, last().open]).toEqual([
      [visible[0]?.value],
      1,
      false,
    ]);
  });
});
