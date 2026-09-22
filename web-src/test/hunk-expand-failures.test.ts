// 行の展開 (views/hunk-expand.ts) の失敗は黙らせない。HTTP の失敗・行の無い
// 応答を、展開の帯のすぐ下と console に理由つきで出し、もう一度押して読めたら
// 帯を消す。以前は r.ok を見ずに r.json() し、失敗も行の無い応答も、ボタンが
// 押せる状態に戻るだけで何も残らなかった。
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import type { DiffCardElement, FileMeta } from "../core/types";
import { createHunkExpand } from "../views/hunk-expand";

beforeAll(() => {
  GlobalRegistrator.register();
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
  globalThis.fetch = originalFetch;
  consoleError.mockRestore();
  document.body.innerHTML = "";
});

const file = { path: "src/sample.ts" } as FileMeta;

/** 1 つ目のハンクが 10 行目から始まる、行ごとの表のカード。 */
function mountCard(): DiffCardElement {
  const card = document.createElement("div") as DiffCardElement;
  card.className = "d2h-file-wrapper";
  card.innerHTML = `
    <table class="d2h-diff-table"><tbody>
      <tr>
        <td class="d2h-code-linenumber d2h-info"></td>
        <td class="d2h-info"><div class="d2h-code-line">@@ -10,2 +10,2 @@</div></td>
      </tr>
      <tr><td class="d2h-code-linenumber">10</td><td class="d2h-cntx">sample</td></tr>
    </tbody></table>`;
  document.body.appendChild(card);
  return card;
}

type FakeResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  body: unknown;
};

function stubFetch(respond: (url: string) => FakeResponse): string[] {
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const reply = respond(url);
    return Promise.resolve({
      ok: reply.ok,
      status: reply.status,
      statusText: reply.statusText,
      json: async () => reply.body,
      text: async () =>
        typeof reply.body === "string"
          ? reply.body
          : JSON.stringify(reply.body),
    } as Response);
  }) as typeof fetch;
  return urls;
}

function setup(card: DiffCardElement) {
  createHunkExpand({
    trackLoad: (promise) => promise,
    getServerGeneration: () => 1,
    getToRef: () => "worktree",
    highlightInsertedSpans: () => undefined,
  }).setupHunkExpand(card, file);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function errorTexts(card: Element): string[] {
  return [...card.querySelectorAll(".gdp-expand-error-row .gdp-error")].map(
    (el) => el.textContent || "",
  );
}

test("HTTP の失敗は、操作・状態・本文つきで帯と console に出す", async () => {
  const card = mountCard();
  stubFetch(() => ({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    body: "sample failure body",
  }));
  setup(card);
  await settle();
  // 最後のハンクの後に行があるかを確かめる問い合わせ (10 + 2 = 12 行目)
  const probe = errorTexts(card);
  expect([
    probe.length,
    probe[0]?.includes(
      "checking for lines after the last hunk of src/sample.ts (line 12) at worktree",
    ),
    probe[0]?.includes("HTTP 500 Internal Server Error"),
    probe[0]?.includes("sample failure body"),
  ]).toEqual([1, true, true, true]);

  card.querySelector<HTMLButtonElement>(".gdp-expand-btn")?.click();
  await settle();
  const expand = errorTexts(card);
  expect([
    expand.length,
    expand[0]?.startsWith("Could not load more lines: "),
    expand[0]?.includes("expanding src/sample.ts lines 1-9 at worktree"),
    card.querySelector<HTMLButtonElement>(".gdp-expand-btn")?.disabled,
    consoleError.mock.calls.map((call: unknown[]) => call[0]),
  ]).toEqual([
    1,
    true,
    true,
    false,
    [
      "[code-viewer] checking for lines after the last hunk of src/sample.ts (line 12) at worktree failed",
      "[code-viewer] expanding src/sample.ts lines 1-9 at worktree failed",
    ],
  ]);
});

test("行の無い応答も失敗として出し、読めたら帯を消す", async () => {
  const card = mountCard();
  let lines: string[] | undefined;
  stubFetch(() => ({
    ok: true,
    status: 200,
    statusText: "OK",
    body: lines === undefined ? { generation: 1 } : { generation: 1, lines },
  }));
  setup(card);
  await settle();
  card.querySelector<HTMLButtonElement>(".gdp-expand-btn")?.click();
  await settle();
  expect(
    errorTexts(card).map((text) => text.includes("the response has no lines")),
  ).toEqual([true]);

  lines = ["line one", "line two"];
  card.querySelector<HTMLButtonElement>(".gdp-expand-btn")?.click();
  await settle();
  expect([
    errorTexts(card),
    card.querySelectorAll("tr.gdp-inserted-ctx").length,
  ]).toEqual([[], 2]);
});
