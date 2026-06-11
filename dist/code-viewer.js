#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// web-src/server/annotations.ts
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
function annotationsFilePath(root) {
  return join(root, CODE_VIEWER_DIR, ANNOTATIONS_FILE_NAME);
}
function emptyAnnotationsState() {
  return { version: 1, sessions: [] };
}
function makeAnnotationId(prefix) {
  const random = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36);
  return `${prefix}-${time}${random}`;
}
function normalizeLineRange(raw) {
  if (!raw || typeof raw !== "object")
    return;
  const start = raw.start;
  const end = raw.end;
  if (!Number.isInteger(start) || start < 1)
    return;
  const endValue = Number.isInteger(end) && end >= start ? end : start;
  return { start, end: endValue };
}
function parseAnnotationLine(raw) {
  const range = /^(\d+)-(\d+)$/.exec(raw);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    return start > 0 ? { start, end } : undefined;
  }
  const line = Number(raw);
  return Number.isInteger(line) && line > 0 ? { start: line, end: line } : undefined;
}
function normalizeRange(raw) {
  const from = raw && typeof raw === "object" && typeof raw.from === "string" ? raw.from || "HEAD" : "HEAD";
  const to = raw && typeof raw === "object" && typeof raw.to === "string" ? raw.to || "worktree" : "worktree";
  return { from, to };
}
function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object")
    return null;
  const entry = raw;
  if (typeof entry.id !== "string" || !entry.id)
    return null;
  if (typeof entry.path !== "string" || !entry.path)
    return null;
  if (typeof entry.body !== "string" || !entry.body)
    return null;
  const normalized = {
    id: entry.id,
    created_at: typeof entry.created_at === "string" ? entry.created_at : "",
    path: entry.path,
    range: normalizeRange(entry.range),
    body: entry.body
  };
  const line = normalizeLineRange(entry.line);
  if (line)
    normalized.line = line;
  if (typeof entry.title === "string" && entry.title)
    normalized.title = entry.title;
  return normalized;
}
function normalizeSession(raw) {
  if (!raw || typeof raw !== "object")
    return null;
  const session = raw;
  if (typeof session.id !== "string" || !session.id)
    return null;
  const entries = Array.isArray(session.entries) ? session.entries.map(normalizeEntry).filter((entry) => entry !== null) : [];
  return {
    id: session.id,
    title: typeof session.title === "string" && session.title ? session.title : "Untitled session",
    created_at: typeof session.created_at === "string" ? session.created_at : "",
    entries
  };
}
function normalizeAnnotationsState(raw) {
  if (!raw || typeof raw !== "object")
    return emptyAnnotationsState();
  const sessions = raw.sessions;
  if (!Array.isArray(sessions))
    return emptyAnnotationsState();
  return {
    version: 1,
    sessions: sessions.map(normalizeSession).filter((session) => session !== null)
  };
}
function loadAnnotationsState(root) {
  const file = annotationsFilePath(root);
  if (!existsSync(file))
    return emptyAnnotationsState();
  try {
    return normalizeAnnotationsState(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return emptyAnnotationsState();
  }
}
function saveAnnotationsState(root, state) {
  const dir = join(root, CODE_VIEWER_DIR);
  mkdirSync(dir, { recursive: true });
  const file = annotationsFilePath(root);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}
`, "utf8");
  renameSync(tmp, file);
}
function startAnnotationSession(state, title, now, id = makeAnnotationId("s")) {
  const session = {
    id,
    title: title.trim().slice(0, ANNOTATION_TITLE_MAX_CHARS) || "Untitled session",
    created_at: now,
    entries: []
  };
  return {
    state: { version: 1, sessions: [...state.sessions, session] },
    session
  };
}
function addAnnotationEntry(state, input, now, makeId = makeAnnotationId) {
  const path = input.path.replace(/^\/+|\/+$/g, "");
  if (!path)
    return { ok: false, error: "path is required" };
  const body = input.body;
  if (!body.trim())
    return { ok: false, error: "body is required" };
  if (Buffer.byteLength(body, "utf8") > ANNOTATION_BODY_MAX_BYTES)
    return { ok: false, error: "body is too large" };
  const line = input.line ? normalizeLineRange(input.line) : undefined;
  if (input.line && !line)
    return { ok: false, error: "invalid line" };
  let sessions = state.sessions;
  let session;
  let createdSession = false;
  if (input.session_id) {
    session = sessions.find((s) => s.id === input.session_id);
    if (!session)
      return { ok: false, error: "session not found" };
  } else {
    session = sessions[sessions.length - 1];
  }
  if (!session) {
    const started = startAnnotationSession(state, input.session_title || "", now, makeId("s"));
    sessions = started.state.sessions;
    session = started.session;
    createdSession = true;
  }
  const entry = {
    id: makeId("a"),
    created_at: now,
    path,
    range: normalizeRange(input.range),
    body
  };
  if (line)
    entry.line = line;
  const title = (input.title || "").trim();
  if (title)
    entry.title = title.slice(0, ANNOTATION_TITLE_MAX_CHARS);
  const updatedSession = {
    ...session,
    entries: [...session.entries, entry]
  };
  return {
    ok: true,
    state: {
      version: 1,
      sessions: sessions.map((s) => s.id === updatedSession.id ? updatedSession : s)
    },
    session: updatedSession,
    entry,
    created_session: createdSession
  };
}
function renameAnnotationSession(state, id, title) {
  const session = state.sessions.find((s) => s.id === id);
  if (!session)
    return { state, renamed: false };
  const next = title.trim().slice(0, ANNOTATION_TITLE_MAX_CHARS) || "Untitled session";
  return {
    state: {
      version: 1,
      sessions: state.sessions.map((s) => s.id === id ? { ...s, title: next } : s)
    },
    renamed: true
  };
}
function updateAnnotationEntry(state, id, patch) {
  const session = state.sessions.find((s) => s.entries.some((e) => e.id === id));
  if (!session)
    return { ok: false, error: "annotation not found" };
  if (patch.body !== undefined) {
    if (!patch.body.trim())
      return { ok: false, error: "body is required" };
    if (Buffer.byteLength(patch.body, "utf8") > ANNOTATION_BODY_MAX_BYTES)
      return { ok: false, error: "body is too large" };
  }
  let updated = null;
  const sessions = state.sessions.map((s) => s.id === session.id ? {
    ...s,
    entries: s.entries.map((e) => {
      if (e.id !== id)
        return e;
      updated = {
        ...e,
        ...patch.title !== undefined ? { title: patch.title.trim() || undefined } : {},
        ...patch.body !== undefined ? { body: patch.body } : {}
      };
      return updated;
    })
  } : s);
  if (!updated)
    return { ok: false, error: "annotation not found" };
  return { ok: true, state: { version: 1, sessions }, entry: updated };
}
function deleteAnnotationById(state, id) {
  for (const session of state.sessions) {
    if (session.id === id) {
      return {
        state: {
          version: 1,
          sessions: state.sessions.filter((s) => s.id !== id)
        },
        removed: "session"
      };
    }
    if (session.entries.some((entry) => entry.id === id)) {
      return {
        state: {
          version: 1,
          sessions: state.sessions.map((s) => s.id === session.id ? { ...s, entries: s.entries.filter((e) => e.id !== id) } : s)
        },
        removed: "entry"
      };
    }
  }
  return { state, removed: null };
}
var CODE_VIEWER_DIR = ".code-viewer", ANNOTATIONS_FILE_NAME = "annotations.json", ANNOTATION_BODY_MAX_BYTES, ANNOTATION_TITLE_MAX_CHARS = 300;
var init_annotations = __esm(() => {
  ANNOTATION_BODY_MAX_BYTES = 64 * 1024;
});

// web-src/server/runtime.ts
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import {
  createServer
} from "node:http";
import { Readable } from "node:stream";
function runSync(args, cwd, options = {}) {
  const proc = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout,
    killSignal: "SIGKILL"
  });
  return {
    code: proc.status ?? (proc.error ? 1 : 0),
    stdout: new TextDecoder().decode(proc.stdout || new Uint8Array),
    stderr: new TextDecoder().decode(proc.stderr || new Uint8Array)
  };
}
function runBytesSync(args, cwd, options = {}) {
  const proc = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout,
    killSignal: "SIGKILL"
  });
  return {
    code: proc.status ?? (proc.error ? 1 : 0),
    stdout: new Uint8Array(proc.stdout || new Uint8Array),
    stderr: new TextDecoder().decode(proc.stderr || new Uint8Array)
  };
}
function spawnDetached(args) {
  const child = spawn(args[0], args.slice(1), {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}
function spawnStream(args, cwd) {
  const proc = spawn(args[0], args.slice(1), {
    cwd,
    stdio: ["ignore", "pipe", "ignore"]
  });
  return {
    stream: Readable.toWeb(proc.stdout),
    exited: new Promise((resolve) => proc.on("close", (code) => resolve(code ?? 1))),
    kill: (signal) => proc.kill(signal)
  };
}
function fileReadableStream(path) {
  return Readable.toWeb(createReadStream(path));
}
function fileByteRangeResponseBody(path, start, endInclusive) {
  return Readable.toWeb(createReadStream(path, { start, end: endInclusive }));
}
async function readFileTextRange(path, start, endExclusive) {
  const length = Math.max(0, endExclusive - start);
  if (length === 0)
    return "";
  const handle = await fs.open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, result.bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
function startServer(options) {
  const server = createServer(async (req, res) => {
    try {
      const request = nodeRequestToWeb(req, options.hostname, server.address());
      const response = await options.fetch(request);
      await writeWebResponse(res, response);
    } catch (error) {
      console.error("[code-viewer] request error:", req.method, req.url, error);
      if (res.headersSent || res.writableEnded) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("internal server error");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.hostname, () => {
      server.off("error", reject);
      server.on("error", (error) => {
        console.error("[code-viewer] server error:", error);
      });
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        port,
        close: () => new Promise((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error)
              rejectClose(error);
            else
              resolveClose();
          });
          server.closeAllConnections?.();
        })
      });
    });
  });
}
function nodeRequestToWeb(req, hostname, address) {
  const port = typeof address === "object" && address ? address.port : 0;
  const host = req.headers.host || `${hostname}:${port}`;
  const url = new URL(req.url || "/", `http://${host}`);
  const headers = new Headers;
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value)
        headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  const method = req.method || "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? "half" : undefined
  });
}
async function writeWebResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const body = Readable.fromWeb(response.body);
    let settled = false;
    const settle = (fn) => {
      if (settled)
        return;
      settled = true;
      fn();
    };
    body.on("error", (error) => settle(() => {
      res.destroy(error);
      reject(error);
    }));
    res.on("finish", () => settle(resolve));
    res.on("close", () => settle(() => {
      body.destroy();
      resolve();
    }));
    body.pipe(res);
  });
}
var init_runtime = () => {};

// web-src/server/git.ts
import {
  existsSync as existsSync2,
  lstatSync,
  readdirSync,
  readFileSync as readFileSync2,
  statSync
} from "node:fs";
import { join as join2 } from "node:path";
function run(args, cwd) {
  return runSync(args, cwd);
}
function runBytes(args, cwd) {
  return runBytesSync(args, cwd);
}
function repoRoot(cwd) {
  const res = run(["git", "rev-parse", "--show-toplevel"], cwd);
  return res.code === 0 ? res.stdout.trimEnd() : null;
}
function currentBranch(cwd) {
  const res = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return res.code === 0 ? res.stdout.trimEnd() : null;
}
function show(ref, path, cwd) {
  return run(["git", "show", `${ref}:${path}`], cwd);
}
function showBytes(ref, path, cwd) {
  return runBytes(["git", "show", `${ref}:${path}`], cwd);
}
function catFileBlobStream(oid, cwd) {
  return spawnStream(["git", "cat-file", "blob", oid], cwd);
}
function objectSize(ref, path, cwd) {
  const res = run(["git", "cat-file", "-s", `${ref}:${path}`], cwd);
  return {
    code: res.code,
    size: Number(res.stdout.trim()) || 0,
    stderr: res.stderr
  };
}
function objectByteSize(oid, cwd) {
  const res = run(["git", "cat-file", "-s", oid], cwd);
  return {
    code: res.code,
    size: Number(res.stdout.trim()) || 0,
    stderr: res.stderr
  };
}
function lastCommitDateForPath(ref, path, cwd) {
  const args = ["git", "log", "-1", "--format=%cI", ref, "--", path];
  const res = run(args, cwd);
  if (res.code !== 0)
    return null;
  return res.stdout.trim() || null;
}
function objectId(ref, path, cwd) {
  const res = run(["git", "rev-parse", "--verify", `${ref}:${path}`], cwd);
  const oid = res.stdout.trim();
  if (res.code !== 0 || !oid)
    return { code: res.code || 1, oid: "", stderr: res.stderr };
  const type = run(["git", "cat-file", "-t", oid], cwd);
  if (type.code !== 0 || type.stdout.trim() !== "blob")
    return { code: 1, oid: "", stderr: type.stderr };
  return { code: 0, oid, stderr: "" };
}
function verifyTreeRef(ref, cwd) {
  if (!ref || ref === "worktree")
    return false;
  if (ref.startsWith("-"))
    return false;
  const res = run(["git", "rev-parse", "--verify", `${ref}^{tree}`], cwd);
  return res.code === 0;
}
function refs(cwd) {
  const out = {
    branches: [],
    tags: [],
    commits: [],
    current: ""
  };
  const branches = run([
    "git",
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname)%09%(refname:short)%09%(committerdate:iso-strict)",
    "refs/heads",
    "refs/remotes"
  ], cwd);
  if (branches.code === 0) {
    for (const line of branches.stdout.split(`
`)) {
      const [fullName, name, when] = line.split("\t");
      if (!fullName || !name || fullName.startsWith("refs/remotes/") && fullName.endsWith("/HEAD"))
        continue;
      out.branches.push({ name, when });
    }
  }
  const tags = run([
    "git",
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(refname:short)%09%(creatordate:iso-strict)",
    "refs/tags"
  ], cwd);
  if (tags.code === 0) {
    for (const line of tags.stdout.split(`
`)) {
      const [name, when] = line.split("\t");
      if (!name)
        continue;
      out.tags.push({ name, when });
    }
  }
  out.commits = refCommits(cwd, "", DEFAULT_REF_COMMIT_LIMIT);
  out.current = currentBranch(cwd) || "";
  return out;
}
function clampCommitLimit(max) {
  return Math.max(1, Math.min(max, MAX_REF_COMMIT_LIMIT));
}
function parseCommitLog(stdout) {
  const parts = stdout.split("\x00");
  const commits = [];
  for (let index = 0;index < parts.length; ) {
    if (!parts[index]) {
      index++;
      continue;
    }
    const sha = parts[index++] || "";
    const subject = parts[index++] || "";
    const author = parts[index++] || "";
    const when = parts[index++] || "";
    if (sha)
      commits.push({ sha, subject, author, when });
  }
  return commits;
}
function commitLogArgs(limit) {
  return [
    "git",
    "log",
    "--all",
    "-z",
    `--max-count=${limit}`,
    `--format=${COMMIT_FORMAT}`
  ];
}
function mergeCommitResults(limit, ...groups) {
  const seen = new Set;
  const merged = [];
  for (const commits of groups) {
    for (const commit of commits) {
      if (!commit.sha || seen.has(commit.sha))
        continue;
      seen.add(commit.sha);
      merged.push(commit);
      if (merged.length >= limit)
        return merged;
    }
  }
  return merged;
}
function runCommitLog(cwd, args) {
  const commits = run(args, cwd);
  return commits.code === 0 ? parseCommitLog(commits.stdout) : [];
}
function refCommits(cwd, query = "", max = DEFAULT_REF_COMMIT_LIMIT) {
  const limit = clampCommitLimit(max);
  const trimmed = query.trim().slice(0, 200).replace(/\0/g, "");
  const hashMatches = [];
  if (/^[0-9a-f]{4,40}$/i.test(trimmed)) {
    const verified = run(["git", "rev-parse", "--verify", `${trimmed}^{commit}`], cwd);
    const single = run([
      "git",
      "log",
      "-z",
      "-1",
      `--format=${COMMIT_FORMAT}`,
      verified.code === 0 && verified.stdout.trim() ? verified.stdout.trim() : trimmed
    ], cwd);
    if (single.code === 0 && single.stdout.trim()) {
      hashMatches.push(...parseCommitLog(single.stdout));
    }
  }
  if (!trimmed) {
    return runCommitLog(cwd, commitLogArgs(limit));
  }
  const subjectMatches = runCommitLog(cwd, [
    ...commitLogArgs(limit),
    "--regexp-ignore-case",
    "--fixed-strings",
    `--grep=${trimmed}`
  ]);
  const authorMatches = runCommitLog(cwd, [
    ...commitLogArgs(limit),
    "--regexp-ignore-case",
    "--fixed-strings",
    `--author=${trimmed}`
  ]);
  return mergeCommitResults(limit, hashMatches, subjectMatches, authorMatches);
}
function parseRemoteWebUrl(remote) {
  const raw = (remote || "").trim();
  if (!raw)
    return null;
  const sshShorthand = /^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/.exec(raw);
  if (sshShorthand)
    return `https://${sshShorthand[1]}/${sshShorthand[2]}`;
  const sshUrl = /^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(raw);
  if (sshUrl)
    return `https://${sshUrl[1]}/${sshUrl[2]}`;
  const httpUrl = /^https?:\/\/([\w.-]+)\/(.+?)(?:\.git)?\/?$/.exec(raw);
  if (httpUrl)
    return `https://${httpUrl[1]}/${httpUrl[2]}`;
  return null;
}
function remoteWebUrl(cwd) {
  const res = run(["git", "remote", "get-url", "origin"], cwd);
  if (res.code !== 0)
    return null;
  return parseRemoteWebUrl(res.stdout.trim());
}
function parseHistoryLog(stdout) {
  const parts = stdout.split("\x00");
  const commits = [];
  for (let index = 0;index < parts.length; ) {
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
        body
      });
  }
  return commits;
}
function historyQueryArgs(query) {
  const trimmed = query.trim().slice(0, 200).replace(/\0/g, "");
  if (!trimmed)
    return { filterArgs: [], pathspec: [], shaTerm: "" };
  const prefixed = /^(author|path):(.*)$/.exec(trimmed);
  if (prefixed) {
    const term = prefixed[2].trim();
    if (!term)
      return { filterArgs: [], pathspec: [], shaTerm: "" };
    if (prefixed[1] === "author") {
      return {
        filterArgs: [
          "--regexp-ignore-case",
          "--fixed-strings",
          `--author=${term}`
        ],
        pathspec: [],
        shaTerm: ""
      };
    }
    return {
      filterArgs: [],
      pathspec: ["--", `:(icase)*${term}*`],
      shaTerm: ""
    };
  }
  return {
    filterArgs: [
      "--regexp-ignore-case",
      "--fixed-strings",
      `--grep=${trimmed}`
    ],
    pathspec: [],
    shaTerm: /^[0-9a-f]{4,40}$/i.test(trimmed) ? trimmed : ""
  };
}
function commitHistory(cwd, options) {
  const ref = (options.ref || "HEAD").trim();
  if (!ref || ref.startsWith("-") || ref.includes("\x00"))
    return { commits: [], hasMore: false, error: "invalid ref" };
  const verified = run(["git", "rev-parse", "--verify", `${ref}^{commit}`], cwd);
  if (verified.code !== 0)
    return { commits: [], hasMore: false, error: "unknown ref" };
  const skip = Math.max(0, Math.floor(options.skip) || 0);
  const limit = Math.max(1, Math.min(Math.floor(options.limit) || 1, MAX_HISTORY_LIMIT));
  const { filterArgs, pathspec, shaTerm } = historyQueryArgs(options.query || "");
  const res = run([
    "git",
    "log",
    "-z",
    `--skip=${skip}`,
    `--max-count=${limit + 1}`,
    `--format=${HISTORY_FORMAT}`,
    ...filterArgs,
    verified.stdout.trim(),
    ...pathspec
  ], cwd);
  if (res.code !== 0)
    return { commits: [], hasMore: false, error: "git log failed" };
  let parsed = parseHistoryLog(res.stdout);
  if (shaTerm && skip === 0) {
    const bySha = run(["git", "rev-parse", "--verify", `${shaTerm}^{commit}`], cwd);
    const sha = bySha.code === 0 ? bySha.stdout.trim() : "";
    if (sha) {
      const single = run(["git", "log", "-z", "-1", `--format=${HISTORY_FORMAT}`, sha], cwd);
      if (single.code === 0) {
        const hit = parseHistoryLog(single.stdout);
        parsed = [...hit, ...parsed.filter((c) => c.sha !== sha)];
      }
    }
  }
  const hasMore = parsed.length > limit;
  return { commits: hasMore ? parsed.slice(0, limit) : parsed, hasMore };
}
function nameStatus(args, cwd) {
  const res = run([
    "git",
    "-c",
    "core.quotepath=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    "--name-status",
    "-z",
    ...args
  ], cwd);
  if (res.code !== 0)
    return [];
  const parts = res.stdout.split("\x00");
  const files = [];
  for (let i = 0;i < parts.length; ) {
    const status = parts[i++];
    if (!status)
      break;
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const oldPath = parts[i++] || "";
      const path = parts[i++] || "";
      if (path)
        files.push({
          status: kind,
          old_path: oldPath,
          path,
          similarity: Number(status.slice(1)) || undefined
        });
    } else {
      const path = parts[i++] || "";
      if (path)
        files.push({ status: kind, path });
    }
  }
  return files;
}
function numstatZ(args, cwd) {
  const res = run([
    "git",
    "-c",
    "core.quotepath=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    "--numstat",
    "-z",
    ...args
  ], cwd);
  if (res.code !== 0)
    return [];
  const parts = res.stdout.split("\x00");
  const files = [];
  for (let i = 0;i < parts.length; ) {
    const rec = parts[i++];
    if (!rec)
      break;
    const match = rec.match(/^(\S+)\t(\S+)\t(.*)$/);
    if (!match)
      break;
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
  return files;
}
function isToolInternalPath(path) {
  return path.split(/[\\/]+/).some((part) => part.toLowerCase() === ".code-viewer");
}
function untracked(cwd, path = "") {
  const args = ["git", "ls-files", "--others", "--exclude-standard"];
  if (path)
    args.push("--", `${path}/`);
  const res = run(args, cwd);
  if (res.code !== 0)
    return [];
  return res.stdout.split(`
`).filter(Boolean).filter((entry) => !isToolInternalPath(entry));
}
function normalizeTreePath(path) {
  return path.replace(/^\/+|\/+$/g, "");
}
function sortTreeEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type)
      return a.type === "tree" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
