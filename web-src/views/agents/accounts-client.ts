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
} from "../../core/agent-accounts";
import { formatErrorDetail } from "../../core/error-detail";
import { BACKGROUND_REQUEST_HEADER } from "../../core/network-activity";

/** 周期の取り直しの間隔。使用量とログインの状態はそう速く変わらない。 */
const ACCOUNTS_POLL_MS = 10_000;
/** ログインを始めてから、状態を強く取り直し続ける時間。 */
const LOGIN_WATCH_MS = 5 * 60_000;

export type AccountsClientDeps = {
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  actionHeaders(): HeadersInit;
};

export type AccountsSnapshot = {
  data: AccountsResponse | null;
  error: string;
};

export type AccountsClient = {
  snapshot(): AccountsSnapshot;
  subscribe(listener: () => void): () => void;
  /** 取り直す。background は周期の取り直し。 */
  load(options?: {
    background?: boolean;
    refreshLogin?: boolean;
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
};

/** 失敗の応答を、操作名・HTTP の状態・本文の理由 (全文) の 1 つの文にする。 */
export async function responseFailure(
  res: Response,
  operation: string,
): Promise<Error> {
  const body = await res.text();
  let detail = body;
  if (body.startsWith("{")) {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") detail = parsed.error;
  }
  return new Error(
    `${operation} (HTTP ${res.status}): ${detail || res.statusText}`,
  );
}

export function createAccountsClient(deps: AccountsClientDeps): AccountsClient {
  let data: AccountsResponse | null = null;
  let error = "";
  let generation = 0;
  let holders = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loginWatchUntil = 0;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  async function load(
    options: { background?: boolean; refreshLogin?: boolean } = {},
  ): Promise<void> {
    const mine = ++generation;
    const query = options.refreshLogin ? "?login=refresh" : "";
    try {
      const res = options.background
        ? await fetch(`/_agent/accounts${query}`, {
            headers: { [BACKGROUND_REQUEST_HEADER]: "1" },
          })
        : await deps.trackLoad(fetch(`/_agent/accounts${query}`));
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
        `/_agent/accounts/plan?${new URLSearchParams({ op: "create", agent, name })}`,
        "plan the account",
      ),
    planRegister: (agent, name, path) =>
      get(
        `/_agent/accounts/plan?${new URLSearchParams({ op: "register", agent, name, path })}`,
        "check the directory",
      ),
    async create(plan, share) {
      const result = await post<{ added: StoredAccount }>(
        "/_agent/accounts",
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
        "/_agent/accounts",
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
        "/_agent/accounts",
        { op: "remove", id },
        "remove the account",
      );
      await load();
      return result.removed;
    },
    async savePreferences(commands) {
      await post(
        "/_agent/accounts",
        { op: "preferences", launchCommands: commands },
        "save the launch commands",
      );
      await load();
    },
    async login(id) {
      const result = await post<{ paneId: string; session: string }>(
        "/_agent/accounts/login",
        { id },
        "start the login",
      );
      loginWatchUntil = Date.now() + LOGIN_WATCH_MS;
      return result;
    },
    launch: (request) =>
      post<LaunchResponse>("/_agent/launch", request, "start the agent"),
    planStatusLine: (account, action) =>
      get(
        `/_agent/statusline/plan?${new URLSearchParams({ account, action })}`,
        "plan the statusLine change",
      ),
    async applyStatusLine(plan, account) {
      const result = await post<StatusLineApplyResponse>(
        "/_agent/statusline/apply",
        { account, action: plan.action, baseHash: plan.baseHash },
        "change the statusLine",
      );
      await load();
      return result;
    },
    async clearUsageFailures() {
      const res = await deps.trackLoad(
        fetch("/_agent/statusline/failures", {
          method: "DELETE",
          headers: deps.actionHeaders(),
        }),
      );
      if (!res.ok) throw await responseFailure(res, "clear the failures");
      await load();
    },
  };
}
