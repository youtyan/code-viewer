// Tools の Markdown プレビューの結果の描き方。描画そのものは core の
// renderMarkdownPreview に任せる (見出し TOC / タスクリスト / frontmatter /
// コードハイライト / ```mermaid フェンスまで、ファイル閲覧時と同じ結果になる)。
// 結果は markdown-it が作る要素なので、その要素をそのまま結果の欄に出す。
//
// リポジトリ相対リンクの遷移先は無い (貼り付け専用のスクラッチパッドなので)
// ため onNavigateMarkdown は渡さない。markdown-preview 側はハンドラが無い
// リンクを preventDefault するだけなので、押しても何も起きない。

import { renderMarkdownPreview } from "../../core/markdown-preview";
import type { ScratchpadRender } from "./scratchpad-pane";

/** リポジトリのファイルではないことが分かる名前にしておく。相対リンクの
 * 解決基準にしか使われない。 */
const SCRATCHPAD_TARGET = { path: "scratchpad.md", ref: "worktree" } as const;

export const renderMarkdownOutput: ScratchpadRender = async (
  value,
  { signal, show },
) => {
  const rendered = await renderMarkdownPreview(value, SCRATCHPAD_TARGET, {
    syntaxHighlight: true,
    signal,
  });
  if (signal.aborted) return;
  show(rendered);
};
