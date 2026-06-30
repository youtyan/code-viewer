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
          fetchWithTimeout(url, 1000),
          fetchWithTimeout(
            new URL("/_tree?ref=worktree", url).toString(),
            1000,
          ),
          fetchWithTimeout(
            new URL("/_tree?ref=worktree&recursive=1", url).toString(),
            1000,
          ),
          fetchWithTimeout(new URL("/_db/files", url).toString(), 1000),
        ]);

        expect(Date.now() - started < 1500).toBe(true);
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
      /code-viewer status \[--cwd <repo>\] \[--ref <ref>\] \[--limit <N>\] \[--json\]/,
    );
    expect(stdout).toMatch(
      /code-viewer annotate <start\|add\|add-db\|rename\|edit\|move\|list\|delete\|clear>/,
    );
    expect(stdout).toMatch(
      /code-viewer query <sources\|schemas\|schema\|columns\|ddl\|exec\|list\|clear\|snapshot\|diff\|search\|redis\|elasticsearch\|s3>/,
    );
    expect(stdout).toMatch(
      /code-viewer <status\|annotate\|query\|search\|file\|skill\|doctor> agent-help/,
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
