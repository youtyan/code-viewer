// mermaid で描いた図のように「1 枚が画面より大きくなりうる描画」を、ズームと
// ドラッグスクロールで見て回るためのビューポート。DB の ER 図と tools の
// mermaid プレビューが同じ操作系 (ボタンズーム / ctrl+wheel ズーム / ドラッグ
// パン) を共有する。クラス名は呼び出し側の CSS に合わせて注入する。

export type DiagramViewport = {
  /** スクロールコンテナ。ドラッグパンを受ける。 */
  container: HTMLElement;
  /** 拡大縮小される中身。呼び出し側はここに描画結果を入れる。 */
  content: HTMLElement;
  zoomIn(): void;
  zoomOut(): void;
  reset(): void;
  dispose(): void;
};

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
const BUTTON_STEP = 0.2;
const WHEEL_STEP = 0.1;

function clampScale(value: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
}

export function createDiagramViewport(options: {
  containerClassName: string;
  contentClassName: string;
}): DiagramViewport {
  const container = document.createElement("div");
  container.className = options.containerClassName;
  const content = document.createElement("div");
  content.className = options.contentClassName;
  container.appendChild(content);

  let scale = 1;

  function applyZoom(next: number): void {
    scale = clampScale(next);
    content.style.transform = `scale(${scale})`;
    content.style.transformOrigin = "top left";
  }

  let dragState: { x: number; y: number; sl: number; st: number } | null = null;
  container.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    dragState = {
      x: event.clientX,
      y: event.clientY,
      sl: container.scrollLeft,
      st: container.scrollTop,
    };
    container.style.cursor = "grabbing";
    event.preventDefault();
  });
  const onWindowMouseMove = (event: MouseEvent) => {
    if (!dragState) return;
    container.scrollLeft = dragState.sl - (event.clientX - dragState.x);
    container.scrollTop = dragState.st - (event.clientY - dragState.y);
  };
  const onWindowMouseUp = () => {
    if (!dragState) return;
    dragState = null;
    container.style.cursor = "";
  };
  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mouseup", onWindowMouseUp);

  container.addEventListener(
    "wheel",
    (event) => {
      // 修飾キー無しのホイールは通常スクロールのまま残す。
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      applyZoom(scale + (event.deltaY > 0 ? -WHEEL_STEP : WHEEL_STEP));
    },
    { passive: false },
  );

  applyZoom(1);

  return {
    container,
    content,
    zoomIn: () => applyZoom(scale + BUTTON_STEP),
    zoomOut: () => applyZoom(scale - BUTTON_STEP),
    reset: () => applyZoom(1),
    dispose() {
      dragState = null;
      container.style.cursor = "";
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
    },
  };
}
