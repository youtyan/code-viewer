// claude の statusLine を包む・戻す。
//
// claude の使用量 (5 時間枠・週枠) は statusLine に渡される JSON にしか
// 無い (https://code.claude.com/docs/en/statusline の rate_limits)。そこで
// settings.json の statusLine.command を「受け取った JSON を状態ディレクトリに
// 保存してから、元のコマンドにそのまま渡し、その出力をそのまま返す」
// スクリプト (包むスクリプト) に置き換える。
//
// 変える外部状態と戻し方 (server.md「外部状態を変える機能」):
//
// - `<設定ディレクトリ>/settings.json` の statusLine.command を
//   `<包むスクリプト> '<元のコマンド>'` に書き換える。元のコマンドはこの
//   引数にそのまま残るので、外すとそれを取り出して元に戻す。statusLine が
//   無かったときは包むスクリプトだけを入れ (最小の表示)、外すと statusLine
//   ごと消す。statusLine のほかの欄 (padding など) には触らない
// - 書く前のファイルは同じディレクトリに `settings.json.code-viewer-backup-<時刻>`
// - 包むスクリプトは `<状態ディレクトリ>/agent-usage/code-viewer-statusline`。
//   外しても残す (ほかのアカウントの settings.json がまだ使っているかも
//   しれないため)
//
// 検出は doctor の agent-accounts グループ (server/doctor.ts)。
// 書き方の約束 (読めなければ書かない・ハッシュの照合・バックアップ・
// 一時ファイルで置き換え・リンクのまま) は settings-file.ts。
//
// 包むスクリプトの約束: 元のコマンドを遅くしない・失敗させない。保存に
// 失敗しても元の出力と終了コードを返し、失敗は failures.log に残す。

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type {
  StatusLineAction,
  StatusLineApplyResponse,
  StatusLinePlanResponse,
  StatusLineState,
  StatusLineStatus,
} from "../../core/agent-accounts";
import { serializeHookFile } from "../../core/agent-hooks";
import { formatErrorDetail } from "../../core/error-detail";
import { unifiedDiff } from "../../core/text-diff";
import { shellSingleQuote } from "../cli-helpers";
import { shellWord } from "./hooks";
import {
  backupPathFor,
  commitJsonSettingsChange,
  contentHash,
  DEFAULT_WRITE_OPS,
  errno,
  type JsonFileRead,
  readJsonSettingsFile,
  type SettingsWriteOps,
  type ShapeIssue,
  settingsFileIdentity,
  settingsRevisionConflicts,
  writeBlockedReason,
  writeFileAtomic,
} from "./settings-file";

/** 包むスクリプトの名前。コマンド文字列にこれが入っていれば自分のもの。 */
export const STATUSLINE_MARKER = "code-viewer-statusline";

export function statusLineWrapperPath(usageDir: string): string {
  return join(usageDir, STATUSLINE_MARKER);
}

export function statusLineFailureLog(usageDir: string): string {
  return join(usageDir, "failures.log");
}

type JsonObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** statusLine を書き換えられる形か。 */
export function checkStatusLineShape(root: unknown): ShapeIssue[] {
  if (!isPlainObject(root)) {
    return [{ path: "$", message: "the file must contain a JSON object" }];
  }
  if (!("statusLine" in root)) return [];
  const line = root.statusLine;
  if (!isPlainObject(line)) {
    return [{ path: "$.statusLine", message: "statusLine must be an object" }];
  }
  if (typeof line.command !== "string") {
    return [
      { path: "$.statusLine.command", message: "command must be a string" },
    ];
  }
  if (line.type !== undefined && line.type !== "command") {
    return [
      {
        path: "$.statusLine.type",
        message: `unexpected type ${JSON.stringify(line.type)}`,
      },
    ];
  }
  return [];
}

export function wrappedCommand(wrapper: string, original: string | null) {
  return original === null
    ? shellWord(wrapper)
    : `${shellWord(wrapper)} ${shellSingleQuote(original)}`;
}

