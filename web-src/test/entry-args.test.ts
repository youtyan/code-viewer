// 入口として起動するときの引数と、起動の分かれ道 (server/entry/args.ts)。
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  decideEntryLaunch,
  parseEntryArgs,
  runsStandaloneServer,
} from "../server/entry/args";

const REPO_ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
);
/** 配布物と同じバンドル。vitest の globalSetup が焼いてある。 */
const CLI_BUNDLE = join(REPO_ROOT, "dist", "code-viewer.js");

describe("which server `code-viewer` starts", () => {
  test.each([
    [[], false],
    [["--cwd", "/work/sample", "--port", "0"], false],
    [["--open"], false],
    [["--standalone"], true],
    [["--standalone", "--cwd", "/work/sample"], true],
    [["--backend", "--entry-pid", "10"], true],
    [["--help"], true],
    [["-h"], true],
    [["--version"], true],
    [["-v"], true],
  ])("%j → standalone preview server: %s", (argv, expected) => {
    expect(runsStandaloneServer(argv)).toBe(expected);
  });
});

const IDLE_STOP_ERROR =
  "--idle-stop requires a number of seconds (0 = never stop)";

describe("parseEntryArgs", () => {
  test.each([
    [
      [],
      {
        remoteAccess: null,
        port: 0,
        idleStopSeconds: 600,
        cwd: null,
        open: false,
        bins: [],
        backendArgs: [],
      },
    ],
    [
      ["--port", "64620", "--cwd", "/work/sample", "--open"],
      {
        remoteAccess: null,
        port: 64620,
        idleStopSeconds: 600,
        cwd: "/work/sample",
        open: true,
        bins: [],
        backendArgs: [],
      },
    ],
    [
      ["--bin", "git=/usr/bin/git", "--", "--scope-omit-dir", "vendor"],
      {
        remoteAccess: null,
        port: 0,
        idleStopSeconds: 600,
        cwd: null,
        open: false,
        bins: ["git=/usr/bin/git"],
        backendArgs: ["--scope-omit-dir", "vendor"],
      },
    ],
    [
      ["--allow-upload"],
      {
        remoteAccess: null,
        port: 0,
        idleStopSeconds: 600,
        cwd: null,
        open: false,
        bins: [],
        backendArgs: [],
      },
    ],
    [
      ["--idle-stop", "0"],
      {
        remoteAccess: null,
        port: 0,
        idleStopSeconds: 0,
        cwd: null,
        open: false,
        bins: [],
        backendArgs: [],
      },
    ],
    [
      ["--idle-stop", "5"],
      {
        remoteAccess: null,
        port: 0,
        idleStopSeconds: 5,
        cwd: null,
        open: false,
        bins: [],
        backendArgs: [],
      },
    ],
    [
      ["--idle-stop", "0.5"],
      {
        remoteAccess: null,
        port: 0,
        idleStopSeconds: 0.5,
        cwd: null,
        open: false,
        bins: [],
        backendArgs: [],
      },
    ],
  ])("%j", (argv, expected) => {
    expect(parseEntryArgs(argv)).toEqual({ ok: true, args: expected });
  });

  test("keeps remote config on the entry, not its project process", () => {
    expect(
      parseEntryArgs(["--remote-access", "/config/remote.json"]),
    ).toMatchObject({
      ok: true,
      args: { remoteAccess: "/config/remote.json", backendArgs: [] },
    });
  });

  test.each([
    [["--remote-access"], "--remote-access requires a JSON config file"],
    [["--port"], "--port requires a TCP port number"],
    [["--port", "70000"], "--port requires a TCP port number"],
    [["--cwd"], "--cwd requires a value"],
    [["--bin"], "--bin requires <name>=<absolute-path>"],
    [["--scope-omit-dir"], "--scope-omit-dir requires a directory name"],
    [["--idle-stop"], IDLE_STOP_ERROR],
    [["--idle-stop", "-1"], IDLE_STOP_ERROR],
    [["--idle-stop", "ten"], IDLE_STOP_ERROR],
    [["--idle-stop", "Infinity"], IDLE_STOP_ERROR],
  ])("%j is refused", (argv, error) => {
    expect(parseEntryArgs(argv)).toEqual({ ok: false, error });
  });
});

// 以前は git diff に渡していた引数。黙って捨てず、ほかの引数の誤りと同じく 1 で止める。
const GIT_DIFF_GUIDANCE =
  "git diff arguments are no longer supported: pick what the Diff screen compares with its from / to pickers (options: code-viewer --help)";

describe.each([
  { server: "the entry server", prefix: [] },
  { server: "--standalone", prefix: ["--standalone"] },
])("$server refuses git diff arguments", ({ prefix }) => {
  test.each([
    {
      name: "a commit range",
      argv: ["HEAD~1", "HEAD"],
      listed: '"HEAD~1" "HEAD"',
    },
    { name: "--staged", argv: ["--staged"], listed: '"--staged"' },
    {
      name: "a path after --, which is not itself refused",
      argv: ["--port", "0", "--", "src/"],
      listed: '"src/"',
    },
  ])("$name", ({ argv, listed }) => {
    const result = spawnSync(
      process.execPath,
      [CLI_BUNDLE, ...prefix, ...argv],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 20_000,
        killSignal: "SIGKILL",
      },
    );
    expect({
      error: result.error,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    }).toEqual({
      status: 1,
      stdout: "",
      stderr: `code-viewer does not accept: ${listed}\n${GIT_DIFF_GUIDANCE}\n`,
    });
  });
});

describe("decideEntryLaunch", () => {
  const running = {
    status: "running" as const,
    url: "http://127.0.0.1:64620/",
    pid: 10,
    version: "1.0.0",
  };
  test.each([
    ["nothing is running", { status: "none" as const }, { kind: "start" }],
    [
      "the same version is running",
      running,
      { kind: "delegate", url: running.url },
    ],
    [
      "another version is running",
      { ...running, version: "0.9.0" },
      { kind: "other-version", url: running.url, pid: 10, version: "0.9.0" },
    ],
    [
      "the record is broken",
      { status: "broken" as const, detail: "entry.json: not valid JSON" },
      { kind: "broken", detail: "entry.json: not valid JSON" },
    ],
  ])("%s", (_label, found, expected) => {
    expect(decideEntryLaunch(found, "1.0.0")).toEqual(expected);
  });
});
