#!/usr/bin/env bun

import { readdirSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { terminateChild, terminateChildren } from "./dev-process";

const ROOT = normalize(join(import.meta.dir, "..", ".."));
const SERVER_ROOT = join(ROOT, "web-src", "server");
const DEFAULT_DEV_PORT = 64160;

type ChildProcess = {
  kill(signal?: string): void;
  exited: Promise<number>;
};

let server: ChildProcess | null = null;
let build: ChildProcess | null = null;
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
    } else if (name.endsWith(".ts") && name !== "runtime.d.ts") {
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

function startBuild() {
  build = Bun.spawn(
    [
      "bun",
      "build",
      "--watch",
      "--target=browser",
      "--format=iife",
      "--outfile=web/app.js",
      "web-src/app.ts",
    ],
    { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
  ) as ChildProcess;
}

function startServer() {
  const args = serverArgs();
  firstStart = false;
  server = Bun.spawn(["bun", "run", "web-src/server/preview.ts", ...args], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, CODE_VIEWER_DEV: "1" },
  }) as ChildProcess;
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
  if (build) build.kill("SIGTERM");
}

function forceKillChildren() {
  if (server) server.kill("SIGKILL");
  if (build) build.kill("SIGKILL");
}

async function shutdown() {
  if (shuttingDown) {
    forceKillChildren();
    process.exit(1);
  }
  shuttingDown = true;
  const children = [server, build].filter((child): child is ChildProcess =>
    Boolean(child),
  );
  server = null;
  build = null;
  await terminateChildren(children).catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("SIGHUP", () => void shutdown());
// Crash paths (uncaught exceptions and the like) bypass the signal
// handlers; the exit hook keeps children from being orphaned there too.
process.on("exit", killChildren);

console.log(`code-viewer dev server watching ${SERVER_ROOT}`);
startBuild();
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
