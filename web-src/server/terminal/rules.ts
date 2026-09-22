// 画面の文言のルール (状態の判定) の保存済み上書き。
//
// 判定は tmux の全ペインを見るので、上書きはユーザー単位に 1 つ
// (`<状態ディレクトリ>/agent-screen-rules.json`)。以前はリポジトリの
// `.code-viewer/agent-screen-rules.json` にあり、サーバ (リポジトリ) ごとに別の
// ルールで判定しえた。入口のサーバで判定が 1 つになったのでユーザー単位へ移した。
//
// 移し方: ユーザー単位のファイルがまだ無く、移した印
// (`agent-screen-rules.migrated`) も無いときに限り、判定するサーバのリポジトリ
// (入口なら起動したディレクトリ) の上書きを 1 度だけ写す。両方あるときは
// ユーザー単位のほうだけを使う。リポジトリのファイルは読むだけで、書き換えも
// 削除もしない (壊れていても退避しない)。保存・既定に戻すと印を書くので、
// 既定に戻した後にリポジトリの古い上書きがよみがえることはない。
//
// 変える外部状態と戻し方: この 2 つのファイルだけ。消せば既定のルールに戻り、
// 次の起動でリポジトリの上書きがあれば写し直す。

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentScreenRuleIssue,
  type AgentScreenRuleSet,
  type AgentScreenRulesResponse,
  DEFAULT_AGENT_SCREEN_RULES,
  formatAgentScreenRuleSet,
  parseAgentScreenRuleSet,
} from "../../core/agent-screen";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import { resolvedFileLockPath, withFileLock } from "../file-lock";
import { createJsonFileStore } from "../json-store";
import { codeViewerStateDir } from "../user-state-dir";
import { writeFileAtomic } from "./settings-file";

export const MAX_AGENT_SCREEN_RULES_BYTES = 200_000;
const RULES_FILE_NAME = "agent-screen-rules.json";

type LoadedRules = Omit<AgentScreenRulesResponse, "generation">;

let activeRules = DEFAULT_AGENT_SCREEN_RULES;
let activeErrors: AgentScreenRuleIssue[] = [];
let activeGeneration = 0;

function errorIssue(code: string, error: unknown): AgentScreenRuleIssue {
  return {
    path: "$",
    code,
    message: formatErrorDetail(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  };
}

function defaultResponse(errors: AgentScreenRuleIssue[] = []): LoadedRules {
  return { rules: DEFAULT_AGENT_SCREEN_RULES, source: "default", errors };
}

/** ユーザー単位の上書きのファイル。 */
export function agentScreenRulesFilePath(): string {
  return join(codeViewerStateDir(), RULES_FILE_NAME);
}

/** 以前の置き場所 (リポジトリごと)。移すときに読むだけ。 */
export function repoAgentScreenRulesFilePath(root: string): string {
  return join(root, ".code-viewer", RULES_FILE_NAME);
}

/** リポジトリの上書きを写した・ユーザーが保存した・既定に戻した印。 */
export function agentScreenRulesMigratedPath(): string {
  return join(codeViewerStateDir(), "agent-screen-rules.migrated");
}

function parseStoredRules(raw: unknown): AgentScreenRuleSet {
  const parsed = parseAgentScreenRuleSet(raw);
  if ("errors" in parsed) {
    throw Object.assign(new Error("saved terminal rules are invalid"), {
      issues: parsed.errors,
    });
  }
  return parsed.value;
}

const rulesStore = createJsonFileStore<AgentScreenRuleSet | null>({
  // 鍵は状態ディレクトリ (呼ぶ側は codeViewerStateDir() を渡す)。
  filePath: (dir) => join(dir, RULES_FILE_NAME),
  empty: () => null,
  sanitize: (raw) => parseStoredRules(raw),
  maxBytes: MAX_AGENT_SCREEN_RULES_BYTES,
  backupSuffix: "corrupt",
  sizeErrorMessage: `terminal rules must not exceed ${MAX_AGENT_SCREEN_RULES_BYTES} bytes`,
  serialize: (rules) => {
    if (rules === null) throw new Error("terminal rules must not be null");
    return formatAgentScreenRuleSet(rules);
  },
  invalidFileBehavior: "throw",
});

export function getActiveAgentScreenRules(): AgentScreenRuleSet {
  return activeRules;
}

export function getAgentScreenRuleErrors(): AgentScreenRuleIssue[] {
  return activeErrors.map((error) => ({ ...error }));
}

/**
 * 保存したファイルの中身が壊れている (JSON でない・検証に通らない) ときの
 * 理由。読めなかった (ロックを待ちきれない・I/O の失敗) なら null。
 */
function issuesFromInvalidRules(error: unknown): AgentScreenRuleIssue[] | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const issues = (current as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      return issues.filter(
        (issue): issue is AgentScreenRuleIssue =>
          !!issue &&
          typeof issue === "object" &&
          typeof (issue as AgentScreenRuleIssue).path === "string" &&
          typeof (issue as AgentScreenRuleIssue).code === "string" &&
          typeof (issue as AgentScreenRuleIssue).message === "string",
      );
    }
    if (current instanceof SyntaxError)
      return [errorIssue("invalid_json", current)];
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function activate(response: LoadedRules): AgentScreenRulesResponse {
  activeRules = response.rules;
  activeErrors = response.errors.map((error) => ({ ...error }));
  activeGeneration += 1;
  return { ...response, generation: activeGeneration };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw errorWithCause(`cannot read ${path}`, error);
  }
}

