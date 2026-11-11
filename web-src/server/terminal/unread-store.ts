// 未読と「状態が変わった時刻」を、サーバの起動を跨いで覚えておく。
//
// 状態 (作業中・待機など) そのものは保存しない (agents.md 2。古い状態を戻すと、
// 終わったものを待ちと出す)。保存するのは、変わった瞬間を見た時刻と、まだ
// 見ていない変化 (未読) だけ。`pnpm dev` や入口の起動し直しのたびに、未読が
// 全部消え、経過時間が全部「–」になっていた。
//
// 読み戻すのは、起きた後にそのペインを初めて記録したとき (recordAgentState の
// 最初の記録) に、次を全部満たすものだけ (decideUnreadRestore):
// - 同じ tmux のサーバの世代のペイン (ペイン ID は tmux を起こし直すと使い回される)
// - 最初の記録が画面の観測 (申告が先に届いたなら、それが新しい出来事)
// - 最初に観測した状態が、保存したときと同じ組 (止まっている = 待機・完了、
//   入力待ち、作業中)。違えば、止まっていた間に何か起きたので戻さない
// 未読は「入力待ち」なら入力待ちのとき、「終わった」なら止まっているときだけ戻す。
//
// 読めない・壊れた保存は使わず、上書きもしない (理由をログと一覧の errors に出す)。
// 複数のサーバ (入口と --standalone) が同じファイルを書くので、ロックの中で
// 読み直してから自分の中身で置き換える。書くのは変化のあと UNREAD_SAVE_DELAY_MS
// まとめて 1 回 (巡回のたびに書かない)。

import { join } from "node:path";
import type { AgentTransition } from "../../core/agent-overview";
import {
  AGENT_STATES,
  type AgentState,
  type AgentStateObservationError,
  type AgentStateRecord,
} from "../../core/agent-state";
import { isTmuxPaneId } from "../../core/tmux";
import { type RegistryFileRead, readRegistryFile } from "../registry-file";
import { codeViewerStateDir } from "../user-state-dir";
import {
  type AgentRecordListener,
  agentRecordsSnapshot,
  currentAgentTmuxGeneration,
  MAX_TRACKED_TARGETS,
  onAgentRecord,
} from "./agent-state";
import { createSavedStoreErrors, writeSavedStore } from "./saved-store";
import {
  agentUnreadSnapshot,
  onAgentUnreadChanged,
  restoreAgentUnread,
} from "./unread";

const FILE_VERSION = 1;

/** 変化のあと、まとめて書くまでの待ち。 */
export const UNREAD_SAVE_DELAY_MS = 2000;

const TRANSITIONS = ["waiting", "finished"] as const;

/** 保存の 1 件 (tmux のペイン 1 つ)。 */
export type SavedAgentUnread = {
  generation: string;
  target: string;
  /** 保存したときの状態。読み戻すとき、最初に観測した状態と比べる。 */
  state: AgentState;
  /** その状態になった瞬間を見た時刻 (epoch ms)。見ていなければ 0。 */
  changedAt: number;
  /** まだ見ていない変化。無ければ無い。 */
  unread?: AgentTransition;
};

export function agentUnreadPath(): string {
  return join(codeViewerStateDir(), "agent-unread.json");
}

