import type { KeymapScope } from './keymap';

export type PanelFocusScope = Extract<KeymapScope, 'sidebar' | 'main'>;

export function isEditableKeyTarget(target: Element | null): boolean {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.closest('[contenteditable="true"]') != null;
}

export function keymapScope(target: Element | null): KeymapScope {
  if (target?.closest('#content')) return 'main';
  if (target?.closest('#sidebar')) return 'sidebar';
  return 'global';
}

export function prepareKeyboardPanels(doc: Document = document) {
  const sidebar = doc.querySelector<HTMLElement>('#sidebar');
  const content = doc.querySelector<HTMLElement>('#content');
  if (sidebar) sidebar.tabIndex = -1;
  if (content) content.tabIndex = -1;
}

export function getPanelFocusScope(doc: Document = document): PanelFocusScope | null {
  const scope = doc.body?.dataset.focusScope;
  return scope === 'sidebar' || scope === 'main' ? scope : null;
}

export function setPanelFocusScope(scope: PanelFocusScope | null, doc: Document = document) {
  if (!doc.body) return;
  if (scope) doc.body.dataset.focusScope = scope;
  else delete doc.body.dataset.focusScope;
}

export function focusSidebarPanel(doc: Document = document) {
  const active = doc.querySelector<HTMLElement>('#filelist li.active[data-path], #filelist .tree-dir.active[data-dirpath]');
  const sidebar = doc.querySelector<HTMLElement>('#sidebar');
  (active || sidebar)?.focus({ preventScroll: true });
  setPanelFocusScope('sidebar', doc);
}

export function focusMainPanel(doc: Document = document) {
  doc.querySelector<HTMLElement>('#content')?.focus({ preventScroll: true });
  setPanelFocusScope('main', doc);
}

export function findMainScrollTarget(doc: Document = document): HTMLElement | null {
  const active = doc.activeElement as HTMLElement | null;
  const activeScroller = active?.closest<HTMLElement>('#content .gdp-source-virtual-scroller');
  if (activeScroller && activeScroller.offsetParent !== null) return activeScroller;
  const sourceScroller = doc.querySelector<HTMLElement>('#content .gdp-source-virtual-scroller');
  return sourceScroller && sourceScroller.offsetParent !== null ? sourceScroller : null;
}
