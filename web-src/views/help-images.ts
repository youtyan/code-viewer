// ヘルプのページに添える画面のキャプチャ。画像は web/help-images/ に言語ごとに
// 1 枚ずつあり (<名前>.<言語>.webp)、サーバが /help-images/ で配る
// (server/static-files.ts)。撮り直すのは scripts/help-captures.mjs。

import type { HelpLanguage } from "./help-page";

export type HelpFigure = { src: string; alt: string };

export function helpFigure(
  lang: HelpLanguage,
  name: string,
  alt: string,
): HelpFigure {
  return { src: `/help-images/${name}.${lang}.webp`, alt };
}
