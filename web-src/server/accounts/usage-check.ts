// Usage reads never start a model turn: Claude's local /usage command and the
// Codex app-server account/rateLimits/read request use the CLI's own credentials.
import type {
  AccountEntry,
  AccountUsage,
  UsageCheckResponse,
  UsageWindow,
} from "../../core/agent-accounts";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import { type RunResult, runAsync } from "../runtime";
import { accountReadArgv, agentCommandArgv } from "./launch";
import {
  ACCOUNT_READ_REQUESTS,
  accountEnv,
  DEFAULT_LOGIN_DEPS,
  jsonIn,
  type LoginDeps,
} from "./login";
import { sharedAccountService } from "./service";

type CurrentUsage = Extract<AccountUsage, { status: "ok" }>;
export const USAGE_CHECK_TIMEOUT_MS = 60_000;
export type UsageCheckDeps = {
  run(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<RunResult>;
  rpc: LoginDeps["rpc"];
  launchCommand(account: AccountEntry): string;
  publish(account: AccountEntry, command: string, usage: CurrentUsage): void;
  now(): number;
  env: NodeJS.ProcessEnv;
};
export type UsageChecker = {
  check(account: AccountEntry, cwd: string): Promise<UsageCheckResponse>;
};

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(
      `${field}: expected an object; received ${JSON.stringify(value)}`,
    );
  return value as Record<string, unknown>;
}

function windowOf(
  percent: unknown,
  minutes: unknown,
  reset: unknown,
  field: string,
): UsageWindow {
  if (
    typeof percent !== "number" ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    typeof minutes !== "number" ||
    !Number.isFinite(minutes) ||
    minutes <= 0 ||
    typeof reset !== "number" ||
    !Number.isFinite(reset) ||
    reset < 0
  )
    throw new Error(
      `${field}: invalid usage window ${JSON.stringify({ percent, minutes, reset })}`,
    );
  return {
    kind:
      minutes === 300 ? "five_hour" : minutes === 10080 ? "seven_day" : "other",
    minutes,
    usedPercent: percent,
    resetsAt: reset,
  };
}

function claudeWindows(stdout: string): UsageWindow[] {
  // Stream JSON and usage_report are checked against the installed CLI format.
  // Missing structured limits (including a cached fallback without limits) fail
  // explicitly; displayed text is not parsed into an apparently fresh value.
  const messages = stdout
    .split("\n")
    .map((line) => jsonIn(line, true))
    .filter((message) => message !== null);
  const result = [...messages]
    .reverse()
    .find((message) => message.type === "result");
  if (
    result?.is_error !== false ||
    result.local_command !== "usage" ||
    result.num_turns !== 0 ||
    result.total_cost_usd !== 0 ||
    result.duration_api_ms !== 0
  )
    throw new Error(
      `Claude /usage did not complete as a local command: ${JSON.stringify(result ?? messages)}`,
    );
  const report = [...messages]
    .reverse()
    .find((message) => message.usage_report !== undefined);
  const limits = object(
    object(report?.usage_report, "usage_report").rate_limits,
    "usage_report.rate_limits",
  ).limits;
  if (!Array.isArray(limits))
    throw new Error(
      `Claude /usage returned no structured limits: ${JSON.stringify(limits)}. Update the CLI or retry after signing in.`,
    );
  const windows: UsageWindow[] = [];
  for (const item of limits) {
    const limit = object(item, "usage_report.rate_limits.limits[]");
    if (limit.kind !== "session" && limit.kind !== "weekly_all") continue;
    const reset =
      limit.resets_at === null
        ? 0
        : typeof limit.resets_at === "string"
          ? Date.parse(limit.resets_at)
          : Number.NaN;
    windows.push(
      windowOf(
        limit.percent,
        limit.kind === "session" ? 300 : 10080,
        reset,
        String(limit.kind),
      ),
    );
  }
  return windows;
}

