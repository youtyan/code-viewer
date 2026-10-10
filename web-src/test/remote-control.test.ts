// 外部接続を入口のサーバの中で動かす部分 (server/entry/remote-control.ts)。
// cloudflared は偽の実行ファイル (sh のスクリプト) で置き換え、本物の Tunnel には
// 繋がない。トークンは架空の値 (base64 の JSON)。

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RemoteAccessStatus } from "../core/remote-access";
import {
  cloudflaredVersionResult,
  createRemoteControl,
  parseRemoteAccessSaveRequest,
  parseTunnelToken,
  type RemoteControl,
  tunnelConnectionEvent,
} from "../server/entry/remote-control";
import { processAlive } from "../server/file-lock";
import type { RunResult } from "../server/runtime";
import { spawnProcess, stopProcess } from "../server/runtime";
import {
  closeShellSession,
  getShellSession,
  readShellBuffer,
} from "../server/shell/session";
import { captureErrorAsync, waitFor } from "./_test-helpers";

/** a: アカウント、t: 00000000-0000-4000-8000-000000000001、s: 秘密 (どれも架空)。 */
const TOKEN =
  "eyJhIjoiMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYiLCJ0IjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwicyI6ImMyRnRjR3hsTFhObFkzSmxkQT09In0=";
/** TOKEN と Tunnel の ID だけが違う (…0002)。 */
const OTHER_TOKEN =
  "eyJhIjoiMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYiLCJ0IjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAyIiwicyI6ImMyRnRjR3hsTFhObFkzSmxkQT09In0=";
const TUNNEL_ID = "00000000-0000-4000-8000-000000000001";
/** TOKEN と同じ形だが、秘密 (s) の値が引用符の無い SAMPLESECRETVALUE で JSON として壊れている。 */
const BROKEN_SECRET_TOKEN =
  "eyJhIjoiMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYiLCJ0IjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwicyI6U0FNUExFU0VDUkVUVkFMVUV9";
const AUD = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("parseTunnelToken", () => {
  test.each([
    { name: "the token alone", input: TOKEN },
    { name: "the token with a newline", input: `${TOKEN}\n` },
    { name: "service install", input: `cloudflared service install ${TOKEN}` },
    {
      name: "sudo service install",
      input: `sudo cloudflared service install ${TOKEN}`,
    },
    {
      name: "tunnel run --token",
      input: `cloudflared tunnel run --token ${TOKEN}`,
    },
    { name: "a quoted token", input: `"${TOKEN}"` },
    { name: "the same token twice", input: `${TOKEN} ${TOKEN}` },
  ])("takes the token out of $name", ({ input }) => {
    expect(parseTunnelToken(input)).toEqual({
      token: TOKEN,
      tunnelId: TUNNEL_ID,
    });
  });

  test.each([
    {
      name: "empty text",
      input: "",
      message: "no Cloudflare Tunnel token was found",
    },
    {
      name: "a command without the token",
      input: "cloudflared service install",
      message: "no Cloudflare Tunnel token was found",
    },
    {
      name: "two different tokens",
      input: `${TOKEN} ${OTHER_TOKEN}`,
      message: "2 Tunnel tokens were found",
    },
    {
      name: "a token cut off in the middle",
      input: "eyJhIjoieCI=",
      message: "cut off or broken",
    },
    {
      name: "JSON without the Tunnel fields",
      input: "eyJhIjoxfQ==",
      message: "not a Cloudflare Tunnel token",
    },
  ])("refuses $name", ({ input, message }) => {
    expect(() => parseTunnelToken(input)).toThrow(message);
  });

  test("refuses a token broken inside its secret without quoting the secret", async () => {
    const message = await captureErrorAsync(() =>
      parseTunnelToken(BROKEN_SECRET_TOKEN),
    );

    expect(message).toContain("cut off or broken (SyntaxError");
    expect(message).not.toContain("SAMPLESECRET");
  });
});

