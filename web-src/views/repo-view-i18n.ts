// The folder view is rebuilt on every load, so it does not need a localize
// hook. The next render reads STATE.language again.

export type RepoViewLanguage = "en" | "ja";

export type RepoViewText = {
  copyPathFailed: (detail: string) => string;
  readmeRenderFailed: string;
  copyFolderPath: string;
  copyPath: string;
  copyName: string;
  /** 木のファイルの行: 固定のタブで開く・反対の面で開く (ui-surface.md のタブの決まり)。 */
  openInNewTab: string;
  openToTheRight: string;
  newFolderMenu: string;
  moveToTrashMenu: string;
  moveToTrashTitle: string;
  moveToTrashBody: (path: string) => string;
  moveToTrash: string;
  newFolder: string;
  newFolderBody: (place: string) => string;
  folderName: string;
  create: string;
  invalidFolderName: string;
  createFailed: (name: string, detail: string) => string;
  trashFailed: string;
  newFolderFailed: string;
  cannotLoadTree: string;
  symlink: (target: string) => string;
  brokenSymlink: (target: string) => string;
  fileDetails: string;
  size: string;
  updated: string;
  created: string;
  detailsFailed: string;
};

const EN: RepoViewText = {
  copyPathFailed: (detail) => `Could not copy the folder path\n${detail}`,
  readmeRenderFailed:
    "Could not render the Markdown, so the raw text is shown.",
  copyFolderPath: "copy folder path",
  copyPath: "Copy path",
  copyName: "Copy name",
  openInNewTab: "Open in new tab",
  openToTheRight: "Open to the right",
  newFolderMenu: "New folder...",
  moveToTrashMenu: "Move to Trash...",
  moveToTrashTitle: "Move to Trash?",
  moveToTrashBody: (path) => `Move "${path}" to Trash?`,
  moveToTrash: "Move to Trash",
  newFolder: "New Folder",
  newFolderBody: (place) => `Create a folder in "${place}".`,
  folderName: "Folder name",
  create: "Create",
  invalidFolderName:
    "Use a folder name without slashes, control characters, . or ..",
  createFailed: (name, detail) => `Failed to create "${name}": ${detail}`,
  trashFailed: "Trash failed",
  newFolderFailed: "New folder failed",
  cannotLoadTree: "Cannot load tree",
  symlink: (target) => `Symlink → ${target}`,
  brokenSymlink: (target) => `Broken symlink → ${target}`,
  fileDetails: "File details",
  size: "Size",
  updated: "Updated",
  created: "Created",
  detailsFailed: "Could not load details",
};

const JA: RepoViewText = {
  copyPathFailed: (detail) =>
    `フォルダのパスをコピーできませんでした\n${detail}`,
  readmeRenderFailed:
    "Markdown を描画できなかったので、元の文字を表示しています。",
  copyFolderPath: "フォルダのパスをコピー",
  copyPath: "パスをコピー",
  copyName: "名前をコピー",
  openInNewTab: "新しいタブで開く",
  openToTheRight: "右に分割して開く",
  newFolderMenu: "新しいフォルダ...",
  moveToTrashMenu: "ゴミ箱に入れる...",
  moveToTrashTitle: "ゴミ箱に入れますか？",
  moveToTrashBody: (path) => `「${path}」をゴミ箱に入れます。`,
  moveToTrash: "ゴミ箱に入れる",
  newFolder: "新しいフォルダ",
  newFolderBody: (place) => `「${place}」にフォルダを作ります。`,
  folderName: "フォルダの名前",
  create: "作る",
  invalidFolderName:
    "スラッシュ・制御文字を含まない名前にしてください（. と .. は使えません）",
  createFailed: (name, detail) => `「${name}」を作れませんでした: ${detail}`,
  trashFailed: "ゴミ箱に入れられませんでした",
  newFolderFailed: "フォルダを作れませんでした",
  cannotLoadTree: "ファイルの一覧を読み込めません",
  symlink: (target) => `シンボリックリンク → ${target}`,
  brokenSymlink: (target) => `リンク先が無いシンボリックリンク → ${target}`,
  fileDetails: "ファイルの情報",
  size: "大きさ",
  updated: "更新",
  created: "作成",
  detailsFailed: "情報を読み込めませんでした",
};

export function repoViewText(language: RepoViewLanguage): RepoViewText {
  return language === "ja" ? JA : EN;
}
