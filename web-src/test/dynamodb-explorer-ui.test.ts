import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { waitFor } from "./_test-helpers";

GlobalRegistrator.register();

const { createDynamoDbExplorer } = await import(
  "../views/database/dynamodb-explorer"
);

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function click(el: Element | null | undefined): void {
  (el as HTMLElement | null)?.dispatchEvent(
    new Event("click", { bubbles: true }),
  );
}

type FetchState = {
  calls: URL[];
  tableRequestSignal?: AbortSignal;
};

function installFetchMock(): FetchState {
  const state: FetchState = { calls: [] };
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      state.calls.push(url);
      if (url.pathname === "/_db/dynamodb/tables") {
        state.tableRequestSignal = init?.signal ?? undefined;
        if (url.searchParams.get("exclusiveStartTableName")) {
          return json({ dbId: "mock", tableNames: ["sample_table_2"] });
        }
        return json({
          dbId: "mock",
          tableNames: ["sample_table_1"],
          lastEvaluatedTableName: "sample_table_1",
        });
      }
      if (url.pathname === "/_db/dynamodb/table") {
        return json({
          dbId: "mock",
          table: {
            TableName: url.searchParams.get("table"),
            KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
          },
        });
      }
      if (url.pathname === "/_db/dynamodb/items") {
        if (url.searchParams.get("exclusiveStartKey")) {
          return json({
            dbId: "mock",
            tableName: "sample_table_1",
            mode: "scan",
            items: [{ id: { S: "item_2" }, title: { S: "second" } }],
            count: 1,
            scannedCount: 1,
          });
        }
        return json({
          dbId: "mock",
          tableName: "sample_table_1",
          mode: "scan",
          items: [{ id: { S: "item_1" }, title: { S: "first" } }],
          count: 1,
          scannedCount: 1,
          lastEvaluatedKey: { id: { S: "item_1" } },
        });
      }
      if (url.pathname === "/_db/dynamodb/item") {
        return json({
          dbId: "mock",
          tableName: "sample_table_1",
          item: { id: { S: "item_1" }, title: { S: "first" } },
        });
      }
      return json({});
    }) as typeof fetch,
  });
  return state;
}

let explorer: ReturnType<typeof createDynamoDbExplorer> | null = null;

beforeEach(() => {
  explorer?.dispose();
  explorer = null;
  document.body.innerHTML = "";
});

afterAll(() => {
  explorer?.dispose();
  GlobalRegistrator.unregister();
});

async function mountExplorer(options?: {
  trackLoad?: <T>(promise: Promise<T>) => Promise<T>;
}): Promise<ReturnType<typeof createDynamoDbExplorer>> {
  const view = createDynamoDbExplorer({ trackLoad: options?.trackLoad });
  explorer = view;
  document.body.append(view.sidebarSlot, view.el);
  await view.load("mock");
  return view;
}

describe("DynamoDB explorer UI", () => {
  test("テーブル一覧の継続トークンから次ページを追加表示する", async () => {
    installFetchMock();
    const view = await mountExplorer();
    const more = view.sidebarSlot.querySelector<HTMLButtonElement>(
      ".dynamodb-table-more-btn",
    );

    expect(more?.textContent).toBe("Load more");
    click(more);

    await waitFor(
      () =>
        view.sidebarSlot.querySelectorAll(".dynamodb-table-item").length === 2,
    );
    expect(
      Array.from(
        view.sidebarSlot.querySelectorAll<HTMLElement>(".dynamodb-table-item"),
      ).map((row) => row.dataset.tableName),
    ).toEqual(["sample_table_1", "sample_table_2"]);
  });

  test("アイテムの追加読み込みボタンは初回表示から名前を持つ", async () => {
    installFetchMock();
    const view = await mountExplorer();
    const more = view.el.querySelector<HTMLButtonElement>(
      ".dynamodb-item-more-btn",
    );

    expect(more?.hidden).toBe(false);
    expect(more?.textContent).toBe("Load more");
    click(more);

    await waitFor(
      () => view.el.querySelectorAll(".dynamodb-item-row").length === 2,
    );
  });

  test("全DynamoDBリクエストをtrackLoadへ登録する", async () => {
    installFetchMock();
    let tracked = 0;
    const view = await mountExplorer({
      trackLoad: <T>(promise: Promise<T>): Promise<T> => {
        tracked++;
        return promise;
      },
    });

    click(view.sidebarSlot.querySelector(".dynamodb-table-more-btn"));
    click(view.el.querySelector(".dynamodb-item-more-btn"));
    await waitFor(() => tracked === 5);
    await view.load("mock", {
      table: "sample_table_1",
      itemKey: JSON.stringify({ id: { S: "item_1" } }),
    });

    expect(tracked).toBe(9);
  });

  test.each([
    {
      name: "成功時",
      writeText: () => Promise.resolve(),
      expectedStatus: "Copied",
    },
    {
      name: "失敗時",
      writeText: () => Promise.reject(new Error("copy failed")),
      expectedStatus: "Copy failed",
    },
  ])("$name: キーコピー後もボタンラベルを変えない", async ({
    writeText,
    expectedStatus,
  }) => {
    installFetchMock();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const view = await mountExplorer();
    click(view.el.querySelector(".dynamodb-item-row"));
    const copy = view.el.querySelector<HTMLButtonElement>(
      ".dynamodb-copy-key-btn",
    );

    click(copy);
    await waitFor(
      () =>
        view.el.querySelector(".dynamodb-copy-status")?.textContent ===
        expectedStatus,
    );

    expect(copy?.textContent).toBe("Copy key");
  });

  test("disposeで進行中のテーブル一覧取得を中断する", async () => {
    let signal: AbortSignal | undefined;
    let resolveResponse: ((response: Response) => void) | undefined;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: ((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        });
      }) as typeof fetch,
    });
    const view = createDynamoDbExplorer();
    explorer = view;
    document.body.append(view.sidebarSlot, view.el);
    const loading = view.load("mock");
    await waitFor(() => signal !== undefined);

    view.dispose();
    expect(signal?.aborted).toBe(true);
    resolveResponse?.(json({ dbId: "mock", tableNames: [] }));
    await loading;
  });
});
