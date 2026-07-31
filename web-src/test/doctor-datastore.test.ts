import type { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type {
  DbFileInfo,
  DbFilesResponse,
  DbKind,
} from "../core/database/types";
import { __setDockerSpawnSyncForTest } from "../server/database/adapters/docker";
import {
  __clearDockerComposeContainerNameCacheForTest,
  __clearSupabaseContainerCacheForTest,
  __setDockerComposeSpawnSyncForTest,
} from "../server/database/adapters/docker-utils";
import {
  buildDatastoreRetryHint,
  checkDatastoreConnectivity,
  type DatastoreConnectivityDeps,
  DEFAULT_DATASTORE_CONNECTIVITY_DEPS,
} from "../server/doctor";

type SpawnSyncLike = typeof spawnSync;

const CWD = "/example/repo";

// helper: 中立な sample id で DbFileInfo を作る (public repo hygiene)。
function sampleFile(kind: DbKind, id: string, name?: string): DbFileInfo {
  return {
    id,
    path: id,
    name: name ?? id,
    sizeBytes: 0,
    kind,
  };
}

// success/failure/timeout 動作を制御する fake probe。
function buildFakeDeps(opts: {
  files: DbFileInfo[];
  outcomes?: Map<string, "ok" | { fail: string } | { delayMs: number }>;
  timeoutMs?: number;
  discoveryError?: string;
}): DatastoreConnectivityDeps {
  const outcomes = opts.outcomes ?? new Map();
  return {
    listSources: async (): Promise<DbFilesResponse> => {
      if (opts.discoveryError) throw new Error(opts.discoveryError);
      return { files: opts.files };
    },
    probeSource: async (file, _cwd, signal) => {
      signal.throwIfAborted();
      const outcome = outcomes.get(file.id) ?? "ok";
      if (outcome === "ok") return;
      if ("fail" in outcome) throw new Error(outcome.fail);
      // delayMs: 子 signal abort を観測したら abort error を投げる ── 実装の
      // runProbeWithTimeout は Promise.race で timeoutPromise を先に resolve
      // するので probe 自体は abort error にならず、race の結果に "timedOut"
      // フラグが乗る。defensive にここで abort 観測を実装。
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, outcome.delayMs);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new Error("aborted"));
        });
      });
    },
    timeoutMs: opts.timeoutMs ?? 2000,
  };
}

describe("buildDatastoreRetryHint", () => {
  test("SQL kinds emit a paste-safe code-viewer query schemas command without --server", () => {
    expect(buildDatastoreRetryHint(sampleFile("sqlite", "app.db"))).toBe(
      "Retry with: code-viewer query schemas --db 'app.db' --json",
    );
    expect(
      buildDatastoreRetryHint(sampleFile("postgresql", "docker:pg-svc")),
    ).toBe("Retry with: code-viewer query schemas --db 'docker:pg-svc' --json");
    expect(
      buildDatastoreRetryHint(sampleFile("mysql", "docker:mysql-svc")),
    ).toBe(
      "Retry with: code-viewer query schemas --db 'docker:mysql-svc' --json",
    );
  });

  test("SQL retry hint single-quotes ids containing spaces and embedded quotes", () => {
    // POSIX '...' の '\'' 展開で paste-safe を維持する。
    const hint = buildDatastoreRetryHint(
      sampleFile("sqlite", "sample's data.db"),
    );
    expect(hint).toBe(
      "Retry with: code-viewer query schemas --db 'sample'\\''s data.db' --json",
    );
  });

  test("Redis / Elasticsearch / S3 now emit a paste-safe read-only CLI command (no longer a browser-tab hint)", () => {
    // Each non-SQL kind has a read-only CLI surface now, so doctor should point
    // at the cheapest "is the connection alive?" introspect command for that
    // kind rather than tell the user to open a browser tab.
    expect(
      buildDatastoreRetryHint(sampleFile("redis", "docker:redis-svc")),
    ).toBe(
      "Retry with: code-viewer query redis databases --db 'docker:redis-svc' --json",
    );
    expect(
      buildDatastoreRetryHint(sampleFile("elasticsearch", "docker:es-svc")),
    ).toBe(
      "Retry with: code-viewer query elasticsearch indices --db 'docker:es-svc' --json",
    );
    expect(
      buildDatastoreRetryHint(sampleFile("s3", "docker:s3-svc/sample-bucket")),
    ).toBe(
      "Retry with: code-viewer query s3 buckets --db 'docker:s3-svc/sample-bucket' --json",
    );
  });
});

