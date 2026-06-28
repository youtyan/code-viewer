// リクエストスコープで adapter が発行した SQL を収集するためのユーティリティ。
// 各 adapter (sqlite の prepare wrapper / docker の execAsync) が recordSql(sql)
// を呼ぶと、現在 captureSql(...) で囲まれている context のバッファに push される。
// 並列リクエスト同士でバッファが混ざらないよう AsyncLocalStorage を使う。
//
// 設計意図: adapter の public method signature を変えずに「実行された SQL の
// echo」を可能にする。public response (DbMutateResponse / DbTableDataResponse 等)
// の executedSql フィールドはここで集めた配列をそのまま流すだけ。

import { AsyncLocalStorage } from "node:async_hooks";

type Bucket = { sqls: string[] };

const storage = new AsyncLocalStorage<Bucket>();

/** adapter 内部から呼ぶ。capture context が無い場合は無視 (副作用なし)。 */
// ai-dup-check: allow -- closeXxxAdapter(dbId: string)→void と signature だけ
// 一致するが、本体は AsyncLocalStorage バッファへの push であり共通化不可能
// (closeXxxAdapter は adapter cache の close で別ドメイン)。ユーザー承認済み。
export function recordSql(sql: string): void {
  const bucket = storage.getStore();
  if (!bucket) return;
  bucket.sqls.push(sql);
}

/** fn 実行中に recordSql で集められた SQL を取り出して返す。並列リクエスト間で
 * バッファは独立 (AsyncLocalStorage)。fn が throw した場合は throw を再送するが、
 * その時点までに集まった SQL も例外側からは取れない (= 必要なら catch 側で別途
 * 取得用 API を足す)。今は成功パスのみ取れれば十分なのでこの形で OK。 */
export async function captureSql<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; executedSql: string[] }> {
  const bucket: Bucket = { sqls: [] };
  const result = await storage.run(bucket, fn);
  return { result, executedSql: bucket.sqls };
}
