// worktree 画面の HTTP 入口。
//
// - GET  /_worktree/list    作業ツリーの一覧 (ブランチ・変更数・最終コミット)
// - GET  /_worktree/commits 基準ブランチに無いコミット
// - GET  /_worktree/file    変更されたメディアの before / after
// - POST /_worktree/add     作業ツリーを 1 本増やす
// - POST /_worktree/remove  作業ツリーを 1 本外す
// - POST /_worktree/open    その作業ツリーで code-viewer を開く
//
// 書き込み系が触るのは git のリポジトリ状態とプロセスなので、パスを素通しに
// しない。remove と open が受け付けるのは `git worktree list` に今載っている
// パスだけで、add はディレクトリ名 1 つしか受け取らず、置き場所はサーバ側で
// <repoRoot>/.worktrees/<name> に固定する。クライアントから任意のパスを書き
//込める口にはしない。
//
// ルーティングと副作用リクエストの認可は database/handle-shared の
// dispatchRoutes に任せる (tmux/handle.ts と同じ使い方)。

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import { sourceDisplayKind } from "../../core/source-meta";
import { HISTORY_PAGE_SIZE } from "../../core/history";
import type {
  WorktreeActionResponse,
  WorktreeCommitsResponse,
  WorktreeDiffResponse,
  WorktreesResponse,
} from "../../core/types";
import type { WorktreeRef } from "../../core/worktree";
import {
  findWorktree,
  worktreeBranchError,
  worktreeNameError,
} from "../../core/worktree";
import {
  dispatchRoutes,
  handleError,
  json,
  parseBoundedJsonBody,
  textError,
} from "../database/handle-shared";
import { safeWorktreePathFromRoot } from "../file-cli";
import {
  catFileBlobStream,
  commitHistoryAsync,
  defaultBranchResultAsync,
  fileDiffTextAsync,
  isGitInternalPath,
  localBranchExistsResultAsync,
  mergeBaseResultAsync,
  objectByteSizeAsync,
  objectIdAsync,
  truncateToNHunks,
  untrackedFileDiffAsync,
  worktreeAddResultAsync,
  worktreeListResultAsync,
  worktreePruneResultAsync,
  worktreeRemoveResultAsync,
} from "../git";
import { collectByteRangeFromStream, parseHttpByteRange } from "../range";
import { rawFileHeaders } from "../raw-file-headers";
import { fileByteRangeResponseBody, fileReadableStream } from "../runtime";
import { isSafePath } from "../search-service";
import {
  buildWorktreeList,
  collectFiles,
  serverWorktreeRoot,
  worktreeAddParent,
} from "./list";
import { openWorktreeServer, stopWorktreeServer } from "./open";

/** 名前・ブランチ名しか載らないので、本文はごく小さい。 */
const BODY_MAX_BYTES = 8 * 1024;

/**
 * 差分の上限。1 ファイルが数万行のこともあるので、描く前にここで切る。
 * 切ったことは応答の truncated で分かる (黙って短くしない)。
 */
const DIFF_MAX_HUNKS = 200;
const DIFF_MAX_LINES = 20000;

function actionJson(body: WorktreeActionResponse): Response {
  return json(body);
}

function bodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

async function handleListGet(
  cwd: string,
  generation: number,
): Promise<Response> {
  const list = await buildWorktreeList(serverWorktreeRoot(cwd));
  const response: WorktreesResponse = { ...list, generation };
  return json(response);
}

async function handleCommitsGet(
  url: URL,
  cwd: string,
  generation: number,
): Promise<Response> {
  const resolved = await resolveListedPath(
    cwd,
    url.searchParams.get("path") || "",
  );
  if (resolved instanceof Response) return resolved;

  const baseResult = await defaultBranchResultAsync(resolved.root);
  if (baseResult.error) {
    return textError(baseResult.error, baseResult.status ?? 500);
  }
  const base = baseResult.branch;
  if (!base || !resolved.branch || base === resolved.branch) {
    const response: WorktreeCommitsResponse = {
      commits: [],
      hasMore: false,
      generation,
    };
    return json(response);
  }

  const result = await commitHistoryAsync(resolved.path, {
    ref: `refs/heads/${resolved.branch}`,
    excludeRef: `refs/heads/${base}`,
    skip: 0,
    limit: HISTORY_PAGE_SIZE,
  });
  if (result.error) {
    return textError(result.error, result.status ?? 500);
  }
  const response: WorktreeCommitsResponse = {
    commits: result.commits.map(({ sha, subject, author, when }) => ({
      sha,
      subject,
      author,
      when,
    })),
    hasMore: result.hasMore,
    generation,
  };
  return json(response);
}

