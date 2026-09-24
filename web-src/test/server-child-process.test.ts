// サーバが起こす子プロセスは、サーバを動かしている端末を制御端末に持たない
// (runtime.ts の spawnProcess)。持たせると、対話シェル ($SHELL -i -c) が端末の
// 前面を奪ったまま終わり、`pnpm dev` の Ctrl+C が届かなくなった。
//
// 端末を奪う様子そのもの (zsh と擬似端末が要る) は CI で再現できないので、
// ここでは「子が setsid されて自分のグループの長になっている」ことを見る。
// detached でない子は親のグループに入るので pid と pgid が違う。
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { DEFAULT_LOGIN_DEPS } from "../server/accounts/login";
import { spawnTextAsync } from "../server/database/adapters/spawn-runner";
import {
  runAsync,
  runSync,
  spawnProcess,
  spawnStream,
  stopProcess,
} from "../server/runtime";

/** 子の sh 自身の pid と pgid を 1 行で出す。 */
const PRINT_OWN_GROUP = ["sh", "-c", "ps -o pid= -o pgid= -p $$"];

async function streamText(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

function childStdout(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(args[0] as string, args.slice(1), {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", reject);
    child.on("close", () => resolve(out));
  });
}

describe("server child processes are detached from the terminal", () => {
  test.each([
    {
      entry: "runSync",
      run: async () => runSync(PRINT_OWN_GROUP, process.cwd()).stdout,
    },
    {
      entry: "runAsync (login status through the interactive shell)",
      run: async () => (await runAsync(PRINT_OWN_GROUP, process.cwd())).stdout,
    },
    {
      entry: "spawnStream",
      run: async () =>
        streamText(spawnStream(PRINT_OWN_GROUP, process.cwd()).stream),
    },
    { entry: "spawnProcess", run: () => childStdout(PRINT_OWN_GROUP) },
    {
      entry: "spawnTextAsync (database adapters, keychain)",
      run: async () =>
        (
          await spawnTextAsync({
            command: PRINT_OWN_GROUP[0] as string,
            args: PRINT_OWN_GROUP.slice(1),
            timeoutMs: 10_000,
            abortMessage: "aborted",
            timeoutMessage: "timed out",
          })
        ).stdout,
    },
    {
      entry: "login rpc (codex app-server through the interactive shell)",
      run: async () =>
        (
          await DEFAULT_LOGIN_DEPS.rpc(
            PRINT_OWN_GROUP,
            process.env,
            [],
            () => false,
          )
        ).lines.join("\n"),
    },
  ])("$entry starts the child as its own process group leader", async ({
    run,
  }) => {
    const [pid, pgid] = (await run()).trim().split(/\s+/).map(Number);
    expect(pid).toBeGreaterThan(0);
    expect(pgid).toBe(pid);
  });

  test("a timeout stops the whole group, so a grandchild holding stdout does not keep the call waiting", async () => {
    // sh は sleep を fork して待つ。sh だけを止めると sleep が stdout を持った
    // まま残り、close が 30 秒来ない。
    const started = Date.now();
    const result = await runAsync(["sh", "-c", "sleep 30; true"], "/", {
      timeout: 200,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ETIMEDOUT");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test("stopping a child that has exited but is not reaped yet is not an error", async () => {
    // macOS は回収待ちの子だけのグループへの kill に EPERM を返す。時間切れと
    // 子の終了が重なるとこの状態で止めにいく。
    const child = spawnProcess("sh", ["-c", "exit 0"], { stdio: "ignore" });
    const errors: unknown[] = [];
    child.on("error", (error) => errors.push(error));
    const closed = new Promise((resolve) => child.on("close", resolve));
    // イベントループを止めて、node に子を回収させない。
    const until = Date.now() + 300;
    while (Date.now() < until) {
      // 待つだけ
    }
    stopProcess(child, "SIGKILL");
    await closed;
    expect(errors).toEqual([]);
  });

  test("a spawn that node throws for (a file as the working directory) reports through 'error' and 'close'", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-viewer-spawn-throw-"));
    const file = join(root, "sample.txt");
    writeFileSync(file, "sample");
    try {
      const child = spawnProcess("sh", ["-c", "exit 0"], { cwd: file });
      const events: unknown[] = [];
      child.on("error", (error: NodeJS.ErrnoException) =>
        events.push(["error", error.code, error.syscall]),
      );
      child.on("exit", (code: number) => events.push(["exit", code]));
      const closed = new Promise((resolve) =>
        child.on("close", (code: number) => resolve(["close", code])),
      );
      child.stdin?.write("input nobody reads");
      const out = new Response(
        Readable.toWeb(child.stdout as Readable) as ReadableStream,
      ).text();
      events.push(await closed);
      expect({
        pid: child.pid,
        killed: child.kill("SIGKILL"),
        events,
        stdout: await out,
      }).toEqual({
        pid: undefined,
        killed: false,
        events: [
          ["error", "ENOTDIR", "spawn"],
          ["exit", -20],
          ["close", -20],
        ],
        stdout: "",
      });
      await expect(
        spawnStream(["sh", "-c", "exit 0"], file).exited,
      ).resolves.toMatchObject({ kind: "failed", error: { code: "ENOTDIR" } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("children still running when the server exits are stopped with it", async () => {
    // 端末の Ctrl+C は detached の子に届かないので、終了時に止める。
    const program = [
      'const { spawnProcess } = await import("./web-src/server/runtime.ts");',
      'const child = spawnProcess("sleep", ["30"], { stdio: "ignore" });',
      "process.stdout.write(String(child.pid));",
      "process.exit(0);",
    ].join("\n");
    const pid = await new Promise<number>((resolve, reject) => {
      const parent = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", program],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      let err = "";
      parent.stdout.on("data", (chunk) => {
        out += String(chunk);
      });
      parent.stderr.on("data", (chunk) => {
        err += String(chunk);
      });
      parent.on("error", reject);
      parent.on("close", (code) => {
        if (code === 0) resolve(Number(out));
        else reject(new Error(`parent exited with ${code}: ${err}`));
      });
    });
    expect(pid).toBeGreaterThan(0);
    // 親を失った子は init に引き取られてから消える。消えるまで待つ。
    const deadline = Date.now() + 5000;
    let alive = true;
    while (alive && Date.now() < deadline) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ESRCH");
        alive = false;
      }
    }
    expect(alive).toBe(false);
  });
});
