// 「プロジェクトを追加」のダイアログ (views/projects/project-directory-dialog.ts)。
// サーバの一覧は偽物で返し、パスの入力・行・上へ・登録・失敗の出し方を見る。
// 最後に、プロジェクトの操作 (registerByPath) が一覧の GET と既存の登録の
// POST を出すことを fetch の差し替えで確かめる。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { ProjectDirectoryListing } from "../core/projects";
import { agentsText } from "../views/agents/i18n";
import { createProjectActions } from "../views/projects/project-actions";
import { showProjectDirectoryDialog } from "../views/projects/project-directory-dialog";
import {
  clickDialogConfirm,
  closeOpenDialog,
  getOpenDialog,
} from "./_dialog-helpers";
import { deferred, waitFor } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  closeOpenDialog();
  vi.unstubAllGlobals();
});

const text = agentsText("en").projects;

/** 偽のサーバ: パスごとの子。無いパスは 404 と同じ文の失敗。 */
const TREE: Record<string, { name: string; git: boolean }[]> = {
  "/": [{ name: "work", git: false }],
  "/work": [
    { name: "sample-app", git: true },
    { name: "sample-notes", git: false },
  ],
  "/work/sample-app": [{ name: "src", git: false }],
  "/work/sample-notes": [],
  "/home/sample": [{ name: "sample-home-app", git: true }],
};

function parentOf(path: string): string | null {
  return path === "/" ? null : path.slice(0, path.lastIndexOf("/")) || "/";
}

function listing(path: string): ProjectDirectoryListing {
  const entries = TREE[path];
  if (!entries) {
    throw new Error(`GET directories (HTTP 404): cannot read ${path}`);
  }
  return {
    path,
    parent: parentOf(path),
    entries,
    total: entries.length,
    truncated: false,
  };
}

/** ~ と末尾の .. はサーバが読み替える (偽物はホームを /home/sample とする)。 */
function fakeList(path: string): ProjectDirectoryListing {
  if (path === "~") return listing("/home/sample");
  if (path.endsWith("/..")) return listing(parentOf(path.slice(0, -3)) ?? "/");
  return listing(path);
}

function open(
  overrides: Partial<Parameters<typeof showProjectDirectoryDialog>[0]> = {},
) {
  const list = vi.fn(async (path: string, _hidden: boolean) => fakeList(path));
  const register = vi.fn(async (_path: string) => undefined);
  const result = showProjectDirectoryDialog({
    text,
    start: "/work",
    list,
    register,
    ...overrides,
  });
  return { list, register, result };
}

function input(): HTMLInputElement {
  const found = getOpenDialog().querySelector<HTMLInputElement>(
    ".project-directory-path",
  );
  if (!found) throw new Error("no path input");
  return found;
}

function rows(): string[] {
  return Array.from(
    getOpenDialog().querySelectorAll<HTMLElement>(".project-directory-row"),
  ).map(
    (row) =>
      `${row.querySelector(".project-directory-name")?.textContent}${
        row.querySelector(".project-directory-git") ? " [git]" : ""
      }`,
  );
}

function row(name: string): HTMLButtonElement {
  const found = Array.from(
    getOpenDialog().querySelectorAll<HTMLButtonElement>(
      ".project-directory-row",
    ),
  ).find(
    (element) =>
      element.querySelector(".project-directory-name")?.textContent === name,
  );
  if (!found) throw new Error(`no row ${name}: ${rows().join(", ")}`);
  return found;
}

function failureText(): string {
  return (
    getOpenDialog().querySelector(".project-directory-error")?.textContent ?? ""
  );
}

async function shows(path: string): Promise<void> {
  await waitFor(() => input().value === path && rows().length > 0);
}

function typeAndEnter(value: string): void {
  input().value = value;
  input().dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
}

