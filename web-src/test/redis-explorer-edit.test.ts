// Redis エクスプローラの編集 UI を happy-dom で検証する。文字列値の編集 / キー
// 削除 / 新規キー作成が、正しい op で POST /_db/redis/write を呼ぶことを確認する。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import {
  clickDialogCancel,
  clickDialogConfirm,
  closeOpenDialog,
} from "./_dialog-helpers";
import { q } from "./_test-helpers";

GlobalRegistrator.register();

const { createRedisExplorer } = await import(
  "../views/database/redis-explorer"
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
    if (url.includes("/_db/redis/databases")) {
      return jsonResponse({
        dbId: "docker:redis",
        databases: [{ index: 0, keyCount: 1 }],
      });
    }
    if (url.includes("/_db/redis/keys")) {
      return jsonResponse({
        dbId: "docker:redis",
        dbIndex: 0,
        keys: [{ name: "foo", type: "string" }],
        nextCursor: "0",
      });
    }
    if (url.includes("/_db/redis/value")) {
      return jsonResponse({
        dbId: "docker:redis",
        dbIndex: 0,
        key: "foo",
        value: {
          type: "string",
          value: "hello",
          truncated: false,
          fullSize: 5,
        },
      });
    }
    if (url.includes("/_db/redis/write")) {
      writeCalls.push(JSON.parse(String(init?.body)));
      return jsonResponse({ ok: true });
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

async function setupSelectedKey() {
  installFetch();
  const view = createRedisExplorer();
  document.body.appendChild(view.sidebarSlot);
  document.body.appendChild(view.el);
  await view.load("docker:redis", { dbIndex: 0 });
  await tick();
  // キー行をクリックして value を表示する
  const keyRow = q<HTMLElement>(view.el, ".redis-key-item");
  keyRow.click();
  await tick();
  return view;
}

describe("redis explorer edit UI", () => {
  test("editing a string value posts op=setString", async () => {
    const view = await setupSelectedKey();
    // Edit ボタン (アクション内の最初の db-btn) をクリック
    const editBtn = q<HTMLButtonElement>(
      view.el,
      ".redis-value-actions .db-btn",
    );
    editBtn.click();
    await tick();
    const ta = q<HTMLTextAreaElement>(view.el, ".redis-value-edit-textarea");
    ta.value = "world";
    q<HTMLButtonElement>(
      view.el,
      ".redis-value-edit-bar .db-btn-primary",
    ).click();
    await tick();
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0].op).toBe("setString");
    expect(writeCalls[0].key).toBe("foo");
    expect(writeCalls[0].value).toBe("world");
    expect(writeCalls[0].dbIndex).toBe(0);
    view.dispose();
  });

  test("deleting a key posts op=delete after confirm", async () => {
    const view = await setupSelectedKey();
    const buttons = view.el.querySelectorAll<HTMLButtonElement>(
      ".redis-value-actions .db-btn",
    );
    // 最後のアクションが Delete
    buttons[buttons.length - 1].click();
    await tick();
    clickDialogConfirm();
    await tick();
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0].op).toBe("delete");
    expect(writeCalls[0].key).toBe("foo");
    view.dispose();
  });

  test("delete is cancelled when the dialog is cancelled", async () => {
    const view = await setupSelectedKey();
    const buttons = view.el.querySelectorAll<HTMLButtonElement>(
      ".redis-value-actions .db-btn",
    );
    buttons[buttons.length - 1].click();
    await tick();
    clickDialogCancel();
    await tick();
    expect(writeCalls.length).toBe(0);
    view.dispose();
  });

  test("creating a new string key posts op=createString", async () => {
    const view = await setupSelectedKey();
    q<HTMLButtonElement>(view.el, ".redis-new-key-btn").click();
    await tick();
    q<HTMLInputElement>(view.el, ".redis-new-key-name").value = "newkey";
    q<HTMLTextAreaElement>(view.el, ".redis-new-key-value").value = "val";
    q<HTMLButtonElement>(
      view.el,
      ".redis-new-key-form .db-btn-primary",
    ).click();
    await tick();
    const create = writeCalls.find((c) => c.op === "createString");
    expect(create !== undefined).toBeTruthy();
    expect(create?.key).toBe("newkey");
    expect(create?.value).toBe("val");
    view.dispose();
  });
});
