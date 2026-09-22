// プロジェクトの登録簿 (本物のファイルと git)、開く・止めるの判断 (サーバの
// 起動は差し替え)、ユーザー単位の設定の引き継ぎと優先順位、「読んだ」の
// 全サーバ送信、巡回の速い・遅いの切替。
//
// 登録簿と設定は一時ディレクトリにだけ書く (利用者の状態ディレクトリには
// 触らない)。サーバは起こさない。

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { AppSettingsState } from "../core/types";
import { checkProjects } from "../server/doctor";
import { tryAcquireFileLock } from "../server/file-lock";
import {
  ProjectRegistryError,
  readProjectRegistry,
  updateProjectRegistry,
} from "../server/projects/registry";
import {
  changeProjects,
  openRegisteredProject,
  type ProjectServerDeps,
  stopLaunchedServer,
} from "../server/projects/service";
import type { ServerRegistryEntry } from "../server/server-registry";
import { handleStateRoute } from "../server/state-route";
import {
  ACTIVITY_IDLE_POLL_INTERVAL_MS,
  ACTIVITY_POLL_INTERVAL_MS,
  activityIsStale,
  activityPollDelay,
} from "../server/terminal/activity";
import { relayAgentRead } from "../server/terminal/read-relay";
import {
  ensureUserSettings,
  patchUserSettings,
  readUserSettings,
} from "../server/user-settings";
import type {
  RunningWorktreeServerResult,
  SpawnOptions,
  WorktreeOpenResult,
} from "../server/worktree/open";

let dir: string;
let registryPath: string;

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function makeRepo(name: string): string {
  const root = join(dir, name);
  mkdirSync(join(root, "src"), { recursive: true });
  git(root, "init", "-q");
  writeFileSync(join(root, "README.md"), "sample\n");
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.name=sample",
    "-c",
    "user.email=sample@example.invalid",
    "commit",
    "-qm",
    "init",
  );
  return realpathSync(root);
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "cv-projects-")));
  registryPath = join(dir, "state", "projects.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function registered(): string[] {
  const read = readProjectRegistry(registryPath);
  if (read.ok === false) throw new Error(read.error);
  return read.registry.projects.map((project) => project.root);
}

