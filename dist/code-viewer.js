#!/usr/bin/env node
import { createRequire } from "node:module";
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
var __require = /* @__PURE__ */ createRequire(import.meta.url);

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

// web-src/server/query-cli.ts
var exports_query_cli = {};
__export(exports_query_cli, {
  runQueryCli: () => runQueryCli,
  parseQueryArgs: () => parseQueryArgs,
  QUERY_HELP: () => QUERY_HELP,
  QUERY_AGENT_HELP: () => QUERY_AGENT_HELP
});
import { realpathSync as realpathSync2 } from "node:fs";
function takeValue2(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined)
    return { error: `${flag} requires a value` };
  return { value, next: index + 1 };
}
function parseQueryArgs(argv) {
  const rest = [];
  let cwd;
  let server;
  const options = new Map;
  const flags = new Set;
  const valueFlags = new Set([
    "--db",
    "--sql",
    "--title",
    "--body",
    "--max-rows"
  ]);
  for (let i = 0;i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h")
      return { ok: true, args: { command: { kind: "help" } } };
    if (arg === "--cwd" || arg === "--server") {
      const taken = takeValue2(argv, i, arg);
      if ("error" in taken)
        return { ok: false, error: taken.error };
      if (arg === "--cwd")
        cwd = taken.value;
      else
        server = taken.value;
      i = taken.next;
    } else if (valueFlags.has(arg)) {
      const taken = takeValue2(argv, i, arg);
      if ("error" in taken)
        return { ok: false, error: taken.error };
      options.set(arg, taken.value);
      i = taken.next;
    } else if (arg === "--json" || arg === "--no-save") {
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
  if (subcommand === "exec") {
    const db = options.get("--db");
    if (!db)
      return { ok: false, error: "exec requires --db <path>" };
    const sql = options.get("--sql");
    if (!sql)
      return { ok: false, error: "exec requires --sql <sql>" };
    const maxRowsRaw = options.get("--max-rows");
    const maxRows = maxRowsRaw ? Number(maxRowsRaw) || undefined : undefined;
    return {
      ok: true,
      args: {
        command: {
          kind: "exec",
          db,
          sql,
          title: options.get("--title"),
          body: options.get("--body"),
          save: !flags.has("--no-save"),
          maxRows
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
        command: {
          kind: "list",
          json: flags.has("--json"),
          db: options.get("--db")
        },
        cwd,
        server
      }
    };
  }
  if (subcommand === "clear") {
    return {
      ok: true,
      args: {
        command: { kind: "clear", db: options.get("--db") },
        cwd,
        server
      }
    };
  }
  return { ok: false, error: `unknown query command: ${subcommand}` };
}
function resolveRepoRoot2(cwdOption) {
  const base = cwdOption || process.cwd();
  try {
    return repoRoot(base) || realpathSync2(base);
  } catch {
    console.error(`--cwd must point to an existing directory: ${base}`);
    process.exit(1);
  }
}
async function serverReachable2(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/_db/files`, {
      signal: AbortSignal.timeout(1500)
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function ensureServerUrl2(root, override) {
  if (override) {
    const url = override.replace(/\/+$/, "");
    if (await serverReachable2(url))
      return url;
    console.error(`could not reach the code-viewer server at ${url}.`);
    process.exit(1);
  }
  const registered = readServerRegistry(root);
  if (registered) {
    const url = registered.url.replace(/\/+$/, "");
    if (await serverReachable2(url))
      return url;
  }
  console.error(`no running code-viewer server for this repository.
` + `Start one manually (from ${root}):
` + "  code-viewer");
  process.exit(1);
}
async function request2(serverUrl, path, method, body) {
  const url = `${serverUrl}${path}`;
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
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}
async function runQueryCli(argv) {
  const parsed = parseQueryArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error('Run "code-viewer query --help" for usage.');
    process.exit(1);
  }
  const { command, cwd, server } = parsed.args;
  if (command.kind === "help") {
    console.log(QUERY_HELP);
    return;
  }
  if (command.kind === "agent-help") {
    console.log(QUERY_AGENT_HELP);
    return;
  }
  const root = resolveRepoRoot2(cwd);
  const serverUrl = await ensureServerUrl2(root, server);
  if (command.kind === "exec") {
    const reqBody = {
      db: command.db,
      sql: command.sql,
      saveHistory: command.save,
      executedBy: "ai",
      source: "cli"
    };
    if (command.title)
      reqBody.title = command.title;
    if (command.body)
      reqBody.body = command.body;
    if (command.maxRows)
      reqBody.maxRows = command.maxRows;
    const result = await request2(serverUrl, "/_db/query", "POST", reqBody);
    const data = result.data;
    if (!result.ok || data.error) {
      console.error(`query error: ${typeof data.error === "string" ? data.error : JSON.stringify(data)}`);
      process.exit(1);
    }
    console.log(JSON.stringify({
      columns: data.columns,
      rows: data.rows,
      rowCount: data.rowCount,
      elapsedMs: data.elapsedMs
    }, null, 2));
    return;
  }
  if (command.kind === "list") {
    const params = command.db ? `?db=${encodeURIComponent(command.db)}` : "";
    const result = await request2(serverUrl, `/_db/history${params}`, "GET");
    if (!result.ok) {
      console.error("failed to fetch query history");
      process.exit(1);
    }
    const state = result.data;
    if (command.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      if (!state.entries.length) {
        console.log("no query history");
        return;
      }
      for (const entry of state.entries) {
        const by = entry.executedBy === "ai" ? "[AI]" : "";
        const title = entry.title ? ` ${entry.title}` : "";
        const sql = typeof entry.sql === "string" ? entry.sql.length > 80 ? `${entry.sql.slice(0, 80)}...` : entry.sql : "";
        console.log(`${entry.executedAt}  ${by}${title}  ${entry.rowCount} rows (${entry.elapsedMs}ms)`);
        console.log(`  ${sql}`);
      }
    }
    return;
  }
  if (command.kind === "clear") {
    const reqBody = {};
    if (command.db)
      reqBody.db = command.db;
    await request2(serverUrl, "/_db/history/clear", "POST", reqBody);
    console.log("cleared query history");
    return;
  }
}
var QUERY_HELP = `code-viewer query — execute read-only SQL queries against local databases

Usage:
  code-viewer query exec --db <path> --sql <sql> [--title <text>] [--body <markdown>] [--no-save] [--max-rows <n>]
  code-viewer query list [--json] [--db <path>]
  code-viewer query clear [--db <path>]
  code-viewer query search --db <path> --term <text> [--tables t1,t2,...] [--include-non-text] [--max-hits <n>]
  code-viewer query snapshot create --db <path> [--tables t1,t2,...] [--note <text>]
  code-viewer query snapshot list [--json] [--db <path>]
  code-viewer query snapshot delete --id <snapshot-id>
  code-viewer query snapshot note --id <snapshot-id> --note <text>
  code-viewer query diff create --before <id> --after <id> [--note <text>]
  code-viewer query diff list [--json] [--db <path>]
  code-viewer query diff tables --id <diff-id>
  code-viewer query diff rows --id <diff-id> --table <name> [--type inserted|updated|deleted] [--limit <n>]
  code-viewer query diff delete --id <diff-id>
  code-viewer query agent-help

Global options:
  --cwd <dir>      repository directory (default: current directory)
  --server <url>   code-viewer server URL (default: auto-discovered)

Examples:
  code-viewer query exec --db data.sqlite3 --sql "SELECT * FROM users LIMIT 10"
  code-viewer query search --db app.db --term "john@example.com"
  code-viewer query snapshot create --db app.db --tables users,orders --note "Before migration"
  code-viewer query diff create --before snap-abc123 --after snap-def456
  code-viewer query diff rows --id diff-xyz789 --table users --type updated
`, QUERY_AGENT_HELP = `code-viewer query — execute read-only SQL queries against local databases

You are an AI coding agent. Use this tool to investigate database contents
when a human asks about their data. Results are saved to the project's
.code-viewer/query-history.json and appear in the browser's Database > Query
History tab, so the human can review what you queried.

## When to use

- Answering "what does this data look like?"
- Checking schema, row counts, sample data
- Investigating data quality or anomalies
- Searching for a value across all tables
- Taking snapshots before/after a test to verify DB changes

## Requirements

- A code-viewer server must be running for the repository.
- Only SELECT, PRAGMA, EXPLAIN, WITH queries are allowed (for exec).
- Results are persisted and visible to the human.

## Workflow: SQL Query

1. Identify which database file to query (list with: code-viewer query list)
2. Execute:
   code-viewer query exec --db data.sqlite3 --sql "SELECT * FROM users LIMIT 10" \\
       --title "Sample user data" --body "Checking what user records look like."
3. The human sees results in the browser's Database > Query History tab.

## Workflow: Global Search

Search for a string across all tables and all text columns:
  code-viewer query search --db app.db --term "john@example.com"

Options:
  --tables users,orders    Only search specific tables
  --include-non-text       Also search numeric/date columns
  --max-hits 20            Max hits per table (default: 50)

## Workflow: Snapshot & Diff (for testing)

Use this to verify that a feature test correctly modifies the expected DB tables.

1. Take a "before" snapshot:
   code-viewer query snapshot create --db app.db --tables users,orders \\
       --note "Before running user registration test"

2. (The human or test runner performs the action)

3. Take an "after" snapshot:
   code-viewer query snapshot create --db app.db --tables users,orders \\
       --note "After running user registration test"

4. List snapshots to get IDs:
   code-viewer query snapshot list --db app.db

5. Create a diff:
   code-viewer query diff create --before snap-abc123 --after snap-def456 \\
       --note "User registration test - expected 1 INSERT in users"

6. View the diff:
   code-viewer query diff tables --id diff-xyz789
   code-viewer query diff rows --id diff-xyz789 --table users --type inserted

The human can also view all diffs in the browser's Database > Snapshot tab.

## Guidelines

- Always use LIMIT. The server caps rows but be explicit.
- Write --title for the human, not for yourself.
- Use --body to explain why the query matters.
- Do not query broad PII or secrets unless explicitly asked.
- Use --no-save for exploratory queries that should not remain in history.
- Prefer specific columns over SELECT *.
- For snapshots, always specify --tables to avoid scanning unnecessary tables.
- Write meaningful --note values — the human uses them to understand context.
`;
var init_query_cli = __esm(() => {
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
    "/history",
    "/database"
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
  const pendingChangedPaths = new Set;
  const ignored = (path) => isSkippableSearchPath(normalizeRelativePath(path), options.omitDirNames, options.excludeNames);
  const scheduleUpdate = (changedPath) => {
    if (changedPath)
      pendingChangedPaths.add(changedPath);
    if (timer)
      clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      const paths = pendingChangedPaths.size ? [...pendingChangedPaths] : undefined;
      pendingChangedPaths.clear();
      options.onUpdate(paths);
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
            scheduleUpdate(changed);
            return;
          }
          watchDirectory(fullChangedPath);
        } else if (known) {
          closeSubtree(fullChangedPath);
        }
        scheduleUpdate(changed);
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

// web-src/server/database/adapters/docker.ts
import { spawnSync as spawnSync2 } from "node:child_process";
function execInContainer(config, sql, timeoutMs = 1e4) {
  let args;
  if (config.kind === "postgresql") {
    args = [
      "docker",
      "exec",
      "-i",
      "-e",
      `PGPASSWORD=${config.password}`,
      config.containerName,
      "psql",
      "-U",
      config.user,
      "-d",
      config.database,
      "-X",
      "-q",
      "-t",
      "-A",
      "-F",
      "\t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql
    ];
  } else {
    args = [
      "docker",
      "exec",
      "-i",
      "-e",
      `MYSQL_PWD=${config.password}`,
      config.containerName,
      "mysql",
      "-u",
      config.user,
      config.database,
      "--batch",
      "--raw",
      "--default-character-set=utf8mb4",
      "-e",
      sql
    ];
  }
  const proc = spawnSync2(args[0], args.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
    code: proc.status ?? 1
  };
}
function parseTsvOutput(stdout, hasHeader) {
  const lines = stdout.trim().split(`
`).filter(Boolean);
  if (lines.length === 0)
    return { columns: [], rows: [] };
  if (hasHeader) {
    const columns = lines[0].split("\t");
    const rows2 = lines.slice(1).map((line) => line.split("\t"));
    return { columns, rows: rows2 };
  }
  const rows = lines.map((line) => line.split("\t"));
  return { columns: [], rows };
}
function sanitizeIdentifier(name, kind) {
  if (kind === "mysql")
    return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}
function buildOrderClause(orderBy, kind) {
  if (!orderBy?.length)
    return "";
  const parts = orderBy.map((o) => `${sanitizeIdentifier(o.column, kind)} ${o.direction === "desc" ? "DESC" : "ASC"}`);
  return ` ORDER BY ${parts.join(", ")}`;
}
function createDockerAdapter(config) {
  function exec(sql) {
    const result = execInContainer(config, sql);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "query failed");
    }
    return parseTsvOutput(result.stdout, config.kind === "mysql");
  }
  function toDbValue(val) {
    if (val === "NULL" || val === "\\N")
      return null;
    return val;
  }
  const columnCache = new Map;
  function fetchColumnsUncached(table) {
    let sql;
    if (config.kind === "postgresql") {
      sql = `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table.replace(/'/g, "''")}' ORDER BY ordinal_position`;
    } else {
      sql = `SELECT column_name, column_type, is_nullable, column_default, column_key FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table.replace(/'/g, "''")}' ORDER BY ordinal_position`;
    }
    const result = exec(sql);
    if (config.kind === "postgresql") {
      const pkSql = `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = '${table.replace(/'/g, "''")}'::regclass AND i.indisprimary`;
      let pkCols;
      try {
        const pkResult = exec(pkSql);
        pkCols = new Set(pkResult.rows.map((r) => r[0]));
      } catch {
        pkCols = new Set;
      }
      return result.rows.map((row) => ({
        name: row[0],
        type: row[1],
        nullable: row[2] === "YES",
        primaryKey: pkCols.has(row[0]),
        defaultValue: row[3] === "" ? null : row[3]
      }));
    }
    return result.rows.map((row) => ({
      name: row[0],
      type: row[1],
      nullable: row[2] === "YES",
      primaryKey: row[4] === "PRI",
      defaultValue: row[3] === "NULL" ? null : row[3]
    }));
  }
  return {
    kind: config.kind,
    getTables() {
      let sql;
      if (config.kind === "postgresql") {
        sql = `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
      } else {
        sql = `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`;
      }
      const result = exec(sql);
      return result.rows.map((row) => ({
        name: row[0],
        type: row[1] === "VIEW" ? "view" : "table",
        rowCount: null
      }));
    },
    getColumns(table) {
      const cached = columnCache.get(table);
      if (cached)
        return cached;
      const cols = fetchColumnsUncached(table);
      columnCache.set(table, cols);
      return cols;
    },
    getIndexes() {
      let sql;
      if (config.kind === "postgresql") {
        sql = `SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public' AND indexname NOT LIKE 'pg_%' ORDER BY indexname`;
      } else {
        sql = `SELECT DISTINCT index_name, table_name, non_unique FROM information_schema.statistics WHERE table_schema = DATABASE() ORDER BY index_name`;
      }
      const result = exec(sql);
      if (config.kind === "postgresql") {
        return result.rows.map((row) => ({
          name: row[0],
          table: row[1],
          columns: [],
          unique: false
        }));
      }
      return result.rows.map((row) => ({
        name: row[0],
        table: row[1],
        columns: [],
        unique: row[2] === "0"
      }));
    },
    getForeignKeys() {
      let sql;
      if (config.kind === "postgresql") {
        sql = `SELECT tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
      } else {
        sql = `SELECT table_name, column_name, referenced_table_name, referenced_column_name FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL`;
      }
      try {
        const result = exec(sql);
        return result.rows.map((row) => ({
          fromTable: row[0],
          fromColumn: row[1],
          toTable: row[2],
          toColumn: row[3]
        }));
      } catch {
        return [];
      }
    },
    getColumnsMulti(tables) {
      const result = new Map;
      const uncached = tables.filter((t) => {
        const c = columnCache.get(t);
        if (c)
          result.set(t, c);
        return !c;
      });
      if (uncached.length === 0)
        return result;
      let sql;
      if (config.kind === "postgresql") {
        const inList = uncached.map((t) => `'${t.replace(/'/g, "''")}'`).join(",");
        sql = `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${inList}) ORDER BY table_name, ordinal_position`;
      } else {
        const inList = uncached.map((t) => `'${t.replace(/'/g, "''")}'`).join(",");
        sql = `SELECT table_name, column_name, column_type, is_nullable, column_default, column_key FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN (${inList}) ORDER BY table_name, ordinal_position`;
      }
      try {
        const queryResult = exec(sql);
        const grouped = new Map;
        for (const row of queryResult.rows) {
          const tbl = row[0];
          const existing = grouped.get(tbl) || [];
          existing.push(row);
          grouped.set(tbl, existing);
        }
        let pkMap = new Map;
        if (config.kind === "postgresql") {
          try {
            const pkInList = uncached.map((t) => `'${t.replace(/'/g, "''")}'`).join(",");
            const pkResult = exec(`SELECT c.relname, a.attname FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indisprimary AND c.relname IN (${pkInList})`);
            for (const row of pkResult.rows) {
              const existing = pkMap.get(row[0]) || new Set;
              existing.add(row[1]);
              pkMap.set(row[0], existing);
            }
          } catch {
            pkMap = new Map;
          }
        }
        for (const [tbl, rows] of grouped) {
          const pkCols = pkMap.get(tbl) || new Set;
          let cols;
          if (config.kind === "postgresql") {
            cols = rows.map((row) => ({
              name: row[1],
              type: row[2],
              nullable: row[3] === "YES",
              primaryKey: pkCols.has(row[1]),
              defaultValue: row[4] === "" ? null : row[4]
            }));
          } else {
            cols = rows.map((row) => ({
              name: row[1],
              type: row[2],
              nullable: row[3] === "YES",
              primaryKey: row[5] === "PRI",
              defaultValue: row[4] === "NULL" ? null : row[4]
            }));
          }
          columnCache.set(tbl, cols);
          result.set(tbl, cols);
        }
      } catch {
        for (const t of uncached) {
          const cols = fetchColumnsUncached(t);
          columnCache.set(t, cols);
          result.set(t, cols);
        }
      }
      return result;
    },
    getTableRowCount(table) {
      const id = sanitizeIdentifier(table, config.kind);
      const result = exec(`SELECT COUNT(*) FROM ${id}`);
      return result.rows.length > 0 ? Number(result.rows[0][0]) || 0 : 0;
    },
    getTableRowCounts(tables) {
      const result = new Map;
      if (tables.length === 0)
        return result;
      const parts = tables.map((t) => {
        const id = sanitizeIdentifier(t, config.kind);
        return `SELECT '${t.replace(/'/g, "''")}' AS tbl, COUNT(*) AS cnt FROM ${id}`;
      });
      const sql = parts.join(" UNION ALL ");
      try {
        const queryResult = exec(sql);
        for (const row of queryResult.rows) {
          result.set(row[0], Number(row[1]) || 0);
        }
      } catch {
        for (const t of tables) {
          const id = sanitizeIdentifier(t, config.kind);
          try {
            const r = exec(`SELECT COUNT(*) FROM ${id}`);
            result.set(t, r.rows.length > 0 ? Number(r.rows[0][0]) || 0 : 0);
          } catch {
            result.set(t, 0);
          }
        }
      }
      return result;
    },
    getTablePage(table, options) {
      const id = sanitizeIdentifier(table, config.kind);
      const order = buildOrderClause(options.orderBy, config.kind);
      const sql = `SELECT * FROM ${id}${order} LIMIT ${options.limit} OFFSET ${options.offset}`;
      const result = exec(sql);
      const cols = this.getColumns(table);
      if (result.rows.length === 0) {
        return {
          columns: cols.map((c) => c.name),
          columnTypes: cols.map((c) => c.type),
          rows: [],
          rowCount: 0
        };
      }
      const columnNames = config.kind === "mysql" ? result.columns : cols.map((c) => c.name);
      const typeMap = new Map(cols.map((c) => [c.name, c.type]));
      return {
        columns: columnNames,
        columnTypes: columnNames.map((n) => typeMap.get(n) || "TEXT"),
        rows: result.rows.map((row) => row.map(toDbValue)),
        rowCount: result.rows.length
      };
    },
    executeReadonlyQuery(sql, _params, maxRows = 1000) {
      const trimmed = sql.trim();
      const upper = trimmed.toUpperCase();
      const firstWord = upper.split(/\s/)[0];
      if (firstWord !== "SELECT" && firstWord !== "EXPLAIN" && firstWord !== "WITH" && firstWord !== "SHOW" && firstWord !== "DESCRIBE") {
        throw new Error("Only SELECT, EXPLAIN, WITH, SHOW, and DESCRIBE queries are allowed");
      }
      const BLOCKED_RE = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REPLACE|VACUUM|TRUNCATE|GRANT|REVOKE)\b/;
      if (BLOCKED_RE.test(upper)) {
        throw new Error("Query contains a disallowed statement keyword");
      }
      const readOnlyPreamble = config.kind === "postgresql" ? "BEGIN TRANSACTION READ ONLY; " : "SET SESSION TRANSACTION READ ONLY; ";
      const readOnlyPostamble = config.kind === "postgresql" ? "; COMMIT" : "; SET SESSION TRANSACTION READ WRITE";
      const stripped = trimmed.replace(/;\s*$/, "");
      const limited = `${readOnlyPreamble}${stripped} LIMIT ${maxRows}${readOnlyPostamble}`;
      const result = exec(limited);
      const columnNames = config.kind === "mysql" && result.columns.length > 0 ? result.columns : result.rows.length > 0 ? Array.from({ length: result.rows[0].length }, (_, i) => `col${i + 1}`) : [];
      return {
        columns: columnNames,
        columnTypes: columnNames.map(() => "TEXT"),
        rows: result.rows.slice(0, maxRows).map((row) => row.map(toDbValue)),
        rowCount: Math.min(result.rows.length, maxRows)
      };
    },
    getCreateStatement(table) {
      if (config.kind === "mysql") {
        try {
          const result = exec(`SHOW CREATE TABLE ${sanitizeIdentifier(table, config.kind)}`);
          return result.rows.length > 0 ? result.rows[0][1] || "" : "";
        } catch {
          return "";
        }
      }
      try {
        const result = exec(`SELECT 'CREATE TABLE ' || '${table.replace(/'/g, "''")}' || ' (...)' AS ddl`);
        return result.rows.length > 0 ? result.rows[0][0] || "" : "";
      } catch {
        return "";
      }
    },
    getTriggers(table) {
      let sql;
      if (config.kind === "mysql") {
        sql = `SELECT trigger_name, action_statement FROM information_schema.triggers WHERE event_object_schema = DATABASE() AND event_object_table = '${table.replace(/'/g, "''")}'`;
      } else {
        sql = `SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = '${table.replace(/'/g, "''")}'::regclass AND NOT tgisinternal`;
      }
      try {
        const result = exec(sql);
        return result.rows.map((row) => ({
          name: row[0],
          sql: row[1] || ""
        }));
      } catch {
        return [];
      }
    },
    close() {
      columnCache.clear();
    }
  };
}
function resolveContainerName(serviceName, cwd) {
  const proc = spawnSync2("docker", ["compose", "ps", "--format", "json", "--status", "running"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"], cwd });
  if (proc.status !== 0)
    return null;
  try {
    const output = proc.stdout.trim();
    let containers;
    if (output.startsWith("[")) {
      containers = JSON.parse(output);
    } else {
      containers = output.split(`
`).filter(Boolean).map((line) => JSON.parse(line));
    }
    const match = containers.find((c) => c.Service === serviceName && c.State === "running");
    return match?.Name || null;
  } catch {
    return null;
  }
}
function listDockerDatabases(serviceName, kind, env, cwd) {
  const containerName = resolveContainerName(serviceName, cwd);
  if (!containerName)
    return [];
  const user = env.POSTGRES_USER || env.MYSQL_USER || env.MARIADB_USER || (kind === "postgresql" ? "postgres" : "root");
  const password = env.POSTGRES_PASSWORD || env.MYSQL_PASSWORD || env.MYSQL_ROOT_PASSWORD || env.MARIADB_PASSWORD || env.MARIADB_ROOT_PASSWORD || "";
  const defaultDb = env.POSTGRES_DB || env.MYSQL_DATABASE || env.MARIADB_DATABASE || (kind === "postgresql" ? "postgres" : "");
  const config = {
    kind,
    containerName,
    user,
    password,
    database: defaultDb || (kind === "postgresql" ? "postgres" : "mysql")
  };
  try {
    let sql;
    if (kind === "postgresql") {
      sql = `SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname`;
    } else {
      sql = `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys') ORDER BY schema_name`;
    }
    const result = execInContainer(config, sql);
    if (result.code !== 0)
      return defaultDb ? [defaultDb] : [];
    const parsed = parseTsvOutput(result.stdout, kind === "mysql");
    const dbs = parsed.rows.map((r) => r[0]).filter(Boolean);
    return dbs.length > 0 ? dbs : defaultDb ? [defaultDb] : [];
  } catch {
    return defaultDb ? [defaultDb] : [];
  }
}
function openDockerAdapter(serviceName, kind, env, cwd, overrideDatabase) {
  const containerName = resolveContainerName(serviceName, cwd);
  if (!containerName) {
    throw new Error(`Container for service "${serviceName}" is not running. Start it with: docker compose up -d ${serviceName}`);
  }
  const user = env.POSTGRES_USER || env.MYSQL_USER || env.MARIADB_USER || (kind === "postgresql" ? "postgres" : "root");
  const password = env.POSTGRES_PASSWORD || env.MYSQL_PASSWORD || env.MYSQL_ROOT_PASSWORD || env.MARIADB_PASSWORD || env.MARIADB_ROOT_PASSWORD || "";
  const database = overrideDatabase || env.POSTGRES_DB || env.MYSQL_DATABASE || env.MARIADB_DATABASE || (kind === "postgresql" ? "postgres" : "");
  return createDockerAdapter({
    kind,
    containerName,
    user,
    password,
    database
  });
}
var init_docker = () => {};

// web-src/server/database/adapters/sqlite.ts
function safePrepare(db, sql) {
  const stmt = db.prepare(sql);
  if (typeof stmt.safeIntegers === "function") {
    try {
      stmt.safeIntegers(true);
    } catch {}
  }
  return stmt;
}
async function getSqliteClass() {
  if (cachedDbClass)
    return cachedDbClass;
  try {
    const mod = await import("bun:sqlite");
    cachedDbClass = mod.Database;
    return cachedDbClass;
  } catch {}
  try {
    const mod = await Function('return import("better-sqlite3")')();
    cachedDbClass = mod.default || mod;
    return cachedDbClass;
  } catch {}
  throw new Error("No SQLite driver available. Install better-sqlite3 or use the bun runtime.");
}
function sanitizeIdentifier2(name) {
  return `"${name.replace(/"/g, '""')}"`;
}
function buildOrderClause2(orderBy) {
  if (!orderBy?.length)
    return "";
  const parts = orderBy.map((o) => `${sanitizeIdentifier2(o.column)} ${o.direction === "desc" ? "DESC" : "ASC"}`);
  return ` ORDER BY ${parts.join(", ")}`;
}
function queryColumns(db, table) {
  const rows = db.prepare(`PRAGMA table_info(${sanitizeIdentifier2(table)})`).all();
  return rows.map((row) => ({
    name: row.name,
    type: row.type || "TEXT",
    nullable: row.notnull === 0,
    primaryKey: row.pk > 0,
    defaultValue: row.dflt_value
  }));
}
function createSqliteAdapter(db) {
  return {
    kind: "sqlite",
    getTables() {
      const rows = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      return rows.map((row) => ({
        name: row.name,
        type: row.type,
        rowCount: null
      }));
    },
    getColumns(table) {
      return queryColumns(db, table);
    },
    getIndexes() {
      const rows = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      return rows.map((row) => {
        const info = db.prepare(`PRAGMA index_info(${sanitizeIdentifier2(row.name)})`).all();
        const indexList = db.prepare(`PRAGMA index_list(${sanitizeIdentifier2(row.tbl_name)})`).all();
        const entry = indexList.find((i) => i.name === row.name);
        return {
          name: row.name,
          table: row.tbl_name,
          columns: info.map((i) => i.name),
          unique: entry ? entry.unique === 1 : false
        };
      });
    },
    getForeignKeys() {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE '%VIRTUAL%' ORDER BY name").all();
      const fks = [];
      for (const t of tables) {
        try {
          const rows = db.prepare(`PRAGMA foreign_key_list(${sanitizeIdentifier2(t.name)})`).all();
          for (const row of rows) {
            fks.push({
              fromTable: t.name,
              fromColumn: row.from,
              toTable: row.table,
              toColumn: row.to
            });
          }
        } catch {}
      }
      return fks;
    },
    getColumnsMulti(tables) {
      const result = new Map;
      for (const t of tables) {
        result.set(t, queryColumns(db, t));
      }
      return result;
    },
    getTableRowCount(table) {
      const row = db.prepare(`SELECT COUNT(*) AS cnt FROM ${sanitizeIdentifier2(table)}`).get();
      return row?.cnt ?? 0;
    },
    getTableRowCounts(tables) {
      const result = new Map;
      if (tables.length === 0)
        return result;
      const parts = tables.map((t) => `SELECT '${t.replace(/'/g, "''")}' AS tbl, COUNT(*) AS cnt FROM ${sanitizeIdentifier2(t)}`);
      const sql = parts.join(" UNION ALL ");
      try {
        const rows = db.prepare(sql).all();
        for (const row of rows) {
          result.set(row.tbl, row.cnt);
        }
      } catch {
        for (const t of tables) {
          const row = db.prepare(`SELECT COUNT(*) AS cnt FROM ${sanitizeIdentifier2(t)}`).get();
          result.set(t, row?.cnt ?? 0);
        }
      }
      return result;
    },
    getTablePage(table, options) {
      const order = buildOrderClause2(options.orderBy);
      const sql = `SELECT * FROM ${sanitizeIdentifier2(table)}${order} LIMIT ? OFFSET ?`;
      const rows = safePrepare(db, sql).all(options.limit, options.offset);
      const cols = queryColumns(db, table);
      if (rows.length === 0) {
        return {
          columns: cols.map((c) => c.name),
          columnTypes: cols.map((c) => c.type),
          rows: [],
          rowCount: 0
        };
      }
      const columnNames = Object.keys(rows[0]);
      const typeMap = new Map(cols.map((c) => [c.name, c.type]));
      return {
        columns: columnNames,
        columnTypes: columnNames.map((n) => typeMap.get(n) || "TEXT"),
        rows: rows.map((row) => columnNames.map((col) => row[col])),
        rowCount: rows.length
      };
    },
    executeReadonlyQuery(sql, params, maxRows = 1000) {
      const trimmed = sql.trim();
      const upper = trimmed.toUpperCase();
      const firstWord = upper.split(/\s/)[0];
      if (firstWord !== "SELECT" && firstWord !== "PRAGMA" && firstWord !== "EXPLAIN" && firstWord !== "WITH") {
        throw new Error("Only SELECT, PRAGMA, EXPLAIN, and WITH queries are allowed");
      }
      const BLOCKED_RE = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REPLACE|VACUUM|REINDEX|LOAD_EXTENSION)\b/;
      if (BLOCKED_RE.test(upper)) {
        throw new Error("Query contains a disallowed statement keyword");
      }
      const limited = trimmed.replace(/;\s*$/, "");
      const wrappedSql = `SELECT * FROM (${limited}) LIMIT ${maxRows + 1}`;
      let rows;
      try {
        rows = safePrepare(db, wrappedSql).all(...params || []);
      } catch (wrapErr) {
        const fallbackSql = `${limited} LIMIT ${maxRows + 1}`;
        try {
          rows = safePrepare(db, fallbackSql).all(...params || []);
        } catch {
          throw wrapErr;
        }
      }
      const truncated = rows.length > maxRows;
      if (truncated)
        rows = rows.slice(0, maxRows);
      if (rows.length === 0) {
        return { columns: [], columnTypes: [], rows: [], rowCount: 0 };
      }
      const columnNames = Object.keys(rows[0]);
      return {
        columns: columnNames,
        columnTypes: columnNames.map(() => "TEXT"),
        rows: rows.map((row) => columnNames.map((col) => row[col])),
        rowCount: rows.length
      };
    },
    getCreateStatement(table) {
      const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table);
      return row?.sql ?? "";
    },
    getTriggers(table) {
      const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").all(table);
      return rows.map((row) => ({ name: row.name, sql: row.sql ?? "" }));
    },
    close() {
      db.close();
    }
  };
}
var cachedDbClass = null, sqliteAdapterFactory;
var init_sqlite = __esm(() => {
  sqliteAdapterFactory = {
    async open(path) {
      const DbClass = await getSqliteClass();
      const db = new DbClass(path, { readonly: true, create: false });
      return createSqliteAdapter(db);
    }
  };
});

