// 生きた知らせ (views/shell/live-hub.ts) の差し替え。端末やペインのテストは流しを
// 偽の EventSource にして画面を描く。本物の live-hub はチャンネルを 1 本の /_live に
// 相乗りさせるので、テストでは openLiveSource を「チャンネルごとに今の偽の
// EventSource を 1 つ作る」形に差し替える。偽物の url は spec の JSON。
//
//   vi.mock("../views/shell/live-hub", () => import("./_fake-live"));

import type { LiveSpec } from "../core/live";
import type { LiveSource } from "../views/shell/live-hub";

export type { LiveSource };

export function openLiveSource(spec: LiveSpec): LiveSource {
  return new EventSource(JSON.stringify(spec));
}