export function parseSavedUnread(
  raw: unknown,
):
  | { ok: true; registry: SavedAgentUnread[] }
  | { ok: false; issues: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, issues: ["expected an object"] };
  }
  const file = raw as Record<string, unknown>;
  if (file.version !== FILE_VERSION) {
    return {
      ok: false,
      issues: [
        `version: expected ${FILE_VERSION}, got ${JSON.stringify(file.version)}`,
      ],
    };
  }
  if (!Array.isArray(file.entries)) {
    return { ok: false, issues: ["entries: expected an array"] };
  }
  const issues: string[] = [];
  const entries: SavedAgentUnread[] = [];
  file.entries.forEach((value: unknown, index) => {
    const at = `entries[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      issues.push(`${at}: expected an object`);
      return;
    }
    const entry = value as Record<string, unknown>;
    const problems: string[] = [];
    if (typeof entry.generation !== "string" || !entry.generation)
      problems.push("generation is not a non-empty string");
    if (!isTmuxPaneId(entry.target))
      problems.push("target is not a tmux pane id");
    if (!(AGENT_STATES as readonly unknown[]).includes(entry.state))
      problems.push("state is not an agent state");
    if (
      !Number.isSafeInteger(entry.changedAt) ||
      (entry.changedAt as number) < 0
    )
      problems.push("changedAt is not a non-negative integer");
    if (
      entry.unread !== undefined &&
      !(TRANSITIONS as readonly unknown[]).includes(entry.unread)
    )
      problems.push("unread is not waiting or finished");
    if (problems.length > 0) {
      issues.push(...problems.map((problem) => `${at}: ${problem}`));
      return;
    }
    entries.push(value as SavedAgentUnread);
  });
  if (entries.length > MAX_TRACKED_TARGETS) {
    issues.push(
      `entries: ${entries.length} entries, more than ${MAX_TRACKED_TARGETS}`,
    );
  }
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, registry: entries };
}

export function readSavedUnread(
  path: string,
): RegistryFileRead<SavedAgentUnread[]> {
  return readRegistryFile(path, parseSavedUnread, () => []);
}

/** 状態の組。待機と完了は「止まっている」で同じ (完了は読めば待機に戻る)。 */
function stateGroup(state: AgentState): "stopped" | "waiting" | "working" {
  return state === "idle" || state === "done" ? "stopped" : state;
}

/**
 * 保存した 1 件を、起きた後の最初の記録に戻してよいか。戻すもの (経過時間の
 * 時刻・未読) を返す。戻さないなら null。
 */
export function decideUnreadRestore(
  saved: SavedAgentUnread,
  first: { state: AgentState; fromHook: boolean },
  generation: string,
): { changedAt: number; unread: AgentTransition | null } | null {
  if (saved.generation !== generation || first.fromHook) return null;
  if (stateGroup(saved.state) !== stateGroup(first.state)) return null;
  const unread =
    saved.unread === "waiting" && first.state === "waiting"
      ? "waiting"
      : saved.unread === "finished" && stateGroup(first.state) === "stopped"
        ? "finished"
        : null;
  if (saved.changedAt === 0 && unread === null) return null;
  return { changedAt: saved.changedAt, unread };
}

/** 保存の中身。変わった瞬間を見たもの・未読のあるものだけを書く。 */
export function savedUnreadText(
  generation: string,
  records: readonly (readonly [string, AgentStateRecord])[],
  unread: ReadonlyMap<string, AgentTransition>,
): string {
  const entries: SavedAgentUnread[] = [];
  for (const [key, record] of records) {
    const transition = unread.get(key);
    if (!record.changeObserved && !transition) continue;
    entries.push({
      generation,
      target: record.target,
      state: record.state,
      changedAt: record.changeObserved ? record.updatedAt : 0,
      ...(transition ? { unread: transition } : {}),
    });
  }
  entries.sort((a, b) => b.changedAt - a.changedAt);
  return `${JSON.stringify(
    { version: FILE_VERSION, entries: entries.slice(0, MAX_TRACKED_TARGETS) },
    null,
    2,
  )}\n`;
}

/** ロックの中で読み直し、読めれば置き換える。読めない保存は上書きしない。 */
export function writeSavedUnread(path: string, text: string): Promise<void> {
  return writeSavedStore(path, text, readSavedUnread, "the saved unread marks");
}

// ---- サーバの中の保存と読み戻し (巡回するサーバだけが使う) ----

type Persistence = {
  path: string;
  /** 起動時に読んだ保存 (ペイン ID ごと)。最初の記録で 1 件ずつ使い切る。 */
  pending: Map<string, SavedAgentUnread>;
  /** 保存を読めなかった。書かない (上書きしない)。 */
  unreadable: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  writing: Promise<void> | null;
  dirty: boolean;
};

let persistence: Persistence | null = null;
const errors = createSavedStoreErrors({
  what: "the unread marks of the agents",
  restore: "restore_unread",
  save: "save_unread",
  path: () => persistence?.path ?? "",
});
const setError = errors.set;

/** 一覧の errors に載せる、保存と読み戻しの失敗。 */
export function getUnreadStoreErrors(): AgentStateObservationError[] {
  return errors.list();
}

function writeNow(current: Persistence): Promise<void> {
  current.writing ??= (async () => {
    while (current.dirty) {
      current.dirty = false;
      const snapshot = agentRecordsSnapshot();
      // 世代が分かるまでは書かない (前の世代の保存を空で上書きする)。
      if (!snapshot) continue;
      try {
        await writeSavedUnread(
          current.path,
          savedUnreadText(
            snapshot.generation,
            snapshot.records,
            agentUnreadSnapshot(),
          ),
        );
        errors.delete("save_unread");
      } catch (error) {
        setError("save_unread", error);
      }
    }
  })().finally(() => {
    current.writing = null;
  });
  return current.writing;
}

function scheduleSave(): void {
  const current = persistence;
  if (!current || current.unreadable) return;
  current.dirty = true;
  if (current.timer) return;
  current.timer = setTimeout(() => {
    current.timer = null;
    void writeNow(current);
  }, UNREAD_SAVE_DELAY_MS);
  current.timer.unref?.();
}

const restoreFirstRecord: AgentRecordListener = ({ key, record, first }) => {
  scheduleSave();
  const current = persistence;
  if (!first || !current || current.pending.size === 0) return;
  const saved = current.pending.get(record.target);
  if (!saved) return;
  current.pending.delete(record.target);
  const generation = currentAgentTmuxGeneration();
  if (generation === null) return;
  const decision = decideUnreadRestore(
    saved,
    { state: record.state, fromHook: record.source === "hook" },
    generation,
  );
  if (!decision) {
    console.info(
      `[code-viewer] not restoring the unread mark of ${record.target}: ${
        saved.generation !== generation
          ? "tmux-generation"
          : record.source === "hook"
            ? "reported-first"
            : "state-changed"
      }`,
    );
    return;
  }
  if (decision.changedAt > 0) {
    record.updatedAt = decision.changedAt;
    record.changeObserved = true;
  }
  if (decision.unread) restoreAgentUnread(key, decision.unread);
};

/**
 * 保存を読み、以後の変化を書くようにする。読めなければ理由を出して、
 * 読み戻しもしない (書くときも上書きしない)。
 */
export function startUnreadPersistence(path: string = agentUnreadPath()): void {
  if (persistence) return;
  const read = readSavedUnread(path);
  persistence = {
    path,
    pending: new Map(
      (read.ok ? read.registry : []).map((entry) => [entry.target, entry]),
    ),
    unreadable: read.ok === false,
    timer: null,
    writing: null,
    dirty: false,
  };
  if (read.ok === false) setError("restore_unread", new Error(read.error));
  onAgentRecord(restoreFirstRecord);
  onAgentUnreadChanged(scheduleSave);
}

/** 待っている書き込みを今すぐ行って待つ。テストとサーバの終了用。 */
export async function flushUnreadPersistence(): Promise<void> {
  const current = persistence;
  if (!current) return;
  if (current.timer) {
    clearTimeout(current.timer);
    current.timer = null;
  }
  if (current.dirty) await writeNow(current);
  while (current.writing) await current.writing;
}

/** テスト用。 */
export function stopUnreadPersistence(): void {
  if (persistence?.timer) clearTimeout(persistence.timer);
  onAgentRecord(null);
  onAgentUnreadChanged(null);
  persistence = null;
  errors.clear();
}
