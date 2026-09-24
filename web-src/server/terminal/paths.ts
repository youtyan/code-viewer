// ターミナルの画面に出たファイルのパスが、このプロジェクトの中で実在するファイル
// かを答える (core/terminal-links.ts が拾った候補)。答えたものだけが、画面の上で
// 開く・コピーのできるリンクになる。
//
// - `~/` はホーム、絶対パスはそのまま、相対パスは起点 (シェルが映している
//   ペインの作業場所、次にプロジェクトの根) から解く
// - symlink を解いた実体が通常のファイルで、プロジェクトの根の中にあるものだけ
//   (code-viewer で開けるのはプロジェクトの中だけ)。無い・外・ディレクトリは
//   黙って落とす (候補は拾い過ぎる前提。落とすのが普通の結果)
// - 読むのは stat だけ。中身は読まない

import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  MAX_TERMINAL_PATH_QUERY,
  type TerminalPathHit,
} from "../../core/terminal-links";

/** 実在しないことを表す OS のエラーコード。これ以外は理由を残す。 */
const MISSING_CODES = new Set(["ENOENT", "ENOTDIR", "ENAMETOOLONG"]);

function osErrorCode(error: unknown): string | undefined {
  return error instanceof Error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

export type TerminalPathsResult = {
  files: TerminalPathHit[];
  /** 無い以外の理由で確かめられなかった候補 (権限など)。ログにも出す。 */
  errors: string[];
};

/**
 * @param root プロジェクトの根 (実体)
 * @param bases 相対パスの起点 (前から順に試す)
 * @param candidates 行と桁を除いたパスの綴り
 */
export function resolveTerminalPaths(
  root: string,
  bases: readonly string[],
  candidates: readonly string[],
): TerminalPathsResult {
  const files: TerminalPathHit[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const rootReal = realpathSync(root);
  for (const candidate of candidates.slice(0, MAX_TERMINAL_PATH_QUERY)) {
    if (seen.has(candidate) || !candidate || candidate.includes("\0")) continue;
    seen.add(candidate);
    const expanded = candidate.startsWith("~/")
      ? resolve(homedir(), candidate.slice(2))
      : candidate;
    const tries = isAbsolute(expanded)
      ? [expanded]
      : bases.map((base) => resolve(base, expanded));
    for (const full of tries) {
      let real: string;
      try {
        real = realpathSync(full);
        if (!statSync(real).isFile()) continue;
      } catch (error) {
        if (MISSING_CODES.has(osErrorCode(error) ?? "")) continue;
        errors.push(`${candidate}: ${String(error)}`);
        continue;
      }
      if (real !== rootReal && !real.startsWith(`${rootReal}${sep}`)) continue;
      files.push({
        candidate,
        path: relative(rootReal, real).split(sep).join("/"),
        absolute: real,
      });
      break;
    }
  }
  return { files, errors };
}
