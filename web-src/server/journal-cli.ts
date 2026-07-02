import { readFileSync } from "node:fs";
import {
  filterJournalTasks,
  isIsoDate,
  isJournalTaskPriority,
  isJournalTaskStatus,
  type JournalDataResponse,
  type JournalTask,
  type JournalTaskPriority,
  type JournalTaskStatus,
  selectNextJournalTasks,
  todayIsoDate,
} from "../core/journal";
import {
  ensureServerUrl,
  requestJson,
  resolveRepoRoot,
  takeValue,
} from "./cli-helpers";
import {
  configureExternalCommands,
  type ExternalCommandOverride,
  parseExternalCommandOverride,
} from "./command-resolver";
import {
  type GithubIssueListItem,
  type GithubIssueListState,
  readGithubIssue,
  readGithubIssueList,
  singleLineGithubOption,
} from "./github-issues";

type BodyInput = {
  body?: string;
  bodyFile?: string;
};

type NoteInput = {
  note?: string;
  noteFile?: string;
};

export type JournalCommand =
  | { kind: "help" }
  | { kind: "agent-help" }
  | { kind: "list"; date?: string; limit?: number; json: boolean }
  | ({
      kind: "add";
      date: string;
      title?: string;
      labels: string[];
    } & BodyInput)
  | ({
      kind: "edit";
      id: string;
      date?: string;
      title?: string;
      labels?: string[];
    } & BodyInput)
  | {
      kind: "tasks";
      status?: JournalTaskStatus;
      labels: string[];
      json: boolean;
    }
  | ({
      kind: "task-add";
      title: string;
      status?: JournalTaskStatus;
      priority?: JournalTaskPriority;
      labels: string[];
      dueDate?: string;
      sourceDate?: string;
      before?: string;
      after?: string;
      position?: number;
    } & BodyInput)
  | ({
      kind: "task-update";
      id: string;
      title?: string;
      status?: JournalTaskStatus;
      priority?: JournalTaskPriority;
      labels?: string[];
      clearLabels: boolean;
      dueDate?: string | null;
      sourceDate?: string | null;
    } & BodyInput)
  | {
      kind: "task-next";
      status?: JournalTaskStatus;
      labels: string[];
      limit: number;
      json: boolean;
    }
  | {
      kind: "github-issues";
      repo?: string;
      ghState: GithubIssueListState;
      ghLabels: string[];
      search?: string;
      limit: number;
      json: boolean;
    }
  | {
      kind: "task-link-issue";
      issueNumber: number;
      repo?: string;
      status?: JournalTaskStatus;
      priority?: JournalTaskPriority;
      labels: string[];
      before?: string;
      after?: string;
      position?: number;
      json: boolean;
    }
  | {
      kind: "task-claim";
      id: string;
      by?: string;
      leaseMinutes?: number;
      wipLimit?: number;
    }
  | ({ kind: "task-done"; id: string; by?: string } & NoteInput)
  | { kind: "task-delete"; id: string };

export type JournalArgs = {
  command: JournalCommand;
  cwd?: string;
  server?: string;
  commandOverrides?: ExternalCommandOverride[];
  dryRun: boolean;
};

export type JournalParseResult =
  | { ok: true; args: JournalArgs }
  | { ok: false; error: string };