function omittedWorktreeDirectoryReason(name, omitDirNames) {
  if (name === ".git")
    return "internal";
  return omitDirNames.has(name) ? "heavy" : undefined;
}
function worktreeEntryFromDirent(base, dir, name, isDirectory, omitDirNames, excludeNames) {
  if (excludeNames.has(name.toLowerCase()) || isToolInternalPath(name))
    return {
      name,
      path: "",
      type: isDirectory ? "tree" : "blob"
    };
  const entryPath = base ? `${base}/${name}` : name;
  const type = isDirectory ? hasDotGitEntry(join2(dir, name)) ? "commit" : "tree" : "blob";
  const omittedReason = type === "tree" ? omittedWorktreeDirectoryReason(name, omitDirNames) : undefined;
  return omittedReason ? {
    name,
    path: entryPath,
    type,
    children_omitted: true,
    children_omitted_reason: omittedReason
  } : { name, path: entryPath, type };
}
function worktreeFilesystemEntries(cwd, path, recursive, omitDirNames = DEFAULT_WORKTREE_OMIT_DIR_NAMES, excludeNames = []) {
  const base = normalizeTreePath(path);
  const root = join2(cwd, base);
  const omitDirNameSet = new Set(omitDirNames);
  const excludeNameSet = new Set(excludeNames.map((name) => name.toLowerCase()));
  let directEntries;
  try {
    const dirents = readdirSync(root, { withFileTypes: true });
    directEntries = sortTreeEntries(dirents.map((entry) => worktreeEntryFromDirent(base, root, entry.name, entry.isDirectory(), omitDirNameSet, excludeNameSet)).filter((entry) => entry.path));
  } catch {
    return [];
  }
  if (!recursive)
    return directEntries;
  const fileEntries = [];
  let truncated = false;
  const pushRecursiveEntry = (entry) => {
    if (fileEntries.length >= WORKTREE_RECURSIVE_ENTRY_LIMIT) {
      if (!truncated) {
        fileEntries.push({
          name: "more...",
          path: "__code_viewer_truncated__",
          type: "tree",
          children_omitted: true,
          children_omitted_reason: "truncated"
        });
        truncated = true;
      }
      return false;
    }
    fileEntries.push(entry);
    return true;
  };
  const walk = (dir, prefix, depth) => {
    if (truncated)
      return;
    if (depth >= WORKTREE_RECURSIVE_DEPTH_LIMIT)
      return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (excludeNameSet.has(entry.name.toLowerCase()) || isToolInternalPath(entry.name))
        continue;
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join2(dir, entry.name);
      if (entry.isDirectory()) {
        const omittedReason = omittedWorktreeDirectoryReason(entry.name, omitDirNameSet);
        if (omittedReason) {
          if (!pushRecursiveEntry({
            name: entry.name,
            path: entryPath,
            type: "tree",
            children_omitted: true,
            children_omitted_reason: omittedReason
          }))
            return;
          continue;
        }
        if (hasDotGitEntry(full))
          continue;
        walk(full, entryPath, depth + 1);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (!pushRecursiveEntry({
          name: entry.name,
          path: entryPath,
          type: "blob"
        }))
          return;
      }
    }
  };
  walk(root, base, 0);
  return combineDirectAndRecursiveFiles(directEntries, fileEntries.sort((a, b) => a.path.localeCompare(b.path)));
}
function hasDotGitEntry(dir) {
  try {
    lstatSync(join2(dir, ".git"));
    return true;
  } catch (err) {
    return !!err && typeof err === "object" && "code" in err && err.code !== "ENOENT";
  }
}
function gitTreeEntries(ref, path, cwd, recursive) {
  const base = normalizeTreePath(path);
  const args = ["git", "-c", "core.quotepath=false", "ls-tree"];
  if (recursive)
    args.push("-r");
  args.push("-z", "--full-tree", ref, "--");
  if (base)
    args.push(`${base}/`);
  const res = run(args, cwd);
  if (res.code !== 0)
    return { code: res.code, entries: [], stderr: res.stderr };
  const allowedTypes = recursive ? "blob|commit" : "tree|blob|commit";
  let entries = res.stdout.split("\x00").filter(Boolean).map((rec) => {
    const match = rec.match(new RegExp(`^\\d+\\s+(${allowedTypes})\\s+[0-9a-fA-F]+\\t(.+)$`));
    if (!match)
      return null;
    const entryPath = match[2];
    return {
      name: entryPath.split("/").pop() || entryPath,
      path: entryPath,
      type: match[1]
    };
  }).filter((entry) => !!entry);
  if (recursive)
    entries.sort((a, b) => a.path.localeCompare(b.path));
  else
    entries = sortTreeEntries(entries);
  return { code: 0, entries, stderr: "" };
}
function combineDirectAndRecursiveFiles(directEntries, fileEntries) {
  const seen = new Set(directEntries.map((entry) => entry.path));
  return [
    ...directEntries,
    ...fileEntries.filter((entry) => !seen.has(entry.path))
  ];
}
function listTree(ref, path, cwd, options = {}) {
  const base = normalizeTreePath(path);
  if (ref === "worktree") {
    return {
      code: 0,
      entries: worktreeFilesystemEntries(cwd, base, !!options.recursive, options.omitDirNames, options.excludeNames),
      stderr: ""
    };
  }
  const direct = gitTreeEntries(ref, base, cwd, false);
  if (direct.code !== 0 || !options.recursive)
    return direct;
  const recursive = gitTreeEntries(ref, base, cwd, true);
  if (recursive.code !== 0)
    return recursive;
  return {
    code: 0,
    entries: combineDirectAndRecursiveFiles(direct.entries, recursive.entries),
    stderr: ""
  };
}
function untrackedMeta(cwd) {
  return untracked(cwd).flatMap((path) => {
    const full = join2(cwd, path);
    let binary = false;
    let lines = 0;
    let fileExists = false;
    try {
      fileExists = existsSync2(full) && statSync(full).isFile();
    } catch {
      fileExists = false;
    }
    if (fileExists) {
      const data = readFileSync2(full);
      const probe = data.subarray(0, 8192);
      binary = probe.includes(0);
      if (!binary)
        lines = data.toString("utf8").split(`
`).length - 1;
    } else {
      return [];
    }
    return [
      {
        path,
        status: "A",
        additions: binary ? 0 : lines,
        deletions: 0,
        binary,
        untracked: true
      }
    ];
  });
}
function fileMeta(args, cwd, includeUntracked = false) {
  const ns = nameStatus(args, cwd);
  const nm = numstatZ(args, cwd);
  const byPath = new Map(nm.map((file) => [file.path, file]));
  const files = ns.map((file) => {
    const stats = byPath.get(file.path);
    return {
      ...file,
      additions: stats?.additions || 0,
      deletions: stats?.deletions || 0,
      binary: stats?.binary || false
    };
  });
  return includeUntracked ? files.concat(untrackedMeta(cwd)) : files;
}
function fileDiffText(args, path, cwd) {
  const paths = Array.isArray(path) ? path : [path];
  return run([
    "git",
    "-c",
    "core.quotepath=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    ...args,
    "--",
    ...paths
  ], cwd);
}
function untrackedFileDiff(extras, path, cwd) {
  return run([
    "git",
    "-c",
    "core.quotepath=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-index",
    ...extras,
    "/dev/null",
    path
  ], cwd);
}
function splitHunks(diffText) {
  if (!diffText)
    return { header: "", hunks: [] };
  const first = diffText.startsWith("@@") ? 0 : diffText.indexOf(`
@@`) + 1;
  if (first <= 0)
    return { header: diffText, hunks: [] };
  const header = diffText.slice(0, first);
  const hunks = [];
  let cur = first;
  while (cur < diffText.length) {
    const next = diffText.indexOf(`
@@`, cur + 1);
    const end = next >= 0 ? next : diffText.length;
    hunks.push(diffText.slice(cur, end));
    if (next < 0)
      break;
    cur = next + 1;
  }
  return { header, hunks };
}
function truncateToNHunks(diffText, n, maxLines = Number.POSITIVE_INFINITY) {
  const { header, hunks } = splitHunks(diffText);
  if (hunks.length === 0) {
    const lines = diffText.split(`
`);
    const lineTruncated2 = Number.isFinite(maxLines) && lines.length > maxLines;
    const text2 = lineTruncated2 ? lines.slice(0, maxLines).join(`
`) : diffText;
    return {
      text: text2,
      totalHunks: 0,
      renderedHunks: 0,
      lineCount: (text2.match(/\n/g) || []).length,
      lineTruncated: lineTruncated2
    };
  }
  const maxHunks = Math.min(n, hunks.length);
  const rendered = [];
  let renderedHunks = 0;
  let usedLines = (header.match(/\n/g) || []).length;
  let lineTruncated = false;
  for (let index = 0;index < maxHunks; index++) {
    const hunk = hunks[index];
    const lines = hunk.split(`
`);
    const separatorLines = rendered.length > 0 ? 1 : 0;
    const remaining = maxLines - usedLines - separatorLines;
    if (remaining <= 0) {
      lineTruncated = true;
      break;
    }
    if (Number.isFinite(maxLines) && lines.length > remaining) {
      rendered.push(lines.slice(0, remaining).join(`
`));
      renderedHunks++;
      lineTruncated = true;
      break;
    }
    rendered.push(hunk);
    renderedHunks++;
    usedLines += separatorLines + lines.length;
  }
  const text = header + rendered.join(`
`);
  return {
    text,
    totalHunks: hunks.length,
    renderedHunks,
    lineCount: (text.match(/\n/g) || []).length,
    lineTruncated
  };
}
var WORKTREE_RECURSIVE_DEPTH_LIMIT = 32, WORKTREE_RECURSIVE_ENTRY_LIMIT = 50000, DEFAULT_REF_COMMIT_LIMIT = 100, MAX_REF_COMMIT_LIMIT = 500, COMMIT_FORMAT = "%H%x00%s%x00%an%x00%aI", DEFAULT_WORKTREE_OMIT_DIR_NAMES, HISTORY_FORMAT = "%H%x00%s%x00%an%x00%aI%x00%P%x00%b", MAX_HISTORY_LIMIT = 200;
var init_git = __esm(() => {
  init_runtime();
  DEFAULT_WORKTREE_OMIT_DIR_NAMES = [
    "node_modules",
    ".venv",
    "venv",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".astro",
    ".vercel",
    "dist",
    "build",
    "out",
    "target",
    ".gradle",
    ".pnpm-store",
    ".turbo",
    "__pycache__",
    ".pytest_cache",
    ".tox",
    ".terraform",
    ".idea",
    ".vscode",
    "vendor",
    ".cache",
    "coverage",
    "DerivedData",
    "Pods",
    "bin",
    "obj"
  ];
});

