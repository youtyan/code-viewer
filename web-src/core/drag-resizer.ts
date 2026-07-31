// ドラッグでサイズを変えるハンドルの共通配線。tools シート自身の幅、その中の
// 入力 / 出力ペインの分割位置、terminal ドロワーの幅とペイン一覧の高さが同じ
// 操作系を共有する。
//
// サイズのクランプと実際の適用は applySize に任せる (対象ごとに下限・上限や
// 適用先の CSS プロパティが違うため)。ここが持つのはポインタとキーボードの
// 取り回しだけ。

export type DragResizerOptions = {
  /** ドラッグを受け取る要素。 */
  handle: HTMLElement;
  /** ドラッグ開始時点のサイズを返す。 */
  getSize: () => number;
  /** 算出したサイズを適用する。範囲のクランプは呼び出し側の責任。 */
  applySize: (size: number) => void;
  /**
   * ハンドルを動かす向き。既定は "x" (左右にドラッグして幅を変える)。
   * "y" にすると上下のドラッグと ArrowUp / ArrowDown を見る。
   */
  axis?: "x" | "y";
  /**
   * ハンドルを右 (axis: "y" なら下) に動かしたときサイズが増えるなら 1、
   * 減るなら -1。
   */
  direction: 1 | -1;
  /** ドラッグ / キー操作が終わったとき。永続化はここで行う。 */
  onEnd?: () => void;
  /** 矢印キー 1 回あたりの変化量 (Shift 併用で 4 倍)。 */
  keyboardStep?: number;
  /** ドラッグ中だけクラスを付ける要素。 */
  activeClassTarget?: HTMLElement;
  activeClassName?: string;
};

const DEFAULT_KEYBOARD_STEP = 16;

export function attachDragResizer(options: DragResizerOptions): () => void {
  const { handle } = options;
  const step = options.keyboardStep ?? DEFAULT_KEYBOARD_STEP;
  const vertical = options.axis === "y";
  const pointerPosition = (event: PointerEvent) =>
    vertical ? event.clientY : event.clientX;
  const increaseKey = vertical ? "ArrowDown" : "ArrowRight";
  const decreaseKey = vertical ? "ArrowUp" : "ArrowLeft";
  let pointerId: number | null = null;
  let startPosition = 0;
  let startSize = 0;

  function setActive(active: boolean): void {
    if (!options.activeClassTarget || !options.activeClassName) return;
    options.activeClassTarget.classList.toggle(options.activeClassName, active);
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    startPosition = pointerPosition(event);
    startSize = options.getSize();
    try {
      // 捕捉できなくてもドラッグ自体は成立させる (ハンドル外に出たときの
      // 追従が甘くなるだけ)。ここで throw させて操作ごと落とさない。
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
    setActive(true);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    options.applySize(
      startSize + (pointerPosition(event) - startPosition) * options.direction,
    );
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    setActive(false);
    options.onEnd?.();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== decreaseKey && event.key !== increaseKey) return;
    const delta = (event.key === increaseKey ? 1 : -1) * options.direction;
    options.applySize(
      options.getSize() + delta * step * (event.shiftKey ? 4 : 1),
    );
    event.preventDefault();
    options.onEnd?.();
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerEnd);
  handle.addEventListener("pointercancel", onPointerEnd);
  handle.addEventListener("keydown", onKeyDown);

  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("pointermove", onPointerMove);
    handle.removeEventListener("pointerup", onPointerEnd);
    handle.removeEventListener("pointercancel", onPointerEnd);
    handle.removeEventListener("keydown", onKeyDown);
    pointerId = null;
    setActive(false);
  };
}
