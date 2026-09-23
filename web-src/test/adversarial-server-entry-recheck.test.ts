// 入口の起動 (runEntry) は、起動ロックを取った後に entry.json をもう一度
// 見る (recheck)。そこで running 以外 (none・broken) を区別せずに先へ進んで
// いたので、ロックを待つ間に entry.json が読めなくなった (broken) ときも、
// 読めない記録を自分の記録で上書きしていた (読めない記録は上書きも削除も
// しない決まりに反する)。いまは none のときだけ先へ進み、それ以外は最初の
// 判断からやり直す (broken なら理由を出して終わる)。
//
// 記録の読み書きと起動ロック、待ち受けは偽物にし、process.exit は投げる
// ようにして、runEntry を同じプロセスの中で動かす。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const reads: Array<
  { ok: true; registry: null } | { ok: false; error: string }
> = [];
const written: unknown[] = [];
const released: number[] = [];

vi.mock("../server/entry/entry-file", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/entry/entry-file")>();
  return {
    ...actual,
    readEntryRecord: () => {
      const next = reads.shift();
      if (!next)
        throw new Error("sample: entry.json was read more than set up");
      return next;
    },
    writeEntryRecord: (entry: unknown) => {
      written.push(entry);
      throw new Error("sample: stop after writing entry.json");
    },
    acquireEntryStartLock: () => ({
      release: () => released.push(1),
    }),
  };
});

vi.mock("../server/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/runtime")>();
  return {
    ...actual,
    startServer: async () => ({ port: 1, close: () => undefined }),
  };
});

const { runEntry } = await import("../server/entry/server");

afterEach(() => {
  reads.length = 0;
  written.length = 0;
  released.length = 0;
  vi.restoreAllMocks();
});

describe("runEntry when entry.json becomes unreadable while taking the start lock", () => {
  test("読めない entry.json を上書きせず、理由を出して終わる", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cv-adversarial-entry-"));
    reads.push(
      { ok: true, registry: null },
      { ok: false, error: "sample: entry.json is not valid JSON" },
      { ok: false, error: "sample: entry.json is not valid JSON" },
    );
    const errors: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`sample: process.exit(${code})`);
    });

    await expect(runEntry(["--cwd", cwd])).rejects.toThrow(
      "sample: process.exit(1)",
    );
    expect(written).toEqual([]);
    expect(released).toHaveLength(1);
    expect(String(errors[errors.length - 1]?.[0])).toContain(
      "sample: entry.json is not valid JSON",
    );
  });
});
