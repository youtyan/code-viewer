// ターミナルで見つけた画像パスを、配信できる 1 枚に解決する。
//
// 拾ってくるのは端末に流れた文字列なので、そのまま読みにいってよいかを必ず
// ここで決める。通すのは 3 つを満たすものだけ。
//
// - 許可した拡張子 (PNG/JPEG/GIF/WebP)。SVG は貼り付けと同じ理由で外す
// - 実体が通常のファイル (ディレクトリや名前付きパイプを配ろうとすると、
//   読み出しで詰まる)
// - 上限バイト数まで
//
// 置き場は問わない。エージェントが作る画像はリポジトリの外 (作業用の一時
// ディレクトリなど) に出ることが多く、リポジトリ内に限ると肝心の 1 枚が
// 出せないため。ローカルの 127.0.0.1 に閉じたツールで、映しているのは
// 利用者自身の端末に出たパスだけ、という前提でこの範囲にしている。
//
// リポジトリ外も配るので、配信は既存の /_file (worktree 限定) には乗らない。
// 同じ判定を通した専用ルートから配る (handle.ts の /_agent/image)。

import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import {
  MAX_TERMINAL_IMAGE_QUERY,
  type TerminalImageRef,
  terminalImageExtension,
} from "../../core/terminal-images";
import { MAX_PASTE_IMAGE_BYTES } from "../../core/terminal-paste";

/**
 * 帯に出す 1 枚の上限。貼り付けと同じ値にしてある。帯に並ぶ縮小画像に、
 * それ以上の大きさを配る意味がない。
 */
const MAX_IMAGE_BYTES = MAX_PASTE_IMAGE_BYTES;

/** 解決できた画像の実体。配信ルートはこれを見てファイルを開く。 */
export type ResolvedTerminalImage = { path: string; bytes: number };

/**
 * 候補 1 つを実体に解決する。配れないものは null。
 *
 * @param cwd 相対パスの起点 (リポジトリのルート)
 * @param candidate 端末の出力から拾った文字列
 */
export function resolveTerminalImage(
  cwd: string,
  candidate: unknown,
): ResolvedTerminalImage | null {
  if (typeof candidate !== "string" || candidate === "") return null;
  if (candidate.includes("\0")) return null;
  // 先に拡張子で落とす。ファイルを触る前に大半の候補がここで消える。
  if (!terminalImageExtension(candidate)) return null;
  const expanded = candidate.startsWith("~/")
    ? resolve(homedir(), candidate.slice(2))
    : candidate;
  const full = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  try {
    // symlink を解いた実体で答える。綴り違いの同じ 1 枚を帯に二重に出さない。
    const real = realpathSync(full);
    const stat = statSync(real);
    if (!stat.isFile()) return null;
    if (stat.size === 0 || stat.size > MAX_IMAGE_BYTES) return null;
    return { path: real, bytes: stat.size };
  } catch {
    // 実在しない・読めない。候補は拾い過ぎる前提なので、これが普通の結果。
    return null;
  }
}

/** ブラウザがその 1 枚を取りにくる URL。 */
export function terminalImageUrl(path: string): string {
  return `/_agent/image?path=${encodeURIComponent(path)}`;
}

/**
 * まとめて解決する。配れないものは黙って落とす (拾い過ぎる前提の入口なので、
 * 落ちたことを一件ずつ返しても使い道がない)。同じ 1 枚を指す綴りが複数あって
 * も、返すのは 1 つ。
 */
export function resolveTerminalImages(
  cwd: string,
  candidates: string[],
): TerminalImageRef[] {
  const images: TerminalImageRef[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates.slice(0, MAX_TERMINAL_IMAGE_QUERY)) {
    const image = resolveTerminalImage(cwd, candidate);
    if (!image || seen.has(image.path)) continue;
    seen.add(image.path);
    images.push({
      path: image.path,
      // 画面で探すのは、渡された綴りそのもの。実体のパスとは違うことがある。
      candidate,
      name: basename(image.path),
      url: terminalImageUrl(image.path),
    });
  }
  return images;
}
