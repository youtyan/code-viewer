import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { WEB_BUNDLES } from "./bundles.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const RUNS = 5;
const QUICK = process.argv.includes("--quick");
const KEEP = process.argv.includes("--keep-work");
const LABEL = argumentValue("--label") ?? "current";
// Seconds after the page is up at which RSS is sampled, e.g. "600,3600".
const MEMORY_DELAYS_SECONDS = (
  argumentValue("--memory-delays") ?? (QUICK ? "2,6" : "10,60")
)
  .split(",")
  .map((value) => {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0)
      throw new Error(`--memory-delays has a bad value: ${value}`);
    return seconds;
  });
// Fake agents end by themselves when the sentinel file goes away, or after
// this long at the latest (outlives the last memory sample).
const AGENT_LIFETIME_MS = (Math.max(...MEMORY_DELAYS_SECONDS) + 300) * 1000;
const CHROME =
  process.env.CODE_VIEWER_PERF_CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TMUX = process.env.CODE_VIEWER_PERF_TMUX ?? "tmux";
const WORK = mkdtempSync(join(tmpdir(), "code-viewer-perf-"));
const TMUX_SOCKET = join(WORK, "tmux.sock");
const TMUX_WRAPPER = join(WORK, "perf-tmux");
const TMUX_SENTINEL = join(WORK, "agents-alive");
const LOGS =
  argumentValue("--output-dir") ??
  process.env.CODE_VIEWER_PERF_OUTPUT_DIR ??
  join(ROOT, "logs");
const children = new Set();

mkdirSync(LOGS, { recursive: true });
installTmuxWrapper();

function argumentValue(name) {
  const at = process.argv.indexOf(name);
  if (at < 0) return null;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function shellSingleQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function installTmuxWrapper() {
  writeFileSync(
    TMUX_WRAPPER,
    [
      "#!/bin/sh",
      `exec /usr/bin/env -u TMUX ${shellSingleQuote(TMUX)} -S ${shellSingleQuote(TMUX_SOCKET)} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
}

function fixtureEnv(name = "main") {
  const base = join(WORK, name);
  const env = {
    ...process.env,
    CODE_VIEWER_TEST_SERVER_REGISTRY_DIR: join(base, "servers"),
    CODE_VIEWER_TEST_STATE_DIR: join(base, "state"),
    CODE_VIEWER_BIN_TMUX: TMUX_WRAPPER,
    HOME: join(base, "home"),
    SHELL: "/bin/sh",
    // tmux itself goes through TMUX_WRAPPER (-S); this keeps any other tmux
    // call away from the developer's default socket too.
    TMUX_TMPDIR: join(base, "tmux-tmpdir"),
  };
  delete env.TMUX;
  delete env.TMUX_PANE;
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CODEX_HOME;
  mkdirSync(env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR, { recursive: true });
  mkdirSync(env.CODE_VIEWER_TEST_STATE_DIR, { recursive: true });
  mkdirSync(env.HOME, { recursive: true });
  mkdirSync(env.TMUX_TMPDIR, { recursive: true });
  return env;
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed (${signal ?? code})\n${stdout}${stderr}`,
        ),
      );
    });
  });
}

function runTmux(args, env) {
  return run(TMUX_WRAPPER, args, { env });
}

