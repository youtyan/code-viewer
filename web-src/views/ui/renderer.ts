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

/**
 * テンプレートで描かない要素 (index.html の部品・描いた後に印を付ける行) の属性を、
 * 値が変わったときだけ書く (null は外す)。同じ値でも書けば書き込みとして数えられ、
 * 描き直しは 1.5 秒ごとのエージェントの監視でも起きるので、そのたびに書いていた。
 */
export function setAttributeIfChanged(
  el: Element,
  name: string,
  value: string | null,
): void {
  if (el.getAttribute(name) === value) return;
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

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

const owned = new WeakSet<Node>();

/**
 * 画面の箱 (web/index.html に書いてある要素など) の中を、いまここで template で
 * 描く。最初に描くときに、箱にもとからあった中身 (lit が描いていないもの) を
 * 外す (lit はもとの中身の後ろに描き足すので)。2 回目からは描き直すだけ。
 */
export function renderOwned(container: HTMLElement, template: unknown): void {
  defineUiComponents();
  if (!owned.has(container)) {
    container.replaceChildren();
    owned.add(container);
  }
  render(template, container);
}

/**
 * テンプレートの最初の要素を、どこにも置かずに作る。置き場所が描く側に無い
 * 1 つの要素 (外の部品に渡す要素・後から決まった所へ動かす要素) に使う。
 */
export function templateElement<T extends Element = HTMLElement>(
  template: unknown,
): T {
  defineUiComponents();
  const fragment = document.createDocumentFragment();
  render(template, fragment);
  const element = fragment.firstElementChild;
  if (!element) throw new Error("templateElement: the template has no element");
  return element as T;
}

/**
 * テンプレートの最上段の要素を全部、どこにも置かずに作る。表の行をまとめて
 * 差し込むときなど、1 つの箱に包めない並びに使う (描き直さない)。
 */
export function templateElements(template: unknown): Element[] {
  defineUiComponents();
  const fragment = document.createDocumentFragment();
  render(template, fragment);
  return [...fragment.children];
}

/**
 * テンプレートの中身 (文字も含めた全部の節) を、どこにも置かずに作る。ほかの所も
 * 中身を書き換える箱 (画面にもとからあるボタンなど) へ replaceChildren で入れる
 * ときに使う (箱に描く係を置かないので、書き換えられても次にまた入れられる)。
 */
export function templateFragment(template: unknown): DocumentFragment {
  defineUiComponents();
  const fragment = document.createDocumentFragment();
  render(template, fragment);
  return fragment;
}

/**
 * templateElement の描き直せる形。テンプレートの最初の要素を作って返し、
 * draw() でその要素の中を描き直す (要素は外の部品が置く。ダイアログの本文など)。
 * テンプレートの最上段の形 (最初の要素の種類) は描き直しで変えないこと。
 */
export function detachedElement(template: () => unknown): {
  element: HTMLElement;
  draw(): void;
} {
  defineUiComponents();
  const fragment = document.createDocumentFragment();
  render(template(), fragment);
  const element = fragment.firstElementChild;
  if (!(element instanceof HTMLElement))
    throw new Error("detachedElement: the template has no element");
  // 要素を外へ動かしても、中の部分は要素についていく (最上段の印だけが残る)。
  return { element, draw: () => render(template(), fragment) };
}