// web-src/server/database/connection-pool.ts
function setAdapterFactory(f) {
  factory = f;
}
function evictOldest() {
  let oldestKey = null;
  let oldestTime = Infinity;
  for (const [key, entry] of pool) {
    if (entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    const entry = pool.get(oldestKey);
    if (entry) {
      clearTimeout(entry.timer);
      try {
        entry.adapter.close();
      } catch {}
      pool.delete(oldestKey);
    }
  }
}
function scheduleEviction(key, entry) {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    const current = pool.get(key);
    if (current === entry) {
      try {
        current.adapter.close();
      } catch {}
      pool.delete(key);
    }
  }, IDLE_TIMEOUT_MS);
}
async function getConnection(resolvedPath) {
  if (!factory) {
    throw new Error("No adapter factory configured");
  }
  const existing = pool.get(resolvedPath);
  if (existing) {
    existing.lastUsed = Date.now();
    scheduleEviction(resolvedPath, existing);
    return existing.adapter;
  }
  if (pool.size >= MAX_CONNECTIONS) {
    evictOldest();
  }
  const adapter = await factory.open(resolvedPath);
  const entry = {
    adapter,
    path: resolvedPath,
    lastUsed: Date.now(),
    timer: setTimeout(() => {}, 0)
  };
  pool.set(resolvedPath, entry);
  scheduleEviction(resolvedPath, entry);
  return adapter;
}
function closeConnection(resolvedPath) {
  const entry = pool.get(resolvedPath);
  if (!entry)
    return false;
  clearTimeout(entry.timer);
  try {
    entry.adapter.close();
  } catch {}
  pool.delete(resolvedPath);
  return true;
}
var MAX_CONNECTIONS = 8, IDLE_TIMEOUT_MS, pool, factory = null;
var init_connection_pool = __esm(() => {
  IDLE_TIMEOUT_MS = 5 * 60 * 1000;
  pool = new Map;
});