async function waitFor(check, description, timeoutMs = 15_000) {
  const deadline = performance.now() + timeoutMs;
  let lastError = null;
  while (performance.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(
    `timed out waiting for ${description}`,
    lastError === null ? undefined : { cause: lastError },
  );
}

async function stopChild(child, label) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} did not stop`)), 5000),
    ),
  ]);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}

function summary(values) {
  return {
    median: rounded(median(values)),
    samples: values.map(rounded),
  };
}

async function fetchChecked(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `${options.method ?? "GET"} ${url} failed: ${response.status}\n${body}`,
    );
  }
  return response;
}

function createFixture() {
  const repos = ["sample-one", "sample-two", "sample-three"].map((name) =>
    join(WORK, "fixtures", name),
  );
  for (const [index, repo] of repos.entries()) {
    mkdirSync(repo, { recursive: true });
    writeFileSync(
      join(repo, "README.md"),
      `# Sample ${index + 1}\n\nFixture text.\n`,
    );
    writeFileSync(join(repo, "small.txt"), "one\ntwo\nthree\n");
    if (index === 0) {
      const bulk = join(repo, "bulk");
      mkdirSync(bulk);
      for (let file = 0; file < 1000; file++) {
        writeFileSync(
          join(bulk, `file-${String(file).padStart(4, "0")}.txt`),
          `${file}\n`,
        );
      }
      const lines = Array.from(
        { length: 8000 },
        (_, line) => `export const sampleLine${line + 1} = ${line + 1};`,
      );
      writeFileSync(join(repo, "large.ts"), `${lines.join("\n")}\n`);
    }
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["config", "user.name", "Sample User"]);
    runGit(repo, ["config", "user.email", "sample@example.com"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-qm", "chore: add sample fixture"]);
  }
  return repos;
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) {
    throw new Error(`git ${args.join(" ")} could not start`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed\n${result.stdout}${result.stderr}`,
    );
  }
}

async function startEntry(env, cwd, port = 0) {
  const started = performance.now();
  const child = spawn(
    process.execPath,
    [
      join(ROOT, "dist/code-viewer.js"),
      "--cwd",
      cwd,
      "--port",
      String(port),
      "--idle-stop",
      "0",
    ],
    { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.once("exit", () => children.delete(child));
  const urls = await waitFor(() => {
    if (child.exitCode !== null) {
      throw new Error(`entry exited ${child.exitCode}\n${stdout}${stderr}`);
    }
    const base = stdout.match(
      /GDP_LISTEN_URL=(http:\/\/127\.0\.0\.1:\d+\/)/,
    )?.[1];
    const open = stdout.match(
      /code-viewer entry server: (http:\/\/127\.0\.0\.1:\d+\/p\/[a-f0-9]+\/)/,
    )?.[1];
    return base && open ? { base, open } : null;
  }, "entry URLs");
  const entryRecord = join(env.CODE_VIEWER_TEST_STATE_DIR, "entry.json");
  if (!existsSync(entryRecord)) {
    throw new Error(
      `entry reported its URLs without writing ${entryRecord}\n${stdout}${stderr}`,
    );
  }
  return { child, started, ...urls, output: () => `${stdout}${stderr}` };
}

function projectKey(openUrl) {
  const match = new URL(openUrl).pathname.match(/^\/p\/([^/]+)\/$/);
  if (!match) throw new Error(`cannot read project key from ${openUrl}`);
  return match[1];
}

async function wakeBackend(entry) {
  const key = projectKey(entry.open);
  await fetchChecked(entry.open);
  await waitFor(
    async () => {
      const response = await fetchChecked(
        new URL("_entry/backend", entry.base),
        {
          headers: { "X-Code-Viewer-Project": key },
        },
      );
      const body = await response.json();
      // EntryBackendStateResponse.state is a plain string (backends.ts `state`).
      if (body.state === "running") return body;
      if (body.state === "unreachable") {
        throw new Error(
          `backend became unreachable: ${JSON.stringify(body)}\n${entry.output()}`,
        );
      }
      return null;
    },
    "backend running",
    30_000,
  );
  await fetchChecked(new URL("_settings", entry.open));
  return key;
}

async function startupMeasurements(repo) {
  const entryResponse = [];
  const backendReady = [];
  for (let index = 0; index < RUNS; index++) {
    const env = fixtureEnv(`startup-${index}`);
    const entry = await startEntry(env, repo);
    try {
      await fetchChecked(new URL("_entry", entry.base));
      entryResponse.push(performance.now() - entry.started);
      await wakeBackend(entry);
      backendReady.push(performance.now() - entry.started);
    } catch (error) {
      throw new Error(`startup run ${index} failed\n${entry.output()}`, {
        cause: error,
      });
    } finally {
      await stopChild(entry.child, `startup entry ${index}`);
    }
  }
  return {
    entryResponseMs: summary(entryResponse),
    backendReadyMs: summary(backendReady),
  };
}

async function writeProjectRegistry(env, repos) {
  const projects = repos.map((root, index) => ({
    root,
    name: `Sample ${index + 1}`,
    addedAt: new Date(index * 1000).toISOString(),
  }));
  writeFileSync(
    join(env.CODE_VIEWER_TEST_STATE_DIR, "projects.json"),
    `${JSON.stringify({ version: 1, projects }, null, 2)}\n`,
  );
}

async function createTmuxAgents(env, repo, count, startIndex = 0) {
  const binDir = join(WORK, "agent-bin");
  mkdirSync(binDir, { recursive: true });
  for (const name of ["claude", "codex"]) {
    const path = join(binDir, name);
    if (!existsSync(path)) {
      cpSync(process.execPath, path);
      chmodSync(path, 0o755);
    }
  }
  if (startIndex === 0) {
    writeFileSync(TMUX_SENTINEL, "running\n");
    await runTmux(
      [
        "new-session",
        "-d",
        "-s",
        "sample-agents",
        "-c",
        repo,
        join(binDir, "claude"),
        "-e",
        "const fs = require('node:fs'); setInterval(() => { if (!fs.existsSync(process.argv[1])) process.exit(0); }, 50); setTimeout(() => process.exit(0), Number(process.argv[2]))",
        TMUX_SENTINEL,
        String(AGENT_LIFETIME_MS),
      ],
      env,
    );
    startIndex = 1;
  }
  for (let index = startIndex; index < count; index++) {
    const agent = index % 2 === 0 ? "claude" : "codex";
    await runTmux(
      [
        "new-window",
        "-d",
        "-t",
        "sample-agents:",
        "-n",
        `sample-${index}`,
        "-c",
        repo,
        join(binDir, agent),
        "-e",
        "const fs = require('node:fs'); setInterval(() => { if (!fs.existsSync(process.argv[1])) process.exit(0); }, 50); setTimeout(() => process.exit(0), Number(process.argv[2]))",
        TMUX_SENTINEL,
        String(AGENT_LIFETIME_MS),
      ],
      env,
    );
  }
}

async function createShell(entry, key) {
  const response = await fetchChecked(new URL("_shell/create", entry.base), {
    method: "POST",
    headers: sideEffectHeaders(entry.base, key),
    body: JSON.stringify({ cols: 100, rows: 30 }),
  });
  const body = await response.json();
  if (typeof body.session?.id !== "string") {
    throw new Error(
      `shell create returned invalid body: ${JSON.stringify(body)}`,
    );
  }
  return body.session.id;
}

function sideEffectHeaders(base, key) {
  return {
    "Content-Type": "application/json",
    Origin: new URL(base).origin,
    "X-Code-Viewer-Action": "1",
    "X-Code-Viewer-Project": key,
  };
}

async function seedTabs(entry, key, shell) {
  const layout = {
    version: 2,
    focused: "left",
    panes: [
      {
        side: "left",
        activeId: "large",
        tabs: [
          {
            id: "large",
            preview: false,
            target: { kind: "file", path: "large.ts" },
          },
          {
            id: "readme",
            preview: false,
            target: { kind: "file", path: "README.md" },
          },
          {
            id: "agents",
            preview: false,
            target: { kind: "page", page: "agents" },
          },
          {
            id: "terminal",
            preview: false,
            target: { kind: "terminal", session: shell },
          },
        ],
      },
    ],
  };
  await fetchChecked(new URL("_state/tabs", entry.open), {
    method: "PUT",
    headers: sideEffectHeaders(entry.base, key),
    body: JSON.stringify({ layout }),
  });
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => this.receive(event.data));
  }

  receive(raw) {
    const message = JSON.parse(raw);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    const listeners = this.listeners.get(message.method) ?? [];
    for (const listener of listeners)
      listener(message.params, message.sessionId);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.sequence;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
    return () =>
      this.listeners.set(
        method,
        listeners.filter((item) => item !== listener),
      );
  }
}

async function startChrome() {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const profile = join(WORK, "chrome");
  mkdirSync(profile);
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--disable-default-apps",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-extensions",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  children.add(child);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.once("exit", () => children.delete(child));
  const activePort = join(profile, "DevToolsActivePort");
  const [port, path] = await waitFor(() => {
    if (child.exitCode !== null) throw new Error(`Chrome exited\n${output}`);
    if (!existsSync(activePort)) return null;
    const lines = readFileSync(activePort, "utf8").trim().split("\n");
    return lines.length >= 2 ? lines : null;
  }, "Chrome DevTools port");
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return { child, cdp: new Cdp(socket), socket };
}

async function createPage(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await Promise.all([
    cdp.send("Page.enable", {}, sessionId),
    cdp.send("Network.enable", {}, sessionId),
    cdp.send("Performance.enable", {}, sessionId),
  ]);
  await cdp.send(
    "Network.setCacheDisabled",
    { cacheDisabled: true },
    sessionId,
  );
  // The app connects SSE and animates only while the page is visible and
  // focused, as a front browser tab is for a person using it.
  await cdp.send("Page.bringToFront", {}, sessionId);
  await cdp.send(
    "Emulation.setFocusEmulationEnabled",
    { enabled: true },
    sessionId,
  );
  return { targetId, sessionId };
}

/**
 * Throw `error` with a snapshot of the page. When taking the snapshot fails
 * too, both failures are kept instead of the snapshot failure replacing it.
 */
async function failWithPageSnapshot(
  cdp,
  sessionId,
  expression,
  error,
  describe,
) {
  let snapshot;
  try {
    snapshot = await evaluate(cdp, sessionId, expression);
  } catch (snapshotError) {
    throw new AggregateError(
      [error, snapshotError],
      describe("(the page snapshot also failed)"),
    );
  }
  throw new Error(describe(snapshot), { cause: error });
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(
      `browser evaluation failed: ${JSON.stringify(result.exceptionDetails)}`,
    );
  }
  return result.result.value;
}

async function waitForPage(
  cdp,
  sessionId,
  expression,
  description,
  timeoutMs = 20_000,
) {
  return waitFor(
    () => evaluate(cdp, sessionId, expression),
    description,
    timeoutMs,
  );
}

async function pageReady(cdp, sessionId) {
  return waitForPage(
    cdp,
    sessionId,
    `(() => {
      const source = document.querySelector('.gdp-standalone-source');
      return document.readyState === 'complete' &&
        document.querySelectorAll('.main-tab').length >= 4 &&
        document.querySelectorAll('.nav-project').length >= 3 &&
        document.querySelectorAll('.nav-agent').length >= 6 &&
        document.querySelector('#filelist') &&
        document.querySelector('#agent-status') &&
        document.querySelector('#statusbar') &&
        source?.dataset.sourceState === 'done';
    })()`,
    "full page ready",
  );
}

async function loadMeasurements(cdp, sessionId, url) {
  const ready = [];
  const dom = [];
  const overview = [];
  for (let index = 0; index < RUNS; index++) {
    await cdp.send("Page.navigate", { url: "about:blank" }, sessionId);
    await waitForPage(
      cdp,
      sessionId,
      "document.readyState === 'complete'",
      "blank page",
    );
    const started = performance.now();
    await cdp.send("Page.navigate", { url }, sessionId);
    await pageReady(cdp, sessionId);
    ready.push(performance.now() - started);
    const timing = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const overviewEntry = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/_agent/overview'));
        return { dom: nav.domContentLoadedEventEnd, overview: overviewEntry?.responseEnd ?? 0 };
      })()`,
    );
    dom.push(timing.dom);
    overview.push(timing.overview);
  }
  return {
    readyMs: summary(ready),
    domContentLoadedMs: summary(dom),
    firstOverviewMs: summary(overview),
  };
}

