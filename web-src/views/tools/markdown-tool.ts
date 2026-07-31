// tools オーバーレイの Markdown プレビュー。描画そのものは core の
// renderMarkdownPreview に任せる (見出し TOC / タスクリスト / frontmatter /
// コードハイライト / ```mermaid フェンスまで、ファイル閲覧時と同じ結果になる)。
//
// リポジトリ相対リンクの遷移先は無い (貼り付け専用のスクラッチパッドなので)
// ため onNavigateMarkdown は渡さない。markdown-preview 側はハンドラが無い
// リンクを preventDefault するだけなので、押しても何も起きない。

import { renderMarkdownPreview } from "../../core/markdown-preview";
import type { ToolsText } from "./i18n";
import { createScratchpadPane, type ScratchpadPane } from "./scratchpad-pane";

/** リポジトリのファイルではないことが分かる名前にしておく。相対リンクの
 * 解決基準にしか使われない。 */
const SCRATCHPAD_TARGET = { path: "scratchpad.md", ref: "worktree" } as const;

export function createMarkdownTool(
  text: ToolsText,
  initialText: string,
  onInput: (value: string) => void,
): ScratchpadPane {
  return createScratchpadPane(
    text,
    text.markdown.output,
    text.markdown.placeholder,
    {
      toolClassName: "tools-pane-markdown",
      initialText,
      onInput,
      render: async (value, output, signal) => {
        const rendered = await renderMarkdownPreview(value, SCRATCHPAD_TARGET, {
          syntaxHighlight: true,
          signal,
        });
        if (signal.aborted) return;
        output.replaceChildren(rendered);
      },
    },
  );
}
