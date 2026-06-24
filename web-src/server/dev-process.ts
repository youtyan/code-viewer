export type DevChildProcess = {
  kill(signal?: string): void;
  exited: Promise<number>;
};

export type TerminateChildOptions = {
  graceMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

export async function terminateChild(
  child: DevChildProcess,
  options: TerminateChildOptions = {},
): Promise<number> {
  const graceMs = options.graceMs ?? 1500;
  const setTimer = options.setTimeoutFn || setTimeout;
  const clearTimer = options.clearTimeoutFn || clearTimeout;
  let escalated = false;
  const timer = setTimer(() => {
    escalated = true;
    child.kill("SIGKILL");
  }, graceMs);
  timer.unref?.();
  try {
    child.kill("SIGTERM");
    return await child.exited;
  } finally {
    clearTimer(timer);
    if (escalated) {
      // Keep this observable in dev logs without treating it as an error path.
      console.warn("code-viewer dev child required SIGKILL during shutdown");
    }
  }
}

export async function terminateChildren(
  children: DevChildProcess[],
  options: TerminateChildOptions = {},
): Promise<void> {
  await Promise.allSettled(
    children.map((child) => terminateChild(child, options)),
  );
}
