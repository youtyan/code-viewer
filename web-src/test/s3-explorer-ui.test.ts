// Explorer ツリー・種別バッジ・空状態・選択ハイライトの「実描画」挙動を
// happy-dom 上で検証する。文字列存在ではなく DOM 構造と状態を確認する。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { waitFor } from "./_test-helpers";

GlobalRegistrator.register();

const { createS3Explorer } = await import("../views/database/s3-explorer");

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

function installFetchMock(): void {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
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

async function mountExplorer(): Promise<ReturnType<typeof createS3Explorer>> {
  const view = createS3Explorer();
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
