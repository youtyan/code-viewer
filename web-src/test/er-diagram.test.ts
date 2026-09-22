import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";

GlobalRegistrator.register();

const { runMermaid } = vi.hoisted(() => ({ runMermaid: vi.fn() }));

vi.mock("../core/mermaid-loader", () => ({
  loadMermaid: () => Promise.resolve({ run: runMermaid }),
}));

const { createErDiagram } = await import("../views/database/er-diagram");

describe("ER diagram", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
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