/**
 * Run `act` inside the page and time it there: from just before the action
 * until the first animation frame after `ready` holds. Polling from Node over
 * CDP would add the round trip and the poll interval to every sample.
 */
async function timeInPage(cdp, sessionId, act, ready, timeoutMs = 20_000) {
  const result = await evaluate(
    cdp,
    sessionId,
    `(async () => {
      let lastReadyError = null;
      const ready = () => { try { return !!(${ready}); } catch (error) { lastReadyError = String(error?.stack ?? error); return false; } };
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const started = performance.now();
      const acted = (() => { ${act} })();
      if (acted === false) return { ok: false, reason: "action target not found" };
      while (!ready()) {
        if (performance.now() - started > ${timeoutMs}) return { ok: false, reason: lastReadyError === null ? "timed out" : "timed out; the last ready check threw: " + lastReadyError };
        await frame();
      }
      await frame();
      return { ok: true, ms: performance.now() - started };
    })()`,
  );
  if (!result?.ok) {
    throw new Error(
      `in-page timing failed (${result?.reason}): act=${act} ready=${ready}`,
    );
  }
  return result.ms;
}

async function taskDuration(cdp, sessionId) {
  const { metrics } = await cdp.send("Performance.getMetrics", {}, sessionId);
  return metrics.find((metric) => metric.name === "TaskDuration")?.value ?? 0;
}

