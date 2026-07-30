import { describe, expect, test } from "bun:test";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  startWatchSupervisor,
  type WatchSupervisorOptions,
} from "../server/watch-supervisor";

class FakeStream extends EventEmitter {
  setEncoding(): void {
    /* the fake delivers strings already; encoding is irrelevant */
  }
}

// Stands in for a watcher child. The important trait it models is that a child
// wedged in libuv's FSEvents close never exits and never answers a signal, so
// the parent must not depend on either.
class FakeChild extends EventEmitter {
  stdinWrites: string[] = [];
  signals: string[] = [];
  stdout = new FakeStream();
  stderr = new FakeStream();
  stdin = {
    write: (data: string) => {
      this.stdinWrites.push(data);
      return true;
    },
  };

  kill(signal?: string): boolean {
    this.signals.push(signal ?? "SIGTERM");
    return true;
  }

  emitMessage(message: unknown): void {
    this.stdout.emit("data", `${JSON.stringify(message)}\n`);
  }

  emitRaw(chunk: string): void {
    this.stdout.emit("data", chunk);
  }
}

type FakeTimer = { fn: () => void; at: number; every?: number };

function makeClock(startMs = 1_000) {
  let nowMs = startMs;
  let nextId = 1;
  const timers = new Map<number, FakeTimer>();
  const makeHandle = (id: number) => ({ id, unref: () => undefined });
  return {
    now: () => nowMs,
    setTimeout: ((fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fn, at: nowMs + ms });
      return makeHandle(id);
    }) as unknown as typeof setTimeout,
    setInterval: ((fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fn, at: nowMs + ms, every: ms });
      return makeHandle(id);
    }) as unknown as typeof setInterval,
    clearInterval: ((handle: { id: number } | undefined) => {
      if (handle) timers.delete(handle.id);
    }) as unknown as typeof clearInterval,
    advance(ms: number) {
      const target = nowMs + ms;
      for (;;) {
        let due: [number, FakeTimer] | null = null;
        for (const entry of timers) {
          if (entry[1].at > target) continue;
          if (!due || entry[1].at < due[1].at) due = entry;
        }
        if (!due) break;
        nowMs = due[1].at;
        if (due[1].every === undefined) timers.delete(due[0]);
        else due[1].at = nowMs + due[1].every;
        due[1].fn();
      }
      nowMs = target;
    },
  };
}

const HEARTBEAT_MS = 1_000;

function startWithFakes(overrides: Partial<WatchSupervisorOptions> = {}) {
  const clock = makeClock();
  const children: FakeChild[] = [];
  const updates: Array<string[] | undefined> = [];
  const errors: string[] = [];
  let pollOnlyNotices = 0;

  const supervisor = startWatchSupervisor({
    root: "/tmp/sample-root",
    omitDirNames: ["node_modules"],
    excludeNames: [],
    maxWatchedDirectories: 1024,
    heartbeatIntervalMs: HEARTBEAT_MS,
    command: ["fake-exec", "fake-entry", "watch-child"],
    spawnFn: (() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    }) as unknown as typeof spawn,
    nowFn: clock.now,
    setTimeoutFn: clock.setTimeout,
    setIntervalFn: clock.setInterval,
    clearIntervalFn: clock.clearInterval,
    onUpdate: (paths) => updates.push(paths),
    onError: (error) =>
      errors.push(error instanceof Error ? error.message : String(error)),
    onPollOnly: () => {
      pollOnlyNotices++;
    },
    ...overrides,
  });

  const ready = (child: FakeChild) =>
    child.emitMessage({ type: "ready", watching: true, pollOnly: false });

  return {
    supervisor,
    clock,
    children,
    updates,
    errors,
    ready,
    pollOnlyNotices: () => pollOnlyNotices,
  };
}

