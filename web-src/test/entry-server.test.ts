// 入口のサーバを配布物 (dist/code-viewer.js) で起こして確かめる: 1 つのポートで
// `/p/<鍵>/` をプロジェクトの裏のプロセスへ取り次ぐ・落ちた裏は 502・起きない
// 裏は 503・入口が居なくなったら裏も終わる・起動し直した入口は生きた裏を拾う・
// 別のディレクトリの `code-viewer` は動いている入口に委ねる・版の違う入口は
// 止めずに知らせる。
//
// 状態ディレクトリ・サーバ登録簿・tmux のソケットはテストごとの一時ディレクトリ
// (実データと利用者の tmux に触らない。agents.md 9・10)。
import { type ChildProcess, spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { rootFileKey } from "../server/server-registry";
import { runGit } from "./_git-fixture";

const REPO_ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
);
const CLI_BUNDLE = join(REPO_ROOT, "dist", "code-viewer.js");

type Sandbox = {
  dir: string;
  env: NodeJS.ProcessEnv;
  stateDir: string;
  registryDir: string;
};

const children: ChildProcess[] = [];
const sandboxes: string[] = [];

afterEach(async () => {
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
): Promise<{ proc: ChildProcess; url: string; openUrl: string }> {
  const proc = spawn(
    process.execPath,
    [CLI_BUNDLE, "--cwd", cwd, "--port", "0"],
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
        resolve({ proc, url: listen[1], openUrl: open[1] });
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
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  // spawnSync だとこのプロセスのイベントループが止まり、テストの中の偽の
  // サーバが応答できない。
  const proc = spawn(process.execPath, [CLI_BUNDLE], {
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
    // 裏は tmux・シェル・エージェントを受けない (入口が受ける)。
    const registry = JSON.parse(
      readFileSync(join(box.registryDir, `${key}.json`), "utf8"),
    );
    expect(registry).toMatchObject({ backend: true, launched: true });
    const direct = await fetch(`${registry.url}_agent/states`);
    expect(direct.status).toBe(404);
    const viaEntry = await fetch(`${url}_agent/states`);
    expect(viaEntry.status).toBe(200);
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

  test("project processes end when the entry is gone, and a restarted entry picks them up", async () => {
    const box = sandbox();
    const root = repo(box, "sample-app");
    const first = await startEntry(box, root);
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
        version: "0.0.1-sample",
        started_at: "x",
      }),
    );
    const result = await runCli(box, root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `another version (0.0.1-sample) is running at http://127.0.0.1:${port}/ (pid ${process.pid})`,
    );
  });
});
