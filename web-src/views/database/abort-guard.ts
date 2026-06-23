export type AbortGuardSlot = {
  signal: AbortSignal;
  isStale(): boolean;
  finish(): void;
};

export type AbortGuard = {
  start(): AbortGuardSlot;
  dispose(): void;
};

export function createAbortGuard(): AbortGuard {
  let active: AbortController | null = null;
  let runId = 0;

  return {
    start(): AbortGuardSlot {
      active?.abort("abort-guard:start");
      const abort = new AbortController();
      active = abort;
      const requestRunId = ++runId;
      return {
        signal: abort.signal,
        isStale(): boolean {
          return abort.signal.aborted || requestRunId !== runId;
        },
        finish(): void {
          if (active === abort) active = null;
        },
      };
    },
    dispose(): void {
      runId++;
      active?.abort("abort-guard:dispose");
      active = null;
    },
  };
}