/** sh の単語 1 つ (引用符付きも可) を先頭から読む。 */
function readWord(
  text: string,
  from: number,
): { word: string; end: number } | null {
  let i = from;
  let word = "";
  let any = false;
  while (i < text.length && text[i] !== " ") {
    const ch = text[i] as string;
    if (ch === "'") {
      const close = text.indexOf("'", i + 1);
      if (close < 0) return null;
      word += text.slice(i + 1, close);
      i = close + 1;
    } else if (ch === "\\" && i + 1 < text.length) {
      word += text[i + 1];
      i += 2;
    } else if (ch === '"' || ch === "$" || ch === "`") {
      // 自分で書いた形 (単一引用符とエスケープだけ) 以外は読まない。
      return null;
    } else {
      word += ch;
      i += 1;
    }
    any = true;
  }
  return any ? { word, end: i } : null;
}

export type WrappedCommand =
  | { kind: "plain" }
  | { kind: "wrapped"; original: string | null }
  /** 印はあるが、自分で書いた形として読めない。 */
  | { kind: "unknown" };

/** statusLine.command が自分の包んだものかを見て、元のコマンドを取り出す。 */
export function parseWrappedCommand(command: string): WrappedCommand {
  if (!command.includes(STATUSLINE_MARKER)) return { kind: "plain" };
  const first = readWord(command, 0);
  if (!first?.word.endsWith(`/${STATUSLINE_MARKER}`))
    return { kind: "unknown" };
  const rest = command.slice(first.end);
  if (rest.trim() === "") return { kind: "wrapped", original: null };
  if (!rest.startsWith(" ")) return { kind: "unknown" };
  const second = readWord(rest, 1);
  if (!second || rest.slice(second.end).trim() !== "")
    return { kind: "unknown" };
  return { kind: "wrapped", original: second.word };
}

export type StatusLinePlan = {
  next: JsonObject;
  before: unknown;
  after: unknown;
  changed: boolean;
};

/**
 * 次に書く中身を決める。何度入れても増えない (包んだものは包み直さない)。
 * 外すと元の statusLine に戻る (無かったなら statusLine ごと消す)。
 */
export function planStatusLineChange(
  root: JsonObject | null,
  action: StatusLineAction,
  wrapper: string,
): StatusLinePlan {
  const base: JsonObject = root ? { ...root } : {};
  const before = base.statusLine;
  const same = { next: root ?? {}, before, after: before, changed: false };
  const line = isPlainObject(before) ? before : null;
  const parsed = line
    ? parseWrappedCommand(line.command as string)
    : ({ kind: "plain" } as WrappedCommand);
  if (parsed.kind === "unknown") {
    throw new Error(
      "statusLine.command names code-viewer-statusline but is not in the form code-viewer writes; edit it by hand",
    );
  }
  if (action === "install") {
    if (parsed.kind === "wrapped") {
      const want = wrappedCommand(wrapper, parsed.original);
      if (line?.command === want) return same;
      // 包むスクリプトの場所が変わった (状態ディレクトリを移した) ときは
      // 書き直す。元のコマンドはそのまま。
      const after = { ...line, command: want };
      return {
        next: { ...base, statusLine: after },
        before,
        after,
        changed: true,
      };
    }
    const after = line
      ? { ...line, command: wrappedCommand(wrapper, line.command as string) }
      : { type: "command", command: wrappedCommand(wrapper, null) };
    return {
      next: { ...base, statusLine: after },
      before,
      after,
      changed: true,
    };
  }
  if (parsed.kind !== "wrapped") return same;
  if (parsed.original === null) {
    delete base.statusLine;
    return { next: base, before, after: undefined, changed: true };
  }
  const after = { ...line, command: parsed.original };
  return { next: { ...base, statusLine: after }, before, after, changed: true };
}

export function statusLineStateOf(root: JsonObject | null): StatusLineState {
  const line = root?.statusLine;
  if (!isPlainObject(line)) return "none";
  const parsed = parseWrappedCommand(line.command as string);
  if (parsed.kind === "unknown") return "unreadable";
  if (parsed.kind === "plain") return "plain";
  return parsed.original === null ? "added" : "wrapped";
}

