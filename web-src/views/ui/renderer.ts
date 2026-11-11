// presenter が自分の受け持つ箱 (host) を描く係。描き方は
// .agents/skills/project-rules/references/ui-components.md。

import { type RenderOptions, render } from "lit/html.js";
import { defineUiComponents } from "./components";
import { cancelRender, flushRenders, scheduleRender } from "./render-queue";

export type Renderer = {
  /** 次の描画の機会に描き直す。 */
  request(): void;
  /** いまここで描き直す (頼まれているほかの描き直しも一緒に描く)。描いた直後の
   * DOM を読む所 (フォーカス・寸法) の前で呼ぶ。 */
  flush(): void;
  /** 頼んでいる描き直しを取り下げ、以後は描かない。 */
  dispose(): void;
};

/** host の中を template() の結果で描く係を作る。host の中身はこの係だけが
 * 持つ (ほかの所から子を足したり消したりしない)。 */
export function createRenderer(
  host: HTMLElement | DocumentFragment,
  template: () => unknown,
  options?: RenderOptions,
): Renderer {
  defineUiComponents();
  let disposed = false;
  const job = () => {
    if (disposed) return;
    render(template(), host, options);
  };
  return {
    request() {
      if (!disposed) scheduleRender(job);
    },
    flush() {
      if (disposed) return;
      scheduleRender(job);
      flushRenders();
    },
    dispose() {
      disposed = true;
      cancelRender(job);
    },
  };
}
