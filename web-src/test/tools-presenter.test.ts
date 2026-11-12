// Tools の presenter を、表示 (view) を差し替えて確かめる。presenter が view に
// 渡す値と、サーバへの読み書き (モデルの呼び出し) を見る。既定の表示
// (DEFAULT_VIEW) の形は tools-view.test.ts と画面の撮影で確かめる。

import "./_dom";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ToolId } from "../core/tools";
import type { ToolsState } from "../core/types";
import {
  createToolsPresenter,
  type ToolsViewHandle,
} from "../views/tools/tools-presenter";
import type { ToolsViewProps } from "../views/tools/tools-view";
import { flushRenders } from "../views/ui/render-queue";

type Call = { method: string; body: unknown };

let calls: Call[];
let stored: ToolsState;
let patchStatus: number;
let seen: ToolsViewProps[];
let toolChanges: ToolId[];
let presenters: ToolsViewHandle[];
const originalFetch = globalThis.fetch;

function last(): ToolsViewProps {
  flushRenders();
  const props = seen[seen.length - 1];
  if (!props) throw new Error("the view was never drawn");
  return props;
}

function createPresenter(): ToolsViewHandle {
  const presenter = createToolsPresenter(
    {
      $: <T extends Element = HTMLElement>(sel: string) =>
        document.querySelector<T>(sel),
      trackLoad: (promise) => promise,
      getLanguage: () => "en",
      actionHeaders: () => ({ "Content-Type": "application/json" }),
      onToolChange: (tool) => toolChanges.push(tool),
    },
    (props) => {
      seen.push(props);
      return null;
    },
  );
  presenters.push(presenter);
  return presenter;
}

beforeEach(() => {
  calls = [];
  seen = [];
  toolChanges = [];
  presenters = [];
  stored = { version: 1 };
  patchStatus = 200;
  document.body.innerHTML =
    '<div id="tools-sheet-overlay" hidden></div><aside id="tools-sheet" hidden inert></aside>';
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      method,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (method === "PATCH")
      return new Response("sample failure", { status: patchStatus });
    return { ok: true, json: async () => stored } as unknown as Response;
  }) as typeof fetch;
});

afterEach(() => {
  for (const presenter of presenters) presenter.dispose();
  globalThis.fetch = originalFetch;
});

describe("tools presenter", () => {
  test("opening reads the saved drafts and shows the stored tool with its draft", async () => {
    stored = {
      version: 1,
      activeTool: "json",
      drafts: { json: '{"a":1}', markdown: "# note" },
    };
    await createPresenter().open();

    const props = last();
    expect({
      reads: calls.filter((call) => call.method === "GET").length,
      activeTool: props.activeTool,
      drafts: props.drafts,
      refreshed: props.refreshKeys,
      focused: props.focusKeys,
      pinned: props.pinnedStatus,
    }).toEqual({
      reads: 1,
      activeTool: "json",
      drafts: { json: '{"a":1}', markdown: "# note" },
      refreshed: { markdown: 0, mermaid: 0, json: 1 },
      focused: { markdown: 0, mermaid: 0, json: 1 },
      pinned: null,
    });
  });

  test("picking a tool in the view reports it and saves it as the last used tool", async () => {
    const presenter = createPresenter();
    await presenter.open();
    last().onSelectTool("mermaid");
    presenter.close();

    expect({
      activeTool: last().activeTool,
      toolChanges,
      saved: calls.filter((call) => call.method === "PATCH").map((c) => c.body),
    }).toEqual({
      activeTool: "mermaid",
      // 開いたとき (保存値が無いので既定の Markdown) と、選んだとき。
      toolChanges: ["markdown", "mermaid"],
      saved: [{ activeTool: "mermaid", drafts: {} }],
    });
  });

  test("a draft typed in the view is saved when the drawer closes", async () => {
    patchStatus = 200;
    const presenter = createPresenter();
    await presenter.open();
    last().onDraftInput("markdown", "# typed");
    presenter.close();

    const saved = calls.filter((call) => call.method === "PATCH");
    expect(saved[saved.length - 1]?.body).toEqual({
      activeTool: "markdown",
      drafts: { markdown: "# typed" },
    });
  });

  test("a save the server refuses is shown to every tool with its reason", async () => {
    patchStatus = 413;
    const presenter = createPresenter();
    await presenter.open();
    last().onDraftInput("markdown", "# typed");
    presenter.close();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    expect(last().pinnedStatus).toBe(
      "could not save this draft\nError: saving tools drafts (HTTP 413): sample failure",
    );
  });

  test("switching the JSON output format redraws only the JSON result", async () => {
    await createPresenter().open();
    const before = last().refreshKeys;
    last().onJsonFormat("yaml");
    const after = last();

    expect({
      format: after.json.format,
      refreshed: after.refreshKeys,
    }).toEqual({
      format: "yaml",
      refreshed: { ...before, json: before.json + 1 },
    });
  });

  test("minify toggles and redraws the JSON result", async () => {
    await createPresenter().open();
    last().onToggleMinify();

    expect([last().json.minify, last().refreshKeys.json]).toEqual([true, 1]);
  });

  test("changing the language redraws the result of the shown tool", async () => {
    const presenter = createPresenter();
    await presenter.open();
    presenter.localize();

    expect(last().refreshKeys).toEqual({ markdown: 2, mermaid: 0, json: 0 });
  });
});
