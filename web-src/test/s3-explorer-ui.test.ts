// Explorer ツリー・種別バッジ・空状態・選択ハイライトの「実描画」挙動を
// happy-dom 上で検証する。文字列存在ではなく DOM 構造と状態を確認する。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { waitFor } from "./_test-helpers";

GlobalRegistrator.register();

const { createS3Explorer } = await import("../views/database/s3-explorer");
const { dbText } = await import("../views/database/i18n");

type FolderLevel = { folders: string[]; objects: Array<{ key: string }> };

const FOLDERS: Record<string, FolderLevel> = {
  "": {
    folders: ["images/", "videos/"],
    objects: [{ key: "a.png" }, { key: "b.png" }, { key: "notes.txt" }],
  },
  "images/": {
    folders: [],
    objects: [{ key: "images/hero.png" }, { key: "images/diagram.svg" }],
  },
  "videos/": { folders: [], objects: [{ key: "videos/clip.mp4" }] },
};

const LIST_OBJECTS = [
  { key: "a.png" },
  { key: "notes.txt" },
  { key: "sample.csv" },
];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function installFetchMock(fail?: (url: URL) => Error | null): void {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const failure = fail?.(url);
      if (failure) throw failure;
      const p = url.pathname;
      if (p === "/_db/s3/buckets")
        return json({ dbId: "mock", buckets: [{ name: "media" }] });
      if (p === "/_db/s3/folder") {
        const prefix = url.searchParams.get("prefix") || "";
        const level = FOLDERS[prefix] || { folders: [], objects: [] };
        return json({ dbId: "mock", bucket: "media", prefix, ...level });
      }
      if (p === "/_db/s3/objects")
        return json({
          dbId: "mock",
          bucket: "media",
          prefix: "",
          search: "",
          mode: "prefix",
          sort: "updated-desc",
          objects: LIST_OBJECTS,
          truncated: false,
          scannedObjects: LIST_OBJECTS.length,
          scannedPages: 1,
        });
      if (p === "/_db/s3/head")
        return json({
          dbId: "mock",
          bucket: "media",
          key: url.searchParams.get("key"),
          sizeBytes: 0,
        });
      if (p === "/_db/s3/text")
        return json({
          dbId: "mock",
          bucket: "media",
          key: url.searchParams.get("key"),
          text: 'name,note\nalpha,"one, two"',
          truncated: false,
        });
      return json({});
    }) as typeof fetch,
  });
}

function click(el: Element | null | undefined): void {
  (el as HTMLElement | null)?.dispatchEvent(
    new Event("click", { bubbles: true }),
  );
}

let explorer: ReturnType<typeof createS3Explorer> | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
  installFetchMock();
});

afterAll(() => {
  explorer?.dispose();
  GlobalRegistrator.unregister();
});

async function mountExplorer(
  callbacks: Parameters<typeof createS3Explorer>[0] = {},
): Promise<ReturnType<typeof createS3Explorer>> {
  const view = createS3Explorer(callbacks);
  explorer = view;
  // sidebarSlot は本番では db-sidebar の dbToolbar 直下に mount される。
  // テストでは同じ document.body に並べて、querySelector で両方を辿れるようにする。
  document.body.append(view.sidebarSlot, view.el);
  await view.load("mock");
  return view;
}

async function switchToExplorer(
  view: ReturnType<typeof createS3Explorer>,
): Promise<void> {
  // Bucket と View Seg は sidebarSlot に移された (本番では db-sidebar 配下)。
  const buttons = view.sidebarSlot.querySelectorAll(".s3-view-seg button");
  click(buttons[1]); // Explorer
  await waitFor(() => !!view.sidebarSlot.querySelector(".s3-tree .tree-dir"));
}

