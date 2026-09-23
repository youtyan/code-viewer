// 入口のサーバを配布物 (dist/code-viewer.js) で起こして確かめる: 1 つのポートで
// `/p/<鍵>/` をプロジェクトの裏のプロセスへ取り次ぐ・落ちた裏は 502・起きない
// 裏は 503・入口が居なくなったら裏も終わる・起動し直した入口は生きた裏を拾う・
// 別のディレクトリの `code-viewer` は動いている入口に委ねる・版の違う入口は
// 止めずに知らせる・使われていない裏は止め、次の要求で黙って起こす。
//
// 状態ディレクトリ・サーバ登録簿・tmux のソケットはテストごとの一時ディレクトリ
// (実データと利用者の tmux に触らない。agents.md 9・10)。
import { type ChildProcess, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { PROJECT_HEADER } from "../core/api-url";
import type { EntryBackendFailure } from "../core/types";
import { SSE_RETRY_MS } from "../server/runtime";
import { rootFileKey } from "../server/server-registry";
import { runGit } from "./_git-fixture";
import { fetchPwaAssets, SERVED_PWA_ICONS } from "./_pwa-fixture";

const REPO_ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
);
const CLI_BUNDLE = join(REPO_ROOT, "dist", "code-viewer.js");
const PACKAGE_VERSION = JSON.parse(
  readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
).version as string;
const SAMPLE_TOKEN = "0123456789abcdef";

type Sandbox = {
  dir: string;
  env: NodeJS.ProcessEnv;
  stateDir: string;
  registryDir: string;
};

const children: ChildProcess[] = [];
const sandboxes: string[] = [];
const identityServers: Server[] = [];

