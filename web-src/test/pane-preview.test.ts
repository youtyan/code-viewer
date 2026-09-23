// エージェントの行に載せたときのシェルの覗き窓。
//
// 守りたいのは次のこと。
// - 載せて 0.4 秒で出す (通りすがりでは問い合わせない)。出ている間の乗り換えは待たない
// - 出ている間は 1 秒ごとに取り直し、問い合わせは常に 1 本。離れたら取り消して止める
// - キーボードで来たときも出す。Esc で消す。描き直しで同じ行へ戻ったフォーカスでは
//   出し直さない
// - 押したら消す (行は今までどおり開く)。指・電話の画面では出さない
// - 読み上げは中身でなく「プレビュー: 行の名前」
// - 窓の位置と、画面の文字から出す行 (純関数の表)

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  PANE_PREVIEW_DELAY_MS,
  PANE_PREVIEW_REFRESH_MS,
  panePreviewLines,
  panePreviewPosition,
} from "../core/pane-preview";
import { agentsText } from "../views/agents/i18n";
import {
  createPanePreview,
  markPreviewRow,
  PaneGoneError,
  type PanePreview,
} from "../views/agents/pane-preview";

describe("panePreviewLines", () => {
  const ESC = String.fromCharCode(27);
  test.each<[string, string, number, string[]]>([
    ["keeps the last lines", "a\nb\nc\nd", 2, ["c", "d"]],
    ["drops the blank rows under the prompt", "a\nb\n\n  \n", 5, ["a", "b"]],
    [
      "strips colours and trailing spaces",
      `${ESC}[31mred${ESC}[0m   \n${ESC}[1mbold${ESC}[0m`,
      5,
      ["red", "bold"],
    ],
    ["drops carriage returns", "a\r\nb\r\n", 5, ["a", "b"]],
    ["keeps blank rows between lines", "a\n\nb", 5, ["a", "", "b"]],
    ["an empty screen has no lines", "\n\n\n", 5, []],
  ])("%s", (_label, content, lines, expected) => {
    expect(panePreviewLines(content, lines)).toEqual(expected);
  });
});

describe("panePreviewPosition", () => {
  const viewport = { width: 1280, height: 800 };
  const size = { width: 720, height: 400 };
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
  });
  test.each<
    [string, "right" | "below", ReturnType<typeof rect>, [number, number]]
  >([
    // 左のサイドバーの行 (幅 260) の右に、行の上端をそろえて。
    ["right of a sidebar row", "right", rect(8, 120, 252, 44), [268, 120]],
    // 下に入りきらなければ上へ寄せる (800 - 400 - 8)。
    [
      "right, pushed up at the bottom",
      "right",
      rect(8, 700, 252, 44),
      [268, 392],
    ],
    // 右に入りきらなければ左へ寄せる (1280 - 720 - 8)。
    [
      "right, pushed left at the edge",
      "right",
      rect(600, 120, 252, 44),
      [552, 120],
    ],
    // 全体ボードの行の下。
    ["below a board row", "below", rect(300, 100, 900, 48), [300, 156]],
    // 下に入らなければ行の上 (500 - 8 - 400)。
    [
      "above a board row near the bottom",
      "below",
      rect(300, 500, 900, 48),
      [300, 92],
    ],
    // 上にも入らなければ下に出して画面の中へ寄せる。
    [
      "below, clamped when neither side fits",
      "below",
      rect(300, 380, 900, 48),
      [300, 392],
    ],
    [
      "below, pushed left at the edge",
      "below",
      rect(900, 100, 300, 48),
      [552, 156],
    ],
  ])("%s", (_label, placement, anchor, [left, top]) => {
    expect(panePreviewPosition({ anchor, size, viewport, placement })).toEqual({
      left,
      top,
    });
  });
});

