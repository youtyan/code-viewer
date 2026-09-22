async function runShutdownSteps(
  exitCode: number,
  steps: readonly {
    label: string;
    run(): void | Promise<void>;
  }[],
): Promise<number> {
  let result = exitCode;
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      result = 1;
      console.error(`${step.label} failed:`, error);
    }
  }
  return result;
}

export function createProcessShutdown(
  steps: readonly { label: string; run(): void | Promise<void> }[],
  exit: (code: number) => void = process.exit,
): {
  run(exitCode?: number): Promise<void>;
  started(): boolean;
} {
  let requestedExitCode = 0;
  let pending: Promise<void> | null = null;
  return {
    run: (exitCode = 0) => {
      if (exitCode !== 0) requestedExitCode = 1;
      pending ??= (async () => {
        const cleanupCode = await runShutdownSteps(requestedExitCode, steps);
        exit(Math.max(requestedExitCode, cleanupCode));
      })();
      return pending;
    },
    started: () => pending !== null,
  };
}

export function reportFatalAndShutdown(
  label: string,
  error: unknown,
  shutdown: (exitCode: number) => void | Promise<void>,
): void {
  console.error(`[code-viewer] ${label}:`, error);
  void shutdown(1);
}
