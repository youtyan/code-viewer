// Redis エクスプローラの編集 UI を happy-dom で検証する。文字列値の編集 / キー
// 削除 / 新規キー作成が、正しい op で POST /_db/redis/write を呼ぶことを確認する。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import {
  clickDialogCancel,
  clickDialogConfirm,
  closeOpenDialog,
} from "./_dialog-helpers";
import { q, waitFor } from "./_test-helpers";

GlobalRegistrator.register();

const { createRedisExplorer } = await import(
  "../views/database/redis-explorer"
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

function installFetch(
  options: {
    fail?: (url: string) => Error | null;
    value?: Record<string, unknown>;
  } = {},
) {
  writeCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const failure = options.fail?.(url);
    if (failure) throw failure;
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
        value: options.value ?? {
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

async function setupSelectedKey(
  options: Parameters<typeof installFetch>[0] = {},
  getText?: () => ReturnType<typeof dbText>,
) {
  installFetch(options);
  const view = createRedisExplorer({ getText });
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

type RedisView = ReturnType<typeof createRedisExplorer>;

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
    (args) => args[0] === `[code-viewer] Redis ${operation} failed`,
  );
  expect(logs.length).toBe(1);
  expect(logs[0]?.[logs[0].length - 1]).toBe(failure);
}

// 直す前は err.message だけを出し、console にも cause にも何も残らなかった。
describe("redis explorer failures", () => {
  test.each([
    {
      operation: "database list",
      fails: (url: string) => url.includes("/_db/redis/databases"),
      where: ".redis-db-list .db-pane-error",
      clickKey: false,
    },
    {
      operation: "key list",
      fails: (url: string) => url.includes("/_db/redis/keys"),
      where: ".redis-key-list .db-pane-error",
      clickKey: false,
    },
    {
      operation: "value",
      fails: (url: string) => url.includes("/_db/redis/value"),
      where: ".redis-main-pane .db-pane-error",
      clickKey: true,
    },
  ])("$operation の失敗は理由を cause ごと画面と console に出す", async ({
    operation,
    fails,
    where,
    clickKey,
  }) => {
    const failure = failureWithCause(`${operation} request failed`);
    installFetch({ fail: (url) => (fails(url) ? failure : null) });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const view = createRedisExplorer();
    try {
      document.body.append(view.sidebarSlot, view.el);
      await view.load("docker:redis", { dbIndex: 0 });
      if (clickKey) {
        await waitFor(() => !!view.el.querySelector(".redis-key-item"));
        q<HTMLElement>(view.el, ".redis-key-item").click();
      }
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
      operation: "key write",
      act: async (view: RedisView) => {
        q<HTMLButtonElement>(view.el, ".redis-value-actions .db-btn").click();
        await tick();
        q<HTMLButtonElement>(
          view.el,
          ".redis-value-edit-bar .db-btn-primary",
        ).click();
      },
      where: ".redis-value-edit-status",
    },
    {
      operation: "key delete",
      act: async (view: RedisView) => {
        const buttons = view.el.querySelectorAll<HTMLButtonElement>(
          ".redis-value-actions .db-btn",
        );
        buttons[buttons.length - 1].click();
        await tick();
        clickDialogConfirm();
      },
      where: ".redis-main-pane .db-pane-error",
    },
    {
      operation: "key create",
      act: async (view: RedisView) => {
        q<HTMLButtonElement>(view.el, ".redis-new-key-btn").click();
        await tick();
        q<HTMLInputElement>(view.el, ".redis-new-key-name").value = "newkey";
        q<HTMLButtonElement>(
          view.el,
          ".redis-new-key-form .db-btn-primary",
        ).click();
      },
      where: ".redis-new-key-form .redis-value-edit-status",
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
    const view = await setupSelectedKey({
      fail: (url) => (url.includes("/_db/redis/write") ? failure : null),
    });
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

// 直す前は日本語の設定でも、ハッシュの列見出し・切り詰めの注記・読み込み中の
// 表示が英語のままだった。
describe("redis explorer text", () => {
  const truncatedHash = {
    type: "hash",
    fields: [{ field: "sample_field", value: "sample value" }],
    truncated: true,
    total: 3,
  };

  test.each([
    {
      language: "en" as const,
      headers: ["Field", "Value"],
      notice: "(showing 1 of 3 fields, truncated)",
    },
    {
      language: "ja" as const,
      headers: ["フィールド", "値"],
      notice: "(3 フィールドのうち 1 件を表示。残りは省略)",
    },
  ])("ハッシュの見出しと切り詰めの注記を表示の言語で描く: $language", async ({
    language,
    headers,
    notice,
  }) => {
    const view = await setupSelectedKey({ value: truncatedHash }, () =>
      dbText(language),
    );
    expect(
      Array.from(view.el.querySelectorAll(".redis-value-hash-table th")).map(
        (th) => th.textContent,
      ),
    ).toEqual(headers);
    expect(view.el.querySelector(".redis-value-body")?.textContent).toContain(
      notice,
    );
    view.dispose();
  });

  test("言語を切り替えると描いた値も描き直す", async () => {
    let language: "en" | "ja" = "en";
    const view = await setupSelectedKey({ value: truncatedHash }, () =>
      dbText(language),
    );
    language = "ja";
    view.localize();
    expect(
      Array.from(view.el.querySelectorAll(".redis-value-hash-table th")).map(
        (th) => th.textContent,
      ),
    ).toEqual(["フィールド", "値"]);
    view.dispose();
  });

  test("読み込み中の表示を表示の言語で描く", async () => {
    let release: (() => void) | undefined;
    installFetch();
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (String(input).includes("/_db/redis/keys")) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return fetchMock(input, init);
    }) as typeof fetch;
    const view = createRedisExplorer({ getText: () => dbText("ja") });
    document.body.append(view.sidebarSlot, view.el);
    const loading = view.load("docker:redis", { dbIndex: 0 });
    await waitFor(() => release !== undefined);
    expect(view.el.querySelector(".redis-key-list")?.textContent).toBe(
      "キーを読み込み中...",
    );
    release?.();
    await loading;
    view.dispose();
    document.body.innerHTML = "";
  });
});

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
