import {
  closeSync,
  type Dirent,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { cacheFresh, setTimedCacheEntry, type TimedCacheEntry } from "./cache";
import {
  commandForExternal,
  commandNotFoundDetail,
  isCommandNotFoundResult,
} from "./command-resolver";
import { compileNamePatterns, type NamePatternSet } from "./name-pattern";
import {
  runAsync,
  runBytesAsync,
  runBytesSync,
  runSync,
  spawnStream,
} from "./runtime";

export type GitFileMeta = {
  order?: number;
  path: string;
  old_path?: string;
  status?: string;
  similarity?: number;
  additions?: number;
  deletions?: number;
  binary?: boolean;
  untracked?: boolean;
};

export type GitFileMetaResult = {
  files: GitFileMeta[];
  error?: string;
};

export type GitErrorResult = {
  error: string;
  status?: number;
};

// ai-dup-check: allow -- server git layer keeps its public DTO local to avoid a core/server dependency cycle.
export type GitTreeEntry = {
  name: string;
  path: string;
  type: "tree" | "blob" | "commit";
  submodule?: true;
  children_omitted?: true;
  children_omitted_reason?: "heavy" | "internal" | "truncated";
  size?: number;
  created_at?: string;
  updated_at?: string;
  commit_updated_at?: string;
  // A symlink keeps its resolved `type` (tree/blob) so every existing
  // type-based branch (navigation, sorting, icons) treats it like the real
  // target. is_symlink only changes how it is drawn/labeled.
  is_symlink?: true;
  symlink_target?: string;
  symlink_target_type?: "tree" | "blob" | "missing";
  // Committed-ref directory symlinks only: `git ls-tree`/`cat-file` never
  // resolve a symlink path as if it were the target directory (unlike a
  // worktree path, which the OS resolves transparently), so the client must
  // navigate using this repo-relative path instead of `path` to actually
  // see the target contents.
  resolved_path?: string;
  status?: string;
};

// ai-dup-check: allow -- server git layer emits commit DTOs without importing browser-facing core types.
export type GitCommitMeta = {
  sha: string;
  subject: string;
  author: string;
  when: string;
};

export type GitBranchMeta = {
  name: string;
  when: string;
};

// ai-dup-check: allow -- blame DTOs are intentionally narrow to avoid leaking parser state.
export type GitBlameLine = {
  lineNo: number;
  sha: string;
  isUncommitted: boolean;
};

// ai-dup-check: allow -- blame commit DTO mirrors core/blame.ts BlameCommit; server keeps a local copy to avoid a server→core import cycle.
export type GitBlameCommit = {
  sha: string;
  author: string;
  authorMail: string;
  authorTime: number;
  summary: string;
  isUncommitted: boolean;
};

export type GitBlameResult = {
  lines: GitBlameLine[];
  commits: Record<string, GitBlameCommit>;
  isUntracked?: boolean;
  isSynthetic?: boolean;
  error?: string;
  status?: number;
};

export const BLAME_ZERO_SHA = "0000000000000000000000000000000000000000";

export type GitBlameBase = "worktree" | "HEAD";

export function normalizeBlameRef(
  ref: string,
  base: GitBlameBase,
): { base: GitBlameBase; ref: string } {
  const rawRef = ref || "worktree";
  if (base === "worktree" && rawRef !== "worktree") {
    return { base: "HEAD", ref: rawRef };
  }
  if (base === "HEAD" && rawRef === "worktree") {
    return { base: "HEAD", ref: "HEAD" };
  }
  return { base, ref: rawRef };
}

export type GitTagMeta = {
  name: string;
  when: string;
};

const WORKTREE_RECURSIVE_DEPTH_LIMIT = 32;
export const WORKTREE_RECURSIVE_ENTRY_LIMIT = 50000;
export const DEFAULT_REF_COMMIT_LIMIT = 100;
const MAX_REF_COMMIT_LIMIT = 500;
const COMMIT_FORMAT = "%H%x00%s%x00%an%x00%aI";
// ユーザー設定 (scopeOmitDirs) や CLI 指定に関係なく常に監視・走査対象から
// 除外するディレクトリ。保存済み scopeOmitDirs は保存時点のデフォルトの
// スナップショットなので、デフォルトリストへの追加だけでは既存プロジェクト
// に届かない。.devbox / .direnv は Nix ストアへのシンボリックリンクツリーで
// 数千ディレクトリ規模になり、watcher に載るとファイル監視の登録・解除が
// イベントループを数十秒ブロックして全リクエストを止める。
export const ALWAYS_WORKTREE_OMIT_DIR_NAMES = [".devbox", ".direnv"];

// 保存済みリストが union 済みなら同一参照を返す: 呼び出し側
// (applyPersistedSettings) は参照比較で watcher 再構築を判断するため、
// 変化が無いのに新しい配列を返すと設定保存のたびに再構築が走ってしまう。
export function withAlwaysWorktreeOmitDirNames(names: string[]): string[] {
  const missing = ALWAYS_WORKTREE_OMIT_DIR_NAMES.filter(
    (name) => !names.includes(name),
  );
  return missing.length ? [...names, ...missing] : names;
}

export const DEFAULT_WORKTREE_OMIT_DIR_NAMES = [
  "node_modules",
  "bower_components",
  ".venv",
  "venv",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".vercel",
  ".angular",
  ".docusaurus",
  ".expo",
  ".dart_tool",
  ".serverless",
  "dist",
  "build",
  "out",
  "target",
  ".gradle",
  ...ALWAYS_WORKTREE_OMIT_DIR_NAMES,
  ".pnpm-store",
  ".turbo",
  ".parcel-cache",
  ".vite",
  ".webpack",
  "__pycache__",
  ".pytest_cache",
  ".tox",
  ".terraform",
  ".idea",
  ".vscode",
  "vendor",
  ".cache",
  "coverage",
  ".nyc_output",
  "tmp",
  "log",
  "storage",
  "DerivedData",
  "Pods",
  "bin",
  "obj",
];

// spawnSync はプロセス全体をブロックする (Bun はシングルスレッド)。lock 競合
// や巨大リポジトリでの想定外の停止が起きても、DB 等の無関係なリクエストまで
// 巻き込んで無期限に固まらないよう上限を設ける。
const GIT_COMMAND_TIMEOUT_MS = 20_000;

function run(
  args: string[],
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  return runSync(resolveGitArgs(args), cwd, {
    timeout: GIT_COMMAND_TIMEOUT_MS,
  });
}

function runGitAsync(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runAsync(resolveGitArgs(args), cwd, {
    timeout: GIT_COMMAND_TIMEOUT_MS,
  });
}

function runBytes(
  args: string[],
  cwd: string,
): { code: number; stdout: Uint8Array; stderr: string } {
  return runBytesSync(resolveGitArgs(args), cwd, {
    timeout: GIT_COMMAND_TIMEOUT_MS,
  });
}

function runGitBytesAsync(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: Uint8Array; stderr: string }> {
  return runBytesAsync(resolveGitArgs(args), cwd, {
    timeout: GIT_COMMAND_TIMEOUT_MS,
  });
}

function resolveGitArgs(args: string[]): string[] {
  if (args[0] !== "git") return args;
  return [commandForExternal("git"), ...args.slice(1)];
}

export function gitCommand(): string {
  return commandForExternal("git");
}

export function gitFailureMessage(
  res: { code: number; stderr?: string },
  fallback: string,
): string {
  if (isCommandNotFoundResult("git", res)) return commandNotFoundDetail("git");
  return res.stderr?.trim() || fallback;
}

function gitFailureResult(
  res: { code: number; stderr?: string },
  fallback: string,
): GitErrorResult {
  if (!isCommandNotFoundResult("git", res)) {
    return { error: fallback };
  }
  return {
    error: commandNotFoundDetail("git"),
    status: 503,
  };
}

function runGitRefLookup(args: string[], cwd: string): string | null {
  const res = run(args, cwd);
  return res.code === 0 ? res.stdout.trimEnd() : null;
}

async function runGitRefLookupAsync(
  args: string[],
  cwd: string,
): Promise<string | null> {
  const res = await runGitAsync(args, cwd);
  return res.code === 0 ? res.stdout.trimEnd() : null;
}

export function repoRoot(cwd: string): string | null {
  return runGitRefLookup(["git", "rev-parse", "--show-toplevel"], cwd);
}

export function repoRootResult(
  cwd: string,
):
  | { kind: "root"; root: string }
  | { kind: "outside" }
  | { kind: "error"; error: string } {
  const res = run(["git", "rev-parse", "--show-toplevel"], cwd);
  if (res.code === 0) return { kind: "root", root: res.stdout.trimEnd() };
  if (isCommandNotFoundResult("git", res)) {
    return { kind: "error", error: commandNotFoundDetail("git") };
  }
  const stderr = res.stderr.trim();
  if (/not a git repository/i.test(stderr)) return { kind: "outside" };
  return { kind: "error", error: stderr || "git rev-parse failed" };
}

export function currentBranch(cwd: string): string | null {
  return runGitRefLookup(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

export function currentBranchAsync(cwd: string): Promise<string | null> {
  return runGitRefLookupAsync(
    ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    cwd,
  );
}

export function verifyCommit(
  ref: string,
  cwd: string,
): { ok: true; sha: string } | { ok: false; error: string } {
  const res = run(["git", "rev-parse", "--verify", `${ref}^{commit}`], cwd);
  if (res.code === 0) return { ok: true, sha: res.stdout.trim() };
  return { ok: false, error: gitFailureMessage(res, "unknown ref") };
}

export async function verifyCommitAsync(
  ref: string,
  cwd: string,
): Promise<{ ok: true; sha: string } | { ok: false; error: string }> {
  const res = await runGitAsync(
    ["git", "rev-parse", "--verify", `${ref}^{commit}`],
    cwd,
  );
  if (res.code === 0) return { ok: true, sha: res.stdout.trim() };
  return { ok: false, error: gitFailureMessage(res, "unknown ref") };
}

export function statusPorcelainForPath(
  path: string,
  cwd: string,
): { ok: true; stdout: string } | { ok: false; error: string } {
  const res = run(
    [
      "git",
      "-c",
      "core.quotepath=false",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=normal",
      "--",
      path,
    ],
    cwd,
  );
  if (res.code === 0) return { ok: true, stdout: res.stdout };
  return {
    ok: false,
    error: gitFailureMessage(res, "git status failed"),
  };
}

export async function statusPorcelainForPathAsync(
  path: string,
  cwd: string,
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  const res = await runGitAsync(
    [
      "git",
      "-c",
      "core.quotepath=false",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=normal",
      "--",
      path,
    ],
    cwd,
  );
  if (res.code === 0) return { ok: true, stdout: res.stdout };
  return {
    ok: false,
    error: gitFailureMessage(res, "git status failed"),
  };
}

// Keyed by cwd. Every tree render (expand a dir, switch ref, poll for
// changes) calls repoStatusMapAsync, and each call shells out to `git
// status` over the whole repo - a short TTL cache coalesces those bursts
// the same way metaCache/fileListCache do in preview.ts.
const repoStatusMapCache = new Map<
  string,
  TimedCacheEntry<{ map: Map<string, string> }>
>();

// One-char status per path across the whole repo (index + worktree +
// untracked), for the tree explorer change badges. Distinct from
// statusPorcelainForPathAsync, which only checks whether a single given
// path has any uncommitted change (existence, not per-path codes).
export async function repoStatusMapAsync(
  cwd: string,
  now = Date.now(),
): Promise<Map<string, string>> {
  const cached = repoStatusMapCache.get(cwd);
  if (cacheFresh(cached, now)) return cached.map;
  const map = new Map<string, string>();
  const res = await runGitAsync(
    [
      "git",
      "-c",
      "core.quotepath=false",
      "status",
      "--porcelain=v1",
      "-z",
      // "all" (not "normal") so a brand-new untracked directory is expanded
      // into its individual file paths (`?? dir/file` for each) instead of
      // collapsing to one `?? dir/` record - the tree explorer needs a
      // per-file status to badge each entry, not just the containing dir.
      "--untracked-files=all",
    ],
    cwd,
  );
  if (res.code !== 0) return map;
  const records = res.stdout.split("\0").filter(Boolean);
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const xy = record.slice(0, 2);
    const path = record.slice(3);
    if (!path) continue;
    if (xy === "??") {
      map.set(path, "A");
      continue;
    }
    // Renames/copies emit "XY PATH" followed by a separate "ORIG_PATH"
    // record (the -z form drops the " -> " separator) - skip that record.
    // R/C can land in either column: the index side (staged rename) or the
    // worktree side (unstaged rename, only detected when a rename-tracking
    // config/flag is active) - check both, not just xy[0].
    if (xy[0] === "R" || xy[0] === "C" || xy[1] === "R" || xy[1] === "C") {
      i++;
      map.set(path, "R");
      continue;
    }
    const code = xy[0] !== " " ? xy[0] : xy[1];
    if (code && code !== " ") map.set(path, code);
  }
  setTimedCacheEntry(repoStatusMapCache, cwd, { map }, now);
  return map;
}

export function show(
  ref: string,
  path: string,
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  return run(["git", "show", `${ref}:${path}`], cwd);
}

export function showAsync(
  ref: string,
  path: string,
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runGitAsync(["git", "show", `${ref}:${path}`], cwd);
}

// Resolves a symlink raw target text (relative to the link own directory,
// git-style forward slashes) to a repo-relative path. Absolute targets and
// targets that escape the repo root resolve to null - same "do not follow
// outside the tree" stance as safeWorktreePath in search-service.
export function resolveSymlinkPath(
  linkPath: string,
  target: string,
): string | null {
  if (!target || target.startsWith("/") || target.includes("\0")) return null;
  const baseDir = dirname(linkPath);
  const combined = baseDir === "." ? target : `${baseDir}/${target}`;
  const normalized = posix.normalize(combined);
  if (normalized === "." || normalized === "") return "";
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

// Committed-ref symlinks do not carry their target text in `ls-tree` output
// (only the mode flags them as a symlink) - the target is the blob content
// itself, so resolving it costs a `git show` + `git cat-file -t`. Only
// called for the non-recursive listing (attachTreeEntryMetadata), never for
// the flat recursive file list, to keep that path cheap.
export async function gitSymlinkTargetMetadataAsync(
  ref: string,
  path: string,
  cwd: string,
): Promise<{
  symlink_target?: string;
  symlink_target_type: "tree" | "blob" | "missing";
  resolved_path?: string;
}> {
  const res = await showAsync(ref, path, cwd);
  if (res.code !== 0) return { symlink_target_type: "missing" };
  const target = res.stdout;
  const resolved = resolveSymlinkPath(path, target);
  if (resolved === null)
    return { symlink_target: target, symlink_target_type: "missing" };
  const type = await runGitAsync(
    ["git", "cat-file", "-t", `${ref}:${resolved}`],
    cwd,
  );
  const kind = type.stdout.trim();
  const symlink_target_type: "tree" | "blob" | "missing" =
    kind === "tree" ? "tree" : kind === "blob" ? "blob" : "missing";
  return symlink_target_type === "missing"
    ? { symlink_target: target, symlink_target_type }
    : { symlink_target: target, symlink_target_type, resolved_path: resolved };
}

export function showBytes(
  ref: string,
  path: string,
  cwd: string,
): { code: number; stdout: Uint8Array; stderr: string } {
  return runBytes(["git", "show", `${ref}:${path}`], cwd);
}

export function showBytesAsync(
  ref: string,
  path: string,
  cwd: string,
): Promise<{ code: number; stdout: Uint8Array; stderr: string }> {
  return runGitBytesAsync(["git", "show", `${ref}:${path}`], cwd);
}

export function catFileBlobStream(
  oid: string,
  cwd: string,
): {
  stream: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: string): void;
} {
  return spawnStream(resolveGitArgs(["git", "cat-file", "blob", oid]), cwd);
}

export function objectSize(
  ref: string,
  path: string,
  cwd: string,
): { code: number; size: number; stderr: string } {
  const res = run(["git", "cat-file", "-s", `${ref}:${path}`], cwd);
  return {
    code: res.code,
    size: Number(res.stdout.trim()) || 0,
    stderr: res.stderr,
  };
}

export async function objectSizeAsync(
  ref: string,
  path: string,
  cwd: string,
): Promise<{ code: number; size: number; stderr: string }> {
  const res = await runGitAsync(
    ["git", "cat-file", "-s", `${ref}:${path}`],
    cwd,
  );
  return {
    code: res.code,
    size: Number(res.stdout.trim()) || 0,
    stderr: res.stderr,
  };
}

export function objectByteSize(
  oid: string,
  cwd: string,
): { code: number; size: number; stderr: string } {
  const res = run(["git", "cat-file", "-s", oid], cwd);
  return {
    code: res.code,
    size: Number(res.stdout.trim()) || 0,
    stderr: res.stderr,
  };
}

export async function objectByteSizeAsync(
  oid: string,
  cwd: string,
): Promise<{ code: number; size: number; stderr: string }> {
  const res = await runGitAsync(["git", "cat-file", "-s", oid], cwd);
  return {
    code: res.code,
    size: Number(res.stdout.trim()) || 0,
    stderr: res.stderr,
  };
}

export function lastCommitDateForPath(
  ref: string,
  path: string,
  cwd: string,
): string | null {
  const args = ["git", "log", "-1", "--format=%cI", ref, "--", path];
  const res = run(args, cwd);
  if (res.code !== 0) return null;
  return res.stdout.trim() || null;
}

export async function lastCommitDateForPathAsync(
  ref: string,
  path: string,
  cwd: string,
): Promise<string | null> {
  const args = ["git", "log", "-1", "--format=%cI", ref, "--", path];
  const res = await runGitAsync(args, cwd);
  if (res.code !== 0) return null;
  return res.stdout.trim() || null;
}

export function objectId(
  ref: string,
  path: string,
  cwd: string,
): { code: number; oid: string; stderr: string } {
  const res = run(["git", "rev-parse", "--verify", `${ref}:${path}`], cwd);
  const oid = res.stdout.trim();
  if (res.code !== 0 || !oid)
    return { code: res.code || 1, oid: "", stderr: res.stderr };
  const type = run(["git", "cat-file", "-t", oid], cwd);
  if (type.code !== 0 || type.stdout.trim() !== "blob")
    return { code: 1, oid: "", stderr: type.stderr };
  return { code: 0, oid, stderr: "" };
}

export async function objectIdAsync(
  ref: string,
  path: string,
  cwd: string,
): Promise<{ code: number; oid: string; stderr: string }> {
  const res = await runGitAsync(
    ["git", "rev-parse", "--verify", `${ref}:${path}`],
    cwd,
  );
  const oid = res.stdout.trim();
  if (res.code !== 0 || !oid)
    return { code: res.code || 1, oid: "", stderr: res.stderr };
  const type = await runGitAsync(["git", "cat-file", "-t", oid], cwd);
  if (type.code !== 0 || type.stdout.trim() !== "blob")
    return { code: 1, oid: "", stderr: type.stderr };
  return { code: 0, oid, stderr: "" };
}

export function verifyTreeRef(ref: string, cwd: string): boolean {
  return verifyTreeRefResult(ref, cwd).ok;
}

export function verifyTreeRefResult(
  ref: string,
  cwd: string,
): { ok: true } | ({ ok: false } & GitErrorResult) {
  if (!ref || ref === "worktree")
    return { ok: false, error: "invalid target", status: 400 };
  if (ref.startsWith("-"))
    return { ok: false, error: "invalid target", status: 400 };
  const res = run(["git", "rev-parse", "--verify", `${ref}^{tree}`], cwd);
  if (res.code === 0) return { ok: true };
  return { ok: false, ...gitFailureResult(res, "invalid target") };
}

export async function verifyTreeRefResultAsync(
  ref: string,
  cwd: string,
): Promise<{ ok: true } | ({ ok: false } & GitErrorResult)> {
  if (!ref || ref === "worktree")
    return { ok: false, error: "invalid target", status: 400 };
  if (ref.startsWith("-"))
    return { ok: false, error: "invalid target", status: 400 };
  const res = await runGitAsync(
    ["git", "rev-parse", "--verify", `${ref}^{tree}`],
    cwd,
  );
  if (res.code === 0) return { ok: true };
  return { ok: false, ...gitFailureResult(res, "invalid target") };
}

export type GitRefs = {
  branches: GitBranchMeta[];
  tags: GitTagMeta[];
  commits: GitCommitMeta[];
  current: string;
};

export function refs(cwd: string): GitRefs {
  return refsResult(cwd).refs;
}

export function refsResult(
  cwd: string,
): { refs: GitRefs } & Partial<GitErrorResult> {
  const out = {
    branches: [] as GitBranchMeta[],
    tags: [] as GitTagMeta[],
    commits: [] as GitCommitMeta[],
    current: "",
  };
  const branches = run(
    [
      "git",
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname)%09%(refname:short)%09%(committerdate:iso-strict)",
      "refs/heads",
      "refs/remotes",
    ],
    cwd,
  );
  if (branches.code !== 0 && isCommandNotFoundResult("git", branches)) {
    return { refs: out, ...gitFailureResult(branches, "git refs failed") };
  }
  if (branches.code === 0) {
    for (const line of branches.stdout.split("\n")) {
      const [fullName, name, when] = line.split("\t");
      if (
        !fullName ||
        !name ||
        (fullName.startsWith("refs/remotes/") && fullName.endsWith("/HEAD"))
      )
        continue;
      out.branches.push({ name, when });
    }
  }
  const tags = run(
    [
      "git",
      "for-each-ref",
      "--sort=-creatordate",
      "--format=%(refname:short)%09%(creatordate:iso-strict)",
      "refs/tags",
    ],
    cwd,
  );
  if (tags.code !== 0 && isCommandNotFoundResult("git", tags)) {
    return { refs: out, ...gitFailureResult(tags, "git refs failed") };
  }
  if (tags.code === 0) {
    for (const line of tags.stdout.split("\n")) {
      const [name, when] = line.split("\t");
      if (!name) continue;
      out.tags.push({ name, when });
    }
  }
  const commits = refCommitPageResult(cwd, {
    query: "",
    max: DEFAULT_REF_COMMIT_LIMIT,
  });
  if (commits.error) {
    return { refs: out, error: commits.error, status: commits.status };
  }
  out.commits = commits.commits;
  out.current = currentBranch(cwd) || "";
  return { refs: out };
}

export async function refsResultAsync(
  cwd: string,
): Promise<{ refs: GitRefs } & Partial<GitErrorResult>> {
  const out = {
    branches: [] as GitBranchMeta[],
    tags: [] as GitTagMeta[],
    commits: [] as GitCommitMeta[],
    current: "",
  };
  const branches = await runGitAsync(
    [
      "git",
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname)%09%(refname:short)%09%(committerdate:iso-strict)",
      "refs/heads",
      "refs/remotes",
    ],
    cwd,
  );
  if (branches.code !== 0 && isCommandNotFoundResult("git", branches)) {
    return { refs: out, ...gitFailureResult(branches, "git refs failed") };
  }
  if (branches.code === 0) {
    for (const line of branches.stdout.split("\n")) {
      const [fullName, name, when] = line.split("\t");
      if (
        !fullName ||
        !name ||
        (fullName.startsWith("refs/remotes/") && fullName.endsWith("/HEAD"))
      )
        continue;
      out.branches.push({ name, when });
    }
  }
  const tags = await runGitAsync(
    [
      "git",
      "for-each-ref",
      "--sort=-creatordate",
      "--format=%(refname:short)%09%(creatordate:iso-strict)",
      "refs/tags",
    ],
    cwd,
  );
  if (tags.code !== 0 && isCommandNotFoundResult("git", tags)) {
    return { refs: out, ...gitFailureResult(tags, "git refs failed") };
  }
  if (tags.code === 0) {
    for (const line of tags.stdout.split("\n")) {
      const [name, when] = line.split("\t");
      if (!name) continue;
      out.tags.push({ name, when });
    }
  }
  const commits = await refCommitPageResultAsync(cwd, {
    query: "",
    max: DEFAULT_REF_COMMIT_LIMIT,
  });
  if (commits.error) {
    return { refs: out, error: commits.error, status: commits.status };
  }
  out.commits = commits.commits;
  out.current = (await currentBranchAsync(cwd)) || "";
  return { refs: out };
}

