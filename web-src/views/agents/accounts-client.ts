import { apiUrl } from "../../core/api-url";
// アカウントの一覧 (/_agent/accounts) を取り、エージェント一覧の帯と
// 設定画面の節で同じ結果を見るための入れ物。書き込み系の呼び出しもここに
// まとめる (X-Code-Viewer-Action を付け忘れないため)。
//
// 取り直すのは、帯か設定の節が画面にある間だけ (呼び出し側が start/stop)。
// 周期の取り直しは BACKGROUND_REQUEST_HEADER を付け、通信中の表示と取消の
// 対象から外す。利用者の操作で始まる取得は trackLoad を通す。世代で古い
// 応答を捨てる。

import type {
  AccountsResponse,
  CreateAccountPlan,
  LaunchResponse,
  RegisterAccountPlan,
  StatusLineApplyResponse,
  StatusLinePlanResponse,
  StoredAccount,
  UsageCheckResponse,
} from "../../core/agent-accounts";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import { BACKGROUND_REQUEST_HEADER } from "../../core/network-activity";

/** 周期の取り直しの間隔。使用量とログインの状態はそう速く変わらない。 */
const ACCOUNTS_POLL_MS = 10_000;
/** ログインを始めてから、状態を強く取り直し続ける時間。 */
const LOGIN_WATCH_MS = 5 * 60_000;

export type AccountsClientDeps = {
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  actionHeaders(): HeadersInit;
};

/**
 * 「使用量を確かめる」のアカウントごとの状態。走っている間は running、
 * 終われば応答 (止まった理由) か、要求そのものの失敗の全文。値が取れて
 * セッションも閉じたら状態を消す (カードは普段の表示に戻る)。
 */
export type UsageCheckState = {
  running: boolean;
  response?: UsageCheckResponse;
  error?: string;
};

export type AccountsSnapshot = {
  data: AccountsResponse | null;
  error: string;
};

export type AccountsClient = {
  snapshot(): AccountsSnapshot;
  subscribe(listener: () => void): () => void;
  /**
   * 取り直す。background は周期の取り直し。refreshLogin はログインの状態を
   * CLI に訊き直させる (account を添えるとそのアカウントだけ)。
   */
  load(options?: {
    background?: boolean;
    refreshLogin?: boolean;
    account?: string;
  }): Promise<void>;
  /** 見ている間だけ周期で取り直す。何度呼んでもよい (数える)。 */
  retain(): () => void;
  planCreate(agent: string, name: string): Promise<CreateAccountPlan>;
  planRegister(
    agent: string,
    name: string,
    path: string,
  ): Promise<RegisterAccountPlan>;
  create(plan: CreateAccountPlan, share: string[]): Promise<StoredAccount>;
  register(plan: RegisterAccountPlan): Promise<StoredAccount>;
  remove(id: string): Promise<StoredAccount>;
  rename(id: string, name: string): Promise<StoredAccount>;
  savePreferences(commands: Record<string, string>): Promise<void>;
  login(id: string): Promise<{ paneId: string; session: string }>;
  launch(request: {
    accountId: string;
    project: string;
    session: string;
  }): Promise<LaunchResponse>;
  planStatusLine(
    account: string,
    action: "install" | "uninstall",
  ): Promise<StatusLinePlanResponse>;
  applyStatusLine(
    plan: StatusLinePlanResponse,
    account: string,
  ): Promise<StatusLineApplyResponse>;
  clearUsageFailures(): Promise<void>;
  /** そのアカウントの「使用量を確かめる」の状態。無ければ null。 */
  usageCheck(id: string): UsageCheckState | null;
  /**
   * 使用量を確かめる (確認の画面は出さない)。走っている間は何もしない。
   * 結果は usageCheck に置き、失敗も投げずにそこへ残す。
   */
  checkUsage(id: string): Promise<void>;
};

/**
 * 失敗の応答を、操作名・HTTP の状態・本文の理由 (全文) の 1 つの文にする。
 * 本文がサーバの `{error, code}` だけなら理由の文と code に縮め、ほかの欄が
 * ある・JSON でない本文は全文を出す (欄を黙って捨てない)。
 */
export async function responseFailure(
  res: Response,
  operation: string,
): Promise<Error> {
  const statusText = res.statusText ? ` ${res.statusText}` : "";
  const prefix = `${operation} (HTTP ${res.status}${statusText})`;
  let body: string;
  try {
    body = await res.text();
  } catch (error) {
    return errorWithCause(`${prefix}: failed to read response body`, error);
  }
  const detail = serverReason(body) ?? body;
  return new Error(detail ? `${prefix}: ${detail}` : prefix);
}

