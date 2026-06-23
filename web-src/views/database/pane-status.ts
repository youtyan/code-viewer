export function setPaneStatus(
  el: HTMLElement,
  message: string,
  options: { error?: boolean; afterClear?: () => void } = {},
): void {
  el.innerHTML = "";
  options.afterClear?.();
  const note = document.createElement("div");
  note.className = options.error ? "db-pane-error" : "db-pane-note";
  note.textContent = message;
  el.appendChild(note);
}
