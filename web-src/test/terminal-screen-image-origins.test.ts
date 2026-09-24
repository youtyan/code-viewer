// 棚の画像の出どころ: どのペインのどの行に出たかを棚に添え、ホバーでその
// ペインを枠で示し、「ターミナルで見る」でその行まで戻る
// (views/terminal/terminal-screen.ts・image-shelf.ts)。
//
// 落とすと痛いもの:
//
// - tmux で画面を分けていると、棚の 1 枚がどのペインのどの文字列か分からない
//   (利用者の声)
// - 隣のペインに同じパスが出ていると、ホバーで違うペインの文字を選ぶ
// - 枠がペインの中の文字の上に重なる / 離れても残る
// - 「ターミナルで見る」が、流れた行を示せない (tmux は xterm にスクロール
//   バックを持たないので、tmux に遡らせる)
//
// xterm・EventSource・fetch は外の境界なので差し替える。tmux の応答 (ペインの
// 並びと、どのペインに出たか) も偽物。本物は実画面で確かめる (作業報告)。

import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { ShellSession } from "../core/shell";
import type {
  TerminalImageRef,
  TerminalImageSighting,
  TerminalImagesResponse,
  TerminalPaneLayout,
} from "../core/terminal-images";
import { terminalText } from "../views/terminal/i18n";
import {
  createTerminalScreen,
  type TerminalScreenHandle,
} from "../views/terminal/terminal-screen";

/** 端末の偽物の状態。vi.mock の factory から触るので vi.hoisted で作る。 */
const term = vi.hoisted(() => ({
  /** バッファの行 (0 始まり)。1 字 1 マス。 */
  lines: [] as string[],
  cols: 80,
  rows: 24,
  viewportY: 0,
  selection: null as { column: number; row: number; length: number } | null,
  scrolledTo: [] as number[],
}));

vi.mock("../core/xterm-loader", () => {
  const noop = () => undefined;
  const disposable = () => ({ dispose: noop });
  const bufferLine = (text: string) => ({
    isWrapped: false,
    length: term.cols,
    getCell: (x: number) =>
      x < term.cols
        ? { getChars: () => text[x] ?? "", getWidth: () => 1 }
        : undefined,
    translateToString: (trimRight?: boolean) =>
      trimRight ? text.replace(/\s+$/, "") : text.padEnd(term.cols),
  });
  class FakeTerminal {
    element: HTMLElement | undefined;
    options: Record<string, unknown>;
    modes = { applicationCursorKeysMode: false };
    buffer = {
      active: {
        get viewportY() {
          return term.viewportY;
        },
        baseY: 0,
        cursorY: 0,
        get length() {
          return term.lines.length;
        },
        getLine: (y: number) =>
          y >= 0 && y < term.lines.length
            ? bufferLine(term.lines[y] ?? "")
            : undefined,
      },
    };
    get cols() {
      return term.cols;
    }
    get rows() {
      return term.rows;
    }
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
    }
    open = (parent: HTMLElement) => {
      const root = document.createElement("div");
      root.className = "xterm";
      const screen = document.createElement("div");
      screen.className = "xterm-screen";
      // マス目は 8×16 px。
      Object.defineProperty(screen, "clientWidth", {
        get: () => term.cols * 8,
      });
      Object.defineProperty(screen, "clientHeight", {
        get: () => term.rows * 16,
      });
      root.append(screen);
      parent.append(root);
      this.element = root;
    };
    select = (column: number, row: number, length: number) => {
      term.selection = { column, row, length };
    };
    hasSelection = () => term.selection !== null;
    clearSelection = () => {
      term.selection = null;
    };
    scrollToLine = (line: number) => {
      term.scrolledTo.push(line);
      term.viewportY = line;
    };
    loadAddon = noop;
    registerLinkProvider = disposable;
    onResize = disposable;
    onRender = disposable;
    onScroll = disposable;
    onData = disposable;
    attachCustomKeyEventHandler = noop;
    write = noop;
    reset = noop;
    focus = noop;
    dispose = noop;
    resize = noop;
  }
  class FakeFitAddon {
    activate = noop;
    dispose = noop;
    fit = noop;
    proposeDimensions = () => ({ cols: term.cols, rows: term.rows });
  }
  class FakeWebglAddon {
    activate = noop;
    dispose = noop;
    onContextLoss = disposable;
  }
  return {
    loadXterm: () =>
      Promise.resolve({
        Terminal: FakeTerminal,
        FitAddon: FakeFitAddon,
        WebglAddon: FakeWebglAddon,
      }),
  };
});

