import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";

GlobalRegistrator.register();

const { runMermaid, loadMermaid } = vi.hoisted(() => {
  const runMermaid = vi.fn();
  return {
    runMermaid,
    loadMermaid: vi.fn(() => Promise.resolve({ run: runMermaid })),
  };
});

vi.mock("../core/mermaid-loader", () => ({ loadMermaid }));

const { createErDiagram } = await import("../views/database/er-diagram");

const SAMPLE_SCHEMA = {
  dbId: "sample.db",
  tables: [{ name: "sample_table", type: "table" as const, rowCount: 1 }],
  indexes: [],
  foreignKeys: [],
};
const SAMPLE_COLUMNS = new Map([
  [
    "sample_table",
    [
      {
        name: "sample_column",
        type: "TEXT",
        nullable: false,
        primaryKey: false,
        defaultValue: null,
      },
    ],
  ],
]);

describe("ER diagram", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    loadMermaid.mockImplementation(() => Promise.resolve({ run: runMermaid }));
    runMermaid.mockReset();
  });

  test.each([
    {
      name: "the Mermaid bundle does not load",
      arrange: () =>
        loadMermaid.mockImplementation(() =>
          Promise.reject(new Error("sample bundle missing")),
        ),
      shown:
        "Error: Failed to load mermaid.js\nCaused by: Error: sample bundle missing",
    },
    {
      name: "Mermaid throws while drawing",
      arrange: () =>
        runMermaid.mockImplementation(() =>
          Promise.reject(new TypeError("sample render crash")),
        ),
      shown:
        "Error: Failed to render ER diagram.\nCaused by: TypeError: sample render crash",
    },
  ])("shows why the diagram is missing when $name", async ({
    arrange,
    shown,
  }) => {
    arrange();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const diagram = createErDiagram();
    document.body.appendChild(diagram.el);

    await diagram.render(SAMPLE_SCHEMA, SAMPLE_COLUMNS);

    expect(diagram.el.querySelector(".db-er-svg-wrap")?.textContent).toBe(
      shown,
    );
    expect(consoleError).toHaveBeenCalledTimes(1);
    diagram.dispose();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("shows the Mermaid clipboard failure reason", async () => {
    const failure = new DOMException(
      "clipboard permission denied",
      "NotAllowedError",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(failure) },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const diagram = createErDiagram();
    document.body.appendChild(diagram.el);
    await diagram.render(
      {
        dbId: "sample.db",
        tables: [{ name: "sample_table", type: "table", rowCount: 1 }],
        indexes: [],
        foreignKeys: [],
      },
      new Map([
        [
          "sample_table",
          [
            {
              name: "sample_column",
              type: "TEXT",
              nullable: false,
              primaryKey: false,
              defaultValue: null,
            },
          ],
        ],
      ]),
    );

    const copy = diagram.el.querySelector<HTMLButtonElement>(
      ".db-er-zoom-btn:last-child",
    );
    copy?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(copy?.classList.contains("failed")).toBe(true);
    expect(copy?.title).toContain(
      "NotAllowedError: clipboard permission denied",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to copy Mermaid source",
      failure,
    );
    diagram.dispose();
  });
});
