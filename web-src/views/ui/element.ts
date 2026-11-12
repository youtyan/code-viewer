// 部品 (cv-*) の土台。部品は Shadow DOM を使わず、自分の中 (light DOM) に描く。
// 見た目は web/style.css だけが決め、部品の中は標準の要素 (button・input・
// select・a) にしてキー操作とアクセシビリティを標準のまま保つ。
//
// クラスはモジュールを読んだ時ではなく、初めて定義する時に作る。DOM の無い
// node のテストもこれらのモジュールを (間接に) 読むので、読んだだけで
// HTMLElement を参照すると落ちる。
//
// 決まりは .agents/skills/project-rules/references/ui-components.md。

import { render } from "lit/html.js";
import { cancelRender, scheduleRender } from "./render-queue";

function makeBase(Element: typeof HTMLElement) {
  abstract class CvElement extends Element {
    /** 描き直しを起こす property の名前。defineElement が accessor を付ける。 */
    static props: readonly string[] = [];
    /** property の値。accessor の裏。 */
    readonly propValues: Record<string, unknown> = {};
    readonly #job = () => {
      if (this.isConnected) this.renderNow();
    };

    /** 中身のテンプレート。 */
    protected abstract template(): unknown;

    /** 描いた直後に呼ぶ。描いた DOM を読む処理 (フォーカスなど) はここ。 */
    protected rendered(): void {
      // 既定では何もしない (描いた DOM を読む部品だけが上書きする)。
    }

    connectedCallback(): void {
      // 定義される前に property を入れられていたら (要素を先に作って後から
      // 定義した場合)、自前の値が accessor を隠しているので付け直す。
      const ctor = this.constructor as typeof CvElement;
      for (const prop of ctor.props) {
        if (!Object.getOwnPropertyDescriptor(this, prop)) continue;
        const value = (this as unknown as Record<string, unknown>)[prop];
        delete (this as unknown as Record<string, unknown>)[prop];
        (this as unknown as Record<string, unknown>)[prop] = value;
      }
      this.renderNow();
    }

    disconnectedCallback(): void {
      cancelRender(this.#job);
    }

    /** 次の描画の機会に描き直す。 */
    requestRender(): void {
      if (this.isConnected) scheduleRender(this.#job);
    }

    /** いまここで描き直す。 */
    renderNow(): void {
      render(this.template(), this, { host: this });
      this.rendered();
    }
  }
  return CvElement;
}

export type CvElementClass = ReturnType<typeof makeBase>;
export type CvElement = InstanceType<CvElementClass>;

const bases = new WeakMap<typeof HTMLElement, CvElementClass>();

/** いまのページ (テストでは登録した DOM) の HTMLElement を土台にした基底クラス。 */
function cvElementBase(): CvElementClass {
  const Element = globalThis.HTMLElement;
  let base = bases.get(Element);
  if (!base) {
    base = makeBase(Element);
    bases.set(Element, base);
  }
  return base;
}

/** 部品を 1 つ定義する。同じ名前が定義済みなら何もしない。props に挙げた
 * property は、値が変わったときに描き直しを頼む accessor になる。 */
export function defineElement(
  name: string,
  make: (Base: CvElementClass) => CvElementClass,
): void {
  if (customElements.get(name)) return;
  const ctor = make(cvElementBase());
  for (const prop of ctor.props) {
    Object.defineProperty(ctor.prototype, prop, {
      configurable: true,
      enumerable: true,
      get(this: CvElement) {
        return this.propValues[prop];
      },
      set(this: CvElement, value: unknown) {
        if (Object.is(this.propValues[prop], value)) return;
        this.propValues[prop] = value;
        this.requestRender();
      },
    });
  }
  customElements.define(name, ctor as unknown as CustomElementConstructor);
}