/**
 * 一覧に載っているパスだけを通す。載っていないパスは 404 で、存在しない
 * ディレクトリを消しに行くことも、無関係な場所でサーバを起こすこともしない。
 *
 * root も返すのは、git を走らせる場所を呼び出し側で cwd に取り違えないため
 * (cwd はサブディレクトリでも symlink 越しでもありうる)。
 */
async function resolveListedPath(
  cwd: string,
  path: string,
): Promise<
  | {
      path: string;
      root: string;
      branch: string;
      current: boolean;
      ref: WorktreeRef;
    }
  | Response
> {
  const root = serverWorktreeRoot(cwd);
  if (!path) return textError("path is required", 400);
  const listed = await worktreeListResultAsync(root);
  if (listed.error) return textError(listed.error, listed.status ?? 500);
  const found = findWorktree(listed.worktrees, path);
  if (!found) return textError("unknown worktree", 404);
  return {
    path: found.path,
    root,
    branch: found.branch,
    current: found.path === root,
    ref: found,
  };
}

/**
 * 選んだファイルの差分。**このサーバの作業ツリーではなく、選ばれた作業ツリーを
 * cwd にして git を走らせる**のが肝で、それができるから 1 つのサーバで全部の
 * 作業ツリーの中身を見られる。
 *
 * origin が何を比べるかを決める。uncommitted は HEAD から今の状態まで、
 * committed は基準ブランチから分かれた後のコミットぶん。未追跡ファイルは
 * HEAD に無いので --no-index で /dev/null と比べる。
 */
async function handleDiffGet(
  url: URL,
  cwd: string,
  generation: number,
): Promise<Response> {
  const file = url.searchParams.get("file") || "";
  if (!file) return textError("file is required", 400);
  // クライアント由来のパスは相対で、`..` を含まないものだけ通す。
  if (!isSafePath(file)) return textError("invalid file path", 400);
  // `-` 始まりは git のオプションに化ける。`--output=/tmp/x` で任意の場所へ
  // ファイルを書けることを再現済み (git.ts 側でも `./` を前置して防ぐ)。
  if (file.startsWith("-")) return textError("invalid file path", 400);
  if (isGitInternalPath(file)) return textError("forbidden", 403);

  const resolved = await resolveListedPath(
    cwd,
    url.searchParams.get("path") || "",
  );
  if (resolved instanceof Response) return resolved;

  const origin =
    url.searchParams.get("origin") === "committed"
      ? "committed"
      : "uncommitted";
  const untracked = url.searchParams.get("untracked") === "1";

  // topbar の「空白」トグル。Diff ビューアの /file_diff と同じキーで受ける。
  const extras: string[] = [];
  if (url.searchParams.get("ignore_ws") === "1") extras.push("-w");
  if (url.searchParams.get("ignore_blank") === "1") {
    extras.push("--ignore-blank-lines");
  }

  const baseResult =
    origin === "committed"
      ? await defaultBranchResultAsync(resolved.root)
      : { branch: "" };
  if (baseResult.error) {
    return textError(baseResult.error, baseResult.status ?? 500);
  }
  const base = baseResult.branch;
  let args: string[] = ["HEAD"];
  if (origin === "committed") {
    if (!base || !resolved.branch || base === resolved.branch) {
      return textError("nothing to compare against", 409);
    }
    args = [`refs/heads/${base}...refs/heads/${resolved.branch}`];
  }

  // その作業ツリーが実際に変更しているファイルだけを返す。これが無いと、
  // untracked=1 を付けるだけで作業ツリー内の任意の追跡ファイルまで読めた。
  const changes = await collectFiles(resolved.ref, base);
  const listedFile = changes.files.find(
    (change) => change.path === file && change.origin === origin,
  );
  if (!listedFile) return textError("file is not changed here", 404);
  // 実体が作業ツリーの外へ出ていないことまで見る。ディレクトリ symlink を
  // 経由すると、文字列上は相対パスのまま外のファイルを指せる。
  if (!safeWorktreePathFromRoot(resolved.path, file)) {
    return textError("forbidden", 403);
  }

  const res = untracked
    ? await untrackedFileDiffAsync(extras, file, resolved.path)
    : await fileDiffTextAsync([...extras, ...args], file, resolved.path);
  // `--no-index` は差分があると 1 を返す。差分そのものは stdout に出ている。
  const failed = untracked ? res.code > 1 : res.code !== 0;
  if (failed) {
    return textError(res.stderr.trim() || "git diff failed", res.status ?? 500);
  }
  const truncated = truncateToNHunks(
    res.stdout,
    DIFF_MAX_HUNKS,
    DIFF_MAX_LINES,
  );
  const response: WorktreeDiffResponse = {
    file,
    origin,
    diff: truncated.text,
    totalHunks: truncated.totalHunks,
    renderedHunks: truncated.renderedHunks,
    truncated: truncated.renderedHunks < truncated.totalHunks,
    generation,
  };
  return json(response);
}