// web-src/server/database/discovery.ts
import {
  closeSync,
  existsSync as existsSync6,
  lstatSync as lstatSync4,
  openSync,
  readdirSync as readdirSync2,
  readFileSync as readFileSync5,
  readSync,
  realpathSync as realpathSync3,
  statSync as statSync2
} from "node:fs";
import { basename as basename2, join as join8, relative as relative2 } from "node:path";
function isSqliteFile(fullPath) {
  try {
    const stat = statSync2(fullPath);
    if (!stat.isFile() || stat.size < 16)
      return false;
    const buf = Buffer.alloc(16);
    const fd = openSync(fullPath, "r");
    try {
      readSync(fd, buf, 0, 16, 0);
    } finally {
      closeSync(fd);
    }
    return buf.toString("utf8", 0, 16) === SQLITE_MAGIC;
  } catch {
    return false;
  }
}
function discoverSqliteFiles(cwd, omitDirNames) {
  const omitSet = new Set(omitDirNames.map((d) => d.toLowerCase()));
  omitSet.add(".git");
  const results = [];
  function scan(dir, depth) {
    if (depth > MAX_SCAN_DEPTH || results.length >= MAX_ENTRIES)
      return;
    let entries;
    try {
      entries = readdirSync2(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= MAX_ENTRIES)
        return;
      if (omitSet.has(entry.toLowerCase()))
        continue;
      const full = join8(dir, entry);
      let stat;
      try {
        stat = lstatSync4(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink())
        continue;
      if (stat.isDirectory()) {
        scan(full, depth + 1);
      } else if (stat.isFile()) {
        const ext = entry.slice(entry.lastIndexOf(".")).toLowerCase();
        if (!SQLITE_EXTENSIONS.has(ext))
          continue;
        if (!isSqliteFile(full))
          continue;
        const rel = relative2(cwd, full);
        if (rel.startsWith("..") || rel.startsWith("/"))
          continue;
        results.push({
          path: rel,
          name: basename2(rel),
          sizeBytes: stat.size
        });
      }
    }
  }
  scan(cwd, 0);
  results.sort((a, b) => {
    const aInternal = a.path.startsWith(".code-viewer/") ? 1 : 0;
    const bInternal = b.path.startsWith(".code-viewer/") ? 1 : 0;
    if (aInternal !== bInternal)
      return aInternal - bInternal;
    return a.path.localeCompare(b.path);
  });
  return results;
}
function validateDbPath(cwd, dbPath) {
  if (!dbPath || dbPath.includes("\x00") || dbPath.startsWith("/") || dbPath.startsWith("\\"))
    return null;
  const parts = dbPath.split(/[\\/]+/);
  if (parts.some((p) => p === ".." || p.toLowerCase() === ".git"))
    return null;
  const full = join8(cwd, dbPath);
  if (!existsSync6(full))
    return null;
  let realCwd;
  let realFull;
  try {
    realCwd = realpathSync3(cwd);
    realFull = realpathSync3(full);
  } catch {
    return null;
  }
  const rel = relative2(realCwd, realFull);
  if (rel === "" || rel.startsWith("..") || rel.startsWith("/"))
    return null;
  if (!isSqliteFile(realFull))
    return null;
  return realFull;
}
function detectDbKind(image) {
  const lower = image.toLowerCase();
  if (lower.includes("postgres"))
    return "postgresql";
  if (lower.includes("mysql") || lower.includes("mariadb"))
    return "mysql";
  if (lower.includes("redis"))
    return "redis";
  return null;
}
function defaultPortFor(kind) {
  switch (kind) {
    case "postgresql":
      return "5432";
    case "mysql":
      return "3306";
    case "redis":
      return "6379";
    default:
      return "";
  }
}
function resolveEnvValue(raw) {
  return raw.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    const defaultMatch = expr.match(/^([^:-]+)(?::?-(.*))?$/);
    if (!defaultMatch)
      return "";
    const varName = defaultMatch[1];
    const fallback = defaultMatch[2] ?? "";
    return process.env[varName] || fallback;
  });
}
function parseComposeEnv(serviceBlock) {
  const env = {};
  const envMatch = serviceBlock.match(/^[ \t]+environment:\s*\n((?:[ \t]+(?:- )?[^\n]+\n?)*)/m);
  if (!envMatch)
    return env;
  const block = envMatch[1];
  for (const line of block.split(`
`)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#"))
      continue;
    const stripped = trimmed.startsWith("- ") ? trimmed.slice(2) : trimmed;
    const eqIdx = stripped.indexOf("=");
    const colonIdx = stripped.indexOf(": ");
    if (eqIdx > 0) {
      env[stripped.slice(0, eqIdx).trim()] = resolveEnvValue(stripped.slice(eqIdx + 1).trim());
    } else if (colonIdx > 0) {
      env[stripped.slice(0, colonIdx).trim()] = resolveEnvValue(stripped.slice(colonIdx + 2).trim());
    }
  }
  return env;
}
function parseComposePorts(serviceBlock) {
  const portsMatch = serviceBlock.match(/^[ \t]+ports:\s*\n((?:[ \t]+- [^\n]+\n?)*)/m);
  if (!portsMatch)
    return null;
  for (const line of portsMatch[1].split(`
`)) {
    const m = line.match(/["']?(\d+):(\d+)["']?/);
    if (m)
      return m[1];
  }
  return null;
}
function discoverDockerDatabases(cwd) {
  const results = [];
  for (const filename of COMPOSE_FILENAMES) {
    const filepath = join8(cwd, filename);
    if (!existsSync6(filepath))
      continue;
    let content;
    try {
      content = readFileSync5(filepath, "utf-8");
    } catch {
      continue;
    }
    const servicesMatch = content.match(/^services:\s*\n/m);
    if (!servicesMatch || servicesMatch.index === undefined)
      continue;
    const servicesStart = servicesMatch.index + servicesMatch[0].length;
    const afterServices = content.slice(servicesStart);
    const topLevelEnd = afterServices.search(/^\S/m);
    const servicesBlock = topLevelEnd >= 0 ? afterServices.slice(0, topLevelEnd) : afterServices;
    const serviceRegex = /^ {2}(\w[\w-]*):\s*\n/gm;
    const servicePositions = [];
    for (let match = serviceRegex.exec(servicesBlock);match !== null; match = serviceRegex.exec(servicesBlock)) {
      servicePositions.push({
        name: match[1],
        start: match.index
      });
    }
    for (let i = 0;i < servicePositions.length; i++) {
      const svc = servicePositions[i];
      const nextStart = i + 1 < servicePositions.length ? servicePositions[i + 1].start : servicesBlock.length;
      const svcBlock = servicesBlock.slice(svc.start, nextStart);
      const imageMatch = svcBlock.match(/^\s+image:\s*["']?([^\s"'#]+)/m);
      if (!imageMatch)
        continue;
      const image = imageMatch[1];
      const kind = detectDbKind(image);
      if (!kind)
        continue;
      const env = parseComposeEnv(svcBlock);
      const port = parseComposePorts(svcBlock);
      const hostPort = port || defaultPortFor(kind);
      let label;
      if (kind === "redis") {
        label = `${svc.name} (${image}, localhost:${hostPort})`;
      } else {
        const dbName = env.POSTGRES_DB || env.MYSQL_DATABASE || env.MARIADB_DATABASE || svc.name;
        const user = env.POSTGRES_USER || env.MYSQL_USER || env.MARIADB_USER || (kind === "postgresql" ? "postgres" : "root");
        label = `${svc.name} (${image}, ${user}@localhost:${hostPort}/${dbName})`;
      }
      results.push({
        id: `docker:${svc.name}`,
        path: filename,
        name: label,
        sizeBytes: 0,
        kind,
        serviceName: svc.name,
        env
      });
    }
    break;
  }
  return results;
}
var SQLITE_EXTENSIONS, SQLITE_MAGIC = "SQLite format 3\x00", MAX_SCAN_DEPTH = 3, MAX_ENTRIES = 50, COMPOSE_FILENAMES;
var init_discovery = __esm(() => {
  SQLITE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3", ".s3db"]);
  COMPOSE_FILENAMES = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml"
  ];
});

// web-src/server/database/serialize.ts
function serializeDbValue(value) {
  if (value === null || value === undefined)
    return null;
  if (typeof value === "bigint") {
    return value >= MIN_SAFE && value <= MAX_SAFE ? Number(value) : value.toString();
  }
  if (value instanceof Uint8Array) {
    return `<blob ${value.byteLength} bytes>`;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}
function serializeDbRow(row) {
  return row.map(serializeDbValue);
}
function serializeDbRows(rows) {
  return rows.map(serializeDbRow);
}
var MIN_SAFE, MAX_SAFE;
var init_serialize = __esm(() => {
  MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
  MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
});

// web-src/server/database/global-search.ts
function sanitizeIdentifier3(name, kind) {
  if (kind === "mysql")
    return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}
function escapeSqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
function isTextLikeType(type) {
  const upper = type.toUpperCase();
  return upper.includes("CHAR") || upper.includes("TEXT") || upper.includes("VARCHAR") || upper.includes("CLOB") || upper.includes("STRING") || upper === "JSON" || upper === "JSONB" || upper === "XML" || upper === "UUID";
}
function escapeLikeTerm(term) {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
function searchTable(adapter, table, columns, term, maxHits, includeNonText, pkColumns) {
  const kind = adapter.kind;
  const searchCols = includeNonText ? columns.filter((c) => c.type.toUpperCase() !== "BLOB" && c.type.toUpperCase() !== "BYTEA") : columns.filter((c) => isTextLikeType(c.type));
  if (searchCols.length === 0)
    return [];
  const escapedTerm = escapeLikeTerm(term);
  const tbl = sanitizeIdentifier3(table, kind);
  const hits = [];
  for (const col of searchCols) {
    if (hits.length >= maxHits)
      break;
    const colId = sanitizeIdentifier3(col.name, kind);
    const castCol = kind === "mysql" ? `CAST(${colId} AS CHAR)` : `CAST(${colId} AS TEXT)`;
    let sql;
    const remaining = maxHits - hits.length;
    if (kind === "sqlite") {
      sql = `SELECT * FROM ${tbl} WHERE ${castCol} LIKE ? ESCAPE '\\' LIMIT ${remaining}`;
    } else {
      const likeVal = escapeSqlString(`%${escapedTerm}%`);
      sql = `SELECT * FROM ${tbl} WHERE ${castCol} LIKE ${likeVal} ESCAPE '\\' LIMIT ${remaining}`;
    }
    try {
      const result = kind === "sqlite" ? adapter.executeReadonlyQuery(sql, [`%${escapedTerm}%`], remaining) : adapter.executeReadonlyQuery(sql, undefined, remaining);
      for (const row of result.rows) {
        const colIdx = result.columns.indexOf(col.name);
        const valueRaw = colIdx >= 0 ? serializeDbValue(row[colIdx]) : null;
        const valueStr = valueRaw == null ? "" : String(valueRaw);
        const preview = valueStr.length > 200 ? `${valueStr.slice(0, 200)}...` : valueStr;
        let rowKeyJson;
        if (pkColumns.length > 0) {
          const keyObj = {};
          for (const pk of pkColumns) {
            const pkIdx = result.columns.indexOf(pk);
            if (pkIdx >= 0)
              keyObj[pk] = serializeDbValue(row[pkIdx]);
          }
          rowKeyJson = JSON.stringify(keyObj);
        }
        hits.push({
          table,
          column: col.name,
          rowKeyJson,
          valuePreview: preview,
          rowPreview: serializeDbRow(row)
        });
      }
    } catch {}
  }
  return hits;
}
function getPrimaryKeyColumns(adapter, table) {
  const columns = adapter.getColumns(table);
  return columns.filter((c) => c.primaryKey).map((c) => c.name);
}
var init_global_search = __esm(() => {
  init_serialize();
});

// web-src/server/database/query-history.ts
import {
  existsSync as existsSync7,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync6,
  renameSync as renameSync2,
  writeFileSync as writeFileSync3
} from "node:fs";
import { join as join9 } from "node:path";
function historyFilePath(root) {
  return join9(root, CODE_VIEWER_DIR2, HISTORY_FILE_NAME);
}
function emptyState() {
  return { version: 1, entries: [] };
}
function loadQueryHistory(cwd) {
  const file = historyFilePath(cwd);
  if (!existsSync7(file))
    return emptyState();
  try {
    const raw = readFileSync6(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return emptyState();
    }
    return parsed;
  } catch {
    return emptyState();
  }
}
function saveQueryHistory(cwd, state) {
  const dir = join9(cwd, CODE_VIEWER_DIR2);
  mkdirSync4(dir, { recursive: true });
  const file = historyFilePath(cwd);
  const tmp = `${file}.tmp-${process.pid}`;
  let content = `${JSON.stringify(state, null, 2)}
`;
  if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) {
    while (state.entries.length > 1 && Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) {
      state.entries.pop();
      content = `${JSON.stringify(state, null, 2)}
`;
    }
  }
  writeFileSync3(tmp, content, "utf8");
  renameSync2(tmp, file);
}
function clampPreviewRows(rows) {
  return rows.slice(0, MAX_PREVIEW_ROWS);
}
function addQueryHistoryEntry(state, entry) {
  const clamped = {
    ...entry,
    rowsPreview: clampPreviewRows(entry.rowsPreview),
    savedRows: Math.min(entry.rowsPreview.length, MAX_PREVIEW_ROWS)
  };
  const entries = [clamped, ...state.entries];
  if (entries.length > MAX_ENTRIES2)
    entries.length = MAX_ENTRIES2;
  return { version: 1, entries };
}
function deleteQueryHistoryEntry(state, id) {
  return {
    version: 1,
    entries: state.entries.filter((e) => e.id !== id)
  };
}
function clearQueryHistory(state, dbId) {
  if (!dbId)
    return emptyState();
  return {
    version: 1,
    entries: state.entries.filter((e) => e.dbId !== dbId)
  };
}
var CODE_VIEWER_DIR2 = ".code-viewer", HISTORY_FILE_NAME = "query-history.json", MAX_ENTRIES2 = 200, MAX_PREVIEW_ROWS = 100, MAX_JSON_BYTES = 1e6;
var init_query_history = () => {};

// web-src/server/database/snapshot-store.ts
import { createHash as createHash2, randomBytes } from "node:crypto";
import { mkdirSync as mkdirSync5 } from "node:fs";
import { join as join10 } from "node:path";
async function getSqliteClass2() {
  if (cachedDbClass2)
    return cachedDbClass2;
  try {
    const mod = await import("bun:sqlite");
    cachedDbClass2 = mod.Database;
    return cachedDbClass2;
  } catch {}
  try {
    const mod = await Function('return import("better-sqlite3")')();
    cachedDbClass2 = mod.default || mod;
    return cachedDbClass2;
  } catch {}
  throw new Error("No SQLite driver available. Install better-sqlite3 or use the bun runtime.");
}
async function getStoreDb(cwd) {
  const dbPath = join10(cwd, CODE_VIEWER_DIR3, SNAPSHOT_DB_NAME);
  if (storeDb && storeDbPath === dbPath)
    return storeDb;
  if (storeDb) {
    try {
      storeDb.close();
    } catch {}
  }
  mkdirSync5(join10(cwd, CODE_VIEWER_DIR3), { recursive: true });
  const DbClass = await getSqliteClass2();
  storeDb = new DbClass(dbPath);
  storeDbPath = dbPath;
  storeDb.exec("PRAGMA journal_mode=WAL");
  storeDb.exec("PRAGMA foreign_keys=ON");
  storeDb.exec(SCHEMA_SQL);
  return storeDb;
}
function makeId(prefix) {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}
function hashPayload(payloadJson) {
  return createHash2("sha256").update(payloadJson).digest("hex");
}
async function createSnapshot(cwd, dbId, kind, tables, note) {
  const db = await getStoreDb(cwd);
  const id = makeId("snap");
  db.prepare("INSERT INTO snapshots (id, db_id, kind, note, created_at, status) VALUES (?, ?, ?, ?, ?, ?)").run(id, dbId, kind, note, new Date().toISOString(), "running");
  for (const t of tables) {
    db.prepare("INSERT INTO snapshot_tables (snapshot_id, table_name) VALUES (?, ?)").run(id, t);
  }
  return id;
}
async function addSnapshotTableData(cwd, snapshotId, tableName, pkColumns, rows) {
  const db = await getStoreDb(cwd);
  const tableHasher = createHash2("sha256");
  const insertRow = db.prepare("INSERT OR IGNORE INTO snapshot_rows (snapshot_id, table_name, row_key_hash, row_key_json, row_hash, payload_hash) VALUES (?, ?, ?, ?, ?, ?)");
  const insertPayload = db.prepare("INSERT OR IGNORE INTO snapshot_payloads (payload_hash, payload_json) VALUES (?, ?)");
  for (const row of rows) {
    const rowKeyHash = createHash2("sha256").update(row.rowKeyJson).digest("hex");
    const payloadHash = hashPayload(row.payloadJson);
    tableHasher.update(row.rowHash);
    insertRow.run(snapshotId, tableName, rowKeyHash, row.rowKeyJson, row.rowHash, payloadHash);
    insertPayload.run(payloadHash, row.payloadJson);
  }
  const tableHash = tableHasher.digest("hex");
  db.prepare("UPDATE snapshot_tables SET row_count = ?, table_hash = ?, pk_columns_json = ? WHERE snapshot_id = ? AND table_name = ?").run(rows.length, tableHash, JSON.stringify(pkColumns), snapshotId, tableName);
}
async function finalizeSnapshot(cwd, snapshotId, error) {
  const db = await getStoreDb(cwd);
  if (error) {
    db.prepare("UPDATE snapshots SET status = 'error', error_message = ? WHERE id = ?").run(error, snapshotId);
  } else {
    db.prepare("UPDATE snapshots SET status = 'done' WHERE id = ?").run(snapshotId);
  }
}
async function listSnapshots(cwd, dbId) {
  const db = await getStoreDb(cwd);
  let rows;
  if (dbId) {
    rows = db.prepare("SELECT id, db_id, kind, note, created_at, status, error_message FROM snapshots WHERE db_id = ? ORDER BY created_at DESC").all(dbId);
  } else {
    rows = db.prepare("SELECT id, db_id, kind, note, created_at, status, error_message FROM snapshots ORDER BY created_at DESC").all();
  }
  return rows.map((r) => {
    const tableRows = db.prepare("SELECT table_name FROM snapshot_tables WHERE snapshot_id = ?").all(r.id);
    return {
      id: r.id,
      dbId: r.db_id,
      kind: r.kind,
      note: r.note,
      createdAt: r.created_at,
      tables: tableRows.map((t) => t.table_name),
      status: r.status,
      errorMessage: r.error_message
    };
  });
}
async function updateSnapshotNote(cwd, snapshotId, note) {
  const db = await getStoreDb(cwd);
  db.prepare("UPDATE snapshots SET note = ? WHERE id = ?").run(note, snapshotId);
}
async function deleteSnapshot(cwd, snapshotId) {
  const db = await getStoreDb(cwd);
  const payloadHashes = db.prepare("SELECT DISTINCT payload_hash FROM snapshot_rows WHERE snapshot_id = ?").all(snapshotId).map((r) => r.payload_hash);
  db.prepare("DELETE FROM snapshots WHERE id = ?").run(snapshotId);
  for (const ph of payloadHashes) {
    const used = db.prepare("SELECT 1 FROM snapshot_rows WHERE payload_hash = ? LIMIT 1").get(ph);
    if (!used) {
      db.prepare("DELETE FROM snapshot_payloads WHERE payload_hash = ?").run(ph);
    }
  }
}
async function computeDiffTables(cwd, beforeId, afterId) {
  const db = await getStoreDb(cwd);
  const beforeTables = db.prepare("SELECT table_name, table_hash, row_count FROM snapshot_tables WHERE snapshot_id = ?").all(beforeId);
  const afterTables = db.prepare("SELECT table_name, table_hash, row_count FROM snapshot_tables WHERE snapshot_id = ?").all(afterId);
  const beforeMap = new Map(beforeTables.map((t) => [t.table_name, t]));
  const afterMap = new Map(afterTables.map((t) => [t.table_name, t]));
  const allTables = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const results = [];
  for (const table of allTables) {
    const b = beforeMap.get(table);
    const a = afterMap.get(table);
    if (b && a && b.table_hash === a.table_hash) {
      results.push({
        tableName: table,
        insertedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        unchangedCount: b.row_count
      });
      continue;
    }
    if (!b) {
      results.push({
        tableName: table,
        insertedCount: a.row_count,
        updatedCount: 0,
        deletedCount: 0,
        unchangedCount: 0
      });
      continue;
    }
    if (!a) {
      results.push({
        tableName: table,
        insertedCount: 0,
        updatedCount: 0,
        deletedCount: b.row_count,
        unchangedCount: 0
      });
      continue;
    }
    const insertedCount = db.prepare(`SELECT COUNT(*) AS cnt
           FROM snapshot_rows a
           LEFT JOIN snapshot_rows b ON b.snapshot_id = ? AND b.table_name = ? AND b.row_key_hash = a.row_key_hash
           WHERE a.snapshot_id = ? AND a.table_name = ? AND b.row_key_hash IS NULL`).get(beforeId, table, afterId, table).cnt;
    const deletedCount = db.prepare(`SELECT COUNT(*) AS cnt
           FROM snapshot_rows b
           LEFT JOIN snapshot_rows a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
           WHERE b.snapshot_id = ? AND b.table_name = ? AND a.row_key_hash IS NULL`).get(afterId, table, beforeId, table).cnt;
    const updatedCount = db.prepare(`SELECT COUNT(*) AS cnt
           FROM snapshot_rows b
           INNER JOIN snapshot_rows a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
           WHERE b.snapshot_id = ? AND b.table_name = ? AND b.row_hash != a.row_hash`).get(afterId, table, beforeId, table).cnt;
    const unchangedCount = b.row_count - deletedCount - updatedCount;
    results.push({
      tableName: table,
      insertedCount,
      updatedCount,
      deletedCount,
      unchangedCount: Math.max(0, unchangedCount)
    });
  }
  results.sort((a, b) => {
    const aChanges = a.insertedCount + a.updatedCount + a.deletedCount;
    const bChanges = b.insertedCount + b.updatedCount + b.deletedCount;
    if (bChanges !== aChanges)
      return bChanges - aChanges;
    return a.tableName.localeCompare(b.tableName);
  });
  return results;
}
async function computeDiffRows(cwd, beforeId, afterId, table, offset = 0, limit = 200) {
  const db = await getStoreDb(cwd);
  const allDiffRows = [];
  const inserted = db.prepare(`SELECT a.row_key_json, a.payload_hash
       FROM snapshot_rows a
       LEFT JOIN snapshot_rows b ON b.snapshot_id = ? AND b.table_name = ? AND b.row_key_hash = a.row_key_hash
       WHERE a.snapshot_id = ? AND a.table_name = ? AND b.row_key_hash IS NULL
       ORDER BY a.row_key_json`).all(beforeId, table, afterId, table);
  for (const r of inserted) {
    allDiffRows.push({
      change_type: "inserted",
      row_key_json: r.row_key_json,
      before_payload_hash: null,
      after_payload_hash: r.payload_hash
    });
  }
  const deleted = db.prepare(`SELECT b.row_key_json, b.payload_hash
       FROM snapshot_rows b
       LEFT JOIN snapshot_rows a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
       WHERE b.snapshot_id = ? AND b.table_name = ? AND a.row_key_hash IS NULL
       ORDER BY b.row_key_json`).all(afterId, table, beforeId, table);
  for (const r of deleted) {
    allDiffRows.push({
      change_type: "deleted",
      row_key_json: r.row_key_json,
      before_payload_hash: r.payload_hash,
      after_payload_hash: null
    });
  }
  const updated = db.prepare(`SELECT b.row_key_json, b.payload_hash AS before_ph, a.payload_hash AS after_ph
       FROM snapshot_rows b
       INNER JOIN snapshot_rows a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
       WHERE b.snapshot_id = ? AND b.table_name = ? AND b.row_hash != a.row_hash
       ORDER BY b.row_key_json`).all(afterId, table, beforeId, table);
  for (const r of updated) {
    allDiffRows.push({
      change_type: "updated",
      row_key_json: r.row_key_json,
      before_payload_hash: r.before_ph,
      after_payload_hash: r.after_ph
    });
  }
  allDiffRows.sort((a, b) => a.row_key_json.localeCompare(b.row_key_json));
  const total = allDiffRows.length;
  const page = allDiffRows.slice(offset, offset + limit);
  const rows = page.map((r) => {
    let beforeValues;
    let afterValues;
    if (r.before_payload_hash) {
      const payload = db.prepare("SELECT payload_json FROM snapshot_payloads WHERE payload_hash = ?").get(r.before_payload_hash);
      if (payload)
        beforeValues = JSON.parse(payload.payload_json);
    }
    if (r.after_payload_hash) {
      const payload = db.prepare("SELECT payload_json FROM snapshot_payloads WHERE payload_hash = ?").get(r.after_payload_hash);
      if (payload)
        afterValues = JSON.parse(payload.payload_json);
    }
    return {
      changeType: r.change_type,
      rowKeyJson: r.row_key_json,
      beforeValues,
      afterValues
    };
  });
  return { rows, total };
}
var CODE_VIEWER_DIR3 = ".code-viewer", SNAPSHOT_DB_NAME = "db-snapshots.sqlite", cachedDbClass2 = null, SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  db_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS snapshot_tables (
  snapshot_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  table_hash TEXT NOT NULL DEFAULT '',
  pk_columns_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (snapshot_id, table_name),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_rows (
  snapshot_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_key_hash TEXT NOT NULL,
  row_key_json TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, table_name, row_key_hash),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_payloads (
  payload_hash TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

`, storeDb = null, storeDbPath = null;
var init_snapshot_store = () => {};

// web-src/server/database/snapshot-runner.ts
import { createHash as createHash3 } from "node:crypto";
function normalizeValue(v) {
  if (v === null)
    return "\\N";
  if (typeof v === "bigint")
    return v.toString();
  if (v instanceof Uint8Array) {
    return `\\x${Buffer.from(v).toString("hex")}`;
  }
  return String(v);
}
function rowToPayloadJson(columns, row) {
  const obj = {};
  for (let i = 0;i < columns.length; i++) {
    obj[columns[i]] = serializeDbValue(row[i]);
  }
  return JSON.stringify(obj);
}
function computeRowHash(columns, row) {
  const parts = columns.map((_, i) => normalizeValue(row[i]));
  return createHash3("sha256").update(parts.join("\t")).digest("hex");
}
function buildRowKeyJson(pkColumns, allColumns, row, rowIndex) {
  if (pkColumns.length === 0) {
    return JSON.stringify({ __rowIndex: rowIndex });
  }
  const keyObj = {};
  for (const pk of pkColumns) {
    const idx = allColumns.indexOf(pk);
    if (idx >= 0)
      keyObj[pk] = serializeDbValue(row[idx]);
  }
  return JSON.stringify(keyObj);
}
async function runSnapshot(cwd, adapter, dbId, tables, note, onProgress) {
  const snapshotId = await createSnapshot(cwd, dbId, adapter.kind, tables, note);
  try {
    for (const table of tables) {
      onProgress?.(table, false);
      const columns = adapter.getColumns(table);
      const colNames = columns.map((c) => c.name);
      const pkColumns = columns.filter((c) => c.primaryKey).map((c) => c.name);
      let offset = 0;
      let rowIndex = 0;
      const allRows = [];
      for (;; ) {
        const result = adapter.getTablePage(table, {
          offset,
          limit: BATCH_SIZE
        });
        if (result.rows.length === 0)
          break;
        for (const row of result.rows) {
          const rowKeyJson = buildRowKeyJson(pkColumns, colNames, row, rowIndex);
          const rowHash = computeRowHash(colNames, row);
          const payloadJson = rowToPayloadJson(colNames, row);
          allRows.push({ rowKeyJson, rowHash, payloadJson });
          rowIndex++;
        }
        offset += result.rows.length;
        if (result.rows.length < BATCH_SIZE)
          break;
      }
      await addSnapshotTableData(cwd, snapshotId, table, pkColumns, allRows);
    }
    await finalizeSnapshot(cwd, snapshotId);
    onProgress?.("", true);
    return snapshotId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalizeSnapshot(cwd, snapshotId, msg);
    throw err;
  }
}
var BATCH_SIZE = 500;
var init_snapshot_runner = __esm(() => {
  init_serialize();
  init_snapshot_store();
});

// web-src/server/database/adapters/redis.ts
import { spawnSync as spawnSync3 } from "node:child_process";
function execRedisCli(config, args, timeoutMs = 1e4) {
  const dockerArgs = [
    "exec",
    "-i",
    ...config.password ? ["-e", `REDISCLI_AUTH=${config.password}`] : [],
    config.containerName,
    "redis-cli",
    "-3",
    ...args
  ];
  const proc = spawnSync3("docker", dockerArgs, {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
    code: proc.status ?? 1
  };
}
function resolveContainerName2(serviceName, cwd) {
  const proc = spawnSync3("docker", ["compose", "ps", "--format", "json", "--status", "running"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"], cwd });
  if (proc.status !== 0)
    return null;
  try {
    const output = proc.stdout.trim();
    let containers;
    if (output.startsWith("[")) {
      containers = JSON.parse(output);
    } else {
      containers = output.split(`
`).filter(Boolean).map((line) => JSON.parse(line));
    }
    const match = containers.find((c) => c.Service === serviceName && c.State === "running");
    return match?.Name || null;
  } catch {
    return null;
  }
}
function parseInfoKeyspace(stdout) {
  const counts = new Map;
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^db(\d+):keys=(\d+)/);
    if (m)
      counts.set(Number(m[1]), Number(m[2]));
  }
  return counts;
}
function isValidRedisType(t) {
  return t === "string" || t === "list" || t === "set" || t === "zset" || t === "hash" || t === "stream" || t === "none";
}
function safeJsonParse(stdout, command) {
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`${command} 返却 JSON の parse に失敗: ${err instanceof Error ? err.message : String(err)} / 先頭200: ${stdout.slice(0, 200)}`);
  }
}
function decodeQuotedRedisBytes(output) {
  const trimmed = output.replace(/\r?\n$/, "");
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return {
      bytes: Buffer.from(trimmed, "utf8"),
      sawBinaryEscape: false
    };
  }
  const inner = trimmed.slice(1, -1);
  const bytes = [];
  let sawBinaryEscape = false;
  let i = 0;
  while (i < inner.length) {
    const ch = inner.charCodeAt(i);
    if (ch === 92 && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === "x" && i + 3 < inner.length) {
        const b = parseInt(inner.slice(i + 2, i + 4), 16);
        if (Number.isFinite(b)) {
          bytes.push(b);
          if (b < 32 || b >= 127)
            sawBinaryEscape = true;
          i += 4;
          continue;
        }
      }
      if (next === "n") {
        bytes.push(10);
        i += 2;
        continue;
      }
      if (next === "r") {
        bytes.push(13);
        i += 2;
        continue;
      }
      if (next === "t") {
        bytes.push(9);
        i += 2;
        continue;
      }
      if (next === "a") {
        bytes.push(7);
        i += 2;
        continue;
      }
      if (next === "b") {
        bytes.push(8);
        i += 2;
        continue;
      }
      if (next === "\\") {
        bytes.push(92);
        i += 2;
        continue;
      }
      if (next === '"') {
        bytes.push(34);
        i += 2;
        continue;
      }
      bytes.push(92);
      i += 1;
      continue;
    }
    if (ch > 127)
      sawBinaryEscape = true;
    bytes.push(ch & 255);
    i += 1;
  }
  return { bytes: Buffer.from(bytes), sawBinaryEscape };
}
function isValidUtf8(buf) {
  try {
    const decoded = buf.toString("utf8");
    return Buffer.from(decoded, "utf8").equals(buf);
  } catch {
    return false;
  }
}
function createRedisAdapter(config) {
  function listDatabases() {
    const result = execRedisCli(config, ["INFO", "keyspace"]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "INFO keyspace failed");
    }
    const counts = parseInfoKeyspace(result.stdout);
    const dbs = [];
    for (let i = 0;i < DEFAULT_DATABASES; i++) {
      dbs.push({ index: i, keyCount: counts.get(i) ?? 0 });
    }
    return dbs;
  }
  function listKeys(opts) {
    const pattern = opts.pattern || "*";
    const cursor = opts.cursor || "0";
    const count = String(opts.count ?? 200);
    const result = execRedisCli(config, [
      "-n",
      String(opts.db),
      "EVAL",
      SCAN_WITH_TYPES_LUA,
      "0",
      cursor,
      pattern,
      count
    ]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "SCAN failed");
    }
    const stdout = result.stdout.trim();
    if (!stdout)
      return { keys: [], nextCursor: "0" };
    const parsed = safeJsonParse(stdout, "SCAN");
    const keys = [];
    for (let i = 0;i < parsed.keys.length; i++) {
      const rawType = parsed.types[i] || "none";
      const type = isValidRedisType(rawType) ? rawType : "none";
      keys.push({ name: parsed.keys[i], type });
    }
    return { keys, nextCursor: parsed.cursor };
  }
  function getValue(opts) {
    const dbArg = ["-n", String(opts.db)];
    const typeResult = execRedisCli(config, [...dbArg, "TYPE", opts.key]);
    if (typeResult.code !== 0) {
      throw new Error(typeResult.stderr.trim() || "TYPE failed");
    }
    const rawType = typeResult.stdout.trim();
    if (rawType === "none" || !isValidRedisType(rawType)) {
      return { type: "none" };
    }
    if (rawType === "string") {
      const lenR = execRedisCli(config, [...dbArg, "STRLEN", opts.key]);
      if (lenR.code !== 0) {
        throw new Error(lenR.stderr.trim() || "STRLEN failed");
      }
      const fullSize = Number(lenR.stdout.trim()) || 0;
      const lastIndex = REDIS_STRING_BYTE_LIMIT - 1;
      const r = execRedisCli(config, [
        "--no-raw",
        ...dbArg,
        "GETRANGE",
        opts.key,
        "0",
        String(lastIndex)
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "GETRANGE failed");
      }
      const { bytes, sawBinaryEscape } = decodeQuotedRedisBytes(r.stdout);
      const truncated = fullSize > REDIS_STRING_BYTE_LIMIT;
      if (sawBinaryEscape || !isValidUtf8(bytes)) {
        return {
          type: "string",
          value: "",
          binaryBase64: bytes.toString("base64"),
          truncated,
          fullSize
        };
      }
      return {
        type: "string",
        value: bytes.toString("utf8"),
        truncated,
        fullSize
      };
    }
    if (rawType === "list") {
      const lua = `local total = redis.call('LLEN', KEYS[1]); local items = redis.call('LRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1); return cjson.encode({total = total, items = items})`;
      const r = execRedisCli(config, [
        ...dbArg,
        "EVAL",
        lua,
        "1",
        opts.key,
        String(REDIS_COLLECTION_LIMIT)
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "LRANGE failed");
      }
      const stdout = r.stdout.trim();
      const parsed = stdout ? safeJsonParse(stdout, "LRANGE") : { total: 0, items: [] };
      return {
        type: "list",
        items: parsed.items,
        total: parsed.total,
        truncated: parsed.items.length < parsed.total
      };
    }
    if (rawType === "hash") {
      const lua = `local total = redis.call('HLEN', KEYS[1]); local result = redis.call('HSCAN', KEYS[1], '0', 'COUNT', tonumber(ARGV[1])); local fields = result[2]; local obj = {}; local count = 0; for i = 1, #fields, 2 do if count >= tonumber(ARGV[1]) then break end; obj[fields[i]] = fields[i+1]; count = count + 1 end; return cjson.encode({total = total, fields = obj, count = count, cursor = result[1]})`;
      const r = execRedisCli(config, [
        ...dbArg,
        "EVAL",
        lua,
        "1",
        opts.key,
        String(REDIS_COLLECTION_LIMIT)
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "HSCAN failed");
      }
      const stdout = r.stdout.trim();
      const parsed = stdout ? safeJsonParse(stdout, "HSCAN") : { total: 0, fields: {}, count: 0, cursor: "0" };
      const truncated = parsed.count < parsed.total || parsed.cursor !== "0";
      return {
        type: "hash",
        fields: parsed.fields,
        total: parsed.total,
        truncated
      };
    }
    if (rawType === "set") {
      const lua = `local total = redis.call('SCARD', KEYS[1]); local result = redis.call('SSCAN', KEYS[1], '0', 'COUNT', tonumber(ARGV[1])); local members = {}; local limit = tonumber(ARGV[1]); for i = 1, math.min(#result[2], limit) do members[i] = result[2][i] end; return cjson.encode({total = total, members = members, cursor = result[1]})`;
      const r = execRedisCli(config, [
        ...dbArg,
        "EVAL",
        lua,
        "1",
        opts.key,
        String(REDIS_COLLECTION_LIMIT)
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "SSCAN failed");
      }
      const stdout = r.stdout.trim();
      const parsed = stdout ? safeJsonParse(stdout, "SSCAN") : { total: 0, members: [], cursor: "0" };
      const truncated = parsed.members.length < parsed.total || parsed.cursor !== "0";
      return {
        type: "set",
        members: parsed.members,
        total: parsed.total,
        truncated
      };
    }
    if (rawType === "zset") {
      const lua = `local total = redis.call('ZCARD', KEYS[1]); local r = redis.call('ZRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1, 'WITHSCORES'); local arr = {}; for i = 1, #r, 2 do table.insert(arr, {member = r[i], score = tonumber(r[i+1])}) end; return cjson.encode({total = total, members = arr})`;
      const r = execRedisCli(config, [
        ...dbArg,
        "EVAL",
        lua,
        "1",
        opts.key,
        String(REDIS_COLLECTION_LIMIT)
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "ZRANGE failed");
      }
      const stdout = r.stdout.trim();
      const parsed = stdout ? safeJsonParse(stdout, "ZRANGE") : { total: 0, members: [] };
      return {
        type: "zset",
        members: parsed.members,
        total: parsed.total,
        truncated: parsed.members.length < parsed.total
      };
    }
    if (rawType === "stream") {
      const lua = `local total = redis.call('XLEN', KEYS[1]); local r = redis.call('XRANGE', KEYS[1], '-', '+', 'COUNT', tonumber(ARGV[1])); local arr = {}; for _, entry in ipairs(r) do local fields = {}; for i = 1, #entry[2], 2 do fields[entry[2][i]] = entry[2][i+1] end; table.insert(arr, {id = entry[1], fields = fields}) end; return cjson.encode({total = total, entries = arr})`;
      const r = execRedisCli(config, [
        ...dbArg,
        "EVAL",
        lua,
        "1",
        opts.key,
        String(REDIS_COLLECTION_LIMIT)
      ]);
      if (r.code !== 0) {
        throw new Error(r.stderr.trim() || "XRANGE failed");
      }
      const stdout = r.stdout.trim();
      const parsed = stdout ? safeJsonParse(stdout, "XRANGE") : { total: 0, entries: [] };
      return {
        type: "stream",
        entries: parsed.entries,
        total: parsed.total,
        truncated: parsed.entries.length < parsed.total
      };
    }
    return { type: "none" };
  }
  return {
    kind: "redis",
    listDatabases,
    listKeys,
    getValue,
    close() {}
  };
}
function openRedisExplorer(serviceName, env, cwd) {
  const containerName = resolveContainerName2(serviceName, cwd);
  if (!containerName) {
    throw new Error(`Container for service "${serviceName}" is not running. Start it with: docker compose up -d ${serviceName}`);
  }
  const password = env.REDIS_PASSWORD || "";
  return createRedisAdapter({ containerName, password });
}
var DEFAULT_DATABASES = 16, REDIS_STRING_BYTE_LIMIT = 65536, REDIS_COLLECTION_LIMIT = 200, SCAN_WITH_TYPES_LUA = `local s = redis.call('SCAN', ARGV[1], 'MATCH', ARGV[2], 'COUNT', ARGV[3]); local types = {}; for i, k in ipairs(s[2]) do types[i] = redis.call('TYPE', k).ok end; return cjson.encode({cursor=s[1], keys=s[2], types=types})`;
var init_redis = () => {};

// web-src/server/database/handle-redis.ts
var exports_handle_redis = {};
__export(exports_handle_redis, {
  handleRedisRoute: () => handleRedisRoute
});
function getRedisServices(cwd) {
  if (cachedRedisCwd === cwd && cachedRedisDbs)
    return cachedRedisDbs;
  const all = discoverDockerDatabases(cwd);
  cachedRedisDbs = all.filter((d) => d.kind === "redis").map((d) => ({ serviceName: d.serviceName, env: d.env }));
  cachedRedisCwd = cwd;
  return cachedRedisDbs;
}
function resolveRedis(cwd, dbParam) {
  if (!dbParam)
    return textError("missing db parameter", 400);
  if (!dbParam.startsWith("docker:")) {
    return textError("redis requires docker: prefix", 400);
  }
  const serviceName = dbParam.slice(7).split(":")[0];
  const services = getRedisServices(cwd);
  const info = services.find((s) => s.serviceName === serviceName);
  if (!info)
    return textError("redis service not found", 404);
  const cached = redisAdapterCache.get(dbParam);
  if (cached)
    return { dbId: dbParam, explorer: cached };
  const explorer = openRedisExplorer(info.serviceName, info.env, cwd);
  redisAdapterCache.set(dbParam, explorer);
  return { dbId: dbParam, explorer };
}
function handleDatabases(cwd, url) {
  const r = resolveRedis(cwd, url.searchParams.get("db"));
  if (r instanceof Response)
    return r;
  try {
    const databases = r.explorer.listDatabases();
    const body = { dbId: r.dbId, databases };
    return json(body);
  } catch (err) {
    console.error("[code-viewer] redis error:", err instanceof Error ? err.message : String(err));
    return textError(`failed to list redis databases: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}
function handleKeys(cwd, url) {
  const r = resolveRedis(cwd, url.searchParams.get("db"));
  if (r instanceof Response)
    return r;
  const dbIndexRaw = url.searchParams.get("dbIndex");
  if (dbIndexRaw === null)
    return textError("missing dbIndex", 400);
  const dbIndex = Number(dbIndexRaw);
  if (!Number.isInteger(dbIndex) || dbIndex < 0 || dbIndex > 15) {
    return textError("dbIndex must be an integer in 0..15", 400);
  }
  const pattern = url.searchParams.get("pattern") || "*";
  const cursor = url.searchParams.get("cursor") || "0";
  const countRaw = url.searchParams.get("count");
  const count = countRaw ? Math.min(1e4, Math.max(1, Number(countRaw) || 200)) : 200;
  try {
    const { keys, nextCursor } = r.explorer.listKeys({
      db: dbIndex,
      pattern,
      cursor,
      count
    });
    const body = {
      dbId: r.dbId,
      dbIndex,
      keys,
      nextCursor
    };
    return json(body);
  } catch (err) {
    console.error("[code-viewer] redis error:", err instanceof Error ? err.message : String(err));
    return textError(`failed to list redis keys: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}
async function handleRedisRoute(req, url, cwd) {
  const path = url.pathname;
  const start = Date.now();
  const method = req.method;
  const qs = url.search ? url.search.slice(0, 120) : "";
  const log = (status) => {
    const ms = Date.now() - start;
    console.log(`[code-viewer] ${method} ${path}${qs} ${status} ${ms}ms`);
  };
  const wrap = (res) => {
    log(res.status);
    return res;
  };
  if (path === "/_db/redis/databases")
    return wrap(handleDatabases(cwd, url));
  if (path === "/_db/redis/keys")
    return wrap(handleKeys(cwd, url));
  if (path === "/_db/redis/value")
    return wrap(handleValue(cwd, url));
  return null;
}
function handleValue(cwd, url) {
  const r = resolveRedis(cwd, url.searchParams.get("db"));
  if (r instanceof Response)
    return r;
  const dbIndexRaw = url.searchParams.get("dbIndex");
  if (dbIndexRaw === null)
    return textError("missing dbIndex", 400);
  const dbIndex = Number(dbIndexRaw);
  if (!Number.isInteger(dbIndex) || dbIndex < 0 || dbIndex > 15) {
    return textError("dbIndex must be an integer in 0..15", 400);
  }
  const key = url.searchParams.get("key");
  if (!key)
    return textError("missing key", 400);
  try {
    const value = r.explorer.getValue({ db: dbIndex, key });
    const body = { dbId: r.dbId, dbIndex, key, value };
    return json(body);
  } catch (err) {
    console.error("[code-viewer] redis error:", err instanceof Error ? err.message : String(err));
    return textError(`failed to read redis value: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}
var redisAdapterCache, cachedRedisDbs = null, cachedRedisCwd = null;
var init_handle_redis = __esm(() => {
  init_redis();
  init_discovery();
  init_handle();
  redisAdapterCache = new Map;
});

// web-src/server/database/handle.ts
var exports_handle = {};
__export(exports_handle, {
  textError: () => textError,
  json: () => json,
  handleDatabaseRoute: () => handleDatabaseRoute
});
import { randomBytes as randomBytes2 } from "node:crypto";
function ensureInit() {
  if (initialized)
    return;
  setAdapterFactory(sqliteAdapterFactory);
  initialized = true;
}
async function getAdapter(r, cwd) {
  if (r.docker) {
    const key = r.dbId;
    const cached = dockerAdapterCache.get(key);
    if (cached)
      return cached;
    const adapter = openDockerAdapter(r.docker.serviceName, r.docker.kind, r.docker.env, cwd, r.docker.database);
    dockerAdapterCache.set(key, adapter);
    return adapter;
  }
  return getConnection(r.resolved);
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
function textError(message, status) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
function sanitizeFilename(name) {
  return name.replace(/["\\\r\n\x00-\x1f]/g, "_");
}
function getDockerDbs(cwd) {
  if (cachedDockerCwd === cwd && cachedDockerDbs)
    return cachedDockerDbs;
  cachedDockerDbs = discoverDockerDatabases(cwd);
  cachedDockerCwd = cwd;
  return cachedDockerDbs;
}
function resolveDb(cwd, dbParam) {
  if (!dbParam)
    return textError("missing db parameter", 400);
  if (dbParam.startsWith("docker:")) {
    const rest = dbParam.slice(7);
    const colonIdx = rest.indexOf(":");
    const serviceName = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
    const dbName = colonIdx >= 0 ? rest.slice(colonIdx + 1) : undefined;
    const dockerDbs = getDockerDbs(cwd);
    const info = dockerDbs.find((d) => d.serviceName === serviceName);
    if (!info)
      return textError("docker service not found", 404);
    if (info.kind === "redis") {
      return textError("redis services must use the /_db/redis/* routes", 400);
    }
    const resolved2 = dbName ? { ...info, database: dbName } : info;
    return { resolved: dbParam, dbId: dbParam, docker: resolved2 };
  }
  const resolved = validateDbPath(cwd, dbParam);
  if (!resolved)
    return textError("invalid database path", 400);
  return { resolved, dbId: dbParam };
}
function toFileInfo(entry) {
  return {
    id: entry.id,
    path: entry.path,
    name: entry.name,
    sizeBytes: entry.sizeBytes,
    kind: entry.kind
  };
}
function handleFiles(cwd, omitDirNames) {
  const sqliteFiles = discoverSqliteFiles(cwd, omitDirNames);
  const dockerServices = discoverDockerDatabases(cwd);
  const dockerEntries = [];
  for (const svc of dockerServices) {
    if (svc.kind === "redis") {
      dockerEntries.push(svc);
      continue;
    }
    const dbs = listDockerDatabases(svc.serviceName, svc.kind, svc.env, cwd);
    if (dbs.length <= 1) {
      dockerEntries.push(svc);
    } else {
      for (const db of dbs) {
        dockerEntries.push({
          ...svc,
          id: `docker:${svc.serviceName}:${db}`,
          name: svc.name.replace(/\)$/, ` / ${db})`),
          database: db
        });
      }
    }
  }
  const body = {
    files: [
      ...sqliteFiles.map((f) => ({
        id: f.path,
        path: f.path,
        name: f.name,
        sizeBytes: f.sizeBytes,
        kind: "sqlite"
      })),
      ...dockerEntries.map(toFileInfo)
    ]
  };
  return json(body);
}
async function handleSchema(cwd, url) {
  const r = resolveDb(cwd, url.searchParams.get("db"));
  if (r instanceof Response)
    return r;
  const includeColumns = url.searchParams.get("includeColumns") === "1";
  try {
    const adapter = await getAdapter(r, cwd);
    const tables = adapter.getTables();
    const tableNames = tables.filter((t) => t.type === "table").map((t) => t.name);
    let countMap;
    if (adapter.getTableRowCounts) {
      countMap = adapter.getTableRowCounts(tableNames);
    } else {
      countMap = new Map;
      for (const name of tableNames) {
        countMap.set(name, adapter.getTableRowCount(name));
      }
    }
    const tablesWithCount = tables.map((t) => ({
      ...t,
      rowCount: t.type === "table" ? countMap.get(t.name) ?? 0 : null
    }));
    const indexes = adapter.getIndexes();
    const foreignKeys = adapter.getForeignKeys();
    const body = {
      dbId: r.dbId,
      tables: tablesWithCount,
      indexes,
      foreignKeys
    };
    if (includeColumns) {
      let colsMap;
      if (adapter.getColumnsMulti) {
        colsMap = adapter.getColumnsMulti(tableNames);
      } else {
        colsMap = new Map;
        for (const name of tableNames) {
          colsMap.set(name, adapter.getColumns(name));
        }
      }
      body.columnsMap = Object.fromEntries(colsMap);
    }
    return json(body);
  } catch (err) {
    console.error("[code-viewer] database error:", err instanceof Error ? err.message : String(err));
    return textError(`failed to read schema: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}
function sanitizeIdentifier4(name, kind = "sqlite") {
  if (kind === "mysql")
    return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}
function escapeSqlString2(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
function buildFilterWhere(grouped, kind) {
  const whereParts = [];
  const params = [];
  const useParams = kind === "sqlite";
  for (const [value, cols] of grouped) {
    const likeVal = useParams ? "?" : escapeSqlString2(`%${value}%`);
    if (cols.length === 1) {
      const cast = kind === "mysql" ? `CAST(${sanitizeIdentifier4(cols[0], kind)} AS CHAR)` : `CAST(${sanitizeIdentifier4(cols[0], kind)} AS TEXT)`;
      whereParts.push(`${cast} LIKE ${likeVal}`);
      if (useParams)
        params.push(`%${value}%`);
    } else {
      const orParts = cols.map((c) => {
        const cast = kind === "mysql" ? `CAST(${sanitizeIdentifier4(c, kind)} AS CHAR)` : `CAST(${sanitizeIdentifier4(c, kind)} AS TEXT)`;
        return `${cast} LIKE ${likeVal}`;
      });
      whereParts.push(`(${orParts.join(" OR ")})`);
      if (useParams) {
        for (let i = 0;i < cols.length; i++)
          params.push(`%${value}%`);
      }
    }
  }
  return { where: whereParts.join(" AND "), params, useParams };
}
function parseFilters(url) {
  const raw = url.searchParams.get("filters");
  if (!raw)
    return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed))
      return [];
    return parsed.filter((f) => !!f && typeof f === "object" && typeof f.column === "string" && typeof f.value === "string");
  } catch {
    return [];
  }
}
async function handleTable(cwd, url) {
  const r = resolveDb(cwd, url.searchParams.get("db"));
  if (r instanceof Response)
    return r;
  const table = url.searchParams.get("table");
  if (!table)
    return textError("missing table parameter", 400);
  const offset = Math.max(0, Number(url.searchParams.get("offset") || "0") || 0);
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || "200") || 200));
  let orderBy;
  const sortCol = url.searchParams.get("sort");
  const sortDir = url.searchParams.get("dir");
  if (sortCol) {
    orderBy = [
      {
        column: sortCol,
        direction: sortDir === "desc" ? "desc" : "asc"
      }
    ];
  }
  const filters = parseFilters(url);
  try {
    const adapter = await getAdapter(r, cwd);
    const columns = adapter.getColumns(table);
    const colNames = new Set(columns.map((c) => c.name));
    if (sortCol && !colNames.has(sortCol)) {
      return textError(`invalid sort column: ${sortCol}`, 400);
    }
    if (filters.length > 0) {
      const validFilters = filters.filter((f) => colNames.has(f.column));
      if (validFilters.length > 0) {
        const grouped = new Map;
        for (const f of validFilters) {
          const existing = grouped.get(f.value) || [];
          existing.push(f.column);
          grouped.set(f.value, existing);
        }
        const k = adapter.kind;
        const filter = buildFilterWhere(grouped, k);
        const order = orderBy ? ` ORDER BY ${sanitizeIdentifier4(orderBy[0].column, k)} ${orderBy[0].direction === "desc" ? "DESC" : "ASC"}` : "";
        const tbl = sanitizeIdentifier4(table, k);
        const countSql = `SELECT COUNT(*) AS cnt FROM ${tbl} WHERE ${filter.where}`;
        const limitOffset = filter.useParams ? "LIMIT ? OFFSET ?" : `LIMIT ${limit} OFFSET ${offset}`;
        const dataSql = `SELECT * FROM ${tbl} WHERE ${filter.where}${order} ${limitOffset}`;
        const countResult = adapter.executeReadonlyQuery(countSql, filter.useParams ? filter.params : undefined);
        const totalRows2 = countResult.rows.length > 0 ? Number(countResult.rows[0][0]) || 0 : 0;
        const dataResult = adapter.executeReadonlyQuery(dataSql, filter.useParams ? [...filter.params, limit, offset] : undefined);
        const body2 = {
          dbId: r.dbId,
          table,
          columns,
          rows: serializeDbRows(dataResult.rows),
          totalRows: totalRows2,
          offset,
          limit,
          hasMore: offset + dataResult.rowCount < totalRows2
        };
        return json(body2);
      }
    }
    const result = adapter.getTablePage(table, { offset, limit, orderBy });
    const totalRows = result.rowCount < limit ? offset + result.rowCount : adapter.getTableRowCount(table);
    const body = {
      dbId: r.dbId,
      table,
      columns,
      rows: serializeDbRows(result.rows),
      totalRows,
      offset,
      limit,
      hasMore: offset + result.rowCount < totalRows
    };
    return json(body);
  } catch (err) {
    console.error("[code-viewer] database error:", err instanceof Error ? err.message : String(err));
    return textError(`failed to read table: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}
function makeHistoryId() {
  return `qh-${randomBytes2(8).toString("hex")}`;
}
async function handleQuery(cwd, req, sendSse) {
  if (req.method !== "POST")
    return textError("method not allowed", 405);
  let body;
  try {
    body = await req.json();
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (!body.db || !body.sql)
    return textError("missing db or sql", 400);
  const r = resolveDb(cwd, body.db);
  if (r instanceof Response)
    return r;
  const maxRows = Math.min(1e4, Math.max(1, body.maxRows || 1000));
  const start = Date.now();
  try {
    const adapter = await getAdapter(r, cwd);
    const result = adapter.executeReadonlyQuery(body.sql, undefined, maxRows);
    const elapsed = Date.now() - start;
    const serializedRows = serializeDbRows(result.rows);
    const response = {
      dbId: body.db,
      columns: result.columns,
      columnTypes: result.columnTypes,
      rows: serializedRows,
      rowCount: result.rowCount,
      truncated: result.rowCount >= maxRows,
      elapsedMs: elapsed
    };
    if (body.saveHistory) {
      const entry = {
        id: makeHistoryId(),
        dbId: body.db,
        sql: body.sql,
        title: body.title,
        body: body.body,
        columns: result.columns,
        rowsPreview: serializedRows,
        rowCount: result.rowCount,
        savedRows: serializedRows.length,
        truncated: result.rowCount >= maxRows,
        elapsedMs: elapsed,
        executedAt: new Date().toISOString(),
        executedBy: body.executedBy || "user",
        source: body.source || "browser"
      };
      const state = loadQueryHistory(cwd);
      const updated = addQueryHistoryEntry(state, entry);
      saveQueryHistory(cwd, updated);
      sendSse?.("db-query", JSON.stringify({ action: "add", id: entry.id }));
    }
    return json(response);
  } catch (err) {
    console.error("[code-viewer] database error:", err instanceof Error ? err.message : String(err));
    const elapsed = Date.now() - start;
    const response = {
      dbId: body.db,
      columns: [],
      columnTypes: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      elapsedMs: elapsed,
      error: err instanceof Error ? err.message : String(err)
    };
    return json(response, 400);
  }
}
function handleHistory(cwd, url) {
  const dbId = url.searchParams.get("db") || undefined;
  const state = loadQueryHistory(cwd);
  if (dbId) {
    return json({
      version: 1,
      entries: state.entries.filter((e) => e.dbId === dbId)
    });
  }
  return json(state);
}
async function handleHistoryDelete(cwd, req, sendSse) {
  if (req.method !== "POST")
    return textError("method not allowed", 405);
  let body;
  try {
    body = await req.json();
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (!body.id)
    return textError("missing id", 400);
  const state = loadQueryHistory(cwd);
  const updated = deleteQueryHistoryEntry(state, body.id);
  saveQueryHistory(cwd, updated);
  sendSse?.("db-query", JSON.stringify({ action: "delete", id: body.id }));
  return json({ ok: true });
}
async function handleHistoryClear(cwd, req, sendSse) {
  if (req.method !== "POST")
    return textError("method not allowed", 405);
  let body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const state = loadQueryHistory(cwd);
  const updated = clearQueryHistory(state, body.db);
  saveQueryHistory(cwd, updated);
  sendSse?.("db-query", JSON.stringify({ action: "clear" }));
  return json({ ok: true });
}
function formatCsvField(value) {
  if (value === null || value === undefined)
    return "";
  if (typeof value === "bigint")
    return value.toString();
  if (value instanceof Uint8Array)
    return `<blob ${value.byteLength} bytes>`;
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str.includes(",") || str.includes('"') || str.includes(`
`) || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
async function handleExport(cwd, url) {
  const r = resolveDb(cwd, url.searchParams.get("db"));
  if (r instanceof Response)
    return r;
  const table = url.searchParams.get("table");
  if (!table)
    return textError("missing table parameter", 400);
  const format = url.searchParams.get("format");
  if (format !== "csv" && format !== "json")
    return textError("format must be csv or json", 400);
  let orderBy;
  const sortCol = url.searchParams.get("sort");
  const sortDir = url.searchParams.get("dir");
  if (sortCol) {
    orderBy = [
      {
        column: sortCol,
        direction: sortDir === "desc" ? "desc" : "asc"
      }
    ];
  }
  const filters = parseFilters(url);
  try {
    const adapter = await getAdapter(r, cwd);
    const columns = adapter.getColumns(table);
    const colNames = columns.map((c) => c.name);
    const colNameSet = new Set(colNames);
    if (sortCol && !colNameSet.has(sortCol)) {
      return textError(`invalid sort column: ${sortCol}`, 400);
    }
    let rawRows;
    if (filters.length > 0) {
      const validFilters = filters.filter((f) => colNameSet.has(f.column));
      if (validFilters.length > 0) {
        const grouped = new Map;
        for (const f of validFilters) {
          const existing = grouped.get(f.value) || [];
          existing.push(f.column);
          grouped.set(f.value, existing);
        }
        const k = adapter.kind;
        const filter = buildFilterWhere(grouped, k);
        const order = orderBy ? ` ORDER BY ${sanitizeIdentifier4(orderBy[0].column, k)} ${orderBy[0].direction === "desc" ? "DESC" : "ASC"}` : "";
        const tbl = sanitizeIdentifier4(table, k);
        const limitOffset = filter.useParams ? "LIMIT ? OFFSET ?" : `LIMIT ${EXPORT_MAX_ROWS} OFFSET 0`;
        const dataSql = `SELECT * FROM ${tbl} WHERE ${filter.where}${order} ${limitOffset}`;
        const result = adapter.executeReadonlyQuery(dataSql, filter.useParams ? [...filter.params, EXPORT_MAX_ROWS, 0] : undefined);
        rawRows = result.rows;
      } else {
        const result = adapter.getTablePage(table, {
          offset: 0,
          limit: EXPORT_MAX_ROWS,
          orderBy
        });
        rawRows = result.rows;
      }
    } else {
      const result = adapter.getTablePage(table, {
        offset: 0,
        limit: EXPORT_MAX_ROWS,
        orderBy
      });
      rawRows = result.rows;
    }
    const rows = serializeDbRows(rawRows);
    if (format === "csv") {
      const lines = [colNames.map(formatCsvField).join(",")];
      for (const row of rows) {
        lines.push(row.map(formatCsvField).join(","));
      }
      const body2 = lines.join(`
`);
      return new Response(body2, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(table)}.csv"`,
          "Cache-Control": "no-store"
        }
      });
    }
    const objects = rows.map((row) => {
      const obj = {};
      for (let i = 0;i < colNames.length; i++) {
        obj[colNames[i]] = row[i];
      }
      return obj;
    });
    const body = JSON.stringify(objects, null, 2);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(table)}.json"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (err) {
    console.error("[code-viewer] database error:", err instanceof Error ? err.message : String(err));
    return textError(`failed to export table: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}
async function handleColumns(cwd, url) {
  const r = resolveDb(cwd, url.searchParams.get("db"));
  if (r instanceof Response)
    return r;
  const table = url.searchParams.get("table");
  if (!table)
    return textError("missing table parameter", 400);
  try {
    const adapter = await getAdapter(r, cwd);
    const columns = adapter.getColumns(table);
    return json({ dbId: r.dbId, table, columns });
  } catch (err) {
    console.error("[code-viewer] database error:", err instanceof Error ? err.message : String(err));
    return textError(`failed to get columns: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}
