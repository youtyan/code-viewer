// ファイル一覧を畳む / 開くボタン (#sidebar-toggle) の絵を、枠の中央に置く。
// ボタンは 16px の列を 1 本だけ持つ grid で、列そのものを中央に置かないと、
// 列が左端に残って絵だけが左へずれた (畳んだ縦の帯で、上の絵柄の列より 6px 左)。
// 実物の style.css を happy-dom に流し込み、計算値で見る。
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  GlobalRegistrator.register();
  const style = document.createElement("style");
  style.textContent = readFileSync("web/style.css", "utf8");
  document.head.append(style);
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

test.each([
  { name: "ファイル一覧を開いている間", hidden: false },
  { name: "ファイル一覧を畳んだ縦の帯", hidden: true },
])("$name: 絵の列を枠の中央に置く", ({ hidden }) => {
  document.body.className = hidden ? "gdp-sidebar-hidden" : "";
  document.body.innerHTML =
    '<div id="panel-head"><div id="view-head"><div class="view-head-row">' +
    '<button id="sidebar-toggle" type="button"><svg></svg></button>' +
    "</div></div></div>";
  const toggle = document.querySelector("#sidebar-toggle") as HTMLElement;
  const style = getComputedStyle(toggle);
  expect({
    columns: style.gridTemplateColumns,
    justifyContent: style.justifyContent,
    alignContent: style.alignContent,
  }).toEqual({
    columns: "16px",
    justifyContent: "center",
    alignContent: "center",
  });
});
