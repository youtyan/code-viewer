import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import type { ToolId } from "../core/tools";
import type { ToolsState } from "../core/types";
import {
  createToolsView,
  type ToolsViewHandle,
} from "../views/tools/tools-view";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

type PatchCall = { url: string; body: unknown; keepalive: boolean };

let storedState: ToolsState;
let patches: PatchCall[];
let closeRequests: number;
let toolChanges: ToolId[];
// グローバルの fetch を差し替えるので、必ず同じテスト内で戻す。持ち越すと
// 同一プロセスで動く他のテストファイル (実 HTTP を叩くもの) を巻き込む。
let originalFetch: typeof fetch | null = null;
let deferGet = false;
let resolveGet: ((state: ToolsState) => void) | null = null;
let patchFails = false;
let deferPatch = false;
let resolvePatch: (() => void) | null = null;
/** null 以外なら、その HTTP ステータスで PATCH を失敗させる。 */
let patchStatus: number | null = null;
let views: ToolsViewHandle[] = [];
/** PATCH ごとの AbortSignal。打ち切られたかを見るのに使う。 */
let patchSignals: (AbortSignal | undefined)[] = [];
let getCalls = 0;
let getFails = false;

function installFixtureDom(): void {
  document.body.className = "";
  document.body.innerHTML = [
    '<div id="tools-sheet-overlay" hidden aria-hidden="true"></div>',
    '<aside id="tools-sheet" hidden aria-hidden="true" inert></aside>',
  ].join("");
}

function jsonResponse(state: ToolsState): Response {
  return { ok: true, json: async () => state } as unknown as Response;
}

function installFetchStub(): void {
  originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "PATCH") {
      patches.push({
        url,
        body: JSON.parse(String(init.body)),
        keepalive: init.keepalive === true,
      });
      patchSignals.push(init.signal ?? undefined);
      if (patchStatus !== null) {
        return Promise.resolve({
          ok: false,
          status: patchStatus,
        } as unknown as Response);
      }
      if (deferPatch) {
        return new Promise<Response>((resolve) => {
          resolvePatch = () => resolve(jsonResponse(storedState));
        });
      }
      return patchFails
        ? Promise.reject(new Error("aborted"))
        : Promise.resolve(jsonResponse(storedState));
    }
    getCalls += 1;
    if (getFails)
      return Promise.resolve({ ok: false, status: 500 } as unknown as Response);
    // deferred のときは resolveGet を呼ぶまで読み込みが終わらない。読み込み中
    // に起きた操作 (入力・閉じる) との競合を組み立てるために使う。
    if (deferGet) {
      return new Promise<Response>((resolve) => {
        resolveGet = (state) => resolve(jsonResponse(state));
      });
    }
    return Promise.resolve(jsonResponse(storedState));
  }) as typeof fetch;
}

