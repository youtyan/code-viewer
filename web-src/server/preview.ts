#!/usr/bin/env bun

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, join, normalize, relative } from 'node:path';
import type { DiffMeta, FileDiffResponse, FileMeta, FileRangeResponse } from '../types';
import * as git from './git';

const ROOT = normalize(join(import.meta.dir, '..', '..'));
const WEB_ROOT = join(ROOT, 'web');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string;
const DEFAULT_ARGS = ['HEAD'];
const PREVIEW_HUNKS_DEFAULT = 3;
const WATCHED_ASSET_FILES = ['index.html', 'style.css', 'app.js'];
const SIZE_SMALL = 2000;
const SIZE_MEDIUM = 8000;
const SIZE_LARGE = 20000;

let generation = 1;
let cwd = git.repoRoot(process.cwd()) || process.cwd();
let cliArgs = DEFAULT_ARGS;

const enc = new TextEncoder();
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const fileCache = new Map<string, string>();
const metaCache = new Map<string, { body: string; sig: string }>();

function parseCli() {
  const rest: string[] = [];
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(`code-viewer ${VERSION}

Usage:
  code-viewer [--cwd <repo>] [--open] [git-diff-args...]

Examples:
  code-viewer --open
  code-viewer --cwd /path/to/repo --open
  code-viewer HEAD~1 HEAD
  code-viewer --staged
`);
      process.exit(0);
    } else if (arg === '--version' || arg === '-v') {
      console.log(VERSION);
      process.exit(0);
    } else if (arg === '--cwd') {
      const next = process.argv[++i];
      if (!next) {
        console.error('--cwd requires a value');
        process.exit(1);
      }
      cwd = git.repoRoot(next) || cwd;
    } else if (arg === '--open') {
      setTimeout(() => openBrowser(`http://127.0.0.1:${server.port}/`), 0);
    } else {
      rest.push(arg);
    }
  }
  if (rest.length) cliArgs = rest;
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function requestAllowed(req: Request) {
  const host = req.headers.get('host') || '';
  const origin = req.headers.get('origin');
  const okHost = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(host);
  const okOrigin = !origin || origin === 'null' || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(origin);
  return okHost && okOrigin;
}

function staticFile(pathname: string): Response | null {
  const map: Record<string, [string, string]> = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
    '/vendor/diff2html/diff2html.min.css': ['vendor/diff2html/diff2html.min.css', 'text/css; charset=utf-8'],
    '/vendor/diff2html/diff2html-ui.min.js': ['vendor/diff2html/diff2html-ui.min.js', 'application/javascript; charset=utf-8'],
    '/vendor/highlight.js/highlight.min.js': ['vendor/highlight.js/highlight.min.js', 'application/javascript; charset=utf-8'],
    '/vendor/highlight.js/styles/github.min.css': ['vendor/highlight.js/styles/github.min.css', 'text/css; charset=utf-8'],
    '/vendor/highlight.js/styles/github-dark.min.css': ['vendor/highlight.js/styles/github-dark.min.css', 'text/css; charset=utf-8'],
  };
  const spec = map[pathname];
  if (!spec) return null;
  const full = join(WEB_ROOT, spec[0]);
  if (!existsSync(full)) return text('not found', 404);
  return new Response(readFileSync(full), {
    headers: { 'Content-Type': spec[1], 'Cache-Control': 'no-store' },
  });
}

function buildRangeArgs(range: { from?: string; to?: string }) {
  const refs = [];
  if (range.from && range.from !== 'worktree') refs.push(range.from);
  if (range.to && range.to !== 'worktree') refs.push(range.to);
  return { args: refs.length ? refs : cliArgs, refs };
}

function includeUntracked(range: { from?: string; to?: string }, refs: string[]) {
  const toWorktree = !range.to || range.to === 'worktree';
  if (refs.length > 0) return toWorktree && refs.length < 2;
  return cliArgs.length === 0 || (cliArgs.length === 1 && cliArgs[0] === 'HEAD');
}

function guessMediaKind(path: string) {
  const ext = extname(path).slice(1).toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  return null;
}

function classify(file: git.GitFileMeta) {
  if (file.binary) return 'binary';
  const total = (file.additions || 0) + (file.deletions || 0);
  if (total <= SIZE_SMALL) return 'small';
  if (total <= SIZE_MEDIUM) return 'medium';
  if (total <= SIZE_LARGE) return 'large';
  return 'huge';
}

function estimateHeight(file: git.GitFileMeta, sizeClass: string) {
  if (file.binary) return 380;
  if (sizeClass === 'small') return Math.min(800, ((file.additions || 0) + (file.deletions || 0) + 10) * 22);
  return 140;
}

