import { describe, expect, test } from 'bun:test';
import { filePathClipboardText } from '../file-path-copy';

describe('filePathClipboardText', () => {
  test('copies the current file path exactly', () => {
    expect(filePathClipboardText('web-src/app.ts')).toBe('web-src/app.ts');
  });

  test('handles missing paths without throwing', () => {
    expect(filePathClipboardText(null)).toBe('');
  });
});
