import type { RawFileInfo } from "./types";

// blob / blame ビューの SSE 再描画ゲート用。HEAD /_file のメタデータを
// 変更検知の署名へ落とす。404 (missing) はファイル削除という確定状態なので
// 署名になる。全フィールド欠落は「取得失敗 / 中断」であり署名にしない
// (呼び出し側は判定不能として画面に触れず、次の通知で再検証する)。
export function rawFileInfoSignature(info: RawFileInfo): string | null {
  if (info.missing) return "missing";
  if (info.size == null && !info.updated_at && !info.commit_updated_at)
    return null;
  return `${info.size ?? ""}|${info.updated_at ?? ""}|${info.commit_updated_at ?? ""}`;
}

// 直前に見えていた署名と完全一致したときだけ「変化なし」。キーが違う
// (別ファイル / 別ビュー / 別 ref) ・未観測のときは変化ありとして扱う。
export function fileSignatureUnchanged(
  stored: { key: string; sig: string } | null,
  key: string,
  sig: string,
): boolean {
  return stored !== null && stored.key === key && stored.sig === sig;
}
