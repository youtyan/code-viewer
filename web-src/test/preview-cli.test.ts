import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit as git } from "./_git-fixture";

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
  const commandName =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? null
        : "xdg-open";
  if (!commandName) return null;
  const command = join(root, commandName);
  writeFileSync(
    command,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}.tmp" && mv "${log}.tmp" "${log}"\n`,
  );
  chmodSync(command, 0o755);
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

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("preview CLI", () => {
  const runOrSkip = process.platform === "win32" ? test.skip : test;

  runOrSkip(
    "--open launches the browser after the server port exists",
    async () => {
      const fakeBrowser = makeFakeBrowserCommand();
      if (!fakeBrowser) throw new Error("fake browser command is unavailable");

      const proc = spawn(
        process.execPath,
        ["run", "web-src/server/preview.ts", "--port", "0", "--open"],
        {
          cwd: join(import.meta.dir, "..", ".."),
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
        ["run", "web-src/server/preview.ts", "--port", "0", "--cwd", root],
        {
          cwd: join(import.meta.dir, "..", ".."),
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
          sleep(5000).then(() => {
            throw new Error("preview did not start");
          }),
        ]);

        const started = Date.now();
        const responses = await Promise.all([
          fetchWithTimeout(url, 2500),
          fetchWithTimeout(
            new URL("/_tree?ref=worktree", url).toString(),
            2500,
          ),
          fetchWithTimeout(
            new URL("/_tree?ref=worktree&recursive=1", url).toString(),
            2500,
          ),
          fetchWithTimeout(new URL("/_db/files", url).toString(), 2500),
        ]);

        expect(Date.now() - started < 2500).toBe(true);
        expect(responses.map((response) => response.status)).toEqual([
          200, 200, 200, 200,
        ]);
        expect(
          await waitForOutput(
            () => stderrOutput,
            /worktree watcher cap reached \(1\)/,
            1000,
          ),
        ).toBe(true);
      } finally {
        proc.kill("SIGKILL");
        cleanupTimedOut = (await waitForExit(exited, 3000)) === "timeout";
      }
      if (cleanupTimedOut) {
        throw new Error("preview process did not exit after SIGKILL");
      }
    },
  );

  runOrSkip("keeps an explicit non-git cwd as the project root", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-viewer-explicit-cwd-"));
    tmpRoots.push(root);
    const explicitCwd = join(root, "nested");
    mkdirSync(explicitCwd);

    const proc = spawn(
      process.execPath,
      ["run", "web-src/server/preview.ts", "--port", "0", "--cwd", explicitCwd],
      {
        cwd: join(import.meta.dir, "..", ".."),
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
        sleep(5000).then(() => {
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
      ["run", "web-src/server/preview.ts", "--port", "0", "--cwd", root],
      {
        cwd: join(import.meta.dir, "..", ".."),
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
        sleep(5000).then(() => {
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
        ["run", "web-src/server/preview.ts", "--port", "0", "--cwd", root],
        {
          cwd: join(import.meta.dir, "..", ".."),
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
          sleep(5000).then(() => {
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
        [
          "run",
          "web-src/server/preview.ts",
          "--port",
          "0",
          "--cwd",
          explicitCwd,
        ],
        {
          cwd: join(import.meta.dir, "..", ".."),
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
          sleep(5000).then(() => {
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
        ["run", "web-src/server/preview.ts", "--port", "0", "--cwd", root],
        {
          cwd: join(import.meta.dir, "..", ".."),
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
          sleep(5000).then(() => {
            throw new Error("preview did not start");
          }),
        ]);

        const response = await fetchWithTimeout(
          new URL("/_tree?ref=worktree", url).toString(),
          1000,
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

  runOrSkip("--help lists every wired annotate/query subcommand", async () => {
    const proc = spawn(
      process.execPath,
      ["run", "web-src/server/preview.ts", "--help"],
      {
        cwd: join(import.meta.dir, "..", ".."),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
    expect(/annotate <start\|add\|list\|delete\|clear>/.test(stdout)).toBe(
      false,
    );
    expect(/query <run/.test(stdout)).toBe(false);
    expect(stdout).toMatch(/^Usage:$/m);
  });
});
