// 設定の「外部接続」の節の文言 (views/remote-access-settings.ts)。ログインし直しの
// 案内 (views/remote-access.ts) の文言は、そちらのファイルが持つ。
// 1 段落は日本語 120 文字・英語 240 文字まで (settings-text-length.test.ts)。

export type RemoteAccessSettingsText = {
  statusTitle: string;
  rowListener: string;
  rowTunnel: string;
  rowToken: string;
  listenerRunning: string;
  listenerStopped: string;
  listenerFailed: string;
  listenerTarget: (port: number, origin: string) => string;
  tunnelConnected: (connections: number) => string;
  tunnelWaiting: string;
  tunnelStopped: string;
  tunnelSkipped: string;
  tunnelExited: string;
  tunnelUnavailable: string;
  tunnelSkippedDetail: string;
  tunnelProcess: (version: string, pid: number) => string;
  cloudflaredVersion: (version: string) => string;
  install: string;
  installing: string;
  installHint: string;
  installingNote: string;
  installFailed: string;
  tokenSaved: string;
  tokenAbsent: string;
  tokenInvalid: string;
  tokenTunnelId: (id: string) => string;
  start: string;
  stop: string;
  autoStart: string;
  needValues: string;
  configInvalid: string;
  localOnly: string;
  standalone: string;
  loading: string;
  loadFailed: string;
  startFailed: string;
  stopFailed: string;
  autoStartFailed: string;
  valuesTitle: string;
  unsaved: string;
  valuesIntro: string;
  originLabel: string;
  teamDomainLabel: string;
  audienceLabel: string;
  portLabel: string;
  tokenLabel: string;
  tokenPlaceholderSaved: string;
  tokenPlaceholderAbsent: string;
  tokenHelp: string;
  portProblem: string;
  saveFailed: string;
  savedTo: (configPath: string, tokenPath: string) => string;
  fromFlag: (configPath: string, tokenPath: string) => string;
  logTitle: (lines: number) => string;
  logEmpty: string;
};

export const REMOTE_ACCESS_SETTINGS_TEXT: Record<
  "en" | "ja",
  RemoteAccessSettingsText
