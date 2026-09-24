// サーバが起き直して終わったシェルのタブの案内 (views/terminal/terminal-view.ts の
// showEnded) を、端末の面の上下の真ん中に出す。実物の style.css を happy-dom に
// 流し込み、計算値で見る。案内は面 (.terminal-pane、縦の flex) の直下に置く
// .empty で、広げないと中身の高さのまま面の上に寄った。
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test } from "vitest";
import { TERMINAL_16_PATHS } from "../core/icons";
import { renderEmptyState } from "../views/empty-state";

beforeAll(() => {
  GlobalRegistrator.register();
  const style = document.createElement("style");
  style.textContent = readFileSync("web/style.css", "utf8");
  document.head.append(style);
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

test("端末の面の案内は、面の高さいっぱいに広がり、中身を上下の真ん中に置く", () => {
  const pane = document.createElement("div");
  pane.className = "terminal-pane";
  const empty = renderEmptyState({
    icon: TERMINAL_16_PATHS,
    title: "The shell ended",
    actions: [{ label: "Reopen", primary: true, run: () => undefined }],
  });
  pane.append(empty);
  document.body.append(pane);
  const paneStyle = getComputedStyle(pane);
  const emptyStyle = getComputedStyle(empty);
  expect({
    paneDisplay: paneStyle.display,
    paneDirection: paneStyle.flexDirection,
    grow: emptyStyle.flexGrow,
    justify: emptyStyle.justifyContent,
    align: emptyStyle.alignItems,
  }).toEqual({
    paneDisplay: "flex",
    paneDirection: "column",
    grow: "1",
    justify: "center",
    align: "center",
  });
});
