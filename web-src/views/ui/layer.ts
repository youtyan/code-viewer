// 画面の上に重ねて出すもの (右クリックのメニュー・ダイアログ・説明の吹き出し) を
// 描く層。出すたびに body の末尾に <cv-layer data-layer=名前> を 1 つ置き、中身は
// lit が描く。層の箱は箱を作らない (display: contents) ので、中身の位置は今までの
// とおり中身の CSS (position: fixed など) が決める。
//
// 層の箱はこのファイルだけが作る (宣言的に描く所が置く先が、まだ DOM に無いため)。
// 出すたびに作り直し、隠すときは箱ごと外す。中身の一部を外から外された
// (テストの後片付けなど) 箱を、次に出すときに使い回さないため。

import { createRenderer, type Renderer } from "./renderer";

export const CV_LAYER = "cv-layer";

export type Layer = {
  /** 中身を描いて出す (前に出していたものは外す)。いまここで描き終える。 */
  show(template: () => unknown): void;
  /** 出している中身を描き直す (いまここで)。 */
  update(): void;
  /** 外す。 */
  hide(): void;
  /** 出している層の箱。描いた中身を測るときに使う。出していなければ null。 */
  host(): HTMLElement | null;
};

export function createLayer(name: string): Layer {
  let host: HTMLElement | null = null;
  let renderer: Renderer | null = null;

  function hide(): void {
    renderer?.dispose();
    renderer = null;
    host?.remove();
    host = null;
  }

  return {
    show(template) {
      hide();
      host = document.createElement(CV_LAYER);
      host.dataset.layer = name;
      document.body.appendChild(host);
      renderer = createRenderer(host, template);
      renderer.flush();
    },
    update() {
      if (host?.isConnected) renderer?.flush();
    },
    hide,
    host: () => host,
  };
}
