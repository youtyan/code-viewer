// ターミナルへ貼り付けた画像をファイルにする。
//
// 置き場はリポジトリの .code-viewer/pasted/ 配下。既に gitignore されている
// ので、貼り付けたスクショが作業ツリーの差分に出てこない。リポジトリの中に
// 置くのは、パスをそのままエージェントへ渡したときに読める必要があるため
// (tmux のペインは同じマシンの別プロセスなので、共有の場所が要る)。
//
// 保存名はこちらで決める。貼り付け元の名前は信用しないし、そもそも
// クリップボードの画像には名前が無いことが多い。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTimedId } from "../../core/id";
import {
  base64ByteLength,
  looksLikeBase64,
  MAX_PASTE_IMAGE_BYTES,
  pasteImageExtension,
} from "../../core/terminal-paste";

/** .code-viewer 配下の置き場。annotations などと同じ階層に並べる。 */
const PASTE_DIR = join(".code-viewer", "pasted");

export type SavePasteResult =
  | { status: "ok"; path: string; name: string; bytes: number }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

/**
 * base64 の画像を保存して、絶対パスを返す。
 *
 * @param cwd リポジトリのルート
 * @param mime クライアントが申告した種類。許可した 4 種以外は弾く
 * @param base64 データ本体 (data URL の接頭辞は付けない)
 */
export async function savePastedImage(
  cwd: string,
  mime: unknown,
  base64: unknown,
): Promise<SavePasteResult> {
  const extension = pasteImageExtension(mime);
  if (!extension) {
    return { status: "invalid", message: "unsupported image type" };
  }
  if (!looksLikeBase64(base64)) {
    return { status: "invalid", message: "invalid image data" };
  }
  // 先に長さで弾く。デコードしてからでは、その時点で上限を超えた量を
  // メモリに載せてしまう。
  if (base64ByteLength(base64) > MAX_PASTE_IMAGE_BYTES) {
    return { status: "invalid", message: "image too large" };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return { status: "invalid", message: "invalid image data" };
  }
  if (bytes.length === 0) {
    return { status: "invalid", message: "invalid image data" };
  }
  if (bytes.length > MAX_PASTE_IMAGE_BYTES) {
    return { status: "invalid", message: "image too large" };
  }

  // 名前はこちらで作る。時刻順に並び、ぶつからない。
  const name = `${makeTimedId("paste")}.${extension}`;
  const dir = join(cwd, PASTE_DIR);
  const path = join(dir, name);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path, bytes);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { status: "ok", path, name, bytes: bytes.length };
}