> = {
  en: {
    statusTitle: "Status",
    rowListener: "Listener",
    rowTunnel: "cloudflared",
    rowToken: "Token",
    listenerRunning: "Open",
    listenerStopped: "Stopped",
    listenerFailed: "Could not open",
    listenerTarget: (port, origin) => `127.0.0.1:${port} for ${origin}`,
    tunnelConnected: (connections) => `Connected (${connections})`,
    tunnelWaiting: "Connecting",
    tunnelStopped: "Stopped",
    tunnelSkipped: "Not started",
    tunnelExited: "Stopped by itself",
    tunnelUnavailable: "Unavailable",
    tunnelSkippedDetail:
      "No token is saved, so cloudflared was not started. If you run cloudflared yourself, this is fine.",
    tunnelProcess: (version, pid) => `cloudflared ${version} (pid ${pid})`,
    cloudflaredVersion: (version) => `cloudflared ${version}`,
    install: "Install cloudflared",
    installing: "Installing",
    installHint:
      "Install cloudflared installs it with Homebrew; you do not need to open a terminal.",
    installingNote:
      "Installing with Homebrew. Its output appears under cloudflared output below.",
    installFailed: "Could not install cloudflared",
    tokenSaved: "Saved",
    tokenAbsent: "Not saved",
    tokenInvalid: "Unreadable",
    tokenTunnelId: (id) => `Tunnel ID ${id}`,
    start: "Start",
    stop: "Stop",
    autoStart: "Start when code-viewer starts",
    needValues: "Save the Cloudflare values below to start.",
    configInvalid:
      "The settings file cannot be read. Saving the values moves it aside and writes a new one.",
    localOnly:
      "Remote access can be started, stopped and changed only on the computer running code-viewer.",
    standalone:
      "This code-viewer cannot run remote access. Start code-viewer without --standalone (if an older code-viewer is still running, stop it and start it again).",
    loading: "Loading…",
    loadFailed: "Could not read the remote access status",
    startFailed: "Could not start remote access",
    stopFailed: "Could not stop remote access",
    autoStartFailed: "Could not change start with code-viewer",
    valuesTitle: "Cloudflare values",
    unsaved: "Unsaved",
    valuesIntro:
      "Enter the values you noted in Cloudflare and press Save changes at the bottom. Saving while remote access is on applies them right away.",
    originLabel: "Public URL",
    teamDomainLabel: "Team domain",
    audienceLabel: "AUD",
    portLabel: "Listener port",
    tokenLabel: "Tunnel token",
    tokenPlaceholderSaved: "Saved. Paste only to replace it",
    tokenPlaceholderAbsent: "Paste the Tunnel's install command",
    tokenHelp:
      "You can paste the whole install command (cloudflared service install …); only the token is saved, in a file only you can read. It is never shown again.",
    portProblem: "The listener port must be a whole number from 1 to 65535.",
    saveFailed: "Could not save the remote access values",
    savedTo: (configPath, tokenPath) =>
      `Saved in ${configPath} (token: ${tokenPath}).`,
    fromFlag: (configPath, tokenPath) =>
      `Using the file given with --remote-access: ${configPath} (token: ${tokenPath}).`,
    logTitle: (lines) => `cloudflared output (last ${lines} lines)`,
    logEmpty: "No output yet.",
  },
  ja: {
    statusTitle: "状態",
    rowListener: "待ち受け",
    rowTunnel: "cloudflared",
    rowToken: "トークン",
    listenerRunning: "開いています",
    listenerStopped: "止まっています",
    listenerFailed: "開けませんでした",
    listenerTarget: (port, origin) => `127.0.0.1:${port}（${origin} 用）`,
    tunnelConnected: (connections) => `接続中（${connections} 本）`,
    tunnelWaiting: "接続しています",
    tunnelStopped: "止まっています",
    tunnelSkipped: "起動していません",
    tunnelExited: "止まりました",
    tunnelUnavailable: "使えません",
    tunnelSkippedDetail:
      "トークンが保存されていないので、cloudflared は起動していません。cloudflared を別に動かしているなら、このままで使えます。",
    tunnelProcess: (version, pid) => `cloudflared ${version}（pid ${pid}）`,
    cloudflaredVersion: (version) => `cloudflared ${version}`,
    install: "cloudflared を入れる",
    installing: "入れています",
    installHint:
      "「cloudflared を入れる」で Homebrew から入れます。ターミナルを開く必要はありません。",
    installingNote:
      "Homebrew で入れています。経過は下の「cloudflared の出力」に出ます。",
    installFailed: "cloudflared を入れられませんでした",
    tokenSaved: "保存済み",
    tokenAbsent: "未保存",
    tokenInvalid: "読めません",
    tokenTunnelId: (id) => `Tunnel ID ${id}`,
    start: "開始",
    stop: "停止",
    autoStart: "code-viewer の起動時に開始する",
    needValues: "下の Cloudflare の値を保存すると開始できます。",
    configInvalid:
      "設定ファイルを読めません。値を保存し直すと、読めないファイルを隣に退けて書き直します。",
    localOnly:
      "外部接続の開始・停止と値の変更は、code-viewer を動かしているパソコンの画面でだけ行えます。",
    standalone:
      "この code-viewer では外部接続を使えません。--standalone を付けずに起動してください（古い code-viewer が動いたままなら、止めて起動し直します）。",
    loading: "読み込んでいます…",
    loadFailed: "外部接続の状態を読めませんでした",
    startFailed: "外部接続を開始できませんでした",
    stopFailed: "外部接続を停止できませんでした",
    autoStartFailed: "起動時に開始するかを変えられませんでした",
    valuesTitle: "Cloudflare の値",
    unsaved: "未保存",
    valuesIntro:
      "Cloudflare の画面で控えた値を入れ、下の「変更を保存」で保存します。開始している間に保存すると、すぐ新しい値で開き直します。",
    originLabel: "公開 URL",
    teamDomainLabel: "Team domain",
    audienceLabel: "AUD",
    portLabel: "待ち受けのポート",
    tokenLabel: "Tunnel のトークン",
    tokenPlaceholderSaved: "保存済み。置き換えるときだけ貼り付けます",
    tokenPlaceholderAbsent: "Tunnel のインストールコマンドを貼り付け",
    tokenHelp:
      "インストールコマンド（cloudflared service install …）をそのまま貼れます。トークンだけを自分しか読めないファイルに保存し、画面には二度と出しません。",
    portProblem: "待ち受けのポートは 1〜65535 の整数にしてください。",
    saveFailed: "外部接続の値を保存できませんでした",
    savedTo: (configPath, tokenPath) =>
      `保存先: ${configPath}（トークン: ${tokenPath}）`,
    fromFlag: (configPath, tokenPath) =>
      `--remote-access で指定したファイルを使っています: ${configPath}（トークン: ${tokenPath}）`,
    logTitle: (lines) => `cloudflared の出力（最後の ${lines} 行）`,
    logEmpty: "まだ出力はありません。",
  },
};
