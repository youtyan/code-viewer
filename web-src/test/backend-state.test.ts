// 入口の下で裏のプロセスが起きなかった (503) ときの最初の画面
// (views/backend-state.ts)。入口の版が古いなら「再起動」では直らないので、
// 覆いとダイアログの最初の 1 文に入口の案内 (本文の error) を出す。
// パス・名前はすべて架空。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { errorWithCause } from "../core/error-detail";
import type { EntryBackendFailure } from "../core/types";
import { createBackendState } from "../views/backend-state";
import { PROJECTS_EN } from "../views/projects/projects-i18n";
import { closeOpenDialog, getOpenDialog } from "./_dialog-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
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
