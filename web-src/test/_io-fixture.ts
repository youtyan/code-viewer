// Shared helper for CLI runner tests that need to capture stdout / stderr
// and intercept process.exit() without actually terminating the test
// process. file-cli.test.ts and status-cli.test.ts both rebuilt the same
// hook stack — `ai-dup-check` flagged that. This module owns the single
// implementation; tests import { captureIo, restoreIo, ExitMarker,
// catchExit } from "./_io-fixture".

export class ExitMarker extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

export type Captured = {
  logs: string[];
  errs: string[];
  exits: number[];
};

type StashedHandles = {
  exit: typeof process.exit;
  log: typeof console.log;
  err: typeof console.error;
};

let stashed: StashedHandles | null = null;

export function captureIo(): Captured {
  const logs: string[] = [];
  const errs: string[] = [];
  const exits: number[] = [];
  stashed = {
    exit: process.exit,
    log: console.log,
    err: console.error,
  };
  process.exit = ((code?: number) => {
    exits.push(typeof code === "number" ? code : 0);
    throw new ExitMarker(code ?? 0);
  }) as typeof process.exit;
  console.log = (...args: unknown[]) => {
    logs.push(
      args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
    );
  };
  console.error = (...args: unknown[]) => {
    errs.push(
      args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
    );
  };
  return { logs, errs, exits };
}

export function restoreIo(): void {
  if (!stashed) return;
  process.exit = stashed.exit;
  console.log = stashed.log;
  console.error = stashed.err;
  stashed = null;
}

// Run an async CLI entry point and swallow the ExitMarker thrown by the
// captured process.exit so the test can inspect captureIo() output.
export async function catchExitAsync(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ExitMarker) return;
    throw err;
  }
}

// Same shape but for sync CLI runners (status-cli's runStatusCli is sync).
export function catchExit(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (err instanceof ExitMarker) return;
    throw err;
  }
}
