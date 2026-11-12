// 部品 (cv-*) と宣言的な描き方の決まりを守らせる検査。決まりの本文は
// .agents/skills/project-rules/references/ui-components.md。
//
// 1. どの部品の外側の要素も箱を作らない (display: contents)。web/style.css の
//    「部品の外側の要素」の並びに名前が無いと、外側の要素が親の flex・grid の
//    並びに 1 つ余計な箱として入り、見た目が変わる。
// 2. 宣言的に書き直した画面に、命令的に DOM を組み立てる書き方 (createElement・
//    innerHTML・insertAdjacentHTML・outerHTML) が戻っていない (不在の証明)。
//    まだ書き直していない所の数は上限で抑え、書き直すたびに下げる。

import "./_dom";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const VIEWS = "web-src/views";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const VIEW_FILES = [...sourceFiles(VIEWS), "web-src/app.ts"];

/** ソースに書かれた部品の名前 (export const CV_X = "cv-x")。 */
function componentNames(): string[] {
  const names: string[] = [];
  for (const file of VIEW_FILES) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /export const CV_[A-Z_]+ = "([^"]+)";/g,
    ))
      names.push(match[1]);
  }
  return names.sort();
}

describe("component outer elements", () => {
  const names = componentNames();

  test("there are components to check", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  test("every component name starts with cv-", () => {
    expect(names.filter((name) => !name.startsWith("cv-"))).toEqual([]);
  });

  test("every component's outer element makes no box of its own", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("web/style.css", "utf8");
    document.head.appendChild(style);
    const boxed = names.filter((name) => {
      const el = document.createElement(name);
      document.body.appendChild(el);
      const display = getComputedStyle(el).display;
      el.remove();
      return display !== "contents";
    });
    style.remove();
    expect(boxed).toEqual([]);
  });
});

