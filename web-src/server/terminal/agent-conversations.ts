// フックが知らせた会話記録の場所 (session_id・transcript_path・cwd) を、
// サーバの起動を跨いで覚えておく。「別のアカウントで続ける」
// (views/agents/handoff.ts) は場所が無いと押せないので、サーバを起こし直す
// たびに、待機しているエージェントが次に話しかけられるまで使えなくなっていた。
//
// 保存するのは場所だけ。状態 (作業中・待機など) は agent-state.ts の冒頭の
// 理由で保存しない。場所は古くても害が無い条件を読み戻すときに確かめる:
// 同じ tmux のサーバの世代・そのペインが今も同じ種類のエージェント・記録の
// ファイルが実在する (decideConversationRestore)。満たさないものは使わず、
// 次に書くときに保存からも落とす。
//
// 読めない・壊れた保存は使わず、上書きもしない (理由をログと一覧の errors に
// 出す。消すのは利用者)。複数のサーバ (入口と --standalone) が同じファイルを
// 書くので、書くときはロックの中で読み直してから自分の記録で置き換える。
// どのサーバも同じペインの申告を受けるので、中身は揃う。

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { agentKindOf } from "../../core/agent-overview";
import {
  type AgentStateObservationError,
  isAgentConversation,
  isReportedAgent,
} from "../../core/agent-state";
import { formatErrorDetail } from "../../core/error-detail";
import { isTmuxPaneId } from "../../core/tmux";
import { withFileLock } from "../file-lock";
import { type RegistryFileRead, readRegistryFile } from "../registry-file";
import { codeViewerStateDir } from "../user-state-dir";
import {
  type AgentConversationEntry,
  agentConversationsSnapshot,
  MAX_TRACKED_TARGETS,
  onAgentConversationsChanged,
  restoreAgentConversations,
} from "./agent-state";
import { writeFileAtomic } from "./settings-file";

const FILE_VERSION = 1;

/** 保存する件数の上限。メモリに覚える数と同じ。溢れたら受け取りの古いものから落とす。 */
export const MAX_SAVED_CONVERSATIONS = MAX_TRACKED_TARGETS;

/** 保存の 1 件。どの tmux のサーバの世代のペインのものかを持つ。 */
export type SavedAgentConversation = AgentConversationEntry & {
  generation: string;
};

export function agentConversationsPath(): string {
  return join(codeViewerStateDir(), "agent-conversations.json");
}

export function parseSavedConversations(
  raw: unknown,
):
  | { ok: true; registry: SavedAgentConversation[] }
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
  const entries: SavedAgentConversation[] = [];
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
    if (!isReportedAgent(entry.agent))
      problems.push("agent is not claude or codex");
    if (!isAgentConversation(entry.conversation))
      problems.push("conversation is not a valid conversation");
    if (!Number.isSafeInteger(entry.at) || (entry.at as number) < 0)
      problems.push("at is not a non-negative integer");
    if (problems.length > 0) {
      issues.push(...problems.map((problem) => `${at}: ${problem}`));
      return;
    }
    entries.push(value as SavedAgentConversation);
  });
  if (entries.length > MAX_SAVED_CONVERSATIONS) {
    issues.push(
      `entries: ${entries.length} entries, more than ${MAX_SAVED_CONVERSATIONS}`,
    );
  }
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, registry: entries };
}

export function readSavedConversations(
  path: string,
): RegistryFileRead<SavedAgentConversation[]> {
  return readRegistryFile(path, parseSavedConversations, () => []);
}

/** 読み戻さなかった理由。 */
export type ConversationDropReason =
  | "tmux-generation"
  | "pane-gone"
  | "agent-changed"
  | "transcript-missing";

export type ConversationRestoreDecision = {
  restore: AgentConversationEntry[];
  dropped: { entry: SavedAgentConversation; reason: ConversationDropReason }[];
};

/**
 * 保存のうち、今のペインへ戻してよいものを選ぶ。種類はペインの前面の
 * コマンドだけで決める (申告の種類は、状態と一緒にメモリから消えている)。
 */
export function decideConversationRestore(
  saved: readonly SavedAgentConversation[],
  generation: string,
  panes: readonly { id: string; command: string }[],
  transcriptExists: (path: string) => boolean,
): ConversationRestoreDecision {
  const commands = new Map(panes.map((pane) => [pane.id, pane.command]));
  const decision: ConversationRestoreDecision = { restore: [], dropped: [] };
  for (const entry of saved) {
    const command = commands.get(entry.target);
    const reason: ConversationDropReason | null =
      entry.generation !== generation
        ? "tmux-generation"
        : command === undefined
          ? "pane-gone"
          : agentKindOf(command, null) !== entry.agent
            ? "agent-changed"
            : !transcriptExists(entry.conversation.transcriptPath)
              ? "transcript-missing"
              : null;
    if (reason) {
      decision.dropped.push({ entry, reason });
      continue;
    }
    const { generation: _generation, ...kept } = entry;
    decision.restore.push(kept);
  }
  return decision;
}