function clampCommitLimit(max: number): number {
  return Math.max(1, Math.min(max, MAX_REF_COMMIT_LIMIT));
}

function clampCommitSkip(skip: number): number {
  return Math.max(0, Math.floor(skip) || 0);
}

function parseCommitLog(stdout: string): GitCommitMeta[] {
  const parts = stdout.split("\0");
  const commits: GitCommitMeta[] = [];
  for (let index = 0; index < parts.length; ) {
    if (!parts[index]) {
      index++;
      continue;
    }
    const sha = parts[index++] || "";
    const subject = parts[index++] || "";
    const author = parts[index++] || "";
    const when = parts[index++] || "";
    if (sha) commits.push({ sha, subject, author, when });
  }
  return commits;
}

function commitLogArgs(limit: number, skip = 0): string[] {
  const args = [
    "git",
    "log",
    "--all",
    "-z",
    `--max-count=${limit}`,
    `--format=${COMMIT_FORMAT}`,
  ];
  if (skip > 0) args.splice(4, 0, `--skip=${skip}`);
  return args;
}

function mergeCommitResults(
  limit: number,
  ...groups: GitCommitMeta[][]
): GitCommitMeta[] {
  const seen = new Set<string>();
  const merged: GitCommitMeta[] = [];
  for (const commits of groups) {
    for (const commit of commits) {
      if (!commit.sha || seen.has(commit.sha)) continue;
      seen.add(commit.sha);
      merged.push(commit);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}

function runCommitLogResult(
  cwd: string,
  args: string[],
): { commits: GitCommitMeta[] } & Partial<GitErrorResult> {
  const commits = run(args, cwd);
  if (commits.code === 0) return { commits: parseCommitLog(commits.stdout) };
  if (isCommandNotFoundResult("git", commits))
    return { commits: [], ...gitFailureResult(commits, "git log failed") };
  return { commits: [] };
}

async function runCommitLogResultAsync(
  cwd: string,
  args: string[],
): Promise<{ commits: GitCommitMeta[] } & Partial<GitErrorResult>> {
  const commits = await runGitAsync(args, cwd);
  if (commits.code === 0) return { commits: parseCommitLog(commits.stdout) };
  if (isCommandNotFoundResult("git", commits))
    return { commits: [], ...gitFailureResult(commits, "git log failed") };
  return { commits: [] };
}

export function refCommits(
  cwd: string,
  query = "",
  max = DEFAULT_REF_COMMIT_LIMIT,
): GitCommitMeta[] {
  return refCommitPageResult(cwd, { query, max }).commits;
}

export function refCommitPage(
  cwd: string,
  options: { query?: string; max?: number; skip?: number } = {},
): { commits: GitCommitMeta[]; hasMore: boolean } {
  const result = refCommitPageResult(cwd, options);
  return { commits: result.commits, hasMore: result.hasMore };
}

export function refCommitPageResult(
  cwd: string,
  options: { query?: string; max?: number; skip?: number } = {},
): { commits: GitCommitMeta[]; hasMore: boolean } & Partial<GitErrorResult> {
  const limit = clampCommitLimit(options.max ?? DEFAULT_REF_COMMIT_LIMIT);
  const skip = clampCommitSkip(options.skip ?? 0);
  const fetchLimit = limit + 1;
  const hashMatches: GitCommitMeta[] = [];
  const trimmed = (options.query || "").trim().slice(0, 200).replace(/\0/g, "");
  if (skip === 0 && /^[0-9a-f]{4,40}$/i.test(trimmed)) {
    const verified = run(
      ["git", "rev-parse", "--verify", `${trimmed}^{commit}`],
      cwd,
    );
    if (verified.code !== 0 && isCommandNotFoundResult("git", verified)) {
      return {
        commits: [],
        hasMore: false,
        ...gitFailureResult(verified, "unknown ref"),
      };
    }
    const single = run(
      [
        "git",
        "log",
        "-z",
        "-1",
        `--format=${COMMIT_FORMAT}`,
        verified.code === 0 && verified.stdout.trim()
          ? verified.stdout.trim()
          : trimmed,
      ],
      cwd,
    );
    if (single.code !== 0 && isCommandNotFoundResult("git", single)) {
      return {
        commits: [],
        hasMore: false,
        ...gitFailureResult(single, "git log failed"),
      };
    }
    if (single.code === 0 && single.stdout.trim()) {
      hashMatches.push(...parseCommitLog(single.stdout));
    }
  }
  if (!trimmed) {
    const result = runCommitLogResult(cwd, commitLogArgs(fetchLimit, skip));
    if (result.error) {
      return {
        commits: [],
        hasMore: false,
        error: result.error,
        status: result.status,
      };
    }
    const commits = result.commits;
    return {
      commits: commits.slice(0, limit),
      hasMore: commits.length > limit,
    };
  }
  const subjectMatches = runCommitLogResult(cwd, [
    ...commitLogArgs(fetchLimit, skip),
    "--regexp-ignore-case",
    "--fixed-strings",
    `--grep=${trimmed}`,
  ]);
  if (subjectMatches.error) {
    return {
      commits: [],
      hasMore: false,
      error: subjectMatches.error,
      status: subjectMatches.status,
    };
  }
  const authorMatches = runCommitLogResult(cwd, [
    ...commitLogArgs(fetchLimit, skip),
    "--regexp-ignore-case",
    "--fixed-strings",
    `--author=${trimmed}`,
  ]);
  if (authorMatches.error) {
    return {
      commits: [],
      hasMore: false,
      error: authorMatches.error,
      status: authorMatches.status,
    };
  }
  const merged = mergeCommitResults(
    fetchLimit,
    hashMatches,
    subjectMatches.commits,
    authorMatches.commits,
  );
  return {
    commits: merged.slice(0, limit),
    hasMore: merged.length > limit,
  };
}

export async function refCommitPageResultAsync(
  cwd: string,
  options: { query?: string; max?: number; skip?: number } = {},
): Promise<
  { commits: GitCommitMeta[]; hasMore: boolean } & Partial<GitErrorResult>
> {
  const limit = clampCommitLimit(options.max ?? DEFAULT_REF_COMMIT_LIMIT);
  const skip = clampCommitSkip(options.skip ?? 0);
  const fetchLimit = limit + 1;
  const hashMatches: GitCommitMeta[] = [];
  const trimmed = (options.query || "").trim().slice(0, 200).replace(/\0/g, "");
  if (skip === 0 && /^[0-9a-f]{4,40}$/i.test(trimmed)) {
    const verified = await runGitAsync(
      ["git", "rev-parse", "--verify", `${trimmed}^{commit}`],
      cwd,
    );
    if (verified.code !== 0 && isCommandNotFoundResult("git", verified)) {
      return {
        commits: [],
        hasMore: false,
        ...gitFailureResult(verified, "unknown ref"),
      };
    }
    const single = await runGitAsync(
      [
        "git",
        "log",
        "-z",
        "-1",
        `--format=${COMMIT_FORMAT}`,
        verified.code === 0 && verified.stdout.trim()
          ? verified.stdout.trim()
          : trimmed,
      ],
      cwd,
    );
    if (single.code !== 0 && isCommandNotFoundResult("git", single)) {
      return {
        commits: [],
        hasMore: false,
        ...gitFailureResult(single, "git log failed"),
      };
    }
    if (single.code === 0 && single.stdout.trim()) {
      hashMatches.push(...parseCommitLog(single.stdout));
    }
  }
  if (!trimmed) {
    const result = await runCommitLogResultAsync(
      cwd,
      commitLogArgs(fetchLimit, skip),
    );
    if (result.error) {
      return {
        commits: [],
        hasMore: false,
        error: result.error,
        status: result.status,
      };
    }
    const commits = result.commits;
    return {
      commits: commits.slice(0, limit),
      hasMore: commits.length > limit,
    };
  }
  const [subjectMatches, authorMatches] = await Promise.all([
    runCommitLogResultAsync(cwd, [
      ...commitLogArgs(fetchLimit, skip),
      "--regexp-ignore-case",
      "--fixed-strings",
      `--grep=${trimmed}`,
    ]),
    runCommitLogResultAsync(cwd, [
      ...commitLogArgs(fetchLimit, skip),
      "--regexp-ignore-case",
      "--fixed-strings",
      `--author=${trimmed}`,
    ]),
  ]);
  if (subjectMatches.error) {
    return {
      commits: [],
      hasMore: false,
      error: subjectMatches.error,
      status: subjectMatches.status,
    };
  }
  if (authorMatches.error) {
    return {
      commits: [],
      hasMore: false,
      error: authorMatches.error,
      status: authorMatches.status,
    };
  }
  const merged = mergeCommitResults(
    fetchLimit,
    hashMatches,
    subjectMatches.commits,
    authorMatches.commits,
  );
  return {
    commits: merged.slice(0, limit),
    hasMore: merged.length > limit,
  };
}

// Converts a git remote URL to the matching https web URL (GitHub-style
// hosts). Returns null for local paths and other non-web remotes.
export function parseRemoteWebUrl(remote: string): string | null {
  const raw = (remote || "").trim();
  if (!raw) return null;
  const sshShorthand = /^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/.exec(raw);
  if (sshShorthand) return `https://${sshShorthand[1]}/${sshShorthand[2]}`;
  const sshUrl =
    /^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(raw);
  if (sshUrl) return `https://${sshUrl[1]}/${sshUrl[2]}`;
  const httpUrl = /^https?:\/\/([\w.-]+)\/(.+?)(?:\.git)?\/?$/.exec(raw);
  if (httpUrl) return `https://${httpUrl[1]}/${httpUrl[2]}`;
  return null;
}

export function remoteWebUrl(cwd: string): string | null {
  const res = run(["git", "remote", "get-url", "origin"], cwd);
  if (res.code !== 0) return null;
  return parseRemoteWebUrl(res.stdout.trim());
}

export async function remoteWebUrlAsync(cwd: string): Promise<string | null> {
  const res = await runGitAsync(["git", "remote", "get-url", "origin"], cwd);
  if (res.code !== 0) return null;
  return parseRemoteWebUrl(res.stdout.trim());
}

export type GitHistoryCommit = GitCommitMeta & {
  parents: string[];
  body: string;
};

const HISTORY_FORMAT = "%H%x00%s%x00%an%x00%aI%x00%P%x00%b";
const MAX_HISTORY_LIMIT = 200;

function parseHistoryLog(stdout: string): GitHistoryCommit[] {
  const parts = stdout.split("\0");
  const commits: GitHistoryCommit[] = [];
  for (let index = 0; index < parts.length; ) {
    if (!parts[index]) {
      index++;
      continue;
    }
    const sha = parts[index++] || "";
    const subject = parts[index++] || "";
    const author = parts[index++] || "";
    const when = parts[index++] || "";
    const parentsRaw = (parts[index++] || "").trim();
    const body = (parts[index++] || "").trim();
    if (sha)
      commits.push({
        sha,
        subject,
        author,
        when,
        parents: parentsRaw ? parentsRaw.split(/\s+/) : [],
        body,
      });
  }
  return commits;
}

// "author:foo" / "path:foo" switch the search target; anything else matches
// the commit message (and, for hex-looking terms, a sha prefix).
function historyQueryArgs(query: string): {
  filterArgs: string[];
  pathspec: string[];
  shaTerm: string;
} {
  const trimmed = query.trim().slice(0, 200).replace(/\0/g, "");
  if (!trimmed) return { filterArgs: [], pathspec: [], shaTerm: "" };
  const prefixed = /^(author|path):(.*)$/.exec(trimmed);
  if (prefixed) {
    const term = prefixed[2].trim();
    if (!term) return { filterArgs: [], pathspec: [], shaTerm: "" };
    if (prefixed[1] === "author") {
      return {
        filterArgs: [
          "--regexp-ignore-case",
          "--fixed-strings",
          `--author=${term}`,
        ],
        pathspec: [],
        shaTerm: "",
      };
    }
    return {
      filterArgs: [],
      pathspec: ["--", `:(icase)*${term}*`],
      shaTerm: "",
    };
  }
  return {
    filterArgs: [
      "--regexp-ignore-case",
      "--fixed-strings",
      `--grep=${trimmed}`,
    ],
    pathspec: [],
    shaTerm: /^[0-9a-f]{4,40}$/i.test(trimmed) ? trimmed : "",
  };
}

export function commitHistory(
  cwd: string,
  options: {
    ref: string;
    skip: number;
    limit: number;
    query?: string;
    path?: string;
  },
): {
  commits: GitHistoryCommit[];
  hasMore: boolean;
  error?: string;
  status?: number;
} {
  const ref = (options.ref || "HEAD").trim();
  if (!ref || ref.startsWith("-") || ref.includes("\0"))
    return { commits: [], hasMore: false, error: "invalid ref" };
  const verified = run(
    ["git", "rev-parse", "--verify", `${ref}^{commit}`],
    cwd,
  );
  if (verified.code !== 0)
    return {
      commits: [],
      hasMore: false,
      ...gitFailureResult(verified, "unknown ref"),
    };
  const skip = Math.max(0, Math.floor(options.skip) || 0);
  const limit = Math.max(
    1,
    Math.min(Math.floor(options.limit) || 1, MAX_HISTORY_LIMIT),
  );
  const { filterArgs, pathspec, shaTerm } = historyQueryArgs(
    options.query || "",
  );
  const pathFilter = (options.path || "").trim();
  // When the caller pins a path, follow renames through history. Skip --follow
  // for directories (git --follow rejects them) by treating any path ending in
  // "/" as a directory and not adding --follow.
  const pathArgs: string[] = [];
  if (pathFilter && !pathFilter.includes("\0") && !pathFilter.startsWith("-")) {
    if (!pathFilter.endsWith("/")) pathArgs.push("--follow");
    pathArgs.push("--", pathFilter);
  }
  const res = run(
    [
      "git",
      "log",
      "-z",
      `--skip=${skip}`,
      `--max-count=${limit + 1}`,
      `--format=${HISTORY_FORMAT}`,
      ...filterArgs,
      verified.stdout.trim(),
      ...pathspec,
      ...pathArgs,
    ],
    cwd,
  );
  if (res.code !== 0)
    return {
      commits: [],
      hasMore: false,
      ...gitFailureResult(res, "git log failed"),
    };
  let parsed = parseHistoryLog(res.stdout);
  // A hex-looking term also matches a commit by sha prefix; pin that commit
  // ahead of message matches on the first page.
  if (shaTerm && skip === 0) {
    const bySha = run(
      ["git", "rev-parse", "--verify", `${shaTerm}^{commit}`],
      cwd,
    );
    const sha = bySha.code === 0 ? bySha.stdout.trim() : "";
    if (sha) {
      const single = run(
        ["git", "log", "-z", "-1", `--format=${HISTORY_FORMAT}`, sha],
        cwd,
      );
      if (single.code === 0) {
        const hit = parseHistoryLog(single.stdout);
        parsed = [...hit, ...parsed.filter((c) => c.sha !== sha)];
      }
    }
  }
  const hasMore = parsed.length > limit;
  return { commits: hasMore ? parsed.slice(0, limit) : parsed, hasMore };
}

export async function commitHistoryAsync(
  cwd: string,
  options: {
    ref: string;
    skip: number;
    limit: number;
    query?: string;
    path?: string;
  },
): Promise<{
  commits: GitHistoryCommit[];
  hasMore: boolean;
  error?: string;
  status?: number;
}> {
  const ref = (options.ref || "HEAD").trim();
  if (!ref || ref.startsWith("-") || ref.includes("\0"))
    return { commits: [], hasMore: false, error: "invalid ref" };
  const verified = await runGitAsync(
    ["git", "rev-parse", "--verify", `${ref}^{commit}`],
    cwd,
  );
  if (verified.code !== 0)
    return {
      commits: [],
      hasMore: false,
      ...gitFailureResult(verified, "unknown ref"),
    };
  const skip = Math.max(0, Math.floor(options.skip) || 0);
  const limit = Math.max(
    1,
    Math.min(Math.floor(options.limit) || 1, MAX_HISTORY_LIMIT),
  );
  const { filterArgs, pathspec, shaTerm } = historyQueryArgs(
    options.query || "",
  );
  const pathFilter = (options.path || "").trim();
  const pathArgs: string[] = [];
  if (pathFilter && !pathFilter.includes("\0") && !pathFilter.startsWith("-")) {
    if (!pathFilter.endsWith("/")) pathArgs.push("--follow");
    pathArgs.push("--", pathFilter);
  }
  const res = await runGitAsync(
    [
      "git",
      "log",
      "-z",
      `--skip=${skip}`,
      `--max-count=${limit + 1}`,
      `--format=${HISTORY_FORMAT}`,
      ...filterArgs,
      verified.stdout.trim(),
      ...pathspec,
      ...pathArgs,
    ],
    cwd,
  );
  if (res.code !== 0)
    return {
      commits: [],
      hasMore: false,
      ...gitFailureResult(res, "git log failed"),
    };
  let parsed = parseHistoryLog(res.stdout);
  if (shaTerm && skip === 0) {
    const bySha = await runGitAsync(
      ["git", "rev-parse", "--verify", `${shaTerm}^{commit}`],
      cwd,
    );
    const sha = bySha.code === 0 ? bySha.stdout.trim() : "";
    if (sha) {
      const single = await runGitAsync(
        ["git", "log", "-z", "-1", `--format=${HISTORY_FORMAT}`, sha],
        cwd,
      );
      if (single.code === 0) {
        const hit = parseHistoryLog(single.stdout);
        parsed = [...hit, ...parsed.filter((c) => c.sha !== sha)];
      }
    }
  }
  const hasMore = parsed.length > limit;
  return { commits: hasMore ? parsed.slice(0, limit) : parsed, hasMore };
}

export function nameStatusResult(
  args: string[],
  cwd: string,
): GitFileMetaResult {
  const res = run(
    [
      "git",
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--name-status",
      "-z",
      ...args,
    ],
    cwd,
  );
  if (res.code !== 0) {
    return {
      files: [],
      error: gitFailureMessage(res, "git diff --name-status failed"),
    };
  }
  const parts = res.stdout.split("\0");
  const files: GitFileMeta[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (!status) break;
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const oldPath = parts[i++] || "";
      const path = parts[i++] || "";
      if (path)
        files.push({
          status: kind,
          old_path: oldPath,
          path,
          similarity: Number(status.slice(1)) || undefined,
        });
    } else {
      const path = parts[i++] || "";
      if (path) files.push({ status: kind, path });
    }
  }
  return { files };
}

export async function nameStatusResultAsync(
  args: string[],
  cwd: string,
): Promise<GitFileMetaResult> {
  const res = await runGitAsync(
    [
      "git",
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--name-status",
      "-z",
      ...args,
    ],
    cwd,
  );
  if (res.code !== 0) {
    return {
      files: [],
      error: gitFailureMessage(res, "git diff --name-status failed"),
    };
  }
  const parts = res.stdout.split("\0");
  const files: GitFileMeta[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (!status) break;
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const oldPath = parts[i++] || "";
      const path = parts[i++] || "";
      if (path)
        files.push({
          status: kind,
          old_path: oldPath,
          path,
          similarity: Number(status.slice(1)) || undefined,
        });
    } else {
      const path = parts[i++] || "";
      if (path) files.push({ status: kind, path });
    }
  }
  return { files };
}

