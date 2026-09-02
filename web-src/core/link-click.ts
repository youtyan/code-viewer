export type LinkClickLike = Pick<
  MouseEvent,
  "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "button"
>;

/**
 * True when the browser should keep its own handling of a click on a link:
 * a modifier key (new tab / window, download) or a non-primary button. The
 * app takes over only the plain primary click.
 */
export function isNativeLinkClick(event: LinkClickLike): boolean {
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  );
}