describe("watch supervisor: 通知の受け渡し", () => {
  test("起動時に設定を子の stdin へ渡す", () => {
    const { supervisor, children } = startWithFakes();
    expect(children).toHaveLength(1);
    const config = JSON.parse(children[0].stdinWrites[0]);
    expect(config.root).toBe("/tmp/sample-root");
    expect(config.omitDirNames).toEqual(["node_modules"]);
    expect(config.pollOnly).toBe(false);
    supervisor.close();
  });

  test.each([
    {
      name: "パス付き update はそのまま渡す",
      message: { type: "update", paths: ["src/a.ts", "src/b.ts"] },
      expected: [["src/a.ts", "src/b.ts"]],
    },
    {
      name: "パスなし update は undefined として渡す（変更箇所不明）",
      message: { type: "update" },
      expected: [undefined],
    },
  ])("$name", ({ message, expected }) => {
    const { supervisor, children, ready, updates } = startWithFakes();
    ready(children[0]);
    children[0].emitMessage(message);
    expect(updates).toEqual(expected);
    supervisor.close();
  });

  test("複数行が1チャンクで届いても分割して処理する", () => {
    const { supervisor, children, updates } = startWithFakes();
    children[0].emitRaw(
      '{"type":"update","paths":["a.ts"]}\n{"type":"update","paths":["b.ts"]}\n',
    );
    expect(updates).toEqual([["a.ts"], ["b.ts"]]);
    supervisor.close();
  });

  test("行が途中で切れても次のチャンクと連結して処理する", () => {
    const { supervisor, children, updates } = startWithFakes();
    children[0].emitRaw('{"type":"update","pat');
    expect(updates).toEqual([]);
    children[0].emitRaw('hs":["a.ts"]}\n');
    expect(updates).toEqual([["a.ts"]]);
    supervisor.close();
  });

  test("壊れた行は無視し、子を落とさない", () => {
    const { supervisor, children, updates } = startWithFakes();
    children[0].emitRaw("not json at all\n");
    children[0].emitMessage({ type: "update", paths: ["a.ts"] });
    expect(updates).toEqual([["a.ts"]]);
    expect(children).toHaveLength(1);
    supervisor.close();
  });
});

describe("watch supervisor: 故障からの復帰", () => {
  test("heartbeat が途絶えた子を差し替える", () => {
    const { supervisor, clock, children, ready, errors } = startWithFakes();
    ready(children[0]);
    // 2回分の欠落では差し替えない（大きなworktreeのpollで揺れるため）
    clock.advance(HEARTBEAT_MS * 2);
    expect(children).toHaveLength(1);
    // 3回分で失われたと判定する
    clock.advance(HEARTBEAT_MS * 2);
    expect(children).toHaveLength(2);
    expect(children[0].signals).toEqual(["SIGTERM"]);
    expect(errors).toEqual(["watch child stopped reporting; restarting"]);
    supervisor.close();
  });

  test("heartbeat が届き続ける限り子を差し替えない", () => {
    const { supervisor, clock, children, ready } = startWithFakes();
    ready(children[0]);
    for (let i = 0; i < 10; i++) {
      clock.advance(HEARTBEAT_MS);
      children[0].emitMessage({ type: "heartbeat" });
    }
    expect(children).toHaveLength(1);
    supervisor.close();
  });

  // これが今回の障害そのもの。close() が libuv のセマフォで固まった子は
  // SIGTERM でも exit せず、終了通知も返さない。それでも新しい子が動くこと。
  test("SIGTERM に応答せず exit もしない子でも代替の子が動き出す", () => {
    const { supervisor, clock, children, ready, updates } = startWithFakes();
    ready(children[0]);
    clock.advance(HEARTBEAT_MS * 4);
    expect(children).toHaveLength(2);

    // 固まった子は exit イベントを出さないまま。新しい子の通知が届くこと。
    ready(children[1]);
    children[1].emitMessage({ type: "update", paths: ["src/after.ts"] });
    expect(updates).toEqual([["src/after.ts"]]);

    // 固まった子からの遅れた通知は無視される（差し替え時にlistenerを外す）
    children[0].emitMessage({ type: "update", paths: ["src/stale.ts"] });
    expect(updates).toEqual([["src/after.ts"]]);
    supervisor.close();
  });

  test("SIGTERM の猶予を過ぎたら SIGKILL を送る", () => {
    const { supervisor, clock, children, ready } = startWithFakes();
    ready(children[0]);
    clock.advance(HEARTBEAT_MS * 4);
    expect(children[0].signals).toEqual(["SIGTERM"]);
    clock.advance(2_000);
    expect(children[0].signals).toEqual(["SIGTERM", "SIGKILL"]);
    supervisor.close();
  });

  test("exit した子は間を置いて再起動する", () => {
    const { supervisor, children, clock, ready } = startWithFakes();
    ready(children[0]);
    children[0].emit("exit", 1, null);
    expect(children).toHaveLength(1);
    clock.advance(HEARTBEAT_MS);
    expect(children).toHaveLength(2);
    supervisor.close();
  });
});

