#!/usr/bin/env -S npx tsx

import { spawn } from "node:child_process";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { type BuildContext, context } from "esbuild";
import { type DevChildProcess, terminateChild } from "./dev-process";
import { devWatchSignature } from "./dev-watch";

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
      child.on("error", (error) => {
        console.error(`code-viewer dev: ${command} failed to run:`, error);
        resolve(1);
      });
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

// CLI の入口 (cli.ts) を起こすので、引数が無ければ入口のサーバになる
// (`pnpm dev -- --standalone` で今までの 1 つで完結するサーバ)。入口が起こす
// プロジェクトの裏のプロセスは CODE_VIEWER_DEV を受け継ぎ、親 (入口) が
// 居なくなると 1 秒で終わる。ソースを直すと入口が起き直すので、裏も
// 起き直す (次の要求で入口が起こす)。
function startServer() {
  const args = serverArgs();
  firstStart = false;
  server = spawnDevChild(TSX, [join("web-src", "server", "cli.ts"), ...args]);
}

async function restartServer() {
  if (restarting) return;
  restarting = true;
  const old = server;
  server = null;
  if (old) {
    await terminateChild(old).catch((error: unknown) => {
      console.error("code-viewer dev: stopping the old server failed:", error);
    });
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
  let exitCode = 0;
  const report = (step: string) => (error: unknown) => {
    console.error(`code-viewer dev: ${step} failed during shutdown:`, error);
    exitCode = 1;
  };
  if (child) await terminateChild(child).catch(report("stopping the server"));
  if (ctx) await ctx.dispose().catch(report("stopping the web build"));
  process.exit(exitCode);
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

let sig = devWatchSignature(ROOT);
setInterval(() => {
  try {
    const next = devWatchSignature(ROOT);
    if (next === sig) return;
    sig = next;
    console.log("server source changed; restarting preview server");
    restartServer();
  } catch (error) {
    console.warn("watch tick failed:", error);
  }
}, 500);
