// `code-viewer show` (AI が利用者の画面にファイル・差分を開く) の形と検査。
// CLI・サーバ・画面が同じものを見るように core に置く。
//
// 開くのは利用者に頼まれたときだけ (配布スキル・agent-help に書く)。画面は
// いま見ているタブを変えず、新しいタブで開く。

/** 何で開くか。file = ファイルの画面、diff = 差分の画面のそのファイル。 */
export type ShowView = "file" | "diff";

export type ShowRequest = {
  /** リポジトリの根からの相対パス。 */
  path: string;
  /** 行 (1 始まり)。 */
  line?: number;
  view: ShowView;
};

/** 画面へ流す出来事 (プロジェクトの通知の `show`)。id で 1 つの窓だけが開く。 */
export type ShowEvent = ShowRequest & { id: string };

/** `src/app.ts:12` を、パスと行に分ける。行の無いもの・0 以下の行はパスのまま。 */
export function parseShowTarget(value: string): {
  path: string;
  line?: number;
} {
  const match = /^(.*):(\d+)$/.exec(value);
  if (!match) return { path: value };
  const line = Number(match[2]);
  return line > 0 && Number.isSafeInteger(line)
    ? { path: match[1] ?? "", line }
    : { path: value };
}

/** 外から来た値が ShowRequest の形か (サーバの本文・画面の出来事)。 */
export function isShowRequest(value: unknown): value is ShowRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.path === "string" &&
    item.path.length > 0 &&
    (item.line === undefined ||
      (typeof item.line === "number" &&
        Number.isSafeInteger(item.line) &&
        item.line > 0)) &&
    (item.view === "file" || item.view === "diff")
  );
}

export function isShowEvent(value: unknown): value is ShowEvent {
  if (!isShowRequest(value)) return false;
  const id: unknown = (value as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0;
}