export const JOURNAL_HELP = `code-viewer journal — daily work journal and task queue

The journal is stored in <repo>/.code-viewer/daily-journal.json and tasks are
stored in <repo>/.code-viewer/tasks.json. A running code-viewer server for the
repository is required unless you pass --dry-run for a write command.
The github-issues command is read-only and runs gh directly without a server.

Run "code-viewer journal agent-help" for an AI-agent oriented guide.

Usage:
  code-viewer journal list [--date <YYYY-MM-DD|today>] [--limit <n>] [--json]
  code-viewer journal add --date <YYYY-MM-DD|today> [--title <text>]
      [--label <label>...] [--body <markdown> | --body-file <path>]
  code-viewer journal edit <id> [--date <YYYY-MM-DD|today>] [--title <text>]
      [--label <label>...] [--body <markdown> | --body-file <path>]
  code-viewer journal tasks [--status <draft|todo|doing|blocked|done>]
      [--label <label>...] [--json]
  code-viewer journal task-add --title <text>
      [--status <status>] [--priority <p0|p1|p2|p3>] [--label <label>...]
      [--due <YYYY-MM-DD|none>] [--source-date <YYYY-MM-DD|today|none>]
      [--before <id> | --after <id> | --position <n>]
      [--body <markdown> | --body-file <path>]
  code-viewer journal task-update <id> [--title <text>] [--status <status>]
      [--priority <p0|p1|p2|p3>] [--label <label>...] [--clear-labels]
      [--due <YYYY-MM-DD|none>] [--source-date <YYYY-MM-DD|today|none>]
      [--body <markdown> | --body-file <path>]
  code-viewer journal task-next [--label <label>...] [--status <status>]
      [--limit <n>] [--json]
  code-viewer journal github-issues [--repo <owner/repo>]
      [--state <open|closed|all>] [--gh-label <label>...]
      [--search <query>] [--limit <n>] [--json] [--bin gh=<path>]
  code-viewer journal task-link-issue <number> [--repo <owner/repo>]
      [--status <status>] [--priority <p0|p1|p2|p3>] [--label <label>...]
      [--before <id> | --after <id> | --position <n>] [--json]
      [--dry-run] [--bin gh=<path>]
  code-viewer journal task-claim <id> [--by <agent>] [--lease-minutes <n>]
      [--wip-limit <n>]
  code-viewer journal task-done <id> --by <agent>
      [--note <markdown> | --note-file <path>]
  code-viewer journal task-delete <id>

Global options:
  --cwd <dir>      repository root (default: current directory)
  --server <url>   code-viewer server URL (default: auto-discovered)
  --bin gh=<p>     override gh executable path for github-issues
  --dry-run        print the write payload without sending it
`;

export const JOURNAL_AGENT_HELP = `code-viewer journal — agent guide

You are an AI coding agent. Use this tool to write daily work notes and process
explicit task queues without guessing from memory.

## Workflow

1. Check the queue before doing label-scoped work:
     code-viewer journal task-next --label ai-ready --limit 5 --json
2. Claim exactly one task before editing code:
     code-viewer journal task-claim <task-id> --by agent --wip-limit 1
3. When finished, mark it done with a short note:
     code-viewer journal task-done <task-id> --by agent --note "Implemented and verified."
4. Add a daily journal entry for work that is not already represented by a task:
     code-viewer journal add --date today --label ai --body "..."
5. Inspect GitHub issues read-only before deciding what local task to create:
     code-viewer journal github-issues --repo owner/repo --json
6. Link a GitHub issue to the local board without updating GitHub:
     code-viewer journal task-link-issue 123 --repo owner/repo --status draft --label ai-ready

## Rules

- Treat labels as filters, priority as importance, and card order as human order.
- Do not process draft tasks unless the human asked for drafts.
- Use task-next for ordering; do not sort the JSON yourself unless asked.
- Use --dry-run before large generated entries.
- GitHub issue listing is read-only. Create or update local tasks explicitly.
- task-link-issue reads issue metadata only and stores a local task link plus
  your local labels. It does not copy the issue body or update GitHub.
`;

function parsePositiveInteger(
  value: string | undefined,
  flag: string,
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`${flag} must be a positive integer`);
  return n;
}

function parseDateValue(
  value: string | undefined,
  flag: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (value === "today") return todayIsoDate();
  if (value === "none") return "";
  if (!isIsoDate(value)) throw new Error(`${flag} must be YYYY-MM-DD or today`);
  return value;
}

