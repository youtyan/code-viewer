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
  loadViewState,
  patchAppSettingsState,
  patchViewState,
} from "./state-store";

const MAX_STATE_PATCH_BODY_BYTES = 1_000_000;

export type StateRouteOptions = {
  onSettingsChange?: (state: AppSettingsState) => void;
};

async function parseJsonBody(req: Request): Promise<unknown | Response> {
  return parseBoundedJsonBody(
    req,
    MAX_STATE_PATCH_BODY_BYTES,
    "state body too large",
  );
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
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  try {
    const next = await patchAppSettingsState(cwd, body);
    if (onChange) {
      try {
        onChange(next);
      } catch (notifyErr) {
        console.warn("[code-viewer] settings change notify failed:", notifyErr);
      }
    }
    return json(next);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "settings state too large") return textError(message, 413);
    console.error("[code-viewer] state error:", err);
    return textError("failed to save settings state", 500);
  }
}

async function handleViewGet(cwd: string): Promise<Response> {
  return jsonLoadResponse(
    () => loadViewState(cwd),
    "state",
    "failed to load view state",
  );
}

async function handleViewPatch(cwd: string, req: Request): Promise<Response> {
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  try {
    return json(await patchViewState(cwd, body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "view state too large") return textError(message, 413);
    console.error("[code-viewer] state error:", err);
    return textError("failed to save view state", 500);
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
    },
    sideEffectAllowed,
    (res) => res,
    (err) => handleError("state", "handle state request", err),
  );
}
