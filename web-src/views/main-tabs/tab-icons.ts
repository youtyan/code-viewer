// タブ列の絵。種類ごとに core/icons.ts の既存の絵を当てるだけ。
import {
  APPS_16_PATH,
  FILE_16_PATH,
  FOLDER_ICON_PATHS,
  GEAR_16_PATH,
  GIT_BRANCH_16_PATH,
  IMAGE_16_PATH,
  PENCIL_16_PATH,
  PLUS_16_PATH,
  PULSE_16_PATH,
  SIDEBAR_SHOW_16_PATHS,
  TERMINAL_16_PATHS,
  X_16_PATH,
} from "../../core/icons";
import type { PageKind } from "../../core/main-tabs";

export type PageIconPaths = string | string[];

// repo はタブにしないが、Files の入口 (木の見出しの絵柄の列) が使う。
const ICONS: Record<
  PageKind | "repo" | "file" | "image" | "terminal" | "new" | "split",
  PageIconPaths
> = {
  repo: FOLDER_ICON_PATHS.closed,
  diff: FILE_16_PATH,
  history: PULSE_16_PATH,
  worktree: GIT_BRANCH_16_PATH,
  database: APPS_16_PATH,
  journal: PENCIL_16_PATH,
  agents: TERMINAL_16_PATHS,
  help: GEAR_16_PATH,
  file: FILE_16_PATH,
  image: IMAGE_16_PATH,
  terminal: TERMINAL_16_PATHS,
  new: PLUS_16_PATH,
  split: SIDEBAR_SHOW_16_PATHS,
};

export const CLOSE_ICON_PATH = X_16_PATH;

export function pageIconPaths(kind: keyof typeof ICONS): PageIconPaths {
  return ICONS[kind];
}
