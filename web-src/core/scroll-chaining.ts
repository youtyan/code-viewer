// ページに重ねて出す箱の中で回したホイールを、後ろのページへ渡さないための
// 配線。
//
// ブラウザはホイールを受けた要素から外へ向かって「動かせる箱」を探し、内側で
// 動かし切れなかった分を外側へ渡す (scroll chaining)。パネルやドロワーはページ
// の上に重ねて出しているので、渡された先はたいてい後ろで見ていた画面になる。
// 中を読んでいるだけのつもりで後ろが動くと、閉じた後にどこを見ていたのか
// 分からなくなる。
//
// CSS の overscroll-behavior: contain だけでは足りない。あれが効くのは
// 「自分で動ける箱が端に着いた」ときだけで、中身が枠に収まっていて 1px も
// 動けない箱はブラウザがそもそもスクロールの相手に選ばず、そこに書いた指定
// ごと読み飛ばして外側へ渡す。端末のように「枠に収まっているのが普通」の
// 中身では、これが一番よくある場面になる。
//
// なので両方使う。動ける箱の端は CSS に任せ、動けない箱はここで止める。

/**
 * ホイールの向きに、この箱がまだ動ける余地を持っているか。
 *
 * 端に着くと小数が残ることがあるので、1px の余裕を見る。
 */
function hasScrollRoom(el: HTMLElement, event: WheelEvent): boolean {
  const up = event.deltaY < 0 && el.scrollTop > 1;
  const down =
    event.deltaY > 0 && el.scrollHeight - el.clientHeight - el.scrollTop > 1;
  const left = event.deltaX < 0 && el.scrollLeft > 1;
  const right =
    event.deltaX > 0 && el.scrollWidth - el.clientWidth - el.scrollLeft > 1;
  if (!up && !down && !left && !right) return false;
  // 中身が溢れているだけでスクロールはしない箱がある (xterm が字の大きさを
  // 測るために置く .xterm-helpers は、高さ 0 の枠に 1 画面分の中身が入って
  // いる)。寸法だけ見ると動けるように見えるので、最後に overflow を確かめる。
  const style = getComputedStyle(el);
  const scrollsY = style.overflowY === "auto" || style.overflowY === "scroll";
  const scrollsX = style.overflowX === "auto" || style.overflowX === "scroll";
  return ((up || down) && scrollsY) || ((left || right) && scrollsX);
}

/**
 * root の中で回したホイールが、外側へ渡らないようにする。
 *
 * ホイールを受けた要素から root までを順に見て、その向きに動かせる箱が 1 つも
 * 無ければ既定の動作ごと止める。動かせる箱があるときは何もしないので、中身の
 * スクロールはいつも通り効く (端まで来た後の残りは CSS の overscroll-behavior
 * が受け持つ)。
 *
 * 返る関数を呼ぶと外れる。
 */
export function blockScrollChaining(root: HTMLElement): () => void {
  const onWheel = (event: WheelEvent): void => {
    // 中身が自分で捌いた分 (xterm が alt buffer のアプリへ送る ↑/↓ など) は、
    // もう既定の動作ごと止まっている。
    if (event.defaultPrevented) return;
    let node = event.target instanceof HTMLElement ? event.target : null;
    while (node) {
      if (hasScrollRoom(node, event)) return;
      if (node === root) break;
      node = node.parentElement;
    }
    event.preventDefault();
  };
  // 既定の動作を止めるので passive にはできない。
  root.addEventListener("wheel", onWheel, { passive: false });
  return () => root.removeEventListener("wheel", onWheel);
}