export function nameStatus(args: string[], cwd: string): GitFileMeta[] {
  return nameStatusResult(args, cwd).files;
}

export function numstatZResult(args: string[], cwd: string): GitFileMetaResult {
  const res = run(
    [
      "git",
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--numstat",
      "-z",
      ...args,
    ],
    cwd,
  );
  if (res.code !== 0) {
    return {
      files: [],
      error: gitFailureMessage(res, "git diff --numstat failed"),
    };
  }
  const parts = res.stdout.split("\0");
  const files: GitFileMeta[] = [];
  for (let i = 0; i < parts.length; ) {
    const rec = parts[i++];
    if (!rec) break;
    const match = rec.match(/^(\S+)\t(\S+)\t(.*)$/);
    if (!match) break;
    const [, add, del, rest] = match;
    const binary = add === "-" && del === "-";
    const additions = binary ? 0 : Number(add) || 0;
    const deletions = binary ? 0 : Number(del) || 0;
    if (rest === "") {
      const oldPath = parts[i++] || "";
      const path = parts[i++] || "";
      if (path)
        files.push({ old_path: oldPath, path, additions, deletions, binary });
    } else {
      files.push({ path: rest, additions, deletions, binary });
    }
  }
  return { files };
}

export async function numstatZResultAsync(
  args: string[],
  cwd: string,
): Promise<GitFileMetaResult> {
  const res = await runGitAsync(
    [
      "git",
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--numstat",
      "-z",
      ...args,
    ],
    cwd,
  );
  if (res.code !== 0) {
    return {
      files: [],
      error: gitFailureMessage(res, "git diff --numstat failed"),
    };
  }
  const parts = res.stdout.split("\0");
  const files: GitFileMeta[] = [];
  for (let i = 0; i < parts.length; ) {
    const rec = parts[i++];
    if (!rec) break;
    const match = rec.match(/^(\S+)\t(\S+)\t(.*)$/);
    if (!match) break;
    const [, add, del, rest] = match;
    const binary = add === "-" && del === "-";
    const additions = binary ? 0 : Number(add) || 0;
    const deletions = binary ? 0 : Number(del) || 0;
    if (rest === "") {
      const oldPath = parts[i++] || "";
      const path = parts[i++] || "";
      if (path)
        files.push({ old_path: oldPath, path, additions, deletions, binary });
    } else {
      files.push({ path: rest, additions, deletions, binary });
    }
  }
  return { files };
}

