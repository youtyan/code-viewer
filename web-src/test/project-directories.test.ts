// 「プロジェクトを追加」がたどるディレクトリの一覧 (GET /_agent/projects/directories)。
//
// 一時ディレクトリの中だけを読む。最後の describe は単体のサーバ (--standalone) を
// 起こし、手前の requestAllowed がローカル以外の Origin を断ることと、一覧で
// 選んだ場所を既存の登録の経路で登録すると一覧 (/_agent/overview) に出ることを
// 確かめる (状態ディレクトリと登録簿はこのテストの一時ディレクトリ)。

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { AgentOverviewResponse } from "../core/agent-overview";
import type { ProjectDirectoryListing } from "../core/projects";
import { listProjectDirectory } from "../server/projects/directories";
import { handleAgentRoute } from "../server/terminal/handle";
import { callRoute } from "./_test-helpers";

const REPO_ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
);
const CLI_BUNDLE = join(REPO_ROOT, "dist", "code-viewer.js");

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "cv-directories-")));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function mkdirs(...names: string[]): void {
  for (const name of names) mkdirSync(join(dir, name), { recursive: true });
}

async function get(
  query: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await callRoute(
    handleAgentRoute,
    `/_agent/projects/directories?${new URLSearchParams(query)}`,
  );
  if (!res) throw new Error("the route did not answer");
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe("listing the child directories", () => {
  test("returns only directories (a link to one counts), in name order (numbers by value, case ignored), and no file names", async () => {
    mkdirs("sample-b", "Sample-a", "sample-10", "sample-9");
    writeFileSync(join(dir, "sample-file.txt"), "x");
    symlinkSync(join(dir, "sample-b"), join(dir, "sample-link"));
    symlinkSync(join(dir, "missing"), join(dir, "sample-broken"));
    const { status, body } = await get({ path: dir });
    expect(status).toBe(200);
    const listing = body as ProjectDirectoryListing;
    expect(listing.entries.map((entry) => entry.name)).toEqual([
      "sample-9",
      "sample-10",
      "Sample-a",
      "sample-b",
      "sample-link",
    ]);
    expect(JSON.stringify(body)).not.toContain("sample-file");
    expect(JSON.stringify(body)).not.toContain("sample-broken");
    expect(listing).toMatchObject({
      path: dir,
      total: 5,
      truncated: false,
    });
  });

  test.each([
    { hidden: undefined, names: ["sample-app"] },
    { hidden: "1", names: [".sample-hidden", "sample-app"] },
  ])("hidden directories only with hidden=$hidden", async ({
    hidden,
    names,
  }) => {
    mkdirs(".sample-hidden", "sample-app");
    const { body } = await get(hidden ? { path: dir, hidden } : { path: dir });
    expect(
      (body as ProjectDirectoryListing).entries.map((entry) => entry.name),
    ).toEqual(names);
  });

  test("marks the root of a repository and of a worktree (.git file), not a plain folder", async () => {
    mkdirs("sample-repo/.git", "sample-worktree", "sample-plain");
    writeFileSync(join(dir, "sample-worktree", ".git"), "gitdir: /x\n");
    const listing = await listProjectDirectory(dir, { hidden: false });
    expect(listing.entries).toEqual([
      { name: "sample-plain", git: false },
      { name: "sample-repo", git: true },
      { name: "sample-worktree", git: true },
    ]);
  });

  test("over the limit, lists the first ones and says how many there are", async () => {
    mkdirs("sample-1", "sample-2", "sample-3");
    const listing = await listProjectDirectory(dir, {
      hidden: false,
      limit: 2,
    });
    expect(listing.entries.map((entry) => entry.name)).toEqual([
      "sample-1",
      "sample-2",
    ]);
    expect(listing).toMatchObject({ total: 3, truncated: true });
  });

  test.each([
    { input: "~", expected: "" },
    { input: "~/sample-app", expected: "/sample-app" },
    { input: "~/sample-app/../sample-app/", expected: "/sample-app" },
  ])("$input is read from the home folder", async ({ input, expected }) => {
    mkdirs("sample-app");
    vi.stubEnv("HOME", dir);
    const { status, body } = await get({ path: input });
    expect(status).toBe(200);
    expect(body.path).toBe(`${dir}${expected}`);
  });

  test("the parent is one up, and / has none", async () => {
    mkdirs("sample-app/src");
    const inner = await listProjectDirectory(`${dir}/sample-app/src/..`, {
      hidden: false,
    });
    expect(inner).toMatchObject({ path: `${dir}/sample-app`, parent: dir });
    expect((await listProjectDirectory("/", { hidden: false })).parent).toBe(
      null,
    );
  });
});

describe("places that cannot be listed", () => {
  test.each([
    {
      name: "a missing folder",
      path: () => join(dir, "sample-missing"),
      status: 404,
      code: "not-found",
    },
    {
      name: "a file",
      path: () => join(dir, "sample-file.txt"),
      status: 400,
      code: "not-directory",
    },
    {
      name: "a relative path",
      path: () => "sample-app",
      status: 400,
      code: "invalid",
    },
    { name: "no path", path: () => "", status: 400, code: "invalid" },
  ])("$name is $status with the reason", async ({ path, status, code }) => {
    writeFileSync(join(dir, "sample-file.txt"), "x");
    const { status: got, body } = await get({ path: path() });
    expect(got).toBe(status);
    expect(body.code).toBe(code);
    expect(body.error).toEqual(expect.any(String));
    if (path()) expect(body.error).toContain(path());
  });

  test("a folder that cannot be read is 403 with the reason from the system", async () => {
    mkdirs("sample-locked");
    const locked = join(dir, "sample-locked");
    chmodSync(locked, 0o000);
    try {
      const { status, body } = await get({ path: locked });
      expect(status).toBe(403);
      expect(body.code).toBe("unreadable");
      expect(body.error).toContain(locked);
      expect(body.error).toContain("EACCES");
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  test("only GET is taken", async () => {
    const res = await callRoute(
      handleAgentRoute,
      `/_agent/projects/directories?path=${encodeURIComponent(dir)}`,
      { method: "POST" },
    );
    expect(res?.status).toBe(405);
  });
});

describe("through a running server", () => {
  let server: ChildProcess | null = null;
  let origin = "";
  let work = "";

  beforeAll(async () => {
    work = realpathSync(mkdtempSync(join(tmpdir(), "cv-directories-server-")));
    const app = join(work, "sample-app");
    mkdirSync(app);
    const git = spawnSync("git", ["init", "-q"], {
      cwd: app,
      encoding: "utf8",
    });
    if (git.status !== 0) throw new Error(`git init failed: ${git.stderr}`);
    server = spawn(
      process.execPath,
      [CLI_BUNDLE, "--standalone", "--cwd", work, "--port", "0"],
      {
        cwd: REPO_ROOT,
        // 登録簿はこのテストの一時ディレクトリに置く (ほかのテストに残さない)。
        // 隠しにして、一覧に出ないようにする。
        env: {
          ...process.env,
          NO_COLOR: "1",
          CODE_VIEWER_TEST_STATE_DIR: join(work, ".state"),
          CODE_VIEWER_TEST_SERVER_REGISTRY_DIR: join(work, ".registry"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    origin = await new Promise<string>((resolve, reject) => {
      let output = "";
      const onData = (chunk: Buffer) => {
        output += chunk.toString("utf8");
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      };
      server?.stdout?.on("data", onData);
      server?.stderr?.on("data", onData);
      server?.once("exit", (code) =>
        reject(new Error(`the server exited: code=${code}\n${output}`)),
      );
      setTimeout(
        () => reject(new Error(`the server printed no URL:\n${output}`)),
        15000,
      );
    });
  });

  afterAll(async () => {
    if (server && server.exitCode === null) {
      const exited = new Promise((resolve) => server?.once("exit", resolve));
      server.kill("SIGTERM");
      await exited;
    }
    rmSync(work, { recursive: true, force: true });
  });

  test("another site's Origin is refused", async () => {
    const res = await fetch(
      `${origin}/_agent/projects/directories?path=${encodeURIComponent(work)}`,
      { headers: { Origin: "http://sample.invalid" } },
    );
    expect(res.status).toBe(403);
  });

  test("a folder chosen from the list is registered and listed", async () => {
    const list = await fetch(
      `${origin}/_agent/projects/directories?path=${encodeURIComponent(work)}`,
    );
    expect(list.status).toBe(200);
    const listing = (await list.json()) as ProjectDirectoryListing;
    expect(listing.entries).toEqual([{ name: "sample-app", git: true }]);
    const path = `${listing.path}/${listing.entries[0].name}`;
    const add = await fetch(`${origin}/_agent/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
        "X-Code-Viewer-Action": "1",
      },
      body: JSON.stringify({ action: "add", path }),
    });
    expect(add.status).toBe(200);
    const overview = (await (
      await fetch(`${origin}/_agent/overview`)
    ).json()) as AgentOverviewResponse;
    expect(
      overview.projects.find((project) => project.root === path)?.registered,
    ).toBeTruthy();
  });
});
