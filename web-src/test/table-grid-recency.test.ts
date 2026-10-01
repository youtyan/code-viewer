// Data の表の「最近の変化」: 行番号の右の「変更」の列、「新しい順」、
// 再読み込みで変わった行の印。happy-dom 上の実描画で、出た文字・付いた
// クラス・取りに行った並び (fetchPage に渡った sort) を見る。時計は Date だけ
// 止める (行の組み立ては requestAnimationFrame と setTimeout で本物を使う)。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { tableData } from "./_table-grid-fixture";
import { q } from "./_test-helpers";

GlobalRegistrator.register();

const { createTableGrid } = await import("../views/database/table-grid");
const { dbText } = await import("../views/database/i18n");

import type {
  DbColumn,
  DbTableDataResponse,
  DbValue,
} from "../core/database/types";
import type {
  GridSort,
  TableGridCallbacks,
} from "../views/database/table-grid";

/** 2026-10-02T00:00:00Z */
const NOW = 1790899200000;
const tick = () => new Promise((r) => setTimeout(r, 20));

function column(name: string, type: string, primaryKey = false): DbColumn {
  return { name, type, nullable: true, primaryKey, defaultValue: null };
}

const TIMED: DbColumn[] = [
  column("id", "INTEGER", true),
  column("title", "TEXT"),
  column("created_at", "TEXT"),
  column("updated_at", "TEXT"),
];

const TIMED_ROWS: DbValue[][] = [
  [3, "third", "2026-10-01 23:55:00", "2026-10-01 23:55:00"],
  [2, "second", "2026-09-20 10:00:00", "2026-10-01 21:00:00"],
  [1, "first", "2026-09-01 10:00:00", "2026-09-01 10:00:00"],
  [4, "fourth", null, null],
];

const PLAIN: DbColumn[] = [
  column("id", "INTEGER", true),
  column("label", "TEXT"),
];

function data(columns: DbColumn[], rows: DbValue[][]): DbTableDataResponse {
  return tableData({ dbId: "sample.db", table: "sample_table", columns, rows });
}

type FetchCall = { offset: number; sort: GridSort | null };
const lastSort = (calls: FetchCall[]) => calls[calls.length - 1]?.sort ?? null;