/**
 * 包むスクリプト。usageDir に受け取った JSON を保存し、元のコマンドに
 * 同じ入力を渡して、その出力と終了コードをそのまま返す。
 *
 * - 保存先の名前は CLAUDE_CONFIG_DIR の値 (既定なら空) の cksum
 *   (server/accounts/usage.ts が同じ計算で読む)
 * - 保存に失敗しても元のコマンドには必ず入力が届く (tee はファイルに
 *   書けなくても標準出力へ流し続ける)。失敗の stderr は failures.log へ
 * - 保存先のディレクトリが作れないときは tee を使わず、そのまま渡す
 * - Claude Code は、走っている statusLine を次の更新が来ると打ち切る。打ち切られても
 *   一時ファイルを残さないよう trap で消す (強制終了で残ったものは
 *   maintainStatusLineWrapper が消す)。以前は打ち切りのたびに 1 つずつ溜まっていた
 * - 元のコマンドが無い (statusLine が無かった) ときは、使用量を 1 行で出す
 */
export function statusLineWrapperScript(usageDir: string): string {
  return `#!/bin/sh
# Written by code-viewer. Wraps Claude Code's statusLine command: keeps the JSON
# it receives so code-viewer can show this account's usage, then runs the
# original command with the same input and returns its output unchanged.
# Remove it from Settings > Accounts in code-viewer (that restores the original).
dir=${shellSingleQuote(usageDir)}
log="$dir/failures.log"
key=$(printf '%s' "\${CLAUDE_CONFIG_DIR-}" | cksum)
key=\${key%% *}
tmp="$dir/.claude-$key.$$"
trap 'rm -f "$tmp"' EXIT
trap 'rm -f "$tmp"; exit 129' HUP
trap 'rm -f "$tmp"; exit 130' INT
trap 'rm -f "$tmp"; exit 143' TERM
save=1
[ -d "$dir" ] || mkdir -p "$dir" || save=0
[ -w "$dir" ] || save=0
if [ "$#" -gt 0 ]; then
  if [ "$save" = 1 ]; then
    tee "$tmp" 2>>"$log" | /bin/sh -c "$1"
  else
    /bin/sh -c "$1"
  fi
  status=$?
else
  if [ "$save" = 1 ]; then
    tee "$tmp" 2>>"$log"
  else
    cat
  fi | awk '{ s = s $0 } END {
    out = ""
    if (match(s, /"five_hour"[^}]*"used_percentage"[^0-9.]*[0-9.]+/)) {
      v = substr(s, RSTART, RLENGTH); sub(/.*[^0-9.]/, "", v)
      out = sprintf("5h %.0f%%", v)
    }
    if (match(s, /"seven_day"[^}]*"used_percentage"[^0-9.]*[0-9.]+/)) {
      v = substr(s, RSTART, RLENGTH); sub(/.*[^0-9.]/, "", v)
      out = out (out == "" ? "" : " · ") sprintf("7d %.0f%%", v)
    }
    print (out == "" ? "usage: n/a" : out)
  }'
  status=0
fi
if [ "$save" = 1 ]; then
  final="$dir/claude-$key.json"
  # 保存先がディレクトリだと mv はその中へ移して成功してしまうので、先に見る。
  if [ -s "$tmp" ] && [ ! -d "$final" ] && mv -f "$tmp" "$final" 2>>"$log"; then
    :
  else
    printf '%s could not save the statusline input for key %s\\n' "$(date +%s)" "$key" >>"$log"
    rm -f "$tmp" 2>>"$log"
  fi
else
  printf 'code-viewer: cannot write %s; usage was not saved\\n' "$dir" >&2
fi
exit $status
`;
}

export function statusLineWrapperHealth(
  usageDir: string,
): "ok" | "missing" | "outdated" {
  const path = statusLineWrapperPath(usageDir);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (errno(error) === "ENOENT") return "missing";
    throw error;
  }
  return text === statusLineWrapperScript(usageDir) ? "ok" : "outdated";
}

/** 打ち切りで残った一時ファイルとみなす古さ。statusLine は数秒で終わる。 */
export const STATUSLINE_TEMP_STALE_MS = 10 * 60 * 1000;

/**
 * 包むスクリプトの手入れ。code-viewer が新しくした中身 (outdated) なら書き直す
 * (code-viewer 自身のファイルで、利用者の設定には触らない。無いものは作らない)。
 * 打ち切り・強制終了で残った一時ファイル (`.claude-<key>.<pid>`) のうち古いものを
 * 消す。できなかったことは理由の文で返す (投げない。一覧の表示は止めない)。
 */
