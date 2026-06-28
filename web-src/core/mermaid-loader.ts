// mermaid を lazy import する共通ローダ。markdown preview (fence ```mermaid)
// と DB の ER 図描画から呼ばれる。プロセス内で 1 度だけ load + initialize する。
// 失敗時は null (呼び出し側で fallback)。

export type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  // nodes は Element[] で受ける (markdown-preview が Element[]、er-diagram が
  // HTMLElement[] を渡すので、共通の base クラスで揃える)。
  run(options: { nodes: Element[]; suppressErrors?: boolean }): Promise<void>;
  parse?: (text: string) => Promise<unknown>;
};

type MermaidModule = { default: MermaidApi };

// initialize は idempotent ではなく「最初の設定」が永続化される。両 caller
// の設定を統合してデフォルトに含める (er.useMaxWidth は ER 描画にしか効か
// ないので markdown 側にも害なし)。
const DEFAULT_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "default",
  er: { useMaxWidth: false },
};

let mermaidPromise: Promise<MermaidApi | null> | null = null;
let initialized = false;

export function loadMermaid(): Promise<MermaidApi | null> {
  if (!mermaidPromise) {
    mermaidPromise = import(`/${"mermaid.js"}`)
      .then((mod: unknown) => {
        const mermaid = (mod as MermaidModule).default;
        if (!initialized) {
          mermaid.initialize(DEFAULT_CONFIG);
          initialized = true;
        }
        return mermaid;
      })
      .catch(() => null);
  }
  return mermaidPromise;
}
