// mermaid の ELK の並べ方 (elkjs) の代わりに mermaid のバンドルへ入れるもの
// (scripts/bundles.mjs の WEB_BUNDLES の alias)。
//
// mermaid 12 は ELK を中に持ち、使わなくてもバンドルが 4MB あまり増えた。
// code-viewer は図を dagre で描く (core/mermaid-loader.ts の layout: "dagre")
// ので ELK は読まない。図の中で `layout: elk` を名指ししたときだけここに来て、
// 理由をそのまま mermaid の描き損じとして出す (黙って別の並べ方にしない)。
export default class ElkUnavailable {
  constructor() {
    throw new Error(
      "The ELK layout is not included in code-viewer. Diagrams are drawn with the dagre layout; remove `layout: elk` from the diagram to draw it.",
    );
  }
}
