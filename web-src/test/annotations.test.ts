import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnnotationTarget } from "../core/types";
import {
  addAnnotationEntry,
  annotationsFilePath,
  deleteAnnotationById,
  emptyAnnotationsState,
  loadAnnotationsState,
  moveAnnotationEntry,
  normalizeAnnotationsState,
  parseAnnotationLine,
  renameAnnotationSession,
  saveAnnotationsState,
  startAnnotationSession,
  updateAnnotationEntry,
} from "../server/annotations";

const NOW = "2026-06-10T00:00:00.000Z";
const makeId = (() => {
  let n = 0;
  return (prefix: string) => `${prefix}-${++n}`;
})();

describe("parseAnnotationLine", () => {
  test("parses single lines and ranges", () => {
    expect(parseAnnotationLine("12")).toEqual({ start: 12, end: 12 });
    expect(parseAnnotationLine("5-9")).toEqual({ start: 5, end: 9 });
    expect(parseAnnotationLine("9-5")).toEqual({ start: 5, end: 9 });
  });

  test("rejects invalid input", () => {
    expect(parseAnnotationLine("0")).toBe(undefined);
    expect(parseAnnotationLine("abc")).toBe(undefined);
    expect(parseAnnotationLine("1.5")).toBe(undefined);
    expect(parseAnnotationLine("")).toBe(undefined);
  });
});