async function clickTab(cdp, sessionId, id, readyExpression) {
  const before = await taskDuration(cdp, sessionId);
  const wallMs = await timeInPage(
    cdp,
    sessionId,
    `const tab = document.querySelector('.main-tab[data-tab-id=${JSON.stringify(id)}]');
     if (!tab) return false;
     tab.click();
     return true;`,
    readyExpression,
  );
  return {
    wallMs,
    mainThreadMs: ((await taskDuration(cdp, sessionId)) - before) * 1000,
  };
}

async function transitionMeasurements(cdp, sessionId) {
  const cases = [
    {
      name: "fileToFile",
      from: "large",
      fromReady: `document.querySelector('.main-tab[data-tab-id="large"].main-tab-active') && document.querySelector('.gdp-standalone-source')?.dataset.sourceState === 'done'`,
      to: "readme",
      ready: `document.querySelector('.main-tab[data-tab-id="readme"].main-tab-active') && document.querySelector('.gdp-standalone-source')?.dataset.sourceState === 'done'`,
    },
    {
      name: "fileToPage",
      from: "readme",
      fromReady: `document.querySelector('.main-tab[data-tab-id="readme"].main-tab-active') && document.querySelector('.gdp-standalone-source')?.dataset.sourceState === 'done'`,
      to: "agents",
      ready: `document.querySelector('.main-tab[data-tab-id="agents"].main-tab-active') && document.body.classList.contains('gdp-agents-page') && document.querySelector('.agents-page')`,
    },
    {
      name: "pageToTerminal",
      from: "agents",
      fromReady: `document.querySelector('.main-tab[data-tab-id="agents"].main-tab-active') && document.body.classList.contains('gdp-agents-page')`,
      to: "terminal",
      ready: `document.querySelector('.main-tab[data-tab-id="terminal"].main-tab-active') && document.querySelector('.main-pane-host[data-kind="terminal"] .terminal-slot .xterm')`,
    },
  ];
  const out = {};
  for (const item of cases) {
    const wall = [];
    const mainThread = [];
    for (let index = 0; index < RUNS; index++) {
      await clickTab(cdp, sessionId, item.from, item.fromReady);
      const sample = await clickTab(cdp, sessionId, item.to, item.ready);
      wall.push(sample.wallMs);
      mainThread.push(sample.mainThreadMs);
    }
    out[item.name] = {
      wallMs: summary(wall),
      mainThreadMs: summary(mainThread),
    };
  }
  return out;
}

