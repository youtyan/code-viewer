import { describe, expect, test } from "bun:test";
import {
  isIsoDate,
  normalizeJournalLabels,
  selectNextJournalTasks,
} from "../core/journal";
import {
  addDailyJournalEntry,
  addJournalTask,
  claimJournalTask,
  completeJournalTask,
  emptyDailyJournalState,
  emptyJournalTaskState,
  linkGithubIssueTask,
  moveJournalTask,
} from "../server/journal";

const NOW = "2026-07-02T00:00:00.000Z";

function makeIdFactory() {
  let n = 0;
  return (prefix: string) => `${prefix}-${++n}`;
}

describe("journal state", () => {
  test("adds daily entries with normalized labels", () => {
    const result = addDailyJournalEntry(
      emptyDailyJournalState(),
      {
        date: "2026-07-02",
        title: "Daily note",
        body: "Worked on the task queue.",
        labels: ["AI Ready", "ui", "ui"],
      },
      NOW,
      makeIdFactory(),
    );
    if (result.ok === false) throw new Error(result.error);
    expect(result.entry.id).toBe("j-1");
    expect(result.entry.date).toBe("2026-07-02");
    expect(result.entry.labels).toEqual(["ai-ready", "ui"]);
    expect(result.entry.source).toBe("user");
  });

  test("moves tasks within status columns and across columns", () => {
    const makeId = makeIdFactory();
    let state = emptyJournalTaskState();
    const first = addJournalTask(
      state,
      { title: "First", status: "todo", priority: "p2" },
      NOW,
      makeId,
    );
    if (first.ok === false) throw new Error(first.error);
    state = first.state;
    const second = addJournalTask(
      state,
      { title: "Second", status: "todo", priority: "p2" },
      NOW,
      makeId,
    );
    if (second.ok === false) throw new Error(second.error);
    state = second.state;

    const moved = moveJournalTask(
      state,
      second.task.id,
      { status: "doing", position: 1 },
      "2026-07-02T01:00:00.000Z",
    );
    if (moved.ok === false) throw new Error(moved.error);

    expect(moved.task.status).toBe("doing");
    expect(
      moved.state.tasks.map((task) => `${task.status}:${task.title}`),
    ).toEqual(["todo:First", "doing:Second"]);
  });

  test("selects AI queue by label, priority, and active claim state", () => {
    const makeId = makeIdFactory();
    let state = emptyJournalTaskState();
    for (const input of [
      { title: "Low", priority: "p3" as const },
      { title: "High", priority: "p0" as const },
      { title: "Other label", priority: "p0" as const, labels: ["other"] },
    ]) {
      const added = addJournalTask(
        state,
        {
          title: input.title,
          status: "todo",
          priority: input.priority,
          labels: input.labels || ["ai-ready"],
        },
        NOW,
        makeId,
      );
      if (added.ok === false) throw new Error(added.error);
      state = added.state;
    }
    const claimed = claimJournalTask(
      state,
      "t-2",
      { by: "agent", lease_minutes: 60 },
      "2026-07-02T00:10:00.000Z",
    );
    if (claimed.ok === false) throw new Error(claimed.error);
    state = claimed.state;

    expect(
      selectNextJournalTasks(
        state,
        { labels: ["ai-ready"], now: Date.parse("2026-07-02T00:20:00.000Z") },
        5,
      ).map((task) => task.title),
    ).toEqual(["Low"]);
  });

  test("links GitHub issues atomically by required local labels", () => {
    let state = emptyJournalTaskState();
    const first = linkGithubIssueTask(
      state,
      {
        issue_number: 42,
        title: "Sample issue",
        url: "https://example.invalid/repo/issues/42",
        labels: ["ai-ready"],
      },
      "2026-07-02T00:00:00.000Z",
      () => "t-linked",
    );
    expect(first.ok).toBe(true);
    if (first.ok === false) return;
    state = first.state;
    expect(first.created).toBe(true);
    expect(first.task.status).toBe("draft");
    expect(first.task.priority).toBe("p2");
    expect(first.task.labels).toEqual(["github", "issue-42", "ai-ready"]);
    expect(first.task.body.includes("GitHub issue #42")).toBe(true);
    const linkedUrl = first.task.body.match(/https:\/\/[^\s)]+/)?.[0];
    expect(linkedUrl).toBe("https://example.invalid/repo/issues/42");

    const second = linkGithubIssueTask(
      state,
      {
        issue_number: 42,
        title: "Sample issue",
        status: "doing",
        priority: "p1",
        labels: ["ui"],
      },
      "2026-07-02T00:10:00.000Z",
      () => "t-duplicate",
    );
    expect(second.ok).toBe(true);
    if (second.ok === false) return;
    expect(second.created).toBe(false);
    expect(second.moved).toBe(true);
    expect(second.state.tasks).toHaveLength(1);
    expect(second.task.id).toBe("t-linked");
    expect(second.task.status).toBe("doing");
    expect(second.task.priority).toBe("p1");
    expect(second.task.labels).toEqual([
      "github",
      "issue-42",
      "ai-ready",
      "ui",
    ]);
  });

  test("scopes GitHub issue links by GitHub label and repository", () => {
    const makeId = makeIdFactory();
    const manual = addJournalTask(
      emptyJournalTaskState(),
      { title: "Manual reference", labels: ["issue-7"] },
      NOW,
      makeId,
    );
    if (manual.ok === false) throw new Error(manual.error);

    const first = linkGithubIssueTask(
      manual.state,
      {
        issue_number: 7,
        repo: "owner/alpha",
        title: "Alpha issue",
      },
      "2026-07-02T00:10:00.000Z",
      makeId,
    );
    if (first.ok === false) throw new Error(first.error);
    expect(first.created).toBe(true);
    expect(first.state.tasks).toHaveLength(2);
    expect(first.task.labels).toEqual([
      "github",
      "issue-7",
      "repo-owner-alpha",
    ]);

    const second = linkGithubIssueTask(
      first.state,
      {
        issue_number: 7,
        repo: "owner/beta",
        title: "Beta issue",
      },
      "2026-07-02T00:20:00.000Z",
      makeId,
    );
    if (second.ok === false) throw new Error(second.error);
    expect(second.created).toBe(true);
    expect(second.state.tasks).toHaveLength(3);
    expect(second.task.labels).toEqual([
      "github",
      "issue-7",
      "repo-owner-beta",
    ]);

    const relink = linkGithubIssueTask(
      second.state,
      {
        issue_number: 7,
        repo: "owner/alpha",
        title: "Alpha issue",
        status: first.task.status,
      },
      "2026-07-02T00:30:00.000Z",
      makeId,
    );
    if (relink.ok === false) throw new Error(relink.error);
    expect(relink.created).toBe(false);
    expect(relink.moved).toBe(false);
    expect(relink.task.id).toBe(first.task.id);
    expect(relink.state.tasks).toHaveLength(3);

    const unscoped = linkGithubIssueTask(
      relink.state,
      {
        issue_number: 7,
        title: "Unscoped issue",
      },
      "2026-07-02T00:40:00.000Z",
      makeId,
    );
    if (unscoped.ok === false) throw new Error(unscoped.error);
    expect(unscoped.created).toBe(true);
    expect(unscoped.task.labels).toEqual(["github", "issue-7"]);
    expect([first.task.id, second.task.id].includes(unscoped.task.id)).toBe(
      false,
    );
    expect(unscoped.state.tasks).toHaveLength(4);
  });

  test("claim WIP limit only counts the same claimant", () => {
    const makeId = makeIdFactory();
    let state = emptyJournalTaskState();
    for (const title of ["First", "Second", "Third"]) {
      const added = addJournalTask(
        state,
        { title, status: "todo" },
        NOW,
        makeId,
      );
      if (added.ok === false) throw new Error(added.error);
      state = added.state;
    }

    const firstClaim = claimJournalTask(
      state,
      "t-1",
      { by: "agent-a", wip_limit: 1 },
      "2026-07-02T00:10:00.000Z",
    );
    if (firstClaim.ok === false) throw new Error(firstClaim.error);
    state = firstClaim.state;

    const secondClaim = claimJournalTask(
      state,
      "t-2",
      { by: "agent-b", wip_limit: 1 },
      "2026-07-02T00:11:00.000Z",
    );
    if (secondClaim.ok === false) throw new Error(secondClaim.error);

    const blocked = claimJournalTask(
      secondClaim.state,
      "t-3",
      { by: "agent-a", wip_limit: 1 },
      "2026-07-02T00:12:00.000Z",
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok === false) expect(blocked.error).toBe("WIP limit reached");
  });

  test("complete requires an active matching claim", () => {
    const makeId = makeIdFactory();
    const added = addJournalTask(
      emptyJournalTaskState(),
      { title: "Finish me", status: "todo" },
      NOW,
      makeId,
    );
    if (added.ok === false) throw new Error(added.error);

    const unclaimed = completeJournalTask(
      added.state,
      added.task.id,
      { note: "Verified.", by: "agent-a" },
      "2026-07-02T02:00:00.000Z",
      makeId,
    );
    expect(unclaimed.ok).toBe(false);

    const claimed = claimJournalTask(
      added.state,
      added.task.id,
      { by: "agent-a" },
      "2026-07-02T01:00:00.000Z",
    );
    if (claimed.ok === false) throw new Error(claimed.error);

    const wrongOwner = completeJournalTask(
      claimed.state,
      claimed.task.id,
      { note: "Verified.", by: "agent-b" },
      "2026-07-02T02:00:00.000Z",
      makeId,
    );
    expect(wrongOwner.ok).toBe(false);

    const done = completeJournalTask(
      claimed.state,
      claimed.task.id,
      { note: "Verified.", by: "agent-a" },
      "2026-07-02T02:00:00.000Z",
      makeId,
    );
    if (done.ok === false) throw new Error(done.error);
    expect(done.task.status).toBe("done");
    expect(done.task.completed_at).toBe("2026-07-02T02:00:00.000Z");
    expect(done.task.notes?.[0].body).toBe("Verified.");
  });

  test("normalizes label input for exact AI filters", () => {
    expect(normalizeJournalLabels([" UI Work ", "ui work", "bug/fix"])).toEqual(
      ["ui-work", "bugfix"],
    );
    expect(normalizeJournalLabels([" バグ修正 ", "UI 作業"])).toEqual([
      "バグ修正",
      "ui-作業",
    ]);
  });

  test("validates real ISO calendar dates", () => {
    expect(isIsoDate("2026-07-02")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-40")).toBe(false);
    expect(isIsoDate("2026-7-2")).toBe(false);
  });
});
