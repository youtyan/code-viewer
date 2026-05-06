import { spawn, spawnSync } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";

export type RunResult = {
	code: number;
	stdout: string;
	stderr: string;
};

export type RunBytesResult = {
	code: number;
	stdout: Uint8Array;
	stderr: string;
};

export type StartedServer = {
	port: number;
};

export function runSync(
	args: string[],
	cwd: string,
	options: { timeout?: number } = {},
): RunResult {
	const proc = spawnSync(args[0], args.slice(1), {
		cwd,
		encoding: "buffer",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: options.timeout,
		killSignal: "SIGKILL",
	});
	return {
		code: proc.status ?? (proc.error ? 1 : 0),
		stdout: new TextDecoder().decode(proc.stdout || new Uint8Array()),
		stderr: new TextDecoder().decode(proc.stderr || new Uint8Array()),
	};
}

export function runBytesSync(
	args: string[],
	cwd: string,
	options: { timeout?: number } = {},
): RunBytesResult {
	const proc = spawnSync(args[0], args.slice(1), {
		cwd,
		encoding: "buffer",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: options.timeout,
		killSignal: "SIGKILL",
	});
	return {
		code: proc.status ?? (proc.error ? 1 : 0),
		stdout: new Uint8Array(proc.stdout || new Uint8Array()),
		stderr: new TextDecoder().decode(proc.stderr || new Uint8Array()),
	};
}

export function spawnDetached(args: string[]): void {
	const child = spawn(args[0], args.slice(1), {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
}

export function spawnStream(
	args: string[],
	cwd: string,
): {
	stream: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	kill(signal?: string): void;
} {
	const proc = spawn(args[0], args.slice(1), {
		cwd,
		stdio: ["ignore", "pipe", "ignore"],
	});
	return {
		stream: Readable.toWeb(
			proc.stdout,
		) as unknown as ReadableStream<Uint8Array>,
		exited: new Promise((resolve) =>
			proc.on("close", (code) => resolve(code ?? 1)),
		),
		kill: (signal?: string) => proc.kill(signal as NodeJS.Signals | undefined),
	};
}

export function fileReadableStream(path: string): ReadableStream<Uint8Array> {
	return Readable.toWeb(
		createReadStream(path),
	) as unknown as ReadableStream<Uint8Array>;
}

export function fileByteRangeResponseBody(
	path: string,
	start: number,
	endInclusive: number,
): ReadableStream<Uint8Array> {
	return Readable.toWeb(
		createReadStream(path, { start, end: endInclusive }),
	) as unknown as ReadableStream<Uint8Array>;
}

export async function readFileTextRange(
	path: string,
	start: number,
	endExclusive: number,
): Promise<string> {
	const length = Math.max(0, endExclusive - start);
	if (length === 0) return "";
	const handle = await fs.open(path, "r");
	try {
		const buffer = Buffer.alloc(length);
		const result = await handle.read(buffer, 0, length, start);
		return buffer.subarray(0, result.bytesRead).toString("utf8");
	} finally {
		await handle.close();
	}
}

export function startServer(options: {
	hostname: string;
	port: number;
	fetch: (req: Request) => Response | Promise<Response>;
}): Promise<StartedServer> {
	const server = createServer(async (req, res) => {
		try {
			const request = nodeRequestToWeb(req, options.hostname, server.address());
			const response = await options.fetch(request);
			await writeWebResponse(res, response);
		} catch {
			if (!res.headersSent)
				res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("internal server error");
		}
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port, options.hostname, () => {
			server.off("error", reject);
			server.on("error", (error) => {
				console.error("[code-viewer] server error:", error);
			});
			const address = server.address();
			const port =
				typeof address === "object" && address ? address.port : options.port;
			resolve({ port });
		});
	});
}

function nodeRequestToWeb(
	req: IncomingMessage,
	hostname: string,
	address: ReturnType<ReturnType<typeof createServer>["address"]>,
): Request {
	const port = typeof address === "object" && address ? address.port : 0;
	const host = req.headers.host || `${hostname}:${port}`;
	const url = new URL(req.url || "/", `http://${host}`);
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (Array.isArray(value)) {
			for (const item of value) headers.append(key, item);
		} else if (value !== undefined) {
			headers.set(key, value);
		}
	}
	const method = req.method || "GET";
	const hasBody = method !== "GET" && method !== "HEAD";
	return new Request(url, {
		method,
		headers,
		body: hasBody
			? (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>)
			: undefined,
		duplex: hasBody ? "half" : undefined,
	} as RequestInit);
}

async function writeWebResponse(
	res: ServerResponse,
	response: Response,
): Promise<void> {
	res.statusCode = response.status;
	response.headers.forEach((value, key) => {
		res.setHeader(key, value);
	});
	if (!response.body) {
		res.end();
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const body = Readable.fromWeb(
			response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
		);
		let settled = false;
		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			fn();
		};
		body.on("error", (error) =>
			settle(() => {
				res.destroy(error);
				reject(error);
			}),
		);
		res.on("finish", () => settle(resolve));
		res.on("close", () =>
			settle(() => {
				body.destroy();
				resolve();
			}),
		);
		body.pipe(res);
	});
}