function parseStatus(value: string | undefined): JournalTaskStatus | undefined {
  if (value === undefined) return undefined;
  if (isJournalTaskStatus(value)) return value;
  throw new Error("--status must be draft, todo, doing, blocked, or done");
}

function parsePriority(
  value: string | undefined,
): JournalTaskPriority | undefined {
  if (value === undefined) return undefined;
  if (isJournalTaskPriority(value)) return value;
  throw new Error("--priority must be p0, p1, p2, or p3");
}

function parseGithubIssueState(
  value: string | undefined,
): GithubIssueListState {
  if (value === undefined) return "open";
  if (value === "open" || value === "closed" || value === "all") return value;
  throw new Error("--state must be open, closed, or all");
}

function parseGithubOption(
  value: string | undefined,
  flag: string,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = singleLineGithubOption(value);
  if (!normalized) throw new Error(`${flag} must be a non-empty single line`);
  return normalized;
}

export function parseJournalArgs(argv: string[]): JournalParseResult {
  const rest: string[] = [];
  let cwd: string | undefined;
  let server: string | undefined;
  const options = new Map<string, string>();
  const multiOptions = new Map<string, string[]>();
  const flags = new Set<string>();
  const commandOverrides: ExternalCommandOverride[] = [];
  const valueFlags = new Set([
    "--date",
    "--title",
    "--body",
    "--body-file",
    "--note",
    "--note-file",
    "--label",
    "--status",
    "--priority",
    "--due",
    "--source-date",
    "--before",
    "--after",
    "--position",
    "--by",
    "--lease-minutes",
    "--wip-limit",
    "--limit",
    "--repo",
    "--gh-label",
    "--search",
    "--state",
  ]);

  try {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--help" || arg === "-h")
        return { ok: true, args: { command: { kind: "help" }, dryRun: false } };
      if (arg === "--cwd" || arg === "--server") {
        const taken = takeValue(argv, i, arg);
        if ("error" in taken) return { ok: false, error: taken.error };
        if (arg === "--cwd") cwd = taken.value;
        else server = taken.value;
        i = taken.next;
      } else if (arg === "--bin") {
        const taken = takeValue(argv, i, arg);
        if ("error" in taken) return { ok: false, error: taken.error };
        const parsed = parseExternalCommandOverride(taken.value, "--bin", [
          "gh",
        ]);
        if (parsed.ok === false) return { ok: false, error: parsed.error };
        commandOverrides.push(parsed.override);
        i = taken.next;
      } else if (valueFlags.has(arg)) {
        const taken = takeValue(argv, i, arg);
        if ("error" in taken) return { ok: false, error: taken.error };
        options.set(arg, taken.value);
        const values = multiOptions.get(arg) || [];
        values.push(taken.value);
        multiOptions.set(arg, values);
        i = taken.next;
      } else if (
        arg === "--json" ||
        arg === "--dry-run" ||
        arg === "--clear-labels"
      ) {
        flags.add(arg);
      } else if (arg.startsWith("-")) {
        return { ok: false, error: `unknown option: ${arg}` };
      } else {
        rest.push(arg);
      }
    }

    const labels = multiOptions.get("--label") || [];
    const subcommand = rest[0];
    const dryRun = flags.has("--dry-run");
    if (!subcommand)
      return { ok: true, args: { command: { kind: "help" }, dryRun } };
    if (subcommand === "agent-help")
      return { ok: true, args: { command: { kind: "agent-help" }, dryRun } };
    if (
      commandOverrides.length > 0 &&
      subcommand !== "github-issues" &&
      subcommand !== "task-link-issue"
    ) {
      return {
        ok: false,
        error: "--bin is only supported with github-issues or task-link-issue",
      };
    }
    if (subcommand === "list") {
      return {
        ok: true,
        args: {
          command: {
            kind: "list",
            date: parseDateValue(options.get("--date"), "--date"),
            limit: parsePositiveInteger(options.get("--limit"), "--limit"),
            json: flags.has("--json"),
          },
          cwd,
          server,
          dryRun,
        },
      };
    }
    if (subcommand === "add") {
      const date = parseDateValue(options.get("--date"), "--date");
      if (!date)
        return { ok: false, error: "add requires --date <YYYY-MM-DD|today>" };
      return {
        ok: true,
        args: {
          command: {
            kind: "add",
            date,
            title: options.get("--title"),
            labels,
            body: options.get("--body"),
            bodyFile: options.get("--body-file"),
          },
          cwd,
          server,
          dryRun,
        },
      };
    }
    if (subcommand === "edit") {
      const id = rest[1];
      if (!id) return { ok: false, error: "edit requires a journal entry id" };
      return {
        ok: true,
        args: {
          command: {
            kind: "edit",
            id,
            date: parseDateValue(options.get("--date"), "--date"),
            title: options.get("--title"),
            labels: multiOptions.has("--label") ? labels : undefined,
            body: options.get("--body"),
            bodyFile: options.get("--body-file"),
          },
          cwd,
          server,
          dryRun,
        },
      };
    }
    if (subcommand === "tasks") {
      return {
        ok: true,
        args: {
          command: {
            kind: "tasks",
            status: parseStatus(options.get("--status")),
            labels,
            json: flags.has("--json"),
          },
          cwd,
          server,
          dryRun,
        },
      };
    }
    if (subcommand === "task-add") {
      const title = options.get("--title");
      if (!title)
        return { ok: false, error: "task-add requires --title <text>" };
      return {
        ok: true,
        args: {
          command: {
            kind: "task-add",
            title,
            status: parseStatus(options.get("--status")),
            priority: parsePriority(options.get("--priority")),
            labels,
            dueDate: parseDateValue(options.get("--due"), "--due"),
            sourceDate: parseDateValue(
              options.get("--source-date"),
              "--source-date",
            ),
            before: options.get("--before"),
            after: options.get("--after"),
            position: parsePositiveInteger(
              options.get("--position"),
              "--position",
            ),
            body: options.get("--body"),
            bodyFile: options.get("--body-file"),
          },
          cwd,
          server,
          dryRun,
        },
      };
    }
    if (subcommand === "task-update") {
      const id = rest[1];
      if (!id) return { ok: false, error: "task-update requires a task id" };
      return {
        ok: true,
        args: {
          command: {
            kind: "task-update",
            id,
            title: options.get("--title"),
            status: parseStatus(options.get("--status")),
            priority: parsePriority(options.get("--priority")),
            labels: multiOptions.has("--label") ? labels : undefined,
            clearLabels: flags.has("--clear-labels"),
            dueDate: parseDateValue(options.get("--due"), "--due") ?? undefined,
            sourceDate:
              parseDateValue(options.get("--source-date"), "--source-date") ??
              undefined,
            body: options.get("--body"),
            bodyFile: options.get("--body-file"),
          },
          cwd,
          server,
          dryRun,
        },
      };
    }
    if (subcommand === "task-next") {
      return {
        ok: true,
        args: {
          command: {
            kind: "task-next",
            status: parseStatus(options.get("--status")),
            labels,
            limit: parsePositiveInteger(options.get("--limit"), "--limit") || 1,
            json: flags.has("--json"),
          },
          cwd,
          server,
          dryRun,
        },
      };
    }
    if (subcommand === "github-issues") {
      if (multiOptions.has("--label")) {
        return {
          ok: false,
          error: "github-issues uses --gh-label, not --label",
        };
      }
      return {
        ok: true,
        args: {
          command: {
            kind: "github-issues",
            repo: parseGithubOption(options.get("--repo"), "--repo"),
            ghState: parseGithubIssueState(options.get("--state")),
            ghLabels: (multiOptions.get("--gh-label") || []).map((label) =>
              parseGithubOption(label, "--gh-label"),
            ),
            search: parseGithubOption(options.get("--search"), "--search"),
            limit:
              parsePositiveInteger(options.get("--limit"), "--limit") || 30,
            json: flags.has("--json"),
          },
          cwd,
          server,
          commandOverrides,
          dryRun,
        },
      };
    }
    if (subcommand === "task-link-issue") {
      if (multiOptions.has("--gh-label")) {
        return {
          ok: false,
          error: "task-link-issue uses --label for local labels",
        };
      }
      const issueNumber = parsePositiveInteger(rest[1], "issue number");
      if (!issueNumber) {
        return {
          ok: false,
          error: "task-link-issue requires <number>",
        };
      }
      return {
        ok: true,
        args: {
          command: {
            kind: "task-link-issue",
            issueNumber,
            repo: parseGithubOption(options.get("--repo"), "--repo"),
            status: parseStatus(options.get("--status")),
            priority: parsePriority(options.get("--priority")),
            labels,
            before: options.get("--before"),
            after: options.get("--after"),
            position: parsePositiveInteger(
              options.get("--position"),
              "--position",
            ),
            json: flags.has("--json"),
          },
          cwd,
          server,
          commandOverrides,
          dryRun,
        },
      };
    }
    if (subcommand === "task-claim") {
      const id = rest[1];
      if (!id) return { ok: false, error: "task-claim requires a task id" };
      return {
        ok: true,
        args: {
          command: {
            kind: "task-claim",
            id,
            by: options.get("--by"),
            leaseMinutes: parsePositiveInteger(
              options.get("--lease-minutes"),
              "--lease-minutes",
            ),
            wipLimit: parsePositiveInteger(
              options.get("--wip-limit"),
              "--wip-limit",
            ),
          },
          cwd,
          server,
          dryRun,
        },
      };
    }
    if (subcommand === "task-done") {
      const id = rest[1];
      if (!id) return { ok: false, error: "task-done requires a task id" };
      if (!options.get("--by"))
        return { ok: false, error: "task-done requires --by <agent>" };
      return {
        ok: true,
        args: {
          command: {
            kind: "task-done",
            id,
            by: options.get("--by"),
            note: options.get("--note"),
            noteFile: options.get("--note-file"),
          },
          cwd,
          server,
          dryRun,
        },
      };
    }
    if (subcommand === "task-delete") {
      const id = rest[1];
      if (!id) return { ok: false, error: "task-delete requires a task id" };
      return {
        ok: true,
        args: { command: { kind: "task-delete", id }, cwd, server, dryRun },
      };
    }
    return { ok: false, error: `unknown journal command: ${subcommand}` };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "invalid journal arguments",
    };
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function textFromBody(
  command: BodyInput,
  required: boolean,
): Promise<string | undefined> {
  if (command.body !== undefined && command.bodyFile !== undefined) {
    console.error("use either --body or --body-file");
    process.exit(1);
  }
  if (command.body !== undefined) return command.body;
  if (command.bodyFile !== undefined) {
    try {
      return readFileSync(command.bodyFile, "utf8");
    } catch {
      console.error(`could not read --body-file: ${command.bodyFile}`);
      process.exit(1);
    }
  }
  const stdin = await readStdin();
  if (stdin.trim()) return stdin;
  if (required) {
    console.error("body is empty. Pass --body, --body-file, or pipe stdin.");
    process.exit(1);
  }
  return undefined;
}