const IMAGE: TerminalImageRef = {
  path: "/repo/docs/out.png",
  candidate: "docs/out.png",
  name: "out.png",
  url: "/_agent/image?path=%2Frepo%2Fdocs%2Fout.png&v=1000-3",
  bytes: 3,
  mtimeMs: 1000,
};

/** 左右に分けたウインドウ。左 (0 番) は 39 桁、右 (1 番) は 40 桁。 */
const LAYOUT: TerminalPaneLayout = {
  panes: [
    {
      id: "%1",
      index: 0,
      title: "shell",
      command: "zsh",
      folder: "sample-app",
      left: 0,
      top: 0,
      width: 39,
      height: 23,
    },
    {
      id: "%2",
      index: 1,
      title: "日本語の作業",
      command: "node",
      folder: "sample-app",
      left: 40,
      top: 0,
      width: 40,
      height: 23,
    },
  ],
  statusLines: 1,
  statusAt: "bottom",
};

/** 右のペイン (新しい) と左のペイン (古い) の両方に出た。 */
const SIGHTINGS: TerminalImageSighting[] = [
  {
    candidate: "docs/out.png",
    pane: "%2",
    line: "図を書き出しました docs/out.png",
  },
  { candidate: "docs/out.png", pane: "%1", line: "old docs/out.png" },
];

/** 端末の 1 行: 左のペインの 39 桁、境目、右のペイン。 */
function splitRow(left: string, right: string): string {
  return `${left.padEnd(39)}│${right}`;
}

const SHELL: ShellSession = {
  id: "shell-abc123",
  command: "/bin/zsh -l",
  cwd: "/repo",
  createdAt: "2026-08-01T09:41:58.000Z",
  cols: 80,
  rows: 24,
  exited: false,
  exitCode: null,
  tty: "/dev/ttys001",
};

type Emit = (data: string) => void;
let emitOutput: Emit;
let imagesBody: () => Partial<TerminalImagesResponse>;
let requests: Array<{ url: string; body: string | null; headers: HeadersInit }>;
let statuses: Array<string | null>;
let revealStatus: number;
/** app が渡すエージェントの名前 (サイドバーと同じ)。 */
let agentNames: Map<string, string>;

function installFakes(): void {
  const noop = () => undefined;
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: class {
      static readonly CLOSED = 2;
      readyState = 1;
      onerror = null;
      addEventListener(
        type: string,
        handler: (event: MessageEvent<string>) => void,
      ) {
        if (type !== "output") return;
        emitOutput = (data) =>
          handler({ data: JSON.stringify({ data }) } as MessageEvent<string>);
      }
      close = noop;
    },
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      observe = noop;
      disconnect = noop;
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (input: string, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        body: typeof init?.body === "string" ? init.body : null,
        headers: init?.headers ?? {},
      });
      const base = { source: "pane", cwd: "/repo" };
      let body: unknown;
      if (url.startsWith("/_agent/images/history")) {
        body = {
          images: [],
          rejected: [],
          base,
          pane: null,
          candidates: [],
          lines: 0,
        };
      } else if (url.startsWith("/_agent/images/layout")) {
        body = { layout: imagesBody().layout ?? null };
      } else if (url.startsWith("/_agent/images/reveal")) {
        return Promise.resolve(
          new Response(revealStatus === 200 ? '{"ok":true}' : "tmux: boom", {
            status: revealStatus,
          }),
        );
      } else {
        body = { images: [IMAGE], rejected: [], base, ...imagesBody() };
      }
      return Promise.resolve(new Response(JSON.stringify(body)));
    },
  });
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

let handle: TerminalScreenHandle;