describe("the project registry on disk", () => {
  test("a subfolder, a worktree and the root all register the same git root once", async () => {
    const root = makeRepo("sample-repo");
    git(root, "worktree", "add", "-q", join(dir, "sample-wt"), "-b", "wt");
    const add = (path: string) =>
      changeProjects({ action: "add", path }, root, 1, registryPath);
    expect((await add(join(root, "src"))).root).toBe(root);
    for (const path of [root, join(dir, "sample-wt")]) {
      const error = await add(path).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ProjectRegistryError);
      expect((error as ProjectRegistryError).code).toBe("conflict");
    }
    expect(registered()).toEqual([root]);
  });

  test("a folder outside git is refused with the reason", async () => {
    mkdirSync(join(dir, "plain"));
    const error = await changeProjects(
      { action: "add", path: join(dir, "plain") },
      dir,
      1,
      registryPath,
    ).catch((caught: unknown) => caught);
    expect((error as Error).message).toContain(
      "is not inside a git repository",
    );
    expect(existsSync(registryPath)).toBe(false);
  });

  test("add, rename, move and remove, in the user's order", async () => {
    const a = makeRepo("repo-a");
    const b = makeRepo("repo-b");
    const run = (change: Parameters<typeof changeProjects>[0]) =>
      changeProjects(change, a, 1, registryPath);
    await run({ action: "add", path: a });
    await run({ action: "add", path: b, name: "Second" });
    await run({ action: "move", root: b, direction: -1 });
    expect(registered()).toEqual([b, a]);
    await run({ action: "rename", root: a, name: "First" });
    await run({ action: "remove", root: b });
    const read = readProjectRegistry(registryPath);
    expect(
      read.ok && read.registry.projects.map((p) => [p.root, p.name]),
    ).toEqual([[a, "First"]]);
    // 外しても、リポジトリはそのまま。
    expect(existsSync(join(b, "README.md"))).toBe(true);
  });

  test.each([
    ["not JSON", "{ broken"],
    [
      "the wrong shape",
      JSON.stringify({ version: 1, projects: [{ root: "x" }] }),
    ],
  ])("a broken registry (%s) is reported and never overwritten", async (_label, text) => {
    const root = makeRepo("sample-repo");
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(registryPath, text);
    const read = readProjectRegistry(registryPath);
    expect(read.ok).toBe(false);
    const error = await changeProjects(
      { action: "add", path: root },
      root,
      1,
      registryPath,
    ).catch((caught: unknown) => caught);
    expect((error as ProjectRegistryError).code).toBe("unreadable");
    expect((error as Error).message).toContain(registryPath);
    expect(readFileSync(registryPath, "utf8")).toBe(text);
  });

  test("concurrent writers do not lose each other's projects", async () => {
    const roots = Array.from(
      { length: 12 },
      (_, index) => `/work/sample-${index}`,
    );
    await Promise.all(
      roots.map((root, index) =>
        updateProjectRegistry(registryPath, (registry) => ({
          ok: true,
          registry: {
            version: 1,
            projects: [
              ...registry.projects,
              { root, name: `sample-${index}`, addedAt: "x" },
            ],
          },
          project: { root, name: `sample-${index}`, addedAt: "x" },
        })),
      ),
    );
    expect(registered().sort()).toEqual([...roots].sort());
    expect(existsSync(`${registryPath}.lock`)).toBe(false);
  });

  test("another process holding the lock makes the writer wait, a dead holder's lock is taken over", async () => {
    mkdirSync(join(dir, "state"), { recursive: true });
    const lock = tryAcquireFileLock(`${registryPath}.lock`, {
      staleMs: 60_000,
    });
    expect(lock).not.toBeNull();
    let done = false;
    const writing = changeProjects(
      { action: "add", path: makeRepo("repo-a") },
      dir,
      1,
      registryPath,
    ).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(done).toBe(false);
    lock?.release();
    await writing;
    expect(registered()).toHaveLength(1);

    // 居なくなったプロセスのロックは奪う。
    writeFileSync(
      `${registryPath}.lock`,
      JSON.stringify({ token: "sample", pid: 999_999, createdAt: Date.now() }),
    );
    await changeProjects(
      { action: "add", path: makeRepo("repo-b") },
      dir,
      1,
      registryPath,
    );
    expect(registered()).toHaveLength(2);
  });
});

