// 「完了を読んだ」を、ほかの code-viewer サーバにも伝える。
//
// 完了 (done) はフックの申告で全部のサーバに届くが、読んだことは画面を
// 開いているサーバにしか届かない。そのままだと、別のプロジェクトのサーバでは
// 完了・未読が残り、プロジェクトを移ると未読がよみがえって見える。フックの
// 申告 (hook-report.ts) と同じく、登録簿の全部のサーバへ送る。
//
// 入口のサーバ自身は中継しない (状態を持つのが入口だけなので)。ここを使うのは
// 1 つで完結するサーバで、送り先は入口と、登録簿のうち入口の裏のプロセスでも
// token も版も無い古い形でもないもの (hook-report.ts の reportTargets)。
//
// 送り先では送り直さない (relay の印を付けない)。ほかのサーバに届かなくても
// 自分の記録は済んでいる。届かなかった理由は全部返し、画面に出す。

import { formatErrorDetail } from "../../core/error-detail";
import { type EntryRecord, liveEntryRecord } from "../entry/entry-file";
import {
  listServerRegistry,
  type ServerRegistryListing,
} from "../server-registry";
import {
  connectionRefused,
  postToServer,
  REPORT_TIMEOUT_MS,
  reportTargets,
} from "./hook-report";

export type ReadRelayDeps = {
  /** このサーバのプロセス。自分には送らない。 */
  selfPid: number;
  listServers(): ServerRegistryListing;
  /** 動いている入口の記録。無ければ null。読めなければ投げる。 */
  entryRecord(): EntryRecord | null;
  post(url: string, body: unknown, signal: AbortSignal): Promise<Response>;
};

export type ReadRelayResult = {
  /** 届いたサーバの数。 */
  reached: number;
  /** 届かなかった理由 (サーバごと、全文)。 */
  failures: string[];
};

export async function relayAgentRead(
  target: string,
  at: number,
  deps: ReadRelayDeps = {
    selfPid: process.pid,
    listServers: listServerRegistry,
    entryRecord: () => liveEntryRecord(),
    post: postToServer,
  },
): Promise<ReadRelayResult> {
  const failures: string[] = [];
  let listing: ServerRegistryListing;
  try {
    listing = deps.listServers();
  } catch (error) {
    return {
      reached: 0,
      failures: [`server registry: ${formatErrorDetail(error)}`],
    };
  }
  for (const broken of listing.errors) {
    failures.push(`${broken.file}: ${formatErrorDetail(broken.error)}`);
  }
  let entry: EntryRecord | null = null;
  try {
    entry = deps.entryRecord();
  } catch (error) {
    failures.push(`entry server record: ${formatErrorDetail(error)}`);
  }
  const self = new Set(
    listing.servers
      .filter((server) => server.pid === deps.selfPid)
      .map((server) => server.url.replace(/\/+$/, "")),
  );
  let reached = 0;
  await Promise.all(
    reportTargets(listing, entry)
      .map((reportTarget) => reportTarget.url)
      .filter((base) => !self.has(base))
      .map(async (base) => {
        const url = `${base}/_agent/state`;
        try {
          const res = await deps.post(
            url,
            { target, event: "read", at },
            AbortSignal.timeout(REPORT_TIMEOUT_MS),
          );
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${await res.text()}`);
          }
          reached += 1;
        } catch (error) {
          if (connectionRefused(error)) return;
          failures.push(`${url}: ${formatErrorDetail(error)}`);
        }
      }),
  );
  return { reached, failures: failures.sort() };
}