describe("pane preview", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  type Read = {
    pane: string;
    signal: AbortSignal;
    resolve(content: string): void;
    reject(error: unknown): void;
  };
  let reads: Read[];
  let finger: boolean;
  let preview: PanePreview;
  let stop: () => void;
  let container: HTMLElement;
  const text = agentsText("en").preview;

  function row(pane: string, name: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-agent";
    button.tabIndex = -1;
    markPreviewRow(button, pane, name);
    return button;
  }

  function rows(): HTMLButtonElement[] {
    return [...container.querySelectorAll<HTMLButtonElement>("button")];
  }

  function draw(): void {
    container.replaceChildren(
      row("%1", "claude · Review plan · work:0.0"),
      row("%2", "codex · Add tests · work:1.0"),
    );
  }

  /** ポインタの位置。動かす (move) たびにずらす。 */
  let x = 0;
  function pointer(type: string, target: Element, pointerType = "mouse") {
    if (type === "pointermove") x += 1;
    const event = new PointerEvent(type, {
      bubbles: true,
      pointerType,
      clientX: x,
      clientY: 10,
    });
    target.dispatchEvent(event);
  }

  function box(): HTMLElement | null {
    return document.querySelector<HTMLElement>(".pane-preview");
  }

  function shownPane(): string | null {
    const el = box();
    return el && !el.hidden ? preview.current() : null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    reads = [];
    finger = false;
    document.body.innerHTML = '<div id="list"></div>';
    container = document.querySelector<HTMLElement>("#list") as HTMLElement;
    draw();
    preview = createPanePreview({
      read: (pane, signal) =>
        new Promise<string>((resolve, reject) => {
          reads.push({ pane, signal, resolve, reject });
        }),
      fingerScreen: () => finger,
    });
    stop = preview.watch(container, {
      placement: "right",
      getText: () => text,
    });
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("appears 0.4 s after the pointer rests on a row, not before", async () => {
    const [first] = rows();
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS - 1);
    expect([reads.length, shownPane()]).toEqual([0, null]);
    await vi.advanceTimersByTimeAsync(1);
    expect([reads.map((r) => r.pane), shownPane()]).toEqual([["%1"], "%1"]);
    expect(box()?.querySelector("pre")?.textContent).toBe(text.loading);
    reads[0]?.resolve("line 1\nline 2\n\n");
    await vi.advanceTimersByTimeAsync(0);
    expect([
      box()?.querySelector(".pane-preview-head")?.textContent,
      box()?.querySelector("pre")?.textContent,
    ]).toEqual(["claude · Review plan · work:0.0", "line 1\nline 2"]);
  });

  test("passing over a row without resting asks nothing", async () => {
    const [first, second] = rows();
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(200);
    pointer("pointermove", container);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    pointer("pointermove", second as Element);
    await vi.advanceTimersByTimeAsync(200);
    pointer("pointerleave", container);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS * 3);
    expect([reads.length, shownPane()]).toEqual([0, null]);
  });

  test("refreshes every second while shown, one request at a time", async () => {
    const [first] = rows();
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    // 応答が返らない間は、何秒経っても 2 本目を出さない。
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_REFRESH_MS * 5);
    expect(reads.length).toBe(1);
    reads[0]?.resolve("one");
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_REFRESH_MS - 1);
    expect(reads.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(reads.length).toBe(2);
    reads[1]?.resolve("two");
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_REFRESH_MS);
    expect([
      reads.map((r) => r.pane),
      reads.filter((r) => !r.signal.aborted).length,
      box()?.querySelector("pre")?.textContent,
    ]).toEqual([["%1", "%1", "%1"], 3, "two"]);
  });

  test("leaving the list hides it, cancels the request and stops asking", async () => {
    const [first] = rows();
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    pointer("pointerleave", container);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_REFRESH_MS * 5);
    expect([
      shownPane(),
      box()?.hidden,
      reads.length,
      reads[0]?.signal.aborted,
    ]).toEqual([null, true, 1, true]);
    // 取り消した後に返ってきた応答は描かない。
    reads[0]?.resolve("late");
    await vi.advanceTimersByTimeAsync(0);
    expect(box()?.querySelector("pre")?.textContent).toBe(text.loading);
  });

  test("moving to another row while shown switches at once and asks only for it", async () => {
    const [first, second] = rows();
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    pointer("pointermove", second as Element);
    expect([shownPane(), reads.map((r) => [r.pane, r.signal.aborted])]).toEqual(
      [
        "%2",
        [
          ["%1", true],
          ["%2", false],
        ],
      ],
    );
  });

  test("a redraw that replaces the rows keeps it on the same pane", async () => {
    const [first] = rows();
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    draw();
    reads[0]?.resolve("after redraw");
    await vi.advanceTimersByTimeAsync(0);
    expect([
      shownPane(),
      rows()[0]?.getAttribute("aria-describedby"),
      box()?.querySelector("pre")?.textContent,
    ]).toEqual(["%1", "pane-preview", "after redraw"]);
    // 行が無くなったら (エージェントが終わった) 消える。
    container.replaceChildren(row("%2", "codex · Add tests · work:1.0"));
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_REFRESH_MS);
    reads[1]?.resolve("gone row");
    await vi.advanceTimersByTimeAsync(0);
    expect(shownPane()).toBe(null);
  });

  test("the keyboard shows it too, Escape hides it, and a redraw does not bring it back", async () => {
    const [first, second] = rows();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    first?.focus();
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    expect(shownPane()).toBe("%1");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect([shownPane(), reads[0]?.signal.aborted]).toEqual([null, true]);
    // 描き直しが同じペインの新しい行へフォーカスを戻しても、出し直さない。
    draw();
    rows()[0]?.focus();
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS * 2);
    expect([shownPane(), reads.length]).toEqual([null, 1]);
    // ほかの行へ移れば出す。
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    rows()[1]?.focus();
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    expect(shownPane()).toBe("%2");
    expect(second?.isConnected).toBe(false);
  });

  test("focus that leaves the rows hides a preview the keyboard opened", async () => {
    const [first] = rows();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    first?.focus();
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    expect(shownPane()).toBe("%1");
    outside.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(shownPane()).toBe(null);
  });

  test("a click focus (not the keyboard) does not show it", async () => {
    const [first] = rows();
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    first?.focus();
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS * 2);
    expect(reads.length).toBe(0);
  });

  // 描き直しで行が差し替わると、ブラウザは止まったポインタの下の要素へ over と
  // (位置の変わらない) move を送る。それでは出さない・押して消したものを戻さない。
  test("a pointer that has not moved does not show it (the rows were redrawn under it)", async () => {
    const [first] = rows();
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    pointer("pointerdown", first as Element);
    draw();
    const redrawn = rows()[0] as Element;
    redrawn.dispatchEvent(
      new PointerEvent("pointerover", {
        bubbles: true,
        pointerType: "mouse",
        clientX: x,
        clientY: 10,
      }),
    );
    container.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerType: "mouse",
        clientX: x,
        clientY: 10,
      }),
    );
    redrawn.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerType: "mouse",
        clientX: x,
        clientY: 10,
      }),
    );
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS * 3);
    expect([shownPane(), reads.length]).toEqual([null, 1]);
  });

  test("pressing a row hides it and it stays hidden until the pointer leaves", async () => {
    const [first] = rows();
    const opened: string[] = [];
    first?.addEventListener("click", () => opened.push("%1"));
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    pointer("pointerdown", first as Element);
    first?.click();
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS * 2);
    expect([shownPane(), opened, reads.length]).toEqual([null, ["%1"], 1]);
    pointer("pointerleave", container);
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    expect(shownPane()).toBe("%1");
  });

  test.each([
    ["a finger", "touch", false],
    ["a pen", "pen", false],
    ["a mouse on a phone-sized or touch screen", "mouse", true],
  ])("%s does not show it", async (_label, pointerType, fingerScreen) => {
    finger = fingerScreen;
    const [first] = rows();
    pointer("pointermove", first as Element, pointerType);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS * 2);
    expect([reads.length, shownPane()]).toEqual([0, null]);
  });

  test("screen readers hear a preview label, not the screen", async () => {
    const [first] = rows();
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    const el = box();
    expect([
      el?.getAttribute("role"),
      el?.getAttribute("aria-label"),
      first?.getAttribute("aria-describedby"),
      el?.querySelector("pre")?.getAttribute("aria-hidden"),
      el?.querySelector(".pane-preview-head")?.getAttribute("aria-hidden"),
    ]).toEqual([
      "tooltip",
      "Preview: claude · Review plan · work:0.0",
      "pane-preview",
      "true",
      "true",
    ]);
    pointer("pointerleave", container);
    expect(first?.hasAttribute("aria-describedby")).toBe(false);
  });

  test("a closed pane says so and stops asking; other failures keep the reason and retry", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const [first] = rows();
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    reads[0]?.reject(new Error("GET /_agent/capture (HTTP 500): tmux failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect([
      box()?.querySelector("pre")?.textContent,
      error.mock.calls.length,
    ]).toEqual([
      text.failed("Error: GET /_agent/capture (HTTP 500): tmux failed"),
      1,
    ]);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_REFRESH_MS);
    expect(reads.length).toBe(2);
    reads[1]?.reject(new PaneGoneError("GET /_agent/capture (HTTP 410)"));
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_REFRESH_MS * 3);
    expect([
      box()?.querySelector("pre")?.textContent,
      reads.length,
      error.mock.calls.length,
    ]).toEqual([text.gone, 2, 1]);
  });

  test("hides while paused (a heading is being dragged)", async () => {
    const [first] = rows();
    pointer("pointermove", first as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS);
    preview.setPaused(true);
    pointer("pointermove", rows()[1] as Element);
    await vi.advanceTimersByTimeAsync(PANE_PREVIEW_DELAY_MS * 2);
    expect([shownPane(), reads.length]).toEqual([null, 1]);
    preview.setPaused(false);
  });
});
