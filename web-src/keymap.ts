export type KeymapScope = 'global' | 'sidebar' | 'main';

export type KeymapAction =
  | 'open-file-palette'
  | 'open-grep-palette'
  | 'focus-file-filter'
  | 'focus-sidebar'
  | 'focus-main'
  | 'open-sidebar-item'
  | 'sidebar-next'
  | 'sidebar-previous'
  | 'sidebar-page-down'
  | 'sidebar-page-up'
  | 'sidebar-expand'
  | 'sidebar-collapse'
  | 'scroll-main-down'
  | 'scroll-main-up'
  | 'scroll-main-page-down'
  | 'scroll-main-page-up'
  | 'tab-preview'
  | 'tab-code'
  | 'goto-top'
  | 'goto-bottom'
  | 'start-g-sequence'
  | 'cancel-source-load'
  | 'layout-unified'
  | 'layout-split'
  | 'toggle-theme';

export type KeyEventLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
};

export type KeymapContext = {
  scope: KeymapScope;
  editable: boolean;
  composing?: boolean;
  paletteOpen?: boolean;
  pendingG?: boolean;
  lightboxOpen?: boolean;
};

export type KeyBinding = {
  action: KeymapAction;
  key: string;
  scope?: KeymapScope;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  allowEditable?: boolean;
  allowPaletteOpen?: boolean;
  shift?: boolean;
  pendingG?: boolean;
  requires?: {
    lightboxClosed?: boolean;
  };
};

export const DEFAULT_KEY_BINDINGS: KeyBinding[] = [
  { action: 'open-file-palette', key: 'k', ctrl: true, allowEditable: true, allowPaletteOpen: true },
  { action: 'open-file-palette', key: 'k', meta: true, allowEditable: true, allowPaletteOpen: true },
  { action: 'open-grep-palette', key: 'g', ctrl: true, allowEditable: true, allowPaletteOpen: true },
  { action: 'open-grep-palette', key: 'g', meta: true, allowEditable: true, allowPaletteOpen: true },
  { action: 'focus-file-filter', key: '/' },
  { action: 'focus-sidebar', key: 'h', ctrl: true },
  { action: 'focus-main', key: 'l', ctrl: true },
  { action: 'cancel-source-load', key: 'escape', requires: { lightboxClosed: true } },
  { action: 'open-sidebar-item', key: 'enter', scope: 'sidebar' },
  { action: 'open-sidebar-item', key: 'enter', scope: 'global' },
  { action: 'sidebar-next', key: 'j', scope: 'sidebar' },
  { action: 'sidebar-next', key: 'j', scope: 'global' },
  { action: 'sidebar-previous', key: 'k', scope: 'sidebar' },
  { action: 'sidebar-previous', key: 'k', scope: 'global' },
  { action: 'sidebar-page-down', key: 'd', scope: 'sidebar', ctrl: true },
  { action: 'sidebar-page-down', key: 'd', scope: 'global', ctrl: true },
  { action: 'sidebar-page-up', key: 'u', scope: 'sidebar', ctrl: true },
  { action: 'sidebar-page-up', key: 'u', scope: 'global', ctrl: true },
  { action: 'sidebar-expand', key: 'l', scope: 'sidebar' },
  { action: 'sidebar-expand', key: 'l', scope: 'global' },
  { action: 'sidebar-collapse', key: 'h', scope: 'sidebar' },
  { action: 'sidebar-collapse', key: 'h', scope: 'global' },
  { action: 'scroll-main-down', key: 'j', scope: 'main' },
  { action: 'scroll-main-up', key: 'k', scope: 'main' },
  { action: 'scroll-main-page-down', key: 'd', scope: 'main', ctrl: true },
  { action: 'scroll-main-page-up', key: 'u', scope: 'main', ctrl: true },
  { action: 'tab-preview', key: 'p', scope: 'main', pendingG: true },
  { action: 'tab-code', key: 'c', scope: 'main', pendingG: true },
  { action: 'goto-top', key: 'g', pendingG: true },
  { action: 'goto-bottom', key: 'g', shift: true, pendingG: true },
  { action: 'goto-bottom', key: 'g', shift: true },
  { action: 'start-g-sequence', key: 'g', scope: 'sidebar' },
  { action: 'start-g-sequence', key: 'g', scope: 'main' },
  { action: 'layout-unified', key: 'u' },
  { action: 'layout-split', key: 's' },
  { action: 'toggle-theme', key: 't' },
];

export function resolveKeymapAction(event: KeyEventLike, context: KeymapContext): KeymapAction | null {
  const key = event.key.toLowerCase();
  if (context.composing) return null;
  for (const binding of DEFAULT_KEY_BINDINGS) {
    if (binding.key !== key) continue;
    if (binding.requires?.lightboxClosed && context.lightboxOpen) continue;
    if (binding.scope && binding.scope !== context.scope) continue;
    if (!!binding.pendingG !== !!context.pendingG) continue;
    if (context.paletteOpen && !binding.allowPaletteOpen) continue;
    if (context.editable && !binding.allowEditable) continue;
    if (!!binding.ctrl !== !!event.ctrlKey) continue;
    if (!!binding.meta !== !!event.metaKey) continue;
    if (!!binding.alt !== !!event.altKey) continue;
    if (!!binding.shift !== !!event.shiftKey) continue;
    if (!binding.ctrl && !binding.meta && !binding.alt && !binding.shift && (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)) continue;
    return binding.action;
  }
  return null;
}