type MediaResponseBody = ReadableStream<Uint8Array> | ArrayBuffer;

type MediaResponseSource = {
  full(): MediaResponseBody;
  range(
    start: number,
    end: number,
  ): MediaResponseBody | Response | Promise<MediaResponseBody | Response>;
};

function byteRangeBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function mediaResponse(
  req: Request,
  file: string,
  size: number,
  source: MediaResponseSource,
): Promise<Response> {
  const rangeResult = req.headers.get("range")
    ? parseHttpByteRange(req.headers.get("range"), size)
    : null;
  if (rangeResult?.kind === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        ...rawFileHeaders(file, { size }),
        "Content-Range": `bytes */${size}`,
        "Content-Length": "0",
      },
    });
  }
  if (rangeResult?.kind === "range") {
    const range = rangeResult.range;
    const body = await source.range(range.start, range.end);
    if (body instanceof Response) return body;
    return new Response(body, {
      status: 206,
      headers: rawFileHeaders(file, { size, range }),
    });
  }
  return new Response(source.full(), {
    headers: rawFileHeaders(file, { size }),
  });
}

async function worktreeMediaResponse(
  req: Request,
  file: string,
  full: string,
): Promise<Response> {
  const metadata = await stat(full);
  if (!metadata.isFile()) return textError("media is not a regular file", 404);
  return mediaResponse(req, file, metadata.size, {
    full: () => fileReadableStream(full),
    range: (start, end) => fileByteRangeResponseBody(full, start, end),
  });
}

async function blobMediaResponse(
  req: Request,
  file: string,
  ref: string,
  cwd: string,
): Promise<Response> {
  const object = await objectIdAsync(ref, file, cwd);
  if (object.code !== 0 || !object.oid) {
    return textError(
      object.stderr.trim() || "media is not available in ref",
      404,
    );
  }
  const size = await objectByteSizeAsync(object.oid, cwd);
  if (size.code !== 0) {
    return textError(size.stderr.trim() || "cannot read media size", 500);
  }
  return mediaResponse(req, file, size.size, {
    full: () => catFileBlobStream(object.oid, cwd).stream,
    range: async (start, end) => {
      const shown = catFileBlobStream(object.oid, cwd);
      const bytes = await collectByteRangeFromStream(
        shown.stream,
        start,
        end + 1,
      );
      const code = await shown.exited;
      if (code !== 0) {
        return textError(`git cat-file failed with exit code ${code}`, 500);
      }
      const expectedLength = end - start + 1;
      if (bytes.byteLength !== expectedLength) {
        return textError(
          `git cat-file returned ${bytes.byteLength} of ${expectedLength} requested bytes`,
          500,
        );
      }
      return byteRangeBody(bytes);
    },
  });
}

/**
 * Worktree の変更一覧に載っているメディアだけを before / after で返す。
 * committed の before は 3-dot diff と同じ merge-base を使う。
 */
