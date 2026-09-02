import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { supportsNativeRecursiveWatch } from "../server/worktree-watcher";
import { runGit as git } from "./_git-fixture";

/** 配布物と同じバンドル。vitest の globalSetup が焼いてある。 */
const CLI_BUNDLE = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "dist",
  "code-viewer.js",
);

const tmpRoots: string[] = [];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(
  exited: Promise<number | null>,
  timeoutMs: number,
): Promise<number | null | "timeout"> {
  return Promise.race([
    exited,
    sleep(timeoutMs).then(() => "timeout" as const),
  ]);
}

function waitForPreviewUrl(proc: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = output.match(
        /GDP_LISTEN_URL=(http:\/\/127\.0\.0\.1:\d+\/)/,
      );
      if (match) resolve(match[1]);
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.once("exit", (code) =>
      reject(new Error(`preview exited before listening: ${code}`)),
    );
  });
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function requestWithHost(
  url: string,
  host: string,
  origin?: string,
): Promise<{ status: number; body: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: "GET",
        headers: {
          Host: host,
          ...(origin === undefined ? {} : { Origin: origin }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function waitForOutput(
  readOutput: () => string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (pattern.test(readOutput())) return true;
    await sleep(10);
  }
  return pattern.test(readOutput());
}

function makeFakeBrowserCommand() {
  const root = mkdtempSync(join(tmpdir(), "code-viewer-open-"));
  tmpRoots.push(root);
  const log = join(root, "open.log");
  if (process.platform === "win32") return null;
  const commandNames =
    process.platform === "darwin" ? ["open"] : ["xdg-open", "gio", "cmd.exe"];
  for (const commandName of commandNames) {
    const command = join(root, commandName);
    writeFileSync(
      command,
      `#!/bin/sh\nlast=''\nfor arg do last=$arg; done\nprintf '%s\\n' "$last" > "${log}.tmp" && mv "${log}.tmp" "${log}"\n`,
    );
    chmodSync(command, 0o755);
  }
  return { root, log };
}

function makeFakeMissingGitCommand(): string {
  const root = mkdtempSync(join(tmpdir(), "code-viewer-missing-git-bin-"));
  tmpRoots.push(root);
  const command = join(root, "git");
  writeFileSync(
    command,
    "#!/bin/sh\nprintf 'spawn git ENOENT\\n' >&2\nexit 127\n",
  );
  chmodSync(command, 0o755);
  return command;
}

function makeFailingSearchRgCommand(): string {
  const root = mkdtempSync(join(tmpdir(), "code-viewer-failing-rg-bin-"));
  tmpRoots.push(root);
  const command = join(root, "rg");
  writeFileSync(
    command,
    '#!/bin/sh\n[ "$1" = "--version" ] && exit 0\nprintf \'sample rg regex failure\\n\' >&2\nexit 2\n',
  );
  chmodSync(command, 0o755);
  return command;
}

function makePathspecRequiredGitCommand(requiredPath: string): string {
  const root = mkdtempSync(join(tmpdir(), "code-viewer-pathspec-git-"));
  tmpRoots.push(root);
  const command = join(root, "git");
  const realGit = process.env.PATH?.split(":")
    .map((dir) => join(dir, "git"))
    .find((path) => existsSync(path));
  if (!realGit) throw new Error("git command is unavailable");
  writeFileSync(
    command,
    `#!/bin/sh
saw_metadata=0
saw_separator=0
saw_path=0
for arg in "$@"; do
  case "$arg" in --name-status|--numstat) saw_metadata=1 ;; esac
  [ "$saw_separator" = 1 ] && [ "$arg" = ${JSON.stringify(requiredPath)} ] && saw_path=1
  [ "$arg" = "--" ] && saw_separator=1
done
if [ "$saw_metadata" = 1 ] && [ "$saw_path" != 1 ]; then
  printf 'missing diff pathspec\n' >&2
  exit 2
fi
exec ${JSON.stringify(realGit)} "$@"
`,
  );
  chmodSync(command, 0o755);
  return command;
}

function makeGatedGitCommand(match: "numstat" | "ls-tree" | "file-diff"): {
  command: string;
  started: string;
  release: string;
} {
  const root = mkdtempSync(join(tmpdir(), "code-viewer-gated-git-"));
  tmpRoots.push(root);
  const command = join(root, "git");
  const started = join(root, "started");
  const release = join(root, "release");
  const claim = join(root, "claim");
  const stdout = join(root, "stdout");
  const stderr = join(root, "stderr");
  const status = join(root, "status");
  const realGit = process.env.PATH?.split(":")
    .map((dir) => join(dir, "git"))
    .find((path) => existsSync(path));
  if (!realGit) throw new Error("git command is unavailable");
  writeFileSync(
    command,
    `#!/bin/sh
matched=0
case ${JSON.stringify(match)} in
  numstat)
    for arg in "$@"; do [ "$arg" = "--numstat" ] && matched=1; done
    ;;
  ls-tree)
    saw_ls_tree=0
    saw_recursive=0
    for arg in "$@"; do
      [ "$arg" = "ls-tree" ] && saw_ls_tree=1
      [ "$arg" = "-r" ] && saw_recursive=1
    done
    [ "$saw_ls_tree" = 1 ] && [ "$saw_recursive" = 1 ] && matched=1
    ;;
  file-diff)
    saw_diff=0
    rejected=0
    for arg in "$@"; do
      [ "$arg" = "diff" ] && saw_diff=1
      case "$arg" in --name-status|--numstat|--no-index) rejected=1 ;; esac
    done
    [ "$saw_diff" = 1 ] && [ "$rejected" = 0 ] && matched=1
    ;;
esac
if [ "$matched" = 1 ] && mkdir ${JSON.stringify(claim)} 2>/dev/null; then
  ${JSON.stringify(realGit)} "$@" > ${JSON.stringify(stdout)} 2> ${JSON.stringify(stderr)}
  printf '%s' "$?" > ${JSON.stringify(status)}
  : > ${JSON.stringify(started)}
  while [ ! -e ${JSON.stringify(release)} ]; do sleep 0.01; done
  cat ${JSON.stringify(stdout)}
  cat ${JSON.stringify(stderr)} >&2
  exit "$(cat ${JSON.stringify(status)})"
fi
exec ${JSON.stringify(realGit)} "$@"
`,
  );
  chmodSync(command, 0o755);
  return { command, started, release };
}

function makeDoubleGatedGitCommand(): {
  command: string;
  gates: readonly [
    { started: string; release: string },
    { started: string; release: string },
  ];
} {
  const root = mkdtempSync(join(tmpdir(), "code-viewer-double-gated-git-"));
  tmpRoots.push(root);
  const command = join(root, "git");
  const gates = [
    { started: join(root, "started-1"), release: join(root, "release-1") },
    { started: join(root, "started-2"), release: join(root, "release-2") },
  ] as const;
  const realGit = process.env.PATH?.split(":")
    .map((dir) => join(dir, "git"))
    .find((path) => existsSync(path));
  if (!realGit) throw new Error("git command is unavailable");
  writeFileSync(
    command,
    `#!/bin/sh
matched=0
for arg in "$@"; do [ "$arg" = "--numstat" ] && matched=1; done
if [ "$matched" = 1 ]; then
  gate=0
  if mkdir ${JSON.stringify(join(root, "claim-1"))} 2>/dev/null; then
    gate=1
  elif mkdir ${JSON.stringify(join(root, "claim-2"))} 2>/dev/null; then
    gate=2
  fi
  if [ "$gate" != 0 ]; then
    stdout=${JSON.stringify(root)}/stdout-$gate
    stderr=${JSON.stringify(root)}/stderr-$gate
    status=${JSON.stringify(root)}/status-$gate
    ${JSON.stringify(realGit)} "$@" > "$stdout" 2> "$stderr"
    printf '%s' "$?" > "$status"
    : > ${JSON.stringify(root)}/started-$gate
    while [ ! -e ${JSON.stringify(root)}/release-$gate ]; do sleep 0.01; done
    cat "$stdout"
    cat "$stderr" >&2
    exit "$(cat "$status")"
  fi
fi
exec ${JSON.stringify(realGit)} "$@"
`,
  );
  chmodSync(command, 0o755);
  return { command, gates };
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function startTestPreview(
  root: string,
  gitCommand: string,
  rgCommand?: string,
) {
  const proc = spawn(
    process.execPath,
    [CLI_BUNDLE, "--port", "0", "--cwd", root],
    {
      cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
      env: {
        ...process.env,
        CODE_VIEWER_BIN_GIT: gitCommand,
        ...(rgCommand ? { CODE_VIEWER_BIN_RG: rgCommand } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = new Promise<number | null>((resolve) => {
    proc.once("exit", (code) => resolve(code));
  });
  try {
    const url = await Promise.race([
      waitForPreviewUrl(proc),
      sleep(15000).then(() => {
        throw new Error("preview did not start");
      }),
    ]);
    return { proc, exited, url };
  } catch (err) {
    proc.kill("SIGKILL");
    await waitForExit(exited, 3000);
    throw err;
  }
}

async function stopTestPreview(
  proc: ReturnType<typeof spawn>,
  exited: Promise<number | null>,
): Promise<void> {
  proc.kill("SIGKILL");
  if ((await waitForExit(exited, 3000)) === "timeout") {
    throw new Error("preview process did not exit after SIGKILL");
  }
}

async function refreshPreview(url: string): Promise<Response> {
  const origin = new URL(url).origin;
  return fetch(new URL("/refresh", url), {
    method: "POST",
    headers: {
      Origin: origin,
      "X-Code-Viewer-Action": "1",
    },
  });
}

describe("preview CLI", () => {
  const runOrSkip = process.platform === "win32" ? test.skip : test;

  runOrSkip(
    "--open launches the browser after the server port exists",
    async () => {
      const fakeBrowser = makeFakeBrowserCommand();
      if (!fakeBrowser) throw new Error("fake browser command is unavailable");

      const proc = spawn(
        process.execPath,
        [CLI_BUNDLE, "--port", "0", "--open"],
        {
          cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
          env: {
            ...process.env,
            PATH: `${fakeBrowser.root}:${process.env.PATH || ""}`,
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      const exited = new Promise<number | null>((resolve) => {
        proc.once("exit", (code) => resolve(code));
      });

      let cleanupTimedOut = false;
      let openedUrl = "";
      try {
        for (let i = 0; i < 50; i++) {
          const exitCode = await waitForExit(exited, 100);
          if (exitCode !== "timeout") {
            throw new Error(`preview exited early with ${exitCode}`);
          }
          if (existsSync(fakeBrowser.log)) {
            openedUrl = readFileSync(fakeBrowser.log, "utf8").trim();
            break;
          }
        }

        const url = new URL(openedUrl);
        expect(url.protocol).toBe("http:");
        expect(url.hostname).toBe("127.0.0.1");
        expect(Number(url.port) > 0).toBe(true);
        expect(url.pathname).toBe("/");
      } finally {
        proc.kill("SIGKILL");
        cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
      }
      if (cleanupTimedOut) {
        throw new Error("preview process did not exit after SIGKILL");
      }
    },
  );

  test("rejects requests with a non-loopback Host", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-viewer-request-host-"));
    tmpRoots.push(root);
    const preview = await startTestPreview(root, makeFakeMissingGitCommand());

    try {
      const response = await requestWithHost(
        preview.url,
        "example.invalid",
        "https://example.invalid",
      );
      expect(response.status).toBe(403);
      expect(response.body.length > 0).toBe(true);
    } finally {
      await stopTestPreview(preview.proc, preview.exited);
    }
  });

  test("/_grep returns rg regular-expression failures as HTTP 500", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-viewer-grep-failure-"));
    tmpRoots.push(root);
    const preview = await startTestPreview(
      root,
      makeFakeMissingGitCommand(),
      makeFailingSearchRgCommand(),
    );

    try {
      const response = await fetchWithTimeout(
        new URL("/_grep?q=%28&regex=1", preview.url).toString(),
        5000,
      );
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("sample rg regex failure");
    } finally {
      await stopTestPreview(preview.proc, preview.exited);
    }
  });

  test("/_grep keeps an unknown ref as a client error", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-viewer-grep-ref-"));
    tmpRoots.push(root);
    git(root, ["init", "-b", "main"]);
    const preview = await startTestPreview(
      root,
      makePathspecRequiredGitCommand("sample.txt"),
    );

    try {
      const response = await fetchWithTimeout(
        new URL("/_grep?ref=sample-missing&q=sample", preview.url).toString(),
        5000,
      );
      expect(response.status).toBe(400);
    } finally {
      await stopTestPreview(preview.proc, preview.exited);
    }
  });

  runOrSkip(
    "serves requests promptly while the worktree watcher scans a large tree",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-large-preview-"));
      tmpRoots.push(root);
      for (let i = 0; i < 700; i++) {
        mkdirSync(join(root, `dir-${i}`, "child"), { recursive: true });
        writeFileSync(join(root, `dir-${i}`, "child", "file.txt"), "x");
      }

      const proc = spawn(
        process.execPath,
        [CLI_BUNDLE, "--port", "0", "--cwd", root],
        {
          cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
          env: {
            ...process.env,
            CODE_VIEWER_WORKTREE_WATCH_LIMIT: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stderrOutput = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrOutput += chunk.toString("utf8");
      });
      const exited = new Promise<number | null>((resolve) => {
        proc.once("exit", (code) => resolve(code));
      });

      let cleanupTimedOut = false;
      try {
        const url = await Promise.race([
          waitForPreviewUrl(proc),
          sleep(15000).then(() => {
            throw new Error("preview did not start");
          }),
        ]);

        const started = Date.now();
        const responses = await Promise.all([
          fetchWithTimeout(url, 6000),
          fetchWithTimeout(
            new URL("/_tree?ref=worktree", url).toString(),
            6000,
          ),
          fetchWithTimeout(
            new URL("/_tree?ref=worktree&recursive=1", url).toString(),
            6000,
          ),
          fetchWithTimeout(new URL("/_db/files", url).toString(), 6000),
        ]);

        expect(Date.now() - started < 6000).toBe(true);
        expect(responses.map((response) => response.status)).toEqual([
          200, 200, 200, 200,
        ]);
        // A per-directory cap only exists where watching is per-directory.
        // macOS and Windows collapse the tree into one recursive handle, so
        // there is no cap to reach. The cap itself is covered by the
        // worktree-watcher unit tests on every platform.
        if (!supportsNativeRecursiveWatch(process.platform)) {
          expect(
            await waitForOutput(
              () => stderrOutput,
              /worktree watcher cap reached \(1\)/,
              1000,
            ),
          ).toBe(true);
        }
      } finally {
        proc.kill("SIGKILL");
        cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
      }
      if (cleanupTimedOut) {
        throw new Error("preview process did not exit after SIGKILL");
      }
    },
    // Creating the 700-directory fixture alone can take over 5s on a busy
    // filesystem, which is pure setup cost. What this test actually asserts —
    // responses arriving within 2500ms — is checked inside, so the outer budget
    // only has to be large enough to cover the fixture.
    20000,
  );

  runOrSkip("keeps an explicit non-git cwd as the project root", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-viewer-explicit-cwd-"));
    tmpRoots.push(root);
    const explicitCwd = join(root, "nested");
    mkdirSync(explicitCwd);

    const proc = spawn(
      process.execPath,
      [CLI_BUNDLE, "--port", "0", "--cwd", explicitCwd],
      {
        cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const exited = new Promise<number | null>((resolve) => {
      proc.once("exit", (code) => resolve(code));
    });

    let cleanupTimedOut = false;
    try {
      const url = await Promise.race([
        waitForPreviewUrl(proc),
        sleep(15000).then(() => {
          throw new Error("preview did not start");
        }),
      ]);
      const res = await fetchWithTimeout(`${url}_settings`, 5000);
      expect(res.status).toBe(200);
      const settings = (await res.json()) as { project?: string };
      expect(settings.project).toBe("nested");
    } finally {
      proc.kill("SIGKILL");
      cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
    }
    if (cleanupTimedOut) {
      throw new Error("preview process did not exit after SIGKILL");
    }
  });

  // git 管理外のディレクトリでは、diff と tmux ペイン一覧 (とその裏の巡回) が
  // 失敗する git を毎回起動して usage 全文でログを埋めていた。git を呼ばずに
  // 空で答えること、そして後から git init したら再起動なしで拾うことを見る。
  runOrSkip(
    "stays quiet outside a git repository and picks the repository up once it appears",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-outside-git-"));
      tmpRoots.push(root);
      writeFileSync(join(root, "sample.txt"), "sample\n");

      const proc = spawn(
        process.execPath,
        [CLI_BUNDLE, "--port", "0", "--cwd", root],
        {
          cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const output: string[] = [];
      const collect = (chunk: Buffer) => {
        output.push(chunk.toString("utf8"));
      };
      proc.stdout?.on("data", collect);
      proc.stderr?.on("data", collect);
      const exited = new Promise<number | null>((resolve) => {
        proc.once("exit", (code) => resolve(code));
      });
      const gitFailureLines = () =>
        output
          .join("")
          .split("\n")
          .filter((line) => line.includes("(git exit"));

      let cleanupTimedOut = false;
      try {
        const url = await Promise.race([
          waitForPreviewUrl(proc),
          sleep(15000).then(() => {
            throw new Error("preview did not start");
          }),
        ]);

        const settings = (await (
          await fetchWithTimeout(`${url}_settings`, 5000)
        ).json()) as { branch?: string };
        expect(settings.branch).toBeUndefined();

        const diffRes = await fetchWithTimeout(`${url}diff.json`, 5000);
        expect(diffRes.status).toBe(200);
        const diff = (await diffRes.json()) as {
          files: unknown[];
          range?: string;
          error?: string;
        };
        expect(diff.files).toEqual([]);
        expect(diff.range).toBe("HEAD");
        expect(diff.error).toBeUndefined();

        const panesRes = await fetchWithTimeout(`${url}_tmux/panes`, 5000);
        expect(panesRes.status).toBe(200);
        expect(gitFailureLines()).toEqual([]);

        git(root, ["init", "-b", "main"]);
        git(root, ["config", "user.email", "sample-author"]);
        git(root, ["config", "user.name", "sample-author"]);
        git(root, ["add", "sample.txt"]);
        git(root, ["commit", "-m", "sample initial commit"]);

        const after = (await (
          await fetchWithTimeout(`${url}_settings`, 5000)
        ).json()) as { branch?: string };
        expect(after.branch).toBe("main");
        const diffAfter = (await (
          await fetchWithTimeout(`${url}diff.json?nocache=1`, 5000)
        ).json()) as { files: unknown[]; branch?: string; error?: string };
        expect(diffAfter.branch).toBe("main");
        expect(diffAfter.files).toEqual([]);
        expect(diffAfter.error).toBeUndefined();
        expect(gitFailureLines()).toEqual([]);
      } finally {
        proc.kill("SIGKILL");
        cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
      }
      if (cleanupTimedOut) {
        throw new Error("preview process did not exit after SIGKILL");
      }
    },
  );

  runOrSkip("serves ranged raw files from a committed ref", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-viewer-ref-raw-"));
    tmpRoots.push(root);
    git(root, ["init", "-b", "main"]);
    git(root, ["config", "user.email", "sample-author"]);
    git(root, ["config", "user.name", "sample-author"]);
    writeFileSync(join(root, "sample.txt"), "abcdef\n");
    git(root, ["add", "sample.txt"]);
    git(root, ["commit", "-m", "sample initial commit"]);

    const proc = spawn(
      process.execPath,
      [CLI_BUNDLE, "--port", "0", "--cwd", root],
      {
        cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const exited = new Promise<number | null>((resolve) => {
      proc.once("exit", (code) => resolve(code));
    });

    let cleanupTimedOut = false;
    try {
      const url = await Promise.race([
        waitForPreviewUrl(proc),
        sleep(15000).then(() => {
          throw new Error("preview did not start");
        }),
      ]);
      const rawUrl = new URL("/_file?path=sample.txt&ref=HEAD", url).toString();
      const response = await fetch(rawUrl, {
        headers: { Range: "bytes=1-3" },
      });

      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 1-3/7");
      expect(response.headers.get("content-length")).toBe("3");
      expect(await response.text()).toBe("bcd");
    } finally {
      proc.kill("SIGKILL");
      cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
    }
    if (cleanupTimedOut) {
      throw new Error("preview process did not exit after SIGKILL");
    }
  });

  runOrSkip(
    "serves untracked file diffs even when git diff exits with differences",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-untracked-http-"));
      tmpRoots.push(root);
      git(root, ["init", "-b", "main"]);
      git(root, ["config", "user.email", "sample-author"]);
      git(root, ["config", "user.name", "sample-author"]);
      writeFileSync(join(root, "tracked.txt"), "base\n");
      git(root, ["add", "tracked.txt"]);
      git(root, ["commit", "-m", "sample initial commit"]);
      writeFileSync(join(root, "sample_new.ts"), "export const sample = 1;\n");

      const proc = spawn(
        process.execPath,
        [CLI_BUNDLE, "--port", "0", "--cwd", root],
        {
          cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const exited = new Promise<number | null>((resolve) => {
        proc.once("exit", (code) => resolve(code));
      });

      let cleanupTimedOut = false;
      try {
        const url = await Promise.race([
          waitForPreviewUrl(proc),
          sleep(15000).then(() => {
            throw new Error("preview did not start");
          }),
        ]);
        const diffUrl = new URL("/file_diff", url);
        diffUrl.searchParams.set("from", "HEAD");
        diffUrl.searchParams.set("to", "worktree");
        diffUrl.searchParams.set("untracked", "1");
        diffUrl.searchParams.set("ignore_ws", "1");
        diffUrl.searchParams.set("status", "A");
        diffUrl.searchParams.set("path", "sample_new.ts");

        const response = await fetchWithTimeout(diffUrl.toString(), 5000);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { diff: string; path: string };
        expect(body.path).toBe("sample_new.ts");
        expect(body.diff).toMatch(/diff --git/);
        expect(body.diff).toMatch(/\+export const sample = 1;/);
      } finally {
        proc.kill("SIGKILL");
        cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
      }
      if (cleanupTimedOut) {
        throw new Error("preview process did not exit after SIGKILL");
      }
    },
  );

  runOrSkip(
    "surfaces git command failures from preview HTTP endpoints",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-http-missing-git-"));
      tmpRoots.push(root);
      const explicitCwd = join(root, "repo");
      mkdirSync(explicitCwd);
      writeFileSync(join(explicitCwd, "sample.txt"), "alpha\n");
      const fakeGit = makeFakeMissingGitCommand();

      const proc = spawn(
        process.execPath,
        [CLI_BUNDLE, "--port", "0", "--cwd", explicitCwd],
        {
          cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
          env: { ...process.env, CODE_VIEWER_BIN_GIT: fakeGit },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const exited = new Promise<number | null>((resolve) => {
        proc.once("exit", (code) => resolve(code));
      });

      let cleanupTimedOut = false;
      try {
        const url = await Promise.race([
          waitForPreviewUrl(proc),
          sleep(15000).then(() => {
            throw new Error("preview did not start");
          }),
        ]);

        for (const path of [
          "_grep?ref=HEAD&q=",
          "_file_blame?path=sample.txt&ref=worktree",
          "file_diff?path=sample.txt",
        ]) {
          const res = await fetchWithTimeout(`${url}${path}`, 5000);
          expect(res.status).toBe(503);
          expect(await res.text()).toMatch(
            /git binary not found|git not found/,
          );
        }
      } finally {
        proc.kill("SIGKILL");
        cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
      }
      if (cleanupTimedOut) {
        throw new Error("preview process did not exit after SIGKILL");
      }
    },
  );

  runOrSkip(
    "/_tree gives a browsable non-submodule worktree commit entry directory metadata",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-gitlink-preview-"));
      tmpRoots.push(root);
      mkdirSync(join(root, "nested-repo"));
      writeFileSync(
        join(root, "nested-repo", ".git"),
        "gitdir: ../.git/modules/nested-repo\n",
      );
      mkdirSync(join(root, "submodule-dir"));
      writeFileSync(
        join(root, "submodule-dir", ".git"),
        "gitdir: ../.git/modules/submodule-dir\n",
      );
      writeFileSync(
        join(root, ".gitmodules"),
        [
          '[submodule "submodule-dir"]',
          "\tpath = submodule-dir",
          "\turl = ../sample.git",
          "",
        ].join("\n"),
      );

      const proc = spawn(
        process.execPath,
        [CLI_BUNDLE, "--port", "0", "--cwd", root],
        {
          cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const exited = new Promise<number | null>((resolve) => {
        proc.once("exit", (code) => resolve(code));
      });

      let cleanupTimedOut = false;
      try {
        const url = await Promise.race([
          waitForPreviewUrl(proc),
          sleep(15000).then(() => {
            throw new Error("preview did not start");
          }),
        ]);

        const response = await fetchWithTimeout(
          new URL("/_tree?ref=worktree", url).toString(),
          5000,
        );
        const body = (await response.json()) as {
          entries: Array<{
            path: string;
            type: string;
            submodule?: boolean;
            updated_at?: string;
          }>;
        };
        const nested = body.entries.find(
          (entry) => entry.path === "nested-repo",
        );
        const submodule = body.entries.find(
          (entry) => entry.path === "submodule-dir",
        );

        expect(nested?.type).toBe("commit");
        expect(nested?.submodule).toBe(undefined);
        expect(typeof nested?.updated_at).toBe("string");

        expect(submodule?.type).toBe("commit");
        expect(submodule?.submodule).toBe(true);
        expect(submodule?.updated_at).toBe(undefined);
      } finally {
        proc.kill("SIGKILL");
        cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
      }
      if (cleanupTimedOut) {
        throw new Error("preview process did not exit after SIGKILL");
      }
    },
  );

  runOrSkip(
    "/_tree includes a badged entry for a deleted-but-uncommitted file",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-deleted-tree-"));
      tmpRoots.push(root);
      git(root, ["init"]);
      git(root, ["config", "user.email", "test@example.com"]);
      git(root, ["config", "user.name", "Test"]);
      writeFileSync(join(root, "keep.txt"), "keep\n");
      writeFileSync(join(root, "gone.txt"), "gone\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-m", "initial"]);
      rmSync(join(root, "gone.txt"));

      const proc = spawn(
        process.execPath,
        [CLI_BUNDLE, "--port", "0", "--cwd", root],
        {
          cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const exited = new Promise<number | null>((resolve) => {
        proc.once("exit", (code) => resolve(code));
      });

      let cleanupTimedOut = false;
      try {
        const url = await Promise.race([
          waitForPreviewUrl(proc),
          sleep(15000).then(() => {
            throw new Error("preview did not start");
          }),
        ]);

        const response = await fetchWithTimeout(
          new URL("/_tree?ref=worktree", url).toString(),
          5000,
        );
        const body = (await response.json()) as {
          entries: Array<{ path: string; type: string; status?: string }>;
        };
        const deleted = body.entries.find((entry) => entry.path === "gone.txt");
        const kept = body.entries.find((entry) => entry.path === "keep.txt");

        expect(deleted?.type).toBe("blob");
        expect(deleted?.status).toBe("D");
        expect(kept?.status).toBe(undefined);
      } finally {
        proc.kill("SIGKILL");
        cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
      }
      if (cleanupTimedOut) {
        throw new Error("preview process did not exit after SIGKILL");
      }
    },
  );

  runOrSkip(
    "/_tree distinguishes untracked and ignored entries from tracked ones",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-untracked-tree-"));
      tmpRoots.push(root);
      git(root, ["init"]);
      git(root, ["config", "user.email", "test@example.com"]);
      git(root, ["config", "user.name", "Test"]);
      writeFileSync(join(root, ".gitignore"), "ignored.txt\nbuild/\n");
      writeFileSync(join(root, "tracked.txt"), "tracked\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-m", "initial"]);

      writeFileSync(join(root, "staged.txt"), "staged\n");
      git(root, ["add", "staged.txt"]);
      writeFileSync(join(root, "untracked.txt"), "new\n");
      writeFileSync(join(root, "ignored.txt"), "secret\n");
      mkdirSync(join(root, "build"));
      writeFileSync(join(root, "build", "out.js"), "generated\n");
      // A brand-new directory holding a file the ignore rules also name: the
      // directory reads untracked, the file inside it reads ignored.
      mkdirSync(join(root, "fresh-dir"));
      writeFileSync(join(root, "fresh-dir", "inside.txt"), "nested\n");
      writeFileSync(join(root, "fresh-dir", "ignored.txt"), "nested secret\n");

      const proc = spawn(
        process.execPath,
        [CLI_BUNDLE, "--port", "0", "--cwd", root],
        {
          cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const exited = new Promise<number | null>((resolve) => {
        proc.once("exit", (code) => resolve(code));
      });

      let cleanupTimedOut = false;
      try {
        const url = await Promise.race([
          waitForPreviewUrl(proc),
          sleep(15000).then(() => {
            throw new Error("preview did not start");
          }),
        ]);

        const statusAt = async (path: string) => {
          const query = path
            ? `/_tree?ref=worktree&path=${path}`
            : "/_tree?ref=worktree";
          const response = await fetchWithTimeout(
            new URL(query, url).toString(),
            5000,
          );
          const body = (await response.json()) as {
            entries: Array<{ path: string; status?: string }>;
          };
          return new Map(body.entries.map((e) => [e.path, e.status]));
        };

        const rootStatus = await statusAt("");
        expect(rootStatus.get("tracked.txt")).toBe(undefined);
        expect(rootStatus.get("staged.txt")).toBe("A");
        expect(rootStatus.get("untracked.txt")).toBe("U");
        expect(rootStatus.get("ignored.txt")).toBe("I");
        expect(rootStatus.get("build")).toBe("I");
        expect(rootStatus.get("fresh-dir")).toBe("U");

        // Descendants of the untracked directory inherit "U", except the one
        // an ignore rule names for itself.
        const freshStatus = await statusAt("fresh-dir");
        expect(freshStatus.get("fresh-dir/inside.txt")).toBe("U");
        expect(freshStatus.get("fresh-dir/ignored.txt")).toBe("I");

        const buildStatus = await statusAt("build");
        expect(buildStatus.get("build/out.js")).toBe("I");
      } finally {
        proc.kill("SIGKILL");
        cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
      }
      if (cleanupTimedOut) {
        throw new Error("preview process did not exit after SIGKILL");
      }
    },
  );

  runOrSkip(
    "/_tree resolves a committed-ref directory symlink via resolved_path",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-symlink-tree-"));
      tmpRoots.push(root);
      git(root, ["init"]);
      git(root, ["config", "user.email", "test@example.com"]);
      git(root, ["config", "user.name", "Test"]);
      mkdirSync(join(root, "real-dir"));
      writeFileSync(join(root, "real-dir", "inner.txt"), "inner\n");
      symlinkSync("real-dir", join(root, "link-to-dir"));
      git(root, ["add", "-A"]);
      git(root, ["commit", "-m", "initial"]);
      const sha = git(root, ["rev-parse", "HEAD"]).stdout.trim();

      const proc = spawn(
        process.execPath,
        [CLI_BUNDLE, "--port", "0", "--cwd", root],
        {
          cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const exited = new Promise<number | null>((resolve) => {
        proc.once("exit", (code) => resolve(code));
      });

      let cleanupTimedOut = false;
      try {
        const url = await Promise.race([
          waitForPreviewUrl(proc),
          sleep(15000).then(() => {
            throw new Error("preview did not start");
          }),
        ]);

        const rootResponse = await fetchWithTimeout(
          new URL(`/_tree?ref=${sha}`, url).toString(),
          5000,
        );
        const rootBody = (await rootResponse.json()) as {
          entries: Array<{
            path: string;
            type: string;
            is_symlink?: boolean;
            resolved_path?: string;
          }>;
        };
        const link = rootBody.entries.find(
          (entry) => entry.path === "link-to-dir",
        );
        expect(link?.is_symlink).toBe(true);
        expect(link?.resolved_path).toBe("real-dir");

        const resolvedResponse = await fetchWithTimeout(
          new URL(
            `/_tree?ref=${sha}&path=${link?.resolved_path}`,
            url,
          ).toString(),
          5000,
        );
        const resolvedBody = (await resolvedResponse.json()) as {
          entries: Array<{ path: string; type: string }>;
        };
        expect(
          resolvedBody.entries.some(
            (entry) => entry.path === "real-dir/inner.txt",
          ),
        ).toBe(true);

        const ownPathResponse = await fetchWithTimeout(
          new URL(`/_tree?ref=${sha}&path=link-to-dir`, url).toString(),
          5000,
        );
        const ownPathBody = (await ownPathResponse.json()) as {
          entries: Array<{ path: string }>;
        };
        expect(ownPathBody.entries).toEqual([]);
      } finally {
        proc.kill("SIGKILL");
        cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
      }
      if (cleanupTimedOut) {
        throw new Error("preview process did not exit after SIGKILL");
      }
    },
  );

  runOrSkip(
    "/_tree does not expose files reached through a symlink that escapes the worktree",
    async () => {
      const outsideRoot = mkdtempSync(
        join(tmpdir(), "code-viewer-symlink-outside-"),
      );
      tmpRoots.push(outsideRoot);
      writeFileSync(join(outsideRoot, "secret.txt"), "top secret\n");

      const root = mkdtempSync(
        join(tmpdir(), "code-viewer-symlink-escape-tree-"),
      );
      tmpRoots.push(root);
      git(root, ["init"]);
      git(root, ["config", "user.email", "test@example.com"]);
      git(root, ["config", "user.name", "Test"]);
      writeFileSync(join(root, "keep.txt"), "keep\n");
      symlinkSync(outsideRoot, join(root, "link-outside"));
      git(root, ["add", "-A"]);
      git(root, ["commit", "-m", "initial"]);

      const proc = spawn(
        process.execPath,
        [CLI_BUNDLE, "--port", "0", "--cwd", root],
        {
          cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const exited = new Promise<number | null>((resolve) => {
        proc.once("exit", (code) => resolve(code));
      });

      let cleanupTimedOut = false;
      try {
        const url = await Promise.race([
          waitForPreviewUrl(proc),
          sleep(15000).then(() => {
            throw new Error("preview did not start");
          }),
        ]);

        const rootResponse = await fetchWithTimeout(
          new URL("/_tree?ref=worktree", url).toString(),
          5000,
        );
        const rootBody = (await rootResponse.json()) as {
          entries: Array<{
            path: string;
            type: string;
            symlink_target_type?: string;
          }>;
        };
        const link = rootBody.entries.find(
          (entry) => entry.path === "link-outside",
        );
        expect(link?.type).toBe("blob");
        expect(link?.symlink_target_type).toBe("missing");

        const escapedResponse = await fetchWithTimeout(
          new URL("/_tree?ref=worktree&path=link-outside", url).toString(),
          5000,
        );
        const escapedBody = (await escapedResponse.json()) as {
          entries: Array<{ path: string }>;
        };
        expect(escapedBody.entries).toEqual([]);
      } finally {
        proc.kill("SIGKILL");
        cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
      }
      if (cleanupTimedOut) {
        throw new Error("preview process did not exit after SIGKILL");
      }
    },
  );

  runOrSkip("--help lists every wired annotate/query subcommand", async () => {
    const proc = spawn(process.execPath, [CLI_BUNDLE, "--help"], {
      cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const exited = new Promise<number | null>((resolve) => {
      proc.once("exit", (code) => resolve(code));
    });
    const exitCode = await waitForExit(exited, 5000);

    if (exitCode === "timeout") {
      proc.kill("SIGKILL");
      throw new Error("--help did not exit");
    }
    if (exitCode !== 0) {
      throw new Error(
        `--help exited with ${exitCode}; stderr=${stderr}; stdout=${stdout}`,
      );
    }

    expect(stdout).toMatch(
      /code-viewer status \[--cwd <repo>\] \[--bin git=<path>\] \[--ref <ref>\] \[--limit <N>\] \[--json\]/,
    );
    expect(stdout).toMatch(
      /code-viewer annotate <start\|add\|add-db\|rename\|edit\|move\|list\|delete\|clear>/,
    );
    expect(stdout).toMatch(
      /code-viewer journal <list\|add\|edit\|tasks\|task-add\|task-update\|task-next\|github-issues\|task-link-issue\|task-claim\|task-done\|task-delete>/,
    );
    expect(stdout).toMatch(
      /code-viewer query <sources\|schemas\|schema\|columns\|ddl\|exec\|list\|clear\|snapshot\|diff\|search\|redis\|elasticsearch\|s3>/,
    );
    expect(stdout).toMatch(
      /code-viewer <status\|annotate\|journal\|query\|search\|file\|skill\|doctor> agent-help/,
    );
    expect(stdout).toMatch(/code-viewer search code --term <text>/);
    expect(stdout).toMatch(/code-viewer search files --term <pattern>/);
    expect(stdout).toMatch(
      /code-viewer file <blame\|history\|show\|diff> --path <p>/,
    );
    expect(stdout).toMatch(
      /code-viewer doctor .*--bin <git\|rg\|docker\|gh\|tmux>=<path>/,
    );
    expect(/annotate <start\|add\|list\|delete\|clear>/.test(stdout)).toBe(
      false,
    );
    expect(/query <run/.test(stdout)).toBe(false);
    expect(stdout).toMatch(/^Usage:$/m);
  });

  runOrSkip(
    "passes a file history path filter through to git diff metadata commands",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-diff-pathspec-"));
      tmpRoots.push(root);
      git(root, ["init", "-b", "main"]);
      git(root, ["config", "user.email", "sample-author"]);
      git(root, ["config", "user.name", "sample-author"]);
      writeFileSync(join(root, "sample.txt"), "base\n");
      writeFileSync(join(root, "unrelated.txt"), "base\n");
      git(root, ["add", "sample.txt", "unrelated.txt"]);
      git(root, ["commit", "-m", "sample initial commit"]);
      writeFileSync(join(root, "sample.txt"), "changed\n");
      writeFileSync(join(root, "unrelated.txt"), "changed\n");
      const preview = await startTestPreview(
        root,
        makePathspecRequiredGitCommand("sample.txt"),
      );

      try {
        const endpoint = new URL(
          "/diff.json?from=HEAD&to=worktree&path=sample.txt&nocache=1",
          preview.url,
        );
        const response = await fetchWithTimeout(endpoint.toString(), 5000);
        const body = (await response.json()) as {
          error?: string;
          files: Array<{ path: string }>;
        };

        expect(response.status).toBe(200);
        expect(body.error).toBeUndefined();
        expect(body.files).toHaveLength(1);
        expect(body.files[0]?.path).toBe("sample.txt");
      } finally {
        await stopTestPreview(preview.proc, preview.exited);
      }
    },
  );

  runOrSkip(
    "later stale diff metadata cannot overwrite the newer generation cache",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-diff-meta-race-"));
      tmpRoots.push(root);
      git(root, ["init", "-b", "main"]);
      git(root, ["config", "user.email", "sample-author"]);
      git(root, ["config", "user.name", "sample-author"]);
      writeFileSync(join(root, "sample.txt"), "base\n");
      git(root, ["add", "sample.txt"]);
      git(root, ["commit", "-m", "sample initial commit"]);
      writeFileSync(join(root, "sample.txt"), "first\n");
      const gate = makeGatedGitCommand("numstat");
      const preview = await startTestPreview(root, gate.command);
      try {
        const endpoint = new URL("/diff.json?nocache=1", preview.url);
        const olderPromise = fetch(endpoint).then(
          (response) =>
            response.json() as Promise<{
              generation: number;
              totals: { additions: number; deletions: number };
            }>,
        );
        expect(
          await waitForOutput(
            () => (existsSync(gate.started) ? "started" : ""),
            /started/,
            5000,
          ),
        ).toBe(true);

        writeFileSync(join(root, "sample.txt"), "second\nthird\n");
        const newer = (await (await fetch(endpoint)).json()) as {
          generation: number;
          totals: { additions: number; deletions: number };
        };
        writeFileSync(gate.release, "release");
        const older = await olderPromise;
        const cached = (await (
          await fetch(new URL("/diff.json", preview.url))
        ).json()) as {
          generation: number;
          totals: { additions: number; deletions: number };
        };

        expect(older.totals).toEqual({
          files: 1,
          additions: 1,
          deletions: 1,
        });
        expect(newer.totals).toEqual({
          files: 1,
          additions: 2,
          deletions: 1,
        });
        expect(older.generation < newer.generation).toBe(true);
        expect(cached.totals).toEqual({
          files: 1,
          additions: 2,
          deletions: 1,
        });
      } finally {
        writeFileSync(gate.release, "release");
        await stopTestPreview(preview.proc, preview.exited);
      }
    },
  );

  runOrSkip(
    "an older diff result finishing first cannot make a newer result stale",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-diff-meta-first-"));
      tmpRoots.push(root);
      git(root, ["init", "-b", "main"]);
      git(root, ["config", "user.email", "sample-author"]);
      git(root, ["config", "user.name", "sample-author"]);
      writeFileSync(join(root, "sample.txt"), "base\n");
      git(root, ["add", "sample.txt"]);
      git(root, ["commit", "-m", "sample initial commit"]);
      writeFileSync(join(root, "sample.txt"), "first\n");
      const gate = makeDoubleGatedGitCommand();
      const preview = await startTestPreview(root, gate.command);
      try {
        const endpoint = new URL("/diff.json?nocache=1", preview.url);
        const olderPromise = fetch(endpoint).then(
          (response) =>
            response.json() as Promise<{
              generation: number;
              totals: { additions: number; deletions: number };
            }>,
        );
        expect(
          await waitForOutput(
            () => (existsSync(gate.gates[0].started) ? "started" : ""),
            /started/,
            5000,
          ),
        ).toBe(true);

        writeFileSync(join(root, "sample.txt"), "second\nthird\n");
        const newerPromise = fetch(endpoint).then(
          (response) =>
            response.json() as Promise<{
              generation: number;
              totals: { additions: number; deletions: number };
            }>,
        );
        expect(
          await waitForOutput(
            () => (existsSync(gate.gates[1].started) ? "started" : ""),
            /started/,
            5000,
          ),
        ).toBe(true);

        writeFileSync(gate.gates[0].release, "release");
        const older = await olderPromise;
        writeFileSync(gate.gates[1].release, "release");
        const newer = await newerPromise;
        const cached = (await (
          await fetch(new URL("/diff.json", preview.url))
        ).json()) as {
          generation: number;
          totals: { additions: number; deletions: number };
        };

        expect(older.totals).toEqual({
          files: 1,
          additions: 1,
          deletions: 1,
        });
        expect(newer.totals).toEqual({
          files: 1,
          additions: 2,
          deletions: 1,
        });
        expect(older.generation < newer.generation).toBe(true);
        expect(cached.generation).toBe(newer.generation);
        expect(cached.totals).toEqual({
          files: 1,
          additions: 2,
          deletions: 1,
        });
      } finally {
        for (const item of gate.gates) writeFileSync(item.release, "release");
        await stopTestPreview(preview.proc, preview.exited);
      }
    },
  );

  runOrSkip(
    "later stale repository file lists are not published as the current cache",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-file-list-race-"));
      tmpRoots.push(root);
      git(root, ["init", "-b", "main"]);
      git(root, ["config", "user.email", "sample-author"]);
      git(root, ["config", "user.name", "sample-author"]);
      writeFileSync(join(root, "sample_a.txt"), "a\n");
      git(root, ["add", "sample_a.txt"]);
      git(root, ["commit", "-m", "sample initial commit"]);
      const gate = makeGatedGitCommand("ls-tree");
      const preview = await startTestPreview(root, gate.command);
      try {
        const endpoint = new URL("/_files?ref=HEAD", preview.url);
        const olderPromise = fetch(endpoint).then(
          (response) =>
            response.json() as Promise<{
              generation: number;
              files: Array<{ path: string }>;
            }>,
        );
        expect(
          await waitForOutput(
            () => (existsSync(gate.started) ? "started" : ""),
            /started/,
            5000,
          ),
        ).toBe(true);

        writeFileSync(join(root, "sample_b.txt"), "b\n");
        git(root, ["add", "sample_b.txt"]);
        git(root, ["commit", "-m", "sample second commit"]);
        expect((await refreshPreview(preview.url)).status).toBe(200);
        const newer = (await (await fetch(endpoint)).json()) as {
          generation: number;
          files: Array<{ path: string }>;
        };
        writeFileSync(gate.release, "release");
        const older = await olderPromise;
        const cached = (await (await fetch(endpoint)).json()) as {
          generation: number;
          files: Array<{ path: string }>;
        };

        expect(older.files.map((file) => file.path)).toEqual(["sample_a.txt"]);
        expect(newer.files.map((file) => file.path)).toEqual([
          "sample_a.txt",
          "sample_b.txt",
        ]);
        expect(older.generation < newer.generation).toBe(true);
        expect(cached.files.map((file) => file.path)).toEqual([
          "sample_a.txt",
          "sample_b.txt",
        ]);
      } finally {
        writeFileSync(gate.release, "release");
        await stopTestPreview(preview.proc, preview.exited);
      }
    },
  );

  runOrSkip(
    "fixed-ref file diff URLs keep the metadata generation after worktree updates",
    async () => {
      const root = mkdtempSync(
        join(tmpdir(), "code-viewer-fixed-diff-generation-"),
      );
      tmpRoots.push(root);
      git(root, ["init", "-b", "main"]);
      git(root, ["config", "user.email", "sample-author"]);
      git(root, ["config", "user.name", "sample-author"]);
      writeFileSync(join(root, "sample.txt"), "base\n");
      git(root, ["add", "sample.txt"]);
      git(root, ["commit", "-m", "sample initial commit"]);
      const baseRef = git(root, ["rev-parse", "HEAD"]).stdout.trim();
      writeFileSync(join(root, "sample.txt"), "target\n");
      git(root, ["add", "sample.txt"]);
      git(root, ["commit", "-m", "sample target commit"]);
      const targetRef = git(root, ["rev-parse", "HEAD"]).stdout.trim();
      const gate = makeGatedGitCommand("file-diff");
      writeFileSync(gate.release, "release");
      const preview = await startTestPreview(root, gate.command);

      try {
        const metaUrl = new URL("/diff.json", preview.url);
        metaUrl.searchParams.set("from", baseRef);
        metaUrl.searchParams.set("to", targetRef);
        const meta = (await (await fetch(metaUrl)).json()) as {
          generation: number;
          files: Array<{ load_url: string }>;
        };
        const fileUrl = new URL(meta.files[0]?.load_url || "", preview.url);

        expect(fileUrl.searchParams.get("generation")).toBe(
          String(meta.generation),
        );
        expect((await refreshPreview(preview.url)).status).toBe(200);
        const fileDiff = (await (await fetch(fileUrl)).json()) as {
          generation: number;
          diff: string;
        };
        expect(fileDiff.generation).toBe(meta.generation);
        expect(fileDiff.diff).toMatch(/\+target/);
      } finally {
        await stopTestPreview(preview.proc, preview.exited);
      }
    },
  );

  runOrSkip(
    "a stale file diff response keeps its starting generation",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-file-diff-race-"));
      tmpRoots.push(root);
      git(root, ["init", "-b", "main"]);
      git(root, ["config", "user.email", "sample-author"]);
      git(root, ["config", "user.name", "sample-author"]);
      writeFileSync(join(root, "sample.txt"), "base\n");
      git(root, ["add", "sample.txt"]);
      git(root, ["commit", "-m", "sample initial commit"]);
      writeFileSync(join(root, "sample.txt"), "first\n");
      const gate = makeGatedGitCommand("file-diff");
      const preview = await startTestPreview(root, gate.command);
      try {
        const endpoint = new URL(
          "/file_diff?from=HEAD&to=worktree&path=sample.txt",
          preview.url,
        );
        const olderPromise = fetch(endpoint).then(
          (response) =>
            response.json() as Promise<{
              generation: number;
              diff: string;
            }>,
        );
        expect(
          await waitForOutput(
            () => (existsSync(gate.started) ? "started" : ""),
            /started/,
            5000,
          ),
        ).toBe(true);

        writeFileSync(join(root, "sample.txt"), "second\n");
        expect((await refreshPreview(preview.url)).status).toBe(200);
        const newer = (await (await fetch(endpoint)).json()) as {
          generation: number;
          diff: string;
        };
        writeFileSync(gate.release, "release");
        const older = await olderPromise;

        expect(older.diff).toMatch(/\+first/);
        expect(newer.diff).toMatch(/\+second/);
        expect(older.generation < newer.generation).toBe(true);
      } finally {
        writeFileSync(gate.release, "release");
        await stopTestPreview(preview.proc, preview.exited);
      }
    },
  );

  runOrSkip(
    "a stale staged diff cannot replace the current same-key cache entry",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-staged-diff-race-"));
      tmpRoots.push(root);
      git(root, ["init", "-b", "main"]);
      git(root, ["config", "user.email", "sample-author"]);
      git(root, ["config", "user.name", "sample-author"]);
      writeFileSync(join(root, "sample.txt"), "base\n");
      git(root, ["add", "sample.txt"]);
      git(root, ["commit", "-m", "sample initial commit"]);
      writeFileSync(join(root, "sample.txt"), "first\n");
      git(root, ["add", "sample.txt"]);
      const gate = makeGatedGitCommand("file-diff");
      const preview = await startTestPreview(root, gate.command);
      try {
        const endpoint = new URL(
          "/file_diff?to=--staged&path=sample.txt",
          preview.url,
        );
        const olderPromise = fetch(endpoint).then(
          (response) =>
            response.json() as Promise<{
              generation: number;
              diff: string;
            }>,
        );
        expect(
          await waitForOutput(
            () => (existsSync(gate.started) ? "started" : ""),
            /started/,
            5000,
          ),
        ).toBe(true);

        writeFileSync(join(root, "sample.txt"), "second\n");
        git(root, ["add", "sample.txt"]);
        expect((await refreshPreview(preview.url)).status).toBe(200);
        const newer = (await (await fetch(endpoint)).json()) as {
          generation: number;
          diff: string;
        };
        writeFileSync(gate.release, "release");
        const older = await olderPromise;
        const cached = (await (await fetch(endpoint)).json()) as {
          generation: number;
          diff: string;
        };

        expect(older.diff).toMatch(/\+first/);
        expect(newer.diff).toMatch(/\+second/);
        expect(cached.diff).toMatch(/\+second/);
        expect(cached.diff).not.toMatch(/\+first/);
        expect(cached.generation).toBe(newer.generation);
      } finally {
        writeFileSync(gate.release, "release");
        await stopTestPreview(preview.proc, preview.exited);
      }
    },
  );

  // Markdown 内のディレクトリリンクは /_file にディレクトリを渡す。stat は
  // 成功するのでレスポンスストリームの read が EISDIR を投げ、以前はそこで
  // サーバープロセスごと落ちて開いている全タブが死んでいた。
  runOrSkip("answers 404 for a directory path and keeps serving", async () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "code-viewer-dir-file-")),
    );
    tmpRoots.push(root);
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "guide.md"), "# Guide\n");
    git(root, ["init"]);
    git(root, ["add", "-A"]);
    git(root, [
      "-c",
      "user.email=t@example.com",
      "-c",
      "user.name=t",
      "commit",
      "-m",
      "init",
    ]);

    const proc = spawn(
      process.execPath,
      [CLI_BUNDLE, "--port", "0", "--cwd", root],
      {
        cwd: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const exited = new Promise<number | null>((resolve) => {
      proc.once("exit", (code) => resolve(code));
    });
    try {
      const url = await Promise.race([
        waitForPreviewUrl(proc),
        sleep(15000).then(() => {
          throw new Error("preview did not start");
        }),
      ]);
      const directory = await fetchWithTimeout(
        new URL("/_file?path=docs&ref=worktree", url).toString(),
        6000,
      );
      expect(directory.status).toBe(404);
      // 直後にファイルが読めることが「プロセスが生きている」証拠。
      const file = await fetchWithTimeout(
        new URL("/_file?path=docs/guide.md&ref=worktree", url).toString(),
        6000,
      );
      expect(file.status).toBe(200);
      expect(await file.text()).toBe("# Guide\n");
    } finally {
      await stopTestPreview(proc, exited);
    }
  });
});
