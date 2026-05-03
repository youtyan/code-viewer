import { describe, expect, test } from 'bun:test';
import { DEFAULT_KEY_BINDINGS, resolveKeymapAction, type KeymapScope } from '../keymap';

function key(key: string, options: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}) {
  return {
    key,
    ctrlKey: !!options.ctrl,
    metaKey: !!options.meta,
    shiftKey: !!options.shift,
    altKey: !!options.alt,
  };
}

function action(keyValue: string, scope: KeymapScope, options: Parameters<typeof key>[1] = {}) {
  return resolveKeymapAction(key(keyValue, options), { scope, editable: false });
}

describe('keymap action resolution', () => {
  test('moves focus between sidebar and main with Ctrl+H and Ctrl+L', () => {
    expect(action('h', 'main', { ctrl: true })).toBe('focus-sidebar');
    expect(action('l', 'sidebar', { ctrl: true })).toBe('focus-main');
  });

  test('keeps Ctrl+K as file palette in every scope', () => {
    expect(action('k', 'sidebar', { ctrl: true })).toBe('open-file-palette');
    expect(action('k', 'global', { ctrl: true })).toBe('open-file-palette');
    expect(action('k', 'main', { ctrl: true })).toBe('open-file-palette');
  });

  test('scrolls the main panel with vim-style keys only in main scope', () => {
    expect(action('j', 'main')).toBe('scroll-main-down');
    expect(action('k', 'main')).toBe('scroll-main-up');
    expect(action('d', 'main', { ctrl: true })).toBe('scroll-main-page-down');
    expect(action('u', 'main', { ctrl: true })).toBe('scroll-main-page-up');
    expect(action('j', 'sidebar')).toBe('sidebar-next');
    expect(action('k', 'sidebar')).toBe('sidebar-previous');
    expect(action('d', 'sidebar', { ctrl: true })).toBe('sidebar-page-down');
    expect(action('u', 'sidebar', { ctrl: true })).toBe('sidebar-page-up');
  });

  test('does not handle vim navigation inside editable fields', () => {
    expect(resolveKeymapAction(key('j'), { scope: 'main', editable: true })).toBe(null);
    expect(resolveKeymapAction(key('k', { ctrl: true }), { scope: 'main', editable: true })).toBe('open-file-palette');
    expect(resolveKeymapAction(key('g', { ctrl: true }), { scope: 'main', editable: true })).toBe('open-grep-palette');
  });

  test('suppresses vim navigation while composing text or using the palette', () => {
    expect(resolveKeymapAction(key('j'), { scope: 'main', editable: false, composing: true })).toBe(null);
    expect(resolveKeymapAction(key('j'), { scope: 'main', editable: false, paletteOpen: true })).toBe(null);
    expect(resolveKeymapAction(key('g', { ctrl: true }), { scope: 'main', editable: true, paletteOpen: true })).toBe('open-grep-palette');
  });

  test('keeps default bindings as data for future customization', () => {
    expect(DEFAULT_KEY_BINDINGS.some(binding => binding.action === 'focus-main' && binding.key === 'l' && binding.ctrl)).toBe(true);
    expect(DEFAULT_KEY_BINDINGS.some(binding => binding.action === 'scroll-main-page-up' && binding.key === 'u' && binding.scope === 'main' && binding.ctrl)).toBe(true);
  });

  test('supports Vim top and bottom navigation with gg and Shift+G', () => {
    expect(resolveKeymapAction(key('g'), { scope: 'main', editable: false })).toBe('start-g-sequence');
    expect(resolveKeymapAction(key('g'), { scope: 'main', editable: false, pendingG: true })).toBe('goto-top');
    expect(resolveKeymapAction(key('G', { shift: true }), { scope: 'main', editable: false })).toBe('goto-bottom');
  });

  test('switches source tabs with gp and gc in the main scope', () => {
    expect(resolveKeymapAction(key('p'), { scope: 'main', editable: false, pendingG: true })).toBe('tab-preview');
    expect(resolveKeymapAction(key('c'), { scope: 'main', editable: false, pendingG: true })).toBe('tab-code');
    expect(resolveKeymapAction(key('p'), { scope: 'sidebar', editable: false, pendingG: true })).toBe(null);
    expect(resolveKeymapAction(key('c'), { scope: 'sidebar', editable: false, pendingG: true })).toBe(null);
  });
});