async function handleFileGet(
  req: Request,
  url: URL,
  cwd: string,
): Promise<Response> {
  const file = url.searchParams.get("file") || "";
  if (!file) return textError("file is required", 400);
  if (!isSafePath(file)) return textError("invalid file path", 400);
  if (file.startsWith("-")) return textError("invalid file path", 400);
  if (isGitInternalPath(file)) return textError("forbidden", 403);

  const origin = url.searchParams.get("origin");
  if (origin !== "uncommitted" && origin !== "committed") {
    return textError("invalid origin", 400);
  }
  const side = url.searchParams.get("side");
  if (side !== "before" && side !== "after") {
    return textError("invalid side", 400);
  }

  const resolved = await resolveListedPath(
    cwd,
    url.searchParams.get("path") || "",
  );
  if (resolved instanceof Response) return resolved;

  const baseResult =
    origin === "committed"
      ? await defaultBranchResultAsync(resolved.root)
      : { branch: "" };
  if (baseResult.error) {
    return textError(baseResult.error, baseResult.status ?? 500);
  }
  const base = baseResult.branch;
  if (
    origin === "committed" &&
    (!base || !resolved.branch || base === resolved.branch)
  ) {
    return textError("nothing to compare against", 409);
  }

  const changes = await collectFiles(resolved.ref, base);
  if (changes.error) {
    return textError(`could not collect changed files: ${changes.error}`, 500);
  }
  const listedFile = changes.files.find(
    (change) => change.path === file && change.origin === origin,
  );
  if (!listedFile) return textError("file is not changed here", 404);
  const displayKind = sourceDisplayKind(file);
  if (
    displayKind !== "image" &&
    displayKind !== "video" &&
    displayKind !== "audio"
  ) {
    return textError("file is not media", 404);
  }

  if (origin === "uncommitted" && side === "after") {
    const full = safeWorktreePathFromRoot(resolved.path, file);
    if (!full) return textError("media is not available", 404);
    return worktreeMediaResponse(req, file, full);
  }

  let ref = "HEAD";
  if (origin === "committed") {
    const branchRef = `refs/heads/${resolved.branch}`;
    if (side === "after") {
      ref = branchRef;
    } else {
      const baseRef = `refs/heads/${base}`;
      const mergeBase = await mergeBaseResultAsync(
        resolved.path,
        baseRef,
        branchRef,
      );
      if (mergeBase.error) {
        return textError(mergeBase.error, mergeBase.status ?? 500);
      }
      ref = mergeBase.oid;
    }
  }
  return blobMediaResponse(req, file, ref, resolved.path);
}

async function handleAddPost(req: Request, cwd: string): Promise<Response> {
  const parsed = await parseBoundedJsonBody(
    req,
    BODY_MAX_BYTES,
    "body too large",
  );
  if (parsed instanceof Response) return parsed;
  const body = (parsed ?? {}) as Record<string, unknown>;

  const name = bodyString(body, "name");
  const nameError = worktreeNameError(name);
  if (nameError) return textError(`invalid name: ${nameError}`, 400);

  // ブランチ名を省いたら、ディレクトリ名と同じ名前のブランチを作る。
  const branch = bodyString(body, "branch") || name;
  const branchError = worktreeBranchError(branch);
  if (branchError) return textError(`invalid branch: ${branchError}`, 400);

  const root = serverWorktreeRoot(cwd);
  const path = join(worktreeAddParent(root), name);
  if (existsSync(path)) return textError("path already exists", 409);

  const exists = await localBranchExistsResultAsync(root, branch);
  if (exists.error) return textError(exists.error, exists.status ?? 500);
  const result = await worktreeAddResultAsync(root, {
    path,
    branch,
    createBranch: !exists.exists,
  });
  if (result.error) return textError(result.error, result.status ?? 500);
  return actionJson({ path });
}

