// 入口の下で裏のプロセスが起きなかった (503) ときの最初の画面
// (views/backend-state.ts)。入口の版が古いなら「再起動」では直らないので、
// 覆いとダイアログの最初の 1 文に入口の案内 (本文の error) を出す。
// パス・名前はすべて架空。

import "./_dom";
import { afterEach, expect, test, vi } from "vitest";
import { errorWithCause } from "../core/error-detail";
import type { EntryBackendFailure } from "../core/types";
import {
  type BackendSurfaceProps,
  createBackendState,
  DEFAULT_VIEW,
} from "../views/backend-state";
import { PROJECTS_EN } from "../views/projects/projects-i18n";
import { closeOpenDialog, getOpenDialog } from "./_dialog-helpers";

afterEach(() => {
  closeOpenDialog();
  document.body.replaceChildren();
});

const OUTDATED_GUIDANCE =
  "code-viewer was updated or reinstalled while this entry server (version 0.0.1-sample, pid 4242) was running, so the entry server is out of date.";

test.each([
  {
    name: "入口が古い",
    extra: { entryOutdated: true as const },
    error: OUTDATED_GUIDANCE,
    shown: OUTDATED_GUIDANCE,
  },
  {
    name: "それ以外",
    extra: {},
    error: "the process for this project did not start",
    shown: PROJECTS_EN.backendSurfaceText("sample-app"),
    dialog: PROJECTS_EN.backendDialogText,
  },
])("503 の最初の画面 ($name)", async ({ extra, error, shown, dialog }) => {
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  const state = createBackendState({
    text: () => PROJECTS_EN,
    reload: () => undefined,
    reportError: (operation, cause) => {
      throw errorWithCause(operation, cause);
    },
  });
  const body: EntryBackendFailure = {
    error,
    code: "backend-start-failed",
    project: { key: "0123456789abcdef", root: "/work/sample-app" },
    detail: `${error}\n\nthe project process stopped at start`,
    log: "",
    ...extra,
  };
  const response = new Response(JSON.stringify(body), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "url", {
    value: "http://127.0.0.1:4321/p/0123456789abcdef/_settings",
  });

  state.inspect(response);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect({
    surface: document.querySelector("#backend-state p")?.textContent,
    dialog: getOpenDialog().querySelector(".gdp-dialog-description")
      ?.textContent,
  }).toEqual({ surface: shown, dialog: dialog ?? shown });
});

// presenter: 描き方を記録する view に差し替え、覆いに渡す値と、［再起動］を押した
// ときの要求と、押している間に押せないことを見る。
test("presenter: the surface gets the failure and the restart asks the entry server", async () => {
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  const shown: BackendSurfaceProps[] = [];
  const reloads: string[] = [];
  const state = createBackendState(
    {
      text: () => PROJECTS_EN,
      reload: () => reloads.push("reload"),
      reportError: (operation, cause) => {
        throw errorWithCause(operation, cause);
      },
    },
    {
      ...DEFAULT_VIEW,
      surface: (props) => {
        shown.push(props);
        return DEFAULT_VIEW.surface(props);
      },
    },
  );
  const body: EntryBackendFailure = {
    error: "the process for this project stopped",
    code: "backend-stopped",
    project: { key: "0123456789abcdef", root: "/work/sample-app" },
    detail: "the process for this project stopped",
    log: "",
  };
  const response = new Response(JSON.stringify(body), {
    status: 502,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "url", {
    value: "http://127.0.0.1:4321/p/0123456789abcdef/_settings",
  });
  state.inspect(response);
  await new Promise((resolve) => setTimeout(resolve, 0));
  closeOpenDialog();
  const last = () => shown[shown.length - 1];
  expect([last()?.mode, last()?.hidden, last()?.heading]).toEqual([
    "failure",
    false,
    PROJECTS_EN.backendStoppedHeading,
  ]);
  const restarts: string[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    restarts.push(String(init?.body));
    return new Response("{}", { status: 200 });
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    last()?.actions?.restart.onClick();
    expect(last()?.actions?.restart.busy).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([restarts, reloads, last()?.actions?.restart.busy]).toEqual([
      ['{"key":"0123456789abcdef"}'],
      ["reload"],
      false,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
