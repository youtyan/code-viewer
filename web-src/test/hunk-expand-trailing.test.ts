// 最後のハンクの後ろの「下へ広げる」行 (views/hunk-expand.ts)。
// - 削除したファイルには新しい側が無いので、後ろを問い合わせない (作業ツリーに
//   無いファイルを問い合わせて、エラーの行が出ていた)
// - 最後の文脈が 3 行ちょうど (row_basis.tail_more) なら、描いた時点で行を置く
//   (カードの見積もりにこの行が入っている。後から足すと下のカードが下がる)。
//   問い合わせで行が無いと分かったら外す
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { DiffCardElement, FileMeta } from "../core/types";
import { createHunkExpand } from "../views/hunk-expand";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

/** 1 ハンクだけの、行ごとの表のカード。 */
function mountCard(hunkHeader: string): DiffCardElement {
  const card = document.createElement("div") as DiffCardElement;
  card.className = "d2h-file-wrapper";
  card.innerHTML = `
    <table class="d2h-diff-table"><tbody>
      <tr>
        <td class="d2h-code-linenumber d2h-info"></td>
        <td class="d2h-info"><div class="d2h-code-line">${hunkHeader}</div></td>
      </tr>
      <tr><td class="d2h-code-linenumber">1</td><td class="d2h-cntx">sample</td></tr>
    </tbody></table>`;
  document.body.appendChild(card);
  return card;
}

/** /file_range の問い合わせを止めておき、あとで lines を返す。 */
function gateFileRange() {
  const urls: string[] = [];
  let release: (lines: string[]) => void = () => undefined;
  const answer = new Promise<string[]>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    const lines = await answer;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ lines }),
      text: async () => JSON.stringify({ lines }),
    } as Response;
  }) as typeof fetch;
  return { urls, release: (lines: string[]) => release(lines) };
}

function setup(card: DiffCardElement, file: FileMeta) {
  createHunkExpand({
    trackLoad: (promise) => promise,
    getServerGeneration: () => 1,
    getToRef: () => "worktree",
    highlightInsertedSpans: () => undefined,
  }).setupHunkExpand(card, file);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const trailingRows = (card: Element) =>
  card.querySelectorAll(".gdp-trailing-expand-row").length;

const basis = (tailMore: boolean) => ({
  hunks: 1,
  context: 6,
  split_changes: 1,
  lead_gap: false,
  tail_more: tailMore,
});

describe("最後のハンクの後ろの行", () => {
  test("削除したファイルは後ろを問い合わせず、エラーの行も出ない", async () => {
    const card = mountCard("@@ -1,3 +0,0 @@");
    const gate = gateFileRange();
    setup(card, {
      path: "src/removed.ts",
      status: "D",
      load_url: "/file_diff?path=src%2Fremoved.ts",
    });
    gate.release([]);
    await settle();
    expect({
      requests: gate.urls,
      trailing: trailingRows(card),
      errors: card.querySelectorAll(".gdp-expand-error-row").length,
    }).toEqual({ requests: [], trailing: 0, errors: 0 });
  });

  test.each([
    {
      name: "続く見込みで、続きがある: 描いた時点から 1 行のまま",
      tailMore: true,
      lines: ["more"],
      expected: { atRender: 1, afterProbe: 1 },
    },
    {
      name: "続く見込みだったが、ファイルがそこで終わる: 問い合わせの後で外す",
      tailMore: true,
      lines: [],
      expected: { atRender: 1, afterProbe: 0 },
    },
    {
      name: "見込みが無い: 今までどおり問い合わせの後で置く",
      tailMore: false,
      lines: ["more"],
      expected: { atRender: 0, afterProbe: 1 },
    },
  ])("$name", async ({ tailMore, lines, expected }) => {
    const card = mountCard("@@ -1,4 +1,4 @@");
    const gate = gateFileRange();
    setup(card, {
      path: "src/sample.ts",
      status: "M",
      load_url: "/file_diff?path=src%2Fsample.ts",
      row_basis: basis(tailMore),
    });
    const atRender = trailingRows(card);
    gate.release(lines);
    await settle();
    await settle();
    expect({
      atRender,
      afterProbe: trailingRows(card),
      probes: gate.urls.filter((url) => url.includes("start=5&end=5")).length,
    }).toEqual({ ...expected, probes: 1 });
  });
});
