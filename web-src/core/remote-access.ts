// 外部接続 (Cloudflare Tunnel + Access) の、入口のサーバと設定画面の間の形。
// 中身は server/entry/remote-control.ts が作り、views/remote-access-settings.ts
// が描く。Tunnel のトークンそのものはどの応答にも載せない (Tunnel の ID だけ)。

/** 設定ファイルに書く Cloudflare の値 (autoStart を除く)。 */
export type RemoteAccessValues = {
  /** 外からの要求だけを受ける 127.0.0.1 の待ち受けのポート。 */
  port: number;
  /** 公開 URL のオリジン (https://<ホスト名>)。 */
  origin: string;
  /** <team>.cloudflareaccess.com */
  teamDomain: string;
  /** Access のアプリケーションの AUD (64 桁の 16 進)。 */
  audience: string;
};

export type RemoteAccessStatus = {
  /**
   * 入口の中で状態が変わるたびに進む (入口を起こし直すと 0 から)。画面は古い
   * 応答を自分の要求の番号で捨てるので、これは比べない (ログや調べもの用)。
   */
  generation: number;
  configPath: string;
  tokenPath: string;
  /** `--remote-access <file>` で渡したファイルを使っている。 */
  configFromFlag: boolean;
  config:
    | { state: "absent" }
    | { state: "ok"; values: RemoteAccessValues; autoStart: boolean }
    | { state: "invalid"; error: string };
  token:
    | { state: "absent" }
    | { state: "ok"; tunnelId: string }
    | { state: "invalid"; error: string };
  /**
   * `cloudflared --version` を最後に試した結果。まだ試していなければ unknown。
   * installable は、cloudflared が無く Homebrew があるので画面から入れられる。
   */
  cloudflared:
    | { state: "unknown" }
    | { state: "ok"; version: string }
    | { state: "unavailable"; error: string; installable: boolean }
    | { state: "installing" };
  listener:
    | { state: "stopped" }
    | { state: "running"; port: number; origin: string }
    | { state: "failed"; error: string };
  tunnel:
    | { state: "stopped" }
    /** トークンが無いので cloudflared は起こさず、待ち受けだけ開いた。 */
    | { state: "skipped" }
    /** shell は cloudflared を動かしている code-viewer の端末 (タブで開ける)。 */
    | { state: "running"; pid: number; connections: number; shell: string }
    | { state: "exited"; error: string };
  /**
   * Homebrew (cloudflared を入れる) と code-viewer の記録の最後の行 (古い順)。
   * cloudflared の出力は端末 (tunnel.shell) にあり、ここには入れない。
   */
  log: string[];
};

/**
 * 値の保存 (core/api-url.ts の entryRemoteConfig) の本文。書いた欄だけを変える。token は空でない
 * ときだけ置き換える (画面には保存済みの値を戻さない)。
 */
export type RemoteAccessSaveRequest = {
  values?: RemoteAccessValues;
  autoStart?: boolean;
  token?: string;
};

/**
 * 開始で入口が起こす cloudflared の引数 (server/entry/remote-control.ts)。設定の
 * 画面は同じものを「実行するコマンド」として見せる。--grace-period は止めるときに
 * 通信の終わりを待つ時間。
 */
export function cloudflaredRunArgs(tokenPath: string): string[] {
  return [
    "tunnel",
    "--no-autoupdate",
    "--grace-period",
    "2s",
    "run",
    "--token-file",
    tokenPath,
  ];
}

/** 外から開いた画面が外部接続の経路 (entryRemote*) を叩いたときの 403 の code。 */
export const REMOTE_LOCAL_ONLY_CODE = "remote-local-only";
