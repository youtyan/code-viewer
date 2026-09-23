export type ImageTabLanguage = "en" | "ja";

export type ImageTabText = {
  imageView: (name: string) => string;
  zoomOut: string;
  zoomIn: string;
  actualSize: string;
  fitWidth: string;
  previousImage: string;
  nextImage: string;
  copyPath: string;
  openFolder: string;
  loading: string;
  imageLoadFailed: string;
  copyFailed: string;
  openFailed: string;
  pathCopied: string;
  pathLabel: string;
  eventLabel: string;
};

const EN: ImageTabText = {
  imageView: (name) => `Image: ${name}`,
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  actualSize: "Actual size",
  fitWidth: "Fit width",
  previousImage: "Previous image",
  nextImage: "Next image",
  copyPath: "Copy path",
  openFolder: "Open folder",
  loading: "Loading image…",
  imageLoadFailed: "Could not load the image.",
  copyFailed: "Could not copy the path.",
  openFailed: "Could not open the folder.",
  pathCopied: "Path copied",
  pathLabel: "Path",
  eventLabel: "Event",
};

const JA: ImageTabText = {
  imageView: (name) => `画像: ${name}`,
  zoomOut: "縮小",
  zoomIn: "拡大",
  actualSize: "等倍",
  fitWidth: "幅に合わせる",
  previousImage: "前の画像",
  nextImage: "次の画像",
  copyPath: "パスをコピー",
  openFolder: "フォルダを開く",
  loading: "画像を読み込んでいます…",
  imageLoadFailed: "画像を読み込めませんでした。",
  copyFailed: "パスをコピーできませんでした。",
  openFailed: "フォルダを開けませんでした。",
  pathCopied: "パスをコピーしました",
  pathLabel: "パス",
  eventLabel: "イベント",
};

export function imageTabText(language: ImageTabLanguage): ImageTabText {
  return language === "ja" ? JA : EN;
}
