import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  markdownSlugify,
  renderMarkdownHtml,
  resolveMarkdownAssetPath,
  resolveMarkdownLinkTarget,
} from "../core/markdown-preview";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";
import { sourceFixture } from "./source-fixture";

const markdown = sourceFixture(
  readFileSync(new URL("../core/markdown-preview.ts", import.meta.url), "utf8"),
);
// shiki / mermaid の lazy load は専用 loader モジュールに切り出されている
// (markdown-preview と er-diagram / query-editor 等から共有)。lazy 性は
// loader 側のソースで検証する。
const mermaidLoader = sourceFixture(
  readFileSync(new URL("../core/mermaid-loader.ts", import.meta.url), "utf8"),
);
const shikiLoader = sourceFixture(
  readFileSync(new URL("../core/shiki-loader.ts", import.meta.url), "utf8"),
);
const server = sourceFixture(
  readFileSync(new URL("../server/preview.ts", import.meta.url), "utf8"),
);
const style = sourceFixture(
  readFileSync(new URL("../../web/style.css", import.meta.url), "utf8"),
);
const pkg = readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8",
);
// 遅延バンドルの定義はビルドスクリプト側にある。
const bundles = readFileSync(
  new URL("../../scripts/bundles.mjs", import.meta.url),
  "utf8",
);