afterEach(async () => {
  for (const server of identityServers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
  // 入口が起こした裏は切り離されているので、登録簿から pid を引いて止める。
  for (const dir of sandboxes.splice(0)) {
    for (const pid of registeredPids(join(dir, "servers"))) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // 既に終わっている
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function registeredPids(registryDir: string): number[] {
  const pids: number[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(registryDir);
  } catch {
    return pids;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    pids.push(JSON.parse(readFileSync(join(registryDir, name), "utf8")).pid);
  }
  return pids;
}

function sandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "entry-server-"));
  sandboxes.push(dir);
  const stateDir = join(dir, "state");
  const registryDir = join(dir, "servers");
  mkdirSync(join(dir, "tmux"), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CODE_VIEWER_TEST_STATE_DIR: stateDir,
    CODE_VIEWER_TEST_SERVER_REGISTRY_DIR: registryDir,
    TMUX_TMPDIR: join(dir, "tmux"),
  };
  delete env.TMUX;
  delete env.TMUX_PANE;
  delete env.CODE_VIEWER_DEV;
  return { dir, env, stateDir, registryDir };
}

function repo(box: Sandbox, name: string): string {
  const root = join(box.dir, name);
  mkdirSync(root);
  runGit(root, ["init", "-q", "-b", "main"]);
  writeFileSync(join(root, "README.md"), `# ${name}\n`);
  runGit(root, ["add", "."]);
  runGit(root, [
    "-c",
    "user.name=Sample",
    "-c",
    "user.email=sample@example.com",
    "commit",
    "-q",
    "-m",
    "start",
  ]);
  return realpathSync(root);
}

function startEntry(
  box: Sandbox,
  cwd: string,
  extraArgs: string[] = [],
  bundle = CLI_BUNDLE,
): Promise<{
  proc: ChildProcess;
  url: string;
  openUrl: string;
  output: () => string;
}> {
  const proc = spawn(
    process.execPath,
    [bundle, "--cwd", cwd, "--port", "0", ...extraArgs],
    {
      env: box.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(proc);
  return new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const listen = /GDP_LISTEN_URL=(http:\/\/127\.0\.0\.1:\d+\/)/.exec(
        output,
      );
      const open = /code-viewer entry server: (\S+)/.exec(output);
      if (listen?.[1] && open?.[1])
        resolve({
          proc,
          url: listen[1],
          openUrl: open[1],
          output: () => output,
        });
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.once("exit", (code) =>
      reject(new Error(`entry exited (${code}):\n${output}`)),
    );
  });
}

function runCli(
  box: Sandbox,
  cwd: string,
  args: string[] = [],
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  // spawnSync だとこのプロセスのイベントループが止まり、テストの中の偽の
  // サーバが応答できない。
  const proc = spawn(process.execPath, [CLI_BUNDLE, ...args], {
    cwd,
    env: box.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(proc);
  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  return new Promise((resolve) => {
    proc.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function backendPid(box: Sandbox, root: string): number {
  return JSON.parse(
    readFileSync(join(box.registryDir, `${rootFileKey(root)}.json`), "utf8"),
  ).pid;
}

/** 入口を通さずに裏だけを起こす (持ち主の入口は entry.json と偽の本人確認で作る)。 */
function startBackend(
  box: Sandbox,
  root: string,
  entryPid: number,
  entryToken: string,
  bundle = CLI_BUNDLE,
): { proc: ChildProcess; output: () => string } {
  const proc = spawn(
    process.execPath,
    [
      bundle,
      "--cwd",
      root,
      "--port",
      "0",
      "--backend",
      "--entry-pid",
      String(entryPid),
      "--entry-token",
      entryToken,
    ],
    { env: box.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(proc);
  let output = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  return { proc, output: () => output };
}

/** `/_entry` に決まった本人確認を返す偽の入口。 */
async function identityServer(identity: {
  pid: number;
  token: string;
  version: string;
}): Promise<{
  url: string;
  close: () => Promise<void>;
  /** 繋がりは受けるが答えない (古い入口のポートを別のサーバが使っている)。 */
  silence: () => void;
}> {
  let silent = false;
  const server = createServer((_req, res) => {
    if (silent) return;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ role: "entry", ...identity }));
  });
  identityServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    // 使い回しの接続で答え続けないよう、繋がっているものも切る。
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
    silence: () => {
      silent = true;
      server.closeAllConnections();
    },
  };
}

/**
 * 入れ直しを写しで作る: 配布物と package.json を写した置き場。`install` で
 * package.json の版だけを書き換える (そこから起きるプロセスはその版で動く)。
 */
function packageCopy(box: Sandbox): {
  bundle: string;
  install: (version: string) => void;
} {
  const pkg = join(box.dir, "package");
  const bundle = join(pkg, "dist", "code-viewer.js");
  mkdirSync(join(pkg, "dist"), { recursive: true });
  copyFileSync(CLI_BUNDLE, bundle);
  symlinkSync(join(REPO_ROOT, "web"), join(pkg, "web"));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(pkg, "node_modules"));
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  );
  return {
    bundle,
    install: (version) =>
      writeFileSync(
        join(pkg, "package.json"),
        JSON.stringify({ ...manifest, version }),
      ),
  };
}

function writeEntryJson(
  box: Sandbox,
  entry: { url: string; pid: number; token: string; version: string },
): void {
  mkdirSync(box.stateDir, { recursive: true });
  writeFileSync(
    join(box.stateDir, "entry.json"),
    JSON.stringify({ ...entry, started_at: "2026-09-23T00:00:00.000Z" }),
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  check: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

describe("the entry server", () => {
  test("forwards /p/<key>/ to the project process on the same port", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    const { url, openUrl } = await startEntry(box, root);
    const key = rootFileKey(root);
    expect(openUrl).toBe(`${url}p/${key}/`);

    const top = await fetch(url, { redirect: "manual" });
    expect(top.status).toBe(302);
    expect(top.headers.get("location")).toBe(`/p/${key}/`);
    const old = await fetch(`${url}file?path=README.md`, {
      redirect: "manual",
    });
    expect(old.headers.get("location")).toBe(`/p/${key}/file?path=README.md`);
    const page = await fetch(`${url}p/${key}/history`);
    expect(page.headers.get("content-type")).toContain("text/html");

    const settings = (await (
      await fetch(`${url}p/${key}/_settings`)
    ).json()) as {
      server: { root: string; pid: number };
    };
    expect(settings.server.root).toBe(root);
    expect(settings.server.pid).toBe(backendPid(box, root));

    const origin = new URL(url).origin;
    const write = await fetch(`${url}p/${key}/refresh`, {
      method: "POST",
      headers: {
        Origin: origin,
        "X-Code-Viewer-Action": "1",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    expect(write.status).toBe(200);

    const unknown = await fetch(
      `${url}p/${rootFileKey("/work/not-registered")}/_settings`,
    );
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { code: string }).code).toBe(
      "unknown-project",
    );
    // 知らない鍵の画面は、ただの 404 ではなく登録されていないことの案内。
    // 言語は全プロジェクト共通の設定に合わせる (この一時の状態では英語)。
    const stranger = rootFileKey("/work/not-registered");
    const pages = await Promise.all(
      [`p/${stranger}`, `p/${stranger}/`, `p/${stranger}/history`].map(
        async (path) => {
          const res = await fetch(`${url}${path}`, { redirect: "manual" });
          const body = await res.text();
          return [
            path,
            res.status,
            res.headers.get("content-type"),
            body.includes("This project is not registered"),
            body.includes("このプロジェクトは登録されていません"),
            body.includes('<a href="/agents">'),
            body.includes("code-viewer --cwd /path/to/repo"),
          ];
        },
      ),
    );
    expect(pages).toEqual([
      [
        `p/${stranger}`,
        404,
        "text/html; charset=utf-8",
        true,
        false,
        true,
        true,
      ],
      [
        `p/${stranger}/`,
        404,
        "text/html; charset=utf-8",
        true,
        false,
        true,
        true,
      ],
      [
        `p/${stranger}/history`,
        404,
        "text/html; charset=utf-8",
        true,
        false,
        true,
        true,
      ],
    ]);
    // 裏は tmux・シェル・エージェントを受けない (入口が受ける)。
    const registry = JSON.parse(
      readFileSync(join(box.registryDir, `${key}.json`), "utf8"),
    );
    expect(registry).toMatchObject({ backend: true, launched: true });
    const direct = await fetch(`${registry.url}_agent/states`);
    expect(direct.status).toBe(404);
    const viaEntry = await fetch(`${url}_agent/states`);
    expect(viaEntry.status).toBe(200);

    const backendWorktreeOpen = await fetch(`${url}p/${key}/_worktree/open`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "X-Code-Viewer-Action": "1",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ path: root }),
    });
    expect(backendWorktreeOpen.status).toBe(404);
  });

  test("the installed-window manifest and icons are the same at the root and under /p/<key>/", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    const { url } = await startEntry(box, root);
    const atRoot = await fetchPwaAssets(url);
    // 画面は根の /manifest.webmanifest を読むが、/p/<鍵>/ の下 (裏が配る) でも同じものが引ける。
    const underProject = await fetchPwaAssets(`${url}p/${rootFileKey(root)}/`);
    expect([
      atRoot.contentType,
      atRoot.manifest.start_url,
      atRoot.icons,
    ]).toEqual([
      "application/manifest+json; charset=utf-8",
      "/",
      SERVED_PWA_ICONS,
    ]);
    expect(underProject).toEqual(atRoot);
  });

  test("a stopped project process is 502 until restarted; a project that cannot start is 503", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    const { url } = await startEntry(box, root);
    const key = rootFileKey(root);
    expect((await fetch(`${url}p/${key}/_settings`)).status).toBe(200);
    process.kill(backendPid(box, root), "SIGKILL");
    await waitUntil(() => !alive(backendPid(box, root)), 5000);

    const stopped = await fetch(`${url}p/${key}/_tree`);
    expect(stopped.status).toBe(502);
    const body = (await stopped.json()) as {
      code: string;
      project: { key: string; root: string };
      detail: string;
    };
    expect(body).toMatchObject({
      code: "backend-stopped",
      project: { key, root },
    });
    expect(body.detail).toContain("ECONNREFUSED");
    expect((await fetch(`${url}p/${key}/_tree`)).status).toBe(502);

    const origin = new URL(url).origin;
    const restart = await fetch(`${url}_entry/restart`, {
      method: "POST",
      headers: {
        Origin: origin,
        "X-Code-Viewer-Action": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key }),
    });
    expect(restart.status).toBe(200);
    expect((await fetch(`${url}p/${key}/_settings`)).status).toBe(200);

    // 登録したのに消えたフォルダは起こせない。
    const gone = repo(box, "sample-gone");
    const cli = await runCli(box, gone);
    expect(cli.status).toBe(0);
    rmSync(gone, { recursive: true, force: true });
    const failed = await fetch(`${url}p/${rootFileKey(gone)}/_settings`);
    expect(failed.status).toBe(503);
    expect(((await failed.json()) as { code: string }).code).toBe(
      "backend-start-failed",
    );
  });

  test("the event stream through the entry tells the browser to reconnect quickly", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    const { url } = await startEntry(box, root);
    const key = rootFileKey(root);
    const leave = new AbortController();
    const events = await fetch(`${url}p/${key}/events`, {
      signal: leave.signal,
    });
    const first = await events.body?.getReader().read();
    leave.abort();
    expect(new TextDecoder().decode(first?.value)).toMatch(
      new RegExp(`^retry: ${SSE_RETRY_MS}\n`),
    );
  }, 30_000);

  test("a project process nobody uses is stopped after --idle-stop, not treated as stopped, and started again by the next request", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    const { url, output } = await startEntry(box, root, ["--idle-stop", "1"]);
    const key = rootFileKey(root);
    const backendState = async () =>
      (
        (await (
          await fetch(`${url}_entry/backend`, {
            headers: { [PROJECT_HEADER]: key },
          })
        ).json()) as { state: string }
      ).state;

    // SSE を購読している間は止めない。
    const leave = new AbortController();
    const events = await fetch(`${url}p/${key}/events`, {
      signal: leave.signal,
    });
    await events.body?.getReader().read();
    const first = backendPid(box, root);
    expect(await backendState()).toBe("running");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(alive(first)).toBe(true);

    leave.abort();
    expect(await waitUntil(() => !alive(first), 10_000)).toBe(true);
    expect(await backendState()).toBe("idle-stopped");
    // 入口の出力はパイプ越しなので、状態が変わった後に届く。
    const stoppedLine = `[code-viewer] entry: stopped the project process for ${root} (idle: no subscribers or streams for`;
    await waitUntil(() => output().includes(stoppedLine), 5000);
    expect(output()).toContain(stoppedLine);

    const settings = await fetch(`${url}p/${key}/_settings`);
    expect(settings.status).toBe(200);
    expect(backendPid(box, root)).not.toBe(first);
    expect(await backendState()).toBe("running");
    const startedLine = `[code-viewer] entry: started the project process for ${root} again on request (stopped as idle`;
    await waitUntil(() => output().includes(startedLine), 5000);
    expect(output()).toContain(startedLine);
  }, 30_000);

  test("the state of the selected project's process needs a known project", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    const { url } = await startEntry(box, root);
    const missing = await fetch(`${url}_entry/backend`);
    expect(missing.status).toBe(400);
    const known = await fetch(`${url}_entry/backend`, {
      headers: { [PROJECT_HEADER]: rootFileKey(root) },
    });
    expect(["absent", "starting", "running"]).toContain(
      ((await known.json()) as { state: string }).state,
    );
  });

  test("project processes end when the entry is gone, and a restarted entry picks them up", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    const first = await startEntry(box, root);
    const firstToken = JSON.parse(
      readFileSync(join(box.stateDir, "entry.json"), "utf8"),
    ).token as string;
    const key = rootFileKey(root);
    expect((await fetch(`${first.url}p/${key}/_settings`)).status).toBe(200);
    const kept = backendPid(box, root);

    // 起動し直した入口は、生きている裏をそのまま使う。
    first.proc.kill("SIGTERM");
    await waitUntil(
      () => first.proc.exitCode !== null || first.proc.signalCode !== null,
      5000,
    );
    const second = await startEntry(box, root);
    const secondToken = JSON.parse(
      readFileSync(join(box.stateDir, "entry.json"), "utf8"),
    ).token as string;
    expect(secondToken).toMatch(/^[0-9a-f]{16}$/);
    expect(secondToken).not.toBe(firstToken);
    const settings = (await (
      await fetch(`${second.url}p/${key}/_settings`)
    ).json()) as { server: { pid: number } };
    expect(settings.server.pid).toBe(kept);
    // 入口が居なくなって猶予 (10 秒) を過ぎても、新しい入口に付き直した裏は残る。
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    expect(alive(kept)).toBe(true);

    second.proc.kill("SIGKILL");
    expect(await waitUntil(() => !alive(kept), 16_000)).toBe(true);
  }, 45_000);

  test("a project process exits when the owner pid is alive but its entry token cannot be verified", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    const { proc, output } = startBackend(box, root, process.pid, SAMPLE_TOKEN);

    expect(
      await waitUntil(
        () =>
          proc.exitCode !== null ||
          proc.signalCode !== null ||
          registeredPids(box.registryDir).includes(proc.pid ?? -1),
        5000,
      ),
    ).toBe(true);
    expect(proc.exitCode).toBeNull();
    expect(proc.signalCode).toBeNull();
    expect(
      await waitUntil(
        () => proc.exitCode !== null || proc.signalCode !== null,
        16_000,
      ),
    ).toBe(true);
    expect(output()).toContain("entry owner verification failed");
  }, 25_000);

  test("a project process started by an entry of another version stops at once with its own exit code and says how to restart the entry", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    writeEntryJson(box, {
      url: "http://127.0.0.1:9/",
      pid: process.pid,
      token: SAMPLE_TOKEN,
      version: "0.0.1-sample",
    });
    const { proc, output } = startBackend(box, root, process.pid, SAMPLE_TOKEN);

    expect(
      await waitUntil(
        () => proc.exitCode !== null || proc.signalCode !== null,
        5000,
      ),
    ).toBe(true);
    expect([proc.exitCode, proc.signalCode]).toEqual([3, null]);
    expect(registeredPids(box.registryDir)).not.toContain(proc.pid);
    expect(output()).toContain(
      `this project process is version ${PACKAGE_VERSION}, but the entry server that started it (pid ${process.pid}) is version 0.0.1-sample.`,
    );
    expect(output()).toContain(`kill ${process.pid}`);
  }, 15_000);

  test("an entry server left running across an update of code-viewer says it is out of date, stops starting project processes, and a restart tries again", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    // 写した置き場から入口を起こし、動いている間に版だけを書き換える (裏は
    // 入口と同じ置き場から起きるので、書き換えた版で動く)。
    const { bundle, install } = packageCopy(box);
    install("0.0.1-sample");
    const entry = await startEntry(box, root, [], bundle);
    install("0.0.2-sample");
    const key = rootFileKey(root);
    const entryPid = entry.proc.pid as number;
    const failure = async () => {
      const res = await fetch(`${entry.url}p/${key}/_settings`);
      return {
        status: res.status,
        body: (await res.json()) as EntryBackendFailure,
      };
    };
    const started = () =>
      readdirSync(join(box.stateDir, "server-logs"))
        .map((name) =>
          readFileSync(join(box.stateDir, "server-logs", name), "utf8"),
        )
        .join("")
        .split("this project process is version 0.0.2-sample").length - 1;

    const first = await failure();
    expect(first.status).toBe(503);
    expect(first.body).toMatchObject({
      code: "backend-start-failed",
      entryOutdated: true,
      error: `code-viewer was updated or reinstalled while this entry server (version 0.0.1-sample, pid ${entryPid}) was running, so the entry server is out of date. Stop the entry server (Ctrl+C where code-viewer was started, or kill ${entryPid}) and run code-viewer again.`,
      project: { key, root },
    });
    expect(first.body.detail.startsWith(first.body.error)).toBe(true);
    expect(first.body.log).toContain(
      `this project process is version 0.0.2-sample, but the entry server that started it (pid ${entryPid}) is version 0.0.1-sample.`,
    );
    // 2 回目からは起こさずに同じ案内を返す (起こしても同じ理由で終わる)。
    const again = await failure();
    expect([again.status, again.body.error]).toEqual([503, first.body.error]);
    expect(started()).toBe(1);
    expect(
      entry.output().split("the entry server is out of date").length - 1,
    ).toBe(1);
    // 案内は全プロジェクト共通の設定の言語で出す。
    writeFileSync(
      join(box.stateDir, "settings.json"),
      JSON.stringify({ version: 1, language: "ja" }),
    );
    expect((await failure()).body.error).toBe(
      `入口のサーバ（版 0.0.1-sample、pid ${entryPid}）が動いている間に code-viewer が入れ直されたので、入口の版が古いままです。入口のプロセスを止めて（code-viewer を起動した端末で Ctrl+C、または kill ${entryPid}）、code-viewer を打ち直してください。`,
    );

    // 画面の「再起動」は起こし直す (版が戻っていれば動く)。
    install("0.0.1-sample");
    const origin = new URL(entry.url).origin;
    const restart = await fetch(`${entry.url}_entry/restart`, {
      method: "POST",
      headers: {
        Origin: origin,
        "X-Code-Viewer-Action": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key }),
    });
    expect(restart.status).toBe(200);
    expect((await fetch(`${entry.url}p/${key}/_settings`)).status).toBe(200);
  }, 45_000);

  // 入れ直して入口を起こし直した直後: 古い版の裏は新しい入口の採用を断る。
  // 入口はそれを待たずに止め (待つと裏が自分で終わる約 10 秒開けなかった)、
  // 新しい版の裏を起こす。
  test("a restarted entry of a new version replaces the old version's project process at once", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    const { bundle, install } = packageCopy(box);
    install("0.0.1-sample");
    const oldEntryProc = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1 << 30)"],
      { stdio: "ignore" },
    );
    children.push(oldEntryProc);
    const oldEntryPid = oldEntryProc.pid as number;
    const oldEntry = await identityServer({
      pid: oldEntryPid,
      token: SAMPLE_TOKEN,
      version: "0.0.1-sample",
    });
    writeEntryJson(box, {
      url: oldEntry.url,
      pid: oldEntryPid,
      token: SAMPLE_TOKEN,
      version: "0.0.1-sample",
    });
    const old = startBackend(box, root, oldEntryPid, SAMPLE_TOKEN, bundle);
    expect(
      await waitUntil(
        () => registeredPids(box.registryDir).includes(old.proc.pid ?? -1),
        5000,
      ),
    ).toBe(true);
    // 古い入口が終わり、新しい版の入口が起きる。
    await oldEntry.close();
    oldEntryProc.kill("SIGKILL");
    expect(await waitUntil(() => !alive(oldEntryPid), 2000)).toBe(true);
    const entry = await startEntry(box, root);

    const startedAt = Date.now();
    const res = await fetch(`${entry.url}p/${rootFileKey(root)}/_settings`);
    const tookMs = Date.now() - startedAt;
    const body = (await res.json()) as { server?: { pid?: number } };
    const oldExited = await waitUntil(
      () => old.proc.exitCode !== null || old.proc.signalCode !== null,
      3000,
    );
    expect({
      status: res.status,
      replaced: body.server?.pid !== old.proc.pid,
      oldExited,
    }).toEqual({ status: 200, replaced: true, oldExited: true });
    expect(tookMs).toBeLessThan(8000);
  }, 30_000);

  // 古い入口のポートを答えない別のサーバが使っていても、採用は入口の側の上限
  // (worktree/open.ts の 1.5 秒) に収まる (古い入口の確認は 300ms で打ち切る)。
  test.each([
    { how: "stopped listening", stop: "close" as const },
    { how: "accepts connections but never answers", stop: "silence" as const },
  ])("a restarted entry adopts a project process even when the old entry's pid now belongs to another program ($how)", async ({
    stop,
  }) => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    // 古い入口の pid を別のプログラムが使っている: pid は生きているが、古い
    // 入口の URL はもう答えない。
    const reused = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1 << 30)"],
      { stdio: "ignore" },
    );
    children.push(reused);
    const reusedPid = reused.pid as number;
    const newToken = "fedcba9876543210";
    const oldEntry = await identityServer({
      pid: reusedPid,
      token: SAMPLE_TOKEN,
      version: PACKAGE_VERSION,
    });
    writeEntryJson(box, {
      url: oldEntry.url,
      pid: reusedPid,
      token: SAMPLE_TOKEN,
      version: PACKAGE_VERSION,
    });
    const { proc, output } = startBackend(box, root, reusedPid, SAMPLE_TOKEN);
    expect(
      await waitUntil(
        () => registeredPids(box.registryDir).includes(proc.pid ?? -1),
        5000,
      ),
    ).toBe(true);
    const backendUrl = JSON.parse(
      readFileSync(join(box.registryDir, `${rootFileKey(root)}.json`), "utf8"),
    ).url as string;
    const newEntry = await identityServer({
      pid: process.pid,
      token: newToken,
      version: PACKAGE_VERSION,
    });
    writeEntryJson(box, {
      url: newEntry.url,
      pid: process.pid,
      token: newToken,
      version: PACKAGE_VERSION,
    });
    const adopt = () =>
      fetch(`${backendUrl}_entry/adopt`, {
        method: "POST",
        headers: {
          Origin: new URL(backendUrl).origin,
          "X-Code-Viewer-Action": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pid: process.pid, token: newToken }),
      });

    // 古い入口が token で答える間は、持ち主を渡さない。
    const refused = await adopt();
    expect([refused.status, await refused.text()]).toEqual([
      409,
      `entry owner pid ${reusedPid} is still alive`,
    ]);
    // 古い入口が答えなくなれば、pid が生きていても新しい入口を採用する。
    if (stop === "close") await oldEntry.close();
    else oldEntry.silence();
    const startedAt = Date.now();
    const adopted = await adopt();
    const tookMs = Date.now() - startedAt;
    expect([adopted.status, await adopted.text()]).toEqual([
      200,
      JSON.stringify({ ok: true, adopted: true }),
    ]);
    expect(tookMs).toBeLessThan(1000);
    expect(output()).toContain(
      `the code-viewer entry server restarted (pid ${reusedPid} -> ${process.pid})`,
    );
  }, 25_000);
});

