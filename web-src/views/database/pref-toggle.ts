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
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = opts.extraClass
    ? `db-pref-toggle ${opts.extraClass}`
    : "db-pref-toggle";
  btn.title = opts.title;
  // SVG はテンプレ化された定数 (path data) なので innerHTML で組み立てる。
  // label はユーザー/ローカライズ由来の文字列が入る可能性があるため、span
  // 側に textContent で挿入して escape 不要にする。
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "currentColor");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", opts.pathD);
  svg.appendChild(path);
  const label = document.createElement("span");
  label.className = "db-pref-toggle-label";
  label.textContent = opts.label;
  btn.append(svg, label);
  return btn;
}
