import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { renderDelimitedPreview } from "../views/source-preview-elements";
import { delimitedPreviewText } from "../views/source-preview-i18n";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("Delimited preview", () => {
  test.each([
    {
      name: "quoted commas, escaped quotes, and quoted newlines",
      format: "csv" as const,
      csv: '\uFEFFname,note\nalpha,"one, two"\nbeta,"said ""hello"""\ngamma,"line 1\nline 2"',
      expectedHead: ["", "name", "note"],
      expectedBody: [
        ["1", "alpha", "one, two"],
        ["2", "beta", 'said "hello"'],
        ["3", "gamma", "line 1\nline 2"],
      ],
    },
    {
      name: "rows with fewer and more cells than the header",
      format: "csv" as const,
      csv: "first,second\none\ntwo,three,four",
      expectedHead: ["", "first", "second", ""],
      expectedBody: [
        ["1", "one", "", ""],
        ["2", "two", "three", "four"],
      ],
    },
    {
      name: "quoted tabs and quoted newlines",
      format: "tsv" as const,
      csv: 'name\tnote\nalpha\t"one\ttwo"\nbeta\t"line 1\nline 2"',
      expectedHead: ["", "name", "note"],
      expectedBody: [
        ["1", "alpha", "one\ttwo"],
        ["2", "beta", "line 1\nline 2"],
      ],
    },
    {
      name: "empty input",
      format: "csv" as const,
      csv: "",
      expectedHead: [],
      expectedBody: [],
    },
  ])("renders $name", ({ format, csv, expectedHead, expectedBody }) => {
    const preview = renderDelimitedPreview(csv, format);

    expect(
      Array.from(preview.querySelectorAll("thead tr:first-child th"), (cell) =>
        cell.textContent?.replace(/\u00a0/g, ""),
      ),
    ).toEqual(expectedHead);
    expect(
      Array.from(preview.querySelectorAll("tbody tr"), (row) =>
        Array.from(row.children, (cell) => cell.textContent),
      ),
    ).toEqual(expectedBody);
  });

  test("writes CSV fields as text instead of executable markup", () => {
    const preview = renderDelimitedPreview(
      'kind,value\nmarkup,"<img src=x onerror=alert(1)>"',
      "csv",
    );

    expect(preview.querySelector("img")).toBe(null);
    expect(preview.querySelector("tbody td:last-child")?.textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });

  test.each([
    {
      name: "global search matches any column without case sensitivity",
      selector: ".gdp-csv-search",
      value: "PENDING",
      expected: {
        rowNumbers: ["2"],
        resultCount: "1 / 3 rows",
        emptyText: null,
      },
    },
    {
      name: "column filter only matches its own column",
      selector: '[data-csv-column-filter="1"]',
      value: "do",
      expected: {
        rowNumbers: ["3"],
        resultCount: "1 / 3 rows",
        emptyText: null,
      },
    },
    {
      name: "unmatched filter shows the empty result state",
      selector: ".gdp-csv-search",
      value: "missing",
      expected: {
        rowNumbers: [],
        resultCount: "0 / 3 rows",
        emptyText: "No rows match the current filters.",
      },
    },
  ])("filters rows: $name", ({ selector, value, expected }) => {
    const preview = renderDelimitedPreview(
      "name,status,note\nalpha,ready,first\nbeta,pending,second\ngamma,done,third",
      "csv",
    );
    const input = preview.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`missing ${selector}`);

    input.value = value;
    input.dispatchEvent(new Event("input"));

    expect({
      rowNumbers: Array.from(
        preview.querySelectorAll("tbody tr:not(.gdp-csv-empty-row) th"),
        (cell) => cell.textContent,
      ),
      resultCount: preview.querySelector(".gdp-csv-result-count")?.textContent,
      emptyText:
        preview.querySelector(".gdp-csv-empty-row td")?.textContent ?? null,
    }).toEqual(expected);
  });

  test("combines global search and column filters", () => {
    const preview = renderDelimitedPreview(
      "name,status\nalpha,ready\nbeta,pending\ngamma,ready",
      "csv",
    );
    const search = preview.querySelector<HTMLInputElement>(".gdp-csv-search");
    const statusFilter = preview.querySelector<HTMLInputElement>(
      '[data-csv-column-filter="1"]',
    );
    if (!search || !statusFilter) throw new Error("missing CSV filters");

    search.value = "mm";
    search.dispatchEvent(new Event("input"));
    statusFilter.value = "ready";
    statusFilter.dispatchEvent(new Event("input"));

    expect(
      Array.from(
        preview.querySelectorAll("tbody tr th"),
        (cell) => cell.textContent,
      ),
    ).toEqual(["3"]);
  });

  test("cycles numeric sorting through ascending, descending, and source order", () => {
    const preview = renderDelimitedPreview(
      "value,label\n10,first\n2,second\n2,third\n,empty",
      "csv",
    );
    const sort = preview.querySelector<HTMLButtonElement>(
      '[data-csv-sort-column="0"]',
    );
    const header = sort?.closest("th");
    if (!sort || !header) throw new Error("missing CSV sort header");

    sort.click();
    expect(
      Array.from(
        preview.querySelectorAll("tbody th"),
        (cell) => cell.textContent,
      ),
    ).toEqual(["2", "3", "1", "4"]);
    expect(header.getAttribute("aria-sort")).toBe("ascending");

    sort.click();
    expect(
      Array.from(
        preview.querySelectorAll("tbody th"),
        (cell) => cell.textContent,
      ),
    ).toEqual(["1", "2", "3", "4"]);
    expect(header.getAttribute("aria-sort")).toBe("descending");

    sort.click();
    expect(
      Array.from(
        preview.querySelectorAll("tbody th"),
        (cell) => cell.textContent,
      ),
    ).toEqual(["1", "2", "3", "4"]);
    expect(header.getAttribute("aria-sort")).toBe("none");
  });

  test("reset clears every filter and sort while restoring source order", () => {
    const preview = renderDelimitedPreview(
      "value,status\n10,ready\n2,pending",
      "csv",
    );
    const search = preview.querySelector<HTMLInputElement>(".gdp-csv-search");
    const columnFilter = preview.querySelector<HTMLInputElement>(
      '[data-csv-column-filter="1"]',
    );
    const sort = preview.querySelector<HTMLButtonElement>(
      '[data-csv-sort-column="0"]',
    );
    const reset = preview.querySelector<HTMLButtonElement>(".gdp-csv-reset");
    if (!search || !columnFilter || !sort || !reset)
      throw new Error("missing CSV controls");
    search.value = "pending";
    search.dispatchEvent(new Event("input"));
    columnFilter.value = "pending";
    columnFilter.dispatchEvent(new Event("input"));
    sort.click();

    reset.click();

    expect(search.value).toBe("");
    expect(columnFilter.value).toBe("");
    expect(reset.disabled).toBe(true);
    expect(
      Array.from(
        preview.querySelectorAll("tbody th"),
        (cell) => cell.textContent,
      ),
    ).toEqual(["1", "2"]);
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("none");
  });

  test("updates TSV controls when the viewer language changes", () => {
    let language: "en" | "ja" = "en";
    const preview = renderDelimitedPreview("name\nalpha", "tsv", () =>
      delimitedPreviewText(language, "tsv"),
    );

    language = "ja";
    preview.localize();

    expect(
      preview.querySelector<HTMLInputElement>(".gdp-csv-search")?.placeholder,
    ).toBe("全列を検索…");
    expect(preview.querySelector(".gdp-csv-reset")?.textContent).toBe(
      "リセット",
    );
    expect(preview.querySelector(".gdp-csv-result-count")?.textContent).toBe(
      "1 / 1 行",
    );
    expect(
      preview
        .querySelector<HTMLInputElement>(".gdp-csv-search")
        ?.getAttribute("aria-label"),
    ).toBe("TSVの全列を検索");
    expect(
      preview
        .querySelector('[data-csv-sort-column="0"]')
        ?.getAttribute("aria-label"),
    ).toBe("nameを昇順に並べ替え");
  });

  test.each([
    {
      name: "CSV labels",
      format: "csv" as const,
      input: "name,status\nalpha,ready",
      searchLabel: "Search all CSV columns",
      resultCountLabel: "Visible CSV rows",
    },
    {
      name: "TSV labels",
      format: "tsv" as const,
      input: "name\tstatus\nalpha\tready",
      searchLabel: "Search all TSV columns",
      resultCountLabel: "Visible TSV rows",
    },
  ])("uses $name", ({ format, input, searchLabel, resultCountLabel }) => {
    const preview = renderDelimitedPreview(input, format);

    expect(
      preview
        .querySelector<HTMLInputElement>(".gdp-csv-search")
        ?.getAttribute("aria-label"),
    ).toBe(searchLabel);
    expect(
      preview
        .querySelector<HTMLElement>(".gdp-csv-result-count")
        ?.getAttribute("aria-label"),
    ).toBe(resultCountLabel);
  });
});
