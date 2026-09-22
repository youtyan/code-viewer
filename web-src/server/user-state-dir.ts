// code-viewer のユーザー単位の状態ディレクトリ。全リポジトリ・全サーバで
// 共通のもの (フックの起動スクリプト、アカウントの登録簿、使用量の保存先)
// を置く。キャッシュ (~/.cache) に置くと掃除で消えて、エージェントの設定に
// 書いた呼び先を失うので、状態ディレクトリにする。

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

type Env = Record<string, string | undefined>;

let reportedRelativeStateHome = false;

export function codeViewerStateDir(
  env: Env = process.env,
  home: string = homedir(),
): string {
  // Test-only override; keeps tests from writing to the user's state dir.
  const override = env.CODE_VIEWER_TEST_STATE_DIR;
  if (override) return override;
  // 相対パスの XDG_STATE_HOME は無視する (XDG の決まり)。使うと、入口・裏・
  // フックがそれぞれの作業ディレクトリの下の別々の entry.json を見る。
  const stateHome = env.XDG_STATE_HOME;
  if (stateHome && !isAbsolute(stateHome) && !reportedRelativeStateHome) {
    reportedRelativeStateHome = true;
    console.error(
      `[code-viewer] ignoring XDG_STATE_HOME=${stateHome}: it must be an absolute path; using ${join(home, ".local", "state")}`,
    );
  }
  return join(
    stateHome && isAbsolute(stateHome)
      ? stateHome
      : join(home, ".local", "state"),
    "code-viewer",
  );
}