describe("annotation sessions and entries", () => {
  test("start creates a titled session", () => {
    const { state, session } = startAnnotationSession(
      emptyAnnotationsState(),
      "How SSE works",
      NOW,
      "s-1",
    );
    expect(session).toEqual({
      id: "s-1",
      title: "How SSE works",
      created_at: NOW,
      entries: [],
    });
    expect(state.sessions).toEqual([session]);
  });

  test("add appends to the most recent session by default", () => {
    let state = startAnnotationSession(
      emptyAnnotationsState(),
      "first",
      NOW,
      "s-1",
    ).state;
    state = startAnnotationSession(state, "second", NOW, "s-2").state;
    const result = addAnnotationEntry(
      state,
      { path: "src/app.ts", body: "explanation" },
      NOW,
      makeId,
    );
    if (result.ok === false) throw new Error(result.error);
    expect(result.session.id).toBe("s-2");
    expect(result.state.sessions[0].entries).toEqual([]);
    expect(result.state.sessions[1].entries[0].path).toBe("src/app.ts");
    expect(result.state.sessions[1].entries[0].range).toEqual({
      from: "HEAD",
      to: "worktree",
    });
  });

  test("add auto-creates a session when none exists", () => {
    const result = addAnnotationEntry(
      emptyAnnotationsState(),
      {
        path: "/src/app.ts/",
        line: { start: 10, end: 20 },
        range: { from: "HEAD~1", to: "worktree" },
        title: "guard clause",
        body: "The guard moved up here.",
      },
      NOW,
      makeId,
    );
    if (result.ok === false) throw new Error(result.error);
    expect(result.state.sessions.length).toBe(1);
    expect(result.entry.path).toBe("src/app.ts");
    expect(result.entry.line).toEqual({ start: 10, end: 20 });
    expect(result.entry.range).toEqual({ from: "HEAD~1", to: "worktree" });
    expect(result.entry.title).toBe("guard clause");
  });

  test("add targets an explicit session and validates input", () => {
    const { state } = startAnnotationSession(
      emptyAnnotationsState(),
      "walkthrough",
      NOW,
      "s-1",
    );
    const targeted = addAnnotationEntry(
      state,
      { session_id: "s-1", path: "a.ts", body: "ok" },
      NOW,
      makeId,
    );
    expect(targeted.ok).toBe(true);
    expect(
      addAnnotationEntry(
        state,
        { session_id: "missing", path: "a.ts", body: "x" },
        NOW,
        makeId,
      ),
    ).toEqual({ ok: false, error: "session not found" });
    expect(
      addAnnotationEntry(state, { path: "", body: "x" }, NOW, makeId).ok,
    ).toBe(false);
    expect(
      addAnnotationEntry(state, { path: "a.ts", body: "  " }, NOW, makeId).ok,
    ).toBe(false);
    expect(
      addAnnotationEntry(
        state,
        { path: "a.ts", body: "x", line: { start: 0, end: 2 } },
        NOW,
        makeId,
      ).ok,
    ).toBe(false);
  });

  test("add can insert before, after, or at a position", () => {
    const started = startAnnotationSession(
      emptyAnnotationsState(),
      "walkthrough",
      NOW,
      "s-1",
    );
    const first = addAnnotationEntry(
      started.state,
      { session_id: "s-1", path: "a.ts", body: "first" },
      NOW,
      () => "a-1",
    );
    if (first.ok === false) throw new Error(first.error);
    const third = addAnnotationEntry(
      first.state,
      { session_id: "s-1", path: "c.ts", body: "third" },
      NOW,
      () => "a-3",
    );
    if (third.ok === false) throw new Error(third.error);
    const second = addAnnotationEntry(
      third.state,
      { path: "b.ts", body: "second", before_id: "a-3" },
      NOW,
      () => "a-2",
    );
    if (second.ok === false) throw new Error(second.error);
    expect(second.state.sessions[0].entries.map((entry) => entry.id)).toEqual([
      "a-1",
      "a-2",
      "a-3",
    ]);

    const zero = addAnnotationEntry(
      second.state,
      { session_id: "s-1", path: "z.ts", body: "zero", position: 1 },
      NOW,
      () => "a-0",
    );
    if (zero.ok === false) throw new Error(zero.error);
    expect(zero.state.sessions[0].entries.map((entry) => entry.id)).toEqual([
      "a-0",
      "a-1",
      "a-2",
      "a-3",
    ]);
    expect(
      addAnnotationEntry(
        zero.state,
        { session_id: "s-1", path: "x.ts", body: "x", after_id: "missing" },
        NOW,
        () => "a-x",
      ).ok,
    ).toBe(false);
  });

  test("add stores database targets without requiring a repo path", () => {
    const result = addAnnotationEntry(
      emptyAnnotationsState(),
      {
        target: {
          kind: "database",
          db: "app.db",
          table: "users",
          tab: "schema",
        },
        title: "users schema",
        body: "The user table is the identity root.",
      },
      NOW,
      makeId,
    );
    if (result.ok === false) throw new Error(result.error);
    expect(result.entry.path).toBe("database:app.db:users:schema");
    expect(result.entry.target).toEqual({
      kind: "database",
      db: "app.db",
      table: "users",
      tab: "schema",
    });
    expect(
      addAnnotationEntry(
        emptyAnnotationsState(),
        {
          target: { kind: "database", table: "users" },
          body: "missing db",
        },
        NOW,
        makeId,
      ),
    ).toEqual({ ok: false, error: "database annotation requires db" });
  });

  test("add normalizes database targets before storing them", () => {
    const result = addAnnotationEntry(
      emptyAnnotationsState(),
      {
        target: {
          kind: "database",
          db: "app.db",
          table: "orders",
          tab: "data",
          data: {
            search: "failed",
            filters: [
              { column: "status", value: "failed", ignored: "x" },
              { column: "", value: "ignored" },
            ],
            sort: { column: "created_at", direction: "desc" },
            row: 4,
            ignored: true,
          },
          ignored: true,
        } as unknown as AnnotationTarget,
        body: "filtered rows",
      },
      NOW,
      makeId,
    );
    if (result.ok === false) throw new Error(result.error);
    expect(result.entry.target).toEqual({
      kind: "database",
      db: "app.db",
      table: "orders",
      tab: "data",
      data: {
        search: "failed",
        filters: [{ column: "status", value: "failed" }],
        sort: { column: "created_at", direction: "desc" },
        row: 4,
      },
    });
  });

  test("add rejects data grid database targets without a table", () => {
    expect(
      addAnnotationEntry(
        emptyAnnotationsState(),
        {
          target: {
            kind: "database",
            db: "app.db",
            tab: "data",
            data: { search: "failed" },
          },
          body: "missing table",
        },
        NOW,
        makeId,
      ),
    ).toEqual({
      ok: false,
      error: "database data annotations require table",
    });
  });

  test("add preserves database view state for data, query, and search annotations", () => {
    const result = addAnnotationEntry(
      emptyAnnotationsState(),
      {
        target: {
          kind: "database",
          db: "app.db",
          table: "orders",
          tab: "data",
          data: {
            search: "failed",
            filters: [{ column: "status", value: "failed" }],
            sort: { column: "created_at", direction: "desc" },
            row: 3,
          },
          query: {
            sql: "select * from orders where status = 'failed'",
            mode: "run",
            autoRun: true,
          },
          search: {
            term: "failed",
            includeNonText: true,
            autoRun: true,
          },
        },
        title: "failed orders",
        body: "The filtered rows show failed orders.",
      },
      NOW,
      makeId,
    );
    if (result.ok === false) throw new Error(result.error);
    expect(result.entry.path).toMatch(/search=failed/);
    expect(result.entry.target).toEqual({
      kind: "database",
      db: "app.db",
      table: "orders",
      tab: "data",
      data: {
        search: "failed",
        filters: [{ column: "status", value: "failed" }],
        sort: { column: "created_at", direction: "desc" },
        row: 3,
      },
      query: {
        sql: "select * from orders where status = 'failed'",
        mode: "run",
        autoRun: true,
      },
      search: {
        term: "failed",
        includeNonText: true,
        autoRun: true,
      },
    });
  });

  test("add rejects explicit session when the insertion anchor belongs elsewhere", () => {
    let state = startAnnotationSession(
      emptyAnnotationsState(),
      "first",
      NOW,
      "s-1",
    ).state;
    let added = addAnnotationEntry(
      state,
      { session_id: "s-1", path: "a.ts", body: "first" },
      NOW,
      () => "a-1",
    );
    if (added.ok === false) throw new Error(added.error);
    state = startAnnotationSession(added.state, "second", NOW, "s-2").state;
    added = addAnnotationEntry(
      state,
      { session_id: "s-2", path: "b.ts", body: "second" },
      NOW,
      () => "a-2",
    );
    if (added.ok === false) throw new Error(added.error);
    expect(
      addAnnotationEntry(
        added.state,
        {
          session_id: "s-2",
          path: "x.ts",
          body: "insert",
          before_id: "a-1",
        },
        NOW,
        () => "a-x",
      ),
    ).toEqual({
      ok: false,
      error: "anchor annotation belongs to another session",
    });

    const inferred = addAnnotationEntry(
      added.state,
      { path: "x.ts", body: "insert", after_id: "a-1" },
      NOW,
      () => "a-x",
    );
    if (inferred.ok === false) throw new Error(inferred.error);
    expect(inferred.session.id).toBe("s-1");
  });

  test("move reorders annotations while preserving ids and bodies", () => {
    const started = startAnnotationSession(
      emptyAnnotationsState(),
      "walkthrough",
      NOW,
      "s-1",
    );
    let state = started.state;
    for (const [id, body] of [
      ["a-1", "first"],
      ["a-2", "second"],
      ["a-3", "third"],
    ] as const) {
      const added = addAnnotationEntry(
        state,
        { session_id: "s-1", path: `${id}.ts`, body },
        NOW,
        () => id,
      );
      if (added.ok === false) throw new Error(added.error);
      state = added.state;
    }
    const moved = moveAnnotationEntry(state, "a-3", { before_id: "a-1" });
    if (moved.ok === false) throw new Error(moved.error);
    expect(moved.state.sessions[0].entries.map((entry) => entry.id)).toEqual([
      "a-3",
      "a-1",
      "a-2",
    ]);
    expect(moved.entry.body).toBe("third");
    expect(
      moveAnnotationEntry(moved.state, "a-1", { after_id: "a-1" }).ok,
    ).toBe(false);
  });

  test("move rejects anchors from another session", () => {
    let state = startAnnotationSession(
      emptyAnnotationsState(),
      "first",
      NOW,
      "s-1",
    ).state;
    let added = addAnnotationEntry(
      state,
      { session_id: "s-1", path: "a.ts", body: "first" },
      NOW,
      () => "a-1",
    );
    if (added.ok === false) throw new Error(added.error);
    state = startAnnotationSession(added.state, "second", NOW, "s-2").state;
    added = addAnnotationEntry(
      state,
      { session_id: "s-2", path: "b.ts", body: "second" },
      NOW,
      () => "a-2",
    );
    if (added.ok === false) throw new Error(added.error);
    expect(
      moveAnnotationEntry(added.state, "a-1", { after_id: "a-2" }),
    ).toEqual({
      ok: false,
      error: "anchor annotation belongs to another session",
    });
  });

  test("delete removes an entry or a whole session by id", () => {
    const added = addAnnotationEntry(
      emptyAnnotationsState(),
      { path: "a.ts", body: "x" },
      NOW,
      makeId,
    );
    if (added.ok === false) throw new Error(added.error);
    const sessionId = added.session.id;
    const entryId = added.entry.id;

    const entryRemoved = deleteAnnotationById(added.state, entryId);
    expect(entryRemoved.removed).toBe("entry");
    expect(entryRemoved.state.sessions[0].entries).toEqual([]);

    const sessionRemoved = deleteAnnotationById(added.state, sessionId);
    expect(sessionRemoved.removed).toBe("session");
    expect(sessionRemoved.state.sessions).toEqual([]);

    expect(deleteAnnotationById(added.state, "nope").removed).toBeNull();
  });
});