export function numstatZ(args: string[], cwd: string): GitFileMeta[] {
  return numstatZResult(args, cwd).files;
}

// Shared "does this path contain segment X?" predicate, case-insensitive.
// Used to detect `.code-viewer` (tool metadata) and `.git` (git metadata)
// reliably across subsystems without each module reimplementing the same
// `split(/[\\/]+/).some(...)` loop. Pre-existing duplicates in file-cli /
// preview were both this same loop with only the excluded segment name
// differing; that's what triggered ai-dup-check before this helper was
// added.
function pathHasSegment(path: string, segment: string): boolean {
  const target = segment.toLowerCase();
  return path.split(/[\\/]+/).some((part) => part.toLowerCase() === target);
}

export function isToolInternalPath(path: string): boolean {
  return pathHasSegment(path, ".code-viewer");
}

export function isGitInternalPath(path: string): boolean {
  return pathHasSegment(path, ".git");
}

function syntheticUncommittedBlameFromWorktree(
  cwd: string,
  path: string,
): GitBlameResult {
  const filePath = join(cwd, path);
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return { lines: [], commits: {}, error: "not a file" };
    const text = readFileSync(filePath, "utf8");
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lineCount = normalized.length
      ? normalized.endsWith("\n")
        ? normalized.length - 1 === 0
          ? 1
          : normalized.split("\n").length - 1
        : normalized.split("\n").length
      : 1;
    const lines: GitBlameLine[] = [];
    for (let i = 1; i <= lineCount; i++) {
      lines.push({ lineNo: i, sha: BLAME_ZERO_SHA, isUncommitted: true });
    }
    return {
      lines,
      commits: {
        [BLAME_ZERO_SHA]: {
          sha: BLAME_ZERO_SHA,
          author: "Not Committed Yet",
          authorMail: "",
          authorTime: 0,
          summary: "Working tree",
          isUncommitted: true,
        },
      },
      isUntracked: true,
      isSynthetic: true,
    };
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === "ENOENT"
    ) {
      return { lines: [], commits: {}, error: "file not found" };
    }
    return { lines: [], commits: {}, error: "file not readable" };
  }
}

