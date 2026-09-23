// アカウント・使用量・起動の HTTP 入口。振り分けは terminal/handle.ts の
// /_agent/ の表に載せる (並行するルータは作らない)。
//
// - GET    /_agent/accounts               アカウントの一覧 (ログイン・使用量・フック・statusLine)
// - GET    /_agent/accounts/plan          作る・登録すると何が起きるか (書かない)
// - POST   /_agent/accounts               作る・登録する・外す・起動コマンドを変える
// - POST   /_agent/accounts/login         ログインを tmux の新しいウィンドウで始める
// - POST   /_agent/launch                 エージェントを tmux の新しいウィンドウで起動する
// - GET    /_agent/statusline/plan        claude の statusLine を包む・戻すと何が変わるか
// - POST   /_agent/statusline/apply       確認した計画を実行する
// - DELETE /_agent/statusline/failures    包むスクリプトの失敗の記録を消す

import { realpathSync, statSync, unlinkSync } from "node:fs";
import {
  type AccountEntry,
  isAccountAgent,
  LOGIN_SESSION,
  MAX_LAUNCH_COMMAND,
} from "../../core/agent-accounts";
import { hasControlCharacter } from "../../core/control-chars";
import { formatErrorDetail } from "../../core/error-detail";
import {
  json,
  parseBoundedJsonBody,
  textError,
} from "../database/handle-shared";
import { rememberSignInPane } from "../terminal/open";
import {
  applyStatusLine,
  planStatusLine,
  StatusLineError,
  statusLineFailureLog,
} from "../terminal/statusline";
import {
  accountWindowName,
  agentCommandArgv,
  loginWindowArgv,
  openAccountWindow,
} from "./launch";
import {
  AccountError,
  applyCreateAccount,
  applyRegisterAccount,
  applyRemoveAccount,
  applyRenameAccount,
  planCreateAccount,
  planRegisterAccount,
  updateAccountRegistry,
} from "./registry";
import { sharedAccountService } from "./service";

/** 本文の上限。名前・パス・コマンドとリンクの一覧だけが来る。 */
const MAX_ACCOUNT_BODY_BYTES = 16 * 1024;

function errorResponse(error: unknown): Response {
  if (error instanceof AccountError || error instanceof StatusLineError) {
    // code は本文の欄で返す。文にも入れると、画面で同じ code が 2 度出る。
    const detail = formatErrorDetail(error, { fieldsShownElsewhere: ["code"] });
    const status =
      error.code === "invalid"
        ? 400
        : error.code === "not-found"
          ? 404
          : error.code === "builtin"
            ? 403
            : error.code === "conflict" || error.code === "blocked"
              ? 409
              : error.code === "unreadable"
                ? 422
                : 500;
    if (status === 500)
      console.error("[code-viewer] account request failed", error);
    return json({ error: detail, code: error.code }, status);
  }
  console.error("[code-viewer] account request failed", error);
  return json({ error: formatErrorDetail(error), code: "failed" }, 500);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  if (hasControlCharacter(value)) return null;
  return value;
}

function findAccount(id: unknown): AccountEntry {
  const service = sharedAccountService();
  const { entries } = service.entries();
  const found = entries.find((entry) => entry.id === id);
  if (!found) throw new AccountError(`no account ${String(id)}`, "not-found");
  return found;
}