async function sourceMeasurements(cdp, sessionId) {
  const values = [];
  for (let index = 0; index < RUNS; index++) {
    await clickTab(cdp, sessionId, "readme", "true");
    const sample = await clickTab(
      cdp,
      sessionId,
      "large",
      `document.querySelector('.main-tab[data-tab-id="large"].main-tab-active') && document.querySelector('.gdp-standalone-source')?.dataset.sourceState === 'done'`,
    );
    values.push(sample.wallMs);
  }
  return summary(values);
}

async function treeMeasurements(cdp, sessionId) {
  const values = [];
  const requests = [];
  const row = `[...document.querySelectorAll('.tree-dir')].find((element) => element.dataset.dirpath === 'bulk')`;
  // The tree is drawn either as plain rows or virtualized (tree-virtual with
  // a tall list); either way all 1,000 files must be reachable.
  const expanded = `(() => {
    const row = ${row};
    const list = document.querySelector('#filelist');
    if (!row || row.classList.contains('collapsed') || !list) return false;
    return list.querySelectorAll('li').length >= 1000 ||
      (list.classList.contains('tree-virtual') && parseFloat(list.style.height || '0') > 10000);
  })()`;
  // The file screen lists changed files; the repository tree with the
  // 1,000-file folder is the Files view (no tab selected on the left).
  await timeInPage(
    cdp,
    sessionId,
    `const files = document.querySelector('.view-strip-item[data-route="repo"]');
     if (!files) return false;
     files.click();
     return true;`,
    `document.body.classList.contains('gdp-repo-page')`,
  );
  try {
    await waitForPage(
      cdp,
      sessionId,
      `!!${row}?.querySelector('.chev')`,
      "bulk tree row",
    );
  } catch (error) {
    await failWithPageSnapshot(
      cdp,
      sessionId,
      `JSON.stringify({ url: location.href, body: document.body.className, list: document.querySelector('#filelist')?.className, rows: [...document.querySelectorAll('#filelist li')].slice(0, 20).map((li) => li.className + ' ' + (li.dataset.dirpath ?? li.dataset.path ?? '')) })`,
      error,
      (snapshot) => `bulk tree row is missing: ${snapshot}`,
    );
  }
  for (let index = 0; index < RUNS; index++) {
    if (
      await evaluate(cdp, sessionId, `!${row}.classList.contains('collapsed')`)
    ) {
      await timeInPage(
        cdp,
        sessionId,
        `${row}.querySelector('.chev').click();`,
        `${row}?.classList.contains('collapsed')`,
      );
    }
    await evaluate(cdp, sessionId, "performance.clearResourceTimings()");
    values.push(
      await timeInPage(
        cdp,
        sessionId,
        `${row}.querySelector('.chev').click();`,
        expanded,
      ),
    );
    // Requests the expansion waited on, so a slow sample can be explained.
    requests.push(
      await evaluate(
        cdp,
        sessionId,
        `performance.getEntriesByType('resource').map((entry) => ({ path: new URL(entry.name).pathname + new URL(entry.name).search, startMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration) }))`,
      ),
    );
  }
  return { ...summary(values), requests };
}

