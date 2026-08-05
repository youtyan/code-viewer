// `code-viewer terminal` — 動いているターミナルの状態を申告し、本文を読む。
//
// 2 つの相手を想定している。
//
// - エージェントのフック: `terminal state` を呼んで自分の状態を申告する。
//   claude なら UserPromptSubmit / PreToolUse / Stop / Notification、codex なら
//   hooks.json の同等の口から呼ぶ。サーバの場所は cli-helpers の探索に任せる
//   ので、フック側はポートを知らなくてよい。
// - 別のエージェント: `terminal list` で誰が何をしているかを見て、
//   `terminal capture` で他のセッションの本文を前回の続きから受け取る。
//
// 構成は status-cli / search-cli と同じ「parse して run」。サーバへの往復は
// cli-helpers の ensureServerUrl と requestJson をそのまま使う。

import {
  AGENT_EVENTS,
  type AgentEvent,
  type AgentStateRecord,
  isAgentEvent,
  needsAttention,
} from "../core/agent-state";
import {
  ensureServerUrl,
  requestJson,
  resolveRepoRoot,
  takeGlobalCliOption,
  takeValue,
} from "./cli-helpers";

/** サーバ探索に使う疎通先。この経路自体が読み取り専用なので使い回せる。 */
const HEALTH_PATH = "/_agent/states";

export type TerminalCommand =
  | { mode: "help" }
  | { mode: "agent-help" }
  | { mode: "list"; json: boolean; attentionOnly: boolean }
  | {
      mode: "capture";
      target: string;
      cursor: string | null;
      history: number | null;
      json: boolean;
    }
  | {
      mode: "state";
      target: string;
      event: AgentEvent;
      prompt: string | null;
      note: string | null;
    };

export type TerminalArgs = {
  command: TerminalCommand;
  cwd: string | undefined;
  server: string | undefined;
};

export type TerminalParseResult =
  | { ok: true; args: TerminalArgs }
  | { ok: false; error: string };

export const TERMINAL_HELP = `code-viewer terminal — report and read the terminals this repository is running

Usage:
  code-viewer terminal list [--attention] [--json]
  code-viewer terminal capture --target <id> [--cursor <cursor>] [--history <n>] [--json]
  code-viewer terminal state --target <id> --event <event> [--prompt <text>] [--note <text>]

Commands:
  list      Show every terminal the server knows a state for.
  capture   Read a terminal's text. With --cursor only what is new since then.
  state     Report a state change. Meant to be called from an agent CLI hook.

Options:
  --target <id>     tmux pane id (%12) or browser shell id (shell-xxxx).
                    Inside tmux use "$TMUX_PANE"; inside a browser shell use
                    "$CODE_VIEWER_SHELL_ID".
  --event <event>   ${AGENT_EVENTS.join(" | ")}
  --cursor <cursor> Opaque value returned by the previous capture.
  --history <n>     Lines of scrollback to include (tmux only). Default 500.
  --prompt <text>   The instruction the human last gave. Kept until replaced.
  --note <text>     One line from the agent about what it is doing.
  --attention       Only terminals waiting for you or finished but unread.
  --json            Machine-readable output.
  --cwd <path>      Repository to talk to. Default: current directory.
  --server <url>    code-viewer server URL (default: auto-discover).

Examples:
  code-viewer terminal state --target "$TMUX_PANE" --event stop
  code-viewer terminal list --attention
  code-viewer terminal capture --target %12 --json
`;

export const TERMINAL_AGENT_HELP = `code-viewer terminal — agent guide

What it is for
  Two things a coding agent cannot do on its own: tell the human's dashboard
  what it is doing, and read what another agent's terminal is showing.

Reporting your own state (hooks)
  Call once per lifecycle event. The event names map to what the dashboard
  shows:
    prompt    the human sent an instruction  -> working
    progress  you ran a tool                 -> working
    ask       you stopped to ask something   -> waiting
    stop      your turn ended                -> done (unread)
    exit      the session ended              -> idle
  Identify yourself with $TMUX_PANE (inside tmux) or $CODE_VIEWER_SHELL_ID
  (inside a shell this server opened). Nothing else is needed; the CLI finds
  the running server by itself.

    code-viewer terminal state --target "$TMUX_PANE" --event ask \\
      --note "waiting for approval to force push"

Reading another terminal
  capture returns { target, kind, content, cursor, reset }. Keep the cursor and
  pass it back next time to get only what was added. reset=true means the
  previous position could not be followed and content is the whole buffer
  again, so treat it as overlapping with what you already had.

    code-viewer terminal capture --target %12 --json
    code-viewer terminal capture --target %12 --cursor t420.1f9k --json

Finding who needs something
  code-viewer terminal list --attention --json
  Returns only waiting and done. Use it before asking the human anything.

Rerun this guide
  code-viewer terminal agent-help
`;

function parseCount(value: string, flag: string): number | { error: string } {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { error: `${flag} must be a non-negative integer` };
  }
  return parsed;
}

