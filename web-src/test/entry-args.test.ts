// 入口として起動するときの引数と、起動の分かれ道 (server/entry/args.ts)。
import { describe, expect, test } from "vitest";
import {
  decideEntryLaunch,
  parseEntryArgs,
  runsStandaloneServer,
} from "../server/entry/args";

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
        port: 64620,
        idleStopSeconds: 600,
        cwd: "/work/sample",
        open: true,
        bins: [],
        backendArgs: [],
      },
    ],
    [
      ["--bin", "git=/usr/bin/git", "--staged", "--scope-omit-dir", "vendor"],
      {
        port: 0,
        idleStopSeconds: 600,
        cwd: null,
        open: false,
        bins: ["git=/usr/bin/git"],
        backendArgs: ["--staged", "--scope-omit-dir", "vendor"],
      },
    ],
    [
      ["--allow-upload"],
      {
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

  test.each([
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
