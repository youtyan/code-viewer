import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type MockInstance,
  test,
  vi,
} from "vitest";
import * as opener from "../server/os-opener";
import { handleShellRoute } from "../server/shell/handle";
import { callRoute, postRoute } from "./_test-helpers";

let root: string;
let repo: string;
let open: MockInstance<typeof opener.openDirectoryInOs>;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "terminal-path-")));
  repo = join(root, "repo");
  mkdirSync(repo);
  mkdirSync(join(repo, "sample folder"));
  mkdirSync(join(repo, ".git"));
  writeFileSync(join(repo, "sample file.ts"), "sample");
  writeFileSync(join(root, "external.txt"), "sample");
  symlinkSync(join(root, "external.txt"), join(repo, "outside.txt"));
  symlinkSync(join(repo, ".git"), join(repo, "alias"));
  open = vi.spyOn(opener, "openDirectoryInOs").mockResolvedValue(undefined);
});
afterEach(() => {
  open.mockRestore();
  rmSync(root, { recursive: true, force: true });
});

const post = (body: unknown) =>
  postRoute(handleShellRoute, "/_shell/open-path", body, () => true, repo);

describe("terminal path navigation", () => {
  test.each([
    { name: "file with spaces", file: "sample file.ts", kind: "file" },
    { name: "directory with spaces", file: "sample folder", kind: "directory" },
    { name: "repository root", file: "", kind: "directory" },
  ])("returns an in-app target for $name", async ({ file, kind }) => {
    const res = await post({ path: join(repo, file) });
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ kind, path: file });
    expect(open).not.toHaveBeenCalled();
  });
  test("file URLs are decoded before navigation", async () => {
    const res = await post({
      path: pathToFileURL(join(repo, "sample file.ts")).href,
    });
    expect(await res?.json()).toEqual({ kind: "file", path: "sample file.ts" });
  });
  test.each([
    { name: "outside file", file: "external.txt" },
    { name: "outside symlink", file: "repo/outside.txt" },
  ])("reveals the containing folder for $name", async ({ file }) => {
    const res = await post({ path: join(root, file) });
    expect(await res?.json()).toEqual({ kind: "external" });
    expect(open).toHaveBeenCalledWith(root);
  });
  test.each([
    { name: "relative path", path: "sample file.ts", status: 400 },
    { name: "empty path", path: "", status: 400 },
    { name: "control character", path: "/repo/\u0000file", status: 400 },
    { name: "missing field", path: undefined, status: 400 },
    { name: "non-string field", path: 1, status: 400 },
  ])("rejects $name", async ({ path, status }) => {
    expect((await post({ path }))?.status).toBe(status);
    expect(open).not.toHaveBeenCalled();
  });
  test.each([
    { name: "Git directory", file: ".git" },
    { name: "symlink to Git directory", file: "alias" },
  ])("does not open $name", async ({ file }) => {
    expect((await post({ path: join(repo, file) }))?.status).toBe(403);
    expect(open).not.toHaveBeenCalled();
  });
  test("a missing file reports its full filesystem error", async () => {
    const path = join(repo, "missing.ts");
    const res = await post({ path });
    expect(res?.status).toBe(404);
    expect(await res?.text()).toContain(
      `ENOENT: no such file or directory, realpath '${path}'`,
    );
  });
  test("OS opener failures retain the cause", async () => {
    open.mockRejectedValue(
      Object.assign(new Error("open failed"), {
        cause: new Error("process failed"),
      }),
    );
    const res = await post({ path: join(root, "external.txt") });
    expect(res?.status).toBe(500);
    expect(await res?.text()).toBe(
      "Error: open failed\nCaused by: Error: process failed",
    );
  });
  test.each([
    { name: "GET", init: {}, allowed: true, status: 405 },
    {
      name: "unmarked action",
      init: { method: "POST" },
      allowed: false,
      status: 403,
    },
    {
      name: "wrong media type",
      init: { method: "POST", body: "{}" },
      allowed: true,
      status: 415,
    },
    {
      name: "invalid JSON",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      },
      allowed: true,
      status: 400,
    },
    {
      name: "oversize body",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: " ".repeat(16385),
      },
      allowed: true,
      status: 413,
    },
  ])("rejects $name before touching the OS", async ({
    init,
    allowed,
    status,
  }) => {
    const res = await callRoute(
      handleShellRoute,
      "/_shell/open-path",
      init,
      () => allowed,
      repo,
    );
    expect(res?.status).toBe(status);
    expect(open).not.toHaveBeenCalled();
  });
});
