import { describe, expect, test } from 'bun:test';
import { nextVisibleFileIndex } from '../file-navigation';

describe('nextVisibleFileIndex', () => {
  test('starts at the first item when moving down with no active item', () => {
    expect(nextVisibleFileIndex(-1, 3, 1)).toBe(0);
  });

  test('starts at the last item when moving up with no active item', () => {
    expect(nextVisibleFileIndex(-1, 3, -1)).toBe(2);
  });

  test('moves within bounds', () => {
    expect(nextVisibleFileIndex(1, 3, 1)).toBe(2);
    expect(nextVisibleFileIndex(1, 3, -1)).toBe(0);
  });

  test('clamps at list edges', () => {
    expect(nextVisibleFileIndex(2, 3, 1)).toBe(2);
    expect(nextVisibleFileIndex(0, 3, -1)).toBe(0);
  });
});