// web-src/server/server-registry.ts
import { createHash } from "node:crypto";
import {
  existsSync as existsSync3,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync3,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "node:fs";
import { homedir } from "node:os";
import { join as join3 } from "node:path";
function registryDir() {
  return join3(homedir(), ".cache", "code-viewer", "servers");
}
function serverRegistryFilePath(root) {
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join3(registryDir(), `${hash}.json`);
}
function writeServerRegistry(entry) {
  try {
    mkdirSync2(registryDir(), { recursive: true });
    writeFileSync2(serverRegistryFilePath(entry.root), `${JSON.stringify(entry, null, 2)}
`, "utf8");
  } catch {}
}
function readServerRegistry(root) {
  const file = serverRegistryFilePath(root);
  if (!existsSync3(file))
    return null;
  try {
    const raw = JSON.parse(readFileSync3(file, "utf8"));
    if (!raw || typeof raw !== "object")
      return null;
    const entry = raw;
    if (typeof entry.url !== "string" || !entry.url)
      return null;
    return {
      url: entry.url,
      pid: typeof entry.pid === "number" ? entry.pid : 0,
      root: typeof entry.root === "string" ? entry.root : root,
      started_at: typeof entry.started_at === "string" ? entry.started_at : ""
    };
  } catch {
    return null;
  }
}
function removeServerRegistry(root, pid) {
  try {
    const entry = readServerRegistry(root);
    if (!entry || entry.pid !== pid)
      return;
    unlinkSync(serverRegistryFilePath(root));
  } catch {}
}
var init_server_registry = () => {};

// web-src/server/annotate-cli.ts
var exports_annotate_cli = {};
__export(exports_annotate_cli, {
  runAnnotateCli: () => runAnnotateCli,
  parseAnnotateArgs: () => parseAnnotateArgs,
  ANNOTATE_HELP: () => ANNOTATE_HELP,
  ANNOTATE_AGENT_HELP: () => ANNOTATE_AGENT_HELP
});
import { readFileSync as readFileSync4, realpathSync } from "node:fs";
function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined)
    return { error: `${flag} requires a value` };
  return { value, next: index + 1 };
}
function parseAnnotateArgs(argv) {
  const rest = [];
  let cwd;
  let server;
  const options = new Map;
  const flags = new Set;
  const valueFlags = new Set([
    "--title",
    "--file",
    "--line",
    "--from",
    "--to",
    "--session",
    "--session-title",
    "--body",
    "--body-file"
  ]);
  for (let i = 0;i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h")
      return { ok: true, args: { command: { kind: "help" } } };
    if (arg === "--cwd" || arg === "--server") {
      const taken = takeValue(argv, i, arg);
      if ("error" in taken)
        return { ok: false, error: taken.error };
      if (arg === "--cwd")
        cwd = taken.value;
      else
        server = taken.value;
      i = taken.next;
    } else if (valueFlags.has(arg)) {
      const taken = takeValue(argv, i, arg);
      if ("error" in taken)
        return { ok: false, error: taken.error };
      options.set(arg, taken.value);
      i = taken.next;
    } else if (arg === "--json") {
      flags.add(arg);
    } else if (arg.startsWith("-")) {
      return { ok: false, error: `unknown option: ${arg}` };
    } else {
      rest.push(arg);
    }
  }
  const subcommand = rest[0];
  if (!subcommand)
    return { ok: true, args: { command: { kind: "help" } } };
  if (subcommand === "agent-help") {
    return { ok: true, args: { command: { kind: "agent-help" } } };
  }
  if (subcommand === "start") {
    return {
      ok: true,
      args: {
        command: { kind: "start", title: options.get("--title") || "" },
        cwd,
        server
      }
    };
  }
  if (subcommand === "add") {
    const file = options.get("--file");
    if (!file)
      return { ok: false, error: "add requires --file <path>" };
    let line;
    const rawLine = options.get("--line");
    if (rawLine !== undefined) {
      line = parseAnnotationLine(rawLine);
      if (!line)
        return { ok: false, error: "--line must be <n> or <n>-<m>" };
    }
    const body = options.get("--body");
    const bodyFile = options.get("--body-file");
    if (body !== undefined && bodyFile !== undefined)
      return { ok: false, error: "use either --body or --body-file" };
    return {
      ok: true,
      args: {
        command: {
          kind: "add",
          file,
          line,
          from: options.get("--from"),
          to: options.get("--to"),
          title: options.get("--title"),
          session: options.get("--session"),
          sessionTitle: options.get("--session-title"),
          body,
          bodyFile
        },
        cwd,
        server
      }
    };
  }
  if (subcommand === "rename") {
    const id = rest[1];
    if (!id)
      return { ok: false, error: "rename requires a session id" };
    const title = options.get("--title");
    if (!title)
      return { ok: false, error: "rename requires --title <text>" };
    return {
      ok: true,
      args: { command: { kind: "rename", id, title }, cwd, server }
    };
  }
  if (subcommand === "edit") {
    const id = rest[1];
    if (!id)
      return { ok: false, error: "edit requires an annotation id" };
    const body = options.get("--body");
    const bodyFile = options.get("--body-file");
    if (body !== undefined && bodyFile !== undefined)
      return { ok: false, error: "use either --body or --body-file" };
    return {
      ok: true,
      args: {
        command: {
          kind: "edit",
          id,
          title: options.get("--title"),
          body,
          bodyFile
        },
        cwd,
        server
      }
    };
  }
  if (subcommand === "list") {
    return {
      ok: true,
      args: {
        command: { kind: "list", json: flags.has("--json") },
        cwd,
        server
      }
    };
  }
  if (subcommand === "delete") {
    const id = rest[1];
    if (!id)
      return { ok: false, error: "delete requires an id" };
    return { ok: true, args: { command: { kind: "delete", id }, cwd, server } };
  }
  if (subcommand === "clear") {
    return { ok: true, args: { command: { kind: "clear" }, cwd, server } };
  }
  return { ok: false, error: `unknown annotate command: ${subcommand}` };
}
async function readStdin() {
  if (process.stdin.isTTY)
    return "";
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
function resolveRepoRoot(cwdOption) {
  const base = cwdOption || process.cwd();
  try {
    return repoRoot(base) || realpathSync(base);
  } catch {
    console.error(`--cwd must point to an existing directory: ${base}`);
    process.exit(1);
  }
}
async function serverReachable(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/_annotations`, {
      signal: AbortSignal.timeout(1500)
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function ensureServerUrl(root, override) {
  if (override) {
    const url = override.replace(/\/+$/, "");
    if (await serverReachable(url))
      return url;
    console.error(`could not reach the code-viewer server at ${url}.`);
    process.exit(1);
  }
  const registered = readServerRegistry(root);
  if (registered) {
    const url = registered.url.replace(/\/+$/, "");
    if (await serverReachable(url))
      return url;
  }
  console.error(`no running code-viewer server for this repository.
` + `Start one manually (from ${root}):
` + "  code-viewer");
  process.exit(1);
}
async function request(serverUrl, method, body) {
  const url = `${serverUrl}/_annotations`;
  const origin = new URL(serverUrl).origin;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: method === "POST" ? {
        "Content-Type": "application/json",
        Origin: origin,
        "X-Code-Viewer-Action": "1"
      } : {},
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    console.error(`could not reach the code-viewer server at ${serverUrl}.`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`server rejected the request: ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}
function formatLine(line) {
  if (!line)
    return "";
  return line.start === line.end ? `:${line.start}` : `:${line.start}-${line.end}`;
}
function printList(state) {
  if (!state.sessions.length) {
    console.log("no annotations");
    return;
  }
  for (const session of state.sessions) {
    console.log(`session ${session.id}  ${session.title}`);
    session.entries.forEach((entry, index) => {
      const location = `${entry.path}${formatLine(entry.line)}`;
      const summary = (entry.title || entry.body).split(`
`)[0].slice(0, 80);
      console.log(`  ${index + 1}. [${entry.id}] ${location}  ${summary}`);
    });
  }
}
async function runAnnotateCli(argv) {
  const parsed = parseAnnotateArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error('Run "code-viewer annotate --help" for usage.');
    process.exit(1);
  }
  const { command, cwd, server } = parsed.args;
  if (command.kind === "help") {
    console.log(ANNOTATE_HELP);
    return;
  }
  if (command.kind === "agent-help") {
    console.log(ANNOTATE_AGENT_HELP);
    return;
  }
  const root = resolveRepoRoot(cwd);
  const serverUrl = await ensureServerUrl(root, server);
  if (command.kind === "start") {
    const result = await request(serverUrl, "POST", {
      action: "start",
      title: command.title
    });
    console.log(`session ${result.session.id}  ${result.session.title}`);
    console.error(`view annotations at ${serverUrl}/ with the code annotations panel`);
    return;
  }
  if (command.kind === "add") {
    let body = command.body;
    if (body === undefined && command.bodyFile !== undefined) {
      try {
        body = readFileSync4(command.bodyFile, "utf8");
      } catch {
        console.error(`could not read --body-file: ${command.bodyFile}`);
        process.exit(1);
      }
    }
    if (body === undefined)
      body = await readStdin();
    if (!body.trim()) {
      console.error("annotation body is empty. Pass --body, --body-file, or pipe stdin.");
      process.exit(1);
    }
    const result = await request(serverUrl, "POST", {
      action: "add",
      session_id: command.session,
      session_title: command.sessionTitle,
      path: command.file,
      line: command.line,
      range: { from: command.from, to: command.to },
      title: command.title,
      body
    });
    if (result.created_session) {
      console.error(`created new annotation session ${result.session_id} (${result.session_title || "Untitled session"})`);
    }
    console.log(`annotated ${result.entry.path}${formatLine(result.entry.line)} ` + `[${result.entry.id}] in session ${result.session_id} (${result.session_title || "Untitled session"})`);
    console.error(`view annotations at ${serverUrl}/ with the code annotations panel`);
    return;
  }
  if (command.kind === "list") {
    const state = await request(serverUrl, "GET");
    if (command.json)
      console.log(JSON.stringify(state, null, 2));
    else
      printList(state);
    return;
  }
  if (command.kind === "rename") {
    await request(serverUrl, "POST", {
      action: "rename",
      id: command.id,
      title: command.title
    });
    console.log(`renamed session ${command.id} to "${command.title}"`);
    return;
  }
  if (command.kind === "edit") {
    let bodyText = command.body;
    if (command.bodyFile !== undefined)
      bodyText = readFileSync4(command.bodyFile, "utf8");
    if (bodyText === undefined) {
      const stdin = await readStdin();
      if (stdin.trim())
        bodyText = stdin;
    }
    if (bodyText === undefined && command.title === undefined) {
      console.error("edit requires --title, --body, --body-file, or stdin");
      process.exit(1);
    }
    const result = await request(serverUrl, "POST", {
      action: "update",
      id: command.id,
      title: command.title,
      body: bodyText
    });
    console.log(`updated annotation ${result.entry.id} (${result.entry.path}${formatLine(result.entry.line)})`);
    return;
  }
  if (command.kind === "delete") {
    const result = await request(serverUrl, "POST", {
      action: "delete",
      id: command.id
    });
    if (!result.removed) {
      console.error(`no annotation or session with id ${command.id}`);
      process.exit(1);
    }
    console.log(`deleted ${result.removed} ${command.id}`);
    return;
  }
  await request(serverUrl, "POST", { action: "clear" });
  console.log("cleared all annotations");
}
var ANNOTATE_HELP = `code-viewer annotate — attach explanations to code locations

The annotations show up live in the code-viewer browser UI and are stored
in <repo>/.code-viewer/annotations.json. A running code-viewer server for
the repository is required: start one with "code-viewer" before using
annotate (or point at one explicitly with --server).

Run "code-viewer annotate agent-help" for an AI-agent oriented guide
(workflow, conventions, and pitfalls for writing good walkthroughs).

Usage:
  code-viewer annotate start [--title <text>]
  code-viewer annotate add --file <path> [--line <n>|<n>-<m>]
      [--from <ref>] [--to <ref>] [--title <text>] [--session <id>]
      [--body <markdown> | --body-file <path>]   (or pipe body via stdin)
  code-viewer annotate rename <session-id> --title <text>
  code-viewer annotate edit <id> [--title <text>]
      [--body <markdown> | --body-file <path>]   (or pipe body via stdin)
  code-viewer annotate list [--json]
  code-viewer annotate delete <id>
  code-viewer annotate clear

Global options:
  --cwd <dir>      repository to annotate (default: current directory)
  --server <url>   code-viewer server URL (default: auto-discovered)

Examples:
  code-viewer annotate start --title "How SSE updates work"
  code-viewer annotate add --file web-src/server/preview.ts --line 2220-2250 \\
      --body "This endpoint keeps one SSE stream per browser tab."
  git diff HEAD~1 | code-viewer annotate add --file src/app.ts --line 10 \\
      --from HEAD~1 --to worktree --body "The fix moves the guard up here."
`, ANNOTATE_AGENT_HELP = `code-viewer annotate — agent guide

You are an AI coding agent. Use this tool to walk a human through code in
their browser: each annotation jumps every open code-viewer tab to a file
location and renders your explanation directly under the annotated lines.

## When to use

- Explaining a change you just made (per-file, per-hunk commentary)
- Guiding a code review: point at the risky lines, in reading order
- Onboarding walkthroughs: "how does feature X flow through the code"

## Requirements

- A code-viewer server must already be running for the repository
  (the human starts it with: code-viewer). This command never starts one.
- Run from inside the repository, or pass --cwd <repo>.
- If "code-viewer" is not on PATH (e.g. the human runs it via npx), invoke
  every command below as: npx -y @youtyan/code-viewer annotate ...

## Workflow

1. Start a session per walkthrough topic. The title is shown to the human:
     code-viewer annotate start --title "How the cache invalidation works"
2. Add annotations in READING ORDER (the order you want the human to
   follow). Each add without --session appends to the most recent session:
     code-viewer annotate add --file src/cache.ts --line 120-145 \\
         --title "Entry point" --body "Writes land here first. ..."
3. Verify what you posted:
     code-viewer annotate list

## Conventions for good walkthroughs

- One idea per annotation. Prefer 5-10 focused annotations over 2 huge ones.
- Always pass --line. Use the smallest range that covers the idea; the
  body is rendered inline directly under the LAST line of the range.
- Line numbers must match the "to" side of the range (default: the current
  worktree state of the file). When annotating a diff against another ref,
  pass --from/--to and use NEW-side line numbers.
- The body is Markdown. Code spans, fenced blocks, and links work. Long
  bodies: use --body-file <path> or pipe via stdin instead of --body.
- Give every annotation a short --title; it becomes the inline heading.
- Annotating unchanged code is fine: the viewer auto-expands diff context
  or falls back to the full source view.

## Sessions

- add (no --session) → appends to the most recent session.
- annotate start      → begins a NEW session; later adds go there.
- add --session <id>  → targets a specific session (ids: annotate list).
- The human can share a walkthrough as a URL; one session = one shareable
  walkthrough. Do not mix unrelated topics in one session.

## Fixing mistakes and follow-ups

- The human may paste a reference block copied from the viewer that starts
  with "code-viewer のコード注釈について依頼があります" and lists the
  annotation id, location, and session, followed by their question.
  Read the current body first: code-viewer annotate list --json
- Revise a wrong annotation IN PLACE (do not delete + re-add; the id and
  its position in the walkthrough are preserved):
    code-viewer annotate edit <id> --body "<corrected markdown>"
    (long bodies: --body-file <path> or pipe via stdin; --title also works)
- Post a follow-up answer next to the original instead of replacing it:
    code-viewer annotate add --session <session-id> --file <path> --line <n>         --title "回答: ..." --body "<markdown>"
- Rename a session: code-viewer annotate rename <session-id> --title <text>

## Cleanup

- delete <id> removes one annotation or a whole session by its id.
- clear removes everything. Ask the human before clearing state you did
  not create.
`;
var init_annotate_cli = __esm(() => {
  init_annotations();
  init_git();
  init_server_registry();
});

// web-src/server/root.ts
import { existsSync as existsSync4 } from "node:fs";
import { dirname, join as join4, normalize } from "node:path";
import { fileURLToPath } from "node:url";
function findRoot(start) {
  let current = start;
  for (let i = 0;i < 5; i++) {
    if (existsSync4(join4(current, "package.json")) && existsSync4(join4(current, "web"))) {
      return normalize(current);
    }
    const parent = dirname(current);
    if (parent === current)
      break;
    current = parent;
  }
  return normalize(join4(start, "..", ".."));
}
var ROOT;
var init_root = __esm(() => {
  ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
});

// web-src/server/skill-cli.ts
var exports_skill_cli = {};
__export(exports_skill_cli, {
  runSkillCli: () => runSkillCli,
  parseSkillArgs: () => parseSkillArgs,
  installSkill: () => installSkill,
  SKILL_HELP: () => SKILL_HELP,
  AGENT_SKILL_DIRS: () => AGENT_SKILL_DIRS
});
import { cpSync, existsSync as existsSync5, mkdirSync as mkdirSync3 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join5, resolve } from "node:path";
function parseAgentList(value) {
  if (value === "all")
    return [...AGENT_NAMES];
  const names = value.split(",").map((name) => name.trim()).filter(Boolean);
  if (names.length === 0)
    return null;
  const result = [];
  for (const name of names) {
    if (!(name in AGENT_SKILL_DIRS))
      return null;
    const agent = name;
    if (!result.includes(agent))
      result.push(agent);
  }
  return result;
}
function parseSkillArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv[0] === "help") {
    return { ok: true, args: { kind: "help" } };
  }
  const [command, ...rest] = argv;
  if (command !== "install") {
    return { ok: false, error: `unknown skill command: ${command}` };
  }
  let global = false;
  let cwd;
  let agents = ["claude"];
  for (let i = 0;i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--global") {
      global = true;
    } else if (arg === "--cwd") {
      cwd = rest[++i];
      if (!cwd)
        return { ok: false, error: "--cwd requires a directory" };
    } else if (arg === "--agent") {
      const value = rest[++i];
      if (!value)
        return { ok: false, error: "--agent requires a list" };
      const parsed = parseAgentList(value);
      if (!parsed) {
        return {
          ok: false,
          error: `unknown agent in "${value}" (valid: ${AGENT_NAMES.join(", ")}, all)`
        };
      }
      agents = parsed;
    } else {
      return { ok: false, error: `unknown option: ${arg}` };
    }
  }
  return { ok: true, args: { kind: "install", agents, global, cwd } };
}
function installSkill(args, deps) {
  if (!existsSync5(join5(deps.sourceDir, "SKILL.md"))) {
    return {
      ok: false,
      error: `bundled skill not found at ${deps.sourceDir}`
    };
  }
  const base = args.global ? deps.homeDir : resolve(args.cwd ?? deps.projectDir);
  const results = [];
  for (const agent of args.agents) {
    const target = join5(base, AGENT_SKILL_DIRS[agent], "skills", SKILL_NAME);
    const action = existsSync5(target) ? "updated" : "installed";
    try {
      mkdirSync3(target, { recursive: true });
      cpSync(deps.sourceDir, target, { recursive: true });
    } catch (error) {
      return { ok: false, error: String(error) };
    }
    results.push({ agent, action, target });
  }
  return { ok: true, results };
}
function runSkillCli(argv) {
  const parsed = parseSkillArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error('Run "code-viewer skill --help" for usage.');
    process.exit(1);
  }
  if (parsed.args.kind === "help") {
    console.log(SKILL_HELP);
    return;
  }
  const result = installSkill(parsed.args, {
    sourceDir: join5(ROOT, "skills", SKILL_NAME),
    homeDir: homedir2(),
    projectDir: process.cwd()
  });
  if (result.ok === false) {
    console.error(result.error);
    process.exit(1);
  }
  for (const entry of result.results) {
    console.log(`${entry.action} (${entry.agent}): ${entry.target}`);
  }
  if (result.results.some((entry) => entry.action === "installed")) {
    console.log("Re-run the same command anytime to update the skill.");
  }
}
var SKILL_NAME = "code-viewer-annotate", AGENT_SKILL_DIRS, AGENT_NAMES, SKILL_HELP;
var init_skill_cli = __esm(() => {
  init_root();
  AGENT_SKILL_DIRS = {
    claude: ".claude",
    codex: ".codex",
    gemini: ".gemini",
    cursor: ".cursor",
    agents: ".agents"
  };
  AGENT_NAMES = Object.keys(AGENT_SKILL_DIRS);
  SKILL_HELP = `code-viewer skill — manage the bundled agent skill

Usage:
  code-viewer skill install [--agent <list>] [--global] [--cwd <dir>]

Installs the ${SKILL_NAME} skill (SKILL.md for AI coding agents) into the
skills directory of each selected agent in the current project, or into the
home directory equivalents with --global. Running install again overwrites
the files, so the same command also updates an existing installation.

Options:
  --agent <list>  comma separated agents: ${AGENT_NAMES.join(", ")}, or all
                  (default: claude)
  --global        install into the home directory (~/.claude/skills/ etc)
  --cwd <dir>     project directory to install into (ignored with --global)

Examples:
  code-viewer skill install
  code-viewer skill install --agent claude,codex,gemini
  code-viewer skill install --agent all --global
`;
});