describe("`code-viewer` in another folder", () => {
  let fake: Server | null = null;
  afterEach(async () => {
    const server = fake;
    fake = null;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("registers the folder with the running entry, prints its URL and exits", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    const other = repo(box, "sample-lib");
    const { url } = await startEntry(box, root);
    const result = await runCli(box, other);
    expect(result).toMatchObject({
      status: 0,
      stdout: `${url}p/${rootFileKey(other)}/\n`,
    });
    const projects = JSON.parse(
      readFileSync(join(box.stateDir, "projects.json"), "utf8"),
    );
    expect(projects.projects.map((p: { root: string }) => p.root)).toEqual([
      root,
      other,
    ]);
    expect(
      (await fetch(`${url}p/${rootFileKey(other)}/_settings`)).status,
    ).toBe(200);
  });

  test("does not start a second entry next to one of another version, and says where it is", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    fake = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          role: "entry",
          pid: process.pid,
          token: "0123456789abcdef",
          version: "0.0.1-sample",
        }),
      );
    });
    await new Promise<void>((resolve) => fake?.listen(0, "127.0.0.1", resolve));
    const port = (fake.address() as AddressInfo).port;
    mkdirSync(box.stateDir, { recursive: true });
    writeFileSync(
      join(box.stateDir, "entry.json"),
      JSON.stringify({
        url: `http://127.0.0.1:${port}/`,
        pid: process.pid,
        token: "0123456789abcdef",
        version: "0.0.1-sample",
        started_at: "x",
      }),
    );
    const result = await runCli(box, root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `another version (0.0.1-sample) is running at http://127.0.0.1:${port}/ (pid ${process.pid})`,
    );
    expect(result.stderr).toContain(`kill ${process.pid}`);
    // doctor も同じ入口を見つけ、止め方を hint に出す。
    const doctor = await runCli(box, root, ["doctor", "--json"]);
    const entry = JSON.parse(doctor.stdout)
      .groups.flatMap((group: { rows: unknown[] }) => group.rows)
      .find((row: { id: string }) => row.id === "server.entry");
    expect(entry).toMatchObject({ status: "warn" });
    expect(entry.hint).toContain(`kill ${process.pid}`);
  });

  // 入口の答えの URL は OS の開く命令 (Windows では cmd.exe) に渡るので、入口が
  // 作る形 (自分のオリジンの `/p/<鍵>/`) 以外は表示も開きもしない。
  test.each([
    {
      name: "cmd.exe text",
      url: (port: number) =>
        `http://127.0.0.1:${port}/p/0123456789abcdef/&calc`,
    },
    { name: "a file URL", url: () => "file:///sample/app" },
    {
      name: "another origin",
      url: () => "http://127.0.0.1:1/p/0123456789abcdef/",
    },
  ])("refuses a URL the entry did not make ($name)", async ({ url }) => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    let answered = "";
    fake = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        req.url === "/_entry/open"
          ? answered
          : JSON.stringify({
              role: "entry",
              pid: process.pid,
              token: SAMPLE_TOKEN,
              version: PACKAGE_VERSION,
            }),
      );
    });
    await new Promise<void>((resolve) => fake?.listen(0, "127.0.0.1", resolve));
    const port = (fake.address() as AddressInfo).port;
    answered = JSON.stringify({ url: url(port) });
    writeEntryJson(box, {
      url: `http://127.0.0.1:${port}/`,
      pid: process.pid,
      token: SAMPLE_TOKEN,
      version: PACKAGE_VERSION,
    });
    const result = await runCli(box, root);
    expect({
      status: result.status,
      stdout: result.stdout,
      refused: result.stderr.includes(
        `the code-viewer entry server at http://127.0.0.1:${port}/ returned a URL that is not one of its projects: ${answered}`,
      ),
    }).toEqual({ status: 1, stdout: "", refused: true });
  });

  test("starts outside git, says why the folder is not registered and does not register it", async () => {
    const box = sandbox();
    const folder = join(box.dir, "plain-folder");
    mkdirSync(folder);
    const entry = await startEntry(box, folder);
    expect(entry.output()).toContain(
      `${realpathSync(folder)} is not a git repository, so it is not added to the projects`,
    );
    expect(existsSync(join(box.stateDir, "projects.json"))).toBe(false);
  });
});
