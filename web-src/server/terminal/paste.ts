// ターミナルへ貼り付けた画像をファイルにする。
//
// 置き場はリポジトリの .code-viewer/pasted/ 配下。置き場に `*` だけの .gitignore を
// 置き、貼り付けたスクショが作業ツリーの差分に出ないようにする (利用者のリポジトリの
// .gitignore には触らない。以前は「既に無視されている」と思い込んでいたが、それは
// code-viewer 自身のリポジトリだけで、利用者のリポジトリでは未追跡として出ていた)。
// リポジトリの中に置くのは、パスをそのままエージェントへ渡したときに読める必要があるため
// (tmux のペインは同じマシンの別プロセスなので、共有の場所が要る)。
//
// 保存名はこちらで決める (core/terminal-paste.ts の pastedImageName)。貼り付け元の
// 名前は信用しないし、そもそもクリップボードの画像には名前が無いことが多い。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatErrorDetail } from "../../core/error-detail";
import {
  base64ByteLength,
  looksLikeBase64,
  MAX_PASTE_IMAGE_BYTES,
  PASTE_IMAGE_DIR,
  pasteImageExtension,
  pastedImageName,
} from "../../core/terminal-paste";

/** 同じ秒に貼った画像の連番の上限。超えたら保存を断る (理由つき)。 */
const MAX_NAME_ATTEMPTS = 100;

export type SavePasteResult =
  | {
      status: "ok";
      path: string;
      relativePath: string;
      name: string;
      bytes: number;
    }
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

  // Buffer.from は base64 でない文字を読み飛ばすだけで投げない。空になったら不正。
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) {
    return { status: "invalid", message: "invalid image data" };
  }
  if (bytes.length > MAX_PASTE_IMAGE_BYTES) {
    return { status: "invalid", message: "image too large" };
  }

  // 名前はこちらで作る。時刻順に並ぶ。同じ秒の 2 枚目は "wx" (在れば失敗) で
  // ぶつかりを見て連番を足す。
  const dir = join(cwd, PASTE_IMAGE_DIR);
  try {
    await mkdir(dir, { recursive: true });
    await writeIgnoreFile(dir);
  } catch (error) {
    return { status: "error", message: formatErrorDetail(error) };
  }
  const at = new Date();
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const name = pastedImageName(at, extension, attempt);
    const path = join(dir, name);
    try {
      await writeFile(path, bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      return { status: "error", message: formatErrorDetail(error) };
    }
    return {
      status: "ok",
      path,
      relativePath: `${PASTE_IMAGE_DIR}/${name}`,
      name,
      bytes: bytes.length,
    };
  }
  return {
    status: "error",
    message: `${MAX_NAME_ATTEMPTS} images were already pasted in the same second (${pastedImageName(at, extension)})`,
  };
}

/** 置き場の中身 (この .gitignore 自身も) を git に無視させる。在れば書き換えない。 */
async function writeIgnoreFile(dir: string): Promise<void> {
  try {
    await writeFile(join(dir, ".gitignore"), "*\n", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}