describe("tunnelConnectionEvent", () => {
  test.each([
    {
      name: "a registered connection",
      line: "2026-01-01T00:00:00Z INF Registered tunnel connection connIndex=2 connection=sample event=0 ip=192.0.2.1 location=sample protocol=quic",
      expected: { kind: "up", index: "2" },
    },
    {
      name: "a terminated connection",
      line: '2026-01-01T00:00:00Z WRN Connection terminated error="timeout: no recent network activity" connIndex=1',
      expected: { kind: "down", index: "1" },
    },
    {
      name: "an unregistered connection",
      line: "2026-01-01T00:00:00Z INF Unregistered tunnel connection connIndex=0 event=0",
      expected: { kind: "down", index: "0" },
    },
    {
      name: "a retry with an index",
      line: "2026-01-01T00:00:00Z INF Retrying connection in up to 1s connIndex=3 event=0",
      expected: null,
    },
    {
      name: "a registered line without an index",
      line: "INF Registered tunnel connection",
      expected: null,
    },
    { name: "an empty line", line: "", expected: null },
  ])("reads $name", ({ line, expected }) => {
    expect(tunnelConnectionEvent(line)).toEqual(expected);
  });
});

const VALUES = {
  port: 64161,
  origin: "https://viewer.example.com",
  teamDomain: "example.cloudflareaccess.com",
  audience: AUD,
};

describe("parseRemoteAccessSaveRequest", () => {
  test.each([
    {
      name: "values only",
      body: { values: VALUES },
      expected: { values: VALUES },
    },
    {
      name: "autoStart only",
      body: { autoStart: true },
      expected: { autoStart: true },
    },
    {
      name: "a token only",
      body: { token: TOKEN },
      expected: { token: TOKEN },
    },
    {
      name: "a blank token with values",
      body: { values: VALUES, token: "  " },
      expected: { values: VALUES },
    },
  ])("accepts $name", ({ body, expected }) => {
    expect(parseRemoteAccessSaveRequest(body)).toEqual(expected);
  });

  test.each([
    { name: "an array", body: [], message: "must be a JSON object" },
    { name: "an empty object", body: {}, message: "nothing to save" },
    {
      name: "only a blank token",
      body: { token: " " },
      message: "nothing to save",
    },
    {
      name: "an unknown field",
      body: { enabled: true },
      message: "unknown remote access fields: enabled",
    },
    {
      name: "a text autoStart",
      body: { autoStart: "yes" },
      message: "autoStart must be true or false",
    },
    {
      name: "a number token",
      body: { token: 1 },
      message: "token must be a string",
    },
    {
      name: "an HTTP origin",
      body: { values: { ...VALUES, origin: "http://viewer.example.com" } },
      message: "public HTTPS origin",
    },
    {
      name: "an origin that is not a URL",
      body: { values: { ...VALUES, origin: "viewer" } },
      message: "must be a URL like https://viewer.example.com",
    },
  ])("refuses $name", ({ body, message }) => {
    expect(() => parseRemoteAccessSaveRequest(body)).toThrow(message);
  });
});

describe("cloudflaredVersionResult", () => {
  const missing = Object.assign(new Error("spawn cloudflared ENOENT"), {
    code: "ENOENT",
    syscall: "spawn cloudflared",
  });
  test.each<{ name: string; result: RunResult; expected: unknown }>([
    {
      name: "a version line",
      result: {
        code: 0,
        stdout: "cloudflared version 2026.9.0 (built 2026-09-09T00:00:00Z)\n",
        stderr: "",
      },
      expected: { state: "ok", version: "2026.9.0" },
    },
    {
      name: "a missing command",
      result: {
        code: -2,
        stdout: "",
        stderr: "",
        failure: { kind: "spawn-error", error: missing },
      },
      expected: {
        state: "unavailable",
        error:
          "cloudflared was not found in PATH. Install it (for example: brew install cloudflared), then press Start again",
        installable: false,
      },
    },
    {
      name: "a failing command",
      result: { code: 1, stdout: "", stderr: "sample failure\n" },
      expected: {
        state: "unavailable",
        error: "cloudflared --version failed: exited with 1: sample failure",
        installable: false,
      },
    },
    {
      name: "a command that timed out",
      result: {
        code: 1,
        stdout: "",
        stderr: "",
        failure: {
          kind: "timed-out",
          message: "cloudflared --version timed out after 5000 ms",
          timeoutMs: 5000,
          elapsedMs: 5001,
        },
      },
      expected: {
        state: "unavailable",
        error:
          "cloudflared --version failed: cloudflared --version timed out after 5000 ms",
        installable: false,
      },
    },
  ])("reports $name", ({ result, expected }) => {
    expect(cloudflaredVersionResult("cloudflared", result)).toEqual(expected);
  });
});

