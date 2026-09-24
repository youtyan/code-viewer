// タブ列の絵。種類ごとに core/icons.ts の既存の絵を当てるだけ。
import {
  BOOK_16_PATH,
  DATABASE_16_PATH,
  FILE_16_PATH,
  FILE_DIFF_16_PATH,
  FILE_DIRECTORY_SYMLINK_16_PATHS,
  FOLDER_ICON_PATHS,
  GEAR_16_PATH,
  HISTORY_16_PATH,
  IMAGE_16_PATH,
  PENCIL_16_PATH,
  PLUS_16_PATH,
  SEARCH_16_PATH,
  SIDEBAR_HIDE_16_PATHS,
  SIDEBAR_SHOW_16_PATHS,
  TERMINAL_16_PATHS,
  X_16_PATH,
} from "../../core/icons";
import type { PageKind } from "../../core/main-tabs";

export type PageIconPaths = string | string[];

// repo はタブにしないが、Files の入口 (木の見出しの絵柄の列) が使う。
const ICONS: Record<
  | PageKind
  | "repo"
  | "file"
  | "image"
  | "terminal"
  | "new"
  | "split"
  | "unsplit",
  PageIconPaths
> = {
  repo: FOLDER_ICON_PATHS.closed,
  // 素のファイルの絵 (file) と見分ける: ＋ と − の入ったファイル。
  diff: FILE_DIFF_16_PATH,
  history: HISTORY_16_PATH,
  // 枝分かれの絵は使わない (エディタの「変更」の絵なので差分と取り違えられた)。
  worktree: FILE_DIRECTORY_SYMLINK_16_PATHS,
  database: DATABASE_16_PATH,
  journal: PENCIL_16_PATH,
  agents: TERMINAL_16_PATHS,
  // Markdown / Mermaid / JSON の変換 (道具の絵は無いので、文書の絵)。
  tools: BOOK_16_PATH,
  search: SEARCH_16_PATH,
  help: GEAR_16_PATH,
  file: FILE_16_PATH,
  image: IMAGE_16_PATH,
  terminal: TERMINAL_16_PATHS,
  new: PLUS_16_PATH,
  split: SIDEBAR_SHOW_16_PATHS,
  // 分割の逆 (矢印の向きが逆)。
  unsplit: SIDEBAR_HIDE_16_PATHS,
};

export const CLOSE_ICON_PATH = X_16_PATH;

export function pageIconPaths(kind: keyof typeof ICONS): PageIconPaths {
  return ICONS[kind];
}
