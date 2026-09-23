// 裏を起こす仕組み (worktree/open.ts) は根を realpath してから登録簿の鍵に
// する (registryKey)。裏も実パスで自分を登録する。ところが入口の
// backends.finishStart は、起き終わった裏を登録簿で確かめるとき、受け取った
// 根をそのまま readServerRegistry に渡していた (defaultEntryBackendsDeps の
// registryEntry)。根が実パスでない (登録簿 projects.json の根が、後から
// シンボリックリンクに置き換わった場所を指す、など) と、裏は起きて登録
// しているのに「started but did not register itself」の 503 になり、その後の
// 要求も全部同じ 503 になった (起きた裏は動いたまま残る)。いまは同じ
// registryKey で引く。
//
// ここでは起こす部分だけを偽物にし (裏が実パスで登録したのと同じ状態を
// 登録簿に書く)、登録簿の読み取りは本物 (defaultEntryBackendsDeps) を使う。
// 登録簿の置き場所は CODE_VIEWER_TEST_SERVER_REGISTRY_DIR (テストの隔離) に従う。

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  createEntryBackends,
  defaultEntryBackendsDeps,
} from "../server/entry/backends";
import {
  removeServerRegistry,
  writeServerRegistry,
} from "../server/server-registry";

describe("a project root that is not its real path", () => {
  test("実パスで登録した裏に、シンボリックリンクの根からも取り次げる (ok)", async () => {
    const base = realpathSync(
      mkdtempSync(join(tmpdir(), "cv-adversarial-root-")),
    );
    const real = join(base, "sample-app");
    const linked = join(base, "sample-app-link");
    mkdirSync(real);
    symlinkSync(real, linked);
    const url = "http://127.0.0.1:65001/";
    // 裏は自分の実パスで登録する (preview.ts と同じ形)。
    writeServerRegistry({
      url,
      pid: process.pid,
      root: real,
      started_at: new Date(0).toISOString(),
      token: "0123456789abcdef",
      version: "0.0.0-sample",
      backend: true,
    });
    try {
      const deps = defaultEntryBackendsDeps(
        4242,
        "0123456789abcdef",
        () => [],
        0,
      );
      const backends = createEntryBackends({
        ...deps,
        controller: {
          // 本物と同じく、実パスの鍵で動いている裏を見つけて使い回す。
          openWorktreeServer: async () => ({
            status: "ok",
            url,
            started: false,
          }),
          runningServerResult: async () => ({ status: "absent" }),
          stopWorktreeServer: async () => undefined,
        },
        logTail: () => "",
      });

      const target = await backends.target(linked);

      expect(target).toMatchObject({ status: "ok", url, pid: process.pid });
    } finally {
      removeServerRegistry(real, process.pid);
    }
  });
});
