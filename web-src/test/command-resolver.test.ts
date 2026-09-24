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
  commandRunFailure,
  configureExternalCommands,
  parseExternalCommandOverride,
  resetExternalCommandsForTest,
} from "../server/command-resolver";
import { spawnTextAsync } from "../server/database/adapters/spawn-runner";
import { type RunFailure, runAsync, runSync } from "../server/runtime";

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
  });

  // どの操作がどのパスで、どの理由 (code) で落ちたかを返す。
  test.each([
    {
      name: "missing",
      make: () => undefined,
      step: "realpath",
      code: "ENOENT",
    },
    {
      name: "not executable",
      make: (path: string) => {
        writeFileSync(path, "#!/bin/sh\nexit 0\n");
        chmodSync(path, 0o644);
      },
      step: "access (X_OK)",
      code: "EACCES",
    },
  ])("says which check failed for a $name override", ({ make, step, code }) => {
    const root = realpathSync(tempRoot("code-viewer-command-reason-"));
    const path = join(root, "sample-git");
    make(path);

    const configured = configureExternalCommands({
      cwd: tempRoot("code-viewer-command-reason-cwd-"),
      env: {},
      cliOverrides: [{ name: "git", path }],
    });
    const [head, ...detail] =
      configured.ok === false ? configured.error.split("\n") : [""];
    expect({
      ok: configured.ok,
      head,
      code: detail.join("\n").includes(`"code":"${code}"`),
    }).toEqual({
      ok: false,
      head: `--bin git: path must point to an executable file: ${step} ${path} failed`,
      code: true,
    });
  });

  test("says why --cwd cannot be read when an override is configured", () => {
    const cwd = join(tempRoot("code-viewer-command-gone-"), "gone");
    const git = executable(tempRoot("code-viewer-command-gone-bin-"), "git");

    const configured = configureExternalCommands({
      cwd,
      env: {},
      cliOverrides: [{ name: "git", path: git }],
    });
    const [head, ...detail] =
      configured.ok === false ? configured.error.split("\n") : [""];
    expect({
      ok: configured.ok,
      head,
      code: detail.join("\n").includes('"code":"ENOENT"'),
    }).toEqual({
      ok: false,
      head: `--cwd must point to an existing directory: ${cwd}`,
      code: true,
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

/** node が spawn の失敗で出すのと同じ形の error。 */
function spawnError(code: string): RunFailure {
  return {
    kind: "spawn-error",
    error: Object.assign(new Error(`spawn tmux ${code}`), {
      code,
      syscall: "spawn tmux",
      path: "tmux",
    }),
  };
}

const TIMED_OUT: RunFailure = {
  kind: "timed-out",
  message:
    "tmux display-message -p timed out after 3000 ms (ETIMEDOUT; stopped at 3004 ms)",
  timeoutMs: 3000,
  elapsedMs: 3004,
};

describe("commandRunFailure", () => {
  // 「無い」は ENOENT だけ。時間切れと fork の失敗を「無い」にしない。
  test.each([
    { name: "success", result: { code: 0, stderr: "" }, expected: null },
    {
      name: "a non-zero exit",
      result: { code: 2, stderr: "sample failure" },
      expected: null,
    },
    {
      name: "ENOENT",
      result: {
        code: 1,
        stderr: "spawn tmux ENOENT",
        failure: spawnError("ENOENT"),
      },
      expected: { kind: "not-found", detail: "tmux not found in PATH" },
    },
    {
      name: "a timeout",
      result: {
        code: 1,
        stderr: "sample partial stderr",
        failure: TIMED_OUT,
      },
      expected: {
        kind: "timed-out",
        detail:
          "tmux display-message -p timed out after 3000 ms (ETIMEDOUT; stopped at 3004 ms)",
      },
    },
    {
      name: "EAGAIN",
      result: {
        code: 1,
        stderr: "spawn tmux EAGAIN",
        failure: spawnError("EAGAIN"),
      },
      expected: {
        kind: "could-not-start",
        detail:
          'tmux could not be started: Error: spawn tmux EAGAIN\nDetails: {"code":"EAGAIN","syscall":"spawn tmux","path":"tmux"}',
      },
    },
    {
      name: "EMFILE",
      result: {
        code: 1,
        stderr: "spawn tmux EMFILE",
        failure: spawnError("EMFILE"),
      },
      expected: {
        kind: "could-not-start",
        detail:
          'tmux could not be started: Error: spawn tmux EMFILE\nDetails: {"code":"EMFILE","syscall":"spawn tmux","path":"tmux"}',
      },
    },
    {
      name: "a working directory that does not exist",
      result: {
        code: 1,
        stderr: "spawn tmux ENOENT",
        failure: {
          kind: "cwd-missing",
          cwd: "/sample-missing-directory",
          error: Object.assign(new Error("spawn tmux ENOENT"), {
            code: "ENOENT",
            syscall: "spawn tmux",
          }),
        },
      } satisfies { code: number; stderr: string; failure: RunFailure },
      expected: {
        kind: "cwd-missing",
        detail:
          "tmux could not run because the working directory /sample-missing-directory does not exist or is not a directory",
      },
    },
    {
      name: "the old timeout text without a recorded failure",
      result: { code: 1, stderr: "spawn tmux ETIMEDOUT" },
      expected: null,
    },
    {
      name: "a shell that cannot find the command (exit 127)",
      result: { code: 127, stderr: "sh: tmux: command not found" },
      expected: { kind: "not-found", detail: "tmux not found in PATH" },
    },
  ])("$name", ({ result, expected }) => {
    expect(commandRunFailure("tmux", result)).toEqual(expected);
  });

  // runtime が実際に残す記録から同じ判定になる。
  test.each([
    {
      name: "runAsync stopped by its timeout",
      run: () => runAsync(["sh", "-c", "sleep 5"], "/", { timeout: 50 }),
    },
    {
      name: "runSync stopped by its timeout",
      run: async () => runSync(["sh", "-c", "sleep 5"], "/", { timeout: 50 }),
    },
  ])("$name is timed-out, with the command and the time", async ({ run }) => {
    const failure = commandRunFailure("git", await run());
    expect(failure?.kind).toBe("timed-out");
    expect(failure?.detail).toMatch(
      /^sh -c sleep 5 timed out after 50 ms \(ETIMEDOUT; stopped at \d+ ms\)$/,
    );
  });

  test.each([
    {
      name: "runAsync",
      run: () => runAsync(["code-viewer-no-such-command"], "/"),
    },
    {
      name: "runSync",
      run: async () => runSync(["code-viewer-no-such-command"], "/"),
    },
  ])("$name of a command that does not exist is not-found", async ({ run }) => {
    expect(commandRunFailure("git", await run())).toEqual({
      kind: "not-found",
      detail: "git not found in PATH",
    });
  });
});

describe("commandRunFailure for a working directory that cannot be used", () => {
  // 無いディレクトリは node が `spawn git ENOENT` で、ファイルは spawn が同期で
  // 投げる `spawn ENOTDIR` で知らせる。どちらも「git が無い」と出さず、reject
  // もしない。
  const entries = [
    {
      entry: "runAsync",
      run: (cwd: string) => runAsync(["git", "--version"], cwd),
    },
    {
      entry: "runSync",
      run: async (cwd: string) => runSync(["git", "--version"], cwd),
    },
    {
      entry: "spawnTextAsync",
      run: (cwd: string) =>
        spawnTextAsync({
          command: "git",
          args: ["--version"],
          cwd,
          timeoutMs: 10_000,
          abortMessage: "sample aborted",
          timeoutMessage: "sample timed out",
          rejectOnError: false,
        }),
    },
  ];
  const places = [
    {
      place: "a directory that does not exist",
      cwd: () => "/code-viewer-sample-missing-directory",
    },
    {
      place: "a file",
      cwd: () => {
        const file = join(tempRoot("code-viewer-cwd-file-"), "sample.txt");
        writeFileSync(file, "sample");
        return file;
      },
    },
  ];
  test.each(
    places.flatMap((place) => entries.map((entry) => ({ ...place, ...entry }))),
  )("$entry in $place", async ({ run, cwd }) => {
    const dir = cwd();
    expect(commandRunFailure("git", await run(dir))).toEqual({
      kind: "cwd-missing",
      detail: `git could not run because the working directory ${dir} does not exist or is not a directory`,
    });
  });
});
