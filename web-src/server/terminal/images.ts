// ターミナルで見つけた画像パスを、配信できる 1 枚に解決する。
//
// 拾ってくるのは端末に流れた文字列なので、そのまま読みにいってよいかを必ず
// ここで決める。通すのは 3 つを満たすものだけ。
//
// - 許可した拡張子 (PNG/JPEG/GIF/WebP)。SVG は貼り付けと同じ理由で外す
// - 実体が通常のファイル (ディレクトリや名前付きパイプを配ろうとすると、
//   読み出しで詰まる)
// - 上限バイト数まで・0 バイトでない・読める
//
// 通らなかったときは理由を区別して返す (TerminalImageRejectReason)。棚は
// 読めなかった項目も理由つきで出す。
//
// 置き場は問わない。エージェントが作る画像はリポジトリの外 (作業用の一時
// ディレクトリなど) に出ることが多く、リポジトリ内に限ると肝心の 1 枚が
// 出せないため。ローカルの 127.0.0.1 に閉じたツールで、映しているのは
// 利用者自身の端末に出たパスだけ、という前提でこの範囲にしている。
//
// リポジトリ外も配るので、配信は既存の /_file (worktree 限定) には乗らない。
// 同じ判定を通した専用ルートから配る (handle.ts の /_agent/image)。

import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import {
  MAX_TERMINAL_IMAGE_QUERY,
  type TerminalImageRef,
  type TerminalImageRejection,
  type TerminalImageRejectReason,
  terminalImageExtension,
} from "../../core/terminal-images";
import { MAX_PASTE_IMAGE_BYTES } from "../../core/terminal-paste";

/**
 * 棚に出す 1 枚の上限。貼り付けと同じ値にしてある。棚に並ぶ縮小画像に、
 * それ以上の大きさを配る意味がない。
 */
const MAX_IMAGE_BYTES = MAX_PASTE_IMAGE_BYTES;

/** 解決できた画像の実体。配信ルートはこれを見てファイルを開く。 */
export type ResolvedTerminalImage = {
  path: string;
  bytes: number;
  mtimeMs: number;
};

/**
 * 候補 1 つを解いた結果。配れないときは理由を返す (null 1 種類に潰すと、
 * 棚が「消えた」と「大きすぎる」を言い分けられない)。
 */
export type TerminalImageResolution =
  | { status: "ok"; image: ResolvedTerminalImage }
  | {
      status: "rejected";
      reason: TerminalImageRejectReason;
      /** 解いた先 (実体まで解けていれば実体)。invalid では空。 */
      path: string;
      bytes?: number;
      detail?: string;
    };

/** 実在しないことを表す OS のエラーコード。これ以外は「読めない」。 */
const MISSING_CODES = new Set(["ENOENT", "ENOTDIR"]);

function osErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}

