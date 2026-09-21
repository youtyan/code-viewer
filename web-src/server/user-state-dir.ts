// code-viewer のユーザー単位の状態ディレクトリ。全リポジトリ・全サーバで
// 共通のもの (フックの起動スクリプト、アカウントの登録簿、使用量の保存先)
// を置く。キャッシュ (~/.cache) に置くと掃除で消えて、エージェントの設定に
// 書いた呼び先を失うので、状態ディレクトリにする。

import { homedir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

export function codeViewerStateDir(
  env: Env = process.env,
  home: string = homedir(),
): string {
  // Test-only override; keeps tests from writing to the user's state dir.
  const override = env.CODE_VIEWER_TEST_STATE_DIR;
  if (override) return override;
  return join(
    env.XDG_STATE_HOME || join(home, ".local", "state"),
    "code-viewer",
  );
}
