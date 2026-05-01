export type DiffRange = {
  from?: string;
  to?: string;
};

export function isSameWorktreeRange(range: DiffRange): boolean {
  return range.from === 'worktree' && range.to === 'worktree';
}