function buildQuery(params: Record<string, unknown>) {
  const q = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

function fileToMeta(file: git.GitFileMeta, range: { from?: string; to?: string }, extraQs: Record<string, string>): FileMeta {
  const sizeClass = classify(file);
  const q = { path: file.path, old_path: file.old_path, status: file.status, from: range.from, to: range.to, ...extraQs };
  if (file.untracked) Object.assign(q, { untracked: '1' });
  const previewQ = { ...q, mode: 'preview', max_hunks: PREVIEW_HUNKS_DEFAULT };
  const previewUrl = sizeClass === 'large' || sizeClass === 'huge' ? `/file_diff${buildQuery(previewQ)}` : null;
  return {
    order: file.order,
    key: `${file.status || 'M'}\0${file.old_path || ''}\0${file.path}`,
    path: file.path,
    old_path: file.old_path,
    display_path: file.path,
    status: file.status || 'M',
    additions: file.additions || 0,
    deletions: file.deletions || 0,
    binary: file.binary || false,
    media_kind: guessMediaKind(file.path),
    size_class: sizeClass,
    force_layout: sizeClass === 'large' || sizeClass === 'huge' ? 'line-by-line' : undefined,
    highlight: sizeClass === 'small',
    load_url: `/file_diff${buildQuery(q)}`,
    preview_url: previewUrl,
    estimated_height_px: estimateHeight(file, sizeClass),
    untracked: file.untracked || false,
  };
}

function computePayload(extras: string[], range: { from?: string; to?: string }): DiffMeta {
  const { args, refs } = buildRangeArgs(range);
  const fullArgs = [...extras, ...args];
  const files = git.fileMeta(fullArgs, cwd, false);
  if (includeUntracked(range, refs)) files.push(...git.untrackedMeta(cwd));
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  files.forEach((file, i) => { file.order = i + 1; });
  const extraQs: Record<string, string> = {};
  for (const e of extras) {
    if (e === '-w' || e === '--ignore-all-space') extraQs.ignore_ws = '1';
    if (e === '--ignore-blank-lines') extraQs.ignore_blank = '1';
  }
  const meta = files.map((file) => fileToMeta(file, range, extraQs));
  const totals = meta.reduce((acc, file) => {
    acc.additions += file.additions || 0;
    acc.deletions += file.deletions || 0;
    return acc;
  }, { files: meta.length, additions: 0, deletions: 0 });
  const toWorktree = !range.to || range.to === 'worktree';
  const label = refs.length ? `${refs.join(' .. ')}${toWorktree && refs.length === 1 ? ' .. worktree' : ''}` : cliArgs.join(' ');
  return { files: meta, totals, range: label || 'HEAD', project: basename(cwd), branch: git.currentBranch(cwd) || undefined, generation };
}

function handleDiffJson(url: URL) {
  const extras = [];
  if (url.searchParams.get('ignore_ws') === '1') extras.push('-w');
  if (url.searchParams.get('ignore_blank') === '1') extras.push('--ignore-blank-lines');
  const range = { from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '' };
  const key = `${range.from}|${range.to}|${url.searchParams.get('ignore_ws') || ''}|${url.searchParams.get('ignore_blank') || ''}`;
  if (url.searchParams.get('nocache') === '1') {
    const payload = computePayload(extras, range);
    const sig = JSON.stringify({ ...payload, generation: undefined });
    const cached = metaCache.get(key);
    if (!cached || cached.sig !== sig) {
      generation++;
      payload.generation = generation;
      metaCache.clear();
      fileCache.clear();
    }
    const body = JSON.stringify(payload);
    metaCache.set(key, { body, sig });
    return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const cached = metaCache.get(key);
  if (cached) return new Response(cached.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  const payload = computePayload(extras, range);
  const body = JSON.stringify(payload);
  metaCache.set(key, { body, sig: JSON.stringify({ ...payload, generation: undefined }) });
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function safePath(path: string) {
  return path && !path.includes('../') && !path.includes('..\\') && !path.startsWith('/') && !path.startsWith('\\');
}

function safeWorktreePath(path: string): string | null {
  if (!safePath(path)) return null;
  const full = join(cwd, path);
  if (!existsSync(full)) return null;
  const realCwd = realpathSync(cwd);
  const realFull = realpathSync(full);
  const rel = relative(realCwd, realFull);
  if (rel === '' || rel.startsWith('..') || rel.startsWith('/') || rel.startsWith('\\')) return null;
  return realFull;
}

function handleFileDiff(url: URL) {
  const path = url.searchParams.get('path') || '';
  if (!safePath(path)) return text('invalid path', 400);
  const extras = [];
  if (url.searchParams.get('ignore_ws') === '1') extras.push('-w');
  if (url.searchParams.get('ignore_blank') === '1') extras.push('--ignore-blank-lines');
  const isUntracked = url.searchParams.get('untracked') === '1';
  const range = { from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '' };
  const { args } = buildRangeArgs(range);
  const oldPath = url.searchParams.get('old_path');
  const cacheKey = isUntracked
    ? `u\0${path}\0${extras.join('\0')}`
    : `t\0${path}\0${oldPath || ''}\0${[...extras, ...args].join('\0')}`;
  let diffText = fileCache.get(cacheKey);
  let errText = '';
  if (!diffText) {
    if (isUntracked) {
      diffText = git.untrackedFileDiff(extras, path, cwd).stdout || '';
    } else {
      const res = git.fileDiffText([...extras, ...args], oldPath ? [oldPath, path] : path, cwd);
      diffText = res.stdout || '';
      if (res.code !== 0) errText = res.stderr;
    }
    fileCache.set(cacheKey, diffText);
  }
  const mode = url.searchParams.get('mode') || 'full';
  const truncated = mode === 'preview'
    ? git.truncateToNHunks(diffText, Number(url.searchParams.get('max_hunks')) || PREVIEW_HUNKS_DEFAULT)
    : git.truncateToNHunks(diffText, 1e9);
  const body: FileDiffResponse & { line_count?: number; error?: string } = {
    path,
    old_path: url.searchParams.get('old_path') || '',
    status: url.searchParams.get('status') || '',
    mode,
    diff: truncated.text,
    hunk_count: truncated.totalHunks,
    rendered_hunk_count: truncated.renderedHunks,
    line_count: truncated.lineCount,
    truncated: mode === 'preview' && truncated.totalHunks > truncated.renderedHunks,
    binary: diffText.includes('Binary files'),
    error: errText,
    generation,
  };
  return json(body);
}

function handleFileRange(url: URL) {
  const path = url.searchParams.get('path') || '';
  if (!safePath(path)) return text('invalid path', 400);
  let start = Number(url.searchParams.get('start') || '1') || 1;
  let end = Number(url.searchParams.get('end') || url.searchParams.get('endline') || '0') || 0;
  if (start < 1) start = 1;
  if (end < start) end = start;
  const ref = url.searchParams.get('ref') || 'worktree';
  let content = '';
  if (ref === 'worktree' || ref === '') {
    const full = safeWorktreePath(path);
    if (!full) return text('no file', 404);
    content = readFileSync(full, 'utf8');
  } else {
    const res = git.show(ref, path, cwd);
    if (res.code !== 0) return text('not in ref', 404);
    content = res.stdout;
  }
  const lines: string[] = [];
  const all = `${content}\n`.split('\n');
  for (let i = start; i <= end && i <= all.length; i++) lines.push(all[i - 1]);
  const body: FileRangeResponse = { path, ref, start, end, lines, total: Math.min(all.length, end + 1), generation };
  return json(body);
}

function handleRawFile(url: URL) {
  const path = url.searchParams.get('path') || '';
  if (!safePath(path)) return text('forbidden', 403);
  const ref = url.searchParams.get('ref') || 'worktree';
  let body: BodyInit;
  if (ref !== 'worktree' && ref !== '') {
    const res = git.show(ref, path, cwd);
    if (res.code !== 0) return text('not in ref', 404);
    body = res.stdout;
  } else {
    const full = safeWorktreePath(path);
    if (!full) return text('not found', 404);
    body = new Uint8Array(readFileSync(full));
  }
  const mime: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
  };
  return new Response(body, { headers: { 'Content-Type': mime[extname(path).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' } });
}

function sendSse(event: string, data = 'tick') {
  const payload = enc.encode(`event: ${event}\ndata: ${data}\n\n`);
  for (const client of [...sseClients]) {
    try { client.enqueue(payload); } catch { sseClients.delete(client); }
  }
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['cmd.exe', '/c', 'start', '', url]
      : ['xdg-open', url];
  Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' });
}

parseCli();

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req) {
    if (!requestAllowed(req)) return text('forbidden', 403);
    const url = new URL(req.url);
    const staticResponse = staticFile(url.pathname);
    if (staticResponse) return staticResponse;
    if (url.pathname === '/diff.json') return handleDiffJson(url);
    if (url.pathname === '/file_diff') return handleFileDiff(url);
    if (url.pathname === '/file_range') return handleFileRange(url);
    if (url.pathname === '/_file') return handleRawFile(url);
    if (url.pathname === '/_refs') return json(git.refs(cwd));
    if (url.pathname === '/_asset_version') {
      const version = Math.max(...WATCHED_ASSET_FILES.map((name) => statSync(join(WEB_ROOT, name)).mtimeMs));
      return json({ version });
    }
    if (url.pathname === '/refresh' && req.method === 'POST') {
      generation++;
      fileCache.clear();
      metaCache.clear();
      sendSse('update');
      return json({ ok: true, generation });
    }
    if (url.pathname === '/events') {
      let ctrl: ReadableStreamDefaultController<Uint8Array>;
      let keepalive: ReturnType<typeof setInterval>;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          ctrl = controller;
          sseClients.add(controller);
          controller.enqueue(enc.encode('event: open\ndata: ok\n\n'));
          keepalive = setInterval(() => {
            try {
              controller.enqueue(enc.encode(': ping\n\n'));
            } catch {
              sseClients.delete(controller);
              clearInterval(keepalive);
            }
          }, 15000);
        },
        cancel() {
          if (ctrl) sseClients.delete(ctrl);
          if (keepalive) clearInterval(keepalive);
        },
      }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }
    return text('not found', 404);
  },
});

console.log(`GDP_LISTEN_URL=http://127.0.0.1:${server.port}/`);
console.log(`git-diff-preview serving ${cwd}`);