/**
 * 保存の中身。記録のファイルの場所が無いもの (codex の transcript_path は
 * null になりうる) は、読み戻しても引き継ぎに使えないので書かない。
 */
export function savedConversationsText(
  generation: string,
  entries: readonly AgentConversationEntry[],
): string {
  const kept = entries
    .filter((entry) => entry.conversation.transcriptPath !== "")
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_SAVED_CONVERSATIONS)
    .map((entry) => ({ generation, ...entry }));
  return `${JSON.stringify({ version: FILE_VERSION, entries: kept }, null, 2)}\n`;
}

/** ロックの中で読み直し、読めれば置き換える。読めない保存は上書きしない。 */
export async function writeSavedConversations(
  path: string,
  text: string,
): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await withFileLock(`${path}.lock`, () => {
    const current = readSavedConversations(path);
    if (current.ok === false) {
      throw new Error(
        `the saved conversation locations cannot be read, so they were not overwritten (remove the file to start over).\n${current.error}`,
      );
    }
    writeFileAtomic(path, text, 0o600);
  });
}

// ---- サーバの中の保存と読み戻し (巡回するサーバだけが使う) ----

type Persistence = {
  path: string;
  /** 起動時に読んだ保存。最初の巡回で読み戻したら null。 */
  pending: SavedAgentConversation[] | null;
  writing: Promise<void> | null;
  dirty: boolean;
};

let persistence: Persistence | null = null;
const errors = new Map<string, AgentStateObservationError>();

function setError(
  operation: "restore_conversations" | "save_conversations",
  cause: unknown,
): void {
  console.error(
    `[code-viewer] ${operation === "restore_conversations" ? "could not restore" : "could not save"} the conversation locations of the agents`,
    cause,
  );
  errors.set(operation, {
    operation,
    target: persistence?.path ?? "",
    at: Date.now(),
    detail: formatErrorDetail(cause),
    stack: cause instanceof Error ? (cause.stack ?? "") : "",
  });
}

/** 一覧の errors に載せる、保存と読み戻しの失敗。 */
export function getConversationStoreErrors(): AgentStateObservationError[] {
  return [...errors.values()].map((error) => ({ ...error }));
}

function scheduleSave(): void {
  const current = persistence;
  if (!current) return;
  current.dirty = true;
  // 読み戻す前に書くと、まだ戻していない保存を今の記録だけで上書きする。
  // 読み戻したときに書く (restoreSavedConversations)。
  if (current.pending) return;
  current.writing ??= (async () => {
    while (current.dirty) {
      current.dirty = false;
      const snapshot = agentConversationsSnapshot();
      // 世代が分かるまで (最初の巡回の前) は書かない。前の世代の保存を
      // 空で上書きしてしまう。
      if (!snapshot) continue;
      try {
        await writeSavedConversations(
          current.path,
          savedConversationsText(snapshot.generation, snapshot.entries),
        );
        errors.delete("save_conversations");
      } catch (error) {
        setError("save_conversations", error);
      }
    }
  })().finally(() => {
    current.writing = null;
  });
}

/**
 * 保存を読み、以後の変化を書くようにする。読めなければ理由を出して、
 * 読み戻しもしない (書くときも上書きしない)。
 */
export function startConversationPersistence(
  path: string = agentConversationsPath(),
): void {
  if (persistence) return;
  const read = readSavedConversations(path);
  persistence = {
    path,
    pending: read.ok ? read.registry : [],
    writing: null,
    dirty: false,
  };
  if (read.ok === false)
    setError("restore_conversations", new Error(read.error));
  onAgentConversationsChanged(scheduleSave);
}

/**
 * 最初に tmux のサーバの世代とペインが分かった巡回で 1 度だけ呼ぶ。条件を
 * 満たす保存を戻し、落としたものは 1 行ずつログに出して保存から消す。
 */
export function restoreSavedConversations(
  generation: string,
  panes: readonly { id: string; command: string }[],
): void {
  const current = persistence;
  if (!current?.pending) return;
  const decision = decideConversationRestore(
    current.pending,
    generation,
    panes,
    existsSync,
  );
  current.pending = null;
  const restored = restoreAgentConversations(decision.restore);
  if (restored > 0) {
    console.info(
      `[code-viewer] restored the conversation locations of ${restored} agent panes`,
    );
  }
  for (const { entry, reason } of decision.dropped) {
    console.info(
      `[code-viewer] not restoring the conversation location of ${entry.target} (${entry.agent}): ${reason}`,
    );
  }
  if (decision.dropped.length > 0 || current.dirty) scheduleSave();
}

/** 書きかけを待つ。テストとサーバの終了用。 */
export async function flushConversationPersistence(): Promise<void> {
  while (persistence?.writing) await persistence.writing;
}

/** テスト用。 */
export function stopConversationPersistence(): void {
  onAgentConversationsChanged(null);
  persistence = null;
  errors.clear();
}