// web-src/core/directory-name.ts
function normalizeNewDirectoryName(name) {
  if (typeof name !== "string")
    return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 180)
    return null;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\x00") || Array.from(trimmed).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  }))
    return null;
  if (trimmed === "." || trimmed === ".." || trimmed.toLowerCase() === ".git")
    return null;
  return trimmed;
}

// web-src/core/routes.ts
var SPA_PATHS, APP_ENTRY_PATHS;
var init_routes = __esm(() => {
  SPA_PATHS = [
    "/todif",
    "/todiff",
    "/file",
    "/help",
    "/history"
  ];
  APP_ENTRY_PATHS = ["/", "/index.html"];
});

// web-src/server/cache.ts
import { lstatSync as lstatSync2 } from "node:fs";
import { join as join6 } from "node:path";
function cacheFresh(cached, now = Date.now(), ttlMs = CACHE_TTL_MS) {
  return !!cached && now - cached.storedAt <= ttlMs;
}
function setTimedCacheEntry(cache, key, value, now = Date.now(), maxEntries = MAX_TIMED_CACHE_ENTRIES) {
  cache.set(key, { ...value, storedAt: now });
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined)
      break;
    cache.delete(oldest);
  }
}
function worktreeFileSignature(path, cwd) {
  try {
    const stats = lstatSync2(join6(cwd, path));
    const inode = "ino" in stats ? stats.ino : 0;
    return `state:file|size:${stats.size}|mtime:${stats.mtimeMs}|ctime:${stats.ctimeMs}|ino:${inode}`;
  } catch {
    return "state:missing";
  }
}
function fileDiffCacheKey(options) {
  const worktreeTarget = options.range.from === "worktree" || !options.range.to || options.range.to === "worktree";
  if (options.isUntracked && !worktreeTarget) {
    throw new Error("untracked file diffs require a worktree range");
  }
  const signature = worktreeTarget ? `\x00${worktreeFileSignature(options.path, options.cwd)}` : "";
  if (options.isUntracked) {
    return `u\x00${options.path}${signature}\x00${options.extras.join("\x00")}`;
  }
  return `t\x00${options.path}\x00${options.oldPath || ""}${signature}\x00${[...options.extras, ...options.args].join("\x00")}`;
}
var CACHE_TTL_MS = 1500, MAX_TIMED_CACHE_ENTRIES = 200;
var init_cache = () => {};

// web-src/server/dev-assets.ts
import { basename } from "node:path";
function startDevAssetReload(options) {
  if (!options.enabled)
    return false;
  const watched = new Set(options.watchedFiles);
  const setTimer = options.setTimeoutFn || setTimeout;
  const clearTimer = options.clearTimeoutFn || clearTimeout;
  const debounceMs = options.debounceMs ?? 150;
  let timer = null;
  options.watch(options.webRoot, { persistent: false }, (_event, filename) => {
    if (!filename || !watched.has(basename(filename.toString())))
      return;
    if (timer)
      clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      options.sendReload();
    }, debounceMs);
  });
  return true;
}
var init_dev_assets = () => {};

// web-src/server/range.ts
function isSameWorktreeRange(range) {
  return range.from === "worktree" && range.to === "worktree";
}
function parseHttpByteRange(header, size) {
  if (!header)
    return { kind: "invalid" };
  if (size < 1)
    return { kind: "unsatisfiable" };
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match)
    return { kind: "invalid" };
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd)
    return { kind: "invalid" };
  let start;
  let end;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1)
      return { kind: "unsatisfiable" };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
      return { kind: "invalid" };
    if (end >= size)
      end = size - 1;
  }
  if (start < 0 || end < start || start >= size)
    return { kind: "unsatisfiable" };
  return { kind: "range", range: { start, end } };
}
async function collectLineRangeFromStream(stream, start, end) {
  const reader = stream.getReader();
  const decoder = new TextDecoder;
  const lines = [];
  let lineNo = 1;
  let pending = "";
  let hasMore = false;
  const pushLine = (line) => {
    if (line.endsWith("\r"))
      line = line.slice(0, -1);
    if (lineNo >= start && lineNo <= end)
      lines.push(line);
    else if (lineNo > end)
      hasMore = true;
    lineNo++;
  };
  while (!hasMore) {
    const chunk = await reader.read();
    if (chunk.done)
      break;
    pending += decoder.decode(chunk.value, { stream: true });
    let newline = pending.indexOf(`
`);
    while (newline !== -1) {
      pushLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      if (hasMore)
        break;
      newline = pending.indexOf(`
`);
    }
  }
  if (hasMore) {
    try {
      await reader.cancel();
    } catch {}
    return { lines, total: lineNo - 1, complete: false };
  }
  pending += decoder.decode();
  if (pending.length > 0)
    pushLine(pending);
  if (hasMore)
    return { lines, total: lineNo - 1, complete: false };
  return { lines, total: Math.max(0, lineNo - 1), complete: true };
}
async function buildLineOffsetIndexFromStream(stream, size) {
  const reader = stream.getReader();
  const builder = createLineOffsetIndexBuilder(size);
  let offset = 0;
  let lastByte = -1;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done)
      break;
    const bytes = chunk.value;
    for (let index = 0;index < bytes.length; index++) {
      const byte = bytes[index];
      if (byte === 10)
        builder.push(offset + index);
      lastByte = byte;
    }
    offset += bytes.length;
  }
  return builder.finish(offset, offset > 0 && lastByte !== 10);
}
async function collectByteRangeFromStream(stream, start, endExclusive) {
  const reader = stream.getReader();
  const chunks = [];
  let offset = 0;
  let total = 0;
  while (offset < endExclusive) {
    const chunk = await reader.read();
    if (chunk.done)
      break;
    const chunkStart = offset;
    const chunkEnd = offset + chunk.value.byteLength;
    if (chunkEnd > start && chunkStart < endExclusive) {
      const sliceStart = Math.max(0, start - chunkStart);
      const sliceEnd = Math.min(chunk.value.byteLength, endExclusive - chunkStart);
      const slice = chunk.value.subarray(sliceStart, sliceEnd);
      chunks.push(slice);
      total += slice.byteLength;
    }
    offset = chunkEnd;
  }
  try {
    await reader.cancel();
  } catch {}
  if (chunks.length === 1)
    return chunks[0];
  const bytes = new Uint8Array(total);
  let writeOffset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }
  return bytes;
}
async function collectBytesWithLineOffsetIndexFromStream(stream, sizeHint) {
  const reader = stream.getReader();
  const builder = createLineOffsetIndexBuilder(sizeHint);
  const chunks = [];
  let offset = 0;
  let lastByte = -1;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done)
      break;
    const bytes = chunk.value;
    chunks.push(bytes);
    for (let index = 0;index < bytes.length; index++) {
      const byte = bytes[index];
      if (byte === 10)
        builder.push(offset + index);
      lastByte = byte;
    }
    offset += bytes.length;
  }
  const collected = new Uint8Array(offset);
  let writeOffset = 0;
  for (const chunk of chunks) {
    collected.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }
  return {
    bytes: collected,
    index: builder.finish(offset, offset > 0 && lastByte !== 10)
  };
}
function createLineOffsetIndexBuilder(size) {
  const useFloat64 = size > 4294967295;
  let capacity = 1024;
  let length = 0;
  let offsets = useFloat64 ? new Float64Array(capacity) : new Uint32Array(capacity);
  const grow = () => {
    capacity *= 2;
    const next = useFloat64 ? new Float64Array(capacity) : new Uint32Array(capacity);
    next.set(offsets);
    offsets = next;
  };
  return {
    push(offset) {
      if (length >= capacity)
        grow();
      offsets[length++] = offset;
    },
    finish(totalSize, hasTrailingLine) {
      return {
        size: totalSize,
        total: length + (hasTrailingLine ? 1 : 0),
        newlines: offsets.slice(0, length)
      };
    }
  };
}
function lineByteRangeForIndex(index, start, end) {
  const normalizedStart = Math.max(1, Math.floor(start));
  const normalizedEnd = Math.max(normalizedStart, Math.floor(end));
  if (normalizedStart > index.total)
    return null;
  const lastLine = Math.min(normalizedEnd, index.total);
  const byteStart = normalizedStart <= 1 ? 0 : index.newlines[normalizedStart - 2] + 1;
  const byteEnd = lastLine <= index.newlines.length ? index.newlines[lastLine - 1] : index.size;
  return { start: byteStart, endExclusive: byteEnd };
}
function collectLineRangeFromIndexedText(text, index, start, end) {
  const normalizedStart = Math.max(1, Math.floor(start));
  const normalizedEnd = Math.max(normalizedStart, Math.floor(end));
  if (normalizedStart > index.total)
    return { lines: [], total: index.total, complete: true };
  const expectedLines = Math.min(normalizedEnd, index.total) - normalizedStart + 1;
  const lines = text.length ? text.split(`
`).map((line) => line.endsWith("\r") ? line.slice(0, -1) : line) : Array.from({ length: expectedLines }, () => "");
  return { lines, total: index.total, complete: end >= index.total };
}

// web-src/server/search.ts
function normalizeGrepMax(value) {
  const parsed = Number(value || "");
  if (!Number.isInteger(parsed) || parsed <= 0)
    return GREP_DEFAULT_MAX;
  return Math.min(parsed, GREP_ABSOLUTE_MAX);
}
function isSkippableSearchPath(path, omitDirNames = [], excludeNames = []) {
  const omitDirs = new Set(omitDirNames.map((name) => name.toLowerCase()));
  const excluded = new Set(excludeNames.map((name) => name.toLowerCase()));
  return path.split(/[\\/]+/).some((part) => {
    const lower = part.toLowerCase();
    return lower === ".git" || lower === ".code-viewer" || omitDirs.has(lower) || excluded.has(lower);
  });
}
function fixedStringLineMatches(path, text, query, max) {
  const needle = query.toLowerCase();
  if (!needle)
    return [];
  const matches = [];
  const lines = text.split(`
`);
  for (let i = 0;i < lines.length && matches.length < max; i++) {
    const line = lines[i];
    const column = line.toLowerCase().indexOf(needle);
    if (column < 0)
      continue;
    matches.push({
      path,
      line: i + 1,
      column: column + 1,
      preview: line.slice(0, 500)
    });
  }
  return matches;
}
function buildFileSearchList(ref, generation, entries) {
  const files = entries.filter((entry) => entry.type === "blob" || entry.type === "commit").slice(0, FILE_SEARCH_ABSOLUTE_MAX).map((entry) => ({ path: entry.path, type: entry.type }));
  return {
    ref,
    generation,
    files,
    truncated: entries.length > FILE_SEARCH_ABSOLUTE_MAX
  };
}
function buildRgArgs(query, max, paths, regex = false, omitDirNames = [], excludeNames = []) {
  const safePaths = paths.length ? paths : ["."];
  const omitGlobs = omitDirNames.flatMap((name) => [
    "--glob",
    `!${name}/**`,
    "--glob",
    `!**/${name}/**`
  ]);
  const excludeGlobs = excludeNames.flatMap((name) => [
    "--glob",
    `!${name}`,
    "--glob",
    `!**/${name}`
  ]);
  const args = [
    "rg",
    "--no-config",
    "--line-number",
    "--column",
    "--no-heading",
    "--color",
    "never",
    "--smart-case",
    "--max-count",
    String(max),
    "--max-filesize",
    "2M",
    ...omitGlobs,
    ...excludeGlobs,
    "-e",
    query,
    "--",
    ...safePaths
  ];
  if (!regex)
    args.splice(8, 0, "--fixed-strings");
  return args;
}
function parseRgOutput(stdout, max, omitDirNames = [], excludeNames = []) {
  const matches = [];
  for (const line of stdout.split(`
`)) {
    if (!line || matches.length >= max)
      continue;
    const parsed = /^(.*):(\d+):(\d+):(.*)$/.exec(line);
    if (!parsed)
      continue;
    const path = parsed[1];
    const lineNo = Number(parsed[2]);
    const column = Number(parsed[3]);
    const preview = parsed[4];
    if (!path || !lineNo || !column || isSkippableSearchPath(path, omitDirNames, excludeNames))
      continue;
    matches.push({
      path,
      line: lineNo,
      column,
      preview: preview.slice(0, 500)
    });
  }
  return matches;
}
function parseGitGrepOutput(stdout, ref, max, omitDirNames = [], excludeNames = []) {
  const prefix = `${ref}:`;
  const normalized = stdout.split(`
`).map((line) => line.startsWith(prefix) ? line.slice(prefix.length) : line).join(`
`);
  return parseRgOutput(normalized, max, omitDirNames, excludeNames);
}
var GREP_DEFAULT_MAX = 200, GREP_ABSOLUTE_MAX = 500, GREP_MAX_FILE_BYTES, FILE_SEARCH_ABSOLUTE_MAX = 50000, DEFAULT_EXCLUDE_NAMES;
var init_search = __esm(() => {
  GREP_MAX_FILE_BYTES = 2 * 1024 * 1024;
  DEFAULT_EXCLUDE_NAMES = [".DS_Store"];
});

