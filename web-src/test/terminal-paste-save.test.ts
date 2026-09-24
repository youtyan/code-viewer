// 貼り付けた画像の保存 (server/terminal/paste.ts)。名前は中身と日時が読める形で、
// 同じ秒の 2 枚目は上書きせず連番を足す。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { savePastedImage } from "../server/terminal/paste";

const PNG_A = Buffer.from([137, 80, 78, 71, 1]).toString("base64");
const PNG_B = Buffer.from([137, 80, 78, 71, 2]).toString("base64");

describe("savePastedImage", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "cv-paste-"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 25, 14, 32, 1));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(repo, { recursive: true, force: true });
  });

  test("プロジェクトの .code-viewer/pasted/ に日時の名前で保存し、相対パスも返す", async () => {
    const result = await savePastedImage(repo, "image/png", PNG_A);
    expect(result).toEqual({
      status: "ok",
      path: join(repo, ".code-viewer/pasted/pasted-image-20260925-143201.png"),
      relativePath: ".code-viewer/pasted/pasted-image-20260925-143201.png",
      name: "pasted-image-20260925-143201.png",
      bytes: 5,
    });
  });

  test("置き場に * の .gitignore を置き、在るものは書き換えない", async () => {
    await savePastedImage(repo, "image/png", PNG_A);
    const ignore = join(repo, ".code-viewer/pasted/.gitignore");
    expect(readFileSync(ignore, "utf8")).toBe("*\n");
    writeFileSync(ignore, "*.png\n");
    await savePastedImage(repo, "image/png", PNG_B);
    expect(readFileSync(ignore, "utf8")).toBe("*.png\n");
  });

  test("同じ秒の 2 枚目は -2 を足し、1 枚目を上書きしない", async () => {
    await savePastedImage(repo, "image/png", PNG_A);
    const second = await savePastedImage(repo, "image/png", PNG_B);
    expect(second).toMatchObject({
      status: "ok",
      name: "pasted-image-20260925-143201-2.png",
    });
    const dir = join(repo, ".code-viewer/pasted");
    expect([
      ...readFileSync(join(dir, "pasted-image-20260925-143201.png")),
    ]).toEqual([137, 80, 78, 71, 1]);
    expect([
      ...readFileSync(join(dir, "pasted-image-20260925-143201-2.png")),
    ]).toEqual([137, 80, 78, 71, 2]);
  });
});