async function handleDdl(cwd, url) {
  const r = resolveDb(cwd, url.searchParams.get("db"));
  if (r instanceof Response)
    return r;
  const table = url.searchParams.get("table");
  if (!table)
    return textError("missing table parameter", 400);
  try {
    const adapter = await getAdapter(r, cwd);
    const sql = adapter.getCreateStatement(table);
    const triggers = adapter.getTriggers(table);
    return json({ dbId: r.dbId, table, sql, triggers });
  } catch (err) {
    console.error("[code-viewer] database error:", err instanceof Error ? err.message : String(err));
    return textError(`failed to get DDL: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}
async function handleSearchStart(cwd, req) {
  if (req.method !== "POST")
    return textError("method not allowed", 405);
  let body;
  try {
    body = await req.json();
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (!body.db || !body.term)
    return textError("missing db or term", 400);
  const r = resolveDb(cwd, body.db);
  if (r instanceof Response)
    return r;
  const jobId = `search-${randomBytes2(8).toString("hex")}`;
  const ac = new AbortController;
  const job = {
    id: jobId,
    dbId: body.db,
    scannedTables: 0,
    totalTables: 0,
    hits: [],
    done: false,
    abortController: ac
  };
  searchJobs.set(jobId, job);
  setTimeout(() => searchJobs.delete(jobId), 5 * 60000);
  const term = body.term;
  const maxHitsPerTable = body.maxHitsPerTable ?? 50;
  const includeNonText = body.includeNonText ?? false;
  const filterTables = body.tables;
  (async () => {
    try {
      const adapter = await getAdapter(r, cwd);
      let tables = adapter.getTables().filter((t) => t.type === "table").map((t) => t.name);
      if (filterTables && filterTables.length > 0) {
        const allowed = new Set(filterTables);
        tables = tables.filter((t) => allowed.has(t));
      }
      let countMap;
      if (adapter.getTableRowCounts) {
        countMap = adapter.getTableRowCounts(tables);
      } else {
        countMap = new Map;
        for (const t of tables)
          countMap.set(t, adapter.getTableRowCount(t));
      }
      tables.sort((a, b) => (countMap.get(a) ?? 0) - (countMap.get(b) ?? 0));
      job.totalTables = tables.length;
      for (const table of tables) {
        if (ac.signal.aborted)
          break;
        job.currentTable = table;
        const pkCols = getPrimaryKeyColumns(adapter, table);
        const columns = adapter.getColumns(table);
        const hits = searchTable(adapter, table, columns, term, maxHitsPerTable, includeNonText, pkCols);
        job.hits.push(...hits);
        job.scannedTables++;
      }
      job.done = true;
      job.currentTable = undefined;
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      job.done = true;
    }
  })();
  return json({ jobId });
}
function handleSearchStatus(url) {
  const jobId = url.searchParams.get("id");
  if (!jobId)
    return textError("missing id", 400);
  const job = searchJobs.get(jobId);
  if (!job)
    return textError("job not found", 404);
  const result = {
    jobId: job.id,
    dbId: job.dbId,
    scannedTables: job.scannedTables,
    totalTables: job.totalTables,
    currentTable: job.currentTable,
    hits: job.hits,
    done: job.done,
    error: job.error
  };
  if (job.done) {
    setTimeout(() => searchJobs.delete(jobId), 60000);
  }
  return json(result);
}
async function handleSearchCancel(req) {
  if (req.method !== "POST")
    return textError("method not allowed", 405);
  let body;
  try {
    body = await req.json();
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (!body.id)
    return textError("missing id", 400);
  const job = searchJobs.get(body.id);
  if (!job)
    return textError("job not found", 404);
  job.abortController.abort();
  job.done = true;
  return json({ ok: true });
}
async function handleSnapshotList(cwd, url) {
  const dbId = url.searchParams.get("db") || undefined;
  const snapshots = await listSnapshots(cwd, dbId);
  return json({ snapshots });
}
async function handleSnapshotCreate(cwd, req, sendSse) {
  if (req.method !== "POST")
    return textError("method not allowed", 405);
  let body;
  try {
    body = await req.json();
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (!body.db)
    return textError("missing db", 400);
  const r = resolveDb(cwd, body.db);
  if (r instanceof Response)
    return r;
  const adapter = await getAdapter(r, cwd);
  let tables = body.tables;
  if (!tables || tables.length === 0) {
    tables = adapter.getTables().filter((t) => t.type === "table").map((t) => t.name);
  }
  const note = body.note ?? "";
  (async () => {
    try {
      const snapshotId = await runSnapshot(cwd, adapter, body.db, tables, note, (table, done) => {
        sendSse?.("db-snapshot", JSON.stringify({ action: "progress", table, done }));
      });
      sendSse?.("db-snapshot", JSON.stringify({ action: "created", id: snapshotId }));
    } catch (err) {
      console.error("[code-viewer] snapshot error:", err instanceof Error ? err.message : String(err));
      sendSse?.("db-snapshot", JSON.stringify({
        action: "error",
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  })();
  return json({ ok: true, message: "snapshot started" });
}
async function handleSnapshotUpdateNote(cwd, req) {
  if (req.method !== "POST")
    return textError("method not allowed", 405);
  let body;
  try {
    body = await req.json();
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (!body.id)
    return textError("missing id", 400);
  await updateSnapshotNote(cwd, body.id, body.note ?? "");
  return json({ ok: true });
}
async function handleSnapshotDelete(cwd, req) {
  if (req.method !== "POST")
    return textError("method not allowed", 405);
  let body;
  try {
    body = await req.json();
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (!body.id)
    return textError("missing id", 400);
  await deleteSnapshot(cwd, body.id);
  return json({ ok: true });
}
async function handleDiffTables(cwd, url) {
  const beforeId = url.searchParams.get("before");
  const afterId = url.searchParams.get("after");
  if (!beforeId || !afterId)
    return textError("missing before or after parameter", 400);
  try {
    const tables = await computeDiffTables(cwd, beforeId, afterId);
    return json({ beforeId, afterId, tables });
  } catch (err) {
    return textError(`failed to compute diff: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}
async function handleDiffRows(cwd, url) {
  const beforeId = url.searchParams.get("before");
  const afterId = url.searchParams.get("after");
  const table = url.searchParams.get("table");
  if (!beforeId || !afterId || !table)
    return textError("missing before, after, or table parameter", 400);
  const offset = Math.max(0, Number(url.searchParams.get("offset") || "0") || 0);
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || "200") || 200));
  try {
    const result = await computeDiffRows(cwd, beforeId, afterId, table, offset, limit);
    return json({ beforeId, afterId, table, ...result });
  } catch (err) {
    return textError(`failed to compute diff rows: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}
async function handleClose(cwd, req) {
  if (req.method !== "POST")
    return textError("method not allowed", 405);
  let body;
  try {
    body = await req.json();
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (!body.db)
    return textError("missing db", 400);
  const r = resolveDb(cwd, body.db);
  if (r instanceof Response)
    return r;
  if (r.docker) {
    const cached = dockerAdapterCache.get(r.dbId);
    if (cached) {
      cached.close();
      dockerAdapterCache.delete(r.dbId);
    }
  } else {
    closeConnection(r.resolved);
  }
  return json({ ok: true });
}
async function handleDatabaseRoute(req, url, cwd, omitDirNames, sideEffectAllowed, sendSse) {
  ensureInit();
  if (url.pathname.startsWith("/_db/redis/")) {
    const { handleRedisRoute: handleRedisRoute2 } = await Promise.resolve().then(() => (init_handle_redis(), exports_handle_redis));
    return handleRedisRoute2(req, url, cwd);
  }
  const path = url.pathname;
  const start = Date.now();
  const method = req.method;
  const qs = url.search ? url.search.slice(0, 120) : "";
  const log = (status) => {
    const ms = Date.now() - start;
    console.log(`[code-viewer] ${method} ${path}${qs} ${status} ${ms}ms`);
  };
  const wrapResponse = async (handler) => {
    const res = await handler;
    if (res)
      log(res.status);
    return res;
  };
  if (path === "/_db/files")
    return wrapResponse(handleFiles(cwd, omitDirNames));
  if (path === "/_db/schema")
    return wrapResponse(handleSchema(cwd, url));
  if (path === "/_db/table")
    return wrapResponse(handleTable(cwd, url));
  if (path === "/_db/columns")
    return wrapResponse(handleColumns(cwd, url));
  if (path === "/_db/export")
    return wrapResponse(handleExport(cwd, url));
  if (path === "/_db/ddl")
    return wrapResponse(handleDdl(cwd, url));
  if (path === "/_db/query") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleQuery(cwd, req, sendSse));
  }
  if (path === "/_db/close") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleClose(cwd, req));
  }
  if (path === "/_db/history")
    return wrapResponse(handleHistory(cwd, url));
  if (path === "/_db/history/delete") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleHistoryDelete(cwd, req, sendSse));
  }
  if (path === "/_db/history/clear") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleHistoryClear(cwd, req, sendSse));
  }
  if (path === "/_db/search/start") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleSearchStart(cwd, req));
  }
  if (path === "/_db/search/status")
    return wrapResponse(handleSearchStatus(url));
  if (path === "/_db/search/cancel") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleSearchCancel(req));
  }
  if (path === "/_db/snapshot/list")
    return wrapResponse(handleSnapshotList(cwd, url));
  if (path === "/_db/snapshot/create") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleSnapshotCreate(cwd, req, sendSse));
  }
  if (path === "/_db/snapshot/update-note") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleSnapshotUpdateNote(cwd, req));
  }
  if (path === "/_db/snapshot/delete") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleSnapshotDelete(cwd, req));
  }
  if (path === "/_db/snapshot/diff/tables")
    return wrapResponse(handleDiffTables(cwd, url));
  if (path === "/_db/snapshot/diff/rows")
    return wrapResponse(handleDiffRows(cwd, url));
  return null;
}
var initialized = false, dockerAdapterCache, cachedDockerDbs = null, cachedDockerCwd = null, EXPORT_MAX_ROWS = 1e5, searchJobs;
var init_handle = __esm(() => {
  init_docker();
  init_sqlite();
  init_connection_pool();
  init_discovery();
  init_global_search();
  init_query_history();
  init_serialize();
  init_snapshot_runner();
  init_snapshot_store();
  dockerAdapterCache = new Map;
  searchJobs = new Map;
});

// web-src/server/preview.ts
var exports_preview = {};
import {
  closeSync as closeSync2,
  constants,
  existsSync as existsSync8,
  lstatSync as lstatSync5,
  mkdirSync as mkdirSync6,
  openSync as openSync2,
  readFileSync as readFileSync7,
  realpathSync as realpathSync4,
  renameSync as renameSync3,
  statSync as statSync3,
  unlinkSync as unlinkSync2,
  watch,
  writeFileSync as writeFileSync4
} from "node:fs";
import { homedir as homedir3 } from "node:os";
import { basename as basename3, dirname as dirname2, extname, join as join11, relative as relative3 } from "node:path";
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
        cwd = repoRoot(next) || realpathSync4(next);
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
function json2(data, init = {}) {
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
  const full = join11(WEB_ROOT, spec[0]);
  if (!existsSync8(full))
    return text("not found", 404);
  return new Response(readFileSync7(full), {
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
      project: basename3(cwd),
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
    project: basename3(cwd),
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
  const full = join11(cwd, ".code-viewer.json");
  if (!existsSync8(full))
    return null;
  let realCwd;
  let realConfig;
  try {
    realCwd = realpathSync4(cwd);
    realConfig = realpathSync4(full);
  } catch {
    return null;
  }
  if (dirname2(realConfig) !== realCwd || basename3(realConfig) !== ".code-viewer.json")
    return null;
  try {
    const parsed = JSON.parse(readFileSync7(realConfig, "utf8"));
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
  const full = join11(cwd, path);
  if (!existsSync8(full))
    return null;
  let realCwd;
  let realFull;
  try {
    realCwd = realpathSync4(cwd);
    realFull = realpathSync4(full);
  } catch {
    return null;
  }
  const rel = relative3(realCwd, realFull);
  if (rel === "" || rel.startsWith("..") || rel.startsWith("/") || rel.startsWith("\\"))
    return null;
  if (isGitInternalPath(rel))
    return null;
  return realFull;
}
function worktreePath(path) {
  return join11(cwd, path);
}
function safeOpenWorktreePath(path) {
  if (path === "") {
    try {
      const realCwd = realpathSync4(cwd);
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
    const stat = statSync3(full);
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
      const stat = statSync3(full);
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
        return { path, text: readFileSync7(full, "utf8") };
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
  return json2({
    ref: target,
    path,
    project: basename3(cwd),
    branch: currentBranch(cwd) || undefined,
    entries: recursive ? entries : entries.map((entry) => attachTreeEntryMetadata(target, entry)),
    readme: readReadme(target, path),
    upload_enabled: !uploadDisabledByConfig && (target === "worktree" || target === "")
  });
}
function handleSettings() {
  return json2({
    project: basename3(cwd),
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
function handleFiles2(url) {
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
    return json2(cached.body);
  const ref = target || "worktree";
  const entries = listTree(ref, "", cwd, {
    recursive: true,
    omitDirNames,
    excludeNames
  }).entries.filter((entry) => !isExcludedScopePath(entry.path, excludeNames));
  const body = buildFileSearchList(ref, generation, entries);
  fileListCache.set(key, { generation, body });
  return json2(body);
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
      stat = lstatSync5(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > GREP_MAX_FILE_BYTES)
      continue;
    let data;
    try {
      data = readFileSync7(full);
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
    return json2({
      ref,
      engine: ref === "worktree" ? "fallback" : "git",
      truncated: false,
      matches: []
    });
  if (ref === "worktree" || ref === "")
    return json2(grepWorktree(query, max, paths, regex, omitDirNames, excludeNames));
  if (!verifyTreeRef(ref, cwd))
    return text("invalid target", 400);
  return json2(grepTreeRef(ref, query, max, paths, regex, omitDirNames, excludeNames));
}
function handleRefCommits(url) {
  const query = url.searchParams.get("q") || "";
  const parsedMax = Number(url.searchParams.get("max") || "");
  const max = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : undefined;
  return json2({ commits: refCommits(cwd, query, max) });
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
  return json2({ commits: result.commits, hasMore: result.hasMore });
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
    return json2({
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
  return json2(body);
}
function worktreeLineIndexSignature(full) {
  try {
    const stat = statSync3(full);
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
  const stat = statSync3(full);
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
    return json2(body);
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
    return json2(body);
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
    return statSync3(full).size;
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
  const stats = statSync3(realDir);
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
    const target = join11(realDir, safeName);
    if (relative3(realDir, dirname2(target)) !== "")
      return text("invalid filename", 400);
    if (existsSync8(target))
      return text("file exists", 409);
    uploads.push({ file, name: safeName, target });
  }
  const written = [];
  try {
    for (const upload of uploads) {
      const fd = openSync2(upload.target, uploadOpenFlags(), 420);
      try {
        writeFileSync4(fd, new Uint8Array(await upload.file.arrayBuffer()));
      } finally {
        closeSync2(fd);
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
  return json2({
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
function triggerUpdate(changedPaths) {
  generation++;
  clearMutableCaches();
  const data = changedPaths && changedPaths.length && changedPaths.length <= 50 ? JSON.stringify({ generation, paths: changedPaths }) : "tick";
  sendSse("update", data);
}
function moveMacPathIntoTrash(path) {
  const trashDir = join11(homedir3(), ".Trash");
  const base = basename3(path) || "code-viewer-trash-item";
  const target = join11(trashDir, `${base}-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    mkdirSync6(trashDir, { recursive: true });
    renameSync3(path, target);
    return { ok: true, trashPath: target };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
function movePathToTrash(path) {
  lstatSync5(path);
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
  if (existsSync8(original))
    return { ok: false, error: "restore target exists" };
  if (trashPath) {
    if (process.platform !== "darwin")
      return { ok: false, error: "invalid trash handle" };
    if (!existsSync8(trashPath))
      return { ok: false, error: "trash item not found" };
    try {
      const trashRoot = join11(homedir3(), ".Trash");
      const trashRelative = relative3(trashRoot, trashPath);
      if (trashRelative === "" || trashRelative.startsWith("..") || trashRelative.startsWith("/") || trashRelative.startsWith("\\"))
        return { ok: false, error: "invalid trash handle" };
      mkdirSync6(dirname2(original), { recursive: true });
      renameSync3(trashPath, original);
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
  const stats = statSync3(target);
  if (!stats.isDirectory())
    return text("not a directory", 400);
  openOsPath(target);
  return json2({ ok: true });
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
  return json2({ ok: true, generation, undo });
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
  const stats = statSync3(parent);
  if (!stats.isDirectory())
    return text("not a directory", 400);
  const targetPath = dir ? `${dir}/${name}` : name;
  if (!safeRepoPath(targetPath) || isGitInternalPath(targetPath))
    return text("invalid target", 400);
  const target = join11(parent, name);
  if (existsSync8(target))
    return text("already exists", 409);
  try {
    mkdirSync6(target, { recursive: false });
  } catch (error) {
    if (error.code === "EEXIST")
      return text("already exists", 409);
    return text("create failed", 500);
  }
  triggerUpdate();
  return json2({ ok: true, path: targetPath, generation });
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
  return json2({ ok: true, generation });
}
function annotationSse(kind, sessionId, entryId) {
  sendSse("annotation", JSON.stringify({ kind, session_id: sessionId, entry_id: entryId }));
}
async function handleAnnotations(req) {
  if (req.method === "GET")
    return json2(loadAnnotationsState(cwd));
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
    return json2({ ok: true, session: started.session });
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
    return json2({
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
    return json2({ ok: true, removed: result.removed });
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
    return json2({ ok: true });
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
    return json2({ ok: true, entry: result.entry });
  }
  if (action === "clear") {
    saveAnnotationsState(cwd, emptyAnnotationsState());
    annotationSse("clear");
    return json2({ ok: true });
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
  WEB_ROOT = join11(ROOT, "web");
  VERSION = JSON.parse(readFileSync7(join11(ROOT, "package.json"), "utf8")).version;
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
        return handleFiles2(url);
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
      if (url.pathname.startsWith("/_db/")) {
        const { handleDatabaseRoute: handleDatabaseRoute2 } = await Promise.resolve().then(() => (init_handle(), exports_handle));
        const dbResponse = await handleDatabaseRoute2(req, url, cwd, scopeOmitDirNames, sideEffectRequestAllowed, sendSse);
        if (dbResponse)
          return dbResponse;
      }
      if (url.pathname === "/_annotations")
        return handleAnnotations(req);
      if (url.pathname === "/_refs")
        return json2(refs(cwd));
      if (url.pathname === "/refresh" && req.method === "POST") {
        if (!sideEffectRequestAllowed(req))
          return text("forbidden", 403);
        triggerUpdate();
        return json2({ ok: true, generation });
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
var REQUIRED_NODE_MAJOR = 20;
var nodeMajor = Number.parseInt((process.versions.node || "0").split(".")[0] || "0", 10);
if (!Number.isFinite(nodeMajor) || nodeMajor < REQUIRED_NODE_MAJOR) {
  process.stderr.write(`code-viewer requires Node.js >= ${REQUIRED_NODE_MAJOR}.0.0, but found ${process.versions.node}.
` + `Please upgrade Node.js (e.g. via nvm, volta, or your package manager) and retry.
`);
  process.exit(1);
}
if (process.argv[2] === "annotate") {
  const { runAnnotateCli: runAnnotateCli2 } = await Promise.resolve().then(() => (init_annotate_cli(), exports_annotate_cli));
  await runAnnotateCli2(process.argv.slice(3));
} else if (process.argv[2] === "query") {
  const { runQueryCli: runQueryCli2 } = await Promise.resolve().then(() => (init_query_cli(), exports_query_cli));
  await runQueryCli2(process.argv.slice(3));
} else if (process.argv[2] === "skill") {
  const { runSkillCli: runSkillCli2 } = await Promise.resolve().then(() => (init_skill_cli(), exports_skill_cli));
  runSkillCli2(process.argv.slice(3));
} else {
  await init_preview().then(() => exports_preview);
}
