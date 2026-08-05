#!/usr/bin/env -S npx tsx

import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { type BuildContext, context } from "esbuild";
import { type DevChildProcess, terminateChild } from "./dev-process";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = normalize(join(HERE, "..", ".."));
const SERVER_ROOT = join(ROOT, "web-src", "server");
const DEFAULT_DEV_PORT = 64160;
/** 実行に使う TypeScript ローダ。npx を挟むと毎回の再起動が目に見えて遅い。 */
const TSX = join(ROOT, "node_modules", ".bin", "tsx");

let server: DevChildProcess | null = null;
/** ブラウザ側バンドルの watch。子プロセスではなく esbuild の常駐 context。 */
let buildCtx: BuildContext | null = null;
let restarting = false;
let shuttingDown = false;
let firstStart = true;

function withDefaultPort(args: string[]) {
  if (args.includes("--port")) return args;
  return ["--port", String(DEFAULT_DEV_PORT), ...args];
}

function withoutOpen(args: string[]) {
  return args.filter((arg) => arg !== "--open");
}

function serverArgs() {
  const args = withDefaultPort(process.argv.slice(2));
  return firstStart ? args : withoutOpen(args);
}

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      out.push(...walkTsFiles(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function watchedFiles() {
  return walkTsFiles(SERVER_ROOT).concat(
    walkTsFiles(join(ROOT, "web-src", "core")),
  );
}

function fileSignature(file: string): string {
  // A watched file may disappear mid-flight (branch switch, rename);
  // that must never crash the watcher loop and orphan the children.
  try {
    return `${file}:${statSync(file).mtimeMs}`;
  } catch {
    return `${file}:missing`;
  }
}

function watchSignature() {
  return watchedFiles().map(fileSignature).join("|");
}

/** Node の子プロセスを dev-process の扱える形 (kill / exited) に包む。 */
function spawnDevChild(command: string, args: string[]): DevChildProcess {
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, CODE_VIEWER_DEV: "1" },
  });
  return {
    kill: (signal?: string) => child.kill(signal as NodeJS.Signals | undefined),
    exited: new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 0));
      child.on("error", () => resolve(1));
    }),
  };
}

async function startBuild() {
  buildCtx = await context({
    entryPoints: [join(ROOT, "web-src", "app.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: join(ROOT, "web", "app.js"),
    charset: "utf8",
    logLevel: "info",
  });
  await buildCtx.watch();
}

function startServer() {
  const args = serverArgs();
  firstStart = false;
  server = spawnDevChild(TSX, [
    join("web-src", "server", "preview.ts"),
    ...args,
  ]);
}

async function restartServer() {
  if (restarting) return;
  restarting = true;
  const old = server;
  server = null;
  if (old) {
    await terminateChild(old).catch(() => 1);
  }
  startServer();
  restarting = false;
}

function killChildren() {
  if (server) server.kill("SIGTERM");
}

function forceKillChildren() {
  if (server) server.kill("SIGKILL");
}

async function shutdown() {
  if (shuttingDown) {
    forceKillChildren();
    process.exit(1);
  }
  shuttingDown = true;
  const child = server;
  server = null;
  const ctx = buildCtx;
  buildCtx = null;
  if (child) await terminateChild(child).catch(() => undefined);
  if (ctx) await ctx.dispose().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("SIGHUP", () => void shutdown());
// Crash paths (uncaught exceptions and the like) bypass the signal
// handlers; the exit hook keeps children from being orphaned there too.
process.on("exit", killChildren);

console.log(`code-viewer dev server watching ${SERVER_ROOT}`);
await startBuild();
startServer();

let sig = watchSignature();
setInterval(() => {
  try {
    const next = watchSignature();
    if (next === sig) return;
    sig = next;
    console.log("server source changed; restarting preview server");
    restartServer();
  } catch (error) {
    console.warn(`watch tick failed: ${String(error)}`);
  }
}, 500);
