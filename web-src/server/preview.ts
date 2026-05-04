#!/usr/bin/env bun

import { closeSync, constants, existsSync, lstatSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, relative } from 'node:path';
import { APP_ENTRY_PATHS, SPA_PATHS } from '../routes';
import type { DiffMeta, FileDiffResponse, FileMeta, FileRangeResponse, FileSearchListResponse, GrepMatch, GrepResponse, RepoTreeResponse, SettingsResponse } from '../types';
import { cacheFresh, fileDiffCacheKey, setTimedCacheEntry, type TimedCacheEntry } from './cache';
import { startDevAssetReload } from './dev-assets';
import * as git from './git';
import { isSameWorktreeRange } from './range';
import {
  GREP_MAX_FILE_BYTES,
  buildFileSearchList,
  buildRgArgs,
  fixedStringLineMatches,
  isSkippableSearchPath,
  normalizeGrepMax,
  parseGitGrepOutput,
  parseRgOutput,
} from './search';

const ROOT = normalize(join(import.meta.dir, '..', '..'));
const WEB_ROOT = join(ROOT, 'web');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string;
const DEFAULT_ARGS = ['HEAD'];
const PREVIEW_HUNKS_DEFAULT = 3;
const PREVIEW_LINES_DEFAULT = 1200;
const WATCHED_ASSET_FILES = ['index.html', 'style.css', 'app.js'];
const SIZE_SMALL = 2000;
const SIZE_MEDIUM = 8000;
const SIZE_LARGE = 20000;
const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_TOTAL_BYTES + 1024 * 1024;
const MAX_UPLOAD_FILES = 50;
const SAFE_UPLOAD_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.yaml', '.yml', '.toml',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf',
  '.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.html',
]);

let generation = 1;
let cwd = git.repoRoot(process.cwd()) || process.cwd();
let cliArgs = DEFAULT_ARGS;
let listenPort = 0;
let allowUpload = false;
let uploadAllowedByCli = false;
let scopeOmitDirNames = git.DEFAULT_WORKTREE_OMIT_DIR_NAMES;
let scopeOmitDirCliOverride: string[] | null = null;
let rgAvailableCache: boolean | null = null;

const enc = new TextEncoder();
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const fileCache = new Map<string, TimedCacheEntry<{ diffText: string }>>();
const metaCache = new Map<string, TimedCacheEntry<{ body: string; sig: string }>>();
const fileListCache = new Map<string, { generation: number; body: FileSearchListResponse }>();

function parseCli() {
  const rest: string[] = [];
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(`code-viewer ${VERSION}

Usage:
  code-viewer [--cwd <repo>] [--port <port>] [--open] [git-diff-args...]

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
      try {
        cwd = git.repoRoot(next) || realpathSync(next);
      } catch {
        console.error('--cwd must point to an existing directory');
        process.exit(1);
      }
    } else if (arg === '--port') {
      const next = process.argv[++i];
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        console.error('--port requires a TCP port number');
        process.exit(1);
      }
      listenPort = parsed;
    } else if (arg === '--open') {
      setTimeout(() => openBrowser(`http://127.0.0.1:${server.port}/`), 0);
    } else if (arg === '--allow-upload') {
      allowUpload = true;
      uploadAllowedByCli = true;
    } else if (arg === '--scope-omit-dir') {
      const next = process.argv[++i];
      if (!next) {
        console.error('--scope-omit-dir requires a directory name');
        process.exit(1);
      }
      scopeOmitDirCliOverride = normalizeScopeOmitDirNames([...(scopeOmitDirCliOverride || []), next]);
    } else {
      rest.push(arg);
    }
  }
  if (rest.length) cliArgs = rest;
  if (!uploadAllowedByCli) allowUpload = loadProjectConfigUploadEnabled();
  const configScopeOmitDirs = loadProjectConfigScopeOmitDirs();
  if (scopeOmitDirCliOverride) {
    scopeOmitDirNames = scopeOmitDirCliOverride;
  } else if (configScopeOmitDirs) {
    scopeOmitDirNames = configScopeOmitDirs;
  }
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

