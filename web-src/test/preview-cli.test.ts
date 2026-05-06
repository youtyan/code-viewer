import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
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
});