// git blame --porcelain parser. base "worktree": blame the working copy;
// base "HEAD": blame the committed snapshot at the given ref.
export function blame(
  cwd: string,
  options: { path: string; ref: string; base: GitBlameBase },
): GitBlameResult {
  const path = options.path;
  if (!path || path.includes("\0") || path.startsWith("-")) {
    return { lines: [], commits: {}, error: "invalid path" };
  }
  const normalized = normalizeBlameRef(options.ref, options.base);
  const args = ["git", "blame", "--porcelain"];
  if (normalized.base === "HEAD") {
    if (normalized.ref.startsWith("-") || normalized.ref.includes("\0"))
      return { lines: [], commits: {}, error: "invalid ref" };
    args.push(normalized.ref);
  }
  args.push("--", path);
  const res = run(args, cwd);
  if (res.code !== 0) {
    if (isCommandNotFoundResult("git", res)) {
      return {
        lines: [],
        commits: {},
        error: commandNotFoundDetail("git"),
        status: 503,
      };
    }
    if (normalized.base === "worktree") {
      // untracked / newly added file: synthesize an all-uncommitted blame.
      return syntheticUncommittedBlameFromWorktree(cwd, path);
    }
    return {
      lines: [],
      commits: {},
      error: res.stderr.trim() || "blame failed",
    };
  }
  const lines: GitBlameLine[] = [];
  const commits: Record<string, GitBlameCommit> = {};
  const rawLines = res.stdout.split("\n");
  let i = 0;
  while (i < rawLines.length) {
    const headerLine = rawLines[i];
    if (!headerLine) {
      i++;
      continue;
    }
    const headerMatch = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/.exec(
      headerLine,
    );
    if (!headerMatch) {
      i++;
      continue;
    }
    const sha = headerMatch[1];
    const finalLine = Number(headerMatch[3]);
    i++;
    let commit = commits[sha];
    if (!commit) {
      commit = {
        sha,
        author: "",
        authorMail: "",
        authorTime: 0,
        summary: "",
        isUncommitted: sha === BLAME_ZERO_SHA,
      };
      commits[sha] = commit;
    }
    while (i < rawLines.length && !rawLines[i].startsWith("\t")) {
      const metaLine = rawLines[i++];
      if (!metaLine) continue;
      const sp = metaLine.indexOf(" ");
      const key = sp >= 0 ? metaLine.slice(0, sp) : metaLine;
      const val = sp >= 0 ? metaLine.slice(sp + 1) : "";
      if (key === "author" && !commit.author) commit.author = val;
      else if (key === "author-mail" && !commit.authorMail)
        commit.authorMail = val.replace(/^</, "").replace(/>$/, "");
      else if (key === "author-time" && !commit.authorTime)
        commit.authorTime = Number(val) || 0;
      else if (key === "summary" && !commit.summary) commit.summary = val;
    }
    if (i < rawLines.length && rawLines[i].startsWith("\t")) i++;
    if (Number.isFinite(finalLine) && finalLine > 0) {
      lines.push({
        lineNo: finalLine,
        sha,
        isUncommitted: sha === BLAME_ZERO_SHA,
      });
    }
  }
  lines.sort((a, b) => a.lineNo - b.lineNo);
  return { lines, commits };
}

