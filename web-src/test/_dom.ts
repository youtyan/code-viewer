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

// happy-dom の Response には bytes() が無い (21.0.4 でも)。shiki 4.6 は
// WebAssembly を `new Response(...).bytes()` で読むので、色付けを描くテストが
// 読み込みの時点で落ちた。本物のブラウザ (Chrome 132・Safari 18・Firefox 128
// 以降) と Node の Response には bytes() があるので、テストの DOM にだけ足す。
if (typeof Response.prototype.bytes !== "function") {
  Object.defineProperty(Response.prototype, "bytes", {
    configurable: true,
    writable: true,
    value: async function bytes(this: Response): Promise<Uint8Array> {
      return new Uint8Array(await this.arrayBuffer());
    },
  });
}

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
