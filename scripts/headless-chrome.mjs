// 使い捨てのプロファイルの headless Chrome と、CDP の接続 (Node の組み込みの
// WebSocket)。利用者のブラウザには触らない。
// 使う所: scripts/help-captures.mjs (ヘルプの撮影)・scripts/ui-check.mjs (画面の確認)。

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 空いているポートを 1 つ返す。 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** CHROME_PATH が無いときに探す場所 (macOS と Linux の既定)。 */
export const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function chromePath() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv))
      throw new Error(`CHROME_PATH points to a missing file: ${fromEnv}`);
    return fromEnv;
  }
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found)
    throw new Error(
      `no Chrome found: set CHROME_PATH (looked at ${CHROME_CANDIDATES.join(", ")})`,
    );
  return found;
}

/**
 * 使い捨てのプロファイルで headless Chrome を起こし、CDP の口が開くまで待つ。
 * extraArgs は足したい Chrome の引数 (WebGL を CPU で描かせる等)。
 */
export async function startChrome(extraArgs = []) {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "headless-chrome-"));
  const child = spawn(
    chromePath(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--lang=en-US",
      ...extraArgs,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8192);
  });
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  let lastError = null;
  for (;;) {
    if (child.exitCode !== null)
      throw new Error(`Chrome exited with ${child.exitCode}:\n${stderr}`);
    try {
      const res = await fetch(`${endpoint}/json/version`);
      if (res.ok) break;
      lastError = new Error(`GET /json/version answered ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline)
      throw new Error(`Chrome did not open its CDP port:\n${stderr}`, {
        cause: lastError,
      });
    await sleep(200);
  }
  const stop = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    }
    rmSync(profile, { recursive: true, force: true });
  };
  return { child, endpoint, stop };
}

/** CDP の 1 本の接続 (Node の組み込みの WebSocket)。 */
export class Cdp {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener(
        "error",
        (event) =>
          reject(new Error(`could not connect to ${url}`, { cause: event })),
        { once: true },
      );
    });
    return new Cdp(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? [])
          listener(message.params);
        return;
      }
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error)
        waiting.reject(
          new Error(
            `${waiting.method} failed: ${JSON.stringify(message.error)}`,
          ),
        );
      else waiting.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const waiting of this.pending.values())
        waiting.reject(
          new Error(`the CDP connection closed during ${waiting.method}`),
        );
      this.pending.clear();
    });
  }

  /** CDP のイベント (Runtime.exceptionThrown など) を受け取る。 */
  on(method, listener) {
    const list = this.listeners.get(method) ?? [];
    list.push(listener);
    this.listeners.set(method, list);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

/** 新しいページを開いてつなぐ。 */
export async function openPage(endpoint) {
  const res = await fetch(`${endpoint}/json/new?about:blank`, {
    method: "PUT",
  });
  if (!res.ok)
    throw new Error(
      `PUT /json/new answered ${res.status}: ${await res.text()}`,
    );
  const target = await res.json();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  // headless でも焦点のある窓として振る舞わせる (xterm の入力欄・:focus)。
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  return { cdp, targetId: target.id };
}

export async function closePage(endpoint, page) {
  page.cdp.close();
  const res = await fetch(`${endpoint}/json/close/${page.targetId}`);
  if (!res.ok)
    throw new Error(
      `GET /json/close answered ${res.status}: ${await res.text()}`,
    );
}
