import { describe, expect, test } from 'bun:test';
import { PALETTE_RESULT_LIMIT, limitPaletteResults, movePaletteSelection } from '../search-palette';

describe('limitPaletteResults', () => {
  test('keeps only the first palette result window', () => {
    const items = Array.from({ length: PALETTE_RESULT_LIMIT + 2 }, (_, index) => index);
    expect(limitPaletteResults(items).length).toBe(PALETTE_RESULT_LIMIT);
  });
});

describe('movePaletteSelection', () => {
  test('starts at first or last item when there is no selection', () => {
    expect(movePaletteSelection(-1, 3, 1)).toBe(0);
    expect(movePaletteSelection(-1, 3, -1)).toBe(2);
  });

  test('wraps around result edges', () => {
    expect(movePaletteSelection(2, 3, 1)).toBe(0);
    expect(movePaletteSelection(0, 3, -1)).toBe(2);
  });

  test('returns -1 for empty results', () => {
    expect(movePaletteSelection(0, 0, 1)).toBe(-1);
  });
});
