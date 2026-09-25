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
// 送り先は入口のサーバ (entry.json) と、サーバ登録簿の 1 つで完結するサーバ
// (`--standalone`)。入口の裏のプロセス (登録簿の backend) は状態を持たない
// ので送らない。入口・単体サーバとも起動ごとの本人確認が一致した相手だけに
// 送る。古い版のように token / version が無い相手へ prompt を渡さない。
// token も version も無い古い形の登録は、確かめようがないので候補にもしない
// (失敗として数えない。サーバの起動時に登録簿から消える)。

import {
  type AgentHookFailure,
  agentEventForHook,
  type HookAgent,
} from "../../core/agent-hooks";
import {
  type AgentEvent,
  conversationFromHookInput,
  MAX_CONVERSATION_FIELD,
} from "../../core/agent-state";
import { formatErrorDetail } from "../../core/error-detail";
import { extractErrorDetail } from "../cli-helpers";
import {
  type EntryIdentityVerification,
  type EntryRecord,
  isEntryToken,
  liveEntryRecord,
  verifyServerIdentity,
} from "../entry/entry-file";
import {
  isLegacyServerRegistry,
  listServerRegistry,
  parseServerRegistryUrl,
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
  /** 動いている入口の記録。無ければ null。読めなければ投げる。 */
  entryRecord(): EntryRecord | null;
  verifyIdentity(target: ReportTarget): Promise<EntryIdentityVerification>;
  post(url: string, body: unknown, signal: AbortSignal): Promise<Response>;
  recordFailure(failure: AgentHookFailure): void;
};

export type ReportTarget = {
  url: string;
  pid: number;
  token?: string;
  version?: string;
  role: "entry" | "standalone";
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
      detail: `could not read the hook input: ${formatErrorDetail(error)}\ninput: ${Buffer.byteLength(stdin, "utf8")} bytes, not shown`,
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
  let entry: EntryRecord | null = null;
  try {
    entry = deps.entryRecord();
  } catch (error) {
    fail({
      hookEvent,
      event,
      target,
      stage: "registry",
      detail: formatErrorDetail(error),
    });
  }
  const targets = reportTargets(listing, entry);
  if (targets.length === 0) {
    fail({
      hookEvent,
      event,
      target,
      stage: "no-server",
      detail: `no running code-viewer server is registered in ${registryDir()}`,
    });
    return { kind: "failed", failures };
  }

  const verified: ReportTarget[] = [];
  await Promise.all(
    targets.map(async (reportTarget) => {
      let verification: EntryIdentityVerification;
      try {
        verification = await deps.verifyIdentity(reportTarget);
      } catch (error) {
        fail({
          hookEvent,
          event,
          target,
          server: reportTarget.url,
          stage: "identity",
          detail: formatErrorDetail(error),
        });
        return;
      }
      if (verification.status === "ok") {
        verified.push(reportTarget);
        return;
      }
      const detail =
        verification.status === "dead"
          ? `registered pid ${reportTarget.pid} is no longer running`
          : verification.status === "unreachable"
            ? `identity endpoint did not answer:\n${formatErrorDetail(verification.error)}`
            : verification.detail;
      fail({
        hookEvent,
        event,
        target,
        server: reportTarget.url,
        stage: "identity",
        detail,
      });
    }),
  );
  if (verified.length === 0) return { kind: "failed", failures };

  // 本人確認が終わる前は、送信先ごとの処理にも prompt 本文を作らない。
  const prompt =
    event === "prompt" && typeof input.prompt === "string"
      ? input.prompt.slice(0, MAX_PROMPT_LENGTH)
      : undefined;
  // 会話の場所 (session_id・transcript_path・cwd)。「別のアカウントで続ける」が
  // 次の担当に記録の場所を渡すのに使う。記録の中身は読まない。受け取れない
  // 欄は空にして申告は続け、欄の名前だけを失敗の記録に残す (値はパスや
  // 長い文字列なので載せない)。申告の結果は失敗にしない。
  const { conversation, rejected } = conversationFromHookInput(input);
  if (rejected.length > 0) {
    deps.recordFailure({
      at,
      agent,
      hookEvent,
      event,
      target,
      server: "",
      stage: "input",
      detail: `the hook input has conversation fields that are not reported (not a string, not an absolute path, control characters, or longer than ${MAX_CONVERSATION_FIELD} characters): ${rejected.join(", ")}`,
    });
  }
  const body = {
    target,
    event,
    at,
    agent,
    ...(prompt === undefined ? {} : { lastPrompt: prompt }),
    ...(conversation === null ? {} : { conversation }),
  };
  const reached: string[] = [];
  const refused: string[] = [];
  await Promise.all(
    verified.map(async (reportTarget) => {
      const { url } = reportTarget;
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
 * 申告の候補: 入口と、登録簿のうち裏のプロセスでも古い形でもないもの。同じ URL は 1 つ
 * (末尾の `/` なし)。この後 `verifyReportTargetIdentity` を通った候補だけに送る。
 */
export function reportTargets(
  listing: ServerRegistryListing,
  entry: EntryRecord | null,
): ReportTarget[] {
  const targets = new Map<string, ReportTarget>();
  if (entry) {
    const url = parseServerRegistryUrl(entry.url).href.replace(/\/$/, "");
    targets.set(url, { ...entry, url, role: "entry" });
  }
  for (const server of listing.servers) {
    // 古い形の登録は確かめられないので送らない (失敗としても数えない)。
    // サーバが起きたときに消える (server-registry.ts の isLegacyServerRegistry)。
    if (server.backend || isLegacyServerRegistry(server)) continue;
    const url = parseServerRegistryUrl(server.url).href.replace(/\/$/, "");
    if (targets.has(url)) continue;
    targets.set(url, {
      url,
      pid: server.pid,
      token: server.token,
      version: server.version,
      role: "standalone",
    });
  }
  return [...targets.values()];
}

export function verifyReportTargetIdentity(
  target: ReportTarget,
): Promise<EntryIdentityVerification> {
  const mismatches: string[] = [];
  if (!target.version) {
    mismatches.push("version mismatch: the registry has no version");
  }
  if (!isEntryToken(target.token)) {
    mismatches.push(
      "token mismatch: the registry has no valid per-start token",
    );
  }
  if (mismatches.length > 0) {
    return Promise.resolve({
      status: "invalid",
      detail: `the server at ${target.url} failed identity verification:\n${mismatches.map((reason) => `- ${reason}`).join("\n")}`,
    });
  }
  return verifyServerIdentity(
    {
      url: target.url,
      pid: target.pid,
      token: target.token,
      version: target.version,
    },
    target.role,
  );
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
    entryRecord: () => liveEntryRecord(),
    verifyIdentity: verifyReportTargetIdentity,
    post: postToServer,
    recordFailure,
  };
}
