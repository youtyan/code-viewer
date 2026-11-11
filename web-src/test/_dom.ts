// DOM (happy-dom) を、このファイルを読んだ時点で登録する。
//
// lit-html は読み込んだ時点の document を掴む (node 版は document が無ければ
// 中身の無い代わりを掴み、後から登録しても描けない)。lit で描く画面
// (views/ui の部品と、それを使う presenter) を読むテストは、import の先頭で
// これを読み、beforeAll での登録をやめる。
//
//   import "./_dom";
//   import { createToolsPresenter } from "../views/tools/tools-presenter";
//
// URL を変えたいテストは window.happyDOM.setURL(...) を使う。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll } from "vitest";

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" });

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
