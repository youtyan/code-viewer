// ヘルプのページに添える画面のキャプチャと構成図。画像は web/help-images/ に言語ごとに
// 1 枚ずつあり (<名前>.<言語>.webp)、サーバが /help-images/ で配る
// (server/static-files.ts)。アプリの撮り直しは scripts/help-captures.mjs。
// remote-* はCloudflareの未保存の設定画面を、説明用の値で撮影したもの。

import type { HelpLanguage } from "./help-page";

/**
 * 撮った画像の名前と、画素の高さ (幅はどれも HELP_CAPTURE_WIDTH)。言語で高さが
 * 違うものは言語ごと。本文は撮る予定の画面も名前で書いておき、ここに無いものは
 * 描かない (壊れた画像を出さない)。撮ったら画像と一緒にここへ足す
 * (help-page.test.ts が web/help-images/ の中身と名前・高さが一致することを見る)。
 * 高さは画像が届く前に箱を取るため (取らないと、届いたときに下の本文が押し下がった)。
 */
export const HELP_CAPTURES: ReadonlyMap<
  string,
  number | Readonly<Record<HelpLanguage, number>>
> = new Map<string, number | Readonly<Record<HelpLanguage, number>>>([
  ["accounts-add", 657],
  ["accounts-list", 494],
  ["accounts-review", 1005],
  ["accounts-sign-in", 707],
  ["accounts-signed-in", 707],
  ["agent-launch", 1200],
  ["agent-new", 591],
  ["agent-running", 456],
  ["agents-board", 750],
  ["annotations-panel", 750],
  ["datastore-grid", 750],
  ["diff-screen", 750],
  ["doctor-sheet", 750],
  ["files-line-select", 750],
  ["files-open", 750],
  ["history-screen", 750],
  ["hooks-dialog", 1152],
  ["hooks-section", { en: 408, ja: 438 }],
  ["notify-enable", 156],
  ["overview", 750],
  ["overview-marked", 750],
  ["phone-screen", 1338],
  ["project-add", 1100],
  ["project-register", 1100],
  ["projects-menu", 473],
  ["quick-help", 912],
  ["remote-access-hostname", 240],
  ["remote-access-policy", 543],
  ["remote-tunnel-route", 732],
  ["remote-tunnel-options", 725],
  ["search-palette", 750],
  ["sidebar-no-tmux", 293],
  ["skill-install", 698],
  ["tabs-groups", 674],
  ["tabs-split", 750],
  ["terminal-tab", 666],
  ["tools-markdown", 750],
  ["worktrees-screen", 750],
]);

/** 撮った画像の画素の幅 (scripts/help-captures.mjs の切り抜く幅 × 1.5)。 */
export const HELP_CAPTURE_WIDTH = 1200;

export type HelpFigure = {
  name: string;
  src: string;
  alt: string;
  /** 画像があるか (HELP_CAPTURES)。無いものは描かない。 */
  captured: boolean;
  /** 画素の高さ (HELP_CAPTURES。無いものは 0)。 */
  height: number;
};

export function helpFigure(
  lang: HelpLanguage,
  name: string,
  alt: string,
): HelpFigure {
  const height = HELP_CAPTURES.get(name);
  return {
    name,
    src: `/help-images/${name}.${lang}.webp`,
    alt,
    captured: height !== undefined,
    height: typeof height === "object" ? height[lang] : (height ?? 0),
  };
}