function osErrorCode(error: unknown): string | undefined {
  return error instanceof Error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

/**
 * 候補 1 つを実体に解決する。
 *
 * @param cwd 相対パスの起点 (ペインの作業場所。取れなければリポジトリの根)
 * @param candidate 端末の出力から拾った文字列
 */
export function resolveTerminalImage(
  cwd: string,
  candidate: unknown,
): TerminalImageResolution {
  if (typeof candidate !== "string" || candidate === "") {
    return { status: "rejected", reason: "invalid", path: "" };
  }
  if (candidate.includes("\0")) {
    return { status: "rejected", reason: "invalid", path: "" };
  }
  const expanded = candidate.startsWith("~/")
    ? resolve(homedir(), candidate.slice(2))
    : candidate;
  const full = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  // 先に拡張子で落とす。ファイルを触る前に大半の候補がここで消える。
  if (!terminalImageExtension(candidate)) {
    return { status: "rejected", reason: "unsupported", path: full };
  }
  let real: string;
  try {
    // symlink を解いた実体で答える。綴り違いの同じ 1 枚を棚に二重に出さない。
    real = realpathSync(full);
  } catch (error) {
    // 実在しないのは普通の結果 (候補は拾い過ぎる前提)。それ以外 (権限・
    // symlink の輪など) は理由ごと返す。
    if (MISSING_CODES.has(osErrorCode(error) ?? "")) {
      return { status: "rejected", reason: "missing", path: full };
    }
    return {
      status: "rejected",
      reason: "unreadable",
      path: full,
      detail: osErrorDetail(error),
    };
  }
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(real);
  } catch (error) {
    if (MISSING_CODES.has(osErrorCode(error) ?? "")) {
      return { status: "rejected", reason: "missing", path: real };
    }
    return {
      status: "rejected",
      reason: "unreadable",
      path: real,
      detail: osErrorDetail(error),
    };
  }
  // 通常のファイルだけ。ディレクトリや名前付きパイプを配ろうとすると、
  // 読み出しで詰まる。
  if (!stat.isFile()) {
    return { status: "rejected", reason: "not-file", path: real };
  }
  if (stat.size === 0) {
    return { status: "rejected", reason: "empty", path: real, bytes: 0 };
  }
  if (stat.size > MAX_IMAGE_BYTES) {
    return {
      status: "rejected",
      reason: "too-large",
      path: real,
      bytes: stat.size,
    };
  }
  try {
    accessSync(real, constants.R_OK);
  } catch (error) {
    return {
      status: "rejected",
      reason: "unreadable",
      path: real,
      detail: osErrorDetail(error),
    };
  }
  return {
    status: "ok",
    image: { path: real, bytes: stat.size, mtimeMs: stat.mtimeMs },
  };
}

/**
 * その版を表す文字列。URL に入れて、ブラウザに覚えさせてよいかの鍵にする
 * (handle.ts の handleImageGet)。同じ名前で上書きされれば変わる。
 */
export function terminalImageVersion(image: {
  bytes: number;
  mtimeMs: number;
}): string {
  return `${Math.trunc(image.mtimeMs)}-${image.bytes}`;
}

/** ブラウザがその 1 枚を取りにくる URL。 */
export function terminalImageUrl(image: ResolvedTerminalImage): string {
  return `/_agent/image?path=${encodeURIComponent(image.path)}&v=${terminalImageVersion(image)}`;
}

/**
 * まとめて解決する。同じ 1 枚を指す綴りが複数あっても、返すのは 1 つ。
 * 配れなかったものも理由つきで返す (どれを棚に出すかは受け取る側が決める)。
 *
 * @param limit 見る候補の数。ブラウザからの問い合わせは
 *   MAX_TERMINAL_IMAGE_QUERY まで。溢れた分は次の出力でまた拾える
 */
export function resolveTerminalImages(
  cwd: string,
  candidates: string[],
  limit = MAX_TERMINAL_IMAGE_QUERY,
): { images: TerminalImageRef[]; rejected: TerminalImageRejection[] } {
  const images: TerminalImageRef[] = [];
  const rejected: TerminalImageRejection[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates.slice(0, limit)) {
    const result = resolveTerminalImage(cwd, candidate);
    if (result.status === "rejected") {
      const key = `${result.reason}:${result.path || candidate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rejected.push({
        candidate,
        path: result.path,
        name: basename(result.path || candidate),
        reason: result.reason,
        ...(result.bytes !== undefined ? { bytes: result.bytes } : {}),
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
      });
      continue;
    }
    const { image } = result;
    if (seen.has(image.path)) continue;
    seen.add(image.path);
    images.push({
      path: image.path,
      // 画面で探すのは、渡された綴りそのもの。実体のパスとは違うことがある。
      candidate,
      name: basename(image.path),
      url: terminalImageUrl(image),
      bytes: image.bytes,
      mtimeMs: image.mtimeMs,
    });
  }
  return { images, rejected };
}
