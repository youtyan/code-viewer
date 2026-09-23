// 画面 (views) が失敗を黙って空・決まり文句にせず、操作・HTTP の状態・本文・
// cause の連鎖まで画面と console に出すこと。直す前は、ここの行はどれも
// 理由を捨てていた (本文の JSON の欄を落とす・4xx/5xx を成功扱いにする・
// err.message だけを出す・catch で何もしない)。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { errorWithCause } from "../core/error-detail";
import { clickDialogConfirm, closeOpenDialog } from "./_dialog-helpers";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const originalFetch = globalThis.fetch;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  globalThis.fetch = originalFetch;
  closeOpenDialog();
  document.body.replaceChildren();
});

/** promise チェーンを進める。実時間は待たない。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("responseFailure keeps every field the server sent", () => {
  test.each([
    {
      name: "only a reason: the reason alone",
      body: '{"error":"sample reason"}',
      status: 409,
      statusText: "Conflict",
      message: "sample op (HTTP 409 Conflict): sample reason",
    },
    {
      name: "a reason and a code: both",
      body: '{"error":"sample reason","code":"sample_code"}',
      status: 409,
      statusText: "Conflict",
      message: "sample op (HTTP 409 Conflict): sample reason (sample_code)",
    },
    {
      name: "more fields than a reason and a code: the whole body",
      body: '{"error":"sample reason","code":"sample_code","path":"sample/path"}',
      status: 500,
      statusText: "Internal Server Error",
      message:
        'sample op (HTTP 500 Internal Server Error): {"error":"sample reason","code":"sample_code","path":"sample/path"}',
    },
    {
      name: "a body that only starts like JSON: the whole body",
      body: "{sample broken",
      status: 502,
      statusText: "Bad Gateway",
      message: "sample op (HTTP 502 Bad Gateway): {sample broken",
    },
    {
      name: "plain text: the whole body",
      body: "sample plain failure",
      status: 500,
      statusText: "",
      message: "sample op (HTTP 500): sample plain failure",
    },
    {
      name: "no body: the status alone",
      body: "",
      status: 503,
      statusText: "Service Unavailable",
      message: "sample op (HTTP 503 Service Unavailable)",
    },
  ])("$name", async ({ body, status, statusText, message }) => {
    const { responseFailure } = await import("../views/agents/accounts-client");
    const failure = await responseFailure(
      new Response(body, { status, statusText }),
      "sample op",
    );
    expect(failure.message).toBe(message);
  });
});

describe("a dialog whose submit fails", () => {
  test("shows the whole cause chain and logs the error", async () => {
    const { showFormDialog } = await import("../views/ui-dialog");
    const failure = errorWithCause(
      "sample save failed",
      new TypeError("sample disk unavailable"),
    );
    const body = document.createElement("div");
    void showFormDialog({
      body,
      submit: () => Promise.reject(failure),
    });
    await settle();

    clickDialogConfirm();
    await settle();

    expect([
      document.querySelector(".gdp-dialog-error")?.textContent,
      consoleError.mock.calls,
    ]).toEqual([
      "Error: sample save failed\nCaused by: TypeError: sample disk unavailable",
      [["[code-viewer] dialog submit failed", failure]],
    ]);
  });
});

describe("line reference pill copy failures", () => {
  test.each([
    {
      name: "the reference copy",
      button: "#line-ref-pill-copy",
      title:
        "Error: copying the line reference failed\nCaused by: NotAllowedError: sample clipboard denied",
    },
    {
      name: "the GitHub link copy",
      button: "#line-ref-pill-github-copy",
      title:
        "Error: copying the GitHub link failed\nCaused by: NotAllowedError: sample clipboard denied",
    },
  ])("$name puts the reason on the button", async ({ button, title }) => {
    const { createLineRefPill } = await import("../views/line-ref-pill");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(
            new DOMException("sample clipboard denied", "NotAllowedError"),
          ),
      },
    });
    const pill = createLineRefPill({
      onClose() {
        /* noop */
      },
      githubUrlForSelection: () =>
        "https://github.com/example/sample/blob/main/src/index.ts#L1",
      copyReferenceLabel: () => "Copy AI reference",
      lineCountLabel: (count) => `${count} lines`,
      githubOpenTitle: () => "Open selected lines on GitHub",
      githubCopyTitle: () => "Copy GitHub link",
    });
    pill.show("src/index.ts", 1, 1);
    const target = document.querySelector<HTMLButtonElement>(button);

    target?.click();
    await settle();

    expect([
      target?.classList.contains("failed"),
      target?.title,
      consoleError.mock.calls.length,
    ]).toEqual([true, title, 1]);
  });
});

