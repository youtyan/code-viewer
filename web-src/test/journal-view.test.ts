import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { JournalDataResponse, JournalTask } from "../core/journal";
import type { AppRoute, DiffRange } from "../core/routes";
import { createJournalView, type JournalViewText } from "../views/journal-view";
import { q, waitFor } from "./_test-helpers";

GlobalRegistrator.register();

afterAll(() => {
  GlobalRegistrator.unregister();
});

const RANGE: DiffRange = { from: "HEAD", to: "worktree" };
const NOW = "2026-07-02T00:00:00.000Z";

const TEXT: JournalViewText = {
  locale: "ja",
  ariaLabel: "ワークログ",
  title: "ワークログ",
  tabs: { journal: "ログ", tasks: "タスク" },
  refresh: "更新",
  loading: "読み込み中",
  loadFailed: "読み込みに失敗しました",
  statusLabels: {
    draft: "下書き",
    todo: "未着手",
    doing: "進行中",
    blocked: "ブロック",
    done: "完了",
  },
  priorityLabels: { p0: "P0", p1: "P1", p2: "P2", p3: "P3" },
  statusField: "ステータス",
  priorityField: "優先度",
  previousMonth: "前の月",
  nextMonth: "次の月",
  weekDays: ["日", "月", "火", "水", "木", "金", "土"],
  noEntries: "ログなし",
  noRelatedTasks: "関連タスクなし",
  noBody: "本文はありません",
  relatedTasks: "関連タスク",
  new: "新規",
  titlePlaceholder: "タイトル",
  labelPlaceholder: "ラベル",
  entryBodyPlaceholder: "本文",
  addEntry: "ログを追加",
  saveEntry: "ログを保存",
  delete: "削除",
  deleteEntryFailed: "ログの削除に失敗しました",
  saveEntryFailed: "ログの保存に失敗しました",
  moveTaskFailed: "タスクの移動に失敗しました",
  aiQueue: "AIキュー",
  empty: "空です",
  duePrefix: "期限",
  startDate: "開始日",
  endDate: "終了日",
  removeLabel: (label) => `${label} を削除`,
  claimedBy: (name) => `${name} が確保中`,
  taskHeading: "タスク",
  newTaskHeading: "新規タスク",
  taskBodyPlaceholder: "詳細",
  addTask: "タスクを追加",
  saveTask: "タスクを保存",
  saveTaskFailed: "タスクの保存に失敗しました",
  claim: "確保",
  claimTaskFailed: "タスクの確保に失敗しました",
  done: "完了",
  doneTaskFailed: "タスクの完了に失敗しました",
  deleteTaskFailed: "タスクの削除に失敗しました",
  labelFilterPlaceholder: "ラベル",
  allLabels: "すべて",
  labelFilters: "ラベル",
  githubIssues: "GitHub Issue",
  githubRepoPlaceholder: "リポジトリ",
  githubLabelPlaceholder: "GitHubラベル",
  githubSearchPlaceholder: "Issue検索",
  githubStateLabels: { open: "未解決", closed: "解決済み", all: "すべて" },
  githubLoad: "Issueを表示",
  githubLoadMore: "さらに読む",
  githubLoading: "読み込み中",
  githubLoadFailed: "GitHub Issueの読み込みに失敗しました",
  githubShowing: (count, limit) => `${limit}件中${count}件を表示中`,
  githubRateLimited: (seconds) => `${seconds}秒後に再試行`,
  githubNotLoaded: "GitHub Issueは未読み込みです",
  githubNoIssues: "GitHub Issueは0件です",
  githubClose: "GitHub Issueを閉じる",
  githubLinked: "紐づき済み",
  githubAddToBoard: "看板へ追加",
  githubOpenTask: "タスクを開く",
  githubDragHint: "Issueを追加またはドラッグできます。",
  githubLinkTaskFailed: "GitHub Issueの紐づけに失敗しました",
  githubMemoLabel: "メモ",
  moreTasks: (count) => `他${count}件`,
  resizeTaskPanel: "タスクパネルをリサイズ",
  dragTask: "タスクをドラッグ",
  editorModes: { write: "編集", preview: "プレビュー", split: "分割" },
};