beforeEach(async () => {
  term.lines = [];
  term.cols = 80;
  term.rows = 24;
  term.viewportY = 0;
  term.selection = null;
  term.scrolledTo = [];
  requests = [];
  statuses = [];
  revealStatus = 200;
  agentNames = new Map();
  imagesBody = () => ({ layout: LAYOUT, sightings: SIGHTINGS });
  installFakes();
  document.body.replaceChildren();
  handle = createTerminalScreen({
    trackLoad: (promise) => promise,
    actionHeaders: () => ({ "X-Code-Viewer-Action": "1" }),
    getText: () => terminalText("en"),
    onStatus: (message) => statuses.push(message),
    onTargetGone: () => undefined,
    onShellExited: () => undefined,
    tmuxWindow: () => null,
    onTmuxWindowStale: () => undefined,
    getFontSize: () => 14,
    isImageShelfCollapsed: () => false,
    setImageShelfCollapsed: () => undefined,
    paneName: (id) => agentNames.get(id) ?? null,
  });
  document.body.append(handle.el);
  await handle.attach(SHELL);
});

/** 画像のパスを出力に流し、棚に入るまで待つ。 */
async function showImage(): Promise<HTMLButtonElement> {
  emitOutput("docs/out.png\r\n");
  await flush();
  await flush();
  const open = handle.el.querySelector<HTMLButtonElement>(
    ".terminal-image-shelf-open",
  );
  if (!open) throw new Error("the image was not shelved");
  return open;
}

function frame(): HTMLElement {
  const el = handle.el.querySelector<HTMLElement>(".terminal-pane-frame");
  if (!el) throw new Error("no pane frame");
  return el;
}

function frameBox(): Record<string, string> {
  const el = frame();
  return Object.fromEntries(
    ["--frame-top", "--frame-left", "--frame-rows", "--frame-cols"].map(
      (name) => [name, el.style.getPropertyValue(name)],
    ),
  );
}

/** 右クリックのメニューから選ぶ。 */
function chooseFromMenu(open: HTMLElement, label: string): void {
  open.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
  const item = [
    ...document.querySelectorAll<HTMLButtonElement>(".gdp-context-menu button"),
  ].find((button) => button.textContent === label);
  if (!item) throw new Error(`menu item ${label} is missing`);
  item.click();
}

/** 棚の中の、出た所ごとのまとまり: 見出しと、その下の画像の名前。 */
function shelfGroups(): Array<{ head: string; names: string[] }> {
  return [
    ...handle.el.querySelectorAll<HTMLElement>(".terminal-image-shelf-group"),
  ].map((group) => ({
    head:
      group.querySelector(".terminal-image-shelf-group-head")?.textContent ??
      "",
    names: [...group.querySelectorAll(".terminal-image-shelf-name")].map(
      (name) => name.textContent ?? "",
    ),
  }));
}

/** 層に描いた強い強調 (画面の行・桁・桁数)。 */
function strongMarks(): Array<{ row: number; col: number; cols: number }> {
  return [
    ...handle.el.querySelectorAll<HTMLElement>(".terminal-link-hover"),
  ].map((el) => ({
    row: Number(el.style.getPropertyValue("--link-row")),
    col: Number(el.style.getPropertyValue("--link-col")),
    cols: Number(el.style.getPropertyValue("--link-cols")),
  }));
}

/** 棚の見出しの行の詳しい表示 (出ていなければ null)。 */
function headDetail(): string | null {
  const detail = handle.el.querySelector<HTMLElement>(
    ".terminal-image-shelf-detail",
  );
  return detail && !detail.hidden ? (detail.textContent ?? "") : null;
}

const CHART: TerminalImageRef = {
  ...IMAGE,
  path: "/repo/docs/chart.png",
  candidate: "docs/chart.png",
  name: "chart.png",
  url: "/_agent/image?path=%2Frepo%2Fdocs%2Fchart.png&v=1000-3",
};

