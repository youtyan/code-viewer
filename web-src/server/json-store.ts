import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { errorWithCause, errorWithCauses } from "../core/error-detail";

export type JsonStoreOptions<T> = {
  filePath: (root: string) => string;
  empty: () => T;
  sanitize: (raw: unknown) => T;
  maxBytes?: number;
  backupSuffix?: string;
  sizeErrorMessage?: string;
  serialize?: (state: T) => string;
  invalidFileBehavior?: "empty" | "throw";
};

export type JsonFileStore<T> = {
  load(root: string): Promise<T>;
  save(root: string, state: T): Promise<void>;
  remove(root: string): Promise<boolean>;
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

async function backupInvalidFile(
  file: string,
  suffix: string,
): Promise<string> {
  const backup = `${file}.${suffix}-${Date.now()}`;
  await rename(file, backup);
  return backup;
}

export function createJsonFileStore<T>(
  options: JsonStoreOptions<T>,
): JsonFileStore<T> {
  const queues = new Map<string, Promise<void>>();
  const backupSuffix = options.backupSuffix ?? "corrupt";
  const invalidFileBehavior = options.invalidFileBehavior ?? "empty";
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
    } catch (invalidError) {
      let backup: string;
      try {
        backup = await backupInvalidFile(file, backupSuffix);
      } catch (backupError) {
        throw errorWithCauses("invalid JSON state could not be backed up", [
          invalidError,
          backupError,
        ]);
      }
      const recovered = Object.assign(
        errorWithCause("invalid JSON state was moved aside", invalidError),
        { backup },
      );
      if (invalidFileBehavior === "throw") throw recovered;
      console.error(
        "[code-viewer] invalid JSON state was moved aside",
        recovered,
      );
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
    try {
      await writeFile(tmp, content, "utf8");
      await rename(tmp, file);
    } catch (writeError) {
      try {
        await unlink(tmp);
      } catch (cleanupError) {
        if (!isEnoent(cleanupError)) {
          throw errorWithCauses(
            "failed to save JSON state and remove the temporary file",
            [writeError, cleanupError],
          );
        }
      }
      throw errorWithCause("failed to save JSON state", writeError);
    }
  }

  function enqueue<R>(root: string, operation: () => Promise<R>): Promise<R> {
    const file = options.filePath(root);
    const previous = queues.get(file) ?? Promise.resolve();
    const gateState: { release: () => void } = {
      release: () => {
        throw new Error("JSON store queue gate was not initialized");
      },
    };
    const gate = new Promise<void>((resolve) => {
      gateState.release = resolve;
    });
    const tail = previous.then(() => gate);
    queues.set(file, tail);
    return previous.then(async () => {
      try {
        return await operation();
      } finally {
        gateState.release();
        if (queues.get(file) === tail) queues.delete(file);
      }
    });
  }

  function load(root: string): Promise<T> {
    return enqueue(root, () => loadUnqueued(root));
  }

  function save(root: string, state: T): Promise<void> {
    return enqueue(root, () => saveUnqueued(root, state));
  }

  function remove(root: string): Promise<boolean> {
    return enqueue(root, async () => {
      try {
        await unlink(options.filePath(root));
        return true;
      } catch (error) {
        if (isEnoent(error)) return false;
        throw errorWithCause("failed to remove JSON state", error);
      }
    });
  }

  async function update<R>(
    root: string,
    updater: (
      state: T,
    ) => { state: T; result: R } | Promise<{ state: T; result: R }>,
  ): Promise<R> {
    return enqueue(root, async () => {
      const current = await loadUnqueued(root);
      const updated = await updater(current);
      await saveUnqueued(root, updated.state);
      return updated.result;
    });
  }

  return { load, save, remove, update };
}
