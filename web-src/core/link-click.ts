type LinkClickLike = Pick<
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

/**
 * How a press on something that opens a tab should open it (the tab rules in
 * `ui-surface.md`): `preview` replaces the pane's preview tab, `new-tab` adds
 * a kept tab, `other-pane` opens on the other side. null leaves the press to
 * the browser (Shift: a new window from the row link; right button; Alt with
 * ⌘/Ctrl).
 */
export type OpenIntent = "preview" | "new-tab" | "other-pane";

/** A click, an auxclick (middle button) or a dblclick on a row. */
export function linkOpenIntent(
  event: LinkClickLike & { type: string },
): OpenIntent | null {
  if (event.shiftKey) return null;
  if (event.type === "dblclick") return "new-tab";
  if (event.button === 1) return "new-tab";
  if (event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey) return event.altKey ? null : "new-tab";
  return event.altKey ? "other-pane" : "preview";
}

/** Enter on a selected row (the palette): Shift+Enter keeps the tab. */
export function keyOpenIntent(
  event: Pick<KeyboardEvent, "shiftKey">,
): OpenIntent {
  return event.shiftKey ? "new-tab" : "preview";
}