async function writeMigratedMark(
  detail: Record<string, string>,
): Promise<void> {
  await mkdir(codeViewerStateDir(), { recursive: true, mode: 0o700 });
  writeFileAtomic(
    agentScreenRulesMigratedPath(),
    `${JSON.stringify({ ...detail, at: new Date().toISOString() }, null, 2)}\n`,
    0o600,
  );
}

function withAgentScreenRulesLock<T>(run: () => T | Promise<T>): Promise<T> {
  return withFileLock(resolvedFileLockPath(agentScreenRulesFilePath()), run);
}

/**
 * ユーザー単位の上書きがまだ無ければ、root のリポジトリの上書きを 1 度だけ
 * 写す。リポジトリのファイルが壊れていれば写さずに理由を投げる (退避しない)。
 */
async function migrateRepoRules(root: string): Promise<void> {
  const userFile = agentScreenRulesFilePath();
  const marker = agentScreenRulesMigratedPath();
  if (await fileExists(marker)) return;
  if (await fileExists(userFile)) {
    await writeMigratedMark({ reason: "existing-user-rules" });
    return;
  }
  const repoFile = repoAgentScreenRulesFilePath(root);
  let text: string;
  try {
    text = await readFile(repoFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw errorWithCause(
      `cannot read the saved terminal rules ${repoFile}`,
      error,
    );
  }
  let rules: AgentScreenRuleSet;
  try {
    rules = parseStoredRules(JSON.parse(text));
  } catch (error) {
    throw errorWithCause(
      `the saved terminal rules of ${root} (${repoFile}) are invalid, so they were not moved to ${userFile}`,
      error,
    );
  }
  await rulesStore.save(codeViewerStateDir(), rules);
  await writeMigratedMark({ from: repoFile });
}

/**
 * root: 判定するサーバのリポジトリ (入口なら起動したディレクトリ)。以前の
 * リポジトリごとの上書きを移すときにだけ読む。
 *
 * 保存したファイルが壊れていれば、理由を付けて既定のルールにする。読めな
 * かった (別のプロセスがロックを持っている間に待ちきれない、など) ときは、
 * 前に有効だったルールのまま投げる。既定に落とすと、保存したルールでの判定が
 * 黙って既定の判定に切り替わる。
 */
export async function reloadAgentScreenRules(
  root: string,
): Promise<AgentScreenRulesResponse> {
  try {
    return await withAgentScreenRulesLock(async () => {
      await migrateRepoRules(root);
      const rules = await rulesStore.load(codeViewerStateDir());
      return activate(
        rules === null
          ? defaultResponse()
          : { rules, source: "saved", errors: [] },
      );
    });
  } catch (error) {
    const invalid = issuesFromInvalidRules(error);
    if (!invalid) {
      throw errorWithCause(
        "could not reload the terminal rules; the previously active rules stay in use",
        error,
      );
    }
    console.error("[code-viewer] terminal rule load failed", error);
    return activate(defaultResponse(invalid));
  }
}

export async function saveAgentScreenRules(
  raw: unknown,
): Promise<AgentScreenRulesResponse | { errors: AgentScreenRuleIssue[] }> {
  const parsed = parseAgentScreenRuleSet(raw);
  if ("errors" in parsed) return { errors: parsed.errors };
  return withAgentScreenRulesLock(async () => {
    // 印を先に置けば、本体の保存途中で止まっても旧リポジトリ版は戻らない。
    await writeMigratedMark({ reason: "saved" });
    await rulesStore.save(codeViewerStateDir(), parsed.value);
    return activate({ rules: parsed.value, source: "saved", errors: [] });
  });
}

export async function resetAgentScreenRules(): Promise<AgentScreenRulesResponse> {
  return withAgentScreenRulesLock(async () => {
    // 印を先に置けば、本体を消した直後に止まっても旧リポジトリ版は戻らない。
    await writeMigratedMark({ reason: "reset" });
    await rulesStore.remove(codeViewerStateDir());
    return activate(defaultResponse());
  });
}

export function resetAgentScreenRulesForTest(): void {
  activeRules = DEFAULT_AGENT_SCREEN_RULES;
  activeErrors = [];
  activeGeneration = 0;
}