export function parseTerminalArgs(argv: string[]): TerminalParseResult {
  const sub = argv[0];
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    return {
      ok: true,
      args: { command: { mode: "help" }, cwd: undefined, server: undefined },
    };
  }
  if (sub === "agent-help") {
    return {
      ok: true,
      args: {
        command: { mode: "agent-help" },
        cwd: undefined,
        server: undefined,
      },
    };
  }
  if (sub !== "list" && sub !== "capture" && sub !== "state") {
    return { ok: false, error: `unknown terminal subcommand: ${sub}` };
  }

  let cwd: string | undefined;
  let server: string | undefined;
  let json = false;
  let attentionOnly = false;
  let target = "";
  let cursor: string | null = null;
  let history: number | null = null;
  let event: AgentEvent | null = null;
  let prompt: string | null = null;
  let note: string | null = null;

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const global = takeGlobalCliOption(argv, i, { allowServer: true });
    if (global.kind === "error") return { ok: false, error: global.error };
    if (global.kind === "cwd" || global.kind === "server") {
      if (global.kind === "cwd") cwd = global.value;
      else server = global.value;
      i = global.next;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--attention") {
      attentionOnly = true;
      continue;
    }
    if (
      arg === "--target" ||
      arg === "--cursor" ||
      arg === "--history" ||
      arg === "--event" ||
      arg === "--prompt" ||
      arg === "--note"
    ) {
      const taken = takeValue(argv, i, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      i = taken.next;
      if (arg === "--target") target = taken.value;
      else if (arg === "--cursor") cursor = taken.value;
      else if (arg === "--prompt") prompt = taken.value;
      else if (arg === "--note") note = taken.value;
      else if (arg === "--history") {
        const parsed = parseCount(taken.value, "--history");
        if (typeof parsed !== "number")
          return { ok: false, error: parsed.error };
        history = parsed;
      } else if (arg === "--event") {
        if (!isAgentEvent(taken.value)) {
          return {
            ok: false,
            error: `--event must be one of: ${AGENT_EVENTS.join(", ")}`,
          };
        }
        event = taken.value;
      }
      continue;
    }
    return { ok: false, error: `unknown option: ${arg}` };
  }

  if (sub === "list") {
    return {
      ok: true,
      args: { command: { mode: "list", json, attentionOnly }, cwd, server },
    };
  }
  if (!target) return { ok: false, error: "--target is required" };
  if (sub === "capture") {
    return {
      ok: true,
      args: {
        command: { mode: "capture", target, cursor, history, json },
        cwd,
        server,
      },
    };
  }
  if (!event) return { ok: false, error: "--event is required" };
  return {
    ok: true,
    args: {
      command: { mode: "state", target, event, prompt, note },
      cwd,
      server,
    },
  };
}

/** 一覧の 1 行。人間が読むときは幅を揃えたいので、ここで整える。 */
export function formatStateLine(record: AgentStateRecord): string {
  const mark = needsAttention(record.state) ? "*" : " ";
  const state = record.state.padEnd(7, " ");
  const source = record.source === "hook" ? "hook" : "gues";
  const text = record.note || record.lastPrompt || "";
  return `${mark} ${state} ${source}  ${record.target.padEnd(16, " ")} ${text}`;
}

type StatesResponse = { states?: AgentStateRecord[] };
type CaptureResponse = {
  target?: string;
  kind?: string;
  content?: string;
  cursor?: string;
  reset?: boolean;
};

export async function runTerminalCli(argv: string[]): Promise<void> {
  const parsed = parseTerminalArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error(TERMINAL_HELP);
    process.exit(1);
  }
  const { command, cwd, server } = parsed.args;
  if (command.mode === "help") {
    console.log(TERMINAL_HELP);
    return;
  }
  if (command.mode === "agent-help") {
    console.log(TERMINAL_AGENT_HELP);
    return;
  }

  const root = resolveRepoRoot(cwd);
  const serverUrl = await ensureServerUrl(root, server, HEALTH_PATH);

  if (command.mode === "state") {
    // フックは別プロセスなので、送った順に着くとは限らない。呼ばれた時刻を
    // 添えて、古い申告がサーバ側で捨てられるようにする。
    const at = Date.now();
    await requestJson(
      serverUrl,
      "/_agent/state",
      "POST",
      {
        target: command.target,
        event: command.event,
        at,
        ...(command.prompt === null ? {} : { lastPrompt: command.prompt }),
        ...(command.note === null ? {} : { note: command.note }),
      },
      "terminal state",
    );
    return;
  }

  if (command.mode === "list") {
    const response = (await requestJson(
      serverUrl,
      "/_agent/states",
      "GET",
      undefined,
      "terminal list",
    )) as StatesResponse;
    const all = response.states ?? [];
    const states = command.attentionOnly
      ? all.filter((record) => needsAttention(record.state))
      : all;
    if (command.json) {
      console.log(JSON.stringify({ states }, null, 2));
      return;
    }
    if (states.length === 0) {
      console.log("no terminals are reporting a state.");
      return;
    }
    for (const record of states) console.log(formatStateLine(record));
    return;
  }

  const query = new URLSearchParams({ target: command.target });
  if (command.cursor) query.set("cursor", command.cursor);
  if (command.history !== null) query.set("history", String(command.history));
  const response = (await requestJson(
    serverUrl,
    `/_agent/capture?${query.toString()}`,
    "GET",
    undefined,
    "terminal capture",
  )) as CaptureResponse;
  if (command.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  // 人間向けは本文だけ。カーソルは stderr に出して、パイプの邪魔をしない。
  if (response.reset) {
    console.error("(cursor could not be followed — the whole buffer follows)");
  }
  console.error(`cursor: ${response.cursor ?? ""}`);
  console.log(response.content ?? "");
}