async function overviewMeasurements(entry, key) {
  const values = [];
  for (let index = 0; index < RUNS; index++) {
    const started = performance.now();
    await fetchChecked(new URL("_agent/overview", entry.base), {
      headers: { "X-Code-Viewer-Project": key },
    });
    values.push(performance.now() - started);
  }
  const sweeps = [];
  for (let index = 0; index < RUNS; index++) {
    const initial = await overviewBody(entry, key);
    let previous = initial.observedAt;
    let changes = 0;
    const started = performance.now();
    await waitFor(
      async () => {
        const body = await overviewBody(entry, key);
        if (body.observedAt && body.observedAt !== previous) {
          previous = body.observedAt;
          changes++;
        }
        return changes >= 2 ? true : null;
      },
      "two bounded agent sweeps",
      20_000,
    );
    sweeps.push(performance.now() - started);
  }
  return { responseMs: summary(values), full40PaneCycleMs: summary(sweeps) };
}

async function overviewBody(entry, key) {
  const response = await fetchChecked(new URL("_agent/overview", entry.base), {
    headers: { "X-Code-Viewer-Project": key },
  });
  const body = await response.json();
  if (!Array.isArray(body.projects))
    throw new Error("overview has no projects array");
  return body;
}

/**
 * Restart the entry server the way `pnpm dev` or a new `code-viewer` does:
 * the backend keeps running and the new entry adopts it. Measures from the
 * new entry listening until a file written afterwards shows up in the Files
 * view (SSE reconnected and caught up), and counts /events requests so a
 * reconnect storm shows as a large number.
 */
