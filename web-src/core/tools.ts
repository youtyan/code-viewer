// tools オーバーレイに載る単発ツールの identity。URL (?tools=…)、
// tools.json の永続化、タブの表示順が同じ 1 つの並びを参照するように、
// クライアント / サーバ双方から import できる core に置く。

/** tools オーバーレイに載っている単発ツールの識別子。 */
export type ToolId = "markdown" | "mermaid" | "json";

/** タブの表示順でもある。ツールを増やすときはここに足す。 */
export const TOOL_IDS = [
  "markdown",
  "mermaid",
  "json",
] as const satisfies readonly ToolId[];

export const DEFAULT_TOOL_ID: ToolId = "markdown";

/** ドロワー幅 (px) の許容範囲。サーバ側の sanitize とクライアント側のドラッグ
 * クランプが同じ値を見るように core に置く。上限はワイドディスプレイでほぼ
 * 全面まで広げられる程度。 */
export const MIN_TOOLS_SHEET_WIDTH = 480;
export const MAX_TOOLS_SHEET_WIDTH = 4000;

export function isToolId(value: unknown): value is ToolId {
  return TOOL_IDS.includes(value as ToolId);
}