describe("opening a registered project", () => {
  const ROOT = "/work/sample-repo";

  function deps(
    over: Partial<ProjectServerDeps> & {
      opens?: SpawnOptions[];
    },
  ): ProjectServerDeps {
    return {
      registryPath,
      running: async (): Promise<RunningWorktreeServerResult> => ({
        status: "absent",
      }),
      open: async (_root, options): Promise<WorktreeOpenResult> => {
        over.opens?.push(options);
        return {
          status: "ok",
          url: `http://127.0.0.1:${options.port || 64200}/`,
          started: true,
        };
      },
      stop: async () => undefined,
      ...over,
    };
  }

  async function register(port?: number): Promise<void> {
    await updateProjectRegistry(registryPath, (registry) => ({
      ok: true,
      registry: {
        version: 1,
        projects: [
          ...registry.projects,
          {
            root: ROOT,
            name: "sample-repo",
            addedAt: "x",
            ...(port ? { port } : {}),
          },
        ],
      },
      project: { root: ROOT, name: "sample-repo", addedAt: "x" },
    }));
  }

  test("running: goes there without starting anything", async () => {
    await register();
    const opens: SpawnOptions[] = [];
    const result = await openRegisteredProject(
      ROOT,
      deps({
        opens,
        running: async () => ({
          status: "running",
          url: "http://127.0.0.1:64150/",
          pid: 1,
          launched: false,
        }),
      }),
    );
    expect(result).toEqual({ url: "http://127.0.0.1:64150/", started: false });
    expect(opens).toEqual([]);
  });

  test.each([
    ["nothing remembered", undefined],
    ["a port remembered by an older version", 64200],
  ])("stopped (%s): starts it on an automatic port", async (_label, port) => {
    await register(port);
    const opens: SpawnOptions[] = [];
    const result = await openRegisteredProject(ROOT, deps({ opens }));
    expect(result).toEqual({ url: "http://127.0.0.1:64200/", started: true });
    expect(opens.map((item) => item.port)).toEqual([0]);
  });

  test.each<[string, WorktreeOpenResult, string]>([
    ["the repository is gone", { status: "missing" }, "does not exist"],
    [
      "the server exits",
      { status: "error", error: new Error("exited: sample reason") },
      "sample reason",
    ],
    [
      "the server never answers",
      { status: "timeout" },
      "did not start in time",
    ],
  ])("fails with the reason when %s", async (_label, outcome, reason) => {
    await register();
    const error = await openRegisteredProject(
      ROOT,
      deps({ open: async () => outcome }),
    ).catch((caught: unknown) => caught);
    expect((error as Error).message).toContain(reason);
  });

  test("an unregistered project is never started", async () => {
    const opens: SpawnOptions[] = [];
    const error = await openRegisteredProject(ROOT, deps({ opens })).catch(
      (caught: unknown) => caught,
    );
    expect((error as ProjectRegistryError).code).toBe("not-found");
    expect(opens).toEqual([]);
  });

  test.each<[string, RunningWorktreeServerResult, string, "stopped" | string]>([
    [
      "started by code-viewer",
      {
        status: "running",
        url: "http://127.0.0.1:64150/",
        pid: 1,
        launched: true,
      },
      "/work/other",
      "stopped",
    ],
    [
      "started by the user",
      {
        status: "running",
        url: "http://127.0.0.1:64150/",
        pid: 1,
        launched: false,
      },
      "/work/other",
      "started outside code-viewer",
    ],
    [
      "this screen's own server",
      {
        status: "running",
        url: "http://127.0.0.1:64150/",
        pid: 1,
        launched: true,
      },
      ROOT,
      "cannot be stopped from here",
    ],
  ])("stop: %s", async (_label, running, serverRoot, expected) => {
    const stopped: string[] = [];
    const outcome = await stopLaunchedServer(
      ROOT,
      serverRoot,
      deps({
        running: async () => running,
        stop: async (root) => {
          stopped.push(root);
        },
      }),
    ).catch((caught: unknown) => caught);
    if (expected === "stopped") {
      expect(outcome).toEqual({ stopped: true });
      expect(stopped).toEqual([ROOT]);
    } else {
      expect((outcome as Error).message).toContain(expected);
      expect(stopped).toEqual([]);
    }
  });
});

describe("user settings on disk", () => {
  const repo: AppSettingsState = {
    version: 1,
    theme: "dark",
    language: "ja",
    codeFontSize: "large",
    hideTests: true,
  };
  let path: string;
  beforeEach(() => {
    path = join(dir, "state", "settings.json");
  });

  test("the first read takes over the repository values; later repositories do not override them", async () => {
    expect(readUserSettings(path)).toBeNull();
    expect(await ensureUserSettings(path, repo)).toEqual({
      version: 1,
      theme: "dark",
      language: "ja",
      codeFontSize: "large",
    });
    const other: AppSettingsState = {
      version: 1,
      theme: "light",
      language: "en",
    };
    expect((await ensureUserSettings(path, other)).theme).toBe("dark");
  });

  test("a change is written for every project; null goes back to the default", async () => {
    await ensureUserSettings(path, repo);
    await patchUserSettings(path, { theme: "light", codeFontSize: null }, repo);
    expect(readUserSettings(path)).toEqual({
      version: 1,
      theme: "light",
      language: "ja",
    });
  });

  test("per-repository keys never go into the user file", async () => {
    await patchUserSettings(path, { theme: "light", hideTests: false }, repo);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      version: 1,
      theme: "light",
      language: "ja",
      codeFontSize: "large",
    });
  });

  test("a broken file is reported and not overwritten", async () => {
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(path, "{ broken");
    await expect(ensureUserSettings(path, repo)).rejects.toThrow(
      "are not valid JSON",
    );
    await expect(
      patchUserSettings(path, { theme: "light" }, repo),
    ).rejects.toThrow("are not valid JSON");
    expect(readFileSync(path, "utf8")).toBe("{ broken");
  });
});

