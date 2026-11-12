// 巡回するサーバがエージェントについて覚えておくファイル (会話の場所・未読と
// 変わった時刻) の、書き方と失敗の持ち方。どちらも同じ約束で書く:
// - ロックの中で読み直し、読めたときだけ置き換える (読めない保存は上書きしない)
// - 失敗は console と一覧の errors (操作ごとに最新の 1 件) に出す

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentStateObservationError } from "../../core/agent-state";
import { formatErrorDetail } from "../../core/error-detail";
import { withFileLock } from "../file-lock";
import type { RegistryFileRead } from "../registry-file";
import { writeFileAtomic } from "./settings-file";

/** ロックの中で読み直し、読めれば置き換える。what は読めないときの文の主語。 */
export async function writeSavedStore(
  path: string,
  text: string,
  read: (path: string) => RegistryFileRead<unknown>,
  what: string,
): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await withFileLock(`${path}.lock`, () => {
    const current = read(path);
    if (current.ok === false) {
      throw new Error(
        `${what} cannot be read, so they were not overwritten (remove the file to start over).\n${current.error}`,
      );
    }
    writeFileAtomic(path, text, 0o600);
  });
}

type StoreOperation = AgentStateObservationError["operation"];

/** 保存と読み戻しの失敗 (操作ごとに最新の 1 件)。 */
export function createSavedStoreErrors<Op extends StoreOperation>(options: {
  /** console の文: `could not <restore|save> <what>` */
  what: string;
  restore: Op;
  save: Op;
  path: () => string;
}) {
  const errors = new Map<Op, AgentStateObservationError>();
  return {
    set(operation: Op, cause: unknown): void {
      console.error(
        `[code-viewer] ${operation === options.restore ? "could not restore" : "could not save"} ${options.what}`,
        cause,
      );
      errors.set(operation, {
        operation,
        target: options.path(),
        at: Date.now(),
        detail: formatErrorDetail(cause),
        stack: cause instanceof Error ? (cause.stack ?? "") : "",
      });
    },
    delete(operation: Op): void {
      errors.delete(operation);
    },
    list(): AgentStateObservationError[] {
      return [...errors.values()].map((error) => ({ ...error }));
    },
    clear(): void {
      errors.clear();
    },
  };
}
