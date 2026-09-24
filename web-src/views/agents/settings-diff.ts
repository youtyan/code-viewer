// 利用者の設定ファイルに書く前の確認の画面 (フック・statusLine、入れる・外す)
// に出す「書き込む先」と「書く前と後の差分」。差分はサーバが plan で作った
// unified diff (core/text-diff.ts) をそのまま、このアプリの差分の画面と同じ
// diff2html (index.html が読み込む Diff2HtmlUI) と CSS で 1 列に描く。画面で
// 中身を推測しない。
//
//   書き込むファイル  ~/.claude/settings.json → ~/dotfiles/claude/settings.json
//   ┌ 1  {                                ┐
//   │ 2 +  "hooks": { … }                  │ ← 追加は緑・削除は赤 (行番号つき)
//   └──────────────────────────────────────┘ ← 長ければこの中でスクロール

import { abbreviateHome } from "../../core/agent-overview";
import { el, labeled } from "./accounts-dialogs";

export type SettingsDiffText = {
  /** 「書き込むファイル」の欄の名前。 */
  file: string;
  /** 変わらないとき。 */
  unchanged: string;
  /** diff2html が無くて差分の見た目で描けないとき (下に差分の文字を出す)。 */
  drawFailed: string;
};

export type SettingsDiffPlan = {
  path: string;
  realPath: string;
  symlink: boolean;
  changed: boolean;
  diff: string;
};

/** 書き込む先 (リンクなら「リンク → 実体」) と差分。 */
export function settingsDiffBlock(
  plan: SettingsDiffPlan,
  home: string,
  text: SettingsDiffText,
): HTMLElement[] {
  const short = (path: string) => (home ? abbreviateHome(path, home) : path);
  const where = labeled(
    text.file,
    plan.symlink
      ? `${short(plan.path)} → ${short(plan.realPath)}`
      : short(plan.path),
  );
  where.title = plan.symlink ? `${plan.path} → ${plan.realPath}` : plan.path;
  if (!plan.changed || plan.diff === "") {
    return [where, el("p", "agent-settings-diff-none", text.unchanged)];
  }
  const box = el("div", "agent-settings-diff");
  if (typeof window.Diff2HtmlUI !== "function") {
    // 見た目の部品が無い (読み込みに失敗した)。黙って省かず、差分の文字を出す。
    console.error(
      "[code-viewer] Diff2HtmlUI is not loaded; showing the settings diff as text",
    );
    const note = el("p", "agent-hooks-detail-problem", text.drawFailed);
    box.appendChild(el("pre", "terminal-mono", plan.diff));
    return [where, note, box];
  }
  new window.Diff2HtmlUI(box, plan.diff, {
    drawFileList: false,
    matching: "lines",
    outputFormat: "line-by-line",
    highlight: false,
    fileListToggle: false,
    fileContentToggle: false,
  }).draw();
  return [where, box];
}
