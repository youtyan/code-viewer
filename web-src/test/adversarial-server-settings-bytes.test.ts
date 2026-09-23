// エージェントの設定ファイルの書き換え (settings-file.ts の
// commitJsonSettingsChange。フックの入れ外しと statusLine が使う) は、書く前に
// バックアップを作る。そのバックアップの中身が、読んだときに UTF-8 として
// 解読した文字列 (current.text) だったので、UTF-8 として正しくないバイトは
// U+FFFD (EF BF BD) に置き換わって書かれていた。書き換えた本体も同じ文字列
// から作るので、元のバイトはどこにも残らなかった。JSON.parse は U+FFFD を
// 含む文字列をそのまま通すので、読めない扱いにもならない。いまは
// バックアップを元のファイルのバイト列のまま写す。

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { errorWithCause } from "../core/error-detail";
import {
  commitJsonSettingsChange,
  contentHash,
  DEFAULT_WRITE_OPS,
  readJsonSettingsFile,
} from "../server/terminal/settings-file";

describe("rewriting an agent settings file that is not valid UTF-8", () => {
  test("バックアップは元のファイルと同じバイト列 (UTF-8 として正しくないバイトも残る)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cv-adversarial-settings-"));
    const path = join(dir, "settings.json");
    // "caf" + 0xE9 (Latin-1 の e-acute。UTF-8 としては不正な 1 バイト)。
    const original = Buffer.concat([
      Buffer.from('{\n  "note": "caf', "utf8"),
      Buffer.from([0xe9]),
      Buffer.from('"\n}\n', "utf8"),
    ]);
    writeFileSync(path, original);
    const read = readJsonSettingsFile(dir, path, () => []);
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;

    const { backupPath } = await commitJsonSettingsChange({
      configDir: dir,
      path,
      check: () => [],
      baseHash: contentHash(read),
      realPath: read.realPath,
      fileIdentity: read.fileIdentity,
      next: (root) =>
        `${JSON.stringify({ ...root, sampleSetting: true }, null, 2)}\n`,
      now: new Date(0),
      ops: DEFAULT_WRITE_OPS,
      error: (code, message, cause) =>
        errorWithCause(`${code}: ${message}`, cause),
    });

    expect(backupPath).not.toBeNull();
    expect(readFileSync(backupPath as string).toString("hex")).toBe(
      original.toString("hex"),
    );
  });
});
