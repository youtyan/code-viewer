// インストールした窓 (PWA) の manifest とアイコンを、動いているサーバから取る。
// 1 つで完結するサーバ (preview-cli.test.ts) と入口のサーバ (entry-server.test.ts) が
// 同じ形で比べるための共有ヘルパ。

/** PNG の IHDR から "幅x高さ" を読む。PNG でなければ投げる。 */
export function pngSize(bytes: Uint8Array): string {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte))
    throw new Error(`not a PNG (${bytes.length} bytes)`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return `${view.getUint32(16)}x${view.getUint32(20)}`;
}

export type ServedPwaAssets = {
  contentType: string | null;
  manifest: { icons: { src: string; sizes: string }[] } & Record<
    string,
    unknown
  >;
  /** [src, HTTP status, Content-Type, PNG の寸法] */
  icons: [string, number, string | null, string][];
};

/**
 * `base` (末尾 / の URL) の下の manifest.webmanifest と、そこに書かれたアイコンを取る。
 * アイコンの URL はブラウザと同じく manifest の URL を基準に解決する。
 */
export async function fetchPwaAssets(base: string): Promise<ServedPwaAssets> {
  const manifestUrl = new URL("manifest.webmanifest", base);
  const res = await fetch(manifestUrl);
  const text = await res.text();
  if (res.status !== 200)
    throw new Error(`GET ${manifestUrl}: HTTP ${res.status}: ${text}`);
  const manifest = JSON.parse(text) as ServedPwaAssets["manifest"];
  const icons = await Promise.all(
    manifest.icons.map(
      async (icon): Promise<ServedPwaAssets["icons"][number]> => {
        const iconRes = await fetch(new URL(icon.src, manifestUrl));
        const bytes = new Uint8Array(await iconRes.arrayBuffer());
        return [
          icon.src,
          iconRes.status,
          iconRes.headers.get("content-type"),
          iconRes.status === 200 ? pngSize(bytes) : "",
        ];
      },
    ),
  );
  return { contentType: res.headers.get("content-type"), manifest, icons };
}

/** 配っているべきアイコン (manifest の順)。 */
export const SERVED_PWA_ICONS: ServedPwaAssets["icons"] = [
  ["/icons/icon-192.png", 200, "image/png", "192x192"],
  ["/icons/icon-512.png", 200, "image/png", "512x512"],
  ["/icons/icon-maskable-192.png", 200, "image/png", "192x192"],
  ["/icons/icon-maskable-512.png", 200, "image/png", "512x512"],
];
