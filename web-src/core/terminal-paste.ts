// ターミナルへ貼り付けた画像の受け渡しに使う形と、その検証。
//
// 貼り付けた画像は 2 つの相手に渡る。
//
// - エージェント: 保存したファイルのパスをそのままペインへ打ち込む。CLI の
//   エージェントはパスを受け取れば読める。
// - 人間: ターミナルのすぐ上に小さく出す。ちゃんと渡ったことが目で分かる。
//
// サーバとブラウザが同じ判定を見るように core に置く。

/**
 * 受け付ける画像の種類。
 *
 * SVG は入れない。中に script を書けるので、後から誰かが img 以外で開いた
 * ときに実行経路になりうる。貼り付けの用途 (スクショ) では要らない。
 */
export const PASTE_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** 1 枚あたりの上限 (バイト)。スクショなら十分で、貼り間違いも止まる。 */
export const MAX_PASTE_IMAGE_BYTES = 8 * 1024 * 1024;

/** base64 は元の 4/3 になる。本文の上限はそれに余白を足したもの。 */
export const MAX_PASTE_BODY_BYTES = Math.ceil(MAX_PASTE_IMAGE_BYTES * 1.4);

export function pasteImageExtension(mime: unknown): string | null {
  if (typeof mime !== "string") return null;
  // `image/png; charset=...` のような付帯パラメータは落とす。
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return PASTE_IMAGE_TYPES[base] ?? null;
}

// ai-dup-check: allow -- ok:path/name/bytes という並びが database/discovery.ts の
// DiscoveredDb と偶然そっくりなだけで、指しているものが違う (発見した DB と
// 貼り付けた画像)。共通化すると両方の意味が薄まる。
export type PasteImageResponse = {
  /** 保存したファイルの絶対パス。これをそのままペインへ打ち込む。 */
  path: string;
  /** 表示に使う名前。 */
  name: string;
  bytes: number;
};

/**
 * base64 の見た目をしているか。中身の妥当性はデコードで分かるので、ここでは
 * 明らかに違うものを早く弾くだけ。data URL の接頭辞が付いたままの取り違えも
 * ここで落ちる。
 */
export function looksLikeBase64(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

/**
 * Shift+Enter で送るバイト列。LF (Ctrl+J) 1 バイト。
 *
 * 対話型端末アプリは Ctrl+J を「送信せずに改行」として扱う。これは端末側の
 * 設定に依存しない並びなので、送信側だけで完結する。
 *
 * 端末が本来 Shift+Enter で送る拡張キー符号は、送り手と tmux の両方に設定が
 * 要る (tmux なら extended-keys on)。ここは自前で送る側なので、設定の要らない
 * Ctrl+J を選ぶ。ESC+CR (Option+Enter 相当) では駄目で、受け側は ESC と Enter
 * を別々に読み、そのまま送信してしまう。
 */
export const SHIFT_ENTER_SEQUENCE = String.fromCharCode(10);

/**
 * その打鍵が「送信しない改行」かどうか。
 *
 * Shift だけを見る。Ctrl / Cmd / Alt が一緒に押されているものは、エージェント
 * 側で別の割り当てを持っていることがあるので横取りしない。
 */
export function isShiftEnter(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    event.key === "Enter" &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

/** スマホの Ctrl ラッチと、その直後に入力された 1 文字を制御文字へ変える。 */
export function controlSequenceForInput(input: string): string | null {
  if (input.length !== 1) return null;
  if (input === " ") return String.fromCharCode(0);
  if (input === "?") return String.fromCharCode(127);
  const upper = input.toUpperCase();
  if (upper.length !== 1) return null;
  const code = upper.charCodeAt(0);
  if (code < 64 || code > 95) return null;
  return String.fromCharCode(code & 31);
}

/** base64 の文字数から、デコード後のバイト数を出す。 */
export function base64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}
