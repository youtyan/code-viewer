// 診断の画面 (views/doctor-view.ts) が /_doctor の失敗の本文を捨てずに出すこと。
// 裏は 500 の本文に失敗の理由の全文 (cause の連なり) を入れて返す。

import "./_dom";
import { expect, test, vi } from "vitest";
import {
  createDoctorView,
  DEFAULT_VIEW,
  type DoctorSheetProps,
} from "../views/doctor-view";

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

test("the doctor presenter gives the view one group per check group", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        worstStatus: "warn",
        groups: [
          {
            id: "runtime",
            title: "Runtime",
            rows: [{ status: "ok", title: "Node.js", detail: "v24", hint: "" }],
          },
        ],
      }),
    ),
  );
  document.body.innerHTML = '<div id="doctor-sheet" hidden></div>';
  const shown: DoctorSheetProps[] = [];
  try {
    await createDoctorView(
      {
        $: (sel) => document.querySelector(sel),
        trackLoad: (promise) => promise,
        getLanguage: () => "en",
      },
      (props) => {
        shown.push(props);
        return DEFAULT_VIEW(props);
      },
    ).open();
    const last = shown[shown.length - 1];
    expect({
      summary: last?.summary,
      content: last?.content,
      refresh: last?.refresh.disabled,
    }).toEqual({
      summary: "Some checks reported warnings.",
      content: {
        kind: "groups",
        groups: [
          {
            id: "runtime",
            title: "Runtime",
            rows: [
              {
                status: "ok",
                pill: "OK",
                title: "Node.js",
                detail: "v24",
                hint: "",
              },
            ],
          },
        ],
      },
      refresh: false,
    });
  } finally {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  }
});
