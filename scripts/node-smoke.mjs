import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const bundle = readFileSync("dist/code-viewer.js", "utf8");
if (bundle.includes("Bun.")) {
	console.error("dist/code-viewer.js must not reference Bun globals");
	process.exit(1);
}

const child = spawn(
	process.execPath,
	["dist/code-viewer.js", "--cwd", ".", "--port", "0"],
	{
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	},
);

let stdout = "";
let stderr = "";
let settled = false;
const hardLimit = setTimeout(() => fail("node smoke test timed out"), 10000);

const fail = (message) => {
	if (settled) return;
	settled = true;
	clearTimeout(hardLimit);
	child.kill("SIGTERM");
	console.error(message);
	if (stdout) console.error(stdout);
	if (stderr) console.error(stderr);
	process.exit(1);
};

const withTimeout = (promise, message, ms = 5000) =>
	Promise.race([
		promise,
		new Promise((_, reject) => {
			setTimeout(() => reject(new Error(message)), ms);
		}),
	]);

const waitForUrl = new Promise((resolve, reject) => {
	const timer = setTimeout(
		() => reject(new Error("timed out waiting for GDP_LISTEN_URL")),
		5000,
	);
	child.stdout.on("data", (chunk) => {
		stdout += chunk.toString("utf8");
		const match = stdout.match(/GDP_LISTEN_URL=(http:\/\/127\.0\.0\.1:\d+\/)/);
		if (match) {
			clearTimeout(timer);
			resolve(match[1]);
		}
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString("utf8");
	});
	child.on("exit", (code) => {
		if (!settled)
			reject(new Error(`server exited before smoke test completed: ${code}`));
	});
});

try {
	const baseUrl = await withTimeout(
		waitForUrl,
		"timed out waiting for GDP_LISTEN_URL",
	);
	if (baseUrl.endsWith(":0/")) throw new Error("server reported port 0");

	const settings = await withTimeout(
		fetch(new URL("_settings", baseUrl)),
		"/_settings timed out",
	);
	if (!settings.ok) throw new Error(`/_settings failed: ${settings.status}`);

	const files = await withTimeout(
		fetch(new URL("_files?target=worktree", baseUrl)),
		"/_files timed out",
	);
	if (!files.ok) throw new Error(`/_files failed: ${files.status}`);

	const ranged = await withTimeout(
		fetch(new URL("_file?path=README.md&ref=worktree", baseUrl), {
			headers: { Range: "bytes=0-15" },
		}),
		"range request timed out",
	);
	if (ranged.status !== 206)
		throw new Error(`range request failed: ${ranged.status}`);

	const controller = new AbortController();
	const events = await withTimeout(
		fetch(new URL("events", baseUrl), {
			signal: controller.signal,
		}),
		"/events timed out",
	);
	if (!events.ok || !events.body)
		throw new Error(`/events failed: ${events.status}`);
	const reader = events.body.getReader();
	const first = await withTimeout(reader.read(), "/events read timed out");
	controller.abort();
	if (
		first.done ||
		!new TextDecoder().decode(first.value).includes("event: open")
	) {
		throw new Error("/events did not emit the open event");
	}

	settled = true;
	clearTimeout(hardLimit);
	child.kill("SIGTERM");
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}
