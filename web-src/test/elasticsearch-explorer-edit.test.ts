// Elasticsearch エクスプローラの編集 UI を happy-dom で検証する。ドキュメント
// JSON 編集 (楽観ロック付き) / 削除 / 新規作成が正しい body で
// POST /_db/elasticsearch/write を呼ぶことを確認する。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { clickDialogConfirm, closeOpenDialog } from "./_dialog-helpers";
import { q, waitFor } from "./_test-helpers";

GlobalRegistrator.register();

const { createElasticsearchExplorer } = await import(
  "../views/database/elasticsearch-explorer"
);
const { dbText } = await import("../views/database/i18n");

const tick = () => new Promise((r) => setTimeout(r, 20));

type WriteCall = Record<string, unknown>;
let writeCalls: WriteCall[] = [];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const origFetch = globalThis.fetch;

function installFetch(fail?: (url: string) => Error | null) {
  writeCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const failure = fail?.(url);
    if (failure) throw failure;
    if (url.includes("/_db/elasticsearch/indices")) {
      return jsonResponse({
        dbId: "docker:es",
        indices: [{ name: "my-index", docCount: 1, sizeBytes: 0 }],
      });
    }
    if (url.includes("/_db/elasticsearch/mapping")) {
      return jsonResponse({
        dbId: "docker:es",
        mapping: { index: "my-index", properties: {} },
      });
    }
    if (url.includes("/_db/elasticsearch/docs")) {
      return jsonResponse({
        dbId: "docker:es",
        index: "my-index",
        hits: [{ _index: "my-index", _id: "d1", _source: { a: 1 } }],
        totalHits: 1,
      });
    }
    if (url.includes("/_db/elasticsearch/doc?")) {
      return jsonResponse({
        dbId: "docker:es",
        index: "my-index",
        id: "d1",
        found: true,
        source: { a: 1 },
        seqNo: 5,
        primaryTerm: 1,
      });
    }
    if (url.includes("/_db/elasticsearch/write")) {
      writeCalls.push(JSON.parse(String(init?.body)));
      return jsonResponse({ ok: true, id: "d1", result: "updated" });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = origFetch;
  closeOpenDialog();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

async function setupWithDoc(fail?: (url: string) => Error | null) {
  installFetch(fail);
  const view = createElasticsearchExplorer();
  document.body.appendChild(view.sidebarSlot);
  document.body.appendChild(view.el);
  await view.load("docker:es", { index: "my-index" });
  await tick();
  q<HTMLElement>(view.el, ".es-doc-item").click();
  await tick();
  return view;
}

type EsView = ReturnType<typeof createElasticsearchExplorer>;

function failureWithCause(message: string): Error {
  return Object.assign(new Error(message), {
    cause: new Error("network is unreachable"),
  });
}

async function expectReportedFailure(
  operation: string,
  failure: Error,
  shown: () => string | null | undefined,
  consoleError: { mock: { calls: unknown[][] } },
): Promise<void> {
  await waitFor(() => !!shown());
  const text = shown() ?? "";
  expect(text).toContain(failure.message);
  expect(text).toContain("Caused by");
  expect(text).toContain("network is unreachable");
  const logs = consoleError.mock.calls.filter(
    (args) => args[0] === `[code-viewer] Elasticsearch ${operation} failed`,
  );
  expect(logs.length).toBe(1);
  expect(logs[0]?.[logs[0].length - 1]).toBe(failure);
}

// 直す前は err.message だけを出し、console にも cause にも何も残らなかった。
describe("elasticsearch explorer failures", () => {
  test.each([
    {
      operation: "index list",
      fails: (url: string) => url.includes("/_db/elasticsearch/indices"),
      open: async (_view: EsView) => {
        // 開くだけ (load の中で失敗する)。
      },
      where: ".es-index-list .db-pane-error",
    },
    {
      operation: "mapping",
      fails: (url: string) => url.includes("/_db/elasticsearch/mapping"),
      open: async (_view: EsView) => {
        // 開くだけ (index を選んだところで失敗する)。
      },
      where: ".db-detail-pane .db-pane-error",
    },
    {
      operation: "doc list",
      fails: (url: string) => url.includes("/_db/elasticsearch/docs"),
      open: async (_view: EsView) => {
        // 開くだけ (index を選んだところで失敗する)。
      },
      where: ".es-doc-list .db-pane-error",
    },
    {
      operation: "doc",
      fails: (url: string) => url.includes("/_db/elasticsearch/doc?"),
      open: async (view: EsView) => {
        await waitFor(() => !!view.el.querySelector(".es-doc-item"));
        q<HTMLElement>(view.el, ".es-doc-item").click();
      },
      where: ".db-detail-pane .db-pane-error",
    },
  ])("$operation の失敗は理由を cause ごと画面と console に出す", async ({
    operation,
    fails,
    open,
    where,
  }) => {
    const failure = failureWithCause(`${operation} request failed`);
    installFetch((url) => (fails(url) ? failure : null));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const view = createElasticsearchExplorer();
    try {
      document.body.append(view.sidebarSlot, view.el);
      await view.load("docker:es", { index: "my-index" });
      await open(view);
      await expectReportedFailure(
        operation,
        failure,
        () => document.body.querySelector(where)?.textContent,
        consoleError,
      );
    } finally {
      view.dispose();
      document.body.innerHTML = "";
      consoleError.mockRestore();
    }
  });

  test.each([
    {
      operation: "doc write",
      act: async (view: EsView) => {
        q<HTMLButtonElement>(view.el, ".es-doc-actions .db-btn").click();
        await tick();
        q<HTMLButtonElement>(
          view.el,
          ".es-doc-edit-bar .db-btn-primary",
        ).click();
      },
      where: ".es-doc-edit-status",
    },
    {
      operation: "doc delete",
      act: async (view: EsView) => {
        const buttons = view.el.querySelectorAll<HTMLButtonElement>(
          ".es-doc-actions .db-btn",
        );
        buttons[buttons.length - 1].click();
        await tick();
        clickDialogConfirm();
      },
      where: ".db-detail-pane .db-pane-error",
    },
    {
      operation: "doc create",
      act: async (view: EsView) => {
        q<HTMLButtonElement>(view.el, ".es-new-doc-btn").click();
        await tick();
        q<HTMLInputElement>(view.el, ".es-new-doc-id").value = "d2";
        q<HTMLTextAreaElement>(view.el, ".es-doc-edit-textarea").value =
          '{ "b": 9 }';
        q<HTMLButtonElement>(
          view.el,
          ".es-new-doc-form .db-btn-primary",
        ).click();
      },
      where: ".es-new-doc-form .es-doc-edit-status",
    },
  ])("$operation の失敗は理由を cause ごと画面と console に出す", async ({
    operation,
    act,
    where,
  }) => {
    const failure = failureWithCause(`${operation} request failed`);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const view = await setupWithDoc((url) =>
      url.includes("/_db/elasticsearch/write") ? failure : null,
    );
    try {
      await act(view);
      await expectReportedFailure(
        operation,
        failure,
        () => view.el.querySelector(where)?.textContent,
        consoleError,
      );
    } finally {
      view.dispose();
      document.body.innerHTML = "";
      consoleError.mockRestore();
    }
  });
});

// 直す前は日本語の設定でも、件数の札と読み込み中の表示が英語のままだった。
describe("elasticsearch explorer text", () => {
  test.each([
    { language: "en" as const, meta: /^1 docs \/ / },
    { language: "ja" as const, meta: /^1 件 \/ / },
  ])("index の件数の札を表示の言語で描く: $language", async ({
    language,
    meta,
  }) => {
    installFetch();
    const view = createElasticsearchExplorer({
      getText: () => dbText(language),
    });
    document.body.append(view.sidebarSlot, view.el);
    await view.load("docker:es");
    expect(
      view.sidebarSlot.querySelector(".es-index-meta")?.textContent,
    ).toMatch(meta);
    view.dispose();
    document.body.innerHTML = "";
  });

  test("言語を切り替えると件数の札も描き直す", async () => {
    installFetch();
    let language: "en" | "ja" = "en";
    const view = createElasticsearchExplorer({
      getText: () => dbText(language),
    });
    document.body.append(view.sidebarSlot, view.el);
    await view.load("docker:es");
    language = "ja";
    view.localize();
    expect(
      view.sidebarSlot.querySelector(".es-index-meta")?.textContent,
    ).toMatch(/^1 件 \/ /);
    view.dispose();
    document.body.innerHTML = "";
  });

  test("読み込み中の表示を表示の言語で描く", async () => {
    let release: (() => void) | undefined;
    installFetch();
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (String(input).includes("/_db/elasticsearch/mapping")) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return fetchMock(input, init);
    }) as typeof fetch;
    const view = createElasticsearchExplorer({ getText: () => dbText("ja") });
    document.body.append(view.sidebarSlot, view.el);
    const loading = view.load("docker:es", { index: "my-index" });
    await waitFor(() => release !== undefined);
    expect(view.el.querySelector(".db-detail-pane")?.textContent).toContain(
      "マッピングを読み込み中...",
    );
    release?.();
    await loading;
    view.dispose();
    document.body.innerHTML = "";
  });
});

