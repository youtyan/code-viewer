// 診断の画面 (views/doctor-view.ts) が /_doctor の失敗の本文を捨てずに出すこと。
// 裏は 500 の本文に失敗の理由の全文 (cause の連なり) を入れて返す。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { escapeHtml } from "../core/html-escape";
import { createDoctorView } from "../views/doctor-view";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test("a failed /_doctor shows the status and the whole body, and logs the error", async () => {
  const body = JSON.stringify({
    error: "Error: sample doctor failure\nCaused by: TypeError: sample cause",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 500 })),
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  document.body.innerHTML = '<div id="doctor-sheet" hidden></div>';
  try {
    await createDoctorView({
      $: (sel) => document.querySelector(sel),
      escapeHtml: (value) => escapeHtml(String(value)),
      trackLoad: (promise) => promise,
      getLanguage: () => "en",
    }).open();

    const expected = `Error: GET /_doctor (HTTP 500): ${body}`;
    expect({
      shown: document.querySelector(".doctor-empty")?.textContent,
      logged: log.mock.calls.map(([label, error]) => [
        label,
        (error as Error).message,
      ]),
    }).toEqual({
      shown: `Failed to load doctor report: ${expected}`,
      logged: [
        [
          "[code-viewer] the doctor report could not be loaded:",
          `GET /_doctor (HTTP 500): ${body}`,
        ],
      ],
    });
  } finally {
    log.mockRestore();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  }
});
