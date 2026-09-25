// code-viewer が claude を起こすとき (新しいエージェント・別のアカウントで続ける・
// このアカウントで開く。どれも POST /_agent/launch)、起動するフォルダの
// プロジェクトの設定に statusLine があると、ユーザーの設定の (包んだ) statusLine
// より優先され、そのセッションから使用量が保存されない。そのアカウントで使用量を
// 記録しているときだけ、プロジェクトの statusLine を包んだものを --settings で
// 渡す (表示はそのプロジェクトのまま。padding などほかの欄も引き継ぐ)。
//
// どのファイルの statusLine が効くかは Claude Code と同じ順で決める
// (https://code.claude.com/docs/en/settings の「Settings files and precedence」と
// 「Where Claude Code keeps the local file in a git repository」):
//
// 1. `.claude/settings.local.json` を git のリポジトリのルート (worktree なら本体の
//    ルート) で読む。git の外・ルートがホームのときは起動したフォルダ
// 2. 起動したフォルダの `.claude/settings.local.json` (以前の版が置いたもの。
//    ルートのものと同じ欄はルートが勝つ)
// 3. 起動したフォルダ (primary working directory) の `.claude/settings.json`
//
// この順は Claude Code の内部の読み方で、版が変われば変わりうる (agents.md の
// 11「内部形式に頼っている箇所」)。

import { dirname, join } from "node:path";
import { formatErrorDetail } from "../../core/error-detail";
import { projectRootResultAsync } from "../git";
import { readJsonSettingsFile } from "../terminal/settings-file";
import {
  checkStatusLineShape,
  isPlainObject,
  parseWrappedCommand,
  wrappedCommand,
} from "../terminal/statusline";
import { statusLineSettingsArgs } from "./launch";

export type ProjectStatusLine =
  /** プロジェクトの設定に statusLine が無い (ユーザーの設定の包みが効く)。 */
  | { kind: "none" }
  /** 効く statusLine が既に包んである。 */
  | { kind: "wrapped"; path: string }
  | { kind: "found"; path: string; line: Record<string, unknown> }
  /** 効くファイルが読めない・形が違う・git のルートが分からない。 */
  | { kind: "unreadable"; path: string; detail: string };

/** statusLine を探すファイル。前にあるものほど強い。 */
export function projectSettingsFiles(
  folder: string,
  gitRoot: string | null,
  home: string,
): string[] {
  const files: string[] = [];
  const startLocal = join(folder, ".claude", "settings.local.json");
  if (gitRoot && gitRoot !== home) {
    files.push(join(gitRoot, ".claude", "settings.local.json"));
  }
  if (!files.includes(startLocal)) files.push(startLocal);
  files.push(join(folder, ".claude", "settings.json"));
  return files;
}

/** 起動するフォルダで効くプロジェクトの statusLine。 */
export async function projectStatusLine(
  folder: string,
  home: string,
): Promise<ProjectStatusLine> {
  const root = await projectRootResultAsync(folder, folder);
  if (root.kind === "error") {
    return {
      kind: "unreadable",
      path: folder,
      detail: `could not find the git repository of ${folder}: ${root.error}`,
    };
  }
  const files = projectSettingsFiles(
    folder,
    root.kind === "root" ? root.root : null,
    home,
  );
  for (const path of files) {
    const read = readJsonSettingsFile(
      dirname(path),
      path,
      checkStatusLineShape,
    );
    if (read.kind === "missing" || read.kind === "missing-dir") continue;
    if (read.kind === "unreadable") {
      return { kind: "unreadable", path, detail: read.detail };
    }
    const line = read.root.statusLine;
    if (line === undefined) continue;
    // 形は checkStatusLineShape が見た (object で command が文字列)。
    if (!isPlainObject(line) || typeof line.command !== "string") {
      return {
        kind: "unreadable",
        path,
        detail: "statusLine is not an object with a command",
      };
    }
    if (parseWrappedCommand(line.command).kind !== "plain") {
      return { kind: "wrapped", path };
    }
    return { kind: "found", path, line };
  }
  return { kind: "none" };
}

export type LaunchStatusLine = {
  /** claude の起動コマンドに足す引数。足さないなら空。 */
  args: string[];
  /** 足せなかった理由 (起動の結果とサーバのログに出す)。無ければ空。 */
  problem: string;
};

/**
 * 起動に足す --settings。recording はそのアカウントで使用量を記録しているか
 * (statusLine を包んでいて包むスクリプトがある)。wrapper は包むスクリプト。
 */
export async function launchStatusLineArgs(options: {
  recording: boolean;
  wrapper: string;
  folder: string;
  home: string;
}): Promise<LaunchStatusLine> {
  if (!options.recording) return { args: [], problem: "" };
  let found: ProjectStatusLine;
  try {
    found = await projectStatusLine(options.folder, options.home);
  } catch (error) {
    found = {
      kind: "unreadable",
      path: options.folder,
      detail: formatErrorDetail(error),
    };
  }
  if (found.kind === "unreadable") {
    const problem = `the project statusLine in ${found.path} could not be read, so this session does not record usage:\n${found.detail}`;
    console.error(`[code-viewer] launch: ${problem}`);
    return { args: [], problem };
  }
  if (found.kind !== "found") return { args: [], problem: "" };
  const command =
    typeof found.line.command === "string" ? found.line.command : "";
  return {
    args: statusLineSettingsArgs({
      ...found.line,
      command: wrappedCommand(options.wrapper, command),
    }),
    problem: "",
  };
}
