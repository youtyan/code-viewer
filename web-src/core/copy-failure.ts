import { errorWithCause, formatErrorDetail } from "./error-detail";

/**
 * Show a failed copy on its button: the failed look plus the reason
 * (`error.name` and message, with the cause chain) in title / aria-label, and
 * the whole error on the console. The button returns to its idle label later.
 */
export function showCopyFailure(
  button: HTMLElement,
  operation: string,
  error: unknown,
  idleLabel: string,
  durationMs: number,
): void {
  const failure = errorWithCause(operation, error);
  console.error(failure);
  button.classList.add("failed");
  button.title = formatErrorDetail(failure);
  button.setAttribute("aria-label", button.title);
  setTimeout(() => {
    button.classList.remove("failed");
    button.title = idleLabel;
    button.setAttribute("aria-label", idleLabel);
  }, durationMs);
}

/**
 * Show that syntax highlighting failed on the element that keeps the plain
 * text: the failed mark (`.gdp-highlight-failed`), the reason in title, and
 * the whole error on the console. Same shape as the diff view's marker.
 */
export function showHighlightFailure(
  element: HTMLElement,
  operation: string,
  error: unknown,
): void {
  const failure = errorWithCause(operation, error);
  console.error(failure);
  element.classList.add("gdp-highlight-failed");
  element.title = formatErrorDetail(failure);
}
