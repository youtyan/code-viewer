// tryAcquireFileLock は、古い (持ち主が居ない・staleMs を過ぎた・読めない)
// ロックを「読む (または stat する) → unlink」の 2 手で奪っていた。2 つのプロセスが
// 同じ古いロックを同時に見ると、先に奪って置き直した側の新しいロックを、
// 後の側が古いものだと思い込んだまま unlink していた。後の側も置けるので、
// 2 者が同時に「持っている」になり、読んで・変えて・書くが重なって片方の
// 変更が消えた。いまは rename で退避してから中身を確かめ、違えば戻す。
//
// 2 つのプロセスの間の順序は、node:fs の読み取りの直後に割り込んで作る
// (1 つ目の読み取り・stat が終わった瞬間に、もう 1 人が奪い終える)。

import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

type Interleave = { after: "readFileSync" | "statSync"; run: () => void };
const pending: { hook: Interleave | null } = { hook: null };

function interleaved<T extends (...args: never[]) => unknown>(
  name: Interleave["after"],
  original: T,
): T {
  return ((...args: Parameters<T>) => {
    const result = original(...args);
    const hook = pending.hook;
    if (
      hook &&
      hook.after === name &&
      typeof args[0] === "string" &&
      (args[0] as string).endsWith(".lock")
    ) {
      pending.hook = null;
      hook.run();
    }
    return result;
  }) as T;
}

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = interleaved("readFileSync", actual.readFileSync);
  const statSync = interleaved("statSync", actual.statSync);
  return {
    ...actual,
    readFileSync,
    statSync,
    default: { ...actual, readFileSync, statSync },
  };
});

const { tryAcquireFileLock } = await import("../server/file-lock");

afterEach(() => {
  pending.hook = null;
});

const STALE_MS = 1_000;
const NOW = 1_000_000;

describe("tryAcquireFileLock: two takers of the same stale lock", () => {
  test.each([
    {
      name: "staleMs を過ぎた (中身は読める) ロック",
      after: "readFileSync" as const,
      leave(file: string) {
        writeFileSync(
          file,
          `${JSON.stringify({ token: "left-behind", pid: process.pid, createdAt: NOW - STALE_MS * 10 })}\n`,
        );
      },
    },
    {
      name: "staleMs より古い、読めない (空の) ロック",
      after: "statSync" as const,
      leave(file: string) {
        writeFileSync(file, "");
        const old = (NOW - STALE_MS * 10) / 1000;
        utimesSync(file, old, old);
      },
    },
  ])("$name: 先に奪った 1 人だけが持ち、もう 1 人は null", ({
    after,
    leave,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), "cv-adversarial-lock-"));
    const file = join(dir, "shared.json.lock");
    leave(file);
    // 読めないロックを奪うときの理由の行 (takeOverUnreadableLock) は溜めておく。
    const logged: unknown[][] = [];
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    let first: ReturnType<typeof tryAcquireFileLock> = null;
    // 2 人目が古いロックを読み終えた (stat し終えた) 瞬間に、1 人目が奪い終える。
    pending.hook = {
      after,
      run: () => {
        first = tryAcquireFileLock(file, { staleMs: STALE_MS, now: NOW });
      },
    };
    const second = tryAcquireFileLock(file, { staleMs: STALE_MS, now: NOW });
    errors.mockRestore();
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