function setup(opts: {
  columns: DbColumn[];
  rows: DbValue[][];
  newestFirst?: boolean;
  setNewestFirst?: TableGridCallbacks["setNewestFirst"];
  fetchRows?: () => DbValue[][];
  embedded?: boolean;
  timeZone?: string;
  setTimeZone?: TableGridCallbacks["setTimeZone"];
}) {
  const calls: FetchCall[] = [];
  const saved: boolean[] = [];
  const savedZones: (string | null)[] = [];
  const grid = createTableGrid(
    {
      fetchPage: async (_table, offset, _limit, sort) => {
        calls.push({ offset, sort });
        return data(opts.columns, opts.fetchRows?.() ?? opts.rows);
      },
      getDbId: () => "sample.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getForeignKeys: () => [],
      getEditable: () => false,
      getNewestFirst: () => opts.newestFirst ?? false,
      setNewestFirst:
        opts.setNewestFirst ??
        (async (on) => {
          saved.push(on);
        }),
      getTimeZone: () => opts.timeZone ?? "",
      setTimeZone:
        opts.setTimeZone ??
        (async (zone) => {
          savedZones.push(zone);
        }),
    },
    { embedded: opts.embedded },
  );
  document.body.appendChild(grid.el);
  const viewport = q<HTMLElement>(grid.el, ".db-grid-viewport");
  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    value: 400,
  });
  const rows = () => [
    ...grid.el.querySelectorAll<HTMLElement>(".db-grid-body .db-grid-row"),
  ];
  const newest = () => q<HTMLButtonElement>(grid.el, ".db-grid-newest");
  const status = () => q(grid.el, ".db-grid-status").textContent ?? "";
  const done = () => {
    grid.destroy();
    grid.el.remove();
  };
  const zoneButton = () => q<HTMLButtonElement>(grid.el, ".db-grid-tz-button");
  const zoneMenu = () => q<HTMLElement>(grid.el, ".db-grid-tz-menu");
  const zoneSearch = () => q<HTMLInputElement>(grid.el, ".db-grid-tz-search");
  const shownZones = () =>
    [...grid.el.querySelectorAll<HTMLElement>(".db-grid-tz-option")].filter(
      (o) => !o.hidden,
    );
  const pickZone = async (value: string) => {
    zoneButton().click();
    q<HTMLButtonElement>(
      grid.el,
      `.db-grid-tz-option[data-value="${value}"]`,
    ).click();
    await tick();
  };
  return {
    grid,
    calls,
    saved,
    savedZones,
    rows,
    newest,
    status,
    zoneButton,
    zoneMenu,
    zoneSearch,
    shownZones,
    pickZone,
    done,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("the Changed column", () => {
  test("shows when each row was added or changed, strongest within the hour", async () => {
    const t = setup({ columns: TIMED, rows: TIMED_ROWS });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
    await tick();
    const shown = t.rows().map((row) => {
      const cell = q<HTMLElement>(row, ".db-grid-recency");
      return {
        text: cell.textContent,
        kind: cell.dataset.kind ?? null,
        fresh: cell.classList.contains("is-fresh"),
        recent: cell.classList.contains("is-recent"),
        old: cell.classList.contains("is-old"),
      };
    });
    expect(shown).toEqual([
      { text: "5m ago", kind: "added", fresh: true, recent: false, old: false },
      {
        text: "3h ago",
        kind: "updated",
        fresh: false,
        recent: true,
        old: false,
      },
      {
        text: "last mo.",
        kind: "added",
        fresh: false,
        recent: false,
        old: true,
      },
      { text: "", kind: null, fresh: false, recent: false, old: false },
    ]);
    t.done();
  });

  test("names the column and the source columns in the header", async () => {
    const t = setup({ columns: TIMED, rows: TIMED_ROWS });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
    await tick();
    const header = [
      ...t.grid.el.querySelectorAll(".db-grid-header > .db-grid-cell"),
    ];
    expect(header.map((cell) => cell.textContent)).toEqual([
      "#",
      "Changed",
      "id",
      "title",
      "created_at",
      "updated_at",
    ]);
    expect((header[1] as HTMLElement).title).toContain(
      "created_at / updated_at",
    );
    t.done();
  });

  test("tells what the time is in the cell's tooltip", async () => {
    const t = setup({ columns: TIMED, rows: TIMED_ROWS });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
    await tick();
    expect(q<HTMLElement>(t.rows()[1], ".db-grid-recency").title).toBe(
      "Changed 3h ago — updated_at: 2026-10-01 21:00:00",
    );
    t.done();
  });

  test("is not drawn for a table without time columns", async () => {
    const t = setup({ columns: PLAIN, rows: [[1, "a"]] });
    t.grid.load("sample_table", data(PLAIN, [[1, "a"]]), null);
    await tick();
    expect(
      t.grid.el.querySelector(".db-grid-recency, .db-grid-recency-header"),
    ).toBeNull();
    expect([...t.rows()[0].children].map((cell) => cell.textContent)).toEqual([
      "1",
      "1",
      "a",
    ]);
    t.done();
  });

  test("moves its labels on as time passes", async () => {
    const t = setup({ columns: TIMED, rows: TIMED_ROWS });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
    await tick();
    vi.setSystemTime(NOW + 60 * 60_000);
    t.grid.localize();
    const cell = q(t.rows()[0], ".db-grid-recency");
    expect([cell.textContent, cell.classList.contains("is-recent")]).toEqual([
      "1h ago",
      true,
    ]);
    t.done();
  });

  test("keeps the clicked cell active although the column is in front", async () => {
    const t = setup({ columns: TIMED, rows: TIMED_ROWS });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
    await tick();
    const titleCell = t.rows()[1].children[3] as HTMLElement;
    titleCell.click();
    await tick();
    expect(q(t.grid.el, ".db-grid-cell-active").textContent).toBe("second");
    t.done();
  });
});

describe("Newest first", () => {
  test.each([
    {
      name: "on, with time columns",
      newestFirst: true,
      embedded: false,
      expected: { column: "updated_at", direction: "desc" },
    },
    { name: "off", newestFirst: false, embedded: false, expected: null },
    {
      name: "in the related panel",
      newestFirst: true,
      embedded: true,
      expected: null,
    },
  ])("initial sort: $name", ({ newestFirst, embedded, expected }) => {
    const t = setup({
      columns: TIMED,
      rows: TIMED_ROWS,
      newestFirst,
      embedded,
    });
    expect(t.grid.initialSortFor(TIMED)).toEqual(expected);
    t.done();
  });

  test("the integer key orders a table without time columns", () => {
    const t = setup({ columns: PLAIN, rows: [], newestFirst: true });
    expect(t.grid.initialSortFor(PLAIN)).toEqual({
      column: "id",
      direction: "desc",
    });
    t.done();
  });

  test("shows as pressed when the table opened newest first", async () => {
    const t = setup({ columns: TIMED, rows: TIMED_ROWS, newestFirst: true });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), {
      column: "updated_at",
      direction: "desc",
    });
    await tick();
    expect([
      t.newest().hidden,
      t.newest().getAttribute("aria-pressed"),
    ]).toEqual([false, "true"]);
    expect(t.status()).toContain("Newest first (updated_at)");
    expect(t.calls).toEqual([]);
    t.done();
  });

  test("turning it off and on reloads in that order and remembers it", async () => {
    const t = setup({ columns: TIMED, rows: TIMED_ROWS, newestFirst: true });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), {
      column: "updated_at",
      direction: "desc",
    });
    await tick();
    t.newest().click();
    await tick();
    expect([
      t.newest().getAttribute("aria-pressed"),
      lastSort(t.calls),
    ]).toEqual(["false", null]);
    t.newest().click();
    await tick();
    expect([
      t.newest().getAttribute("aria-pressed"),
      lastSort(t.calls),
    ]).toEqual(["true", { column: "updated_at", direction: "desc" }]);
    expect(t.saved).toEqual([false, true]);
    t.done();
  });

  test("sorting by a header turns it off without forgetting the setting", async () => {
    const t = setup({ columns: TIMED, rows: TIMED_ROWS, newestFirst: true });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), {
      column: "updated_at",
      direction: "desc",
    });
    await tick();
    const titleHeader = [
      ...t.grid.el.querySelectorAll<HTMLElement>(".db-grid-header-cell"),
    ].find((cell) => cell.textContent?.startsWith("title"));
    titleHeader?.click();
    await tick();
    expect([
      t.newest().getAttribute("aria-pressed"),
      lastSort(t.calls),
    ]).toEqual(["false", { column: "title", direction: "asc" }]);
    expect(t.saved).toEqual([]);
    t.done();
  });

  test("a table loaded without an order is fetched again newest first", async () => {
    const unsorted = [...TIMED_ROWS].reverse();
    const t = setup({ columns: TIMED, rows: TIMED_ROWS, newestFirst: true });
    t.grid.load("sample_table", data(TIMED, unsorted));
    await tick();
    expect(t.calls).toEqual([
      { offset: 0, sort: { column: "updated_at", direction: "desc" } },
    ]);
    expect(t.rows().map((row) => row.children[3].textContent)).toEqual([
      "third",
      "second",
      "first",
      "fourth",
    ]);
    t.done();
  });

  test("is hidden for a table it cannot order", async () => {
    const columns = [column("key", "TEXT", true), column("value", "TEXT")];
    const t = setup({ columns, rows: [["a", "b"]], newestFirst: true });
    t.grid.load("sample_table", data(columns, [["a", "b"]]), null);
    await tick();
    expect(t.newest().hidden).toBe(true);
    t.done();
  });

  test("shows why the setting could not be remembered", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const t = setup({
      columns: TIMED,
      rows: TIMED_ROWS,
      newestFirst: true,
      setNewestFirst: async () => {
        throw new Error("save datastore settings (HTTP 500): disk full");
      },
    });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), {
      column: "updated_at",
      direction: "desc",
    });
    await tick();
    t.newest().click();
    await tick();
    expect(t.newest().dataset.saveFailed).toBe("1");
    expect(t.newest().title).toContain("disk full");
    expect(error).toHaveBeenCalledWith(
      "[code-viewer] SQL remember newest-first order failed",
      false,
      expect.any(Error),
    );
    t.done();
  });
});

