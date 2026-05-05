interface BunFile extends globalThis.Blob {
  arrayBuffer(): Promise<ArrayBuffer>;
  slice(start?: number, end?: number, contentType?: string): BunFile;
  stream(): ReadableStream<Uint8Array<ArrayBuffer>>;
  text(): Promise<string>;
}

declare const Bun: {
  file(path: string): BunFile;
  spawn(args: string[], opts?: Record<string, unknown>): {
    kill(signal?: string): void;
    exited: Promise<number>;
    stdout?: ReadableStream<Uint8Array>;
    stderr?: ReadableStream<Uint8Array>;
  };
  spawnSync(args: string[], opts?: Record<string, unknown>): {
    exitCode: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
  };
  serve(opts: {
    hostname?: string;
    port?: number;
    fetch(req: Request): Response | Promise<Response>;
  }): { port: number };
};

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd(): string;
  platform: 'darwin' | 'win32' | string;
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  exit(code?: number): never;
};

interface ImportMeta {
  dir: string;
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string): Buffer;
  export function readFileSync(path: string, encoding: BufferEncoding): string;
  export function realpathSync(path: string): string;
  export function statSync(path: string): { mtimeMs: number };
  export function watch(
    path: string,
    options: { persistent?: boolean },
    listener: (eventType: string, filename: string | Buffer | null) => void,
  ): unknown;
}

declare module 'node:path' {
  export function basename(path: string): string;
  export function extname(path: string): string;
  export function join(...parts: string[]): string;
  export function normalize(path: string): string;
  export function relative(from: string, to: string): string;
}
