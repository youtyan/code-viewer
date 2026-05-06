export function isWhitespaceOnlyInlineHighlight(text: string | null): boolean {
  return !!text && !/\S/.test(text);
}

export function suppressWhitespaceOnlyInlineHighlights(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("ins, del").forEach((el) => {
    if (!isWhitespaceOnlyInlineHighlight(el.textContent)) return;
    const parent = el.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(el.textContent || ""), el);
  });
}