describe("marks after a reload", () => {
  test("marks rows that are new or changed since the last load", async () => {
    let rows: DbValue[][] = [
      [1, "a"],
      [2, "b"],
    ];
    const t = setup({ columns: PLAIN, rows, fetchRows: () => rows });
    t.grid.load("sample_table", data(PLAIN, rows), null);
    await tick();
    rows = [
      [1, "a2"],
      [2, "b"],
      [3, "c"],
    ];
    await t.grid.refresh();
    await tick();
    expect(
      t
        .rows()
        .map((row) => [
          row.children[1].textContent,
          row.classList.contains("is-changed"),
          row.classList.contains("is-added"),
        ]),
    ).toEqual([
      ["1", true, false],
      ["2", false, false],
      ["3", false, true],
    ]);
    expect(t.status()).toContain("Since the last reload: 1 new, 1 changed");
    t.done();
  });

  test("drops the marks when the order changes", async () => {
    let rows: DbValue[][] = [[1, "a"]];
    const t = setup({ columns: PLAIN, rows, fetchRows: () => rows });
    t.grid.load("sample_table", data(PLAIN, rows), null);
    await tick();
    rows = [[1, "a2"]];
    await t.grid.refresh();
    await tick();
    q<HTMLElement>(t.grid.el, ".db-grid-header-cell").click();
    await tick();
    expect(t.grid.el.querySelector(".db-grid-row-refreshed")).toBeNull();
    expect(t.status()).not.toContain("Since the last reload");
    t.done();
  });

  test("marks nothing when the reload fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let fail = false;
    const rows: DbValue[][] = [[1, "a"]];
    const t = setup({
      columns: PLAIN,
      rows,
      fetchRows: () => {
        if (fail) throw new Error("no such table");
        return rows;
      },
    });
    t.grid.load("sample_table", data(PLAIN, rows), null);
    await tick();
    fail = true;
    await t.grid.refresh();
    await tick();
    expect(t.grid.el.querySelector(".db-grid-row-refreshed")).toBeNull();
    expect(q(t.grid.el, ".db-grid-status").textContent).toContain(
      "no such table",
    );
    t.done();
  });
});