function textFromNote(command: NoteInput): string | undefined {
  if (command.note !== undefined && command.noteFile !== undefined) {
    console.error("use either --note or --note-file");
    process.exit(1);
  }
  if (command.note !== undefined) return command.note;
  if (command.noteFile !== undefined) {
    try {
      return readFileSync(command.noteFile, "utf8");
    } catch {
      console.error(`could not read --note-file: ${command.noteFile}`);
      process.exit(1);
    }
  }
  return undefined;
}

async function journalRequest(
  serverUrl: string,
  method: "GET" | "POST",
  action: string,
  body?: unknown,
): Promise<unknown> {
  return requestJson(serverUrl, "/_journal", method, body, action);
}

function selectEntries(
  data: JournalDataResponse,
  date?: string,
  limit?: number,
): JournalDataResponse["journal"]["entries"] {
  const entries = date
    ? data.journal.entries.filter((entry) => entry.date === date)
    : data.journal.entries;
  if (limit === undefined) return entries;
  return [...entries]
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.updated_at.localeCompare(a.updated_at) ||
        b.created_at.localeCompare(a.created_at),
    )
    .slice(0, limit);
}

function printEntries(
  data: JournalDataResponse,
  date?: string,
  limit?: number,
): void {
  const entries = selectEntries(data, date, limit);
  if (!entries.length) {
    console.log("no journal entries");
    return;
  }
  for (const entry of entries) {
    const labels = entry.labels.length ? ` #${entry.labels.join(" #")}` : "";
    const title = entry.title ? ` ${entry.title}` : "";
    console.log(`${entry.date} [${entry.id}]${title}${labels}`);
    console.log(`  ${entry.body.split("\n")[0].slice(0, 120)}`);
  }
}

