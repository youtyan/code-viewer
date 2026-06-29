import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type JsonStoreOptions<T> = {
  filePath: (root: string) => string;
  empty: () => T;
  sanitize: (raw: unknown) => T;
  maxBytes?: number;
  backupSuffix?: string;
  sizeErrorMessage?: string;
  serialize?: (state: T) => string;
};

export type JsonFileStore<T> = {
  load(root: string): Promise<T>;
  save(root: string, state: T): Promise<void>;
  update<R>(
    root: string,
    updater: (
      state: T,
    ) => { state: T; result: R } | Promise<{ state: T; result: R }>,
  ): Promise<R>;
};

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function tmpPath(file: string): string {
  return `${file}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

async function backupInvalidFile(file: string, suffix: string): Promise<void> {
  try {
    await rename(file, `${file}.${suffix}-${Date.now()}`);
  } catch {
    // best effort only
  }
}

export function createJsonFileStore<T>(
  options: JsonStoreOptions<T>,
): JsonFileStore<T> {
  const queues = new Map<string, Promise<void>>();
  const backupSuffix = options.backupSuffix ?? "corrupt";
  const serialize =
    options.serialize ?? ((state: T) => `${JSON.stringify(state, null, 2)}\n`);

  async function loadUnqueued(root: string): Promise<T> {
    const file = options.filePath(root);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if (isEnoent(err)) return options.empty();
      throw err;
    }
    try {
      return options.sanitize(JSON.parse(raw));
    } catch {
      await backupInvalidFile(file, backupSuffix);
      return options.empty();
    }
  }

  async function saveUnqueued(root: string, state: T): Promise<void> {
    const file = options.filePath(root);
    const normalized = options.sanitize(state);
    const content = serialize(normalized);
    if (
      options.maxBytes !== undefined &&
      Buffer.byteLength(content, "utf8") > options.maxBytes
    ) {
      throw new Error(options.sizeErrorMessage ?? "JSON state too large");
    }
    await mkdir(dirname(file), { recursive: true });
    const tmp = tmpPath(file);
    await writeFile(tmp, content, "utf8");
    await rename(tmp, file);
  }

  async function load(root: string): Promise<T> {
    const pendingWrite = queues.get(options.filePath(root));
    if (pendingWrite) await pendingWrite.catch(() => undefined);
    return loadUnqueued(root);
  }

  async function save(root: string, state: T): Promise<void> {
    const file = options.filePath(root);
    const previous = queues.get(file) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() => saveUnqueued(root, state));
    const queued = run.then(
      () => undefined,
      () => undefined,
    );
    queues.set(file, queued);
    try {
      await run;
    } finally {
      if (queues.get(file) === queued) queues.delete(file);
    }
  }

  async function update<R>(
    root: string,
    updater: (
      state: T,
    ) => { state: T; result: R } | Promise<{ state: T; result: R }>,
  ): Promise<R> {
    const file = options.filePath(root);
    const previous = queues.get(file) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const current = await loadUnqueued(root);
        const updated = await updater(current);
        await saveUnqueued(root, updated.state);
        return updated.result;
      });
    const queued = run.then(
      () => undefined,
      () => undefined,
    );
    queues.set(file, queued);
    try {
      return await run;
    } finally {
      if (queues.get(file) === queued) queues.delete(file);
    }
  }

  return { load, save, update };
}