describe("markdown preview", () => {
  test("uses markdown-it with raw HTML disabled and repository-aware overrides", () => {
    expect(markdown.includes("html: false")).toBe(true);
    expect(markdown.includes("linkify: true")).toBe(true);
    expect(markdown.includes("md.use(markdownItAnchor")).toBe(true);
    expect(markdown.includes("md.use(markdownItFootnote)")).toBe(true);
    expect(markdown.includes("data-gdp-md-link")).toBe(true);
    expect(
      markdown.includes(
        "buildRawFileUrl({ path: resolved, ref: target.ref || 'worktree' })",
      ),
    ).toBe(true);
    expect(markdown.includes('target", "_blank"')).toBe(true);
    expect(markdown.includes('rel", "noopener noreferrer"')).toBe(true);
  });

  // GitHub の markdown で辿れる相対リンクは md 同士に限らない。ディレクトリ
  // も md 以外のファイルも同じ行き先になるので、解決対象から外れると SPA を
  // 抜けて 404 になる。
  test.each([
    {
      name: "同じディレクトリの md",
      currentPath: "docs/guide/intro.md",
      href: "./next.md",
      expected: { path: "docs/guide/next.md", hash: "", directory: false },
    },
    {
      name: "親ディレクトリの md + アンカー",
      currentPath: "docs/guide/intro.md",
      href: "../README.markdown#top",
      expected: { path: "docs/README.markdown", hash: "top", directory: false },
    },
    {
      name: "md 以外のファイル",
      currentPath: "docs/README.md",
      href: "./assets/data.json",
      expected: { path: "docs/assets/data.json", hash: "", directory: false },
    },
    {
      name: "リポジトリ外の階層へ出ないソースファイル",
      currentPath: "docs/README.md",
      href: "../src/app.ts",
      expected: { path: "src/app.ts", hash: "", directory: false },
    },
    {
      name: "末尾スラッシュ付きディレクトリ",
      currentPath: "docs/README.md",
      href: "./sub/",
      expected: { path: "docs/sub", hash: "", directory: true },
    },
    {
      name: "末尾スラッシュなしのディレクトリ候補",
      currentPath: "docs/README.md",
      href: "./sub",
      expected: { path: "docs/sub", hash: "", directory: false },
    },
    {
      name: "親ディレクトリそのもの",
      currentPath: "docs/guide/intro.md",
      href: "../",
      expected: { path: "docs", hash: "", directory: true },
    },
    {
      name: "リポジトリルート",
      currentPath: "docs/README.md",
      href: "../",
      expected: { path: "", hash: "", directory: true },
    },
    {
      name: "クエリとアンカーの両方",
      currentPath: "docs/README.md",
      href: "./guide.md?plain=1#section-two",
      expected: {
        path: "docs/guide.md",
        hash: "section-two",
        directory: false,
      },
    },
    {
      name: "percent-encoded なパス",
      currentPath: "docs/README.md",
      href: "./a%20b.md",
      expected: { path: "docs/a b.md", hash: "", directory: false },
    },
    {
      name: "壊れた percent-encoding はそのまま扱う",
      currentPath: "docs/README.md",
      href: "./a%zz.md",
      expected: { path: "docs/a%zz.md", hash: "", directory: false },
    },
    {
      name: "リポジトリルート起点の絶対パス",
      currentPath: "docs/guide/intro.md",
      href: "/README.md",
      expected: { path: "README.md", hash: "", directory: false },
    },
  ])("resolves a repository link: $name", ({ currentPath, href, expected }) => {
    expect(resolveMarkdownLinkTarget(currentPath, href)).toEqual(expected);
  });

  test.each([
    {
      name: "外部 URL",
      currentPath: "docs/guide/intro.md",
      href: "https://example.com/a.md",
    },
    {
      name: "プロトコル相対 URL",
      currentPath: "docs/guide/intro.md",
      href: "//example.com/a.md",
    },
    {
      name: "mailto",
      currentPath: "docs/README.md",
      href: "mailto:someone@example.com",
    },
    {
      name: "ページ内アンカーだけ",
      currentPath: "docs/guide/intro.md",
      href: "#section",
    },
    {
      name: "リポジトリルートより上",
      currentPath: "docs/guide/intro.md",
      href: "../../../README.md",
    },
    { name: "空の href", currentPath: "docs/guide/intro.md", href: "" },
    { name: "クエリだけ", currentPath: "docs/README.md", href: "?plain=1" },
  ])("leaves a non-repository link alone: $name", ({ currentPath, href }) => {
    expect(resolveMarkdownLinkTarget(currentPath, href)).toBe(null);
  });

  test("marks directory and non-markdown links for in-app navigation", () => {
    const html = renderMarkdownHtml(
      [
        "- [dir](./sub/)",
        "- [json](./assets/data.json)",
        "- [anchor](./guide.md#section-two)",
        "- [external](https://example.com)",
      ].join("\n"),
      { path: "docs/README.md", ref: "worktree" },
      null,
    );
    expect(html.includes('data-gdp-md-link="docs/sub"')).toBe(true);
    expect(html.includes('data-gdp-md-dir="1"')).toBe(true);
    expect(html.includes('data-gdp-md-link="docs/assets/data.json"')).toBe(
      true,
    );
    expect(html.includes('data-gdp-md-hash="section-two"')).toBe(true);
    // 素の相対 href が残ると SPA を抜けてサーバーの 404 に飛んでしまう。
    expect(html.includes('href="./sub/"')).toBe(false);
    expect(html.includes('href="./assets/data.json"')).toBe(false);
    expect(html.includes('href="https://example.com"')).toBe(true);
  });

  test("resolves relative markdown image assets through raw file URLs", () => {
    expect(
      resolveMarkdownAssetPath("docs/guide/intro.md", "./img/screen.png"),
    ).toBe("docs/guide/img/screen.png");
    expect(
      resolveMarkdownAssetPath(
        "docs/guide/intro.md",
        "../assets/logo.svg?raw=1",
      ),
    ).toBe("docs/assets/logo.svg");
    expect(
      resolveMarkdownAssetPath("docs/guide/intro.md", "/img/logo.svg"),
    ).toBe("img/logo.svg");
    expect(
      resolveMarkdownAssetPath(
        "docs/guide/intro.md",
        "https://example.com/logo.png",
      ),
    ).toBe(null);
    expect(
      resolveMarkdownAssetPath("docs/guide/intro.md", "../../../etc/passwd"),
    ).toBe(null);
  });

  test("allows object-store previews to provide their own markdown asset URLs", () => {
    const html = renderMarkdownHtml(
      "![shot](./img/screen.png)",
      { path: "docs/guide/intro.md", ref: "s3" },
      null,
      undefined,
      (path) => `/_db/s3/raw?key=${encodeURIComponent(path)}`,
    );
    expect(
      html.includes('src="/_db/s3/raw?key=docs%2Fguide%2Fimg%2Fscreen.png"'),
    ).toBe(true);
  });

  test.each([
    { tag: "<br>", label: "no-space br" },
    { tag: "<br/>", label: "solidus br" },
    { tag: "<br />", label: "spaced br" },
    { tag: "<BR>", label: "uppercase br" },
  ])("renders HTML $label tags as real line breaks", ({ tag }) => {
    const html = renderMarkdownHtml(
      `line1${tag}line2`,
      { path: "README.md", ref: "worktree" },
      null,
    );
    expect(html.includes("line1<br>line2")).toBe(true);
    expect(html.includes("&lt;br")).toBe(false);
  });

  test("leaves HTML line break tags untouched inside code blocks", () => {
    const html = renderMarkdownHtml(
      "```\nline1<br />line2\n```",
      { path: "README.md", ref: "worktree" },
      null,
    );
    expect(html.includes("&lt;br /&gt;")).toBe(true);
  });

  test.each([
    { type: "NOTE", label: "Note" },
    { type: "TIP", label: "Tip" },
    { type: "IMPORTANT", label: "Important" },
    { type: "WARNING", label: "Warning" },
    { type: "CAUTION", label: "Caution" },
  ])("renders GitHub-style $type alert block", ({ type, label }) => {
    const html = renderMarkdownHtml(
      `> [!${type}]\n> body text\n`,
      { path: "README.md", ref: "worktree" },
      null,
    );
    expect(
      html.includes(
        `class="markdown-alert markdown-alert-${type.toLowerCase()}"`,
      ),
    ).toBe(true);
    expect(html.includes(`<p class="markdown-alert-title">${label}</p>`)).toBe(
      true,
    );
    expect(html.includes("body text")).toBe(true);
    expect(html.includes(`[!${type}]`)).toBe(false);
  });

  test("does not turn a regular blockquote into an alert", () => {
    const html = renderMarkdownHtml(
      "> just a quote",
      { path: "README.md", ref: "worktree" },
      null,
    );
    expect(html.includes("markdown-alert")).toBe(false);
  });

  test("renders task lists as list items that can be enhanced after parsing", () => {
    const html = renderMarkdownHtml(
      "- [x] done\n- [ ] todo\n",
      { path: "README.md", ref: "worktree" },
      null,
    );
    expect(html.includes('<li data-gdp-task="checked">done</li>')).toBe(true);
    expect(html.includes('<li data-gdp-task="unchecked">todo</li>')).toBe(true);
  });

  test("renders skill-style YAML frontmatter as highlighted metadata before the body", () => {
    const seen: string[] = [];
    const highlighter = {
      codeToHtml: (code: string, options: { lang: string }) => {
        seen.push(options.lang);
        return (
          '<pre class="shiki"><code><span class="line" data-lang="' +
          options.lang +
          '">' +
          code +
          "</span></code></pre>"
        );
      },
    };
    const html = renderMarkdownHtml(
      "---\nname: my-original-psd-avatar-creation\ndescription: Use when creating an original 2D talking avatar character\n---\n# Body\n",
      { path: ".agents/skills/avatar/SKILL.md", ref: "worktree" },
      highlighter,
    );
    expect(seen).toEqual(["yaml"]);
    expect(html.includes('data-gdp-frontmatter="yaml"')).toBe(true);
    expect(html.includes("name: my-original-psd-avatar-creation")).toBe(true);
    expect(html.includes('<h1 id="body"')).toBe(true);
    expect(html.includes("<hr>")).toBe(false);
  });

  test("renders highlighted code blocks with Shiki markup", () => {
    const highlighter = {
      codeToHtml: (code: string, options: { lang: string }) =>
        '<pre class="shiki"><code><span class="line" data-lang="' +
        options.lang +
        '">' +
        code +
        "</span></code></pre>",
    };
    const html = renderMarkdownHtml(
      "```ts\nconst value = 1;\n```",
      { path: "README.md", ref: "worktree" },
      highlighter,
    );
    expect(html.includes('<pre class="shiki">')).toBe(true);
    expect(html.includes('data-lang="typescript"')).toBe(true);
  });

  test.each([
    { fence: "sh", code: "echo hello", expected: "bash" },
    { fence: "tsx", code: "return value;", expected: "typescript" },
    { fence: "jsx", code: "return value;", expected: "javascript" },
    {
      fence: "tf",
      code: 'resource "null_resource" "example" {}',
      expected: "terraform",
    },
    {
      fence: "tfvars",
      code: 'region = "ap-northeast-1"',
      expected: "terraform",
    },
    { fence: "gd", code: "func _ready():", expected: "gdscript" },
    { fence: "godot", code: "func _ready():", expected: "gdscript" },
    { fence: "gdscript", code: "func _ready():", expected: "gdscript" },
  ])("normalizes a $fence fence to the $expected Shiki language", ({
    fence,
    code,
    expected,
  }) => {
    const seen: string[] = [];
    const highlighter = {
      codeToHtml: (_code: string, options: { lang: string }) => {
        seen.push(options.lang);
        return '<pre class="shiki"><code><span class="line">x</span></code></pre>';
      },
    };
    const html = renderMarkdownHtml(
      `\`\`\`${fence}\n${code}\n\`\`\``,
      { path: "README.md", ref: "worktree" },
      highlighter,
    );
    expect(seen).toEqual([expected]);
    expect(html.includes('class="shiki"')).toBe(true);
  });

  test("slugifies Japanese and duplicate-safe heading ids deterministically", () => {
    expect(markdownSlugify("Hello World!")).toBe("hello-world");
    expect(markdownSlugify("日本語 見出し")).toBe("日本語-見出し");
    expect(markdownSlugify("***")).toBe("section");
  });

  test("markdown TOC includes h4 headings and exposes link titles", () => {
    expect(
      markdown.includes(
        'root.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id]")',
      ),
    ).toBe(true);
    expect(markdown.includes("link.title = entry.text")).toBe(true);
  });

  test("mermaid is built as a lazy standalone asset and served by the preview server", () => {
    expect(bundles.includes("web/mermaid.js")).toBe(true);
    expect(bundles.includes("web-src/mermaid-entry.ts")).toBe(true);
    expect(
      server.includes(
        "'/mermaid.js': ['mermaid.js', 'application/javascript; charset=utf-8']",
      ),
    ).toBe(true);
    // lazy import 本体は mermaid-loader.ts に切り出し済み。markdown-preview
    // 側は loader を呼ぶだけで、bundle 抑止のための非リテラル import 文字列は
    // loader にある。
    expect(mermaidLoader.includes('"mermaid.js"')).toBe(true);
    expect(mermaidLoader.includes('import(`/${"mermaid.js"}`)')).toBe(true);
    expect(mermaidLoader.includes('securityLevel: "strict"')).toBe(true);
    // mermaid の lightbox / error 描画は markdown-preview 側のまま。
    expect(markdown.includes("openMermaidLightbox")).toBe(true);
    expect(markdown.includes("renderMermaidError")).toBe(true);
  });

  test("Shiki is built as a lazy standalone asset for markdown code blocks", () => {
    expect(bundles.includes("web/shiki.js")).toBe(true);
    expect(bundles.includes("web-src/shiki-entry.ts")).toBe(true);
    expect(pkg.includes('"shiki"')).toBe(true);
    expect(
      server.includes(
        "'/shiki.js': ['shiki.js', 'application/javascript; charset=utf-8']",
      ),
    ).toBe(true);
    // lazy import 本体は shiki-loader.ts に切り出し済み。
    expect(shikiLoader.includes('"shiki.js"')).toBe(true);
    expect(shikiLoader.includes('import(`/${"shiki.js"}`)')).toBe(true);
    // markdown は loader を `themes: ["github-light","github-dark"]` で
    // 呼び出す側。
    expect(markdown.includes('"github-light", "github-dark"')).toBe(true);
  });

  test("markdown preview CSS includes TOC, tables, mermaid, and lightbox styling", () => {
    expect(style.includes(".gdp-markdown-layout")).toBe(true);
    expect(style.includes(".gdp-markdown-toc")).toBe(true);
    expect(style.includes(".gdp-standalone-source .gdp-markdown-toc")).toBe(
      false,
    );
    expect(style.includes(".gdp-standalone-source .gdp-markdown-layout")).toBe(
      false,
    );
    expect(style.includes(".gdp-markdown-layout {\n  display: grid;")).toBe(
      true,
    );
    expect(style.includes('content: "On this page";')).toBe(true);
    expect(style.includes("scrollbar-gutter: stable;")).toBe(true);
    expect(style.includes("scrollbar-width: thin;")).toBe(true);
    expect(style.includes(".gdp-markdown-toc a:focus-visible")).toBe(true);
    expect(style.includes(".gdp-markdown-toc .level-4 > a")).toBe(true);
    expect(style.includes(".gdp-markdown-preview table")).toBe(true);
    expect(style.includes(".gdp-markdown-preview .mermaid")).toBe(true);
    expect(style.includes(".mkdp-lightbox")).toBe(true);
    expect(style.includes(".mkdp-mermaid-error")).toBe(true);
  });

  // TOC の高さは「本文が使える高さ」(--content-h) から導く。100vh から直接引くと
  // 下パネルが開いたときに画面外へはみ出す。
  //
  // 生文字列ではなくカスケードを解決して見るのは、同じ文字列が別の規則にも現れると
  // 黙って無関係な規則を守り始めるため。実際この検査は以前 .app-panel の max-height を
  // 守っており、TOC 側を変えても緑のままだった。
  test("markdown TOC height follows the content envelope, not the raw viewport", () => {
    // デスクトップ既定の見た目を見る。@media の上書きは対象外。
    const rules = baseRules(loadStyleSheet());
    // body から見た値を使う。カスタムプロパティの var() は宣言した要素で確定するので、
    // ページごとの --chrome-h も docked の --app-panel-visible-height も body に載る。
    const bodyVariables = cascadedDeclarations(
      rules,
      (selector) =>
        selector === ":root" || selector === "html" || selector === "body",
    );

    // --content-h を :root だけで宣言すると、body 側の上書きが一切届かず、
    // docked にしても本文の下端がパネルの裏に入る。実際にその事故を起こした。
    const rootOnly = cascadedDeclarations(
      rules,
      (selector) => selector === ":root",
    );
    expect(rootOnly.has("--content-h")).toBe(false);
    expect(bodyVariables.has("--content-h")).toBe(true);

    const toc = cascadedDeclarations(
      rules,
      (selector) => selector === ".gdp-markdown-toc",
    );

    expect(toc.get("position")).toBe("sticky");
    expect(toc.get("overflow")).toBe("auto");

    const maxHeight = toc.get("max-height");
    if (!maxHeight) throw new Error("Missing .gdp-markdown-toc max-height");

    // 下パネルが占有する高さを変えると TOC の上限も変わること。
    // 100vh からの直接引き算に戻すと、この 2 つが同じ値になって落ちる。
    const panelClosed = resolveVar(
      maxHeight,
      new Map(bodyVariables).set("--app-panel-visible-height", "0px"),
    );
    const panelOpen = resolveVar(
      maxHeight,
      new Map(bodyVariables).set("--app-panel-visible-height", "320px"),
    );
    expect(panelClosed).not.toBe(panelOpen);
  });

  test("preview/code tabs can hide either rendered surface despite display-specific CSS", () => {
    expect(style.includes(".gdp-markdown-layout[hidden]")).toBe(true);
    expect(style.includes(".gdp-source-table[hidden]")).toBe(true);
    expect(style.includes("display: none !important")).toBe(true);
  });

  test("markdown preview applies Shiki light and dark theme variables", () => {
    expect(style.includes(".gdp-markdown-preview pre.shiki")).toBe(true);
    expect(style.includes("var(--shiki-light-bg)")).toBe(true);
    expect(style.includes("var(--shiki-dark-bg)")).toBe(true);
    expect(
      style.includes(
        '[data-theme="dark"] .gdp-markdown-preview pre.shiki span',
      ),
    ).toBe(true);
  });
});
