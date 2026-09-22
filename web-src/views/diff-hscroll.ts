// 差分のカードの横スクロールバーを、本文の箱の下端に貼り付けて常に見せる。
//
// 本物のスクロールバーはカードの下端にあるので、長いカードでは上の方を読んで
// いる間は画面に出てこない (マウスだけでは横に送れない)。本物のスクロール
// バーを持つ薄い箱 (.gdp-hscroll) をカードの下端に sticky で置き、中身の
// .d2h-code-wrapper と横位置を同期する。カードの下端が画面に入れば、箱は
// ふつうにカードの下端に並ぶ (短いカードは今までどおり)。
//
// 中身の横送り (ホイールの横・Shift+ホイール・トラックパッド) はそのまま効く。
// 中身の本物のスクロールバーだけを隠す (二重に出さない。CSS の
// .gdp-hscroll-host)。Split の左右は既存の同期 (diff-view.ts の
// syncSideScrollCard) で連動し、ここは左右それぞれに 1 本ずつ出す。

import { mirroredScrollLeft, needsProxyScrollbar } from "../core/hscroll-proxy";

type Lane = { source: HTMLElement; proxy: HTMLElement; inner: HTMLElement };

/** カードごとの後片付け (描き直すとき・外すときに呼ぶ)。 */
const CLEANUPS = new WeakMap<HTMLElement, () => void>();

/** 前に付けたものを外す。付けていなければ何もしない。 */
export function detachStickyHScroll(card: HTMLElement): void {
  CLEANUPS.get(card)?.();
  CLEANUPS.delete(card);
}

/**
 * そのカードの差分 (diff2html が描いた .d2h-file-wrapper) に、貼り付く横
 * スクロールバーを付ける。描き直すたびに呼んでよい (前のものは外す)。
 */
export function attachStickyHScroll(card: HTMLElement): void {
  detachStickyHScroll(card);
  const wrappers = card.querySelectorAll<HTMLElement>(".d2h-file-wrapper");
  const cleanups: Array<() => void> = [];
  for (const wrapper of wrappers) {
    const sources = Array.from(
      wrapper.querySelectorAll<HTMLElement>(".d2h-code-wrapper"),
    );
    if (sources.length === 0) continue;
    const row = document.createElement("div");
    row.className = "gdp-hscroll";
    row.setAttribute("aria-hidden", "true");
    const lanes: Lane[] = sources.map((source) => {
      const proxy = document.createElement("div");
      proxy.className = "gdp-hscroll-lane";
      // 押せる操作ではない (中身の横送りと同じもの)。キーの順に入れない。
      proxy.tabIndex = -1;
      const inner = document.createElement("div");
      inner.className = "gdp-hscroll-inner";
      proxy.append(inner);
      row.append(proxy);
      return { source, proxy, inner };
    });
    wrapper.append(row);
    wrapper.classList.add("gdp-hscroll-host");

    const measure = () => {
      let any = false;
      for (const lane of lanes) {
        const extent = {
          scrollWidth: lane.source.scrollWidth,
          clientWidth: lane.source.clientWidth,
        };
        // 中身と同じだけ送れるよう、内側の幅は中身の scrollWidth。枠の幅は
        // 左右の半分 (flex) で中身の枠とそろう。
        lane.inner.style.width = `${extent.scrollWidth}px`;
        const scrollable = needsProxyScrollbar(extent);
        if (scrollable) any = true;
        // 送れる箱は Tab で止まり、←→ で送れる。ブラウザは中に押せる部品
        // (隠れた行を出すボタン) のある箱には止まらないので、自分で止める。
        if (scrollable) lane.source.tabIndex = 0;
        else lane.source.removeAttribute("tabindex");
        const left = mirroredScrollLeft(lane.source.scrollLeft, lane.proxy);
        if (left !== null) lane.proxy.scrollLeft = left;
      }
      row.hidden = !any;
    };

    for (const lane of lanes) {
      const fromProxy = () => {
        const left = mirroredScrollLeft(lane.proxy.scrollLeft, lane.source);
        if (left !== null) lane.source.scrollLeft = left;
      };
      const fromSource = () => {
        const left = mirroredScrollLeft(lane.source.scrollLeft, lane.proxy);
        if (left !== null) lane.proxy.scrollLeft = left;
      };
      lane.proxy.addEventListener("scroll", fromProxy, { passive: true });
      lane.source.addEventListener("scroll", fromSource, { passive: true });
      cleanups.push(() => {
        lane.proxy.removeEventListener("scroll", fromProxy);
        lane.source.removeEventListener("scroll", fromSource);
      });
    }

    measure();
    if (typeof ResizeObserver !== "undefined") {
      // 枠の幅 (面の幅・右の列) と中身の幅 (行の展開・構文の色付けで字の幅が
      // 変わる) のどちらが変わっても測り直す。
      const observer = new ResizeObserver(measure);
      for (const lane of lanes) {
        observer.observe(lane.source);
        const table = lane.source.firstElementChild;
        if (table) observer.observe(table);
      }
      cleanups.push(() => observer.disconnect());
    }
    cleanups.push(() => {
      row.remove();
      wrapper.classList.remove("gdp-hscroll-host");
    });
  }
  if (cleanups.length > 0)
    CLEANUPS.set(card, () => {
      for (const cleanup of cleanups) cleanup();
    });
}
