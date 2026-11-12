import { html } from "lit/html.js";
import { templateElement } from "../ui/renderer";

// 共通のラベル付き「ピル形」永続化トグル button を作るヘルパ。
// 同じ DOM 構造 (button.db-pref-toggle > svg + span.db-pref-toggle-label)
// が複数箇所で再現していたのを 1 か所に集約する。
// className には base "db-pref-toggle" は常に付与され、`extraClass` で
// バリアント (例: "s3-tooltip-toggle") を追加できる。

export type PrefToggleOptions = {
  /** ホバー時に表示される説明文 (title 属性)。 */
  title: string;
  /** ボタンに表示されるテキストラベル。 */
  label: string;
  /** 16x16 viewBox の SVG パス (icon)。 */
  pathD: string;
  /** "db-pref-toggle" に追加で付与するクラス (任意)。 */
  extraClass?: string;
};

// 言語切替時にラベル / title を再適用する。
export function localizePrefToggle(
  btn: HTMLButtonElement,
  label: string,
  title: string,
): void {
  btn.title = title;
  const labelEl = btn.querySelector<HTMLElement>(".db-pref-toggle-label");
  if (labelEl) labelEl.textContent = label;
}

export function makePrefToggle(opts: PrefToggleOptions): HTMLButtonElement {
  // label はユーザー/ローカライズ由来の文字列が入る可能性があるので、文字と
  // して入れる (テンプレートが escape する)。
  return templateElement<HTMLButtonElement>(
    html`<button
      type="button"
      class=${opts.extraClass ? `db-pref-toggle ${opts.extraClass}` : "db-pref-toggle"}
      title=${opts.title}
    ><svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
        fill="currentColor"
      ><path d=${opts.pathD}></path></svg
      ><span class="db-pref-toggle-label">${opts.label}</span></button>`,
  );
}
