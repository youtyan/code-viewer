import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const style = readFileSync('web/style.css', 'utf8');

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = style.match(new RegExp('^\\s*' + escaped + '\\s*\\{([^}]*)\\}', 'm'));
  return match ? match[1] : '';
}

describe('sticky line number styles', () => {
  test('line number cells stay fixed during horizontal code scroll', () => {
    const block = cssBlock('table.d2h-diff-table td.d2h-code-linenumber,\ntable.d2h-diff-table td.d2h-code-side-linenumber');

    expect(block.includes('position: sticky !important')).toBe(true);
    expect(block.includes('left: 0')).toBe(true);
    expect(block.includes('z-index: 2')).toBe(true);
  });

  test('line number divider avoids collapsed table border rendering', () => {
    const block = cssBlock('.d2h-code-linenumber');

    expect(block.includes('border-right: 0 !important')).toBe(true);
    expect(block.includes('box-shadow: inset -1px 0 0 var(--border-muted)')).toBe(true);
  });

  test('context line numbers match GitHub neutral line colors', () => {
    expect(style.includes('.d2h-cntx.d2h-code-linenumber')).toBe(true);
    expect(style.includes('.d2h-cntx.d2h-code-side-linenumber')).toBe(true);
    expect(style.includes('background: var(--bg) !important')).toBe(true);
    expect(style.includes('color: var(--fg-muted) !important')).toBe(true);
  });

  test('split diff add/delete line numbers use current GitHub number backgrounds', () => {
    expect(style.includes('--diff-add-num-bg:    #aceebb;')).toBe(true);
    expect(style.includes('--diff-del-num-bg:    #ffcecb;')).toBe(true);
    expect(style.includes('.d2h-ins.d2h-code-side-linenumber')).toBe(true);
    expect(style.includes('background: var(--diff-add-num-sticky-bg) !important')).toBe(true);
    expect(style.includes('.d2h-del.d2h-code-side-linenumber')).toBe(true);
    expect(style.includes('background: var(--diff-del-num-sticky-bg) !important')).toBe(true);
  });
});
