// tmux のペイン一覧をセッション → ウィンドウ → ペインのツリーにして返す。
//
// `list-panes -a` の 1 回で全セッションぶんが取れるので、セッション一覧と
// ウィンドウ一覧を別々に引かない。並び順は tmux の出力順をそのまま保つ
// (tmux 側がセッション名・ウィンドウ番号・ペイン番号の順で出す)。

import type {
  TmuxPane,
  TmuxPanesResponse,
  TmuxSession,
  TmuxWindow,
} from "../../core/tmux";
import { runTmux } from "./command";

/**
 * フィールド区切り。ASCII の Unit Separator (0x1F)。タブや空白と違い、
 * ペインタイトルにもパスにも現れない。生の制御文字をソースに直接置くと、
 * 見た目が空文字と区別できず、消えていても気付けない。必ずこの形で書く。
 */
const FIELD_SEP = String.fromCharCode(31);

const PANE_FIELDS = [
  "#{pane_id}",
  "#{session_name}",
  "#{session_attached}",
  "#{window_index}",
  "#{window_name}",
  "#{window_active}",
  "#{pane_index}",
  "#{pane_active}",
  "#{pane_width}",
  "#{pane_height}",
  "#{pane_current_command}",
  "#{pane_current_path}",
  // タイトルは自由文字列なので必ず最後に置く。
  "#{pane_title}",
];

const PANE_FORMAT = PANE_FIELDS.join(FIELD_SEP);

/** PANE_FIELDS の並びと 1 対 1 に対応する列位置。 */
const FIELD = {
  paneId: 0,
  sessionName: 1,
  sessionAttached: 2,
  windowIndex: 3,
  windowName: 4,
  windowActive: 5,
  paneIndex: 6,
  paneActive: 7,
  paneWidth: 8,
  paneHeight: 9,
  paneCommand: 10,
  panePath: 11,
  paneTitle: 12,
} as const;

function toInt(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFlag(value: string | undefined): boolean {
  return value === "1";
}

/**
 * `list-panes -F` の出力をツリーにする。tmux を呼ばない純粋な変換なので、
 * ここだけをテストすれば書式の取り違えを検出できる。
 *
 * 列数が足りない行は捨てる。tmux の警告が stdout に混ざっても落ちない。
 */
export function parseTmuxPanes(stdout: string): TmuxSession[] {
  const sessions: TmuxSession[] = [];
  const sessionByName = new Map<string, TmuxSession>();
  const windowByKey = new Map<string, TmuxWindow>();

  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const fields = line.split(FIELD_SEP);
    if (fields.length < PANE_FIELDS.length) continue;
    const paneId = fields[FIELD.paneId];
    if (!paneId) continue;

    const sessionName = fields[FIELD.sessionName] ?? "";
    let session = sessionByName.get(sessionName);
    if (!session) {
      session = {
        name: sessionName,
        attached: toFlag(fields[FIELD.sessionAttached]),
        windows: [],
      };
      sessionByName.set(sessionName, session);
      sessions.push(session);
    }

    const windowIndex = toInt(fields[FIELD.windowIndex]);
    const windowKey = `${sessionName}${FIELD_SEP}${windowIndex}`;
    let window = windowByKey.get(windowKey);
    if (!window) {
      window = {
        index: windowIndex,
        name: fields[FIELD.windowName] ?? "",
        active: toFlag(fields[FIELD.windowActive]),
        panes: [],
      };
      windowByKey.set(windowKey, window);
      session.windows.push(window);
    }

    const paneIndex = toInt(fields[FIELD.paneIndex]);
    const pane: TmuxPane = {
      id: paneId,
      label: `${sessionName}:${windowIndex}.${paneIndex}`,
      paneIndex,
      title: fields[FIELD.paneTitle] ?? "",
      command: fields[FIELD.paneCommand] ?? "",
      path: fields[FIELD.panePath] ?? "",
      width: toInt(fields[FIELD.paneWidth]),
      height: toInt(fields[FIELD.paneHeight]),
      active: toFlag(fields[FIELD.paneActive]),
    };
    window.panes.push(pane);
  }

  return sessions;
}

/** tmux が無い / サーバが動いていない場合も、例外ではなく空の一覧で返す。 */
export async function listTmuxPanes(cwd: string): Promise<TmuxPanesResponse> {
  const result = await runTmux(["list-panes", "-a", "-F", PANE_FORMAT], cwd);
  if (result.status === "missing") {
    return { available: false, running: false, sessions: [] };
  }
  // no-target は -a (全セッション) では起きないが、tmux が空の一覧を
  // ターゲット不在として返す実装もありうるので空として扱う。
  if (result.status === "no-server" || result.status === "no-target") {
    return { available: true, running: false, sessions: [] };
  }
  if (result.status === "error") {
    // ローカルの閲覧ツールなので、tmux 側の不調で画面ごと落とさない。
    console.warn(`[code-viewer] tmux list-panes failed: ${result.message}`);
    return { available: true, running: false, sessions: [] };
  }
  return {
    available: true,
    running: true,
    sessions: parseTmuxPanes(result.stdout),
  };
}