export async function blameAsync(
  cwd: string,
  options: { path: string; ref: string; base: GitBlameBase },
): Promise<GitBlameResult> {
  const path = options.path;
  if (!path || path.includes("\0") || path.startsWith("-")) {
    return { lines: [], commits: {}, error: "invalid path" };
  }
  const normalized = normalizeBlameRef(options.ref, options.base);
  const args = ["git", "blame", "--porcelain"];
  if (normalized.base === "HEAD") {
    if (normalized.ref.startsWith("-") || normalized.ref.includes("\0"))
      return { lines: [], commits: {}, error: "invalid ref" };
    args.push(normalized.ref);
  }
  args.push("--", path);
  const res = await runGitAsync(args, cwd);
  if (res.code !== 0) {
    if (isCommandNotFoundResult("git", res)) {
      return {
        lines: [],
        commits: {},
        error: commandNotFoundDetail("git"),
        status: 503,
      };
    }
    if (normalized.base === "worktree") {
      return syntheticUncommittedBlameFromWorktree(cwd, path);
    }
    return {
      lines: [],
      commits: {},
      error: res.stderr.trim() || "blame failed",
    };
  }
  const lines: GitBlameLine[] = [];
  const commits: Record<string, GitBlameCommit> = {};
  const rawLines = res.stdout.split("\n");
  let i = 0;
  while (i < rawLines.length) {
    const headerLine = rawLines[i];
    if (!headerLine) {
      i++;
      continue;
    }
    const headerMatch = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/.exec(
      headerLine,
    );
    if (!headerMatch) {
      i++;
      continue;
    }
    const sha = headerMatch[1];
    const finalLine = Number(headerMatch[3]);
    i++;
    let commit = commits[sha];
    if (!commit) {
      commit = {
        sha,
        author: "",
        authorMail: "",
        authorTime: 0,
        summary: "",
        isUncommitted: sha === BLAME_ZERO_SHA,
      };
      commits[sha] = commit;
    }
    while (i < rawLines.length && !rawLines[i].startsWith("\t")) {
      const metaLine = rawLines[i++];
      if (!metaLine) continue;
      const sp = metaLine.indexOf(" ");
      const key = sp >= 0 ? metaLine.slice(0, sp) : metaLine;
      const val = sp >= 0 ? metaLine.slice(sp + 1) : "";
      if (key === "author" && !commit.author) commit.author = val;
      else if (key === "author-mail" && !commit.authorMail)
        commit.authorMail = val.replace(/^</, "").replace(/>$/, "");
      else if (key === "author-time" && !commit.authorTime)
        commit.authorTime = Number(val) || 0;
      else if (key === "summary" && !commit.summary) commit.summary = val;
    }
    if (i < rawLines.length && rawLines[i].startsWith("\t")) i++;
    if (Number.isFinite(finalLine) && finalLine > 0) {
      lines.push({
        lineNo: finalLine,
        sha,
        isUncommitted: sha === BLAME_ZERO_SHA,
      });
    }
  }
  lines.sort((a, b) => a.lineNo - b.lineNo);
  return { lines, commits };
}

export function untracked(cwd: string, path = ""): string[] {
  const args = ["git", "ls-files", "--others", "--exclude-standard"];
  if (path) args.push("--", `${path}/`);
  const res = run(args, cwd);
  if (res.code !== 0) return [];
  return res.stdout
    .split("\n")
    .filter(Boolean)
    .filter((entry) => !isToolInternalPath(entry));
}

export async function untrackedAsync(
  cwd: string,
  path = "",
): Promise<string[]> {
  const args = ["git", "ls-files", "--others", "--exclude-standard"];
  if (path) args.push("--", `${path}/`);
  const res = await runGitAsync(args, cwd);
  if (res.code !== 0) return [];
  return res.stdout
    .split("\n")
    .filter(Boolean)
    .filter((entry) => !isToolInternalPath(entry));
}

function normalizeTreePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

function sortTreeEntries(entries: GitTreeEntry[]): GitTreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function omittedWorktreeDirectoryReason(
  name: string,
  omitDirNames: NamePatternSet,
): GitTreeEntry["children_omitted_reason"] | undefined {
  if (name === ".git") return "internal";
  return omitDirNames.matches(name) ? "heavy" : undefined;
}

function worktreeSubmodulePaths(cwd: string): Set<string> {
  if (!existsSync(join(cwd, ".gitmodules"))) return new Set();
  const res = run(
    ["git", "config", "--file", ".gitmodules", "--get-regexp", "\\.path$"],
    cwd,
  );
  if (res.code !== 0) return new Set();
  return new Set(
    res.stdout
      .split("\n")
      .map((line) => {
        const split = line.indexOf(" ");
        return split >= 0 ? normalizeTreePath(line.slice(split + 1)) : "";
      })
      .filter(Boolean),
  );
}

async function worktreeSubmodulePathsAsync(cwd: string): Promise<Set<string>> {
  if (!existsSync(join(cwd, ".gitmodules"))) return new Set();
  const res = await runGitAsync(
    ["git", "config", "--file", ".gitmodules", "--get-regexp", "\\.path$"],
    cwd,
  );
  if (res.code !== 0) return new Set();
  return new Set(
    res.stdout
      .split("\n")
      .map((line) => {
        const split = line.indexOf(" ");
        return split >= 0 ? normalizeTreePath(line.slice(split + 1)) : "";
      })
      .filter(Boolean),
  );
}

// Resolves `full` (an already-joined absolute path) only if it stays
// inside the repo rooted at `cwd` - same containment rule search-service
// enforces via safeWorktreePath for direct file reads. Not calling
// safeWorktreePath itself: search-service.ts imports git.ts, so the
// reverse import would create a cycle. `allowRoot` controls whether
// `full === cwd` counts as "inside": true for tree listing (path="" means
// the repo root itself), false for symlink target resolution (a link that
// resolves to the repo root is not a meaningful browsable target).
function realpathWithinRepo(
  cwd: string,
  full: string,
  allowRoot: boolean,
): string | null {
  try {
    const realCwd = realpathSync(cwd);
    const realFull = realpathSync(full);
    const rel = relative(realCwd, realFull);
    if (rel.startsWith("..") || rel.startsWith("/") || rel.startsWith("\\"))
      return null;
    if (rel === "" && !allowRoot) return null;
    return realFull;
  } catch {
    return null;
  }
}

// A symlink Dirent.isDirectory()/isFile() reflect the link itself (always
// false), never the target - so callers must resolve the target explicitly
// to know whether it behaves like a directory or a file in the tree. A
// target that resolves outside the repo root is treated as "missing" (not
// browsable).
function resolveWorktreeSymlinkTarget(
  cwd: string,
  full: string,
): {
  symlink_target?: string;
  symlink_target_type: "tree" | "blob" | "missing";
} {
  let symlink_target: string | undefined;
  try {
    symlink_target = readlinkSync(full);
  } catch {
    symlink_target = undefined;
  }
  let symlink_target_type: "tree" | "blob" | "missing" = "missing";
  if (realpathWithinRepo(cwd, full, false) !== null) {
    try {
      const stat = statSync(full);
      symlink_target_type = stat.isDirectory()
        ? "tree"
        : stat.isFile()
          ? "blob"
          : "missing";
    } catch {
      symlink_target_type = "missing";
    }
  }
  return symlink_target === undefined
    ? { symlink_target_type }
    : { symlink_target, symlink_target_type };
}

// Recursive worktree walks (used by search/flat-file listing) treat a
// symlink as a leaf blob rather than following it as a directory - that
// keeps the walk from cycling through a symlink loop. It still needs the
// same is_symlink/target metadata as the non-recursive listing so the
// explorer can badge it consistently wherever the entry surfaces.
function recursiveWorktreeFileEntry(
  cwd: string,
  full: string,
  name: string,
  path: string,
  isSymlink: boolean,
): GitTreeEntry {
  const symlinkInfo = isSymlink
    ? resolveWorktreeSymlinkTarget(cwd, full)
    : null;
  return {
    name,
    path,
    type: "blob",
    ...(symlinkInfo ? { is_symlink: true as const, ...symlinkInfo } : {}),
  };
}

function worktreeEntryFromDirent(
  cwd: string,
  base: string,
  dir: string,
  name: string,
  isDirectory: boolean,
  isSymlink: boolean,
  omitDirNames: NamePatternSet,
  excludeNames: NamePatternSet,
  submodulePaths: Set<string>,
): GitTreeEntry {
  if (excludeNames.matches(name))
    return {
      name,
      path: "",
      type: isDirectory ? "tree" : "blob",
    };
  const entryPath = base ? `${base}/${name}` : name;
  const symlinkInfo = isSymlink
    ? resolveWorktreeSymlinkTarget(cwd, join(dir, name))
    : null;
  // A symlink resolves to the target shape (tree/blob) so every type-based
  // branch downstream (navigation, sorting, icons) treats it like the real
  // target - is_symlink only changes how it is labeled.
  const resolvedIsDirectory = symlinkInfo
    ? symlinkInfo.symlink_target_type === "tree"
    : isDirectory;
  const type =
    symlinkInfo && symlinkInfo.symlink_target_type === "missing"
      ? ("blob" as const)
      : resolvedIsDirectory
        ? hasDotGitEntry(join(dir, name))
          ? ("commit" as const)
          : ("tree" as const)
        : ("blob" as const);
  const omittedReason =
    type === "tree"
      ? omittedWorktreeDirectoryReason(name, omitDirNames)
      : undefined;
  const submodule =
    type === "commit" && submodulePaths.has(entryPath) ? true : undefined;
  const baseEntry = {
    name,
    path: entryPath,
    type,
    ...(submodule ? { submodule } : {}),
    ...(symlinkInfo ? { is_symlink: true as const, ...symlinkInfo } : {}),
  } satisfies GitTreeEntry;
  return omittedReason
    ? {
        ...baseEntry,
        children_omitted: true,
        children_omitted_reason: omittedReason,
      }
    : baseEntry;
}