describe("going through folders", () => {
  test("opens at the start, with an up row and the git mark", async () => {
    open();
    await shows("/work");
    expect(rows()).toEqual(["..", "sample-app [git]", "sample-notes"]);
  });

  test.each([
    {
      name: "a typed path",
      typed: "/work/sample-app",
      asked: "/work/sample-app",
      shown: "/work/sample-app",
    },
    {
      name: "~ as the home folder",
      typed: "~",
      asked: "~",
      shown: "/home/sample",
    },
  ])("Enter in the path goes to $name, without registering", async ({
    typed,
    asked,
    shown,
  }) => {
    const { list, register } = open();
    await shows("/work");
    typeAndEnter(typed);
    await shows(shown);
    expect(list).toHaveBeenLastCalledWith(asked, false);
    expect(register).not.toHaveBeenCalled();
    expect(document.querySelector(".gdp-dialog-backdrop")).not.toBeNull();
  });

  test("a row goes into that folder, and the up row goes back", async () => {
    const { list } = open();
    await shows("/work");
    row("sample-app").click();
    await shows("/work/sample-app");
    expect(rows()).toEqual(["..", "src"]);
    row("..").click();
    await shows("/work");
    expect(list.mock.calls.map(([path]) => path)).toEqual([
      "/work",
      "/work/sample-app",
      "/work",
    ]);
  });

  test("/ has no up row", async () => {
    open({ start: "/" });
    await shows("/");
    expect(rows()).toEqual(["work"]);
  });

  test("the hidden switch lists the same place again with hidden=true", async () => {
    const { list } = open();
    await shows("/work");
    const hidden = getOpenDialog().querySelector<HTMLInputElement>(
      ".project-directory-hidden input",
    );
    if (!hidden) throw new Error("no hidden switch");
    hidden.checked = true;
    hidden.dispatchEvent(new Event("change"));
    await waitFor(() => list.mock.calls.length === 2);
    expect(list).toHaveBeenLastCalledWith("/work", true);
  });

  test("a list that came back late does not replace the newer one", async () => {
    const slow = deferred<ProjectDirectoryListing>();
    const list = vi.fn(async (path: string) =>
      path === "/work" ? slow.promise : fakeList(path),
    );
    open({ list });
    typeAndEnter("/work/sample-app");
    await shows("/work/sample-app");
    slow.resolve(listing("/work"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(input().value).toBe("/work/sample-app");
    expect(rows()).toEqual(["..", "src"]);
  });

  test("more folders than listed are told", async () => {
    open({
      list: async () => ({
        ...listing("/work"),
        total: 900,
        truncated: true,
      }),
    });
    await shows("/work");
    expect(
      getOpenDialog().querySelector(".project-directory-status")?.textContent,
    ).toBe(text.addProjectTruncated(2, 900));
  });
});

describe("the server's errors are shown as they are", () => {
  test("a place that cannot be listed shows the whole reason and cannot be registered as is", async () => {
    const { register } = open();
    await shows("/work");
    typeAndEnter("/work/sample-missing");
    await waitFor(() => failureText() !== "");
    expect(failureText()).toBe(
      "Error: GET directories (HTTP 404): cannot read /work/sample-missing",
    );
    expect(rows()).toEqual([]);
    clickDialogConfirm();
    await waitFor(
      () =>
        getOpenDialog().querySelectorAll(".gdp-dialog-error")[1]
          ?.textContent !== "",
    );
    expect(register).not.toHaveBeenCalled();
  });

  test("a refused registration keeps the dialog open with the reason", async () => {
    const register = vi.fn(async () => {
      throw new Error(
        "POST /_agent/projects (HTTP 400): /work/sample-notes is not inside a git repository (invalid)",
      );
    });
    open({ register });
    await shows("/work");
    row("sample-notes").click();
    await waitFor(() => input().value === "/work/sample-notes");
    clickDialogConfirm();
    await waitFor(() => register.mock.calls.length === 1);
    const errors = getOpenDialog().querySelectorAll(".gdp-dialog-error");
    await waitFor(() => errors[errors.length - 1]?.textContent !== "");
    expect(errors[errors.length - 1]?.textContent).toBe(
      "Error: POST /_agent/projects (HTTP 400): /work/sample-notes is not inside a git repository (invalid)",
    );
  });
});

describe("registering", () => {
  test("registers the place shown and closes with its path", async () => {
    const { register, result } = open();
    await shows("/work");
    row("sample-app").click();
    await shows("/work/sample-app");
    clickDialogConfirm();
    await expect(result).resolves.toBe("/work/sample-app");
    expect(register).toHaveBeenCalledWith("/work/sample-app");
    expect(document.querySelector(".gdp-dialog-backdrop")).toBeNull();
  });

  test("a typed path not yet entered is listed first and registered as the server writes it", async () => {
    const { register, result } = open();
    await shows("/work");
    input().value = "~";
    clickDialogConfirm();
    await expect(result).resolves.toBe("/home/sample");
    expect(register).toHaveBeenCalledWith("/home/sample");
  });

  test("Add project asks for the parent of this project, then posts the existing registration", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({
          method,
          url,
          ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
        });
        const payload =
          method === "GET"
            ? fakeList(
                new URL(url, "http://127.0.0.1").searchParams.get("path") ?? "",
              )
            : { project: { root: "/work/sample-app" } };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const refresh = vi.fn(async () => undefined);
    const actions = createProjectActions({
      getText: () => text,
      trackLoad: (promise) => promise,
      actionHeaders: () => ({ "X-Code-Viewer-Action": "1" }),
      refresh,
      navigate: () => undefined,
      currentRoot: () => "/work/sample-current",
    });
    const done = actions.registerByPath();
    await shows("/work");
    row("sample-app").click();
    await shows("/work/sample-app");
    clickDialogConfirm();
    await done;
    expect(calls).toEqual([
      {
        method: "GET",
        url: "/_agent/projects/directories?path=%2Fwork%2Fsample-current%2F..",
      },
      {
        method: "GET",
        url: "/_agent/projects/directories?path=%2Fwork%2Fsample-app",
      },
      {
        method: "POST",
        url: "/_agent/projects",
        body: { action: "add", path: "/work/sample-app" },
      },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
