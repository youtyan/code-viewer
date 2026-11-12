// git のリポジトリでないプロジェクト (git の外のフォルダを登録したもの) で、git が
// 要る画面と操作を押せなくする決まり (core/git-features.ts) と、その案内
// (views/git-unavailable.ts)・ファイルの Blame / History のタブ (views/file-shell.ts)。

import "./_dom";
import { readFileSync } from "node:fs";
import { render } from "lit/html.js";
import { afterEach, describe, expect, test } from "vitest";
import {
  actionNeedsGit,
  gitFeaturesUnavailable,
  pageNeedsGit,
  routeNeedsGit,
} from "../core/git-features";
import type { AppRoute } from "../core/routes";
import { fileViewTabsTemplate } from "../views/file-shell";
import {
  createGitUnavailable,
  GIT_UNAVAILABLE_TEXT,
  type GitUnavailableProps,
  gitUnavailableReason,
  markGitEntryPoints,
  setGitRepositoryState,
} from "../views/git-unavailable";
import { flushRenders } from "../views/ui/render-queue";

const range = { from: "HEAD", to: "worktree" };

afterEach(() => {
  setGitRepositoryState("unknown");
  document.documentElement.lang = "";
  document.body.innerHTML = "";
  document.body.removeAttribute("data-git-unavailable");
  document.head.innerHTML = "";
});

describe("which screens need git", () => {
  test.each<[string, AppRoute, boolean]>([
    ["Diff", { screen: "diff", range }, true],
    ["History", { screen: "history", ref: "HEAD", range }, true],
    ["Worktrees", { screen: "worktree", range }, true],
    [
      "the folder view of the worktree",
      { screen: "repo", ref: "worktree", path: "", range },
      false,
    ],
    [
      "the folder view of another ref",
      { screen: "repo", ref: "main", path: "", range },
      true,
    ],
    [
      "a worktree file",
      { screen: "file", path: "a.txt", ref: "worktree", view: "blob", range },
      false,
    ],
    [
      "a file of another ref",
      { screen: "file", path: "a.txt", ref: "HEAD", view: "blob", range },
      true,
    ],
    [
      "the blame of a worktree file",
      { screen: "file", path: "a.txt", ref: "worktree", view: "blame", range },
      true,
    ],
    [
      "the history of a worktree file",
      {
        screen: "file",
        path: "a.txt",
        ref: "worktree",
        view: "history",
        range,
      },
      true,
    ],
    ["search", { screen: "search", range }, false],
    ["tools", { screen: "tools", range }, false],
    ["agents", { screen: "agents", range }, false],
    ["the data store", { screen: "database", range }, false],
    ["the work log", { screen: "journal", range }, false],
  ])("%s: %s", (_name, route, expected) => {
    expect(routeNeedsGit(route)).toBe(expected);
  });

  test("only the pages that run git are git pages", () => {
    expect(
      ["repo", "diff", "history", "worktree", "database", "journal"].filter(
        pageNeedsGit,
      ),
    ).toEqual(["diff", "history", "worktree"]);
  });

  // "unknown" (git が無い・所有権のエラー) は git の外と決めつけず、git の失敗を出す。
  test("only a folder known to be outside git turns the features off", () => {
    expect(
      (["inside", "outside", "unknown"] as const).map(gitFeaturesUnavailable),
    ).toEqual([false, true, false]);
  });

  test("the reason follows the state and the page language", () => {
    const reasons = () => {
      document.documentElement.lang = "en";
      const en = gitUnavailableReason();
      document.documentElement.lang = "ja";
      return [en, gitUnavailableReason()];
    };
    expect(reasons()).toEqual([null, null]);
    setGitRepositoryState("outside");
    expect(reasons()).toEqual([
      GIT_UNAVAILABLE_TEXT.en.reason,
      GIT_UNAVAILABLE_TEXT.ja.reason,
    ]);
  });
});

describe("the entry points of git screens", () => {
  // 画面の入口の列: git が要る入口だけを押せない印にし、title に理由。戻せば名前に戻る。
  test("the view strip marks Diff, History and Worktrees and says why", () => {
    document.body.innerHTML = ["repo", "diff", "history", "worktree", "journal"]
      .map(
        (route) =>
          `<a class="view-strip-item" data-route="${route}" aria-label="${route} name" title="${route} name"></a>`,
      )
      .join("");
    const links = () => [
      ...document.querySelectorAll<HTMLElement>(".view-strip-item"),
    ];
    const marks = () =>
      links().map((link) => [
        link.dataset.route,
        link.getAttribute("aria-disabled"),
        link.title,
      ]);
    markGitEntryPoints(links(), "sample reason");
    expect(marks()).toEqual([
      ["repo", null, "repo name"],
      ["diff", "true", "sample reason"],
      ["history", "true", "sample reason"],
      ["worktree", "true", "sample reason"],
      ["journal", null, "journal name"],
    ]);
    markGitEntryPoints(links(), null);
    expect(marks()).toEqual([
      ["repo", null, "repo name"],
      ["diff", null, "diff name"],
      ["history", null, "history name"],
      ["worktree", null, "worktree name"],
      ["journal", null, "journal name"],
    ]);
  });

  // キーとパレットの行: git が要る画面へ移る操作だけ (ほかの画面へ移る操作は残す)。
  test("only the keys that open git screens are refused", () => {
    expect(
      [
        "goto-repo",
        "goto-diff",
        "goto-history",
        "goto-worktrees",
        "goto-database",
        "goto-journal",
        "goto-agents",
        "goto-search",
        "goto-tools",
      ].filter(actionNeedsGit),
    ).toEqual(["goto-diff", "goto-history", "goto-worktrees"]);
  });
});