function printTasks(tasks: JournalTask[]): void {
  if (!tasks.length) {
    console.log("no tasks");
    return;
  }
  for (const task of tasks) {
    const labels = task.labels.length ? ` #${task.labels.join(" #")}` : "";
    console.log(
      `[${task.id}] ${task.status} ${task.priority} ${task.title}${labels}`,
    );
  }
}

function printGithubIssues(issues: GithubIssueListItem[]): void {
  if (!issues.length) {
    console.log("no GitHub issues");
    return;
  }
  for (const issue of issues) {
    const labels = issue.labels.length ? ` #${issue.labels.join(" #")}` : "";
    const url = issue.url ? ` ${issue.url}` : "";
    console.log(
      `#${issue.number} ${issue.state} ${issue.title}${labels}${url}`,
    );
  }
}

function taskLinkIssuePayload(
  command: Extract<JournalCommand, { kind: "task-link-issue" }>,
  issue: GithubIssueListItem,
): Record<string, unknown> {
  return {
    action: "link-github-issue",
    issue_number: issue.number,
    repo: command.repo,
    title: issue.title,
    url: issue.url,
    memo_label: "Memo:",
    status: command.status,
    priority: command.priority,
    labels: command.labels,
    before_id: command.before,
    after_id: command.after,
    position: command.position,
  };
}