async function sseMeasurements(cdp, sessionId, entryRef, env, repo) {
  const values = [];
  const attempts = [];
  let eventRequests = 0;
  const unsubscribe = cdp.on(
    "Network.requestWillBeSent",
    (params, eventSession) => {
      if (
        eventSession === sessionId &&
        new URL(params.request.url).pathname.endsWith("/events")
      ) {
        eventRequests++;
      }
    },
  );
  const port = Number(new URL(entryRef.current.base).port);
  try {
    await timeInPage(
      cdp,
      sessionId,
      `const files = document.querySelector('.view-strip-item[data-route="repo"]');
       if (!files) return false;
       files.click();
       return true;`,
      `document.body.classList.contains('gdp-repo-page')`,
    );
    // The tree is virtualized: fold the 1,000-file folder so the probe file
    // at the root is inside the rendered rows.
    const bulk = `[...document.querySelectorAll('.tree-dir')].find((element) => element.dataset.dirpath === 'bulk')`;
    await timeInPage(
      cdp,
      sessionId,
      `for (let el = document.querySelector('#filelist'); el; el = el.parentElement) {
         if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = 0;
       }`,
      `!!${bulk}`,
    );
    if (
      await evaluate(
        cdp,
        sessionId,
        `!!${bulk} && !${bulk}.classList.contains('collapsed')`,
      )
    ) {
      await timeInPage(
        cdp,
        sessionId,
        `${bulk}.querySelector('.chev').click();`,
        `${bulk}?.classList.contains('collapsed')`,
      );
    }
    for (let index = 0; index < RUNS; index++) {
      // app.ts runs at most one catch-up per second (createCatchUpGate); a
      // restart sooner than that after the previous run's catch-up would be
      // skipped by design, so space the runs out like real restarts.
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
      await stopChild(entryRef.current.child, `entry before SSE run ${index}`);
      const before = eventRequests;
      entryRef.current = await startEntry(env, repo, port);
      const started = performance.now();
      const probe = `sse-probe-${index}.txt`;
      writeFileSync(join(repo, probe), `${index}\n`);
      try {
        await waitForPage(
          cdp,
          sessionId,
          `!!document.querySelector('#filelist [data-path=${JSON.stringify(probe)}]')`,
          `file written after entry restart ${index} appears`,
          20_000,
        );
      } catch (error) {
        await failWithPageSnapshot(
          cdp,
          sessionId,
          `JSON.stringify({ url: location.href, visibility: document.visibilityState, focus: document.hasFocus(), status: document.querySelector('#status')?.className, body: document.body.className, rows: [...document.querySelectorAll('#filelist li')].map((li) => li.dataset.dirpath ?? li.dataset.path ?? li.className).slice(0, 12), autoUpdate: document.querySelector('#auto-update')?.className ?? null, banner: document.querySelector('.change-banner, #change-banner')?.textContent ?? null })`,
          error,
          (snapshot) =>
            `SSE run ${index}: ${snapshot}; /events requests since restart: ${eventRequests - before}\n${entryRef.current.output()}`,
        );
      }
      values.push(performance.now() - started);
      attempts.push(eventRequests - before);
    }
  } finally {
    unsubscribe();
  }
  return { caughtUpMs: summary(values), eventsRequests: summary(attempts) };
}

async function bundleMeasurements() {
  const path = join(ROOT, "web/app.js");
  const bytes = statSync(path).size;
  const gzipBytes = gzipSync(readFileSync(path)).byteLength;
  const appBundle = WEB_BUNDLES.find(
    (bundle) => bundle.outfile === "web/app.js",
  );
  if (!appBundle) throw new Error("web/app.js is missing from WEB_BUNDLES");
  const result = await build({
    entryPoints: [join(ROOT, appBundle.entry)],
    bundle: true,
    platform: "browser",
    format: appBundle.format,
    charset: "utf8",
    write: false,
    metafile: true,
  });
  const contributions = Object.values(result.metafile.outputs).flatMap(
    (output) =>
      Object.entries(output.inputs).map(([file, data]) => ({
        module: file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file,
        bytes: data.bytesInOutput,
      })),
  );
  contributions.sort((a, b) => b.bytes - a.bytes);
  return { bytes, gzipBytes, topModules: contributions.slice(0, 10) };
}

async function processRss(pid) {
  const { stdout } = await run("/bin/ps", ["-o", "rss=", "-p", String(pid)]);
  const rss = Number(stdout.trim());
  if (!Number.isFinite(rss))
    throw new Error(`invalid RSS for pid ${pid}: ${stdout}`);
  return rss;
}

async function rendererPid(cdp) {
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const renderers = processInfo.filter(
    (process) => process.type === "renderer",
  );
  if (renderers.length === 0)
    throw new Error("Chrome reported no renderer process");
  const samples = await Promise.all(
    renderers.map(async (process) => ({
      pid: process.id,
      rss: await processRss(process.id),
    })),
  );
  samples.sort((a, b) => b.rss - a.rss);
  return samples[0].pid;
}

function backendPid(env) {
  const files = readdirSync(env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR).filter(
    (file) => file.endsWith(".json"),
  );
  for (const file of files) {
    const entry = JSON.parse(
      readFileSync(
        join(env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR, file),
        "utf8",
      ),
    );
    if (entry.backend === true && Number.isInteger(entry.pid)) return entry.pid;
  }
  throw new Error("backend pid is absent from isolated registry");
}