describe("the notice on a git-only screen", () => {
  function setup() {
    const host = document.createElement("div");
    document.body.append(host);
    const seen: GitUnavailableProps[] = [];
    let opened = 0;
    let language: "en" | "ja" = "en";
    const notice = createGitUnavailable(
      {
        host,
        text: () => GIT_UNAVAILABLE_TEXT[language],
        openFiles: () => {
          opened += 1;
        },
      },
      (props) => {
        seen.push(props);
        return null;
      },
    );
    const last = () => {
      flushRenders();
      const props = seen[seen.length - 1];
      if (!props) throw new Error("the notice was never drawn");
      return props;
    };
    return {
      notice,
      last,
      opened: () => opened,
      setLanguage: (next: "en" | "ja") => {
        language = next;
      },
    };
  }

  test("shows the reason, marks the page and goes back to the files", () => {
    const { notice, last, opened } = setup();
    notice.show();
    expect({
      shown: last().shown,
      title: last().title,
      hint: last().hint,
      marked: document.body.hasAttribute("data-git-unavailable"),
    }).toEqual({
      shown: true,
      title: GIT_UNAVAILABLE_TEXT.en.title,
      hint: GIT_UNAVAILABLE_TEXT.en.hint,
      marked: true,
    });
    last().onOpenFiles();
    expect(opened()).toBe(1);
    notice.hide();
    expect({
      shown: last().shown,
      marked: document.body.hasAttribute("data-git-unavailable"),
    }).toEqual({ shown: false, marked: false });
  });

  test("redraws in the new language", () => {
    const { notice, last, setLanguage } = setup();
    notice.show();
    setLanguage("ja");
    notice.localize();
    expect(last().title).toBe(GIT_UNAVAILABLE_TEXT.ja.title);
  });

  // 実物の style.css: 案内を出している間は本文のほかの中身 (差分・空の案内) を
  // 隠し、案内の箱だけを出す。
  test("hides the rest of the main content while it is shown", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("web/style.css", "utf8");
    document.head.append(style);
    // 差分の画面の道具の帯 (#topbar。ref の選択・Split / Unified) も git の部品
    // なので隠す (案内の上に残っていた)。
    document.body.innerHTML = `<header id="topbar"></header><main id="content"><div id="git-unavailable"></div><div id="diff"></div><div id="empty" class="empty"></div></main>`;
    const shown = () =>
      ["#git-unavailable", "#diff", "#empty", "#topbar"].map(
        (selector) =>
          getComputedStyle(document.querySelector(selector) as HTMLElement)
            .display !== "none",
      );
    expect(shown()).toEqual([true, true, true, true]);
    document.body.setAttribute("data-git-unavailable", "");
    expect(shown()).toEqual([true, false, false, false]);
  });
});

describe("the Blame and History tabs of a file", () => {
  function tabs(): {
    buttons: () => HTMLButtonElement[];
    routes: AppRoute[];
  } {
    const routes: AppRoute[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    render(
      fileViewTabsTemplate(
        {
          currentRange: () => range,
          setRoute: (route) => routes.push(route),
        },
        { path: "notes.txt", ref: "worktree" },
        "code",
        { previewable: false },
      ),
      host,
    );
    return {
      buttons: () => [
        ...host.querySelectorAll<HTMLButtonElement>(
          'button[data-file-view="blame"], button[data-file-view="history"]',
        ),
      ],
      routes,
    };
  }

  test("cannot be pressed outside git and say why", () => {
    document.documentElement.lang = "en";
    setGitRepositoryState("outside");
    const { buttons, routes } = tabs();
    expect(
      buttons().map((button) => [
        button.dataset.fileView,
        button.disabled,
        button.title,
      ]),
    ).toEqual([
      ["blame", true, GIT_UNAVAILABLE_TEXT.en.reason],
      ["history", true, GIT_UNAVAILABLE_TEXT.en.reason],
    ]);
    for (const button of buttons()) button.click();
    expect(routes).toEqual([]);
  });

  test("open their screens in a repository", () => {
    setGitRepositoryState("inside");
    const { buttons, routes } = tabs();
    expect(buttons().map((button) => button.disabled)).toEqual([false, false]);
    buttons()[0]?.click();
    expect(routes).toEqual([
      {
        screen: "file",
        path: "notes.txt",
        ref: "worktree",
        view: "blame",
        range,
      },
    ]);
  });
});