async function handleRemovePost(req: Request, cwd: string): Promise<Response> {
  const parsed = await parseBoundedJsonBody(
    req,
    BODY_MAX_BYTES,
    "body too large",
  );
  if (parsed instanceof Response) return parsed;
  const body = (parsed ?? {}) as Record<string, unknown>;

  const resolved = await resolveListedPath(cwd, bodyString(body, "path"));
  if (resolved instanceof Response) return resolved;
  // このサーバが見ている作業ツリーを足元から外させない。git も拒否するが、
  // 先に弾いたほうが理由がはっきりする。
  if (resolved.current) {
    return textError("cannot remove the worktree this server is serving", 409);
  }

  // フォルダが既に無いエントリは、git によっては remove を拒否される。
  // 消すものは管理情報だけなので prune に切り替える。
  const pruning = !existsSync(resolved.path);
  const result = pruning
    ? await worktreePruneResultAsync(resolved.root)
    : await worktreeRemoveResultAsync(resolved.root, {
        path: resolved.path,
        force: body.force === true,
      });
  if (result.error) return textError(result.error, result.status ?? 500);

  // **prune の終了コードを成功とみなさない。** git worktree prune は
  // ロックされた登録を黙って飛ばしたうえで 0 を返す (実測: lock したまま
  // フォルダを消した作業ツリーは、prune -v が何も出さず 0 で終わった後も
  // git worktree list に残り続ける)。消えたことを確かめてから成功と言う。
  if (pruning) {
    const after = await worktreeListResultAsync(resolved.root);
    if (after.error) return textError(after.error, after.status ?? 500);
    if (findWorktree(after.worktrees, resolved.path)) {
      return textError(
        resolved.ref.locked
          ? "the entry is locked, so git worktree prune left it in place; unlock it first"
          : "git worktree prune left the entry in place",
        409,
      );
    }
  }

  try {
    await stopWorktreeServer(resolved.path);
  } catch (error) {
    throw errorWithCause(
      "worktree was removed but its code-viewer server could not be stopped",
      error,
    );
  }
  return actionJson({});
}

/**
 * 「開く」で起こしたサーバを止める。起こす口だけあって止める口が無いと、
 * 開いた本人にも止め方が分からないまま増え続ける。
 */
async function handleStopPost(req: Request, cwd: string): Promise<Response> {
  const parsed = await parseBoundedJsonBody(
    req,
    BODY_MAX_BYTES,
    "body too large",
  );
  if (parsed instanceof Response) return parsed;
  const body = (parsed ?? {}) as Record<string, unknown>;

  const resolved = await resolveListedPath(cwd, bodyString(body, "path"));
  if (resolved instanceof Response) return resolved;
  // 自分自身は止めさせない。止めた瞬間この画面の相手が居なくなる。
  if (resolved.current) {
    return textError("cannot stop the server serving this worktree", 409);
  }

  // 止められなかった理由はそのまま上へ返す (dispatchRoutes が 500 にする)。
  // 黙って成功扱いにすると、一覧に「起動中」が残ったままになる。
  await stopWorktreeServer(resolved.path);
  return actionJson({});
}

async function handleOpenPost(req: Request, cwd: string): Promise<Response> {
  const parsed = await parseBoundedJsonBody(
    req,
    BODY_MAX_BYTES,
    "body too large",
  );
  if (parsed instanceof Response) return parsed;
  const body = (parsed ?? {}) as Record<string, unknown>;

  const resolved = await resolveListedPath(cwd, bodyString(body, "path"));
  if (resolved instanceof Response) return resolved;

  const result = await openWorktreeServer(resolved.path);
  if (result.status === "missing") return textError("worktree is gone", 410);
  if (result.status === "timeout") {
    return textError("code-viewer did not come up in time", 504);
  }
  if (result.status === "error") {
    console.error("[code-viewer] worktree open failed", result.error);
    return textError(formatErrorDetail(result.error), 500);
  }
  return actionJson({ url: result.url, started: result.started });
}

export function handleWorktreeRoute(
  req: Request,
  url: URL,
  cwd: string,
  generation: number,
  sideEffectAllowed: (req: Request) => boolean,
): Promise<Response | null> {
  return dispatchRoutes(
    req,
    url,
    {
      "/_worktree/list": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleListGet(cwd, generation),
      },
      "/_worktree/commits": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleCommitsGet(url, cwd, generation),
      },
      "/_worktree/diff": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleDiffGet(url, cwd, generation),
      },
      "/_worktree/file": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleFileGet(req, url, cwd),
      },
      "/_worktree/add": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleAddPost(req, cwd),
      },
      "/_worktree/remove": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleRemovePost(req, cwd),
      },
      "/_worktree/open": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleOpenPost(req, cwd),
      },
      "/_worktree/stop": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleStopPost(req, cwd),
      },
    },
    sideEffectAllowed,
    (res) => res,
    (err) => handleError("worktree", "handle worktree request", err),
  );
}
