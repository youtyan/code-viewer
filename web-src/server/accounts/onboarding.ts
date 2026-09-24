// code-viewer が作った claude のアカウントに、Claude Code の「初回の案内を済ませた」
// 印 (設定ディレクトリの .claude.json の hasCompletedOnboarding) を足す。
//
// `claude auth login` はログインだけを保存し、この印を付けない。対話の画面は
// ログインが有効かではなくこの印を見るので、code-viewer でログインしたアカウントを
// 開くと、テーマの選択からログインの方法の選択まで初回の案内をやり直させた
// (`claude auth status` はログイン済みと答えるのに)。上流では対応しないと閉じられ、
// 回避策としてこの印を足すことが挙がっている:
// https://github.com/anthropics/claude-code/issues/67149
//
// .claude.json は Claude Code の内部のファイルで、書式は公式に約束されていない。
// 触るのはこの 1 項目だけで、ほかの項目は読んだまま書き戻す。印がもう付いていれば
// 書かない。書くときは同じディレクトリの一時ファイルから rename する (途中で
// 読まれても壊れたファイルを見せない)。読めない・JSON でないときは書かずに理由を返す。

import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatErrorDetail } from "../../core/error-detail";

export type OnboardingMark =
  | { status: "marked" | "already" }
  /** .claude.json がまだ無い (ログインがまだ書いていない)。何もしない。 */
  | { status: "no-file" }
  | { status: "failed"; detail: string };

const ONBOARDING_KEY = "hasCompletedOnboarding";

export async function markClaudeOnboarded(
  configDir: string,
): Promise<OnboardingMark> {
  const file = join(configDir, ".claude.json");
  let text: string;
  let mode: number;
  try {
    [text, mode] = await Promise.all([
      readFile(file, "utf8"),
      stat(file).then((info) => info.mode & 0o777),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "no-file" };
    }
    return {
      status: "failed",
      detail: `could not read ${file}: ${formatErrorDetail(error)}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // JSON.parse のエラー文は入力の一部を引用するので載せない (識別情報が入る)。
    return {
      status: "failed",
      detail: `${file} is not valid JSON (${text.length} characters; ${(error as Error).name})`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "failed", detail: `${file} is not a JSON object` };
  }
  const record = parsed as Record<string, unknown>;
  if (record[ONBOARDING_KEY] === true) return { status: "already" };
  record[ONBOARDING_KEY] = true;
  const temp = `${file}.code-viewer-${process.pid}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { mode });
    await rename(temp, file);
  } catch (error) {
    const detail = `could not write ${file}: ${formatErrorDetail(error)}`;
    try {
      await unlink(temp);
    } catch (cleanup) {
      if ((cleanup as NodeJS.ErrnoException).code !== "ENOENT") {
        return {
          status: "failed",
          detail: `${detail}; the temporary file ${temp} is left: ${formatErrorDetail(cleanup)}`,
        };
      }
    }
    return { status: "failed", detail };
  }
  return { status: "marked" };
}
