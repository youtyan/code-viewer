import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type GitFileMeta = {
  order?: number;
  path: string;
  old_path?: string;
  status?: string;
  similarity?: number;
  additions?: number;
  deletions?: number;
  binary?: boolean;
  untracked?: boolean;
};

function run(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  return {
    code: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

export function repoRoot(cwd: string): string | null {
  const res = run(['git', 'rev-parse', '--show-toplevel'], cwd);
  return res.code === 0 ? res.stdout.trimEnd() : null;
}

export function currentBranch(cwd: string): string | null {
  const res = run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return res.code === 0 ? res.stdout.trimEnd() : null;
}

export function show(ref: string, path: string, cwd: string): { code: number; stdout: string; stderr: string } {
  return run(['git', 'show', `${ref}:${path}`], cwd);
}

export function refs(cwd: string): { branches: string[]; tags: string[]; commits: string[]; current: string } {
  const out = { branches: [] as string[], tags: [] as string[], commits: [] as string[], current: '' };
  const branches = run([
    'git', 'for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads', 'refs/remotes',
  ], cwd);
  if (branches.code === 0) {
    out.branches = branches.stdout.split('\n').filter((line) => line && line !== 'origin/HEAD');
  }
  const tags = run(['git', 'for-each-ref', '--sort=-creatordate', '--format=%(refname:short)', 'refs/tags'], cwd);
  if (tags.code === 0) out.tags = tags.stdout.split('\n').filter(Boolean);
  const commits = run(['git', 'log', '-50', '--format=%h\t%s\t%an\t%ar'], cwd);
  if (commits.code === 0) out.commits = commits.stdout.split('\n').filter(Boolean);
  out.current = currentBranch(cwd) || '';
  return out;
}

export function nameStatus(args: string[], cwd: string): GitFileMeta[] {
  const res = run([
    'git', '-c', 'core.quotepath=false', 'diff',
    '--no-color', '--no-ext-diff', '--find-renames', '--name-status', '-z',
    ...args,
  ], cwd);
  if (res.code !== 0) return [];
  const parts = res.stdout.split('\0');
  const files: GitFileMeta[] = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (!status) break;
    const kind = status[0];
    if (kind === 'R' || kind === 'C') {
      const oldPath = parts[i++] || '';
      const path = parts[i++] || '';
      if (path) files.push({ status: kind, old_path: oldPath, path, similarity: Number(status.slice(1)) || undefined });
    } else {
      const path = parts[i++] || '';
      if (path) files.push({ status: kind, path });
    }
  }
  return files;
}

export function numstatZ(args: string[], cwd: string): GitFileMeta[] {
  const res = run([
    'git', '-c', 'core.quotepath=false', 'diff',
    '--no-color', '--no-ext-diff', '--find-renames', '--numstat', '-z',
    ...args,
  ], cwd);
  if (res.code !== 0) return [];
  const parts = res.stdout.split('\0');
  const files: GitFileMeta[] = [];
  for (let i = 0; i < parts.length;) {
    const rec = parts[i++];
    if (!rec) break;
    const match = rec.match(/^(\S+)\t(\S+)\t(.*)$/);
    if (!match) break;
    const [, add, del, rest] = match;
    const binary = add === '-' && del === '-';
    const additions = binary ? 0 : Number(add) || 0;
    const deletions = binary ? 0 : Number(del) || 0;
    if (rest === '') {
      const oldPath = parts[i++] || '';
      const path = parts[i++] || '';
      if (path) files.push({ old_path: oldPath, path, additions, deletions, binary });
    } else {
      files.push({ path: rest, additions, deletions, binary });
    }
  }
  return files;
}

export function untracked(cwd: string): string[] {
  const res = run(['git', 'ls-files', '--others', '--exclude-standard'], cwd);
  return res.code === 0 ? res.stdout.split('\n').filter(Boolean) : [];
}

export function untrackedMeta(cwd: string): GitFileMeta[] {
  return untracked(cwd).map((path) => {
    const full = join(cwd, path);
    let binary = false;
    let lines = 0;
    if (existsSync(full)) {
      const data = readFileSync(full);
      const probe = data.subarray(0, 8192);
      binary = probe.includes(0);
      if (!binary) lines = data.toString('utf8').split('\n').length - 1;
    }
    return { path, status: 'A', additions: binary ? 0 : lines, deletions: 0, binary, untracked: true };
  });
}

export function fileMeta(args: string[], cwd: string, includeUntracked = false): GitFileMeta[] {
  const ns = nameStatus(args, cwd);
  const nm = numstatZ(args, cwd);
  const byPath = new Map(nm.map((file) => [file.path, file]));
  const files: GitFileMeta[] = ns.map((file) => {
    const stats = byPath.get(file.path);
    return {
      ...file,
      additions: stats?.additions || 0,
      deletions: stats?.deletions || 0,
      binary: stats?.binary || false,
    };
  });
  return includeUntracked ? files.concat(untrackedMeta(cwd)) : files;
}

export function fileDiffText(args: string[], path: string | string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const paths = Array.isArray(path) ? path : [path];
  return run([
    'git', '-c', 'core.quotepath=false', 'diff',
    '--no-color', '--no-ext-diff', '--find-renames',
    ...args, '--', ...paths,
  ], cwd);
}

export function untrackedFileDiff(extras: string[], path: string, cwd: string): { code: number; stdout: string; stderr: string } {
  return run([
    'git', '-c', 'core.quotepath=false', 'diff',
    '--no-color', '--no-ext-diff', '--no-index',
    ...extras, '/dev/null', path,
  ], cwd);
}

export function splitHunks(diffText: string): { header: string; hunks: string[] } {
  if (!diffText) return { header: '', hunks: [] };
  const first = diffText.startsWith('@@') ? 0 : diffText.indexOf('\n@@') + 1;
  if (first <= 0) return { header: diffText, hunks: [] };
  const header = diffText.slice(0, first);
  const hunks: string[] = [];
  let cur = first;
  while (cur < diffText.length) {
    const next = diffText.indexOf('\n@@', cur + 1);
    const end = next >= 0 ? next : diffText.length;
    hunks.push(diffText.slice(cur, end));
    if (next < 0) break;
    cur = next + 1;
  }
  return { header, hunks };
}

export function truncateToNHunks(diffText: string, n: number): {
  text: string;
  totalHunks: number;
  renderedHunks: number;
  lineCount: number;
} {
  const { header, hunks } = splitHunks(diffText);
  if (hunks.length === 0) {
    return { text: diffText, totalHunks: 0, renderedHunks: 0, lineCount: (diffText.match(/\n/g) || []).length };
  }
  const renderedHunks = Math.min(n, hunks.length);
  const text = header + hunks.slice(0, renderedHunks).join('');
  return {
    text,
    totalHunks: hunks.length,
    renderedHunks,
    lineCount: (text.match(/\n/g) || []).length,
  };
}
