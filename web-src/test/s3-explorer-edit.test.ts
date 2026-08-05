// S3 エクスプローラの編集 UI を happy-dom で検証する。テキストオブジェクトの
// 編集 / 削除 / 新規作成が正しい body で POST /_db/s3/write を呼ぶことを確認する。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { clickDialogConfirm } from "./_dialog-helpers";
import { q } from "./_test-helpers";

GlobalRegistrator.register();

const { createS3Explorer } = await import("../views/database/s3-explorer");

const tick = () => new Promise((r) => setTimeout(r, 30));

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
    if (url.includes("/_db/s3/buckets")) {
      return jsonResponse({ dbId: "docker:s3", buckets: [{ name: "media" }] });
    }
    if (url.includes("/_db/s3/objects") || url.includes("/_db/s3/folder")) {
      return jsonResponse({
        dbId: "docker:s3",
        bucket: "media",
        prefix: "",
        search: "",
        mode: "prefix",
        sort: "key-asc",
        objects: [{ key: "a.txt", sizeBytes: 5 }],
        truncated: false,
        scannedObjects: 1,
        scannedPages: 1,
      });
    }
    if (url.includes("/_db/s3/head")) {
      return jsonResponse({
        dbId: "docker:s3",
        bucket: "media",
        key: "a.txt",
        sizeBytes: 5,
      });
    }
    if (url.includes("/_db/s3/text")) {
      return jsonResponse({
        dbId: "docker:s3",
        bucket: "media",
        key: "a.txt",
        sizeBytes: 5,
        text: "hello",
        truncated: false,
      });
    }
    if (url.includes("/_db/s3/write")) {
      writeCalls.push(JSON.parse(String(init?.body)));
      return jsonResponse({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = origFetch;
  // 各テストの view DOM が body に残ると次テストの querySelector が古い
  // (dispose 済み) view にヒットするのでクリアする (ダイアログも含まれる)。
  document.body.innerHTML = "";
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

async function setupWithObject() {
  installFetch();
  const view = createS3Explorer();
  document.body.appendChild(view.sidebarSlot);
  document.body.appendChild(view.el);
  await view.load("docker:s3", { bucket: "media", key: "a.txt" });
  await tick();
  return view;
}

describe("s3 explorer edit UI", () => {
  test("editing a text object PUTs the new content", async () => {
    const view = await setupWithObject();
    // プレビューヘッダの Edit ボタン (アクション内、Edit ラベル)
    const editBtn = Array.from(
      view.sidebarSlot.ownerDocument.querySelectorAll<HTMLButtonElement>(
        ".s3-preview-actions .db-btn",
      ),
    ).find((b) => b.textContent === "Edit");
    expect(editBtn !== undefined).toBeTruthy();
    editBtn?.click();
    await tick();
    const ta = q<HTMLTextAreaElement>(document.body, ".s3-edit-textarea");
    ta.value = "updated";
    q<HTMLButtonElement>(document.body, ".s3-edit-bar .db-btn-primary").click();
    await tick();
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0].bucket).toBe("media");
    expect(writeCalls[0].key).toBe("a.txt");
    expect(writeCalls[0].content).toBe("updated");
    view.dispose();
  });

  test("deleting an object posts op=delete after confirm", async () => {
    const view = await setupWithObject();
    const delBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".s3-preview-actions .db-btn",
      ),
    ).find((b) => b.textContent === "Delete");
    expect(delBtn !== undefined).toBeTruthy();
    delBtn?.click();
    await tick();
    clickDialogConfirm();
    await tick();
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0].op).toBe("delete");
    expect(writeCalls[0].key).toBe("a.txt");
    view.dispose();
  });

  test("creating a new object posts key + content", async () => {
    const view = await setupWithObject();
    q<HTMLButtonElement>(document.body, ".s3-new-object-btn").click();
    await tick();
    q<HTMLInputElement>(document.body, ".s3-new-object-key").value =
      "folder/new.txt";
    q<HTMLTextAreaElement>(
      document.body,
      ".s3-new-object-form .s3-edit-textarea",
    ).value = "body";
    q<HTMLButtonElement>(
      document.body,
      ".s3-new-object-form .db-btn-primary",
    ).click();
    await tick();
    const create = writeCalls.find((c) => c.key === "folder/new.txt");
    expect(create !== undefined).toBeTruthy();
    expect(create?.content).toBe("body");
    // 新規作成は op:"create" を送り、サーバ側で HEAD により既存を弾く。
    expect(create?.op).toBe("create");
    view.dispose();
  });
});
