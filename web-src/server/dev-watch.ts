import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { errno } from "./terminal/settings-file";

function isGone(error: unknown): boolean {
  const code = errno(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    // 途中で消えたフォルダ (ブランチの切り替えなど) だけ飛ばす。
    if (isGone(error)) return out;
    throw error;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch (error) {
      if (isGone(error)) continue;
      throw error;
    }
    if (isDir) {
      out.push(...walkTsFiles(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function fileSignature(file: string): string {
  // A watched file may disappear mid-flight (branch switch, rename). Other
  // failures reach the tick's catch, which logs them and keeps the loop alive.
  try {
    return `${file}:${statSync(file).mtimeMs}`;
  } catch (error) {
    if (isGone(error)) return `${file}:missing`;
    throw error;
  }
}

/**
 * dev.ts が入口を起こし直すきっかけ。入口と裏が読み込む server・core の
 * ソースと、package.json (入口と裏は起動時にここの版を読む。版を上げても
 * 入口が古いままだと、新しい版の裏がその入口を断って起きない)。
 */
export function devWatchSignature(root: string): string {
  return walkTsFiles(join(root, "web-src", "server"))
    .concat(walkTsFiles(join(root, "web-src", "core")), [
      join(root, "package.json"),
    ])
    .map(fileSignature)
    .join("|");
}