/** promise チェーンを進める。実時間は待たない。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function createView(): ToolsViewHandle {
  const view = createToolsView({
    $: <T extends Element = HTMLElement>(sel: string) =>
      document.querySelector<T>(sel),
    trackLoad: (promise) => promise,
    getLanguage: () => "en",
    actionHeaders: () => ({ "Content-Type": "application/json" }),
    onCloseRequest: () => {
      closeRequests += 1;
    },
    onToolChange: (tool) => {
      toolChanges.push(tool);
    },
  });
  // beforeunload リスナが残ると、後続テストの離脱でも古い view が保存を
  // 走らせてしまう。テストごとに必ず片付ける。
  views.push(view);
  return view;
}

// ai-dup-check: allow -- ok:同型の "querySelector して無ければ throw" だが、
// 対象がこのテスト専用のドロワー要素なのでダイアログ用ヘルパとは共有しない。
function sheet(): HTMLElement {
  const el = document.querySelector<HTMLElement>("#tools-sheet");
  if (!el) throw new Error("missing #tools-sheet");
  return el;
}

function tabLabels(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(".tools-tabs button"),
  ).map((button) => button.textContent ?? "");
}

function activeTabLabel(): string {
  const active = document.querySelector<HTMLButtonElement>(
    ".tools-tabs button.active",
  );
  return active?.textContent ?? "";
}

function visiblePaneClasses(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".tools-pane"))
    .filter((pane) => !pane.hidden)
    .map((pane) => pane.className);
}

function statusFor(tool: ToolId): string {
  return (
    document.querySelector<HTMLElement>(
      `.tools-pane-${tool} .tools-pane-status`,
    )?.textContent ?? ""
  );
}

function textareaFor(tool: ToolId): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>(
    `.tools-pane-${tool} .tools-textarea`,
  );
  if (!el) throw new Error(`missing textarea for ${tool}`);
  return el;
}

beforeEach(() => {
  storedState = { version: 1 };
  patches = [];
  closeRequests = 0;
  toolChanges = [];
  deferGet = false;
  resolveGet = null;
  patchFails = false;
  deferPatch = false;
  resolvePatch = null;
  patchStatus = null;
  patchSignals = [];
  getCalls = 0;
  getFails = false;
  installFixtureDom();
  installFetchStub();
});

afterEach(() => {
  for (const view of views) view.dispose();
  views = [];
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = null;
});

describe("tools overlay shell", () => {
  test("opening reveals the drawer and its overlay", async () => {
    const view = createView();
    await view.open();

    expect(sheet().hidden).toBe(false);
    expect(sheet().hasAttribute("inert")).toBe(false);
    expect(sheet().getAttribute("aria-hidden")).toBe("false");
    const overlay = document.querySelector<HTMLElement>("#tools-sheet-overlay");
    expect(overlay?.hidden).toBe(false);
    expect(document.body.classList.contains("tools-sheet-open")).toBe(true);
    expect(view.isOpen()).toBe(true);
  });

  test("closing hides the drawer and makes it unfocusable", async () => {
    const view = createView();
    await view.open();
    view.close();

    expect(sheet().hidden).toBe(true);
    expect(sheet().hasAttribute("inert")).toBe(true);
    expect(sheet().getAttribute("aria-hidden")).toBe("true");
    expect(
      document.querySelector<HTMLElement>("#tools-sheet-overlay")?.hidden,
    ).toBe(true);
    expect(document.body.classList.contains("tools-sheet-open")).toBe(false);
    expect(view.isOpen()).toBe(false);
  });

  test("shows one tab per tool", async () => {
    await createView().open();
    expect(tabLabels()).toEqual(["Markdown", "Mermaid", "JSON / YAML"]);
  });

  test("the close button asks the host to close", async () => {
    await createView().open();
    document.querySelector<HTMLButtonElement>(".tools-close")?.click();
    expect(closeRequests).toBe(1);
  });
});

describe("tools overlay tool selection", () => {
  test("opens the markdown tool when nothing was stored", async () => {
    const view = createView();
    await view.open();

    expect(view.getActiveTool()).toBe("markdown");
    expect(activeTabLabel()).toBe("Markdown");
    expect(visiblePaneClasses()).toEqual(["tools-pane tools-pane-markdown"]);
  });

  test("reopens the tool that was last used", async () => {
    storedState = { version: 1, activeTool: "json" };
    const view = createView();
    await view.open();

    expect(view.getActiveTool()).toBe("json");
    expect(activeTabLabel()).toBe("JSON / YAML");
    // URL 側にツールが無い状態で開いたので、復元したツールを通知する。
    expect(toolChanges).toEqual(["json"]);
  });

  test("an explicit tool wins over the stored one and is not echoed back", async () => {
    storedState = { version: 1, activeTool: "json" };
    const view = createView();
    await view.open("mermaid");

    expect(view.getActiveTool()).toBe("mermaid");
    expect(activeTabLabel()).toBe("Mermaid");
    expect(visiblePaneClasses()).toEqual(["tools-pane tools-pane-mermaid"]);
    // URL 由来の指定なので、URL を書き直させる通知は要らない。
    expect(toolChanges).toEqual([]);
  });

  test("clicking a tab swaps the visible pane and reports the change", async () => {
    const view = createView();
    await view.open();
    const tabs =
      document.querySelectorAll<HTMLButtonElement>(".tools-tabs button");
    tabs[1].click();

    expect(view.getActiveTool()).toBe("mermaid");
    expect(visiblePaneClasses()).toEqual(["tools-pane tools-pane-mermaid"]);
    // 引数なしの open() が既定タブを通知し、その後クリック分が続く。
    expect(toolChanges).toEqual(["markdown", "mermaid"]);
  });
});

describe("tools overlay drafts", () => {
  test("restores stored drafts into each tool", async () => {
    storedState = {
      version: 1,
      drafts: { markdown: "# stored", json: '{"a":1}' },
    };
    await createView().open();

    expect(textareaFor("markdown").value).toBe("# stored");
    expect(textareaFor("json").value).toBe('{"a":1}');
    expect(textareaFor("mermaid").value).toBe("");
  });

  test("applies a stored drawer width", async () => {
    storedState = { version: 1, width: 900 };
    await createView().open();
    expect(sheet().style.getPropertyValue("--tools-sheet-width")).toBe("900px");
  });

  test("closing flushes an edit that was still waiting to be saved", async () => {
    const view = createView();
    await view.open();
    const input = textareaFor("markdown");
    input.value = "# typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // デバウンス待ちの状態で閉じても、書きかけが失われないこと。
    expect(patches).toEqual([]);

    view.close();

    expect(patches.length).toBe(1);
    expect(patches[0].url).toBe("/_state/tools");
    expect(patches[0].body).toEqual({
      activeTool: "markdown",
      drafts: { markdown: "# typed" },
    });
  });

  test("a draft typed while loading survives the restore", async () => {
    deferGet = true;
    const view = createView();
    const opening = view.open();
    const input = textareaFor("markdown");
    input.value = "typed while loading";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    resolveGet?.({ version: 1, drafts: { markdown: "stored" } });
    await opening;

    expect(input.value).toBe("typed while loading");
  });

  test("typing while loading keeps you on the tool you were typing into", async () => {
    deferGet = true;
    const view = createView();
    const opening = view.open();
    const input = textareaFor("markdown");
    input.value = "typed while loading";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    resolveGet?.({ version: 1, activeTool: "json" });
    await opening;

    // 書いている途中で保存値のタブへ連れて行かれない。
    expect(view.getActiveTool()).toBe("markdown");
    expect(input.value).toBe("typed while loading");
  });

  test("closing while loading leaves the drawer closed and quiet", async () => {
    deferGet = true;
    const view = createView();
    const opening = view.open();
    view.close();
    resolveGet?.({ version: 1, activeTool: "json" });
    await opening;

    expect(view.isOpen()).toBe(false);
    // 閉じたあとに ?tools= を復活させない。
    expect(toolChanges).toEqual([]);
  });

  test("a save that fails is sent again on the next flush", async () => {
    const view = createView();
    await view.open();
    const input = textareaFor("markdown");
    input.value = "# typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    patchFails = true;
    view.close();
    await settle();
    expect(patches.length).toBe(1);

    // 失敗した分は書きかけとして残っているので、次の保存機会で送り直される。
    patchFails = false;
    await view.open();
    view.close();
    await settle();
    expect(patches.length).toBe(2);
    expect(patches[1].body).toEqual({
      activeTool: "markdown",
      drafts: { markdown: "# typed" },
    });
  });

  test("a successful save is not repeated when nothing changed", async () => {
    const view = createView();
    await view.open();
    const input = textareaFor("markdown");
    input.value = "# typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    view.close();
    await settle();
    expect(patches.length).toBe(1);

    await view.open();
    view.close();
    await settle();
    expect(patches.length).toBe(1);
  });

  test("keeps a tab picked while loading instead of restoring the stored one", async () => {
    deferGet = true;
    const view = createView();
    const opening = view.open();
    document
      .querySelectorAll<HTMLButtonElement>(".tools-tabs button")[1]
      .click();
    resolveGet?.({ version: 1, activeTool: "json" });
    await opening;

    expect(view.getActiveTool()).toBe("mermaid");
  });

  test("keeps a width dragged while loading instead of restoring the stored one", async () => {
    deferGet = true;
    const view = createView();
    const opening = view.open();
    const handle = sheet().querySelector<HTMLElement>(".tools-sheet-resizer");
    handle?.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX: 500,
      }),
    );
    handle?.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX: 200,
      }),
    );
    const dragged = sheet().style.getPropertyValue("--tools-sheet-width");
    resolveGet?.({ version: 1, width: 700 });
    await opening;

    expect(dragged).not.toBe("");
    expect(sheet().style.getPropertyValue("--tools-sheet-width")).toBe(dragged);
  });

  test("does not start a second save while one is still in flight", async () => {
    deferPatch = true;
    const view = createView();
    await view.open();
    const input = textareaFor("markdown");
    input.value = "first";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    view.close();
    await settle();
    expect(patches.length).toBe(1);

    // 送信中に増えた変更は溜めておき、完了してから 1 本だけ送る。
    input.value = "second";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await view.open();
    view.close();
    await settle();
    expect(patches.length).toBe(1);

    resolvePatch?.();
    await settle();
    expect(patches.length).toBe(2);
    expect(patches[1].body).toEqual({
      activeTool: "markdown",
      drafts: { markdown: "second" },
    });
  });

  test("gives up on a rejected save instead of retrying forever", async () => {
    patchStatus = 413;
    const view = createView();
    await view.open();
    const input = textareaFor("markdown");
    input.value = "too big";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    view.close();
    await settle();
    expect(patches.length).toBe(1);

    // 4xx は送り直しても通らないので、書きかけを抱えたまま再送し続けない。
    patchStatus = null;
    await view.open();
    view.close();
    await settle();
    expect(patches.length).toBe(1);
  });

  test("re-sends an in-flight save with keepalive when the page goes away", async () => {
    deferPatch = true;
    const view = createView();
    await view.open();
    const input = textareaFor("markdown");
    input.value = "# typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    view.close();
    await settle();
    expect(patches.length).toBe(1);
    expect(patches[0].keepalive).toBe(false);

    window.dispatchEvent(new Event("beforeunload"));
    await settle();

    expect(patches.length).toBe(2);
    expect(patches[1].keepalive).toBe(true);
    expect(patches[1].body).toEqual({
      activeTool: "markdown",
      drafts: { markdown: "# typed" },
    });
  });

  test("aborts the in-flight save before sending the keepalive one", async () => {
    deferPatch = true;
    const view = createView();
    await view.open();
    const input = textareaFor("markdown");
    input.value = "first";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    view.close();
    await settle();
    expect(patches.length).toBe(1);
    expect(patchSignals[0]?.aborted).toBe(false);

    window.dispatchEvent(new Event("beforeunload"));
    await settle();

    // 2 本を並走させず、古いほうを打ち切ってから最新を送る。
    expect(patchSignals[0]?.aborted).toBe(true);
    expect(patches.length).toBe(2);
    expect(patches[1].keepalive).toBe(true);
  });

  test("drops keepalive when the body is over the 64 KiB limit", async () => {
    const view = createView();
    await view.open();
    const input = textareaFor("markdown");
    input.value = "x".repeat(70 * 1024);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    window.dispatchEvent(new Event("beforeunload"));
    await settle();

    expect(patches.length).toBe(1);
    // keepalive では通らないサイズなので、通常送信に落とす。
    expect(patches[0].keepalive).toBe(false);
  });

  test("clears the save error once a later save succeeds", async () => {
    patchStatus = 413;
    const view = createView();
    await view.open();
    const input = textareaFor("markdown");
    input.value = "too big";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    view.close();
    await settle();
    expect(statusFor("markdown")).toBe("could not save this draft");

    patchStatus = null;
    await view.open();
    input.value = "small";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    view.close();
    await settle();

    expect(statusFor("markdown")).toBe("");
  });

  test("re-reads the saved state when closing interrupted the previous read", async () => {
    deferGet = true;
    const view = createView();
    const opening = view.open();
    view.close();
    resolveGet?.({ version: 1, drafts: { markdown: "stored" } });
    await opening;
    expect(getCalls).toBe(1);

    // 中断された読み込みは「読めた」ことにしない。開き直せば読みに行く。
    deferGet = false;
    storedState = { version: 1, drafts: { markdown: "stored" } };
    await view.open();

    expect(getCalls).toBe(2);
    expect(textareaFor("markdown").value).toBe("stored");
  });

  test("a save that fails after dispose does not schedule a retry", async () => {
    deferPatch = true;
    const view = createView();
    await view.open();
    const input = textareaFor("markdown");
    input.value = "# typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    view.close();
    await settle();
    expect(patches.length).toBe(1);

    view.dispose();
    // dispose が送信中の保存を打ち切る。その失敗で再送が始まらないこと。
    expect(patchSignals[0]?.aborted).toBe(true);
    await settle();

    expect(patches.length).toBe(1);
  });

  test("remembers a tool opened straight from the URL", async () => {
    storedState = { version: 1, activeTool: "json" };
    const view = createView();
    await view.open("mermaid");
    view.close();
    await settle();

    // URL 由来で開いた分も「最後に使ったツール」として残る。
    expect(patches.length).toBe(1);
    expect((patches[0].body as { activeTool: string }).activeTool).toBe(
      "mermaid",
    );
  });

  test("keeps reading the saved state after a failed load", async () => {
    getFails = true;
    const view = createView();
    await view.open();
    expect(getCalls).toBe(1);
    expect(statusFor("markdown")).toBe("could not load saved drafts");

    // 読めていないので「空だった」とは扱わない。開き直せば読みに行く。
    getFails = false;
    storedState = { version: 1, drafts: { markdown: "stored" } };
    view.close();
    await view.open();

    expect(getCalls).toBe(2);
    expect(textareaFor("markdown").value).toBe("stored");
  });

  test("stops retrying a save that keeps failing", async () => {
    patchFails = true;
    const view = createView();
    await view.open();
    const input = textareaFor("markdown");
    input.value = "# typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    view.close();
    await settle();
    expect(patches.length).toBe(1);

    // 最初の 1 回 + 再送 3 回で打ち切る。以降は保存機会が来ても投げない。
    for (let i = 0; i < 6; i += 1) {
      await view.open();
      view.close();
      await settle();
    }
    expect(patches.length).toBe(4);
    expect(statusFor("markdown")).toBe("could not save this draft");

    // ユーザーが何か変えたら、また送りに行く。
    input.value = "# typed again";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    patchFails = false;
    view.close();
    await settle();
    expect(patches.length).toBe(5);
  });

  test("keeps showing the load failure even after a save succeeds", async () => {
    getFails = true;
    const view = createView();
    await view.open();
    expect(statusFor("markdown")).toBe("could not load saved drafts");

    // 保存が通っても、読めていないという状況は変わらない。
    const input = textareaFor("markdown");
    input.value = "typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    view.close();
    await settle();
    expect(patches.length).toBe(1);

    expect(statusFor("markdown")).toBe("could not load saved drafts");
  });

  test("keeps showing the save failure across tab switches and redraws", async () => {
    patchStatus = 413;
    const view = createView();
    await view.open();
    const input = textareaFor("markdown");
    input.value = "too big";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    view.close();
    await settle();
    expect(statusFor("markdown")).toBe("could not save this draft");

    await view.open();
    document
      .querySelectorAll<HTMLButtonElement>(".tools-tabs button")[1]
      .click();

    // 別タブに移っても、保存できていないことは出したままにする。
    expect(statusFor("mermaid")).toBe("could not save this draft");
  });

  test("re-renders the pinned failure in the new language", async () => {
    getFails = true;
    let language: "en" | "ja" = "en";
    const view = createToolsView({
      $: <T extends Element = HTMLElement>(sel: string) =>
        document.querySelector<T>(sel),
      trackLoad: (promise) => promise,
      getLanguage: () => language,
      actionHeaders: () => ({ "Content-Type": "application/json" }),
    });
    views.push(view);
    await view.open();
    expect(statusFor("markdown")).toBe("could not load saved drafts");

    language = "ja";
    view.localize();

    expect(statusFor("markdown")).toBe("保存済みの下書きを読み出せません");
  });

  test("clearing the input empties that draft", async () => {
    storedState = { version: 1, drafts: { markdown: "# stored" } };
    const view = createView();
    await view.open();
    document
      .querySelector<HTMLButtonElement>(
        ".tools-pane-markdown .tools-pane-action",
      )
      ?.click();

    expect(textareaFor("markdown").value).toBe("");
    view.close();
    expect(patches[0]?.body).toEqual({
      activeTool: "markdown",
      drafts: { markdown: "" },
    });
  });
});