/** 命令的に DOM を組み立てる書き方。 */
const IMPERATIVE_DOM =
  /createElement(NS)?\(|\.innerHTML\s*=|insertAdjacentHTML|\.outerHTML\s*=/g;

/** 宣言的に書き直した所。中に命令的な組み立てが 1 つも無いこと。 */
const DECLARATIVE = [
  "web-src/views/ui/",
  "web-src/views/tools/",
  "web-src/views/main-tabs/",
  "web-src/views/context-menu.ts",
  "web-src/views/ui-dialog.ts",
  "web-src/views/title-tooltip.ts",
  "web-src/views/projects/project-looks.ts",
  "web-src/views/search-palette-ui.ts",
  "web-src/views/search-palette-view.ts",
  "web-src/views/sidebar.ts",
  "web-src/views/list-tree-open.ts",
  "web-src/views/workspace/",
  "web-src/views/agents/",
  "web-src/views/remote-access-settings.ts",
  "web-src/views/viewer-settings.ts",
  "web-src/views/settings-page.ts",
  "web-src/views/page-shell.ts",
  "web-src/views/help-page.ts",
  "web-src/views/help-blocks.ts",
  "web-src/views/help-keybinding-editor.ts",
  "web-src/views/quick-help.ts",
  "web-src/views/install-help.ts",
  "web-src/views/doctor-view.ts",
  "web-src/views/file-shell.ts",
  "web-src/views/file-history-shell.ts",
  "web-src/views/code-preview.ts",
  "web-src/views/blame-view.ts",
  "web-src/views/line-ref-pill.ts",
  "web-src/views/source-preview-elements.ts",
  "web-src/views/repo-view.ts",
  "web-src/views/source-view.ts",
  "web-src/views/repository-web-link.ts",
  "web-src/views/definition-jump.ts",
  "web-src/views/breadcrumb-fit.ts",
  "web-src/views/diff-view.ts",
  "web-src/views/hunk-expand.ts",
  "web-src/views/diff-hscroll.ts",
  "web-src/views/diff-line-select.ts",
  "web-src/views/empty-diff-pane.ts",
  "web-src/views/history-view.ts",
  "web-src/views/history-graph.ts",
  "web-src/views/worktree-view.ts",
  "web-src/views/search-results-view.ts",
  "web-src/views/image-tab.ts",
  "web-src/views/media-player.ts",
  "web-src/views/media-embed.ts",
  "web-src/views/backend-state.ts",
  "web-src/views/text-mark.ts",
  "web-src/views/status-label.ts",
  "web-src/views/ref-picker.ts",
  "web-src/views/annotations-ui.ts",
  "web-src/views/annotations/",
  "web-src/views/annotations-player.ts",
  "web-src/views/journal-view.ts",
  "web-src/views/database/",
  "web-src/views/terminal/",
];

/**
 * 書き直した所の中で、外の部品が DOM を作る・外の部品に DOM を渡すために
 * 命令的な書き方が残る所。ファイルごとの数と理由。
 */
const EXCEPTIONS: Record<string, { count: number; reason: string }> = {
  "web-src/views/ui/layer.ts": {
    count: 1,
    reason:
      "重ね合わせの層の箱 (cv-layer) を body に置く。宣言的に描く先がまだ DOM に無いため",
  },
  "web-src/views/diff-view.ts": {
    count: 1,
    reason:
      "diff2html が描いた行の本文を、色付けの道具が返した HTML に置き換える (外の部品が描いた DOM。行ごとに lit の根を作ると、何千行の差分の色付けが重くなる)",
  },
};

/** まだ書き直していない所も含めた、命令的な組み立ての数の上限。書き直したら下げる。 */
const IMPERATIVE_LIMIT = 120;

function imperativeCount(file: string): number {
  return [...readFileSync(file, "utf8").matchAll(IMPERATIVE_DOM)].length;
}

describe("declarative views", () => {
  test("rewritten screens build no DOM imperatively", () => {
    const found = VIEW_FILES.filter((file) =>
      DECLARATIVE.some((prefix) => file.startsWith(prefix)),
    )
      .map((file) => ({ file, count: imperativeCount(file) }))
      .filter(({ file, count }) => count !== (EXCEPTIONS[file]?.count ?? 0));
    expect(found).toEqual([]);
  });

  test("the imperative DOM left in screens not yet rewritten does not grow", () => {
    const total = VIEW_FILES.reduce(
      (sum, file) => sum + imperativeCount(file),
      0,
    );
    expect(total).toBeLessThanOrEqual(IMPERATIVE_LIMIT);
  });
});

/**
 * 書き直した所の presenter が view を差し替えられるかの見張り。描く presenter
 * (create… / mount… を書き出し、状態か外とのやり取りを持ち、DOM を描く) は view を
 * DEFAULT_VIEW を既定に受け取る。決まりは ui-components.md の「どこまでを presenter と
 * view に分けるか」。
 */
const PRESENTER_EXEMPT: Record<string, string> = {
  "web-src/views/ui/renderer.ts":
    "描く係の土台 (createRenderer)。画面ではなく、presenter が使う道具",
  "web-src/views/ui/layer.ts":
    "重ね合わせの層の土台 (createLayer)。中身は呼び手の view が描く",
  "web-src/views/projects/project-looks.ts":
    "プロジェクトの色と名前の置き場 (描かない)。projectMark は値から札を作るだけ",
  "web-src/views/sidebar.ts":
    "左のファイル一覧。行はテンプレートで描くが、view の分け直しは段 4 (app.ts から受け取る描き方の口と一緒に直す)",
};

const EXPORTS_PRESENTER = /export function (create|mount)[A-Z]\w*\(/;
const HOLDS_STATE =
  /\bfetch\(|\.subscribe\(|^ {2}let \w|^ {2}const \w+ = new (Map|Set)</m;
const DRAWS =
  /\brenderOwned\(|\bcreateRenderer\(|\btemplateElement\(|\bdetachedElement\(/;
const TAKES_VIEW = /(=|\?\?)\s*DEFAULT_VIEW\b/;

describe("presenters", () => {
  test("rewritten presenters take an injectable view (DEFAULT_VIEW)", () => {
    const missing = VIEW_FILES.filter((file) =>
      DECLARATIVE.some((prefix) => file.startsWith(prefix)),
    ).filter((file) => {
      if (file in PRESENTER_EXEMPT) return false;
      const source = readFileSync(file, "utf8");
      return (
        EXPORTS_PRESENTER.test(source) &&
        HOLDS_STATE.test(source) &&
        DRAWS.test(source) &&
        !TAKES_VIEW.test(source)
      );
    });
    expect(missing).toEqual([]);
  });

  test("every exemption still names a file that exists", () => {
    expect(
      Object.keys(PRESENTER_EXEMPT).filter(
        (file) => !VIEW_FILES.includes(file),
      ),
    ).toEqual([]);
  });
});