describe("/_state/settings across two repositories", () => {
  let previousStateDir: string | undefined;
  beforeEach(() => {
    previousStateDir = process.env.CODE_VIEWER_TEST_STATE_DIR;
    process.env.CODE_VIEWER_TEST_STATE_DIR = join(dir, "state");
  });
  afterEach(() => {
    if (previousStateDir === undefined) {
      delete process.env.CODE_VIEWER_TEST_STATE_DIR;
    } else {
      process.env.CODE_VIEWER_TEST_STATE_DIR = previousStateDir;
    }
  });

  function repoWithSettings(name: string, settings: object): string {
    const root = join(dir, name);
    mkdirSync(join(root, ".code-viewer"), { recursive: true });
    writeFileSync(
      join(root, ".code-viewer", "settings.json"),
      `${JSON.stringify({ version: 1, ...settings }, null, 2)}\n`,
    );
    return root;
  }

  async function call(root: string, patch?: object): Promise<AppSettingsState> {
    const url = new URL("http://127.0.0.1/_state/settings");
    const req = new Request(url, {
      method: patch ? "PATCH" : "GET",
      headers: { "Content-Type": "application/json" },
      ...(patch ? { body: JSON.stringify(patch) } : {}),
    });
    const res = await handleStateRoute(req, url, root, () => true);
    if (!res || res.status !== 200) {
      throw new Error(`HTTP ${res?.status}: ${await res?.text()}`);
    }
    return (await res.json()) as AppSettingsState;
  }

  const repoFile = (root: string) =>
    readFileSync(join(root, ".code-viewer", "settings.json"), "utf8");

  test("the first repository's values carry over, and stay the same after moving", async () => {
    const a = repoWithSettings("repo-a", {
      theme: "dark",
      language: "ja",
      hideTests: true,
    });
    const b = repoWithSettings("repo-b", { theme: "light", language: "en" });
    const aBefore = repoFile(a);
    const bBefore = repoFile(b);

    expect(await call(a)).toMatchObject({
      theme: "dark",
      language: "ja",
      hideTests: true,
    });
    // 移った先のリポジトリに別の値が残っていても、見た目は変わらない。
    expect(await call(b)).toMatchObject({ theme: "dark", language: "ja" });

    // 人に付く項目を変えても、リポジトリの設定ファイルは書き換わらない。
    expect(await call(b, { theme: "light" })).toMatchObject({ theme: "light" });
    expect((await call(a)).theme).toBe("light");
    expect(repoFile(a)).toBe(aBefore);
    expect(repoFile(b)).toBe(bBefore);

    // リポジトリに付く項目は、今までどおりそのリポジトリだけ。
    await call(b, { hideTests: false });
    expect((await call(a)).hideTests).toBe(true);
    expect(JSON.parse(repoFile(b)).hideTests).toBe(false);
  });

  test("a broken shared file: the repository settings are shown with the reason", async () => {
    const a = repoWithSettings("repo-a", { theme: "dark" });
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(join(dir, "state", "settings.json"), "{ broken");
    const shown = await call(a);
    expect(shown.theme).toBe("dark");
    expect(shown.userSettingsError).toContain("are not valid JSON");
    expect(readFileSync(join(dir, "state", "settings.json"), "utf8")).toBe(
      "{ broken",
    );
  });
});

describe("doctor: projects", () => {
  test.each([
    ["nothing yet", null, null, ["ok", "ok"]],
    [
      "both readable",
      '{"version":1,"projects":[]}',
      '{"version":1}',
      ["ok", "ok"],
    ],
    ["both broken", "{ broken", "{ broken", ["warn", "warn"]],
  ])("%s", (_label, registryText, settingsText, statuses) => {
    const settingsPath = join(dir, "state", "settings.json");
    mkdirSync(join(dir, "state"), { recursive: true });
    if (registryText !== null) writeFileSync(registryPath, registryText);
    if (settingsText !== null) writeFileSync(settingsPath, settingsText);
    const group = checkProjects(registryPath, settingsPath);
    expect(group.rows.map((row) => row.status)).toEqual(statuses);
    // 読むだけ。作らない・書き換えない。
    expect(existsSync(registryPath)).toBe(registryText !== null);
    if (settingsText !== null) {
      expect(readFileSync(settingsPath, "utf8")).toBe(settingsText);
    }
  });
});

