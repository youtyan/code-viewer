import { describe, expect, test } from 'bun:test';
import { isSameWorktreeRange } from '../server/range';

describe('isSameWorktreeRange', () => {
  test('treats explicit worktree to worktree as a no-op diff range', () => {
    expect(isSameWorktreeRange({ from: 'worktree', to: 'worktree' })).toBe(true);
  });

  test('does not treat default or one-sided worktree ranges as no-op', () => {
    expect(isSameWorktreeRange({ from: 'HEAD', to: 'worktree' })).toBe(false);
    expect(isSameWorktreeRange({ from: '', to: '' })).toBe(false);
  });
});
