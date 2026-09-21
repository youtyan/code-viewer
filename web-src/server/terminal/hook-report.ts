// `code-viewer terminal hook` の本体。エージェントのフックから呼ばれ、
// 渡された JSON を読んで、動いている全部の code-viewer サーバに状態を
// 知らせる。
//
// エージェントを止めない・遅くしないのが最優先。
//
// - 全部のサーバへ並べて送り、1 つあたり REPORT_TIMEOUT_MS で打ち切る。
//   1 つが応答しなくても、ほかへの申告は止めない
// - どう失敗しても終了コードは 0 (エージェントをブロックする 2 を返さない)
// - 失敗は捨てない。フックの失敗の記録 (起動スクリプトが --log で渡す) に、
//   時刻・どのフック・どのサーバ・理由を残す。設定画面がここを読む
//
// どのサーバに送るかは決めない。同じ tmux ペインを複数のサーバ (リポジトリ
// ごとに起こしたもの) が見ているので、1 つにだけ送ると状態が食い違う。

import {
  type AgentHookFailure,
  agentEventForHook,
  type HookAgent,
} from "../../core/agent-hooks";
import type { AgentEvent } from "../../core/agent-state";
import { formatErrorDetail } from "../../core/error-detail";
import { extractErrorDetail } from "../cli-helpers";
import {
  listServerRegistry,
  registryDir,
  type ServerRegistryListing,
} from "../server-registry";
import { terminalKindOf } from "./capture";

/** サーバ 1 つあたりの待ち時間。ローカルのサーバはふつう数ミリ秒で返す。 */
export const REPORT_TIMEOUT_MS = 1000;

/** 申告に添える指示文の上限。サーバ側 (handle.ts) の上限と同じ。 */
const MAX_PROMPT_LENGTH = 2000;

export type HookReportDeps = {
  now(): number;
  env: Record<string, string | undefined>;
  listServers(): ServerRegistryListing;
  post(url: string, body: unknown, signal: AbortSignal): Promise<Response>;
  recordFailure(failure: AgentHookFailure): void;
};

export type HookReportOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "reported"; event: AgentEvent; servers: string[] }
  | { kind: "failed"; failures: AgentHookFailure[] };

function targetOf(env: Record<string, string | undefined>): string | null {
  for (const value of [env.TMUX_PANE, env.CODE_VIEWER_SHELL_ID]) {
    if (value && terminalKindOf(value)) return value;
  }
  return null;
}

/**
 * 1 回分の申告。例外は投げない (投げると呼び出し側がエージェントを止める
 * 終了コードにしかねない)。失敗は deps.recordFailure に全部渡し、結果にも
 * 載せる。
 */
export async function reportAgentHook(
  agent: HookAgent,
  stdin: string,
  deps: HookReportDeps,
): Promise<HookReportOutcome> {
  const at = deps.now();
  const failures: AgentHookFailure[] = [];
  const fail = (
    fields: Partial<AgentHookFailure> &
      Pick<AgentHookFailure, "stage" | "detail">,
  ) => {
    const failure: AgentHookFailure = {
      at,
      agent,
      hookEvent: "",
      event: "",
      target: "",
      server: "",
      ...fields,
    };
    failures.push(failure);
    deps.recordFailure(failure);
  };

  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(stdin);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("the hook input is not a JSON object");
    }
    input = parsed as Record<string, unknown>;
  } catch (error) {
    fail({
      stage: "input",
      detail: `could not read the hook input: ${formatErrorDetail(error)}\ninput: ${stdin.slice(0, 500)}`,
    });
    return { kind: "failed", failures };
  }
  const hookEvent =
    typeof input.hook_event_name === "string" ? input.hook_event_name : "";
  const event = agentEventForHook(agent, input);
  if (!event) return { kind: "skipped", reason: `not reported: ${hookEvent}` };
  // tmux の外で動くエージェントは一覧に出ないので、知らせる先が無い。
  const target = targetOf(deps.env);
  if (!target) return { kind: "skipped", reason: "not inside tmux" };

  let listing: ServerRegistryListing;
  try {
    listing = deps.listServers();
  } catch (error) {
    fail({
      hookEvent,
      event,
      target,
      stage: "registry",
      detail: formatErrorDetail(error),
    });
    return { kind: "failed", failures };
  }
  for (const broken of listing.errors) {
    fail({
      hookEvent,
      event,
      target,
      server: broken.file,
      stage: "registry",
      detail: formatErrorDetail(broken.error),
    });
  }
  if (listing.servers.length === 0) {
    fail({
      hookEvent,
      event,
      target,
      stage: "no-server",
      detail: `no running code-viewer server is registered in ${registryDir()}`,
    });
    return { kind: "failed", failures };
  }

  const prompt =
    event === "prompt" && typeof input.prompt === "string"
      ? input.prompt.slice(0, MAX_PROMPT_LENGTH)
      : undefined;
  const body = {
    target,
    event,
    at,
    agent,
    ...(prompt === undefined ? {} : { lastPrompt: prompt }),
  };
  const reached: string[] = [];
  const refused: string[] = [];
  await Promise.all(
    listing.servers.map(async (server) => {
      const url = server.url.replace(/\/+$/, "");
      try {
        const res = await deps.post(
          `${url}/_agent/state`,
          body,
          AbortSignal.timeout(REPORT_TIMEOUT_MS),
        );
        if (res.ok) {
          reached.push(url);
          return;
        }
        const text = await res.text();
        const isJson = (res.headers.get("content-type") ?? "").includes("json");
        throw new Error(
          `HTTP ${res.status}: ${extractErrorDetail(text, isJson, res.status)}`,
        );
      } catch (error) {
        // 何も待ち受けていない = そのサーバはもう居ない。登録簿には落ちた
        // サーバの登録が残り、その pid が別のプロセスに使い回されていると
        // 生きているように見える。届かなかった申告ではないので記録しない。
        if (connectionRefused(error)) {
          refused.push(url);
          return;
        }
        fail({
          hookEvent,
          event,
          target,
          server: url,
          stage: "report",
          detail: formatErrorDetail(error),
        });
      }
    }),
  );
  if (reached.length === 0 && failures.length === 0) {
    fail({
      hookEvent,
      event,
      target,
      stage: "no-server",
      detail: `no running code-viewer server answered; ${refused.length} registered in ${registryDir()} refused the connection (left over from servers that are gone): ${refused.sort().join(", ")}`,
    });
  }
  if (failures.length > 0) return { kind: "failed", failures };
  return { kind: "reported", event, servers: reached.sort() };
}

/**
 * ほかの code-viewer サーバへ状態を知らせる POST。サーバは同一オリジンの
 * 副作用要求しか通さないので、相手のオリジンと X-Code-Viewer-Action を付ける。
 */
export function postToServer(
  url: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  const origin = new URL(url).origin;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "X-Code-Viewer-Action": "1",
    },
    body: JSON.stringify(body),
    signal,
  });
}

/** 接続を断られた = そのサーバはもう居ない (登録簿の残り)。失敗ではない。 */
export function connectionRefused(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if ((current as { code?: unknown }).code === "ECONNREFUSED") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function defaultHookReportDeps(
  recordFailure: (failure: AgentHookFailure) => void,
): HookReportDeps {
  return {
    now: () => Date.now(),
    env: process.env,
    listServers: listServerRegistry,
    post: postToServer,
    recordFailure,
  };
}
