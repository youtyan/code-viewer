// アイドル停止 (entry/backends.ts の stopIdle) は、止めている間の記録を
// `stopping` にし、同じ間に来た要求 (target・acquire・restart) を待たせる。
// 止めるのに失敗すると記録は running に戻る (裏は動いたまま)。待っていた要求
// には失敗を投げず、動いている裏で答える。投げると、入口の handleProjectPath
// では理由の無い 500 になり、画面の読み込みで先に起こす target では拾われない
// reject として入口ごと終わっていた。失敗は止める周期の側 (stopIdleBackends)
// だけが出す。

import { describe, expect, test } from "vitest";
import {
  createEntryBackends,
  type EntryBackendsDeps,
} from "../server/entry/backends";

const ROOT = "/work/sample-app";
const IDLE_MS = 600_000;

function backendsWithFailingStop() {
  const clock = { now: 1_000_000 };
  const stopping: { fail?: (error: Error) => void } = {};
  let port = 65000;
  const deps: EntryBackendsDeps = {
    entryPid: 4242,
    entryToken: "0123456789abcdef",
    controller: {
      openWorktreeServer: async () => {
        port += 1;
        return {
          status: "ok",
          url: `http://127.0.0.1:${port}/`,
          started: true,
        };
      },
      runningServerResult: async () => ({ status: "absent" }),
      stopWorktreeServer: () =>
        new Promise<void>((_resolve, reject) => {
          stopping.fail = reject;
        }),
    },
    logFile: () => "/state/server-logs/sample.log",
    logTail: () => "server output: sample tail",
    registryEntry: () => ({ status: "found", pid: 777, backend: true }),
    serverArgs: () => [],
    idleStopMs: IDLE_MS,
    now: () => clock.now,
    log: () => undefined,
  };
  return { b: createEntryBackends(deps), clock, stopping };
}

describe("a request that waits for an idle stop that fails", () => {
  test.each([
    {
      name: "取り次ぐ要求 (acquire)",
      call: (b: ReturnType<typeof createEntryBackends>) =>
        b.acquire(ROOT).then((acquired) => acquired.target),
    },
    {
      name: "開く (target)",
      call: (b: ReturnType<typeof createEntryBackends>) => b.target(ROOT),
    },
    {
      name: "画面の再起動 (restart)",
      call: (b: ReturnType<typeof createEntryBackends>) => b.restart(ROOT),
    },
  ])("$name: 止められなかった停止を待った要求は、動いたままの裏で ok になる", async ({
    call,
  }) => {
    const { b, clock, stopping } = backendsWithFailingStop();
    await b.target(ROOT);
    clock.now += IDLE_MS;
    const sweep = b
      .stopIdleBackends()
      .then(() => null)
      .catch((error: unknown) => error);
    const waiting = call(b)
      .then((target) => ({ target }))
      .catch((error: unknown) => ({ error }));
    stopping.fail?.(new Error("sample: kill failed"));

    // 止める周期の失敗は周期の側に出る (これは今のまま)。
    expect(await sweep).toBeInstanceOf(Error);
    expect(b.state(ROOT)).toBe("running");
    // 待っていた要求は、動いている裏で答えられる。
    expect(await waiting).toMatchObject({ target: { status: "ok" } });
  });
});
