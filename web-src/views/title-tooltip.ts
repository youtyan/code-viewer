// title を持つ要素に、ブラウザの既定より速く出る吹き出しを出す。アプリ全体で 1 つ
// (app.ts が 1 回だけ取り付ける)。部品ごとに付けない: 文言は title の値をそのまま
// 出すので、title を書けば吹き出しも出る。
//
// - マウスとペンだけ。指 (touch) では出さない (長押しは右クリックのメニュー)
// - 出している間は要素の title を外す (ブラウザの既定の吹き出しが重なるため)。消す
//   ときに戻す。出している間にほかのコードが title を書いたら、その値を出して、
//   消すときもその値を残す
// - body 直下の position: fixed (親の overflow で切れない)。見た目は style.css の
//   「title の吹き出し」の節。重ね合わせの層 (views/ui/layer.ts) に描く

import { html } from "lit/html.js";
import { createLayer } from "./ui/layer";

export const TITLE_TOOLTIP_DELAY_MS = 300;

/** 要素と吹き出しの間、窓の端との間。 */
const GAP = 6;
const EDGE = 8;

export type TooltipRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * 吹き出しの置き場所。要素のすぐ下の中央、下に入らなければ上。左右と上下は窓の
 * 端から EDGE 離す。
 */
export function placeTooltip(
  anchor: TooltipRect,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const below = anchor.top + anchor.height + GAP;
  const above = anchor.top - GAP - tip.height;
  const fitsBelow = below + tip.height <= viewport.height - EDGE;
  const top = fitsBelow || above < EDGE ? below : above;
  const centered = anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.min(centered, viewport.width - EDGE - tip.width);
  return {
    left: Math.max(EDGE, left),
    top: Math.max(EDGE, Math.min(top, viewport.height - EDGE - tip.height)),
  };
}

type Hover = {
  anchor: Element;
  timer: ReturnType<typeof setTimeout> | null;
  /** 出している間だけ。外した title (ほかのコードが書き直したら、その値)。 */
  shown: { title: string; observer: MutationObserver } | null;
};

/** 取り付けて、外す関数を返す。 */
export function installTitleTooltips(doc: Document = document): () => void {
  const win = doc.defaultView;
  if (!win) throw new Error("installTitleTooltips: document has no window");
  let hover: Hover | null = null;
  /** 吹き出しの中身と位置。描くのは層。 */
  const tip = { text: "", hidden: true, left: 0, top: 0 };
  const layer = createLayer("title-tooltip");

  function tipElement(): HTMLElement {
    let element = layer.host()?.querySelector<HTMLElement>(".title-tooltip");
    if (!element?.isConnected) {
      layer.show(
        () =>
          html`<div
            class="title-tooltip"
            role="tooltip"
            ?hidden=${tip.hidden}
            style=${`left: ${tip.left}px; top: ${tip.top}px;`}
          >${tip.text}</div>`,
      );
      element = layer.host()?.querySelector<HTMLElement>(".title-tooltip");
    }
    if (!element) throw new Error("title tooltip: the tooltip was not drawn");
    return element;
  }

  /** 文言を入れて出し、要素のすぐ下 (入らなければ上) に置く。 */
  function showTip(anchor: Element, text: string): void {
    const element = tipElement();
    // 前の位置のまま測ると、窓の右端の近くでは折り返して幅が狭く測れる。
    Object.assign(tip, { text, hidden: false, left: 0, top: 0 });
    layer.update();
    const { left, top } = placeTooltip(
      anchor.getBoundingClientRect(),
      element.getBoundingClientRect(),
      { width: win?.innerWidth ?? 0, height: win?.innerHeight ?? 0 },
    );
    Object.assign(tip, { left, top });
    layer.update();
  }

  function hide(): void {
    const current = hover;
    hover = null;
    if (!current) return;
    if (current.timer !== null) clearTimeout(current.timer);
    if (!tip.hidden) {
      tip.hidden = true;
      layer.update();
    }
    const shown = current.shown;
    if (!shown) return;
    // まだ届いていない書き直しを先に読む (disconnect は捨てるので)。
    applyRewrites(current, shown.observer.takeRecords());
    shown.observer.disconnect();
    // 出している間にほかのコードが書いた値は残す。
    if (!current.anchor.hasAttribute("title")) {
      current.anchor.setAttribute("title", shown.title);
    }
  }

  /** 出している間に書かれた title を出し直し、既定の吹き出しのためにまた外す。 */
  function applyRewrites(current: Hover, records: MutationRecord[]): void {
    const shown = current.shown;
    if (!shown || records.length === 0) return;
    const written = current.anchor.getAttribute("title");
    if (written === null) return;
    shown.title = written;
    current.anchor.removeAttribute("title");
    if (hover !== current) return;
    if (!written.trim()) {
      hide();
      return;
    }
    showTip(current.anchor, written);
  }

  function show(current: Hover): void {
    current.timer = null;
    const title = current.anchor.getAttribute("title");
    if (!current.anchor.isConnected || !title?.trim()) {
      hide();
      return;
    }
    const observer = new MutationObserver((records) =>
      applyRewrites(current, records),
    );
    current.shown = { title, observer };
    current.anchor.removeAttribute("title");
    observer.observe(current.anchor, { attributeFilter: ["title"] });
    showTip(current.anchor, title);
  }

  function onPointerOver(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof win.Element)) return;
    // 出している要素の title は外してあるので、ここで見つかるのは中の別の title
    // (タブの中の閉じるボタンなど) か、待っている間の要素そのもの。
    const anchor = target.closest("[title]");
    if (
      hover?.anchor.contains(target) &&
      (!anchor || anchor === hover.anchor || !hover.anchor.contains(anchor))
    ) {
      return;
    }
    hide();
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    // iframe (面・HTML と PDF のプレビュー) の title は読み上げのための名前。中の
    // ページが自分の吹き出しを出すので、枠全体に出さない。
    if (target instanceof win.HTMLIFrameElement) return;
    // 空の title は祖先の title を打ち消す (ブラウザの既定と同じ)。
    if (!anchor?.getAttribute("title")?.trim()) return;
    const current: Hover = { anchor, timer: null, shown: null };
    current.timer = setTimeout(() => show(current), TITLE_TOOLTIP_DELAY_MS);
    hover = current;
  }

  function onPointerOut(event: PointerEvent): void {
    const next = event.relatedTarget;
    if (next instanceof win.Node && hover?.anchor.contains(next)) return;
    hide();
  }

  const listeners: [EventTarget, string, EventListener][] = [
    [doc, "pointerover", onPointerOver as EventListener],
    [doc, "pointerout", onPointerOut as EventListener],
    [doc, "pointerdown", hide],
    [doc, "keydown", hide],
    [doc, "scroll", hide],
    [win, "blur", hide],
  ];
  for (const [target, type, listener] of listeners) {
    target.addEventListener(type, listener, { capture: true, passive: true });
  }
  return () => {
    hide();
    for (const [target, type, listener] of listeners) {
      target.removeEventListener(type, listener, { capture: true });
    }
    layer.hide();
  };
}
