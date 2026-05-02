#!/usr/bin/env bun

import { readdirSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

const ROOT = normalize(join(import.meta.dir, '..', '..'));
const SERVER_ROOT = join(ROOT, 'web-src', 'server');
const DEFAULT_DEV_PORT = 64160;

type ChildProcess = {
  kill(signal?: string): void;
  exited: Promise<number>;
};

let server: ChildProcess | null = null;
let build: ChildProcess | null = null;
let restarting = false;
let firstStart = true;

function withDefaultPort(args: string[]) {
  if (args.includes('--port')) return args;
  return ['--port', String(DEFAULT_DEV_PORT), ...args];
}

function withoutOpen(args: string[]) {
  return args.filter((arg) => arg !== '--open');
}

function serverArgs() {
  const args = withDefaultPort(process.argv.slice(2));
  return firstStart ? args : withoutOpen(args);
}

function watchedFiles() {
  return readdirSync(SERVER_ROOT)
    .filter((name) => name.endsWith('.ts') && name !== 'runtime.d.ts')
    .map((name) => join(SERVER_ROOT, name))
    .concat(join(ROOT, 'web-src', 'types.ts'));
}

function watchSignature() {
  return watchedFiles()
    .map((file) => `${file}:${statSync(file).mtimeMs}`)
    .join('|');
}

function startBuild() {
  build = Bun.spawn([
    'bun', 'build', '--watch', '--target=browser', '--format=iife',
    '--outfile=web/app.js', 'web-src/app.ts',
  ], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' }) as ChildProcess;
}

function startServer() {
  const args = serverArgs();
  firstStart = false;
  server = Bun.spawn([
    'bun', 'run', 'web-src/server/preview.ts', ...args,
  ], {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, CODE_VIEWER_DEV: '1' },
  }) as ChildProcess;
}

async function restartServer() {
  if (restarting) return;
  restarting = true;
  const old = server;
  server = null;
  if (old) {
    old.kill();
    await old.exited.catch(() => 1);
  }
  startServer();
  restarting = false;
}

function shutdown() {
  if (server) server.kill();
  if (build) build.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`code-viewer dev server watching ${SERVER_ROOT}`);
startBuild();
startServer();

let sig = watchSignature();
setInterval(() => {
  const next = watchSignature();
  if (next === sig) return;
  sig = next;
  console.log('server source changed; restarting preview server');
  restartServer();
}, 500);