describe("defaultDatastoreProbe (Supabase CLI source)", () => {
  afterEach(() => {
    __setDockerComposeSpawnSyncForTest(null);
    __setDockerSpawnSyncForTest(null);
    __clearDockerComposeContainerNameCacheForTest();
    __clearSupabaseContainerCacheForTest();
  });

  // regression: defaultDatastoreProbe は file.kind だけで振り分けると
  // supabase: id (kind は "postgresql" 共用) が probeDockerSqlSource に
  // 落ちて "invalid docker db id" で必ず失敗する。Environment Doctor の
  // 接続チェックが Supabase ソースを常に赤くしないことを確認する。
  test("probes a supabase: source through the docker ps / docker exec path instead of docker compose ps", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-doctor-supabase-"));
    try {
      mkdirSync(join(dir, "supabase"), { recursive: true });
      writeFileSync(
        join(dir, "supabase", "config.toml"),
        'project_id = "sample_project"\n\n[db]\nport = 54322\n',
      );
      __setDockerComposeSpawnSyncForTest((() => ({
        status: 0,
        stdout: JSON.stringify([
          { Names: "supabase_db_sample_project", State: "running" },
        ]),
        stderr: "",
      })) as unknown as SpawnSyncLike);
      __setDockerSpawnSyncForTest((() => ({
        status: 0,
        stdout: "",
        stderr: "",
      })) as unknown as SpawnSyncLike);

      const controller = new AbortController();
      const file: DbFileInfo = {
        id: "supabase:sample_project",
        path: "supabase/config.toml",
        name: "sample_project (Supabase CLI, postgres@127.0.0.1:54322/postgres)",
        sizeBytes: 0,
        kind: "postgresql",
      };
      await DEFAULT_DATASTORE_CONNECTIVITY_DEPS.probeSource(
        file,
        dir,
        controller.signal,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("checkDatastoreConnectivity", () => {
  test("emits datastore.none row (status ok) when no sources are discovered", async () => {
    const group = await checkDatastoreConnectivity(
      CWD,
      [],
      undefined,
      buildFakeDeps({ files: [] }),
    );
    expect(group.id).toBe("datastore");
    expect(group.title).toBe("Datastore connectivity");
    expect(group.rows).toEqual([
      {
        id: "datastore.none",
        title: "No discovered sources",
        status: "ok",
        detail:
          "no datastore sources to probe (no SQLite files and no docker compose datastores discovered)",
      },
    ]);
  });

  test("passes omit directories through to source discovery", async () => {
    let receivedOmit: readonly string[] | undefined;
    const deps: DatastoreConnectivityDeps = {
      listSources: async (_cwd, omitDirNames): Promise<DbFilesResponse> => {
        receivedOmit = omitDirNames;
        return { files: [] };
      },
      probeSource: () => Promise.resolve(),
      timeoutMs: 2000,
    };
    await checkDatastoreConnectivity(
      CWD,
      ["node_modules", ".git"],
      undefined,
      deps,
    );
    expect(receivedOmit).toEqual(["node_modules", ".git"]);
  });

  test("emits one ok row per source when probes resolve", async () => {
    const files: DbFileInfo[] = [
      sampleFile("sqlite", "app.db"),
      sampleFile("postgresql", "docker:pg-svc"),
      sampleFile("redis", "docker:redis-svc"),
    ];
    const group = await checkDatastoreConnectivity(
      CWD,
      [],
      undefined,
      buildFakeDeps({ files }),
    );
    expect(group.id).toBe("datastore");
    expect(group.rows).toEqual([
      {
        id: "datastore.app.db",
        title: "sqlite:app.db",
        status: "ok",
        detail: "connect + minimal read succeeded (sqlite)",
      },
      {
        id: "datastore.docker:pg-svc",
        title: "postgresql:docker:pg-svc",
        status: "ok",
        detail: "connect + minimal read succeeded (postgresql)",
      },
      {
        id: "datastore.docker:redis-svc",
        title: "redis:docker:redis-svc",
        status: "ok",
        detail: "connect + minimal read succeeded (redis)",
      },
    ]);
  });

  test("emits warn + paste-safe SQL retry hint when a SQL probe fails", async () => {
    const files: DbFileInfo[] = [sampleFile("postgresql", "docker:pg-svc")];
    const group = await checkDatastoreConnectivity(
      CWD,
      [],
      undefined,
      buildFakeDeps({
        files,
        outcomes: new Map([
          ["docker:pg-svc", { fail: "ECONNREFUSED 127.0.0.1:5432" }],
        ]),
      }),
    );
    expect(group.rows).toEqual([
      {
        id: "datastore.docker:pg-svc",
        title: "postgresql:docker:pg-svc",
        status: "warn",
        detail: "probe failed: ECONNREFUSED 127.0.0.1:5432",
        hint: "Retry with: code-viewer query schemas --db 'docker:pg-svc' --json",
      },
    ]);
  });

  test("emits warn + read-only CLI hint when a non-SQL probe fails", async () => {
    const files: DbFileInfo[] = [
      sampleFile("redis", "docker:redis-svc"),
      sampleFile("elasticsearch", "docker:es-svc"),
      sampleFile("s3", "docker:s3-svc/sample-bucket"),
    ];
    const group = await checkDatastoreConnectivity(
      CWD,
      [],
      undefined,
      buildFakeDeps({
        files,
        outcomes: new Map([
          ["docker:redis-svc", { fail: "redis connection refused" }],
          ["docker:es-svc", { fail: "es cluster unreachable" }],
          ["docker:s3-svc/sample-bucket", { fail: "s3 head-bucket forbidden" }],
        ]),
      }),
    );
    for (const row of group.rows) {
      expect(row.status).toBe("warn");
      expect(typeof row.hint === "string").toBe(true);
      // non-SQL kinds still must NOT emit a SQL schemas command, but they
      // each now have their own paste-safe read-only CLI command instead of
      // a legacy browser-tab hint.
      expect(/code-viewer query schemas/.test(row.hint ?? "")).toBe(false);
      expect(/browser's Datastores tab/.test(row.hint ?? "")).toBe(false);
      expect(/^Retry with: code-viewer query /.test(row.hint ?? "")).toBe(true);
    }
  });

  test("emits warn + timed-out detail when a probe exceeds timeoutMs", async () => {
    const files: DbFileInfo[] = [sampleFile("postgresql", "docker:pg-svc")];
    const group = await checkDatastoreConnectivity(
      CWD,
      [],
      undefined,
      buildFakeDeps({
        files,
        outcomes: new Map([["docker:pg-svc", { delayMs: 200 }]]),
        timeoutMs: 30,
      }),
    );
    expect(group.rows).toHaveLength(1);
    const row = group.rows[0];
    expect(row.status).toBe("warn");
    // detail に "timed out after Xms" が含まれる (X は timeoutMs と一致)。
    expect(/^probe failed: timed out after 30ms$/.test(row.detail ?? "")).toBe(
      true,
    );
    expect(row.hint).toBe(
      "Retry with: code-viewer query schemas --db 'docker:pg-svc' --json",
    );
  });

  test("emits warn when listSources rejects, without throwing through buildDoctorReport", async () => {
    const group = await checkDatastoreConnectivity(
      CWD,
      [],
      undefined,
      buildFakeDeps({
        files: [],
        discoveryError: "docker daemon unreachable",
      }),
    );
    expect(group.rows).toEqual([
      {
        id: "datastore.discovery",
        title: "Source discovery",
        status: "warn",
        detail: "source discovery failed: docker daemon unreachable",
      },
    ]);
  });

  test("returns immediately with a warn row when parent signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const files: DbFileInfo[] = [sampleFile("sqlite", "app.db")];
    const group = await checkDatastoreConnectivity(
      CWD,
      [],
      ctrl.signal,
      buildFakeDeps({
        files,
        // 1s の遅延 probe を仕掛けるが、parent aborted の即時 short-circuit が
        // 効くので test 全体が 1s 待つことはない。
        outcomes: new Map([["app.db", { delayMs: 1000 }]]),
        timeoutMs: 5000,
      }),
    );
    expect(group.rows).toHaveLength(1);
    const row = group.rows[0];
    expect(row.status).toBe("warn");
    expect(row.detail).toBe("probe failed: parent aborted");
  });

  test("aborts in-flight probe when parent signal aborts mid-flight", async () => {
    const ctrl = new AbortController();
    const files: DbFileInfo[] = [sampleFile("sqlite", "app.db")];
    const promise = checkDatastoreConnectivity(
      CWD,
      [],
      ctrl.signal,
      buildFakeDeps({
        files,
        outcomes: new Map([["app.db", { delayMs: 5000 }]]),
        timeoutMs: 60_000,
      }),
    );
    // 次イベントループで parent abort → fake probe 内の signal listener が
    // reject → row は warn。
    setTimeout(() => ctrl.abort(), 10);
    const group = await promise;
    expect(group.rows).toHaveLength(1);
    const row = group.rows[0];
    expect(row.status).toBe("warn");
    expect(/^probe failed: aborted$/.test(row.detail ?? "")).toBe(true);
  });
});
