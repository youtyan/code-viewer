// 起動の直後に、起動したペインが失敗して終わっていないかを確かめる係。
//
// 起動したウィンドウには remain-on-exit failed が付いている (server/accounts/
// launch.ts) ので、起動コマンドの打ち間違い・PATH の違い・ログイン切れで
// すぐ終わったペインは残り、終了コードと画面の最後の行が読める。開いた
// ターミナルのタブには tmux の「Pane is dead」しか出ないことがあるので、
// LAUNCH_FAILURE_CHECK_MS の後に 1 度だけサーバに聞き、終わっていたら
// onFailed で知らせる (画面は確認のダイアログと「ウインドウを開く」)。
//
// 取り直しの周期に乗らない 1 回きりの読み取りなので、画面の切替で止めない
// (BACKGROUND_REQUEST_HEADER)。読めなかったときは理由を onError に渡す。

import {
  LAUNCH_FAILURE_CHECK_MS,
  type LaunchedPaneStatus,
} from "../../core/agent-accounts";
import { apiUrl } from "../../core/api-url";
import { responseErrorMessage } from "../../core/error-detail";
import { BACKGROUND_REQUEST_HEADER } from "../../core/network-activity";

export type LaunchFailure = Extract<LaunchedPaneStatus, { kind: "exited" }>;

export type LaunchFailureWatchDeps = {
  onFailed(pane: string, failure: LaunchFailure): void;
  onError(pane: string, error: unknown): void;
  /** テスト用の差し替え。既定はサーバに聞く。 */
  readStatus?: (pane: string) => Promise<LaunchedPaneStatus>;
  delayMs?: number;
};

export type LaunchFailureWatch = {
  /** 起動したペインを 1 度だけ確かめる。同じペインを重ねて頼んでも 1 回。 */
  watch(pane: string): void;
  dispose(): void;
};

async function readLaunchedPaneStatus(
  pane: string,
): Promise<LaunchedPaneStatus> {
  const res = await fetch(
    `${apiUrl("agentLaunchStatus")}?${new URLSearchParams({ pane })}`,
    { headers: { [BACKGROUND_REQUEST_HEADER]: "1" } },
  );
  if (!res.ok) {
    throw new Error(
      await responseErrorMessage(res, `read the launched pane ${pane}`),
    );
  }
  return (await res.json()) as LaunchedPaneStatus;
}

export function createLaunchFailureWatch(
  deps: LaunchFailureWatchDeps,
): LaunchFailureWatch {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const read = deps.readStatus ?? readLaunchedPaneStatus;
  return {
    watch(pane) {
      if (timers.has(pane)) return;
      timers.set(
        pane,
        setTimeout(() => {
          timers.delete(pane);
          read(pane).then(
            (status) => {
              if (status.kind === "exited") deps.onFailed(pane, status);
            },
            (error: unknown) => deps.onError(pane, error),
          );
        }, deps.delayMs ?? LAUNCH_FAILURE_CHECK_MS),
      );
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
