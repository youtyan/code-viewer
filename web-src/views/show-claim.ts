// `code-viewer show` の出来事を、どの窓が開くかを決める。
//
// 同じプロジェクトを映している画面 (面・別の窓) は全部が同じ `show` を受け取るので、
// そのままだと開く数だけタブが増える。出来事の id を、同じオリジンの全部の文脈で
// 1 つずつしか取れない鍵 (Web Locks) の中で覚え、最初に取った画面だけが開く。

/** 覚えておく id の数 (最近の分だけ。localStorage を増やし続けない)。 */
const KEPT_IDS = 20;
const STORAGE_KEY = "code-viewer-show-claimed";
const LOCK_NAME = "code-viewer-show";

/**
 * この画面が開いてよいか。Web Locks が無いブラウザでは決められないので、どの
 * 画面も開く (重なることはあるが、開かないよりよい)。保存領域が使えなければ
 * 理由つきで投げる (呼び出し側が console に出す)。
 */
export async function claimShow(id: string): Promise<boolean> {
  if (!("locks" in navigator)) return true;
  return navigator.locks.request(LOCK_NAME, () => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const seen: unknown = raw ? JSON.parse(raw) : [];
    const ids = Array.isArray(seen)
      ? seen.filter((item): item is string => typeof item === "string")
      : [];
    if (ids.includes(id)) return false;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([id, ...ids].slice(0, KEPT_IDS)),
    );
    return true;
  });
}