describe("annotations persistence", () => {
  test("save/load round-trips through .code-viewer/annotations.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-annotations-"));
    try {
      expect(loadAnnotationsState(dir)).toEqual(emptyAnnotationsState());
      const added = addAnnotationEntry(
        emptyAnnotationsState(),
        { path: "a.ts", body: "hello", line: { start: 3, end: 3 } },
        NOW,
        makeId,
      );
      if (added.ok === false) throw new Error(added.error);
      saveAnnotationsState(dir, added.state);
      expect(loadAnnotationsState(dir)).toEqual(added.state);
      expect(annotationsFilePath(dir).endsWith("annotations.json")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("corrupt or foreign file contents load as empty state", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-annotations-"));
    try {
      saveAnnotationsState(dir, emptyAnnotationsState());
      writeFileSync(annotationsFilePath(dir), "not json", "utf8");
      expect(loadAnnotationsState(dir)).toEqual(emptyAnnotationsState());
      writeFileSync(annotationsFilePath(dir), '{"sessions": 5}', "utf8");
      expect(loadAnnotationsState(dir)).toEqual(emptyAnnotationsState());
      expect(readFileSync(annotationsFilePath(dir), "utf8")).toBe(
        '{"sessions": 5}',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("normalize drops malformed sessions and entries but keeps valid ones", () => {
    const normalized = normalizeAnnotationsState({
      version: 1,
      sessions: [
        null,
        { id: "", entries: [] },
        {
          id: "s-1",
          title: "",
          created_at: NOW,
          entries: [
            { id: "a-1", path: "a.ts", body: "ok", line: { start: 2 } },
            { id: "a-2", path: "", body: "missing path" },
            "garbage",
          ],
        },
      ],
    });
    expect(normalized.sessions.length).toBe(1);
    expect(normalized.sessions[0].title).toBe("Untitled session");
    expect(normalized.sessions[0].entries.length).toBe(1);
    expect(normalized.sessions[0].entries[0].line).toEqual({
      start: 2,
      end: 2,
    });
  });
});

describe("renameAnnotationSession / updateAnnotationEntry", () => {
  function seeded() {
    const started = startAnnotationSession(
      emptyAnnotationsState(),
      "Original title",
      NOW,
      "s-seed",
    );
    const added = addAnnotationEntry(
      started.state,
      { session_id: "s-seed", path: "src/app.ts", body: "first body" },
      NOW,
      () => "a-seed",
    );
    if (added.ok === false) throw new Error(added.error);
    return added.state;
  }

  test("rename changes the session title and rejects unknown ids", () => {
    const state = seeded();
    const renamed = renameAnnotationSession(state, "s-seed", "  New name  ");
    expect(renamed.renamed).toBe(true);
    expect(renamed.state.sessions[0].title).toBe("New name");
    expect(renameAnnotationSession(state, "s-missing", "x").renamed).toBe(
      false,
    );
  });

  test("rename falls back to the default title for empty input", () => {
    const renamed = renameAnnotationSession(seeded(), "s-seed", "   ");
    expect(renamed.state.sessions[0].title).toBe("Untitled session");
  });

  test("update patches title and body in place", () => {
    const state = seeded();
    const updated = updateAnnotationEntry(state, "a-seed", {
      title: "fixed",
      body: "corrected body",
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.entry.title).toBe("fixed");
      expect(updated.entry.body).toBe("corrected body");
      expect(updated.state.sessions[0].entries[0].body).toBe("corrected body");
    }
  });

  test("update clears the title when blank and keeps body when omitted", () => {
    const state = seeded();
    const updated = updateAnnotationEntry(state, "a-seed", { title: "  " });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.entry.title ?? null).toBeNull();
      expect(updated.entry.body).toBe("first body");
    }
  });

  test("update rejects empty bodies and unknown ids", () => {
    const state = seeded();
    expect(updateAnnotationEntry(state, "a-seed", { body: "  " }).ok).toBe(
      false,
    );
    expect(updateAnnotationEntry(state, "a-x", { body: "ok" }).ok).toBe(false);
  });
});
