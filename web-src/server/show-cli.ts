// `code-viewer show` — 利用者の code-viewer の画面に、ファイル (と行) か、そのファイルの
// 差分を新しいタブで開く。いま見ているタブは変えない。
//
// AI が「ここを見てください」と見せるための口。開くのは利用者に頼まれたときだけ
// (下の SHOW_HELP・agent-help・配布スキルに書く)。このプロジェクトを映している画面が
// 無ければ開けないので、サーバが理由を返し、ここは理由を出して exit 1。
// 形と検査は core/show.ts、開く口はサーバ (preview.ts の /_show)。

import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parseShowTarget, type ShowRequest } from "../core/show";
import {
  ensureServerUrl,
  requestJson,
  resolveRepoRoot,
  takeGlobalCliOption,
  validateRepoRelativePathValue,
} from "./cli-helpers";

export const SHOW_HELP = `code-viewer show — open a file or its diff in the user's code-viewer, in a new tab

Use it only when the user asks to be shown something. It opens a new tab and
leaves the tab the user is reading alone. A code-viewer window showing this
repository must be open in the browser; otherwise it fails and says so.

Usage:
  code-viewer show <path>[:<line>]          the file, scrolled to the line
  code-viewer show <path> --diff            the file in the Diff screen

<path> is relative to the current directory (or --cwd), or absolute inside
the repository.

Global options:
  --cwd <dir>      repository (default: current directory)
  --server <url>   code-viewer server URL (default: auto-discovered)

Examples:
  code-viewer show web-src/app.ts:120
  code-viewer show README.md --diff
`;

/** agent-help の索引 (agent-help.ts) が 1 行目を読む。案内は help と同じ。 */
export const SHOW_AGENT_HELP = SHOW_HELP;

export type ShowArgs =
  | { kind: "help" }
  | {
      kind: "show";
      target: string;
      diff: boolean;
      cwd?: string;
      server?: string;
    };

export function parseShowArgs(
  argv: string[],
): { ok: true; args: ShowArgs } | { ok: false; error: string } {
  const rest: string[] = [];
  let cwd: string | undefined;
  let server: string | undefined;
  let diff = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--help" || arg === "-h" || arg === "agent-help")
      return { ok: true, args: { kind: "help" } };
    const global = takeGlobalCliOption(argv, i, { allowServer: true });
    if (global.kind === "error") return { ok: false, error: global.error };
    if (global.kind === "cwd") {
      cwd = global.value;
      i = global.next;
    } else if (global.kind === "server") {
      server = global.value;
      i = global.next;
    } else if (arg === "--diff") {
      diff = true;
    } else if (arg.startsWith("-")) {
      return { ok: false, error: `unknown option: ${arg}` };
    } else {
      rest.push(arg);
    }
  }
  const target = rest[0];
  if (!target) return { ok: true, args: { kind: "help" } };
  if (rest.length > 1)
    return {
      ok: false,
      error: `show takes one path; also got: ${rest.slice(1).join(" ")}`,
    };
  return {
    ok: true,
    args: {
      kind: "show",
      target,
      diff,
      ...(cwd ? { cwd } : {}),
      ...(server ? { server } : {}),
    },
  };
}

/**
 * 打った綴り (今の場所からの相対・絶対、後ろに :行) を、リポジトリの根からの
 * 相対パスの要求にする。リポジトリの外・git の中は断る。
 */
export function showRequestFor(
  target: string,
  diff: boolean,
  root: string,
  base: string,
): { ok: true; request: ShowRequest } | { ok: false; error: string } {
  const { path, line } = parseShowTarget(target);
  const absolute = isAbsolute(path) ? path : resolve(base, path);
  const inRepo = relative(root, absolute).split("\\").join("/");
  const error = validateRepoRelativePathValue(inRepo, "<path>");
  if (error)
    return { ok: false, error: `${error} (got ${target}, repository ${root})` };
  return {
    ok: true,
    request: {
      path: inRepo,
      view: diff ? "diff" : "file",
      ...(line !== undefined && !diff ? { line } : {}),
    },
  };
}

export async function runShowCli(argv: string[]): Promise<void> {
  const parsed = parseShowArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error('Run "code-viewer show --help" for usage.');
    process.exit(1);
  }
  const args = parsed.args;
  if (args.kind === "help") {
    console.log(SHOW_HELP);
    return;
  }
  const root = resolveRepoRoot(args.cwd);
  const made = showRequestFor(
    args.target,
    args.diff,
    root,
    // 根は実体のパス (macOS の /tmp → /private/tmp) なので、今の場所もそろえる。
    realpathSync(args.cwd ? resolve(args.cwd) : process.cwd()),
  );
  if (made.ok === false) {
    console.error(made.error);
    process.exit(1);
  }
  const serverUrl = await ensureServerUrl(root, args.server, "/_show");
  const result = (await requestJson(
    serverUrl,
    "/_show",
    "POST",
    made.request,
    "show",
  )) as { windows?: number };
  const where =
    made.request.line !== undefined
      ? `${made.request.path}:${made.request.line}`
      : made.request.path;
  console.log(
    `opened ${where}${made.request.view === "diff" ? " (diff)" : ""} in a new tab (${result.windows ?? "?"} window(s) showing this repository)`,
  );
}