function serverReason(body: string): string | null {
  if (!body.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // 括弧で始まるだけの本文。呼び出し側が全文を出す。
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { error, code, ...rest } = parsed as Record<string, unknown>;
  if (typeof error !== "string" || Object.keys(rest).length > 0) return null;
  if (code === undefined) return error;
  return typeof code === "string" ? `${error} (${code})` : null;
}

export function createAccountsClient(deps: AccountsClientDeps): AccountsClient {
  let data: AccountsResponse | null = null;
  let error = "";
  let generation = 0;
  let holders = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loginWatchUntil = 0;
  const listeners = new Set<() => void>();
  const checks = new Map<string, UsageCheckState>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  async function load(
    options: {
      background?: boolean;
      refreshLogin?: boolean;
      account?: string;
    } = {},
  ): Promise<void> {
    const mine = ++generation;
    const query = options.refreshLogin
      ? `?${new URLSearchParams(options.account ? { login: "refresh", account: options.account } : { login: "refresh" })}`
      : "";
    try {
      const res = options.background
        ? await fetch(`${apiUrl("agentAccounts")}${query}`, {
            headers: { [BACKGROUND_REQUEST_HEADER]: "1" },
          })
        : await deps.trackLoad(fetch(`${apiUrl("agentAccounts")}${query}`));
      if (!res.ok) throw await responseFailure(res, "GET /_agent/accounts");
      const next = (await res.json()) as AccountsResponse;
      if (mine !== generation) return;
      data = next;
      error = "";
    } catch (cause) {
      if (mine !== generation) return;
      console.error("[code-viewer] account list failed", cause);
      error = formatErrorDetail(cause);
    }
    emit();
  }

  function schedule(): void {
    if (timer !== null || holders === 0) return;
    timer = setTimeout(() => {
      timer = null;
      if (holders === 0) return;
      void load({
        background: true,
        refreshLogin: Date.now() < loginWatchUntil,
      }).finally(schedule);
    }, ACCOUNTS_POLL_MS);
  }

  async function post<T>(
    url: string,
    body: unknown,
    operation: string,
  ): Promise<T> {
    const res = await deps.trackLoad(
      fetch(url, {
        method: "POST",
        headers: deps.actionHeaders(),
        body: JSON.stringify(body),
      }),
    );
    if (!res.ok) throw await responseFailure(res, operation);
    return (await res.json()) as T;
  }

  async function get<T>(url: string, operation: string): Promise<T> {
    const res = await deps.trackLoad(fetch(url));
    if (!res.ok) throw await responseFailure(res, operation);
    return (await res.json()) as T;
  }

  return {
    snapshot: () => ({ data, error }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    retain() {
      holders += 1;
      schedule();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0 && timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      };
    },
    planCreate: (agent, name) =>
      get(
        `${apiUrl("agentAccountsPlan")}?${new URLSearchParams({ op: "create", agent, name })}`,
        "plan the account",
      ),
    planRegister: (agent, name, path) =>
      get(
        `${apiUrl("agentAccountsPlan")}?${new URLSearchParams({ op: "register", agent, name, path })}`,
        "check the directory",
      ),
    async create(plan, share) {
      const result = await post<{ added: StoredAccount }>(
        apiUrl("agentAccounts"),
        {
          op: "create",
          agent: plan.agent,
          name: plan.name,
          configDir: plan.configDir,
          share,
        },
        "create the account",
      );
      await load();
      return result.added;
    },
    async register(plan) {
      const result = await post<{ added: StoredAccount }>(
        apiUrl("agentAccounts"),
        {
          op: "register",
          agent: plan.agent,
          name: plan.name,
          configDir: plan.configDir,
        },
        "register the directory",
      );
      await load();
      return result.added;
    },
    async remove(id) {
      const result = await post<{ removed: StoredAccount }>(
        apiUrl("agentAccounts"),
        { op: "remove", id },
        "remove the account",
      );
      await load();
      return result.removed;
    },
    async rename(id, name) {
      const result = await post<{ renamed: StoredAccount }>(
        apiUrl("agentAccounts"),
        { op: "rename", id, name },
        "rename the account",
      );
      await load();
      return result.renamed;
    },
    async savePreferences(commands) {
      await post(
        apiUrl("agentAccounts"),
        { op: "preferences", launchCommands: commands },
        "save the launch commands",
      );
      await load();
    },
    async login(id) {
      const result = await post<{ paneId: string; session: string }>(
        apiUrl("agentAccountsLogin"),
        { id },
        "start the login",
      );
      loginWatchUntil = Date.now() + LOGIN_WATCH_MS;
      return result;
    },
    launch: (request) =>
      post<LaunchResponse>(apiUrl("agentLaunch"), request, "start the agent"),
    planStatusLine: (account, action) =>
      get(
        `${apiUrl("agentStatuslinePlan")}?${new URLSearchParams({ account, action })}`,
        "plan the statusLine change",
      ),
    async applyStatusLine(plan, account) {
      const result = await post<StatusLineApplyResponse>(
        apiUrl("agentStatuslineApply"),
        {
          account,
          action: plan.action,
          baseHash: plan.baseHash,
          realPath: plan.realPath,
          fileIdentity: plan.fileIdentity,
        },
        "change the statusLine",
      );
      await load();
      return result;
    },
    async clearUsageFailures() {
      const res = await deps.trackLoad(
        fetch(apiUrl("agentStatuslineFailures"), {
          method: "DELETE",
          headers: deps.actionHeaders(),
        }),
      );
      if (!res.ok) throw await responseFailure(res, "clear the failures");
      await load();
    },
    usageCheck: (id) => checks.get(id) ?? null,
    async checkUsage(id) {
      if (checks.get(id)?.running) return;
      checks.set(id, { running: true });
      emit();
      let response: UsageCheckResponse;
      try {
        response = await post<UsageCheckResponse>(
          apiUrl("agentAccountsUsageCheck"),
          { id },
          "check the usage",
        );
      } catch (cause) {
        console.error("[code-viewer] usage check failed", cause);
        checks.set(id, { running: false, error: formatErrorDetail(cause) });
        emit();
        return;
      }
      if (response.status === "ok" && !response.closeError) checks.delete(id);
      else checks.set(id, { running: false, response });
      // 新しい値 (または届いていない理由) を一覧に出す。load が知らせる。
      await load();
    },
  };
}