describe("time zone display", () => {
  // 列: # | Changed | id | title | created_at | updated_at
  const timeCells = (row: HTMLElement) =>
    [4, 5].map((index) => row.children[index] as HTMLElement);

  test("shows date and time columns in the chosen zone and keeps the stored value in the tooltip", async () => {
    const t = setup({
      columns: TIMED,
      rows: TIMED_ROWS,
      timeZone: "Asia/Tokyo",
    });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
    await tick();
    expect(
      timeCells(t.rows()[1]).map((cell) => [cell.textContent, cell.title]),
    ).toEqual([
      ["2026-09-20 19:00:00", "Stored value: 2026-09-20 10:00:00"],
      ["2026-10-02 06:00:00", "Stored value: 2026-10-01 21:00:00"],
    ]);
    expect(t.rows()[1].children[3].textContent).toBe("second");
    expect(timeCells(t.rows()[3]).map((cell) => cell.textContent)).toEqual([
      "NULL",
      "NULL",
    ]);
    t.done();
  });

  test("marks the converted columns' headers with the zone", async () => {
    const t = setup({
      columns: TIMED,
      rows: TIMED_ROWS,
      timeZone: "Asia/Tokyo",
    });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
    await tick();
    const badges = [
      ...t.grid.el.querySelectorAll<HTMLElement>(".db-grid-header-cell"),
    ].map(
      (cell) => cell.querySelector(".db-grid-header-tz")?.textContent ?? null,
    );
    expect(badges).toEqual([null, null, "GMT+9", "GMT+9"]);
    t.done();
  });

  test("leaves the stored values as they are by default", async () => {
    const t = setup({ columns: TIMED, rows: TIMED_ROWS });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
    await tick();
    expect(timeCells(t.rows()[1]).map((cell) => cell.textContent)).toEqual([
      "2026-09-20 10:00:00",
      "2026-10-01 21:00:00",
    ]);
    expect([
      t.zoneButton().textContent,
      t.grid.el.querySelector(".db-grid-header-tz"),
    ]).toEqual(["Time as stored", null]);
    t.done();
  });

  test("choosing a zone redraws at once and remembers it", async () => {
    const t = setup({ columns: TIMED, rows: TIMED_ROWS });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
    await tick();
    await t.pickZone("America/New_York");
    expect(timeCells(t.rows()[1]).map((cell) => cell.textContent)).toEqual([
      "2026-09-20 06:00:00",
      "2026-10-01 17:00:00",
    ]);
    await t.pickZone("");
    expect(timeCells(t.rows()[1]).map((cell) => cell.textContent)).toEqual([
      "2026-09-20 10:00:00",
      "2026-10-01 21:00:00",
    ]);
    expect(t.savedZones).toEqual(["America/New_York", null]);
    t.done();
  });

  test.each([
    { name: "a table without date columns", columns: PLAIN, embedded: false },
    { name: "the related panel", columns: TIMED, embedded: true },
  ])("the zone choice is hidden in $name", async ({ columns, embedded }) => {
    const t = setup({ columns, rows: [], embedded });
    t.grid.load("sample_table", data(columns, []), null);
    await tick();
    expect(q<HTMLElement>(t.grid.el, ".db-grid-tz").hidden).toBe(true);
    t.done();
  });

  test("shows why the zone could not be remembered", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const t = setup({
      columns: TIMED,
      rows: TIMED_ROWS,
      setTimeZone: async () => {
        throw new Error("save datastore settings (HTTP 500): disk full");
      },
    });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
    await tick();
    await t.pickZone("UTC");
    const control = q<HTMLElement>(t.grid.el, ".db-grid-tz");
    expect([
      control.dataset.saveFailed,
      t.zoneButton().title.includes("disk full"),
    ]).toEqual(["1", true]);
    expect(error).toHaveBeenCalledWith(
      "[code-viewer] SQL remember time zone failed",
      "UTC",
      expect.any(Error),
    );
    t.done();
  });

  test("an unknown stored zone shows the stored values and says why", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const t = setup({
      columns: TIMED,
      rows: TIMED_ROWS,
      timeZone: "Mars/Olympus",
    });
    t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
    await tick();
    const control = q<HTMLElement>(t.grid.el, ".db-grid-tz");
    expect(timeCells(t.rows()[1]).map((cell) => cell.textContent)).toEqual([
      "2026-09-20 10:00:00",
      "2026-10-01 21:00:00",
    ]);
    expect([
      control.classList.contains("is-failed"),
      t.zoneButton().title.includes("Mars/Olympus"),
    ]).toEqual([true, true]);
    expect(error).toHaveBeenCalledTimes(1);
    t.done();
  });

  describe("the time zone menu", () => {
    const key = (target: HTMLElement, name: string) =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, bubbles: true }),
      );

    test("puts the common choices first with the offset of each zone", async () => {
      const t = setup({ columns: TIMED, rows: TIMED_ROWS });
      t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
      await tick();
      t.zoneButton().click();
      const options = t.shownZones();
      expect([options[0], options[2]].map((o) => o.textContent)).toEqual([
        "Time as stored",
        "UTC+00:00",
      ]);
      const tokyo = q<HTMLElement>(
        t.grid.el,
        '.db-grid-tz-option[data-value="Asia/Tokyo"]',
      );
      expect(tokyo.textContent).toBe("Asia/Tokyo+09:00");
      expect(
        q<HTMLElement>(
          t.grid.el,
          '.db-grid-tz-option[data-value=""]',
        ).getAttribute("aria-selected"),
      ).toBe("true");
      t.done();
    });

    // 一覧はランタイムの ICU が決める (Asia/Kolkata か Asia/Calcutta か) ので、
    // 名前ではなく、残った行の時差と、名前で引いたときの 1 件で見る。
    test("narrows the list by an offset", async () => {
      const t = setup({ columns: TIMED, rows: TIMED_ROWS });
      t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
      await tick();
      t.zoneButton().click();
      t.zoneSearch().value = "+5:30";
      t.zoneSearch().dispatchEvent(new Event("input"));
      const offsets = t
        .shownZones()
        .filter((o) => o.dataset.value !== "local")
        .map((o) => o.querySelector(".db-grid-tz-offset")?.textContent);
      expect([offsets.length > 0, new Set(offsets)]).toEqual([
        true,
        new Set(["+05:30"]),
      ]);
      t.done();
    });

    test("narrows the list by a city", async () => {
      const t = setup({ columns: TIMED, rows: TIMED_ROWS });
      t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
      await tick();
      t.zoneButton().click();
      t.zoneSearch().value = "tokyo";
      t.zoneSearch().dispatchEvent(new Event("input"));
      expect(
        t
          .shownZones()
          .map((o) => o.dataset.value)
          .filter((value) => value !== "local"),
      ).toEqual(["Asia/Tokyo"]);
      t.done();
    });

    test("says so when nothing matches", async () => {
      const t = setup({ columns: TIMED, rows: TIMED_ROWS });
      t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
      await tick();
      t.zoneButton().click();
      t.zoneSearch().value = "no such place";
      t.zoneSearch().dispatchEvent(new Event("input"));
      const empty = q<HTMLElement>(t.grid.el, ".db-grid-tz-empty");
      expect([t.shownZones().length, empty.hidden, empty.textContent]).toEqual([
        0,
        false,
        "No time zone matches",
      ]);
      t.done();
    });

    test("arrow keys and Enter choose from the search box", async () => {
      const t = setup({ columns: TIMED, rows: TIMED_ROWS });
      t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
      await tick();
      t.zoneButton().click();
      t.zoneSearch().value = "utc";
      t.zoneSearch().dispatchEvent(new Event("input"));
      // 先頭は実行するマシンのタイムゾーンで変わる (UTC のマシンでは「この
      // コンピュータ」も utc に当たって先頭に来る)。先頭が選ばれることを見る。
      const shown = t.shownZones().map((option) => option.dataset.value);
      key(t.zoneSearch(), "ArrowDown");
      key(t.zoneSearch(), "ArrowUp");
      key(t.zoneSearch(), "Enter");
      await tick();
      expect([
        shown.includes("UTC"),
        t.savedZones,
        t.zoneMenu().hidden,
      ]).toEqual([true, [shown[0]], true]);
      t.done();
    });

    test("Escape closes the menu without choosing", async () => {
      const t = setup({ columns: TIMED, rows: TIMED_ROWS });
      t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
      await tick();
      t.zoneButton().click();
      key(t.zoneSearch(), "Escape");
      expect([t.zoneMenu().hidden, t.savedZones]).toEqual([true, []]);
      t.done();
    });

    test("a click outside closes the menu", async () => {
      const t = setup({ columns: TIMED, rows: TIMED_ROWS });
      t.grid.load("sample_table", data(TIMED, TIMED_ROWS), null);
      await tick();
      t.zoneButton().click();
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
      expect(t.zoneMenu().hidden).toBe(true);
      t.done();
    });
  });
});