function codexWindows(lines: string[]): UsageWindow[] {
  const messages = lines
    .map((line) => jsonIn(line, true))
    .filter((message) => message !== null);
  const response = messages.find((message) => message.id === 2);
  if (!response)
    throw new Error(
      `Codex account/rateLimits/read did not answer: ${JSON.stringify(messages)}`,
    );
  if (response.error !== undefined)
    throw Object.assign(new Error("Codex account/rateLimits/read failed"), {
      response,
    });
  const limits = object(
    object(response.result, "account/rateLimits/read.result").rateLimits,
    "rateLimits",
  );
  const windows: UsageWindow[] = [];
  for (const key of ["primary", "secondary"] as const) {
    if (limits[key] === null) continue;
    const value = object(limits[key], `rateLimits.${key}`);
    windows.push(
      windowOf(
        value.usedPercent,
        value.windowDurationMins,
        value.resetsAt === null
          ? 0
          : typeof value.resetsAt === "number"
            ? value.resetsAt * 1000
            : Number.NaN,
        `rateLimits.${key}`,
      ),
    );
  }
  return windows;
}

export function createUsageChecker(deps: UsageCheckDeps): UsageChecker {
  const running = new Map<string, Promise<UsageCheckResponse>>();
  async function run(
    account: AccountEntry,
    cwd: string,
    command: string,
  ): Promise<UsageCheckResponse> {
    const base = {
      accountId: account.id,
      cwd,
      session: "",
      closeError: "",
      joined: false,
      startedAt: deps.now(),
    };
    try {
      const env = accountEnv(account, deps.env);
      let windows: UsageWindow[];
      if (account.agent === "claude") {
        // /usage uses the subscription endpoint independently of the model API.
        // Keep inference unreachable even if an older CLI dispatches it differently.
        env.ANTHROPIC_BASE_URL = "http://127.0.0.1:1";
        delete env.CLAUDE_CODE_USE_BEDROCK;
        delete env.CLAUDE_CODE_USE_VERTEX;
        delete env.CLAUDE_CODE_USE_FOUNDRY;
        const result = await deps.run(
          agentCommandArgv(
            command,
            [
              "--safe-mode",
              "--print",
              "/usage",
              "--output-format",
              "stream-json",
              "--verbose",
            ],
            deps.env,
          ),
          cwd,
          env,
        );
        if (result.code !== 0 || result.failure)
          throw Object.assign(new Error("Claude /usage process failed"), {
            result,
          });
        windows = claudeWindows(result.stdout);
      } else {
        const requests = [
          ...ACCOUNT_READ_REQUESTS.slice(0, 2),
          JSON.stringify({ id: 2, method: "account/rateLimits/read" }),
        ];
        const result = await deps.rpc(
          accountReadArgv(command),
          env,
          requests,
          (line) => jsonIn(line, true)?.id === 2,
          true,
        );
        if (result.code !== 0 || result.timedOut || result.tooMuchOutput)
          throw Object.assign(
            new Error("Codex account/rateLimits/read process failed"),
            { result },
          );
        windows = codexWindows(result.lines);
      }
      if (windows.length === 0)
        throw new Error(
          `${account.agent}: no subscription rate limits returned`,
        );
      const usage: CurrentUsage = {
        status: "ok",
        windows,
        observedAt: deps.now(),
      };
      deps.publish(account, command, usage);
      return { ...base, status: "ok", usage, finishedAt: deps.now() };
    } catch (error) {
      const failure = errorWithCause(
        `Usage read failed for ${account.agent} account ${account.id}`,
        error,
      );
      console.error(failure);
      return {
        ...base,
        status: "failed",
        reason: "read-failed",
        detail: formatErrorDetail(failure),
        evidence: [],
        usage: null,
        finishedAt: deps.now(),
      };
    }
  }
  return {
    async check(account, cwd) {
      const command = deps.launchCommand(account);
      const key = JSON.stringify([
        account.id,
        account.agent,
        account.builtin,
        account.configDir,
        command,
      ]);
      const pending = running.get(key);
      if (pending) return { ...(await pending), joined: true };
      const promise = run(account, cwd, command);
      running.set(key, promise);
      try {
        return await promise;
      } finally {
        if (running.get(key) === promise) running.delete(key);
      }
    },
  };
}

let shared: UsageChecker | undefined;
export function sharedUsageChecker(): UsageChecker {
  shared ??= createUsageChecker({
    run: (args, cwd, env) =>
      runAsync(args, cwd, {
        env,
        timeout: USAGE_CHECK_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      }),
    rpc: DEFAULT_LOGIN_DEPS.rpc,
    launchCommand: (account) =>
      sharedAccountService().launchCommands()[account.agent],
    publish: (account, command, usage) =>
      sharedAccountService().recordUsage(account, command, usage),
    now: Date.now,
    env: process.env,
  });
  return shared;
}