function writePayload(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

async function getJournalData(serverUrl: string): Promise<JournalDataResponse> {
  return (await journalRequest(
    serverUrl,
    "GET",
    "journal list",
  )) as JournalDataResponse;
}

export async function runJournalCli(argv: string[]): Promise<void> {
  const parsed = parseJournalArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error('Run "code-viewer journal --help" for usage.');
    process.exit(1);
  }
  const { command, cwd, server, commandOverrides = [], dryRun } = parsed.args;
  if (command.kind === "help") {
    console.log(JOURNAL_HELP);
    return;
  }
  if (command.kind === "agent-help") {
    console.log(JOURNAL_AGENT_HELP);
    return;
  }

  const dryRunPayload = async (
    action: string,
    body: Record<string, unknown>,
  ) => {
    if (!dryRun) return false;
    writePayload({ action, ...body });
    return true;
  };

  if (dryRun) {
    if (command.kind === "add") {
      writePayload({
        action: "add-entry",
        date: command.date,
        title: command.title,
        labels: command.labels,
        body: await textFromBody(command, true),
      });
      return;
    }
    if (command.kind === "edit") {
      writePayload({
        action: "update-entry",
        id: command.id,
        date: command.date,
        title: command.title,
        labels: command.labels,
        body: await textFromBody(command, false),
      });
      return;
    }
    if (command.kind === "task-add") {
      writePayload({
        action: "add-task",
        title: command.title,
        status: command.status,
        priority: command.priority,
        labels: command.labels,
        due_date: command.dueDate === "" ? null : command.dueDate,
        source_date: command.sourceDate === "" ? null : command.sourceDate,
        before_id: command.before,
        after_id: command.after,
        position: command.position,
        body: await textFromBody(command, false),
      });
      return;
    }
    if (command.kind === "task-update") {
      writePayload({
        action: "update-task",
        id: command.id,
        title: command.title,
        status: command.status,
        priority: command.priority,
        labels: command.clearLabels ? [] : command.labels,
        due_date: command.dueDate === "" ? null : command.dueDate,
        source_date: command.sourceDate === "" ? null : command.sourceDate,
        body: await textFromBody(command, false),
      });
      return;
    }
    if (command.kind === "task-claim") {
      writePayload({
        action: "claim-task",
        id: command.id,
        by: command.by,
        lease_minutes: command.leaseMinutes,
        wip_limit: command.wipLimit,
      });
      return;
    }
    if (command.kind === "task-done") {
      writePayload({
        action: "complete-task",
        id: command.id,
        by: command.by,
        note: textFromNote(command),
      });
      return;
    }
    if (command.kind === "task-delete") {
      writePayload({ action: "delete-task", id: command.id });
      return;
    }
  }

  const root = resolveRepoRoot(cwd);
  if (command.kind === "github-issues") {
    const commandConfig = configureExternalCommands({
      cwd: root,
      cliOverrides: commandOverrides,
      allowedNames: ["gh"],
    });
    if (commandConfig.ok === false) {
      console.error(commandConfig.error);
      process.exit(1);
    }
    const issues = readGithubIssueList({
      cwd: root,
      repo: command.repo,
      labels: command.ghLabels,
      search: command.search,
      state: command.ghState,
      limit: command.limit,
    });
    if (command.json) console.log(JSON.stringify({ issues }, null, 2));
    else printGithubIssues(issues);
    return;
  }
  if (command.kind === "task-link-issue") {
    const commandConfig = configureExternalCommands({
      cwd: root,
      cliOverrides: commandOverrides,
      allowedNames: ["gh"],
    });
    if (commandConfig.ok === false) {
      console.error(commandConfig.error);
      process.exit(1);
    }
    const issue = readGithubIssue({
      cwd: root,
      number: command.issueNumber,
      repo: command.repo,
    });
    if (dryRun) {
      writePayload(taskLinkIssuePayload(command, issue));
      return;
    }
    const serverUrl = await ensureServerUrl(root, server, "/_journal");
    const result = (await journalRequest(
      serverUrl,
      "POST",
      "journal task-link-issue",
      taskLinkIssuePayload(command, issue),
    )) as { task: JournalTask; created?: boolean; moved?: boolean };
    if (command.json)
      console.log(
        JSON.stringify(
          {
            issue,
            task: result.task,
            action: result.created
              ? "created"
              : result.moved
                ? "moved"
                : "existing",
          },
          null,
          2,
        ),
      );
    else if (result.created)
      console.log(`linked issue #${issue.number} to task ${result.task.id}`);
    else if (result.moved)
      console.log(`moved linked issue #${issue.number} task ${result.task.id}`);
    else
      console.log(`issue #${issue.number} is linked to task ${result.task.id}`);
    return;
  }

  const serverUrl = await ensureServerUrl(root, server, "/_journal");

  if (command.kind === "list") {
    const data = await getJournalData(serverUrl);
    const entries = selectEntries(data, command.date, command.limit);
    if (command.json)
      console.log(
        JSON.stringify({ version: data.journal.version, entries }, null, 2),
      );
    else printEntries(data, command.date, command.limit);
    return;
  }
  if (command.kind === "add") {
    const body = await textFromBody(command, true);
    const result = (await journalRequest(serverUrl, "POST", "journal add", {
      action: "add-entry",
      date: command.date,
      title: command.title,
      labels: command.labels,
      body,
    })) as { entry: { id: string; date: string } };
    console.log(
      `added journal entry ${result.entry.id} for ${result.entry.date}`,
    );
    return;
  }
  if (command.kind === "edit") {
    const body = await textFromBody(command, false);
    const payload = {
      action: "update-entry",
      id: command.id,
      date: command.date,
      title: command.title,
      labels: command.labels,
      body,
    };
    if (await dryRunPayload("update-entry", payload)) return;
    await journalRequest(serverUrl, "POST", "journal edit", payload);
    console.log(`updated journal entry ${command.id}`);
    return;
  }
  if (command.kind === "tasks") {
    const data = await getJournalData(serverUrl);
    const tasks = filterJournalTasks(data.tasks, {
      status: command.status,
      labels: command.labels,
      includeClaimed: true,
    });
    if (command.json)
      console.log(JSON.stringify({ version: 1, tasks }, null, 2));
    else printTasks(tasks);
    return;
  }
  if (command.kind === "task-add") {
    const body = await textFromBody(command, false);
    const payload = {
      action: "add-task",
      title: command.title,
      status: command.status,
      priority: command.priority,
      labels: command.labels,
      due_date: command.dueDate === "" ? null : command.dueDate,
      source_date: command.sourceDate === "" ? null : command.sourceDate,
      before_id: command.before,
      after_id: command.after,
      position: command.position,
      body,
    };
    if (await dryRunPayload("add-task", payload)) return;
    const result = (await journalRequest(
      serverUrl,
      "POST",
      "journal task-add",
      payload,
    )) as { task: JournalTask };
    console.log(`added task ${result.task.id} ${result.task.title}`);
    return;
  }
  if (command.kind === "task-update") {
    const body = await textFromBody(command, false);
    const payload = {
      action: "update-task",
      id: command.id,
      title: command.title,
      status: command.status,
      priority: command.priority,
      labels: command.clearLabels ? [] : command.labels,
      due_date: command.dueDate === "" ? null : command.dueDate,
      source_date: command.sourceDate === "" ? null : command.sourceDate,
      body,
    };
    if (await dryRunPayload("update-task", payload)) return;
    await journalRequest(serverUrl, "POST", "journal task-update", payload);
    console.log(`updated task ${command.id}`);
    return;
  }
  if (command.kind === "task-next") {
    const data = await getJournalData(serverUrl);
    const tasks = selectNextJournalTasks(
      data.tasks,
      {
        status: command.status || "todo",
        labels: command.labels,
      },
      command.limit,
    );
    if (command.json) console.log(JSON.stringify({ tasks }, null, 2));
    else printTasks(tasks);
    return;
  }
  if (command.kind === "task-claim") {
    const payload = {
      action: "claim-task",
      id: command.id,
      by: command.by,
      lease_minutes: command.leaseMinutes,
      wip_limit: command.wipLimit,
    };
    if (await dryRunPayload("claim-task", payload)) return;
    const result = (await journalRequest(
      serverUrl,
      "POST",
      "journal task-claim",
      payload,
    )) as { task: JournalTask };
    console.log(
      `claimed task ${result.task.id} until ${result.task.claim?.lease_expires_at}`,
    );
    return;
  }
  if (command.kind === "task-done") {
    const payload = {
      action: "complete-task",
      id: command.id,
      by: command.by,
      note: textFromNote(command),
    };
    if (await dryRunPayload("complete-task", payload)) return;
    await journalRequest(serverUrl, "POST", "journal task-done", payload);
    console.log(`completed task ${command.id}`);
    return;
  }
  const payload = { action: "delete-task", id: command.id };
  if (await dryRunPayload("delete-task", payload)) return;
  const result = (await journalRequest(
    serverUrl,
    "POST",
    "journal task-delete",
    payload,
  )) as { removed?: boolean };
  if (!result.removed) {
    console.error(`task not found: ${command.id}`);
    process.exit(1);
  }
  console.log(`deleted task ${command.id}`);
}
