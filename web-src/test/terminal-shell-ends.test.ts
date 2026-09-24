// シェルが終わったターミナルのタブを閉じるための部品 (views/terminal/shell-ends.ts)。
//
// 前面でないタブには「終わった」が届かないので、全画面共通の取り直しに載る
// 生きているシェルの一覧から拾う。拾い損ねるとタブが残り、拾い過ぎると
// 開いた直後のタブ (次の一覧に載る前) が閉じる。

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
import {
  createShellEndNotice,
  createShellEndTracker,
  SHELL_END_NOTICE_MS,
} from "../views/terminal/shell-ends";

describe("createShellEndTracker", () => {
  // server は一覧を返したサーバ (serverInstance)。替わったら入口が起き直した。
  test.each([
    {
      name: "前回あって今回無い、タブのシェルを返す",
      rounds: [
        {
          live: ["shell-a", "shell-b"],
          tabbed: ["shell-a", "shell-b"],
          server: "s1",
        },
        { live: ["shell-b"], tabbed: ["shell-a", "shell-b"], server: "s1" },
      ],
      expected: [
        { ended: [], lost: [] },
        { ended: ["shell-a"], lost: [] },
      ],
    },
    {
      name: "一覧でまだ見ていないタブのシェル (開いた直後) は返さない",
      rounds: [
        { live: ["shell-a"], tabbed: ["shell-a"], server: "s1" },
        { live: ["shell-a"], tabbed: ["shell-a", "shell-new"], server: "s1" },
      ],
      expected: [
        { ended: [], lost: [] },
        { ended: [], lost: [] },
      ],
    },
    {
      name: "タブで開いていないシェルが終わっても返さない",
      rounds: [
        { live: ["shell-a", "shell-b"], tabbed: ["shell-a"], server: "s1" },
        { live: ["shell-a"], tabbed: ["shell-a"], server: "s1" },
      ],
      expected: [
        { ended: [], lost: [] },
        { ended: [], lost: [] },
      ],
    },
    {
      name: "同じ終わりを 2 度返さない",
      rounds: [
        { live: ["shell-a"], tabbed: ["shell-a"], server: "s1" },
        { live: [], tabbed: ["shell-a"], server: "s1" },
        { live: [], tabbed: ["shell-a"], server: "s1" },
      ],
      expected: [
        { ended: [], lost: [] },
        { ended: ["shell-a"], lost: [] },
        { ended: [], lost: [] },
      ],
    },
    {
      name: "初めての一覧では何も返さない (読み込み直後。消えたタブは起動時に繋ぎ直す)",
      rounds: [{ live: [], tabbed: ["shell-a"], server: "s1" }],
      expected: [{ ended: [], lost: [] }],
    },
    {
      name: "サーバが替わったら、無くなったタブのシェルを閉じる側でなく lost に返す",
      rounds: [
        {
          live: ["shell-a", "shell-b"],
          tabbed: ["shell-a", "shell-b"],
          server: "s1",
        },
        { live: [], tabbed: ["shell-a", "shell-b"], server: "s2" },
      ],
      expected: [
        { ended: [], lost: [] },
        { ended: [], lost: ["shell-a", "shell-b"] },
      ],
    },
    {
      name: "サーバが替わったとき、一覧で見ていなかったタブのシェルも lost に入れ、生きているものは入れない",
      rounds: [
        { live: ["shell-a"], tabbed: ["shell-a"], server: "s1" },
        {
          live: ["shell-new"],
          tabbed: ["shell-a", "shell-new", "shell-unseen"],
          server: "s2",
        },
      ],
      expected: [
        { ended: [], lost: [] },
        { ended: [], lost: ["shell-a", "shell-unseen"] },
      ],
    },
    {
      name: "替わった後のサーバでシェルが終わったら、また閉じる側に返す",
      rounds: [
        { live: ["shell-a"], tabbed: ["shell-a"], server: "s1" },
        { live: ["shell-a"], tabbed: ["shell-a"], server: "s2" },
        { live: [], tabbed: ["shell-a"], server: "s2" },
      ],
      expected: [
        { ended: [], lost: [] },
        { ended: [], lost: [] },
        { ended: ["shell-a"], lost: [] },
      ],
    },
  ])("$name", ({ rounds, expected }) => {
    const tracker = createShellEndTracker();
    expect(
      rounds.map((round) =>
        tracker.update(round.live, round.tabbed, round.server),
      ),
    ).toEqual(expected);
  });
});

describe("createShellEndNotice", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  test("最下段の既存の吹き出しの形で出し、しばらくして隠す。続けて出せば最後の文言", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const notice = createShellEndNotice(host);
    const el = host.querySelector<HTMLElement>(".goi-feedback");
    notice.show("claude · Idle has ended.");
    vi.advanceTimersByTime(SHELL_END_NOTICE_MS - 1);
    notice.show("Shell 2 has ended.");
    vi.advanceTimersByTime(SHELL_END_NOTICE_MS - 1);
    const shown = [el?.hidden, el?.textContent, el?.getAttribute("role")];
    vi.advanceTimersByTime(1);
    expect([shown, el?.hidden]).toEqual([
      [false, "Shell 2 has ended.", "status"],
      true,
    ]);
  });
});