async function memoryMeasurements(cdp, entry, env) {
  const waits = MEMORY_DELAYS_SECONDS.map((seconds) => seconds * 1000);
  const renderer = await rendererPid(cdp);
  const backend = backendPid(env);
  const out = {};
  let elapsed = 0;
  for (const waitMs of waits) {
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, waitMs - elapsed),
    );
    elapsed = waitMs;
    const entryRss = [];
    const backendRss = [];
    const rendererRss = [];
    for (let sample = 0; sample < RUNS; sample++) {
      entryRss.push(await processRss(entry.child.pid));
      backendRss.push(await processRss(backend));
      rendererRss.push(await processRss(renderer));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
    out[`${waitMs / 1000}s`] = {
      entryKiB: summary(entryRss),
      backendKiB: summary(backendRss),
      browserRendererKiB: summary(rendererRss),
    };
  }
  return out;
}

async function main() {
  await run("pnpm", ["run", "build"]);
  const repos = createFixture();
  const startup = await startupMeasurements(repos[0]);
  const env = fixtureEnv();
  await writeProjectRegistry(env, repos);
  await createTmuxAgents(env, repos[0], 6);
  const entryRef = { current: await startEntry(env, repos[0]) };
  const entry = entryRef.current;
  let chrome = null;
  let operationError = null;
  try {
    const key = await wakeBackend(entry);
    const shell = await createShell(entry, key);
    await seedTabs(entry, key, shell);
    chrome = await startChrome();
    const page = await createPage(chrome.cdp);
    const pageUrl = new URL("file?path=large.ts&ref=worktree", entry.open).href;
    const load = await loadMeasurements(chrome.cdp, page.sessionId, pageUrl);
    const transitions = await transitionMeasurements(
      chrome.cdp,
      page.sessionId,
    );
    const tree = await treeMeasurements(chrome.cdp, page.sessionId);
    const source = await sourceMeasurements(chrome.cdp, page.sessionId);
    const sse = await sseMeasurements(
      chrome.cdp,
      page.sessionId,
      entryRef,
      env,
      repos[0],
    );
    await createTmuxAgents(env, repos[0], 40, 6);
    const overview = await overviewMeasurements(entry, key);
    const bundle = await bundleMeasurements();
    const memory = await memoryMeasurements(chrome.cdp, entryRef.current, env);
    const result = {
      label: LABEL,
      measuredAt: new Date().toISOString(),
      conditions: {
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        runs: RUNS,
        memoryDelaysSeconds: MEMORY_DELAYS_SECONDS,
        fixture: {
          projects: 3,
          visibleAgents: 6,
          sweepPanes: 40,
          treeFiles: 1000,
          sourceLines: 8000,
        },
      },
      startup,
      load,
      transitions,
      treeExpandMs: tree,
      source8000LinesMs: source,
      sse,
      overview,
      bundle,
      memory,
    };
    const output = join(LOGS, `perf-${LABEL}.json`);
    writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(output);
  } catch (error) {
    operationError = error;
  }
  const stopping = [stopChild(entryRef.current.child, "entry")];
  if (chrome) {
    chrome.socket.close();
    stopping.push(stopChild(chrome.child, "Chrome"));
  }
  const outcomes = await Promise.allSettled(stopping);
  const cleanupErrors = outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : [],
  );
  if (operationError !== null && cleanupErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      "performance measurement and process cleanup failed",
    );
  }
  if (operationError !== null) throw operationError;
  if (cleanupErrors.length > 0)
    throw new AggregateError(
      cleanupErrors,
      "performance processes did not stop",
    );
}

let failure = null;
try {
  await main();
} catch (error) {
  failure = error;
  console.error(error);
  process.exitCode = 1;
} finally {
  if (existsSync(TMUX_SENTINEL)) rmSync(TMUX_SENTINEL);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  const remaining = await Promise.allSettled(
    [...children].map((child) =>
      stopChild(child, `remaining process ${child.pid}`),
    ),
  );
  for (const outcome of remaining) {
    if (outcome.status !== "rejected") continue;
    console.error(
      "failed to stop a remaining performance process",
      outcome.reason,
    );
    process.exitCode = 1;
  }
  if (!KEEP) {
    try {
      rmSync(WORK, { recursive: true });
    } catch (error) {
      console.error("failed to remove performance workspace", error);
      if (failure === null) process.exitCode = 1;
    }
  } else {
    console.error(`kept performance workspace: ${WORK}`);
  }
}