describe("出た所ごとのまとまり (tmux)", () => {
  test("見出しは新しい方のペインの番号と題名、各画像は名前と時刻の 2 行だけ", async () => {
    const open = await showImage();
    expect(shelfGroups()).toEqual([
      { head: "Pane 1 · 日本語の作業", names: ["out.png"] },
    ]);
    expect([...open.children].map((child) => child.className)).toEqual([
      "terminal-image-shelf-frame",
      "terminal-image-shelf-name",
      "terminal-image-shelf-meta",
    ]);
  });

  test("ペインごとに分け、まとまりはそのペインの新しい画像の順", async () => {
    imagesBody = () => ({
      images: [IMAGE, CHART],
      layout: LAYOUT,
      sightings: [
        {
          candidate: "docs/chart.png",
          pane: "%1",
          line: "chart docs/chart.png",
        },
        { candidate: "docs/out.png", pane: "%2", line: "wrote docs/out.png" },
      ],
    });
    emitOutput("docs/out.png docs/chart.png\r\n");
    await flush();
    await flush();
    // chart.png の方が後に出た (新しい) ので、そのペインのまとまりが先。
    expect(shelfGroups()).toEqual([
      { head: "Pane 0 · shell", names: ["chart.png"] },
      { head: "Pane 1 · 日本語の作業", names: ["out.png"] },
    ]);
  });

  test.each([
    { title: "✳ Claude Code", expected: "Pane 1 · Claude Code" },
    { title: "⠋ 作業中", expected: "Pane 1 · 作業中" },
    // 題名が無い (tmux の既定のホスト名はサーバが空にする) ときは コマンド · フォルダ。
    { title: "", expected: "Pane 1 · node · sample-app" },
  ])("題名の頭の状態の記号は見出しに出さない ($title)", async ({
    title,
    expected,
  }) => {
    imagesBody = () => ({
      layout: {
        ...LAYOUT,
        panes: LAYOUT.panes.map((pane) =>
          pane.id === "%2" ? { ...pane, title } : pane,
        ),
      },
      sightings: SIGHTINGS,
    });
    await showImage();
    expect(shelfGroups()[0]?.head).toBe(expected);
  });

  test("エージェントのペインは、題名よりサイドバーと同じ名前を見出しにする", async () => {
    agentNames.set("%2", "claude · 図を書く");
    await showImage();
    expect(shelfGroups()[0]?.head).toBe("Pane 1 · claude · 図を書く");
  });

  test("載っている間、見出しの行に実体のパスを出し、離れたら戻す", async () => {
    const open = await showImage();
    open.dispatchEvent(new PointerEvent("pointerenter"));
    expect(headDetail()).toBe("/repo/docs/out.png");
    open.dispatchEvent(new PointerEvent("pointerleave"));
    expect(headDetail()).toBeNull();
  });

  test("tmux のペインを読めなかったら理由を 1 回だけ出す", async () => {
    imagesBody = () => ({ layout: null, originError: "%2: tmux: boom" });
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await showImage();
      emitOutput("again docs/out.png\r\n");
      await flush();
      expect(
        statuses.filter((status) => status?.includes("tmux: boom")),
      ).toEqual([
        "Could not read the tmux panes, so the image shelf cannot tell which pane an image came from.\n%2: tmux: boom",
      ]);
      expect(shelfGroups()).toEqual([
        { head: "Unknown pane", names: ["out.png"] },
      ]);
    } finally {
      errors.mockRestore();
    }
  });
});

describe("ホバーでペインの枠と行を示す", () => {
  beforeEach(() => {
    // 右のペインの 1 行目と、左のペインの 2 行目に同じパス。
    term.lines = [
      splitRow("", "図を書き出しました docs/out.png"),
      splitRow("old docs/out.png", ""),
    ];
  });

  test("右のペインに枠を描き、そのペインの中のパスだけを選ぶ", async () => {
    const open = await showImage();
    open.dispatchEvent(new PointerEvent("pointerenter"));
    expect(frame().hidden).toBe(false);
    // 左の辺は境目の線のマス (半マス外)、上・右・下はウインドウの端なので内側。
    expect(frameBox()).toEqual({
      "--frame-top": "0",
      "--frame-left": "39.5",
      "--frame-rows": "23",
      "--frame-cols": "40.5",
    });
    // 左のペインの方が下の行でも、右のペインの行を強く強調する (この偽の端末は
    // 1 字 1 マス)。
    const column = splitRow("", "図を書き出しました ").length;
    expect(strongMarks()).toEqual([{ row: 0, col: column, cols: 12 }]);
    // 枠は今の並びで描き直す (ペインは後から動かせる)。
    await flush();
    expect(
      requests.some((request) =>
        request.url.startsWith(`/_agent/images/layout?shell=${SHELL.id}`),
      ),
    ).toBe(true);
    expect(frame().hidden).toBe(false);
  });

  test("離れたら枠と選択を消す", async () => {
    const open = await showImage();
    open.dispatchEvent(new PointerEvent("pointerenter"));
    open.dispatchEvent(new PointerEvent("pointerleave"));
    expect(frame().hidden).toBe(true);
    expect(strongMarks()).toEqual([]);
  });

  test("ステータスが上なら、枠をその行数だけ下げる", async () => {
    imagesBody = () => ({
      layout: { ...LAYOUT, statusAt: "top", statusLines: 2 },
      sightings: SIGHTINGS,
    });
    const open = await showImage();
    open.dispatchEvent(new PointerEvent("pointerenter"));
    expect(frameBox()["--frame-top"]).toBe("2");
  });

  test("枠は端末の画面の中で、操作を下の端末へ通し、面を塗らない", async () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("web/style.css", "utf8");
    document.head.append(style);
    try {
      const open = await showImage();
      open.dispatchEvent(new PointerEvent("pointerenter"));
      expect(frame().parentElement?.className).toBe("xterm-screen");
      const computed = getComputedStyle(frame());
      expect(computed.pointerEvents).toBe("none");
      expect(computed.position).toBe("absolute");
      // 線だけ (中の文字を覆わない)。
      expect(computed.borderTopStyle).toBe("solid");
      expect(computed.backgroundColor).toMatch(
        /^(|transparent|rgba\(0, 0, 0, 0\))$/,
      );
    } finally {
      style.remove();
    }
  });
});