function worktreeFilesystemEntries(
  cwd: string,
  path: string,
  recursive: boolean,
  omitDirNames: string[] = DEFAULT_WORKTREE_OMIT_DIR_NAMES,
  excludeNames: string[] = [],
): GitTreeEntry[] {
  const base = normalizeTreePath(path);
  const root = join(cwd, base);
  // `path` can itself be (or pass through) a symlink that escapes the repo -
  // reject here so /_tree cannot be used to browse the host filesystem
  // through it, regardless of what the client-side type/is_symlink display
  // does.
  if (realpathWithinRepo(cwd, root, true) === null) return [];
  const omitDirNameSet = compileNamePatterns(omitDirNames);
  const excludeNameSet = compileNamePatterns(excludeNames);
  const submodulePaths = worktreeSubmodulePaths(cwd);
  let directEntries: GitTreeEntry[];
  try {
    const dirents = readdirSync(root, { withFileTypes: true });
    directEntries = sortTreeEntries(
      dirents
        .map((entry) =>
          worktreeEntryFromDirent(
            cwd,
            base,
            root,
            entry.name,
            entry.isDirectory(),
            entry.isSymbolicLink(),
            omitDirNameSet,
            excludeNameSet,
            submodulePaths,
          ),
        )
        .filter((entry) => entry.path),
    );
  } catch {
    return [];
  }
  if (!recursive) return directEntries;

  const fileEntries: GitTreeEntry[] = [];
  let truncated = false;
  const pushRecursiveEntry = (entry: GitTreeEntry): boolean => {
    if (fileEntries.length >= WORKTREE_RECURSIVE_ENTRY_LIMIT) {
      if (!truncated) {
        fileEntries.push({
          name: "more...",
          path: "__code_viewer_truncated__",
          type: "tree",
          children_omitted: true,
          children_omitted_reason: "truncated",
        });
        truncated = true;
      }
      return false;
    }
    fileEntries.push(entry);
    return true;
  };
  const walk = (dir: string, prefix: string, depth: number) => {
    if (truncated) return;
    if (depth >= WORKTREE_RECURSIVE_DEPTH_LIMIT) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (excludeNameSet.matches(entry.name)) continue;
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const omittedReason = omittedWorktreeDirectoryReason(
          entry.name,
          omitDirNameSet,
        );
        if (omittedReason) {
          if (
            !pushRecursiveEntry({
              name: entry.name,
              path: entryPath,
              type: "tree",
              children_omitted: true,
              children_omitted_reason: omittedReason,
            })
          )
            return;
          continue;
        }
        if (hasDotGitEntry(full)) continue;
        walk(full, entryPath, depth + 1);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (
          !pushRecursiveEntry(
            recursiveWorktreeFileEntry(
              cwd,
              full,
              entry.name,
              entryPath,
              entry.isSymbolicLink(),
            ),
          )
        )
          return;
      }
    }
  };
  walk(root, base, 0);
  return combineDirectAndRecursiveFiles(
    directEntries,
    fileEntries.sort((a, b) => a.path.localeCompare(b.path)),
  );
}

async function worktreeFilesystemEntriesAsync(
  cwd: string,
  path: string,
  recursive: boolean,
  omitDirNames: string[] = DEFAULT_WORKTREE_OMIT_DIR_NAMES,
  excludeNames: string[] = [],
): Promise<GitTreeEntry[]> {
  const base = normalizeTreePath(path);
  const root = join(cwd, base);
  // See worktreeFilesystemEntries (sync) for why this containment check
  // exists: `path` can pass through a symlink that escapes the repo.
  if (realpathWithinRepo(cwd, root, true) === null) return [];
  const omitDirNameSet = compileNamePatterns(omitDirNames);
  const excludeNameSet = compileNamePatterns(excludeNames);
  const submodulePaths = await worktreeSubmodulePathsAsync(cwd);
  let directEntries: GitTreeEntry[];
  try {
    const dirents = readdirSync(root, { withFileTypes: true });
    directEntries = sortTreeEntries(
      dirents
        .map((entry) =>
          worktreeEntryFromDirent(
            cwd,
            base,
            root,
            entry.name,
            entry.isDirectory(),
            entry.isSymbolicLink(),
            omitDirNameSet,
            excludeNameSet,
            submodulePaths,
          ),
        )
        .filter((entry) => entry.path),
    );
  } catch {
    return [];
  }
  if (!recursive) return directEntries;

  const fileEntries: GitTreeEntry[] = [];
  let truncated = false;
  const pushRecursiveEntry = (entry: GitTreeEntry): boolean => {
    if (fileEntries.length >= WORKTREE_RECURSIVE_ENTRY_LIMIT) {
      if (!truncated) {
        fileEntries.push({
          name: "more...",
          path: "__code_viewer_truncated__",
          type: "tree",
          children_omitted: true,
          children_omitted_reason: "truncated",
        });
        truncated = true;
      }
      return false;
    }
    fileEntries.push(entry);
    return true;
  };
  let visitedDirs = 0;
  const yieldIfNeeded = async () => {
    visitedDirs++;
    if (visitedDirs % 25 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  const walk = async (
    dir: string,
    prefix: string,
    depth: number,
  ): Promise<void> => {
    if (truncated) return;
    if (depth >= WORKTREE_RECURSIVE_DEPTH_LIMIT) return;
    await yieldIfNeeded();
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (excludeNameSet.matches(entry.name)) continue;
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const omittedReason = omittedWorktreeDirectoryReason(
          entry.name,
          omitDirNameSet,
        );
        if (omittedReason) {
          if (
            !pushRecursiveEntry({
              name: entry.name,
              path: entryPath,
              type: "tree",
              children_omitted: true,
              children_omitted_reason: omittedReason,
            })
          )
            return;
          continue;
        }
        if (hasDotGitEntry(full)) continue;
        await walk(full, entryPath, depth + 1);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (
          !pushRecursiveEntry(
            recursiveWorktreeFileEntry(
              cwd,
              full,
              entry.name,
              entryPath,
              entry.isSymbolicLink(),
            ),
          )
        )
          return;
      }
    }
  };
  await walk(root, base, 0);
  return combineDirectAndRecursiveFiles(
    directEntries,
    fileEntries.sort((a, b) => a.path.localeCompare(b.path)),
  );
}

function hasDotGitEntry(dir: string): boolean {
  try {
    lstatSync(join(dir, ".git"));
    return true;
  } catch (err) {
    return (
      !!err && typeof err === "object" && "code" in err && err.code !== "ENOENT"
    );
  }
}

// A ls-tree symlink record still reports the git object type "blob" (git
// stores the link target text as the blob content) - only mode 120000
// distinguishes it from a regular file. The target text itself is resolved
// separately (see gitSymlinkTargetMetadata) since ls-tree does not carry it.
const LS_TREE_SYMLINK_MODE = "120000";

function parseLsTreeRecord(
  rec: string,
  allowedTypes: string,
): GitTreeEntry | null {
  const match = rec.match(
    new RegExp(`^(\\d+)\\s+(${allowedTypes})\\s+[0-9a-fA-F]+\\t(.+)$`),
  );
  if (!match) return null;
  const [, mode, type, entryPath] = match;
  return {
    name: entryPath.split("/").pop() || entryPath,
    path: entryPath,
    type: type as GitTreeEntry["type"],
    ...(mode === LS_TREE_SYMLINK_MODE ? { is_symlink: true as const } : {}),
  };
}

function gitTreeEntries(
  ref: string,
  path: string,
  cwd: string,
  recursive: boolean,
): { code: number; entries: GitTreeEntry[]; stderr: string } {
  const base = normalizeTreePath(path);
  const args = ["git", "-c", "core.quotepath=false", "ls-tree"];
  if (recursive) args.push("-r");
  args.push("-z", "--full-tree", ref, "--");
  if (base) args.push(`${base}/`);
  const res = run(args, cwd);
  if (res.code !== 0)
    return { code: res.code, entries: [], stderr: res.stderr };
  const allowedTypes = recursive ? "blob|commit" : "tree|blob|commit";
  let entries = res.stdout
    .split("\0")
    .filter(Boolean)
    .map((rec) => parseLsTreeRecord(rec, allowedTypes))
    .filter((entry): entry is GitTreeEntry => !!entry);
  if (recursive) entries.sort((a, b) => a.path.localeCompare(b.path));
  else entries = sortTreeEntries(entries);
  return { code: 0, entries, stderr: "" };
}

async function gitTreeEntriesAsync(
  ref: string,
  path: string,
  cwd: string,
  recursive: boolean,
): Promise<{ code: number; entries: GitTreeEntry[]; stderr: string }> {
  const base = normalizeTreePath(path);
  const args = ["git", "-c", "core.quotepath=false", "ls-tree"];
  if (recursive) args.push("-r");
  args.push("-z", "--full-tree", ref, "--");
  if (base) args.push(`${base}/`);
  const res = await runGitAsync(args, cwd);
  if (res.code !== 0)
    return { code: res.code, entries: [], stderr: res.stderr };
  const allowedTypes = recursive ? "blob|commit" : "tree|blob|commit";
  let entries = res.stdout
    .split("\0")
    .filter(Boolean)
    .map((rec) => parseLsTreeRecord(rec, allowedTypes))
    .filter((entry): entry is GitTreeEntry => !!entry);
  if (recursive) entries.sort((a, b) => a.path.localeCompare(b.path));
  else entries = sortTreeEntries(entries);
  return { code: 0, entries, stderr: "" };
}

function combineDirectAndRecursiveFiles(
  directEntries: GitTreeEntry[],
  fileEntries: GitTreeEntry[],
): GitTreeEntry[] {
  const seen = new Set(directEntries.map((entry) => entry.path));
  return [
    ...directEntries,
    ...fileEntries.filter((entry) => !seen.has(entry.path)),
  ];
}

export function worktreeEntries(cwd: string, path: string): GitTreeEntry[] {
  return listTree("worktree", path, cwd).entries;
}

export function worktreeFiles(cwd: string): GitTreeEntry[] {
  return listTree("worktree", "", cwd, { recursive: true }).entries;
}

export function treeEntries(
  ref: string,
  path: string,
  cwd: string,
): { code: number; entries: GitTreeEntry[]; stderr: string } {
  return listTree(ref, path, cwd);
}

export function treeFiles(
  ref: string,
  cwd: string,
): { code: number; entries: GitTreeEntry[]; stderr: string } {
  return listTree(ref, "", cwd, { recursive: true });
}

export function listTree(
  ref: string,
  path: string,
  cwd: string,
  options: {
    recursive?: boolean;
    omitDirNames?: string[];
    excludeNames?: string[];
  } = {},
): { code: number; entries: GitTreeEntry[]; stderr: string } {
  const base = normalizeTreePath(path);
  if (ref === "worktree") {
    return {
      code: 0,
      entries: worktreeFilesystemEntries(
        cwd,
        base,
        !!options.recursive,
        options.omitDirNames,
        options.excludeNames,
      ),
      stderr: "",
    };
  }

  const direct = gitTreeEntries(ref, base, cwd, false);
  if (direct.code !== 0 || !options.recursive) return direct;
  const recursive = gitTreeEntries(ref, base, cwd, true);
  if (recursive.code !== 0) return recursive;
  return {
    code: 0,
    entries: combineDirectAndRecursiveFiles(direct.entries, recursive.entries),
    stderr: "",
  };
}

