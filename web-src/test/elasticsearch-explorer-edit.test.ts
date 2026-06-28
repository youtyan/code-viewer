// Elasticsearch エクスプローラの編集 UI を happy-dom で検証する。ドキュメント
// JSON 編集 (楽観ロック付き) / 削除 / 新規作成が正しい body で
// POST /_db/elasticsearch/write を呼ぶことを確認する。
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { clickDialogConfirm, closeOpenDialog } from "./_dialog-helpers";
import { q } from "./_test-helpers";

GlobalRegistrator.register();

const { createElasticsearchExplorer } = await import(
  "../views/database/elasticsearch-explorer"
);

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

function installFetch() {
  writeCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
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

async function setupWithDoc() {
  installFetch();
  const view = createElasticsearchExplorer();
  document.body.appendChild(view.sidebarSlot);
  document.body.appendChild(view.el);
  await view.load("docker:es", { index: "my-index" });
  await tick();
  q<HTMLElement>(view.el, ".es-doc-item").click();
  await tick();
  return view;
}

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