// web-src/server/worktree-watcher.ts
import {
  lstatSync as lstatSync3,
  readdirSync as nodeReaddirSync,
  watch as nodeWatch
} from "node:fs";
import { join as join7, relative } from "node:path";
function normalizeRelativePath(path) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}
function isInsideRoot(root, path) {
  const rel = relative(root, path).replace(/\\/g, "/");
  return rel === "" || !rel.startsWith("..") && !rel.startsWith("/");
}
function startWorktreeUpdateWatch(options) {
  const watch = options.watch || nodeWatch;
  const readDirs = options.readdirSync || ((path) => nodeReaddirSync(path, { withFileTypes: true }));
  const isDirectory = options.isDirectory || ((path) => {
    try {
      return lstatSync3(path).isDirectory();
    } catch {
      return false;
    }
  });
  const directorySignature = options.directorySignature || ((path) => {
    try {
      const stats = lstatSync3(path);
      if (!stats.isDirectory())
        return null;
      return `${stats.dev}:${stats.ino}`;
    } catch {
      return null;
    }
  });
  const setTimer = options.setTimeoutFn || setTimeout;
  const clearTimer = options.clearTimeoutFn || clearTimeout;
  const debounceMs = options.debounceMs ?? 250;
  const watchers = new Map;
  const signatures = new Map;
  const initialScanAsync = options.initialScanMode === "async" || (!options.watch || options.watch === nodeWatch) && !options.readdirSync;
  const initialScanQueue = [];
  let initialScanTimer = null;
  let timer = null;
  const ignored = (path) => isSkippableSearchPath(normalizeRelativePath(path), options.omitDirNames, options.excludeNames);
  const scheduleUpdate = () => {
    if (timer)
      clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      options.onUpdate();
    }, debounceMs);
  };
  const closeSubtree = (dir) => {
    for (const [watchedDir, watcher] of [...watchers]) {
      if (watchedDir !== dir && !watchedDir.startsWith(`${dir}/`))
        continue;
      try {
        watcher.close?.();
      } catch {}
      watchers.delete(watchedDir);
      signatures.delete(watchedDir);
    }
  };
  const closeAll = () => {
    if (initialScanTimer) {
      clearTimer(initialScanTimer);
      initialScanTimer = null;
    }
    initialScanQueue.length = 0;
    for (const watcher of [...watchers.values()]) {
      try {
        watcher.close?.();
      } catch {}
    }
    watchers.clear();
    signatures.clear();
  };
  const readChildDirectories = (dir) => {
    let entries;
    try {
      entries = readDirs(dir);
    } catch (error) {
      options.onError?.(error);
      return [];
    }
    const children = [];
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue;
      children.push(join7(dir, entry.name));
    }
    return children;
  };
  const processInitialScanQueue = () => {
    initialScanTimer = null;
    const next = initialScanQueue.shift();
    if (next)
      watchDirectory(next, true);
    if (initialScanQueue.length)
      initialScanTimer = setTimer(processInitialScanQueue, 50);
  };
  const queueInitialChildren = (dir) => {
    initialScanQueue.push(...readChildDirectories(dir));
    if (!initialScanTimer)
      initialScanTimer = setTimer(processInitialScanQueue, 5000);
  };
  const watchDirectory = (dir, initialScan = false) => {
    if (watchers.has(dir))
      return;
    const rel = normalizeRelativePath(relative(options.root, dir));
    if (rel && ignored(rel))
      return;
    try {
      const watcher = watch(dir, { persistent: false }, (_event, filename) => {
        if (!filename) {
          scheduleUpdate();
          return;
        }
        const changed = normalizeRelativePath(join7(rel, filename.toString()));
        if (ignored(changed))
          return;
        const fullChangedPath = join7(options.root, changed);
        if (!isInsideRoot(options.root, fullChangedPath))
          return;
        const known = watchers.has(fullChangedPath);
        if (isDirectory(fullChangedPath)) {
          if (known) {
            const signature2 = directorySignature(fullChangedPath);
            if (signature2 && signature2 !== signatures.get(fullChangedPath)) {
              closeSubtree(fullChangedPath);
              watchDirectory(fullChangedPath);
            }
            scheduleUpdate();
            return;
          }
          watchDirectory(fullChangedPath);
        } else if (known) {
          closeSubtree(fullChangedPath);
        }
        scheduleUpdate();
      }) || {};
      watchers.set(dir, watcher);
      const signature = directorySignature(dir);
      if (signature)
        signatures.set(dir, signature);
      watcher.on?.("error", () => {
        if (watchers.get(dir) === watcher) {
          watchers.delete(dir);
          signatures.delete(dir);
        }
      });
      watcher.on?.("close", () => {
        if (watchers.get(dir) === watcher) {
          watchers.delete(dir);
          signatures.delete(dir);
        }
      });
    } catch (error) {
      options.onError?.(error);
      return;
    }
    if (initialScanAsync && initialScan) {
      queueInitialChildren(dir);
      return;
    }
    for (const child of readChildDirectories(dir))
      watchDirectory(child);
  };
  watchDirectory(options.root, true);
  return { started: watchers.size > 0, close: closeAll };
}
var init_worktree_watcher = __esm(() => {
  init_search();
});

// web-src/server/preview.ts
var exports_preview = {};
import {
  closeSync,
  constants,
  existsSync as existsSync6,
  lstatSync as lstatSync4,
  mkdirSync as mkdirSync4,
  openSync,
  readFileSync as readFileSync5,
  realpathSync as realpathSync2,
  renameSync as renameSync2,
  statSync as statSync2,
  unlinkSync as unlinkSync2,
  watch,
  writeFileSync as writeFileSync3
} from "node:fs";
import { homedir as homedir3 } from "node:os";
import { basename as basename2, dirname as dirname2, extname, join as join8, relative as relative2 } from "node:path";
function parseCli() {
  const rest = [];
  for (let i = 2;i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(`code-viewer ${VERSION}

Usage:
  code-viewer [--cwd <repo>] [--port <port>] [--open] [git-diff-args...]
  code-viewer annotate <start|add|list|delete|clear> [options]

Examples:
  code-viewer --open
  code-viewer --cwd /path/to/repo --open
  code-viewer HEAD~1 HEAD
  code-viewer --staged
  code-viewer annotate --help
`);
      process.exit(0);
    } else if (arg === "--version" || arg === "-v") {
      console.log(VERSION);
      process.exit(0);
    } else if (arg === "--cwd") {
      const next = process.argv[++i];
      if (!next) {
        console.error("--cwd requires a value");
        process.exit(1);
      }
      try {
        cwd = repoRoot(next) || realpathSync2(next);
      } catch {
        console.error("--cwd must point to an existing directory");
        process.exit(1);
      }
    } else if (arg === "--port") {
      const next = process.argv[++i];
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        console.error("--port requires a TCP port number");
        process.exit(1);
      }
      listenPort = parsed;
    } else if (arg === "--open") {
      openAfterStart = true;
    } else if (arg === "--allow-upload") {} else if (arg === "--scope-omit-dir") {
      const next = process.argv[++i];
      if (!next) {
        console.error("--scope-omit-dir requires a directory name");
        process.exit(1);
      }
      scopeOmitDirCliOverride = normalizeScopeOmitDirNames([
        ...scopeOmitDirCliOverride || [],
        next
      ]);
    } else {
      rest.push(arg);
    }
  }
  if (rest.length)
    cliArgs = rest;
  const configScopeOmitDirs = loadProjectConfigScopeOmitDirs();
  const configScopeExcludeNames = loadProjectConfigScopeExcludeNames();
  uploadDisabledByConfig = loadProjectConfigUploadDisabled();
  if (scopeOmitDirCliOverride) {
    scopeOmitDirNames = scopeOmitDirCliOverride;
  } else if (configScopeOmitDirs) {
    scopeOmitDirNames = configScopeOmitDirs;
  }
  if (configScopeExcludeNames)
    scopeExcludeNames = configScopeExcludeNames;
}
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...init.headers || {}
    }
  });
}
function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
function requestAllowed(req) {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin");
  const okHost = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(host);
  const okOrigin = !origin || origin === "null" || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(origin);
  return okHost && okOrigin;
}
function sideEffectRequestAllowed(req) {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  const requestedBy = req.headers.get("x-code-viewer-action");
  return /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(host) && origin === `http://${host}` && (!fetchSite || fetchSite === "same-origin") && requestedBy === "1";
}
function staticFile(pathname) {
  const map = {
    "/favicon.png": ["favicon.png", "image/png"],
    "/style.css": ["style.css", "text/css; charset=utf-8"],
    "/app.js": ["app.js", "application/javascript; charset=utf-8"],
    "/mermaid.js": ["mermaid.js", "application/javascript; charset=utf-8"],
    "/shiki.js": ["shiki.js", "application/javascript; charset=utf-8"],
    "/vendor/diff2html/diff2html.min.css": [
      "vendor/diff2html/diff2html.min.css",
      "text/css; charset=utf-8"
    ],
    "/vendor/diff2html/diff2html-ui.min.js": [
      "vendor/diff2html/diff2html-ui.min.js",
      "application/javascript; charset=utf-8"
    ],
    "/vendor/highlight.js/highlight.min.js": [
      "vendor/highlight.js/highlight.min.js",
      "application/javascript; charset=utf-8"
    ],
    "/vendor/highlight.js/styles/github.min.css": [
      "vendor/highlight.js/styles/github.min.css",
      "text/css; charset=utf-8"
    ],
    "/vendor/highlight.js/styles/github-dark.min.css": [
      "vendor/highlight.js/styles/github-dark.min.css",
      "text/css; charset=utf-8"
    ]
  };
  for (const spaPath of [...APP_ENTRY_PATHS, ...SPA_PATHS]) {
    map[spaPath] = ["index.html", "text/html; charset=utf-8"];
  }
  const spec = map[pathname];
  if (!spec)
    return null;
  const full = join8(WEB_ROOT, spec[0]);
  if (!existsSync6(full))
    return text("not found", 404);
  return new Response(readFileSync5(full), {
    headers: { "Content-Type": spec[1], "Cache-Control": "no-store" }
  });
}
function buildRangeArgs(range) {
  const refs2 = [];
  if (range.from && range.from !== "worktree")
    refs2.push(range.from);
  if (range.to && range.to !== "worktree")
    refs2.push(range.to);
  return { args: refs2.length ? refs2 : cliArgs, refs: refs2 };
}
function includeUntracked(range, refs2) {
  const toWorktree = !range.to || range.to === "worktree";
  if (refs2.length > 0)
    return toWorktree && refs2.length < 2;
  return cliArgs.length === 0 || cliArgs.length === 1 && cliArgs[0] === "HEAD";
}
function guessMediaKind(path) {
  const ext = extname(path).slice(1).toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"].includes(ext))
    return "image";
  if (["mp4", "webm", "mov"].includes(ext))
    return "video";
  if (["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"].includes(ext))
    return "audio";
  return null;
}
function classify(file) {
  if (file.binary)
    return "binary";
  const total = (file.additions || 0) + (file.deletions || 0);
  if (total <= SIZE_SMALL)
    return "small";
  if (total <= SIZE_MEDIUM)
    return "medium";
  if (total <= SIZE_LARGE)
    return "large";
  return "huge";
}
function estimateHeight(file, sizeClass) {
  if (file.binary)
    return 380;
  if (sizeClass === "small")
    return Math.min(800, ((file.additions || 0) + (file.deletions || 0) + 10) * 22);
  return 140;
}
function buildQuery(params) {
  const q = new URLSearchParams;
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== "")
      q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}