function sideEffectRequestAllowed(req: Request) {
  const host = req.headers.get('host') || '';
  const origin = req.headers.get('origin');
  const fetchSite = req.headers.get('sec-fetch-site');
  const requestedBy = req.headers.get('x-code-viewer-action');
  return /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(host) &&
    origin === `http://${host}` &&
    (!fetchSite || fetchSite === 'same-origin') &&
    requestedBy === '1';
}

function staticFile(pathname: string): Response | null {
  const map: Record<string, [string, string]> = {
    '/favicon.png': ['favicon.png', 'image/png'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
    '/mermaid.js': ['mermaid.js', 'application/javascript; charset=utf-8'],
    '/shiki.js': ['shiki.js', 'application/javascript; charset=utf-8'],
    '/vendor/diff2html/diff2html.min.css': ['vendor/diff2html/diff2html.min.css', 'text/css; charset=utf-8'],
    '/vendor/diff2html/diff2html-ui.min.js': ['vendor/diff2html/diff2html-ui.min.js', 'application/javascript; charset=utf-8'],
    '/vendor/highlight.js/highlight.min.js': ['vendor/highlight.js/highlight.min.js', 'application/javascript; charset=utf-8'],
    '/vendor/highlight.js/styles/github.min.css': ['vendor/highlight.js/styles/github.min.css', 'text/css; charset=utf-8'],
    '/vendor/highlight.js/styles/github-dark.min.css': ['vendor/highlight.js/styles/github-dark.min.css', 'text/css; charset=utf-8'],
  };
  for (const spaPath of [...APP_ENTRY_PATHS, ...SPA_PATHS]) {
    map[spaPath] = ['index.html', 'text/html; charset=utf-8'];
  }
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
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'].includes(ext)) return 'audio';
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
  const previewUrl = sizeClass !== 'small' ? `/file_diff${buildQuery(previewQ)}` : null;
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
    force_layout: sizeClass === 'huge' ? 'line-by-line' : undefined,
    highlight: sizeClass === 'small',
    load_url: `/file_diff${buildQuery(q)}`,
    preview_url: previewUrl,
    estimated_height_px: estimateHeight(file, sizeClass),
    untracked: file.untracked || false,
  };
}