describe("watch supervisor: 監視不能時の縮退", () => {
  test("ready を返せない子が2回続いたら poll-only で起動する", () => {
    const { supervisor, children, clock, pollOnlyNotices } = startWithFakes();
    expect(supervisor.pollOnly()).toBe(false);

    // 1回目: ready なしで exit
    children[0].emit("exit", 1, null);
    clock.advance(HEARTBEAT_MS);
    expect(children).toHaveLength(2);
    expect(supervisor.pollOnly()).toBe(false);

    // 2回目: ready なしで exit → 監視をあきらめてポーリングへ
    children[1].emit("exit", 1, null);
    clock.advance(HEARTBEAT_MS);
    expect(children).toHaveLength(3);
    expect(supervisor.pollOnly()).toBe(true);
    expect(pollOnlyNotices()).toBe(1);
    const config = JSON.parse(children[2].stdinWrites[0]);
    expect(config.pollOnly).toBe(true);
    supervisor.close();
  });

  test("watcher なしで ready を返した子も失敗として数える", () => {
    const { supervisor, children, clock } = startWithFakes();
    children[0].emitMessage({
      type: "ready",
      watching: false,
      pollOnly: false,
    });
    children[0].emitMessage({
      type: "ready",
      watching: false,
      pollOnly: false,
    });
    children[0].emit("exit", 1, null);
    clock.advance(HEARTBEAT_MS);
    expect(supervisor.pollOnly()).toBe(true);
    supervisor.close();
  });

  test("poll-only の子が heartbeat を返せば健全として扱う", () => {
    const { supervisor, children, clock } = startWithFakes();
    children[0].emitMessage({ type: "ready", watching: false, pollOnly: true });
    for (let i = 0; i < 6; i++) {
      clock.advance(HEARTBEAT_MS);
      children[0].emitMessage({ type: "heartbeat" });
    }
    expect(children).toHaveLength(1);
    supervisor.close();
  });
});

describe("watch supervisor: 終了", () => {
  test("close は子に SIGTERM を送り、以後 watchdog を発火させない", () => {
    const { supervisor, clock, children, ready } = startWithFakes();
    ready(children[0]);
    supervisor.close();
    expect(children[0].signals).toEqual(["SIGTERM"]);
    clock.advance(HEARTBEAT_MS * 10);
    expect(children).toHaveLength(1);
  });

  test("close 後に子が exit しても再起動しない", () => {
    const { supervisor, clock, children, ready } = startWithFakes();
    ready(children[0]);
    supervisor.close();
    children[0].emit("exit", 0, null);
    clock.advance(HEARTBEAT_MS * 5);
    expect(children).toHaveLength(1);
  });

  test("spawn が例外を投げても呼び出し側に伝播させない", () => {
    const errors: string[] = [];
    const supervisor = startWatchSupervisor({
      root: "/tmp/sample-root",
      omitDirNames: [],
      excludeNames: [],
      maxWatchedDirectories: 1024,
      command: ["fake-exec", "fake-entry", "watch-child"],
      spawnFn: (() => {
        throw new Error("spawn failed");
      }) as unknown as typeof spawn,
      onUpdate: () => undefined,
      onError: (error) =>
        errors.push(error instanceof Error ? error.message : String(error)),
    });
    expect(errors).toEqual(["spawn failed"]);
    supervisor.close();
  });
});