export function maintainStatusLineWrapper(
  usageDir: string,
  now: number,
): string[] {
  const problems: string[] = [];
  try {
    if (statusLineWrapperHealth(usageDir) === "outdated")
      writeStatusLineWrapper(usageDir);
  } catch (error) {
    problems.push(
      `could not update ${statusLineWrapperPath(usageDir)}: ${formatErrorDetail(error)}`,
    );
  }
  let names: string[];
  try {
    names = readdirSync(usageDir);
  } catch (error) {
    if (errno(error) === "ENOENT") return problems;
    problems.push(`could not list ${usageDir}: ${formatErrorDetail(error)}`);
    return problems;
  }
  for (const name of names) {
    if (!/^\.claude-\d+\.\d+$/.test(name)) continue;
    const path = join(usageDir, name);
    try {
      if (now - statSync(path).mtimeMs < STATUSLINE_TEMP_STALE_MS) continue;
      unlinkSync(path);
    } catch (error) {
      if (errno(error) === "ENOENT") continue;
      problems.push(`could not remove ${path}: ${formatErrorDetail(error)}`);
    }
  }
  return problems;
}

/** 包むスクリプトを書く (同じなら書かない)。書いたら true。 */
export function writeStatusLineWrapper(usageDir: string): boolean {
  if (statusLineWrapperHealth(usageDir) === "ok") return false;
  const path = statusLineWrapperPath(usageDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileAtomic(path, statusLineWrapperScript(usageDir), 0o755);
  return true;
}

export function claudeSettingsPath(configDir: string): string {
  return join(configDir, "settings.json");
}

function read(configDir: string): { path: string; read: JsonFileRead } {
  const path = claudeSettingsPath(configDir);
  return {
    path,
    read: readJsonSettingsFile(configDir, path, checkStatusLineShape),
  };
}

export function statusLineStatus(
  configDir: string,
  usageDir: string,
): StatusLineStatus {
  const { path, read: file } = read(configDir);
  const base = {
    path,
    realPath: file.kind === "missing-dir" ? path : file.realPath,
    symlink:
      file.kind === "ok" || file.kind === "unreadable" ? file.symlink : false,
    writeBlocked: writeBlockedReason(path, file),
    detail: "",
    command: "",
    wrapperMissing: false,
  };
  if (file.kind === "missing-dir") return { ...base, state: "no-config-dir" };
  if (file.kind === "unreadable") {
    return { ...base, state: "unreadable", detail: file.detail };
  }
  const root = file.kind === "ok" ? file.root : null;
  const state = statusLineStateOf(root);
  const line = root?.statusLine;
  const command =
    isPlainObject(line) && typeof line.command === "string" ? line.command : "";
  const parsed = parseWrappedCommand(command);
  let wrapperMissing = false;
  if (state === "wrapped" || state === "added") {
    try {
      wrapperMissing = statusLineWrapperHealth(usageDir) === "missing";
    } catch (error) {
      return {
        ...base,
        state: "unreadable",
        detail: `cannot read ${statusLineWrapperPath(usageDir)}: ${formatErrorDetail(error)}`,
      };
    }
  }
  return {
    ...base,
    state,
    detail:
      state === "unreadable"
        ? "statusLine.command names code-viewer-statusline but is not in the form code-viewer writes"
        : "",
    command: parsed.kind === "wrapped" ? (parsed.original ?? "") : command,
    wrapperMissing,
  };
}

export class StatusLineError extends Error {
  constructor(
    message: string,
    readonly code: "conflict" | "blocked" | "unreadable" | "failed",
    options?: { cause?: unknown },
  ) {
    super(message);
    if (options && "cause" in options) {
      Object.assign(this, { cause: options.cause });
    }
  }
}

export function planStatusLine(
  configDir: string,
  action: StatusLineAction,
  usageDir: string,
  now: Date = new Date(),
): StatusLinePlanResponse {
  const { path, read: file } = read(configDir);
  if (file.kind === "missing-dir") {
    throw new StatusLineError(
      `the claude settings directory does not exist: ${configDir}`,
      "unreadable",
    );
  }
  if (file.kind === "unreadable") {
    throw new StatusLineError(
      `cannot read ${path}; nothing was changed.\n${file.detail}`,
      "unreadable",
    );
  }
  const root = file.kind === "ok" ? file.root : null;
  const wrapper = statusLineWrapperPath(usageDir);
  let plan: StatusLinePlan;
  try {
    plan = planStatusLineChange(root, action, wrapper);
  } catch (error) {
    throw new StatusLineError(formatErrorDetail(error), "unreadable", {
      cause: error,
    });
  }
  const original = file.kind === "ok" ? file.text : null;
  return {
    action,
    configDir,
    path,
    realPath: file.realPath,
    symlink: file.kind === "ok" ? file.symlink : false,
    fileExists: file.kind === "ok",
    before: plan.before ?? null,
    after: plan.after ?? null,
    changed: plan.changed,
    diff: plan.changed
      ? unifiedDiff(
          original,
          serializeHookFile(plan.next, original),
          basename(path),
        )
      : "",
    backupPath:
      plan.changed && file.kind === "ok" ? backupPathFor(path, now) : null,
    formattingChanged:
      original !== null && serializeHookFile(root, original) !== original,
    wrapper: {
      path: wrapper,
      write: action === "install" && statusLineWrapperHealth(usageDir) !== "ok",
    },
    usageDir,
    writeBlocked: writeBlockedReason(path, file),
    baseHash: contentHash(file),
    fileIdentity: settingsFileIdentity(file),
  };
}

export async function applyStatusLine(
  configDir: string,
  action: StatusLineAction,
  usageDir: string,
  expected: Pick<
    StatusLinePlanResponse,
    "baseHash" | "realPath" | "fileIdentity"
  >,
  now: Date = new Date(),
  ops: SettingsWriteOps = DEFAULT_WRITE_OPS,
): Promise<StatusLineApplyResponse> {
  const plan = planStatusLine(configDir, action, usageDir, now);
  const conflicts = settingsRevisionConflicts(plan, expected);
  if (conflicts.length > 0) {
    throw new StatusLineError(
      `${plan.path} changed after it was shown for confirmation; nothing was changed. Review it again.\n${conflicts.map((reason) => `- ${reason}`).join("\n")}`,
      "conflict",
    );
  }
  if (plan.writeBlocked && plan.changed) {
    throw new StatusLineError(
      `cannot write ${plan.realPath}; nothing was changed.\n${plan.writeBlocked}`,
      "blocked",
    );
  }
  let wrapperWritten = false;
  if (action === "install") {
    try {
      wrapperWritten = writeStatusLineWrapper(usageDir);
    } catch (error) {
      throw new StatusLineError(
        `failed to write ${plan.wrapper.path}; the settings file was not changed.`,
        "failed",
        { cause: error },
      );
    }
  }
  if (!plan.changed) {
    return {
      path: plan.path,
      changed: false,
      backupPath: null,
      wrapperWritten,
    };
  }
  const wrapper = statusLineWrapperPath(usageDir);
  const { backupPath } = await commitJsonSettingsChange({
    configDir,
    path: plan.path,
    check: checkStatusLineShape,
    ...expected,
    next: (root, text) =>
      serializeHookFile(planStatusLineChange(root, action, wrapper).next, text),
    now,
    ops,
    error: (code, message, cause) =>
      new StatusLineError(
        message,
        code,
        cause === undefined ? undefined : { cause },
      ),
  });
  return { path: plan.path, changed: true, backupPath, wrapperWritten };
}

/** 包むスクリプトの失敗の記録 (新しい順)。 */
export function readStatusLineFailures(
  usageDir: string,
  limit = 10,
): { total: number; recent: string[]; log: string } {
  const log = statusLineFailureLog(usageDir);
  let text: string;
  try {
    text = readFileSync(log, "utf8");
  } catch (error) {
    if (errno(error) === "ENOENT") return { total: 0, recent: [], log };
    throw error;
  }
  const lines = text.split("\n").filter(Boolean);
  return { total: lines.length, recent: lines.slice(-limit).reverse(), log };
}