describe("a tools pane whose render throws", () => {
  test("shows the whole cause chain in the status line and its title", async () => {
    const { createScratchpadPane } = await import(
      "../views/tools/scratchpad-pane"
    );
    const { toolsText } = await import("../views/tools/i18n");
    const failure = errorWithCause(
      "sample render failed",
      new RangeError("sample limit"),
    );
    const pane = createScratchpadPane(toolsText("en"), "Output", "Input", {
      toolClassName: "tools-pane-test",
      initialText: "sample input",
      onInput: () => undefined,
      render: () => Promise.reject(failure),
    });
    document.body.replaceChildren(pane.el);

    pane.refresh();
    await settle();

    const status = pane.el.querySelector<HTMLElement>(".tools-pane-status");
    expect([
      status?.textContent,
      status?.title,
      consoleError.mock.calls,
    ]).toEqual([
      "Error: sample render failed\nCaused by: RangeError: sample limit",
      "Error: sample render failed\nCaused by: RangeError: sample limit",
      [["[code-viewer] tools render failed", failure]],
    ]);
  });
});

describe("snapshot view failures", () => {
  function mountSnapshotView(
    respond: (url: string, init?: RequestInit) => Response,
  ) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      respond(String(input), init)) as typeof fetch;
    return import("../views/database/snapshot-view").then(
      ({ createSnapshotView }) => {
        const view = createSnapshotView({
          getDbId: () => "sample.db",
          getSchema: () => null,
          getTables: () => [
            { name: "sample_table", type: "table", rowCount: 1 },
          ],
        });
        document.body.replaceChildren(view.el);
        return view;
      },
    );
  }

  test("a list that cannot be read shows why above the list", async () => {
    const view = await mountSnapshotView(
      () => new Response("sample list failure", { status: 500 }),
    );

    view.refresh();
    await settle();

    expect(
      view.el.querySelector(".db-snapshot-left-pane > [data-snapshot-failure]")
        ?.textContent,
    ).toBe("Error: failed to list snapshots (HTTP 500): sample list failure");
    view.dispose();
  });

  test("a rejected create keeps the selector open with the reason", async () => {
    const posts: string[] = [];
    const view = await mountSnapshotView((url, init) => {
      if (init?.method === "POST") {
        posts.push(url);
        return new Response("sample create failure", { status: 500 });
      }
      return new Response(JSON.stringify({ snapshots: [] }), { status: 200 });
    });
    view.el
      .querySelector<HTMLButtonElement>(".db-snapshot-create-btn")
      ?.click();
    view.el
      .querySelector<HTMLButtonElement>(".db-snapshot-select-actions button")
      ?.click();

    view.el
      .querySelector<HTMLButtonElement>(".db-snapshot-confirm-btn")
      ?.click();
    await settle();

    const selector = view.el.querySelector<HTMLElement>(
      ".db-snapshot-table-selector",
    );
    expect([
      posts.length,
      selector?.hidden,
      selector?.querySelector(":scope > [data-snapshot-failure]")?.textContent,
    ]).toEqual([
      1,
      false,
      "Error: failed to create snapshot (HTTP 500): sample create failure",
    ]);
    view.dispose();
  });

  test("a refused cancel stops showing 'cancelling' and says why", async () => {
    const view = await mountSnapshotView((_url, init) =>
      init?.method === "POST"
        ? new Response("sample cancel failure", { status: 409 })
        : new Response(JSON.stringify({ snapshots: [] }), { status: 200 }),
    );
    view.handleSse(
      JSON.stringify({
        action: "started",
        dbId: "sample.db",
        id: "sample-job",
        total: 2,
      }),
    );

    view.el
      .querySelector<HTMLButtonElement>(".db-snapshot-job-cancel-btn")
      ?.click();
    await settle();

    const cancel = view.el.querySelector<HTMLButtonElement>(
      ".db-snapshot-job-cancel-btn",
    );
    expect([
      cancel?.disabled,
      view.el.querySelector(".db-snapshot-left-pane > [data-snapshot-failure]")
        ?.textContent,
    ]).toEqual([
      false,
      "Error: failed to cancel snapshot (HTTP 409): sample cancel failure",
    ]);
    view.dispose();
  });

  test("an event that is not JSON is logged, not dropped silently", async () => {
    const view = await mountSnapshotView(
      () => new Response(JSON.stringify({ snapshots: [] }), { status: 200 }),
    );

    view.handleSse("{sample broken");

    expect(consoleError.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["[code-viewer] snapshot event is not JSON", "{sample broken"],
    ]);
    view.dispose();
  });
});

describe("deleting a datastore connection", () => {
  test("an unreadable response does not pass for 'credentials removed'", async () => {
    const { deleteDatastoreConnectionFromUi } = await import(
      "../views/database/connection-dialog"
    );
    globalThis.fetch = (async () =>
      new Response("sample not json", { status: 200 })) as typeof fetch;
    const deleting = deleteDatastoreConnectionFromUi(
      { trackLoad: (promise) => promise, language: "en" },
      "sample-connection",
    );
    await settle();

    clickDialogConfirm();

    await expect(deleting).rejects.toThrow(
      "the connection was deleted, but the response did not say whether its keychain credentials were removed",
    );
  });
});
