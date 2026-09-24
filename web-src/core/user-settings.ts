// 人に付く設定 (テーマ・言語・文字の大きさ・キー割り当て・通知…) を、
// リポジトリごとの設定から分けてユーザー単位に置くための純ロジック。
//
// プロジェクトを移っても (別のリポジトリのサーバへ移っても) 見た目と操作が
// 変わらないようにする。閲覧済みの印・注釈・画面ルールの上書きなど、
// リポジトリの中身に付くものはここに入れない。
//
// 読むときは、ユーザー単位の設定があればその項目はそれだけを使う (項目が
// 無ければ既定値。リポジトリの値へは戻らない: 戻ると、ある画面で既定に
// 戻した設定が、別のリポジトリの古い値で復活してしまう)。ユーザー単位の
// 設定がまだ無いとき (この版を初めて使うとき) だけ、リポジトリの値を使う。

import type { AppSettingsState } from "./types";

// 骨格の見た目 (左のサイドバーの幅・畳み・畳んだプロジェクト、下のパネルの
// 高さ) もここに入れる。localStorage はオリジン (ポート) ごとで、ポートは
// 続かない: 入口のサーバは `--port` を付けなければ起動のたびに OS が選ぶ
// ポートで待ち受ける (`server/entry/args.ts` の既定が 0) ので、code-viewer を
// 起こし直すとオリジンが変わり、localStorage は空から始まる (`--standalone`
// のサーバもそれぞれ別のポート)。決まりの本体は project-rules の ui-layout.md。
export const USER_SETTING_KEYS = [
  "theme",
  "palette",
  "language",
  /** 文字の大きさと、それに連動する表示の密度 (body[data-sidebar-font-size])。 */
  "sidebarFontSize",
  "codeFontSize",
  "keybindings",
  "agentNotifyWaiting",
  "agentNotifyDone",
  "agentHookHintDismissed",
  "agentNotifyHintDismissed",
  "agentAccountsCollapsed",
  "terminalImageShelfCollapsed",
  "terminalPanelOpen",
  "navCollapsed",
  "navWidth",
  "navCollapsedProjects",
  "navStoppedProjectsOpen",
  "lastProjectRoot",
] as const satisfies readonly (keyof AppSettingsState)[];

export type UserSettingKey = (typeof USER_SETTING_KEYS)[number];

export type UserSettingsState = { version: 1 } & Pick<
  AppSettingsState,
  UserSettingKey
>;

const USER_KEY_SET: ReadonlySet<string> = new Set(USER_SETTING_KEYS);

export function isUserSettingKey(key: string): key is UserSettingKey {
  return USER_KEY_SET.has(key);
}

/** 設定のうち、ユーザー単位の項目だけ (初回の引き継ぎに使う)。 */
export function pickUserSettings(
  settings: Partial<AppSettingsState>,
): UserSettingsState {
  const out: Record<string, unknown> = { version: 1 };
  for (const key of USER_SETTING_KEYS) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }
  return out as UserSettingsState;
}

/**
 * 画面に返す設定。ユーザー単位の設定が無ければリポジトリの設定そのまま。
 * あれば、ユーザー単位の項目はリポジトリの値を使わずユーザー単位の値だけ。
 */
export function withUserSettings(
  repo: AppSettingsState,
  user: UserSettingsState | null,
): AppSettingsState {
  if (!user) return repo;
  const out: Record<string, unknown> = { ...repo };
  for (const key of USER_SETTING_KEYS) {
    if (user[key] === undefined) delete out[key];
    else out[key] = user[key];
  }
  return out as AppSettingsState;
}

/** 画面からの変更を、ユーザー単位とリポジトリの分に分ける。 */
export function splitSettingsPatch(patch: Record<string, unknown>): {
  user: Record<string, unknown>;
  repo: Record<string, unknown>;
} {
  const user: Record<string, unknown> = {};
  const repo: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "version") continue;
    if (isUserSettingKey(key)) user[key] = value;
    else repo[key] = value;
  }
  return { user, repo };
}
