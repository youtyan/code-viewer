import type { AppSettingsState } from "../core/types";
import {
  dispatchRoutes,
  handleError,
  json,
  jsonLoadResponse,
  parseBoundedJsonBody,
  textError,
} from "./database/handle-shared";
import {
  loadAppSettingsState,
  loadToolsState,
  loadViewState,
  patchAppSettingsState,
  patchToolsState,
  patchViewState,
} from "./state-store";

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
    return textError(saveFailedMessage, 500);
  }
}

async function handleSettingsGet(cwd: string): Promise<Response> {
  return jsonLoadResponse(
    () => loadAppSettingsState(cwd),
    "state",
    "failed to load settings state",
  );
}

async function handleSettingsPatch(
  cwd: string,
  req: Request,
  onChange?: (state: AppSettingsState) => void,
): Promise<Response> {
  return handleStatePatch(
    cwd,
    req,
    patchAppSettingsState,
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