describe("createRemoteControl", () => {
  let dir: string;
  let control: RemoteControl | null;
  let blocker: Server | null;
  /** create() の外で作った入口の代わり (afterEach で止める)。 */
  let others: RemoteControl[];
  const onListenerError = vi.fn();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cv-remote-control-"));
    control = null;
    blocker = null;
    others = [];
    onListenerError.mockReset();
    // 開始・停止の 1 行ずつのログ (入口の端末向け) は、ここでは読まない。
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    for (const other of others) await other.shutdown();
    await control?.shutdown();
    vi.restoreAllMocks();
    if (blocker) await new Promise((resolve) => blocker?.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  const STAYS_UP = [
    'echo "INF Registered tunnel connection connIndex=0 event=0" >&2',
    "trap 'echo \"INF Initiating graceful shutdown\" >&2; exit 0' TERM",
    "while :; do sleep 0.05; done",
  ].join("\n");
  const EXITS = 'echo "ERR Provided Tunnel token is not valid" >&2\nexit 3';

  /** 偽の cloudflared。--version に答え、受け取った引数を出力の 1 行目に出す。 */
  function fakeCloudflared(body: string): string {
    const path = join(dir, "fake-cloudflared");
    writeFileSync(
      path,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "cloudflared version 2099.1.0 (built sample)"; exit 0; fi',
        'echo "ARGS $*" >&2',
        body,
        "",
      ].join("\n"),
    );
    chmodSync(path, 0o755);
    return path;
  }

  async function freePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    await new Promise((resolve) => server.close(resolve));
    if (!address || typeof address === "string")
      throw new Error("no port was assigned");
    return address.port;
  }

  function create(
    cloudflared: string,
    brew?: string,
    configFromFlag = false,
  ): RemoteControl {
    control = createRemoteControl({
      configPath: join(dir, "remote-access.json"),
      configFromFlag,
      tokenPath: join(dir, "tunnel-token"),
      pidPath: join(dir, "cloudflared.pid"),
      forward: async () => new Response("forwarded"),
      onListenerError,
      cloudflared,
      brew: brew ?? join(dir, "missing-brew"),
    });
    return control;
  }

  /** 偽の Homebrew。install で installed (偽の cloudflared) を作る。 */
  function fakeBrew(installed: string, exitCode: number): string {
    const path = join(dir, "fake-brew");
    writeFileSync(
      path,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "Homebrew 4.0.0"; exit 0; fi',
        'echo "==> Installing $2"',
        exitCode === 0
          ? `printf '#!/bin/sh\\necho "cloudflared version 2099.2.0 (built sample)"\\n' > '${installed}' && chmod 755 '${installed}'`
          : 'echo "Error: sample install failure" >&2',
        `exit ${exitCode}`,
        "",
      ].join("\n"),
    );
    chmodSync(path, 0o755);
    return path;
  }

  async function route(
    target: RemoteControl,
    path: string,
    body?: unknown,
    allowed = true,
  ): Promise<{ status: number; text: string }> {
    const url = new URL(`http://127.0.0.1:0${path}`);
    const res = await target.handleRoute(
      new Request(url, {
        method: path.startsWith("/_entry/remote/") ? "POST" : "GET",
        headers:
          body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      url,
      () => allowed,
    );
    if (!res) throw new Error(`${path} was not handled`);
    return { status: res.status, text: await res.text() };
  }

  function statusOf(response: { text: string }): RemoteAccessStatus {
    return JSON.parse(response.text) as RemoteAccessStatus;
  }

  test("saves the values and the token in private files and never returns the token", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    const saved = await route(target, "/_entry/remote/config", {
      values: VALUES,
      token: `cloudflared service install ${TOKEN}`,
    });

    expect(saved.status).toBe(200);
    expect(saved.text).not.toContain(TOKEN);
    expect(statusOf(saved).config).toEqual({
      state: "ok",
      values: VALUES,
      autoStart: false,
    });
    expect(statusOf(saved).token).toEqual({ state: "ok", tunnelId: TUNNEL_ID });
    expect(readFileSync(join(dir, "tunnel-token"), "utf8")).toBe(`${TOKEN}\n`);
    expect(statSync(join(dir, "tunnel-token")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "remote-access.json")).mode & 0o777).toBe(0o600);
  });

  test("refuses a broken token without writing the values either", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    const saved = await route(target, "/_entry/remote/config", {
      values: VALUES,
      token: "eyJhIjoxfQ==",
    });

    expect(saved.status).toBe(400);
    expect(JSON.parse(saved.text)).toEqual({
      code: "invalid",
      error: expect.stringContaining("not a Cloudflare Tunnel token"),
    });
    expect(existsSync(join(dir, "remote-access.json"))).toBe(false);
    expect(existsSync(join(dir, "tunnel-token"))).toBe(false);
  });

  test("refuses to start before the values are saved", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    const started = await route(target, "/_entry/remote/start");

    expect(started.status).toBe(409);
    expect(JSON.parse(started.text)).toEqual({
      code: "conflict",
      error: expect.stringContaining("save the Cloudflare values first"),
    });
    expect(target.status().listener).toEqual({ state: "stopped" });
  });

  test("start opens the guarded listener and runs cloudflared with the token file; stop ends both", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    const port = await freePort();
    await route(target, "/_entry/remote/config", {
      values: { ...VALUES, port },
      token: TOKEN,
    });

    const started = statusOf(await route(target, "/_entry/remote/start"));
    expect(started.listener).toEqual({
      state: "running",
      port,
      origin: VALUES.origin,
    });
    await waitFor(() => {
      const tunnel = target.status().tunnel;
      return tunnel.state === "running" && tunnel.connections === 1;
    });
    expect(
      JSON.parse(readFileSync(join(dir, "cloudflared.pid"), "utf8")),
    ).toEqual({
      pid: started.tunnel.state === "running" ? started.tunnel.pid : 0,
      tokenPath: join(dir, "tunnel-token"),
    });
    // cloudflared は code-viewer の端末で動く (設定の「ターミナルで見る」で開く)。
    const shell =
      started.tunnel.state === "running" ? started.tunnel.shell : "";
    const screen = readShellBuffer(shell)?.replay ?? "";
    expect(getShellSession(shell)?.purpose).toEqual({ kind: "remote-tunnel" });
    expect(screen).toContain(
      `ARGS tunnel --no-autoupdate --grace-period 2s run --token-file ${join(dir, "tunnel-token")}`,
    );
    expect(screen).not.toContain(TOKEN);
    // 待ち受けは関所の後ろ: Host が公開 URL でない要求は入口へ渡さない。
    const outside = await fetch(`http://127.0.0.1:${port}/`);
    expect(outside.status).toBe(403);
    expect(outside.headers.get("x-code-viewer-remote")).toBe("1");

    const stopped = statusOf(await route(target, "/_entry/remote/stop"));
    expect(stopped.listener).toEqual({ state: "stopped" });
    expect(stopped.tunnel).toEqual({ state: "stopped" });
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    expect(existsSync(join(dir, "cloudflared.pid"))).toBe(false);
    expect(onListenerError).not.toHaveBeenCalled();
  });

  test("without a token, start opens only the listener", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    await route(target, "/_entry/remote/config", {
      values: { ...VALUES, port: await freePort() },
    });

    const started = statusOf(await route(target, "/_entry/remote/start"));

    expect(started.listener.state).toBe("running");
    expect(started.tunnel).toEqual({ state: "skipped" });
  });

  test("a cloudflared that stops by itself is reported with its output", async () => {
    const target = create(fakeCloudflared(EXITS));
    await route(target, "/_entry/remote/config", {
      values: { ...VALUES, port: await freePort() },
      token: TOKEN,
    });
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await route(target, "/_entry/remote/start");
    await waitFor(() => target.status().tunnel.state === "exited");

    // 端末は終わると消えるので、最後の出力を理由に添える。
    expect(target.status().tunnel).toEqual({
      state: "exited",
      error: `cloudflared exited (code 3).\nLast output:\nARGS tunnel --no-autoupdate --grace-period 2s run --token-file ${join(dir, "tunnel-token")}\nERR Provided Tunnel token is not valid`,
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  test("stopping its terminal from the tab stops cloudflared without reporting a failure", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    await route(target, "/_entry/remote/config", {
      values: { ...VALUES, port: await freePort() },
      token: TOKEN,
    });
    const started = statusOf(await route(target, "/_entry/remote/start"));
    const shell =
      started.tunnel.state === "running" ? started.tunnel.shell : "";

    await closeShellSession(shell);
    await waitFor(() => target.status().tunnel.state !== "running");

    expect({
      tunnel: target.status().tunnel,
      listener: target.status().listener.state,
      pidRecord: existsSync(join(dir, "cloudflared.pid")),
    }).toEqual({
      tunnel: { state: "stopped" },
      listener: "running",
      pidRecord: false,
    });
  });

  test("a missing cloudflared is reported on the cloudflared row", async () => {
    const target = create(join(dir, "missing-cloudflared"));
    await route(target, "/_entry/remote/config", {
      values: { ...VALUES, port: await freePort() },
      token: TOKEN,
    });

    const started = statusOf(await route(target, "/_entry/remote/start"));

    expect(started.listener.state).toBe("running");
    expect(started.tunnel.state).toBe("exited");
    expect(started.cloudflared.state).toBe("unavailable");
  });

  test("a port in use is reported on the listener row and cloudflared is not started", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    const port = await freePort();
    const occupied = createServer();
    blocker = occupied;
    await new Promise<void>((resolve) =>
      occupied.listen(port, "127.0.0.1", resolve),
    );
    await route(target, "/_entry/remote/config", {
      values: { ...VALUES, port },
      token: TOKEN,
    });
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const started = statusOf(await route(target, "/_entry/remote/start"));

    expect(started.listener.state).toBe("failed");
    expect(
      started.listener.state === "failed" ? started.listener.error : "",
    ).toContain(`could not listen on 127.0.0.1:${port} for remote access`);
    expect(started.tunnel).toEqual({ state: "stopped" });
    error.mockRestore();
  });

  test("saving another token while started restarts cloudflared with it", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    await route(target, "/_entry/remote/config", {
      values: { ...VALUES, port: await freePort() },
      token: TOKEN,
    });
    const first = statusOf(await route(target, "/_entry/remote/start")).tunnel;

    const saved = statusOf(
      await route(target, "/_entry/remote/config", { token: OTHER_TOKEN }),
    );

    expect(first.state).toBe("running");
    expect(saved.token).toEqual({
      state: "ok",
      tunnelId: "00000000-0000-4000-8000-000000000002",
    });
    expect(saved.tunnel.state).toBe("running");
    expect(saved.tunnel.state === "running" ? saved.tunnel.pid : 0).not.toBe(
      first.state === "running" ? first.pid : 0,
    );
  });

  test.each([
    { autoStart: true, expected: "running" },
    { autoStart: false, expected: "stopped" },
  ])(
    "start on launch with autoStart $autoStart leaves the listener $expected",
    async ({ autoStart, expected }) => {
      const target = create(fakeCloudflared(STAYS_UP));
      await route(target, "/_entry/remote/config", {
        values: { ...VALUES, port: await freePort() },
        autoStart,
      });

      await target.startOnLaunch();

      expect(target.status().listener.state).toBe(expected);
    },
  );

  test("an unreadable config is moved aside, not overwritten, when values are saved", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    writeFileSync(join(dir, "remote-access.json"), "{");
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(target.status().config.state).toBe("invalid");
    const saved = await route(target, "/_entry/remote/config", {
      values: VALUES,
    });

    expect(saved.status).toBe(200);
    expect(statusOf(saved).config.state).toBe("ok");
    const aside = readdirSync(dir).filter((name) =>
      name.startsWith("remote-access.json.broken-"),
    );
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir, aside[0] ?? ""), "utf8")).toBe("{");
    error.mockRestore();
  });

  test("turning on start with code-viewer needs saved values", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    const changed = await route(target, "/_entry/remote/config", {
      autoStart: true,
    });

    expect(changed.status).toBe(409);
    expect(JSON.parse(changed.text)).toEqual({
      code: "conflict",
      error:
        "save the Cloudflare values before turning on start with code-viewer",
    });
  });
  test("installs a missing cloudflared with Homebrew, then checks it again", async () => {
    const installed = join(dir, "installed-cloudflared");
    const target = create(installed, fakeBrew(installed, 0));

    const checked = statusOf(await route(target, "/_entry/remote/probe"));
    const installing = statusOf(await route(target, "/_entry/remote/install"));
    await waitFor(() => target.status().cloudflared.state === "ok");

    expect(checked.cloudflared).toEqual({
      state: "unavailable",
      error: `${installed} was not found in PATH. Install it (for example: brew install cloudflared), then press Start again`,
      installable: true,
    });
    expect(installing.cloudflared).toEqual({ state: "installing" });
    expect(target.status().cloudflared).toEqual({
      state: "ok",
      version: "2099.2.0",
    });
    expect(target.status().log).toContain("[brew] ==> Installing cloudflared");
  });

  test("a failed Homebrew install is reported and can be tried again", async () => {
    const installed = join(dir, "installed-cloudflared");
    const target = create(installed, fakeBrew(installed, 1));
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await route(target, "/_entry/remote/probe");
    await route(target, "/_entry/remote/install");
    await waitFor(() => target.status().cloudflared.state === "unavailable");

    expect(target.status().cloudflared).toEqual({
      state: "unavailable",
      error: `${join(dir, "fake-brew")} install cloudflared failed (code 1). The last lines of its output are below.`,
      installable: true,
    });
    expect(target.status().log).toContain(
      "[brew] Error: sample install failure",
    );
    expect(error).toHaveBeenCalled();
  });

  test("without Homebrew, install is refused with the reason", async () => {
    const target = create(join(dir, "missing-cloudflared"));

    const checked = statusOf(await route(target, "/_entry/remote/probe"));
    const refused = await route(target, "/_entry/remote/install");

    expect(checked.cloudflared).toMatchObject({ installable: false });
    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.text).error).toContain(
      "Homebrew was not found in PATH",
    );
  });
  /** console.log に出た「cloudflared を起こした」の行の数 (起こした回数)。 */
  function startedCount(): number {
    return vi
      .mocked(console.log)
      .mock.calls.filter(([line]) =>
        String(line).includes("remote access: cloudflared started"),
      ).length;
  }

  test("with --remote-access, saved values reach the open listener and Start adds cloudflared", async () => {
    const target = create(fakeCloudflared(STAYS_UP), undefined, true);
    const port = await freePort();
    await route(target, "/_entry/remote/config", {
      values: { ...VALUES, port },
      token: TOKEN,
    });
    await target.startListenerFromFlag();

    const saved = statusOf(
      await route(target, "/_entry/remote/config", {
        values: { ...VALUES, port, origin: "https://other.example.com" },
      }),
    );
    const started = statusOf(await route(target, "/_entry/remote/start"));

    expect(saved.listener).toEqual({
      state: "running",
      port,
      origin: "https://other.example.com",
    });
    expect(saved.tunnel).toEqual({ state: "stopped" });
    expect(started.tunnel.state).toBe("running");
  });

  test("two starts at once run one cloudflared", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    await route(target, "/_entry/remote/config", {
      values: { ...VALUES, port: await freePort() },
      token: TOKEN,
    });

    await Promise.all([
      route(target, "/_entry/remote/start"),
      route(target, "/_entry/remote/start"),
    ]);

    expect(startedCount()).toBe(1);
  });

  test("turning on start with code-viewer leaves a cloudflared that stopped by itself stopped", async () => {
    const target = create(fakeCloudflared(EXITS));
    await route(target, "/_entry/remote/config", {
      values: { ...VALUES, port: await freePort() },
      token: TOKEN,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await route(target, "/_entry/remote/start");
    await waitFor(() => target.status().tunnel.state === "exited");

    const changed = statusOf(
      await route(target, "/_entry/remote/config", { autoStart: true }),
    );

    expect(changed.tunnel.state).toBe("exited");
    expect(startedCount()).toBe(1);
  });

  test("a cloudflared left by a killed code-viewer is stopped when the next one starts", async () => {
    const fake = fakeCloudflared(STAYS_UP);
    const first = create(fake);
    await route(first, "/_entry/remote/config", {
      values: { ...VALUES, port: await freePort() },
      token: TOKEN,
    });
    const started = statusOf(await route(first, "/_entry/remote/start"));
    const pid = started.tunnel.state === "running" ? started.tunnel.pid : 0;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // 入口が SIGKILL で終わった: first の後始末は走らないまま、同じ置き場所で次の入口が起きる。
    const next = createRemoteControl({
      configPath: join(dir, "remote-access.json"),
      configFromFlag: false,
      forward: async () => new Response("forwarded"),
      onListenerError,
      cloudflared: fake,
      brew: join(dir, "missing-brew"),
      tokenPath: join(dir, "tunnel-token"),
      pidPath: join(dir, "cloudflared.pid"),
    });
    others.push(next);

    await next.startOnLaunch();

    expect(processAlive(pid)).toBe(false);
    expect(next.status().log).toContain(
      `[code-viewer] stopping cloudflared (pid ${pid}) left running by an earlier code-viewer`,
    );
    expect(existsSync(join(dir, "cloudflared.pid"))).toBe(false);
  });

  test("a pid record that now names another program is dropped without stopping it", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    const other = spawnProcess("sleep", ["30"], { stdio: "ignore" });
    const pid = other.pid ?? 0;
    writeFileSync(
      join(dir, "cloudflared.pid"),
      JSON.stringify({ pid, tokenPath: join(dir, "tunnel-token") }),
    );

    try {
      await target.startOnLaunch();

      expect(processAlive(pid)).toBe(true);
      expect(existsSync(join(dir, "cloudflared.pid"))).toBe(false);
    } finally {
      stopProcess(other, "SIGKILL");
    }
  });

  test("probing for cloudflared again needs a request from the page", async () => {
    const target = create(fakeCloudflared(STAYS_UP));

    const refused = await route(
      target,
      "/_entry/remote/probe",
      undefined,
      false,
    );
    const read = await route(target, "/_entry/remote", undefined, false);

    expect([refused.status, read.status]).toEqual([403, 200]);
  });

  test("install checks for cloudflared first when it has not been checked yet", async () => {
    const installed = join(dir, "installed-cloudflared");
    const target = create(installed, fakeBrew(installed, 0));

    const installing = statusOf(await route(target, "/_entry/remote/install"));
    await waitFor(() => target.status().cloudflared.state === "ok");

    expect(installing.cloudflared).toEqual({ state: "installing" });
  });

  test("a cloudflared that is there but does not run is not installed again", async () => {
    const broken = join(dir, "broken-cloudflared");
    writeFileSync(broken, "#!/bin/sh\necho sample failure >&2\nexit 1\n");
    chmodSync(broken, 0o755);
    const installed = join(dir, "installed-cloudflared");
    const target = create(broken, fakeBrew(installed, 0));

    const refused = await route(target, "/_entry/remote/install");

    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.text)).toEqual({
      code: "conflict",
      error: expect.stringContaining(
        "cloudflared is installed but does not run, so it is not installed again",
      ),
    });
  });

  test("a token file with other text around the token is not taken as saved", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    writeFileSync(
      join(dir, "tunnel-token"),
      `cloudflared service install ${TOKEN}\n`,
    );

    expect(target.status().token).toEqual({
      state: "invalid",
      error: expect.stringContaining("must contain only the Tunnel token"),
    });
  });

  test("saving keeps a linked config file a link and leaves out autoStart when it is off", async () => {
    const target = create(fakeCloudflared(STAYS_UP));
    const real = join(dir, "linked-remote-access.json");
    writeFileSync(real, JSON.stringify(VALUES));
    symlinkSync(real, join(dir, "remote-access.json"));

    await route(target, "/_entry/remote/config", {
      values: { ...VALUES, origin: "https://other.example.com" },
    });

    expect(lstatSync(join(dir, "remote-access.json")).isSymbolicLink()).toBe(
      true,
    );
    expect(JSON.parse(readFileSync(real, "utf8"))).toEqual({
      ...VALUES,
      origin: "https://other.example.com",
    });
  });
});