describe("S3 explorer UI", () => {
  test("List 表示の各オブジェクトに種別バッジが付く", async () => {
    const view = await mountExplorer();
    // List / Explorer 共通の検索/オプション/オブジェクトリスト/tree は
    // すべて sidebarSlot に積まれる。
    await waitFor(() => !!view.sidebarSlot.querySelector(".s3-object-item"));
    const badges = view.sidebarSlot.querySelectorAll(
      ".s3-object-item .s3-kind-badge",
    );
    // 行ごとに 1 つバッジが出る。
    expect(badges.length).toBe(LIST_OBJECTS.length);
    const pngRow = view.sidebarSlot.querySelector(
      '.s3-object-item[data-key="a.png"]',
    );
    expect(pngRow?.querySelector(".s3-kind-badge.kind-image")).toBeTruthy();
    const txtRow = view.sidebarSlot.querySelector(
      '.s3-object-item[data-key="notes.txt"]',
    );
    expect(txtRow?.querySelector(".s3-kind-badge.kind-text")).toBeTruthy();
  });

  test("日本語では表示の切替と種別バッジも日本語になる", async () => {
    document.documentElement.lang = "ja";
    try {
      const view = await mountExplorer({ getText: () => dbText("ja") });
      await waitFor(() => !!view.sidebarSlot.querySelector(".s3-object-item"));
      const seg = [
        ...view.sidebarSlot.querySelectorAll(".s3-view-seg button"),
      ].map((button) => button.textContent);
      expect(seg).toEqual(["一覧", "フォルダ"]);
      const badge = view.sidebarSlot.querySelector(
        '.s3-object-item[data-key="a.png"] .s3-kind-badge',
      );
      expect(badge?.textContent).toBe("画像");
      expect(badge?.getAttribute("title")).toBe("PNG 画像");
    } finally {
      document.documentElement.lang = "";
    }
  });

  // 直す前は日本語の設定でも、状態の行・スキャン上限の文言・空のフォルダ・
  // 読み込み中の表示が英語のままだった。英語の出力は今までどおり。
  test.each([
    {
      language: "en" as const,
      status: "3 shown / 3 scanned / newest first in scanned objects",
    },
    {
      language: "ja" as const,
      status: "3 件表示 / 3 件スキャン / スキャンした中で更新が新しい順",
    },
  ])("状態の行を表示の言語で描く: $language", async ({ language, status }) => {
    const view = await mountExplorer({ getText: () => dbText(language) });
    const line = () =>
      view.sidebarSlot.querySelector(".s3-object-status")?.textContent;
    await waitFor(() => !!line());
    expect(line()).toBe(status);
  });

  test("言語を切り替えると状態の行も描き直す", async () => {
    let language: "en" | "ja" = "en";
    const view = await mountExplorer({ getText: () => dbText(language) });
    const line = () =>
      view.sidebarSlot.querySelector(".s3-object-status")?.textContent;
    await waitFor(() => !!line());
    language = "ja";
    view.localize();
    expect(line()).toBe(
      "3 件表示 / 3 件スキャン / スキャンした中で更新が新しい順",
    );
  });

  test.each([
    {
      language: "en" as const,
      empty:
        "(no matches in the first 1,000 scanned objects; narrow the prefix and search again)",
      cap: "scan cap reached; narrow the prefix to search more precisely",
    },
    {
      language: "ja" as const,
      empty:
        "(スキャンした先頭 1,000 件に一致するものがありません。プレフィックスを絞って検索し直してください)",
      cap: "スキャンの上限に達しました。プレフィックスを絞るとより正確に検索できます",
    },
  ])("スキャン上限の文言を表示の言語で描く: $language", async ({
    language,
    empty,
    cap,
  }) => {
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/_db/s3/objects") {
        return json({
          dbId: "mock",
          bucket: "media",
          prefix: "",
          search: "sample",
          mode: "contains",
          sort: "key",
          objects: [],
          truncated: true,
          scannedObjects: 1000,
          scannedPages: 1,
          scanLimitReached: true,
        });
      }
      return fetchMock(input, init);
    }) as typeof fetch;
    const view = await mountExplorer({ getText: () => dbText(language) });
    const list = () =>
      view.sidebarSlot.querySelector(".s3-object-list")?.textContent;
    await waitFor(() => list() === empty);
    expect(
      view.sidebarSlot.querySelector(".s3-object-status")?.textContent,
    ).toContain(cap);
  });

  test.each([
    { language: "en" as const, loading: "Loading…", empty: "(empty)" },
    { language: "ja" as const, loading: "読み込み中…", empty: "(空)" },
  ])("フォルダの読み込み中と空の行を表示の言語で描く: $language", async ({
    language,
    loading,
    empty,
  }) => {
    let release: (() => void) | undefined;
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = new URL(String(input), "http://localhost");
      if (
        url.pathname === "/_db/s3/folder" &&
        url.searchParams.get("prefix") === "videos/"
      ) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return json({
          dbId: "mock",
          bucket: "media",
          prefix: "videos/",
          folders: [],
          objects: [],
        });
      }
      return fetchMock(input, init);
    }) as typeof fetch;
    const view = await mountExplorer({ getText: () => dbText(language) });
    await switchToExplorer(view);
    click(
      [...view.sidebarSlot.querySelectorAll(".s3-tree .tree-dir")].find(
        (dir) => dir.querySelector(".dir-name")?.textContent === "videos",
      ),
    );
    await waitFor(() => release !== undefined);
    expect(
      view.sidebarSlot.querySelector(".s3-tree-loading")?.textContent,
    ).toContain(loading);
    release?.();
    await waitFor(() => !!view.sidebarSlot.querySelector(".s3-tree-empty"));
    expect(
      view.sidebarSlot.querySelector(".s3-tree-empty")?.textContent,
    ).toContain(empty);
  });

  test("Explorer に切り替えると List 専用の検索/ソート行が hidden になる", async () => {
    const view = await mountExplorer();
    const searchRow =
      view.sidebarSlot.querySelector<HTMLElement>(".s3-search-row");
    const optionRow =
      view.sidebarSlot.querySelector<HTMLElement>(".s3-options-row");
    expect(searchRow?.hidden).toBe(false);
    await switchToExplorer(view);
    expect(searchRow?.hidden).toBe(true);
    expect(optionRow?.hidden).toBe(true);
    expect(
      view.sidebarSlot.querySelector<HTMLElement>(".s3-object-list")?.hidden,
    ).toBe(true);
    // セグメントの active 状態も切り替わる (sidebarSlot 配下に移動済み)。
    const buttons = view.sidebarSlot.querySelectorAll(".s3-view-seg button");
    expect(buttons[0].classList.contains("active")).toBe(false);
    expect(buttons[1].classList.contains("active")).toBe(true);
  });

  test("Explorer はフォルダとファイルをツリー構造で描画し、展開で子を遅延ロードする", async () => {
    const view = await mountExplorer();
    await switchToExplorer(view);
    const dirs = view.sidebarSlot.querySelectorAll(".s3-tree .tree-dir");
    expect(dirs.length).toBe(FOLDERS[""].folders.length);
    // root 直下のファイルは種別バッジ付きの tree-file。
    const rootPng = view.sidebarSlot.querySelector(
      '.s3-tree .tree-file[data-key="a.png"] .s3-kind-badge.kind-image',
    );
    expect(rootPng).toBeTruthy();
    // images/ を展開すると子ファイルが現れる。
    const imagesDir = Array.from(dirs).find(
      (d) => d.querySelector(".dir-name")?.textContent === "images",
    );
    click(imagesDir);
    await waitFor(
      () =>
        !!view.sidebarSlot.querySelector(
          '.s3-tree .tree-file[data-key="images/hero.png"]',
        ),
    );
    expect(
      view.sidebarSlot.querySelector(
        '.tree-file[data-key="images/diagram.svg"]',
      ),
    ).toBeTruthy();
  });

  test("ファイルを選択し直してもハイライトは常に 1 行だけ (二重ハイライト回帰防止)", async () => {
    const view = await mountExplorer();
    await switchToExplorer(view);
    click(
      view.sidebarSlot.querySelector('.s3-tree .tree-file[data-key="a.png"]'),
    );
    await waitFor(
      () =>
        view.sidebarSlot
          .querySelector('.tree-file[data-key="a.png"]')
          ?.classList.contains("active") === true,
    );
    click(
      view.sidebarSlot.querySelector('.s3-tree .tree-file[data-key="b.png"]'),
    );
    await waitFor(
      () =>
        view.sidebarSlot
          .querySelector('.tree-file[data-key="b.png"]')
          ?.classList.contains("active") === true,
    );
    const active = view.sidebarSlot.querySelectorAll(
      ".s3-tree .tree-file.active",
    );
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.key).toBe("b.png");
  });

  // 直す前は err.message だけをボタンに出し、console にも cause にも何も
  // 残らなかった。今は cause の連鎖ごとの全文が画面に出て、error そのものが
  // console.error に渡る。
  test("続きの読み込みに失敗したら、理由を cause ごと画面と console に出す", async () => {
    const failure = Object.assign(new Error("failed to fetch s3 folder"), {
      cause: new Error("network is unreachable"),
    });
    let failFolder = false;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/_db/s3/buckets")
          return json({ dbId: "mock", buckets: [{ name: "media" }] });
        if (url.pathname === "/_db/s3/folder") {
          if (failFolder) throw failure;
          return json({
            dbId: "mock",
            bucket: "media",
            prefix: "",
            folders: [],
            objects: [{ key: "a.png" }],
            nextToken: "page-2",
          });
        }
        return json({});
      }) as typeof fetch,
    });
    const view = await mountExplorer();
    click(view.sidebarSlot.querySelectorAll(".s3-view-seg button")[1]);
    await waitFor(() => !!view.sidebarSlot.querySelector(".s3-tree-more"));

    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      failFolder = true;
      const more =
        view.sidebarSlot.querySelector<HTMLButtonElement>(".s3-tree-more");
      click(more);
      await waitFor(() => !!view.sidebarSlot.querySelector(".s3-tree-error"));

      // 失敗の文言はボタンのラベルに入れず、ボタンの直後の状態の行に出す
      // (ラベルが伸びると押せる領域が動くため)。
      const row = more?.nextElementSibling;
      expect(row?.classList.contains("s3-tree-error")).toBe(true);
      expect(row?.tagName).not.toBe("BUTTON");
      expect(row?.textContent).toContain("failed to fetch s3 folder");
      expect(row?.textContent).toContain("Caused by");
      expect(row?.textContent).toContain("network is unreachable");
      expect(more?.textContent).toBe("Load more");
      expect(more?.disabled).toBe(false);
      expect(logged.length).toBe(1);
      expect(logged[0]?.[0]).toBe("[code-viewer] S3 load more failed");
      expect(logged[0]?.[logged[0].length - 1]).toBe(failure);

      // もう一度押して成功すれば、前の失敗の行は残らない。
      failFolder = false;
      click(more);
      await waitFor(() => !more?.isConnected);
      expect(view.sidebarSlot.querySelector(".s3-tree-error")).toBeNull();
    } finally {
      console.error = originalError;
    }
  });

  // 直す前は err.message だけを出し、console にも cause にも何も残らなかった。
  test.each([
    {
      operation: "bucket list",
      fails: (url: URL) => url.pathname === "/_db/s3/buckets",
      open: async () => {
        // 開くだけ (load の中で失敗する)。
      },
      where: ".s3-object-list .db-pane-error",
    },
    {
      operation: "object list",
      fails: (url: URL) => url.pathname === "/_db/s3/objects",
      open: async () => {
        // 開くだけ (load の中で失敗する)。
      },
      where: ".s3-object-list .db-pane-error",
    },
    {
      operation: "folder tree",
      fails: (url: URL) =>
        url.pathname === "/_db/s3/folder" && !url.searchParams.get("prefix"),
      open: async (view: ReturnType<typeof createS3Explorer>) => {
        click(view.sidebarSlot.querySelectorAll(".s3-view-seg button")[1]);
      },
      where: ".s3-tree .db-pane-error",
    },
    {
      operation: "folder",
      fails: (url: URL) =>
        url.pathname === "/_db/s3/folder" &&
        url.searchParams.get("prefix") === "images/",
      open: async (view: ReturnType<typeof createS3Explorer>) => {
        await switchToExplorer(view);
        click(
          [...view.sidebarSlot.querySelectorAll(".s3-tree .tree-dir")].find(
            (dir) => dir.querySelector(".dir-name")?.textContent === "images",
          ),
        );
      },
      where: ".s3-tree-error",
    },
    {
      operation: "object preview",
      fails: (url: URL) => url.pathname === "/_db/s3/text",
      open: async (view: ReturnType<typeof createS3Explorer>) => {
        await waitFor(
          () =>
            !!view.sidebarSlot.querySelector(
              '.s3-object-item[data-key="sample.csv"]',
            ),
        );
        click(
          view.sidebarSlot.querySelector(
            '.s3-object-item[data-key="sample.csv"]',
          ),
        );
      },
      where: ".s3-preview-pane .db-pane-error",
    },
  ])("$operation の失敗は理由を cause ごと画面と console に出す", async ({
    operation,
    fails,
    open,
    where,
  }) => {
    const failure = Object.assign(new Error(`${operation} request failed`), {
      cause: new Error("network is unreachable"),
    });
    installFetchMock((url) => (fails(url) ? failure : null));
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const view = await mountExplorer();
      await open(view);
      const root = document.body;
      await waitFor(() => !!root.querySelector(where));

      const shown = root.querySelector(where)?.textContent ?? "";
      expect(shown).toContain(`${operation} request failed`);
      expect(shown).toContain("Caused by");
      expect(shown).toContain("network is unreachable");
      const s3Logs = logged.filter(
        (args) => args[0] === `[code-viewer] S3 ${operation} failed`,
      );
      expect(s3Logs.length).toBe(1);
      expect(s3Logs[0]?.[s3Logs[0].length - 1]).toBe(failure);
    } finally {
      console.error = originalError;
    }
  });

  test("S3 URI のコピーに失敗したら、ラベルは動かさず理由を title と console に出す", async () => {
    const failure = new Error("clipboard is not allowed");
    const clipboard = navigator.clipboard;
    const originalWrite = clipboard.writeText;
    clipboard.writeText = async () => {
      throw failure;
    };
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const view = await mountExplorer();
      await waitFor(
        () =>
          !!view.sidebarSlot.querySelector('.s3-object-item[data-key="a.png"]'),
      );
      click(
        view.sidebarSlot.querySelector('.s3-object-item[data-key="a.png"]'),
      );
      await waitFor(
        () =>
          !![...view.el.querySelectorAll("button")].find(
            (button) => button.textContent === "Copy S3 URI",
          ),
      );
      const copy = [...view.el.querySelectorAll("button")].find(
        (button) => button.textContent === "Copy S3 URI",
      );
      click(copy);
      await waitFor(() => copy?.classList.contains("failed") === true);

      expect(copy?.textContent).toBe("Copy failed");
      expect(copy?.title).toContain("copy s3 uri s3://media/a.png");
      expect(copy?.title).toContain("clipboard is not allowed");
      expect(logged.length).toBe(1);
      const logged0 = logged[0]?.[0] as Error & { cause?: unknown };
      expect(logged0.cause).toBe(failure);
    } finally {
      console.error = originalError;
      clipboard.writeText = originalWrite;
    }
  });

  test("未選択プレビューは共通の空状態 (db-pane-empty) で表示する", async () => {
    const view = await mountExplorer();
    const empty = view.el.querySelector(".s3-preview-pane .db-pane-empty");
    expect(empty).toBeTruthy();
    expect(empty?.querySelector(".db-pane-empty-icon svg")).toBeTruthy();
    expect(empty?.querySelector(".db-pane-empty-title")?.textContent).toBe(
      "Select an object to preview.",
    );
  });

  test("CSV オブジェクトを表形式でプレビューする", async () => {
    const view = await mountExplorer();
    await waitFor(
      () =>
        !!view.sidebarSlot.querySelector(
          '.s3-object-item[data-key="sample.csv"]',
        ),
    );

    click(
      view.sidebarSlot.querySelector('.s3-object-item[data-key="sample.csv"]'),
    );
    await waitFor(() => !!view.el.querySelector(".gdp-csv-table"));

    expect(
      Array.from(
        view.el.querySelectorAll(".gdp-csv-table thead tr:first-child th"),
        (cell) => cell.textContent,
      ),
    ).toEqual(["", "name", "note"]);
    expect(
      Array.from(
        view.el.querySelectorAll(".gdp-csv-table tbody td"),
        (cell) => cell.textContent,
      ),
    ).toEqual(["alpha", "one, two"]);
  });
});
