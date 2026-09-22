import { formatErrorDetail } from "../core/error-detail";
import type { AppSettingsState } from "../core/types";
import { splitSettingsPatch, withUserSettings } from "../core/user-settings";
import {
  dispatchRoutes,
  handleError,
  json,
  jsonLoadResponse,
  parseBoundedJsonBody,
  textError,
} from "./database/handle-shared";
import {
  backupMainTabs,
  loadProjectMainTabs,
  mainTabsPath,
  saveProjectMainTabs,
} from "./main-tabs-store";
import {
  loadAppSettingsState,
  loadToolsState,
  loadViewState,
  patchAppSettingsState,
  patchToolsState,
  patchViewState,
} from "./state-store";
import {
  ensureUserSettings,
  patchUserSettings,
  UserSettingsError,
  userSettingsPath,
} from "./user-settings";

const MAX_STATE_PATCH_BODY_BYTES = 1_000_000;
// tools の下書きは 1 ツール 200,000 コード単位 × 3 ツールで、UTF-8 では最悪
// 4 バイト/文字になる。state-store 側の保存上限 (MAX_TOOLS_BYTES) と揃えて
// おかないと、個別には許可した下書きの組合せが本文の時点で弾かれる。
const MAX_TOOLS_PATCH_BODY_BYTES = 4_000_000;

export type StateRouteOptions = {
  onSettingsChange?: (state: AppSettingsState) => void;
};

async function parseJsonBody(
  req: Request,
  maxBytes: number,
): Promise<unknown | Response> {
  return parseBoundedJsonBody(req, maxBytes, "state body too large");
}

// 各 state の PATCH は「本文を読む → merge して保存 → 保存後の値を返す」まで
// 同じで、違うのは保存先と、上限超過時に state-store が投げるメッセージだけ。
async function handleStatePatch<T>(
  cwd: string,
  req: Request,
  patchState: (root: string, patch: unknown) => Promise<T>,
  tooLargeMessage: string,
  saveFailedMessage: string,
  maxBodyBytes: number,
  onChange?: (state: T) => void,
): Promise<Response> {
  const body = await parseJsonBody(req, maxBodyBytes);
  if (body instanceof Response) return body;
  try {
    const next = await patchState(cwd, body);
    if (onChange) {
      try {
        onChange(next);
      } catch (notifyErr) {
        console.warn("[code-viewer] state change notify failed:", notifyErr);
      }
    }
    return json(next);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === tooLargeMessage) return textError(message, 413);
    console.error("[code-viewer] state error:", err);
    // 理由を捨てない。画面の保存失敗の表示 (reportPersistenceError) に全文が出る。
    return textError(`${saveFailedMessage}: ${formatErrorDetail(err)}`, 500);
  }
}

/**
 * 画面に返す設定。人に付く項目はユーザー単位の設定 (user-settings.ts) から、
 * それ以外はリポジトリの設定から。ユーザー単位の設定が壊れていれば
 * リポジトリの設定で表示し、読めない理由を userSettingsError で返す。
 */
async function settingsForScreen(cwd: string): Promise<AppSettingsState> {
  const repo = await loadAppSettingsState(cwd);
  try {
    return withUserSettings(
      repo,
      await ensureUserSettings(userSettingsPath(), repo),
    );
  } catch (error) {
    if (!(error instanceof UserSettingsError)) throw error;
    console.error("[code-viewer] user settings are not used:", error);
    return { ...repo, userSettingsError: formatErrorDetail(error) };
  }
}

async function handleSettingsGet(cwd: string): Promise<Response> {
  return jsonLoadResponse(
    () => settingsForScreen(cwd),
    "state",
    "failed to load settings state",
  );
}

/** 人に付く項目はユーザー単位へ、残りはリポジトリの設定へ書く。 */
async function patchSettingsForScreen(
  cwd: string,
  patch: unknown,
): Promise<AppSettingsState> {
  const { user, repo } = splitSettingsPatch(
    patch && typeof patch === "object" && !Array.isArray(patch)
      ? (patch as Record<string, unknown>)
      : {},
  );
  const repoState =
    Object.keys(repo).length > 0
      ? await patchAppSettingsState(cwd, repo)
      : await loadAppSettingsState(cwd);
  const userState =
    Object.keys(user).length > 0
      ? await patchUserSettings(userSettingsPath(), user, repoState)
      : await ensureUserSettings(userSettingsPath(), repoState);
  return withUserSettings(repoState, userState);
}