function computePayload(extras: string[], range: { from?: string; to?: string }): DiffMeta {
  if (isSameWorktreeRange(range)) {
    return {
      files: [],
      totals: { files: 0, additions: 0, deletions: 0 },
      range: 'worktree .. worktree',
      project: basename(cwd),
      branch: git.currentBranch(cwd) || undefined,
      generation,
    };
  }
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
    setTimedCacheEntry(metaCache, key, { body, sig });
    return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const cached = metaCache.get(key);
  if (cacheFresh(cached)) return new Response(cached.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  const payload = computePayload(extras, range);
  const body = JSON.stringify(payload);
  setTimedCacheEntry(metaCache, key, { body, sig: JSON.stringify({ ...payload, generation: undefined }) });
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function safePath(path: string) {
  if (!path || path.startsWith('/') || path.startsWith('\\') || path.includes('\0')) return false;
  return !path.split(/[\\/]+/).includes('..');
}

function safeRepoPath(path: string) {
  return path === '' || safePath(path);
}

function normalizeScopeOmitDirNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  return [...new Set(names
    .filter((name): name is string => typeof name === 'string')
    .map(name => name.trim())
    .filter(name => name && name.length <= 64 && !name.includes('/') && !name.includes('\\') && !name.includes('\0') && name !== '.' && name !== '..' && name !== '.git'))]
    .sort((a, b) => a.localeCompare(b));
}

function parseScopeOmitDirNamesQuery(value: string): string[] | null {
  const names = value ? value.split(',') : [];
  if (names.length > 100) return null;
  for (const raw of names) {
    const name = raw.trim();
    if (!name || name.length > 64 || name.includes('/') || name.includes('\\') || name.includes('\0') || name === '.' || name === '..' || name === '.git') return null;
  }
  return normalizeScopeOmitDirNames(names);
}

function loadProjectConfig(): Record<string, unknown> | null {
  const full = join(cwd, '.code-viewer.json');
  if (!existsSync(full)) return null;
  let realCwd: string;
  let realConfig: string;
  try {
    realCwd = realpathSync(cwd);
    realConfig = realpathSync(full);
  } catch {
    return null;
  }
  if (dirname(realConfig) !== realCwd || basename(realConfig) !== '.code-viewer.json') return null;
  try {
    const parsed = JSON.parse(readFileSync(realConfig, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'version' in parsed && (parsed as { version?: unknown }).version !== 1) return null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function loadProjectConfigUploadEnabled(): boolean {
  const config = loadProjectConfig() as { upload?: { enabled?: unknown } } | null;
  return config?.upload?.enabled === true;
}

function loadProjectConfigScopeOmitDirs(): string[] | null {
  const config = loadProjectConfig() as { scope?: { omitDirs?: unknown } } | null;
  if (!config?.scope || !Array.isArray(config.scope.omitDirs)) return null;
  return normalizeScopeOmitDirNames(config.scope.omitDirs);
}

function scopeOmitDirNamesFromQuery(url: URL): string[] {
  if (!url.searchParams.has('omit_dirs')) return scopeOmitDirNames;
  return parseScopeOmitDirNamesQuery(url.searchParams.get('omit_dirs') || '') || scopeOmitDirNames;
}

function invalidScopeOmitDirNamesQuery(url: URL): boolean {
  return url.searchParams.has('omit_dirs') && !parseScopeOmitDirNamesQuery(url.searchParams.get('omit_dirs') || '');
}

function isGitInternalPath(path: string): boolean {
  return path.split(/[\\/]+/).some(part => part.toLowerCase() === '.git');
}

function safeWorktreePath(path: string): string | null {
  if (!safePath(path)) return null;
  if (isGitInternalPath(path)) return null;
  const full = join(cwd, path);
  if (!existsSync(full)) return null;
  let realCwd: string;
  let realFull: string;
  try {
    realCwd = realpathSync(cwd);
    realFull = realpathSync(full);
  } catch {
    return null;
  }
  const rel = relative(realCwd, realFull);
  if (rel === '' || rel.startsWith('..') || rel.startsWith('/') || rel.startsWith('\\')) return null;
  if (isGitInternalPath(rel)) return null;
  return realFull;
}

function safeOpenWorktreePath(path: string): string | null {
  if (path === '') {
    try {
      const realCwd = realpathSync(cwd);
      if (isGitInternalPath(realCwd)) return null;
      return realCwd;
    } catch {
      return null;
    }
  }
  return safeWorktreePath(path);
}

function parentRepoPath(path: string): string {
  const parent = dirname(path);
  return parent === '.' ? '' : parent;
}

function readReadme(target: string, dirPath: string): RepoTreeResponse['readme'] {
  const candidates = ['README.md', 'readme.md', 'README.markdown', 'README'];
  for (const name of candidates) {
    const path = dirPath ? `${dirPath}/${name}` : name;
    if (target === 'worktree' || target === '') {
      const full = safeWorktreePath(path);
      if (!full) continue;
      try {
        return { path, text: readFileSync(full, 'utf8') };
      } catch {
        continue;
      }
    }
    const res = git.show(target, path, cwd);
    if (res.code === 0) return { path, text: res.stdout };
  }
  return null;
}

function handleTree(url: URL) {
  const target = url.searchParams.get('ref') || url.searchParams.get('target') || 'worktree';
  const path = (url.searchParams.get('path') || '').replace(/^\/+|\/+$/g, '');
  if (!safeRepoPath(path)) return text('invalid path', 400);
  if ((target === 'worktree' || target === '') && isGitInternalPath(path)) return text('forbidden', 403);
  if (target !== 'worktree' && !git.verifyTreeRef(target, cwd)) return text('invalid target', 400);
  const recursive = url.searchParams.get('recursive') === '1';
  if (invalidScopeOmitDirNamesQuery(url)) return text('invalid omit dirs', 400);
  const entries = git.listTree(target, path, cwd, { recursive, omitDirNames: scopeOmitDirNamesFromQuery(url) }).entries;
  return json({
    ref: target,
    path,
    project: basename(cwd),
    branch: git.currentBranch(cwd) || undefined,
    entries,
    readme: readReadme(target, path),
    upload_enabled: allowUpload && (target === 'worktree' || target === ''),
  } satisfies RepoTreeResponse);
}

function handleSettings() {
  return json({
    project: basename(cwd),
    scope: {
      omit_dirs_effective: scopeOmitDirNames,
      omit_dirs_built_in: git.DEFAULT_WORKTREE_OMIT_DIR_NAMES,
      max_entries: git.WORKTREE_RECURSIVE_ENTRY_LIMIT,
    },
  } satisfies SettingsResponse);
}

function handleFiles(url: URL) {
  const target = url.searchParams.get('ref') || url.searchParams.get('target') || 'worktree';
  if (target !== 'worktree' && !git.verifyTreeRef(target, cwd)) return text('invalid target', 400);
  if (invalidScopeOmitDirNamesQuery(url)) return text('invalid omit dirs', 400);
  const omitDirNames = scopeOmitDirNamesFromQuery(url);
  const key = `${target || 'worktree'}\0${omitDirNames.join('\0')}`;
  const cached = fileListCache.get(key);
  if (cached && cached.generation === generation) return json(cached.body);
  const ref = target || 'worktree';
  const entries = git.listTree(ref, '', cwd, { recursive: true, omitDirNames }).entries;
  const body = buildFileSearchList(ref, generation, entries);
  fileListCache.set(key, { generation, body });
  return json(body);
}

function parseGrepPaths(url: URL, omitDirNames: string[]): string[] {
  return url.searchParams.getAll('path').filter(path => safePath(path) && !isGitInternalPath(path) && !isSkippableSearchPath(path, omitDirNames));
}

function rgAvailable(): boolean {
  if (rgAvailableCache !== null) return rgAvailableCache;
  const proc = Bun.spawnSync(['rg', '--version'], { cwd, stdout: 'pipe', stderr: 'pipe' });
  rgAvailableCache = proc.exitCode === 0;
  return rgAvailableCache;
}

function grepWorktreeFallback(query: string, max: number, paths: string[], omitDirNames: string[]): GrepMatch[] {
  const candidates = paths.length ? paths : git.worktreeFiles(cwd).map(entry => entry.path);
  const matches: GrepMatch[] = [];
  for (const path of candidates) {
    if (matches.length >= max) break;
    if (!safePath(path) || isGitInternalPath(path) || isSkippableSearchPath(path, omitDirNames)) continue;
    const full = safeWorktreePath(path);
    if (!full) continue;
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > GREP_MAX_FILE_BYTES) continue;
    let data: Buffer;
    try {
      data = readFileSync(full);
    } catch {
      continue;
    }
    if (data.subarray(0, 8192).includes(0)) continue;
    matches.push(...fixedStringLineMatches(path, data.toString('utf8'), query, max - matches.length));
  }
  return matches;
}

function grepWorktree(query: string, max: number, paths: string[], regex: boolean, omitDirNames: string[]): GrepResponse {
  if (rgAvailable()) {
    const safePaths = paths.filter(path => safePath(path) && !isGitInternalPath(path) && !isSkippableSearchPath(path, omitDirNames) && safeWorktreePath(path));
    const args = buildRgArgs(query, max, safePaths, regex, omitDirNames);
    const proc = Bun.spawnSync(args, { cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', timeout: 5000, killSignal: 'SIGKILL' });
    const stdout = new TextDecoder().decode(proc.stdout);
    const matches = parseRgOutput(stdout, max, omitDirNames)
      .filter(match => safePath(match.path) && !isGitInternalPath(match.path) && !isSkippableSearchPath(match.path, omitDirNames) && !!safeWorktreePath(match.path));
    return { ref: 'worktree', engine: 'rg', truncated: matches.length >= max, matches };
  }
  if (regex) return { ref: 'worktree', engine: 'fallback', truncated: false, matches: [] };
  const matches = grepWorktreeFallback(query, max, paths, omitDirNames);
  return { ref: 'worktree', engine: 'fallback', truncated: matches.length >= max, matches };
}

function grepTreeRef(ref: string, query: string, max: number, paths: string[], regex: boolean, omitDirNames: string[]): GrepResponse {
  const safePaths = paths.filter(path => safePath(path) && !isGitInternalPath(path) && !isSkippableSearchPath(path, omitDirNames));
  const args = [
    'git', '-c', 'core.quotepath=false', 'grep',
    '-n', '--column', '-i', regex ? '-E' : '-F', '--no-color',
    '-e', query,
    ref, '--',
    ...safePaths,
  ];
  const proc = Bun.spawnSync(args, { cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', timeout: 5000, killSignal: 'SIGKILL' });
  const stdout = new TextDecoder().decode(proc.stdout);
  const matches = parseGitGrepOutput(stdout, ref, max, omitDirNames).slice(0, max);
  return { ref, engine: 'git', truncated: matches.length >= max, matches };
}

function handleGrep(url: URL) {
  const query = url.searchParams.get('q') || '';
  const ref = url.searchParams.get('ref') || 'worktree';
  const max = normalizeGrepMax(url.searchParams.get('max'));
  if (invalidScopeOmitDirNamesQuery(url)) return text('invalid omit dirs', 400);
  const omitDirNames = scopeOmitDirNamesFromQuery(url);
  const paths = parseGrepPaths(url, omitDirNames);
  const regex = url.searchParams.get('regex') === '1';
  if (!query.trim()) return json({ ref, engine: ref === 'worktree' ? 'fallback' : 'git', truncated: false, matches: [] } satisfies GrepResponse);
  if (ref === 'worktree' || ref === '') return json(grepWorktree(query, max, paths, regex, omitDirNames));
  if (!git.verifyTreeRef(ref, cwd)) return text('invalid target', 400);
  return json(grepTreeRef(ref, query, max, paths, regex, omitDirNames));
}

function handleFileDiff(url: URL) {
  const path = url.searchParams.get('path') || '';
  if (!safePath(path)) return text('invalid path', 400);
  const extras = [];
  if (url.searchParams.get('ignore_ws') === '1') extras.push('-w');
  if (url.searchParams.get('ignore_blank') === '1') extras.push('--ignore-blank-lines');
  const isUntracked = url.searchParams.get('untracked') === '1';
  const range = { from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '' };
  if (isSameWorktreeRange(range)) {
    return json({
      path,
      old_path: url.searchParams.get('old_path') || '',
      status: url.searchParams.get('status') || '',
      mode: url.searchParams.get('mode') || 'full',
      diff: '',
      hunk_count: 0,
      rendered_hunk_count: 0,
      line_count: 0,
      truncated: false,
      binary: false,
      generation,
    });
  }
  const { args } = buildRangeArgs(range);
  const oldPath = url.searchParams.get('old_path');
  let cacheKey: string;
  try {
    cacheKey = fileDiffCacheKey({ path, oldPath, isUntracked, range, extras, args, cwd });
  } catch {
    return text('invalid diff range', 400);
  }
  const cached = fileCache.get(cacheKey);
  let diffText: string;
  let errText = '';
  if (cacheFresh(cached)) {
    diffText = cached.diffText;
  } else {
    if (isUntracked) {
      diffText = git.untrackedFileDiff(extras, path, cwd).stdout || '';
    } else {
      const res = git.fileDiffText([...extras, ...args], oldPath ? [oldPath, path] : path, cwd);
      diffText = res.stdout || '';
      if (res.code !== 0) errText = res.stderr;
    }
    setTimedCacheEntry(fileCache, cacheKey, { diffText });
  }
  const mode = url.searchParams.get('mode') || 'full';
  const truncated = mode === 'preview'
    ? git.truncateToNHunks(
      diffText,
      Number(url.searchParams.get('max_hunks')) || PREVIEW_HUNKS_DEFAULT,
      Number(url.searchParams.get('max_lines')) || PREVIEW_LINES_DEFAULT,
    )
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
    truncated: mode === 'preview' && (truncated.totalHunks > truncated.renderedHunks || truncated.lineTruncated),
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
    if (!git.verifyTreeRef(ref, cwd)) return text('invalid ref', 400);
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

function handleRawFile(req: Request, url: URL) {
  const path = url.searchParams.get('path') || '';
  if (!safePath(path)) return text('forbidden', 403);
  const ref = url.searchParams.get('ref') || 'worktree';
  let body: BodyInit;
  if (ref !== 'worktree' && ref !== '') {
    if (!git.verifyTreeRef(ref, cwd)) return text('invalid ref', 400);
    const size = rawFileSize(path, ref);
    if (size == null) return text('not in ref', 404);
    if (req.method === 'HEAD') return new Response(null, { headers: rawFileHeaders(path, size) });
    const res = git.showBytes(ref, path, cwd);
    if (res.code !== 0) return text('not in ref', 404);
    body = res.stdout.buffer.slice(res.stdout.byteOffset, res.stdout.byteOffset + res.stdout.byteLength) as ArrayBuffer;
    return new Response(body, { headers: rawFileHeaders(path, size) });
  } else {
    const full = safeWorktreePath(path);
    if (!full) return text('not found', 404);
    const size = rawFileSize(path, ref);
    if (size == null) return text('not found', 404);
    if (req.method === 'HEAD') return new Response(null, { headers: rawFileHeaders(path, size) });
    const bytes = new Uint8Array(readFileSync(full));
    body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(body, { headers: rawFileHeaders(path, size) });
  }
}

function rawFileSize(path: string, ref: string): number | null {
  if (ref !== 'worktree' && ref !== '') {
    if (!git.verifyTreeRef(ref, cwd)) return null;
    const res = git.objectSize(ref, path, cwd);
    return res.code === 0 ? res.size : null;
  }
  const full = safeWorktreePath(path);
  if (!full) return null;
  try {
    return (statSync(full) as unknown as { size: number }).size;
  } catch {
    return null;
  }
}

function rawFileHeaders(path: string, size: number | null = null): HeadersInit {
  const mime: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime', '.pdf': 'application/pdf',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.opus': 'audio/ogg',
  };
  const headers: Record<string, string> = {
    'Content-Type': mime[extname(path).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  };
  if (size != null) headers['Content-Length'] = String(size);
  return headers;
}

function isForbiddenUploadName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('.') ||
    lower === 'package.json' ||
    lower === 'package-lock.json' ||
    lower === 'bun.lock' ||
    lower === 'bun.lockb' ||
    lower === 'yarn.lock' ||
    lower === 'pnpm-lock.yaml' ||
    lower === 'makefile' ||
    lower === 'dockerfile' ||
    lower.endsWith('.dockerfile') ||
    /^(tsconfig|jsconfig|bunfig|vercel|netlify|wrangler|next|vite|webpack|rollup|esbuild|astro|svelte|tailwind|postcss|babel|prettier|eslint)\./.test(lower) ||
    lower.endsWith('.config.js') ||
    lower.endsWith('.config.jsx') ||
    lower.endsWith('.config.ts') ||
    lower.endsWith('.config.tsx') ||
    lower.endsWith('.config.mjs') ||
    lower.endsWith('.config.cjs') ||
    lower.includes('credential') ||
    lower.includes('secret') ||
    lower.endsWith('.exe') ||
    lower.endsWith('.dll') ||
    lower.endsWith('.dylib') ||
    lower.endsWith('.so') ||
    lower.endsWith('.sh') ||
    lower.endsWith('.bash') ||
    lower.endsWith('.zsh') ||
    lower.endsWith('.fish') ||
    lower.endsWith('.ps1') ||
    lower.endsWith('.bat') ||
    lower.endsWith('.cmd');
}

function safeUploadFileName(name: string): string | null {
  if (!name || name.includes('\0') || name.includes('/') || name.includes('\\')) return null;
  if (name === '.' || name === '..') return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,180}$/.test(name)) return null;
  if (isGitInternalPath(name) || isForbiddenUploadName(name)) return null;
  if (!SAFE_UPLOAD_EXTENSIONS.has(extname(name).toLowerCase())) return null;
  return name;
}

function uploadOpenFlags() {
  return constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0);
}

async function handleUploadFiles(req: Request) {
  if (!allowUpload) return text('upload disabled', 403);
  if (req.method !== 'POST') return text('method not allowed', 405);
  if (!sideEffectRequestAllowed(req)) return text('forbidden', 403);
  if (req.headers.get('content-encoding')) return text('unsupported media type', 415);
  const lengthHeader = req.headers.get('content-length');
  if (!lengthHeader) return text('content length required', 411);
  const length = Number(lengthHeader);
  if (!Number.isSafeInteger(length) || length < 0) return text('invalid content length', 400);
  if (length > MAX_UPLOAD_BODY_BYTES) return text('upload too large', 413);
  const contentType = req.headers.get('content-type') || '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) return text('unsupported media type', 415);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return text('invalid form data', 400);
  }

  const dir = String(form.get('dir') || '').replace(/^\/+|\/+$/g, '');
  if (!safeRepoPath(dir)) return text('invalid dir', 400);
  if (dir && isGitInternalPath(dir)) return text('forbidden', 403);
  const realDir = safeOpenWorktreePath(dir);
  if (!realDir) return text('not found', 404);
  const stats = statSync(realDir) as unknown as { isDirectory(): boolean };
  if (!stats.isDirectory()) return text('not a directory', 400);

  const files = form.getAll('files').filter((item): item is File => item instanceof File);
  if (!files.length) return text('no files', 400);
  if (files.length > MAX_UPLOAD_FILES) return text('too many files', 413);

  let total = 0;
  const names = new Set<string>();
  const uploads: Array<{ file: File; name: string; target: string }> = [];
  for (const file of files) {
    const safeName = safeUploadFileName(file.name);
    if (!safeName) return text('invalid filename', 400);
    const lowerName = safeName.toLowerCase();
    if (names.has(lowerName)) return text('duplicate filename', 409);
    names.add(lowerName);
    if (file.size > MAX_UPLOAD_FILE_BYTES) return text('file too large', 413);
    total += file.size;
    if (total > MAX_UPLOAD_TOTAL_BYTES) return text('upload too large', 413);
    const target = join(realDir, safeName);
    if (relative(realDir, dirname(target)) !== '') return text('invalid filename', 400);
    if (existsSync(target)) return text('file exists', 409);
    uploads.push({ file, name: safeName, target });
  }

  const written: string[] = [];
  try {
    for (const upload of uploads) {
      const fd = openSync(upload.target, uploadOpenFlags(), 0o644);
      try {
        writeFileSync(fd, new Uint8Array(await upload.file.arrayBuffer()));
      } finally {
        closeSync(fd);
      }
      written.push(upload.target);
    }
  } catch (error) {
    for (const path of written) {
      try { unlinkSync(path); } catch { /* best-effort cleanup */ }
    }
    if ((error as { code?: string }).code === 'EEXIST') return text('file exists', 409);
    return text('upload failed', 500);
  }

  generation++;
  fileCache.clear();
  metaCache.clear();
  sendSse('update');
  return json({ ok: true, files: uploads.map(upload => upload.name), generation });
}

function openOsPath(path: string) {
  const cmd = process.platform === 'darwin' ? ['open', '--', path]
    : process.platform === 'win32' ? ['explorer.exe', path]
      : ['xdg-open', path];
  Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' });
}

async function handleOpenPath(req: Request) {
  if (req.method !== 'POST') return text('method not allowed', 405);
  if (!sideEffectRequestAllowed(req)) return text('forbidden', 403);
  const contentType = req.headers.get('content-type') || '';
  if (!/^application\/json(?:;|$)/i.test(contentType)) return text('unsupported media type', 415);
  const length = Number(req.headers.get('content-length') || '0');
  if (length > 1024) return text('payload too large', 413);

  let body: { path?: unknown; kind?: unknown } = {};
  try {
    const raw = await req.text();
    if (raw.length > 1024) return text('payload too large', 413);
    body = JSON.parse(raw);
  } catch {
    return text('invalid json', 400);
  }

  const path = typeof body.path === 'string' ? body.path.replace(/^\/+|\/+$/g, '') : '';
  const kind = body.kind;
  if (kind !== 'directory' && kind !== 'file-parent') return text('invalid kind', 400);
  if (kind === 'file-parent' && !path) return text('invalid path', 400);
  if (!safeRepoPath(path)) return text('invalid path', 400);
  if (path && isGitInternalPath(path)) return text('forbidden', 403);

  const targetPath = kind === 'file-parent' ? parentRepoPath(path) : path;
  const target = safeOpenWorktreePath(targetPath);
  if (!target) return text('not found', 404);

  const stats = statSync(target) as unknown as { isDirectory(): boolean };
  if (!stats.isDirectory()) return text('not a directory', 400);
  openOsPath(target);
  return json({ ok: true });
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
  port: listenPort,
  async fetch(req) {
    if (!requestAllowed(req)) return text('forbidden', 403);
    const url = new URL(req.url);
    const staticResponse = staticFile(url.pathname);
    if (staticResponse) return staticResponse;
    if (url.pathname === '/diff.json') return handleDiffJson(url);
    if (url.pathname === '/_settings') return handleSettings();
    if (url.pathname === '/_tree') return handleTree(url);
    if (url.pathname === '/_files') return handleFiles(url);
    if (url.pathname === '/_grep') return handleGrep(url);
    if (url.pathname === '/file_diff') return handleFileDiff(url);
    if (url.pathname === '/file_range') return handleFileRange(url);
    if (url.pathname === '/_file') return handleRawFile(req, url);
    if (url.pathname === '/_open_path') return handleOpenPath(req);
    if (url.pathname === '/_upload_files') return handleUploadFiles(req);
    if (url.pathname === '/_refs') return json(git.refs(cwd));
    if (url.pathname === '/refresh' && req.method === 'POST') {
      if (!sideEffectRequestAllowed(req)) return text('forbidden', 403);
      generation++;
      fileCache.clear();
      metaCache.clear();
      fileListCache.clear();
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

startDevAssetReload({
  enabled: process.env.CODE_VIEWER_DEV === '1',
  webRoot: WEB_ROOT,
  watchedFiles: WATCHED_ASSET_FILES,
  watch,
  sendReload: () => sendSse('reload'),
});

console.log(`GDP_LISTEN_URL=http://127.0.0.1:${server.port}/`);
console.log(`git-diff-preview serving ${cwd}`);
