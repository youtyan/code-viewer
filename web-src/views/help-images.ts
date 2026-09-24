// ヘルプのページに添える画面のキャプチャ。画像は web/help-images/ に言語ごとに
// 1 枚ずつあり (<名前>.<言語>.webp)、サーバが /help-images/ で配る
// (server/static-files.ts)。撮り直すのは scripts/help-captures.mjs。

import type { HelpLanguage } from "./help-page";

/**
 * 撮った画像の名前。本文は撮る予定の画面も名前で書いておき、ここに無いものは
 * 描かない (壊れた画像を出さない)。撮ったら画像と一緒にここへ足す
 * (help-page.test.ts が web/help-images/ の中身と一致することを見る)。
 */
export const HELP_CAPTURES: ReadonlySet<string> = new Set([
  "accounts-add",
  "accounts-list",
  "accounts-review",
  "accounts-sign-in",
  "accounts-signed-in",
  "agent-launch",
  "agent-new",
  "agent-running",
  "agents-board",
  "annotations-panel",
  "datastore-grid",
  "diff-screen",
  "doctor-sheet",
  "files-line-select",
  "files-open",
  "history-screen",
  "hooks-dialog",
  "hooks-section",
  "notify-enable",
  "overview",
  "overview-marked",
  "phone-screen",
  "project-add",
  "project-register",
  "projects-menu",
  "quick-help",
  "search-palette",
  "sidebar-no-tmux",
  "skill-install",
  "tabs-groups",
  "tabs-split",
  "terminal-tab",
  "tools-markdown",
  "worktrees-screen",
]);

export type HelpFigure = {
  name: string;
  src: string;
  alt: string;
  /** 画像があるか (HELP_CAPTURES)。無いものは描かない。 */
  captured: boolean;
};

export function helpFigure(
  lang: HelpLanguage,
  name: string,
  alt: string,
): HelpFigure {
  return {
    name,
    src: `/help-images/${name}.${lang}.webp`,
    alt,
    captured: HELP_CAPTURES.has(name),
  };
}