describe("ターミナルで見る (tmux)", () => {
  test("画面に出ていれば、選択と枠で示し、tmux には何も頼まない", async () => {
    term.lines = [splitRow("", "図を書き出しました docs/out.png")];
    const open = await showImage();
    chooseFromMenu(open, "Show in terminal");
    await flush();
    expect(strongMarks()[0]?.row).toBe(0);
    expect(frame().hidden).toBe(false);
    expect(requests.filter((r) => r.url.includes("/reveal"))).toEqual([]);
  });

  test("流れていれば、そのペインを tmux に遡らせる", async () => {
    term.lines = [splitRow("", "")];
    const open = await showImage();
    chooseFromMenu(open, "Show in terminal");
    await flush();
    const reveal = requests.filter((r) => r.url.includes("/reveal"));
    expect(reveal).toHaveLength(1);
    expect(JSON.parse(reveal[0]?.body ?? "")).toEqual({
      shell: SHELL.id,
      pane: "%2",
      text: "docs/out.png",
    });
    // 同一オリジンの副作用として送る。
    expect(reveal[0]?.headers).toMatchObject({ "X-Code-Viewer-Action": "1" });
    expect(frame().hidden).toBe(false);
  });

  test("tmux が断ったら理由を出す", async () => {
    term.lines = [splitRow("", "")];
    revealStatus = 409;
    const open = await showImage();
    chooseFromMenu(open, "Show in terminal");
    await flush();
    await flush();
    expect(
      statuses.some(
        (status) =>
          status?.startsWith(
            "Could not show the image's line in the terminal.",
          ) && status.includes("tmux: boom"),
      ),
    ).toBe(true);
  });
});

describe("tmux でないシェル", () => {
  beforeEach(() => {
    imagesBody = () => ({});
    term.lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    term.lines[50] = "saved chart to docs/out.png";
  });

  test("見出しはシェルの名前", async () => {
    await showImage();
    expect(shelfGroups()).toEqual([{ head: "zsh", names: ["out.png"] }]);
  });

  test("ターミナルで見る: その行が画面の中ほどに来るまでスクロールして選ぶ", async () => {
    const open = await showImage();
    chooseFromMenu(open, "Show in terminal");
    await flush();
    expect(term.scrolledTo).toEqual([50 - 12]);
    // 画面の先頭が 38 行目になったので、50 行目は画面の 12 行目。
    expect(strongMarks()).toEqual([
      { row: 12, col: "saved chart to ".length, cols: 12 },
    ]);
    // ペインの枠は描かない (tmux ではない)。
    expect(
      handle.el.querySelector(".terminal-pane-frame:not([hidden])"),
    ).toBeNull();
  });

  test("もうバッファに無ければ、そう伝える", async () => {
    const open = await showImage();
    term.lines = ["cleared"];
    chooseFromMenu(open, "Show in terminal");
    await flush();
    expect(statuses).toContain("The path is no longer in the terminal.");
    expect(term.scrolledTo).toEqual([]);
  });
});