export async function listTreeAsync(
  ref: string,
  path: string,
  cwd: string,
  options: {
    recursive?: boolean;
    omitDirNames?: string[];
    excludeNames?: string[];
  } = {},
): Promise<{ code: number; entries: GitTreeEntry[]; stderr: string }> {
  const base = normalizeTreePath(path);
  if (ref === "worktree") {
    return {
      code: 0,
      entries: await worktreeFilesystemEntriesAsync(
        cwd,
        base,
        !!options.recursive,
        options.omitDirNames,
        options.excludeNames,
      ),
      stderr: "",
    };
  }

  const direct = await gitTreeEntriesAsync(ref, base, cwd, false);
  if (direct.code !== 0 || !options.recursive) return direct;
  const recursive = await gitTreeEntriesAsync(ref, base, cwd, true);
  if (recursive.code !== 0) return recursive;
  return {
    code: 0,
    entries: combineDirectAndRecursiveFiles(direct.entries, recursive.entries),
    stderr: "",
  };
}

export function listTreeResult(
  ref: string,
  path: string,
  cwd: string,
  options: {
    recursive?: boolean;
    omitDirNames?: string[];
    excludeNames?: string[];
  } = {},
): { entries: GitTreeEntry[] } & Partial<GitErrorResult> {
  const result = listTree(ref, path, cwd, options);
  if (result.code === 0) return { entries: result.entries };
  return { entries: [], ...gitFailureResult(result, "git ls-tree failed") };
}

export async function listTreeResultAsync(
  ref: string,
  path: string,
  cwd: string,
  options: {
    recursive?: boolean;
    omitDirNames?: string[];
    excludeNames?: string[];
  } = {},
): Promise<{ entries: GitTreeEntry[] } & Partial<GitErrorResult>> {
  const result = await listTreeAsync(ref, path, cwd, options);
  if (result.code === 0) return { entries: result.entries };
  return { entries: [], ...gitFailureResult(result, "git ls-tree failed") };
}

export function untrackedMeta(cwd: string): GitFileMeta[] {
  return untracked(cwd).flatMap((path) => {
    const full = join(cwd, path);
    let fileExists = false;
    try {
      fileExists = existsSync(full) && statSync(full).isFile();
    } catch {
      fileExists = false;
    }
    let scan: { binary: boolean; newlines: number };
    if (fileExists) {
      try {
        scan = scanFileBinaryAndNewlines(full);
      } catch {
        return [];
      }
    } else {
      return [];
    }
    return [
      {
        path,
        status: "A",
        additions: scan.binary ? 0 : scan.newlines,
        deletions: 0,
        binary: scan.binary,
        untracked: true,
      },
    ];
  });
}

export async function untrackedMetaAsync(cwd: string): Promise<GitFileMeta[]> {
  const paths = await untrackedAsync(cwd);
  return paths.flatMap((path) => {
    const full = join(cwd, path);
    let fileExists = false;
    try {
      fileExists = existsSync(full) && statSync(full).isFile();
    } catch {
      fileExists = false;
    }
    let scan: { binary: boolean; newlines: number };
    if (fileExists) {
      try {
        scan = scanFileBinaryAndNewlines(full);
      } catch {
        return [];
      }
    } else {
      return [];
    }
    return [
      {
        path,
        status: "A",
        additions: scan.binary ? 0 : scan.newlines,
        deletions: 0,
        binary: scan.binary,
        untracked: true,
      },
    ];
  });
}

function scanFileBinaryAndNewlines(full: string): {
  binary: boolean;
  newlines: number;
} {
  const fd = openSync(full, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let newlines = 0;
  let inspected = 0;
  try {
    while (true) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      const binaryProbeBytes = Math.min(read, Math.max(0, 8192 - inspected));
      for (let i = 0; i < binaryProbeBytes; i++) {
        if (buffer[i] === 0) return { binary: true, newlines: 0 };
      }
      inspected += read;
      for (let i = 0; i < read; i++) {
        if (buffer[i] === 10) newlines++;
      }
    }
  } finally {
    closeSync(fd);
  }
  return { binary: false, newlines };
}

export function fileMeta(
  args: string[],
  cwd: string,
  includeUntracked = false,
): GitFileMeta[] {
  return fileMetaResult(args, cwd, includeUntracked).files;
}

export function fileMetaResult(
  args: string[],
  cwd: string,
  includeUntracked = false,
): GitFileMetaResult {
  const ns = nameStatusResult(args, cwd);
  if (ns.error) return { files: [], error: ns.error };
  const nm = numstatZResult(args, cwd);
  if (nm.error) return { files: [], error: nm.error };
  const byPath = new Map(nm.files.map((file) => [file.path, file]));
  const files: GitFileMeta[] = ns.files.map((file) => {
    const stats = byPath.get(file.path);
    return {
      ...file,
      additions: stats?.additions || 0,
      deletions: stats?.deletions || 0,
      binary: stats?.binary || false,
    };
  });
  return {
    files: includeUntracked ? files.concat(untrackedMeta(cwd)) : files,
  };
}

export async function fileMetaResultAsync(
  args: string[],
  cwd: string,
  includeUntracked = false,
): Promise<GitFileMetaResult> {
  const ns = await nameStatusResultAsync(args, cwd);
  if (ns.error) return { files: [], error: ns.error };
  const nm = await numstatZResultAsync(args, cwd);
  if (nm.error) return { files: [], error: nm.error };
  const byPath = new Map(nm.files.map((file) => [file.path, file]));
  const files: GitFileMeta[] = ns.files.map((file) => {
    const stats = byPath.get(file.path);
    return {
      ...file,
      additions: stats?.additions || 0,
      deletions: stats?.deletions || 0,
      binary: stats?.binary || false,
    };
  });
  return {
    files: includeUntracked
      ? files.concat(await untrackedMetaAsync(cwd))
      : files,
  };
}

export function fileDiffText(
  args: string[],
  path: string | string[],
  cwd: string,
): { code: number; stdout: string; stderr: string; status?: number } {
  const paths = Array.isArray(path) ? path : [path];
  const res = run(
    [
      "git",
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      ...args,
      "--",
      ...paths,
    ],
    cwd,
  );
  if (isCommandNotFoundResult("git", res)) {
    return { ...res, stderr: commandNotFoundDetail("git"), status: 503 };
  }
  return res;
}

export async function fileDiffTextAsync(
  args: string[],
  path: string | string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string; status?: number }> {
  const paths = Array.isArray(path) ? path : [path];
  const res = await runGitAsync(
    [
      "git",
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      ...args,
      "--",
      ...paths,
    ],
    cwd,
  );
  if (isCommandNotFoundResult("git", res)) {
    return { ...res, stderr: commandNotFoundDetail("git"), status: 503 };
  }
  return res;
}

export function untrackedFileDiff(
  extras: string[],
  path: string,
  cwd: string,
): { code: number; stdout: string; stderr: string; status?: number } {
  const res = run(
    [
      "git",
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-index",
      ...extras,
      "/dev/null",
      path,
    ],
    cwd,
  );
  if (isCommandNotFoundResult("git", res)) {
    return { ...res, stderr: commandNotFoundDetail("git"), status: 503 };
  }
  return res;
}

export async function untrackedFileDiffAsync(
  extras: string[],
  path: string,
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string; status?: number }> {
  const res = await runGitAsync(
    [
      "git",
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-index",
      ...extras,
      "/dev/null",
      path,
    ],
    cwd,
  );
  if (isCommandNotFoundResult("git", res)) {
    return { ...res, stderr: commandNotFoundDetail("git"), status: 503 };
  }
  return res;
}

export function splitHunks(diffText: string): {
  header: string;
  hunks: string[];
} {
  if (!diffText) return { header: "", hunks: [] };
  const startsWithHunk = diffText.startsWith("@@");
  const first = startsWithHunk ? 0 : diffText.indexOf("\n@@");
  if (first < 0) return { header: diffText, hunks: [] };
  const hunkStart = startsWithHunk ? 0 : first + 1;
  if (hunkStart >= diffText.length) return { header: diffText, hunks: [] };
  const header = diffText.slice(0, hunkStart);
  const hunks: string[] = [];
  let cur = hunkStart;
  while (cur < diffText.length) {
    const next = diffText.indexOf("\n@@", cur + 1);
    const end = next >= 0 ? next : diffText.length;
    hunks.push(diffText.slice(cur, end));
    if (next < 0) break;
    cur = next + 1;
  }
  return { header, hunks };
}

export function truncateToNHunks(
  diffText: string,
  n: number,
): {
  text: string;
  totalHunks: number;
  renderedHunks: number;
  lineCount: number;
  lineTruncated: boolean;
};
export function truncateToNHunks(
  diffText: string,
  n: number,
  maxLines: number,
): {
  text: string;
  totalHunks: number;
  renderedHunks: number;
  lineCount: number;
  lineTruncated: boolean;
};
export function truncateToNHunks(
  diffText: string,
  n: number,
  maxLines = Number.POSITIVE_INFINITY,
): {
  text: string;
  totalHunks: number;
  renderedHunks: number;
  lineCount: number;
  lineTruncated: boolean;
} {
  const { header, hunks } = splitHunks(diffText);
  if (hunks.length === 0) {
    const lines = diffText.split("\n");
    const lineTruncated = Number.isFinite(maxLines) && lines.length > maxLines;
    const text = lineTruncated ? lines.slice(0, maxLines).join("\n") : diffText;
    return {
      text,
      totalHunks: 0,
      renderedHunks: 0,
      lineCount: (text.match(/\n/g) || []).length,
      lineTruncated,
    };
  }
  const maxHunks = Math.min(n, hunks.length);
  const rendered: string[] = [];
  let renderedHunks = 0;
  let usedLines = (header.match(/\n/g) || []).length;
  let lineTruncated = false;
  for (let index = 0; index < maxHunks; index++) {
    const hunk = hunks[index];
    const lines = hunk.split("\n");
    const separatorLines = rendered.length > 0 ? 1 : 0;
    const remaining = maxLines - usedLines - separatorLines;
    if (remaining <= 0) {
      lineTruncated = true;
      break;
    }
    if (Number.isFinite(maxLines) && lines.length > remaining) {
      rendered.push(lines.slice(0, remaining).join("\n"));
      renderedHunks++;
      lineTruncated = true;
      break;
    }
    rendered.push(hunk);
    renderedHunks++;
    usedLines += separatorLines + lines.length;
  }
  const text = header + rendered.join("\n");
  return {
    text,
    totalHunks: hunks.length,
    renderedHunks,
    lineCount: (text.match(/\n/g) || []).length,
    lineTruncated,
  };
}