function task(overrides: Partial<JournalTask> = {}): JournalTask {
  return {
    id: "t-1",
    title: "Sample task",
    body: "Task body",
    status: "todo",
    priority: "p2",
    labels: [],
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function journalData(tasks: JournalTask[] = [task()]): JournalDataResponse {
  return {
    journal: { version: 1, entries: [] },
    tasks: { version: 1, tasks },
    labels: ["backend", "docs", "sample", "ui"],
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function click(el: Element | null | undefined): void {
  (el as HTMLElement | null)?.dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
}

function change(el: Element | null | undefined): void {
  (el as HTMLElement | null)?.dispatchEvent(
    new Event("change", { bubbles: true }),
  );
}

function fakeDataTransfer() {
  const state = {
    effectAllowed: "",
    data: new Map<string, string>(),
    dragImages: [] as Array<{ element: Element; x: number; y: number }>,
    setData(type: string, value: string) {
      state.data.set(type, value);
    },
    setDragImage(element: Element, x: number, y: number) {
      state.dragImages.push({ element, x, y });
    },
  };
  return state;
}

function dragStart(
  el: Element | null | undefined,
  dataTransfer?: ReturnType<typeof fakeDataTransfer>,
): Event {
  const event = new MouseEvent("dragstart", {
    bubbles: true,
    cancelable: true,
    clientX: 8,
    clientY: 8,
  });
  if (dataTransfer)
    Object.defineProperty(event, "dataTransfer", {
      configurable: true,
      value: dataTransfer,
    });
  (el as HTMLElement | null)?.dispatchEvent(event);
  return event;
}

function installDom(): void {
  document.body.innerHTML = `
    <main id="content"></main>
    <section id="diff"></section>
    <section id="empty"></section>
    <section id="history-commit-info"></section>
  `;
}

function createView(route: AppRoute, setRouteCalls: AppRoute[] = []) {
  return createJournalView({
    getRoute: () => route,
    setRoute: (next) => setRouteCalls.push(next),
    currentRange: () => RANGE,
    trackLoad: (promise) => promise,
    getText: () => TEXT,
    setPageMode: () => undefined,
    syncHeaderMenu: () => undefined,
    setStatus: () => undefined,
  });
}

beforeEach(() => {
  installDom();
});

describe("journal view", () => {
  test("reloads GitHub issues after a filter change", async () => {
    const posts: Array<Record<string, unknown>> = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === "GET") return json(journalData());
        const body = JSON.parse(String(init.body || "{}")) as Record<
          string,
          unknown
        >;
        posts.push(body);
        return json({
          issues: [
            {
              number: posts.length,
              title: "Sample issue",
              state: body.state,
              labels: [],
            },
          ],
        });
      }) as typeof fetch,
    });

    const view = createView({ screen: "journal", tab: "tasks", range: RANGE });
    await view.enter();
    click(q(document, ".journal-github-toggle"));
    await waitFor(
      () =>
        posts.filter((post) => post.action === "list-github-issues").length ===
        1,
    );

    const state = q<HTMLSelectElement>(
      document,
      ".journal-github-controls select",
    );
    state.value = "closed";
    change(state);

    await waitFor(
      () =>
        posts.filter((post) => post.action === "list-github-issues").length ===
        2,
    );
    expect(posts[1]?.state).toBe("closed");
  });

  test("shows unscoped linked GitHub issues without a repo filter", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === "GET")
          return json(journalData([task({ labels: ["github", "issue-1"] })]));
        return json({
          issues: [
            {
              number: 1,
              title: "Linked issue",
              state: "open",
              labels: [],
            },
          ],
        });
      }) as typeof fetch,
    });

    const view = createView({ screen: "journal", tab: "tasks", range: RANGE });
    await view.enter();
    click(q(document, ".journal-github-toggle"));
    await waitFor(
      () =>
        document
          .querySelector(".journal-github-issue-card")
          ?.classList.contains("linked") === true,
    );

    expect(
      q(document, ".journal-github-issue-action").textContent?.trim(),
    ).toBe(TEXT.githubOpenTask);
  });

  test("keeps the selected task when delete returns removed false", async () => {
    const setRouteCalls: AppRoute[] = [];
    const posts: Array<Record<string, unknown>> = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === "GET") return json(journalData());
        const body = JSON.parse(String(init.body || "{}")) as Record<
          string,
          unknown
        >;
        posts.push(body);
        if (body.action === "delete-task")
          return json({ ok: true, removed: false, generation: 1 });
        return json({ ok: true, generation: 1 });
      }) as typeof fetch,
    });

    const view = createView(
      { screen: "journal", tab: "tasks", task: "t-1", range: RANGE },
      setRouteCalls,
    );
    await view.enter();
    const del = q(document, ".journal-danger-action");
    click(del);
    expect(document.querySelector(".gdp-dialog")).toBeTruthy();
    click(q(document, ".gdp-dialog-danger"));

    await waitFor(() => posts.some((post) => post.action === "delete-task"));
    await waitFor(
      () =>
        q(document, ".journal-status").textContent === TEXT.deleteTaskFailed,
    );
    expect(setRouteCalls).toEqual([]);
    expect(q(document, ".journal-status").textContent).toBe(
      TEXT.deleteTaskFailed,
    );
    expect(
      q(document, ".journal-task-card.selected").textContent || "",
    ).toMatch(/Sample task/);
  });

  test("adds a suggested label chip to the task save payload", async () => {
    const posts: Array<Record<string, unknown>> = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === "GET")
          return json(journalData([task({ labels: ["sample"] })]));
        const body = JSON.parse(String(init.body || "{}")) as Record<
          string,
          unknown
        >;
        posts.push(body);
        return json({
          ok: true,
          task: task({ labels: body.labels as string[] }),
        });
      }) as typeof fetch,
    });

    const view = createView({
      screen: "journal",
      tab: "tasks",
      task: "t-1",
      range: RANGE,
    });
    await view.enter();

    const suggestion = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".journal-label-editor-quick-chip",
      ),
    ].find((button) => button.textContent === "ui");
    expect(suggestion).toBeTruthy();
    click(suggestion);
    click(q(document, ".journal-primary-action"));

    await waitFor(() => posts.some((post) => post.action === "update-task"));
    const update = posts.find((post) => post.action === "update-task");
    expect(update?.labels).toEqual(["sample", "ui"]);
    expect(
      [...document.querySelectorAll(".journal-label-editor-quick-chip")].some(
        (button) => button.textContent === "ui",
      ),
    ).toBe(false);
  });

  test("starts task drag only from the card handle", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
        json(
          journalData([
            task({ id: "t-1", title: "First task" }),
            task({ id: "t-2", title: "Second task" }),
          ]),
        )) as typeof fetch,
    });

    const view = createView({ screen: "journal", tab: "tasks", range: RANGE });
    await view.enter();

    const card = q(document, '.journal-task-card[data-task-id="t-1"]');
    const bodyDrag = dragStart(card);
    expect(bodyDrag.defaultPrevented).toBe(true);
    expect(card.classList.contains("dragging")).toBe(false);

    const dataTransfer = fakeDataTransfer();
    const handleDrag = dragStart(
      q(card, ".journal-task-drag-handle"),
      dataTransfer,
    );
    expect(handleDrag.defaultPrevented).toBe(false);
    expect(card.classList.contains("dragging")).toBe(true);
    expect(dataTransfer.dragImages[0]?.element).toBe(card);
  });

  test("does not move a task after leaving a stale native drop target", async () => {
    const posts: Array<Record<string, unknown>> = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === "GET")
          return json(
            journalData([
              task({ id: "t-1", title: "First task" }),
              task({ id: "t-2", title: "Second task" }),
            ]),
          );
        const body = JSON.parse(String(init.body || "{}")) as Record<
          string,
          unknown
        >;
        posts.push(body);
        return json({ ok: true, generation: 1 });
      }) as typeof fetch,
    });
    const elementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => null,
    });

    try {
      const view = createView({
        screen: "journal",
        tab: "tasks",
        range: RANGE,
      });
      await view.enter();

      const source = q(document, '.journal-task-card[data-task-id="t-1"]');
      const target = q(document, '.journal-task-card[data-task-id="t-2"]');
      dragStart(q(source, ".journal-task-drag-handle"));
      target.dispatchEvent(
        new Event("dragenter", { bubbles: true, cancelable: true }),
      );
      target.dispatchEvent(
        new Event("dragleave", { bubbles: true, cancelable: true }),
      );
      source.dispatchEvent(
        new Event("dragend", { bubbles: true, cancelable: true }),
      );

      await Promise.resolve();
      expect(posts.some((post) => post.action === "move-task")).toBe(false);
    } finally {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: elementFromPoint,
      });
    }
  });

  test("keeps a moved task selected after the refresh", async () => {
    const posts: Array<Record<string, unknown>> = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === "GET")
          return json(
            journalData([
              task({ id: "t-1", title: "First task" }),
              task({ id: "t-2", title: "Second task" }),
            ]),
          );
        const body = JSON.parse(String(init.body || "{}")) as Record<
          string,
          unknown
        >;
        posts.push(body);
        return json({ ok: true, generation: 1 });
      }) as typeof fetch,
    });

    const view = createView({ screen: "journal", tab: "tasks", range: RANGE });
    await view.enter();

    const source = q(document, '.journal-task-card[data-task-id="t-1"]');
    const target = q(document, '.journal-task-card[data-task-id="t-2"]');
    dragStart(q(source, ".journal-task-drag-handle"));
    target.dispatchEvent(
      new Event("drop", { bubbles: true, cancelable: true }),
    );

    await waitFor(() => posts.some((post) => post.action === "move-task"));
    await waitFor(() =>
      q(document, '.journal-task-card[data-task-id="t-1"]').classList.contains(
        "selected",
      ),
    );
    const move = posts.find((post) => post.action === "move-task");
    expect(move?.id).toBe("t-1");
    expect(move?.before_id).toBe("t-2");
  });

  test("does not refresh from SSE while the task editor has focus", async () => {
    let getCount = 0;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === "GET") {
          getCount++;
          return json(journalData());
        }
        return json({ ok: true, generation: 1 });
      }) as typeof fetch,
    });

    const view = createView({ screen: "journal", tab: "tasks", range: RANGE });
    await view.enter();
    expect(getCount).toBe(1);

    q<HTMLInputElement>(
      document,
      ".journal-task-editor .journal-title-input",
    ).focus();
    view.handleSse();
    await Promise.resolve();
    expect(getCount).toBe(1);

    q<HTMLInputElement>(
      document,
      ".journal-task-editor .journal-title-input",
    ).blur();
    view.handleSse();
    await waitFor(() => getCount === 2);
  });

  test("closes the GitHub issue panel with Escape and outside pointerdown", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === "GET") return json(journalData());
        return json({ issues: [] });
      }) as typeof fetch,
    });

    const view = createView({ screen: "journal", tab: "tasks", range: RANGE });
    await view.enter();

    click(q(document, ".journal-github-toggle"));
    expect(document.querySelector(".journal-github-panel")).toBeTruthy();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );
    expect(document.querySelector(".journal-github-panel")).toBeNull();

    click(q(document, ".journal-github-toggle"));
    expect(document.querySelector(".journal-github-panel")).toBeTruthy();
    document.body.dispatchEvent(
      new Event("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(document.querySelector(".journal-github-panel")).toBeNull();
  });
});
