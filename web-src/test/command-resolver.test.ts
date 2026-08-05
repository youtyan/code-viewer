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
import { afterEach, describe, expect, test } from "vitest";
import {
  commandForExternal,
  configureExternalCommands,
  parseExternalCommandOverride,
  resetExternalCommandsForTest,
} from "../server/command-resolver";

const tmpRoots: string[] = [];

afterEach(() => {
  resetExternalCommandsForTest();
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

function executable(root: string, name: string): string {
  const path = join(root, name);
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
}

describe("external command resolver", () => {
  test("defaults to PATH command names when no override is configured", () => {
    const root = tempRoot("code-viewer-command-default-");

    expect(configureExternalCommands({ cwd: root, env: {} })).toEqual({
      ok: true,
    });
    expect(commandForExternal("git")).toBe("git");
    expect(commandForExternal("rg")).toBe("rg");
    expect(commandForExternal("docker")).toBe("docker");
    expect(commandForExternal("gh")).toBe("gh");
  });

  test("accepts env overrides and lets CLI overrides win", () => {
    const root = tempRoot("code-viewer-command-override-");
    const envGit = executable(root, "env-git");
    const cliGit = executable(root, "cli-git");
    const docker = executable(root, "docker-bin");

    const configured = configureExternalCommands({
      cwd: tempRoot("code-viewer-command-cwd-"),
      env: {
        CODE_VIEWER_BIN_GIT: envGit,
        CODE_VIEWER_BIN_DOCKER: docker,
      },
      cliOverrides: [{ name: "git", path: cliGit }],
    });

    expect(configured).toEqual({ ok: true });
    expect(commandForExternal("git")).toBe(realpathSync(cliGit));
    expect(commandForExternal("docker")).toBe(realpathSync(docker));
    expect(commandForExternal("rg")).toBe("rg");
  });

  test("keeps the previous active overrides when reconfiguration fails", () => {
    const cwd = tempRoot("code-viewer-command-stable-cwd-");
    const git = executable(tempRoot("code-viewer-command-stable-bin-"), "git");

    expect(
      configureExternalCommands({
        cwd,
        env: {},
        cliOverrides: [{ name: "git", path: git }],
      }),
    ).toEqual({ ok: true });
    expect(commandForExternal("git")).toBe(realpathSync(git));

    expect(
      configureExternalCommands({
        cwd,
        env: {},
        cliOverrides: [{ name: "docker", path: "docker" }],
      }),
    ).toEqual({
      ok: false,
      error: "--bin docker: path must be absolute",
    });
    expect(commandForExternal("git")).toBe(realpathSync(git));

    expect(configureExternalCommands({ cwd, env: {} })).toEqual({ ok: true });
    expect(commandForExternal("git")).toBe("git");
  });

  test("allowedNames limits both env and CLI overrides", () => {
    const cwd = tempRoot("code-viewer-command-allowed-");
    const git = executable(tempRoot("code-viewer-command-git-"), "git-bin");

    expect(
      configureExternalCommands({
        cwd,
        env: {
          CODE_VIEWER_BIN_GIT: git,
          CODE_VIEWER_BIN_DOCKER: "relative-docker",
        },
        allowedNames: ["git"],
      }),
    ).toEqual({ ok: true });
    expect(commandForExternal("git")).toBe(realpathSync(git));
    expect(commandForExternal("docker")).toBe("docker");

    expect(
      configureExternalCommands({
        cwd,
        env: {},
        cliOverrides: [{ name: "docker", path: "/opt/bin/docker" }],
        allowedNames: ["git"],
      }),
    ).toEqual({
      ok: false,
      error: "--bin unsupported command: docker",
    });
  });

  test("parses only supported command names", () => {
    expect(parseExternalCommandOverride("git=/opt/bin/git")).toEqual({
      ok: true,
      override: { name: "git", path: "/opt/bin/git" },
    });
    expect(parseExternalCommandOverride("psql=/opt/bin/psql")).toEqual({
      ok: false,
      error: "--bin unsupported command: psql",
    });
    expect(parseExternalCommandOverride("git")).toEqual({
      ok: false,
      error: "--bin requires <name>=<absolute-path>",
    });
  });

  test("rejects relative or non-executable override paths", () => {
    const root = tempRoot("code-viewer-command-invalid-");

    expect(
      configureExternalCommands({
        cwd: root,
        env: {},
        cliOverrides: [{ name: "git", path: "git" }],
      }),
    ).toEqual({
      ok: false,
      error: "--bin git: path must be absolute",
    });

    expect(
      configureExternalCommands({
        cwd: root,
        env: {},
        cliOverrides: [{ name: "git", path: join(root, "missing-git") }],
      }),
    ).toEqual({
      ok: false,
      error: "--bin git: path must point to an executable file",
    });
  });

  test("rejects executables inside the repository even from a subdirectory cwd", () => {
    const repo = tempRoot("code-viewer-command-repo-");
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, "subdir"));
    const repoGit = executable(repo, "git-wrapper");

    expect(
      configureExternalCommands({
        cwd: join(repo, "subdir"),
        env: {},
        cliOverrides: [{ name: "git", path: repoGit }],
      }),
    ).toEqual({
      ok: false,
      error:
        "--bin git: path must not point inside the current repository or working directory",
    });
  });

  test("rejects symlinks whose real target is inside the current cwd", () => {
    const cwd = tempRoot("code-viewer-command-cwd-");
    const outside = tempRoot("code-viewer-command-link-");
    const target = executable(cwd, "docker-wrapper");
    const link = join(outside, "docker");
    symlinkSync(target, link);

    expect(
      configureExternalCommands({
        cwd,
        env: {},
        cliOverrides: [{ name: "docker", path: link }],
      }),
    ).toEqual({
      ok: false,
      error:
        "--bin docker: path must not point inside the current repository or working directory",
    });
  });
});