export async function handleAccountsGet(
  url: URL,
  cwd: string,
): Promise<Response> {
  try {
    return json(
      await sharedAccountService().overview({
        // login=refresh で全部、account=<id> を添えるとその行だけ訊き直す。
        forceLogin:
          url.searchParams.get("login") === "refresh"
            ? (url.searchParams.get("account") ?? true)
            : false,
        serverRoot: realpathSync(cwd),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleAccountsPlanGet(url: URL): Response {
  const op = url.searchParams.get("op");
  const agent = url.searchParams.get("agent");
  const name = text(url.searchParams.get("name") ?? "", 200);
  if (!isAccountAgent(agent)) return textError("invalid agent", 400);
  if (name === null) return textError("invalid name", 400);
  const paths = sharedAccountService().paths;
  try {
    if (op === "create") return json(planCreateAccount(paths, agent, name));
    if (op === "register") {
      const path = text(url.searchParams.get("path") ?? "", 4096);
      if (!path) return textError("invalid path", 400);
      return json(planRegisterAccount(paths, agent, name, path));
    }
    return textError("invalid op", 400);
  } catch (error) {
    return errorResponse(error);
  }
}

function shareOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const out: string[] = [];
  for (const item of value) {
    const name = text(item, 255);
    // 直下の名前だけ。区切りや . / .. を含むものは受け取らない。
    if (!name || name.includes("/") || name === "." || name === "..") {
      return null;
    }
    out.push(name);
  }
  return out;
}

export async function handleAccountsPost(req: Request): Promise<Response> {
  const body = await parseBoundedJsonBody(
    req,
    MAX_ACCOUNT_BODY_BYTES,
    "account request too large",
  );
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object") {
    return textError("invalid account request", 400);
  }
  const fields = body as Record<string, unknown>;
  const paths = sharedAccountService().paths;
  try {
    if (fields.op === "remove") {
      if (typeof fields.id !== "string") return textError("invalid id", 400);
      return json({ removed: await applyRemoveAccount(paths, fields.id) });
    }
    if (fields.op === "rename") {
      if (typeof fields.id !== "string") return textError("invalid id", 400);
      const name = text(fields.name, 200);
      if (name === null) return textError("invalid name", 400);
      return json({
        renamed: await applyRenameAccount(paths, fields.id, name),
      });
    }
    if (fields.op === "preferences") {
      const commands = fields.launchCommands;
      if (typeof commands !== "object" || commands === null) {
        return textError("invalid launchCommands", 400);
      }
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(commands)) {
        const command = text(value, MAX_LAUNCH_COMMAND);
        if (!isAccountAgent(key) || command === null) {
          return textError(`invalid launch command for ${key}`, 400);
        }
        next[key] = command.trim();
      }
      await updateAccountRegistry(paths.registry, (registry) => ({
        registry: {
          ...registry,
          launchCommands: Object.fromEntries(
            Object.entries({ ...registry.launchCommands, ...next }).filter(
              ([, value]) => value !== "",
            ),
          ),
        },
        result: null,
      }));
      return json({ ok: true });
    }
    const agent = fields.agent;
    const name = text(fields.name, 200);
    if (!isAccountAgent(agent)) return textError("invalid agent", 400);
    if (name === null) return textError("invalid name", 400);
    const configDir = text(fields.configDir, 4096);
    if (!configDir) return textError("invalid configDir", 400);
    if (fields.op === "create") {
      const share = shareOf(fields.share);
      if (!share) return textError("invalid share", 400);
      return json({
        added: await applyCreateAccount(paths, {
          agent,
          name,
          configDir,
          share,
        }),
      });
    }
    if (fields.op === "register") {
      return json({
        added: await applyRegisterAccount(paths, agent, name, configDir),
      });
    }
    return textError("invalid op", 400);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLoginPost(
  req: Request,
  cwd: string,
): Promise<Response> {
  const body = await parseBoundedJsonBody(
    req,
    MAX_ACCOUNT_BODY_BYTES,
    "login request too large",
  );
  if (body instanceof Response) return body;
  const id = (body as Record<string, unknown> | null)?.id;
  if (typeof id !== "string") return textError("invalid id", 400);
  try {
    const account = findAccount(id);
    const pane = await openAccountWindow({
      agent: account.agent,
      account,
      cwd,
      session: LOGIN_SESSION,
      windowName: `login-${accountWindowName(account.agent, account)}`,
      argv: loginWindowArgv(
        account.agent,
        sharedAccountService().launchCommands()[account.agent],
      ),
    });
    rememberSignInPane(pane.paneId, {
      kind: "sign-in",
      agent: account.agent,
      account: account.builtin ? "" : account.name,
    });
    return json(pane);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLaunchPost(req: Request): Promise<Response> {
  const body = await parseBoundedJsonBody(
    req,
    MAX_ACCOUNT_BODY_BYTES,
    "launch request too large",
  );
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object") {
    return textError("invalid launch request", 400);
  }
  const { accountId, project, session } = body as Record<string, unknown>;
  const cwd = text(project, 4096);
  const sessionName = text(session, 80);
  if (!cwd?.startsWith("/")) return textError("invalid project", 400);
  if (!sessionName?.trim()) return textError("invalid session", 400);
  try {
    let isDir = false;
    try {
      isDir = statSync(cwd).isDirectory();
    } catch (error) {
      throw new AccountError(`cannot open ${cwd}`, "invalid", { cause: error });
    }
    if (!isDir) throw new AccountError(`${cwd} is not a directory`, "invalid");
    const account = findAccount(accountId);
    const service = sharedAccountService();
    const command = service.launchCommands()[account.agent];
    const pane = await openAccountWindow({
      agent: account.agent,
      account,
      cwd,
      session: sessionName,
      windowName: accountWindowName(account.agent, account),
      argv: agentCommandArgv(command),
    });
    // 次に開いたときの既定。覚えられなくても起動は済んでいるので、理由を
    // 添えて返す (画面に出す)。
    let rememberError = "";
    try {
      await updateAccountRegistry(service.paths.registry, (registry) => ({
        registry: {
          ...registry,
          lastLaunch: {
            agent: account.agent,
            accountId: account.id,
            project: cwd,
            session: pane.session,
          },
        },
        result: null,
      }));
    } catch (error) {
      console.error(
        "[code-viewer] could not remember the launch choice",
        error,
      );
      rememberError = formatErrorDetail(error);
    }
    return json({ ...pane, command, rememberError });
  } catch (error) {
    return errorResponse(error);
  }
}

function claudeAccount(id: unknown): AccountEntry {
  const account = findAccount(id);
  if (account.agent !== "claude") {
    throw new AccountError("statusLine is a claude setting", "invalid");
  }
  return account;
}

export function handleStatusLinePlanGet(url: URL): Response {
  const action = url.searchParams.get("action");
  if (action !== "install" && action !== "uninstall") {
    return textError("invalid action", 400);
  }
  try {
    const account = claudeAccount(url.searchParams.get("account"));
    return json(
      planStatusLine(
        account.configDir,
        action,
        sharedAccountService().paths.usageDir,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleStatusLineApplyPost(
  req: Request,
): Promise<Response> {
  const body = await parseBoundedJsonBody(
    req,
    MAX_ACCOUNT_BODY_BYTES,
    "statusline request too large",
  );
  if (body instanceof Response) return body;
  const { account, action, baseHash, realPath, fileIdentity } = (body ??
    {}) as Record<string, unknown>;
  if (action !== "install" && action !== "uninstall") {
    return textError("invalid action", 400);
  }
  if (typeof baseHash !== "string" || !/^[0-9a-f]{64}$/.test(baseHash)) {
    return textError("invalid baseHash", 400);
  }
  if (typeof realPath !== "string" || !realPath.startsWith("/")) {
    return textError("invalid realPath", 400);
  }
  if (typeof fileIdentity !== "string" || fileIdentity === "") {
    return textError("invalid fileIdentity", 400);
  }
  try {
    const entry = claudeAccount(account);
    return json(
      await applyStatusLine(
        entry.configDir,
        action,
        sharedAccountService().paths.usageDir,
        { baseHash, realPath, fileIdentity },
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleStatusLineFailuresDelete(): Response {
  const log = statusLineFailureLog(sharedAccountService().paths.usageDir);
  try {
    unlinkSync(log);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return errorResponse(
        new AccountError(`failed to remove ${log}`, "failed", { cause: error }),
      );
    }
  }
  return json({ ok: true });
}