describe("elasticsearch explorer edit UI", () => {
  test("editing a doc posts source with optimistic-lock seqNo/primaryTerm", async () => {
    const view = await setupWithDoc();
    q<HTMLButtonElement>(view.el, ".es-doc-actions .db-btn").click();
    await tick();
    const ta = q<HTMLTextAreaElement>(view.el, ".es-doc-edit-textarea");
    ta.value = '{ "a": 2 }';
    q<HTMLButtonElement>(view.el, ".es-doc-edit-bar .db-btn-primary").click();
    await tick();
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0].index).toBe("my-index");
    expect(writeCalls[0].id).toBe("d1");
    expect(writeCalls[0].seqNo).toBe(5);
    expect(writeCalls[0].primaryTerm).toBe(1);
    expect(writeCalls[0].source).toEqual({ a: 2 });
    view.dispose();
  });

  test("invalid JSON blocks the save (no request sent)", async () => {
    const view = await setupWithDoc();
    q<HTMLButtonElement>(view.el, ".es-doc-actions .db-btn").click();
    await tick();
    const ta = q<HTMLTextAreaElement>(view.el, ".es-doc-edit-textarea");
    ta.value = "{ not json";
    q<HTMLButtonElement>(view.el, ".es-doc-edit-bar .db-btn-primary").click();
    await tick();
    expect(writeCalls.length).toBe(0);
    view.dispose();
  });

  test("deleting a doc posts op=delete after confirm", async () => {
    const view = await setupWithDoc();
    const buttons = view.el.querySelectorAll<HTMLButtonElement>(
      ".es-doc-actions .db-btn",
    );
    buttons[buttons.length - 1].click();
    await tick();
    clickDialogConfirm();
    await tick();
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0].op).toBe("delete");
    expect(writeCalls[0].id).toBe("d1");
    view.dispose();
  });

  test("creating a new doc with an id posts source without seqNo", async () => {
    const view = await setupWithDoc();
    q<HTMLButtonElement>(view.el, ".es-new-doc-btn").click();
    await tick();
    q<HTMLInputElement>(view.el, ".es-new-doc-id").value = "d2";
    q<HTMLTextAreaElement>(view.el, ".es-doc-edit-textarea").value =
      '{ "b": 9 }';
    q<HTMLButtonElement>(view.el, ".es-new-doc-form .db-btn-primary").click();
    await tick();
    const create = writeCalls.find((c) => c.id === "d2");
    expect(create !== undefined).toBeTruthy();
    expect(create?.source).toEqual({ b: 9 });
    expect(create?.seqNo).toBeUndefined();
    // 新規作成は op:"create" を送り、サーバ側で _create により既存 id を弾く。
    expect(create?.op).toBe("create");
    view.dispose();
  });
});