function fileToMeta(file, range, extraQs) {
  const sizeClass = classify(file);
  const q = {
    path: file.path,
    old_path: file.old_path,
    status: file.status,
    from: range.from,
    to: range.to,
    ...extraQs
  };
  if (file.untracked)
    Object.assign(q, { untracked: "1" });
  const previewQ = { ...q, mode: "preview", max_hunks: PREVIEW_HUNKS_DEFAULT };
  const previewUrl = sizeClass !== "small" ? `/file_diff${buildQuery(previewQ)}` : null;
  return {
    order: file.order,
    key: `${file.status || "M"}\x00${file.old_path || ""}\x00${file.path}`,
    path: file.path,
    old_path: file.old_path,
    display_path: file.path,
    status: file.status || "M",
    additions: file.additions || 0,
    deletions: file.deletions || 0,
    binary: file.binary || false,
    media_kind: guessMediaKind(file.path),
    size_class: sizeClass,
    force_layout: sizeClass === "huge" ? "line-by-line" : undefined,
    highlight: sizeClass === "small",
    load_url: `/file_diff${buildQuery(q)}`,
    preview_url: previewUrl,
    estimated_height_px: estimateHeight(file, sizeClass),
    untracked: file.untracked || false
  };
}
function computePayload(extras, range) {
  if (isSameWorktreeRange(range)) {
    return {
      files: [],
      totals: { files: 0, additions: 0, deletions: 0 },
      range: "worktree .. worktree",
      project: basename2(cwd),
      branch: currentBranch(cwd) || undefined,
      generation
    };
  }
  const { args, refs: refs2 } = buildRangeArgs(range);
  const fullArgs = [...extras, ...args];
  const files = fileMeta(fullArgs, cwd, false);
  if (includeUntracked(range, refs2))
    files.push(...untrackedMeta(cwd));
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  files.forEach((file, i) => {
    file.order = i + 1;
  });
  const extraQs = {};
  for (const e of extras) {
    if (e === "-w" || e === "--ignore-all-space")
      extraQs.ignore_ws = "1";
    if (e === "--ignore-blank-lines")
      extraQs.ignore_blank = "1";
  }
  const meta = files.map((file) => fileToMeta(file, range, extraQs));
  const totals = meta.reduce((acc, file) => {
    acc.additions += file.additions || 0;
    acc.deletions += file.deletions || 0;
    return acc;
  }, { files: meta.length, additions: 0, deletions: 0 });
  const toWorktree = !range.to || range.to === "worktree";
  const label = refs2.length ? `${refs2.join(" .. ")}${toWorktree && refs2.length === 1 ? " .. worktree" : ""}` : cliArgs.join(" ");
  return {
    files: meta,
    totals,
    range: label || "HEAD",
    project: basename2(cwd),
    branch: currentBranch(cwd) || undefined,
    generation
  };
}
function handleDiffJson(url) {
  const extras = [];
  if (url.searchParams.get("ignore_ws") === "1")
    extras.push("-w");
  if (url.searchParams.get("ignore_blank") === "1")
    extras.push("--ignore-blank-lines");
  const range = {
    from: url.searchParams.get("from") || "",
    to: url.searchParams.get("to") || ""
  };
  const key = `${range.from}|${range.to}|${url.searchParams.get("ignore_ws") || ""}|${url.searchParams.get("ignore_blank") || ""}`;
  if (url.searchParams.get("nocache") === "1") {
    const payload2 = computePayload(extras, range);
    const sig = JSON.stringify({ ...payload2, generation: undefined });
    const cached2 = metaCache.get(key);
    if (!cached2 || cached2.sig !== sig) {
      generation++;
      payload2.generation = generation;
      metaCache.clear();
      fileCache.clear();
    }
    const body2 = JSON.stringify(payload2);
    setTimedCacheEntry(metaCache, key, { body: body2, sig });
    return new Response(body2, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }
  const cached = metaCache.get(key);
  if (cacheFresh(cached))
    return new Response(cached.body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  const payload = computePayload(extras, range);
  const body = JSON.stringify(payload);
  setTimedCacheEntry(metaCache, key, {
    body,
    sig: JSON.stringify({ ...payload, generation: undefined })
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
function safePath(path) {
  if (!path || path.startsWith("/") || path.startsWith("\\") || path.includes("\x00"))
    return false;
  return !path.split(/[\\/]+/).includes("..");
}
function safeRepoPath(path) {
  return path === "" || safePath(path);
}
function normalizeScopeOmitDirNames(names) {
  if (!Array.isArray(names))
    return [];
  return [
    ...new Set(names.filter((name) => typeof name === "string").map((name) => name.trim()).filter((name) => name && name.length <= 64 && !name.includes("/") && !name.includes("\\") && !name.includes("\x00") && name !== "." && name !== ".." && name !== ".git"))
  ].sort((a, b) => a.localeCompare(b));
}
function normalizeScopeExcludeNames(names) {
  if (!Array.isArray(names))
    return [];
  return [
    ...new Set(names.filter((name) => typeof name === "string").map((name) => name.trim()).filter((name) => name && name.length <= 128 && !name.includes("/") && !name.includes("\\") && !name.includes("\x00") && name !== "." && name !== ".." && name !== ".git"))
  ].sort((a, b) => a.localeCompare(b));
}
function parseScopeOmitDirNamesQuery(value) {
  const names = value ? value.split(",") : [];
  if (names.length > 100)
    return null;
  for (const raw of names) {
    const name = raw.trim();
    if (!name || name.length > 64 || name.includes("/") || name.includes("\\") || name.includes("\x00") || name === "." || name === ".." || name === ".git")
      return null;
  }
  return normalizeScopeOmitDirNames(names);
}
function parseScopeExcludeNamesQuery(value) {
  const names = value ? value.split(",") : [];
  if (names.length > 200)
    return null;
  for (const raw of names) {
    const name = raw.trim();
    if (!name || name.length > 128 || name.includes("/") || name.includes("\\") || name.includes("\x00") || name === "." || name === ".." || name === ".git")
      return null;
  }
  return normalizeScopeExcludeNames(names);
}
function loadProjectConfig() {
  const full = join8(cwd, ".code-viewer.json");
  if (!existsSync6(full))
    return null;
  let realCwd;
  let realConfig;
  try {
    realCwd = realpathSync2(cwd);
    realConfig = realpathSync2(full);
  } catch {
    return null;
  }
  if (dirname2(realConfig) !== realCwd || basename2(realConfig) !== ".code-viewer.json")
    return null;
  try {
    const parsed = JSON.parse(readFileSync5(realConfig, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "version" in parsed && parsed.version !== 1)
      return null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function loadProjectConfigUploadDisabled() {
  const config = loadProjectConfig();
  return config?.upload?.enabled === false;
}
function loadProjectConfigScopeOmitDirs() {
  const config = loadProjectConfig();
  if (!config?.scope || !Array.isArray(config.scope.omitDirs))
    return null;
  return normalizeScopeOmitDirNames(config.scope.omitDirs);
}
function loadProjectConfigScopeExcludeNames() {
  const config = loadProjectConfig();
  if (!config?.scope || !Array.isArray(config.scope.excludeNames))
    return null;
  return normalizeScopeExcludeNames(config.scope.excludeNames);
}
function scopeOmitDirNamesFromQuery(url) {
  if (!url.searchParams.has("omit_dirs"))
    return scopeOmitDirNames;
  return parseScopeOmitDirNamesQuery(url.searchParams.get("omit_dirs") || "") || scopeOmitDirNames;
}
function scopeExcludeNamesFromQuery(url) {
  if (!url.searchParams.has("exclude_names"))
    return scopeExcludeNames;
  return parseScopeExcludeNamesQuery(url.searchParams.get("exclude_names") || "") || scopeExcludeNames;
}
function invalidScopeOmitDirNamesQuery(url) {
  return url.searchParams.has("omit_dirs") && !parseScopeOmitDirNamesQuery(url.searchParams.get("omit_dirs") || "");
}
function invalidScopeExcludeNamesQuery(url) {
  return url.searchParams.has("exclude_names") && !parseScopeExcludeNamesQuery(url.searchParams.get("exclude_names") || "");
}
function isExcludedScopePath(path, excludeNames) {
  return path.split(/[\\/]+/).some((part) => excludeNames.some((name) => part.toLowerCase() === name.toLowerCase()));
}
function isGitInternalPath(path) {
  return path.split(/[\\/]+/).some((part) => part.toLowerCase() === ".git");
}
function safeWorktreePath(path) {
  if (!safePath(path))
    return null;
  if (isGitInternalPath(path))
    return null;
  const full = join8(cwd, path);
  if (!existsSync6(full))
    return null;
  let realCwd;
  let realFull;
  try {
    realCwd = realpathSync2(cwd);
    realFull = realpathSync2(full);
  } catch {
    return null;
  }
  const rel = relative2(realCwd, realFull);
  if (rel === "" || rel.startsWith("..") || rel.startsWith("/") || rel.startsWith("\\"))
    return null;
  if (isGitInternalPath(rel))
    return null;
  return realFull;
}
function worktreePath(path) {
  return join8(cwd, path);
}
function safeOpenWorktreePath(path) {
  if (path === "") {
    try {
      const realCwd = realpathSync2(cwd);
      if (isGitInternalPath(realCwd))
        return null;
      return realCwd;
    } catch {
      return null;
    }
  }
  return safeWorktreePath(path);
}
function parentRepoPath(path) {
  const parent = dirname2(path);
  return parent === "." ? "" : parent;
}
function isoDate(ms) {
  return ms && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}
function worktreeFileMetadata(path, knownSize) {
  const full = safeWorktreePath(path);
  if (!full)
    return {};
  try {
    const stat = statSync2(full);
    return {
      size: knownSize ?? stat.size,
      created_at: isoDate(stat.birthtimeMs),
      updated_at: isoDate(stat.mtimeMs)
    };
  } catch {
    return {};
  }
}
function gitFileMetadata(ref, path, knownSize) {
  const size = knownSize ?? rawFileSize(path, ref);
  const commitUpdatedAt = lastCommitDateForPath(ref, path, cwd) || undefined;
  return {
    size: size == null ? undefined : size,
    updated_at: commitUpdatedAt,
    commit_updated_at: commitUpdatedAt
  };
}
function directoryMetadata(target, path) {
  if (target === "worktree" || target === "") {
    const full = path === "" ? safeOpenWorktreePath("") : safeWorktreePath(path);
    if (!full)
      return {};
    try {
      const stat = statSync2(full);
      return {
        created_at: isoDate(stat.birthtimeMs),
        updated_at: isoDate(stat.mtimeMs)
      };
    } catch {
      return {};
    }
  }
  const commitUpdatedAt = lastCommitDateForPath(target, path || ".", cwd) || undefined;
  return { updated_at: commitUpdatedAt, commit_updated_at: commitUpdatedAt };
}
function fileMetadataForTarget(target, path) {
  return target === "worktree" || target === "" ? worktreeFileMetadata(path) : gitFileMetadata(target, path);
}
function attachTreeEntryMetadata(target, entry) {
  if (entry.type === "tree")
    return { ...entry, ...directoryMetadata(target, entry.path) };
  if (entry.type !== "blob")
    return entry;
  return { ...entry, ...fileMetadataForTarget(target, entry.path) };
}
function fileMetadataHeaders(metadata) {
  const headers = {};
  if (metadata.created_at)
    headers["X-Code-Viewer-Created-At"] = metadata.created_at;
  if (metadata.updated_at)
    headers["X-Code-Viewer-Updated-At"] = metadata.updated_at;
  if (metadata.commit_updated_at)
    headers["X-Code-Viewer-Commit-Updated-At"] = metadata.commit_updated_at;
  return headers;
}
function readReadme(target, dirPath) {
  const candidates = ["README.md", "readme.md", "README.markdown", "README"];
  for (const name of candidates) {
    const path = dirPath ? `${dirPath}/${name}` : name;
    if (target === "worktree" || target === "") {
      const full = safeWorktreePath(path);
      if (!full)
        continue;
      try {
        return { path, text: readFileSync5(full, "utf8") };
      } catch {
        continue;
      }
    }
    const res = show(target, path, cwd);
    if (res.code === 0)
      return { path, text: res.stdout };
  }
  return null;
}
function handleTree(url) {
  const target = url.searchParams.get("ref") || url.searchParams.get("target") || "worktree";
  const path = (url.searchParams.get("path") || "").replace(/^\/+|\/+$/g, "");
  if (!safeRepoPath(path))
    return text("invalid path", 400);
  if ((target === "worktree" || target === "") && isGitInternalPath(path))
    return text("forbidden", 403);
  if (target !== "worktree" && !verifyTreeRef(target, cwd))
    return text("invalid target", 400);
  const recursive = url.searchParams.get("recursive") === "1";
  if (invalidScopeOmitDirNamesQuery(url))
    return text("invalid omit dirs", 400);
  if (invalidScopeExcludeNamesQuery(url))
    return text("invalid exclude names", 400);
  const excludeNames = scopeExcludeNamesFromQuery(url);
  const entries = listTree(target, path, cwd, {
    recursive,
    omitDirNames: scopeOmitDirNamesFromQuery(url),
    excludeNames
  }).entries.filter((entry) => !isExcludedScopePath(entry.path, excludeNames));
  return json({
    ref: target,
    path,
    project: basename2(cwd),
    branch: currentBranch(cwd) || undefined,
    entries: recursive ? entries : entries.map((entry) => attachTreeEntryMetadata(target, entry)),
    readme: readReadme(target, path),
    upload_enabled: !uploadDisabledByConfig && (target === "worktree" || target === "")
  });
}
function handleSettings() {
  return json({
    project: basename2(cwd),
    repo_web_url: remoteWebUrl(cwd),
    scope: {
      omit_dirs_effective: scopeOmitDirNames,
      omit_dirs_built_in: DEFAULT_WORKTREE_OMIT_DIR_NAMES,
      exclude_names_effective: scopeExcludeNames,
      exclude_names_built_in: DEFAULT_EXCLUDE_NAMES,
      max_entries: WORKTREE_RECURSIVE_ENTRY_LIMIT
    }
  });
}
function handleFiles(url) {
  const target = url.searchParams.get("ref") || url.searchParams.get("target") || "worktree";
  if (target !== "worktree" && !verifyTreeRef(target, cwd))
    return text("invalid target", 400);
  if (invalidScopeOmitDirNamesQuery(url))
    return text("invalid omit dirs", 400);
  if (invalidScopeExcludeNamesQuery(url))
    return text("invalid exclude names", 400);
  const omitDirNames = scopeOmitDirNamesFromQuery(url);
  const excludeNames = scopeExcludeNamesFromQuery(url);
  const key = `${target || "worktree"}\x00${omitDirNames.join("\x00")}\x00${excludeNames.join("\x00")}`;
  const cached = fileListCache.get(key);
  if (cached && cached.generation === generation)
    return json(cached.body);
  const ref = target || "worktree";
  const entries = listTree(ref, "", cwd, {
    recursive: true,
    omitDirNames,
    excludeNames
  }).entries.filter((entry) => !isExcludedScopePath(entry.path, excludeNames));
  const body = buildFileSearchList(ref, generation, entries);
  fileListCache.set(key, { generation, body });
  return json(body);
}
function parseGrepPaths(url, omitDirNames, excludeNames) {
  return url.searchParams.getAll("path").filter((path) => safePath(path) && !isGitInternalPath(path) && !isSkippableSearchPath(path, omitDirNames, excludeNames));
}
function rgAvailable() {
  if (rgAvailableCache !== null)
    return rgAvailableCache;
  const proc = runSync(["rg", "--version"], cwd);
  rgAvailableCache = proc.code === 0;
  return rgAvailableCache;
}
function grepWorktreeFallback(query, max, paths, omitDirNames, excludeNames) {
  const candidates = paths.length ? paths : listTree("worktree", "", cwd, {
    recursive: true,
    omitDirNames,
    excludeNames
  }).entries.map((entry) => entry.path);
  const matches = [];
  for (const path of candidates) {
    if (matches.length >= max)
      break;
    if (!safePath(path) || isGitInternalPath(path) || isSkippableSearchPath(path, omitDirNames, excludeNames))
      continue;
    const full = safeWorktreePath(path);
    if (!full)
      continue;
    let stat;
    try {
      stat = lstatSync4(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > GREP_MAX_FILE_BYTES)
      continue;
    let data;
    try {
      data = readFileSync5(full);
    } catch {
      continue;
    }
    if (data.subarray(0, 8192).includes(0))
      continue;
    matches.push(...fixedStringLineMatches(path, data.toString("utf8"), query, max - matches.length));
  }
  return matches;
}
function grepWorktree(query, max, paths, regex, omitDirNames, excludeNames) {
  if (rgAvailable()) {
    const safePaths = paths.filter((path) => safePath(path) && !isGitInternalPath(path) && !isSkippableSearchPath(path, omitDirNames, excludeNames) && safeWorktreePath(path));
    const args = buildRgArgs(query, max, safePaths, regex, omitDirNames, excludeNames);
    const proc = runSync(args, cwd, { timeout: 5000 });
    const stdout = proc.stdout;
    const matches2 = parseRgOutput(stdout, max, omitDirNames, excludeNames).filter((match) => safePath(match.path) && !isGitInternalPath(match.path) && !isSkippableSearchPath(match.path, omitDirNames, excludeNames) && !!safeWorktreePath(match.path));
    return {
      ref: "worktree",
      engine: "rg",
      truncated: matches2.length >= max,
      matches: matches2
    };
  }
  if (regex)
    return {
      ref: "worktree",
      engine: "fallback",
      truncated: false,
      matches: []
    };
  const matches = grepWorktreeFallback(query, max, paths, omitDirNames, excludeNames);
  return {
    ref: "worktree",
    engine: "fallback",
    truncated: matches.length >= max,
    matches
  };
}
function grepTreeRef(ref, query, max, paths, regex, omitDirNames, excludeNames) {
  const safePaths = paths.filter((path) => safePath(path) && !isGitInternalPath(path) && !isSkippableSearchPath(path, omitDirNames, excludeNames));
  const args = [
    "git",
    "-c",
    "core.quotepath=false",
    "grep",
    "-n",
    "--column",
    "-i",
    regex ? "-E" : "-F",
    "--no-color",
    "-e",
    query,
    ref,
    "--",
    ...safePaths
  ];
  const proc = runSync(args, cwd, { timeout: 5000 });
  const stdout = proc.stdout;
  const matches = parseGitGrepOutput(stdout, ref, max, omitDirNames, excludeNames).slice(0, max);
  return { ref, engine: "git", truncated: matches.length >= max, matches };
}
function handleGrep(url) {
  const query = url.searchParams.get("q") || "";
  const ref = url.searchParams.get("ref") || "worktree";
  const max = normalizeGrepMax(url.searchParams.get("max"));
  if (invalidScopeOmitDirNamesQuery(url))
    return text("invalid omit dirs", 400);
  if (invalidScopeExcludeNamesQuery(url))
    return text("invalid exclude names", 400);
  const omitDirNames = scopeOmitDirNamesFromQuery(url);
  const excludeNames = scopeExcludeNamesFromQuery(url);
  const paths = parseGrepPaths(url, omitDirNames, excludeNames);
  const regex = url.searchParams.get("regex") === "1";
  if (!query.trim())
    return json({
      ref,
      engine: ref === "worktree" ? "fallback" : "git",
      truncated: false,
      matches: []
    });
  if (ref === "worktree" || ref === "")
    return json(grepWorktree(query, max, paths, regex, omitDirNames, excludeNames));
  if (!verifyTreeRef(ref, cwd))
    return text("invalid target", 400);
  return json(grepTreeRef(ref, query, max, paths, regex, omitDirNames, excludeNames));
}
function handleRefCommits(url) {
  const query = url.searchParams.get("q") || "";
  const parsedMax = Number(url.searchParams.get("max") || "");
  const max = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : undefined;
  return json({ commits: refCommits(cwd, query, max) });
}
function handleLog(url) {
  const ref = url.searchParams.get("ref") || "HEAD";
  const skip = Number(url.searchParams.get("skip") || "0");
  const limit = Number(url.searchParams.get("limit") || "50");
  const result = commitHistory(cwd, {
    ref,
    skip: Number.isFinite(skip) ? skip : 0,
    limit: Number.isFinite(limit) ? limit : 50,
    query: url.searchParams.get("q") || ""
  });
  if (result.error)
    return text(result.error, 400);
  return json({ commits: result.commits, hasMore: result.hasMore });
}
function handleFileDiff(url) {
  const path = url.searchParams.get("path") || "";
  if (!safePath(path))
    return text("invalid path", 400);
  const extras = [];
  if (url.searchParams.get("ignore_ws") === "1")
    extras.push("-w");
  if (url.searchParams.get("ignore_blank") === "1")
    extras.push("--ignore-blank-lines");
  const isUntracked = url.searchParams.get("untracked") === "1";
  const range = {
    from: url.searchParams.get("from") || "",
    to: url.searchParams.get("to") || ""
  };
  if (isSameWorktreeRange(range)) {
    return json({
      path,
      old_path: url.searchParams.get("old_path") || "",
      status: url.searchParams.get("status") || "",
      mode: url.searchParams.get("mode") || "full",
      diff: "",
      hunk_count: 0,
      rendered_hunk_count: 0,
      line_count: 0,
      truncated: false,
      binary: false,
      generation
    });
  }
  const { args } = buildRangeArgs(range);
  const oldPath = url.searchParams.get("old_path");
  let cacheKey;
  try {
    cacheKey = fileDiffCacheKey({
      path,
      oldPath,
      isUntracked,
      range,
      extras,
      args,
      cwd
    });
  } catch {
    return text("invalid diff range", 400);
  }
  const cached = fileCache.get(cacheKey);
  let diffText;
  let errText = "";
  if (cacheFresh(cached)) {
    diffText = cached.diffText;
  } else {
    if (isUntracked) {
      diffText = untrackedFileDiff(extras, path, cwd).stdout || "";
    } else {
      const res = fileDiffText([...extras, ...args], oldPath ? [oldPath, path] : path, cwd);
      diffText = res.stdout || "";
      if (res.code !== 0)
        errText = res.stderr;
    }
    setTimedCacheEntry(fileCache, cacheKey, { diffText });
  }
  const mode = url.searchParams.get("mode") || "full";
  const truncated = mode === "preview" ? truncateToNHunks(diffText, Number(url.searchParams.get("max_hunks")) || PREVIEW_HUNKS_DEFAULT, Number(url.searchParams.get("max_lines")) || PREVIEW_LINES_DEFAULT) : truncateToNHunks(diffText, 1e9);
  const body = {
    path,
    old_path: url.searchParams.get("old_path") || "",
    status: url.searchParams.get("status") || "",
    mode,
    diff: truncated.text,
    hunk_count: truncated.totalHunks,
    rendered_hunk_count: truncated.renderedHunks,
    line_count: truncated.lineCount,
    truncated: mode === "preview" && (truncated.totalHunks > truncated.renderedHunks || truncated.lineTruncated),
    binary: diffText.includes("Binary files"),
    error: errText,
    generation
  };
  return json(body);
}
function worktreeLineIndexSignature(full) {
  try {
    const stat = statSync2(full);
    return `size:${stat.size}|mtime:${stat.mtimeMs}|ctime:${stat.ctimeMs}|ino:${stat.ino || 0}`;
  } catch {
    return null;
  }
}
async function getWorktreeLineIndex(full) {
  const signature = worktreeLineIndexSignature(full);
  if (!signature)
    return null;
  const cached = lineIndexCache.get(full);
  if (cached?.signature === signature) {
    lineIndexCache.delete(full);
    lineIndexCache.set(full, cached);
    return cached.index;
  }
  const stat = statSync2(full);
  if (stat.size > LINE_INDEX_MAX_FILE_BYTES)
    return null;
  const index = await buildLineOffsetIndexFromStream(fileReadableStream(full), stat.size);
  lineIndexCache.delete(full);
  lineIndexCache.set(full, { signature, index });
  while (lineIndexCache.size > 32) {
    const oldest = lineIndexCache.keys().next().value;
    if (oldest === undefined)
      break;
    lineIndexCache.delete(oldest);
  }
  return index;
}
function cachedBlobLineRange(cacheKey, start, end) {
  const bytes = blobBytesCache.get(cacheKey);
  const index = blobLineIndexCache.get(cacheKey);
  if (!bytes || !index)
    return null;
  blobBytesCache.delete(cacheKey);
  blobBytesCache.set(cacheKey, bytes);
  blobLineIndexCache.delete(cacheKey);
  blobLineIndexCache.set(cacheKey, index);
  const range = lineByteRangeForIndex(index, start, end);
  const textValue = range ? new TextDecoder().decode(bytes.subarray(range.start, range.endExclusive)) : "";
  return collectLineRangeFromIndexedText(textValue, index, start, end);
}
function setBlobLineCache(cacheKey, bytes, index) {
  setBlobLineIndexCache(cacheKey, index);
  const existing = blobBytesCache.get(cacheKey);
  if (existing)
    blobLineCacheBytes -= existing.byteLength;
  blobBytesCache.delete(cacheKey);
  if (bytes.byteLength > BLOB_LINE_CACHE_MAX_BYTES)
    return;
  blobBytesCache.set(cacheKey, bytes);
  blobLineCacheBytes += bytes.byteLength;
  while (blobBytesCache.size > 16 || blobLineCacheBytes > BLOB_LINE_CACHE_MAX_BYTES) {
    const oldest = blobBytesCache.keys().next().value;
    if (oldest === undefined)
      break;
    const evicted = blobBytesCache.get(oldest);
    if (evicted)
      blobLineCacheBytes -= evicted.byteLength;
    blobBytesCache.delete(oldest);
  }
}
function setBlobLineIndexCache(cacheKey, index) {
  blobLineIndexCache.delete(cacheKey);
  blobLineIndexCache.set(cacheKey, index);
  while (blobLineIndexCache.size > 128) {
    const oldest = blobLineIndexCache.keys().next().value;
    if (oldest === undefined)
      break;
    blobLineIndexCache.delete(oldest);
  }
}
async function collectGitBlobLineRangeWithIndex(cacheKey, oid, index, start, end) {
  blobLineIndexCache.delete(cacheKey);
  blobLineIndexCache.set(cacheKey, index);
  const range = lineByteRangeForIndex(index, start, end);
  if (!range)
    return collectLineRangeFromIndexedText("", index, start, end);
  const shown = catFileBlobStream(oid, cwd);
  const bytes = await collectByteRangeFromStream(shown.stream, range.start, range.endExclusive);
  await shown.exited;
  if (bytes.byteLength !== range.endExclusive - range.start)
    return null;
  const textValue = new TextDecoder().decode(bytes);
  return collectLineRangeFromIndexedText(textValue, index, start, end);
}
async function readGitBlobBytesWithIndex(oid, sizeHint) {
  const shown = catFileBlobStream(oid, cwd);
  const result = await collectBytesWithLineOffsetIndexFromStream(shown.stream, sizeHint);
  const code = await shown.exited;
  if (code !== 0)
    return null;
  return result;
}
async function collectGitBlobLineRangeFromStream(oid, start, end) {
  const shown = catFileBlobStream(oid, cwd);
  const result = await collectLineRangeFromStream(shown.stream, start, end);
  const code = await shown.exited;
  if (code !== 0 && result.complete)
    return null;
  return result;
}
async function collectIndexedGitBlobLineRange(path, oid, size, start, end) {
  const cacheKey = `${oid}\x00${path}`;
  const cached = cachedBlobLineRange(cacheKey, start, end);
  if (cached)
    return cached;
  const cachedIndex = blobLineIndexCache.get(cacheKey);
  if (cachedIndex)
    return collectGitBlobLineRangeWithIndex(cacheKey, oid, cachedIndex, start, end);
  if (start < LINE_INDEX_MIN_START) {
    return collectGitBlobLineRangeFromStream(oid, start, end);
  }
  if (size > LINE_INDEX_MAX_FILE_BYTES)
    return collectGitBlobLineRangeFromStream(oid, start, end);
  const indexedBlob = await readGitBlobBytesWithIndex(oid, size);
  if (!indexedBlob)
    return null;
  setBlobLineCache(cacheKey, indexedBlob.bytes, indexedBlob.index);
  return cachedBlobLineRange(cacheKey, start, end) || collectGitBlobLineRangeWithIndex(cacheKey, oid, indexedBlob.index, start, end);
}
async function collectIndexedWorktreeLineRange(full, start, end) {
  if (start < LINE_INDEX_MIN_START && !lineIndexCache.has(full)) {
    return collectLineRangeFromStream(fileReadableStream(full), start, end);
  }
  const index = await getWorktreeLineIndex(full);
  if (!index)
    return collectLineRangeFromStream(fileReadableStream(full), start, end);
  const range = lineByteRangeForIndex(index, start, end);
  const textValue = range ? await readFileTextRange(full, range.start, range.endExclusive) : "";
  return collectLineRangeFromIndexedText(textValue, index, start, end);
}
async function handleFileRange(url) {
  const path = url.searchParams.get("path") || "";
  if (!safePath(path))
    return text("invalid path", 400);
  let start = Number(url.searchParams.get("start") || "1") || 1;
  let end = Number(url.searchParams.get("end") || url.searchParams.get("endline") || "0") || 0;
  if (start < 1)
    start = 1;
  if (end < start)
    end = start;
  const ref = url.searchParams.get("ref") || "worktree";
  if (ref === "worktree" || ref === "") {
    const full = safeWorktreePath(path);
    if (!full)
      return text("no file", 404);
    const result = await collectIndexedWorktreeLineRange(full, start, end);
    const body = {
      path,
      ref,
      start,
      end,
      lines: result.lines,
      total: result.total,
      complete: result.complete,
      generation
    };
    return json(body);
  } else {
    if (!verifyTreeRef(ref, cwd))
      return text("invalid ref", 400);
    const oid = objectId(ref, path, cwd);
    if (oid.code !== 0 || !oid.oid)
      return text("not in ref", 404);
    const size = objectByteSize(oid.oid, cwd);
    if (size.code !== 0)
      return text("cannot read ref", 500);
    const result = await collectIndexedGitBlobLineRange(path, oid.oid, size.size, start, end);
    if (!result)
      return text("cannot read ref", 500);
    const body = {
      path,
      ref,
      start,
      end,
      lines: result.lines,
      total: result.total,
      complete: result.complete,
      generation
    };
    return json(body);
  }
}
function handleRawFile(req, url) {
  const path = url.searchParams.get("path") || "";
  if (!safePath(path))
    return text("forbidden", 403);
  const ref = url.searchParams.get("ref") || "worktree";
  let body;
  if (ref !== "worktree" && ref !== "") {
    if (!verifyTreeRef(ref, cwd))
      return text("invalid ref", 400);
    const size = rawFileSize(path, ref);
    if (size == null)
      return text("not in ref", 404);
    const metadata = gitFileMetadata(ref, path, size);
    if (req.method === "HEAD")
      return new Response(null, {
        headers: rawFileHeaders(path, size, undefined, metadata)
      });
    const res = showBytes(ref, path, cwd);
    if (res.code !== 0)
      return text("not in ref", 404);
    body = res.stdout.buffer.slice(res.stdout.byteOffset, res.stdout.byteOffset + res.stdout.byteLength);
    return new Response(body, {
      headers: rawFileHeaders(path, size, undefined, metadata)
    });
  } else {
    const full = safeWorktreePath(path);
    if (!full)
      return text("not found", 404);
    const size = rawFileSize(path, ref);
    if (size == null)
      return text("not found", 404);
    const metadata = worktreeFileMetadata(path, size);
    const rangeResult = req.headers.get("range") ? parseHttpByteRange(req.headers.get("range"), size) : null;
    if (rangeResult?.kind === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: {
          ...rawFileHeaders(path, size, undefined, metadata),
          "Content-Range": `bytes */${size}`,
          "Content-Length": "0"
        }
      });
    }
    if (rangeResult?.kind === "range") {
      const range = rangeResult.range;
      if (req.method === "HEAD") {
        return new Response(null, {
          status: 206,
          headers: rawFileHeaders(path, size, range, metadata)
        });
      }
      return new Response(fileByteRangeResponseBody(full, range.start, range.end), {
        status: 206,
        headers: rawFileHeaders(path, size, range, metadata)
      });
    }
    if (req.method === "HEAD")
      return new Response(null, {
        headers: rawFileHeaders(path, size, undefined, metadata)
      });
    return new Response(fileReadableStream(full), {
      headers: rawFileHeaders(path, size, undefined, metadata)
    });
  }
}
function rawFileSize(path, ref) {
  if (ref !== "worktree" && ref !== "") {
    if (!verifyTreeRef(ref, cwd))
      return null;
    const res = objectSize(ref, path, cwd);
    return res.code === 0 ? res.size : null;
  }
  const full = safeWorktreePath(path);
  if (!full)
    return null;
  try {
    return statSync2(full).size;
  } catch {
    return null;
  }
}
function rawFileHeaders(path, size = null, range, metadata = {}) {
  const mime = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".pdf": "application/pdf",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".opus": "audio/ogg"
  };
  const headers = {
    "Content-Type": mime[extname(path).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Accept-Ranges": "bytes"
  };
  if (range && size != null) {
    headers["Content-Length"] = String(range.end - range.start + 1);
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  } else if (size != null) {
    headers["Content-Length"] = String(size);
  }
  for (const [key, value] of Object.entries(fileMetadataHeaders(metadata))) {
    headers[key] = value;
  }
  return headers;
}
function isForbiddenUploadName(name) {
  const lower = name.toLowerCase();
  return lower.startsWith(".") || lower === "package.json" || lower === "package-lock.json" || lower === "bun.lock" || lower === "bun.lockb" || lower === "yarn.lock" || lower === "pnpm-lock.yaml" || lower === "makefile" || lower === "dockerfile" || lower.endsWith(".dockerfile") || /^(tsconfig|jsconfig|bunfig|vercel|netlify|wrangler|next|vite|webpack|rollup|esbuild|astro|svelte|tailwind|postcss|babel|prettier|eslint)\./.test(lower) || lower.endsWith(".config.js") || lower.endsWith(".config.jsx") || lower.endsWith(".config.ts") || lower.endsWith(".config.tsx") || lower.endsWith(".config.mjs") || lower.endsWith(".config.cjs") || lower.includes("credential") || lower.includes("secret") || lower.endsWith(".exe") || lower.endsWith(".dll") || lower.endsWith(".dylib") || lower.endsWith(".so") || lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh") || lower.endsWith(".fish") || lower.endsWith(".ps1") || lower.endsWith(".bat") || lower.endsWith(".cmd");
}
function safeUploadFileName(name) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 180 || trimmed.includes("\x00") || trimmed.includes("/") || trimmed.includes("\\") || Array.from(trimmed).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  }))
    return null;
  if (trimmed === "." || trimmed === "..")
    return null;
  if (isGitInternalPath(trimmed) || isForbiddenUploadName(trimmed))
    return null;
  if (!SAFE_UPLOAD_EXTENSIONS.has(extname(trimmed).toLowerCase()))
    return null;
  return trimmed;
}
function uploadOpenFlags() {
  return constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0);
}
async function handleUploadFiles(req) {
  if (uploadDisabledByConfig)
    return text("upload disabled by project config", 403);
  if (req.method !== "POST")
    return text("method not allowed", 405);
  if (!sideEffectRequestAllowed(req))
    return text("forbidden", 403);
  if (req.headers.get("content-encoding"))
    return text("unsupported media type", 415);
  const lengthHeader = req.headers.get("content-length");
  if (!lengthHeader)
    return text("content length required", 411);
  const length = Number(lengthHeader);
  if (!Number.isSafeInteger(length) || length < 0)
    return text("invalid content length", 400);
  if (length > MAX_UPLOAD_BODY_BYTES)
    return text("upload too large", 413);
  const contentType = req.headers.get("content-type") || "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType))
    return text("unsupported media type", 415);
  let form;
  try {
    form = await req.formData();
  } catch {
    return text("invalid form data", 400);
  }
  const dir = String(form.get("dir") || "").replace(/^\/+|\/+$/g, "");
  if (!safeRepoPath(dir))
    return text("invalid dir", 400);
  if (dir && isGitInternalPath(dir))
    return text("forbidden", 403);
  const realDir = safeOpenWorktreePath(dir);
  if (!realDir)
    return text("not found", 404);
  const stats = statSync2(realDir);
  if (!stats.isDirectory())
    return text("not a directory", 400);
  const files = form.getAll("files").filter((item) => item instanceof File);
  if (!files.length)
    return text("no files", 400);
  if (files.length > MAX_UPLOAD_FILES)
    return text("too many files", 413);
  let total = 0;
  const names = new Set;
  const uploads = [];
  for (const file of files) {
    const safeName = safeUploadFileName(file.name);
    if (!safeName)
      return text("invalid filename", 400);
    const lowerName = safeName.toLowerCase();
    if (names.has(lowerName))
      return text("duplicate filename", 409);
    names.add(lowerName);
    if (file.size > MAX_UPLOAD_FILE_BYTES)
      return text("file too large", 413);
    total += file.size;
    if (total > MAX_UPLOAD_TOTAL_BYTES)
      return text("upload too large", 413);
    const target = join8(realDir, safeName);
    if (relative2(realDir, dirname2(target)) !== "")
      return text("invalid filename", 400);
    if (existsSync6(target))
      return text("file exists", 409);
    uploads.push({ file, name: safeName, target });
  }
  const written = [];
  try {
    for (const upload of uploads) {
      const fd = openSync(upload.target, uploadOpenFlags(), 420);
      try {
        writeFileSync3(fd, new Uint8Array(await upload.file.arrayBuffer()));
      } finally {
        closeSync(fd);
      }
      written.push(upload.target);
    }
  } catch (error) {
    for (const path of written) {
      try {
        unlinkSync2(path);
      } catch {}
    }
    if (error.code === "EEXIST")
      return text("file exists", 409);
    return text("upload failed", 500);
  }
  triggerUpdate();
  return json({
    ok: true,
    files: uploads.map((upload) => upload.name),
    generation
  });
}
function openOsPath(path) {
  const cmd = process.platform === "darwin" ? ["open", "--", path] : process.platform === "win32" ? ["explorer.exe", path] : ["xdg-open", path];
  spawnDetached(cmd);
}
function windowsTrashScript(path) {
  const quotedPath = path.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop';",
    `$path = '${quotedPath}';`,
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class CodeViewerRecycleBin {",
    "  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
    "  public struct SHFILEOPSTRUCT {",
    "    public IntPtr hwnd;",
    "    public uint wFunc;",
    "    public string pFrom;",
    "    public string pTo;",
    "    public ushort fFlags;",
    "    [MarshalAs(UnmanagedType.Bool)] public bool fAnyOperationsAborted;",
    "    public IntPtr hNameMappings;",
    "    public string lpszProgressTitle;",
    "  }",
    '  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]',
    "  private static extern int SHFileOperationW(ref SHFILEOPSTRUCT lpFileOp);",
    "  public static void MoveToRecycleBin(string path) {",
    "    const uint FO_DELETE = 0x0003;",
    "    const ushort FOF_SILENT = 0x0004;",
    "    const ushort FOF_NOCONFIRMATION = 0x0010;",
    "    const ushort FOF_ALLOWUNDO = 0x0040;",
    "    const ushort FOF_NOERRORUI = 0x0400;",
    "    var op = new SHFILEOPSTRUCT {",
    "      hwnd = IntPtr.Zero,",
    "      wFunc = FO_DELETE,",
    '      pFrom = path + "\\0\\0",',
    "      pTo = null,",
    "      fFlags = (ushort)(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT),",
    "      fAnyOperationsAborted = false,",
    "      hNameMappings = IntPtr.Zero,",
    "      lpszProgressTitle = null",
    "    };",
    "    int result = SHFileOperationW(ref op);",
    '    if (result != 0) throw new InvalidOperationException("SHFileOperationW failed: " + result);',
    '    if (op.fAnyOperationsAborted) throw new OperationCanceledException("SHFileOperationW aborted");',
    "  }",
    "}",
    "'@;",
    "[CodeViewerRecycleBin]::MoveToRecycleBin($path);"
  ].join(" ");
}
function windowsRestoreTrashScript(originalPath) {
  const quotedPath = originalPath.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop';",
    `$original = '${quotedPath}';`,
    "$parent = [System.IO.Path]::GetDirectoryName($original);",
    "$name = [System.IO.Path]::GetFileName($original);",
    "$shell = New-Object -ComObject Shell.Application;",
    "$bin = $shell.Namespace(10);",
    "$restored = $false;",
    "foreach ($item in $bin.Items()) {",
    "  $deletedFrom = $item.ExtendedProperty('System.Recycle.DeletedFrom');",
    "  if ($item.Name -eq $name -and $deletedFrom -eq $parent) {",
    "    $item.InvokeVerb('ESTORE');",
    "    $restored = $true;",
    "    break;",
    "  }",
    "}",
    "if (-not $restored) { throw 'recycle bin item not found'; }"
  ].join(" ");
}
function makeUndoId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function clearMutableCaches() {
  fileCache.clear();
  metaCache.clear();
  fileListCache.clear();
}
function triggerUpdate() {
  generation++;
  clearMutableCaches();
  sendSse("update");
}
function moveMacPathIntoTrash(path) {
  const trashDir = join8(homedir3(), ".Trash");
  const base = basename2(path) || "code-viewer-trash-item";
  const target = join8(trashDir, `${base}-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    mkdirSync4(trashDir, { recursive: true });
    renameSync2(path, target);
    return { ok: true, trashPath: target };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
function movePathToTrash(path) {
  lstatSync4(path);
  if (process.platform === "darwin") {
    return moveMacPathIntoTrash(path);
  }
  if (process.platform === "win32") {
    const res = runSync([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      windowsTrashScript(path)
    ], cwd, { timeout: 60000 });
    return res.code === 0 ? { ok: true } : { ok: false, error: res.stderr || res.stdout };
  }
  return { ok: false, error: "trash unsupported" };
}
function restoreTrashPath(originalPath, trashPath) {
  const parent = parentRepoPath(originalPath);
  const parentFullPath = safeOpenWorktreePath(parent);
  if (!parentFullPath)
    return { ok: false, error: "invalid restore target" };
  const original = worktreePath(originalPath);
  if (existsSync6(original))
    return { ok: false, error: "restore target exists" };
  if (trashPath) {
    if (process.platform !== "darwin")
      return { ok: false, error: "invalid trash handle" };
    if (!existsSync6(trashPath))
      return { ok: false, error: "trash item not found" };
    try {
      const trashRoot = join8(homedir3(), ".Trash");
      const trashRelative = relative2(trashRoot, trashPath);
      if (trashRelative === "" || trashRelative.startsWith("..") || trashRelative.startsWith("/") || trashRelative.startsWith("\\"))
        return { ok: false, error: "invalid trash handle" };
      mkdirSync4(dirname2(original), { recursive: true });
      renameSync2(trashPath, original);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
  if (process.platform === "win32") {
    const res = runSync([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      windowsRestoreTrashScript(original)
    ], cwd, { timeout: 60000 });
    return res.code === 0 ? { ok: true } : { ok: false, error: res.stderr || res.stdout };
  }
  return { ok: false, error: "undo unavailable for this trash operation" };
}
async function handleOpenPath(req) {
  if (req.method !== "POST")
    return text("method not allowed", 405);
  if (!sideEffectRequestAllowed(req))
    return text("forbidden", 403);
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:;|$)/i.test(contentType))
    return text("unsupported media type", 415);
  const length = Number(req.headers.get("content-length") || "0");
  if (length > 1024)
    return text("payload too large", 413);
  let body = {};
  try {
    const raw = await req.text();
    if (raw.length > 1024)
      return text("payload too large", 413);
    body = JSON.parse(raw);
  } catch {
    return text("invalid json", 400);
  }
  const path = typeof body.path === "string" ? body.path.replace(/^\/+|\/+$/g, "") : "";
  const kind = body.kind;
  if (kind !== "directory" && kind !== "file-parent")
    return text("invalid kind", 400);
  if (kind === "file-parent" && !path)
    return text("invalid path", 400);
  if (!safeRepoPath(path))
    return text("invalid path", 400);
  if (path && isGitInternalPath(path))
    return text("forbidden", 403);
  const targetPath = kind === "file-parent" ? parentRepoPath(path) : path;
  const target = safeOpenWorktreePath(targetPath);
  if (!target)
    return text("not found", 404);
  const stats = statSync2(target);
  if (!stats.isDirectory())
    return text("not a directory", 400);
  openOsPath(target);
  return json({ ok: true });
}
async function handleTrashPath(req) {
  if (req.method !== "POST")
    return text("method not allowed", 405);
  if (!sideEffectRequestAllowed(req))
    return text("forbidden", 403);
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:;|$)/i.test(contentType))
    return text("unsupported media type", 415);
  const length = Number(req.headers.get("content-length") || "0");
  if (length > 1024)
    return text("payload too large", 413);
  let body = {};
  try {
    const raw = await req.text();
    if (raw.length > 1024)
      return text("payload too large", 413);
    body = JSON.parse(raw);
  } catch {
    return text("invalid json", 400);
  }
  const path = typeof body.path === "string" ? body.path.replace(/^\/+|\/+$/g, "") : "";
  if (!path)
    return text("invalid path", 400);
  if (!safeRepoPath(path))
    return text("invalid path", 400);
  if (isGitInternalPath(path))
    return text("forbidden", 403);
  const originalFullPath = safeWorktreePath(path);
  if (!originalFullPath)
    return text("not found", 404);
  const moved = movePathToTrash(worktreePath(path));
  if (!moved.ok)
    return text(moved.error || "trash failed", 500);
  const undo = {
    id: makeUndoId(),
    type: "trash",
    label: `Restore ${path}`,
    payload: {
      original_path: path,
      trashPath: moved.trashPath
    }
  };
  triggerUpdate();
  return json({ ok: true, generation, undo });
}
async function handleCreateDirectory(req) {
  if (req.method !== "POST")
    return text("method not allowed", 405);
  if (!sideEffectRequestAllowed(req))
    return text("forbidden", 403);
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:;|$)/i.test(contentType))
    return text("unsupported media type", 415);
  const lengthHeader = req.headers.get("content-length");
  const length = Number(lengthHeader || "0");
  if (lengthHeader && (!Number.isFinite(length) || length < 0))
    return text("invalid content length", 400);
  if (length > 2048)
    return text("payload too large", 413);
  let body = {};
  try {
    const raw = await req.text();
    if (raw.length > 2048)
      return text("payload too large", 413);
    body = JSON.parse(raw);
  } catch {
    return text("invalid json", 400);
  }
  const dir = typeof body.dir === "string" ? body.dir.trim().replace(/^\/+|\/+$/g, "") : "";
  const name = normalizeNewDirectoryName(body.name);
  if (!safeRepoPath(dir))
    return text("invalid dir", 400);
  if (dir && isGitInternalPath(dir))
    return text("forbidden", 403);
  if (!name)
    return text("invalid name", 400);
  const parent = safeOpenWorktreePath(dir);
  if (!parent)
    return text("not found", 404);
  const stats = statSync2(parent);
  if (!stats.isDirectory())
    return text("not a directory", 400);
  const targetPath = dir ? `${dir}/${name}` : name;
  if (!safeRepoPath(targetPath) || isGitInternalPath(targetPath))
    return text("invalid target", 400);
  const target = join8(parent, name);
  if (existsSync6(target))
    return text("already exists", 409);
  try {
    mkdirSync4(target, { recursive: false });
  } catch (error) {
    if (error.code === "EEXIST")
      return text("already exists", 409);
    return text("create failed", 500);
  }
  triggerUpdate();
  return json({ ok: true, path: targetPath, generation });
}
async function handleRestoreTrash(req) {
  if (req.method !== "POST")
    return text("method not allowed", 405);
  if (!sideEffectRequestAllowed(req))
    return text("forbidden", 403);
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:;|$)/i.test(contentType))
    return text("unsupported media type", 415);
  const length = Number(req.headers.get("content-length") || "0");
  if (length > 1024)
    return text("payload too large", 413);
  let body = {};
  try {
    const raw = await req.text();
    if (raw.length > 1024)
      return text("payload too large", 413);
    body = JSON.parse(raw);
  } catch {
    return text("invalid json", 400);
  }
  const originalPath = typeof body.original_path === "string" ? body.original_path.replace(/^\/+|\/+$/g, "") : "";
  const trashPath = typeof body.trashPath === "string" ? body.trashPath : "";
  if (!originalPath || !safeRepoPath(originalPath))
    return text("invalid restore target", 400);
  if (isGitInternalPath(originalPath))
    return text("forbidden", 403);
  const restored = restoreTrashPath(originalPath, trashPath || undefined);
  if (!restored.ok)
    return text(restored.error || "undo failed", 409);
  triggerUpdate();
  return json({ ok: true, generation });
}
function annotationSse(kind, sessionId, entryId) {
  sendSse("annotation", JSON.stringify({ kind, session_id: sessionId, entry_id: entryId }));
}
async function handleAnnotations(req) {
  if (req.method === "GET")
    return json(loadAnnotationsState(cwd));
  if (req.method !== "POST")
    return text("method not allowed", 405);
  if (!sideEffectRequestAllowed(req))
    return text("forbidden", 403);
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:;|$)/i.test(contentType))
    return text("unsupported media type", 415);
  const maxBytes = ANNOTATION_BODY_MAX_BYTES + 4096;
  const length = Number(req.headers.get("content-length") || "0");
  if (length > maxBytes)
    return text("payload too large", 413);
  let body = {};
  try {
    const raw = await req.text();
    if (raw.length > maxBytes)
      return text("payload too large", 413);
    body = JSON.parse(raw);
  } catch {
    return text("invalid json", 400);
  }
  const action = body.action;
  if (action === "start") {
    const title = typeof body.title === "string" ? body.title : "";
    const started = startAnnotationSession(loadAnnotationsState(cwd), title, new Date().toISOString());
    saveAnnotationsState(cwd, started.state);
    annotationSse("start", started.session.id);
    return json({ ok: true, session: started.session });
  }
  if (action === "add") {
    const path = typeof body.path === "string" ? body.path.replace(/^\/+|\/+$/g, "") : "";
    if (!path || !safeRepoPath(path))
      return text("invalid path", 400);
    if (isGitInternalPath(path) || isCodeViewerInternalPath(path))
      return text("forbidden", 403);
    const result = addAnnotationEntry(loadAnnotationsState(cwd), {
      session_id: typeof body.session_id === "string" ? body.session_id : undefined,
      session_title: typeof body.session_title === "string" ? body.session_title : undefined,
      path,
      line: body.line && typeof body.line === "object" ? body.line : undefined,
      range: body.range && typeof body.range === "object" ? body.range : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      body: typeof body.body === "string" ? body.body : ""
    }, new Date().toISOString());
    if (result.ok === false)
      return text(result.error, 400);
    saveAnnotationsState(cwd, result.state);
    annotationSse("add", result.session.id, result.entry.id);
    return json({
      ok: true,
      session_id: result.session.id,
      session_title: result.session.title,
      created_session: result.created_session,
      entry: result.entry
    });
  }
  if (action === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id)
      return text("invalid id", 400);
    const result = deleteAnnotationById(loadAnnotationsState(cwd), id);
    if (result.removed) {
      saveAnnotationsState(cwd, result.state);
      annotationSse("delete");
    }
    return json({ ok: true, removed: result.removed });
  }
  if (action === "rename") {
    const id = typeof body.id === "string" ? body.id : "";
    const title = typeof body.title === "string" ? body.title : "";
    if (!id)
      return text("invalid id", 400);
    const result = renameAnnotationSession(loadAnnotationsState(cwd), id, title);
    if (!result.renamed)
      return text("session not found", 404);
    saveAnnotationsState(cwd, result.state);
    annotationSse("update", id);
    return json({ ok: true });
  }
  if (action === "update") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id)
      return text("invalid id", 400);
    const result = updateAnnotationEntry(loadAnnotationsState(cwd), id, {
      title: typeof body.title === "string" ? body.title : undefined,
      body: typeof body.body === "string" ? body.body : undefined
    });
    if (result.ok === false)
      return text(result.error, 400);
    saveAnnotationsState(cwd, result.state);
    annotationSse("update", undefined, id);
    return json({ ok: true, entry: result.entry });
  }
  if (action === "clear") {
    saveAnnotationsState(cwd, emptyAnnotationsState());
    annotationSse("clear");
    return json({ ok: true });
  }
  return text("invalid action", 400);
}
function isCodeViewerInternalPath(path) {
  return path.split(/[\\/]+/).some((part) => part.toLowerCase() === ".code-viewer");
}
function sendSse(event, data = "tick") {
  const payload = enc.encode(`event: ${event}
data: ${data}

`);
  for (const client of [...sseClients]) {
    try {
      client.enqueue(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}
function openBrowser(url) {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd.exe", "/c", "start", "", url] : ["xdg-open", url];
  spawnDetached(cmd);
}
var WEB_ROOT, VERSION, DEFAULT_ARGS, PREVIEW_HUNKS_DEFAULT = 3, PREVIEW_LINES_DEFAULT = 1200, WATCHED_ASSET_FILES, SIZE_SMALL = 2000, SIZE_MEDIUM = 8000, SIZE_LARGE = 20000, LINE_INDEX_MIN_START = 1e4, LINE_INDEX_MAX_FILE_BYTES, BLOB_LINE_CACHE_MAX_BYTES, MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_TOTAL_BYTES, MAX_UPLOAD_BODY_BYTES, MAX_UPLOAD_FILES = 50, SAFE_UPLOAD_EXTENSIONS, generation = 1, cwd, cliArgs, listenPort = 0, openAfterStart = false, scopeOmitDirNames, scopeOmitDirCliOverride = null, scopeExcludeNames, uploadDisabledByConfig = false, rgAvailableCache = null, enc, sseClients, fileCache, metaCache, fileListCache, lineIndexCache, blobLineIndexCache, blobBytesCache, blobLineCacheBytes = 0, server;
var init_preview = __esm(async () => {
  init_routes();
  init_annotations();
  init_cache();
  init_dev_assets();
  init_git();
  init_root();
  init_runtime();
  init_search();
  init_server_registry();
  init_worktree_watcher();
  WEB_ROOT = join8(ROOT, "web");
  VERSION = JSON.parse(readFileSync5(join8(ROOT, "package.json"), "utf8")).version;
  DEFAULT_ARGS = ["HEAD"];
  WATCHED_ASSET_FILES = ["index.html", "style.css", "app.js"];
  LINE_INDEX_MAX_FILE_BYTES = 256 * 1024 * 1024;
  BLOB_LINE_CACHE_MAX_BYTES = 128 * 1024 * 1024;
  MAX_UPLOAD_FILE_BYTES = 512 * 1024 * 1024;
  MAX_UPLOAD_TOTAL_BYTES = 1024 * 1024 * 1024;
  MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_TOTAL_BYTES + 1024 * 1024;
  SAFE_UPLOAD_EXTENSIONS = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".csv",
    ".tsv",
    ".yaml",
    ".yml",
    ".toml",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".pdf",
    ".mp4",
    ".mov",
    ".m4v",
    ".webm",
    ".mp3",
    ".wav",
    ".m4a",
    ".aac",
    ".flac",
    ".ogg",
    ".zip",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".css",
    ".scss",
    ".html"
  ]);
  cwd = repoRoot(process.cwd()) || process.cwd();
  cliArgs = DEFAULT_ARGS;
  scopeOmitDirNames = DEFAULT_WORKTREE_OMIT_DIR_NAMES;
  scopeExcludeNames = DEFAULT_EXCLUDE_NAMES;
  enc = new TextEncoder;
  sseClients = new Set;
  fileCache = new Map;
  metaCache = new Map;
  fileListCache = new Map;
  lineIndexCache = new Map;
  blobLineIndexCache = new Map;
  blobBytesCache = new Map;
  parseCli();
  server = await startServer({
    hostname: "127.0.0.1",
    port: listenPort,
    async fetch(req) {
      if (!requestAllowed(req))
        return text("forbidden", 403);
      const url = new URL(req.url);
      const staticResponse = staticFile(url.pathname);
      if (staticResponse)
        return staticResponse;
      if (url.pathname === "/diff.json")
        return handleDiffJson(url);
      if (url.pathname === "/_settings")
        return handleSettings();
      if (url.pathname === "/_tree")
        return handleTree(url);
      if (url.pathname === "/_files")
        return handleFiles(url);
      if (url.pathname === "/_grep")
        return handleGrep(url);
      if (url.pathname === "/_commits")
        return handleRefCommits(url);
      if (url.pathname === "/_log")
        return handleLog(url);
      if (url.pathname === "/file_diff")
        return handleFileDiff(url);
      if (url.pathname === "/file_range")
        return handleFileRange(url);
      if (url.pathname === "/_file")
        return handleRawFile(req, url);
      if (url.pathname === "/_open_path")
        return handleOpenPath(req);
      if (url.pathname === "/_trash_path")
        return handleTrashPath(req);
      if (url.pathname === "/_restore_trash")
        return handleRestoreTrash(req);
      if (url.pathname === "/_create_directory")
        return handleCreateDirectory(req);
      if (url.pathname === "/_upload_files")
        return handleUploadFiles(req);
      if (url.pathname === "/_annotations")
        return handleAnnotations(req);
      if (url.pathname === "/_refs")
        return json(refs(cwd));
      if (url.pathname === "/refresh" && req.method === "POST") {
        if (!sideEffectRequestAllowed(req))
          return text("forbidden", 403);
        triggerUpdate();
        return json({ ok: true, generation });
      }
      if (url.pathname === "/events") {
        let ctrl;
        let keepalive;
        return new Response(new ReadableStream({
          start(controller) {
            ctrl = controller;
            sseClients.add(controller);
            controller.enqueue(enc.encode(`event: open
data: ok

`));
            keepalive = setInterval(() => {
              try {
                controller.enqueue(enc.encode(`: ping

`));
              } catch {
                sseClients.delete(controller);
                clearInterval(keepalive);
              }
            }, 15000);
          },
          cancel() {
            if (ctrl)
              sseClients.delete(ctrl);
            if (keepalive)
              clearInterval(keepalive);
          }
        }), {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache"
          }
        });
      }
      return text("not found", 404);
    }
  });
  if (openAfterStart) {
    openBrowser(`http://127.0.0.1:${server.port}/`);
  }
  writeServerRegistry({
    url: `http://127.0.0.1:${server.port}/`,
    pid: process.pid,
    root: cwd,
    started_at: new Date().toISOString()
  });
  process.on("exit", () => removeServerRegistry(cwd, process.pid));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      removeServerRegistry(cwd, process.pid);
      process.exit(0);
    });
  }
  if (process.env.CODE_VIEWER_DEV === "1") {
    const parentPid = process.ppid;
    setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        console.log("dev wrapper exited; shutting down preview server");
        removeServerRegistry(cwd, process.pid);
        process.exit(0);
      }
    }, 1000).unref();
  }
  startDevAssetReload({
    enabled: process.env.CODE_VIEWER_DEV === "1",
    webRoot: WEB_ROOT,
    watchedFiles: WATCHED_ASSET_FILES,
    watch,
    sendReload: () => sendSse("reload")
  });
  startWorktreeUpdateWatch({
    root: cwd,
    omitDirNames: scopeOmitDirNames,
    excludeNames: scopeExcludeNames,
    watch,
    initialScanMode: "async",
    onUpdate: triggerUpdate,
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`code-viewer worktree watch skipped: ${message}`);
    }
  });
  console.log(`GDP_LISTEN_URL=http://127.0.0.1:${server.port}/`);
  console.log(`git-diff-preview serving ${cwd}`);
});

// web-src/server/cli.ts
if (process.argv[2] === "annotate") {
  const { runAnnotateCli: runAnnotateCli2 } = await Promise.resolve().then(() => (init_annotate_cli(), exports_annotate_cli));
  await runAnnotateCli2(process.argv.slice(3));
} else if (process.argv[2] === "skill") {
  const { runSkillCli: runSkillCli2 } = await Promise.resolve().then(() => (init_skill_cli(), exports_skill_cli));
  runSkillCli2(process.argv.slice(3));
} else {
  await init_preview().then(() => exports_preview);
}
