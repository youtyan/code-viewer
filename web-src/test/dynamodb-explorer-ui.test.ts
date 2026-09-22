import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { waitFor } from "./_test-helpers";

GlobalRegistrator.register();

const { createDynamoDbExplorer } = await import(
  "../views/database/dynamodb-explorer"
);
const { dbText } = await import("../views/database/i18n");

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

function installFetchMock(fail?: (url: URL) => Error | null): FetchState {
  const state: FetchState = { calls: [] };
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      state.calls.push(url);
      const failure = fail?.(url);
      if (failure) throw failure;
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
  getText?: () => ReturnType<typeof dbText>;
  initial?: Parameters<ReturnType<typeof createDynamoDbExplorer>["load"]>[1];
}): Promise<ReturnType<typeof createDynamoDbExplorer>> {
  const view = createDynamoDbExplorer({
    trackLoad: options?.trackLoad,
    getText: options?.getText,
  });
  explorer = view;
  document.body.append(view.sidebarSlot, view.el);
  await view.load("mock", options?.initial);
  return view;
}

function failureWithCause(message: string): Error {
  return Object.assign(new Error(message), {
    cause: new Error("network is unreachable"),
  });
}

function dynamoLogs(calls: unknown[][], operation: string): unknown[][] {
  return calls.filter(
    (args) => args[0] === `[code-viewer] DynamoDB ${operation} failed`,
  );
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

  // 直す前は err.message だけを出し、console にも cause にも何も残らなかった。
  test.each([
    {
      operation: "table list",
      fails: (url: URL) =>
        url.pathname === "/_db/dynamodb/tables" &&
        !url.searchParams.get("exclusiveStartTableName"),
      open: async () => {
        // 開くだけ (load の中で失敗する)。
      },
      shown: (view: ReturnType<typeof createDynamoDbExplorer>) =>
        view.sidebarSlot.querySelector(".dynamodb-table-list .db-pane-error")
          ?.textContent,
    },
    {
      operation: "item list",
      fails: (url: URL) =>
        url.pathname === "/_db/dynamodb/items" &&
        !url.searchParams.get("exclusiveStartKey"),
      open: async () => {
        // 開くだけ (最初のテーブルを選んだところで失敗する)。
      },
      shown: (view: ReturnType<typeof createDynamoDbExplorer>) =>
        view.el.querySelector(".dynamodb-item-list .db-pane-error")
          ?.textContent,
    },
    {
      operation: "table describe",
      fails: (url: URL) => url.pathname === "/_db/dynamodb/table",
      open: async () => {
        // 開くだけ (最初のテーブルを選んだところで失敗する)。
      },
      shown: (view: ReturnType<typeof createDynamoDbExplorer>) =>
        view.el.querySelector(".db-detail-pane .db-pane-error")?.textContent,
    },
    {
      operation: "table list page",
      fails: (url: URL) =>
        url.pathname === "/_db/dynamodb/tables" &&
        !!url.searchParams.get("exclusiveStartTableName"),
      open: async (view: ReturnType<typeof createDynamoDbExplorer>) => {
        click(view.sidebarSlot.querySelector(".dynamodb-table-more-btn"));
      },
      shown: (view: ReturnType<typeof createDynamoDbExplorer>) =>
        view.sidebarSlot.querySelector<HTMLElement>(".dynamodb-table-more-btn")
          ?.title,
    },
  ])("$operation の失敗は理由を cause ごと画面と console に出す", async ({
    operation,
    fails,
    open,
    shown,
  }) => {
    const failure = failureWithCause(`${operation} request failed`);
    installFetchMock((url) => (fails(url) ? failure : null));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const view = await mountExplorer();
      await open(view);
      await waitFor(() => !!shown(view));

      const text = shown(view) ?? "";
      expect(text).toContain(`${operation} request failed`);
      expect(text).toContain("Caused by");
      expect(text).toContain("network is unreachable");
      const logs = dynamoLogs(consoleError.mock.calls, operation);
      expect(logs.length).toBe(1);
      expect(logs[0]?.[logs[0].length - 1]).toBe(failure);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("保存したアイテムの復元に失敗しても一覧は出し、理由を console に残す", async () => {
    // 直す前は HTTP の失敗も例外も黙って捨てていた。
    installFetchMock();
    const fetchMock = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/_db/dynamodb/item") {
          return new Response("sample failure", { status: 500 });
        }
        return fetchMock(input, init);
      }) as typeof fetch,
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const view = await mountExplorer({
        initial: {
          table: "sample_table_1",
          itemKey: JSON.stringify({ id: { S: "item_1" } }),
        },
      });

      expect(view.el.querySelectorAll(".dynamodb-item-row").length).toBe(1);
      const logs = dynamoLogs(consoleError.mock.calls, "item restore");
      expect(logs.length).toBe(1);
      const logged = logs[0]?.[logs[0].length - 1] as Error;
      expect(logged.message).toBe("get item (HTTP 500): sample failure");
    } finally {
      consoleError.mockRestore();
    }
  });

  test("キーのコピーに失敗したら、理由を title と console に出す", async () => {
    // 直す前は「コピーに失敗しました」だけで、理由がどこにも残らなかった。
    installFetchMock();
    const failure = new Error("clipboard is not allowed");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(failure) },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const view = await mountExplorer();
      click(view.el.querySelector(".dynamodb-item-row"));
      click(view.el.querySelector(".dynamodb-copy-key-btn"));
      const status = () =>
        view.el.querySelector<HTMLElement>(".dynamodb-copy-status");
      await waitFor(() => !!status()?.title);

      expect(status()?.title).toBe("Error: clipboard is not allowed");
      const logs = dynamoLogs(consoleError.mock.calls, "copy key");
      expect(logs.length).toBe(1);
      expect(logs[0]?.[logs[0].length - 1]).toBe(failure);
    } finally {
      consoleError.mockRestore();
    }
  });

  // 直す前は日本語の設定でも「Loading items...」と件数の行が英語のままだった。
  test.each([
    { language: "en" as const, status: "1 shown / 1 scanned" },
    { language: "ja" as const, status: "1 件表示 / 1 件スキャン" },
  ])("件数の行を表示の言語で描く: $language", async ({ language, status }) => {
    installFetchMock();
    const view = await mountExplorer({ getText: () => dbText(language) });
    await waitFor(
      () =>
        view.el.querySelector(".dynamodb-item-status")?.textContent === status,
    );
  });

  test("言語を切り替えると件数の行も描き直す", async () => {
    installFetchMock();
    let language: "en" | "ja" = "en";
    const view = await mountExplorer({ getText: () => dbText(language) });
    const status = () =>
      view.el.querySelector(".dynamodb-item-status")?.textContent;
    await waitFor(() => status() === "1 shown / 1 scanned");

    language = "ja";
    view.localize();

    expect(status()).toBe("1 件表示 / 1 件スキャン");
  });

  test("読み込み中の表示を表示の言語で描く", async () => {
    let releaseItems: (() => void) | undefined;
    installFetchMock();
    const fetchMock = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/_db/dynamodb/items") {
          await new Promise<void>((resolve) => {
            releaseItems = resolve;
          });
        }
        return fetchMock(input, init);
      }) as typeof fetch,
    });
    const view = createDynamoDbExplorer({ getText: () => dbText("ja") });
    explorer = view;
    document.body.append(view.sidebarSlot, view.el);
    const loading = view.load("mock");
    await waitFor(() => releaseItems !== undefined);

    expect(view.el.querySelector(".dynamodb-item-list")?.textContent).toBe(
      "アイテムを読み込み中...",
    );
    releaseItems?.();
    await loading;
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
