// 窓ごとの面の並びとタブの保存 (server/main-tabs-store.ts の /_state/workspace)。
// 書くのはこの窓の外側のページ (host) か、1 枚の画面 (single) だけ (面は host へ送る)。
//
// 窓の id は sessionStorage に持つ (読み直しても同じ窓)。ブラウザの「タブを複製」は
// sessionStorage ごと写すので、同じ id の窓が 2 つになる。BroadcastChannel で名乗り
// 合い、後から来た窓は新しい id に替える (同じ保存を 2 つの窓で書き合わない)。

import { errorWithCause, responseErrorMessage } from "../../core/error-detail";
import type { SerializedLayout } from "../../core/main-tabs";
import {
  migrateLayout,
  parseWorkspace,
  singlePane,
  type Workspace,
} from "../../core/workspace";

const WINDOW_ID_KEY = "code-viewer:window-id";
const WINDOWS_CHANNEL = "code-viewer:windows";
/** 書きを束ねる間 (面の URL は画面を移るたびに変わる)。 */
const SAVE_DELAY_MS = 400;

export type WorkspaceStoreDeps = {
  /** 保存の入口 (apiUrl("stateWorkspace") と apiUrl("stateWorkspaceBackup"))。 */
  url: string;
  backupUrl: string;
  /** 書く要求の印 (actionHeaders)。 */
  headers(): HeadersInit;
  /** 読み込みの通信を数える (trackLoad)。 */
  trackLoad<T>(promise: Promise<T>): Promise<T>;
};

export type LoadedWorkspace = {
  /** この裏の根 (タブの持ち物のプロジェクト)。 */
  root: string;
  workspace: Workspace;
  /** このアプリより新しい版が書いた保存 (書かない)。 */
  newer: number | null;
};

export type WorkspaceStore = {
  windowId(): string;
  /**
   * この窓の面の並びとタブ。保存が無ければ面 1 つ (url はこの窓の URL)。前の版の
   * 配置なら面の木へ移す (左の面はこの窓の URL、右の面は homeUrl)。
   */
  load(currentUrl: string, homeUrl: string): Promise<LoadedWorkspace>;
  /** 書く (少し束ねる)。keepalive は窓を離れるとき。 */
  save(workspace: Workspace): void;
  flush(keepalive: boolean): void;
  /** 読めなかった保存を上書きの前に写す。写した先を返す。 */
  backup(): Promise<string>;
};

export function createWorkspaceStore(deps: WorkspaceStoreDeps): WorkspaceStore {
  let id = readWindowId();
  let newer: number | null = null;
  // 名乗り: 同じ id の窓がもう居れば (複製したタブ)、こちらが新しい id に替える。
  const nonce = crypto.randomUUID();
  const channel = new BroadcastChannel(WINDOWS_CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    if (!("type" in data) || !("id" in data) || !("nonce" in data)) return;
    if (data.id !== id || data.nonce === nonce) return;
    if (data.type === "claim")
      channel.postMessage({ type: "taken", id, nonce: data.nonce });
    else if (data.type === "taken" && data.nonce === nonce) {
      id = newWindowId();
      if (pending) scheduleSave();
    }
  };
  channel.postMessage({ type: "claim", id, nonce });

  let pending: Workspace | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;

  function scheduleSave(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => flush(false), SAVE_DELAY_MS);
  }

  function flush(keepalive: boolean): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending || newer !== null) return;
    if (saving && !keepalive) {
      scheduleSave();
      return;
    }
    const workspace = pending;
    pending = null;
    saving = true;
    void put(workspace, keepalive)
      .catch((error: unknown) => {
        console.error(
          errorWithCause(`save the workspace of window ${id}`, error),
        );
      })
      .finally(() => {
        saving = false;
      });
  }

  async function put(workspace: Workspace, keepalive: boolean): Promise<void> {
    const response = await fetch(deps.url, {
      method: "PUT",
      keepalive,
      headers: {
        ...headerRecord(deps.headers()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ window: id, workspace }),
    });
    if (!response.ok)
      throw new Error(
        await responseErrorMessage(response, "save the workspace"),
      );
  }

  return {
    windowId: () => id,
    async load(currentUrl, homeUrl) {
      const url = `${deps.url}?window=${encodeURIComponent(id)}`;
      const response = await deps.trackLoad(fetch(url));
      if (!response.ok)
        throw new Error(
          await responseErrorMessage(response, "load the workspace"),
        );
      const body = (await response.json()) as {
        root: string;
        workspace: unknown;
        legacy?: SerializedLayout;
        newer?: number;
        migration?: unknown;
      };
      newer = body.newer ?? null;
      if (body.migration !== undefined)
        console.info(
          "[code-viewer] main tabs: the per-project tabs were moved into one set of tabs:",
          JSON.stringify(body.migration),
        );
      let workspace: Workspace;
      if (body.workspace !== null) workspace = parseWorkspace(body.workspace);
      else if (body.legacy !== undefined)
        workspace = migrateLayout(body.legacy, currentUrl, homeUrl);
      else workspace = singlePane("p1", currentUrl);
      return { root: body.root, workspace, newer };
    },
    save(workspace) {
      pending = workspace;
      scheduleSave();
    },
    flush,
    backup: () => backupSavedTabs(deps.backupUrl, deps.headers()),
  };
}

function readWindowId(): string {
  return window.sessionStorage.getItem(WINDOW_ID_KEY) ?? newWindowId();
}

function newWindowId(): string {
  const id = `w-${crypto.randomUUID()}`;
  window.sessionStorage.setItem(WINDOW_ID_KEY, id);
  return id;
}

/** 読めなかった保存を上書きの前に写す (面からも呼ぶ)。写した先を返す。 */
export async function backupSavedTabs(
  url: string,
  headers: HeadersInit,
): Promise<string> {
  const response = await fetch(url, { method: "POST", headers });
  if (!response.ok)
    throw new Error(
      await responseErrorMessage(response, "back up the saved main tabs"),
    );
  const body = (await response.json()) as { backup?: unknown };
  if (typeof body.backup !== "string")
    throw new Error(
      `back up the saved main tabs: the answer has no backup path: ${JSON.stringify(body)}`,
    );
  return body.backup;
}

function headerRecord(headers: HeadersInit): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}
