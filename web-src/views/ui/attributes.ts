// テンプレートで描かない要素の属性を書く道具。lit にも部品にも依存しない。

/**
 * テンプレートで描かない要素 (index.html の部品・描いた後に印を付ける行) の属性を、
 * 値が変わったときだけ書く (null は外す)。同じ値でも書けば書き込みとして数えられ、
 * 描き直しは 1.5 秒ごとのエージェントの監視でも起きるので、そのたびに書いていた。
 */
export function setAttributeIfChanged(
  el: Element,
  name: string,
  value: string | null,
): void {
  if (el.getAttribute(name) === value) return;
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}
