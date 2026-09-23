// cachedRegistryReader (registry-file.ts) は「大きさ・更新時刻・inode」が
// 前回と同じなら前回の結果を返す。読めなかった結果 (ok: false) もそのまま
// 覚えていたので、読めない理由が中身の外にあった (権限・EMFILE のような
// 一時的な失敗) ときは、理由が消えた後も中身が書き換わるまで「読めない」を
// 返し続けた。chmod は更新時刻を変えない。入口の projects.lookup は
// readProjectRegistryCached を使うので、その間は登録したプロジェクトの
// `/p/<鍵>/` が 500 ("the project registry cannot be read") になった。
// いまは読めなかった結果を覚えない。
//
// 権限で読めなくする都合で、root で走らせると前提 (1 回目が読めない) で落ちる。

import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readProjectRegistryCached } from "../server/projects/registry";

describe("readProjectRegistryCached after the file becomes readable again", () => {
  test("権限を戻した次の読み取りで、中身を変えなくても登録簿が読める", () => {
    const dir = mkdtempSync(join(tmpdir(), "cv-adversarial-registry-"));
    const path = join(dir, "projects.json");
    writeFileSync(path, `${JSON.stringify({ version: 1, projects: [] })}\n`);
    chmodSync(path, 0o000);
    const blocked = readProjectRegistryCached(path);
    chmodSync(path, 0o600);

    // 前提: 権限が無い間は読めない (理由つき)。
    expect(blocked.ok).toBe(false);
    // 権限を戻した後は、中身を変えなくても読める。
    expect(readProjectRegistryCached(path)).toEqual({
      ok: true,
      registry: { version: 1, projects: [] },
    });
  });
});
