// Shared helper for tests that drive a temporary git repository directly.
//
// Multiple test files used to define the same `git(cwd, args)` wrapper
// around `spawnSync("git", ...)` — same exit-code check, same error
// formatting — and the dup-check hook flagged the bodies as identical.
// This module owns the single implementation; tests import `runGit`.

import { type SpawnSyncReturns, spawnSync } from "node:child_process";

export function runGit(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): SpawnSyncReturns<string> {
  const proc = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (proc.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${proc.stderr || proc.stdout}`,
    );
  }
  return proc;
}