describe("relayAgentRead", () => {
  function server(pid: number, port: number): ServerRegistryEntry {
    return {
      url: `http://127.0.0.1:${port}/`,
      pid,
      root: `/work/repo-${port}`,
      started_at: "x",
    };
  }
  const refused = Object.assign(new Error("fetch failed"), {
    cause: { code: "ECONNREFUSED" },
  });

  test("tells every other server, skips itself and servers that are gone, reports the rest", async () => {
    const posted: { url: string; body: unknown }[] = [];
    const result = await relayAgentRead("%3", 1234, {
      selfPid: 10,
      listServers: () => ({
        servers: [
          server(10, 64001),
          server(11, 64002),
          server(12, 64003),
          server(13, 64004),
        ],
        errors: [
          { file: "/state/servers/broken.json", error: new Error("bad JSON") },
        ],
      }),
      entryRecord: () => null,
      post: async (url, body) => {
        posted.push({ url, body });
        if (url.includes("64003")) throw refused;
        if (url.includes("64004"))
          return new Response("forbidden", { status: 403 });
        return new Response("{}", { status: 200 });
      },
    });
    expect(posted.map((item) => item.url).sort()).toEqual([
      "http://127.0.0.1:64002/_agent/state",
      "http://127.0.0.1:64003/_agent/state",
      "http://127.0.0.1:64004/_agent/state",
    ]);
    // 送り先では送り直さない (relay を付けない)。
    expect(posted[0]?.body).toEqual({ target: "%3", event: "read", at: 1234 });
    expect(result.reached).toBe(1);
    expect(result.failures).toEqual([
      "/state/servers/broken.json: Error: bad JSON",
      "http://127.0.0.1:64004/_agent/state: Error: HTTP 403: forbidden",
    ]);
  });
});

describe("relayAgentRead with the entry server", () => {
  test("a standalone server tells the entry server and skips the entry's project processes", async () => {
    const posted: string[] = [];
    const result = await relayAgentRead("%3", 1234, {
      selfPid: 10,
      listServers: () => ({
        servers: [
          {
            url: "http://127.0.0.1:64001/",
            pid: 10,
            root: "/work/self",
            started_at: "x",
          },
          {
            url: "http://127.0.0.1:64002/",
            pid: 11,
            root: "/work/backend",
            started_at: "x",
            launched: true,
            backend: true,
          },
        ],
        errors: [],
      }),
      entryRecord: () => ({
        url: "http://127.0.0.1:64100/",
        pid: process.pid,
        token: "0123456789abcdef",
        version: "1.0.0",
        started_at: "2026-01-01T00:00:00.000Z",
      }),
      post: async (url) => {
        posted.push(url);
        return new Response("{}", { status: 200 });
      },
    });
    expect(posted).toEqual(["http://127.0.0.1:64100/_agent/state"]);
    expect(result).toEqual({ reached: 1, failures: [] });
  });
});

describe("polling tmux fast only while someone watches", () => {
  test.each([
    ["just asked", 0, ACTIVITY_POLL_INTERVAL_MS],
    ["asked 30 s ago", 30_000, ACTIVITY_POLL_INTERVAL_MS],
    ["nobody asked for 31 s", 31_000, ACTIVITY_IDLE_POLL_INTERVAL_MS],
    ["nobody asked for an hour", 3_600_000, ACTIVITY_IDLE_POLL_INTERVAL_MS],
  ])("%s", (_label, sinceWatched, expected) => {
    expect(activityPollDelay(100_000_000, 100_000_000 - sinceWatched)).toBe(
      expected,
    );
  });

  test.each([
    ["swept just now", 0, false],
    ["swept on the fast cadence", ACTIVITY_POLL_INTERVAL_MS, false],
    ["only the slow sweep", ACTIVITY_IDLE_POLL_INTERVAL_MS, true],
    ["never swept", 100_000_000, true],
  ])("stale before answering: %s", (_label, sinceSweep, expected) => {
    expect(activityIsStale(100_000_000, 100_000_000 - sinceSweep)).toBe(
      expected,
    );
  });
});