async function handleSettingsPatch(
  cwd: string,
  req: Request,
  onChange?: (state: AppSettingsState) => void,
): Promise<Response> {
  return handleStatePatch(
    cwd,
    req,
    patchSettingsForScreen,
    "settings state too large",
    "failed to save settings state",
    MAX_STATE_PATCH_BODY_BYTES,
    onChange,
  );
}

async function handleViewGet(cwd: string): Promise<Response> {
  return jsonLoadResponse(
    () => loadViewState(cwd),
    "state",
    "failed to load view state",
  );
}

async function handleViewPatch(cwd: string, req: Request): Promise<Response> {
  return handleStatePatch(
    cwd,
    req,
    patchViewState,
    "view state too large",
    "failed to save view state",
    MAX_STATE_PATCH_BODY_BYTES,
  );
}

async function handleToolsGet(cwd: string): Promise<Response> {
  return jsonLoadResponse(
    () => loadToolsState(cwd),
    "state",
    "failed to load tools state",
  );
}

async function handleToolsPatch(cwd: string, req: Request): Promise<Response> {
  return handleStatePatch(
    cwd,
    req,
    patchToolsState,
    "tools state too large",
    "failed to save tools state",
    MAX_TOOLS_PATCH_BODY_BYTES,
  );
}

/** このプロジェクトのメインの面のタブの配置 (無ければ null)。 */
async function handleTabsGet(cwd: string): Promise<Response> {
  try {
    return json({ layout: loadProjectMainTabs(mainTabsPath(), cwd) });
  } catch (error) {
    console.error("[code-viewer] main tabs are not loaded:", error);
    return textError(
      `failed to load main tabs: ${formatErrorDetail(error)}`,
      500,
    );
  }
}

async function handleTabsPut(cwd: string, req: Request): Promise<Response> {
  const body = await parseJsonBody(req, MAX_STATE_PATCH_BODY_BYTES);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || !("layout" in body))
    return textError("main tabs body has no layout", 400);
  try {
    await saveProjectMainTabs(mainTabsPath(), cwd, body.layout);
    return json({ ok: true });
  } catch (error) {
    console.error("[code-viewer] main tabs are not saved:", error);
    return textError(
      `failed to save main tabs: ${formatErrorDetail(error)}`,
      500,
    );
  }
}

/** 画面が読めなかった保存値を上書きの前に退避する。写した先のパスを返す。 */
async function handleTabsBackup(): Promise<Response> {
  try {
    return json({ backup: await backupMainTabs(mainTabsPath()) });
  } catch (error) {
    console.error("[code-viewer] main tabs are not backed up:", error);
    return textError(
      `failed to back up main tabs: ${formatErrorDetail(error)}`,
      500,
    );
  }
}

export async function handleStateRoute(
  req: Request,
  url: URL,
  cwd: string,
  sideEffectAllowed: (req: Request) => boolean,
  options: StateRouteOptions = {},
): Promise<Response | null> {
  return dispatchRoutes(
    req,
    url,
    {
      "/_state/settings": {
        methods: ["GET", "PATCH"],
        sideEffect: (method) => method !== "GET",
        handler: () =>
          req.method === "GET"
            ? handleSettingsGet(cwd)
            : handleSettingsPatch(cwd, req, options.onSettingsChange),
      },
      "/_state/view": {
        methods: ["GET", "PATCH"],
        sideEffect: (method) => method !== "GET",
        handler: () =>
          req.method === "GET" ? handleViewGet(cwd) : handleViewPatch(cwd, req),
      },
      "/_state/tabs": {
        methods: ["GET", "PUT"],
        sideEffect: (method) => method !== "GET",
        handler: () =>
          req.method === "GET" ? handleTabsGet(cwd) : handleTabsPut(cwd, req),
      },
      "/_state/tabs/backup": {
        methods: ["POST"],
        sideEffect: () => true,
        handler: () => handleTabsBackup(),
      },
      "/_state/tools": {
        methods: ["GET", "PATCH"],
        sideEffect: (method) => method !== "GET",
        handler: () =>
          req.method === "GET"
            ? handleToolsGet(cwd)
            : handleToolsPatch(cwd, req),
      },
    },
    sideEffectAllowed,
    (res) => res,
    (err) => handleError("state", "handle state request", err),
  );
}
